import re
import unicodedata
import hashlib
from functools import lru_cache
from statistics import mean
from time import perf_counter

from .mpn_pattern_library import (
    candidate_mpn_tokens,
    load_manufacturer_lookup,
    load_manufacturer_phrase_lookup,
    score_manufacturer_value,
    score_mpn_value,
)


ROLE_KEYS = (
    "cpn",
    "mpn",
    "manufacturer",
    "description",
    "quantity",
    "uom",
    "notes",
    "internalNotes",
    "level",
    "parent",
)

VALUE_SIGNAL_SAMPLE_SIZE = 150
FIELD_PATTERN_RULE_NAME_PREFIX = "BOM field pattern:"

ROLE_LABELS = {
    "cpn": "CPN / customer part number",
    "mpn": "MPN column",
    "manufacturer": "Manufacturer column",
    "description": "Description / item name",
    "quantity": "Quantity",
    "uom": "UOM",
    "notes": "Notes",
    "internalNotes": "Internal notes",
    "level": "BOM level",
    "parent": "Parent / group key",
}

FACTWISE_FIELD_LABELS = {
    "cpn": "CPN",
    "mpn": "MPN",
    "manufacturer": "Manufacturer",
    "description": "Description",
    "quantity": "Quantity",
    "uom": "UOM",
    "level": "Level",
    "parent": "Parent / group key",
    "notes": "Notes",
    "internalNotes": "Internal notes",
}

AMBIGUOUS_UOM_TOKENS = {"M", "G", "L", "S", "H", "D", "C", "ST", "NO", "P"}
UOM_TOKENS = {
    "M": ("Meter", "Length"),
    "METRE": ("Meter", "Length"),
    "METER": ("Meter", "Length"),
    "METRES": ("Meter", "Length"),
    "METERS": ("Meter", "Length"),
    "CM": ("Centimeter", "Length"),
    "CENTIMETER": ("Centimeter", "Length"),
    "CENTIMETRE": ("Centimeter", "Length"),
    "MM": ("Millimeter", "Length"),
    "MILLIMETER": ("Millimeter", "Length"),
    "MILLIMETRE": ("Millimeter", "Length"),
    "KM": ("Kilometer", "Length"),
    "IN": ("Inch", "Length"),
    "INCH": ("Inch", "Length"),
    "INCHES": ("Inch", "Length"),
    "FT": ("Foot", "Length"),
    "FOOT": ("Foot", "Length"),
    "FEET": ("Foot", "Length"),
    "YD": ("Yard", "Length"),
    "MI": ("Mile", "Length"),
    "SQM": ("Square meter", "Area"),
    "SQ M": ("Square meter", "Area"),
    "M2": ("Square meter", "Area"),
    "MM2": ("Square millimeter", "Area"),
    "CM2": ("Square centimeter", "Area"),
    "CU M": ("Cubic meter", "Volume"),
    "M3": ("Cubic meter", "Volume"),
    "CC": ("Cubic centimeter", "Volume"),
    "ML": ("Milliliter", "Volume"),
    "L": ("Liter", "Volume"),
    "LITER": ("Liter", "Volume"),
    "LITRE": ("Liter", "Volume"),
    "KG": ("Kilogram", "Mass"),
    "KILOGRAM": ("Kilogram", "Mass"),
    "G": ("Gram", "Mass"),
    "GM": ("Gram", "Mass"),
    "GRAM": ("Gram", "Mass"),
    "MG": ("Milligram", "Mass"),
    "OZ": ("Ounce", "Mass"),
    "LB": ("Pound", "Mass"),
    "LBS": ("Pound", "Mass"),
    "PCS": ("Pieces", "Count"),
    "PC": ("Pieces", "Count"),
    "PIECE": ("Pieces", "Count"),
    "PIECES": ("Pieces", "Count"),
    "ST": ("Pieces", "Count"),
    "STK": ("Pieces", "Count"),
    "P": ("Pieces", "Count"),
    "EA": ("Units", "Count"),
    "EACH": ("Units", "Count"),
    "UNIT": ("Units", "Count"),
    "UNITS": ("Units", "Count"),
    "U": ("Units", "Count"),
    "NO": ("Number", "Count"),
    "NO.": ("Number", "Count"),
    "NOS": ("Number", "Count"),
    "NUMBER": ("Number", "Count"),
    "NUMBERS": ("Number", "Count"),
    "DZ": ("Dozen", "Count"),
    "DOZEN": ("Dozen", "Count"),
    "PAIR": ("Pair", "Count"),
    "PAIRS": ("Pair", "Count"),
    "PR": ("Pair", "Count"),
    "SET": ("Set", "Count"),
    "SETS": ("Set", "Count"),
    "BOX": ("Box", "Count"),
    "BOXES": ("Box", "Count"),
    "BX": ("Box", "Count"),
    "PACK": ("Pack", "Count"),
    "PACKAGE": ("Pack", "Count"),
    "PACKS": ("Pack", "Count"),
    "PK": ("Pack", "Count"),
    "ROLL": ("Roll", "Count"),
    "BAG": ("Bag", "Count"),
}

COMPONENT_WORDS = {
    "ADAPTER",
    "ASSEMBLY",
    "BATTERY",
    "BOLT",
    "BRACKET",
    "CABLE",
    "CAP",
    "CAPACITOR",
    "CONNECTOR",
    "CONTACT",
    "DIODE",
    "FERRITE",
    "FUSE",
    "HEADER",
    "IC",
    "INDUCTOR",
    "LABEL",
    "LED",
    "MODULE",
    "NUT",
    "PCB",
    "PCBA",
    "RES",
    "RESISTOR",
    "SCREW",
    "SENSOR",
    "SOCKET",
    "SPRING",
    "SWITCH",
    "TRANSFORMER",
    "TRANSISTOR",
    "WASHER",
    "WIRE",
}

NOTE_WORDS = {
    "APPROVED",
    "CHECK",
    "CUSTOMER",
    "DELETE",
    "DELETED",
    "DNI",
    "DNP",
    "DO",
    "EQUIVALENT",
    "FITTED",
    "IGNORE",
    "INACTIVE",
    "LATEST",
    "NOTE",
    "OBSOLETE",
    "OPTIONAL",
    "POPULATE",
    "PROTOTYPE",
    "REF",
    "REMARK",
    "REQUIRED",
    "REVISION",
    "SUPPLIED",
    "USE",
}

INTERNAL_NOTE_WORDS = {
    "BUYER",
    "COST",
    "COSTING",
    "INTERNAL",
    "MANUAL",
    "PRIVATE",
    "PROCUREMENT",
    "REVIEW",
    "VERIFY",
    "VISIBLE",
}

COMPANY_SUFFIX_WORDS = {
    "AG",
    "BV",
    "CO",
    "COMPANY",
    "CORP",
    "CORPORATION",
    "GMBH",
    "INC",
    "LIMITED",
    "LLC",
    "LTD",
    "PTE",
    "PTY",
    "PVT",
    "SA",
    "SAS",
}

COMPANY_DOMAIN_WORDS = {
    "COMPONENT",
    "COMPONENTS",
    "CONNECTOR",
    "ELECTRIC",
    "ELECTRICAL",
    "ELECTRONIC",
    "ELECTRONICS",
    "INDUSTRIES",
    "MANUFACTURING",
    "MICRO",
    "SEMICONDUCTOR",
    "SEMICONDUCTORS",
    "TECH",
    "TECHNOLOGIES",
    "TECHNOLOGY",
}

SPECIFICATION_PAIR_HEADERS = {
    "specification name",
    "specification value",
    "identifier name",
    "identifier value",
}

NON_BOM_ROLE_HEADERS = {
    "item type",
    "type",
    "type article",
    "tag",
    "preferred vendor code",
    "procurement entity name",
    "procurement item",
    "sales item",
}

BOOLEAN_TOKENS = {
    "0",
    "1",
    "FALSE",
    "N",
    "NO",
    "NON",
    "OUI",
    "TRUE",
    "Y",
    "YES",
}


def clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value).replace("\u00a0", " ")).strip()


PLACEHOLDER_VALUES = {"-", "--", "---", "—", "N/A", "NA", "NULL", "NONE"}


def is_blankish(value):
    text = clean(value)
    return not text or text.upper() in PLACEHOLDER_VALUES


def norm_header(value):
    text = unicodedata.normalize("NFKD", clean(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[\W_]+", " ", text.lower()).strip()


def norm_token(value):
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9.]+", " ", clean(value).upper())).strip()


def clamp(value):
    return max(0.0, min(1.0, float(value or 0.0)))


def confidence(score):
    if score >= 0.85:
        return "high"
    if score >= 0.65:
        return "medium"
    return "low"


def header_support(header, role):
    key = norm_header(header)
    if not key:
        return 0.0

    patterns = {
        "mpn": [
            r"^mpn$",
            r"manufacturer part",
            r"manufacturer equivalent part",
            r"equivalent part",
            r"\bmfr equivalent\b",
            r"\bmfg equivalent\b",
            r"\bmfr part\b",
            r"\bmfg part\b",
            r"ref fabricant",
            r"reference fabricant",
            r"fabricant ref",
            r"approved manufacturer",
            r"producer",
        ],
        "manufacturer": [
            r"^manufacturer$",
            r"^manufacturers$",
            r"\bmfr\b",
            r"\bmfg\b",
            r"fabricant",
            r"maker",
            r"brand",
            r"producer",
            r"approved source",
        ],
        "cpn": [
            r"\bcpn\b",
            r"customer part",
            r"client part",
            r"internal part",
            r"item code",
            r"part code",
            r"component code",
            r"component number",
            r"component no",
            r"item number",
            r"item no",
            r"material code",
            r"material number",
            r"material no",
            r"ref article",
            r"reference article",
            r"article",
            r"^part number$",
            r"^part no$",
            r"^part$",
            r"^pn$",
            r"^component$",
            r"^komponente$",
            r"^material$",
        ],
        "quantity": [
            r"\bqty\b",
            r"quantity",
            r"\bqpa\b",
            r"\bqte\b",
            r"\bqnty\b",
            r"\bmenge\b",
            r"count",
            r"amount",
        ],
        "uom": [
            r"\buom\b",
            r"\bu m\b",
            r"\bunit\b",
            r"unit of measure",
            r"measurement unit",
            r"unite",
            r"\beinheit\b",
            r"mengeneinheit",
        ],
        "description": [
            r"description",
            r"part description",
            r"item description",
            r"component description",
            r"^specification$",
            r"deno civile",
            r"item name",
            r"part name",
            r"component name",
            r"designation",
            r"libelle",
            r"purchase order text",
            r"purchase text",
            r"po text",
            r"einkaufbestelltext",
            r"einkaufbestelltexte",
            r"einkaufsbestelltext",
            r"einkaufsbestelltexte",
            r"bestelltext",
            r"label",
            r"^name$",
        ],
        "notes": [
            r"\bnotes?\b",
            r"remarks?",
            r"comments?",
            r"customer notes?",
            r"bom notes?",
        ],
        "internalNotes": [
            r"internal notes?",
            r"internal remarks?",
            r"private notes?",
            r"engineering notes?",
            r"buyer notes?",
            r"procurement notes?",
            r"not visible",
        ],
        "level": [
            r"\blevel\b",
            r"\blvl\b",
            r"\bniv\b",
            r"\bniveau\b",
            r"bom level",
            r"indent",
            r"outline",
            r"excel outline level",
            r"structure level",
        ],
        "parent": [
            r"parent(?! key)",
            r"parent item",
            r"parent part",
            r"parent assembly",
            r"assembly",
            r"bom id",
            r"sub bom",
            r"finished good",
            r"higher level",
            r"top assembly",
        ],
    }
    exact_headers = {
        "mpn": {
            "mpn",
            "mfr part",
            "mfg part",
            "manufacturer part number",
            "manufacturer equivalent part",
            "equivalent part",
            "ref fabricant",
        },
        "manufacturer": {"manufacturer", "mfr", "mfg", "fabricant", "brand", "maker"},
        "cpn": {"component", "komponente", "material", "material number", "material no", "material code", "item no", "item number"},
        "quantity": {"qty", "quantity", "qpa", "qte", "menge"},
        "uom": {"uom", "unit", "measurement unit", "einheit", "mengeneinheit"},
        "level": {"level", "lvl", "niv", "niveau", "bom level", "excel outline level"},
        "parent": {"parent", "parent item", "parent assembly"},
        "description": {
            "description",
            "part description",
            "item description",
            "component description",
            "specification",
            "libelle",
            "deno civile",
            "designation",
            "item name",
            "part name",
            "component name",
            "purchase order text",
            "purchase text",
            "po text",
            "einkaufbestelltext",
            "einkaufbestelltexte",
            "einkaufsbestelltext",
            "einkaufsbestelltexte",
            "bestelltext",
        },
    }
    if key in exact_headers.get(role, set()):
        return 1.0
    for pattern in patterns.get(role, []):
        if re.search(pattern, key):
            return 0.78
    return 0.0


def is_specification_pair_header(header):
    key = norm_header(header)
    return key in SPECIFICATION_PAIR_HEADERS or re.fullmatch(r"specification (name|value)(?: \d+)?", key or "")


def is_item_name_header(header):
    return norm_header(header) in {"item name", "part name", "component name", "display name", "designation", "name"}


def is_identifier_header(header):
    key = norm_header(header)
    if not key:
        return False
    if re.search(r"\b(description|designation|libelle|name|nom)\b", key):
        return False
    return bool(re.search(
        r"\b(unique|identifier|identifiant|identificateur|uuid|guid|key|cle|id)\b",
        key,
    ))


def is_non_bom_role_header(header):
    key = norm_header(header)
    return (
        key in NON_BOM_ROLE_HEADERS
        or key.startswith("tag ")
        or bool(re.search(r"\b(phase|cycle|vie|life|lifecycle|status|statut|state|approval|approved|approuve|disqualifie|obsolete)\b", key))
        or bool(re.search(r"\b(doc|document|lien|link|url|securite|security|export|regl|class|classification|reach|rohs|ods|amiante|radionucleide|batterie|battery|lithium|lead free|origine|origin|packaging|package|packing|tape|reel)\b", key))
    )


def is_percent_or_cost_header(header):
    key = norm_header(header)
    return bool(re.search(r"\b(percent|percentage|freight|cost|price|rate|tax|duty|bcd|sws)\b", key))


def is_description_or_observation_header(header):
    key = norm_header(header)
    return bool(re.search(r"\b(description|designation|observation|observations|remark|remarks|remarque|remarques|comment|comments|achat|controle|quality|qualite)\b", key))


def is_visual_or_boolean_flag_header(header):
    key = norm_header(header)
    return bool(re.search(
        r"\b(image|picture|photo|icon|flag|checkbox|checked|corrected|corrige|ignored|ignore|valid|visible|phase|cycle|vie|life|lifecycle|status|statut|state|approval|approved|approuve|disqualifie|obsolete|reach|rohs|ods|amiante|radionucleide|batterie|battery|lithium|lead free)\b",
        key,
    ))


def boolean_like_profile(values):
    samples = non_empty(values)
    total = len(samples)
    if not total:
        return {
            "boolean_like": False,
            "boolean_rate": 0.0,
            "unique_rate": 0.0,
        }
    normalized = [norm_token(value) for value in samples]
    boolean_rate = ratio(sum(1 for value in normalized if value in BOOLEAN_TOKENS), total)
    unique_rate = ratio(len(set(normalized)), total)
    return {
        "boolean_like": boolean_rate >= 0.85 and len(set(normalized)) <= 4,
        "boolean_rate": round(boolean_rate, 4),
        "unique_rate": round(unique_rate, 4),
    }


def column_values(headers, rows, index, sample_size):
    values = []
    header = headers[index] if index < len(headers) else ""
    for row in rows[:sample_size]:
        if isinstance(row, dict):
            values.append(row.get(header, ""))
        elif isinstance(row, (list, tuple)):
            values.append(row[index] if index < len(row) else "")
        else:
            values.append("")
    return values


def non_empty(values):
    return [clean(value) for value in values if clean(value)]


def ratio(count, total):
    return (count / total) if total else 0.0


def summarize_mpn_signal(results):
    if not results:
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
        "sample_size": len(results),
        "average_score": round(mean(scores), 4),
        "manufacturer_context_rate": round(manufacturer_context_rate, 4),
        "label_rate": round(label_rate, 4),
        "numeric_identifier_rate": round(numeric_identifier_rate, 4),
        "document_context_rate": round(document_context_rate, 4),
        "exact_lookup_rate": round(exact_lookup_rate, 4),
        "generic_spec_rate": round(generic_spec_rate, 4),
    }


def summarize_manufacturer_signal(results):
    if not results:
        return {"score": 0.0, "match_rate": 0.0, "sample_size": 0}
    scores = [result["score"] for result in results]
    match_rate = sum(1 for score in scores if score >= 0.75) / len(scores)
    return {
        "score": round((mean(scores) * 0.55) + (match_rate * 0.45), 4),
        "match_rate": round(match_rate, 4),
        "sample_size": len(results),
    }


def is_numeric_like(value):
    text = clean(value).replace(",", "")
    return bool(re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text))


def number_value(value):
    try:
        return float(clean(value).replace(",", ""))
    except Exception:
        return None


def is_quantity_token(value):
    return norm_token(value) in {"AR", "A R", "AS REQUIRED", "REF", "DNP", "DNI"}


def numeric_profile(values):
    samples = non_empty(values)
    total = len(samples)
    numbers = [number_value(value) for value in samples if is_numeric_like(value)]
    numeric_rate = ratio(len(numbers), total)
    special_rate = ratio(sum(1 for value in samples if is_quantity_token(value)), total)
    unique_rate = ratio(len({clean(value).upper() for value in samples}), total)
    long_numeric_rate = ratio(sum(1 for value in samples if re.fullmatch(r"\d{6,}", clean(value))), total)
    small_number_rate = ratio(sum(1 for number in numbers if abs(number) <= 1000), len(numbers))
    decimal_rate = ratio(sum(1 for number in numbers if not float(number).is_integer()), len(numbers))
    low_level_rate = ratio(sum(1 for number in numbers if float(number).is_integer() and 0 <= number <= 20), len(numbers))
    sequence_hits = 0
    if len(numbers) >= 3:
        sequence_hits = sum(
            1 for idx in range(1, len(numbers))
            if numbers[idx] == numbers[idx - 1] + 1
        )
    monotonic_sequence_rate = ratio(sequence_hits, max(len(numbers) - 1, 1))
    hierarchy_transitions = 0
    if len(numbers) >= 3:
        for idx in range(1, len(numbers)):
            delta = numbers[idx] - numbers[idx - 1]
            if abs(delta) <= 1:
                hierarchy_transitions += 1
    hierarchy_rate = ratio(hierarchy_transitions, max(len(numbers) - 1, 1))
    dotted_level_rate = ratio(sum(1 for value in samples if re.fullmatch(r"\d+(?:\.\d+){1,5}", clean(value))), total)
    return {
        "sample_size": total,
        "numeric_rate": round(numeric_rate, 4),
        "special_quantity_rate": round(special_rate, 4),
        "unique_rate": round(unique_rate, 4),
        "long_numeric_rate": round(long_numeric_rate, 4),
        "small_number_rate": round(small_number_rate, 4),
        "decimal_rate": round(decimal_rate, 4),
        "low_level_rate": round(low_level_rate, 4),
        "monotonic_sequence_rate": round(monotonic_sequence_rate, 4),
        "hierarchy_rate": round(hierarchy_rate, 4),
        "dotted_level_rate": round(dotted_level_rate, 4),
    }


def score_quantity_column(header, values):
    profile = numeric_profile(values)
    header_score = header_support(header, "quantity")
    level_header_score = header_support(header, "level")
    value_score = (
        profile["numeric_rate"] * 0.45
        + profile["small_number_rate"] * 0.20
        + profile["special_quantity_rate"] * 0.15
        + profile["decimal_rate"] * 0.10
        + (1.0 - profile["unique_rate"]) * 0.10
    )
    sequence_penalty_weight = 0.05 if header_score >= 0.78 else 0.25
    low_level_penalty_weight = 0.05 if header_score >= 0.78 else 0.20
    penalty = (
        profile["long_numeric_rate"] * 0.45
        + profile["monotonic_sequence_rate"] * sequence_penalty_weight
        + max(0.0, profile["low_level_rate"] - 0.75) * low_level_penalty_weight
    )
    score = clamp((value_score * 0.80) + (header_score * 0.20) - penalty)
    if level_header_score and not header_score:
        score = min(score, 0.45)
    if is_percent_or_cost_header(header):
        score = min(score, 0.25)
    reasons = []
    if profile["numeric_rate"] >= 0.7:
        reasons.append("mostly numeric values")
    if header_score:
        reasons.append("quantity-like header")
    if profile["long_numeric_rate"] >= 0.35:
        reasons.append("long numeric identifiers")
    if profile["monotonic_sequence_rate"] >= 0.8:
        reasons.append("line-number-like sequence")
    return score, reasons, profile


def score_level_column(header, values):
    profile = numeric_profile(values)
    header_score = header_support(header, "level")
    value_score = (
        profile["low_level_rate"] * 0.40
        + profile["hierarchy_rate"] * 0.25
        + profile["dotted_level_rate"] * 0.25
        + (1.0 - profile["unique_rate"]) * 0.10
    )
    penalty = profile["monotonic_sequence_rate"] * 0.40 + profile["decimal_rate"] * 0.25
    score = clamp((value_score * 0.80) + (header_score * 0.20) - penalty)
    if is_percent_or_cost_header(header):
        score = min(score, 0.25)
    if profile["unique_rate"] <= 0.05 and not header_score:
        score = min(score, 0.25)
    reasons = []
    if header_score:
        reasons.append("level-like header")
    if profile["hierarchy_rate"] >= 0.7:
        reasons.append("hierarchical numeric sequence")
    if profile["dotted_level_rate"] >= 0.2:
        reasons.append("dotted hierarchy values")
    if profile["monotonic_sequence_rate"] >= 0.8:
        reasons.append("line-number-like sequence")
    return score, reasons, profile


def line_number_score(header, values):
    profile = numeric_profile(values)
    header_score = 1.0 if re.search(r"\b(item|line|sr|s no|pos|position|no)\b", norm_header(header)) else 0.0
    return clamp(profile["monotonic_sequence_rate"] * 0.75 + header_score * 0.25)


def uom_value(value):
    token = norm_token(value)
    if token in UOM_TOKENS:
        canonical, category = UOM_TOKENS[token]
        return {
            "score": 0.85 if token in AMBIGUOUS_UOM_TOKENS else 1.0,
            "matched": True,
            "canonical": canonical,
            "category": category,
            "ambiguous": token in AMBIGUOUS_UOM_TOKENS,
        }
    return {"score": 0.0, "matched": False, "canonical": "", "category": "", "ambiguous": False}


def score_uom_column(header, values, quantity_index=None, index=None, manufacturer_results=None):
    samples = non_empty(values)
    total = len(samples)
    header_score = header_support(header, "uom")
    results = [uom_value(value) for value in samples]
    match_rate = ratio(sum(1 for result in results if result["matched"]), total)
    ambiguous_rate = ratio(sum(1 for result in results if result["ambiguous"]), total)
    short_rate = ratio(sum(1 for value in samples if len(clean(value)) <= 8), total)
    unique_rate = ratio(len({norm_token(value) for value in samples}), total)
    manufacturer_matches = manufacturer_results if manufacturer_results is not None else [
        score_manufacturer_value(value) for value in samples
    ]
    manufacturer_rate = ratio(
        sum(1 for result in manufacturer_matches if result.get("matched")),
        len(manufacturer_matches),
    )
    adjacency = 1.0 if quantity_index is not None and index is not None and abs(index - quantity_index) <= 1 else 0.0
    value_score = match_rate * 0.60 + short_rate * 0.10 + (1.0 - unique_rate) * 0.15 + adjacency * 0.15
    penalty = manufacturer_rate * (0.04 if header_score >= 0.78 else 0.40)
    if ambiguous_rate > 0.5 and not header_score and not adjacency:
        penalty += 0.25
    score = clamp((value_score * 0.75) + (header_score * 0.25) - penalty)
    reasons = []
    if match_rate:
        reasons.append("known UOM values")
    if header_score:
        reasons.append("UOM-like header")
    if adjacency:
        reasons.append("adjacent to quantity column")
    if ambiguous_rate:
        reasons.append("ambiguous short UOM tokens")
    if manufacturer_rate:
        reasons.append("manufacturer alias conflict")
    return score, reasons, {
        "sample_size": total,
        "uom_match_rate": round(match_rate, 4),
        "ambiguous_uom_rate": round(ambiguous_rate, 4),
        "manufacturer_match_rate": round(manufacturer_rate, 4),
        "unique_rate": round(unique_rate, 4),
    }


def words(value):
    return re.findall(r"[A-Z0-9]+", clean(value).upper())


def component_word_rate(samples):
    return ratio(sum(1 for value in samples if any(word in COMPONENT_WORDS for word in words(value))), len(samples))


def note_word_rate(samples, internal=False):
    word_set = NOTE_WORDS | (INTERNAL_NOTE_WORDS if internal else set())
    return ratio(sum(1 for value in samples if any(word in word_set for word in words(value))), len(samples))


def spec_token_rate(samples):
    return ratio(sum(
        1 for value in samples
        if re.search(r"\b\d+(?:\.\d+)?\s*(?:R|K|M|OHM|PF|NF|UF|MF|V|KV|W|MM|CM)\b", clean(value).upper())
    ), len(samples))


def designator_like_rate(samples):
    return ratio(sum(1 for value in samples if re.fullmatch(r"[A-Z]{1,3}\d{1,5}[A-Z]?", clean(value).upper())), len(samples))


def item_name_like_rate(samples):
    return ratio(sum(
        1 for value in samples
        if (
            2 <= len(clean(value)) <= 80
            and not is_numeric_like(value)
            and (
                "_" in clean(value)
                or "-" in clean(value)
                or designator_like_rate([value]) > 0
                or 1 <= len(words(value)) <= 4
            )
        )
    ), len(samples))


def formula_or_link_like_rate(samples):
    return ratio(sum(
        1 for value in samples
        if re.search(r"(https?://|www\.|^=?\s*hyperlink\b|^exte\s*\()", clean(value), re.IGNORECASE)
    ), len(samples))


def descriptive_phrase_rate(samples):
    hits = 0
    for value in samples:
        text = clean(value)
        if not (3 <= len(text) <= 120):
            continue
        if is_numeric_like(text):
            continue
        if re.search(r"(https?://|www\.|^=?\s*hyperlink\b|^exte\s*\()", text, re.IGNORECASE):
            continue
        token_words = words(text)
        if not any(re.search(r"[A-Z]", word) for word in token_words):
            continue
        if len(token_words) >= 2 and len(token_words) <= 12:
            hits += 1
            continue
        if re.search(r"[A-Za-z]{2,}\s*/\s*[A-Za-z]{2,}", text):
            hits += 1
    return ratio(hits, len(samples))


def score_description_column(header, values, mpn_results=None, manufacturer_results=None):
    samples = non_empty(values)
    total = len(samples)
    if not total:
        return 0.0, [], {"sample_size": 0, "fill_rate": 0.0, "subtype": ""}
    source_count = len(values or [])
    fill_rate = ratio(total, source_count)
    header_score = header_support(header, "description")
    item_header_score = 1.0 if is_item_name_header(header) else 0.0
    identifier_header = is_identifier_header(header)
    component_rate = component_word_rate(samples)
    spec_rate = spec_token_rate(samples)
    item_rate = item_name_like_rate(samples)
    designator_rate = designator_like_rate(samples)
    phrase_rate = descriptive_phrase_rate(samples)
    link_rate = formula_or_link_like_rate(samples)
    unique_rate = ratio(len({clean(value).upper() for value in samples}), total)
    diversity_score = clamp((unique_rate - 0.15) / 0.55)
    avg_words = mean([len(words(value)) for value in samples])
    prose_rate = ratio(sum(1 for value in samples if len(words(value)) >= 3), total)
    mpn_matches = mpn_results if mpn_results is not None else [
        score_mpn_value(value) for value in samples
    ]
    manufacturer_matches = manufacturer_results if manufacturer_results is not None else [
        score_manufacturer_value(value) for value in samples
    ]
    mpn_rate = ratio(sum(1 for result in mpn_matches if result.get("matched")), len(mpn_matches))
    mfr_rate = ratio(
        sum(1 for result in manufacturer_matches if result.get("matched")),
        len(manufacturer_matches),
    )
    content_score = max(component_rate, spec_rate, prose_rate, item_rate, designator_rate, phrase_rate)
    population_score = min(1.0, fill_rate / 0.55)
    technical_score = (
        component_rate * 0.26
        + spec_rate * 0.22
        + prose_rate * 0.18
        + header_score * 0.16
        + population_score * 0.18
    )
    item_score = (
        item_rate * 0.26
        + designator_rate * 0.14
        + max(header_score, item_header_score) * 0.28
        + (1.0 if avg_words <= 4 else 0.0) * 0.06
        + population_score * 0.26
    )
    phrase_score = (
        phrase_rate * 0.38
        + population_score * 0.23
        + diversity_score * 0.22
        + prose_rate * 0.12
        + header_score * 0.05
    )
    conflict_penalty = 0.0 if item_header_score else (mpn_rate * 0.35 + mfr_rate * 0.25)
    score = clamp(max(technical_score, item_score, phrase_score) - conflict_penalty - (link_rate * 0.40))
    if header_score >= 1.0 and fill_rate >= 0.50 and content_score >= 0.35:
        score = max(score, 0.86)
    elif header_score >= 0.78 and fill_rate >= 0.50 and content_score >= 0.35:
        score = max(score, 0.72)
    if fill_rate < 0.08:
        score = min(score, 0.35)
    elif fill_rate < 0.18:
        score = min(score, 0.45 if content_score < 0.75 else 0.55)
    elif fill_rate < 0.35 and content_score < 0.65:
        score = min(score, 0.55)
    if unique_rate < 0.15 and not header_score and prose_rate < 0.45:
        score = min(score, 0.45)
    if identifier_header:
        score = min(score, 0.25)
    if total < 4 and unique_rate <= 0.5:
        score = min(score, 0.45)
    subtype = "technical_description" if technical_score >= max(item_score, phrase_score) else "item_name"
    reasons = []
    if header_score:
        reasons.append("description/item-name header")
    if fill_rate < 0.35:
        reasons.append("mostly blank column")
    if component_rate:
        reasons.append("component words")
    if spec_rate:
        reasons.append("technical spec tokens")
    if item_rate:
        reasons.append("item-name-like values")
    if phrase_rate:
        reasons.append("descriptive text values")
    if unique_rate < 0.15:
        reasons.append("repeated values")
    if link_rate:
        reasons.append("link/formula conflict")
    if identifier_header:
        reasons.append("identifier header conflict")
    if mpn_rate:
        reasons.append("MPN conflict")
    return score, reasons, {
        "sample_size": total,
        "fill_rate": round(fill_rate, 4),
        "component_word_rate": round(component_rate, 4),
        "spec_token_rate": round(spec_rate, 4),
        "item_name_rate": round(item_rate, 4),
        "designator_rate": round(designator_rate, 4),
        "descriptive_phrase_rate": round(phrase_rate, 4),
        "link_formula_rate": round(link_rate, 4),
        "unique_rate": round(unique_rate, 4),
        "diversity_score": round(diversity_score, 4),
        "identifier_header": identifier_header,
        "subtype": subtype,
    }


def score_notes_column(header, values, internal=False, mpn_results=None):
    samples = non_empty(values)
    total = len(samples)
    if not total:
        return 0.0, [], {"sample_size": 0}
    header_score = header_support(header, "internalNotes" if internal else "notes")
    note_rate = note_word_rate(samples, internal=internal)
    sentence_rate = ratio(sum(1 for value in samples if len(words(value)) >= 4), total)
    sparse_bonus = 1.0 if total <= max(4, len(values) * 0.5) else 0.0
    description_conflict = component_word_rate(samples)
    mpn_matches = mpn_results if mpn_results is not None else [
        score_mpn_value(value) for value in samples
    ]
    identifier_conflict = ratio(sum(1 for result in mpn_matches if result.get("matched")), len(mpn_matches))
    score = clamp(
        header_score * 0.35
        + note_rate * 0.30
        + sentence_rate * 0.20
        + sparse_bonus * 0.15
        - description_conflict * 0.20
        - identifier_conflict * 0.25
    )
    reasons = []
    if header_score:
        reasons.append("notes-like header")
    if note_rate:
        reasons.append("instruction/status words")
    if sparse_bonus:
        reasons.append("sparse comment column")
    return score, reasons, {
        "sample_size": total,
        "note_word_rate": round(note_rate, 4),
        "sentence_rate": round(sentence_rate, 4),
    }


def identifier_like_rate(samples):
    return ratio(sum(
        1 for value in samples
        if (
            3 <= len(clean(value)) <= 60
            and re.search(r"[A-Za-z0-9]", clean(value))
            and len(words(value)) <= 4
        )
    ), len(samples))


def score_cpn_column(header, values, mpn_signal=None, has_strong_mpn=False):
    samples = non_empty(values)
    total = len(samples)
    if not total:
        return 0.0, [], {"sample_size": 0, "fill_rate": 0.0}
    source_count = len(values or [])
    fill_rate = ratio(total, source_count)
    header_score = header_support(header, "cpn")
    if norm_header(header) == "item code":
        header_score = 1.0
    id_rate = identifier_like_rate(samples)
    unique_rate = ratio(len({clean(value).upper() for value in samples}), total)
    exact_lookup_rate = (mpn_signal or {}).get("exact_lookup_rate", 0.0)
    mpn_match_rate = (mpn_signal or {}).get("match_rate", 0.0)
    manufacturer_context_rate = (mpn_signal or {}).get("manufacturer_context_rate", 0.0)
    mpn_dominance = exact_lookup_rate * 0.35 + manufacturer_context_rate * 0.25
    population_score = min(1.0, fill_rate / 0.45)
    support = 0.20 if has_strong_mpn and fill_rate >= 0.25 else 0.0
    score = clamp(
        id_rate * 0.24
        + header_score * 0.36
        + unique_rate * 0.10
        + population_score * 0.10
        + support
        - mpn_dominance
    )
    if fill_rate < 0.08:
        score = min(score, 0.25)
    elif fill_rate < 0.18:
        score = min(score, 0.40)
    elif fill_rate < 0.35 and header_score < 0.78:
        score = min(score, 0.50)
    reasons = []
    if header_score:
        reasons.append("customer/internal part header")
    if fill_rate < 0.35:
        reasons.append("mostly blank column")
    if id_rate:
        reasons.append("identifier-like values")
    if has_strong_mpn:
        reasons.append("separate strong MPN column present")
    if exact_lookup_rate or manufacturer_context_rate:
        reasons.append("MPN conflict")
    return score, reasons, {
        "sample_size": total,
        "fill_rate": round(fill_rate, 4),
        "identifier_rate": round(id_rate, 4),
        "unique_rate": round(unique_rate, 4),
        "mpn_match_rate": round(mpn_match_rate, 4),
        "exact_lookup_rate": round(exact_lookup_rate, 4),
        "manufacturer_context_rate": round(manufacturer_context_rate, 4),
    }


