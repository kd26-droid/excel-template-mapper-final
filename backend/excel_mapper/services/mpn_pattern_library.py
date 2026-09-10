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
MPN_MFR_LOOKUP_PATH = DATA_DIR / "mpn_mfr_lookup.v1.json.gz"

GENERIC_MANUFACTURER_TERMS = {
    "ACTIVE",
    "ADAPTER",
    "ADHESIVE",
    "ASSEMBLY",
    "CAPACITOR",
    "COMPONENT",
    "COMPONENTS",
    "COMPOSANT",
    "CONNECTOR",
    "CONTACT",
    "CO",
    "COMPANY",
    "CORP",
    "CORPORATION",
    "DIODE",
    "DOCUMENT",
    "DRAWING",
    "ELECTRONIC",
    "ELECTRONICS",
    "ELECTRONIQUE",
    "FUSE",
    "IC",
    "INFO",
    "INC",
    "INDUCTOR",
    "LABEL",
    "LIMITED",
    "LTD",
    "MANUAL",
    "LED",
    "MANUFACTURER",
    "MECHANICAL",
    "MICROELECTRONIC",
    "MICROELECTRONICS",
    "NAME",
    "NO",
    "NONE",
    "NON",
    "NUMBER",
    "PACK",
    "PACKAGE",
    "PACKAGING",
    "PART",
    "PCB",
    "PCBA",
    "REEL",
    "RESISTOR",
    "SOCKET",
    "SEMICONDUCTOR",
    "SEMICONDUCTORS",
    "SWITCH",
    "TAPE",
    "TECH",
    "TECHNOLOGIES",
    "TECHNOLOGY",
    "TEST",
    "TRANSFORMER",
    "TRANSISTOR",
    "INSTRUMENT",
    "INSTRUMENTS",
    "UNKNOWN",
    "VARISTOR",
    "YES",
}

STATUS_OR_COMPLIANCE_TERMS = {
    "ABSENCE",
    "ACTIVE",
    "CANDIDATE",
    "CLASSIFICATION",
    "COMPLIANT",
    "CONFORME",
    "CONTROLLED",
    "D",
    "EXPORT",
    "INFORMATION",
    "LISTED",
    "NO",
    "NON",
    "NOT",
    "PAS",
    "PRESENCE",
    "TBD",
    "UNKNOWN",
    "VALID",
    "WARNING",
    "YES",
}

UNIT_ONLY_TERMS = {
    "G",
    "GM",
    "KG",
    "MG",
    "M",
    "MM",
    "CM",
    "KM",
    "L",
    "ML",
    "EA",
    "U",
    "PC",
    "PCS",
    "ST",
    "STK",
    "NO",
    "NOS",
}


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _strip_identifier_artifacts(value):
    return _clean(value).strip(" \t\r\n\"'`#")


def _strip_trailing_percent_annotation(value):
    text = _strip_identifier_artifacts(value)
    stripped = re.sub(
        r"\s*[\(\[\{]\s*[+-]?\d+(?:\.\d+)?\s*%\s*[\)\]\}]\s*$",
        "",
        text,
    ).strip()
    return stripped if stripped else text


def _norm_key(value):
    return re.sub(r"[^A-Z0-9]+", " ", _clean(value).upper()).strip()


def _manufacturer_key_can_be_segmented(key, known_keys):
    tokens = key.split()
    if len(tokens) < 2:
        return False

    memo = {}

    def search(index, segment_count):
        if index == len(tokens):
            return segment_count >= 2
        if index in memo:
            return memo[index]
        for end in range(index + 1, len(tokens) + 1):
            segment = " ".join(tokens[index:end])
            if segment == key:
                continue
            if segment not in known_keys:
                continue
            if search(end, segment_count + 1):
                memo[index] = True
                return True
        memo[index] = False
        return False

    return search(0, 0)


def _spaced_manufacturer_key_variants(key):
    variants = []
    if not key or " " in key:
        return variants
    for suffix in sorted(GENERIC_MANUFACTURER_TERMS, key=len, reverse=True):
        if len(suffix) < 5 or not key.endswith(suffix):
            continue
        prefix = key[: -len(suffix)].strip()
        if len(prefix) >= 2:
            variants.append(f"{prefix} {suffix}")
    return variants


