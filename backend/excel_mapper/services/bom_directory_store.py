import re
from collections import Counter
from time import monotonic

from django.core.cache import cache
from django.db import OperationalError, ProgrammingError, transaction
from django.utils import timezone
from rapidfuzz import fuzz, process

from excel_mapper.models import (
    DirectoryLearningEvent,
    ManufacturerAlias,
    ManufacturerDirectoryEntry,
    MpnDirectoryEntry,
    MpnManufacturerPair,
    MpnPatternEntry,
)


DIRECTORY_CACHE_VERSION_KEY = "bom-directory:version"
DIRECTORY_CACHE_VERSION_TTL_SECONDS = 2.0
_directory_version_state = {"value": None, "checked_at": 0.0}


def directory_cache_version():
    now = monotonic()
    if (
        _directory_version_state["value"] is not None
        and now - _directory_version_state["checked_at"] < DIRECTORY_CACHE_VERSION_TTL_SECONDS
    ):
        return _directory_version_state["value"]
    version = cache.get(DIRECTORY_CACHE_VERSION_KEY)
    if version is None:
        cache.add(DIRECTORY_CACHE_VERSION_KEY, 1, timeout=None)
        version = cache.get(DIRECTORY_CACHE_VERSION_KEY) or 1
    _directory_version_state.update(value=int(version), checked_at=now)
    return _directory_version_state["value"]


def bump_directory_cache_version():
    try:
        version = int(cache.incr(DIRECTORY_CACHE_VERSION_KEY))
    except (ValueError, TypeError):
        cache.set(DIRECTORY_CACHE_VERSION_KEY, 2, timeout=None)
        version = 2
    _directory_version_state.update(value=version, checked_at=monotonic())
    return version


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def normalize_mpn(value):
    return re.sub(r"[^A-Z0-9]+", "", clean(value).upper())


def normalize_manufacturer(value):
    return re.sub(r"[^A-Z0-9]+", "", clean(value).upper())


def exact_pattern(value):
    output = []
    for char in clean(value):
        if char.isalpha():
            output.append("A")
        elif char.isdigit():
            output.append("0")
        else:
            output.append(" " if char.isspace() else char)
    return "".join(output)


def grouped_pattern(value):
    exact = exact_pattern(value)
    output = []
    index = 0
    while index < len(exact):
        char = exact[index]
        if char in {"A", "0"}:
            end = index + 1
            while end < len(exact) and exact[end] == char:
                end += 1
            output.append(f"{char}{{{end - index}}}")
            index = end
        else:
            output.append(char)
            index += 1
    return "".join(output)


def pattern_classes(value):
    text = clean(value)
    classes = []
    if any(char.isalpha() for char in text):
        classes.append("letters")
    if any(char.isdigit() for char in text):
        classes.append("digits")
    symbols = sorted({char for char in text if not char.isalnum() and not char.isspace()})
    if symbols:
        classes.append(f"symbols:{''.join(symbols)}")
    if any(char.isspace() for char in text):
        classes.append("spaces")
    return ", ".join(classes)


def directory_tables_have_data():
    try:
        return ManufacturerDirectoryEntry.objects.exists() or MpnDirectoryEntry.objects.exists()
    except (OperationalError, ProgrammingError):
        return False


def manufacturer_lookup_rows():
    try:
        manufacturer_rows = list(
            ManufacturerDirectoryEntry.objects.filter(status=ManufacturerDirectoryEntry.STATUS_VERIFIED)
            .values_list("id", "name", "metadata")
        )
        manufacturers = [
            (item_id, name)
            for item_id, name, metadata in manufacturer_rows
            if not isinstance(metadata, dict) or metadata.get("recognition_enabled") is not False
        ]
        if not manufacturers:
            return None
        names_by_id = dict(manufacturers)
        aliases = list(
            ManufacturerAlias.objects.filter(
                is_active=True,
                manufacturer_id__in=names_by_id,
                manufacturer__status=ManufacturerDirectoryEntry.STATUS_VERIFIED,
            ).values_list("alias", "manufacturer_id")
        )
        return {
            "names": list(names_by_id.values()),
            "aliases": [(alias, names_by_id.get(manufacturer_id, "")) for alias, manufacturer_id in aliases],
        }
    except (OperationalError, ProgrammingError):
        return None