def score_parent_column(header, values, cpn_candidate_rate=0.0):
    samples = non_empty(values)
    total = len(samples)
    if not total:
        return 0.0, [], {"sample_size": 0}
    if norm_header(header) == "parentkey":
        return 0.0, ["generated parentKey column"], {"sample_size": total}
    header_score = header_support(header, "parent")
    unique_rate = ratio(len({clean(value).upper() for value in samples}), total)
    repeated_rate = 1.0 - unique_rate
    id_rate = identifier_like_rate(samples)
    score = clamp(repeated_rate * 0.35 + id_rate * 0.25 + header_score * 0.25 - cpn_candidate_rate * 0.10)
    reasons = []
    if header_score:
        reasons.append("parent/group header")
    if repeated_rate:
        reasons.append("repeated group values")
    if id_rate:
        reasons.append("identifier-like parent values")
    return score, reasons, {
        "sample_size": total,
        "repeated_rate": round(repeated_rate, 4),
        "identifier_rate": round(id_rate, 4),
    }


def values_for_indices(values, indices):
    return [values[index] if index < len(values) else "" for index in indices]


def detect_primary_row_anchor(headers, rows, profiles, column_values_by_index, sample_size):
    total_rows = min(len(rows or []), sample_size)
    if total_rows < 3:
        return None

    candidates = []
    for profile in profiles:
        header = profile["header"]
        score = profile["scores"].get("cpn", 0.0)
        header_score = header_support(header, "cpn")
        if score < 0.55 and header_score < 0.78:
            continue
        if profile["scores"].get("mpn", 0.0) >= 0.75 or profile["scores"].get("manufacturer", 0.0) >= 0.75:
            continue
        values = column_values_by_index.get(profile["index"], [])
        indices = [idx for idx, value in enumerate(values) if clean(value)]
        if len(indices) < 3:
            continue
        density = ratio(len(indices), total_rows)
        candidates.append({
            "index": profile["index"],
            "header": header,
            "indices": indices,
            "density": density,
            "score": score + (header_score * 0.25),
        })

    if not candidates:
        return None
    candidates.sort(key=lambda item: (item["score"], item["density"]), reverse=True)
    return candidates[0]


def apply_primary_row_context(headers, rows, profiles, column_values_by_index, anchor, sample_size, cached_mpn_score, cached_manufacturer_score):
    if not anchor:
        return
    anchor_indices = anchor.get("indices") or []
    if len(anchor_indices) < 3:
        return

    anchor_profile = next(
        (profile for profile in profiles if profile["index"] == anchor.get("index")),
        None,
    )
    if anchor_profile:
        anchor_values = values_for_indices(
            column_values_by_index.get(anchor_profile["index"], []),
            anchor_indices,
        )
        cpn_score, cpn_reasons, cpn_profile = score_cpn_column(
            anchor_profile["header"],
            anchor_values,
            mpn_signal=anchor_profile["signals"].get("mpn"),
            has_strong_mpn=False,
        )
        if cpn_score > anchor_profile["scores"].get("cpn", 0.0):
            anchor_profile["scores"]["cpn"] = cpn_score
            anchor_profile["signals"]["cpn"] = {
                **cpn_profile,
                "primary_row_anchor": anchor["header"],
                "primary_row_fill_rate": 1.0,
            }
            anchor_profile["reasons"]["cpn"] = list(dict.fromkeys(
                cpn_reasons + ["primary row anchor"]
            ))

    quantity_index = max(
        range(len(profiles)),
        key=lambda idx: profiles[idx]["scores"].get("quantity", 0.0),
        default=None,
    )
    if quantity_index is not None and profiles[quantity_index]["scores"].get("quantity", 0.0) < 0.50:
        quantity_index = None

    for profile in profiles:
        header = profile["header"]
        is_blocked_context_column = (
            profile["index"] == anchor.get("index")
            or is_non_bom_role_header(header)
            or is_visual_or_boolean_flag_header(header)
            or is_identifier_header(header)
        )
        values = column_values_by_index.get(profile["index"])
        if values is None:
            values = column_values(headers, rows, profile["index"], sample_size)
            column_values_by_index[profile["index"]] = values
        anchored_values = values_for_indices(values, anchor_indices)
        anchored_samples = non_empty(anchored_values)
        if len(anchored_samples) < 3:
            continue
        anchor_fill_rate = ratio(len(anchored_samples), len(anchor_indices))
        if anchor_fill_rate < 0.45:
            continue

        mpn_results = [cached_mpn_score(value) for value in anchored_samples[:VALUE_SIGNAL_SAMPLE_SIZE]]
        manufacturer_results = [
            cached_manufacturer_score(value)
            for value in anchored_samples[:VALUE_SIGNAL_SAMPLE_SIZE]
        ]

        quantity_score, quantity_reasons, quantity_profile = score_quantity_column(
            header,
            anchored_samples,
        )
        if (
            not is_blocked_context_column
            and not header_support(header, "level")
            and quantity_score > profile["scores"].get("quantity", 0.0)
        ):
            profile["scores"]["quantity"] = quantity_score
            profile["signals"]["quantity"] = {
                **quantity_profile,
                "primary_row_anchor": anchor["header"],
                "primary_row_fill_rate": round(anchor_fill_rate, 4),
            }
            profile["reasons"]["quantity"] = list(dict.fromkeys(
                quantity_reasons + ["matches primary rows"]
            ))

        description_score, description_reasons, description_profile = score_description_column(
            header,
            anchored_values,
            mpn_results=mpn_results,
            manufacturer_results=manufacturer_results,
        )
        if not is_blocked_context_column and description_score > profile["scores"].get("description", 0.0):
            profile["scores"]["description"] = description_score
            profile["signals"]["description"] = {
                **description_profile,
                "primary_row_anchor": anchor["header"],
                "primary_row_fill_rate": round(anchor_fill_rate, 4),
            }
            profile["reasons"]["description"] = list(dict.fromkeys(
                description_reasons + ["matches primary rows"]
            ))

        uom_score, uom_reasons, uom_profile = score_uom_column(
            header,
            anchored_values,
            quantity_index=quantity_index,
            index=profile["index"],
            manufacturer_results=manufacturer_results,
        )
        if not is_blocked_context_column and uom_score > profile["scores"].get("uom", 0.0):
            profile["scores"]["uom"] = uom_score
            profile["signals"]["uom"] = {
                **uom_profile,
                "primary_row_anchor": anchor["header"],
                "primary_row_fill_rate": round(anchor_fill_rate, 4),
            }
            profile["reasons"]["uom"] = list(dict.fromkeys(
                uom_reasons + ["matches primary rows"]
            ))


def apply_detail_row_mpn_mfr_context(headers, rows, profiles, column_values_by_index, anchor, sample_size, cached_mpn_score, cached_manufacturer_score):
    if not anchor:
        return
    total_rows = min(len(rows or []), sample_size)
    anchor_indices = set(anchor.get("indices") or [])
    detail_indices = [index for index in range(total_rows) if index not in anchor_indices]
    if len(detail_indices) < 3:
        return

    for profile in profiles:
        header = profile["header"]
        if (
            profile["index"] == anchor.get("index")
            or header_support(header, "uom")
            or header_support(header, "quantity")
            or header_support(header, "level")
            or is_non_bom_role_header(header)
            or is_visual_or_boolean_flag_header(header)
            or is_identifier_header(header)
        ):
            continue

        values = column_values_by_index.get(profile["index"])
        if values is None:
            values = column_values(headers, rows, profile["index"], sample_size)
            column_values_by_index[profile["index"]] = values
        detail_values = values_for_indices(values, detail_indices)
        detail_samples = non_empty(detail_values)
        if len(detail_samples) < 3:
            continue

        mpn_results = [cached_mpn_score(value) for value in detail_samples[:VALUE_SIGNAL_SAMPLE_SIZE]]
        manufacturer_results = [
            cached_manufacturer_score(value)
            for value in detail_samples[:VALUE_SIGNAL_SAMPLE_SIZE]
        ]
        paired_hits = sum(
            1
            for mpn_result, manufacturer_result in zip(mpn_results, manufacturer_results)
            if mpn_result.get("matched") and manufacturer_result.get("matched")
        )
        mpn_hits = sum(1 for result in mpn_results if result.get("matched"))
        manufacturer_hits = sum(1 for result in manufacturer_results if result.get("matched"))
        total = len(detail_samples[:VALUE_SIGNAL_SAMPLE_SIZE])
        paired_rate = ratio(paired_hits, total)
        mpn_rate = ratio(mpn_hits, total)
        manufacturer_rate = ratio(manufacturer_hits, total)
        if paired_hits < 2 or paired_rate < 0.08:
            continue

        boosted_score = round(min(0.92, 0.66 + paired_rate * 0.60 + min(mpn_rate, manufacturer_rate) * 0.20), 4)
        profile["scores"]["mpn"] = max(profile["scores"].get("mpn", 0.0), boosted_score)
        profile["scores"]["manufacturer"] = max(profile["scores"].get("manufacturer", 0.0), boosted_score)
        profile["signals"]["mpn"] = {
            **profile["signals"].get("mpn", {}),
            "detail_row_packed_rate": round(paired_rate, 4),
            "detail_row_packed_count": paired_hits,
            "detail_row_packed_score": boosted_score,
            "detail_row_mpn_rate": round(mpn_rate, 4),
            "detail_row_manufacturer_rate": round(manufacturer_rate, 4),
            "detail_row_anchor": anchor["header"],
        }
        profile["signals"]["manufacturer"] = {
            **profile["signals"].get("manufacturer", {}),
            "detail_row_packed_rate": round(paired_rate, 4),
            "detail_row_packed_count": paired_hits,
            "detail_row_packed_score": boosted_score,
            "detail_row_mpn_rate": round(mpn_rate, 4),
            "detail_row_manufacturer_rate": round(manufacturer_rate, 4),
            "detail_row_anchor": anchor["header"],
        }
        profile["reasons"].setdefault("mpn", []).append("MPN/manufacturer pairs in detail rows")
        profile["reasons"].setdefault("manufacturer", []).append("MPN/manufacturer pairs in detail rows")


def build_column_profiles(headers, rows, sample_size=250):
    profiles = []
    column_values_by_index = {}
    mpn_value_cache = {}
    manufacturer_value_cache = {}

    def cached_mpn_score(value):
        key = clean(value)
        if key not in mpn_value_cache:
            mpn_value_cache[key] = score_mpn_value(key)
        return mpn_value_cache[key]

    def cached_manufacturer_score(value):
        key = clean(value)
        if key not in manufacturer_value_cache:
            manufacturer_value_cache[key] = score_manufacturer_value(key)
        return manufacturer_value_cache[key]

    for index, header in enumerate(headers):
        values = column_values(headers, rows, index, sample_size)
        column_values_by_index[index] = values
        samples = non_empty(values)
        boolean_profile = boolean_like_profile(samples)
        value_signal_samples = samples[:VALUE_SIGNAL_SAMPLE_SIZE]
        mpn_results = [cached_mpn_score(value) for value in value_signal_samples]
        manufacturer_results = [cached_manufacturer_score(value) for value in value_signal_samples]
        mpn_signal = summarize_mpn_signal(mpn_results)
        manufacturer_signal = summarize_manufacturer_signal(manufacturer_results)
        quantity_score, quantity_reasons, quantity_profile = score_quantity_column(header, samples)
        level_score, level_reasons, level_profile = score_level_column(header, samples)
        line_score = line_number_score(header, samples)
        description_score, description_reasons, description_profile = score_description_column(
            header,
            values,
            mpn_results=mpn_results,
            manufacturer_results=manufacturer_results,
        )
        notes_score, notes_reasons, notes_profile = score_notes_column(
            header,
            values,
            internal=False,
            mpn_results=mpn_results,
        )
        internal_notes_score, internal_notes_reasons, internal_notes_profile = score_notes_column(
            header,
            values,
            internal=True,
            mpn_results=mpn_results,
        )
        parent_score, parent_reasons, parent_profile = score_parent_column(header, samples)
        mpn_role_score = clamp(mpn_signal["score"] * 0.90 + header_support(header, "mpn") * 0.10)
        if mpn_signal.get("exact_lookup_rate", 0.0) >= 0.50 and mpn_signal.get("match_rate", 0.0) >= 0.70:
            mpn_role_score = max(mpn_role_score, 0.75)
        manufacturer_role_score = clamp(manufacturer_signal["score"] * 0.90 + header_support(header, "manufacturer") * 0.10)
        scores = {
            "mpn": mpn_role_score,
            "manufacturer": manufacturer_role_score,
            "quantity": quantity_score,
            "level": level_score,
            "description": description_score,
            "notes": notes_score,
            "internalNotes": internal_notes_score,
            "parent": parent_score,
        }
        if is_specification_pair_header(header):
            for role in ("mpn", "manufacturer", "description", "parent"):
                scores[role] = min(scores[role], 0.45)
        if is_non_bom_role_header(header):
            for role in ("mpn", "manufacturer", "cpn", "description", "quantity", "uom", "level", "parent", "notes", "internalNotes"):
                if role in scores:
                    scores[role] = min(scores[role], 0.45)
        if is_percent_or_cost_header(header) or header_support(header, "uom"):
            scores["parent"] = min(scores["parent"], 0.25)
        if is_description_or_observation_header(header):
            scores["mpn"] = min(scores["mpn"], 0.30)
            scores["manufacturer"] = min(scores["manufacturer"], 0.30)
            scores["cpn"] = min(scores.get("cpn", 0.0), 0.30)
        level_header_score = header_support(header, "level")
        preserve_level = (
            level_header_score
            and level_profile.get("numeric_rate", 0.0) >= 0.75
            and (
                level_profile.get("hierarchy_rate", 0.0) >= 0.50
                or level_profile.get("low_level_rate", 0.0) >= 0.90
            )
        )
        if is_visual_or_boolean_flag_header(header) or boolean_profile["boolean_like"]:
            blocked_roles = ["mpn", "manufacturer", "cpn", "description", "quantity", "uom", "parent"]
            if not preserve_level:
                blocked_roles.append("level")
            for role in blocked_roles:
                if role in scores:
                    scores[role] = min(scores[role], 0.10)
        profiles.append({
            "index": index,
            "header": clean(header),
            "sampleSize": len(samples),
            "scores": scores,
            "signals": {
                "mpn": mpn_signal,
                "manufacturer": manufacturer_signal,
                "booleanFlag": boolean_profile,
                "quantity": quantity_profile,
                "level": level_profile,
                "lineNumberScore": round(line_score, 4),
                "description": description_profile,
                "notes": notes_profile,
                "internalNotes": internal_notes_profile,
                "parent": parent_profile,
            },
            "reasons": {
                "quantity": quantity_reasons,
                "level": level_reasons,
                "description": description_reasons,
                "notes": notes_reasons,
                "internalNotes": internal_notes_reasons,
                "parent": parent_reasons,
            },
        })

    has_strong_mpn = any(profile["scores"]["mpn"] >= 0.75 for profile in profiles)
    quantity_index = max(
        range(len(profiles)),
        key=lambda idx: profiles[idx]["scores"]["quantity"],
        default=None,
    )
    if quantity_index is not None and profiles[quantity_index]["scores"]["quantity"] < 0.65:
        quantity_index = None

    for profile in profiles:
        values = column_values(headers, rows, profile["index"], sample_size)
        cpn_score, cpn_reasons, cpn_profile = score_cpn_column(
            profile["header"],
            values,
            mpn_signal=profile["signals"]["mpn"],
            has_strong_mpn=has_strong_mpn and profile["scores"]["mpn"] < 0.75,
        )
        uom_score, uom_reasons, uom_profile = score_uom_column(
            profile["header"],
            values,
            quantity_index=quantity_index,
            index=profile["index"],
            manufacturer_results=[
                cached_manufacturer_score(value)
                for value in non_empty(values)[:VALUE_SIGNAL_SAMPLE_SIZE]
            ],
        )
        profile["scores"]["cpn"] = cpn_score
        profile["scores"]["uom"] = uom_score
        if is_specification_pair_header(profile["header"]):
            profile["scores"]["cpn"] = min(profile["scores"]["cpn"], 0.45)
        if is_non_bom_role_header(profile["header"]):
            for role in ("cpn", "uom"):
                profile["scores"][role] = min(profile["scores"].get(role, 0.0), 0.10)
        if is_description_or_observation_header(profile["header"]):
            profile["scores"]["cpn"] = min(profile["scores"]["cpn"], 0.30)
        profile["signals"]["cpn"] = cpn_profile
        profile["signals"]["uom"] = uom_profile
        profile["reasons"]["cpn"] = cpn_reasons
        profile["reasons"]["uom"] = uom_reasons

        boolean_profile = profile["signals"].get("booleanFlag", {})
        if is_visual_or_boolean_flag_header(profile["header"]) or boolean_profile.get("boolean_like"):
            level_signal = profile["signals"].get("level", {})
            preserve_level = (
                header_support(profile["header"], "level")
                and level_signal.get("numeric_rate", 0.0) >= 0.75
                and (
                    level_signal.get("hierarchy_rate", 0.0) >= 0.50
                    or level_signal.get("low_level_rate", 0.0) >= 0.90
                )
            )
            blocked_roles = ["mpn", "manufacturer", "cpn", "description", "quantity", "uom", "parent"]
            if not preserve_level:
                blocked_roles.append("level")
            for role in blocked_roles:
                profile["scores"][role] = min(profile["scores"].get(role, 0.0), 0.10)

        if profile["signals"]["lineNumberScore"] >= 0.80:
            profile["scores"]["quantity"] = min(profile["scores"]["quantity"], 0.35)
            profile["scores"]["level"] = min(profile["scores"]["level"], 0.45)
            profile["reasons"].setdefault("quantity", []).append("line-number conflict")
            profile["reasons"].setdefault("level", []).append("line-number conflict")

    anchor = detect_primary_row_anchor(headers, rows, profiles, column_values_by_index, sample_size)
    apply_primary_row_context(
        headers,
        rows,
        profiles,
        column_values_by_index,
        anchor,
        sample_size,
        cached_mpn_score,
        cached_manufacturer_score,
    )
    apply_detail_row_mpn_mfr_context(
        headers,
        rows,
        profiles,
        column_values_by_index,
        anchor,
        sample_size,
        cached_mpn_score,
        cached_manufacturer_score,
    )

    return profiles


def role_candidate(profile, role):
    score = round(profile["scores"].get(role, 0.0), 4)
    role_reasons = list(profile.get("reasons", {}).get(role, []))
    if role in {"mpn", "manufacturer"}:
        signal = profile.get("signals", {}).get(role, {})
        if signal.get("match_rate"):
            role_reasons.append("value match rate %.0f%%" % (signal["match_rate"] * 100))
        if signal.get("detail_row_packed_rate"):
            role_reasons.append("MPN/manufacturer pairs in detail rows")
        if role == "mpn" and signal.get("exact_lookup_rate"):
            role_reasons.append("backend MPN lookup hits")
    return {
        "header": profile["header"],
        "index": profile["index"],
        "score": score,
        "confidence": confidence(score),
        "reasons": list(dict.fromkeys(role_reasons)),
        "signals": profile.get("signals", {}).get(role, {}),
    }


def packed_role_score(profile):
    mpn_signal = profile.get("signals", {}).get("mpn", {})
    manufacturer_signal = profile.get("signals", {}).get("manufacturer", {})
    return max(
        mpn_signal.get("detail_row_packed_score", 0.0),
        mpn_signal.get("detail_row_packed_rate", 0.0),
        mpn_signal.get("manufacturer_context_rate", 0.0),
        min(mpn_signal.get("match_rate", 0.0), manufacturer_signal.get("match_rate", 0.0)),
    )


def resolve_roles(profiles):
    roles = {role: "" for role in ROLE_KEYS}
    role_metadata = {}
    supporting_columns = {}
    warnings = []
    candidates = {
        role: sorted(
            [role_candidate(profile, role) for profile in profiles if profile["scores"].get(role, 0.0) >= 0.35],
            key=lambda item: item["score"],
            reverse=True,
        )[:5]
        for role in ROLE_KEYS
    }

    assigned = set()

    def choose(role, min_score=0.65, allow_assigned=False):
        for candidate in candidates.get(role, []):
            if candidate["score"] < min_score:
                return None
            if allow_assigned or candidate["header"] not in assigned:
                roles[role] = candidate["header"]
                assigned.add(candidate["header"])
                return candidate
        return None

    mpn_candidate = choose("mpn", 0.65)
    manufacturer_candidate = None

    if mpn_candidate:
        mpn_profile = profiles[mpn_candidate["index"]]
        if packed_role_score(mpn_profile) >= 0.60:
            roles["manufacturer"] = mpn_candidate["header"]
            assigned.add(mpn_candidate["header"])
            role_metadata.setdefault("manufacturer", {})["packedWithMpn"] = True
            warnings.append({
                "type": "packed_roles",
                "roles": ["mpn", "manufacturer"],
                "columns": [mpn_candidate["header"]],
                "message": "MPN and manufacturer appear packed in the same source column.",
            })

    if not roles["manufacturer"]:
        manufacturer_candidate = choose("manufacturer", 0.65)

    if mpn_candidate and manufacturer_candidate and mpn_candidate["header"] != manufacturer_candidate["header"]:
        mpn_profile = profiles[mpn_candidate["index"]]
        mfr_profile = profiles[manufacturer_candidate["index"]]
        if packed_role_score(mpn_profile) >= 0.60 and mpn_candidate["score"] >= manufacturer_candidate["score"]:
            roles["manufacturer"] = mpn_candidate["header"]
            assigned.add(mpn_candidate["header"])
            role_metadata.setdefault("manufacturer", {})["packedWithMpn"] = True
            warnings.append({
                "type": "packed_roles",
                "roles": ["mpn", "manufacturer"],
                "columns": [mpn_candidate["header"]],
                "message": "MPN and manufacturer appear packed in the same source column.",
            })
        elif (
            packed_role_score(mfr_profile) >= 0.60
            and manufacturer_candidate["score"] > mpn_candidate["score"]
            and mpn_candidate["score"] < 0.75
        ):
            roles["mpn"] = manufacturer_candidate["header"]
            assigned.add(manufacturer_candidate["header"])
            role_metadata.setdefault("mpn", {})["packedWithManufacturer"] = True
            warnings.append({
                "type": "packed_roles",
                "roles": ["mpn", "manufacturer"],
                "columns": [manufacturer_candidate["header"]],
                "message": "MPN and manufacturer appear packed in the same source column.",
            })

    choose("quantity", 0.65)
    choose("uom", 0.65)
    choose("level", 0.70)
    choose("cpn", 0.60)

    description = choose("description", 0.60)
    if description:
        subtype = profiles[description["index"]].get("signals", {}).get("description", {}).get("subtype")
        if subtype:
            role_metadata.setdefault("description", {})["subtype"] = subtype
        technical = [
            candidate for candidate in candidates.get("description", [])
            if profiles[candidate["index"]].get("signals", {}).get("description", {}).get("subtype") == "technical_description"
        ]
        item_names = [
            candidate for candidate in candidates.get("description", [])
            if profiles[candidate["index"]].get("signals", {}).get("description", {}).get("subtype") == "item_name"
        ]
        if technical and item_names and technical[0]["header"] != item_names[0]["header"]:
            roles["description"] = technical[0]["header"]
            supporting_columns["itemName"] = item_names[0]["header"]
            role_metadata.setdefault("description", {})["subtype"] = "technical_description"

    choose("parent", 0.65)
    choose("notes", 0.65)
    choose("internalNotes", 0.65)

    for role, role_candidates in candidates.items():
        if not roles.get(role) and role_candidates and role_candidates[0]["score"] >= 0.50:
            warnings.append({
                "type": "low_confidence_role",
                "role": role,
                "columns": [role_candidates[0]["header"]],
                "message": f"{ROLE_LABELS[role]} has a possible match but needs review.",
            })

    return {
        "roles": roles,
        "roleMetadata": role_metadata,
        "supportingColumns": supporting_columns,
        "candidates": candidates,
        "warnings": warnings,
    }


def infer_bom_roles(headers, rows, options=None):
    options = options or {}
    safe_headers = [clean(header) for header in (headers or [])]
    if not safe_headers:
        return {
            "source": "inferred",
            "roles": {role: "" for role in ROLE_KEYS},
            "roleMetadata": {},
            "supportingColumns": {},
            "candidates": {role: [] for role in ROLE_KEYS},
            "columns": [],
            "warnings": [{"type": "empty_headers", "message": "No headers were provided."}],
        }

    started_at = perf_counter()

    try:
        sample_size = int(options.get("sampleSize") or options.get("sample_size") or 250)
    except Exception:
        sample_size = 250
    sample_size = max(25, min(sample_size, 250))
    safe_rows = rows if isinstance(rows, list) else []
    profiles = build_column_profiles(safe_headers, safe_rows, sample_size=sample_size)
    resolved = resolve_roles(profiles)
    return {
        "source": "inferred",
        "roles": resolved["roles"],
        "roleMetadata": resolved["roleMetadata"],
        "supportingColumns": resolved["supportingColumns"],
        "candidates": resolved["candidates"],
        "columns": profiles,
        "warnings": resolved["warnings"],
        "sampleSize": sample_size,
        "timings": {
            "total_ms": round((perf_counter() - started_at) * 1000, 2),
            "column_count": len(safe_headers),
            "row_count_received": len(safe_rows),
            "sample_size": sample_size,
        },
    }


def _row_cell(row, header, headers, preserve_delimiters=False):
    if not header:
        return ""
    def prepare(value):
        if preserve_delimiters:
            return str(value or "").replace("\u00a0", " ").strip()
        return clean(value)
    if isinstance(row, dict):
        return prepare(row.get(header, ""))
    if isinstance(row, list):
        try:
            index = headers.index(header)
        except ValueError:
            return ""
        return prepare(row[index] if index < len(row) else "")
    return ""


def _source_row_number(row, index, header_row_index=0):
    if isinstance(row, dict):
        for key in ("__sourceRow", "sourceRow", "Source row"):
            value = row.get(key)
            try:
                if value not in (None, ""):
                    return int(value)
            except Exception:
                pass
    return int(index) + int(header_row_index or 0) + 2


def _selected_customer_columns(headers, roles, selected_columns=None):
    allowed = set(headers or [])
    ordered = []

    def add(header):
        header = clean(header)
        if header and header in allowed and header not in ordered:
            ordered.append(header)

    for header in selected_columns or []:
        add(header)
    for role in ROLE_KEYS:
        add((roles or {}).get(role))
    return ordered


@lru_cache(maxsize=16384)
def _best_mpn_from_text(value):
    text = clean(value)
    if not text:
        return "", 0.0, ""

    # Test token candidates before accepting a whole-cell score. A packed value
    # like "M2GL010-VFG400I:MICROSEMI CORP" should return the MPN token, not the
    # whole MPN+MFR string.
    best = ("", 0.0, "")
    tokens = candidate_mpn_tokens(text)
    parts = re.split(r"[:^|;\n\r\t]+", text)
    tokens.extend(part for part in parts if part)
    for token in tokens:
        token_score = score_mpn_value(token)
        score = float(token_score.get("score") or 0)
        candidate = clean(token_score.get("candidate") or token)
        if candidate and not re.search(r"[\s:]", candidate) and any(char.isalpha() for char in candidate) and any(char.isdigit() for char in candidate):
            score = min(1.0, score + 0.35)
        if re.search(r"[\s:]", candidate):
            score = max(0.0, score - 0.35)
        if score > best[1]:
            best = (
                candidate,
                score,
                "; ".join(token_score.get("reasons") or []),
            )
    if best[0]:
        return best

    scored = score_mpn_value(text)
    candidate = clean(scored.get("candidate") or scored.get("raw_candidate"))
    if candidate:
        return candidate, float(scored.get("score") or 0), "; ".join(scored.get("reasons") or [])
    return best


@lru_cache(maxsize=16384)
def _best_manufacturer_from_text(value):
    text = clean(value)
    if not text:
        return "", 0.0, ""
    candidates = [text]
    candidates.extend(re.findall(r"\(([^()]*)\)", text))
    candidates.extend(re.split(r"[:^|;/,\n\r\t=]+", text))

    best = ("", 0.0, "")
    for candidate in candidates:
        stripped = clean(re.sub(r"\b(?:rohs|yes|no|true|false)\b|[()=]+", " ", clean(candidate), flags=re.IGNORECASE))
        if not stripped:
            continue
        scored = score_manufacturer_value(stripped)
        score = float(scored.get("score") or 0)
        manufacturer = clean(scored.get("manufacturer") or (stripped if scored.get("matched") else ""))
        if manufacturer and score > best[1]:
            best = (manufacturer, score, clean(scored.get("reason") or "manufacturer directory/value match"))
    return best


def _split_explicit_delimiter(value, delimiter):
    text = str(value or "").replace("\u00a0", " ").strip()
    delimiter = str(delimiter or "")
    if not text or not delimiter or delimiter not in text:
        return []
    return [clean(part) for part in text.split(delimiter) if not is_blankish(part)]


def _configured_field_rules(config=None):
    rules = {}
    if isinstance((config or {}).get("fieldPatternRules"), dict):
        rules.update(config.get("fieldPatternRules") or {})
    if isinstance((config or {}).get("field_pattern_rules"), dict):
        rules.update(config.get("field_pattern_rules") or {})
    active = (config or {}).get("_activeFieldPatternRule") or (config or {}).get("_active_field_pattern_rule")
    if isinstance(active, dict):
        rules["_active"] = active
    return rules


def _field_rule(config=None, value_type=""):
    rules = _configured_field_rules(config)
    active = rules.get("_active") if isinstance(rules.get("_active"), dict) else {}
    field_rules = active.get("fields") if isinstance(active.get("fields"), dict) else {}
    rule = field_rules.get(value_type) if isinstance(field_rules.get(value_type), dict) else {}

    global_splits = (config or {}).get("sameCellAlternateDelimiters") or (config or {}).get("same_cell_alternate_delimiters") or {}
    if isinstance(global_splits, dict) and global_splits.get(value_type) and not rule.get("delimiter"):
        rule = {**rule, "delimiter": global_splits.get(value_type)}

    global_prefixes = (config or {}).get("fieldPrefixStripRules") or (config or {}).get("field_prefix_strip_rules") or {}
    if isinstance(global_prefixes, dict) and isinstance(global_prefixes.get(value_type), dict):
        prefix_rule = global_prefixes.get(value_type)
        rule = {**prefix_rule, **rule}

    return rule


def _configured_delimiter(rule):
    raw_delimiter = rule.get("delimiterMode") or rule.get("delimiter_mode") or rule.get("delimiter")
    delimiter_mode = str(raw_delimiter or "").replace("\u00a0", " ").strip()
    custom_delimiter = clean(rule.get("customDelimiter") or rule.get("custom_delimiter"))
    if delimiter_mode in {"", "none", "auto"}:
        return ""
    if delimiter_mode == "custom":
        delimiter_mode = custom_delimiter
    if delimiter_mode.lower() in {"\\n", "\\\\n", "newline", "new line"} or delimiter_mode in {"\n", "\r\n"}:
        return "\n"
    return delimiter_mode


def _configured_identity_delimiters(rule):
    raw_delimiter = (
        rule.get("comboDelimiter")
        or rule.get("combo_delimiter")
        or rule.get("delimiter")
    )
    delimiter_mode = str(raw_delimiter or "").replace("\u00a0", " ").strip()
    custom_delimiter = clean(rule.get("customDelimiter") or rule.get("custom_delimiter"))
    if delimiter_mode in {"", "none", "auto"}:
        return []
    if delimiter_mode == "custom":
        delimiter_mode = custom_delimiter
    if delimiter_mode in {"colon_caret", "colon+caret", ":^"}:
        return [":", "^"]
    if delimiter_mode.lower() in {"\\n", "\\\\n", "newline", "new line"} or delimiter_mode in {"\n", "\r\n"}:
        return ["\n"]
    return [delimiter_mode] if delimiter_mode else []


def _split_identity_combo_value(value, rule):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return []
    delimiters = _configured_identity_delimiters(rule)
    if not delimiters:
        return []
    pattern = "|".join(re.escape(delimiter) for delimiter in delimiters if delimiter)
    if not pattern:
        return []
    return [clean(part) for part in re.split(pattern, text) if not is_blankish(part)]


def _looks_like_parenthesized_manufacturer_alias(value):
    text = clean(value).strip("()[]{} ")
    if is_blankish(text):
        return False

    # A leading slash marks a packaging or ordering suffix such as (/TR) or
    # (/TU/7411), not a manufacturer name. Manufacturer aliases may contain a
    # slash internally (for example VISH/SFE), so only reject edge slashes.
    if text.startswith(("/", "\\")) or text.endswith(("/", "\\")):
        return False

    # Slash-separated bracket values are often MPN suffix/packaging choices.
    # A single short token that happens to exist in the manufacturer directory
    # must not make the entire list a manufacturer (for example, EL inside a
    # seven-value suffix list). Treat the bracket as a manufacturer alias list
    # only when the directory supports at least half of its components.
    if "/" in text or "\\" in text:
        components = [clean(part) for part in re.split(r"[/\\]+", text) if clean(part)]
        if len(components) > 1:
            matched_components = 0
            for component in components:
                scored = score_manufacturer_value(component)
                if scored.get("matched") and float(scored.get("score") or 0) >= 0.65:
                    matched_components += 1
            return matched_components > 0 and matched_components * 2 >= len(components)

    manufacturer, score, _ = _best_manufacturer_from_text(text)
    if manufacturer and float(score or 0) >= 0.65:
        return True
    # Unknown prose such as ``(Tape & Reel)`` must remain unclassified.  A
    # parenthesized phrase becomes a manufacturer only when the directory has
    # evidence for it; users can teach missing aliases explicitly.
    return False


def _has_later_manufacturer_in_same_record(text, start_index):
    """Return whether a later parenthesis is the stronger MFR boundary.

    Parenthesized package, technology, or suffix values can also appear in the
    manufacturer directory. Within one record the manufacturer is the last
    directory-backed parenthesis before status/reference annotations or the
    separator that starts the next record.
    """
    source = str(text or "")
    search_start = max(0, int(start_index or 0))
    for later in re.finditer(r"\(([^()]*)\)", source[search_start:]):
        between = source[search_start:search_start + later.start()]
        if re.search(r"[\r\n;\{\[]|\s/\s", between):
            return False
        if _looks_like_parenthesized_manufacturer_alias(later.group(1)):
            return True
    return False