def _should_protect_explicit_manufacturer_key(key):
    tokens = key.split()
    if len(tokens) < 2:
        return False

    has_generic_suffix = any(token in GENERIC_MANUFACTURER_TERMS for token in tokens)
    if not has_generic_suffix:
        return False

    meaningful_tokens = [
        token for token in tokens
        if token not in GENERIC_MANUFACTURER_TERMS
        and token not in STATUS_OR_COMPLIANCE_TERMS
    ]
    return bool(meaningful_tokens)


def _has_explicit_manufacturer_joiner(value):
    text = _clean(value)
    if "/" not in text:
        return False
    parts = [part for part in re.split(r"\s*/\s*", text) if _clean(part)]
    return len(parts) >= 2


def _norm_mpn_lookup_key(value):
    return re.sub(r"[^A-Z0-9]+", "", _clean(value).upper())


def _looks_like_status_or_compliance_value(value):
    key = _norm_key(value)
    if not key:
        return False
    tokens = key.split()
    if not tokens:
        return False
    if all(token in STATUS_OR_COMPLIANCE_TERMS for token in tokens):
        return True
    return bool(re.fullmatch(
        r"(UNKNOWN|WARNING|YES|NO|NON|OUI)(?: PAS D INFORMATION| ABSENCE| PRESENCE| NON CONFORME| CONFORME)?",
        key,
    ))


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
def load_mpn_mfr_lookup():
    if not MPN_MFR_LOOKUP_PATH.exists():
        return {}
    try:
        return _load_json_gz(MPN_MFR_LOOKUP_PATH).get("manufacturers_by_mpn") or {}
    except Exception as exc:
        logger.warning("MPN/MFR lookup not loaded for pattern scoring: %s", exc)
        return {}


@lru_cache(maxsize=1)
def load_manufacturer_lookup():
    lookup = {}
    protected_keys = set()
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
        if key and len(key.replace(" ", "")) >= 2 and key not in GENERIC_MANUFACTURER_TERMS:
            lookup[key] = clean
            if _should_protect_explicit_manufacturer_key(key) or _has_explicit_manufacturer_joiner(clean):
                protected_keys.add(key)
    for alias, canonical in (data.get("aliases") or {}).items():
        alias_key = _norm_key(alias)
        clean_canonical = _clean(canonical)
        canonical_key = _norm_key(clean_canonical)
        if canonical_key and len(canonical_key.replace(" ", "")) >= 2 and canonical_key not in GENERIC_MANUFACTURER_TERMS:
            lookup.setdefault(canonical_key, clean_canonical)
            if _should_protect_explicit_manufacturer_key(canonical_key) or _has_explicit_manufacturer_joiner(clean_canonical):
                protected_keys.add(canonical_key)
        if alias_key and len(alias_key.replace(" ", "")) >= 2 and alias_key not in GENERIC_MANUFACTURER_TERMS:
            lookup[alias_key] = clean_canonical or _clean(alias)
            if _should_protect_explicit_manufacturer_key(alias_key) or _has_explicit_manufacturer_joiner(alias):
                protected_keys.add(alias_key)

    known_keys = set(lookup)
    filtered = {
        key: manufacturer
        for key, manufacturer in lookup.items()
        if key in protected_keys or not _manufacturer_key_can_be_segmented(key, known_keys)
    }
    for key, manufacturer in list(filtered.items()):
        for variant in _spaced_manufacturer_key_variants(key):
            if variant not in GENERIC_MANUFACTURER_TERMS:
                filtered.setdefault(variant, manufacturer)
    return filtered


def is_composite_manufacturer_name(value, lookup=None):
    key = _norm_key(value)
    if not key:
        return False
    known_keys = set(lookup or load_manufacturer_lookup())
    return _manufacturer_key_can_be_segmented(key, known_keys)


@lru_cache(maxsize=1)
def load_manufacturer_phrase_lookup():
    phrases = {}
    for key, manufacturer in load_manufacturer_lookup().items():
        if key in GENERIC_MANUFACTURER_TERMS:
            continue
        if any(char.isdigit() for char in key):
            continue
        compact = key.replace(" ", "")
        if len(compact) < 4:
            continue
        phrases[key] = manufacturer
    return dict(sorted(phrases.items(), key=lambda item: len(item[0]), reverse=True))


