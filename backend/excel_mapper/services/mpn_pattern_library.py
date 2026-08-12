import gzip
import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from statistics import mean


logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
MPN_PATTERN_PATH = DATA_DIR / "mpn_patterns.v1.json.gz"
MANUFACTURER_PATTERN_PATH = DATA_DIR / "manufacturer_pattern_index.v1.json.gz"
MANUFACTURER_DIRECTORY_PATH = DATA_DIR / "manufacturers.json"


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _norm_key(value):
    return re.sub(r"[^A-Z0-9]+", " ", _clean(value).upper()).strip()


def exact_mpn_pattern(value):
    text = _clean(value)
    out = []
    for char in text:
        if char.isalpha():
            out.append("A")
        elif char.isdigit():
            out.append("0")
        else:
            out.append(" " if char.isspace() else char)
    return "".join(out)


def grouped_mpn_pattern(value):
    exact = exact_mpn_pattern(value)
    parts = []
    index = 0
    while index < len(exact):
        char = exact[index]
        if char in {"A", "0"}:
            end = index + 1
            while end < len(exact) and exact[end] == char:
                end += 1
            parts.append(f"{char}{{{end - index}}}")
            index = end
        else:
            parts.append(char)
            index += 1
    return "".join(parts)


def character_classes(value):
    text = _clean(value)
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


def _load_json_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def load_mpn_pattern_library():
    if not MPN_PATTERN_PATH.exists():
        logger.warning("MPN pattern library not found: %s", MPN_PATTERN_PATH)
        return {}
    return _load_json_gz(MPN_PATTERN_PATH)


@lru_cache(maxsize=1)
def load_manufacturer_pattern_index():
    if not MANUFACTURER_PATTERN_PATH.exists():
        logger.warning("Manufacturer pattern index not found: %s", MANUFACTURER_PATTERN_PATH)
        return {}
    return _load_json_gz(MANUFACTURER_PATTERN_PATH)


@lru_cache(maxsize=1)
def load_manufacturer_lookup():
    lookup = {}
    if not MANUFACTURER_DIRECTORY_PATH.exists():
        return lookup
    try:
        with MANUFACTURER_DIRECTORY_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:
        logger.warning("Manufacturer directory not loaded for pattern scoring: %s", exc)
        return lookup

    for name in data.get("names") or []:
        clean = _clean(name)
        key = _norm_key(clean)
        if key:
            lookup[key] = clean
    for alias, canonical in (data.get("aliases") or {}).items():
        alias_key = _norm_key(alias)
        clean_canonical = _clean(canonical)
        if alias_key:
            lookup[alias_key] = clean_canonical or _clean(alias)
    return lookup


def _numeric_ratio(text):
    alnum = [char for char in text if char.isalnum()]
    if not alnum:
        return 0.0
    return sum(1 for char in alnum if char.isdigit()) / len(alnum)


def _looks_like_dimension_or_note(text):
    upper = text.upper()
    if any(token in upper for token in ("ANY APPROVED", "DISCONTINUED", "CONTACT MFR")):
        return True
    if re.search(r"\b\d+(?:\.\d+)?\s*[X*]\s*\d+", upper):
        return True
    if re.search(r"\b\d+(?:\.\d+)?\s*(MM|CM|MTR|METER|INCH|KG|LITER|LITRE)\b", upper):
        return True
    return False


def score_mpn_value(value):
    text = _clean(value)
    if not text:
        return {"score": 0.0, "matched": False, "reason": "blank"}

    library = load_mpn_pattern_library()
    grouped_counts = library.get("grouped_patterns") or {}
    exact_counts = library.get("exact_patterns") or {}
    class_counts = library.get("character_classes") or {}

    exact = exact_mpn_pattern(text)
    grouped = grouped_mpn_pattern(text)
    cls = character_classes(text)
    length = len(text)

    score = 0.0
    reasons = []
    grouped_count = int(grouped_counts.get(grouped, 0) or 0)
    exact_count = int(exact_counts.get(exact, 0) or 0)
    class_count = int(class_counts.get(cls, 0) or 0)

    if grouped_count:
        score += 0.55
        reasons.append("known grouped MPN shape")
    if exact_count:
        score += 0.20
        reasons.append("known exact character shape")
    if class_count:
        score += 0.10
    if 4 <= length <= 32:
        score += 0.10
    elif 1 <= length <= 40:
        score += 0.03

    ratio = _numeric_ratio(text)
    if 0.15 <= ratio <= 0.95 and any(char.isalpha() for char in text):
        score += 0.10
    elif text.isdigit() and length >= 6:
        score += 0.04

    if _looks_like_dimension_or_note(text):
        score -= 0.25
        reasons.append("dimension/note-like text")
    if len(text.split()) >= 5 and not grouped_count:
        score -= 0.20
        reasons.append("long prose-like text")

    score = max(0.0, min(1.0, score))
    return {
        "score": round(score, 4),
        "matched": score >= 0.55,
        "pattern": grouped,
        "exact_pattern": exact,
        "grouped_count": grouped_count,
        "exact_count": exact_count,
        "character_classes": cls,
        "reasons": reasons,
    }


def score_manufacturer_value(value):
    text = _clean(value)
    if not text:
        return {"score": 0.0, "matched": False, "reason": "blank"}

    lookup = load_manufacturer_lookup()
    candidates = [text]
    candidates.extend(re.findall(r"\(([^()]*)\)", text))
    candidates.extend(re.split(r"[|;/,]+", text))

    best = 0.0
    best_match = ""
    for candidate in candidates:
        key = _norm_key(candidate)
        if not key:
            continue
        if key in lookup:
            best = max(best, 1.0)
            best_match = lookup[key]
    return {
        "score": round(best, 4),
        "matched": best >= 0.75,
        "manufacturer": best_match,
    }


def score_column_as_mpn(values, sample_size=200):
    sample = [_clean(value) for value in (values or []) if _clean(value)][:sample_size]
    if not sample:
        return {"score": 0.0, "match_rate": 0.0, "sample_size": 0}
    scores = [score_mpn_value(value)["score"] for value in sample]
    match_rate = sum(1 for score in scores if score >= 0.55) / len(scores)
    return {
        "score": round((mean(scores) * 0.55) + (match_rate * 0.45), 4),
        "match_rate": round(match_rate, 4),
        "sample_size": len(sample),
    }


def score_column_as_manufacturer(values, sample_size=200):
    sample = [_clean(value) for value in (values or []) if _clean(value)][:sample_size]
    if not sample:
        return {"score": 0.0, "match_rate": 0.0, "sample_size": 0}
    scores = [score_manufacturer_value(value)["score"] for value in sample]
    match_rate = sum(1 for score in scores if score >= 0.75) / len(scores)
    return {
        "score": round((mean(scores) * 0.55) + (match_rate * 0.45), 4),
        "match_rate": round(match_rate, 4),
        "sample_size": len(sample),
    }
