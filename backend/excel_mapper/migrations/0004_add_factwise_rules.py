# Generated manually to add factwise_rules field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0003_add_tag_template'),
    ]

    operations = [
        migrations.AddField(
            model_name='mappingtemplate',
            name='factwise_rules',
            field=models.JSONField(blank=True, default=list),
        ),
    ]