@lru_cache(maxsize=1)
def load_manufacturer_phrase_token_index():
    token_index = {}
    for key, manufacturer in load_manufacturer_phrase_lookup().items():
        tokens = {
            token
            for token in key.split()
            if len(token) >= 3 and token not in GENERIC_MANUFACTURER_TERMS
        }
        if not tokens:
            tokens = {key}
        for token in tokens:
            token_index.setdefault(token, []).append((key, manufacturer))

    for token, phrases in token_index.items():
        token_index[token] = sorted(phrases, key=lambda item: len(item[0]), reverse=True)
    return token_index


def _numeric_ratio(text):
    alnum = [char for char in text if char.isalnum()]
    if not alnum:
        return 0.0
    return sum(1 for char in alnum if char.isdigit()) / len(alnum)


def _looks_like_dimension_or_note(text):
    upper = text.upper()
    if any(token in upper for token in ("ANY APPROVED", "DISCONTINUED", "CONTACT MFR")):
        return True
    if _has_embedded_dimension_pattern(upper):
        return True
    if re.search(r"\b\d+(?:\.\d+)?\s*(MM|CM|MTR|METER|INCH|KG|LITER|LITRE)\b", upper):
        return True
    return False


def _has_embedded_dimension_pattern(value):
    upper = _clean(value).upper()
    return bool(re.search(
        r"\d+(?:\.\d+)?\s*[X*]\s*\d+(?:\.\d+)?(?:\s*[X*]\s*\d+(?:\.\d+)?){0,3}\s*(?:MM|CM|M|IN|INCH|INCHES)\b",
        upper,
    ))


def _is_pure_dimension_string(value):
    text = _clean(value).upper().strip()
    text = re.sub(r"^[\(\[\{]\s*(.*?)\s*[\)\]\}]\s*((?:MM|CM|M|IN|INCH|INCHES)?)$", r"\1\2", text)
    text = text.strip("()[]{} ")
    return bool(re.fullmatch(
        r"\d+(?:\.\d+)?(?:\s*[X*]\s*\d+(?:\.\d+)?){1,4}\s*(?:MM|CM|M|IN|INCH|INCHES)?",
        text,
    ))


def _has_spelled_power_fraction(value):
    upper = _clean(value).upper()
    return bool(re.search(r"\b1\s*/\s*(?:2|4|8|10|16|20|32)\s*(?:W|WATT)?(?![\d.])", upper))


def _has_literal_percent_spec(value):
    upper = _clean(value).upper()
    return "%" in upper


def _looks_like_material_grade_identifier(value):
    return bool(re.fullmatch(r"\d\.\d{3,5}(?:\.\d+)?", _clean(value)))


def _looks_like_material_or_alloy_text(value):
    text = _clean(value)
    if not text:
        return False
    upper = text.upper().replace(",", ".")
    elements = re.findall(r"(?:SN|AG|CU|NI|PB|BI|SB|AU|ZN|AL|FE|CR)(?=\d|[A-Z]|$)", upper)
    if len(elements) >= 2 and re.search(r"\d", upper):
        return True
    # Avoid a nested-alternative fullmatch on long supplier-code lists such as
    # "24870-653108... 28384-101..."; those can backtrack for minutes.
    if len(upper) <= 50 and re.fullmatch(r"(?:SN|AG|CU|NI|PB|BI|SB|AU|ZN|AL|FE|CR|\d+(?:\.\d+)?|\s|[+/.-]){4,50}", upper):
        return bool(re.search(r"\d", upper) and len(elements) >= 1)
    material_words = (
        "BLEIFREI",
        "LEAD FREE",
        "LOTE",
        "LOT",
        "SOLDER",
        "ROHS",
        "KONFORM",
        "CONFORME",
        "AUSFUHRUNG",
    )
    return any(word in upper for word in material_words) and any(element in upper for element in ("SN", "CU", "AG", "NI", "PB"))


GENERIC_COMPONENT_DESCRIPTION_WORDS = {
    "ASSEMBLY",
    "BOARD",
    "CAPACITOR",
    "CIRCUIT",
    "CONNECTOR",
    "DIODE",
    "ELECTROLYTIC",
    "FERRITE",
    "FUSE",
    "INDUCTOR",
    "PCB",
    "PRINTED",
    "RESISTANCE",
    "RESISTOR",
    "SCREW",
    "SENSOR",
    "SOCKET",
    "SWITCH",
    "TRANSFORMER",
    "TRANSISTOR",
}


