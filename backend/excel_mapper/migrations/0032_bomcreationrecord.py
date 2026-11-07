"""Ledger of BOMs each entity has produced through the mapper.

A new, empty table. Nothing existing is altered and nothing is backfilled:
BOMs made before this shipped were never recorded with their entity, so the
count starts from zero.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0031_scope_templates_by_entity'),
    ]

    operations = [
        migrations.CreateModel(
            name='BomCreationRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entity_id', models.CharField(db_index=True, max_length=120)),
                ('enterprise_id', models.CharField(blank=True, default='', max_length=120)),
                ('bom_code', models.CharField(max_length=255)),
                ('bom_key', models.CharField(max_length=255)),
                ('first_event', models.CharField(choices=[('sheet_export', 'BOM sheet exported'), ('factwise30_handoff', 'BOM sheet handed to FactWise 3.0'), ('factwise40_commit', 'BOM created in FactWise 4.0')], max_length=32)),
                ('first_session_id', models.CharField(blank=True, default='', max_length=120)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_event', models.CharField(choices=[('sheet_export', 'BOM sheet exported'), ('factwise30_handoff', 'BOM sheet handed to FactWise 3.0'), ('factwise40_commit', 'BOM created in FactWise 4.0')], max_length=32)),
                ('last_session_id', models.CharField(blank=True, default='', max_length=120)),
                ('last_used_at', models.DateTimeField(auto_now=True)),
                ('use_count', models.PositiveIntegerField(default=1)),
            ],
            options={
                'db_table': 'excel_mapper_bom_creation_record',
                'ordering': ['-created_at'],
                'constraints': [models.UniqueConstraint(fields=('entity_id', 'bom_key'), name='uq_bom_creation_entity_bom_key')],
            },
        ),
    ]
