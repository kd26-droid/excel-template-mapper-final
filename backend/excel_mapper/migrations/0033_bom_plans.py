"""Monthly BOM plans and which plan each entity is on.

Two new tables. The three agreed plans are seeded and stay editable in admin:
15 per month, 25 per month, and unlimited. No entity is assigned a plan, so
every entity stays unlimited until someone puts it on one.
"""

import django.db.models.deletion
from django.db import migrations, models

SEED_PLANS = [
    ('15 BOMs / month', 15),
    ('25 BOMs / month', 25),
    ('Unlimited', None),
]


def seed_plans(apps, schema_editor):
    BomPlan = apps.get_model('excel_mapper', 'BomPlan')
    for name, limit in SEED_PLANS:
        BomPlan.objects.get_or_create(name=name, defaults={'monthly_bom_limit': limit})


def unseed_plans(apps, schema_editor):
    BomPlan = apps.get_model('excel_mapper', 'BomPlan')
    BomPlan.objects.filter(name__in=[name for name, _ in SEED_PLANS],
                           entities__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0032_bomcreationrecord'),
    ]

    operations = [
        migrations.CreateModel(
            name='BomPlan',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80, unique=True)),
                ('monthly_bom_limit', models.PositiveIntegerField(blank=True, help_text='New BOMs per calendar month (IST). Leave blank for unlimited.', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'excel_mapper_bom_plan',
                'ordering': ['monthly_bom_limit', 'name'],
            },
        ),
        migrations.CreateModel(
            name='EntityBomPlan',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entity_id', models.CharField(max_length=120, unique=True)),
                ('note', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='entities', to='excel_mapper.bomplan')),
            ],
            options={
                'db_table': 'excel_mapper_entity_bom_plan',
                'ordering': ['entity_id'],
                'verbose_name': 'entity BOM plan',
            },
        ),
        migrations.RunPython(seed_plans, unseed_plans),
    ]