def _looks_like_generic_component_description(value):
    text = _clean(value)
    if not text:
        return False
    if re.search(r"[=/()]", text):
        return False
    tokens = re.findall(r"[A-Z]{3,}", text.upper())
    if not tokens:
        return False
    component_hits = sum(1 for token in tokens if token in GENERIC_COMPONENT_DESCRIPTION_WORDS)
    if component_hits and len(tokens) <= 6:
        return True
    return False


DESCRIPTION_WORDS = {
    "BLACK",
    "BLUE",
    "BOX",
    "BROWN",
    "CABLE",
    "COLOR",
    "GREEN",
    "GREY",
    "GRAY",
    "JALI",
    "KIT",
    "PACK",
    "POCKET",
    "RED",
    "SCREW",
    "SERIES",
    "SET",
    "SOLDER",
    "WHITE",
    "WITH",
    "YELLOW",
}


def _description_word_hits(value):
    words = re.findall(r"[A-Z]{3,}", _clean(value).upper())
    return [word for word in words if word in DESCRIPTION_WORDS]


def assess_mpn_text(value):
    text = _strip_identifier_artifacts(value)
    candidate_text = _strip_trailing_percent_annotation(text)
    stripped_percent_annotation = candidate_text != text
    assessment_text = candidate_text if stripped_percent_annotation else text
    compact = re.sub(r"[^A-Za-z0-9]+", "", assessment_text)
    hard_reasons = []
    review_reasons = []

    if not assessment_text:
        hard_reasons.append("blank")
    if compact and len(compact) <= 2:
        hard_reasons.append("too short")
    if _is_pure_dimension_string(assessment_text):
        hard_reasons.append("pure dimension string")
    if _looks_like_material_or_alloy_text(assessment_text):
        hard_reasons.append("material/alloy specification")
    if looks_like_generic_spec_designator(assessment_text):
        hard_reasons.append("generic spec/designator text")
    elif _has_literal_percent_spec(assessment_text):
        hard_reasons.append("literal percent spec")
    if _has_spelled_power_fraction(assessment_text):
        hard_reasons.append("spelled-out power fraction")

    if stripped_percent_annotation:
        review_reasons.append("trailing percent annotation stripped")
    if (
        _looks_like_dimension_or_note(assessment_text)
        or _has_embedded_dimension_pattern(assessment_text)
    ) and not _is_pure_dimension_string(assessment_text):
        review_reasons.append("loose dimension/unit pattern")
    if _description_word_hits(assessment_text):
        review_reasons.append("description/category words")
    if len(assessment_text.split()) >= 6:
        review_reasons.append("many space-separated words")
    if compact and compact.isalpha():
        review_reasons.append("letters only")
    if _looks_like_material_grade_identifier(assessment_text):
        review_reasons.append("material/grade identifier")
    if re.search(r"\s+/\s+", assessment_text):
        review_reasons.append("slash-separated alternates")

    return {
        "text": text,
        "candidate_text": candidate_text,
        "stripped_percent_annotation": stripped_percent_annotation,
        "hard_reject": bool(hard_reasons),
        "hard_reasons": hard_reasons,
        "needs_review": bool(review_reasons),
        "review_reasons": review_reasons,
        "material_grade": _looks_like_material_grade_identifier(assessment_text),
    }


