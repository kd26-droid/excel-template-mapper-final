from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('excel_mapper', '0021_rename_excel_mappe_name_18e9ee_idx_excel_mappe_name_d14a11_idx_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProviderMpnCache',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(max_length=20)),
                ('scope', models.CharField(blank=True, default='', max_length=100)),
                ('mpn_normalized', models.CharField(max_length=255)),
                ('validation_data', models.JSONField()),
                ('is_valid', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'excel_mapper_provider_mpn_cache',
                'indexes': [
                    models.Index(fields=['provider', 'scope', 'mpn_normalized'], name='excel_mappe_provide_5aaf9a_idx'),
                    models.Index(fields=['updated_at'], name='excel_mappe_updated_ff36ac_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(fields=('provider', 'scope', 'mpn_normalized'), name='unique_provider_scope_mpn_cache'),
                ],
            },
        ),
    ]
