import gzip
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .mpn_pattern_library import (
    assess_mpn_text,
    character_classes,
    exact_mpn_pattern,
    grouped_mpn_pattern,
    is_composite_manufacturer_name,
    load_manufacturer_lookup,
    load_manufacturer_phrase_lookup,
    load_manufacturer_phrase_token_index,
    load_mpn_lookup_lengths,
    load_mpn_mfr_lookup,
    load_mpn_pattern_library,
    clear_scoring_caches,
)
from .bom_role_inference import save_bom_field_pattern_rule


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
MANUFACTURERS_PATH = DATA_DIR / "manufacturers.json"
MPN_MFR_LOOKUP_PATH = DATA_DIR / "mpn_mfr_lookup.v1.json.gz"
MPN_PATTERN_PATH = DATA_DIR / "mpn_patterns.v1.json.gz"


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _norm_words(value):
    return re.sub(r"[^A-Z0-9]+", " ", _clean(value).upper()).strip()


def _norm_compact(value):
    return re.sub(r"[^A-Z0-9]+", "", _clean(value).upper())


def _read_json(path, default):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def _write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _read_json_gz(path, default):
    try:
        if path.exists():
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                return json.load(handle)
    except Exception:
        pass
    return default


def _write_json_gz(path, payload):
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=True)


def _append_example(bucket, key, value, max_examples=5):
    values = bucket.setdefault(key, [])
    if value not in values:
        values.append(value)
    del values[max_examples:]


def _confirmed_pairs_from_entries(entries):
    pairs = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        fields = entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
        mpn = _clean(fields.get("mpn"))
        manufacturer = _clean(fields.get("manufacturer"))
        if not mpn and not manufacturer:
            continue
        pairs.append({"mpn": mpn, "manufacturer": manufacturer})
    return pairs


def _learn_manufacturers(manufacturers):
    payload = _read_json(MANUFACTURERS_PATH, {
        "version": 1,
        "source": "",
        "entry_count": 0,
        "name_count": 0,
        "alias_count": 0,
        "entries": [],
        "names": [],
        "aliases": {},
    })
    entries = list(payload.get("entries") or [])
    names = list(payload.get("names") or [])
    aliases = dict(payload.get("aliases") or {})
    known = {_norm_compact(name) for name in names}
    known.update(_norm_compact(key) for key in aliases.keys())
    for entry in entries:
        if isinstance(entry, dict):
            known.add(_norm_compact(entry.get("name")))
            for alias in entry.get("aliases") or []:
                known.add(_norm_compact(alias))

    added = 0
    for manufacturer in sorted({_clean(value) for value in manufacturers if _clean(value)}, key=str.casefold):
        key = _norm_compact(manufacturer)
        if not key or key in known or is_composite_manufacturer_name(manufacturer):
            continue
        entries.append({"name": manufacturer, "aliases": [manufacturer]})
        names.append(manufacturer)
        known.add(key)
        added += 1

    payload.update({
        "version": 1,
        "source": ", ".join(filter(None, [str(payload.get("source") or ""), "user-confirmed-bom-patterns"])),
        "entry_count": len(entries),
        "name_count": len(names),
        "alias_count": len(aliases),
        "entries": entries,
        "names": names,
        "aliases": aliases,
    })
    if added:
        _write_json(MANUFACTURERS_PATH, payload)
    return added


def _learn_mpn_lookup(pairs):
    payload = _read_json_gz(MPN_MFR_LOOKUP_PATH, {
        "version": 1,
        "sources": [],
        "row_count": 0,
        "unique_mpn_count": 0,
        "pair_count": 0,
        "manufacturers_by_mpn": {},
    })
    by_mpn = dict(payload.get("manufacturers_by_mpn") or {})
    learned_mpn_keys = set()
    new_mpn_keys = set()
    new_pairs = 0
    seen_rows = 0

    for pair in pairs:
        raw_mpn = _clean(pair.get("mpn"))
        manufacturer = _clean(pair.get("manufacturer"))
        if not raw_mpn:
            continue
        assessment = assess_mpn_text(raw_mpn)
        if assessment.get("hard_reject"):
            continue
        mpn = _clean(assessment.get("candidate_text") or raw_mpn)
        key = _norm_compact(mpn)
        if not key:
            continue
        seen_rows += 1
        learned_mpn_keys.add(key)
        if key not in by_mpn:
            new_mpn_keys.add(key)
        entry = by_mpn.setdefault(key, {
            "mpn": mpn,
            "manufacturers": [],
            "counts": {},
        })
        entry["mpn"] = _clean(entry.get("mpn") or mpn)
        entry.setdefault("manufacturers", [])
        entry.setdefault("counts", {})
        if manufacturer:
            if manufacturer not in entry["manufacturers"]:
                entry["manufacturers"].append(manufacturer)
                new_pairs += 1
            entry["counts"][manufacturer] = int(entry["counts"].get(manufacturer, 0) or 0) + 1

    if not seen_rows:
        return set(), 0, 0

    for entry in by_mpn.values():
        entry["manufacturers"] = sorted(entry.get("manufacturers") or [], key=str.casefold)

    sources = list(payload.get("sources") or [])
    if "user-confirmed-bom-patterns" not in sources:
        sources.append("user-confirmed-bom-patterns")
    next_payload = {
        "version": 1,
        "sources": sources,
        "row_count": int(payload.get("row_count", 0) or 0) + seen_rows,
        "unique_mpn_count": len(by_mpn),
        "pair_count": sum(len(entry.get("manufacturers") or []) for entry in by_mpn.values()),
        "manufacturers_by_mpn": by_mpn,
    }
    _write_json_gz(MPN_MFR_LOOKUP_PATH, next_payload)
    return new_mpn_keys, len(learned_mpn_keys), new_pairs