def looks_like_generic_spec_designator(value):
    """Return True for commodity/spec descriptors masquerading as part numbers."""
    text = _strip_trailing_percent_annotation(value)
    if not text:
        return False
    upper = text.upper()
    normalized = re.sub(r"[^A-Z0-9%+./-]+", " ", upper)

    has_tolerance = _has_literal_percent_spec(upper) or "+/-" in upper
    has_resistance = bool(re.search(
        r"(\d+(?:\.\d+)?\s*(?:R|K|M)(?:OHM)?\b|\b(?:OHM|KOHM|MOHM)\b)",
        normalized,
    ))
    has_capacitance = bool(re.search(r"\d+(?:\.\d+)?\s*(?:PF|NF|UF|MF)\b", normalized))
    has_power = bool(re.search(r"(\b\d+\s*/\s*\d+\b|\b\d+(?:\.\d+)?\s*W\b|\bWATT\b)", normalized))
    has_voltage = bool(re.search(r"\d+(?:\.\d+)?\s*(?:VAC|VDC|KV|V)\b", normalized))
    has_package = bool(re.search(r"\b(0201|0402|0603|0805|1206|1210|1812|2010|2512|SMD|SMT)\b", normalized))

    spec_signal_count = sum(bool(signal) for signal in (
        has_tolerance,
        has_resistance,
        has_capacitance,
        has_power,
        has_voltage,
        has_package,
    ))

    if has_tolerance and (has_resistance or has_capacitance or has_power or has_voltage):
        return True
    if spec_signal_count >= 3 and any(separator in upper for separator in ("_", "/", " ")):
        return True
    if re.fullmatch(r"[0-9.]+\s*[RKM]\s*/\s*\d+%\s*/\s*\d+(?:\.\d+)?W", upper):
        return True
    return False


def _looks_like_document_reference(text):
    upper = text.upper()
    document_terms = (
        "DWG",
        "DRAWING",
        "DOCUMENT",
        "DOC",
        "SHEET",
        "REV",
        "REVISION",
        "ECO",
        "ECN",
    )
    return any(re.search(rf"\b{re.escape(term)}\b", upper) for term in document_terms)


def _has_mpn_label(text):
    upper = text.upper()
    return bool(re.search(
        r"\b(MPN|MFR\s*P(?:ART)?\s*N(?:UMBER)?|MFG\s*P(?:ART)?\s*N(?:UMBER)?|MANUFACTURER\s+PART)\b",
        upper,
    ))


def _is_numeric_identifier(text):
    clean = _clean(text)
    return bool(clean) and not any(char.isalpha() for char in clean) and bool(re.fullmatch(r"[0-9][0-9./_+\-() ]{3,49}", clean))


def _candidate_exact_lookup(candidate, lookup):
    assessment = assess_mpn_text(candidate)
    if assessment["hard_reject"] or assessment["material_grade"]:
        return None
    return lookup.get(_norm_mpn_lookup_key(assessment["candidate_text"]))


def _is_code_equals_manufacturer_assignment(cell_text, candidate, lookup):
    text = _clean(cell_text)
    if "=" not in text:
        return False
    left, right = [part.strip() for part in text.split("=", 1)]
    if not left or not right:
        return False
    candidate_key = _norm_mpn_lookup_key(candidate)
    left_key = _norm_mpn_lookup_key(left)
    if not candidate_key or candidate_key != left_key:
        return False
    if lookup.get(left_key):
        return False
    if not score_manufacturer_value(right).get("matched"):
        return False
    return bool(
        re.fullmatch(r"[A-Z]{1,3}\d{4,8}", left_key)
        or re.fullmatch(r"[A-Z]{2,8}", left_key)
    )


MPN_TOKEN_RE = re.compile(r"(?=[A-Za-z0-9][A-Za-z0-9./_+\-()]{2,49})(?=[A-Za-z0-9./_+\-()]*\d)[A-Za-z0-9][A-Za-z0-9./_+\-()]*[A-Za-z0-9)+]")


@lru_cache(maxsize=1)
def load_mpn_lookup_lengths():
    return sorted(
        {
            len(key)
            for key in load_mpn_mfr_lookup().keys()
            if len(key) >= 6
        },
        reverse=True,
    )


def _known_mpn_substrings(value, lookup, max_candidates=16):
    """Return known backend MPNs that appear anywhere inside a cell value."""
    normalized = _norm_mpn_lookup_key(value)
    if len(normalized) < 6:
        return []

    matches = []
    seen = set()
    for length in load_mpn_lookup_lengths():
        if length > len(normalized):
            continue
        for start in range(0, len(normalized) - length + 1):
            key = normalized[start:start + length]
            if key in seen:
                continue
            entry = lookup.get(key)
            if not entry:
                continue
            # Embedded numeric-only IDs are risky; exact/separated numeric tokens
            # are still handled by the normal exact lookup path.
            if not (any(char.isalpha() for char in key) and any(char.isdigit() for char in key)):
                continue
            seen.add(key)
            matches.append(entry.get("mpn") or key)
            if len(matches) >= max_candidates:
                return matches
    return matches