def _is_terminal_parenthesis_before_annotations(text, end_index):
    remainder = str(text or "")[max(0, int(end_index or 0)):]
    return bool(re.fullmatch(r"(?:\s*[\[{][^\]}]{0,80}[\]}])+\s*", remainder))


def _has_complete_identity_before_record_separator(value):
    """Require MFR evidence before treating a spaced slash as a new record."""
    text = str(value or "").strip()
    if not text:
        return False
    matches = list(re.finditer(r"\(([^()]*)\)", text))
    for match in reversed(matches):
        trailing = text[match.end():]
        trailing_is_annotations = _is_terminal_parenthesis_before_annotations(text, match.end())
        trailing_is_blank = not clean(trailing)
        manufacturer_supported = _looks_like_parenthesized_manufacturer_alias(match.group(1))
        if not trailing_is_annotations and not (trailing_is_blank and manufacturer_supported):
            continue
        mpn_text, _ignored_prefix, _source_fragment = (
            _split_mpn_fragment_before_parenthesized_manufacturer(text[:match.start()])
        )
        return bool(mpn_text)
    return False


def _identity_record_spans(text):
    """Split only on top-level separators that represent complete cell records."""
    source = str(text or "")
    spans = []
    start = 0
    depths = {"(": 0, "[": 0, "{": 0}
    closing = {")": "(", "]": "[", "}": "{"}
    index = 0
    while index < len(source):
        character = source[index]
        if character in depths:
            depths[character] += 1
        elif character in closing:
            opener = closing[character]
            depths[opener] = max(0, depths[opener] - 1)
        at_top_level = not any(depths.values())
        is_newline = character in "\r\n"
        is_semicolon = character == ";" and at_top_level
        is_spaced_slash_candidate = (
            character == "/"
            and at_top_level
            and index > 0
            and index + 1 < len(source)
            and source[index - 1].isspace()
            and source[index + 1].isspace()
        )
        is_spaced_slash = (
            is_spaced_slash_candidate
            and _has_complete_identity_before_record_separator(source[start:index])
        )
        if is_newline or is_semicolon or is_spaced_slash:
            span_start, span_end = _trim_semantic_fragment_span(source, start, index)
            if span_end > span_start:
                spans.append((span_start, span_end))
            index += 1
            if is_newline and character == "\r" and index < len(source) and source[index] == "\n":
                index += 1
            start = index
            continue
        index += 1
    span_start, span_end = _trim_semantic_fragment_span(source, start, len(source))
    if span_end > span_start:
        spans.append((span_start, span_end))
    return spans


def _skip_trailing_reference_annotations(text, start_index):
    index = start_index
    length = len(text)
    while index < length:
        whitespace = re.match(r"\s+", text[index:])
        if whitespace:
            index += whitespace.end()
        annotation = re.match(r"[\[{][^\]}]{1,80}[\]}]", text[index:])
        if not annotation:
            break
        index += annotation.end()
    return index


def _split_mpn_fragment_before_parenthesized_manufacturer(raw_text):
    raw = str(raw_text or "").replace("\u00a0", " ")
    mpn_text = clean(raw_text)
    mpn_text = clean(re.sub(r"[\[{][^\]}]{1,80}[\]}]", " ", mpn_text))
    mpn_text = mpn_text.strip(" ,;:/")
    if not mpn_text:
        return "", "", ""

    suffix_values = re.findall(r"(?:@|\s)\s*\(([^()]{2,24})\)\s*$", mpn_text)
    suffix_text = "".join(
        clean(value)
        for value in suffix_values
        if clean(value) and not re.search(r"[/\\,;|]", clean(value))
    )
    mpn_score_text = re.sub(r"(?:@|\s)\s*\([^()]{2,24}\)\s*$", "", mpn_text).strip(" @,;:/")
    if suffix_values and not suffix_text and mpn_score_text:
        return mpn_score_text, "", raw.strip()
    if suffix_text and mpn_score_text:
        base_token_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9./+\-]*", mpn_score_text))
        if base_token_count <= 2 and re.search(r"\d", mpn_score_text):
            return f"{mpn_score_text}{suffix_text}", "", raw.strip()

    candidate, score, _reason = _best_mpn_from_text(mpn_score_text or mpn_text)
    if candidate and float(score or 0) >= 0.45:
        candidate_index = mpn_text.upper().find(candidate.upper())
        if candidate_index > 0:
            prefix_match = re.search(
                r"([A-Za-z][A-Za-z0-9]{1,12}[-\u2010-\u2015])\s*$",
                mpn_text[:candidate_index],
            )
            if prefix_match:
                candidate = f"{prefix_match.group(1)}{candidate}"
        if suffix_text and not re.sub(r"[^A-Z0-9]+", "", candidate.upper()).endswith(re.sub(r"[^A-Z0-9]+", "", suffix_text.upper())):
            candidate = f"{candidate}{suffix_text}"
        if clean(candidate).upper() == mpn_text.upper():
            return candidate, "", raw.strip()
        token_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9./+\-]*", mpn_text))
        # If the span contains prose/description before the actual code, use
        # the strongest embedded MPN. Compact two-token values can be genuine
        # MPNs, so keep those intact.
        if token_count >= 3 or len(mpn_text) > len(candidate) + 12:
            start = _mpn_fragment_start(raw, candidate)
            return candidate, raw[:start].strip(), raw[start:].strip()

    return (mpn_text, "", raw.strip()) if re.search(r"\d", mpn_text) else ("", "", "")


def _mpn_fragment_start(raw_text, mpn):
    text = str(raw_text or "")
    normalized_mpn = re.sub(r"[^A-Z0-9]+", "", clean(mpn).upper())
    if not normalized_mpn:
        return 0
    best_start = 0
    for match in re.finditer(r"[A-Za-z0-9]", text):
        tail = text[match.start():]
        normalized_tail = re.sub(r"[^A-Z0-9]+", "", clean(re.sub(r"[\[{][^\]}]{1,80}[\]}]", " ", tail)).upper())
        if normalized_mpn in normalized_tail:
            best_start = match.start()
    return best_start


def _mpn_before_parenthesized_manufacturer(raw_text):
    mpn, _ignored_prefix, _source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(raw_text)
    return mpn


def _visual_base_mpn_fragment(raw_text, preserve_mpn_at=False):
    """Return the original MPN substring and its source range for visual rules."""
    raw = str(raw_text or "").replace("\u00a0", " ")
    leading_length = len(raw) - len(raw.lstrip())
    trailing_end = len(raw.rstrip())
    if trailing_end <= leading_length:
        return "", leading_length, leading_length

    trimmed = raw[leading_length:trailing_end]
    candidate, ignored_prefix, _source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(trimmed)
    if candidate and ignored_prefix:
        candidate_start = trimmed.upper().rfind(candidate.upper())
        if candidate_start < 0:
            candidate_start = _mpn_fragment_start(trimmed, candidate)
        candidate_end = candidate_start + len(candidate)
        if preserve_mpn_at and trimmed[candidate_end:candidate_end + 1] == "@":
            candidate_end += 1
        original_candidate = clean(trimmed[candidate_start:candidate_end])
        return original_candidate, leading_length + candidate_start, leading_length + candidate_end

    value_end = len(trimmed)
    if not preserve_mpn_at:
        while value_end > 0 and trimmed[value_end - 1] == "@":
            value_end -= 1
        value_end = len(trimmed[:value_end].rstrip())
    value = clean(trimmed[:value_end] if preserve_mpn_at else trimmed[:value_end].replace("@", ""))
    return value, leading_length, leading_length + value_end


def _trailing_annotation_pattern(text):
    pattern = []
    for match in re.finditer(r"[\[{][^\]}]{1,80}[\]}]", str(text or "")):
        token = "{<STATUS>}" if match.group(0).startswith("{") else "[<REF>]"
        if token not in pattern:
            pattern.append(token)
    return " ".join(pattern)


def _same_cell_parenthesized_mpn_manufacturer_pairs(value):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return []

    record_spans = _identity_record_spans(text)
    if len(record_spans) > 1:
        pairs = []
        for start, end in record_spans:
            pairs.extend(_same_cell_parenthesized_mpn_manufacturer_pairs(text[start:end]))
        return pairs

    pairs = []
    cursor = 0
    for match in re.finditer(r"\(([^()]*)\)", text):
        manufacturer = clean(match.group(1))
        is_directory_manufacturer = _looks_like_parenthesized_manufacturer_alias(manufacturer)
        is_contextual_manufacturer = _is_terminal_parenthesis_before_annotations(text, match.end())
        if not is_directory_manufacturer and not is_contextual_manufacturer:
            continue
        if _has_later_manufacturer_in_same_record(text, match.end()):
            continue

        raw_before_mfr = text[cursor:match.start()]
        mpn_text, ignored_prefix, source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(raw_before_mfr)
        if not mpn_text:
            continue
        annotation_end = _skip_trailing_reference_annotations(text, match.end())

        pairs.append({
            "mpn": mpn_text,
            "manufacturer": manufacturer,
            "_ignoredPrefix": clean(ignored_prefix),
            "_sourceFragment": clean(source_fragment),
            "_trailingPattern": _trailing_annotation_pattern(text[match.end():annotation_end]),
        })
        cursor = annotation_end

    return pairs if pairs else []


def _strip_trailing_bracket_annotations(value):
    text = clean(value)
    while True:
        next_text = clean(re.sub(r"[\(\[\{][^\)\]\}]{1,120}[\)\]\}]\s*$", "", text))
        if next_text == text:
            return text
        text = next_text


PACKED_PAIR_DELIMITERS = (":", "^", "~", "|", "=")
PACKED_ENTRY_DELIMITERS = (";", "\n", "|")


def _delimiter_name(delimiter):
    return {
        ":": "colon",
        ";": "semicolon",
        "\n": "newline",
        "|": "pipe",
        "^": "caret",
        "~": "tilde",
        "=": "equals",
        ",": "comma",
        "/": "slash",
    }.get(delimiter, clean(delimiter) or "none")


def _annotation_shape_for_text(value):
    text = str(value or "")
    shapes = []
    for open_char, close_char, token in (
        ("(", ")", "(<ANNOTATION>)"),
        ("[", "]", "[<ANNOTATION>]"),
        ("{", "}", "{<ANNOTATION>}"),
    ):
        if re.search(rf"\{open_char}[^\{close_char}]{{1,120}}\{close_char}", text):
            shapes.append(token)
    return " ".join(shapes)


def _same_cell_packed_mpn_manufacturer_pairs(value):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return []

    best = ([], {"score": 0.0})
    for entry_delimiter in PACKED_ENTRY_DELIMITERS:
        has_entry_delimiter = entry_delimiter in text
        raw_entries = [clean(part) for part in text.split(entry_delimiter) if not is_blankish(part)] if has_entry_delimiter else [text]
        if not raw_entries:
            continue
        actual_entry_delimiter = entry_delimiter if has_entry_delimiter and len(raw_entries) > 1 else ""
        for pair_delimiter in PACKED_PAIR_DELIMITERS:
            if pair_delimiter == entry_delimiter:
                continue
            pairs = []
            total_score = 0.0
            for raw_entry in raw_entries:
                if pair_delimiter not in raw_entry:
                    continue
                left, right = [clean(part) for part in raw_entry.split(pair_delimiter, 1)]
                if not left or not right:
                    continue

                right_without_annotations = _strip_trailing_bracket_annotations(right)
                left_mpn, left_mpn_score, left_mpn_reason = _best_mpn_from_text(left)
                right_mfr, right_mfr_score, right_mfr_reason = _best_manufacturer_from_text(right_without_annotations or right)
                left_mfr, left_mfr_score, left_mfr_reason = _best_manufacturer_from_text(left)
                right_mpn, right_mpn_score, right_mpn_reason = _best_mpn_from_text(right_without_annotations or right)

                if left_mpn and float(left_mpn_score or 0) >= 0.35 and right_without_annotations:
                    pairs.append({
                        "mpn": clean(left_mpn or left),
                        "manufacturer": clean(right_without_annotations),
                        "_sourceFragment": raw_entry,
                        "_pairDelimiter": pair_delimiter,
                        "_entryDelimiter": actual_entry_delimiter,
                        "_mpnMethod": f"Same-cell MPN/MFR pair: value before {_delimiter_name(pair_delimiter)}",
                        "_mpnScore": min(1.0, float(left_mpn_score or 0) + 0.20),
                        "_manufacturerMethod": f"Same-cell MPN/MFR pair: value after {_delimiter_name(pair_delimiter)}"
                        + (f": matched {right_mfr}; {right_mfr_reason}" if right_mfr and right_mfr_reason else f": matched {right_mfr}" if right_mfr else ""),
                        "_manufacturerScore": float(right_mfr_score or 0) or 0.64,
                        "_annotationPattern": _annotation_shape_for_text(right),
                    })
                    total_score += float(left_mpn_score or 0) + float(right_mfr_score or 0)
                    continue

                if left_mfr and float(left_mfr_score or 0) >= 0.45 and right_mpn and float(right_mpn_score or 0) >= 0.35:
                    pairs.append({
                        "mpn": clean(right_mpn or right_without_annotations or right),
                        "manufacturer": clean(left),
                        "_sourceFragment": raw_entry,
                        "_pairDelimiter": pair_delimiter,
                        "_entryDelimiter": actual_entry_delimiter,
                        "_mpnMethod": f"Same-cell MPN/MFR pair: value after {_delimiter_name(pair_delimiter)}"
                        + (f": {right_mpn_reason}" if right_mpn_reason else ""),
                        "_mpnScore": min(1.0, float(right_mpn_score or 0) + 0.20),
                        "_manufacturerMethod": f"Same-cell MPN/MFR pair: value before {_delimiter_name(pair_delimiter)}"
                        + (f": matched {left_mfr}; {left_mfr_reason}" if left_mfr and left_mfr_reason else f": matched {left_mfr}" if left_mfr else ""),
                        "_manufacturerScore": float(left_mfr_score or 0) or 0.64,
                        "_annotationPattern": _annotation_shape_for_text(right),
                    })
                    total_score += float(left_mfr_score or 0) + float(right_mpn_score or 0)

            if not pairs:
                continue
            score = (len(pairs) * 3.0) + total_score
            if len(raw_entries) > 1 and len(pairs) == len(raw_entries):
                score += 2.0
            if score > best[1]["score"]:
                best = (pairs, {
                    "score": score,
                    "pair_delimiter": pair_delimiter,
                    "entry_delimiter": entry_delimiter,
                })

    return best[0] if best[0] else []


def _bracket_groups(text, start_index=0):
    raw = str(text or "")
    groups = []
    pairs = {"(": ")", "[": "]", "{": "}"}
    for match in re.finditer(r"[\(\[\{]", raw[max(0, start_index):]):
        open_index = max(0, start_index) + match.start()
        open_char = raw[open_index]
        close_char = pairs.get(open_char)
        if not close_char:
            continue
        close_index = raw.find(close_char, open_index + 1)
        if close_index < 0:
            continue
        groups.append({
            "open": open_char,
            "close": close_char,
            "content": raw[open_index + 1:close_index],
            "start": open_index,
            "end": close_index + 1,
        })
    return groups


def _token_key(value):
    return re.sub(r"[^A-Z0-9]+", "", clean(value).upper())


def _split_rule_suffix_tokens(content, delimiter, include_empty_base=True):
    raw = str(content or "").replace("\u00a0", " ")
    delimiter = str(delimiter or "")
    if not delimiter:
        return []
    parts = raw.split(delimiter)
    tokens = []
    for index, part in enumerate(parts):
        value = clean(part)
        if value:
            tokens.append(value)
        elif include_empty_base and index == 0:
            tokens.append("")
    return tokens


def _same_cell_expansion_rules(config=None):
    active = _configured_field_rules(config).get("_active")
    if not isinstance(active, dict):
        return []
    rules = (
        active.get("expansions")
        or active.get("expansionRules")
        or active.get("expansion_rules")
        or []
    )
    return rules if isinstance(rules, list) else []


def _same_cell_alternate_expansion_pairs(value, config=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return []

    for rule in _same_cell_expansion_rules(config):
        if not isinstance(rule, dict):
            continue
        if clean(rule.get("type")) not in {"base_suffix_alternates", "mpn_suffix_alternates"}:
            continue

        anchor = clean(rule.get("anchor") or rule.get("baseAnchor") or rule.get("base_anchor"))
        anchor_index = text.find(anchor) if anchor else -1
        if anchor and anchor_index < 0:
            continue

        base = clean(text[:anchor_index] if anchor else text)
        if is_blankish(base):
            continue
        base, _base_score, _base_reason = _best_mpn_from_text(base)
        base = clean(base or (text[:anchor_index] if anchor else text))
        if is_blankish(base):
            continue

        group_search_start = anchor_index + len(anchor) if anchor else len(base)
        groups = _bracket_groups(text, group_search_start)
        if not groups:
            continue

        try:
            suffix_group_index = int(rule.get("suffixGroupIndex") or rule.get("suffix_group_index") or 1) - 1
        except Exception:
            suffix_group_index = 0
        if suffix_group_index < 0 or suffix_group_index >= len(groups):
            continue
        suffix_group = groups[suffix_group_index]
        delimiter = clean(rule.get("suffixDelimiter") or rule.get("suffix_delimiter") or rule.get("delimiter") or "/")
        include_empty_base = clean(rule.get("emptyToken") or rule.get("empty_token")) in {"base", "mpn_base", ""}
        suffixes = _split_rule_suffix_tokens(suffix_group.get("content"), delimiter, include_empty_base=include_empty_base)
        if len(suffixes) <= 1:
            continue

        manufacturer = ""
        try:
            manufacturer_group_index = int(rule.get("manufacturerGroupIndex") or rule.get("manufacturer_group_index") or 0) - 1
        except Exception:
            manufacturer_group_index = -1
        if 0 <= manufacturer_group_index < len(groups):
            manufacturer = clean(groups[manufacturer_group_index].get("content"))
        if not manufacturer:
            for candidate_group in groups[suffix_group_index + 1:]:
                candidate = clean(candidate_group.get("content"))
                matched, score, _reason = _best_manufacturer_from_text(candidate)
                if matched and float(score or 0) >= 0.55:
                    manufacturer = candidate
                    break
        matched_manufacturer, manufacturer_score, manufacturer_reason = _best_manufacturer_from_text(manufacturer)

        pairs = []
        for suffix in suffixes:
            mpn_value = f"{base}{clean(suffix)}" if clean(suffix) else base
            mpn, mpn_score, mpn_reason = _best_mpn_from_text(mpn_value)
            pairs.append({
                "mpn": clean(mpn or mpn_value),
                "manufacturer": clean(manufacturer),
                "_sourceFragment": clean(text[:suffix_group["end"]]),
                "_mpnMethod": "Taught base + suffix alternate expansion"
                + (f": {mpn_reason}" if mpn_reason else ""),
                "_mpnScore": min(1.0, float(mpn_score or 0) + 0.20),
                "_manufacturerMethod": "Taught shared manufacturer for expanded alternates"
                + (f": matched {matched_manufacturer}; {manufacturer_reason}" if matched_manufacturer and manufacturer_reason else f": matched {matched_manufacturer}" if matched_manufacturer else ""),
                "_manufacturerScore": float(manufacturer_score or 0) or 0.72,
            })
        if len(pairs) > 1:
            return pairs

    return []


def _identity_group_rules(config=None):
    active = _configured_field_rules(config).get("_active")
    if not isinstance(active, dict):
        return []
    groups = (
        active.get("identityGroups")
        or active.get("identity_groups")
        or active.get("sameCellIdentityGroups")
        or active.get("same_cell_identity_groups")
        or []
    )
    return groups if isinstance(groups, list) else []


def _same_cell_identity_groups(roles=None):
    by_header = {}
    for role in ("cpn", "mpn", "manufacturer"):
        header = clean((roles or {}).get(role))
        if not header:
            continue
        by_header.setdefault(header, []).append(role)
    return [
        {"header": header, "roles": role_list}
        for header, role_list in by_header.items()
        if len(role_list) >= 2
    ]


def _identity_group_rule_for_header(config, header, roles):
    header = clean(header)
    role_set = set(roles or [])
    for rule in _identity_group_rules(config):
        if not isinstance(rule, dict):
            continue
        rule_header = clean(rule.get("header") or rule.get("sourceColumn") or rule.get("source_column"))
        rule_roles = set(rule.get("roles") or [])
        if rule_header and rule_header != header:
            continue
        if rule_roles and role_set and rule_roles != role_set:
            continue
        return rule
    return {}


def _score_identity_part_for_role(part, role):
    text = clean(part)
    if not text:
        return 0.0
    if role == "mpn":
        mpn, score, _ = _best_mpn_from_text(text)
        return float(score or 0) + (0.2 if mpn else 0.0)
    if role == "manufacturer":
        manufacturer, score, _ = _best_manufacturer_from_text(text)
        return float(score or 0) + (0.2 if manufacturer else 0.0)
    if role == "cpn":
        if _best_manufacturer_from_text(text)[0]:
            return 0.05
        if _best_mpn_from_text(text)[0]:
            return 0.15
        if re.search(r"[A-Za-z0-9]", text):
            return 0.45
    return 0.0


def _guess_identity_order(parts, roles):
    remaining_roles = list(roles or [])
    order = []
    for part in parts:
        if not remaining_roles:
            break
        best_role = max(
            remaining_roles,
            key=lambda role: _score_identity_part_for_role(part, role),
        )
        order.append(best_role)
        remaining_roles.remove(best_role)
    return order


def _apply_identity_combo_rules(role_values, roles, config=None):
    next_values = dict(role_values or {})
    for group in _same_cell_identity_groups(roles):
        header = group["header"]
        group_roles = group["roles"]
        rule = _identity_group_rule_for_header(config, header, group_roles)
        if not rule:
            continue
        parts = _split_identity_combo_value(next_values.get(group_roles[0]), rule)
        if len(parts) < 2:
            continue

        configured_order = [
            role for role in (rule.get("order") or [])
            if role in group_roles
        ]
        order = configured_order if len(configured_order) <= len(parts) else []
        if not order or len(order) < min(len(group_roles), len(parts)):
            order = _guess_identity_order(parts, group_roles)

        for index, role in enumerate(order):
            if index >= len(parts):
                break
            next_values[role] = parts[index]
    return next_values


def _strip_configured_prefix(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    prefix = clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))
    if not text or not prefix:
        return text

    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    try:
        if mode == "regex":
            pattern = prefix if prefix.startswith("^") else f"^(?:{prefix})"
            stripped = re.sub(pattern, "", text, count=1).strip()
        elif mode == "first_n_chars":
            count = int(float(prefix))
            stripped = text[count:].strip() if count > 0 else text
        elif mode == "before_delimiter":
            if prefix in text:
                stripped = text.split(prefix, 1)[1].strip()
            else:
                stripped = text
        else:
            stripped = text[len(prefix):].strip() if text.lower().startswith(prefix.lower()) else text
    except Exception:
        stripped = text
    return clean(stripped)


def _strip_configured_prefixes(parts, rule=None):
    return [clean(_strip_configured_prefix(part, rule)) for part in (parts or []) if not is_blankish(_strip_configured_prefix(part, rule))]


def _repair_wrapped_mpn_segment(value):
    text = clean(value)
    if not text:
        return ""
    text = re.sub(r"(?<=[A-Za-z0-9])-\s+(?=[A-Za-z0-9])", "-", text)
    tokens = text.split()
    if (
        len(tokens) >= 2
        and re.fullmatch(r"[A-Za-z0-9]{1,3}", tokens[-1])
        and re.search(r"\d", "".join(tokens[:-1]))
        and len(tokens[-2]) >= 6
    ):
        tokens[-2] = f"{tokens[-2]}{tokens[-1]}"
        tokens.pop()
        text = " ".join(tokens)
    return clean(text)


def _configured_prefix_applies(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    prefix = clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))
    if not text or not prefix:
        return False
    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    try:
        if mode == "regex":
            pattern = prefix if prefix.startswith("^") else f"^(?:{prefix})"
            return bool(re.search(pattern, text))
        if mode == "first_n_chars":
            count = int(float(prefix))
            return count > 0 and len(text) > count
        if mode == "before_delimiter":
            return prefix in text
        return text.lower().startswith(prefix.lower())
    except Exception:
        return False


def _repair_wrapped_manufacturer_tokens(text, known_keys):
    raw_tokens = [clean(token) for token in re.split(r"\s+", str(text or "").replace("\u00a0", " ").strip()) if clean(token)]
    if len(raw_tokens) <= 1:
        return clean(text)

    known_words = {
        word
        for key in (known_keys or [])
        for word in str(key).split()
        if len(word) > 2
    }
    repaired = []
    index = 0
    while index < len(raw_tokens):
        token = raw_tokens[index]
        if index + 1 < len(raw_tokens):
            next_token = raw_tokens[index + 1]
            joined_key = clean(re.sub(r"[^A-Za-z0-9]+", "", f"{token}{next_token}")).upper()
            if len(next_token) == 1 and joined_key in known_words:
                repaired.append(f"{token}{next_token}")
                index += 2
                continue
        repaired.append(token)
        index += 1

    return clean(" ".join(repaired))


@lru_cache(maxsize=8192)
def _manufacturer_directory_spans(value):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return "", {}

    manufacturer_lookup = load_manufacturer_lookup()
    phrase_lookup = load_manufacturer_phrase_lookup()
    text = _repair_wrapped_manufacturer_tokens(text, set(manufacturer_lookup) | set(phrase_lookup))
    token_matches = list(re.finditer(r"[A-Za-z0-9][A-Za-z0-9&.+'\-]*", text))
    if len(token_matches) <= 1:
        return text, {}

    max_window = min(6, len(token_matches))
    spans_by_start = {}

    def compact_slash_manufacturer_span(raw_segment):
        if "/" not in raw_segment:
            return False
        if re.search(r"\s/|/\s", raw_segment):
            return False
        slash_parts = [clean(part) for part in raw_segment.split("/") if clean(part)]
        if len(slash_parts) < 2:
            return False
        if any(" " in part for part in slash_parts[:-1]):
            return False
        for slash_part in slash_parts:
            scored = score_manufacturer_value(slash_part)
            if not scored.get("matched") or float(scored.get("score") or 0) < 0.75:
                return False
        return True

    for start_index in range(len(token_matches)):
        spans = []
        for end_index in range(start_index + 1, min(len(token_matches), start_index + max_window) + 1):
            start = token_matches[start_index].start()
            end = token_matches[end_index - 1].end()
            raw_segment = clean(text[start:end])
            if not raw_segment:
                continue
            normalized_segment = clean(re.sub(r"[^A-Za-z0-9]+", " ", raw_segment)).upper()
            exact_directory_match = normalized_segment in manufacturer_lookup
            matched = (
                exact_directory_match
                or normalized_segment in phrase_lookup
                or compact_slash_manufacturer_span(raw_segment)
            )
            if not matched:
                scored = score_manufacturer_value(raw_segment)
                scored_manufacturer_key = clean(re.sub(r"[^A-Za-z0-9]+", " ", scored.get("manufacturer") or "")).upper()
                matched = (
                    scored.get("matched")
                    and float(scored.get("score") or 0) >= 0.85
                    and scored_manufacturer_key == normalized_segment
                )
            if matched:
                spans.append({
                    "value": raw_segment,
                    "start": start_index,
                    "end": end_index,
                    "token_count": end_index - start_index,
                    "exact_directory_match": exact_directory_match,
                })
        if spans:
            spans_by_start[start_index] = sorted(spans, key=lambda item: item["token_count"], reverse=True)

    def can_cover_with_smaller_spans(start_index, end_index):
        memo = {}

        def search(index):
            if index == end_index:
                return True
            if index > end_index:
                return False
            if index in memo:
                return memo[index]
            for span in spans_by_start.get(index, []):
                if span["end"] > end_index:
                    continue
                if span["start"] == start_index and span["end"] == end_index:
                    continue
                if search(span["end"]):
                    memo[index] = True
                    return True
            memo[index] = False
            return False

        return search(start_index)

    for start_index, spans in list(spans_by_start.items()):
        filtered = []
        for span in spans:
            if span.get("exact_directory_match"):
                filtered.append(span)
                continue
            if span.get("token_count", 0) > 1 and can_cover_with_smaller_spans(span["start"], span["end"]):
                continue
            filtered.append(span)
        if filtered:
            spans_by_start[start_index] = sorted(filtered, key=lambda item: item["token_count"], reverse=True)
        else:
            spans_by_start.pop(start_index, None)
    return text, spans_by_start


@lru_cache(maxsize=8192)
def _manufacturer_segments_for_target_count(value, target_count):
    try:
        target_count = int(target_count or 0)
    except Exception:
        target_count = 0
    if target_count <= 1:
        return []

    raw_text = str(value or "").replace("\u00a0", " ").strip()
    line_parts = [clean(part) for part in re.split(r"\r?\n+", raw_text) if not is_blankish(part)]
    if len(line_parts) == target_count and _manufacturer_line_parts_are_target_safe(line_parts):
        return line_parts

    text, spans_by_start = _manufacturer_directory_spans(value)
    if not spans_by_start:
        return []

    token_matches = list(re.finditer(r"[A-Za-z0-9][A-Za-z0-9&.+'\-]*", text))
    memo = {}

    def search(index, remaining):
        key = (index, remaining)
        if key in memo:
            return memo[key]
        if remaining == 0:
            memo[key] = [] if index >= len(token_matches) else None
            return memo[key]
        if index >= len(token_matches):
            memo[key] = None
            return None
        best = None
        for span in spans_by_start.get(index, []):
            rest = search(span["end"], remaining - 1)
            if rest is None:
                continue
            candidate = [span["value"], *rest]
            if best is None or sum(len(item) for item in candidate) > sum(len(item) for item in best):
                best = candidate
        memo[key] = best
        return best

    result = [clean(part) for part in (search(0, target_count) or []) if not is_blankish(part)]
    if len(result) == target_count:
        return result
    return _merge_adjacent_known_manufacturer_segments(result)


def _manufacturer_lookup_key(value):
    return clean(re.sub(r"[^A-Za-z0-9]+", " ", str(value or "")).upper())


def _merge_adjacent_known_manufacturer_segments(parts):
    clean_parts = [clean(part) for part in (parts or []) if not is_blankish(part)]
    if len(clean_parts) <= 1:
        return clean_parts

    lookup = load_manufacturer_lookup()
    merged = []
    index = 0
    while index < len(clean_parts):
        selected = clean_parts[index]
        selected_end = index + 1
        max_end = min(len(clean_parts), index + 4)
        for end in range(max_end, index + 1, -1):
            combined = clean(" ".join(clean_parts[index:end]))
            key = _manufacturer_lookup_key(combined)
            if key in lookup:
                selected = clean(lookup.get(key) or combined)
                selected_end = end
                break
        merged.append(selected)
        index = selected_end
    return merged


def _manufacturer_line_parts_are_target_safe(line_parts):
    for part in line_parts or []:
        text = clean(part)
        if is_blankish(text):
            return False
        scored = score_manufacturer_value(text)
        if not scored.get("matched"):
            return False

        span_text, spans_by_start = _manufacturer_directory_spans(text)
        token_matches = list(re.finditer(r"[A-Za-z0-9][A-Za-z0-9&.+'\-]*", span_text))
        full_line_span = any(
            span.get("start") == 0 and span.get("end") == len(token_matches)
            for span in spans_by_start.get(0, [])
        )
        if full_line_span or len(token_matches) <= 1:
            continue
        # Parenthetical legacy aliases should stay attached to the manufacturer
        # line. Without parentheses, a mismatch usually means the line has
        # swallowed the next manufacturer token.
        if "(" in text and ")" in text:
            continue
        return False
    return True


@lru_cache(maxsize=8192)
def _split_manufacturer_part_by_directory(value):
    text, spans_by_start = _manufacturer_directory_spans(value)
    if not spans_by_start:
        return []

    token_matches = list(re.finditer(r"[A-Za-z0-9][A-Za-z0-9&.+'\-]*", text))
    phrase_lookup = load_manufacturer_phrase_lookup()
    max_window = min(6, len(token_matches))
    segments = []
    index = 0
    matched_token_count = 0

    while index < len(token_matches):
        best = None
        for span in spans_by_start.get(index, []):
            best = (span["value"], span["end"])
            break
        if best:
            segments.append(best[0])
            matched_token_count += best[1] - index
            index = best[1]
        else:
            index += 1

    if len(segments) <= 1:
        return []
    if matched_token_count < max(2, int(len(token_matches) * 0.60)):
        return []
    return segments


def _manufacturer_span_value_from_text(value):
    text, spans_by_start = _manufacturer_directory_spans(value)
    if not spans_by_start:
        return ""

    spans = [
        span
        for start_spans in spans_by_start.values()
        for span in start_spans
    ]
    if not spans:
        return ""

    best = sorted(
        spans,
        key=lambda span: (
            not span.get("exact_directory_match"),
            -int(span.get("token_count") or 0),
            span.get("start") or 0,
        ),
    )[0]
    return clean(best.get("value") or "")


def _split_manufacturer_parts_by_directory(parts):
    split_parts = []
    changed = False
    for part in parts or []:
        directory_parts = _split_manufacturer_part_by_directory(part)
        if len(directory_parts) > 1:
            split_parts.extend(directory_parts)
            changed = True
        elif not is_blankish(part):
            split_parts.append(clean(part))
    return split_parts if changed else []


def _repeated_prefix_segments(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    if not text:
        return []

    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    prefix = clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))
    if mode == "first_n_chars":
        try:
            count = int(float(prefix))
        except Exception:
            count = 0
        if count <= 0 or len(text) <= count:
            return []
        prefix = text[:count]
    elif mode not in {"literal", "exact"}:
        return []

    if len(prefix) < 2:
        return []

    matches = list(re.finditer(r"(?<!\S)" + re.escape(prefix), text, flags=re.IGNORECASE))
    if len(matches) <= 1:
        return []

    parts = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        part = clean(text[start:end])
        if part:
            parts.append(part)
    return parts


def _fixed_width_prefix_segments(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    if not text:
        return []

    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    if mode != "first_n_chars":
        return []
    try:
        count = int(float(clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))))
    except Exception:
        count = 0
    if count <= 1:
        return []

    starts = []
    for start in range(0, max(0, len(text) - count)):
        if start > 0 and not text[start - 1].isspace():
            continue
        prefix = text[start:start + count]
        if len(prefix) != count:
            continue
        # Generic supplier-code shape: fixed-width code followed by a separator
        # before the actual MPN. The separator can differ within the same cell.
        if prefix[-1].isalnum() or prefix[-1].isspace():
            continue
        compact_prefix = re.sub(r"[^A-Za-z0-9]+", "", prefix[:-1])
        if len(compact_prefix) < max(2, count - 2):
            continue
        if start + count >= len(text):
            continue
        starts.append(start)

    if len(starts) <= 1:
        return []

    parts = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        part = _repair_wrapped_mpn_segment(clean(text[start:end]))
        if part:
            parts.append(part)
    return parts


