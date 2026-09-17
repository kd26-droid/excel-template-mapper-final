from .bom_directory_store import clean, upsert_directory_pairs
from .mpn_pattern_library import (
    assess_mpn_text,
    clear_scoring_caches,
    load_manufacturer_lookup,
    load_manufacturer_phrase_lookup,
    load_manufacturer_phrase_token_index,
    load_mpn_lookup_lengths,
    load_mpn_mfr_lookup,
    load_mpn_pattern_library,
)
from .bom_role_inference import save_bom_field_pattern_rule


def _field_value(fields, key):
    value = fields.get(key) if isinstance(fields, dict) else ""
    if isinstance(value, dict):
        value = value.get("value")
    return clean(value)


def _confirmed_pairs_from_entries(entries, source_row=None):
    pairs = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        fields = entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
        mpn = _field_value(fields, "mpn")
        manufacturer = _field_value(fields, "manufacturer")
        if not mpn and not manufacturer:
            continue
        if mpn:
            assessment = assess_mpn_text(mpn)
            if assessment.get("hard_reject"):
                continue
            mpn = clean(assessment.get("candidate_text") or mpn)
        pairs.append({
            "mpn": mpn,
            "manufacturer": manufacturer,
            "source_row": source_row,
        })
    return pairs


def _clear_directory_caches():
    for loader in (
        load_manufacturer_lookup,
        load_manufacturer_phrase_lookup,
        load_manufacturer_phrase_token_index,
        load_mpn_lookup_lengths,
        load_mpn_mfr_lookup,
        load_mpn_pattern_library,
        clear_scoring_caches,
    ):
        clear = getattr(loader, "cache_clear", None)
        if callable(clear):
            clear()
        elif callable(loader):
            loader()

    try:
        from .bom_role_inference import clear_bom_role_inference_caches
        clear_bom_role_inference_caches()
    except Exception:
        pass


def _structure_for_fingerprint(structure_fingerprint):
    if not structure_fingerprint:
        return None


def _global_reusable_pattern_rule(rule):
    """Remove source-structure and literal row corrections from a reusable rule."""
    reusable = dict(rule or {})
    for key in (
        "structureScope",
        "structure_scope",
        "structureSignature",
        "structure_signature",
        "structureFingerprint",
        "structure_fingerprint",
        "authoritativeCorrection",
        "authoritative_correction",
    ):
        reusable.pop(key, None)

    visual_pattern = reusable.get("visualPattern") or reusable.get("visual_pattern")
    if isinstance(visual_pattern, dict):
        visual_pattern = dict(visual_pattern)
        visual_pattern.pop("manualCorrections", None)
        visual_pattern.pop("manual_corrections", None)
        reusable["visualPattern"] = visual_pattern
        reusable.pop("visual_pattern", None)
    return reusable
    try:
        from excel_mapper.models import BomStructurePattern
        return BomStructurePattern.objects.filter(signature_hash=structure_fingerprint).first()
    except Exception:
        return None


def learn_normalized_bom_rows(
    rows,
    *,
    status="verified",
    source="normalizer_continue",
    structure_scope=None,
    structure_fingerprint="",
):
    pairs = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        mpn = clean(row.get("mpn") or row.get("MPN"))
        manufacturer = clean(row.get("manufacturer") or row.get("Manufacturer") or row.get("MFR"))
        if not mpn and not manufacturer:
            continue
        entries = [{"fields": {"mpn": mpn, "manufacturer": manufacturer}}]
        pairs.extend(_confirmed_pairs_from_entries(entries, source_row=row.get("sourceRow")))

    structure_scope = structure_scope if isinstance(structure_scope, dict) else {}
    result = upsert_directory_pairs(
        pairs,
        status=status,
        source=source,
        structure=_structure_for_fingerprint(structure_fingerprint),
        structure_signature=structure_scope.get("signature") or "",
    )
    if result.get("confirmed_entries"):
        _clear_directory_caches()
    return {"success": True, **result}


def learn_confirmed_bom_field_patterns(groups, structure_scope=None, structure_fingerprint=""):
    pairs = []
    saved_pattern_rules = []
    structure_scope = dict(structure_scope) if isinstance(structure_scope, dict) else {}
    structure_signature = clean(structure_scope.get("signature"))
    structure_fingerprint = clean(structure_fingerprint)
    for group in groups or []:
        if not isinstance(group, dict) or group.get("confirmed") is False:
            continue
        rule = group.get("rule")
        if isinstance(rule, dict):
            rule = {
                **rule,
                "structureScope": structure_scope,
                "structureSignature": structure_signature,
                "structureFingerprint": structure_fingerprint,
            }
            saved_rule = save_bom_field_pattern_rule(
                rule,
                description="User-confirmed BOM field parser pattern",
            )
            if saved_rule:
                saved_pattern_rules.append(saved_rule)
            # Only semantic pattern identities are safe across arbitrary sheet
            # structures. Shape-only cleanup rules (for example strip-prefix)
            # remain scoped to the structure where the user taught them.
            if clean(rule.get("patternKey") or rule.get("pattern_key")):
                global_rule = save_bom_field_pattern_rule(
                    _global_reusable_pattern_rule(rule),
                    description="Globally reusable user-confirmed BOM field parser pattern",
                    library_scope="global",
                )
                if global_rule:
                    saved_pattern_rules.append(global_rule)
        for row in group.get("rows") or []:
            entries = row.get("entries") if isinstance(row, dict) else []
            source_row = row.get("sourceRow") if isinstance(row, dict) else None
            pairs.extend(_confirmed_pairs_from_entries(entries, source_row=source_row))

    learned = upsert_directory_pairs(
        pairs,
        status="pending",
        source="user_confirmed_pattern",
        structure=_structure_for_fingerprint(structure_fingerprint),
        structure_signature=structure_signature,
    )
    if learned.get("confirmed_entries"):
        _clear_directory_caches()
    return {
        "success": True,
        **learned,
        "saved_pattern_rules": saved_pattern_rules,
    }