def candidate_mpn_tokens(value, max_candidates=16, lookup=None):
    """Return plausible MPN tokens found anywhere inside a cell value."""
    text = _clean(value)
    if not text:
        return []

    candidates = []

    if lookup:
        candidates.extend(_known_mpn_substrings(text, lookup, max_candidates=max_candidates))

    def add(raw):
        token = _clean(raw).strip(" \t\r\n\"'`[]{}<>")
        token = token.strip(".,;:|")
        if not token:
            return
        if not any(char.isdigit() for char in token):
            return
        if len(token) < 4 or len(token) > 50:
            return
        candidates.append(token)

        without_parenthetical = _clean(re.sub(r"\([^)]*\)", "", token)).strip(".,;:|")
        if without_parenthetical and without_parenthetical != token:
            add(without_parenthetical)

    # Score the whole cell when it is already a compact MPN-like value.
    if len(text) <= 50:
        add(text)

    # Packed cells often look like "MPN:MANUFACTURER" or "MFR / MPN; MFR / MPN".
    for part in re.split(r"[:;|,\n\r\t]+", text):
        add(part)

    # MPNs can also be embedded in notes or prose. Pull out compact alpha/digit
    # tokens without assuming a delimiter.
    for match in MPN_TOKEN_RE.finditer(text):
        add(match.group(0))

    unique = []
    seen = set()
    for candidate in candidates:
        key = candidate.upper()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
        if len(unique) >= max_candidates:
            break
    return unique


def _score_mpn_candidate(value):
    assessment = assess_mpn_text(value)
    text = assessment["candidate_text"]
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

    if "loose dimension/unit pattern" in assessment["review_reasons"]:
        score -= 0.12
        reasons.append("loose dimension/unit pattern")
    if "description/category words" in assessment["review_reasons"]:
        score -= 0.08
        reasons.append("description/category words")
    if "many space-separated words" in assessment["review_reasons"]:
        score -= 0.15
        reasons.append("many space-separated words")
    if "slash-separated alternates" in assessment["review_reasons"]:
        score -= 0.10
        reasons.append("slash-separated alternates")
    if assessment["material_grade"]:
        score = min(score, 0.40)
        reasons.append("material/grade identifier")
    if assessment["hard_reject"]:
        score = min(score, 0.25)
        reasons.extend(assessment["hard_reasons"])
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
        "hard_reject": assessment["hard_reject"],
        "hard_reasons": assessment["hard_reasons"],
        "needs_review": assessment["needs_review"],
        "review_reasons": assessment["review_reasons"],
        "material_grade": assessment["material_grade"],
        "canonical_text": text,
    }


