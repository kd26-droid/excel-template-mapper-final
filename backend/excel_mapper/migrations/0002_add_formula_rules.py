# Generated migration for adding formula_rules field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='mappingtemplate',
            name='formula_rules',
            field=models.JSONField(blank=True, default=list),
        ),
    ]