def mpn_lookup_rows():
    try:
        mpns = list(
            MpnDirectoryEntry.objects.filter(status=MpnDirectoryEntry.STATUS_VERIFIED)
            .values_list("id", "normalized_mpn", "mpn")
        )
        if not mpns:
            return None
        by_id = {
            item_id: {"mpn": mpn, "normalized_mpn": normalized_mpn, "manufacturers": [], "counts": {}}
            for item_id, normalized_mpn, mpn in mpns
        }
        pairs = MpnManufacturerPair.objects.filter(
            status=MpnManufacturerPair.STATUS_VERIFIED,
            mpn_id__in=by_id,
            manufacturer__status=ManufacturerDirectoryEntry.STATUS_VERIFIED,
        ).values_list("mpn_id", "manufacturer__name", "confirmation_count")
        for mpn_id, manufacturer, confirmation_count in pairs:
            entry = by_id.get(mpn_id)
            if not entry or not manufacturer:
                continue
            entry["manufacturers"].append(manufacturer)
            entry["counts"][manufacturer] = int(confirmation_count or 0)
        return {
            entry["normalized_mpn"]: {
                "mpn": entry["mpn"],
                "manufacturers": sorted(set(entry["manufacturers"]), key=str.casefold),
                "counts": entry["counts"],
            }
            for entry in by_id.values()
        }
    except (OperationalError, ProgrammingError):
        return None


