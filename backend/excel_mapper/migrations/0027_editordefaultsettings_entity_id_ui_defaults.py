from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0026_columnrule'),
    ]

    operations = [
        migrations.AddField(
            model_name='editordefaultsettings',
            name='entity_id',
            field=models.CharField(blank=True, db_index=True, max_length=120, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='editordefaultsettings',
            name='ui_defaults',
            field=models.JSONField(blank=True, default=dict),
        ),
        # Two filing entities can share a display name, so the name alone can no
        # longer be the key. Existing rows keep working: they are found by name
        # until the first save under a known entity_id adopts them.
        migrations.AlterField(
            model_name='editordefaultsettings',
            name='entity_name',
            field=models.CharField(db_index=True, max_length=200),
        ),
    ]