@lru_cache(maxsize=16384)
def _score_mpn_value_cached(text):
    if not text:
        return {"score": 0.0, "matched": False, "reason": "blank"}

    lookup = load_mpn_mfr_lookup()
    cell_assessment = assess_mpn_text(text)
    candidates = candidate_mpn_tokens(cell_assessment["candidate_text"], lookup=lookup)
    if not candidates:
        return {"score": 0.0, "matched": False, "reason": "no plausible MPN token", "candidate": "", "candidate_count": 0}

    manufacturer_signal = score_manufacturer_value(text)
    has_mpn_label = _has_mpn_label(text)
    has_document_context = _looks_like_document_reference(text)

    scored = []
    for candidate in candidates:
        candidate_score = dict(_score_mpn_candidate(candidate))
        lookup_candidate = candidate_score.get("canonical_text") or candidate
        exact_lookup_hit = _candidate_exact_lookup(lookup_candidate, lookup)
        is_numeric_identifier = _is_numeric_identifier(lookup_candidate)
        code_equals_manufacturer = _is_code_equals_manufacturer_assignment(text, lookup_candidate, lookup)
        candidate_score["_exact_lookup_hit"] = exact_lookup_hit
        candidate_score["_numeric_identifier"] = is_numeric_identifier
        candidate_score["_code_equals_manufacturer"] = code_equals_manufacturer

        if exact_lookup_hit:
            candidate_score["score"] = 1.0
            candidate_score.setdefault("reasons", []).append("known MPN in backend lookup")
        elif candidate_score.get("hard_reject") or (cell_assessment["hard_reject"] and not exact_lookup_hit):
            candidate_score["score"] = min(candidate_score["score"], 0.25)
            candidate_score.setdefault("reasons", []).extend(
                cell_assessment["hard_reasons"]
                or candidate_score.get("hard_reasons")
                or ["generic spec/designator text"]
            )
        elif code_equals_manufacturer:
            candidate_score["score"] = min(candidate_score["score"], 0.35)
            candidate_score.setdefault("reasons", []).append("supplier code assigned to manufacturer")
        elif is_numeric_identifier and not manufacturer_signal.get("matched") and not has_mpn_label:
            candidate_score["score"] = min(candidate_score["score"], 0.52)
            candidate_score.setdefault("reasons", []).append("bare numeric identifier")

        if has_document_context and not exact_lookup_hit and not manufacturer_signal.get("matched") and not has_mpn_label:
            candidate_score["score"] = round(max(0.0, candidate_score["score"] - 0.25), 4)
            candidate_score.setdefault("reasons", []).append("document/reference context")

        scored.append(candidate_score)

    best_index, best = max(enumerate(scored), key=lambda item: item[1]["score"])
    best = dict(best)
    best_candidate = candidates[best_index]
    lookup_candidate = best.get("canonical_text") or best_candidate

    cell_hard_reject = cell_assessment["hard_reject"]
    candidate_hard_reject = bool(best.get("hard_reject"))
    material_grade = bool(best.get("material_grade") or cell_assessment["material_grade"])
    exact_lookup_hit = best.pop("_exact_lookup_hit", None)
    is_numeric_identifier = bool(best.pop("_numeric_identifier", False))
    code_equals_manufacturer = bool(best.pop("_code_equals_manufacturer", False))
    generic_spec_designator = candidate_hard_reject or (cell_hard_reject and not exact_lookup_hit)

    # Manufacturer evidence in the same cell is strong evidence that the MPN-like
    # token belongs in an MPN column, not a random note/description column.
    if manufacturer_signal.get("matched") and best["score"] > 0 and not code_equals_manufacturer:
        best["score"] = round(max(min(1.0, best["score"] + 0.08), 0.65), 4)
        best.setdefault("reasons", []).append("manufacturer evidence in same cell")

    if has_mpn_label and best["score"] > 0:
        best["score"] = round(min(1.0, best["score"] + 0.08), 4)
        best.setdefault("reasons", []).append("MPN label in same cell")

    cell_lookup_key = _norm_mpn_lookup_key(text)
    best_lookup_key = _norm_mpn_lookup_key(lookup_candidate)
    contained_known_mpn = (
        bool(exact_lookup_hit)
        and bool(best_lookup_key)
        and best_lookup_key != cell_lookup_key
        and best_lookup_key in cell_lookup_key
    )
    if contained_known_mpn:
        best.setdefault("reasons", []).append("known MPN found inside cell")

    best["matched"] = best["score"] >= 0.55
    best["candidate"] = lookup_candidate
    best["raw_candidate"] = best_candidate
    best["candidate_count"] = len(candidates)
    best["manufacturer_context"] = bool(manufacturer_signal.get("matched"))
    best["mpn_label"] = has_mpn_label
    best["numeric_identifier"] = is_numeric_identifier
    best["document_context"] = has_document_context
    best["exact_lookup"] = bool(exact_lookup_hit)
    best["code_equals_manufacturer"] = code_equals_manufacturer
    best["generic_spec_designator"] = generic_spec_designator
    best["contained_known_mpn"] = contained_known_mpn
    best["hard_reject"] = generic_spec_designator
    hard_reasons = best.get("hard_reasons") or []
    if generic_spec_designator:
        hard_reasons = hard_reasons + cell_assessment["hard_reasons"]
    best["hard_reasons"] = list(dict.fromkeys(hard_reasons))
    best["material_grade"] = material_grade
    best["cell_hard_reject"] = cell_assessment["hard_reject"]
    best["cell_hard_reasons"] = cell_assessment["hard_reasons"]
    best["cell_needs_review"] = cell_assessment["needs_review"]
    best["cell_review_reasons"] = cell_assessment["review_reasons"]
    if exact_lookup_hit:
        best["lookup_manufacturers"] = exact_lookup_hit.get("manufacturers") or []
    return best