class DatabaseMpnLookup:
    """Small mapping facade that resolves only the MPN keys an inference run uses."""

    def __init__(self):
        # Keep only the lightweight identity index in process memory. This
        # avoids one SQL query per rejected substring while leaving the much
        # larger MPN/manufacturer relationships lazy.
        self._known = {
            normalized_mpn: (item_id, mpn)
            for item_id, normalized_mpn, mpn in MpnDirectoryEntry.objects.filter(
                status=MpnDirectoryEntry.STATUS_VERIFIED
            ).values_list("id", "normalized_mpn", "mpn")
        }
        self._entries = {}
        self._loaded = set()
        self._value_matches = {}
        self._embedded_prefix_index = None
        self._known_trigrams = None
        self._similarity_matches = {}

    def __bool__(self):
        return True

    def __len__(self):
        return len(self._known)

    def is_known(self, normalized_key):
        return normalized_key in self._known

    def find_embedded_keys(self, normalized_value, *, max_candidates=16):
        """Find verified MPNs inside one normalized value without substring explosion."""
        value = str(normalized_value or "")
        if len(value) < 6:
            return []
        if (
            value in self._known
            and any(char.isalpha() for char in value)
            and any(char.isdigit() for char in value)
        ):
            return [value]

        if self._embedded_prefix_index is None:
            prefixes = {}
            for key in self._known:
                if (
                    len(key) >= 6
                    and any(char.isalpha() for char in key)
                    and any(char.isdigit() for char in key)
                ):
                    prefixes.setdefault(key[:4], []).append(key)
            self._embedded_prefix_index = {
                prefix: tuple(sorted(keys, key=lambda item: (-len(item), item)))
                for prefix, keys in prefixes.items()
            }

        matches = set()
        for start in range(max(0, len(value) - 5)):
            prefix = value[start:start + 4]
            for candidate in self._embedded_prefix_index.get(prefix, ()):
                if value.startswith(candidate, start):
                    matches.add(candidate)

        return sorted(
            matches,
            key=lambda item: (-len(item), value.find(item), item),
        )[:max_candidates]

    def match_normalized_many(self, normalized_values, *, threshold=90.0):
        """Return exact or fuzzy verified-directory evidence for unique MPNs."""
        values = {
            str(value or "")
            for value in normalized_values or []
            if str(value or "")
        }
        matches = {}
        unresolved = []
        for value in values:
            known = self._known.get(value)
            if known:
                matches[value] = {
                    "matched": True,
                    "score": 100.0,
                    "match_type": "exact",
                    "matched_mpn": known[1],
                    "matched_normalized_mpn": value,
                }
            elif value in self._similarity_matches:
                cached = self._similarity_matches[value]
                if cached:
                    matches[value] = dict(cached)
            else:
                unresolved.append(value)

        if not unresolved or not self._known:
            return matches

        if self._known_trigrams is None:
            trigrams = {}
            for known_value in self._known:
                for index in range(len(known_value) - 2):
                    trigram = known_value[index:index + 3]
                    trigrams.setdefault(trigram, []).append(known_value)
            self._known_trigrams = {
                trigram: tuple(items)
                for trigram, items in trigrams.items()
            }

        threshold = max(0.0, min(float(threshold), 100.0))
        for value in unresolved:
            value_length = len(value)
            if value_length < 3:
                continue
            candidates = {
                candidate
                for index in range(value_length - 2)
                for candidate in self._known_trigrams.get(value[index:index + 3], ())
                if (
                    2 * min(value_length, len(candidate)) * 100
                    >= threshold * (value_length + len(candidate))
                )
            }
            if not candidates:
                continue
            best = process.extractOne(
                value,
                candidates,
                scorer=fuzz.ratio,
                score_cutoff=threshold,
            )
            if not best:
                self._similarity_matches[value] = None
                continue
            matched_normalized, score, _index = best
            match = {
                "matched": True,
                "score": round(float(score), 2),
                "match_type": "similar",
                "matched_mpn": self._known[matched_normalized][1],
                "matched_normalized_mpn": matched_normalized,
            }
            matches[value] = match
            self._similarity_matches[value] = match
        return matches

    def set_value_matches(self, normalized_value, matched_keys):
        self._value_matches[normalized_value] = tuple(matched_keys)

    def get_value_matches(self, normalized_value):
        keys = self._value_matches.get(normalized_value)
        if keys is None:
            return None
        return [self._entries[key] for key in keys if key in self._entries]

    def get(self, key, default=None):
        normalized_key = normalize_mpn(key)
        if not normalized_key:
            return default
        if normalized_key not in self._loaded:
            self.get_many([normalized_key], normalized=True)
        return self._entries.get(normalized_key, default)

    def get_many(self, keys, *, normalized=False):
        if normalized:
            normalized_keys = {str(key or "") for key in keys or [] if key}
        else:
            normalized_keys = {normalize_mpn(key) for key in keys or [] if normalize_mpn(key)}
        unresolved = normalized_keys.difference(self._loaded)
        if not unresolved:
            return {key: self._entries[key] for key in normalized_keys if key in self._entries}

        by_id = {
            item_id: {
                "mpn": mpn,
                "normalized_mpn": normalized_mpn,
                "manufacturers": [],
                "counts": {},
            }
            for normalized_mpn in unresolved
            for item_id, mpn in [self._known.get(normalized_mpn, (None, ""))]
            if item_id is not None
        }
        if not by_id:
            self._loaded.update(unresolved)
            return {
                key: self._entries[key]
                for key in normalized_keys
                if key in self._entries
            }
        pairs = MpnManufacturerPair.objects.filter(
            status=MpnManufacturerPair.STATUS_VERIFIED,
            mpn_id__in=by_id,
            manufacturer__status=ManufacturerDirectoryEntry.STATUS_VERIFIED,
        ).values_list("mpn_id", "manufacturer__name", "confirmation_count")
        for mpn_id, manufacturer, confirmation_count in pairs:
            entry = by_id.get(mpn_id)
            if not entry or not manufacturer:
                continue
            entry["manufacturers"].append(manufacturer)
            entry["counts"][manufacturer] = int(confirmation_count or 0)

        for entry in by_id.values():
            entry["manufacturers"] = sorted(set(entry["manufacturers"]), key=str.casefold)
            self._entries[entry["normalized_mpn"]] = entry
        self._loaded.update(unresolved)
        return {key: self._entries[key] for key in normalized_keys if key in self._entries}


def database_mpn_lookup():
    try:
        if not MpnDirectoryEntry.objects.filter(status=MpnDirectoryEntry.STATUS_VERIFIED).exists():
            return None
        return DatabaseMpnLookup()
    except (OperationalError, ProgrammingError):
        return None


