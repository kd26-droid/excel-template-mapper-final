from django.db import IntegrityError, transaction
from django.test import TestCase

from excel_mapper.models import BomFieldPattern, ColumnRule


class BomFieldPatternModelTests(TestCase):
    def test_factwise_pattern_has_null_creator_identity(self):
        pattern = BomFieldPattern.objects.create(
            pattern_key='mpn-at-manufacturer',
            interpretation_hash='a' * 64,
            parser_rule={'fields': {'mpn': {'delimiter': 'none'}}},
            source=BomFieldPattern.SOURCE_FACTWISE,
        )

        self.assertIsNone(pattern.created_by_user_id)
        self.assertIsNone(pattern.created_by_entity_id)

    def test_user_pattern_requires_both_creator_ids(self):
        for user_id, entity_id in ((None, 'entity-1'), ('user-1', None), ('', 'entity-1'), ('user-1', '')):
            with self.subTest(user_id=user_id, entity_id=entity_id):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    BomFieldPattern.objects.create(
                        pattern_key=f'mpn-mfr-{user_id}-{entity_id}',
                        interpretation_hash='b' * 64,
                        parser_rule={'fields': {'mpn': {}}},
                        source=BomFieldPattern.SOURCE_USER,
                        created_by_user_id=user_id,
                        created_by_entity_id=entity_id,
                    )

    def test_identical_interpretation_is_unique_but_variant_is_allowed(self):
        original = BomFieldPattern.objects.create(
            pattern_key='combined-mpn-mfr',
            shape='<MPN> (<MFR>)',
            interpretation_hash='c' * 64,
            parser_rule={'visualPattern': {'segments': [{'role': 'mpn'}]}},
            source=BomFieldPattern.SOURCE_USER,
            created_by_user_id='user-1',
            created_by_entity_id='entity-1',
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            BomFieldPattern.objects.create(
                pattern_key=original.pattern_key,
                interpretation_hash=original.interpretation_hash,
                parser_rule=original.parser_rule,
                source=BomFieldPattern.SOURCE_USER,
                created_by_user_id='user-2',
                created_by_entity_id='entity-2',
            )

        variant = BomFieldPattern.objects.create(
            pattern_key=original.pattern_key,
            shape=original.shape,
            interpretation_hash='d' * 64,
            parser_rule={'visualPattern': {'segments': [{'role': 'manufacturer'}]}},
            source_pattern=original,
            source=BomFieldPattern.SOURCE_USER,
            created_by_user_id='user-2',
            created_by_entity_id='entity-2',
        )

        self.assertEqual(variant.source_pattern, original)
        self.assertEqual(original.derived_patterns.get(), variant)

    def test_existing_column_rules_remain_independent(self):
        column_rule = ColumnRule.objects.create(
            name='Fill missing quantity',
            rule={'value_mode': 'fixed', 'target_column': 'Quantity', 'value': '1'},
        )

        self.assertEqual(ColumnRule.objects.count(), 1)
        self.assertEqual(BomFieldPattern.objects.count(), 0)
        self.assertEqual(column_rule.rule['target_column'], 'Quantity')
