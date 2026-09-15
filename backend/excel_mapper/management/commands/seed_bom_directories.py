import gzip
import json
import logging
from pathlib import Path

from django.core.management.base import BaseCommand

from excel_mapper.models import (
    ManufacturerAlias,
    ManufacturerDirectoryEntry,
    MpnDirectoryEntry,
    MpnManufacturerPair,
    MpnPatternEntry,
)
from excel_mapper.services.bom_directory_store import (
    bump_directory_cache_version,
    clean,
    exact_pattern,
    grouped_pattern,
    normalize_manufacturer,
    normalize_mpn,
    pattern_classes,
)


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
BATCH_SIZE = 1000


def _read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _read_json_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def _chunks(values, size=BATCH_SIZE):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def _bulk_create_in_batches(model, objects):
    for batch in _chunks(objects):
        model.objects.bulk_create(batch, ignore_conflicts=True, batch_size=BATCH_SIZE)


class Command(BaseCommand):
    help = "Import legacy BOM directory files into indexed database tables."

    def handle(self, *args, **options):
        # DEBUG SQL output for hundreds of bulk statements is both noisy and
        # materially slower than the import itself.
        logging.getLogger("django.db.backends").setLevel(logging.WARNING)

        manufacturer_payload = _read_json(DATA_DIR / "manufacturers.json")
        lookup_payload = _read_json_gz(DATA_DIR / "mpn_mfr_lookup.v1.json.gz")
        pattern_payload = _read_json_gz(DATA_DIR / "mpn_patterns.v1.json.gz")
        lookup = lookup_payload.get("manufacturers_by_mpn") or {}

        canonical_names = {}
        recognition_keys = set()

        def add_manufacturer(value, *, recognition_enabled=False):
            name = clean(value)
            key = normalize_manufacturer(name)
            if not name or not key:
                return
            canonical_names.setdefault(key, name)
            if recognition_enabled:
                recognition_keys.add(key)

        # The manufacturer file is the curated name/alias directory. Values
        # found only in MPN pair data are retained for relationships, but are
        # not treated as standalone manufacturer-name evidence.
        for name in manufacturer_payload.get("names") or []:
            add_manufacturer(name, recognition_enabled=True)
        for entry in manufacturer_payload.get("entries") or []:
            if isinstance(entry, dict):
                add_manufacturer(entry.get("name"), recognition_enabled=True)
        for canonical in (manufacturer_payload.get("aliases") or {}).values():
            add_manufacturer(canonical, recognition_enabled=True)
        for entry in lookup.values():
            for manufacturer in entry.get("manufacturers") or []:
                add_manufacturer(manufacturer)

        _bulk_create_in_batches(ManufacturerDirectoryEntry, [
            ManufacturerDirectoryEntry(
                name=name,
                normalized_name=key,
                source="seed",
                status=ManufacturerDirectoryEntry.STATUS_VERIFIED,
                metadata={"recognition_enabled": key in recognition_keys},
            )
            for key, name in canonical_names.items()
        ])
        manufacturers = {
            item.normalized_name: item
            for item in ManufacturerDirectoryEntry.objects.only("id", "normalized_name").iterator(chunk_size=5000)
            if item.normalized_name in canonical_names
        }

        aliases = {}

        def add_alias(alias, canonical):
            alias_text = clean(alias)
            canonical_key = normalize_manufacturer(canonical)
            alias_key = normalize_manufacturer(alias_text)
            if alias_text and alias_key and canonical_key in manufacturers and alias_key != canonical_key:
                aliases.setdefault(alias_key, (alias_text, canonical_key))

        for alias, canonical in (manufacturer_payload.get("aliases") or {}).items():
            add_alias(alias, canonical)
        for entry in manufacturer_payload.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            for alias in entry.get("aliases") or []:
                add_alias(alias, entry.get("name"))
        _bulk_create_in_batches(ManufacturerAlias, [
            ManufacturerAlias(
                manufacturer=manufacturers[canonical_key],
                alias=alias,
                normalized_alias=alias_key,
                source="seed",
            )
            for alias_key, (alias, canonical_key) in aliases.items()
        ])

        mpn_rows = {}
        for stored_key, entry in lookup.items():
            mpn = clean(entry.get("mpn") or stored_key)
            key = normalize_mpn(mpn)
            if mpn and key:
                mpn_rows.setdefault(key, mpn)
        _bulk_create_in_batches(MpnDirectoryEntry, [
            MpnDirectoryEntry(
                mpn=mpn,
                normalized_mpn=key,
                exact_pattern=exact_pattern(mpn),
                grouped_pattern=grouped_pattern(mpn),
                character_classes=pattern_classes(mpn),
                mpn_length=len(mpn),
                source="seed",
                status=MpnDirectoryEntry.STATUS_VERIFIED,
            )
            for key, mpn in mpn_rows.items()
        ])
        mpns = {
            item.normalized_mpn: item
            for item in MpnDirectoryEntry.objects.only("id", "normalized_mpn").iterator(chunk_size=5000)
            if item.normalized_mpn in mpn_rows
        }

        pair_objects = []
        pair_count = 0
        for stored_key, entry in lookup.items():
            mpn = mpns.get(normalize_mpn(entry.get("mpn") or stored_key))
            if not mpn:
                continue
            counts = entry.get("counts") or {}
            seen_manufacturers = set()
            for manufacturer_name in entry.get("manufacturers") or []:
                manufacturer = manufacturers.get(normalize_manufacturer(manufacturer_name))
                if not manufacturer or manufacturer.id in seen_manufacturers:
                    continue
                seen_manufacturers.add(manufacturer.id)
                pair_objects.append(MpnManufacturerPair(
                    mpn_id=mpn.id,
                    manufacturer_id=manufacturer.id,
                    source="seed",
                    status=MpnManufacturerPair.STATUS_VERIFIED,
                    confirmation_count=max(int(counts.get(manufacturer_name, 0) or 0), 1),
                ))
                if len(pair_objects) >= BATCH_SIZE:
                    MpnManufacturerPair.objects.bulk_create(
                        pair_objects, ignore_conflicts=True, batch_size=BATCH_SIZE
                    )
                    pair_count += len(pair_objects)
                    pair_objects = []
        if pair_objects:
            MpnManufacturerPair.objects.bulk_create(
                pair_objects, ignore_conflicts=True, batch_size=BATCH_SIZE
            )
            pair_count += len(pair_objects)

        pattern_fields = {
            "exact": (pattern_payload.get("exact_patterns") or {}, {}),
            "grouped": (pattern_payload.get("grouped_patterns") or {}, pattern_payload.get("grouped_examples") or {}),
            "class": (pattern_payload.get("character_classes") or {}, pattern_payload.get("character_class_examples") or {}),
            "length": (pattern_payload.get("lengths") or {}, {}),
        }
        pattern_objects = [
            MpnPatternEntry(
                pattern_type=pattern_type,
                signature=str(signature),
                occurrence_count=int(count or 0),
                examples=list(examples.get(signature) or [])[:5],
                source="seed",
            )
            for pattern_type, (counts, examples) in pattern_fields.items()
            for signature, count in counts.items()
        ]
        _bulk_create_in_batches(MpnPatternEntry, pattern_objects)
        bump_directory_cache_version()

        self.stdout.write(self.style.SUCCESS(
            "Seeded BOM directories: "
            f"{len(manufacturers)} manufacturers, {len(aliases)} aliases, "
            f"{len(mpns)} MPNs, {pair_count} MPN/manufacturer pairs, "
            f"{len(pattern_objects)} patterns."
        ))
