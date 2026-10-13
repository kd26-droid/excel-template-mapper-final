"""Scope saved templates to the entity that owns them.

Until now a template name was globally unique, so "Aurora Praanv" could exist
once across every customer and a second save of that name silently overwrote
someone else's work. Uniqueness moves to (entity_id, name).

Existing rows keep a blank entity on purpose. They were saved before scoping
existed and nobody can say now which customer they belong to, so they stay
SHARED: visible to every entity, and still visible when the app is opened
outside FactWise 4.0 with no entity at all. Guessing an owner would hide
fourteen mapping templates and a hundred and twenty-one column rules from the
people using them.

BomStructurePattern is deliberately NOT scoped - it is keyed by sheet layout,
and the learned shape is useful across customers.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0030_add_littelfuse_compact_aliases'),
    ]

    operations = [
        # --- the name alone is no longer unique -----------------------------
        migrations.AlterField(
            model_name='mappingtemplate',
            name='name',
            field=models.CharField(max_length=200),
        ),
        migrations.AlterField(
            model_name='columnrule',
            name='name',
            field=models.CharField(max_length=200),
        ),
        migrations.AlterField(
            model_name='tagtemplate',
            name='name',
            field=models.CharField(max_length=200),
        ),
        migrations.AlterField(
            model_name='processingtemplate',
            name='name',
            field=models.CharField(max_length=200),
        ),

        # --- who owns it ----------------------------------------------------
        migrations.AddField(
            model_name='mappingtemplate',
            name='entity_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='mappingtemplate',
            name='entity_name',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='columnrule',
            name='entity_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='columnrule',
            name='entity_name',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='tagtemplate',
            name='entity_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='tagtemplate',
            name='entity_name',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='processingtemplate',
            name='entity_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='processingtemplate',
            name='entity_name',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),

        # --- one name per entity --------------------------------------------
        migrations.AlterUniqueTogether(
            name='mappingtemplate',
            unique_together={('entity_id', 'name')},
        ),
        migrations.AlterUniqueTogether(
            name='columnrule',
            unique_together={('entity_id', 'name')},
        ),
        migrations.AlterUniqueTogether(
            name='tagtemplate',
            unique_together={('entity_id', 'name')},
        ),
        migrations.AlterUniqueTogether(
            name='processingtemplate',
            unique_together={('entity_id', 'name')},
        ),
    ]