def mpn_lookup_length_rows():
    try:
        if not MpnDirectoryEntry.objects.filter(status=MpnDirectoryEntry.STATUS_VERIFIED).exists():
            return None
        lengths = MpnPatternEntry.objects.filter(pattern_type="length").values_list("signature", flat=True)
        parsed = sorted({int(value) for value in lengths if str(value).isdigit() and int(value) >= 6}, reverse=True)
        if parsed:
            return parsed
        return sorted(
            set(MpnDirectoryEntry.objects.filter(
                status=MpnDirectoryEntry.STATUS_VERIFIED,
                mpn_length__gte=6,
            ).values_list("mpn_length", flat=True)),
            reverse=True,
        )
    except (OperationalError, ProgrammingError):
        return None


def mpn_pattern_rows():
    try:
        rows = list(MpnPatternEntry.objects.values_list(
            "pattern_type", "signature", "occurrence_count", "examples"
        ))
        if not rows:
            return None
        payload = {
            "version": 2,
            "source": "database",
            "exact_patterns": {},
            "grouped_patterns": {},
            "character_classes": {},
            "lengths": {},
            "grouped_examples": {},
            "character_class_examples": {},
        }
        field_by_type = {
            "exact": "exact_patterns",
            "grouped": "grouped_patterns",
            "class": "character_classes",
            "length": "lengths",
        }
        examples_by_type = {
            "grouped": "grouped_examples",
            "class": "character_class_examples",
        }
        for pattern_type, signature, count, examples in rows:
            field = field_by_type.get(pattern_type)
            if not field:
                continue
            payload[field][signature] = int(count or 0)
            example_field = examples_by_type.get(pattern_type)
            if example_field and examples:
                payload[example_field][signature] = list(examples)
        payload["unique_mpn_rows"] = MpnDirectoryEntry.objects.filter(
            status=MpnDirectoryEntry.STATUS_VERIFIED
        ).count()
        return payload
    except (OperationalError, ProgrammingError):
        return None


def _upsert_manufacturers(values, status, source):
    counts = Counter()
    display_values = {}
    for value in values:
        key = normalize_manufacturer(value)
        if not key:
            continue
        counts[key] += 1
        display_values.setdefault(key, clean(value))
    if not counts:
        return {}, 0
    keys = list(counts)
    existing = {
        item.normalized_name: item
        for item in ManufacturerDirectoryEntry.objects.select_for_update().filter(normalized_name__in=keys)
    }
    missing = [
        ManufacturerDirectoryEntry(
            name=name,
            normalized_name=key,
            source=source,
            status=status,
            confirmation_count=0,
        )
        for key, name in display_values.items()
        if key not in existing
    ]
    ManufacturerDirectoryEntry.objects.bulk_create(missing, ignore_conflicts=True, batch_size=1000)
    records = {
        item.normalized_name: item
        for item in ManufacturerDirectoryEntry.objects.select_for_update().filter(normalized_name__in=keys)
    }
    now = timezone.now()
    for key, count in counts.items():
        record = records[key]
        record.confirmation_count += count
        if status == ManufacturerDirectoryEntry.STATUS_VERIFIED:
            record.status = status
            record.metadata = {**(record.metadata or {}), "recognition_enabled": True}
        if record.source == "seed" and source != "seed":
            record.source = source
        record.updated_at = now
    ManufacturerDirectoryEntry.objects.bulk_update(
        records.values(), ["confirmation_count", "status", "source", "metadata", "updated_at"], batch_size=1000
    )
    return records, len(missing)


