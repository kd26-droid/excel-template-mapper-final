"""Read and write BOM field patterns through the dedicated pattern tables."""

import copy
import hashlib
import json
from collections import defaultdict

from django.db.models import F, Prefetch, Q
from django.utils import timezone

from excel_mapper.models import (
    BomEntityFieldPattern,
    BomEntityPatternStructure,
    BomFieldPattern,
)


NON_CANONICAL_RULE_KEYS = {
    "structureSignature",
    "structure_signature",
    "structureScope",
    "structure_scope",
    "structureFingerprint",
    "structure_fingerprint",
    "libraryScope",
    "library_scope",
    "matchedLibraryScope",
    "matchedPatternId",
    "matchedInterpretationHash",
    "matchedRecognitionSource",
    "matchedRequiresReview",
    "matchedRuleAlternatives",
}


def _clean(value):
    return str(value or "").strip()


def canonical_parser_rule(rule):
    canonical = copy.deepcopy(rule) if isinstance(rule, dict) else {}
    for key in NON_CANONICAL_RULE_KEYS:
        canonical.pop(key, None)
    return canonical


def parser_rule_hash(rule):
    serialized = json.dumps(
        canonical_parser_rule(rule),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class BomPatternResolver:
    """Request-scoped, batched resolver with deterministic ownership priority."""

    def __init__(self, *, entity_id="", structure_pattern_id=None):
        self.entity_id = _clean(entity_id)
        self.structure_pattern_id = structure_pattern_id
        self._resolved = {}
        self._loaded_keys = set()

    def _load(self, lookup_keys):
        keys = {_clean(key) for key in lookup_keys or [] if _clean(key)}
        missing = keys - self._loaded_keys
        if not missing:
            return

        candidates_query = BomFieldPattern.objects.filter(is_active=True).filter(
            Q(pattern_key__in=missing) | Q(shape__in=missing)
        )
        if self.entity_id:
            approvals = BomEntityFieldPattern.objects.filter(
                created_by_entity_id=self.entity_id,
                is_active=True,
            ).prefetch_related(Prefetch(
                "structure_links",
                queryset=BomEntityPatternStructure.objects.filter(is_active=True),
                to_attr="active_structure_links",
            ))
            candidates_query = candidates_query.prefetch_related(Prefetch(
                "entity_approvals",
                queryset=approvals,
                to_attr="current_entity_approvals",
            ))
        candidates = list(candidates_query.order_by("-updated_at", "-id"))

        by_lookup = defaultdict(list)
        for pattern in candidates:
            matched_keys = {pattern.pattern_key, pattern.shape}.intersection(missing)
            for lookup_key in matched_keys:
                by_lookup[lookup_key].append(pattern)

        for lookup_key in missing:
            self._resolved[lookup_key] = self._choose(
                lookup_key,
                by_lookup.get(lookup_key, []),
            )
        self._loaded_keys.update(missing)

    def _priority(self, pattern):
        approvals = list(getattr(pattern, "current_entity_approvals", []) or [])
        structure_match = any(
            self.structure_pattern_id
            and link.structure_pattern_id == self.structure_pattern_id
            for approval in approvals
            for link in getattr(approval, "active_structure_links", [])
        )
        if structure_match:
            return 0, "structure", False
        if approvals:
            return 1, "entity", False
        if pattern.source == BomFieldPattern.SOURCE_FACTWISE:
            return 2, "factwise", False
        if pattern.source == BomFieldPattern.SOURCE_LEGACY:
            return 3, "legacy", True
        return 4, "other_entity", True

    def _choose(self, lookup_key, candidates):
        if not candidates:
            return None
        ranked = sorted(
            ((self._priority(pattern), pattern) for pattern in candidates),
            key=lambda item: (
                item[0][0],
                -item[1].updated_at.timestamp(),
                -item[1].id,
            ),
        )
        best_priority = ranked[0][0][0]
        equally_preferred = [item for item in ranked if item[0][0] == best_priority]
        (priority, match_scope, requires_review), selected = equally_preferred[0]
        ambiguous = len(equally_preferred) > 1
        if ambiguous:
            requires_review = True
            match_scope = f"{match_scope}_ambiguous"

        rule = copy.deepcopy(selected.parser_rule or {})
        rule.update({
            "matchedLibraryScope": match_scope,
            "matchedPatternId": selected.id,
            "matchedInterpretationHash": selected.interpretation_hash,
            "matchedRecognitionSource": selected.source,
            "matchedRequiresReview": bool(requires_review),
        })
        if ambiguous:
            rule["matchedRuleAlternatives"] = [
                {
                    "id": candidate.id,
                    "interpretationHash": candidate.interpretation_hash,
                    "source": candidate.source,
                }
                for _candidate_priority, candidate in equally_preferred
            ]
        return {
            "patternKey": selected.pattern_key,
            "lookupKey": lookup_key,
            "ruleId": selected.id,
            "version": 1,
            "updatedAt": selected.updated_at.isoformat() if selected.updated_at else None,
            "matchScope": match_scope,
            "requiresReview": bool(requires_review),
            "recognized": not requires_review,
            "rule": rule,
        }

    def interpretations(self, lookup_keys):
        self._load(lookup_keys)
        return {
            key: self._resolved[key]
            for key in {_clean(item) for item in lookup_keys or [] if _clean(item)}
            if self._resolved.get(key)
        }

    def rules(self, lookup_keys):
        return {
            key: copy.deepcopy(value["rule"])
            for key, value in self.interpretations(lookup_keys).items()
        }


def persist_confirmed_pattern_rules(
    confirmed_rules,
    *,
    actor,
    structure_pattern,
    confirmation_session_id="",
):
    """Persist confirmed variants and their entity/structure ownership in batches."""
    normalized = []
    for pattern_key, raw_rule in (confirmed_rules or {}).items():
        key = _clean(pattern_key)
        if not key or not isinstance(raw_rule, dict) or not raw_rule:
            continue
        rule = canonical_parser_rule(raw_rule)
        if not rule:
            continue
        normalized.append({
            "pattern_key": key,
            "shape": _clean(rule.get("shape")) or key,
            "hash": parser_rule_hash(rule),
            "rule": rule,
            "source_pattern_id": raw_rule.get("matchedPatternId"),
        })
    if not normalized:
        return []

    pattern_keys = {item["pattern_key"] for item in normalized}
    existing_patterns = list(BomFieldPattern.objects.filter(pattern_key__in=pattern_keys))
    patterns_by_identity = {
        (pattern.pattern_key, pattern.interpretation_hash): pattern
        for pattern in existing_patterns
    }
    existing_ids = {pattern.id for pattern in existing_patterns}
    missing_patterns = []
    for item in normalized:
        identity = (item["pattern_key"], item["hash"])
        if identity in patterns_by_identity:
            continue
        source_pattern_id = item["source_pattern_id"]
        if source_pattern_id not in existing_ids:
            source_pattern_id = None
        missing_patterns.append(BomFieldPattern(
            pattern_key=item["pattern_key"],
            shape=item["shape"],
            interpretation_hash=item["hash"],
            parser_rule=item["rule"],
            source_pattern_id=source_pattern_id,
            source=BomFieldPattern.SOURCE_USER,
            created_by_user_id=actor.user_id,
            created_by_entity_id=actor.entity_id,
            is_active=True,
        ))
    if missing_patterns:
        BomFieldPattern.objects.bulk_create(missing_patterns, ignore_conflicts=True)
        patterns_by_identity = {
            (pattern.pattern_key, pattern.interpretation_hash): pattern
            for pattern in BomFieldPattern.objects.filter(pattern_key__in=pattern_keys)
        }

    selected_patterns = [
        patterns_by_identity[(item["pattern_key"], item["hash"])]
        for item in normalized
    ]
    inactive_patterns = [pattern for pattern in selected_patterns if not pattern.is_active]
    if inactive_patterns:
        for pattern in inactive_patterns:
            pattern.is_active = True
            pattern.updated_at = timezone.now()
        BomFieldPattern.objects.bulk_update(
            inactive_patterns,
            ["is_active", "updated_at"],
        )
    selected_pattern_ids = {pattern.id for pattern in selected_patterns}
    approvals = {
        approval.field_pattern_id: approval
        for approval in BomEntityFieldPattern.objects.filter(
            created_by_entity_id=actor.entity_id,
            field_pattern_id__in=selected_pattern_ids,
        )
    }
    missing_approvals = [
        BomEntityFieldPattern(
            field_pattern=pattern,
            created_by_user_id=actor.user_id,
            created_by_entity_id=actor.entity_id,
            is_active=True,
        )
        for pattern in selected_patterns
        if pattern.id not in approvals
    ]
    if missing_approvals:
        BomEntityFieldPattern.objects.bulk_create(missing_approvals, ignore_conflicts=True)
        approvals = {
            approval.field_pattern_id: approval
            for approval in BomEntityFieldPattern.objects.filter(
                created_by_entity_id=actor.entity_id,
                field_pattern_id__in=selected_pattern_ids,
            )
        }

    now = timezone.now()
    inactive_approvals = [approval for approval in approvals.values() if not approval.is_active]
    for approval in inactive_approvals:
        approval.is_active = True
        approval.created_by_user_id = actor.user_id
        approval.updated_at = now
    if inactive_approvals:
        BomEntityFieldPattern.objects.bulk_update(
            inactive_approvals,
            ["is_active", "created_by_user_id", "updated_at"],
        )

    selected_by_key = {
        pattern.pattern_key: approvals[pattern.id]
        for pattern in selected_patterns
    }
    existing_links = list(BomEntityPatternStructure.objects.filter(
        created_by_entity_id=actor.entity_id,
        structure_pattern=structure_pattern,
        pattern_key__in=pattern_keys,
    ))
    links_by_pair = {
        (link.entity_field_pattern_id, link.structure_pattern_id): link
        for link in existing_links
    }
    links_to_deactivate = []
    links_to_activate = []
    for link in existing_links:
        selected_approval = selected_by_key.get(link.pattern_key)
        should_be_active = bool(
            selected_approval
            and link.entity_field_pattern_id == selected_approval.id
        )
        if should_be_active:
            link.is_active = True
            link.updated_by_user_id = actor.user_id
            link.deactivated_by_user_id = None
            link.deactivated_at = None
            link.deactivation_reason = ""
            link.version += 1
            link.usage_count += 1
            link.last_used_at = now
            link.updated_at = now
            links_to_activate.append(link)
        elif link.is_active:
            link.is_active = False
            link.updated_by_user_id = actor.user_id
            link.deactivated_by_user_id = actor.user_id
            link.deactivated_at = now
            link.deactivation_reason = "Replaced by a newly confirmed interpretation."
            link.updated_at = now
            links_to_deactivate.append(link)
    update_fields = [
        "is_active",
        "updated_by_user_id",
        "deactivated_by_user_id",
        "deactivated_at",
        "deactivation_reason",
        "version",
        "usage_count",
        "last_used_at",
        "updated_at",
    ]
    # Deactivate the previous winner before activating its replacement so the
    # partial unique constraint is never transiently violated.
    if links_to_deactivate:
        BomEntityPatternStructure.objects.bulk_update(
            links_to_deactivate,
            update_fields,
        )
    if links_to_activate:
        BomEntityPatternStructure.objects.bulk_update(
            links_to_activate,
            update_fields,
        )

    new_links = []
    for pattern_key, approval in selected_by_key.items():
        pair = (approval.id, structure_pattern.id)
        if pair in links_by_pair:
            continue
        new_links.append(BomEntityPatternStructure(
            entity_field_pattern=approval,
            structure_pattern=structure_pattern,
            pattern_key=pattern_key,
            created_by_user_id=actor.user_id,
            created_by_entity_id=actor.entity_id,
            updated_by_user_id=actor.user_id,
            confirmation_source=BomEntityPatternStructure.CONFIRMATION_APPLY,
            confirmation_session_id=_clean(confirmation_session_id),
            is_active=True,
            version=1,
            usage_count=1,
            last_used_at=now,
        ))
    if new_links:
        BomEntityPatternStructure.objects.bulk_create(new_links)

    BomFieldPattern.objects.filter(id__in=selected_pattern_ids).update(
        usage_count=F("usage_count") + 1,
    )
    BomEntityFieldPattern.objects.filter(
        id__in={approval.id for approval in selected_by_key.values()}
    ).update(usage_count=F("usage_count") + 1)

    return [
        {
            "id": pattern.id,
            "created": (pattern.pattern_key, pattern.interpretation_hash)
            not in {
                (existing.pattern_key, existing.interpretation_hash)
                for existing in existing_patterns
            },
            "patternKey": pattern.pattern_key,
            "interpretationHash": pattern.interpretation_hash,
            "scope": "entity_structure",
        }
        for pattern in selected_patterns
    ]
