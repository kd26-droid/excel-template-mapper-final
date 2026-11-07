from types import SimpleNamespace

from django.db import connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from excel_mapper.models import (
    BomEntityFieldPattern,
    BomEntityPatternStructure,
    BomFieldPattern,
    BomStructurePattern,
)
from excel_mapper.services.bom_pattern_repository import (
    BomPatternResolver,
    parser_rule_hash,
    persist_confirmed_pattern_rules,
)


class BomPatternResolverTests(TestCase):
    def setUp(self):
        self.entity_id = "entity-a"
        self.user_id = "user-a"
        self.structure = BomStructurePattern.objects.create(
            name="Structure A",
            signature_hash="a" * 64,
        )

    def _pattern(self, key, marker, source, entity_id=None):
        rule = {"shape": key, "fields": {"mpn": {"delimiter": marker}}}
        return BomFieldPattern.objects.create(
            pattern_key=key,
            shape=key,
            interpretation_hash=parser_rule_hash(rule),
            parser_rule=rule,
            source=source,
            created_by_user_id="creator" if source == "user" else None,
            created_by_entity_id=entity_id if source == "user" else None,
        )

    def _approve(self, pattern, entity_id=None, structure=None):
        entity_id = entity_id or self.entity_id
        approval = BomEntityFieldPattern.objects.create(
            field_pattern=pattern,
            created_by_user_id=self.user_id,
            created_by_entity_id=entity_id,
        )
        if structure:
            BomEntityPatternStructure.objects.create(
                entity_field_pattern=approval,
                structure_pattern=structure,
                pattern_key=pattern.pattern_key,
                created_by_user_id=self.user_id,
                created_by_entity_id=entity_id,
                confirmation_source="apply",
            )
        return approval

    def test_resolution_precedence_is_structure_entity_factwise_then_review(self):
        key = "semantic-shared"
        legacy = self._pattern(key, "legacy", "legacy")
        self._pattern(key, "factwise", "factwise")
        entity = self._pattern(key, "entity", "user", self.entity_id)
        structure = self._pattern(key, "structure", "user", self.entity_id)
        self._approve(entity)
        self._approve(structure, structure=self.structure)

        resolved = BomPatternResolver(
            entity_id=self.entity_id,
            structure_pattern_id=self.structure.id,
        ).interpretations([key])[key]

        self.assertEqual(resolved["ruleId"], structure.id)
        self.assertEqual(resolved["matchScope"], "structure")
        self.assertTrue(resolved["recognized"])
        self.assertNotEqual(resolved["ruleId"], legacy.id)

    def test_other_entity_and_legacy_candidates_need_review(self):
        other = self._pattern("other", "comma", "user", "entity-b")
        legacy = self._pattern("legacy", "slash", "legacy")
        resolved = BomPatternResolver(entity_id=self.entity_id).interpretations(
            ["other", "legacy"]
        )

        self.assertEqual(resolved["other"]["ruleId"], other.id)
        self.assertTrue(resolved["other"]["requiresReview"])
        self.assertEqual(resolved["other"]["matchScope"], "other_entity")
        self.assertEqual(resolved["legacy"]["ruleId"], legacy.id)
        self.assertTrue(resolved["legacy"]["requiresReview"])

    def test_anonymous_reads_recognize_factwise_and_review_legacy_rules(self):
        factwise = self._pattern("factwise", "comma", "factwise")
        legacy = self._pattern("legacy", "slash", "legacy")

        with CaptureQueriesContext(connection) as queries:
            resolved = BomPatternResolver().interpretations(["factwise", "legacy"])

        self.assertEqual(len(queries), 1)
        self.assertEqual(resolved["factwise"]["ruleId"], factwise.id)
        self.assertTrue(resolved["factwise"]["recognized"])
        self.assertEqual(resolved["factwise"]["matchScope"], "factwise")
        self.assertEqual(resolved["legacy"]["ruleId"], legacy.id)
        self.assertFalse(resolved["legacy"]["recognized"])
        self.assertEqual(resolved["legacy"]["matchScope"], "legacy")

    def test_ambiguous_same_entity_variants_require_review(self):
        first = self._pattern("ambiguous", "comma", "user", self.entity_id)
        second = self._pattern("ambiguous", "slash", "user", self.entity_id)
        self._approve(first)
        self._approve(second)

        resolved = BomPatternResolver(entity_id=self.entity_id).interpretations(
            ["ambiguous"]
        )["ambiguous"]

        self.assertFalse(resolved["recognized"])
        self.assertTrue(resolved["requiresReview"])
        self.assertEqual(resolved["matchScope"], "entity_ambiguous")
        self.assertCountEqual(
            [item["id"] for item in resolved["rule"]["matchedRuleAlternatives"]],
            [first.id, second.id],
        )

    def test_batch_resolution_query_count_does_not_grow_per_pattern(self):
        for index in range(20):
            self._pattern(f"pattern-{index}", str(index), "factwise")
        resolver = BomPatternResolver(entity_id=self.entity_id)

        with CaptureQueriesContext(connection) as queries:
            resolved = resolver.interpretations([f"pattern-{index}" for index in range(20)])

        self.assertEqual(len(resolved), 20)
        self.assertLessEqual(len(queries), 3)


