import copy
import hashlib
import json

from django.db import migrations, models


STRUCTURE_ONLY_PARSER_KEYS = (
    'structureSignature',
    'structure_signature',
    'structureScope',
    'structure_scope',
    'structureFingerprint',
    'structure_fingerprint',
    'libraryScope',
    'library_scope',
    'matchedLibraryScope',
)


def _clean(value):
    return str(value or '').strip()


def _canonical_parser_rule(parser_rule):
    canonical = copy.deepcopy(parser_rule)
    for key in STRUCTURE_ONLY_PARSER_KEYS:
        canonical.pop(key, None)
    return canonical


def _interpretation_hash(parser_rule):
    serialized = json.dumps(
        parser_rule,
        sort_keys=True,
        separators=(',', ':'),
        ensure_ascii=True,
    )
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def migrate_legacy_patterns(apps, schema_editor):
    ColumnRule = apps.get_model('excel_mapper', 'ColumnRule')
    BomFieldPattern = apps.get_model('excel_mapper', 'BomFieldPattern')

    for column_rule in ColumnRule.objects.order_by('id').iterator():
        payload = column_rule.rule if isinstance(column_rule.rule, dict) else {}
        if payload.get('rule_type') != 'bom_field_pattern':
            continue

        parser_rule = payload.get('parser_rule')
        if not isinstance(parser_rule, dict) or not parser_rule:
            continue

        pattern_key = _clean(
            payload.get('pattern_key')
            or parser_rule.get('patternKey')
            or parser_rule.get('pattern_key')
            or payload.get('shape')
            or parser_rule.get('shape')
        )
        if not pattern_key:
            continue

        shape = _clean(
            payload.get('shape')
            or parser_rule.get('shape')
            or pattern_key
        )
        canonical_rule = _canonical_parser_rule(parser_rule)
        interpretation_hash = _interpretation_hash(canonical_rule)

        BomFieldPattern.objects.get_or_create(
            pattern_key=pattern_key,
            interpretation_hash=interpretation_hash,
            defaults={
                'shape': shape,
                'parser_rule': canonical_rule,
                'source': 'legacy',
                'created_by_user_id': None,
                'created_by_entity_id': None,
                'is_active': True,
                'usage_count': 0,
            },
        )


def remove_legacy_patterns(apps, schema_editor):
    BomFieldPattern = apps.get_model('excel_mapper', 'BomFieldPattern')
    BomFieldPattern.objects.filter(source='legacy').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0033_bomentitypatternstructure'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='bomfieldpattern',
            name='bom_pattern_valid_creator',
        ),
        migrations.AlterField(
            model_name='bomfieldpattern',
            name='pattern_key',
            field=models.CharField(max_length=512),
        ),
        migrations.AlterField(
            model_name='bomfieldpattern',
            name='source',
            field=models.CharField(
                choices=[
                    ('factwise', 'FactWise'),
                    ('legacy', 'Legacy import'),
                    ('user', 'User'),
                ],
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name='bomentitypatternstructure',
            name='pattern_key',
            field=models.CharField(max_length=512),
        ),
        migrations.AddConstraint(
            model_name='bomfieldpattern',
            constraint=models.CheckConstraint(
                check=(
                    models.Q(
                        source='factwise',
                        created_by_user_id__isnull=True,
                        created_by_entity_id__isnull=True,
                    )
                    | models.Q(
                        source='legacy',
                        created_by_user_id__isnull=True,
                        created_by_entity_id__isnull=True,
                    )
                    | (
                        models.Q(
                            source='user',
                            created_by_user_id__isnull=False,
                            created_by_entity_id__isnull=False,
                        )
                        & ~models.Q(created_by_user_id='')
                        & ~models.Q(created_by_entity_id='')
                    )
                ),
                name='bom_pattern_valid_creator',
            ),
        ),
        migrations.RunPython(migrate_legacy_patterns, remove_legacy_patterns),
    ]