def _looks_like_standalone_mpn_prefix_line(line, count):
    text = clean(line)
    if not text or count <= 1:
        return False
    compact = re.sub(r"[^A-Za-z0-9]+", "", text)
    if len(compact) < max(2, count - 2) or len(compact) > count:
        return False
    mpn, score, _ = _best_mpn_from_text(text)
    if mpn and float(score or 0) >= 0.75:
        return False
    # Supplier prefixes are often a short code by itself, with or without a
    # trailing separator. Treat those as labels for the following wrapped line.
    return bool(re.match(r"^[A-Za-z0-9]+[-_:./]?$", text))


def _starts_with_fixed_width_mpn_prefix(line, count):
    text = clean(line)
    if count <= 1 or len(text) <= count:
        return False
    prefix = text[:count]
    if prefix[-1].isalnum() or prefix[-1].isspace():
        return False
    compact_prefix = re.sub(r"[^A-Za-z0-9]+", "", prefix[:-1])
    return len(compact_prefix) >= max(2, count - 2)


def _wrapped_prefixed_mpn_segments(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    if not text or not re.search(r"[\r\n]", text):
        return []

    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    if mode != "first_n_chars":
        return []
    try:
        count = int(float(clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))))
    except Exception:
        count = 0
    if count <= 1:
        return []

    lines = [clean(line) for line in re.split(r"\r?\n+", text) if not is_blankish(line)]
    if len(lines) <= 1:
        return []

    segments = []
    current = ""

    def flush_current():
        nonlocal current
        if current:
            segments.append(current)
            current = ""

    for line in lines:
        if _looks_like_standalone_mpn_prefix_line(line, count):
            flush_current()
            continue

        starts_with_prefix = _starts_with_fixed_width_mpn_prefix(line, count)
        if starts_with_prefix:
            flush_current()
            current = _strip_configured_prefix(line, rule)
            continue

        if not current:
            current = line
            continue

        if current.endswith(("-", "/", "\\")) or not starts_with_prefix:
            separator = "" if current.endswith(("-", "/", "\\")) else " "
            current = clean(f"{current}{separator}{line}")
        else:
            flush_current()
            current = line

    flush_current()

    if len(segments) <= 1:
        return []
    return [_repair_wrapped_mpn_segment(segment) for segment in segments]


def _clean_field_value(value, config=None, value_type=""):
    return _strip_configured_prefix(value, _field_rule(config, value_type))


def _split_whitespace_mpn_parts(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    if not text or not re.search(r"\s", text):
        return []
    raw_parts = [clean(part) for part in re.split(r"\s+", text) if not is_blankish(part)]
    if len(raw_parts) <= 1:
        return []
    stripped_parts = _strip_configured_prefixes(raw_parts, rule)
    if len(stripped_parts) <= 1:
        return []
    scored = [_best_mpn_from_text(part) for part in stripped_parts]
    valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
    digit_part_count = sum(1 for part in stripped_parts if re.search(r"\d", part))
    compact_count = sum(1 for part in stripped_parts if not re.search(r"\s", part) and len(part) <= 40)
    if valid_count >= 2 or (digit_part_count >= 2 and compact_count == len(stripped_parts)):
        return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]
    return []


def _split_alternate_value(value, config=None, value_type="mpn"):
    raw_text = str(value or "").replace("\u00a0", " ").strip()
    text = clean(raw_text)
    if is_blankish(text):
        return []
    config = config or {}
    rule = _field_rule(config, value_type)
    rule_delimiter_mode = clean(rule.get("delimiterMode") or rule.get("delimiter_mode") or rule.get("delimiter"))
    if rule_delimiter_mode in {"none", "no_split"}:
        return []

    if value_type == "mpn":
        fixed_width_prefix_parts = _fixed_width_prefix_segments(raw_text, rule)
        if len(fixed_width_prefix_parts) > 1:
            stripped_parts = _strip_configured_prefixes(fixed_width_prefix_parts, rule)
            scored = [_best_mpn_from_text(part) for part in stripped_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            if valid_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]
            digit_part_count = sum(1 for part in stripped_parts if re.search(r"\d", part))
            if digit_part_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]

        wrapped_prefix_parts = _wrapped_prefixed_mpn_segments(raw_text, rule)
        if len(wrapped_prefix_parts) > 1:
            scored = [_best_mpn_from_text(part) for part in wrapped_prefix_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            digit_part_count = sum(1 for part in wrapped_prefix_parts if re.search(r"\d", part))
            if valid_count >= 2 or digit_part_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(wrapped_prefix_parts, scored)]

    configured_delimiter = _configured_delimiter(rule)
    explicit_parts = _split_explicit_delimiter(raw_text, configured_delimiter)
    if len(explicit_parts) > 1:
        explicit_parts = _strip_configured_prefixes(explicit_parts, rule)
        if value_type == "manufacturer":
            return _split_manufacturer_parts_by_directory(explicit_parts) or explicit_parts
        if value_type == "mpn":
            scored = [_best_mpn_from_text(part) for part in explicit_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            digit_part_count = sum(1 for part in explicit_parts if re.search(r"\d", part))
            if valid_count >= 2 or digit_part_count >= max(2, len(explicit_parts)):
                return explicit_parts
        else:
            return explicit_parts

    prefix_parts = _repeated_prefix_segments(raw_text, rule)
    if len(prefix_parts) > 1:
        stripped_parts = _strip_configured_prefixes(prefix_parts, rule)
        if value_type != "mpn":
            return stripped_parts
        scored = [_best_mpn_from_text(part) for part in stripped_parts]
        valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
        if valid_count >= 2:
            return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]
        digit_part_count = sum(1 for part in stripped_parts if re.search(r"\d", part))
        if digit_part_count >= 2:
            return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]

    if value_type == "mpn" and rule_delimiter_mode in {"", "auto"}:
        fixed_width_prefix_parts = _fixed_width_prefix_segments(raw_text, rule)
        if len(fixed_width_prefix_parts) > 1:
            stripped_parts = _strip_configured_prefixes(fixed_width_prefix_parts, rule)
            scored = [_best_mpn_from_text(part) for part in stripped_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            if valid_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]
            digit_part_count = sum(1 for part in stripped_parts if re.search(r"\d", part))
            if digit_part_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]

    if value_type == "mpn" and rule_delimiter_mode in {"", "auto"}:
        whitespace_parts = _split_whitespace_mpn_parts(raw_text, rule)
        if len(whitespace_parts) > 1:
            return whitespace_parts

    raw_text = _strip_configured_prefix(raw_text, rule)
    text = clean(raw_text)

    delimiter_mode = clean(config.get("delimiterMode") or config.get("delimiter_mode"))
    custom_delimiter = clean(config.get("customDelimiter") or config.get("custom_delimiter"))
    explicit_delimiter = custom_delimiter if delimiter_mode == "custom" else delimiter_mode
    if explicit_delimiter == "\\n":
        explicit_delimiter = "\n"
    explicit_parts = _split_explicit_delimiter(raw_text, explicit_delimiter)
    if len(explicit_parts) > 1:
        explicit_parts = _strip_configured_prefixes(explicit_parts, rule)
        if value_type == "manufacturer":
            return _split_manufacturer_parts_by_directory(explicit_parts) or explicit_parts
        return explicit_parts

    delimiters = [r"\s+/\s+", r"\s*\|\s*", r"\s*;\s*", r"\r?\n+", r"\s*\^\s*"]
    if value_type == "manufacturer":
        delimiters.extend([r"\s+or\s+", r"\s+and/or\s+"])

    for delimiter in delimiters:
        parts = [clean(part) for part in re.split(delimiter, raw_text, flags=re.IGNORECASE) if not is_blankish(part)]
        if len(parts) <= 1:
            continue
        parts = _strip_configured_prefixes(parts, rule)
        if value_type == "manufacturer":
            return _split_manufacturer_parts_by_directory(parts) or parts
        if value_type != "mpn":
            return parts
        scored = [_best_mpn_from_text(part) for part in parts]
        valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
        if valid_count >= 2:
            return [mpn if mpn else part for part, (mpn, _, _) in zip(parts, scored)]
        digit_part_count = sum(1 for part in parts if re.search(r"\d", part))
        if delimiter in {r"\r?\n+", r"\s+/\s+", r"\s*\|\s*", r"\s*;\s*", r"\s*\^\s*"} and digit_part_count >= 2:
            return [mpn if mpn else part for part, (mpn, _, _) in zip(parts, scored)]
    if value_type == "manufacturer":
        return _split_manufacturer_part_by_directory(raw_text)
    return []


def _copy_inheritable_fields(fields, config=None):
    inherit_fields = set()
    if isinstance((config or {}).get("alternateInheritFields"), list):
        inherit_fields = set(config.get("alternateInheritFields") or [])
    elif isinstance((config or {}).get("alternate_inherit_fields"), list):
        inherit_fields = set(config.get("alternate_inherit_fields") or [])

    copied = {}
    for key in FACTWISE_FIELD_LABELS:
        if key in {"mpn", "manufacturer"}:
            continue
        value = (fields or {}).get(key) or _blank_factwise_field()
        if key in inherit_fields and value.get("value"):
            copied[key] = {
                **value,
                "method": "Inherited from primary mapped field",
            }
        else:
            copied[key] = _blank_factwise_field()
    return copied


def _blank_factwise_field():
    return {
        "value": "",
        "sourceColumn": "",
        "confidence": 0.0,
        "method": "Not detected",
    }


def _direct_factwise_field(value, source_column, confidence=0.72, method="Direct from selected column"):
    value = clean(value)
    if is_blankish(value):
        value = ""
    return {
        "value": value,
        "sourceColumn": source_column or "",
        "confidence": round(float(confidence or 0), 4),
        "method": method,
    }


def _mpn_factwise_field(value, source_column, method_prefix):
    text = clean(value)
    if is_blankish(text):
        return _blank_factwise_field()
    mpn, score, reason = _best_mpn_from_text(text)
    if mpn:
        return _direct_factwise_field(
            mpn,
            source_column,
            min(1.0, float(score or 0) + 0.20),
            method_prefix + (f": {reason}" if reason else ""),
        )
    return _direct_factwise_field(text, source_column, 0.55, "Direct from mapped MPN column")


def _manufacturer_factwise_field(value, source_column, method_prefix):
    text = clean(value)
    if is_blankish(text):
        return _blank_factwise_field()
    manufacturer, score, reason = _best_manufacturer_from_text(text)
    if manufacturer:
        return _direct_factwise_field(
            text,
            source_column,
            float(score or 0) or 0.55,
            method_prefix + (f": matched {manufacturer}; {reason}" if reason else f": matched {manufacturer}"),
        )
    return _direct_factwise_field(text, source_column, 0.55, "Direct from mapped Manufacturer column")


def _configured_alternate_column_groups(config):
    groups = []
    for index, group in enumerate((config or {}).get("alternateColumnGroups") or (config or {}).get("alternate_column_groups") or []):
        if not isinstance(group, dict):
            continue
        normalized = {
            "slot": clean(group.get("slot") or index + 1),
            "cpn": clean(group.get("cpn")),
            "mpn": clean(group.get("mpn")),
            "manufacturer": clean(group.get("manufacturer") or group.get("mfr")),
            "quantity": clean(group.get("quantity") or group.get("qty")),
            "uom": clean(group.get("uom")),
            "description": clean(group.get("description")),
            "level": clean(group.get("level")),
            "parent": clean(group.get("parent")),
            "notes": clean(group.get("notes")),
            "internalNotes": clean(group.get("internalNotes") or group.get("internal_notes")),
        }
        if any(normalized.get(key) for key in normalized if key != "slot"):
            groups.append(normalized)
    return groups


def _values_from_alternate_group_cell(value, config, field, source_header="", primary_header="", primary_parts=None):
    if is_blankish(value):
        return []

    primary_parts = primary_parts or []
    if source_header and primary_header and source_header == primary_header:
        if len(primary_parts) > 1:
            return primary_parts[1:]
        return []

    split_type = "manufacturer" if field == "manufacturer" else "mpn" if field == "mpn" else field
    parts = _split_alternate_value(value, config, split_type)
    return parts if parts else [clean(value)]


def _apply_alternate_group_field(alt_fields, role, values, value_index, source_column):
    if not values:
        return
    value = values[value_index] if value_index < len(values) else values[0]
    if role == "mpn":
        alt_fields[role] = _mpn_factwise_field(
            value,
            source_column,
            "Alternate column group MPN value/pattern lookup in mapped MPN column",
        )
    elif role == "manufacturer":
        alt_fields[role] = _manufacturer_factwise_field(
            value,
            source_column,
            "Alternate column group manufacturer directory/pattern match in mapped Manufacturer column",
        )
    else:
        alt_fields[role] = _direct_factwise_field(
            value,
            source_column,
            0.72,
            "Direct from mapped alternate column",
        )


def _infer_separate_column_entries(row, headers, roles, config, primary_fields, mpn_parts, manufacturer_parts):
    if clean(config.get("alternateLayout") or config.get("alternate_layout")) != "separate_columns":
        return []

    groups = _configured_alternate_column_groups(config)
    if not groups:
        return []

    mpn_header = clean((roles or {}).get("mpn"))
    manufacturer_header = clean((roles or {}).get("manufacturer"))
    entries = []

    for group in groups:
        group_values = {}
        for role in ("cpn", "mpn", "manufacturer", "quantity", "uom", "description", "level", "parent", "notes", "internalNotes"):
            source_header = group.get(role)
            raw_value = _row_cell(row, source_header, headers) if source_header else ""
            if role == "mpn":
                values = _values_from_alternate_group_cell(
                    raw_value,
                    config,
                    role,
                    source_header,
                    mpn_header,
                    mpn_parts,
                )
            elif role == "manufacturer":
                values = _values_from_alternate_group_cell(
                    raw_value,
                    config,
                    role,
                    source_header,
                    manufacturer_header,
                    manufacturer_parts,
                )
            else:
                values = _values_from_alternate_group_cell(raw_value, config, role)
            group_values[role] = {
                "source": source_header,
                "values": values,
            }

        mpn_part_count = len(group_values.get("mpn", {}).get("values") or [])
        if mpn_part_count <= 0:
            continue

        for value_index in range(mpn_part_count):
            alt_fields = _copy_inheritable_fields(primary_fields, config)
            alt_fields["mpn"] = _blank_factwise_field()
            alt_fields["manufacturer"] = _blank_factwise_field()

            for role, details in group_values.items():
                _apply_alternate_group_field(
                    alt_fields,
                    role,
                    details["values"],
                    value_index,
                    details["source"],
                )

            if not any(alt_fields.get(role, {}).get("value") for role in ("mpn", "manufacturer", "cpn")):
                continue
            entries.append(_build_factwise_entry(
                len(entries) + 1,
                alt_fields,
                f"Alternate {len(entries) + 1}",
            ))

    return entries


def _build_factwise_entry(index, fields, relation):
    return {
        "index": index,
        "relation": relation,
        "fields": fields,
    }


def _value_shape(value, role_hint=""):
    text = clean(value)
    if is_blankish(text):
        return "<BLANK>"
    if role_hint:
        if role_hint == "internalNotes":
            return "<INTERNAL_NOTES>"
        return f"<{role_hint.upper()}>"

    mpn, mpn_score, _ = _best_mpn_from_text(text)
    if mpn and mpn_score >= 0.55:
        text = re.sub(re.escape(mpn), "<MPN>", text, flags=re.IGNORECASE)
    manufacturer, manufacturer_score, _ = _best_manufacturer_from_text(text)
    if manufacturer and manufacturer_score >= 0.75:
        text = re.sub(re.escape(manufacturer), "<MFR>", text, flags=re.IGNORECASE)
    text = re.sub(r"\d+(?:\.\d+)?", "<NUM>", text)
    text = re.sub(r"[A-Za-z][A-Za-z0-9_./+\-()]{2,}", "<TOKEN>", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:160] or "<VALUE>"


PATTERN_DISPLAY_ROLE_ORDER = (
    "cpn",
    "mpn",
    "manufacturer",
    "description",
    "quantity",
    "uom",
    "level",
    "parent",
    "notes",
    "internalNotes",
)


def _pattern_display_token(role):
    if role == "manufacturer":
        return "<MFR>"
    if role == "mpn":
        return "<MPN>"
    if role == "cpn":
        return "<CPN>"
    label = FACTWISE_FIELD_LABELS.get(role) or ROLE_LABELS.get(role) or role or "Value"
    return f"<{re.sub(r'[^A-Za-z0-9]+', '_', label).strip('_').upper()}>"


def _field_review_title(mapped_fields):
    labels = [
        FACTWISE_FIELD_LABELS.get(role) or ROLE_LABELS.get(role) or role
        for role in (mapped_fields or [])
    ]
    if not labels:
        return "Confirm pattern"
    if len(labels) == 1:
        field_list = labels[0]
    elif len(labels) == 2:
        field_list = f"{labels[0]} and {labels[1]}"
    else:
        field_list = f"{', '.join(labels[:-1])}, and {labels[-1]}"
    return f"Confirm patterns for {field_list}"