def _upsert_mpns(values, status, source):
    counts = Counter()
    display_values = {}
    for value in values:
        key = normalize_mpn(value)
        if not key:
            continue
        counts[key] += 1
        display_values.setdefault(key, clean(value))
    if not counts:
        return {}, 0, set()
    keys = list(counts)
    existing = {
        item.normalized_mpn: item
        for item in MpnDirectoryEntry.objects.select_for_update().filter(normalized_mpn__in=keys)
    }
    missing_keys = {key for key in counts if key not in existing}
    MpnDirectoryEntry.objects.bulk_create([
        MpnDirectoryEntry(
            mpn=mpn,
            normalized_mpn=key,
            exact_pattern=exact_pattern(mpn),
            grouped_pattern=grouped_pattern(mpn),
            character_classes=pattern_classes(mpn),
            mpn_length=len(mpn),
            source=source,
            status=status,
            confirmation_count=0,
        )
        for key, mpn in display_values.items()
        if key in missing_keys
    ], ignore_conflicts=True, batch_size=1000)
    records = {
        item.normalized_mpn: item
        for item in MpnDirectoryEntry.objects.select_for_update().filter(normalized_mpn__in=keys)
    }
    now = timezone.now()
    for key, count in counts.items():
        record = records[key]
        record.confirmation_count += count
        if status == MpnDirectoryEntry.STATUS_VERIFIED:
            record.status = status
        if record.source == "seed" and source != "seed":
            record.source = source
        record.updated_at = now
    MpnDirectoryEntry.objects.bulk_update(
        records.values(), ["confirmation_count", "status", "source", "updated_at"], batch_size=1000
    )
    return records, len(missing_keys), missing_keys


def _upsert_patterns(mpn_records, new_keys, source):
    signatures = Counter()
    examples = {}
    for key in new_keys:
        record = mpn_records.get(key)
        if not record:
            continue
        for pattern_type, signature in (
            ("exact", record.exact_pattern),
            ("grouped", record.grouped_pattern),
            ("class", record.character_classes),
            ("length", str(record.mpn_length)),
        ):
            if not signature:
                continue
            signatures[(pattern_type, signature)] += 1
            examples.setdefault((pattern_type, signature), []).append(record.mpn)
    if not signatures:
        return 0
    existing = {
        (item.pattern_type, item.signature): item
        for item in MpnPatternEntry.objects.select_for_update().filter(
            pattern_type__in={key[0] for key in signatures},
            signature__in={key[1] for key in signatures},
        )
    }
    missing = [
        MpnPatternEntry(
            pattern_type=pattern_type,
            signature=signature,
            occurrence_count=count,
            examples=examples.get((pattern_type, signature), [])[:5],
            source=source,
        )
        for (pattern_type, signature), count in signatures.items()
        if (pattern_type, signature) not in existing
    ]
    MpnPatternEntry.objects.bulk_create(missing, ignore_conflicts=True, batch_size=1000)
    updates = []
    now = timezone.now()
    for key, record in existing.items():
        record.occurrence_count += signatures[key]
        merged_examples = list(dict.fromkeys((record.examples or []) + examples.get(key, [])))[:5]
        record.examples = merged_examples
        record.updated_at = now
        updates.append(record)
    if updates:
        MpnPatternEntry.objects.bulk_update(updates, ["occurrence_count", "examples", "updated_at"], batch_size=1000)
    return len(signatures)


