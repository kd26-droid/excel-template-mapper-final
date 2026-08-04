# Generated manually to align MappingTemplate defaults with the SFO mapper UI.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0019_processingtemplate'),
    ]

    operations = [
        migrations.AlterField(
            model_name='mappingtemplate',
            name='spec_pairs_count',
            field=models.IntegerField(default=3),
        ),
        migrations.AlterField(
            model_name='mappingtemplate',
            name='tags_count',
            field=models.IntegerField(default=3),
        ),
    ]