def _visual_pattern_display_pattern(visual_pattern, source_value=""):
    """Render the grammar stored in a visual rule without re-detecting it."""
    if not isinstance(visual_pattern, dict):
        return ""
    stored = clean(visual_pattern.get("displayPattern") or visual_pattern.get("display_pattern"))
    if stored:
        return stored

    segments = visual_pattern.get("segments") or []
    if not isinstance(segments, list) or not segments:
        return ""
    composition = visual_pattern.get("mpnComposition") or visual_pattern.get("mpn_composition") or {}
    operation = clean(composition.get("operation")) if isinstance(composition, dict) else ""
    tokens = []
    seen_roles = set()
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        role = clean(segment.get("role"))
        if not role or role in seen_roles:
            continue
        seen_roles.add(role)
        if role == "mpn" and operation == "replace_suffix_at_marker":
            marker = str(composition.get("markerSequence") or composition.get("marker") or "@")
            tokens.append(f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>")
        elif role == "alternateList" and operation == "replace_suffix_at_marker":
            tokens.append("(<ALTERNATE_SUFFIXES>)")
        elif role == "alternateList":
            tokens.append("(<ALTERNATE_MPN_VALUES>)")
        else:
            token = _pattern_display_token(role)
            wrapper = segment.get("wrapper") if isinstance(segment.get("wrapper"), dict) else {}
            if wrapper.get("open") and wrapper.get("close"):
                token = f"{wrapper['open']}{token}{wrapper['close']}"
            else:
                before = str(segment.get("before") or "")
                after = str(segment.get("after") or "")
                if before.rstrip().endswith("(") and after.lstrip().startswith(")"):
                    token = f"({token})"
                elif before.rstrip().endswith("[") and after.lstrip().startswith("]"):
                    token = f"[{token}]"
                elif before.rstrip().endswith("{") and after.lstrip().startswith("}"):
                    token = f"{{{token}}}"
            tokens.append(token)

    text = str(source_value or "")
    if re.search(r"\{[^{}]{1,80}\}", text):
        tokens.append("{<STATUS>}")
    if re.search(r"\[[^\[\]]{1,80}\]", text):
        tokens.append("[<REF>]")
    separator = str(
        visual_pattern.get("recordSeparator")
        or visual_pattern.get("record_separator")
        or visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    pattern = " ".join(tokens)
    if separator:
        pattern = f"{pattern} repeated by {separator}"
    return clean(pattern)


def _flexible_literal_pattern(value):
    text = clean(value)
    if not text:
        return ""
    pieces = []
    for character in text:
        if character.isspace():
            pieces.append(r"\s+")
        elif character in {"-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015"}:
            pieces.append(r"[-\u2010-\u2015]\s*")
        else:
            pieces.append(re.escape(character))
    return "".join(pieces)


def _replace_pattern_display_value(pattern, value, token):
    value = clean(value)
    if not value:
        return pattern
    candidates = [
        re.escape(value).replace(r"\ ", r"\s+"),
        _flexible_literal_pattern(value),
    ]
    next_pattern = pattern
    for candidate in candidates:
        if not candidate:
            continue
        bounded = rf"(?<![A-Za-z0-9]){candidate}(?![A-Za-z0-9])"
        next_pattern = re.sub(bounded, token, next_pattern, flags=re.IGNORECASE)
    return next_pattern


def _normalize_pattern_display_text(pattern):
    text = str(pattern or "").replace("\u00a0", " ")
    text = re.sub(r"\{[^{}]{1,80}\}", "{<TAG>}", text)
    text = re.sub(r"\[[^\[\]]{1,80}\]", "[<REF>]", text)
    text = re.sub(r"\r?\n+", " [new line] ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:420] + " ..." if len(text) > 420 else text


def _display_pattern_for_source_value(value, role_values):
    pattern = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(pattern):
        return ""

    replacements = []
    for role in PATTERN_DISPLAY_ROLE_ORDER:
        token = _pattern_display_token(role)
        seen = set()
        role_items = role_values.get(role, []) if isinstance(role_values, dict) else []
        for raw_value in role_items:
            display_value = clean(raw_value)
            if not display_value or display_value.upper() in seen:
                continue
            seen.add(display_value.upper())
            replacements.append((role, display_value, token))

    replacements.sort(key=lambda item: len(item[1]), reverse=True)
    for _role, display_value, token in replacements:
        pattern = _replace_pattern_display_value(pattern, display_value, token)

    return _normalize_pattern_display_text(pattern)


def _display_pattern_for_expansion_rule(value, config=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    if is_blankish(text):
        return ""
    for rule in _same_cell_expansion_rules(config):
        if not isinstance(rule, dict):
            continue
        if clean(rule.get("type")) not in {"base_suffix_alternates", "mpn_suffix_alternates"}:
            continue
        anchor = clean(rule.get("anchor") or rule.get("baseAnchor") or rule.get("base_anchor"))
        anchor_index = text.find(anchor) if anchor else -1
        if anchor and anchor_index < 0:
            continue
        group_search_start = anchor_index + len(anchor) if anchor else 0
        groups = _bracket_groups(text, group_search_start)
        if not groups:
            continue
        try:
            suffix_group_index = int(rule.get("suffixGroupIndex") or rule.get("suffix_group_index") or 1) - 1
        except Exception:
            suffix_group_index = 0
        try:
            manufacturer_group_index = int(rule.get("manufacturerGroupIndex") or rule.get("manufacturer_group_index") or 0) - 1
        except Exception:
            manufacturer_group_index = -1
        if suffix_group_index < 0 or suffix_group_index >= len(groups):
            continue
        pattern = text
        if 0 <= manufacturer_group_index < len(groups):
            group = groups[manufacturer_group_index]
            pattern = f"{pattern[:group['start']]}(<MFR>){pattern[group['end']:]}"
        group = groups[suffix_group_index]
        delimiter = clean(rule.get("suffixDelimiter") or rule.get("suffix_delimiter") or rule.get("delimiter") or "/")
        suffix_pattern = f"({delimiter}<SUFFIX>{delimiter}<SUFFIX>)" if delimiter else "(<SUFFIXES>)"
        pattern = f"{pattern[:group['start']]}{suffix_pattern}{pattern[group['end']:]}"
        if anchor and anchor_index >= 0:
            pattern = f"<MPN_BASE>{pattern[anchor_index:]}"
        else:
            pattern = _replace_pattern_display_value(pattern, text[:group["start"]], "<MPN_BASE>")
        return _normalize_pattern_display_text(pattern)
    return ""


def _mpn_source_fragment_pattern(fragment):
    text = clean(fragment).strip(" ,;:/")
    if not text:
        return "<MPN>"
    suffix_groups = list(re.finditer(r"\([^()]{1,24}\)", text))
    if suffix_groups:
        before_first_group = text[:suffix_groups[0].start()].rstrip()
        marker_match = re.search(r"([@#]+)([^@#]*)$", before_first_group)
        if marker_match:
            marker = marker_match.group(1)
            marker_prefix = before_first_group[:marker_match.start()]
            marker_suffix = marker_match.group(2)
            base_pattern = (
                f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>"
                if clean(marker_prefix) and clean(marker_suffix)
                else f"<MPN>{marker}"
            )
            return base_pattern + " " + " ".join("(<ALTERNATE_SUFFIXES>)" for _ in suffix_groups)
        else:
            connector = "" if suffix_groups[0].start() > 0 and not text[suffix_groups[0].start() - 1].isspace() else " "
        return "<MPN>" + connector + " ".join("(<SUFFIX>)" for _ in suffix_groups)
    return "<MPN>"


def _same_cell_parenthesized_patterns_from_entries(value, entries, header):
    pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(value)
    if not pairs:
        return []

    patterns = {}
    for pair in pairs:
        source_pattern = _mpn_source_fragment_pattern(pair.get("_sourceFragment"))
        trailing = clean(pair.get("_trailingPattern"))
        key = (source_pattern, trailing)
        patterns[key] = patterns.get(key, 0) + 1

    output = []
    for (source_pattern, trailing), count in sorted(
        patterns.items(),
        key=lambda item: (
            0 if "@" in item[0][0] else 1,
            -item[0][0].count("(<SUFFIX>)"),
            item[0][0],
            item[0][1],
        ),
    ):
        pattern = f"{source_pattern} (<MFR>)"
        if trailing:
            pattern = f"{pattern} {trailing}"
        if count > 1:
            pattern = f"{pattern} repeated"
        output.append(pattern)
    return output


def _same_cell_parenthesized_pattern_from_entries(value, entries, header):
    """Compatibility helper for callers that still expect one display string."""
    patterns = _same_cell_parenthesized_patterns_from_entries(value, entries, header)
    return patterns[0] if patterns else ""


def _same_cell_packed_pair_pattern_from_entries(value):
    pairs = _same_cell_packed_mpn_manufacturer_pairs(value)
    if not pairs:
        return ""
    annotation_patterns = [clean(pair.get("_annotationPattern")) for pair in pairs if clean(pair.get("_annotationPattern"))]
    annotation = annotation_patterns[0] if annotation_patterns else ""
    pair_delimiter = clean(pairs[0].get("_pairDelimiter")) or ":"
    entry_delimiter = clean(pairs[0].get("_entryDelimiter")) or ";"
    pattern = f"<MPN>{pair_delimiter}<MFR>{annotation}"
    if len(pairs) > 1:
        pattern = f"{pattern}{entry_delimiter} repeated"
    return pattern


def _field_from_entries(entries, role, header):
    for entry in entries or []:
        fields = entry.get("fields") if isinstance(entry, dict) else {}
        field = fields.get(role) if isinstance(fields, dict) else {}
        if not isinstance(field, dict):
            continue
        if clean(field.get("sourceColumn")) != header:
            continue
        value = clean(field.get("value"))
        if value:
            return value
    return ""


def _pattern_display_rows_for_sample(row, headers, roles, selected_columns, entries, config=None, source_row=None):
    selected = set(selected_columns or [])
    rows = []
    seen = set()

    for scope, header, role_hints in _identity_pattern_sources(roles, config):
        if header not in headers or (selected and header not in selected):
            continue
        key = (scope, header, tuple(role_hints))
        if key in seen:
            continue
        seen.add(key)

        role_values = {role: [] for role in role_hints}
        for entry in entries or []:
            fields = entry.get("fields") if isinstance(entry, dict) else {}
            for role in role_hints:
                field = fields.get(role) if isinstance(fields, dict) else {}
                if not isinstance(field, dict):
                    continue
                if clean(field.get("sourceColumn")) != header:
                    continue
                value = clean(field.get("value"))
                if value:
                    role_values.setdefault(role, []).append(value)

        source_value = _row_cell(row, header, headers, preserve_delimiters=True)
        patterns = []
        active_rule = (
            (config or {}).get("_activeFieldPatternRule")
            or (config or {}).get("_active_field_pattern_rule")
            or {}
        )
        visual_pattern = active_rule.get("visualPattern") or active_rule.get("visual_pattern") or {}
        visual_source_header = clean(
            visual_pattern.get("sourceHeader") or visual_pattern.get("source_header")
        ) if isinstance(visual_pattern, dict) else ""
        if visual_source_header == header:
            visual_display = _visual_pattern_display_pattern(visual_pattern, source_value)
            if visual_display:
                patterns = [visual_display]
        if "mpn" in role_hints:
            expansion_pattern = _display_pattern_for_expansion_rule(source_value, config)
            if expansion_pattern and not patterns:
                patterns = [expansion_pattern]
        if not patterns and "mpn" in role_hints and "manufacturer" in role_hints:
            packed_pattern = _same_cell_packed_pair_pattern_from_entries(source_value)
            if packed_pattern:
                patterns = [packed_pattern]
            else:
                patterns = _same_cell_parenthesized_patterns_from_entries(source_value, entries, header)
        if not patterns:
            fallback_pattern = _display_pattern_for_source_value(source_value, role_values)
            if fallback_pattern:
                patterns = [fallback_pattern]
        if not patterns:
            continue
        label = " + ".join(_pattern_display_token(role).strip("<>") for role in role_hints) or "Pattern"
        if scope.startswith("alt"):
            label = f"Alt {scope[3:]} {label}"
        example = {
            "sourceRow": source_row or _source_row_number(row, 0),
            "rawValue": source_value,
            "mpn": _field_from_entries(entries, "mpn", header),
            "manufacturer": _field_from_entries(entries, "manufacturer", header),
            "cpn": _field_from_entries(entries, "cpn", header),
        }
        for pattern_index, pattern in enumerate(patterns):
            pattern_digest = hashlib.sha256(pattern.encode("utf-8")).hexdigest()[:10]
            rows.append({
                "key": f"{scope}-{header}-{'-'.join(role_hints)}-{pattern_index}-{pattern_digest}",
                "label": label,
                "source": header,
                "roles": role_hints,
                "pattern": pattern,
                "example": example,
                "occurrences": [{
                    "sourceRow": example.get("sourceRow"),
                    "rawValue": source_value,
                }],
                "occurrenceCount": 1,
            })

    def sort_key(row):
        roles = set(row.get("roles") or [])
        identity_score = 0
        if {"mpn", "manufacturer"}.issubset(roles):
            identity_score = 3
        elif "mpn" in roles:
            identity_score = 2
        elif "manufacturer" in roles:
            identity_score = 1
        return (-identity_score, row.get("source") or "")

    return sorted(rows, key=sort_key)


def _primary_pattern_row(pattern_rows):
    rows = [row for row in (pattern_rows or []) if isinstance(row, dict)]
    if not rows:
        return None

    return sorted(rows, key=lambda row: (-_pattern_row_score(row), row.get("source") or ""))[0]


def _pattern_row_score(row):
    roles = set((row or {}).get("roles") or [])
    if {"mpn", "manufacturer"}.issubset(roles):
        return 4
    if "mpn" in roles:
        return 3
    if "manufacturer" in roles:
        return 2
    if "cpn" in roles:
        return 1
    return 0


def _pattern_row_identity(row):
    roles = tuple(sorted((row or {}).get("roles") or []))
    grammar = clean((row or {}).get("pattern")).lower()
    grammar = re.sub(r"\s+", " ", grammar).strip()
    grammar = re.sub(r"\s+repeated$", "", grammar).strip()
    return (
        clean((row or {}).get("source")),
        roles,
        grammar,
    )


def _merge_pattern_display_rows(existing_rows, new_rows, limit=8):
    """Keep representative display rows without letting the first sample win forever."""
    by_identity = {}
    for row in list(existing_rows or []) + list(new_rows or []):
        if not isinstance(row, dict) or not clean(row.get("pattern")):
            continue
        key = _pattern_row_identity(row)
        current = by_identity.get(key)
        if current is None:
            by_identity[key] = {
                **row,
                "occurrences": list(row.get("occurrences") or []),
                "occurrenceCount": len(row.get("occurrences") or []) or int(row.get("occurrenceCount") or 1),
            }
            continue
        current_example = current.get("example") if isinstance(current.get("example"), dict) else {}
        row_example = row.get("example") if isinstance(row.get("example"), dict) else {}
        current_has_values = bool(clean(current_example.get("mpn")) or clean(current_example.get("manufacturer")))
        row_has_values = bool(clean(row_example.get("mpn")) or clean(row_example.get("manufacturer")))
        if row_has_values and not current_has_values:
            replacement = {
                **row,
                "occurrences": list(current.get("occurrences") or []),
                "occurrenceCount": int(current.get("occurrenceCount") or 0),
            }
            by_identity[key] = replacement
            current = replacement
        existing_occurrences = {
            (item.get("sourceRow"), clean(item.get("rawValue")))
            for item in (current.get("occurrences") or [])
            if isinstance(item, dict)
        }
        for occurrence in row.get("occurrences") or []:
            if not isinstance(occurrence, dict):
                continue
            occurrence_key = (occurrence.get("sourceRow"), clean(occurrence.get("rawValue")))
            if occurrence_key in existing_occurrences:
                continue
            current.setdefault("occurrences", []).append(occurrence)
            existing_occurrences.add(occurrence_key)
        current["occurrenceCount"] = len(current.get("occurrences") or [])

    return sorted(
        by_identity.values(),
        key=lambda row: (-_pattern_row_score(row), row.get("source") or "", row.get("pattern") or ""),
    )[:limit]


def _semantic_pattern_key(source_column, mapped_fields, grammar):
    identity = "|".join([
        "+".join(sorted(clean(field) for field in (mapped_fields or []) if clean(field))),
        re.sub(r"\s+", " ", clean(grammar).lower()),
    ])
    return f"semantic-{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:20]}"


def _semantic_rule_for_source(rule, source_column):
    rebound = dict(rule or {})
    visual_pattern = rebound.get("visualPattern") or rebound.get("visual_pattern")
    if isinstance(visual_pattern, dict):
        rebound["visualPattern"] = {
            **visual_pattern,
            "sourceHeader": clean(source_column),
        }
        rebound.pop("visual_pattern", None)
    return rebound


def _trim_semantic_fragment_span(text, start, end):
    raw = str(text or "")
    start = max(0, int(start or 0))
    end = min(len(raw), max(start, int(end or 0)))
    while start < end and raw[start].isspace():
        start += 1
    while start < end and raw[start] in "/;|\\":
        start += 1
        while start < end and raw[start].isspace():
            start += 1
    while end > start and raw[end - 1].isspace():
        end -= 1
    return start, end


def _unclassified_identity_fragment_pattern(fragment):
    text = clean(fragment)
    if not text:
        return ""
    candidate, score, _reason = _best_mpn_from_text(text)
    if not candidate or float(score or 0) < 0.35:
        return "<UNCLASSIFIED_TEXT>"
    candidate_index = text.upper().find(clean(candidate).upper())
    if candidate_index < 0:
        return "<MPN> <UNCLASSIFIED_TEXT>"
    before = clean(text[:candidate_index])
    after = clean(text[candidate_index + len(candidate):])
    tokens = []
    if before:
        tokens.append("<UNCLASSIFIED_TEXT>")
    tokens.append("<MPN>")
    if after:
        if re.fullmatch(r"\([^()]+\)", after):
            tokens.append("(<UNCLASSIFIED_TEXT>)")
        else:
            tokens.append("<UNCLASSIFIED_TEXT>")
    return " ".join(tokens)


def _semantic_identity_fragments(value, mapped_fields):
    """Split a shared identity cell into independently teachable records."""
    text = str(value or "").replace("\u00a0", " ")
    if is_blankish(text):
        return []

    mapped = set(mapped_fields or [])
    if not {"mpn", "manufacturer"}.issubset(mapped):
        grammar = " + ".join(_pattern_display_token(role) for role in (mapped_fields or []))
        return [{"start": 0, "end": len(text), "rawValue": text, "grammar": grammar or "<VALUE>"}]

    record_spans = _identity_record_spans(text)
    if len(record_spans) > 1:
        fragments = []
        for record_start, record_end in record_spans:
            for fragment in _semantic_identity_fragments(text[record_start:record_end], mapped_fields):
                fragments.append({
                    **fragment,
                    "start": record_start + int(fragment.get("start") or 0),
                    "end": record_start + int(fragment.get("end") or 0),
                })
        return fragments

    fragments = []
    cursor = 0
    for match in re.finditer(r"\(([^()]*)\)", text):
        manufacturer = clean(match.group(1))
        is_directory_manufacturer = _looks_like_parenthesized_manufacturer_alias(manufacturer)
        is_contextual_manufacturer = _is_terminal_parenthesis_before_annotations(text, match.end())
        if not is_directory_manufacturer and not is_contextual_manufacturer:
            continue
        if _has_later_manufacturer_in_same_record(text, match.end()):
            continue
        raw_before_mfr = text[cursor:match.start()]
        mpn_text, _ignored_prefix, source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(raw_before_mfr)
        if not mpn_text:
            continue
        annotation_end = _skip_trailing_reference_annotations(text, match.end())
        start, end = _trim_semantic_fragment_span(text, cursor, annotation_end)
        if end <= start:
            cursor = annotation_end
            continue
        grammar = f"{_mpn_source_fragment_pattern(source_fragment)} (<MFR>)"
        trailing = _trailing_annotation_pattern(text[match.end():annotation_end])
        if trailing:
            grammar = f"{grammar} {trailing}"
        fragments.append({
            "start": start,
            "end": end,
            "rawValue": text[start:end],
            "grammar": clean(grammar),
        })
        cursor = annotation_end

    residual_start, residual_end = _trim_semantic_fragment_span(text, cursor, len(text))
    if residual_end > residual_start:
        residual = text[residual_start:residual_end]
        grammar = _unclassified_identity_fragment_pattern(residual)
        if grammar:
            fragments.append({
                "start": residual_start,
                "end": residual_end,
                "rawValue": residual,
                "grammar": grammar,
            })

    if fragments:
        return fragments

    grammar = _unclassified_identity_fragment_pattern(text)
    return [{"start": 0, "end": len(text), "rawValue": text, "grammar": grammar or "<UNCLASSIFIED_TEXT>"}]


def _raw_field_pattern_sample_score(sample):
    left_values = [
        clean(item.get("value") if isinstance(item, dict) else "")
        for item in ((sample or {}).get("left") or [])
    ]
    non_empty_values = [value for value in left_values if not is_blankish(value)]
    text = " ".join(non_empty_values)
    score = len(non_empty_values) * 5
    score += min(len(text), 1600) / 80
    if "(" in text and ")" in text:
        score += 10
    if "{" in text or "[" in text:
        score += 5
    if "\n" in text or "\r" in text:
        score += 3
    if re.search(r"[A-Za-z0-9]{3,}[-/][A-Za-z0-9]{2,}", text):
        score += 4
    if re.search(r"\b[A-Z]{2,}[A-Z0-9-]{3,}\b", text):
        score += 3
    return score


def _select_raw_field_pattern_samples(raw_samples, limit):
    samples = list(raw_samples or [])
    if limit <= 0 or len(samples) <= limit:
        return samples
    ranked = sorted(
        enumerate(samples),
        key=lambda item: (-_raw_field_pattern_sample_score(item[1]), item[0]),
    )
    selected_indexes = sorted(index for index, _sample in ranked[:limit])
    return [samples[index] for index in selected_indexes]


def _allocate_field_pattern_sample_limits(groups, per_group_limit, total_limit):
    """Give every pattern group a small review sample without letting many groups explode runtime."""
    groups = [group for group in (groups or []) if group.get("_rawSamples")]
    if not groups:
        return {}

    per_group_limit = max(1, int(per_group_limit or 1))
    # The UI should have at least one row to show for each detected group. If a
    # file produces many groups, cap the extra rows first instead of deep-parsing
    # every group.
    total_limit = max(len(groups), int(total_limit or len(groups)))
    limits = {group["id"]: 1 for group in groups}
    remaining = max(0, total_limit - len(groups))

    ranked = sorted(
        groups,
        key=lambda item: (-int(item.get("rowCount") or 0), item.get("id") or ""),
    )
    while remaining > 0:
        changed = False
        for group in ranked:
            group_id = group["id"]
            available = len(group.get("_rawSamples") or [])
            if limits[group_id] >= per_group_limit or limits[group_id] >= available:
                continue
            limits[group_id] += 1
            remaining -= 1
            changed = True
            if remaining <= 0:
                break
        if not changed:
            break
    return limits


VISUAL_TEACH_VALUE_ROLES = set(ROLE_KEYS) | {"alternateList"}


def _safe_visual_teach_spans(source_value, tagged_spans):
    text = str(source_value or "")
    spans = []
    for item in tagged_spans if isinstance(tagged_spans, list) else []:
        if not isinstance(item, dict):
            continue
        role = clean(item.get("role"))
        if role not in VISUAL_TEACH_VALUE_ROLES | {"groupSeparator", "ignore"}:
            continue
        try:
            start = max(0, min(int(item.get("start")), len(text)))
            end = max(start, min(int(item.get("end")), len(text)))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        spans.append({"start": start, "end": end, "role": role})
    return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))


def _visual_teach_wrapper(value):
    text = str(value or "")
    wrappers = {"(": ")", "[": "]", "{": "}", "<": ">"}
    closing = wrappers.get(text[:1])
    if closing and text.endswith(closing):
        return {"open": text[:1], "close": closing}
    return None


def _visual_teach_end_boundary(value):
    text = str(value or "")
    match = re.match(r"^\s*[\]\)}>]", text)
    if match:
        return match.group(0)
    match = re.match(r"^\s*[,;|^~]", text)
    return match.group(0) if match else ""


def _visual_teach_reusable_before(value, segment_index):
    text = str(value or "")
    if segment_index:
        return text
    match = re.search(r"([@:^|;~=]\s*)$", text)
    return match.group(1) if match else text


def derive_visual_pattern_from_tagged_spans(
    source_value,
    source_header,
    tagged_spans,
    alternate_delimiter="/",
    alternate_mode="append",
    ignored_fields=None,
):
    """Turn user-selected source ranges into one backend-owned parser rule."""
    text = str(source_value or "")
    source_header = clean(source_header)
    spans = _safe_visual_teach_spans(text, tagged_spans)
    value_spans = [span for span in spans if span["role"] in VISUAL_TEACH_VALUE_ROLES]
    ignored = [span for span in spans if span["role"] == "ignore"]
    if source_header and ignored and not value_spans:
        return {
            "type": "ignore_fields",
            "sourceHeader": source_header,
            "ignoredFields": [
                clean(field)
                for field in (ignored_fields or [])
                if clean(field) in ROLE_KEYS
            ],
            "displayPattern": "<IGNORE>",
        }
    if not source_header or not value_spans:
        return {}

    separator_spans = [span for span in spans if span["role"] == "groupSeparator"]
    separator_counts = {}
    for span in separator_spans:
        literal = text[span["start"]:span["end"]]
        if literal:
            separator_counts[literal] = separator_counts.get(literal, 0) + 1
    group_separator = sorted(
        separator_counts,
        key=lambda literal: (-separator_counts[literal], -len(literal), literal),
    )[0] if separator_counts else ""

    group_ranges = []
    if group_separator:
        cursor = 0
        while cursor <= len(text):
            index = text.find(group_separator, cursor)
            if index < 0:
                group_ranges.append((cursor, len(text)))
                break
            group_ranges.append((cursor, index))
            cursor = index + len(group_separator)
            if cursor == len(text):
                break
    else:
        group_ranges = [(0, len(text))]

    template_range = None
    template_spans = []
    for start, end in group_ranges:
        candidates = [
            span for span in value_spans
            if span["start"] >= start and span["end"] <= end
        ]
        if candidates:
            template_range = (start, end)
            template_spans = candidates
            break
    if not template_range:
        return {}

    group_start, group_end = template_range
    segments = []
    for index, span in enumerate(template_spans):
        previous_end = template_spans[index - 1]["end"] if index else group_start
        next_start = template_spans[index + 1]["start"] if index + 1 < len(template_spans) else group_end
        selected_text = text[span["start"]:span["end"]]
        before = text[previous_end:span["start"]]
        after = text[span["end"]:next_start]
        segments.append({
            "role": span["role"],
            "before": _visual_teach_reusable_before(before, index),
            "after": after if index + 1 < len(template_spans) else _visual_teach_end_boundary(after),
            "wrapper": _visual_teach_wrapper(selected_text),
        })

    tagged_roles = {segment["role"] for segment in segments}
    if "mpn" in tagged_roles and "manufacturer" in tagged_roles:
        pattern_type = "bracket_alternate_manufacturer" if "alternateList" in tagged_roles else "bracket_manufacturer"
    else:
        pattern_type = "tagged_fields"
    rule = {
        "type": pattern_type,
        "sourceHeader": source_header,
        "groupSeparator": group_separator,
        "recordSeparator": group_separator,
        "alternateDelimiter": "" if alternate_delimiter == "__no_split__" else str(alternate_delimiter or ""),
        "alternateMode": "complete" if alternate_mode == "complete" else "append",
        "segments": segments,
    }

    mpn_span = next((span for span in template_spans if span["role"] == "mpn"), None)
    mpn_text = text[mpn_span["start"]:mpn_span["end"]] if mpn_span else ""
    marker_match = re.search(r"([@#]+)([^@#]*)$", mpn_text)
    replacement_marker = marker_match.group(1) if marker_match else ""
    if "alternateList" in tagged_roles and replacement_marker:
        prefix, primary_suffix = mpn_text.rsplit(replacement_marker, 1)
        if clean(prefix) and clean(primary_suffix):
            rule["alternateMode"] = "replace_suffix_at_marker"
            rule["mpnComposition"] = {
                "operation": "replace_suffix_at_marker",
                "marker": replacement_marker,
                "markerSequence": replacement_marker,
                "prefixSource": "mpn_before_marker",
                "primarySuffixSource": "mpn_after_marker",
                "alternateSuffixSource": "alternateList",
            }

    preserve_outer_brackets = {}
    for span in template_spans:
        if span["role"] not in {"alternateList", "manufacturer"}:
            continue
        if _visual_teach_wrapper(text[span["start"]:span["end"]]):
            preserve_outer_brackets[span["role"]] = True
    if preserve_outer_brackets:
        rule["preserveOuterBrackets"] = preserve_outer_brackets
    rule["displayPattern"] = _visual_pattern_display_pattern(rule, text)
    return rule


def _visual_pattern_segment_values(group_text, visual_pattern):
    segments = visual_pattern.get("segments") if isinstance(visual_pattern, dict) else []
    if not isinstance(segments, list) or not segments:
        return {}

    cursor = 0
    parsed = {}
    allowed_roles = set(ROLE_KEYS) | {"alternateList"}
    for segment in segments:
        if not isinstance(segment, dict):
            return {}
        role = clean(segment.get("role"))
        if role not in allowed_roles:
            continue
        before = str(segment.get("before") or "")
        after = str(segment.get("after") or "")
        wrapper = segment.get("wrapper") if isinstance(segment.get("wrapper"), dict) else {}
        value_start = cursor
        if before:
            before_index = group_text.find(before, cursor)
            if before_index < 0:
                return {}
            value_start = before_index + len(before)
        while value_start < len(group_text) and group_text[value_start].isspace():
            value_start += 1

        value_end = len(group_text)
        opening = str(wrapper.get("open") or "")
        closing = str(wrapper.get("close") or "")
        if opening and closing:
            open_index = group_text.find(opening, value_start)
            close_index = group_text.find(closing, open_index + len(opening)) if open_index >= 0 else -1
            if open_index < 0 or close_index < 0:
                return {}
            value_start = open_index
            value_end = close_index + len(closing)
        elif after:
            after_index = group_text.find(after, value_start)
            if after_index >= 0:
                value_end = after_index

        value = clean(group_text[value_start:value_end])
        if value:
            parsed[role] = f"{parsed.get(role, '')}{value}"
        cursor = value_end
    return parsed


def _normalize_visual_segment_values(parsed):
    """Refine broad visual MPN spans with backend directory/value evidence."""
    normalized = dict(parsed or {})
    mpn_value = clean(normalized.get("mpn"))
    if not mpn_value:
        return normalized

    candidate, ignored_prefix, _source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(
        mpn_value
    )
    if candidate and ignored_prefix:
        normalized["mpn"] = candidate
    return normalized


def _visual_pattern_identity_pairs(row, headers, roles, config=None):
    """Apply a user-taught visual structure to one packed identity cell."""
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = active_rule.get("visualPattern") or active_rule.get("visual_pattern")
    if not isinstance(visual_pattern, dict):
        return []
    visual_pattern_type = clean(visual_pattern.get("type"))
    if visual_pattern_type not in {"bracket_alternate_manufacturer", "bracket_manufacturer"}:
        return []

    source_header = clean(
        visual_pattern.get("sourceHeader")
        or visual_pattern.get("source_header")
        or (roles or {}).get("mpn")
    )
    if not source_header or source_header not in headers:
        return []
    source_value = _row_cell(row, source_header, headers, preserve_delimiters=True)
    if is_blankish(source_value):
        return []

    group_separator = str(
        visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    alternate_delimiter = str(
        visual_pattern.get("alternateDelimiter")
        or visual_pattern.get("alternate_delimiter")
        or "/"
    )
    alternate_mode = clean(
        visual_pattern.get("alternateMode")
        or visual_pattern.get("alternate_mode")
        or "append"
    )
    mpn_composition = (
        visual_pattern.get("mpnComposition")
        or visual_pattern.get("mpn_composition")
        or {}
    )
    composition_operation = clean(mpn_composition.get("operation")) if isinstance(mpn_composition, dict) else ""
    composition_marker = str(
        mpn_composition.get("markerSequence")
        or mpn_composition.get("marker")
        or "@"
    ) if isinstance(mpn_composition, dict) else "@"
    preserve_outer_brackets = (
        visual_pattern.get("preserveOuterBrackets")
        or visual_pattern.get("preserve_outer_brackets")
        or {}
    )
    if not isinstance(preserve_outer_brackets, dict):
        preserve_outer_brackets = {}
    preserve_mpn_at = bool(
        visual_pattern.get("preserveMpnAt")
        or visual_pattern.get("preserve_mpn_at")
    )
    raw_groups = str(source_value).split(group_separator) if group_separator else [str(source_value)]
    pairs = []
    seen = set()

    def add_pair(mpn, manufacturer):
        mpn_text = str(mpn or "")
        if not preserve_mpn_at:
            mpn_text = mpn_text.replace("@", "")
        mpn = clean(mpn_text)
        manufacturer = clean(manufacturer)
        if not mpn:
            return
        key = (mpn.upper(), manufacturer.upper())
        if key in seen:
            return
        seen.add(key)
        pairs.append({
            "mpn": mpn,
            "manufacturer": manufacturer,
            "_mpnScore": 0.98,
            "_manufacturerScore": 0.98 if manufacturer else 0.0,
            "_mpnMethod": "User-taught visual pattern: base and alternate MPN",
            "_manufacturerMethod": "User-taught visual pattern: manufacturer bracket",
        })

    for raw_group in raw_groups:
        group_text = str(raw_group or "").strip()
        if not group_text:
            continue
        parsed_segments = _normalize_visual_segment_values(
            _visual_pattern_segment_values(group_text, visual_pattern)
        )
        segment_mpn = clean(parsed_segments.get("mpn"))
        segment_manufacturer = clean(parsed_segments.get("manufacturer"))
        segment_alternates = clean(parsed_segments.get("alternateList"))
        if segment_mpn:
            primary_mpn = segment_mpn
            replacement_prefix = ""
            if (
                composition_operation == "replace_suffix_at_marker"
                and composition_marker
                and composition_marker in segment_mpn
            ):
                replacement_prefix, primary_suffix = segment_mpn.rsplit(composition_marker, 1)
                primary_mpn = f"{replacement_prefix}{primary_suffix}"
            add_pair(primary_mpn, segment_manufacturer)
            if segment_alternates and alternate_delimiter:
                wrapper_match = re.match(r"^([\(\[\{<])(.*)([\)\]\}>])$", segment_alternates)
                alternate_wrapper = None
                if wrapper_match:
                    alternate_wrapper = (wrapper_match.group(1), wrapper_match.group(3))
                    segment_alternates = clean(wrapper_match.group(2))
                for alternate in [clean(part) for part in segment_alternates.split(alternate_delimiter)]:
                    if not alternate:
                        continue
                    if alternate_wrapper:
                        alternate = f"{alternate_wrapper[0]}{alternate}{alternate_wrapper[1]}"
                    if composition_operation == "replace_suffix_at_marker" and replacement_prefix:
                        alternate_mpn = f"{replacement_prefix}{alternate.lstrip(composition_marker)}"
                    else:
                        alternate_mpn = alternate if alternate_mode == "complete" else f"{segment_mpn}{alternate}"
                    add_pair(alternate_mpn, segment_manufacturer)
            continue
        brackets = list(re.finditer(r"\(([^)]*)\)", group_text))
        if not brackets:
            continue
        base_mpn, _base_start, _base_end = _visual_base_mpn_fragment(
            group_text[:brackets[0].start()],
            preserve_mpn_at=preserve_mpn_at,
        )
        if not base_mpn:
            continue

        alternate_text = ""
        manufacturer = ""
        if visual_pattern_type == "bracket_manufacturer":
            manufacturer = clean(
                brackets[0].group(0)
                if preserve_outer_brackets.get("manufacturer")
                else brackets[0].group(1)
            )
        elif len(brackets) >= 2:
            alternate_text = clean(
                brackets[0].group(0)
                if preserve_outer_brackets.get("alternateList")
                else brackets[0].group(1)
            )
            manufacturer = clean(
                brackets[1].group(0)
                if preserve_outer_brackets.get("manufacturer")
                else brackets[1].group(1)
            )
        else:
            bracket_value = clean(brackets[0].group(1))
            matched_manufacturer, score, _reason = _best_manufacturer_from_text(bracket_value)
            if matched_manufacturer and float(score or 0) >= 0.65:
                manufacturer = bracket_value
            else:
                alternate_text = bracket_value

        primary_mpn = base_mpn
        replacement_prefix = ""
        if (
            composition_operation == "replace_suffix_at_marker"
            and composition_marker
            and composition_marker in base_mpn
        ):
            replacement_prefix, primary_suffix = base_mpn.rsplit(composition_marker, 1)
            primary_mpn = f"{replacement_prefix}{primary_suffix}"
        add_pair(primary_mpn, manufacturer)
        if not alternate_text or not alternate_delimiter:
            continue
        alternate_wrapper = None
        if preserve_outer_brackets.get("alternateList"):
            wrapper_pairs = {"(": ")", "[": "]", "{": "}", "<": ">"}
            opening = alternate_text[:1]
            closing = wrapper_pairs.get(opening)
            if closing and alternate_text.endswith(closing):
                alternate_wrapper = (opening, closing)
                alternate_text = clean(alternate_text[1:-1])
        alternate_parts = [clean(part) for part in alternate_text.split(alternate_delimiter)]
        for alternate in alternate_parts:
            if not alternate:
                continue
            if alternate_wrapper:
                alternate = f"{alternate_wrapper[0]}{alternate}{alternate_wrapper[1]}"
            if composition_operation == "replace_suffix_at_marker" and replacement_prefix:
                alternate_mpn = f"{replacement_prefix}{alternate.lstrip(composition_marker)}"
            else:
                alternate_mpn = alternate if alternate_mode == "complete" else f"{base_mpn}{alternate}"
            add_pair(alternate_mpn, manufacturer)

    return pairs


def _visual_pattern_ignored_fields(roles, config=None):
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = active_rule.get("visualPattern") or active_rule.get("visual_pattern")
    if not isinstance(visual_pattern, dict) or clean(visual_pattern.get("type")) != "ignore_fields":
        return set()
    source_header = clean(
        visual_pattern.get("sourceHeader")
        or visual_pattern.get("source_header")
    )
    ignored_fields = visual_pattern.get("ignoredFields") or visual_pattern.get("ignored_fields") or []
    if not isinstance(ignored_fields, list):
        return set()
    return {
        clean(field)
        for field in ignored_fields
        if clean(field) in ROLE_KEYS
        and clean((roles or {}).get(clean(field))) == source_header
    }


def _visual_pattern_tagged_field_rows(row, headers, config=None):
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = active_rule.get("visualPattern") or active_rule.get("visual_pattern")
    if not isinstance(visual_pattern, dict) or clean(visual_pattern.get("type")) != "tagged_fields":
        return []
    source_header = clean(
        visual_pattern.get("sourceHeader")
        or visual_pattern.get("source_header")
    )
    if not source_header or source_header not in headers:
        return []
    source_value = _row_cell(row, source_header, headers, preserve_delimiters=True)
    if is_blankish(source_value):
        return []
    segments = visual_pattern.get("segments") or []
    if not isinstance(segments, list) or not segments:
        return []
    group_separator = str(
        visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    groups = str(source_value).split(group_separator) if group_separator else [str(source_value)]
    parsed_rows = []

    for group_text in groups:
        parsed = _normalize_visual_segment_values(
            _visual_pattern_segment_values(group_text, visual_pattern)
        )
        parsed = {role: value for role, value in parsed.items() if role in ROLE_KEYS}
        if parsed:
            parsed_rows.append(parsed)
    return parsed_rows


def _visual_pattern_manual_rows(row, headers, config=None):
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = active_rule.get("visualPattern") or active_rule.get("visual_pattern")
    if not isinstance(visual_pattern, dict):
        return [], ""
    source_header = clean(
        visual_pattern.get("sourceHeader")
        or visual_pattern.get("source_header")
    )
    if not source_header or source_header not in headers:
        return [], source_header
    source_value = _row_cell(row, source_header, headers, preserve_delimiters=True)
    source_key = clean(source_value)
    corrections = visual_pattern.get("manualCorrections") or visual_pattern.get("manual_corrections") or []
    for correction in corrections if isinstance(corrections, list) else []:
        if (
            not isinstance(correction, dict)
            or correction.get("userEdited") is not True
            or clean(correction.get("sourceValue")) != source_key
        ):
            continue
        corrected_rows = []
        for entry in correction.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            raw_fields = entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
            corrected_rows.append({
                role: clean(value.get("value") if isinstance(value, dict) else value)
                for role, value in raw_fields.items()
                if role in ROLE_KEYS
            })
        return corrected_rows, source_header
    return [], source_header


def _semantic_pattern_rules(config=None):
    rules = {}
    for key in ("semanticPatternRules", "semantic_pattern_rules", "fieldPatternRules", "field_pattern_rules"):
        value = (config or {}).get(key)
        if not isinstance(value, dict):
            continue
        for candidate_key, rule in value.items():
            if not isinstance(rule, dict):
                continue
            pattern_key = clean(rule.get("patternKey") or rule.get("pattern_key") or candidate_key)
            if pattern_key.startswith("semantic-"):
                rules[pattern_key] = rule
    return rules


def _infer_semantic_pattern_entries_for_row(row, headers, roles, selected_columns, config=None):
    if (config or {}).get("_semanticPatternPass"):
        return []
    rules = _semantic_pattern_rules(config)
    if not rules:
        return []

    combined_entries = []
    for unit in _field_review_mapping_units(headers, roles, config=config):
        if unit.get("relationship") != "shared":
            continue
        source_column = unit.get("sourceColumn")
        source_value = _row_cell(row, source_column, headers, preserve_delimiters=True)
        if is_blankish(source_value):
            continue
        fragments = _semantic_identity_fragments(source_value, unit.get("mappedFields") or [])
        if not any(
            _semantic_pattern_key(source_column, unit.get("mappedFields") or [], fragment.get("grammar")) in rules
            for fragment in fragments
        ):
            continue

        for fragment in fragments:
            pattern_key = _semantic_pattern_key(
                source_column,
                unit.get("mappedFields") or [],
                fragment.get("grammar"),
            )
            rule = rules.get(pattern_key) or {}
            fragment_row = dict(row) if isinstance(row, dict) else {}
            fragment_row[source_column] = fragment.get("rawValue") or ""
            fragment_config = dict(config or {})
            fragment_config["_semanticPatternPass"] = True
            fragment_config.pop("semanticPatternRules", None)
            fragment_config.pop("semantic_pattern_rules", None)
            fragment_config.pop("fieldPatternRules", None)
            fragment_config.pop("field_pattern_rules", None)
            fragment_config.pop("_activeFieldPatternRule", None)
            fragment_config.pop("_active_field_pattern_rule", None)
            if rule:
                fragment_config = _config_with_active_rule(
                    fragment_config,
                    _semantic_rule_for_source(rule, source_column),
                )
            fragment_entries = _infer_field_entries_for_row(
                fragment_row,
                headers,
                roles,
                selected_columns,
                config=fragment_config,
            )
            combined_entries.extend(fragment_entries)

    for index, entry in enumerate(combined_entries):
        entry["index"] = index
        entry["relation"] = "Primary" if index == 0 else f"Alternate {index}"
    return combined_entries


def _infer_field_entries_for_row(row, headers, roles, selected_columns, config=None):
    config = config or {}
    semantic_entries = _infer_semantic_pattern_entries_for_row(
        row,
        headers,
        roles,
        selected_columns,
        config=config,
    )
    if semantic_entries:
        return semantic_entries
    ignored_fields = _visual_pattern_ignored_fields(roles, config=config)
    tagged_field_rows = _visual_pattern_tagged_field_rows(row, headers, config=config)
    manual_rows, manual_source_header = _visual_pattern_manual_rows(row, headers, config=config)
    tagged_fields = {
        field
        for parsed in tagged_field_rows
        for field in parsed
    }
    manual_fields = {
        field
        for parsed in manual_rows
        for field in parsed
    }
    pattern_owned_fields = ignored_fields | tagged_fields | manual_fields
    fields = {
        key: _blank_factwise_field()
        for key in FACTWISE_FIELD_LABELS
    }

    def set_field(role, value, source_column, confidence=0.72, method="Direct from selected column", overwrite=False):
        value = clean(value)
        if is_blankish(value):
            value = ""
        if not overwrite and fields[role]["value"]:
            return
        fields[role] = {
            "value": value,
            "sourceColumn": source_column or "",
            "confidence": round(float(confidence or 0), 4),
            "method": method,
        }

    for role in ("cpn", "description", "quantity", "uom", "level", "parent", "notes", "internalNotes"):
        if role in pattern_owned_fields:
            continue
        header = clean((roles or {}).get(role))
        if header:
            value = _row_cell(row, header, headers)
            if not is_blankish(value):
                clean_value = _clean_field_value(value, config, role) if role in {"cpn"} else value
                set_field(role, clean_value, header)

    cpn_header = "" if "cpn" in pattern_owned_fields else clean((roles or {}).get("cpn"))
    mpn_header = "" if "mpn" in pattern_owned_fields else clean((roles or {}).get("mpn"))
    manufacturer_header = "" if "manufacturer" in pattern_owned_fields else clean((roles or {}).get("manufacturer"))
    cpn_value = _row_cell(row, cpn_header, headers, preserve_delimiters=True) if cpn_header else ""
    mpn_value = _row_cell(row, mpn_header, headers, preserve_delimiters=True) if mpn_header else ""
    manufacturer_value = _row_cell(row, manufacturer_header, headers, preserve_delimiters=True) if manufacturer_header else ""
    if manual_rows:
        entries = []
        for entry_index, parsed in enumerate(manual_rows):
            entry_fields = {
                field: dict(value)
                for field, value in fields.items()
            }
            for role, value in parsed.items():
                entry_fields[role] = _direct_factwise_field(
                    value,
                    manual_source_header,
                    1.0,
                    "User-confirmed manual interpretation",
                )
            entries.append(_build_factwise_entry(
                entry_index,
                entry_fields,
                "Primary" if entry_index == 0 else f"Alternate {entry_index}",
            ))
        return entries
    if tagged_field_rows:
        source_header = clean(
            (((config or {}).get("_activeFieldPatternRule") or {}).get("visualPattern") or {}).get("sourceHeader")
        )
        entries = []
        for entry_index, parsed in enumerate(tagged_field_rows):
            entry_fields = {
                field: dict(value)
                for field, value in fields.items()
            }
            for role, value in parsed.items():
                entry_fields[role] = _direct_factwise_field(
                    value,
                    source_header,
                    0.99,
                    "User-taught tagged field pattern",
                )
            entries.append(_build_factwise_entry(
                entry_index,
                entry_fields,
                "Primary" if entry_index == 0 else f"Alternate {entry_index}",
            ))
        return entries
    same_cell_identity_pairs = _visual_pattern_identity_pairs(
        row,
        headers,
        roles,
        config,
    )
    if not same_cell_identity_pairs and mpn_header:
        same_cell_identity_pairs = _same_cell_alternate_expansion_pairs(mpn_value, config)
    if not same_cell_identity_pairs and mpn_header and manufacturer_header and mpn_header == manufacturer_header:
        same_cell_identity_pairs = _same_cell_packed_mpn_manufacturer_pairs(mpn_value)
    if not same_cell_identity_pairs and mpn_header and manufacturer_header and mpn_header == manufacturer_header:
        same_cell_identity_pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(mpn_value)
    if not same_cell_identity_pairs:
        identity_values = _apply_identity_combo_rules(
            {
                "cpn": cpn_value,
                "mpn": mpn_value,
                "manufacturer": manufacturer_value,
            },
            roles,
            config=config,
        )
        cpn_value = identity_values.get("cpn", cpn_value)
        mpn_value = identity_values.get("mpn", mpn_value)
        manufacturer_value = identity_values.get("manufacturer", manufacturer_value)
    cpn_parts = _split_alternate_value(cpn_value, config, "cpn") if cpn_header else []
    mpn_parts = _split_alternate_value(mpn_value, config, "mpn") if mpn_header else []
    manufacturer_parts = _split_alternate_value(manufacturer_value, config, "manufacturer") if manufacturer_header else []
    if same_cell_identity_pairs:
        mpn_parts = [pair["mpn"] for pair in same_cell_identity_pairs]
        manufacturer_parts = [pair["manufacturer"] for pair in same_cell_identity_pairs]
    manufacturer_rule = _field_rule(config, "manufacturer")
    manufacturer_delimiter_mode = clean(
        manufacturer_rule.get("delimiterMode")
        or manufacturer_rule.get("delimiter_mode")
        or manufacturer_rule.get("delimiter")
    )
    if (
        manufacturer_header
        and len(mpn_parts) > 1
        and manufacturer_delimiter_mode in {"", "auto"}
    ):
        targeted_manufacturer_parts = _manufacturer_segments_for_target_count(
            manufacturer_value,
            len(mpn_parts),
        )
        if targeted_manufacturer_parts and len(targeted_manufacturer_parts) <= len(mpn_parts):
            manufacturer_parts = targeted_manufacturer_parts
    primary_cpn_value = cpn_parts[0] if cpn_parts else _clean_field_value(cpn_value, config, "cpn")
    primary_mpn_value = mpn_parts[0] if mpn_parts else _clean_field_value(mpn_value, config, "mpn")
    primary_manufacturer_value = manufacturer_parts[0] if manufacturer_parts else _clean_field_value(manufacturer_value, config, "manufacturer")
    if manufacturer_header and not manufacturer_parts:
        manufacturer_span_value = _manufacturer_span_value_from_text(primary_manufacturer_value)
        if manufacturer_span_value:
            primary_manufacturer_value = manufacturer_span_value

    if cpn_header and not is_blankish(primary_cpn_value):
        set_field("cpn", primary_cpn_value, cpn_header, 0.72, "Direct from mapped CPN column", overwrite=True)

    if mpn_header:
        if not is_blankish(primary_mpn_value):
            mpn, score, reason = _best_mpn_from_text(primary_mpn_value)
            if mpn:
                set_field(
                    "mpn",
                    mpn,
                    mpn_header,
                    min(1.0, float(score or 0) + 0.25),
                    "Backend MPN value/pattern lookup in mapped MPN column" + (f": {reason}" if reason else ""),
                    overwrite=True,
                )
            else:
                set_field("mpn", primary_mpn_value, mpn_header, 0.55, "Direct from mapped MPN column")

    if manufacturer_header:
        if not is_blankish(primary_manufacturer_value):
            manufacturer, mfr_score, mfr_reason = _best_manufacturer_from_text(primary_manufacturer_value)
            if manufacturer:
                set_field(
                    "manufacturer",
                    primary_manufacturer_value,
                    manufacturer_header,
                    mfr_score,
                    "Backend manufacturer directory/pattern match in mapped Manufacturer column"
                    + (f": matched {manufacturer}; {mfr_reason}" if mfr_reason else f": matched {manufacturer}"),
                    overwrite=True,
                )
            else:
                set_field(
                    "manufacturer",
                    primary_manufacturer_value,
                    manufacturer_header,
                    0.55,
                    "Direct from mapped Manufacturer column",
                )

    if same_cell_identity_pairs:
        first_pair = same_cell_identity_pairs[0]
        fields["mpn"] = _direct_factwise_field(
            first_pair.get("mpn"),
            mpn_header,
            float(first_pair.get("_mpnScore") or 0.86),
            first_pair.get("_mpnMethod") or "Same-cell MPN/manufacturer chunk: MPN before parenthesized manufacturer",
        )
        manufacturer, score, reason = _best_manufacturer_from_text(first_pair.get("manufacturer"))
        fields["manufacturer"] = _direct_factwise_field(
            first_pair.get("manufacturer"),
            manufacturer_header,
            float(first_pair.get("_manufacturerScore") or score or 0) or 0.72,
            first_pair.get("_manufacturerMethod") or "Same-cell MPN/manufacturer chunk: parenthesized manufacturer"
            + (f": matched {manufacturer}; {reason}" if manufacturer and reason else f": matched {manufacturer}" if manufacturer else ""),
        )
        entries = [_build_factwise_entry(0, fields, "Primary")]
        for entry_index in range(1, len(same_cell_identity_pairs)):
            pair = same_cell_identity_pairs[entry_index]
            alt_fields = _copy_inheritable_fields(fields, config)
            alt_fields["mpn"] = _direct_factwise_field(
                pair.get("mpn"),
                mpn_header,
                float(pair.get("_mpnScore") or 0.86),
                pair.get("_mpnMethod") or "Same-cell MPN/manufacturer chunk: MPN before parenthesized manufacturer",
            )
            manufacturer, score, reason = _best_manufacturer_from_text(pair.get("manufacturer"))
            alt_fields["manufacturer"] = _direct_factwise_field(
                pair.get("manufacturer"),
                manufacturer_header,
                float(pair.get("_manufacturerScore") or score or 0) or 0.72,
                pair.get("_manufacturerMethod") or "Same-cell MPN/manufacturer chunk: parenthesized manufacturer"
                + (f": matched {manufacturer}; {reason}" if manufacturer and reason else f": matched {manufacturer}" if manufacturer else ""),
            )
            entries.append(_build_factwise_entry(entry_index, alt_fields, f"Alternate {entry_index}"))
        return entries

    entry_count = max(len(cpn_parts), len(mpn_parts), len(manufacturer_parts), 1)
    if mpn_header and (mpn_parts or not is_blankish(primary_mpn_value)):
        # MPN is the identity anchor for alternates. Manufacturer parsing can
        # over-split multi-word names, but it must never create an extra
        # alternate row with no MPN.
        entry_count = max(len(mpn_parts), 1)
        if len(mpn_parts) > 1 and len(manufacturer_parts) > len(mpn_parts):
            manufacturer_parts = manufacturer_parts[:len(mpn_parts)]
    entries = [_build_factwise_entry(0, fields, "Primary")]

    separate_column_entries = _infer_separate_column_entries(
        row,
        headers,
        roles,
        config,
        fields,
        mpn_parts,
        manufacturer_parts,
    )
    if separate_column_entries:
        return entries + separate_column_entries

    if entry_count <= 1:
        return entries

    for entry_index in range(1, entry_count):
        alt_fields = _copy_inheritable_fields(fields, config)
        alt_fields["mpn"] = _blank_factwise_field()
        alt_fields["manufacturer"] = _blank_factwise_field()
        if entry_index < len(cpn_parts):
            alt_fields["cpn"] = _direct_factwise_field(
                cpn_parts[entry_index],
                cpn_header,
                0.72,
                "Alternate split from mapped CPN column",
            )
        elif cpn_header and len(cpn_parts) <= 1 and not is_blankish(primary_cpn_value):
            alt_fields["cpn"] = _direct_factwise_field(
                primary_cpn_value,
                cpn_header,
                0.72,
                "Repeated single mapped CPN for split alternate",
            )
        if entry_index < len(mpn_parts):
            mpn, score, reason = _best_mpn_from_text(mpn_parts[entry_index])
            alt_fields["mpn"] = {
                "value": mpn or clean(mpn_parts[entry_index]),
                "sourceColumn": mpn_header,
                "confidence": round(min(1.0, float(score or 0) + 0.20), 4),
                "method": "Alternate split from mapped MPN column" + (f": {reason}" if reason else ""),
            }
        elif mpn_header and len(mpn_parts) <= 1 and not is_blankish(primary_mpn_value):
            mpn, score, reason = _best_mpn_from_text(primary_mpn_value)
            alt_fields["mpn"] = {
                "value": mpn or clean(primary_mpn_value),
                "sourceColumn": mpn_header,
                "confidence": round(min(1.0, float(score or 0) + 0.20), 4),
                "method": "Repeated single mapped MPN for split alternate"
                + (f": {reason}" if reason else ""),
            }
        if entry_index < len(manufacturer_parts):
            manufacturer, score, reason = _best_manufacturer_from_text(manufacturer_parts[entry_index])
            alt_fields["manufacturer"] = {
                "value": clean(manufacturer_parts[entry_index]),
                "sourceColumn": manufacturer_header,
                "confidence": round(float(score or 0) or 0.55, 4),
                "method": "Alternate split from mapped Manufacturer column"
                + (f": matched {manufacturer}; {reason}" if manufacturer and reason else f": matched {manufacturer}" if manufacturer else ""),
            }
        elif manufacturer_header and len(manufacturer_parts) <= 1 and not is_blankish(primary_manufacturer_value):
            manufacturer, score, reason = _best_manufacturer_from_text(primary_manufacturer_value)
            alt_fields["manufacturer"] = {
                "value": clean(primary_manufacturer_value),
                "sourceColumn": manufacturer_header,
                "confidence": round(float(score or 0) or 0.55, 4),
                "method": "Repeated single mapped Manufacturer for split alternate"
                + (f": matched {manufacturer}; {reason}" if manufacturer and reason else f": matched {manufacturer}" if manufacturer else ""),
            }
        entries.append(_build_factwise_entry(entry_index, alt_fields, f"Alternate {entry_index}"))

    return entries


def _infer_field_values_for_row(row, headers, roles, selected_columns, config=None):
    entries = _infer_field_entries_for_row(row, headers, roles, selected_columns, config=config)
    return entries[0]["fields"] if entries else {}


STRUCTURAL_DELIMITER_RE = re.compile(
    r"(?P<newline>\r?\n+)"
    r"|(?P<tab>\t+)"
    r"|(?P<spaced_dash>\s[-\u2010-\u2015]{1,3}\s)"
    r"|(?P<repeated_dash>[-\u2010-\u2015]{2,})"
    r"|(?P<slash>/)"
    r"|(?P<backslash>\\)"
    r"|(?P<pipe>[|¦ǀ∣│┃❘❙｜])"
    r"|(?P<colon>:)"
    r"|(?P<semicolon>;)"
    r"|(?P<comma>,)"
    r"|(?P<caret>\^)"
    r"|(?P<tilde>~)"
    r"|(?P<percent>%)"
    r"|(?P<equals>=)"
    r"|(?P<hash>#)"
    r"|(?P<at>@)"
    r"|(?P<plus>\+)"
    r"|(?P<amp>&)"
    r"|(?P<pipe_like_i>(?<=\s)[Ii](?=\s))"
)

EMBEDDED_DELIMITER_CHARS = {
    "-": "dash",
    "\u2010": "dash",
    "\u2011": "dash",
    "\u2012": "dash",
    "\u2013": "dash",
    "\u2014": "dash",
    "\u2015": "dash",
    "/": "slash",
    "\\": "backslash",
    "|": "pipe",
    "¦": "pipe",
    "ǀ": "pipe",
    "∣": "pipe",
    "│": "pipe",
    "┃": "pipe",
    "❘": "pipe",
    "❙": "pipe",
    "｜": "pipe",
    ":": "colon",
    ";": "semicolon",
    ",": "comma",
    "^": "caret",
    "~": "tilde",
    "%": "percent",
    "=": "equals",
    "#": "hash",
    "@": "at",
    "+": "plus",
    "&": "amp",
}


def _delimiter_label(match):
    kind = match.lastgroup or ""
    return {
        "newline": "\\n",
        "tab": "\\t",
        "spaced_dash": "dash",
        "repeated_dash": "dash",
        "slash": "slash",
        "backslash": "backslash",
        "pipe": "pipe",
        "colon": "colon",
        "semicolon": "semicolon",
        "comma": "comma",
        "caret": "caret",
        "tilde": "tilde",
        "percent": "percent",
        "equals": "equals",
        "hash": "hash",
        "at": "at",
        "plus": "plus",
        "amp": "amp",
        "pipe_like_i": "pipe_like_i",
    }.get(kind, kind)


def _neighbor_segment(text, start, end):
    left = clean(re.split(r"[\r\n\t|¦ǀ∣│┃❘❙｜:;,^~=#@+&]|(?:\s[-\u2010-\u2015]{1,3}\s)|(?:[-\u2010-\u2015]{2,})", text[:start])[-1])
    right = clean(re.split(r"[\r\n\t|¦ǀ∣│┃❘❙｜:;,^~=#@+&]|(?:\s[-\u2010-\u2015]{1,3}\s)|(?:[-\u2010-\u2015]{2,})", text[end:])[0])
    return left, right


def _looks_like_structural_slash(text, match, role_hint=""):
    start, end = match.span()
    if start > 0 and end < len(text) and text[start - 1].isspace() and text[end].isspace():
        return True

    left, right = _neighbor_segment(text, start, end)
    if not left or not right:
        return False

    if role_hint == "mpn":
        left_mpn, left_score, _ = _best_mpn_from_text(left)
        right_mpn, right_score, _ = _best_mpn_from_text(right)
        if left_mpn and right_mpn and left_score >= 0.45 and right_score >= 0.45:
            return True
        # A slash inside a mapped MPN column is still worth surfacing as a
        # teachable group. Some suppliers use it as revision/packaging text,
        # while others use it to list alternates; the user decides in review.
        return True

    if role_hint == "manufacturer":
        # Manufacturer names can contain compact slash aliases.
        # Do not turn those embedded aliases into an alternate split rule unless
        # the slash is written as a visible separator with spaces around it.
        return False

    return True


def _is_structural_delimiter(text, match, role_hint=""):
    label = _delimiter_label(match)
    if label == "slash":
        return _looks_like_structural_slash(text, match, role_hint)

    left, right = _neighbor_segment(text, *match.span())
    if not left or not right:
        return False

    if role_hint == "manufacturer":
        left_manufacturer, left_score, _ = _best_manufacturer_from_text(left)
        right_manufacturer, right_score, _ = _best_manufacturer_from_text(right)
        return bool(left_manufacturer and right_manufacturer and left_score >= 0.55 and right_score >= 0.55)

    if role_hint == "mpn":
        left_mpn, left_score, _ = _best_mpn_from_text(left)
        right_mpn, right_score, _ = _best_mpn_from_text(right)
        return bool(left_mpn and right_mpn and left_score >= 0.45 and right_score >= 0.45)

    if label in {"dash", "\\n", "\\t"}:
        return True

    # Treat punctuation as a structural separator only when it sits between two
    # meaningful chunks. A trailing comma in "CORP.," or the percent in "10%"
    # should not create a separate pattern group by itself.
    return True


def _delimiter_events_for_value(value, role_hint=""):
    text = clean(value)
    if not text:
        return []

    events = []
    for match in STRUCTURAL_DELIMITER_RE.finditer(text):
        label = _delimiter_label(match)
        if _is_structural_delimiter(text, match, role_hint):
            events.append(label)
    return events


def _split_on_structural_delimiters(value, role_hint=""):
    text = clean(value)
    if not text:
        return []

    spans = []
    for match in STRUCTURAL_DELIMITER_RE.finditer(text):
        if not _is_structural_delimiter(text, match, role_hint):
            continue
        spans.append(match.span())

    if not spans:
        return [text]

    parts = []
    cursor = 0
    for start, end in spans:
        part = clean(text[cursor:start])
        if part:
            parts.append(part)
        cursor = end
    tail = clean(text[cursor:])
    if tail:
        parts.append(tail)
    return parts


def _identity_cell_signature(value, role_hints):
    text = clean(value)
    roles = "+".join(sorted(set(role_hints or []))) or "source"
    if is_blankish(text):
        return f"{roles}:blank"

    identity_roles = set(role_hints or []) & {"cpn", "mpn", "manufacturer"}
    primary_role = (
        "packed" if len(identity_roles) > 1
        else "mpn" if "mpn" in role_hints
        else "manufacturer" if "manufacturer" in role_hints
        else "cpn" if "cpn" in role_hints
        else ""
    )
    delimiters = _delimiter_events_for_value(text, primary_role)
    parts = _split_on_structural_delimiters(text, primary_role)
    token_count = len([part for part in parts if not is_blankish(part)])
    presence = "multi" if token_count > 1 else "single"
    sequence = ">".join(delimiters) if delimiters else "none"
    delimiter_set = ",".join(sorted(set(delimiters))) if delimiters else "none"

    return (
        f"{roles}:{presence}:tokens={token_count}:"
        f"delims={delimiter_set}:seq={sequence}"
    )


def _structural_identity_cell_signature(value, role_hints):
    text = clean(value)
    if is_blankish(text):
        return ""

    identity_roles = set(role_hints or []) & {"cpn", "mpn", "manufacturer"}
    packed_signature = _packed_identity_repeat_signature(text, role_hints)
    if packed_signature:
        return packed_signature
    parenthesized_signature = _parenthesized_identity_repeat_signature(text, role_hints)
    if parenthesized_signature:
        return parenthesized_signature

    role_hint = (
        "packed" if len(identity_roles) > 1
        else "mpn" if "mpn" in role_hints
        else "manufacturer" if "manufacturer" in role_hints
        else "cpn" if "cpn" in role_hints
        else ""
    )
    delimiters = _delimiter_events_for_value(text, role_hint)
    if not delimiters:
        return ""

    roles = "+".join(sorted(set(role_hints or []))) or "source"
    parts = _split_on_structural_delimiters(text, role_hint)
    token_count = len([part for part in parts if not is_blankish(part)])
    token_bucket = "multi" if token_count > 1 else "single"
    sequence = _normalized_delimiter_sequence(delimiters)
    delimiter_set = ",".join(sorted(set(delimiters)))
    return f"{roles}:tokens={token_bucket}:delims={delimiter_set}:seq={sequence}"


def _packed_identity_repeat_signature(value, role_hints):
    roles = set(role_hints or []) & {"mpn", "manufacturer", "cpn"}
    if not {"mpn", "manufacturer"}.issubset(roles):
        return ""

    text = clean(value)
    pairs = _same_cell_packed_mpn_manufacturer_pairs(text)
    if not pairs:
        return ""

    pair_delimiters = [
        _delimiter_name(pair.get("_pairDelimiter"))
        for pair in pairs
        if clean(pair.get("_pairDelimiter"))
    ]
    pair_delimiter = _normalized_delimiter_sequence(pair_delimiters) if pair_delimiters else "pair"

    entry_delimiters = [
        _delimiter_name(pair.get("_entryDelimiter"))
        for pair in pairs
        if clean(pair.get("_entryDelimiter"))
    ]
    entry_delimiter = _normalized_delimiter_sequence(entry_delimiters) if entry_delimiters else "single"

    role_key = "+".join(sorted(set(role_hints or []))) or "source"
    return (
        f"{role_key}:packed_pair:"
        f"pair_delim={_delimiter_name(pair_delimiter)}:"
        f"entry_delim={_delimiter_name(entry_delimiter)}:"
        "annotations=optional"
    )


def _parenthesized_identity_repeat_signature(value, role_hints):
    roles = set(role_hints or []) & {"mpn", "manufacturer", "cpn"}
    if not {"mpn", "manufacturer"}.issubset(roles):
        return ""

    text = clean(value)
    pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(text)
    if not pairs:
        return ""

    source_forms = []
    for pair in pairs:
        source_fragment = clean(pair.get("_sourceFragment"))
        parenthesized_matches = list(re.finditer(r"\(([^()]*)\)", source_fragment))
        parenthesized_groups = [match.group(1) for match in parenthesized_matches]
        if not parenthesized_groups:
            source_form = "plain"
        else:
            before_first_group = source_fragment[:parenthesized_matches[0].start()].rstrip()
            if "@" in before_first_group:
                text_after_marker = before_first_group.rsplit("@", 1)[1].strip()
                attachment = "at_primary_suffix" if text_after_marker else "at_empty_suffix"
            else:
                attachment = (
                    "attached"
                    if parenthesized_matches[0].start() > 0 and not source_fragment[parenthesized_matches[0].start() - 1].isspace()
                    else "spaced"
                )
            outside_groups = re.sub(r"\([^()]*\)", "()", source_fragment)
            between_group_delimiters = [
                _delimiter_name(match.group(0).strip())
                for match in re.finditer(r"(?<=\))\s*[/\\,;|^~%]\s*(?=[^()]*(?:\(|$))", outside_groups)
            ]
            source_form = (
                f"{attachment}_parenthesized_{len(parenthesized_groups)}:"
                f"between={_normalized_delimiter_sequence(between_group_delimiters)}"
            )
        if source_form not in source_forms:
            source_forms.append(source_form)

    suffix_presence = "with_mpn_suffix" if any(form != "plain" for form in source_forms) else "plain_mpn"
    source_form_signature = "+".join(sorted(source_forms))
    trailing_presence = "optional" if any(clean(pair.get("_trailingPattern")) for pair in pairs) else "none"
    role_key = "+".join(sorted(set(role_hints or []))) or "source"
    return (
        f"{role_key}:parenthesized_pair:"
        f"mpn={suffix_presence}:"
        f"source_forms={source_form_signature}:"
        f"trailing={trailing_presence}"
    )


def _normalized_delimiter_sequence(delimiters):
    """Keep delimiter order meaningful, but do not split groups by repeat count."""
    cleaned = [clean(delimiter) for delimiter in (delimiters or []) if clean(delimiter)]
    if not cleaned:
        return "none"

    for width in range(1, len(cleaned) + 1):
        unit = cleaned[:width]
        if all(cleaned[index] == unit[index % width] for index in range(len(cleaned))):
            return ">".join(unit)

    return ">".join(cleaned)


def _primary_identity_pattern_sources(roles):
    sources = []
    for role in ("cpn", "mpn", "manufacturer"):
        header = clean((roles or {}).get(role))
        if header:
            sources.append(("primary", role, header))
    return sources


def _group_sources_by_header(sources):
    grouped = {}
    for scope, role, header in sources:
        key = (scope, header)
        if key not in grouped:
            grouped[key] = []
        if role not in grouped[key]:
            grouped[key].append(role)
    return [(scope, header, grouped[(scope, header)]) for scope, header in grouped]


def _identity_pattern_sources(roles, config=None):
    config = config or {}
    sources = _primary_identity_pattern_sources(roles)

    for index, group in enumerate(_configured_alternate_column_groups(config), start=1):
        for role in ("cpn", "mpn", "manufacturer"):
            header = clean(group.get(role))
            if header:
                sources.append((f"alt{index}", role, header))

    return _group_sources_by_header(sources)


def _pattern_shape_for_row(row, headers, roles, selected_columns, config=None):
    identity_parts = [
        f"identity={clean((config or {}).get('identityLayout') or '') or 'auto'}",
        f"row={clean((config or {}).get('rowPlacement') or '') or 'same_row'}",
        f"alternates={clean((config or {}).get('alternateLayout') or '') or 'none'}",
    ]
    structural_parts = []

    for scope, header, role_hints in _group_sources_by_header(_primary_identity_pattern_sources(roles)):
        if header not in headers:
            continue
        value = _row_cell(row, header, headers)
        signature = _structural_identity_cell_signature(value, role_hints)
        if signature:
            structural_parts.append(f"{scope}.{'+'.join(role_hints)}={signature}")

    if clean((config or {}).get("alternateLayout") or (config or {}).get("alternate_layout")) == "separate_columns":
        for index, group in enumerate(_configured_alternate_column_groups(config), start=1):
            mpn_header = clean(group.get("mpn"))
            mpn_value = _row_cell(row, mpn_header, headers) if mpn_header in headers else ""
            if is_blankish(mpn_value):
                continue
            sources = []
            for role in ("cpn", "mpn", "manufacturer"):
                header = clean(group.get(role))
                if header:
                    sources.append((f"alt{index}", role, header))
            for scope, header, role_hints in _group_sources_by_header(sources):
                if header not in headers:
                    continue
                value = _row_cell(row, header, headers)
                signature = _structural_identity_cell_signature(value, role_hints)
                if signature:
                    structural_parts.append(f"{scope}.{'+'.join(role_hints)}={signature}")
    else:
        for scope, header, role_hints in _identity_pattern_sources(roles, config):
            if scope == "primary" or header not in headers:
                continue
            value = _row_cell(row, header, headers)
            signature = _structural_identity_cell_signature(value, role_hints)
            if signature:
                structural_parts.append(f"{scope}.{'+'.join(role_hints)}={signature}")

    if structural_parts:
        return " | ".join(identity_parts + structural_parts)

    if _primary_identity_pattern_sources(roles):
        return " | ".join(identity_parts + ["pattern=no_structural_delimiters"])

    role_by_header = {}
    for role, header in (roles or {}).items():
        if header and header not in role_by_header:
            role_by_header[header] = role
        elif header and role_by_header.get(header) in {"mpn", "manufacturer", "cpn"} and role in {"mpn", "manufacturer", "cpn"}:
            role_by_header[header] = "packed"

    pieces = []
    for header in selected_columns:
        value = _row_cell(row, header, headers)
        pieces.append(f"{header}={_value_shape(value, role_by_header.get(header, ''))}")
    return " | ".join(pieces)


def _pattern_rule_for_shape(options=None, shape=""):
    rules = {}
    for key in ("fieldPatternRules", "field_pattern_rules", "patternRules", "pattern_rules"):
        value = (options or {}).get(key)
        if isinstance(value, dict):
            rules.update(value)
    rule = rules.get(shape)
    if not isinstance(rule, dict):
        return {}
    return rule


def _config_for_pattern_shape(config=None, options=None, shape=""):
    rule = _pattern_rule_for_shape(options, shape)
    if not rule:
        return config or {}
    next_config = dict(config or {})
    next_config["_activeFieldPatternRule"] = rule
    return next_config


def _config_with_active_rule(config=None, rule=None):
    existing_active = (config or {}).get("_activeFieldPatternRule") or (config or {}).get("_active_field_pattern_rule")
    if isinstance(existing_active, dict):
        rule = _merge_pattern_rules(rule or {}, existing_active)
    if not rule:
        return config or {}
    next_config = dict(config or {})
    next_config["_activeFieldPatternRule"] = rule
    return next_config


def _merge_pattern_rules(base=None, override=None):
    base = base if isinstance(base, dict) else {"fields": {}}
    override = override if isinstance(override, dict) else {"fields": {}}
    merged = {
        **base,
        "fields": {
            **(base.get("fields") if isinstance(base.get("fields"), dict) else {}),
        },
    }
    for field, rule in (override.get("fields") if isinstance(override.get("fields"), dict) else {}).items():
        existing = merged["fields"].get(field) if isinstance(merged["fields"].get(field), dict) else {}
        next_rule = {**existing, **rule}
        override_delimiter = clean(
            rule.get("delimiterMode")
            or rule.get("delimiter_mode")
            or rule.get("delimiter")
        )
        if override_delimiter == "none":
            for key in ("stripPrefix", "strip_prefix", "prefix", "prefixMode", "prefix_mode"):
                if key not in rule:
                    next_rule.pop(key, None)
        merged["fields"][field] = next_rule
    if override.get("shape"):
        merged["shape"] = override.get("shape")
    elif base.get("shape"):
        merged["shape"] = base.get("shape")
    identity_groups = _merge_identity_group_rules(
        base.get("identityGroups") or base.get("identity_groups"),
        override.get("identityGroups") or override.get("identity_groups"),
    )
    if identity_groups:
        merged["identityGroups"] = identity_groups
    expansion_rules = _merge_expansion_rules(
        base.get("expansions") or base.get("expansionRules") or base.get("expansion_rules"),
        override.get("expansions") or override.get("expansionRules") or override.get("expansion_rules"),
    )
    if expansion_rules:
        merged["expansions"] = expansion_rules
    visual_pattern = override.get("visualPattern") or override.get("visual_pattern")
    if isinstance(visual_pattern, dict) and visual_pattern:
        merged["visualPattern"] = dict(visual_pattern)
    elif isinstance(base.get("visualPattern") or base.get("visual_pattern"), dict):
        merged["visualPattern"] = dict(base.get("visualPattern") or base.get("visual_pattern"))
    return merged


def _expansion_rule_key(rule):
    if not isinstance(rule, dict):
        return None
    return (
        clean(rule.get("type")),
        clean(rule.get("role") or rule.get("sourceRole") or rule.get("source_role")),
        clean(rule.get("anchor")),
        clean(rule.get("suffixDelimiter") or rule.get("suffix_delimiter") or rule.get("delimiter")),
        str(rule.get("suffixGroupIndex") or rule.get("suffix_group_index") or ""),
    )


def _merge_expansion_rules(base_rules=None, override_rules=None):
    base_rules = base_rules if isinstance(base_rules, list) else []
    override_rules = override_rules if isinstance(override_rules, list) else []
    merged_rules = []
    positions_by_key = {}

    for rule in base_rules:
        if not isinstance(rule, dict):
            continue
        key = _expansion_rule_key(rule)
        if key is not None:
            positions_by_key[key] = len(merged_rules)
        merged_rules.append(dict(rule))

    for rule in override_rules:
        if not isinstance(rule, dict):
            continue
        key = _expansion_rule_key(rule)
        if key is not None and key in positions_by_key:
            index = positions_by_key[key]
            merged_rules[index] = {**merged_rules[index], **rule}
            continue
        if key is not None:
            positions_by_key[key] = len(merged_rules)
        merged_rules.append(dict(rule))

    return merged_rules


def _identity_group_rule_key(rule):
    if not isinstance(rule, dict):
        return None
    header = clean(rule.get("header") or rule.get("sourceColumn") or rule.get("source_column"))
    roles = tuple(sorted(clean(role) for role in (rule.get("roles") or []) if clean(role)))
    if not header and not roles:
        return None
    return header, roles


def _merge_identity_group_rules(base_groups=None, override_groups=None):
    base_groups = base_groups if isinstance(base_groups, list) else []
    override_groups = override_groups if isinstance(override_groups, list) else []
    merged_groups = []
    positions_by_key = {}

    for group in base_groups:
        if not isinstance(group, dict):
            continue
        key = _identity_group_rule_key(group)
        if key is not None:
            positions_by_key[key] = len(merged_groups)
        merged_groups.append(dict(group))

    for group in override_groups:
        if not isinstance(group, dict):
            continue
        key = _identity_group_rule_key(group)
        if key is not None and key in positions_by_key:
            index = positions_by_key[key]
            merged_groups[index] = {**merged_groups[index], **group}
        else:
            if key is not None:
                positions_by_key[key] = len(merged_groups)
            merged_groups.append(dict(group))

    return merged_groups


def _rule_for_single_field(role, rule):
    return {"fields": {role: rule or {}}}


def _field_pattern_rule_has_content(rule):
    if not isinstance(rule, dict):
        return False
    return bool(
        (rule.get("fields") if isinstance(rule.get("fields"), dict) else {})
        or (rule.get("identityGroups") if isinstance(rule.get("identityGroups"), list) else [])
        or (rule.get("identity_groups") if isinstance(rule.get("identity_groups"), list) else [])
        or (rule.get("expansions") if isinstance(rule.get("expansions"), list) else [])
        or (rule.get("expansionRules") if isinstance(rule.get("expansionRules"), list) else [])
        or (rule.get("expansion_rules") if isinstance(rule.get("expansion_rules"), list) else [])
        or (rule.get("visualPattern") if isinstance(rule.get("visualPattern"), dict) else {})
        or (rule.get("visual_pattern") if isinstance(rule.get("visual_pattern"), dict) else {})
    )


def _field_pattern_rule_storage_name(shape):
    digest = hashlib.sha256(clean(shape).encode("utf-8")).hexdigest()[:16]
    return f"{FIELD_PATTERN_RULE_NAME_PREFIX} {digest}"


def load_saved_bom_field_pattern_rules():
    rules = {}
    try:
        from excel_mapper.models import ColumnRule
        stored_rules = ColumnRule.objects.filter(name__startswith=FIELD_PATTERN_RULE_NAME_PREFIX)
    except Exception:
        return rules

    for stored in stored_rules:
        payload = stored.rule or {}
        if not isinstance(payload, dict) or payload.get("rule_type") != "bom_field_pattern":
            continue
        shape = clean(payload.get("shape"))
        parser_rule = payload.get("parser_rule") if isinstance(payload.get("parser_rule"), dict) else {}
        if not shape or not _field_pattern_rule_has_content(parser_rule):
            continue
        rules[shape] = _merge_pattern_rules(rules.get(shape), parser_rule)
    return rules


def load_saved_bom_pattern_interpretations():
    """Return saved semantic rules with identity/version metadata for review."""
    interpretations = {}
    try:
        from excel_mapper.models import ColumnRule
        stored_rules = ColumnRule.objects.filter(name__startswith=FIELD_PATTERN_RULE_NAME_PREFIX)
    except Exception:
        return interpretations

    try:
        for stored in stored_rules:
            payload = stored.rule or {}
            if not isinstance(payload, dict) or payload.get("rule_type") != "bom_field_pattern":
                continue
            parser_rule = payload.get("parser_rule") if isinstance(payload.get("parser_rule"), dict) else {}
            pattern_key = clean(payload.get("pattern_key") or parser_rule.get("patternKey") or parser_rule.get("pattern_key"))
            if not pattern_key or not _field_pattern_rule_has_content(parser_rule):
                continue
            interpretations[pattern_key] = {
                "patternKey": pattern_key,
                "ruleId": stored.id,
                "version": int(payload.get("version") or 1),
                "updatedAt": stored.updated_at.isoformat() if stored.updated_at else None,
                "rule": parser_rule,
            }
    except Exception:
        return {}
    return interpretations


def save_bom_field_pattern_rule(rule, description="User-taught BOM field pattern"):
    if not _field_pattern_rule_has_content(rule):
        return None
    shape = clean(rule.get("shape"))
    pattern_key = clean(rule.get("patternKey") or rule.get("pattern_key"))
    if not shape and not pattern_key:
        return None
    parser_rule = {
        "shape": shape,
        "fields": rule.get("fields") if isinstance(rule.get("fields"), dict) else {},
    }
    if pattern_key:
        parser_rule["patternKey"] = pattern_key
    identity_groups = rule.get("identityGroups") or rule.get("identity_groups")
    if isinstance(identity_groups, list) and identity_groups:
        parser_rule["identityGroups"] = identity_groups
    expansions = rule.get("expansions") or rule.get("expansionRules") or rule.get("expansion_rules")
    if isinstance(expansions, list) and expansions:
        parser_rule["expansions"] = expansions
    visual_pattern = rule.get("visualPattern") or rule.get("visual_pattern")
    if isinstance(visual_pattern, dict) and visual_pattern:
        parser_rule["visualPattern"] = dict(visual_pattern)

    try:
        from excel_mapper.models import ColumnRule
        storage_identity = f"pattern:{pattern_key}" if pattern_key else shape
        storage_name = _field_pattern_rule_storage_name(storage_identity)
        existing = ColumnRule.objects.filter(name=storage_name).first()
        existing_payload = existing.rule if existing and isinstance(existing.rule, dict) else {}
        version = int(existing_payload.get("version") or 0) + 1
        saved, created = ColumnRule.objects.update_or_create(
            name=storage_name,
            defaults={
                "description": description,
                "rule": {
                    "rule_type": "bom_field_pattern",
                    "shape": shape,
                    "pattern_key": pattern_key,
                    "version": version,
                    "parser_rule": parser_rule,
                },
            },
        )
        return {
            "id": saved.id,
            "created": created,
            "name": saved.name,
            "shape": shape,
            "patternKey": pattern_key,
            "version": version,
        }
    except Exception:
        return None


def _add_interpretation_span(spans, start, end, role, source_length):
    start = max(0, min(int(start or 0), source_length))
    end = max(start, min(int(end or 0), source_length))
    if end <= start or not clean(role):
        return
    span = {"start": start, "end": end, "role": clean(role)}
    if span not in spans:
        spans.append(span)


def _visual_pattern_interpretation_spans(value, visual_pattern):
    """Return backend-owned source ranges used by a saved visual interpretation."""
    text = str(value or "")
    if not text or not isinstance(visual_pattern, dict):
        return []
    pattern_type = clean(visual_pattern.get("type"))
    spans = []
    if pattern_type == "ignore_fields":
        _add_interpretation_span(spans, 0, len(text), "ignore", len(text))
        return spans

    group_separator = str(
        visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    group_ranges = []
    if group_separator:
        cursor = 0
        while cursor <= len(text):
            separator_index = text.find(group_separator, cursor)
            if separator_index < 0:
                group_ranges.append((cursor, len(text)))
                break
            group_ranges.append((cursor, separator_index))
            _add_interpretation_span(
                spans,
                separator_index,
                separator_index + len(group_separator),
                "groupSeparator",
                len(text),
            )
            cursor = separator_index + len(group_separator)
            if cursor == len(text):
                break
    else:
        group_ranges = [(0, len(text))]

    segments = visual_pattern.get("segments") or []
    if isinstance(segments, list) and segments:
        for group_start, group_end in group_ranges:
            group_text = text[group_start:group_end]
            cursor = 0
            for segment in segments:
                if not isinstance(segment, dict):
                    continue
                role = clean(segment.get("role"))
                if role not in set(ROLE_KEYS) | {"alternateList"}:
                    continue
                before = str(segment.get("before") or "")
                after = str(segment.get("after") or "")
                wrapper = segment.get("wrapper") if isinstance(segment.get("wrapper"), dict) else {}
                value_start = cursor
                if before:
                    before_index = group_text.find(before, cursor)
                    if before_index < 0:
                        break
                    value_start = before_index + len(before)
                while value_start < len(group_text) and group_text[value_start].isspace():
                    value_start += 1
                value_end = len(group_text)
                opening = str(wrapper.get("open") or "")
                closing = str(wrapper.get("close") or "")
                if opening and closing:
                    open_index = group_text.find(opening, value_start)
                    close_index = group_text.find(closing, open_index + len(opening)) if open_index >= 0 else -1
                    if open_index < 0 or close_index < 0:
                        break
                    value_start = open_index
                    value_end = close_index + len(closing)
                elif after:
                    after_index = group_text.find(after, value_start)
                    if after_index >= 0:
                        value_end = after_index
                if role == "mpn":
                    raw_mpn = group_text[value_start:value_end]
                    candidate, ignored_prefix, _source_fragment = (
                        _split_mpn_fragment_before_parenthesized_manufacturer(raw_mpn)
                    )
                    if candidate and ignored_prefix:
                        candidate_start = raw_mpn.upper().rfind(candidate.upper())
                        if candidate_start < 0:
                            candidate_start = _mpn_fragment_start(raw_mpn, candidate)
                        value_start += candidate_start
                        value_end = value_start + len(candidate)
                _add_interpretation_span(
                    spans,
                    group_start + value_start,
                    group_start + value_end,
                    role,
                    len(text),
                )
                cursor = value_end
        return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))

    if pattern_type not in {"bracket_alternate_manufacturer", "bracket_manufacturer"}:
        return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))

    preserve_outer_brackets = (
        visual_pattern.get("preserveOuterBrackets")
        or visual_pattern.get("preserve_outer_brackets")
        or {}
    )
    if not isinstance(preserve_outer_brackets, dict):
        preserve_outer_brackets = {}
    preserve_mpn_at = bool(
        visual_pattern.get("preserveMpnAt")
        or visual_pattern.get("preserve_mpn_at")
    )
    for group_start, group_end in group_ranges:
        group_text = text[group_start:group_end]
        brackets = list(re.finditer(r"\(([^)]*)\)", group_text))
        if not brackets:
            continue
        _base_mpn, base_start, base_end = _visual_base_mpn_fragment(
            group_text[:brackets[0].start()],
            preserve_mpn_at=preserve_mpn_at,
        )
        _add_interpretation_span(
            spans,
            group_start + base_start,
            group_start + base_end,
            "mpn",
            len(text),
        )

        role_by_bracket = []
        if pattern_type == "bracket_manufacturer":
            role_by_bracket = [(brackets[0], "manufacturer")]
        elif len(brackets) >= 2:
            role_by_bracket = [
                (brackets[0], "alternateList"),
                (brackets[1], "manufacturer"),
            ]
        else:
            bracket_value = clean(brackets[0].group(1))
            matched_manufacturer, score, _reason = _best_manufacturer_from_text(bracket_value)
            role_by_bracket = [(
                brackets[0],
                "manufacturer" if matched_manufacturer and float(score or 0) >= 0.65 else "alternateList",
            )]
        for bracket, role in role_by_bracket:
            preserve = preserve_outer_brackets.get(role)
            span_start = bracket.start() if preserve else bracket.start(1)
            span_end = bracket.end() if preserve else bracket.end(1)
            _add_interpretation_span(
                spans,
                group_start + span_start,
                group_start + span_end,
                role,
                len(text),
            )
    return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))