def score_mpn_value(value):
    return dict(_score_mpn_value_cached(_clean(value)))


@lru_cache(maxsize=8192)
def _score_manufacturer_text(text):
    if not text:
        return {"score": 0.0, "matched": False, "reason": "blank"}
    if _norm_key(text) in UNIT_ONLY_TERMS:
        return {"score": 0.0, "matched": False, "manufacturer": "", "reason": "unit token"}
    if _looks_like_status_or_compliance_value(text):
        return {"score": 0.0, "matched": False, "manufacturer": "", "reason": "status/compliance value"}
    if _looks_like_generic_component_description(text):
        return {"score": 0.0, "matched": False, "manufacturer": "", "reason": "component description"}

    lookup = load_manufacturer_lookup()
    candidates = [text]
    candidates.extend(re.findall(r"\(([^()]*)\)", text))
    candidates.extend(re.split(r"[:|;/,=]+", text))

    best = 0.0
    best_match = ""
    for candidate in candidates:
        key = _norm_key(candidate)
        if not key:
            continue
        if key in lookup:
            best = max(best, 1.0)
            best_match = lookup[key]
    if best < 0.75:
        padded_text = f" {_norm_key(text)} "
        text_tokens = {
            token
            for token in padded_text.split()
            if len(token) >= 3 and token not in GENERIC_MANUFACTURER_TERMS
        }
        phrase_candidates = {}
        phrase_index = load_manufacturer_phrase_token_index()
        for token in text_tokens:
            for key, manufacturer in phrase_index.get(token, []):
                phrase_candidates[key] = manufacturer

        for key, manufacturer in sorted(phrase_candidates.items(), key=lambda item: len(item[0]), reverse=True):
            if f" {key} " in padded_text:
                best = 0.85
                best_match = manufacturer
                break
    return {
        "score": round(best, 4),
        "matched": best >= 0.75,
        "manufacturer": best_match,
    }


def score_manufacturer_value(value):
    return dict(_score_manufacturer_text(_clean(value)))


def clear_scoring_caches():
    _score_mpn_value_cached.cache_clear()
    _score_manufacturer_text.cache_clear()


def score_column_as_mpn(values, sample_size=200):
    sample = [_clean(value) for value in (values or []) if _clean(value)][:sample_size]
    if not sample:
        return {
            "score": 0.0,
            "match_rate": 0.0,
            "sample_size": 0,
            "average_score": 0.0,
            "manufacturer_context_rate": 0.0,
            "label_rate": 0.0,
            "numeric_identifier_rate": 0.0,
            "document_context_rate": 0.0,
            "exact_lookup_rate": 0.0,
            "generic_spec_rate": 0.0,
        }
    results = [score_mpn_value(value) for value in sample]
    scores = [result["score"] for result in results]
    match_rate = sum(1 for score in scores if score >= 0.55) / len(scores)
    manufacturer_context_rate = sum(1 for result in results if result.get("manufacturer_context")) / len(results)
    label_rate = sum(1 for result in results if result.get("mpn_label")) / len(results)
    numeric_identifier_rate = sum(1 for result in results if result.get("numeric_identifier")) / len(results)
    document_context_rate = sum(1 for result in results if result.get("document_context")) / len(results)
    exact_lookup_rate = sum(1 for result in results if result.get("exact_lookup")) / len(results)
    generic_spec_rate = sum(1 for result in results if result.get("generic_spec_designator")) / len(results)
    return {
        "score": round((mean(scores) * 0.45) + (match_rate * 0.35) + (manufacturer_context_rate * 0.10) + (exact_lookup_rate * 0.10), 4),
        "match_rate": round(match_rate, 4),
        "sample_size": len(sample),
        "average_score": round(mean(scores), 4),
        "manufacturer_context_rate": round(manufacturer_context_rate, 4),
        "label_rate": round(label_rate, 4),
        "numeric_identifier_rate": round(numeric_identifier_rate, 4),
        "document_context_rate": round(document_context_rate, 4),
        "exact_lookup_rate": round(exact_lookup_rate, 4),
        "generic_spec_rate": round(generic_spec_rate, 4),
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
