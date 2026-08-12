from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0024_mappingtemplate_default_value_rules'),
    ]

    operations = [
        migrations.CreateModel(
            name='EditorDefaultSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entity_name', models.CharField(db_index=True, max_length=200, unique=True)),
                ('item_type', models.CharField(blank=True, default='', max_length=80)),
                ('procurement_item', models.BooleanField(blank=True, null=True)),
                ('sales_item', models.BooleanField(blank=True, null=True)),
                ('measurement_unit', models.CharField(blank=True, default='', max_length=80)),
                ('item_code_rule', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'excel_mapper_editor_default_settings',
                'ordering': ['entity_name'],
            },
        ),
    ]