def _entry_interpretation_spans(value, source_header, entries, existing_spans=None):
    text = str(value or "")
    spans = list(existing_spans or [])
    occupied = {
        index
        for span in spans
        for index in range(int(span.get("start") or 0), int(span.get("end") or 0))
    }
    upper_text = text.upper()
    for entry in entries or []:
        fields = entry.get("fields") if isinstance(entry, dict) else {}
        for role in ROLE_KEYS:
            field = fields.get(role) if isinstance(fields, dict) else {}
            if not isinstance(field, dict) or clean(field.get("sourceColumn")) != clean(source_header):
                continue
            field_value = clean(field.get("value"))
            if not field_value:
                continue
            search_from = 0
            while search_from < len(text):
                start = upper_text.find(field_value.upper(), search_from)
                if start < 0:
                    break
                end = start + len(field_value)
                if not any(index in occupied for index in range(start, end)):
                    _add_interpretation_span(spans, start, end, role, len(text))
                    occupied.update(range(start, end))
                    break
                search_from = start + 1
    return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))


def _interpretation_spans_by_column(row, headers, source_columns, active_rule, entries):
    visual_pattern = (
        (active_rule or {}).get("visualPattern")
        or (active_rule or {}).get("visual_pattern")
        or {}
    )
    visual_source_header = clean(
        visual_pattern.get("sourceHeader")
        or visual_pattern.get("source_header")
    ) if isinstance(visual_pattern, dict) else ""
    spans_by_column = {}
    for source_header in source_columns or []:
        source_header = clean(source_header)
        if not source_header:
            continue
        source_value = _row_cell(row, source_header, headers, preserve_delimiters=True)
        visual_spans = (
            _visual_pattern_interpretation_spans(source_value, visual_pattern)
            if source_header == visual_source_header
            else []
        )
        spans = _entry_interpretation_spans(
            source_value,
            source_header,
            entries,
            existing_spans=visual_spans,
        )
        if spans:
            spans_by_column[source_header] = spans
    return spans_by_column