class BomPatternPersistenceTests(TestCase):
    def setUp(self):
        self.actor = SimpleNamespace(user_id="user-a", entity_id="entity-a")
        self.structure = BomStructurePattern.objects.create(
            name="Structure A",
            signature_hash="b" * 64,
        )

    def test_apply_is_idempotent_and_reuses_all_three_records(self):
        rules = {"semantic-a": {"shape": "semantic-a", "fields": {"mpn": {"delimiter": "/"}}}}

        with transaction.atomic():
            first = persist_confirmed_pattern_rules(
                rules,
                actor=self.actor,
                structure_pattern=self.structure,
                confirmation_session_id="session-a",
            )
        with transaction.atomic():
            second = persist_confirmed_pattern_rules(
                rules,
                actor=self.actor,
                structure_pattern=self.structure,
                confirmation_session_id="session-a",
            )

        self.assertEqual(first[0]["id"], second[0]["id"])
        self.assertEqual(BomFieldPattern.objects.count(), 1)
        self.assertEqual(BomEntityFieldPattern.objects.count(), 1)
        self.assertEqual(BomEntityPatternStructure.objects.count(), 1)
        link = BomEntityPatternStructure.objects.get()
        self.assertTrue(link.is_active)
        self.assertEqual(link.usage_count, 2)

    def test_changed_interpretation_keeps_variant_and_switches_active_link(self):
        first_rule = {"semantic-a": {"shape": "semantic-a", "fields": {"mpn": {"delimiter": "/"}}}}
        second_rule = {"semantic-a": {"shape": "semantic-a", "fields": {"mpn": {"delimiter": "newline"}}}}

        persist_confirmed_pattern_rules(
            first_rule,
            actor=self.actor,
            structure_pattern=self.structure,
        )
        persist_confirmed_pattern_rules(
            second_rule,
            actor=self.actor,
            structure_pattern=self.structure,
        )

        self.assertEqual(BomFieldPattern.objects.count(), 2)
        self.assertEqual(BomEntityFieldPattern.objects.count(), 2)
        self.assertEqual(BomEntityPatternStructure.objects.count(), 2)
        links = BomEntityPatternStructure.objects.order_by("created_at")
        self.assertFalse(links[0].is_active)
        self.assertTrue(links[1].is_active)
        self.assertEqual(links[0].deactivated_by_user_id, self.actor.user_id)

    def test_structure_metadata_is_not_part_of_canonical_hash(self):
        base = {"shape": "semantic-a", "fields": {"mpn": {"delimiter": "/"}}}
        scoped = {
            **base,
            "structureSignature": "temporary",
            "structureScope": {"headers": ["MPN"]},
            "matchedPatternId": 99,
        }
        self.assertEqual(parser_rule_hash(base), parser_rule_hash(scoped))