def upsert_directory_pairs(
    pairs,
    *,
    status="pending",
    source="user_confirmed",
    structure=None,
    structure_signature="",
):
    cleaned_pairs = [
        {"mpn": clean(pair.get("mpn")), "manufacturer": clean(pair.get("manufacturer")), "source_row": pair.get("source_row")}
        for pair in pairs or []
        if isinstance(pair, dict) and (clean(pair.get("mpn")) or clean(pair.get("manufacturer")))
    ]
    if not cleaned_pairs:
        return {
            "confirmed_entries": 0,
            "learned_mpn_count": 0,
            "new_mpn_count": 0,
            "new_mpn_mfr_pairs": 0,
            "added_manufacturers": 0,
            "added_mpn_patterns": 0,
        }

    db_status = ManufacturerDirectoryEntry.STATUS_VERIFIED if status == "verified" else ManufacturerDirectoryEntry.STATUS_PENDING
    with transaction.atomic():
        manufacturer_records, new_manufacturers = _upsert_manufacturers(
            [pair["manufacturer"] for pair in cleaned_pairs if pair["manufacturer"]], db_status, source
        )
        mpn_records, new_mpns, new_mpn_keys = _upsert_mpns(
            [pair["mpn"] for pair in cleaned_pairs if pair["mpn"]], db_status, source
        )

        pair_counts = Counter(
            (normalize_mpn(pair["mpn"]), normalize_manufacturer(pair["manufacturer"]))
            for pair in cleaned_pairs
            if pair["mpn"] and pair["manufacturer"]
        )
        mpn_ids = [mpn_records[key].id for key, _ in pair_counts if key in mpn_records]
        manufacturer_ids = [manufacturer_records[key].id for _, key in pair_counts if key in manufacturer_records]
        existing_pairs = {
            (item.mpn_id, item.manufacturer_id): item
            for item in MpnManufacturerPair.objects.select_for_update().filter(
                mpn_id__in=mpn_ids,
                manufacturer_id__in=manufacturer_ids,
            )
        }
        missing_pairs = []
        for (mpn_key, manufacturer_key), count in pair_counts.items():
            mpn = mpn_records.get(mpn_key)
            manufacturer = manufacturer_records.get(manufacturer_key)
            if not mpn or not manufacturer or (mpn.id, manufacturer.id) in existing_pairs:
                continue
            missing_pairs.append(MpnManufacturerPair(
                mpn=mpn,
                manufacturer=manufacturer,
                source=source,
                status=db_status,
                confirmation_count=0,
            ))
        MpnManufacturerPair.objects.bulk_create(missing_pairs, ignore_conflicts=True, batch_size=1000)
        stored_pairs = {
            (item.mpn_id, item.manufacturer_id): item
            for item in MpnManufacturerPair.objects.select_for_update().filter(
                mpn_id__in=mpn_ids,
                manufacturer_id__in=manufacturer_ids,
            )
        }
        for (mpn_key, manufacturer_key), count in pair_counts.items():
            mpn = mpn_records.get(mpn_key)
            manufacturer = manufacturer_records.get(manufacturer_key)
            if not mpn or not manufacturer:
                continue
            pair = stored_pairs.get((mpn.id, manufacturer.id))
            if not pair:
                continue
            pair.confirmation_count += count
            if db_status == MpnManufacturerPair.STATUS_VERIFIED:
                pair.status = db_status
            if pair.source == "seed" and source != "seed":
                pair.source = source
            pair.updated_at = timezone.now()
        if stored_pairs:
            MpnManufacturerPair.objects.bulk_update(
                stored_pairs.values(), ["confirmation_count", "status", "source", "updated_at"], batch_size=1000
            )

        added_patterns = _upsert_patterns(mpn_records, new_mpn_keys, source) if db_status == MpnDirectoryEntry.STATUS_VERIFIED else 0
        event_status = DirectoryLearningEvent.STATUS_PROMOTED if status == "verified" else DirectoryLearningEvent.STATUS_PENDING
        event_counts = Counter(
            (
                pair["mpn"],
                pair["manufacturer"],
                normalize_mpn(pair["mpn"]),
                normalize_manufacturer(pair["manufacturer"]),
                pair.get("source_row"),
            )
            for pair in cleaned_pairs
        )
        DirectoryLearningEvent.objects.bulk_create([
            DirectoryLearningEvent(
                structure=structure,
                structure_signature=clean(structure_signature),
                source_row=source_row if isinstance(source_row, int) else None,
                raw_mpn=raw_mpn,
                raw_manufacturer=raw_manufacturer,
                normalized_mpn=mpn_key,
                normalized_manufacturer=manufacturer_key,
                status=event_status,
                occurrence_count=count,
                metadata={"source": source},
            )
            for (raw_mpn, raw_manufacturer, mpn_key, manufacturer_key, source_row), count in event_counts.items()
        ], batch_size=1000)

    if db_status == MpnDirectoryEntry.STATUS_VERIFIED:
        bump_directory_cache_version()
    return {
        "confirmed_entries": len(cleaned_pairs),
        "learned_mpn_count": len({normalize_mpn(pair["mpn"]) for pair in cleaned_pairs if pair["mpn"]}),
        "new_mpn_count": new_mpns,
        "new_mpn_mfr_pairs": len(missing_pairs),
        "added_manufacturers": new_manufacturers,
        "added_mpn_patterns": added_patterns,
    }
