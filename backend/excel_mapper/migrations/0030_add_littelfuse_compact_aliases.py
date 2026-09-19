from django.db import migrations


SOURCE = "curated_alias_migration_0030"
ALIASES = (
    ("LITTELFUSE", "LITTELFUSE"),
    ("LIITELFUSE", "LIITELFUSE"),
)


def add_littelfuse_aliases(apps, schema_editor):
    ManufacturerDirectoryEntry = apps.get_model(
        "excel_mapper", "ManufacturerDirectoryEntry"
    )
    ManufacturerAlias = apps.get_model("excel_mapper", "ManufacturerAlias")

    manufacturer = ManufacturerDirectoryEntry.objects.filter(
        normalized_name="LITTELFUSE"
    ).first()
    if manufacturer is None:
        return
    if manufacturer.status != "verified":
        manufacturer.status = "verified"
        manufacturer.save(update_fields=["status", "updated_at"])

    for alias, normalized_alias in ALIASES:
        ManufacturerAlias.objects.get_or_create(
            normalized_alias=normalized_alias,
            defaults={
                "manufacturer": manufacturer,
                "alias": alias,
                "source": SOURCE,
                "is_active": True,
            },
        )


def remove_littelfuse_aliases(apps, schema_editor):
    ManufacturerDirectoryEntry = apps.get_model(
        "excel_mapper", "ManufacturerDirectoryEntry"
    )
    ManufacturerAlias = apps.get_model("excel_mapper", "ManufacturerAlias")

    ManufacturerAlias.objects.filter(
        normalized_alias__in=[normalized for _alias, normalized in ALIASES],
        source=SOURCE,
    ).delete()
class Migration(migrations.Migration):
    dependencies = [
        ("excel_mapper", "0029_add_bom_directory_tables"),
    ]

    operations = [
        migrations.RunPython(
            add_littelfuse_aliases,
            remove_littelfuse_aliases,
        ),
    ]
