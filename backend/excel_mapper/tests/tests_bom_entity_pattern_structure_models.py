from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone

from excel_mapper.models import (
    BomEntityFieldPattern,
    BomEntityPatternStructure,
    BomFieldPattern,
    BomStructurePattern,
)


class BomEntityPatternStructureModelTests(TestCase):
    def _canonical_pattern(self, pattern_key='combined-mpn-mfr', hash_character='a'):
        return BomFieldPattern.objects.create(
            pattern_key=pattern_key,
            shape='<MPN> (<MFR>)',
            interpretation_hash=hash_character * 64,
            parser_rule={'visualPattern': {'segments': []}},
            source=BomFieldPattern.SOURCE_FACTWISE,
        )

    def _entity_pattern(self, canonical=None, entity_id='entity-1'):
        return BomEntityFieldPattern.objects.create(
            field_pattern=canonical or self._canonical_pattern(),
            created_by_user_id='user-1',
            created_by_entity_id=entity_id,
        )

    def _structure(self, signature_character='1'):
        return BomStructurePattern.objects.create(
            name=f'Structure {signature_character}',
            signature_hash=signature_character * 64,
        )

    def _link(self, entity_pattern=None, structure=None, **overrides):
        entity_pattern = entity_pattern or self._entity_pattern()
        values = {
            'entity_field_pattern': entity_pattern,
            'structure_pattern': structure or self._structure(),
            'pattern_key': entity_pattern.field_pattern.pattern_key,
            'created_by_user_id': 'user-1',
            'created_by_entity_id': entity_pattern.created_by_entity_id,
            'confirmation_source': BomEntityPatternStructure.CONFIRMATION_APPLY,
        }
        values.update(overrides)
        return BomEntityPatternStructure.objects.create(**values)

    def test_entity_pattern_can_link_to_multiple_structures(self):
        entity_pattern = self._entity_pattern()
        self._link(entity_pattern=entity_pattern, structure=self._structure('1'))
        self._link(entity_pattern=entity_pattern, structure=self._structure('2'))

        self.assertEqual(entity_pattern.structures.count(), 2)
        self.assertEqual(entity_pattern.structure_links.count(), 2)

    def test_structure_can_link_to_multiple_pattern_keys(self):
        structure = self._structure()
        first = self._entity_pattern()
        second = self._entity_pattern(
            canonical=self._canonical_pattern('quantity-cleanup', 'b'),
        )
        self._link(entity_pattern=first, structure=structure)
        self._link(entity_pattern=second, structure=structure)

        self.assertEqual(structure.entity_pattern_links.count(), 2)

    def test_duplicate_entity_pattern_structure_pair_is_rejected(self):
        link = self._link()

        with self.assertRaises(ValidationError):
            self._link(
                entity_pattern=link.entity_field_pattern,
                structure=link.structure_pattern,
            )

    def test_only_one_interpretation_is_active_for_entity_structure_and_key(self):
        structure = self._structure()
        original = self._entity_pattern()
        variant = self._entity_pattern(
            canonical=self._canonical_pattern('combined-mpn-mfr', 'b'),
        )
        self._link(entity_pattern=original, structure=structure)

        with self.assertRaises(ValidationError):
            self._link(entity_pattern=variant, structure=structure)

        historical = self._link(
            entity_pattern=variant,
            structure=structure,
            is_active=False,
            deactivated_by_user_id='user-2',
            deactivated_at=timezone.now(),
            deactivation_reason='Superseded interpretation',
        )
        self.assertFalse(historical.is_active)

    def test_creator_and_pattern_identity_are_required(self):
        entity_pattern = self._entity_pattern()
        structure = self._structure()
        for overrides in (
            {'pattern_key': ''},
            {'created_by_user_id': ''},
            {'created_by_entity_id': ''},
            {'confirmation_source': ''},
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValidationError):
                    self._link(
                        entity_pattern=entity_pattern,
                        structure=structure,
                        **overrides,
                    )

    def test_entity_and_pattern_key_must_match_entity_pattern(self):
        entity_pattern = self._entity_pattern()
        structure = self._structure()

        with self.assertRaises(ValidationError):
            self._link(
                entity_pattern=entity_pattern,
                structure=structure,
                created_by_entity_id='entity-2',
            )
        with self.assertRaises(ValidationError):
            self._link(
                entity_pattern=entity_pattern,
                structure=structure,
                pattern_key='different-pattern',
            )

    def test_active_and_inactive_audit_state_is_consistent(self):
        entity_pattern = self._entity_pattern()
        structure = self._structure()

        with self.assertRaises(ValidationError):
            self._link(
                entity_pattern=entity_pattern,
                structure=structure,
                is_active=False,
            )
        with self.assertRaises(ValidationError):
            self._link(
                entity_pattern=entity_pattern,
                structure=structure,
                deactivated_by_user_id='user-2',
                deactivated_at=timezone.now(),
            )

    def test_referenced_records_are_protected(self):
        link = self._link()

        with self.assertRaises(ProtectedError):
            link.entity_field_pattern.delete()
        with self.assertRaises(ProtectedError):
            link.structure_pattern.delete()

    def test_database_constraints_reject_bypassed_duplicate(self):
        link = self._link()

        with self.assertRaises(IntegrityError), transaction.atomic():
            BomEntityPatternStructure.objects.bulk_create([
                BomEntityPatternStructure(
                    entity_field_pattern=link.entity_field_pattern,
                    structure_pattern=link.structure_pattern,
                    pattern_key=link.pattern_key,
                    created_by_user_id='user-2',
                    created_by_entity_id=link.created_by_entity_id,
                    confirmation_source=BomEntityPatternStructure.CONFIRMATION_APPLY,
                ),
            ])
