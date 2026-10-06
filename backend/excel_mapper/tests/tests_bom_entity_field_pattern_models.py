from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase

from excel_mapper.models import BomEntityFieldPattern, BomFieldPattern


class BomEntityFieldPatternModelTests(TestCase):
    def _pattern(self, interpretation_hash='a' * 64, source_pattern=None):
        return BomFieldPattern.objects.create(
            pattern_key='combined-mpn-mfr',
            shape='<MPN> (<MFR>)',
            interpretation_hash=interpretation_hash,
            parser_rule={'visualPattern': {'segments': []}},
            source_pattern=source_pattern,
            source=BomFieldPattern.SOURCE_FACTWISE,
        )

    def test_creator_user_and_entity_ids_are_required(self):
        pattern = self._pattern()

        for user_id, entity_id in (
            (None, 'entity-1'),
            ('user-1', None),
            ('', 'entity-1'),
            ('user-1', ''),
        ):
            with self.subTest(user_id=user_id, entity_id=entity_id):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    BomEntityFieldPattern.objects.create(
                        field_pattern=pattern,
                        created_by_user_id=user_id,
                        created_by_entity_id=entity_id,
                    )

    def test_duplicate_entity_pattern_association_is_rejected(self):
        pattern = self._pattern()
        BomEntityFieldPattern.objects.create(
            field_pattern=pattern,
            created_by_user_id='user-1',
            created_by_entity_id='entity-1',
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            BomEntityFieldPattern.objects.create(
                field_pattern=pattern,
                created_by_user_id='user-2',
                created_by_entity_id='entity-1',
            )

    def test_entity_can_approve_multiple_interpretations(self):
        original = self._pattern()
        variant = self._pattern('b' * 64, source_pattern=original)

        for pattern in (original, variant):
            BomEntityFieldPattern.objects.create(
                field_pattern=pattern,
                created_by_user_id='user-1',
                created_by_entity_id='entity-1',
            )

        self.assertEqual(
            BomEntityFieldPattern.objects.filter(
                created_by_entity_id='entity-1',
            ).count(),
            2,
        )

    def test_pattern_can_be_approved_by_multiple_entities(self):
        pattern = self._pattern()

        for entity_id in ('entity-1', 'entity-2'):
            BomEntityFieldPattern.objects.create(
                field_pattern=pattern,
                created_by_user_id=f'user-for-{entity_id}',
                created_by_entity_id=entity_id,
            )

        self.assertEqual(pattern.entity_approvals.count(), 2)

    def test_approved_canonical_pattern_cannot_be_deleted(self):
        pattern = self._pattern()
        BomEntityFieldPattern.objects.create(
            field_pattern=pattern,
            created_by_user_id='user-1',
            created_by_entity_id='entity-1',
        )

        with self.assertRaises(ProtectedError):
            pattern.delete()