def _delimiter_candidates_for_values(values):
    candidates = [("auto", "auto")]
    raw_values = [str(value or "").replace("\u00a0", " ") for value in values or []]
    delimiter_tokens = [
        ("\\n", "\n"),
        ("/", "/"),
        (",", ","),
        (";", ";"),
        ("|", "|"),
        ("^", "^"),
        ("~", "~"),
    ]
    for delimiter, token in delimiter_tokens:
        if any(token in value for value in raw_values):
            candidates.append((delimiter, token))
    return candidates


def _prefix_rule_candidates_for_mpn_values(values):
    candidates = [{}]
    literal_counts = {}
    for value in values or []:
        for token in re.split(r"\s+", str(value or "").replace("\u00a0", " ").strip()):
            token = clean(token)
            if not token:
                continue
            scored = score_mpn_value(token)
            candidate = clean(scored.get("candidate") or "")
            if (
                candidate
                and len(candidate) < len(token)
                and token.upper().endswith(candidate.upper())
                and scored.get("matched")
            ):
                prefix = token[:len(token) - len(candidate)]
                if len(prefix) >= 2:
                    literal_counts[prefix] = literal_counts.get(prefix, 0) + 1

    for prefix, count in sorted(literal_counts.items(), key=lambda item: (-item[1], len(item[0]))):
        if count >= 2:
            candidates.append({"stripPrefix": prefix, "prefixMode": "literal"})

    token_lengths = [
        len(clean(token))
        for value in values or []
        for token in re.split(r"\s+", str(value or "").replace("\u00a0", " ").strip())
        if clean(token)
    ]
    max_prefix = min(12, max([length - 4 for length in token_lengths if length > 4] or [0]))
    for count in range(1, max_prefix + 1):
        candidates.append({"stripPrefix": str(count), "prefixMode": "first_n_chars"})

    unique = []
    seen = set()
    for candidate in candidates:
        key = tuple(sorted(candidate.items()))
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _score_mpn_rule(values, rule):
    config = _config_with_active_rule({}, _rule_for_single_field("mpn", rule))
    rows_with_split = 0
    total_parts = 0
    valid_parts = 0
    high_confidence_parts = 0
    clean_stripped_parts = 0
    exact_stripped_parts = 0
    bad_stripped_parts = 0
    prefix_applied_parts = 0
    prefix_candidate_parts = 0
    explicit_supported_rows = 0
    explicit_unsupported_rows = 0
    examples = []

    for value in values or []:
        if is_blankish(value):
            continue
        parts = _split_alternate_value(value, config, "mpn")
        if len(parts) <= 1:
            continue
        rows_with_split += 1
        total_parts += len(parts)
        examples.append(parts)

        configured_delimiter = _configured_delimiter(rule)
        if configured_delimiter:
            direct_parts = _split_explicit_delimiter(value, configured_delimiter)
            if len(direct_parts) > 1 and len(direct_parts) == len(parts):
                explicit_supported_rows += 1
            else:
                explicit_unsupported_rows += 1

        for part in parts:
            mpn, score, _ = _best_mpn_from_text(part)
            if mpn and score >= 0.45:
                valid_parts += 1
            if mpn and score >= 0.75:
                high_confidence_parts += 1

        if rule.get("stripPrefix"):
            raw_text = str(value or "").replace("\u00a0", " ").strip()
            raw_parts = []
            explicit_parts = _split_explicit_delimiter(raw_text, configured_delimiter)
            if len(explicit_parts) > 1:
                raw_parts = explicit_parts
            if len(raw_parts) <= 1:
                repeated_parts = _repeated_prefix_segments(raw_text, rule)
                if len(repeated_parts) > 1:
                    raw_parts = repeated_parts
            if len(raw_parts) <= 1:
                fixed_width_prefix_parts = _fixed_width_prefix_segments(raw_text, rule)
                if len(fixed_width_prefix_parts) > 1:
                    raw_parts = fixed_width_prefix_parts
            if len(raw_parts) <= 1 and re.search(r"\s", raw_text):
                whitespace_parts = [clean(part) for part in re.split(r"\s+", raw_text) if not is_blankish(part)]
                if len(whitespace_parts) > 1:
                    raw_parts = whitespace_parts

            for raw_part in raw_parts:
                prefix_candidate_parts += 1
                if _configured_prefix_applies(raw_part, rule):
                    prefix_applied_parts += 1
                stripped = _strip_configured_prefix(raw_part, rule)
                if not stripped:
                    continue
                if re.match(r"^[A-Za-z0-9]", stripped):
                    clean_stripped_parts += 1
                else:
                    bad_stripped_parts += 1
                scored = score_mpn_value(stripped)
                candidate = clean(scored.get("candidate") or "")
                if scored.get("exact_lookup") and candidate and candidate.upper() == stripped.upper():
                    exact_stripped_parts += 1

    if not rows_with_split or not total_parts:
        return {"score": 0.0, "rows": 0, "parts": 0, "examples": []}

    valid_rate = valid_parts / total_parts
    high_rate = high_confidence_parts / total_parts
    row_rate = rows_with_split / max(1, len([value for value in values or [] if not is_blankish(value)]))
    clean_stripped_rate = clean_stripped_parts / max(1, clean_stripped_parts + bad_stripped_parts)
    exact_stripped_rate = exact_stripped_parts / max(1, total_parts)
    bad_stripped_rate = bad_stripped_parts / max(1, clean_stripped_parts + bad_stripped_parts)
    prefix_application_rate = prefix_applied_parts / max(1, prefix_candidate_parts)
    part_count_bonus = min(1.6, max(0, total_parts - (rows_with_split * 2)) * 0.16)
    score = (
        (row_rate * 3.0)
        + (valid_rate * 4.0)
        + (high_rate * 1.5)
        + min(2.0, total_parts / max(1, rows_with_split))
        + part_count_bonus
    )
    if rule.get("stripPrefix"):
        score += (
            0.75
            + (prefix_application_rate * 0.70)
            + (clean_stripped_rate * 0.35)
            + (exact_stripped_rate * 0.45)
            - ((1.0 - prefix_application_rate) * 1.25)
            - (bad_stripped_rate * 1.0)
        )
    if rule.get("delimiter") and rule.get("delimiter") not in {"auto", "none"}:
        support_rate = explicit_supported_rows / max(1, explicit_supported_rows + explicit_unsupported_rows)
        score += (support_rate * 0.35) - ((1.0 - support_rate) * 0.75)
    return {
        "score": score,
        "rows": rows_with_split,
        "parts": total_parts,
        "valid_rate": valid_rate,
        "clean_stripped_rate": clean_stripped_rate,
        "bad_stripped_rate": bad_stripped_rate,
        "prefix_application_rate": prefix_application_rate,
        "explicit_supported_rows": explicit_supported_rows,
        "explicit_unsupported_rows": explicit_unsupported_rows,
        "examples": examples,
    }


def _discover_mpn_rule_for_values(values):
    best = ({}, {"score": 0.0})
    for delimiter, _token in _delimiter_candidates_for_values(values):
        for prefix_rule in _prefix_rule_candidates_for_mpn_values(values):
            rule = {"delimiter": delimiter, **prefix_rule}
            result = _score_mpn_rule(values, rule)
            if result["score"] > best[1]["score"]:
                best = (rule, result)
    if best[1]["score"] <= 0 or best[1].get("rows", 0) <= 0:
        return {}
    return best[0]


def _manufacturer_parts_for_rule(value, rule, target_count=0):
    config = _config_with_active_rule({}, _rule_for_single_field("manufacturer", rule))
    parts = _split_alternate_value(value, config, "manufacturer")
    if target_count and clean(rule.get("delimiter")) in {"", "auto"}:
        targeted = _manufacturer_segments_for_target_count(value, target_count)
        if targeted and len(targeted) <= target_count:
            parts = targeted
    return parts


def _score_manufacturer_rule(values, rule, target_counts=None):
    rows_with_split = 0
    total_parts = 0
    matched_parts = 0
    explicit_supported_rows = 0
    explicit_unsupported_rows = 0
    target_counts = target_counts or []
    value_count = len([value for value in values or [] if not is_blankish(value)])
    explicit_delimiter = _configured_delimiter(rule)

    for index, value in enumerate(values or []):
        if is_blankish(value):
            continue
        target_count = target_counts[index] if index < len(target_counts) else 0
        parts = _manufacturer_parts_for_rule(value, rule, target_count=target_count)
        if len(parts) <= 1:
            continue
        rows_with_split += 1
        total_parts += len(parts)

        if explicit_delimiter:
            direct_parts = _split_explicit_delimiter(value, explicit_delimiter)
            if len(direct_parts) > 1 and (not target_count or len(direct_parts) == target_count):
                explicit_supported_rows += 1
            else:
                explicit_unsupported_rows += 1

        for part in parts:
            scored = score_manufacturer_value(part)
            if scored.get("matched") and float(scored.get("score") or 0) >= 0.75:
                matched_parts += 1

    if not rows_with_split or not total_parts:
        return {"score": 0.0, "rows": 0, "parts": 0}

    matched_rate = matched_parts / total_parts
    row_rate = rows_with_split / max(1, value_count)
    score = (row_rate * 3.0) + (matched_rate * 4.5) + min(2.0, total_parts / max(1, rows_with_split))
    if rule.get("delimiter") and rule.get("delimiter") not in {"auto", "none"}:
        support_rate = explicit_supported_rows / max(1, explicit_supported_rows + explicit_unsupported_rows)
        score += (support_rate * 0.35) - ((1.0 - support_rate) * 1.25)
    return {
        "score": score,
        "rows": rows_with_split,
        "parts": total_parts,
        "matched_rate": matched_rate,
        "explicit_supported_rows": explicit_supported_rows,
        "explicit_unsupported_rows": explicit_unsupported_rows,
    }


def _discover_manufacturer_rule_for_values(values, target_counts=None):
    best = ({}, {"score": 0.0})
    for delimiter, _token in _delimiter_candidates_for_values(values):
        rule = {"delimiter": delimiter}
        result = _score_manufacturer_rule(values, rule, target_counts=target_counts)
        if result["score"] > best[1]["score"]:
            best = (rule, result)
    if best[1]["score"] <= 0 or best[1].get("rows", 0) <= 0:
        return {}
    return best[0]


def _identity_delimiter_candidates_for_values(values):
    candidates = [
        ("auto", []),
        ("colon_caret", [":", "^"]),
        (":", [":"]),
        ("^", ["^"]),
        ("|", ["|"]),
        (";", [";"]),
        (",", [","]),
        ("/", ["/"]),
        ("~", ["~"]),
        ("\\n", ["\n"]),
    ]
    raw_values = [str(value or "").replace("\u00a0", " ") for value in values or []]
    return [
        (label, delimiters)
        for label, delimiters in candidates
        if label == "auto" or any(any(delimiter in value for delimiter in delimiters) for value in raw_values)
    ]


def _split_identity_value_for_candidate(value, delimiters):
    text = str(value or "").replace("\u00a0", " ").strip()
    if not text or not delimiters:
        return []
    pattern = "|".join(re.escape(delimiter) for delimiter in delimiters)
    return [clean(part) for part in re.split(pattern, text) if not is_blankish(part)]


def _discover_identity_group_rule_for_values(values, roles):
    best = (None, {"score": 0.0})
    role_count = len(roles or [])
    if role_count < 2:
        return {}

    for delimiter, delimiters in _identity_delimiter_candidates_for_values(values):
        if delimiter == "auto":
            continue
        rows_with_split = 0
        total_score = 0.0
        discovered_orders = {}
        for value in values or []:
            parts = _split_identity_value_for_candidate(value, delimiters)
            if len(parts) < role_count:
                continue
            order = _guess_identity_order(parts[:role_count], roles)
            if len(order) < role_count:
                continue
            rows_with_split += 1
            order_key = tuple(order)
            discovered_orders[order_key] = discovered_orders.get(order_key, 0) + 1
            total_score += sum(
                _score_identity_part_for_role(part, role)
                for part, role in zip(parts, order)
            )

        if not rows_with_split or not discovered_orders:
            continue
        order, order_count = sorted(discovered_orders.items(), key=lambda item: (-item[1], item[0]))[0]
        score = (rows_with_split * 2.0) + total_score + (order_count * 1.5)
        if score > best[1]["score"]:
            best = ({
                "delimiter": delimiter,
                "roles": list(roles),
                "order": list(order),
            }, {"score": score, "rows": rows_with_split})

    return best[0] or {}


def _discover_field_pattern_rule_for_group(group, headers, roles, config=None, sample_limit=20):
    samples = group.get("_rawSamples") or []
    if not samples:
        return {"fields": {}}

    rule = {"fields": {}}
    discovery_samples = _select_raw_field_pattern_samples(samples, sample_limit)
    sample_rows = [sample.get("row") for sample in discovery_samples]

    identity_groups = []
    for group_info in _same_cell_identity_groups(roles):
        header = group_info["header"]
        values = [
            _row_cell(row, header, headers, preserve_delimiters=True)
            for row in sample_rows
        ]
        group_rule = _discover_identity_group_rule_for_values(values, group_info["roles"])
        if group_rule:
            identity_groups.append({
                "header": header,
                **group_rule,
            })
    if identity_groups:
        rule["identityGroups"] = identity_groups

    mpn_header = clean((roles or {}).get("mpn"))
    manufacturer_header = clean((roles or {}).get("manufacturer"))

    mpn_values = [
        _row_cell(row, mpn_header, headers, preserve_delimiters=True)
        for row in sample_rows
        if mpn_header
    ]
    mpn_rule = _discover_mpn_rule_for_values(mpn_values)
    if mpn_rule:
        rule["fields"]["mpn"] = mpn_rule

    target_counts = []
    if mpn_header:
        mpn_config = _config_with_active_rule(config, _rule_for_single_field("mpn", mpn_rule)) if mpn_rule else (config or {})
        for row in sample_rows:
            value = _row_cell(row, mpn_header, headers, preserve_delimiters=True)
            parts = _split_alternate_value(value, mpn_config, "mpn")
            target_counts.append(len(parts) if len(parts) > 1 else 0)

    manufacturer_values = [
        _row_cell(row, manufacturer_header, headers, preserve_delimiters=True)
        for row in sample_rows
        if manufacturer_header
    ]
    manufacturer_rule = _discover_manufacturer_rule_for_values(manufacturer_values, target_counts=target_counts)
    if manufacturer_rule:
        rule["fields"]["manufacturer"] = manufacturer_rule

    return rule


def _delimiter_rule_for_value(value, parts):
    raw_text = str(value or "").replace("\u00a0", " ").strip()
    clean_parts = [clean(part) for part in (parts or []) if not is_blankish(part)]
    if len(clean_parts) <= 1:
        return {}
    if "\n" in raw_text or "\r" in raw_text:
        return {"delimiter": "\\n"}
    delimiter_candidates = [
        (" / ", "/"),
        ("/", "/"),
        (" | ", "|"),
        ("|", "|"),
        (";", ";"),
        (",", ","),
        ("^", "^"),
        ("~", "~"),
    ]
    for token, delimiter in delimiter_candidates:
        if token in raw_text:
            split_count = len([part for part in raw_text.split(token) if clean(part)])
            if split_count >= len(clean_parts):
                return {"delimiter": delimiter}
    return {"delimiter": "auto"}


def _corrected_values_for_role(entries, role):
    values = []
    for entry in entries or []:
        fields = entry.get("fields") if isinstance(entry, dict) else {}
        value = fields.get(role) if isinstance(fields, dict) else ""
        if isinstance(value, dict):
            value = value.get("value")
        value = clean(value)
        if value:
            values.append(value)
    return values


def _split_source_for_taught_values(value, corrected_values):
    text = str(value or "").replace("\u00a0", " ").strip()
    if not text or not corrected_values:
        return "", []
    delimiter_candidates = [
        ("\\n", "\n"),
        ("/", "/"),
        ("|", "|"),
        (";", ";"),
        (",", ","),
        ("^", "^"),
        ("~", "~"),
    ]
    for delimiter, token in delimiter_candidates:
        if token not in text:
            continue
        parts = [clean(part) for part in text.split(token) if not is_blankish(part)]
        if len(parts) >= len(corrected_values):
            return delimiter, parts
    parts = [clean(part) for part in re.split(r"\s+", text) if not is_blankish(part)]
    return "auto", parts


def _derive_prefix_rule_from_taught_values(value, corrected_values):
    delimiter, source_parts = _split_source_for_taught_values(value, corrected_values)
    if not source_parts or not corrected_values:
        return {}

    prefixes = []
    used_indexes = set()
    for corrected in corrected_values:
        corrected_key = re.sub(r"[^A-Z0-9]+", "", corrected.upper())
        if not corrected_key:
            continue
        match_index = None
        match_prefix = ""
        for index, part in enumerate(source_parts):
            if index in used_indexes:
                continue
            part_key = re.sub(r"[^A-Z0-9]+", "", part.upper())
            if not part_key.endswith(corrected_key) or len(part_key) <= len(corrected_key):
                continue
            raw_position = part.upper().replace(" ", "").rfind(corrected.upper().replace(" ", ""))
            if raw_position >= 0:
                match_prefix = part[:raw_position]
            else:
                match_prefix = part[:max(0, len(part) - len(corrected))]
            match_index = index
            break
        if match_index is None:
            continue
        used_indexes.add(match_index)
        prefixes.append(clean(match_prefix))

    prefixes = [prefix for prefix in prefixes if prefix]
    if len(prefixes) < max(1, min(2, len(corrected_values))):
        return {}
    if len(set(prefixes)) == 1:
        return {"stripPrefix": prefixes[0], "prefixMode": "literal"}
    prefix_lengths = {len(prefix) for prefix in prefixes}
    if len(prefix_lengths) == 1:
        return {"stripPrefix": str(prefix_lengths.pop()), "prefixMode": "first_n_chars"}
    return {}


def _common_prefix_case_insensitive(values):
    clean_values = [clean(value) for value in values or [] if clean(value)]
    if not clean_values:
        return ""
    prefix = clean_values[0]
    for value in clean_values[1:]:
        max_len = min(len(prefix), len(value))
        index = 0
        while index < max_len and prefix[index].upper() == value[index].upper():
            index += 1
        prefix = prefix[:index]
        if not prefix:
            break
    return clean(prefix)