def _learn_mpn_patterns(new_mpn_keys):
    if not new_mpn_keys:
        return 0
    lookup = _read_json_gz(MPN_MFR_LOOKUP_PATH, {}).get("manufacturers_by_mpn") or {}
    payload = _read_json_gz(MPN_PATTERN_PATH, {
        "version": 1,
        "source": "",
        "unique_mpn_rows": 0,
        "pattern_rule": "Letters become A, digits become 0, and spaces/symbols are retained. Grouped patterns compress A/0 runs.",
        "exact_patterns": {},
        "grouped_patterns": {},
        "character_classes": {},
        "lengths": {},
        "manufacturer_coverage": {},
        "grouped_examples": {},
        "character_class_examples": {},
    })
    exact_counts = Counter(payload.get("exact_patterns") or {})
    grouped_counts = Counter(payload.get("grouped_patterns") or {})
    class_counts = Counter(payload.get("character_classes") or {})
    length_counts = Counter(payload.get("lengths") or {})
    grouped_examples = defaultdict(list, {
        key: list(value)
        for key, value in (payload.get("grouped_examples") or {}).items()
    })
    class_examples = defaultdict(list, {
        key: list(value)
        for key, value in (payload.get("character_class_examples") or {}).items()
    })

    added = 0
    for key in sorted(new_mpn_keys):
        mpn = _clean((lookup.get(key) or {}).get("mpn") or key)
        if not mpn:
            continue
        exact = exact_mpn_pattern(mpn)
        grouped = grouped_mpn_pattern(mpn)
        classes = character_classes(mpn)
        exact_counts[exact] += 1
        grouped_counts[grouped] += 1
        class_counts[classes] += 1
        length_counts[str(len(mpn))] += 1
        _append_example(grouped_examples, grouped, mpn)
        _append_example(class_examples, classes, mpn, max_examples=3)
        added += 1

    if not added:
        return 0
    source = str(payload.get("source") or "")
    if "user-confirmed-bom-patterns" not in source:
        source = ", ".join(filter(None, [source, "user-confirmed-bom-patterns"]))
    payload.update({
        "version": 1,
        "source": source,
        "unique_mpn_rows": int(payload.get("unique_mpn_rows", 0) or 0) + added,
        "exact_patterns": dict(exact_counts),
        "grouped_patterns": dict(grouped_counts),
        "character_classes": dict(class_counts),
        "lengths": dict(length_counts),
        "grouped_examples": dict(grouped_examples),
        "character_class_examples": dict(class_examples),
    })
    _write_json_gz(MPN_PATTERN_PATH, payload)
    return added


def _clear_directory_caches():
    for loader in (
        load_manufacturer_lookup,
        load_manufacturer_phrase_lookup,
        load_manufacturer_phrase_token_index,
        load_mpn_lookup_lengths,
        load_mpn_mfr_lookup,
        load_mpn_pattern_library,
        clear_scoring_caches,
    ):
        clear = getattr(loader, "cache_clear", None)
        if callable(clear):
            clear()
        elif callable(loader):
            loader()

    try:
        from .bom_role_inference import clear_bom_role_inference_caches
        clear_bom_role_inference_caches()
    except Exception:
        pass


def learn_confirmed_bom_field_patterns(groups):
    pairs = []
    saved_pattern_rules = []
    for group in groups or []:
        if not isinstance(group, dict):
            continue
        if group.get("confirmed") is False:
            continue
        rule = group.get("rule")
        if isinstance(rule, dict):
            saved_rule = save_bom_field_pattern_rule(
                rule,
                description="User-confirmed BOM field parser pattern",
            )
            if saved_rule:
                saved_pattern_rules.append(saved_rule)
        for row in group.get("rows") or []:
            entries = row.get("entries") if isinstance(row, dict) else []
            pairs.extend(_confirmed_pairs_from_entries(entries))

    manufacturers = [pair["manufacturer"] for pair in pairs if pair.get("manufacturer")]
    added_manufacturers = _learn_manufacturers(manufacturers)
    new_mpn_keys, learned_mpn_count, new_pairs = _learn_mpn_lookup(pairs)
    added_mpn_patterns = _learn_mpn_patterns(new_mpn_keys)
    if added_manufacturers or learned_mpn_count or new_pairs or added_mpn_patterns:
        _clear_directory_caches()
    return {
        "success": True,
        "confirmed_entries": len(pairs),
        "learned_mpn_count": learned_mpn_count,
        "new_mpn_count": len(new_mpn_keys),
        "new_mpn_mfr_pairs": new_pairs,
        "added_manufacturers": added_manufacturers,
        "added_mpn_patterns": added_mpn_patterns,
        "saved_pattern_rules": saved_pattern_rules,
    }
