import importlib

from django.apps import apps
from django.db import IntegrityError, transaction
from django.test import TestCase

from excel_mapper.models import BomFieldPattern, ColumnRule


migration = importlib.import_module(
    'excel_mapper.migrations.0034_migrate_legacy_bom_field_patterns'
)


class BomLegacyPatternMigrationTests(TestCase):
    def _create_rule(self, name, parser_rule, **payload_overrides):
        payload = {
            'rule_type': 'bom_field_pattern',
            'shape': parser_rule.get('shape', ''),
            'pattern_key': parser_rule.get('patternKey', ''),
            'parser_rule': parser_rule,
            **payload_overrides,
        }
        return ColumnRule.objects.create(name=name, rule=payload)

    def test_migration_deduplicates_structure_scoped_copies(self):
        common = {
            'shape': 'primary.mpn=mpn',
            'patternKey': 'semantic-example',
            'fields': {'mpn': {'delimiter': '/'}},
        }
        global_rule = {
            **common,
            'libraryScope': 'global',
        }
        structure_rule = {
            **common,
            'libraryScope': 'structure',
            'structureSignature': 'layout-signature',
            'structureFingerprint': 'structure-fingerprint',
            'structureScope': {'headers': ['MPN']},
        }
        self._create_rule('legacy-global', global_rule)
        self._create_rule('legacy-structure', structure_rule)

        migration.migrate_legacy_patterns(apps, None)

        pattern = BomFieldPattern.objects.get()
        self.assertEqual(pattern.source, BomFieldPattern.SOURCE_LEGACY)
        self.assertIsNone(pattern.created_by_user_id)
        self.assertIsNone(pattern.created_by_entity_id)
        self.assertNotIn('libraryScope', pattern.parser_rule)
        self.assertNotIn('structureSignature', pattern.parser_rule)
        self.assertNotIn('structureFingerprint', pattern.parser_rule)
        self.assertNotIn('structureScope', pattern.parser_rule)
        self.assertEqual(ColumnRule.objects.count(), 2)

    def test_migration_uses_shape_when_pattern_key_is_missing(self):
        long_shape = 'pattern-' + ('x' * 320)
        self._create_rule(
            'legacy-without-key',
            {'shape': long_shape, 'fields': {'mpn': {'delimiter': ','}}},
        )

        migration.migrate_legacy_patterns(apps, None)

        pattern = BomFieldPattern.objects.get()
        self.assertEqual(pattern.pattern_key, long_shape)
        self.assertGreater(len(pattern.pattern_key), 255)

    def test_migration_is_idempotent_and_skips_non_pattern_rules(self):
        self._create_rule(
            'legacy-pattern',
            {
                'shape': 'primary.mpn=mpn',
                'patternKey': 'semantic-example',
                'fields': {'mpn': {}},
            },
        )
        ColumnRule.objects.create(
            name='ordinary-column-rule',
            rule={'rule_type': 'fill_column', 'target_column': 'Description'},
        )

        migration.migrate_legacy_patterns(apps, None)
        migration.migrate_legacy_patterns(apps, None)

        self.assertEqual(BomFieldPattern.objects.count(), 1)
        self.assertEqual(ColumnRule.objects.count(), 2)

    def test_reverse_removes_only_legacy_patterns(self):
        BomFieldPattern.objects.create(
            pattern_key='factwise-pattern',
            shape='factwise-pattern',
            interpretation_hash='f' * 64,
            parser_rule={'fields': {'mpn': {}}},
            source=BomFieldPattern.SOURCE_FACTWISE,
        )
        self._create_rule(
            'legacy-pattern',
            {
                'shape': 'legacy-pattern',
                'patternKey': 'legacy-pattern',
                'fields': {'mpn': {}},
            },
        )
        migration.migrate_legacy_patterns(apps, None)

        migration.remove_legacy_patterns(apps, None)

        self.assertEqual(
            list(BomFieldPattern.objects.values_list('source', flat=True)),
            [BomFieldPattern.SOURCE_FACTWISE],
        )

    def test_legacy_source_rejects_creator_identity(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            BomFieldPattern.objects.create(
                pattern_key='legacy-pattern',
                shape='legacy-pattern',
                interpretation_hash='a' * 64,
                parser_rule={'fields': {'mpn': {}}},
                source=BomFieldPattern.SOURCE_LEGACY,
                created_by_user_id='user-1',
                created_by_entity_id='entity-1',
            )
