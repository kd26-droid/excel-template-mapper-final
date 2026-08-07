from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0023_mappingtemplate_bom_structure'),
    ]

    operations = [
        migrations.AddField(
            model_name='mappingtemplate',
            name='default_value_rules',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