def _derive_mpn_suffix_expansion_rule(value, corrected_values, corrected_manufacturers=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    mpn_values = [clean(value) for value in corrected_values or [] if not is_blankish(value)]
    if len(mpn_values) <= 1 or is_blankish(text):
        return {}

    base = _common_prefix_case_insensitive(mpn_values)
    while base and not re.search(r"\d", base):
        base = base[:-1]
    if len(_token_key(base)) < 4:
        return {}
    base_index = text.upper().find(base.upper())
    if base_index < 0:
        return {}

    suffix_values = []
    for mpn in mpn_values:
        if not mpn.upper().startswith(base.upper()):
            return {}
        suffix_values.append(clean(mpn[len(base):]))
    if len({suffix.upper() for suffix in suffix_values}) <= 1:
        return {}

    groups = _bracket_groups(text, base_index + len(base))
    if not groups:
        return {}

    delimiters = ["/", "|", ";", ",", "^", "~", "\\", ":"]
    suffix_keys = [_token_key(suffix) for suffix in suffix_values]
    suffix_group_index = -1
    suffix_delimiter = ""
    empty_token_means_base = False
    for group_index, group in enumerate(groups):
        content = group.get("content") or ""
        for delimiter in delimiters:
            if delimiter not in content:
                continue
            raw_tokens = content.split(delimiter)
            tokens = [clean(token) for token in raw_tokens]
            candidate_tokens = []
            if raw_tokens and clean(raw_tokens[0]) == "":
                candidate_tokens.append("")
            candidate_tokens.extend([token for token in tokens if token])
            candidate_keys = [_token_key(token) for token in candidate_tokens]
            if candidate_keys == suffix_keys:
                suffix_group_index = group_index
                suffix_delimiter = delimiter
                empty_token_means_base = bool(candidate_tokens and candidate_tokens[0] == "")
                break
        if suffix_group_index >= 0:
            break
    if suffix_group_index < 0:
        return {}

    anchor = clean(text[base_index + len(base):groups[suffix_group_index]["start"]])
    if len(anchor) > 20:
        anchor = ""
    manufacturer_group_index = 0
    manufacturer_values = [
        clean(value)
        for value in corrected_manufacturers or []
        if not is_blankish(value)
    ]
    preferred_manufacturer = manufacturer_values[0] if manufacturer_values else ""
    for group_index, group in enumerate(groups):
        if group_index == suffix_group_index:
            continue
        candidate = clean(group.get("content"))
        if not candidate:
            continue
        matched, score, _reason = _best_manufacturer_from_text(candidate)
        if (
            (preferred_manufacturer and _token_key(candidate) == _token_key(preferred_manufacturer))
            or (matched and float(score or 0) >= 0.55)
        ):
            manufacturer_group_index = group_index + 1
            break

    return {
        "type": "base_suffix_alternates",
        "role": "mpn",
        "anchor": anchor,
        "suffixGroupIndex": suffix_group_index + 1,
        "suffixDelimiter": suffix_delimiter,
        "emptyToken": "base" if empty_token_means_base else "ignore",
        "combine": "append_to_base",
        "manufacturerGroupIndex": manufacturer_group_index,
    }


def _derive_taught_field_rule(value, corrected_values, role):
    values = [clean(value) for value in corrected_values or [] if not is_blankish(value)]
    if not values:
        return {}
    rule = _delimiter_rule_for_value(value, values)
    if len(values) <= 1 or len({item.upper() for item in values}) <= 1:
        rule = {"delimiter": "none"}
    elif role == "manufacturer":
        # Manufacturer names often contain spaces and multi-word aliases. Let
        # backend directory spans align them to the taught MPN count.
        rule = {"delimiter": rule.get("delimiter") if rule.get("delimiter") not in {"", "none"} else "auto"}
    if role == "mpn":
        prefix_rule = _derive_prefix_rule_from_taught_values(value, values)
        if prefix_rule:
            rule.update(prefix_rule)
    return rule


def derive_bom_field_pattern_rule_from_correction(
    headers,
    row,
    roles=None,
    entries=None,
    group=None,
    visual_pattern=None,
    has_manual_edits=False,
):
    """Derive reusable backend parser rules from one corrected teach-popup row."""
    safe_headers = [clean(header) for header in (headers or [])]
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    corrected_entries = entries if isinstance(entries, list) else []
    rule = {
        "shape": clean((group or {}).get("shape") or ""),
        "fields": {},
        "expansions": [],
    }
    pattern_key = clean((group or {}).get("patternKey") or (group or {}).get("pattern_key"))
    if pattern_key:
        rule["patternKey"] = pattern_key
    if isinstance(visual_pattern, dict) and visual_pattern:
        taught_visual_pattern = dict(visual_pattern)
        source_header = clean(
            taught_visual_pattern.get("sourceHeader")
            or taught_visual_pattern.get("source_header")
        )
        source_value = _row_cell(row, source_header, safe_headers, preserve_delimiters=True) if source_header else ""
        segment_roles = {
            clean(segment.get("role"))
            for segment in (taught_visual_pattern.get("segments") or [])
            if isinstance(segment, dict) and clean(segment.get("role")) in ROLE_KEYS
        }
        mapped_roles = {
            role
            for role, header in safe_roles.items()
            if source_header and header == source_header
        } | segment_roles
        manual_entries = []
        for entry in corrected_entries:
            fields = entry.get("fields") if isinstance(entry, dict) and isinstance(entry.get("fields"), dict) else {}
            manual_entries.append({
                "relation": clean(entry.get("relation")) if isinstance(entry, dict) else "",
                "fields": {
                    role: clean(fields.get(role).get("value") if isinstance(fields.get(role), dict) else fields.get(role))
                    for role in mapped_roles
                },
            })
        if source_value and manual_entries and mapped_roles and has_manual_edits:
            corrections = [
                correction
                for correction in (taught_visual_pattern.get("manualCorrections") or [])
                if (
                    isinstance(correction, dict)
                    and correction.get("userEdited") is True
                    and clean(correction.get("sourceValue")) != clean(source_value)
                )
            ]
            corrections.append({
                "sourceValue": source_value,
                "entries": manual_entries,
                "userEdited": True,
            })
            taught_visual_pattern["manualCorrections"] = corrections
        else:
            confirmed_corrections = [
                correction
                for correction in (taught_visual_pattern.get("manualCorrections") or [])
                if isinstance(correction, dict) and correction.get("userEdited") is True
            ]
            if confirmed_corrections:
                taught_visual_pattern["manualCorrections"] = confirmed_corrections
            else:
                taught_visual_pattern.pop("manualCorrections", None)
                taught_visual_pattern.pop("manual_corrections", None)
        rule["visualPattern"] = taught_visual_pattern

    for role in ("cpn", "mpn", "manufacturer"):
        header = clean(safe_roles.get(role))
        if not header or header not in safe_headers:
            continue
        corrected_values = _corrected_values_for_role(corrected_entries, role)
        source_value = _row_cell(row, header, safe_headers, preserve_delimiters=True)
        field_rule = _derive_taught_field_rule(source_value, corrected_values, role)
        if field_rule:
            rule["fields"][role] = field_rule
        if role == "mpn":
            expansion_rule = _derive_mpn_suffix_expansion_rule(
                source_value,
                corrected_values,
                _corrected_values_for_role(corrected_entries, "manufacturer"),
            )
            if expansion_rule:
                rule["expansions"].append(expansion_rule)

    if not rule["expansions"]:
        rule.pop("expansions", None)
    return rule


def build_bom_field_pattern_teach_result(
    headers,
    row,
    roles=None,
    entries=None,
    group=None,
    tagged_spans=None,
    source_header="",
    alternate_delimiter="/",
    alternate_mode="append",
    ignored_fields=None,
    has_manual_edits=False,
    visual_pattern=None,
):
    """Return the rule, grammar, highlights, and rows from one backend parse."""
    safe_headers = [clean(header) for header in (headers or [])]
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    source_header = clean(source_header)
    if not source_header:
        source_header = clean(
            (visual_pattern or {}).get("sourceHeader")
            or (visual_pattern or {}).get("source_header")
        )
    source_value = _row_cell(row, source_header, safe_headers, preserve_delimiters=True) if source_header else ""

    backend_visual_pattern = dict(visual_pattern or {})
    if isinstance(tagged_spans, list):
        backend_visual_pattern = derive_visual_pattern_from_tagged_spans(
            source_value=source_value,
            source_header=source_header,
            tagged_spans=tagged_spans,
            alternate_delimiter=alternate_delimiter,
            alternate_mode=alternate_mode,
            ignored_fields=ignored_fields,
        )
    rule = derive_bom_field_pattern_rule_from_correction(
        headers=safe_headers,
        row=row,
        roles=safe_roles,
        entries=entries if has_manual_edits else [],
        group=group,
        visual_pattern=backend_visual_pattern,
        has_manual_edits=has_manual_edits,
    )
    row_config = _config_with_active_rule({}, rule)
    selected_columns = [
        header for header in dict.fromkeys(safe_roles.values())
        if header and header in safe_headers
    ]
    if source_header and source_header not in selected_columns:
        selected_columns.append(source_header)
    interpreted_entries = _infer_field_entries_for_row(
        row,
        safe_headers,
        safe_roles,
        selected_columns,
        config=row_config,
    )
    spans = _interpretation_spans_by_column(
        row,
        safe_headers,
        selected_columns,
        rule,
        interpreted_entries,
    )
    pattern = _visual_pattern_display_pattern(backend_visual_pattern, source_value)
    mapped_fields = [
        role
        for role in ROLE_KEYS
        if source_header and clean(safe_roles.get(role)) == source_header
    ]
    return {
        "source": "backend",
        "rule": rule,
        "visualPattern": backend_visual_pattern,
        "pattern": pattern,
        "title": _field_review_title(mapped_fields),
        "mappedFields": mapped_fields,
        "entries": interpreted_entries,
        "interpretationSpansByColumn": spans,
    }


def _suggest_field_rules_for_sample(row, headers, roles, entries):
    suggestions = {"fields": {}}
    if not isinstance(entries, list) or len(entries) <= 1:
        return suggestions

    for role in ("cpn", "mpn", "manufacturer"):
        header = clean((roles or {}).get(role))
        if not header:
            continue
        raw_value = _row_cell(row, header, headers, preserve_delimiters=True)
        if is_blankish(raw_value):
            continue
        values = [
            clean(((entry.get("fields") or {}).get(role) or {}).get("value"))
            for entry in entries
            if clean(((entry.get("fields") or {}).get(role) or {}).get("value"))
        ]
        if len(values) <= 1 or len({value.upper() for value in values}) <= 1:
            continue
        suggestions["fields"][role] = _delimiter_rule_for_value(raw_value, values)
    return suggestions


def _merge_field_rule_suggestions(current, suggestion):
    current = current if isinstance(current, dict) else {"fields": {}}
    suggestion = suggestion if isinstance(suggestion, dict) else {"fields": {}}
    merged = {
        **current,
        "fields": {
            **(current.get("fields") if isinstance(current.get("fields"), dict) else {}),
        },
    }
    for field, rule in (suggestion.get("fields") if isinstance(suggestion.get("fields"), dict) else {}).items():
        existing = merged["fields"].get(field) if isinstance(merged["fields"].get(field), dict) else {}
        merged["fields"][field] = {**rule, **existing}
    identity_groups = _merge_identity_group_rules(
        suggestion.get("identityGroups") or suggestion.get("identity_groups"),
        merged.get("identityGroups") or merged.get("identity_groups"),
    )
    if identity_groups:
        merged["identityGroups"] = identity_groups
    expansion_rules = _merge_expansion_rules(
        suggestion.get("expansions") or suggestion.get("expansionRules") or suggestion.get("expansion_rules"),
        merged.get("expansions") or merged.get("expansionRules") or merged.get("expansion_rules"),
    )
    if expansion_rules:
        merged["expansions"] = expansion_rules
    return merged


def _field_review_mapping_units(headers, roles, config=None):
    allowed_headers = set(headers or [])
    by_column = {}

    def add_mapping(scope, header, role):
        header = clean(header)
        role = clean(role)
        if not header or header not in allowed_headers or role not in ROLE_KEYS:
            return
        unit = by_column.setdefault(header, {
            "sourceColumn": header,
            "mappedFields": [],
            "scopes": [],
        })
        if role not in unit["mappedFields"]:
            unit["mappedFields"].append(role)
        if scope not in unit["scopes"]:
            unit["scopes"].append(scope)

    for role in ROLE_KEYS:
        add_mapping("primary", (roles or {}).get(role), role)

    if clean((config or {}).get("alternateLayout") or (config or {}).get("alternate_layout")) == "separate_columns":
        alternate_role_keys = {
            "cpn": "cpn",
            "mpn": "mpn",
            "mfr": "manufacturer",
            "manufacturer": "manufacturer",
            "qty": "quantity",
            "quantity": "quantity",
            "uom": "uom",
        }
        for index, group in enumerate(_configured_alternate_column_groups(config), start=1):
            for source_key, role in alternate_role_keys.items():
                add_mapping(f"alternate-{index}", group.get(source_key), role)

    header_positions = {header: index for index, header in enumerate(headers or [])}
    units = list(by_column.values())
    for unit in units:
        unit["mappedFields"] = [role for role in ROLE_KEYS if role in unit["mappedFields"]]
        unit["relationship"] = "shared" if len(unit["mappedFields"]) > 1 else "one_to_one"
    return sorted(
        units,
        key=lambda unit: (
            0 if unit["relationship"] == "shared" else 1,
            header_positions.get(unit["sourceColumn"], len(header_positions)),
        ),
    )


def _review_pattern_identity(source_column, mapped_fields, pattern):
    grammar = clean(pattern).lower()
    grammar = re.sub(r"\s+", " ", grammar).strip()
    grammar = re.sub(r"\s+repeated$", "", grammar).strip()
    return source_column, tuple(sorted(mapped_fields or [])), grammar


def _split_field_preview(samples, field, delimiter):
    previews = []
    for sample in samples or []:
        source = str(sample or "")
        if is_blankish(source):
            continue
        if delimiter == "none":
            values = [clean(source)]
        elif delimiter == "auto":
            config = _config_with_active_rule({}, _rule_for_single_field(field, {"delimiter": "auto"}))
            values = _split_alternate_value(source, config, field) or [clean(source)]
        elif delimiter == "custom":
            values = []
        else:
            token = "\n" if delimiter == "\\n" else delimiter
            values = _split_explicit_delimiter(source, token) or [clean(source)]
        previews.append({
            "source": source,
            "values": values,
        })
    return previews


def _build_split_field_review_step(units, groups, case, require_split_evidence=True):
    split_fields = []
    seen_fields = set()
    delimiter_options = [
        {"value": "none", "label": "No split"},
        {"value": "auto", "label": "Auto-detect"},
        {"value": "/", "label": "Slash (/)"},
        {"value": ",", "label": "Comma (,)"},
        {"value": ";", "label": "Semicolon (;)"},
        {"value": "|", "label": "Pipe (|)"},
        {"value": "^", "label": "Caret (^)"},
        {"value": "~", "label": "Tilde (~)"},
        {"value": "\\n", "label": "New line"},
        {"value": "custom", "label": "Custom"},
    ]

    for unit in units or []:
        source_column = unit.get("sourceColumn")
        for field in unit.get("mappedFields") or []:
            field_identity = (source_column, field)
            if not source_column or not field or field_identity in seen_fields:
                continue
            seen_fields.add(field_identity)

            samples = []
            candidate_rules = []
            for group in groups or []:
                rule = ((group.get("suggestedRule") or {}).get("fields") or {}).get(field)
                if isinstance(rule, dict) and rule:
                    candidate_rules.append({
                        "groupId": group.get("id"),
                        "shape": group.get("shape"),
                        "rule": rule,
                    })
                for sample in group.get("samples") or []:
                    source_item = next(
                        (
                            item
                            for item in (sample.get("left") or [])
                            if clean(item.get("column")) == source_column
                        ),
                        None,
                    )
                    value = clean((source_item or {}).get("value"))
                    if value and value not in samples:
                        samples.append(value)
                    if len(samples) >= 3:
                        break
                if len(samples) >= 3:
                    break

            has_split_evidence = any(
                len((_split_field_preview([sample], field, "auto") or [{}])[0].get("values") or []) > 1
                for sample in samples
            )
            has_saved_split_rule = any(
                clean((candidate.get("rule") or {}).get("delimiter")) not in {"", "none", "no_split"}
                for candidate in candidate_rules
            )
            if require_split_evidence and not has_split_evidence and not has_saved_split_rule:
                continue

            split_fields.append({
                "sourceColumn": source_column,
                "field": field,
                "fieldLabel": FACTWISE_FIELD_LABELS.get(field) or ROLE_LABELS.get(field) or field,
                "samples": samples,
                "groupIds": [group.get("id") for group in groups or [] if group.get("id")],
                "candidateRules": candidate_rules,
                "delimiterOptions": delimiter_options,
                "previews": {
                    option["value"]: _split_field_preview(samples, field, option["value"])
                    for option in delimiter_options
                },
            })

    if not split_fields:
        return None

    split_step_key = "|".join(
        f"{item['sourceColumn']}:{item['field']}"
        for item in split_fields
    )
    return {
        "id": f"split-fields-{hashlib.sha256(split_step_key.encode('utf-8')).hexdigest()[:16]}",
        "case": case,
        "type": "split_fields",
        "fields": split_fields,
        "sourceColumns": list(dict.fromkeys(item["sourceColumn"] for item in split_fields)),
        "mappedFields": list(dict.fromkeys(item["field"] for item in split_fields)),
    }


def _build_semantic_review_patterns(headers, roles, config, row_shape_groups, options=None):
    """Build globally deduplicated, fragment-level patterns for user review."""
    options = options or {}
    units = _field_review_mapping_units(headers, roles, config=config)
    shared_units = [unit for unit in units if unit.get("relationship") == "shared"]
    saved_interpretations = load_saved_bom_pattern_interpretations()
    draft_rules = {}
    for key in ("fieldPatternRules", "field_pattern_rules", "patternRules", "pattern_rules"):
        if isinstance(options.get(key), dict):
            draft_rules.update(options.get(key))

    patterns = {}
    for group in row_shape_groups or []:
        for raw_sample in group.get("_rawSamples") or []:
            row = raw_sample.get("row") or {}
            source_row = raw_sample.get("sourceRow")
            for unit in shared_units:
                source_column = unit.get("sourceColumn")
                mapped_fields = unit.get("mappedFields") or []
                source_value = _row_cell(row, source_column, headers, preserve_delimiters=True)
                if is_blankish(source_value):
                    continue
                for fragment in _semantic_identity_fragments(source_value, mapped_fields):
                    grammar = clean(fragment.get("grammar"))
                    if not grammar:
                        continue
                    pattern_key = _semantic_pattern_key(source_column, mapped_fields, grammar)
                    stored = saved_interpretations.get(pattern_key)
                    draft_rule = draft_rules.get(pattern_key) if isinstance(draft_rules.get(pattern_key), dict) else {}
                    parser_rule = draft_rule or ((stored or {}).get("rule") if stored else {}) or {}
                    parser_rule = _semantic_rule_for_source(parser_rule, source_column)
                    item = patterns.setdefault(pattern_key, {
                        "id": pattern_key,
                        "patternKey": pattern_key,
                        "shape": pattern_key,
                        "grammar": grammar,
                        "title": "",
                        "sourceColumn": source_column,
                        "mappedFields": list(mapped_fields),
                        "selectedColumns": [source_column],
                        "rowShapeGroupIds": [],
                        "occurrences": [],
                        "interpretations": [],
                        "samples": [],
                        "rowEntries": {},
                        "patternRows": [],
                        "primaryPatternRow": None,
                        "suggestedRule": parser_rule or {"fields": {}},
                        "storedInterpretation": stored,
                        "draftInterpretation": {"rule": draft_rule} if draft_rule else None,
                        "confirmed": False,
                    })
                    if group.get("id") not in item["rowShapeGroupIds"]:
                        item["rowShapeGroupIds"].append(group.get("id"))
                    occurrence = {
                        "id": hashlib.sha256(
                            (
                                f"{pattern_key}|{source_row}|{source_column}|"
                                f"{int(fragment.get('start') or 0)}|{int(fragment.get('end') or 0)}"
                            ).encode("utf-8")
                        ).hexdigest()[:20],
                        "sourceRow": source_row,
                        "sourceColumn": source_column,
                        "start": int(fragment.get("start") or 0),
                        "end": int(fragment.get("end") or 0),
                        "rawValue": fragment.get("rawValue") or "",
                        "patternKey": pattern_key,
                        "rowShapeGroupId": group.get("id"),
                    }
                    occurrence_identity = (
                        occurrence["sourceRow"], occurrence["sourceColumn"],
                        occurrence["start"], occurrence["end"],
                    )
                    existing_occurrences = {
                        (entry["sourceRow"], entry["sourceColumn"], entry["start"], entry["end"])
                        for entry in item["occurrences"]
                    }
                    if occurrence_identity in existing_occurrences:
                        continue
                    item["occurrences"].append(occurrence)

                    fragment_row = dict(row) if isinstance(row, dict) else {}
                    fragment_row[source_column] = occurrence["rawValue"]
                    fragment_config = dict(config or {})
                    fragment_config.pop("fieldPatternRules", None)
                    fragment_config.pop("field_pattern_rules", None)
                    if parser_rule:
                        fragment_config = _config_with_active_rule(fragment_config, parser_rule)
                    entries = _infer_field_entries_for_row(
                        fragment_row,
                        headers,
                        roles,
                        [source_column],
                        config=fragment_config,
                    )
                    spans = _interpretation_spans_by_column(
                        fragment_row,
                        headers,
                        [source_column],
                        parser_rule,
                        entries,
                    ) if parser_rule else {}
                    interpretation = {
                        "occurrenceId": occurrence["id"],
                        "sourceRow": source_row,
                        "sourceColumn": source_column,
                        "start": occurrence["start"],
                        "end": occurrence["end"],
                        "rawValue": occurrence["rawValue"],
                        "left": raw_sample.get("left") or [],
                        "entries": entries,
                        "interpretationSpans": spans.get(source_column) or [],
                    }
                    item["interpretations"].append(interpretation)
                    pattern_row = {
                        "key": pattern_key,
                        "label": " + ".join(_pattern_display_token(role).strip("<>") for role in mapped_fields),
                        "source": source_column,
                        "roles": list(mapped_fields),
                        "pattern": grammar,
                        "example": occurrence,
                        "occurrenceRefs": [occurrence["id"]],
                        "occurrenceCount": len(item["occurrences"]),
                    }
                    if not item["patternRows"]:
                        item["patternRows"] = [pattern_row]
                        item["primaryPatternRow"] = pattern_row
                    sample = {
                        "sourceRow": source_row,
                        "left": raw_sample.get("left") or [],
                        "sourceFragment": occurrence,
                        "fields": entries[0].get("fields") if entries else {},
                        "entries": entries,
                        "interpretationSpansByColumn": spans,
                        "patternRows": [pattern_row],
                        "primaryPatternRow": pattern_row,
                    }
                    item["rowEntries"][f"{source_row}:{occurrence['start']}:{occurrence['end']}"] = {
                        "occurrenceId": occurrence["id"],
                    }
                    if len(item["samples"]) < 8:
                        item["samples"].append(sample)

    ordered = sorted(
        patterns.values(),
        key=lambda item: (
            min((occ.get("sourceRow") or 0) for occ in item.get("occurrences") or [{}]),
            min((occ.get("start") or 0) for occ in item.get("occurrences") or [{}]),
            item.get("grammar") or "",
        ),
    )
    for index, item in enumerate(ordered, start=1):
        item["title"] = f"Pattern {index}"
        item["occurrenceCount"] = len(item.get("occurrences") or [])
        item["rowCount"] = len({occ.get("sourceRow") for occ in item.get("occurrences") or []})
        item["sampledRowCount"] = len(item.get("samples") or [])
        if item.get("patternRows"):
            item["patternRows"][0]["occurrenceCount"] = item["occurrenceCount"]
        item["alternateEntryCount"] = max(
            [max(0, len(sample.get("entries") or []) - 1) for sample in item.get("samples") or []] or [0]
        )
        item["groupIds"] = list(item.get("rowShapeGroupIds") or [])
    return ordered


def _build_bom_field_review_workflow(headers, roles, config, groups, patterns=None, options=None):
    options = options or {}
    completed_step_ids = {
        clean(step_id)
        for step_id in (
            options.get("completedReviewStepIds")
            or options.get("completed_review_step_ids")
            or []
        )
        if clean(step_id)
    }
    alternate_layout = clean((config or {}).get("alternateLayout") or (config or {}).get("alternate_layout"))
    same_cell = alternate_layout == "inside_selected_mpn_columns"
    no_alternates = alternate_layout == "already_separate_rows"
    branch = "a" if same_cell else "b"
    units = _field_review_mapping_units(headers, roles, config=config)
    shared_units = [unit for unit in units if unit["relationship"] == "shared"]
    one_to_one_units = [unit for unit in units if unit["relationship"] == "one_to_one"]
    steps = []

    semantic_patterns = list(patterns or [])
    for pattern_number, item in enumerate(semantic_patterns, start=1):
        interpretations = item.get("interpretations") or []
        interpretation_refs = [
            interpretation.get("occurrenceId")
            for interpretation in interpretations
            if interpretation.get("occurrenceId")
        ]
        steps.append({
            "id": f"teach-{item['patternKey']}",
            "case": f"1{branch}",
            "type": "teach_visual",
            "patternKey": item["patternKey"],
            "sourceColumn": item["sourceColumn"],
            "mappedFields": item["mappedFields"],
            "title": _field_review_title(item["mappedFields"]),
            "pattern": item["grammar"],
            "patternNumberForColumn": pattern_number,
            "patternCountForColumn": len(semantic_patterns),
            "groupIds": item.get("groupIds") or [],
            "occurrences": item.get("occurrences") or [],
            "occurrenceCount": item.get("occurrenceCount") or 0,
            "storedInterpretation": item.get("storedInterpretation"),
            "draftInterpretation": item.get("draftInterpretation"),
            "interpretationRefs": interpretation_refs,
            "interpretationRef": interpretation_refs[0] if interpretation_refs else None,
            "interpretation": interpretations[0] if interpretations else None,
        })

    if same_cell and one_to_one_units:
        split_step = _build_split_field_review_step(
            one_to_one_units,
            groups,
            case="2a",
            require_split_evidence=True,
        )
        if split_step:
            steps.append(split_step)

    if branch == "b" and not semantic_patterns:
        steps.append({
            "id": "normalize",
            "case": "direct",
            "type": "normalize",
            "sourceColumns": [unit["sourceColumn"] for unit in units],
            "mappedFields": [role for role in ROLE_KEYS if clean((roles or {}).get(role))],
        })
    else:
        steps.append({
            "id": "preview",
            "case": "preview",
            "type": "preview",
            "sourceColumns": [unit["sourceColumn"] for unit in units],
            "mappedFields": [role for role in ROLE_KEYS if clean((roles or {}).get(role))],
        })
    for index, step in enumerate(steps):
        step["position"] = index + 1
        step["total"] = len(steps)
        step["completed"] = step["id"] in completed_step_ids

    present_cases = []
    for case in [f"1{branch}", f"2{branch}"]:
        if (case.startswith("1") and shared_units) or (case.startswith("2") and one_to_one_units):
            present_cases.append(case)
    return {
        "alternateLayout": alternate_layout,
        "alternatePlacement": "same_cell" if same_cell else ("none" if no_alternates else "elsewhere"),
        "branch": branch,
        "cases": present_cases,
        "mappingUnits": units,
        "steps": steps,
        "completedStepIds": sorted(completed_step_ids),
        "nextStep": next((step for step in steps if not step.get("completed")), None),
        "directPreview": len(steps) == 1 and steps[0].get("type") == "preview",
        "directNormalize": len(steps) == 1 and steps[0].get("type") == "normalize",
    }


def build_bom_field_pattern_groups(headers, rows, roles=None, config=None, selected_columns=None, options=None):
    """Build backend-owned field interpretation groups for the teach popup."""
    started_at = perf_counter()
    options = options or {}
    safe_headers = [clean(header) for header in (headers or [])]
    safe_rows = rows if isinstance(rows, list) else []
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    customer_columns = _selected_customer_columns(safe_headers, safe_roles, selected_columns)
    include_all_rows = bool(options.get("includeAllRows") or options.get("include_all_rows"))

    try:
        max_rows = int(options.get("maxRows") or options.get("max_rows") or 500)
    except Exception:
        max_rows = 500
    max_rows = max(25, min(max_rows, 10000 if include_all_rows else 2000))
    try:
        sample_limit_per_group = int(
            options.get("sampleLimitPerGroup")
            or options.get("sample_limit_per_group")
            or 8
        )
    except Exception:
        sample_limit_per_group = 8
    sample_limit_per_group = max(3, min(sample_limit_per_group, 50))
    try:
        total_sample_limit = int(
            options.get("totalSampleLimit")
            or options.get("total_sample_limit")
            or 64
        )
    except Exception:
        total_sample_limit = 64
    total_sample_limit = max(10, min(total_sample_limit, 200))
    try:
        discovery_sample_limit_per_group = int(
            options.get("discoverySampleLimitPerGroup")
            or options.get("discovery_sample_limit_per_group")
            or 4
        )
    except Exception:
        discovery_sample_limit_per_group = 4
    discovery_sample_limit_per_group = max(1, min(discovery_sample_limit_per_group, 20))
    try:
        total_discovery_sample_limit = int(
            options.get("totalDiscoverySampleLimit")
            or options.get("total_discovery_sample_limit")
            or 80
        )
    except Exception:
        total_discovery_sample_limit = 80
    total_discovery_sample_limit = max(10, min(total_discovery_sample_limit, 250))
    groups_by_shape = {}
    for index, row in enumerate(safe_rows[:max_rows]):
        left_values = [
            {"column": header, "value": _row_cell(row, header, safe_headers)}
            for header in customer_columns
        ]
        if not any(item["value"] for item in left_values):
            continue

        shape = _pattern_shape_for_row(row, safe_headers, safe_roles, customer_columns, config=config)
        group = groups_by_shape.setdefault(shape, {
            "id": f"pattern-{len(groups_by_shape) + 1}",
            "shape": shape,
            "selectedColumns": customer_columns,
            "rowCount": 0,
            "samples": [],
            "_rawSamples": [],
            "patternRows": [],
            "confirmed": False,
            "suggestedRule": {"fields": {}},
        })
        group["rowCount"] += 1
        group["_rawSamples"].append({
            "row": row,
            "index": index,
            "sourceRow": _source_row_number(row, index, int(options.get("headerRowIndex") or 0)),
            "left": left_values,
        })

    parse_limits = _allocate_field_pattern_sample_limits(
        groups_by_shape.values(),
        sample_limit_per_group,
        total_sample_limit,
    )
    discovery_limits = _allocate_field_pattern_sample_limits(
        groups_by_shape.values(),
        discovery_sample_limit_per_group,
        total_discovery_sample_limit,
    )
    saved_rules = load_saved_bom_field_pattern_rules()

    for group in groups_by_shape.values():
        shape = group.get("shape") or ""
        discovered_rule = _discover_field_pattern_rule_for_group(
            group,
            safe_headers,
            safe_roles,
            config=config,
            sample_limit=discovery_limits.get(group["id"], discovery_sample_limit_per_group),
        )
        saved_rule = saved_rules.get(shape) if isinstance(saved_rules.get(shape), dict) else {}
        user_rule = _pattern_rule_for_shape(options, shape)
        active_rule = _merge_pattern_rules(_merge_pattern_rules(discovered_rule, saved_rule), user_rule)
        active_rule["shape"] = shape
        group["suggestedRule"] = active_rule
        if saved_rule:
            group["matchedSavedRule"] = True
        row_config = _config_with_active_rule(config, active_rule)

        raw_samples = group.get("_rawSamples") or []
        group_sample_limit = parse_limits.get(group["id"], sample_limit_per_group)
        group["sampledRowCount"] = min(len(raw_samples), group_sample_limit)
        for raw_sample in _select_raw_field_pattern_samples(raw_samples, group_sample_limit):
            row = raw_sample.get("row")
            entries = _infer_field_entries_for_row(
                row,
                safe_headers,
                safe_roles,
                customer_columns,
                config=row_config,
            )
            fields = entries[0]["fields"] if entries else _infer_field_values_for_row(
                row,
                safe_headers,
                safe_roles,
                customer_columns,
                config=row_config,
            )
            group["suggestedRule"] = _merge_field_rule_suggestions(
                group.get("suggestedRule"),
                _suggest_field_rules_for_sample(row, safe_headers, safe_roles, entries),
            )
            sample_pattern_rows = _pattern_display_rows_for_sample(
                row,
                safe_headers,
                safe_roles,
                customer_columns,
                entries,
                config=row_config,
                source_row=raw_sample.get("sourceRow"),
            )
            interpretation_spans = _interpretation_spans_by_column(
                row,
                safe_headers,
                customer_columns,
                active_rule,
                entries,
            )
            group["samples"].append({
                "sourceRow": raw_sample.get("sourceRow"),
                "left": raw_sample.get("left") or [],
                "fields": fields,
                "entries": entries,
                "interpretationSpansByColumn": interpretation_spans,
                "patternRows": sample_pattern_rows,
                "primaryPatternRow": _primary_pattern_row(sample_pattern_rows),
            })
            group["patternRows"] = _merge_pattern_display_rows(
                group.get("patternRows"),
                sample_pattern_rows,
            )
            group["primaryPatternRow"] = _primary_pattern_row(group.get("patternRows"))
        if include_all_rows:
            group["rowEntries"] = {}
            for raw_sample in raw_samples:
                row = raw_sample.get("row")
                source_row = raw_sample.get("sourceRow")
                entries = _infer_field_entries_for_row(
                    row,
                    safe_headers,
                    safe_roles,
                    customer_columns,
                    config=row_config,
                )
                row_pattern_rows = _pattern_display_rows_for_sample(
                    row,
                    safe_headers,
                    safe_roles,
                    customer_columns,
                    entries,
                    config=row_config,
                    source_row=source_row,
                )
                interpretation_spans = _interpretation_spans_by_column(
                    row,
                    safe_headers,
                    customer_columns,
                    active_rule,
                    entries,
                )
                group["rowEntries"][str(source_row)] = {
                    "sourceRow": source_row,
                    "left": raw_sample.get("left") or [],
                    "entries": entries,
                    "interpretationSpansByColumn": interpretation_spans,
                    "patternRows": row_pattern_rows,
                    "primaryPatternRow": _primary_pattern_row(row_pattern_rows),
                }
    groups = sorted(
        groups_by_shape.values(),
        key=lambda item: (-item["rowCount"], item["id"]),
    )
    for position, group in enumerate(groups, start=1):
        group["id"] = f"pattern-{position}"
        group["title"] = f"Pattern group {position}"
        group["samples"].sort(
            key=lambda sample: (
                -len(sample.get("entries") or []),
                -sum(
                    1
                    for entry in (sample.get("entries") or [])
                    for field in (entry.get("fields") or {}).values()
                    if clean(field.get("value") if isinstance(field, dict) else field)
                ),
                sample.get("sourceRow") or 0,
            )
        )
        group["defaultSampleIndex"] = 0
        group["fieldCoverage"] = {
            field: sum(1 for sample in group["samples"] if clean(sample["fields"].get(field, {}).get("value")))
            for field in FACTWISE_FIELD_LABELS
        }
        group["alternateEntryCount"] = max(
            [max(0, len(sample.get("entries") or []) - 1) for sample in group["samples"]] or [0]
        )
        group["primaryPatternRow"] = _primary_pattern_row(group.get("patternRows"))

    semantic_patterns = _build_semantic_review_patterns(
        safe_headers,
        safe_roles,
        config or {},
        groups,
        options=options,
    )

    review_workflow = _build_bom_field_review_workflow(
        safe_headers,
        safe_roles,
        config or {},
        groups,
        patterns=semantic_patterns,
        options=options,
    )

    for group in groups:
        group.pop("_rawSamples", None)

    return {
        "source": "backend",
        "fields": [
            {"key": key, "label": label, "required": key == "mpn"}
            for key, label in FACTWISE_FIELD_LABELS.items()
        ],
        "selectedColumns": customer_columns,
        "groups": groups,
        "rowShapeGroups": groups,
        "patterns": semantic_patterns,
        "groupCount": len(groups),
        "patternCount": len(semantic_patterns),
        "sampleRowCount": sum(len(group["samples"]) for group in groups),
        "config": config or {},
        "reviewWorkflow": review_workflow,
        "timings": {
            "total_ms": round((perf_counter() - started_at) * 1000, 2),
            "row_count_received": len(safe_rows),
            "row_count_scanned": min(len(safe_rows), max_rows),
            "group_count": len(groups),
            "sample_row_count": sum(len(group["samples"]) for group in groups),
            "sample_limit_per_group": sample_limit_per_group,
            "total_sample_limit": total_sample_limit,
            "discovery_sample_limit_per_group": discovery_sample_limit_per_group,
            "total_discovery_sample_limit": total_discovery_sample_limit,
        },
    }


def _normalize_following_item_row_groups(normalized_rows, source_rows, headers, roles, config, header_row_index=0):
    """Attach sparse MPN/MFR rows to the nearest preceding item context row."""
    rows_by_source = {}
    for normalized in normalized_rows or []:
        rows_by_source.setdefault(str(normalized.get("sourceRow")), []).append(normalized)

    item_column = clean(
        config.get("followingItemRowsItemColumn")
        or config.get("following_item_rows_item_column")
        or roles.get("cpn")
    )
    context_column = clean(
        config.get("followingItemRowsContextColumn")
        or config.get("following_item_rows_context_column")
    )
    cpn_mode = clean(
        config.get("followingItemRowsCpnMode")
        or config.get("following_item_rows_cpn_mode")
        or "primary"
    )
    configured_inherit_fields = config.get("alternateInheritFields")
    if not isinstance(configured_inherit_fields, list):
        configured_inherit_fields = config.get("alternate_inherit_fields")
    inherit_fields = set(configured_inherit_fields or [])
    output_field_by_role = {
        "cpn": "cpn",
        "description": "description",
        "quantity": "quantity",
        "uom": "uom",
        "level": "level",
        "parent": "parent",
        "notes": "Notes",
        "internalNotes": "Internal notes",
    }

    output = []
    current_context = None
    emitted_identity_count = 0

    def emit_unmatched_context():
        nonlocal current_context, emitted_identity_count
        if current_context is not None and emitted_identity_count == 0:
            pending = dict(current_context)
            pending["relation"] = "Primary"
            pending["rule"] = "following_item_rows_primary_without_identity"
            output.append(pending)
        current_context = None
        emitted_identity_count = 0

    def with_context(entry, relation_index):
        merged = dict(entry)
        is_primary = relation_index == 0
        for role, output_key in output_field_by_role.items():
            should_inherit = is_primary or role in inherit_fields
            if role == "cpn" and cpn_mode != "column":
                should_inherit = True
            context_value = current_context.get(output_key) if current_context else ""
            if should_inherit and not is_blankish(context_value):
                merged[output_key] = context_value
        if current_context:
            merged["parentKey"] = current_context.get("parentKey") or merged.get("parentKey")
        merged["relation"] = "Primary" if is_primary else f"Alternate {relation_index}"
        merged["rule"] = "following_item_rows_primary" if is_primary else "following_item_rows_alternate"
        return merged

    for index, source_row_data in enumerate(source_rows or []):
        source_row = _source_row_number(source_row_data, index, header_row_index)
        entries = rows_by_source.get(str(source_row), [])
        item_value = _row_cell(source_row_data, item_column, headers) if item_column else ""
        context_value = _row_cell(source_row_data, context_column, headers) if context_column else ""
        starts_context = bool(clean(context_value or item_value))
        identity_entries = [
            entry
            for entry in entries
            if clean(entry.get("mpn")) or clean(entry.get("manufacturer"))
        ]

        if starts_context:
            emit_unmatched_context()
            current_context = dict(entries[0]) if entries else None
            emitted_identity_count = 0
            if not identity_entries:
                continue

        if identity_entries and current_context is not None:
            for entry in identity_entries:
                output.append(with_context(entry, emitted_identity_count))
                emitted_identity_count += 1
            continue

        if identity_entries:
            for entry_index, entry in enumerate(identity_entries):
                standalone = dict(entry)
                standalone["relation"] = "Primary" if entry_index == 0 else f"Alternate {entry_index}"
                output.append(standalone)
            continue

    emit_unmatched_context()
    return output


def normalize_bom_rows(headers, rows, roles=None, config=None):
    """Normalize all mapped BOM fields through the backend inference contract."""
    safe_headers = [clean(header) for header in (headers or [])]
    safe_rows = rows if isinstance(rows, list) else []
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    safe_config = config if isinstance(config, dict) else {}
    selected_columns = _selected_customer_columns(safe_headers, safe_roles, [])
    pattern_rules = safe_config.get("fieldPatternRules") or safe_config.get("field_pattern_rules") or {}
    header_row_index = int(safe_config.get("headerRowIndex") or safe_config.get("header_row_index") or 0)
    result = build_bom_field_pattern_groups(
        headers=safe_headers,
        rows=safe_rows,
        roles=safe_roles,
        config=safe_config,
        selected_columns=selected_columns,
        options={
            "headerRowIndex": header_row_index,
            "maxRows": max(25, len(safe_rows)),
            "sampleLimitPerGroup": 3,
            "totalSampleLimit": 64,
            "discoverySampleLimitPerGroup": 3,
            "totalDiscoverySampleLimit": 80,
            "fieldPatternRules": pattern_rules,
            "includeAllRows": True,
        },
    )

    entries_by_source_row = {}
    for group in result.get("groups") or []:
        for source_row, row_result in (group.get("rowEntries") or {}).items():
            entries_by_source_row[str(source_row)] = row_result.get("entries") or []

    confirmed_rows = (
        ((safe_config.get("fieldPatternOverrides") or {}).get("rows") or {})
        if isinstance(safe_config.get("fieldPatternOverrides"), dict)
        else {}
    )
    if _semantic_pattern_rules(safe_config):
        confirmed_rows = {}
    normalized_rows = []
    skipped_rows = 0
    consumed_headers = {header for header in safe_roles.values() if header}
    for index, row in enumerate(safe_rows):
        source_row = _source_row_number(row, index, header_row_index)
        if not any(not is_blankish(_row_cell(row, header, safe_headers)) for header in safe_headers):
            skipped_rows += 1
            continue
        override = confirmed_rows.get(str(source_row)) if isinstance(confirmed_rows, dict) else None
        entries = override.get("entries") if isinstance(override, dict) else None
        if not isinstance(entries, list) or not entries:
            entries = entries_by_source_row.get(str(source_row)) or []
        if not entries:
            entries = _infer_field_entries_for_row(
                row,
                safe_headers,
                safe_roles,
                selected_columns,
                config=safe_config,
            )

        for entry_index, entry in enumerate(entries):
            fields = entry.get("fields") if isinstance(entry, dict) else {}

            def field_value(role):
                value = fields.get(role) if isinstance(fields, dict) else ""
                return clean(value.get("value") if isinstance(value, dict) else value)

            values = {role: field_value(role) for role in FACTWISE_FIELD_LABELS}
            if not any(values.values()):
                continue
            confidences = [
                float(field.get("confidence") or 0)
                for field in fields.values()
                if isinstance(field, dict) and field.get("value")
            ] if isinstance(fields, dict) else []
            relation = clean(entry.get("relation")) if isinstance(entry, dict) else ""
            normalized = {
                "sourceRow": source_row,
                "parentKey": values["parent"] or values["cpn"] or str(source_row),
                "parent": values["parent"],
                "relation": relation or ("Primary" if entry_index == 0 else f"Alternate {entry_index}"),
                "level": values["level"] or "1",
                "cpn": values["cpn"],
                "description": values["description"],
                "mpn": values["mpn"],
                "manufacturer": values["manufacturer"],
                "quantity": values["quantity"],
                "uom": values["uom"],
                "Notes": values["notes"],
                "Internal notes": values["internalNotes"],
                "rule": "backend_field_pattern_normalization",
                "confidence": round((sum(confidences) / len(confidences)) * 100, 2) if confidences else 0,
                "discardedText": "",
            }
            for header in safe_headers:
                if header.startswith("__") or header in consumed_headers or header in normalized:
                    continue
                normalized[header] = row.get(header, "") if isinstance(row, dict) else ""
            normalized_rows.append(normalized)

    alternate_layout = clean(
        safe_config.get("alternateLayout") or safe_config.get("alternate_layout")
    )
    if alternate_layout == "following_item_rows":
        normalized_rows = _normalize_following_item_row_groups(
            normalized_rows,
            safe_rows,
            safe_headers,
            safe_roles,
            safe_config,
            header_row_index=header_row_index,
        )

    rows_by_source = {}
    warnings = []
    for normalized in normalized_rows:
        rows_by_source.setdefault(str(normalized.get("sourceRow")), []).append(normalized)
        if not clean(normalized.get("mpn")):
            warnings.append({
                "type": "missing_mpn",
                "sourceRow": normalized.get("sourceRow"),
                "relation": normalized.get("relation"),
                "message": "A generated item has no MPN.",
            })

    pairing_issues = []
    checked_rows = 0
    matched_rows = 0
    for source_row, source_entries in rows_by_source.items():
        mpns = [clean(entry.get("mpn")) for entry in source_entries if clean(entry.get("mpn"))]
        manufacturers = [
            clean(entry.get("manufacturer"))
            for entry in source_entries
            if clean(entry.get("manufacturer"))
        ]
        if len(mpns) <= 1 and len(manufacturers) <= 1:
            continue
        checked_rows += 1
        if len(mpns) == len(manufacturers):
            matched_rows += 1
            continue
        issue = {
            "key": f"backend-{source_row}",
            "sourceRow": source_entries[0].get("sourceRow"),
            "parentKey": source_entries[0].get("parentKey") or source_row,
            "mpns": mpns,
            "manufacturers": manufacturers,
            "rawMpn": " | ".join(mpns),
            "rawManufacturer": " | ".join(manufacturers),
            "action": "keep",
            "mpnDecisions": [
                {
                    "mpn": mpn,
                    "manufacturer": manufacturers[index] if index < len(manufacturers) else "",
                    "keep": True,
                }
                for index, mpn in enumerate(mpns)
            ],
            "mfrDecisions": [
                {"manufacturer": manufacturer, "keep": True}
                for manufacturer in manufacturers
            ],
            "manualManufacturers": " | ".join(
                manufacturers[index] if index < len(manufacturers) else ""
                for index in range(len(mpns))
            ),
            "message": f"{len(mpns)} MPNs detected, {len(manufacturers)} manufacturers detected.",
        }
        pairing_issues.append(issue)
        warnings.append({
            "type": "mpn_mfr_count_mismatch",
            "sourceRow": source_entries[0].get("sourceRow"),
            "message": issue["message"],
        })

    return {
        "source": "backend",
        "normalizedRows": normalized_rows,
        "patternGroups": result.get("groups") or [],
        "patterns": result.get("patterns") or [],
        "reviewWorkflow": result.get("reviewWorkflow") or {},
        "warnings": warnings,
        "pairingCheck": {
            "checkedRows": checked_rows,
            "matchedRows": matched_rows,
            "issueRows": pairing_issues,
        },
        "progress": {
            "processed": len(safe_rows),
            "total": len(safe_rows),
            "outputRows": len(normalized_rows),
            "skippedRows": skipped_rows,
        },
    }


def clear_bom_role_inference_caches():
    _best_mpn_from_text.cache_clear()
    _best_manufacturer_from_text.cache_clear()
    _manufacturer_directory_spans.cache_clear()
    _manufacturer_segments_for_target_count.cache_clear()
    _split_manufacturer_part_by_directory.cache_clear()
