from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0027_editordefaultsettings_entity_id_ui_defaults'),
    ]

    operations = [
        migrations.CreateModel(
            name='BomStructurePattern',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(blank=True, default='', max_length=200)),
                ('structure_type', models.CharField(blank=True, default='', max_length=80)),
                ('signature_hash', models.CharField(max_length=64, unique=True)),
                ('source_signature', models.JSONField(blank=True, default=dict)),
                ('structure_profile', models.JSONField(blank=True, default=dict)),
                ('roles', models.JSONField(blank=True, default=dict)),
                ('config', models.JSONField(blank=True, default=dict)),
                ('workflow', models.JSONField(blank=True, default=dict)),
                ('confidence', models.FloatField(default=0.0)),
                ('sample_count', models.IntegerField(default=0)),
                ('usage_count', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'excel_mapper_bom_structure_pattern',
                'ordering': ['-updated_at'],
                'indexes': [
                    models.Index(fields=['structure_type', '-updated_at'], name='excel_mappe_structu_4f5739_idx'),
                    models.Index(fields=['signature_hash'], name='excel_mappe_signatu_d4af8f_idx'),
                ],
            },
        ),
    ]
