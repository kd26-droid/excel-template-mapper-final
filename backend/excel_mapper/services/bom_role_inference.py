import re
import unicodedata
import hashlib
from collections import Counter
from copy import deepcopy
from functools import lru_cache
from statistics import mean
from time import perf_counter

from .mpn_pattern_library import (
    candidate_mpn_tokens,
    load_manufacturer_lookup,
    load_manufacturer_phrase_lookup,
    load_mpn_mfr_lookup,
    prime_mpn_lookup,
    score_manufacturer_value,
    score_mpn_value,
)
from .bom_directory_store import normalize_mpn


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
MPN_RECOGNITION_SIMILARITY_THRESHOLD = 90.0
ALTERNATE_DELIMITER_NONE = "__no_alternates__"
ALTERNATE_DELIMITER_SINGLE = "__no_split__"


class BomSetupValidationError(ValueError):
    def __init__(self, code, message, field=""):
        super().__init__(message)
        self.code = code
        self.field = field


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
    "parent": "Parent",
}

FACTWISE_FIELD_LABELS = {
    "cpn": "CPN",
    "mpn": "MPN",
    "manufacturer": "Manufacturer",
    "description": "Description",
    "quantity": "Quantity",
    "uom": "UOM",
    "level": "Level",
    "parent": "Parent",
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


def bom_setup_requirements(headers=None, roles=None, config=None):
    safe_headers = {clean(header) for header in (headers or []) if clean(header)}
    safe_config = config if isinstance(config, dict) else {}
    alternate_layout = clean(
        safe_config.get("alternateLayout")
        or safe_config.get("alternate_layout")
    )
    group_key_header = clean(
        safe_config.get("sameGroupKeyColumn")
        or safe_config.get("same_group_key_column")
    )
    if (
        alternate_layout == "same_group_rows"
        and (
            not group_key_header
            or (safe_headers and group_key_header not in safe_headers)
        )
    ):
        return [{
            "code": "group_key_required",
            "field": "sameGroupKeyColumn",
            "message": (
                "Select a group key column before reviewing or "
                "normalizing rows with the same group key."
            ),
        }]
    return []


def _require_valid_bom_setup(headers=None, roles=None, config=None):
    requirements = bom_setup_requirements(headers, roles, config)
    if requirements:
        requirement = requirements[0]
        raise BomSetupValidationError(
            requirement["code"],
            requirement["message"],
            requirement["field"],
        )


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

    prime_values = []
    for index in range(len(headers)):
        values = column_values(headers, rows, index, sample_size)
        column_values_by_index[index] = values
        prime_values.extend(non_empty(values)[:VALUE_SIGNAL_SAMPLE_SIZE])
    prime_mpn_lookup(prime_values)

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
        values = column_values_by_index[index]
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
        mpn_unique_count = len({clean(value).upper() for value in samples})
        mpn_unique_rate = ratio(mpn_unique_count, len(samples))
        mpn_signal["unique_count"] = mpn_unique_count
        mpn_signal["unique_rate"] = round(mpn_unique_rate, 4)
        if (
            len(samples) >= 8
            and mpn_unique_count <= 2
            and mpn_signal.get("exact_lookup_rate", 0.0) < 0.50
        ):
            mpn_role_score = min(mpn_role_score, 0.60)
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
    input_rows = rows if isinstance(rows, list) else []
    safe_rows, block_structure = _prepare_backend_bom_rows(
        safe_headers,
        input_rows,
        config=(options or {}).get("config") or {},
    )
    profiles = build_column_profiles(safe_headers, safe_rows, sample_size=sample_size)
    resolved = resolve_roles(profiles)
    mapped_input_rows = [_row_as_header_mapping(row, safe_headers) for row in input_rows]
    block_structure["parentPathRows"] = [
        _source_row_number(row, index)
        for index, row in enumerate(mapped_input_rows)
        if _backend_parent_path_value(row, safe_headers, resolved["roles"])
    ]
    block_structure["cleanupDetections"] = _cleanup_detection_counts(block_structure)
    return {
        "source": "inferred",
        "roles": resolved["roles"],
        "roleMetadata": resolved["roleMetadata"],
        "supportingColumns": resolved["supportingColumns"],
        "candidates": resolved["candidates"],
        "columns": profiles,
        "warnings": resolved["warnings"],
        "blockStructure": block_structure,
        "cleanupDetections": block_structure.get("cleanupDetections") or {},
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


def _normalizer_config_flag(config, camel_key, snake_key, default=True):
    config = config if isinstance(config, dict) else {}
    if camel_key in config:
        return bool(config.get(camel_key))
    if snake_key in config:
        return bool(config.get(snake_key))
    return default


def _strong_semantic_header_role(value):
    scored = sorted(
        (
            (header_support(value, role), role)
            for role in ROLE_KEYS
        ),
        reverse=True,
    )
    if not scored or scored[0][0] < 0.78:
        return ""
    if len(scored) > 1 and scored[1][0] == scored[0][0]:
        return ""
    return scored[0][1]


def _semantic_role_map_from_header_values(headers, values):
    role_map = {}
    recognized = 0
    nonblank = 0
    for index, value in enumerate(values):
        if is_blankish(value):
            continue
        nonblank += 1
        role = _strong_semantic_header_role(value)
        if not role or role in role_map or index >= len(headers):
            continue
        recognized += 1
        role_map[role] = headers[index]

    identity_roles = {"cpn", "mpn", "manufacturer"}.intersection(role_map)
    if recognized < 2 or not identity_roles:
        return {}
    if recognized / max(nonblank, 1) < 0.45:
        return {}
    return role_map


def _row_as_header_mapping(row, headers):
    if isinstance(row, dict):
        return dict(row)
    if isinstance(row, list):
        return {
            header: row[index] if index < len(row) else ""
            for index, header in enumerate(headers)
        }
    return {}


def _row_values_in_header_order(row, headers):
    return [row.get(header, "") for header in headers]


def _source_value_for_role(row, source_roles, role):
    header = clean((source_roles or {}).get(role))
    return clean(row.get(header, "")) if header else ""


def _looks_like_calendar_date(value):
    return bool(re.fullmatch(
        r"(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})",
        clean(value),
        flags=re.IGNORECASE,
    ))


def _backend_section_title(row, headers, source_roles):
    values = [clean(row.get(header, "")) for header in headers]
    values = [value for value in values if not is_blankish(value)]
    if not values:
        return ""

    # Spreadsheet readers can expand a merged title over several cells. Treat
    # repeated copies as one value, but retain genuinely different row values.
    unique_values = []
    seen_values = set()
    value_counts = {}
    for value in values:
        key = re.sub(r"[^a-z0-9]+", "", value.lower())
        if key:
            value_counts[key] = value_counts.get(key, 0) + 1
        if key and key not in seen_values:
            seen_values.add(key)
            unique_values.append(value)
    if not unique_values or len(unique_values) > 2:
        return ""

    dominant_key, dominant_count = max(
        value_counts.items(),
        key=lambda item: item[1],
    )
    dominant_value = next(
        value for value in unique_values
        if re.sub(r"[^a-z0-9]+", "", value.lower()) == dominant_key
    )
    other_values = [
        value for value in unique_values
        if re.sub(r"[^a-z0-9]+", "", value.lower()) != dominant_key
    ]
    if (
        dominant_count >= 3
        and re.search(r"[A-Za-z]", dominant_value)
        and all(_looks_like_calendar_date(value) for value in other_values)
    ):
        return " ".join(unique_values).strip()

    text = " ".join(unique_values).strip()
    compact = re.sub(r"[^A-Za-z0-9]", "", text)
    if not compact or len(compact) > 80 or not re.search(r"[A-Za-z]", text):
        return ""
    # Normal part numbers and customer codes almost always contain an adjacent
    # letter/digit boundary. Reject those before consulting the large MPN/MFR
    # directories for section-title detection.
    if re.search(r"[A-Za-z]+\d|\d+[A-Za-z]", text):
        return ""

    mpn_value = _source_value_for_role(row, source_roles, "mpn")
    manufacturer_value = _source_value_for_role(row, source_roles, "manufacturer")
    quantity_value = _source_value_for_role(row, source_roles, "quantity")
    uom_value = _source_value_for_role(row, source_roles, "uom")
    level_value = _source_value_for_role(row, source_roles, "level")
    cpn_value = _source_value_for_role(row, source_roles, "cpn")
    if mpn_value and score_mpn_value(mpn_value).get("matched"):
        return ""
    if manufacturer_value and score_manufacturer_value(manufacturer_value).get("matched"):
        return ""
    if quantity_value and re.fullmatch(r"[-+]?\d+(?:[.,]\d+)?", quantity_value):
        return ""
    if uom_value and uom_value.upper() in UOM_TOKENS:
        return ""
    if (
        level_value
        and re.fullmatch(r"\d+(?:[.-]\d+)*", level_value)
        and not _looks_like_calendar_date(level_value)
    ):
        return ""
    if cpn_value and re.search(r"[A-Za-z]+\d|\d+[A-Za-z]", cpn_value):
        return ""

    return text


def _is_backend_summary_row(
    row,
    source_roles,
    headers=None,
    *,
    is_footer=False,
    has_prior_data=False,
):
    safe_headers = [clean(header) for header in (headers or [])]
    populated = [
        (header, clean(row.get(header, "")))
        for header in safe_headers
        if not is_blankish(row.get(header, ""))
    ]
    values = [value for _, value in populated]
    combined = " ".join(values)
    has_number = bool(re.search(r"(?<![A-Za-z])[-+]?\d+(?:[.,]\d+)?(?![A-Za-z])", combined))
    has_summary_label = bool(re.search(
        r"\b(?:"
        r"grand\s+total|sub\s*total|"
        r"total(?:\s+(?:count|items?|components?|parts?|quantity|qty|rows?|records?))?|"
        r"(?:item|component|part|row|record)\s+count"
        r")\b",
        combined,
        flags=re.IGNORECASE,
    ))
    if has_summary_label and has_number:
        return True

    has_identity = any(
        _source_value_for_role(row, source_roles, role)
        for role in ("cpn", "mpn", "manufacturer", "description", "parent", "level")
    )
    if has_identity:
        return False
    quantity = _source_value_for_role(row, source_roles, "quantity")
    if quantity and re.fullmatch(r"[-+]?\d+(?:[.,]\d+)?", quantity):
        return True

    # A workbook may end with an unlabeled numeric total. Only classify that
    # narrow footer shape when it follows substantive rows and the populated
    # column is not an identifier/hierarchy field. This keeps numeric CPNs and
    # line identifiers available to normalization.
    if not (is_footer and has_prior_data and len(populated) == 1):
        return False
    header, value = populated[0]
    if not re.fullmatch(r"[-+]?\d+(?:[.,]\d+)?", value):
        return False
    protected_roles = {"cpn", "mpn", "manufacturer", "parent", "level"}
    mapped_role = next((
        role
        for role, mapped_header in (source_roles or {}).items()
        if clean(mapped_header) == header
    ), "")
    if mapped_role in protected_roles:
        return False
    return _strong_semantic_header_role(header) not in protected_roles


def _is_backend_do_not_populate_row(row, headers):
    text = " ".join(
        clean(row.get(header, ""))
        for header in headers
        if not is_blankish(row.get(header, ""))
    )
    return bool(re.search(
        r"\b(do\s*not\s*populate|not\s*populate|dnp|dni|not\s*fitted|no\s*fit)\b",
        text,
        flags=re.IGNORECASE,
    ))


def _is_backend_deleted_row(row):
    return any(bool(row.get(key)) for key in (
        "__deletedRowStyle",
        "__redRowStyle",
        "__strikeRowStyle",
    ))


def _backend_parent_path_value(row, headers, source_roles):
    parent_headers = []
    mapped_parent = clean((source_roles or {}).get("parent"))
    if mapped_parent in headers:
        parent_headers.append(mapped_parent)
    parent_headers.extend(
        header for header in headers
        if header not in parent_headers and header_support(header, "parent") >= 0.78
    )
    for header in parent_headers:
        value = clean(row.get(header, ""))
        if value and any(separator in value for separator in (">", "::", "|", "\\", "/")):
            return value
    return ""


def _cleanup_detection_counts(diagnostics):
    diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
    return {
        "skipTitleRows": len(diagnostics.get("sectionTitleRows") or []),
        "skipRepeatedHeaders": len(diagnostics.get("repeatedHeaderRows") or []),
        "skipDoNotPopulate": len(diagnostics.get("doNotPopulateRows") or []),
        "skipDeletedRows": len(diagnostics.get("deletedRows") or []),
        "skipSummaryRows": len(diagnostics.get("summaryRows") or []),
        "parentPathLevels": len(diagnostics.get("parentPathRows") or []),
    }


def _prepare_backend_bom_rows(headers, rows, roles=None, config=None, header_row_index=0):
    """Apply cleanup and remap repeated-header blocks into one logical schema."""
    safe_headers = [clean(header) for header in (headers or [])]
    mapped_rows = [_row_as_header_mapping(row, safe_headers) for row in (rows or [])]
    repeated_headers = []
    for index, row in enumerate(mapped_rows):
        role_map = _semantic_role_map_from_header_values(
            safe_headers,
            _row_values_in_header_order(row, safe_headers),
        )
        if role_map:
            repeated_headers.append((index, role_map))

    initial_semantic_roles = {}
    for header in safe_headers:
        role = _strong_semantic_header_role(header)
        if role and role not in initial_semantic_roles:
            initial_semantic_roles[role] = header

    supplied_roles = {
        role: clean((roles or {}).get(role))
        for role in ROLE_KEYS
        if clean((roles or {}).get(role)) in safe_headers
    }
    has_repeated_blocks = bool(repeated_headers)
    active_source_roles = dict(supplied_roles)
    if has_repeated_blocks:
        active_source_roles.update(initial_semantic_roles)
    canonical_role_headers = dict(initial_semantic_roles if not supplied_roles else supplied_roles)
    for role, header in initial_semantic_roles.items():
        canonical_role_headers.setdefault(role, header)

    skip_titles = _normalizer_config_flag(config, "skipTitleRows", "skip_title_rows", True)
    skip_headers = _normalizer_config_flag(config, "skipRepeatedHeaders", "skip_repeated_headers", True)
    skip_do_not_populate = _normalizer_config_flag(
        config,
        "skipDoNotPopulate",
        "skip_do_not_populate",
        False,
    )
    skip_deleted = _normalizer_config_flag(config, "skipDeletedRows", "skip_deleted_rows", True)
    skip_summaries = _normalizer_config_flag(config, "skipSummaryRows", "skip_summary_rows", True)
    prepared_rows = []
    current_section = ""
    diagnostics = {
        "detected": has_repeated_blocks,
        "blockCount": len(repeated_headers) + 1 if has_repeated_blocks else 1,
        "repeatedHeaderRows": [],
        "sectionTitleRows": [],
        "doNotPopulateRows": [],
        "deletedRows": [],
        "parentPathRows": [],
        "summaryRows": [],
        "blankRows": [],
        "roleMaps": [],
    }
    if has_repeated_blocks:
        diagnostics["roleMaps"].append({
            "sourceRow": int(header_row_index or 0) + 1,
            "roles": dict(active_source_roles),
        })

    nonblank_row_indexes = [
        index
        for index, row in enumerate(mapped_rows)
        if any(not is_blankish(row.get(header, "")) for header in safe_headers)
    ]
    final_nonblank_index = nonblank_row_indexes[-1] if nonblank_row_indexes else -1
    prior_data_flags = []
    has_prior_substantive_row = False
    for row in mapped_rows:
        prior_data_flags.append(has_prior_substantive_row)
        if sum(
            not is_blankish(row.get(header, ""))
            for header in safe_headers
        ) >= 2:
            has_prior_substantive_row = True

    for index, row in enumerate(mapped_rows):
        source_row = _source_row_number(row, index, header_row_index)
        if not any(not is_blankish(row.get(header, "")) for header in safe_headers):
            diagnostics["blankRows"].append(source_row)
            continue

        repeated_role_map = _semantic_role_map_from_header_values(
            safe_headers,
            _row_values_in_header_order(row, safe_headers),
        )
        if repeated_role_map:
            active_source_roles.update(repeated_role_map)
            diagnostics["repeatedHeaderRows"].append(source_row)
            diagnostics["roleMaps"].append({
                "sourceRow": source_row,
                "roles": dict(active_source_roles),
            })

        is_summary = _is_backend_summary_row(
            row,
            active_source_roles,
            safe_headers,
            is_footer=index == final_nonblank_index,
            has_prior_data=prior_data_flags[index],
        )
        if is_summary:
            diagnostics["summaryRows"].append(source_row)

        section_title = _backend_section_title(
            row,
            safe_headers,
            active_source_roles,
        )
        if section_title:
            diagnostics["sectionTitleRows"].append(source_row)
            if not is_summary:
                current_section = section_title

        is_do_not_populate = _is_backend_do_not_populate_row(row, safe_headers)
        if is_do_not_populate:
            diagnostics["doNotPopulateRows"].append(source_row)

        is_deleted = _is_backend_deleted_row(row)
        if is_deleted:
            diagnostics["deletedRows"].append(source_row)

        if _backend_parent_path_value(row, safe_headers, active_source_roles):
            diagnostics["parentPathRows"].append(source_row)

        if repeated_role_map and skip_headers:
            continue
        if section_title and skip_titles and not is_summary:
            continue
        if is_do_not_populate and skip_do_not_populate:
            continue
        if is_deleted and skip_deleted:
            continue
        if is_summary and skip_summaries:
            continue

        remapped = dict(row)
        original = dict(row)
        if has_repeated_blocks:
            for role, target_header in canonical_role_headers.items():
                source_header = clean(active_source_roles.get(role))
                if not source_header or not target_header:
                    continue
                remapped[target_header] = original.get(source_header, "")
            remapped["__sourceValues"] = {
                header: original.get(header, "")
                for header in safe_headers
            }
        remapped["__sourceRow"] = source_row
        if current_section:
            remapped["__sourceSection"] = current_section
        prepared_rows.append(remapped)

    diagnostics["inputRowCount"] = len(mapped_rows)
    diagnostics["dataRowCount"] = len(prepared_rows)
    diagnostics["skippedRowCount"] = len(mapped_rows) - len(prepared_rows)
    diagnostics["cleanupDetections"] = _cleanup_detection_counts(diagnostics)
    return prepared_rows, diagnostics


def _selected_customer_columns(headers, roles, selected_columns=None, config=None):
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
    add(
        (config or {}).get("sameGroupKeyColumn")
        or (config or {}).get("same_group_key_column")
    )
    for group in (config or {}).get("alternateColumnGroups") or (config or {}).get("alternate_column_groups") or []:
        if not isinstance(group, dict):
            continue
        for role in ROLE_KEYS:
            add(
                group.get(role)
                or (group.get("mfr") if role == "manufacturer" else "")
            )
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
    raw_delimiter_text = str(raw_delimiter or "").replace("\u00a0", " ")
    if raw_delimiter_text in {"\n", "\r\n"}:
        return "\n"
    delimiter_mode = raw_delimiter_text.strip()
    custom_delimiter = clean(rule.get("customDelimiter") or rule.get("custom_delimiter"))
    if delimiter_mode in {
        "",
        "none",
        "auto",
        ALTERNATE_DELIMITER_NONE,
        ALTERNATE_DELIMITER_SINGLE,
    }:
        return ""
    if delimiter_mode == "custom":
        delimiter_mode = custom_delimiter
    if delimiter_mode.lower() in {"\\n", "\\\\n", "newline", "new line"} or delimiter_mode in {"\n", "\r\n"}:
        return "\n"
    return delimiter_mode


def _authoritative_visual_pattern(rule):
    """Overlay confirmed controls onto the visual rule used by every parser path."""
    rule = rule if isinstance(rule, dict) else {}
    correction = (
        rule.get("authoritativeCorrection")
        or rule.get("authoritative_correction")
        or {}
    )
    correction = correction if isinstance(correction, dict) else {}
    visual_pattern = {
        **(rule.get("visualPattern") or rule.get("visual_pattern") or {}),
        **(
            correction.get("visualPattern")
            or correction.get("visual_pattern")
            or {}
        ),
    }
    if not visual_pattern:
        return {}
    for camel_key, snake_key in (
        ("alternateDelimiter", "alternate_delimiter"),
        ("alternateMode", "alternate_mode"),
        ("alternateJoiner", "alternate_joiner"),
    ):
        if camel_key in correction:
            visual_pattern[camel_key] = correction.get(camel_key)
        elif snake_key in correction:
            visual_pattern[camel_key] = correction.get(snake_key)
    return visual_pattern


def _field_pattern_control_state(rule):
    """Return the canonical popup controls for any persisted parser-rule shape."""
    rule = rule if isinstance(rule, dict) else {}
    correction = (
        rule.get("authoritativeCorrection")
        or rule.get("authoritative_correction")
        or {}
    )
    correction = correction if isinstance(correction, dict) else {}

    visual_pattern = _authoritative_visual_pattern(rule)

    rule_fields = rule.get("fields") if isinstance(rule.get("fields"), dict) else {}
    correction_fields = (
        correction.get("fieldRules")
        or correction.get("field_rules")
        or {}
    )
    correction_fields = correction_fields if isinstance(correction_fields, dict) else {}
    mpn_rule = {
        **(rule_fields.get("mpn") if isinstance(rule_fields.get("mpn"), dict) else {}),
        **(
            correction_fields.get("mpn")
            if isinstance(correction_fields.get("mpn"), dict)
            else {}
        ),
    }

    def first_present(mappings, keys):
        for mapping in mappings:
            for key in keys:
                if key in mapping and mapping.get(key) is not None:
                    return mapping.get(key)
        return None

    raw_delimiter = first_present(
        (correction, visual_pattern),
        ("alternateDelimiter", "alternate_delimiter"),
    )
    if raw_delimiter is None:
        alternate_delimiter = _configured_delimiter(mpn_rule)
    elif str(raw_delimiter).strip() in {
        ALTERNATE_DELIMITER_NONE,
        ALTERNATE_DELIMITER_SINGLE,
    }:
        alternate_delimiter = str(raw_delimiter).strip()
    else:
        alternate_delimiter = _configured_delimiter({"delimiter": raw_delimiter})

    alternate_mode = clean(first_present(
        (correction, visual_pattern),
        ("alternateMode", "alternate_mode"),
    ))
    if not alternate_mode:
        alternate_mode = (
            "complete"
            if alternate_delimiter and mpn_rule.get("preserveOriginalValue") is True
            else "append"
        )

    alternate_joiner = first_present(
        (correction, visual_pattern),
        ("alternateJoiner", "alternate_joiner"),
    )
    prefix_mode = clean(mpn_rule.get("prefixMode") or mpn_rule.get("prefix_mode"))
    strip_prefix = mpn_rule.get("stripPrefix")
    if strip_prefix is None:
        strip_prefix = mpn_rule.get("strip_prefix")
    suffix_mode = clean(mpn_rule.get("suffixMode") or mpn_rule.get("suffix_mode"))
    strip_suffix = mpn_rule.get("stripSuffix")
    if strip_suffix is None:
        strip_suffix = mpn_rule.get("strip_suffix")

    controls = {
        "alternateDelimiter": alternate_delimiter,
        "alternateMode": alternate_mode,
        "alternateJoiner": str(alternate_joiner or ""),
        "prefixMode": prefix_mode,
        "stripPrefix": str(strip_prefix or ""),
    }
    if suffix_mode or strip_suffix:
        controls.update({
            "suffixMode": suffix_mode,
            "stripSuffix": str(strip_suffix or ""),
        })
    return controls


def _bulk_pattern_parsing_contract(mapped_field_options):
    """Return the complete control schema rendered by Confirm Patterns."""
    return {
        "fields": deepcopy(mapped_field_options or []),
        "alternateSeparatorOptions": [
            {"value": "", "label": "Select alternate handling"},
            {"value": ALTERNATE_DELIMITER_NONE, "label": "No alternates"},
            {
                "value": ALTERNATE_DELIMITER_SINGLE,
                "label": "Single alternate (entire selected value)",
            },
            {"value": "/", "label": "Slash (/)"},
            {"value": ";", "label": "Semicolon (;)"},
            {"value": ",", "label": "Comma (,)"},
            {"value": "|", "label": "Pipe (|)"},
            {"value": "^", "label": "Caret (^)"},
            {"value": "~", "label": "Tilde (~)"},
            {"value": "\n", "label": "New line"},
            {"value": "custom", "label": "Custom delimiter"},
        ],
        "customAlternateDelimiterValue": "custom",
        "alternateModeOptions": [
            {"value": "append", "label": "Append to base value"},
            {"value": "complete", "label": "Already complete values"},
            {"value": "replace_suffix_at_marker", "label": "Replace suffix at marker"},
            {"value": "insert_at_marker", "label": "Insert values at marker"},
        ],
        "prefixModeOptions": [
            {"value": "none", "label": "Keep prefix"},
            {"value": "literal", "label": "Remove exact prefix"},
            {"value": "first_n_chars", "label": "Remove first characters"},
            {"value": "before_delimiter", "label": "Remove through delimiter"},
            {"value": "recognized_mpn_start", "label": "Remove text before recognized MPN"},
        ],
        "suffixModeOptions": [
            {"value": "none", "label": "Keep suffix"},
            {"value": "literal", "label": "Remove exact suffix"},
            {"value": "last_n_chars", "label": "Remove last characters"},
            {"value": "after_delimiter", "label": "Remove from last delimiter"},
        ],
        "defaults": {
            "alternateDelimiter": "",
            "alternateMode": "",
            "alternateJoiner": "",
            "prefixMode": "none",
            "stripPrefix": "",
            "suffixMode": "none",
            "stripSuffix": "",
        },
    }


def _configured_identity_delimiters(rule):
    raw_delimiter = (
        rule.get("comboDelimiter")
        or rule.get("combo_delimiter")
        or rule.get("delimiter")
    )
    raw_delimiter_text = str(raw_delimiter or "").replace("\u00a0", " ")
    if raw_delimiter_text in {"\n", "\r\n"}:
        return ["\n"]
    delimiter_mode = raw_delimiter_text.strip()
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


def _parenthesized_identity_content(value):
    """Classify comma-delimited content without hiding unmatched customer text."""
    text = str(value or "").replace("\u00a0", " ")
    components = text.split(",")
    manufacturer_index = -1

    def component_has_manufacturer_evidence(component):
        candidate = clean(component)
        if not candidate or candidate.startswith(("/", "\\")) or candidate.endswith(("/", "\\")):
            return False
        if _looks_like_parenthesized_manufacturer_alias(candidate):
            return True
        manufacturer, score, _reason = _best_manufacturer_from_text(candidate)
        return bool(manufacturer and float(score or 0) >= 0.90)

    if len(components) > 1:
        for index, component in enumerate(components):
            if component_has_manufacturer_evidence(component):
                manufacturer_index = index
                break
    elif component_has_manufacturer_evidence(text):
        manufacturer_index = 0

    # A manufacturer alias can legitimately contain a comma. Only fall back to
    # matching the complete phrase when the remaining components do not look
    # like customer/vendor reference codes.
    if manufacturer_index < 0 and len(components) > 1:
        has_code_component = any(
            bool(re.fullmatch(r"[A-Za-z]*\d[A-Za-z0-9._/-]*", clean(component)))
            for component in components[1:]
        )
        if not has_code_component and _looks_like_parenthesized_manufacturer_alias(text):
            return {
                "manufacturer": clean(text),
                "pattern": "<MFR>",
            }

    pattern_components = []
    for index, component in enumerate(components):
        if index == manufacturer_index:
            pattern_components.append("<MFR>")
        elif clean(component):
            pattern_components.append("<UNCLASSIFIED_TEXT>")
        else:
            pattern_components.append("")

    return {
        "manufacturer": clean(components[manufacturer_index]) if manufacturer_index >= 0 else "",
        "pattern": ",".join(pattern_components),
    }


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
        if _parenthesized_identity_content(later.group(1)).get("manufacturer"):
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
        has_structured_content = "," in match.group(1)
        manufacturer_supported = bool(
            _parenthesized_identity_content(match.group(1)).get("manufacturer")
        )
        if not trailing_is_annotations and not (
            trailing_is_blank and (manufacturer_supported or has_structured_content)
        ):
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
        is_comma = (
            character == ","
            and at_top_level
            and _has_complete_identity_before_record_separator(source[start:index])
            and _has_complete_identity_before_record_separator(source[index + 1:])
        )
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
        if is_newline or is_semicolon or is_comma or is_spaced_slash:
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
        annotation = re.match(r"[\[{][^\]}]{0,80}[\]}]", text[index:])
        if not annotation:
            break
        index += annotation.end()
    return index


def _normalized_candidate_source_span(raw_text, candidate):
    """Locate a normalized library candidate without changing source formatting."""
    source = str(raw_text or "")
    needle = re.sub(r"[^A-Z0-9]+", "", clean(candidate).upper())
    if not needle:
        return None

    projected = []
    source_positions = []
    for index, character in enumerate(source.upper()):
        if "A" <= character <= "Z" or "0" <= character <= "9":
            projected.append(character)
            source_positions.append(index)
    match_index = "".join(projected).rfind(needle)
    if match_index < 0:
        return None
    match_end = match_index + len(needle) - 1
    return source_positions[match_index], source_positions[match_end] + 1


def _split_mpn_fragment_before_parenthesized_manufacturer(raw_text):
    raw = str(raw_text or "").replace("\u00a0", " ")
    mpn_text = clean(raw_text)
    mpn_text = clean(re.sub(r"[\[{][^\]}]{1,80}[\]}]", " ", mpn_text))
    mpn_text = mpn_text.strip(" ,;:/")
    if not mpn_text:
        return "", "", ""

    suffix_values = re.findall(r"(?:@|\s)\s*\(([^()\r\n]+)\)\s*$", mpn_text)
    suffix_text = "".join(
        clean(value)
        for value in suffix_values
        if clean(value) and not re.search(r"[/\\,;|]", clean(value))
    )
    mpn_score_text = re.sub(r"(?:@|\s)\s*\([^()\r\n]+\)\s*$", "", mpn_text).strip(" @,;:/")
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
        source_candidate_span = _normalized_candidate_source_span(raw, candidate)
        if suffix_text and not re.sub(r"[^A-Z0-9]+", "", candidate.upper()).endswith(re.sub(r"[^A-Z0-9]+", "", suffix_text.upper())):
            candidate = f"{candidate}{suffix_text}"
        if clean(candidate).upper() == mpn_text.upper():
            return candidate, "", raw.strip()
        token_count = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9./+\-]*", mpn_text))
        # If the span contains prose/description before the actual code, use
        # the strongest embedded MPN. Compact two-token values can be genuine
        # MPNs, so keep those intact.
        if token_count >= 3 or len(mpn_text) > len(candidate) + 12:
            start = source_candidate_span[0] if source_candidate_span else _mpn_fragment_start(raw, candidate)
            source_mpn = raw[start:].strip()
            return source_mpn, raw[:start].strip(), source_mpn

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
        original_candidate = clean(trimmed[candidate_start:candidate_end])
        return original_candidate, leading_length + candidate_start, leading_length + candidate_end

    value_end = len(trimmed)
    value = clean(trimmed[:value_end])
    return value, leading_length, leading_length + value_end


def _trailing_annotation_pattern(text):
    pattern = []
    for match in re.finditer(r"[\[{][^\]}]{0,80}[\]}]", str(text or "")):
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
        content = match.group(1)
        content_identity = _parenthesized_identity_content(content)
        manufacturer = clean(content_identity.get("manufacturer"))
        is_directory_manufacturer = bool(manufacturer)
        is_contextual_manufacturer = (
            _is_terminal_parenthesis_before_annotations(text, match.end())
            or (
                "," in content
                and not clean(text[match.end():])
            )
        )
        if not manufacturer and is_contextual_manufacturer and "," not in content:
            manufacturer = clean(content)
            content_identity = {
                **content_identity,
                "manufacturer": manufacturer,
                "pattern": "<MFR>",
            }
            is_directory_manufacturer = bool(manufacturer)
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
            "_manufacturerConnector": (
                ""
                if (
                    "," in content
                    and match.start() > cursor
                    and not text[match.start() - 1].isspace()
                )
                else " "
            ),
            "_parenthesizedPattern": content_identity.get("pattern") or "",
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


def _strip_configured_suffix(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    mode = clean(rule.get("suffixMode") or rule.get("suffix_mode") or "none")
    suffix = clean(rule.get("stripSuffix") or rule.get("strip_suffix") or rule.get("suffix"))
    if not text or mode in {"", "none"} or not suffix:
        return text

    try:
        if mode == "regex":
            pattern = suffix if suffix.endswith("$") else f"(?:{suffix})$"
            stripped = re.sub(pattern, "", text, count=1).strip()
        elif mode == "last_n_chars":
            count = int(float(suffix))
            stripped = text[:-count].strip() if 0 < count < len(text) else text
        elif mode == "after_delimiter":
            stripped = text.rsplit(suffix, 1)[0].strip() if suffix in text else text
        else:
            stripped = text[:-len(suffix)].strip() if text.lower().endswith(suffix.lower()) else text
    except Exception:
        stripped = text
    return clean(stripped)


def _strip_configured_prefix(value, rule=None):
    text = str(value or "").replace("\u00a0", " ").strip()
    rule = rule if isinstance(rule, dict) else {}
    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    if not text:
        return _strip_configured_suffix(text, rule)
    if mode == "recognized_mpn_start":
        candidate, score, _reason = _best_mpn_from_text(text)
        if candidate and float(score or 0) >= 0.9:
            candidate_span = _normalized_candidate_source_span(text, candidate)
            if candidate_span is not None and int(candidate_span[0]) > 0:
                return _strip_configured_suffix(clean(text[int(candidate_span[0]):]), rule)
        return _strip_configured_suffix(text, rule)

    prefix = clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))
    if not prefix:
        return _strip_configured_suffix(text, rule)

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
    return _strip_configured_suffix(clean(stripped), rule)


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
    mode = clean(rule.get("prefixMode") or rule.get("prefix_mode") or "literal")
    if not text:
        return False
    if mode == "recognized_mpn_start":
        candidate, score, _reason = _best_mpn_from_text(text)
        if not candidate or float(score or 0) < 0.9:
            return False
        candidate_span = _normalized_candidate_source_span(text, candidate)
        return candidate_span is not None and int(candidate_span[0]) > 0

    prefix = clean(rule.get("stripPrefix") or rule.get("strip_prefix") or rule.get("prefix"))
    if not prefix:
        return False
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


@lru_cache(maxsize=1)
def _manufacturer_directory_words():
    return frozenset(
        word
        for key in set(load_manufacturer_lookup()) | set(load_manufacturer_phrase_lookup())
        for word in str(key).split()
        if len(word) > 2
    )


def _repair_wrapped_manufacturer_tokens(text):
    raw_tokens = [clean(token) for token in re.split(r"\s+", str(text or "").replace("\u00a0", " ").strip()) if clean(token)]
    if len(raw_tokens) <= 1:
        return clean(text)

    known_words = _manufacturer_directory_words()
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
    text = _repair_wrapped_manufacturer_tokens(text)
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
    merged_result = _merge_adjacent_known_manufacturer_segments(result)
    if len(merged_result) == target_count:
        return merged_result

    # If all but one positional manufacturer are known, preserve the unmatched
    # source slice as the remaining manufacturer instead of discarding every
    # directory match. This also handles minor customer spelling variants.
    fallback_memo = {}

    def partition(index, remaining):
        key = (index, remaining)
        if key in fallback_memo:
            return fallback_memo[key]
        tokens_left = len(token_matches) - index
        if remaining == 0:
            return (0, 0, []) if tokens_left == 0 else None
        if tokens_left < remaining:
            return None

        candidates = []
        for span in spans_by_start.get(index, []):
            rest = partition(span["end"], remaining - 1)
            if rest is not None:
                candidates.append((
                    rest[0] + 1,
                    rest[1] + int(span.get("token_count") or 0),
                    [(span["value"], True), *rest[2]],
                ))

        max_unknown_end = len(token_matches) - (remaining - 1)
        for end in range(index + 1, max_unknown_end + 1):
            rest = partition(end, remaining - 1)
            if rest is None:
                continue
            start_char = token_matches[index].start()
            end_char = token_matches[end - 1].end()
            raw_segment = clean(text[start_char:end_char])
            candidates.append((
                rest[0],
                rest[1],
                [(raw_segment, False), *rest[2]],
            ))

        if not candidates:
            fallback_memo[key] = None
            return None
        fallback_memo[key] = max(
            candidates,
            key=lambda candidate: (
                candidate[0],
                candidate[1],
                -sum(1 for _value, known in candidate[2] if not known),
            ),
        )
        return fallback_memo[key]

    fallback = partition(0, target_count)
    if fallback and fallback[0] >= target_count - 1:
        return [value for value, _known in fallback[2]]
    return merged_result


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
        separator = prefix[-1]
        prefix_body = prefix[:-1]
        if separator.isalnum():
            continue
        if separator.isspace() and not re.fullmatch(r"\d{3,8}", prefix_body):
            continue
        compact_prefix = re.sub(r"[^A-Za-z0-9]+", "", prefix_body)
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
            # Return raw records here. Callers apply the configured prefix
            # cleanup once after segmentation.
            current = line
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

    preserve_original_value = bool(
        rule.get("preserveOriginalValue")
        or rule.get("preserve_original_value")
    )
    configured_delimiter = _configured_delimiter(rule)
    if preserve_original_value and configured_delimiter:
        explicit_parts = _split_explicit_delimiter(raw_text, configured_delimiter)
        if len(explicit_parts) > 1:
            return _strip_configured_prefixes(explicit_parts, rule)

    if value_type == "mpn":
        fixed_width_prefix_parts = _fixed_width_prefix_segments(raw_text, rule)
        if len(fixed_width_prefix_parts) > 1:
            stripped_parts = _strip_configured_prefixes(fixed_width_prefix_parts, rule)
            if preserve_original_value:
                return stripped_parts
            scored = [_best_mpn_from_text(part) for part in stripped_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            if valid_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]
            digit_part_count = sum(1 for part in stripped_parts if re.search(r"\d", part))
            if digit_part_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(stripped_parts, scored)]

        wrapped_prefix_parts = _wrapped_prefixed_mpn_segments(raw_text, rule)
        if len(wrapped_prefix_parts) > 1:
            if preserve_original_value:
                return _strip_configured_prefixes(wrapped_prefix_parts, rule)
            scored = [_best_mpn_from_text(part) for part in wrapped_prefix_parts]
            valid_count = sum(1 for mpn, score, _ in scored if mpn and score >= 0.45)
            digit_part_count = sum(1 for part in wrapped_prefix_parts if re.search(r"\d", part))
            if valid_count >= 2 or digit_part_count >= 2:
                return [mpn if mpn else part for part, (mpn, _, _) in zip(wrapped_prefix_parts, scored)]

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
        if preserve_original_value:
            return stripped_parts
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
        # A directory can validate a multi-word manufacturer value, but its
        # internal aliases are not proof of alternates. Positional splitting is
        # handled later when multiple MPNs require matching manufacturers.
        return []
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
            text,
            source_column,
            min(1.0, float(score or 0) + 0.20),
            method_prefix + (f": lookup evidence {mpn}; {reason}" if reason else f": lookup evidence {mpn}"),
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


def _factwise_field_confidence(role, field):
    """Recover confidence when a confirmed interpretation contains plain values."""
    value = field.get("value") if isinstance(field, dict) else field
    value = clean(value)
    if is_blankish(value):
        return None

    if isinstance(field, dict):
        try:
            stored_confidence = float(field.get("confidence") or 0)
        except (TypeError, ValueError):
            stored_confidence = 0.0
        if stored_confidence > 0:
            return min(1.0, stored_confidence)

    if role == "mpn":
        mpn, score, _ = _best_mpn_from_text(value)
        return min(1.0, float(score or 0) + 0.20) if mpn else 0.55
    if role == "manufacturer":
        manufacturer, score, _ = _best_manufacturer_from_text(value)
        return min(1.0, float(score or 0)) if manufacturer else 0.55
    return 0.72


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


def _semantic_values_from_alternate_cell(
    row,
    headers,
    source_header,
    mapped_fields,
    field,
    config,
):
    """Apply the saved semantic rule for one alternate-group source cell."""
    if not source_header or field not in set(mapped_fields or []):
        return False, []
    source_value = _row_cell(
        row,
        source_header,
        headers,
        preserve_delimiters=True,
    )
    if is_blankish(source_value):
        return False, []

    rules = _semantic_pattern_rules(config)
    matched_rule = False
    values = []
    scoped_roles = {
        role: source_header
        for role in (mapped_fields or [])
        if role in ROLE_KEYS
    }
    for fragment in _semantic_identity_fragments(source_value, mapped_fields):
        pattern_key = _semantic_pattern_key(
            source_header,
            mapped_fields,
            fragment.get("grammar"),
        )
        rule = rules.get(pattern_key)
        if not isinstance(rule, dict) or not _field_pattern_rule_has_content(rule):
            continue
        matched_rule = True
        if _field_pattern_rule_ignores_fields(rule):
            continue

        fragment_row = dict(row) if isinstance(row, dict) else {}
        fragment_row[source_header] = fragment.get("rawValue") or ""
        fragment_config = dict(config or {})
        for key in (
            "semanticPatternRules",
            "semantic_pattern_rules",
            "fieldPatternRules",
            "field_pattern_rules",
            "_activeFieldPatternRule",
            "_active_field_pattern_rule",
            "alternateColumnGroups",
            "alternate_column_groups",
        ):
            fragment_config.pop(key, None)
        fragment_config["_semanticPatternPass"] = True
        fragment_config["alternateLayout"] = "none"
        fragment_config = _config_with_active_rule(
            fragment_config,
            _semantic_rule_for_source(rule, source_header),
        )
        parsed_entries = _infer_field_entries_for_row(
            fragment_row,
            headers,
            scoped_roles,
            [source_header],
            config=fragment_config,
        )
        for entry in parsed_entries:
            field_value = _review_entry_field_value(
                (entry.get("fields") or {}).get(field)
            )
            values.append(clean(field_value))
    return matched_rule, values


def _values_from_alternate_group_cell(
    value,
    config,
    field,
    source_header="",
    primary_header="",
    primary_parts=None,
    row=None,
    headers=None,
    mapped_fields=None,
):
    if is_blankish(value):
        return []

    primary_parts = primary_parts or []
    if source_header and primary_header and source_header == primary_header:
        if len(primary_parts) > 1:
            return primary_parts[1:]
        return []

    matched_rule, semantic_values = _semantic_values_from_alternate_cell(
        row,
        headers or [],
        source_header,
        mapped_fields or [field],
        field,
        config,
    )
    if matched_rule:
        return semantic_values

    split_type = "manufacturer" if field == "manufacturer" else "mpn" if field == "mpn" else field
    parts = _split_alternate_value(value, config, split_type)
    return parts if parts else [clean(value)]


def _apply_alternate_group_field(
    alt_fields,
    role,
    values,
    value_index,
    source_column,
    repeat_single=False,
):
    if not values:
        return
    if value_index < len(values):
        value = values[value_index]
    elif repeat_single and len(values) == 1:
        value = values[0]
    else:
        return
    if is_blankish(value):
        return
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

    for group_index, group in enumerate(groups, start=1):
        mapped_fields_by_header = {}
        for identity_role in ("cpn", "mpn", "manufacturer"):
            identity_header = clean(group.get(identity_role))
            if identity_header:
                mapped_fields_by_header.setdefault(identity_header, []).append(identity_role)
        group_values = {}
        for role in ("cpn", "mpn", "manufacturer", "quantity", "uom", "description", "level", "parent", "notes", "internalNotes"):
            source_header = group.get(role)
            raw_value = (
                _row_cell(row, source_header, headers, preserve_delimiters=True)
                if source_header
                else ""
            )
            repeat_single = role not in {"mpn", "manufacturer"}
            if role == "mpn":
                values = _values_from_alternate_group_cell(
                    raw_value,
                    config,
                    role,
                    source_header,
                    mpn_header,
                    mpn_parts,
                    row,
                    headers,
                    mapped_fields_by_header.get(source_header) or [role],
                )
            elif role == "manufacturer":
                if source_header and source_header == manufacturer_header:
                    # Selecting the primary manufacturer column for an alternate
                    # group explicitly means that every alternate reuses it.
                    values = [clean(raw_value)] if not is_blankish(raw_value) else []
                    repeat_single = True
                else:
                    values = _values_from_alternate_group_cell(
                        raw_value,
                        config,
                        role,
                        source_header,
                        manufacturer_header,
                        manufacturer_parts,
                        row,
                        headers,
                        mapped_fields_by_header.get(source_header) or [role],
                    )
            else:
                values = _values_from_alternate_group_cell(
                    raw_value,
                    config,
                    role,
                    row=row,
                    headers=headers,
                    mapped_fields=mapped_fields_by_header.get(source_header) or [role],
                )
            group_values[role] = {
                "source": source_header,
                "values": values,
                "repeatSingle": repeat_single,
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
                    repeat_single=details["repeatSingle"],
                )

            if not any(alt_fields.get(role, {}).get("value") for role in ("mpn", "manufacturer", "cpn")):
                continue
            entry = _build_factwise_entry(
                len(entries) + 1,
                alt_fields,
                f"Alternate {len(entries) + 1}",
            )
            entry["alternateGroup"] = group_index
            entry["alternateGroupSlot"] = clean(group.get("slot") or group_index)
            entries.append(entry)

    return entries


def _build_factwise_entry(index, fields, relation):
    return {
        "index": index,
        "relation": relation,
        "fields": fields,
    }


def _attach_mpn_manufacturer_pairing_check(
    entries,
    manufacturer_mapped=False,
    detected_mpn_count=None,
    detected_manufacturer_count=None,
):
    """Attach one source-fragment-level positional pairing result."""
    entries = list(entries or [])
    if not entries:
        return entries

    emitted_mpn_count = sum(
        1
        for entry in entries
        if clean(_review_entry_field_value((entry.get("fields") or {}).get("mpn")))
    )
    emitted_manufacturer_count = sum(
        1
        for entry in entries
        if clean(_review_entry_field_value((entry.get("fields") or {}).get("manufacturer")))
    )
    mpn_count = max(emitted_mpn_count, int(detected_mpn_count or 0))
    manufacturer_count = max(
        emitted_manufacturer_count,
        int(detected_manufacturer_count or 0),
    )
    has_mismatch = bool(manufacturer_mapped and mpn_count != manufacturer_count)
    message = (
        f"{mpn_count} MPNs detected, {manufacturer_count} manufacturers detected. "
        "Values were paired by position; unmatched values were left blank."
        if has_mismatch
        else ""
    )
    entries[0]["pairingCheck"] = {
        "mpnCount": mpn_count,
        "manufacturerCount": manufacturer_count,
        "hasPairingMismatch": has_mismatch,
        "warning": message,
    }
    return entries


def _positional_newline_values(value):
    """Split explicit Excel line breaks without collapsing internal blanks."""
    raw_value = str(value or "").replace("\u00a0", " ")
    values = [clean(part) for part in re.split(r"\r\n|\r|\n", raw_value)]
    while values and not values[0]:
        values.pop(0)
    while values and not values[-1]:
        values.pop()
    return values


def _pair_semantic_entries_with_separate_manufacturers(
    entries,
    row,
    headers,
    roles,
    semantic_source_columns,
):
    """Pair semantic MPN rows with a separately mapped MFR cell by position."""
    entries = list(entries or [])
    manufacturer_header = clean((roles or {}).get("manufacturer"))
    if (
        not entries
        or not manufacturer_header
        or manufacturer_header in set(semantic_source_columns or [])
    ):
        return entries

    mpn_entries = [
        entry
        for entry in entries
        if (
            not entry.get("ignoredIdentity")
            and clean(entry.get("relation")) != "Ignored"
            and clean(_review_entry_field_value((entry.get("fields") or {}).get("mpn")))
        )
    ]
    if not mpn_entries:
        return entries

    manufacturer_value = _row_cell(
        row,
        manufacturer_header,
        headers,
        preserve_delimiters=True,
    )
    manufacturer_slots = _positional_newline_values(manufacturer_value)
    if not manufacturer_slots and not is_blankish(manufacturer_value):
        manufacturer_slots = [clean(manufacturer_value)]

    unknown_manufacturers = []
    for index, entry in enumerate(mpn_entries):
        fields = entry.setdefault("fields", {})
        manufacturer = (
            manufacturer_slots[index]
            if index < len(manufacturer_slots)
            else ""
        )
        if not manufacturer:
            fields["manufacturer"] = _blank_factwise_field()
            continue

        matched_manufacturer, _, _ = _best_manufacturer_from_text(manufacturer)
        fields["manufacturer"] = _manufacturer_factwise_field(
            manufacturer,
            manufacturer_header,
            "Positionally paired Manufacturer value",
        )
        if not matched_manufacturer:
            warning = {
                "type": "manufacturer_not_in_directory",
                "message": (
                    f'Manufacturer "{manufacturer}" was preserved from the uploaded file '
                    "but was not found in the manufacturer directory."
                ),
                "value": manufacturer,
                "position": index + 1,
            }
            entry.setdefault("warnings", []).append(warning)
            unknown_manufacturers.append(warning)

    for entry in entries:
        entry.pop("pairingCheck", None)
    result = _attach_mpn_manufacturer_pairing_check(
        entries,
        manufacturer_mapped=True,
        detected_mpn_count=len(mpn_entries),
        detected_manufacturer_count=sum(
            1 for value in manufacturer_slots if not is_blankish(value)
        ),
    )
    if result and unknown_manufacturers:
        result[0]["pairingCheck"]["unknownManufacturers"] = unknown_manufacturers
    return result


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
        return re.sub(
            r"<\s*IGNORE\s*>",
            "<UNCLASSIFIED_TEXT>",
            stored,
            flags=re.IGNORECASE,
        )

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
        if role == "mpn" and operation == "insert_alternate_at_marker":
            tokens.append("<MPN_PREFIX><INSERTION_MARKER><MPN_SUFFIX>")
        elif role == "alternateList" and operation == "insert_alternate_at_marker":
            tokens.append("(<ALTERNATE_VALUES>)")
        elif role == "mpn" and operation == "replace_suffix_at_marker":
            marker = str(composition.get("markerSequence") or composition.get("marker") or "<MARKER>")
            tokens.append(f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>")
        elif role == "alternateList" and operation == "replace_suffix_at_marker":
            tokens.append("(<ALTERNATE_SUFFIXES>)")
        elif role == "mpn" and isinstance(composition, dict) and clean(
            composition.get("markerSequence") or composition.get("marker")
        ):
            marker = str(composition.get("markerSequence") or composition.get("marker"))
            tokens.append(f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>")
        elif role == "alternateList" and isinstance(composition, dict) and clean(
            composition.get("markerSequence") or composition.get("marker")
        ):
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
    if re.search(r"\[[^\[\]]{0,80}\]", text):
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


def _unclassified_display_fragment(value):
    """Preserve structural punctuation while hiding untagged customer text."""
    text = str(value or "")
    if not re.search(r"[A-Za-z0-9]", text):
        return text

    structural = set("()[]{}<>,;|^~:/@#")
    rendered = []
    cursor = 0
    while cursor < len(text):
        character = text[cursor]
        if character == "{":
            end = text.find("}", cursor + 1)
            if end >= 0:
                rendered.append("{<STATUS>}")
                cursor = end + 1
                continue
            if re.search(r"[A-Za-z0-9]", text[cursor + 1:]):
                rendered.append("{<STATUS>")
                break
        if character == "[":
            end = text.find("]", cursor + 1)
            if end >= 0:
                rendered.append("[<REF>]")
                cursor = end + 1
                continue
            if re.search(r"[A-Za-z0-9]", text[cursor + 1:]):
                rendered.append("[<REF>")
                break
        if character in structural:
            rendered.append(character)
            cursor += 1
            continue

        end = cursor
        while end < len(text) and text[end] not in structural:
            end += 1
        chunk = text[cursor:end]
        if re.search(r"[A-Za-z0-9]", chunk):
            leading = re.match(r"^\s*", chunk).group(0)
            trailing = re.search(r"\s*$", chunk).group(0)
            rendered.append(f"{leading}<UNCLASSIFIED_TEXT>{trailing}")
        else:
            rendered.append(chunk)
        cursor = end
    return "".join(rendered)


def _visual_pattern_display_from_tagged_spans(
    source_value,
    template_range,
    tagged_spans,
    visual_pattern,
):
    """Render the user-confirmed grammar from exact backend span boundaries."""
    text = str(source_value or "")
    if not template_range or not isinstance(visual_pattern, dict):
        return _visual_pattern_display_pattern(visual_pattern, text)

    start, end = template_range
    spans = sorted(
        [
            span for span in (tagged_spans or [])
            if isinstance(span, dict)
            and int(span.get("start") or 0) >= start
            and int(span.get("end") or 0) <= end
            and clean(span.get("role"))
            not in {"", "groupSeparator", "insertionMarker"}
        ],
        key=lambda item: (int(item.get("start") or 0), int(item.get("end") or 0)),
    )
    if not spans:
        return _visual_pattern_display_pattern(visual_pattern, text)

    composition = (
        visual_pattern.get("mpnComposition")
        or visual_pattern.get("mpn_composition")
        or {}
    )
    operation = clean(composition.get("operation")) if isinstance(composition, dict) else ""

    def role_token(span):
        role = clean(span.get("role"))
        if role == "ignore":
            return "<UNCLASSIFIED_TEXT>"
        if role == "mpn" and operation == "insert_alternate_at_marker":
            token = "<MPN_PREFIX><INSERTION_MARKER><MPN_SUFFIX>"
        elif role == "alternateList" and operation == "insert_alternate_at_marker":
            token = "<ALTERNATE_VALUES>"
        elif role == "mpn" and operation == "replace_suffix_at_marker":
            marker = str(composition.get("markerSequence") or composition.get("marker") or "<MARKER>")
            token = f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>"
        elif role == "alternateList" and operation == "replace_suffix_at_marker":
            token = "<ALTERNATE_SUFFIXES>"
        elif role == "mpn" and isinstance(composition, dict) and clean(
            composition.get("markerSequence") or composition.get("marker")
        ):
            marker = str(composition.get("markerSequence") or composition.get("marker"))
            token = f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>"
        elif role == "alternateList" and isinstance(composition, dict) and clean(
            composition.get("markerSequence") or composition.get("marker")
        ):
            token = "<ALTERNATE_SUFFIXES>"
        elif role == "alternateList":
            token = "<ALTERNATE_MPN_VALUES>"
        else:
            token = _pattern_display_token(role)

        selected = text[int(span.get("start") or 0):int(span.get("end") or 0)]
        wrapper = _visual_teach_wrapper(selected)
        if wrapper:
            token = f"{wrapper['open']}{token}{wrapper['close']}"
        return token

    rendered = []
    cursor = start
    for span in spans:
        span_start = int(span.get("start") or 0)
        span_end = int(span.get("end") or 0)
        if span_start < cursor:
            continue
        rendered.append(_unclassified_display_fragment(text[cursor:span_start]))
        rendered.append(role_token(span))
        cursor = span_end
    rendered.append(_unclassified_display_fragment(text[cursor:end]))
    pattern = "".join(rendered)

    separator = str(
        visual_pattern.get("recordSeparator")
        or visual_pattern.get("record_separator")
        or visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    matching_closers = {")": "(", "]": "[", "}": "{"}
    for closer in separator:
        if closer not in matching_closers:
            break
        opener = matching_closers[closer]
        if pattern.count(opener) <= pattern.count(closer):
            break
        pattern += closer
    if separator:
        pattern = f"{pattern} repeated by {separator}"
    return clean(pattern)


def _visual_pattern_display_quality(pattern):
    """Prefer grammars with mapped roles over degraded empty-occurrence labels."""
    text = clean(pattern)
    placeholders = re.findall(r"<[A-Z0-9_]+>", text.upper())
    supporting_tokens = {"<UNCLASSIFIED_TEXT>", "<STATUS>", "<REF>"}
    mapped_token_count = sum(token not in supporting_tokens for token in placeholders)
    structural_count = len(re.findall(r"[^A-Za-z0-9\s<>_]", text))
    return mapped_token_count, len(placeholders), structural_count, len(text)


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
    suffix_groups = list(re.finditer(r"\([^()\r\n]+\)", text))
    if suffix_groups:
        before_first_group = text[:suffix_groups[0].start()].rstrip()
        alternate_text = clean(suffix_groups[0].group(0)[1:-1])
        delimiter = _infer_list_delimiter(alternate_text)
        # Marker placement is part of the grammar even when the first wrapped
        # value is singular. Otherwise ``MPN@ (ALT)`` and
        # ``MPN_PREFIX@MPN_SUFFIX (ALT)`` collapse to the same semantic key and
        # can replay each other's saved rules.
        marker_match = _select_structural_marker(
            before_first_group,
            alternate_text,
            delimiter,
        )
        if (
            marker_match
            and not delimiter
            and not any(marker in clean(marker_match.get("value")) for marker in ("@", "#"))
        ):
            marker_match = None
        if marker_match:
            marker = marker_match["value"]
            marker_prefix = marker_match["prefix"]
            marker_suffix = marker_match["suffix"]
            base_pattern = (
                f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>"
                if clean(marker_prefix) and clean(marker_suffix)
                else f"<MPN>{marker}"
            )
            wrapped_role = "<ALTERNATE_SUFFIXES>" if delimiter else "<SUFFIX>"
            return base_pattern + " " + " ".join(f"({wrapped_role})" for _ in suffix_groups)
        else:
            connector = "" if suffix_groups[0].start() > 0 and not text[suffix_groups[0].start() - 1].isspace() else " "
        return "<MPN>" + connector + " ".join("(<SUFFIX>)" for _ in suffix_groups)

    # Keep standalone structural markers visible so their interpretations can
    # be taught and replayed even when this record has no alternate list.
    marker_match = _select_structural_marker(text, "", "")
    if marker_match and clean(marker_match.get("suffix")) and not clean(
        marker_match.get("suffix")
    ).isalpha():
        marker_match = None
    if marker_match:
        marker = marker_match["value"]
        marker_prefix = marker_match["prefix"]
        marker_suffix = marker_match["suffix"]
        if clean(marker_prefix):
            return (
                f"<MPN_PREFIX>{marker}<MPN_SUFFIX>"
                if clean(marker_suffix)
                else f"<MPN>{marker}"
            )
    return "<MPN>"


def _mpn_only_marker_alternate_pattern(fragment):
    """Describe a marker/list pattern in a column mapped only to MPN."""
    text = clean(fragment).strip(" ,;:/")
    groups = list(re.finditer(r"\(([^()\r\n]+)\)", text))
    if not groups:
        return ""

    before_first_group = text[:groups[0].start()].rstrip()
    alternate_text = clean(groups[0].group(1))
    delimiter = _infer_list_delimiter(alternate_text)
    if not delimiter:
        return ""
    marker_match = _select_structural_marker(before_first_group, alternate_text, delimiter)
    if not marker_match:
        return ""

    marker = marker_match["value"]
    marker_prefix = marker_match["prefix"]
    marker_suffix = marker_match["suffix"]
    base_pattern = (
        f"<MPN_PREFIX>{marker}<PRIMARY_SUFFIX>"
        if clean(marker_prefix) and clean(marker_suffix)
        else f"<MPN>{marker}"
    )
    tokens = [base_pattern, "(<ALTERNATE_SUFFIXES>)"]
    tokens.extend("(<UNCLASSIFIED_TEXT>)" for _group in groups[1:])
    trailing = _trailing_annotation_pattern(text[groups[-1].end():])
    if trailing:
        tokens.append(trailing)
    return " ".join(tokens)


def _single_field_delimited_pattern(value, role, include_newline=True):
    """Surface structural separators without deciding whether they split values."""
    text = str(value or "").replace("\u00a0", " ").strip()
    token = _pattern_display_token(role)
    delimiter_patterns = (
        (r"/", "/"),
        (r"\|", "|"),
        (r";", ";"),
        (r"\^", "^"),
        (r"~", "~"),
        (r"%", "%"),
        (r",", ","),
    )
    if include_newline:
        delimiter_patterns = ((r"\r\n|\r|\n", "[new line]"),) + delimiter_patterns
    for delimiter_pattern, display_delimiter in delimiter_patterns:
        parts = [clean(part) for part in re.split(delimiter_pattern, text)]
        if len(parts) > 1 and sum(1 for part in parts if part) > 1:
            return f"{token} {display_delimiter} {token}"
    return ""


def _same_cell_parenthesized_patterns_from_entries(value, entries, header):
    pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(value)
    if not pairs:
        return []

    patterns = {}
    for pair in pairs:
        source_pattern = _mpn_source_fragment_pattern(pair.get("_sourceFragment"))
        connector = pair.get("_manufacturerConnector", " ")
        parenthesized_pattern = pair.get("_parenthesizedPattern") or "<MFR>"
        trailing = clean(pair.get("_trailingPattern"))
        key = (source_pattern, connector, parenthesized_pattern, trailing)
        patterns[key] = patterns.get(key, 0) + 1

    output = []
    for (source_pattern, connector, parenthesized_pattern, trailing), count in sorted(
        patterns.items(),
        key=lambda item: (
            0 if "@" in item[0][0] else 1,
            -item[0][0].count("(<SUFFIX>)"),
            item[0][0],
            item[0][1],
        ),
    ):
        pattern = f"{source_pattern}{connector}({parenthesized_pattern})"
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


def _semantic_grammar_required_roles(grammar, mapped_fields=None):
    """Return parser roles that must be represented by a semantic grammar."""
    grammar_text = clean(grammar).upper()
    mapped = {clean(role) for role in (mapped_fields or []) if clean(role)}
    required = set()

    if "mpn" in mapped and re.search(
        r"<(?:MPN|MPN_PREFIX|MPN_SUFFIX|PRIMARY_SUFFIX)>",
        grammar_text,
    ):
        required.add("mpn")
    if "manufacturer" in mapped and "<MFR>" in grammar_text:
        required.add("manufacturer")

    for role in mapped - {"mpn", "manufacturer"}:
        if _pattern_display_token(role).upper() in grammar_text:
            required.add(role)

    if re.search(r"<ALTERNATE_[A-Z0-9_]*>", grammar_text):
        required.add("alternateList")
    return required


def _semantic_grammar_is_unclassified(grammar, mapped_fields=None):
    """Return whether a fragment has no detected mapped-field meaning."""
    return bool(clean(grammar)) and not _semantic_grammar_required_roles(
        grammar,
        mapped_fields,
    )


def _automatic_unclassified_rule(source_column, mapped_fields, pattern_key=""):
    """Build a transient rule that preserves the row but blanks this source's roles."""
    ignored_fields = [
        clean(field)
        for field in (mapped_fields or [])
        if clean(field) in ROLE_KEYS
    ]
    return {
        "patternKey": clean(pattern_key),
        "automaticUnclassified": True,
        "ephemeral": True,
        "visualPattern": {
            "type": "ignore_fields",
            "sourceHeader": clean(source_column),
            "excludeRow": False,
            "ignoredFields": ignored_fields,
            "displayPattern": "<UNCLASSIFIED_TEXT>",
            "automaticUnclassified": True,
            "ephemeral": True,
        },
    }


def _semantic_interpretation_coverage(grammar, mapped_fields, parser_rule, interpretations=None):
    """Validate that a stored/session rule covers and applies every grammar role."""
    required_roles = _semantic_grammar_required_roles(grammar, mapped_fields)
    parser_rule = parser_rule if isinstance(parser_rule, dict) else {}
    if _field_pattern_rule_ignores_fields(parser_rule):
        return {
            "valid": True,
            "requiredRoles": sorted(required_roles),
            "coveredRoles": ["ignore"],
            "missingRoles": [],
            "failedOccurrenceCount": 0,
        }

    visual_pattern = parser_rule.get("visualPattern") or parser_rule.get("visual_pattern") or {}
    visual_pattern = visual_pattern if isinstance(visual_pattern, dict) else {}
    segments = visual_pattern.get("segments") if isinstance(visual_pattern.get("segments"), list) else []
    covered_roles = {
        clean(segment.get("role"))
        for segment in segments
        if isinstance(segment, dict) and clean(segment.get("role"))
    }
    covered_roles.update(
        clean(role)
        for role, rule in (parser_rule.get("fields") or {}).items()
        if clean(role) and isinstance(rule, dict) and rule
    )

    # Retain support for older typed rules that predate explicit visual segments.
    visual_type = clean(visual_pattern.get("type"))
    if visual_type in {"bracket_manufacturer", "bracket_alternate_manufacturer"}:
        covered_roles.update({"mpn", "manufacturer"})
    if visual_type == "bracket_alternate_manufacturer":
        covered_roles.add("alternateList")

    missing_roles = required_roles - covered_roles
    failed_occurrences = []
    safe_interpretations = [
        interpretation
        for interpretation in (interpretations or [])
        if isinstance(interpretation, dict)
    ]
    if not missing_roles and required_roles and interpretations is not None and not safe_interpretations:
        failed_occurrences.append({
            "occurrenceId": "",
            "sourceRow": None,
            "missingRoles": sorted(required_roles),
        })
    if not missing_roles and safe_interpretations:
        for interpretation in safe_interpretations:
            span_roles = {
                clean(span.get("role"))
                for span in interpretation.get("interpretationSpans") or []
                if isinstance(span, dict) and clean(span.get("role"))
            }
            occurrence_missing = required_roles - span_roles
            if occurrence_missing:
                failed_occurrences.append({
                    "occurrenceId": clean(interpretation.get("occurrenceId")),
                    "sourceRow": interpretation.get("sourceRow"),
                    "missingRoles": sorted(occurrence_missing),
                })

    return {
        "valid": not missing_roles and not failed_occurrences,
        "requiredRoles": sorted(required_roles),
        "coveredRoles": sorted(covered_roles),
        "missingRoles": sorted(missing_roles),
        "failedOccurrenceCount": len(failed_occurrences),
        "failedOccurrences": failed_occurrences[:10],
    }


def _generated_mpn_value(entry):
    fields = entry.get("fields") if isinstance(entry, dict) else {}
    fields = fields if isinstance(fields, dict) else {}
    mpn = fields.get("mpn")
    if isinstance(mpn, dict):
        return clean(mpn.get("value"))
    return clean(mpn)


def _verified_mpn_matches(normalized_values, lookup=None):
    """Resolve verification evidence without replacing customer MPN text."""
    if lookup is None:
        lookup = load_mpn_mfr_lookup()
    values = {value for value in normalized_values or [] if value}
    if not values or not lookup:
        return {}
    matcher = getattr(lookup, "match_normalized_many", None)
    if callable(matcher):
        return matcher(values, threshold=MPN_RECOGNITION_SIMILARITY_THRESHOLD)

    # Legacy JSON lookup support is exact-only. Production database lookups use
    # the optimized matcher above for both exact and 90% similarity evidence.
    normalized_lookup = {
        normalize_mpn(key): key
        for key in lookup
        if normalize_mpn(key)
    } if isinstance(lookup, dict) else {}
    return {
        value: {
            "matched": True,
            "score": 100.0,
            "match_type": "exact",
            "matched_mpn": normalized_lookup[value],
            "matched_normalized_mpn": value,
        }
        for value in values
        if value in normalized_lookup
    }


def _validate_semantic_pattern_mpns(patterns, lookup=None):
    """Validate every generated MPN for each semantic review pattern."""
    candidates = set()
    for pattern in patterns or []:
        if "mpn" not in (pattern.get("mappedFields") or []):
            continue
        for interpretation in pattern.get("interpretations") or []:
            for entry in interpretation.get("entries") or []:
                normalized = normalize_mpn(_generated_mpn_value(entry))
                if normalized:
                    candidates.add(normalized)
    matches = _verified_mpn_matches(candidates, lookup=lookup)

    validations = {}
    for pattern in patterns or []:
        pattern_key = clean(pattern.get("patternKey") or pattern.get("id"))
        if "mpn" not in (pattern.get("mappedFields") or []):
            validations[pattern_key] = {
                "applicable": False,
                "valid": True,
                "threshold": MPN_RECOGNITION_SIMILARITY_THRESHOLD,
                "generatedMpnCount": 0,
                "matchedMpnCount": 0,
                "matches": [],
                "failures": [],
            }
            continue

        evidence = []
        failures = []
        interpretations = pattern.get("interpretations") or []
        if not interpretations:
            failures.append({"reason": "blank_mpn", "value": ""})
        for interpretation in interpretations:
            occurrence = {
                "occurrenceId": clean(interpretation.get("occurrenceId")),
                "sourceRow": interpretation.get("sourceRow"),
            }
            if interpretation.get("ruleFallbackUsed"):
                failures.append({
                    **occurrence,
                    "reason": "parser_fallback_used",
                    "value": "",
                })
            entries = interpretation.get("entries") or []
            if not entries:
                failures.append({
                    **occurrence,
                    "reason": "blank_mpn",
                    "value": "",
                })
                continue
            for entry_index, entry in enumerate(entries):
                value = _generated_mpn_value(entry)
                normalized = normalize_mpn(value)
                match = matches.get(normalized) or {}
                match_type = clean(match.get("match_type"))
                result = {
                    **occurrence,
                    "entryIndex": entry_index,
                    "value": value,
                    "normalizedValue": normalized,
                    "matched": bool(match.get("matched")),
                    "score": float(match.get("score") or 0.0),
                    "matchType": match_type or "none",
                    "matchedMpn": clean(match.get("matched_mpn")),
                }
                if not normalized:
                    result.update(matched=False, matchType="none", reason="blank_mpn")
                    failures.append(result)
                elif "%" in value and match_type != "exact":
                    result.update(matched=False, matchType="invalid_spec", reason="invalid_mpn_spec")
                    failures.append(result)
                elif not match.get("matched"):
                    result["reason"] = "mpn_similarity_below_threshold"
                    failures.append(result)
                evidence.append(result)

        reasons = list(dict.fromkeys(item.get("reason") for item in failures if item.get("reason")))
        validations[pattern_key] = {
            "applicable": True,
            "valid": not failures and bool(evidence),
            "threshold": MPN_RECOGNITION_SIMILARITY_THRESHOLD,
            "generatedMpnCount": len(evidence),
            "matchedMpnCount": sum(1 for item in evidence if item.get("matched")),
            "matches": evidence[:10],
            "failures": failures[:20],
            "evidenceTruncated": len(evidence) > 10 or len(failures) > 20,
            "reasons": reasons,
            "reason": reasons[0] if reasons else "",
        }
    return validations


def _compact_recognition_validation(validation):
    compact = deepcopy(validation or {})
    mpn_validation = compact.get("mpnValidation")
    if isinstance(mpn_validation, dict):
        compact["mpnValidation"] = {
            key: value
            for key, value in mpn_validation.items()
            if key not in {"matches", "failures"}
        }
    return compact


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


def _global_rule_for_current_roles(rule, roles):
    """Rebind a global visual rule to the equivalent column in this structure."""
    rebound = dict(rule or {})
    if clean(rebound.get("matchedLibraryScope")) != "global":
        return rebound
    visual_pattern = rebound.get("visualPattern") or rebound.get("visual_pattern")
    if not isinstance(visual_pattern, dict):
        return rebound

    mapped_roles = {
        clean(segment.get("role"))
        for segment in (visual_pattern.get("segments") or [])
        if isinstance(segment, dict) and clean(segment.get("role")) in ROLE_KEYS
    }
    mapped_roles.update(
        clean(role)
        for role in (visual_pattern.get("ignoredFields") or visual_pattern.get("ignored_fields") or [])
        if clean(role) in ROLE_KEYS
    )
    current_headers = {
        clean((roles or {}).get(role))
        for role in mapped_roles
        if clean((roles or {}).get(role))
    }
    if len(current_headers) == 1:
        return _semantic_rule_for_source(rebound, current_headers.pop())
    return rebound


def _symbol_runs(value):
    """Return repeated non-alphanumeric symbols without assuming their literals."""
    text = str(value or "")
    runs = []
    index = 0
    while index < len(text):
        character = text[index]
        if character.isalnum() or character.isspace():
            index += 1
            continue
        end = index + 1
        while end < len(text) and text[end] == character:
            end += 1
        runs.append({"start": index, "end": end, "value": text[index:end]})
        index = end
    return runs


def _contiguous_symbol_runs(value):
    """Return maximal punctuation runs, including mixed-symbol markers."""
    text = str(value or "")
    runs = []
    index = 0
    while index < len(text):
        if text[index].isalnum() or text[index].isspace():
            index += 1
            continue
        end = index + 1
        while end < len(text) and not text[end].isalnum() and not text[end].isspace():
            end += 1
        runs.append({"start": index, "end": end, "value": text[index:end]})
        index = end
    return runs


def _infer_list_delimiter(value):
    """Infer a separator from list structure rather than a delimiter whitelist."""
    text = str(value or "").strip()
    if not text:
        return ""

    line_breaks = re.findall(r"\r\n|\r|\n", text)
    if line_breaks and len([part for part in re.split(r"\r\n|\r|\n", text) if clean(part)]) >= 2:
        return line_breaks[0]

    candidates = []
    seen = set()
    for run in _symbol_runs(text):
        delimiter = run["value"]
        if delimiter in seen:
            continue
        seen.add(delimiter)
        raw_parts = text.split(delimiter)
        parts = [clean(part) for part in raw_parts if clean(part)]
        has_edge_separator = bool(raw_parts and (not clean(raw_parts[0]) or not clean(raw_parts[-1])))
        if len(parts) < 2 and not (len(parts) == 1 and has_edge_separator):
            continue
        if (
            len(parts) == 2
            and all(part.isalpha() and len(part) > 3 for part in parts)
            and any(character.isspace() for character in text)
        ):
            continue
        shapes = {
            re.sub(r"[A-Za-z]+", "A", re.sub(r"\d+", "9", part.upper()))
            for part in parts
        }
        candidates.append((
            1 if has_edge_separator else 0,
            len(parts),
            -len(shapes),
            len(delimiter),
            -run["start"],
            delimiter,
        ))
    return max(candidates)[-1] if candidates else ""


def _structural_marker_candidates(value):
    """Return every possible marker boundary while preserving source offsets."""
    text = str(value or "").rstrip()
    candidates = []
    seen = set()
    for run in _contiguous_symbol_runs(text) + _symbol_runs(text):
        identity = (run["start"], run["end"], run["value"])
        if identity in seen:
            continue
        seen.add(identity)
        prefix = text[:run["start"]]
        suffix = text[run["end"]:]
        if not clean(prefix) or not any(character.isalnum() for character in prefix):
            continue
        marker = run["value"]
        candidates.append({
            **run,
            "prefix": prefix,
            "suffix": suffix,
            "occurrence": text[:run["start"]].count(marker) + 1,
        })
    return candidates


def _directory_mpn_similarity(value):
    """Return verified MPN evidence at the configured 90 percent threshold."""
    normalized = normalize_mpn(value)
    if not normalized:
        return 0.0
    lookup = load_mpn_mfr_lookup()
    if hasattr(lookup, "match_normalized_many"):
        match = lookup.match_normalized_many(
            [normalized],
            threshold=MPN_RECOGNITION_SIMILARITY_THRESHOLD,
        ).get(normalized) or {}
        return float(match.get("score") or 0.0)
    entry = lookup.get(value) if hasattr(lookup, "get") else None
    return 100.0 if isinstance(entry, dict) and clean(entry.get("mpn")) else 0.0


def _effective_marker_operation(mpn_template, alternate_text, delimiter, composition, default):
    """Resolve marker semantics only when verified MPN evidence distinguishes them."""
    marker_parts = _split_visual_mpn_at_marker(mpn_template, composition)
    if not marker_parts or not delimiter:
        return default
    prefix, primary_suffix = marker_parts
    raw_alternates = str(alternate_text or "").strip()
    wrapper_match = re.match(r"^([\(\[\{<])(.*)([\)\]\}>])$", raw_alternates, flags=re.DOTALL)
    if wrapper_match:
        raw_alternates = wrapper_match.group(2).strip()
    raw_parts = raw_alternates.split(delimiter)
    alternates = [clean(part) for part in raw_parts if clean(part)]
    if not alternates:
        return default

    # With no suffix after the marker, insertion and replacement are the same
    # operation. Use one canonical name without guessing from token lengths.
    if not primary_suffix:
        return "insert_alternate_at_marker"

    insertion_values = [f"{prefix}{alternate}{primary_suffix}" for alternate in alternates]
    replacement_values = [f"{prefix}{alternate}" for alternate in alternates]
    insertion_scores = [_directory_mpn_similarity(value) for value in insertion_values]
    replacement_scores = [_directory_mpn_similarity(value) for value in replacement_values]
    insertion_hits = sum(score >= MPN_RECOGNITION_SIMILARITY_THRESHOLD for score in insertion_scores)
    replacement_hits = sum(score >= MPN_RECOGNITION_SIMILARITY_THRESHOLD for score in replacement_scores)
    if insertion_hits != replacement_hits:
        return "insert_alternate_at_marker" if insertion_hits > replacement_hits else "replace_suffix_at_marker"
    if insertion_hits and replacement_hits:
        insertion_score = sum(insertion_scores) / len(insertion_scores)
        replacement_score = sum(replacement_scores) / len(replacement_scores)
        if insertion_score != replacement_score:
            return "insert_alternate_at_marker" if insertion_score > replacement_score else "replace_suffix_at_marker"
    return default


def _select_structural_marker(mpn_template, alternate_text, delimiter):
    """Select a marker only when structure or directory evidence is unambiguous."""
    candidates = _structural_marker_candidates(mpn_template)
    if not candidates:
        return None
    source_length = len(str(mpn_template or "").rstrip())
    trailing_candidates = [
        candidate for candidate in candidates
        if candidate["end"] == source_length
    ]
    if trailing_candidates:
        return {**trailing_candidates[-1], "operation": "insert_alternate_at_marker"}
    supported = []
    for candidate in candidates:
        composition = {
            "marker": candidate["value"],
            "markerSequence": candidate["value"],
            "markerOccurrence": candidate["occurrence"],
        }
        operation = _effective_marker_operation(
            mpn_template,
            alternate_text,
            delimiter,
            composition,
            "",
        )
        if operation:
            supported.append({**candidate, "operation": operation})
    if len(supported) == 1:
        return supported[0]
    if supported:
        supported.sort(key=lambda item: (item["end"] - item["start"], item["start"]), reverse=True)
        return supported[0]
    maximal_runs = _contiguous_symbol_runs(mpn_template)
    if not maximal_runs:
        return None
    maximal = maximal_runs[-1]
    maximal_identity = (maximal["start"], maximal["end"], maximal["value"])
    selected = next(
        (candidate for candidate in candidates if (
            candidate["start"], candidate["end"], candidate["value"]
        ) == maximal_identity),
        None,
    )
    if selected is None:
        return None
    if not clean(selected.get("suffix")):
        selected = next(
            (
                candidate
                for candidate in reversed(candidates)
                if candidate["end"] == source_length
            ),
            selected,
        )
    return {**selected, "operation": ""}


def _finalize_inferred_marker_operation(visual_pattern, mpn_template, alternate_text, delimiter):
    """Attach a directory-supported operation or explicitly require review."""
    if not isinstance(visual_pattern, dict):
        return visual_pattern
    composition = dict(visual_pattern.get("mpnComposition") or {})
    operation = _effective_marker_operation(
        mpn_template,
        alternate_text,
        delimiter,
        composition,
        "",
    )
    if operation == "replace_suffix_at_marker":
        marker = str(composition.get("markerSequence") or composition.get("marker") or "")
        visual_pattern["alternateMode"] = "replace_suffix_at_marker"
        visual_pattern["mpnComposition"] = {
            **composition,
            "operation": operation,
            "marker": marker,
            "markerSequence": marker,
            "prefixSource": "mpn_before_marker",
            "primarySuffixSource": "mpn_after_marker",
            "alternateSuffixSource": "alternateList",
        }
        visual_pattern["operationStatus"] = "directory_supported"
    elif operation == "insert_alternate_at_marker":
        visual_pattern["alternateMode"] = "insert_at_marker"
        visual_pattern["mpnComposition"] = {
            **composition,
            "operation": operation,
            "prefixSource": "mpn_before_marker",
            "suffixSource": "mpn_after_marker",
            "alternateSource": "alternateList",
        }
        visual_pattern["operationStatus"] = "directory_supported"
    else:
        visual_pattern["alternateMode"] = "marker_operation_requires_confirmation"
        visual_pattern["mpnComposition"] = {
            **composition,
            "operation": "",
            "prefixSource": "mpn_before_marker",
            "suffixSource": "mpn_after_marker",
            "alternateSource": "alternateList",
        }
        visual_pattern["operationStatus"] = "needs_user_confirmation"
        visual_pattern.setdefault("recognitionWarnings", []).append({
            "code": "ambiguous_marker_operation",
            "message": "Choose whether alternate values are inserted at the marker or replace the suffix after it.",
        })
    return visual_pattern


def _infer_marker_alternate_visual_rule(source_value, source_column, mapped_fields):
    """Discover an unambiguous marker/list/MFR grammar from backend evidence."""
    mapped = set(mapped_fields or [])
    if "mpn" not in mapped:
        return {}

    text = str(source_value or "").replace("\u00a0", " ")
    if "manufacturer" not in mapped:
        suffix_groups = list(re.finditer(r"\(([^()\r\n]+)\)", text))
        if not suffix_groups:
            return {}
        suffix_group = suffix_groups[0]
        suffix_text = suffix_group.group(1)
        delimiter = _infer_list_delimiter(suffix_text)
        if not delimiter:
            return {}
        before_suffix = text[:suffix_group.start()].rstrip()
        marker_match = _select_structural_marker(before_suffix, suffix_text, delimiter)
        if not marker_match:
            return {}
        candidate, candidate_score, _reason = _best_mpn_from_text(before_suffix)
        if not candidate or float(candidate_score or 0) < 0.55:
            return {}
        mpn_start = len(before_suffix) - len(before_suffix.lstrip())
        mpn_end = len(before_suffix)
        tagged_spans = [
            {"start": mpn_start, "end": mpn_end, "role": "mpn"},
            {
                "start": marker_match["start"],
                "end": marker_match["end"],
                "role": "insertionMarker",
            },
            {
                "start": suffix_group.start(1),
                "end": suffix_group.end(1),
                "role": "alternateList",
            },
        ]
        visual_pattern = derive_visual_pattern_from_tagged_spans(
            text,
            source_column,
            tagged_spans,
            alternate_delimiter=delimiter,
            alternate_mode="insert_at_marker",
        )
        visual_pattern = _finalize_inferred_marker_operation(
            visual_pattern,
            before_suffix,
            suffix_text,
            delimiter,
        )
        return {"fields": {}, "visualPattern": visual_pattern} if visual_pattern else {}

    pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(text)
    if len(pairs) != 1:
        return {}

    pair = pairs[0]
    source_fragment = str(pair.get("_sourceFragment") or "")
    suffix_groups = list(re.finditer(r"\(([^()\r\n]+)\)", source_fragment))
    if len(suffix_groups) != 1:
        return {}

    suffix_group = suffix_groups[0]
    suffix_text = suffix_group.group(1)
    delimiter = _infer_list_delimiter(suffix_text)
    if not delimiter:
        return {}

    before_suffix = source_fragment[:suffix_group.start()].rstrip()
    marker_match = _select_structural_marker(before_suffix, suffix_text, delimiter)
    if not marker_match:
        return {}

    manufacturer = clean(pair.get("manufacturer"))
    if not manufacturer:
        return {}
    manufacturer_supported = _looks_like_parenthesized_manufacturer_alias(manufacturer)

    source_offset = text.find(source_fragment)
    mpn_span = _normalized_candidate_source_span(source_fragment, pair.get("mpn"))
    if mpn_span:
        mpn_span = (mpn_span[0], min(mpn_span[1], suffix_group.start()))
    manufacturer_match = next((
        match
        for match in re.finditer(r"\(([^()\r\n]+)\)", text)
        if _token_key(match.group(1)) == _token_key(manufacturer)
    ), None)
    if source_offset < 0 or not mpn_span or manufacturer_match is None:
        return {}

    marker_start = marker_match["start"]
    marker_end = marker_match["end"]
    if (
        marker_start < mpn_span[0]
        or marker_start > mpn_span[1]
        or (marker_start < mpn_span[1] and marker_end > mpn_span[1])
    ):
        return {}

    tagged_spans = [
        {
            "start": source_offset + suffix_group.start(1),
            "end": source_offset + suffix_group.end(1),
            "role": "alternateList",
        },
        {
            "start": manufacturer_match.start(1),
            "end": manufacturer_match.end(1),
            "role": "manufacturer",
        },
    ]
    if marker_start > mpn_span[0]:
        tagged_spans.append({
            "start": source_offset + mpn_span[0],
            "end": source_offset + marker_start,
            "role": "mpn",
        })
    tagged_spans.append({
        "start": source_offset + marker_start,
        "end": source_offset + marker_end,
        "role": "insertionMarker",
    })
    if marker_end < mpn_span[1]:
        tagged_spans.append({
            "start": source_offset + marker_end,
            "end": source_offset + mpn_span[1],
            "role": "mpn",
        })
    visual_pattern = derive_visual_pattern_from_tagged_spans(
        text,
        source_column,
        tagged_spans,
        alternate_delimiter=delimiter,
        alternate_mode="insert_at_marker",
    )
    if not visual_pattern:
        return {}
    visual_pattern = _finalize_inferred_marker_operation(
        visual_pattern,
        before_suffix,
        suffix_text,
        delimiter,
    )
    if not manufacturer_supported:
        visual_pattern.setdefault("recognitionWarnings", []).append({
            "code": "manufacturer_not_verified",
            "message": "The structurally identified manufacturer is not verified in the manufacturer directory.",
            "sourceText": manufacturer,
        })
    return {"fields": {}, "visualPattern": visual_pattern}


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


def _repeated_fixed_width_mpn_prefix_layout(value):
    """Find repeated supplier-code prefixes without depending on MPN position."""
    text = str(value or "").replace("\u00a0", " ").strip()
    if not text or re.search(r"[\r\n]", text) or not re.search(r"\s", text):
        return {}

    candidates = []
    for match in re.finditer(
        r"(?<!\S)(?:[A-Za-z0-9]{3,12}[-_:]|[0-9]{3,8}\s)(?=\S)",
        text,
    ):
        candidates.append({
            "start": match.start(),
            "length": len(match.group(0)),
        })
    if not candidates or candidates[0]["start"] != 0:
        return {}

    length_counts = Counter(candidate["length"] for candidate in candidates)
    prefix_length, evidence_count = max(
        length_counts.items(),
        key=lambda item: (item[1], -item[0]),
    )
    starts = [
        candidate["start"]
        for candidate in candidates
        if candidate["length"] == prefix_length
    ]
    if evidence_count < 2 or starts[0] != 0:
        return {}

    parts = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        part = clean(text[start:end])
        if len(part) <= prefix_length:
            return {}
        parts.append(part)
    if len(parts) < 2:
        return {}

    return {
        "prefixLength": prefix_length,
        "recordDelimiter": "repeated_prefix",
        "lineCount": 1,
        "evidenceCount": evidence_count,
    }


def _mpn_position_prefix_layout(value):
    """Locate verified MPN starts without making their offsets pattern identity."""
    text = str(value or "").replace("\u00a0", " ")
    lines = [line.strip() for line in re.split(r"\r?\n+", text) if not is_blankish(line)]
    if not lines:
        return {}

    if len(lines) == 1:
        repeated_layout = _repeated_fixed_width_mpn_prefix_layout(lines[0])
        if repeated_layout:
            return repeated_layout

    recognized_starts = []
    for line in lines:
        candidate, score, _reason = _best_mpn_from_text(line)
        if not candidate or float(score or 0) < 0.9:
            return {}
        candidate_span = _normalized_candidate_source_span(line, candidate)
        if candidate_span is None:
            return {}
        recognized_starts.append(int(candidate_span[0]))

    if not recognized_starts or any(start <= 0 for start in recognized_starts):
        return {}
    if any(len(line) <= start for line, start in zip(lines, recognized_starts)):
        return {}

    return {
        "prefixLength": recognized_starts[0] if len(set(recognized_starts)) == 1 else None,
        "prefixLengths": recognized_starts,
        "recordDelimiter": "\\n" if len(lines) > 1 else "none",
        "lineCount": len(lines),
        "evidenceCount": len(recognized_starts),
    }


def _mpn_position_prefix_rule(value, source_column=""):
    layout = _mpn_position_prefix_layout(value)
    if not layout:
        return {}
    repeated_prefix = layout["recordDelimiter"] == "repeated_prefix"
    mpn_rule = {
        "delimiter": layout["recordDelimiter"],
        "prefixMode": "first_n_chars" if repeated_prefix else "recognized_mpn_start",
        "detectionSource": "recognized_mpn_position",
    }
    if repeated_prefix:
        mpn_rule.update({
            "stripPrefix": str(layout["prefixLength"]),
            "preserveOriginalValue": True,
        })
    rule = {
        "fields": {
            "mpn": mpn_rule,
        },
    }
    if layout["recordDelimiter"] == "\\n":
        rule["visualPattern"] = {
            "type": "field_split",
            "sourceHeader": clean(source_column),
            "alternateDelimiter": "\n",
            "alternateMode": "complete",
            "segments": [],
        }
    return rule


def _semantic_identity_fragments(value, mapped_fields):
    """Split a mapped cell into independently teachable semantic records."""
    text = str(value or "").replace("\u00a0", " ")
    if is_blankish(text):
        return []

    mapped = set(mapped_fields or [])
    if not {"mpn", "manufacturer"}.issubset(mapped):
        prefix_layout = {}
        if mapped == {"mpn"}:
            # A one-to-one MPN column can still contain a real MPN plus customer
            # annotations, suffix lists, status text, or other cleanup content.
            # Directory/value evidence identifies the MPN span; the remaining
            # text is deliberately left teachable instead of being discarded.
            prefix_layout = _mpn_position_prefix_layout(text)
            grammar = _mpn_only_marker_alternate_pattern(text)
            if (
                not grammar
                and prefix_layout
                and prefix_layout.get("recordDelimiter") in {"\\n", "repeated_prefix"}
            ):
                grammar = "<PREFIX><MPN>"
                if prefix_layout["recordDelimiter"] == "\\n":
                    grammar = f"{grammar} repeated by <NEW_LINE>"
                else:
                    grammar = f"{grammar} repeated by <ADJACENT_RECORD>"
            if not grammar:
                grammar = _single_field_delimited_pattern(
                    text,
                    "mpn",
                    include_newline=False,
                )
            if not grammar and prefix_layout:
                grammar = "<PREFIX><MPN>"
            if not grammar:
                grammar = _unclassified_identity_fragment_pattern(text)
        elif len(mapped) == 1:
            role = next(iter(mapped))
            grammar = (
                _single_field_delimited_pattern(text, role)
                or _pattern_display_token(role)
            )
        else:
            grammar = " + ".join(_pattern_display_token(role) for role in (mapped_fields or []))
        fragment = {"start": 0, "end": len(text), "rawValue": text, "grammar": grammar or "<VALUE>"}
        if prefix_layout:
            fragment["extraction"] = {
                "mode": "recognized_mpn_start",
                "prefixLengths": list(prefix_layout.get("prefixLengths") or []),
                "recordDelimiter": prefix_layout.get("recordDelimiter") or "none",
            }
        return [fragment]

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
        content = match.group(1)
        content_identity = _parenthesized_identity_content(content)
        manufacturer = clean(content_identity.get("manufacturer"))
        is_directory_manufacturer = bool(manufacturer)
        is_contextual_manufacturer = (
            _is_terminal_parenthesis_before_annotations(text, match.end())
            or (
                "," in content
                and not clean(text[match.end():])
            )
        )
        if not manufacturer and is_contextual_manufacturer and "," not in content:
            manufacturer = clean(content)
            content_identity = {
                **content_identity,
                "manufacturer": manufacturer,
                "pattern": "<MFR>",
            }
            is_directory_manufacturer = bool(manufacturer)
        if not is_directory_manufacturer and not is_contextual_manufacturer:
            continue
        if _has_later_manufacturer_in_same_record(text, match.end()):
            continue
        raw_before_mfr = text[cursor:match.start()]
        mpn_text, _ignored_prefix, source_fragment = _split_mpn_fragment_before_parenthesized_manufacturer(raw_before_mfr)
        if not mpn_text:
            continue
        annotation_end = _skip_trailing_reference_annotations(text, match.end())
        unconsumed = text[annotation_end:]
        if re.search(r"[A-Za-z0-9]|[\(\[\{]", unconsumed):
            # A semantic guess must never truncate a source record. An earlier
            # parenthesis may look like a manufacturer while a later suffix,
            # manufacturer, or customer annotation still belongs to this same
            # record. Keep scanning; if no complete interpretation exists, the
            # fallback below preserves the entire record as unclassified text.
            continue
        start, end = _trim_semantic_fragment_span(text, cursor, annotation_end)
        if end <= start:
            cursor = annotation_end
            continue
        connector = (
            ""
            if (
                "," in content
                and match.start() > cursor
                and not text[match.start() - 1].isspace()
            )
            else " "
        )
        parenthesized_pattern = content_identity.get("pattern") or "<UNCLASSIFIED_TEXT>"
        grammar = (
            f"{_mpn_source_fragment_pattern(source_fragment)}"
            f"{connector}({parenthesized_pattern})"
        )
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
        if fragments and not any(character.isalnum() for character in residual):
            previous = fragments[-1]
            previous["end"] = residual_end
            previous["rawValue"] = text[int(previous.get("start") or 0):residual_end]
            previous["grammar"] = clean(f"{previous.get('grammar') or ''} {residual}")
        else:
            grammar = _unclassified_identity_fragment_pattern(residual)
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
VISUAL_TEACH_STRUCTURAL_ROLES = {"groupSeparator", "insertionMarker", "ignore"}


def _safe_visual_teach_spans(source_value, tagged_spans):
    text = str(source_value or "")
    spans = []
    for item in tagged_spans if isinstance(tagged_spans, list) else []:
        if not isinstance(item, dict):
            continue
        role = clean(item.get("role"))
        if role not in VISUAL_TEACH_VALUE_ROLES | VISUAL_TEACH_STRUCTURAL_ROLES:
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


def _preserve_tagged_mpn_wrappers(source_value, spans):
    """Keep brackets that directly wrap a user-tagged MPN segment."""
    text = str(source_value or "")
    wrapper_pairs = {"(": ")", "[": "]", "{": "}", "<": ">"}
    preserved = []
    for span in spans or []:
        next_span = dict(span)
        if next_span.get("role") == "mpn":
            start = int(next_span.get("start") or 0)
            end = int(next_span.get("end") or 0)
            opening = text[start - 1:start] if start > 0 else ""
            closing = wrapper_pairs.get(opening)
            if closing and text[end:end + 1] == closing:
                wrapper_range = set(range(start - 1, end + 1))
                overlaps_other_tag = any(
                    other is not span
                    and wrapper_range.intersection(range(
                        int(other.get("start") or 0),
                        int(other.get("end") or 0),
                    ))
                    for other in spans or []
                )
                if not overlaps_other_tag:
                    next_span["start"] = start - 1
                    next_span["end"] = end + 1
        preserved.append(next_span)
    return sorted(preserved, key=lambda item: (item["start"], item["end"], item["role"]))


def _visual_teach_wrapper(value):
    text = str(value or "")
    wrappers = {"(": ")", "[": "]", "{": "}", "<": ">"}
    closing = wrappers.get(text[:1])
    if closing and text.endswith(closing):
        return {"open": text[:1], "close": closing}
    return None


def _visual_teach_end_boundary(value):
    text = str(value or "")
    end = 0
    while end < len(text) and not text[end].isalnum():
        end += 1
    boundary = text[:end]
    return boundary if any(not character.isspace() for character in boundary) else ""


def _visual_teach_reusable_before(value, segment_index):
    text = str(value or "")
    if segment_index:
        return text
    match = re.search(r"([@:^|;~=]\s*)$", text)
    return match.group(1) if match else text


def _punctuation_placeholder(value):
    boundary = str(value or "").strip()
    while boundary and boundary[-1] in "([{<":
        boundary = boundary[:-1].rstrip()
    if not boundary or any(character.isalnum() for character in boundary):
        return ""
    if any(character in ")]}>" for character in boundary):
        return ""
    return boundary


def _external_alternate_placeholder(text, mpn_span, alternate_span):
    """Return punctuation placed between a tagged MPN and its alternate list."""
    if not isinstance(mpn_span, dict) or not isinstance(alternate_span, dict):
        return ""
    try:
        start = int(mpn_span.get("end") or 0)
        end = int(alternate_span.get("start") or 0)
    except (TypeError, ValueError):
        return ""
    if end < start:
        return ""

    return _punctuation_placeholder(str(text or "")[start:end])


def _visual_token_occurrence_count(text, token):
    """Count taught boundaries while treating separator whitespace as optional."""
    text = str(text or "")
    token = str(token or "")
    if not text or not token:
        return 0
    pattern = "".join(
        r"[ \t]*" if re.fullmatch(r"[ \t]+", part) else re.escape(part)
        for part in re.split(r"([ \t]+)", token)
        if part
    )
    return len(list(re.finditer(pattern, text))) if pattern else 0


def _find_visual_token_span(text, token, start=0, occurrence=1):
    """Locate a taught boundary without making surrounding spaces significant."""
    text = str(text or "")
    token = str(token or "")
    if not token:
        return None
    try:
        occurrence = max(1, int(occurrence or 1))
    except (TypeError, ValueError):
        occurrence = 1
    offset = max(0, int(start or 0))
    pattern = "".join(
        r"[ \t]*" if re.fullmatch(r"[ \t]+", part) else re.escape(part)
        for part in re.split(r"([ \t]+)", token)
        if part
    )
    if not pattern:
        return None
    matches = re.finditer(pattern, text[offset:])
    match = next((candidate for index, candidate in enumerate(matches, start=1) if index == occurrence), None)
    if match is None:
        return None
    return offset + match.start(), offset + match.end()


def _find_visual_token(text, token, start=0, occurrence=1):
    """Find the taught occurrence of a delimiter, not merely its first copy."""
    span = _find_visual_token_span(text, token, start, occurrence)
    return span[0] if span else -1


def derive_visual_pattern_from_tagged_spans(
    source_value,
    source_header,
    tagged_spans,
    alternate_delimiter="",
    alternate_mode=None,
    alternate_joiner="",
    ignored_fields=None,
):
    """Turn user-selected source ranges into one backend-owned parser rule."""
    text = str(source_value or "")
    source_header = clean(source_header)
    spans = _safe_visual_teach_spans(text, tagged_spans)
    spans = _preserve_tagged_mpn_wrappers(text, spans)
    value_spans = [span for span in spans if span["role"] in VISUAL_TEACH_VALUE_ROLES]
    ignored = [span for span in spans if span["role"] == "ignore"]
    if source_header and ignored and not value_spans:
        return {
            "type": "ignore_fields",
            "sourceHeader": source_header,
            "excludeRow": False,
            "ignoredFields": [
                clean(field)
                for field in (ignored_fields or [])
                if clean(field) in ROLE_KEYS
            ],
            "displayPattern": "<UNCLASSIFIED_TEXT>",
        }
    if not source_header or not value_spans:
        return {}

    separator_spans = [span for span in spans if span["role"] == "groupSeparator"]
    insertion_marker_spans = [span for span in spans if span["role"] == "insertionMarker"]
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
            marker_span = next((
                span for span in insertion_marker_spans
                if span["start"] >= start and span["end"] <= end
            ), None)
            if marker_span:
                adjacent_mpn_spans = [
                    span for span in candidates
                    if span["role"] == "mpn"
                    and (
                        span["end"] == marker_span["start"]
                        or span["start"] == marker_span["end"]
                    )
                ]
                if adjacent_mpn_spans:
                    merged_mpn_span = {
                        "start": min(
                            marker_span["start"],
                            *(span["start"] for span in adjacent_mpn_spans),
                        ),
                        "end": max(
                            marker_span["end"],
                            *(span["end"] for span in adjacent_mpn_spans),
                        ),
                        "role": "mpn",
                    }
                    candidates = [
                        span for span in candidates
                        if span not in adjacent_mpn_spans
                    ] + [merged_mpn_span]
            template_spans = sorted(
                candidates,
                key=lambda item: (item["start"], item["end"], item["role"]),
            )
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
        reusable_before = _visual_teach_reusable_before(before, index)
        reusable_after = after if index + 1 < len(template_spans) else _visual_teach_end_boundary(after)
        segment = {
            "role": span["role"],
            "before": reusable_before,
            "after": reusable_after,
            "wrapper": _visual_teach_wrapper(selected_text),
        }
        if reusable_after:
            after_occurrence = _visual_token_occurrence_count(selected_text, reusable_after) + 1
            if after_occurrence > 1:
                segment["afterOccurrence"] = after_occurrence
        if (
            any(previous.get("role") == span["role"] for previous in template_spans[:index])
            and before
            and before.isspace()
        ):
            segment["roleJoiner"] = before
        segments.append(segment)

    tagged_roles = {segment["role"] for segment in segments}
    if "mpn" in tagged_roles and "manufacturer" in tagged_roles:
        pattern_type = "bracket_alternate_manufacturer" if "alternateList" in tagged_roles else "bracket_manufacturer"
    else:
        pattern_type = "tagged_fields"
    requested_alternate_mode = clean(alternate_mode)
    alternate_mode_is_explicit = bool(requested_alternate_mode)
    rule = {
        "type": pattern_type,
        "sourceHeader": source_header,
        "groupSeparator": group_separator,
        "recordSeparator": group_separator,
        "alternateDelimiter": str(alternate_delimiter or ""),
        "alternateMode": (
            requested_alternate_mode
            if requested_alternate_mode in {
                "complete",
                "append",
                "insert_at_marker",
                "replace_suffix_at_marker",
            }
            else "append"
        ),
        "alternateJoiner": str(alternate_joiner or ""),
        "segments": segments,
    }

    mpn_span = next((span for span in template_spans if span["role"] == "mpn"), None)
    mpn_text = text[mpn_span["start"]:mpn_span["end"]] if mpn_span else ""
    explicit_marker_span = next((
        span for span in insertion_marker_spans
        if mpn_span
        and span["start"] >= mpn_span["start"]
        and span["end"] <= mpn_span["end"]
    ), None)
    explicit_marker = (
        text[explicit_marker_span["start"]:explicit_marker_span["end"]]
        if explicit_marker_span
        else ""
    )
    if explicit_marker:
        marker_offset = explicit_marker_span["start"] - mpn_span["start"]
        marker_occurrence = mpn_text[:marker_offset].count(explicit_marker) + 1
        rule["alternateMode"] = "insert_at_marker"
        rule["mpnComposition"] = {
            "operation": "insert_alternate_at_marker",
            "marker": explicit_marker,
            "markerSequence": explicit_marker,
            "markerOccurrence": marker_occurrence,
            "prefixSource": "mpn_before_marker",
            "suffixSource": "mpn_after_marker",
            **(
                {
                    "alternateSource": "alternateList",
                    "listSuppliesPrimary": True,
                }
                if "alternateList" in tagged_roles
                else {}
            ),
        }
    else:
        alternate_span = next(
            (span for span in template_spans if span["role"] == "alternateList"),
            None,
        )
        alternate_text = (
            text[alternate_span["start"]:alternate_span["end"]]
            if alternate_span
            else ""
        )
        inferred_delimiter = str(alternate_delimiter or "") or _infer_list_delimiter(alternate_text)
        external_placeholder = _external_alternate_placeholder(
            text,
            mpn_span,
            alternate_span,
        )
        if external_placeholder and requested_alternate_mode == "append":
            # The user tagged the complete base MPN and chose append. Punctuation
            # between that value and the alternate list is a source placeholder,
            # not evidence that an internal MPN delimiter is an insertion marker.
            rule["trailingPlaceholder"] = external_placeholder
            marker_match = None
        else:
            marker_match = (
                _select_structural_marker(mpn_text, alternate_text, inferred_delimiter)
                if inferred_delimiter and requested_alternate_mode != "complete"
                else None
            )
        replacement_marker = marker_match["value"] if marker_match else ""
    if (
        "alternateList" in tagged_roles
        and not explicit_marker
        and replacement_marker
        and requested_alternate_mode == "append"
        and not clean(marker_match.get("suffix"))
    ):
        rule["trailingPlaceholder"] = marker_match["value"]
    elif (
        "alternateList" in tagged_roles
        and not explicit_marker
        and replacement_marker
        and (
            requested_alternate_mode != "append"
            or not alternate_mode_is_explicit
        )
    ):
        marker_composition = {
            "marker": replacement_marker,
            "markerSequence": replacement_marker,
            "markerOccurrence": int(marker_match.get("occurrence") or 1),
        }
        marker_parts = _split_visual_mpn_at_marker(mpn_text, marker_composition)
        prefix, primary_suffix = marker_parts if marker_parts else ("", "")
        inferred_operation = {
            "insert_at_marker": "insert_alternate_at_marker",
            "replace_suffix_at_marker": "replace_suffix_at_marker",
        }.get(requested_alternate_mode, clean(marker_match.get("operation")))
        if clean(prefix) and (inferred_operation == "insert_alternate_at_marker" or not primary_suffix):
            rule["alternateMode"] = "insert_at_marker"
            rule["mpnComposition"] = {
                **marker_composition,
                "operation": "insert_alternate_at_marker",
                "prefixSource": "mpn_before_marker",
                "suffixSource": "mpn_after_marker",
                "alternateSource": "alternateList",
                "listSuppliesPrimary": True,
            }
        elif clean(prefix) and inferred_operation == "replace_suffix_at_marker":
            rule["alternateMode"] = "replace_suffix_at_marker"
            rule["mpnComposition"] = {
                **marker_composition,
                "operation": "replace_suffix_at_marker",
                "prefixSource": "mpn_before_marker",
                "primarySuffixSource": "mpn_after_marker",
                "alternateSuffixSource": "alternateList",
            }
        elif clean(prefix):
            rule["alternateMode"] = "marker_operation_requires_confirmation"
            rule["mpnComposition"] = {
                **marker_composition,
                "operation": "",
                "prefixSource": "mpn_before_marker",
                "suffixSource": "mpn_after_marker",
                "alternateSource": "alternateList",
            }
            rule["operationStatus"] = "needs_user_confirmation"

    preserve_outer_brackets = {}
    for span in template_spans:
        if span["role"] not in {"alternateList", "manufacturer"}:
            continue
        if _visual_teach_wrapper(text[span["start"]:span["end"]]):
            preserve_outer_brackets[span["role"]] = True
    if preserve_outer_brackets:
        rule["preserveOuterBrackets"] = preserve_outer_brackets
    display_spans = list(template_spans) + [
        span for span in ignored
        if span["start"] >= group_start and span["end"] <= group_end
    ]
    rule["displayPattern"] = _visual_pattern_display_from_tagged_spans(
        text,
        template_range,
        display_spans,
        rule,
    )
    return rule


def _split_visual_mpn_at_marker(value, composition):
    text = str(value or "")
    if not isinstance(composition, dict):
        return None
    marker = str(composition.get("markerSequence") or composition.get("marker") or "")
    if not marker:
        return None
    try:
        occurrence = max(1, int(composition.get("markerOccurrence") or 1))
    except (TypeError, ValueError):
        occurrence = 1
    marker_index = -1
    search_from = 0
    for _index in range(occurrence):
        marker_index = text.find(marker, search_from)
        if marker_index < 0:
            return None
        search_from = marker_index + len(marker)
    return text[:marker_index], text[marker_index + len(marker):]


def _next_visual_segment_start(group_text, segments, segment_index, value_start):
    """Find the next tagged segment when two selections have no literal gap."""
    for next_segment in segments[segment_index + 1:]:
        if not isinstance(next_segment, dict):
            continue
        next_role = clean(next_segment.get("role"))
        if next_role not in set(ROLE_KEYS) | {"alternateList"}:
            continue
        next_before = str(next_segment.get("before") or "")
        if next_before:
            boundary = _find_visual_token(
                group_text,
                next_before,
                value_start,
                next_segment.get("beforeOccurrence") or 1,
            )
            if boundary >= 0:
                return boundary
        next_wrapper = (
            next_segment.get("wrapper")
            if isinstance(next_segment.get("wrapper"), dict)
            else {}
        )
        opening = str(next_wrapper.get("open") or "")
        if opening:
            boundary = group_text.find(opening, value_start)
            if boundary >= 0:
                return boundary
    return -1


def _visual_pattern_segment_values(group_text, visual_pattern):
    segments = visual_pattern.get("segments") if isinstance(visual_pattern, dict) else []
    if not isinstance(segments, list) or not segments:
        return {}

    cursor = 0
    parsed = {}
    allowed_roles = set(ROLE_KEYS) | {"alternateList"}
    for segment_index, segment in enumerate(segments):
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
            before_span = _find_visual_token_span(
                group_text,
                before,
                cursor,
                segment.get("beforeOccurrence") or segment.get("before_occurrence") or 1,
            )
            if before_span is None:
                return {}
            value_start = before_span[1]
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
            after_index = _find_visual_token(
                group_text,
                after,
                value_start,
                segment.get("afterOccurrence") or segment.get("after_occurrence") or 1,
            )
            if after_index >= 0:
                value_end = after_index
        else:
            next_segment_start = _next_visual_segment_start(
                group_text,
                segments,
                segment_index,
                value_start,
            )
            if next_segment_start >= 0:
                value_end = next_segment_start

        raw_value = group_text[value_start:value_end].strip()
        # Alternate lists may deliberately use a line break as their separator.
        # Preserve it until the configured delimiter has been applied below.
        value = raw_value if role == "alternateList" else clean(raw_value)
        if value:
            role_joiner = str(segment.get("roleJoiner") or segment.get("role_joiner") or "")
            parsed[role] = f"{parsed.get(role, '')}{role_joiner if parsed.get(role) else ''}{value}"
        cursor = value_end
    return parsed


def _normalize_visual_segment_values(parsed):
    """Refine automatically inferred visual MPN spans with directory evidence."""
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
    visual_pattern = _authoritative_visual_pattern(active_rule)
    if not isinstance(visual_pattern, dict):
        return []
    visual_pattern_type = clean(visual_pattern.get("type"))
    visual_roles = {
        clean(segment.get("role"))
        for segment in (visual_pattern.get("segments") or [])
        if isinstance(segment, dict)
    }
    is_mpn_only_alternate_rule = (
        visual_pattern_type == "tagged_fields"
        and {"mpn", "alternateList"}.issubset(visual_roles)
    )
    if (
        visual_pattern_type not in {"bracket_alternate_manufacturer", "bracket_manufacturer"}
        and not is_mpn_only_alternate_rule
    ):
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
    raw_alternate_delimiter = visual_pattern.get("alternateDelimiter")
    if raw_alternate_delimiter is None:
        raw_alternate_delimiter = visual_pattern.get("alternate_delimiter")
    if raw_alternate_delimiter is None:
        raw_alternate_delimiter = ""
    delimiter_choice = str(raw_alternate_delimiter).strip()
    explicit_no_alternates = delimiter_choice == ALTERNATE_DELIMITER_NONE
    explicit_no_split = delimiter_choice == ALTERNATE_DELIMITER_SINGLE
    alternate_delimiter = _configured_delimiter({"delimiter": raw_alternate_delimiter})
    alternate_mode = clean(
        visual_pattern.get("alternateMode")
        or visual_pattern.get("alternate_mode")
        or "append"
    )
    alternate_joiner = str(
        visual_pattern.get("alternateJoiner")
        or visual_pattern.get("alternate_joiner")
        or ""
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
        or ""
    ) if isinstance(mpn_composition, dict) else ""
    trailing_placeholder = str(
        visual_pattern.get("trailingPlaceholder")
        or visual_pattern.get("trailing_placeholder")
        or ""
    )
    if (
        not composition_operation
        and alternate_mode == "append"
        and "alternateList" in visual_roles
    ):
        external_placeholder = next((
            _punctuation_placeholder(segment.get("after"))
            for segment in (visual_pattern.get("segments") or [])
            if isinstance(segment, dict)
            and clean(segment.get("role")) == "mpn"
            and _punctuation_placeholder(segment.get("after"))
        ), "")
        if external_placeholder:
            # Older rules could mistake an internal MPN symbol for a marker even
            # though the confirmed append placeholder follows the tagged MPN.
            alternate_mode = "append"
            trailing_placeholder = trailing_placeholder or external_placeholder
            composition_marker = ""
            mpn_composition = {}
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
    external_manufacturers = []
    manufacturer_header = clean((roles or {}).get("manufacturer"))
    if manufacturer_header and manufacturer_header != source_header and manufacturer_header in headers:
        raw_manufacturers = _row_cell(
            row,
            manufacturer_header,
            headers,
            preserve_delimiters=True,
        )
        manufacturer_rule = _field_rule(config, "manufacturer")
        external_manufacturers = _split_alternate_value(
            raw_manufacturers,
            config,
            "manufacturer",
        )
        if not external_manufacturers and not is_blankish(raw_manufacturers):
            external_manufacturers = [clean(raw_manufacturers)]
        if not external_manufacturers and alternate_delimiter == "\n":
            external_manufacturers = [
                clean(part)
                for part in re.split(r"\r?\n+", str(raw_manufacturers or ""))
                if not is_blankish(part)
            ]
    raw_groups = str(source_value).split(group_separator) if group_separator else [str(source_value)]
    pairs = []
    seen = set()
    pair_position = 0

    def append_base_mpn(value):
        base = str(value or "").rstrip()
        placeholder = str(trailing_placeholder or "").strip()
        if placeholder:
            placeholder_match = re.search(
                rf"{re.escape(placeholder)}\s*$",
                base,
            )
            if placeholder_match:
                base = base[:placeholder_match.start()].rstrip()
        joiner = str(alternate_joiner or "").strip()
        if joiner and base.endswith(joiner):
            base = base[:-len(joiner)].rstrip()
        return clean(base)

    def append_alternate_mpn(base, alternate):
        if not alternate_joiner:
            return f"{append_base_mpn(base)}{alternate}"
        alternate_text = str(alternate or "")
        if alternate_text.startswith(alternate_joiner):
            alternate_text = alternate_text[len(alternate_joiner):]
        return f"{append_base_mpn(base)}{alternate_joiner}{alternate_text}"

    def alternate_values(value, preserve_wrapper=False, preserve_empty=False):
        alternate_text = str(value or "").strip()
        if not alternate_text or explicit_no_alternates:
            return []
        wrapper = None
        wrapper_match = re.match(
            r"^([\(\[\{<])(.*)([\)\]\}>])$",
            alternate_text,
            flags=re.DOTALL,
        )
        if wrapper_match:
            wrapper = (wrapper_match.group(1), wrapper_match.group(3))
            alternate_text = clean(wrapper_match.group(2))
        if alternate_delimiter:
            parts = [clean(part) for part in alternate_text.split(alternate_delimiter)]
        elif explicit_no_split:
            parts = [clean(alternate_text)]
        else:
            parts = []
        return [
            f"{wrapper[0]}{part}{wrapper[1]}"
            if part and preserve_wrapper and wrapper
            else part
            for part in parts
            if part or preserve_empty
        ]

    def add_pair(mpn, manufacturer):
        nonlocal pair_position
        mpn_text = str(mpn or "")
        mpn_text = _strip_configured_prefix(mpn_text, _field_rule(config, "mpn"))
        mpn = clean(mpn_text)
        manufacturer = clean(manufacturer)
        if not manufacturer and external_manufacturers:
            manufacturer = external_manufacturers[
                min(pair_position, len(external_manufacturers) - 1)
            ]
        pair_position += 1
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
        parsed_segments = _visual_pattern_segment_values(group_text, visual_pattern)
        if not visual_pattern.get("authoritativeSegments"):
            parsed_segments = _normalize_visual_segment_values(parsed_segments)
        segment_mpn = clean(parsed_segments.get("mpn"))
        segment_manufacturer = clean(parsed_segments.get("manufacturer"))
        segment_alternates = str(parsed_segments.get("alternateList") or "").strip()
        effective_operation = composition_operation
        if effective_operation not in {
            "insert_alternate_at_marker",
            "replace_suffix_at_marker",
        }:
            effective_operation = _effective_marker_operation(
                segment_mpn,
                segment_alternates,
                alternate_delimiter,
                mpn_composition,
                composition_operation,
            )
        if (
            isinstance(mpn_composition, dict)
            and composition_marker
            and effective_operation not in {
                "insert_alternate_at_marker",
                "replace_suffix_at_marker",
            }
        ):
            continue
        if segment_mpn:
            if effective_operation == "insert_alternate_at_marker":
                marker_parts = _split_visual_mpn_at_marker(segment_mpn, mpn_composition)
                if not marker_parts:
                    continue
                insertion_prefix, insertion_suffix = marker_parts
                segment_alternate_values = alternate_values(
                    segment_alternates,
                    preserve_empty=True,
                )
                if not segment_alternate_values:
                    add_pair(
                        f"{insertion_prefix}{insertion_suffix}",
                        segment_manufacturer,
                    )
                    continue
                for alternate in segment_alternate_values:
                    if alternate:
                        add_pair(
                            f"{insertion_prefix}{alternate}{insertion_suffix}",
                            segment_manufacturer,
                        )
                    elif mpn_composition.get("listSuppliesPrimary"):
                        add_pair(
                            f"{insertion_prefix}{insertion_suffix}",
                            segment_manufacturer,
                        )
                continue
            primary_mpn = segment_mpn
            replacement_prefix = ""
            if (
                effective_operation == "replace_suffix_at_marker"
                and composition_marker
                and composition_marker in segment_mpn
            ):
                replacement_prefix, primary_suffix = segment_mpn.rsplit(composition_marker, 1)
                primary_mpn = f"{replacement_prefix}{primary_suffix}"
            elif alternate_mode == "append" and (alternate_joiner or trailing_placeholder):
                primary_mpn = append_base_mpn(segment_mpn)
            add_pair(primary_mpn, segment_manufacturer)
            if segment_alternates:
                for alternate in alternate_values(
                    segment_alternates,
                    preserve_wrapper=bool(preserve_outer_brackets.get("alternateList")),
                ):
                    if effective_operation == "replace_suffix_at_marker" and replacement_prefix:
                        alternate_mpn = f"{replacement_prefix}{alternate.lstrip(composition_marker)}"
                    else:
                        alternate_mpn = (
                            alternate
                            if alternate_mode == "complete"
                            else append_alternate_mpn(segment_mpn, alternate)
                        )
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
            alternate_text = str(
                brackets[0].group(0)
                if preserve_outer_brackets.get("alternateList")
                else brackets[0].group(1)
            ).strip()
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
                alternate_text = str(brackets[0].group(1) or "").strip()

        effective_operation = composition_operation
        if effective_operation not in {
            "insert_alternate_at_marker",
            "replace_suffix_at_marker",
        }:
            effective_operation = _effective_marker_operation(
                base_mpn,
                alternate_text,
                alternate_delimiter,
                mpn_composition,
                composition_operation,
            )
        if (
            isinstance(mpn_composition, dict)
            and composition_marker
            and effective_operation not in {
                "insert_alternate_at_marker",
                "replace_suffix_at_marker",
            }
        ):
            continue
        if effective_operation == "insert_alternate_at_marker":
            marker_parts = _split_visual_mpn_at_marker(base_mpn, mpn_composition)
            parsed_alternates = alternate_values(
                alternate_text,
                preserve_empty=True,
            )
            if not parsed_alternates:
                if marker_parts:
                    insertion_prefix, insertion_suffix = marker_parts
                    base_mpn = f"{insertion_prefix}{insertion_suffix}"
                add_pair(base_mpn, manufacturer)
                continue
            if not marker_parts:
                continue
            insertion_prefix, insertion_suffix = marker_parts
            for alternate in parsed_alternates:
                if alternate:
                    add_pair(
                        f"{insertion_prefix}{alternate}{insertion_suffix}",
                        manufacturer,
                    )
                elif mpn_composition.get("listSuppliesPrimary"):
                    add_pair(
                        f"{insertion_prefix}{insertion_suffix}",
                        manufacturer,
                    )
            continue

        primary_mpn = base_mpn
        replacement_prefix = ""
        if (
            effective_operation == "replace_suffix_at_marker"
            and composition_marker
            and composition_marker in base_mpn
        ):
            replacement_prefix, primary_suffix = base_mpn.rsplit(composition_marker, 1)
            primary_mpn = f"{replacement_prefix}{primary_suffix}"
        elif alternate_mode == "append" and (alternate_joiner or trailing_placeholder):
            primary_mpn = append_base_mpn(base_mpn)
        add_pair(primary_mpn, manufacturer)
        if not alternate_text:
            continue
        for alternate in alternate_values(
            alternate_text,
            preserve_wrapper=bool(preserve_outer_brackets.get("alternateList")),
        ):
            if effective_operation == "replace_suffix_at_marker" and replacement_prefix:
                alternate_mpn = f"{replacement_prefix}{alternate.lstrip(composition_marker)}"
            else:
                alternate_mpn = (
                    alternate
                    if alternate_mode == "complete"
                    else append_alternate_mpn(base_mpn, alternate)
                )
            add_pair(alternate_mpn, manufacturer)

    return pairs


def _visual_pattern_ignored_fields(roles, config=None):
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = _authoritative_visual_pattern(active_rule)
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


def _visual_pattern_owned_fields(config=None):
    """Fields controlled by a confirmed visual rule must not use raw fallbacks."""
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = _authoritative_visual_pattern(active_rule)
    if not isinstance(visual_pattern, dict):
        return set()

    owned_fields = {
        clean(segment.get("role"))
        for segment in (visual_pattern.get("segments") or [])
        if isinstance(segment, dict) and clean(segment.get("role")) in ROLE_KEYS
    }
    owned_fields.update(
        clean(field)
        for field in (
            visual_pattern.get("ignoredFields")
            or visual_pattern.get("ignored_fields")
            or []
        )
        if clean(field) in ROLE_KEYS
    )
    return owned_fields


def _field_pattern_rule_controlled_fields(rule):
    """Fields a confirmed rule is allowed to replace, including with blanks."""
    if not isinstance(rule, dict):
        return set()

    controlled_fields = {
        clean(field)
        for field in (rule.get("fields") or {})
        if clean(field) in ROLE_KEYS
    }
    visual_pattern = _authoritative_visual_pattern(rule)
    if isinstance(visual_pattern, dict):
        controlled_fields.update(
            clean(segment.get("role"))
            for segment in (visual_pattern.get("segments") or [])
            if isinstance(segment, dict) and clean(segment.get("role")) in ROLE_KEYS
        )
        controlled_fields.update(
            clean(field)
            for field in (
                visual_pattern.get("ignoredFields")
                or visual_pattern.get("ignored_fields")
                or []
            )
            if clean(field) in ROLE_KEYS
        )

    authoritative_correction = rule.get("authoritativeCorrection") or {}
    controlled_fields.update(
        clean(field)
        for field in (authoritative_correction.get("fieldRules") or {})
        if clean(field) in ROLE_KEYS
    )
    return controlled_fields


def _merge_confirmed_pattern_entries(base_entries, corrected_entries, rule):
    """Overlay a pattern correction without clearing unrelated mapped fields."""
    base_entries = [entry for entry in (base_entries or []) if isinstance(entry, dict)]
    corrected_entries = [entry for entry in (corrected_entries or []) if isinstance(entry, dict)]
    controlled_fields = _field_pattern_rule_controlled_fields(rule)
    merged_entries = []

    for corrected_index, corrected_entry in enumerate(corrected_entries):
        base_entry = (
            base_entries[corrected_index]
            if corrected_index < len(base_entries)
            else (base_entries[0] if base_entries else {})
        )
        merged_fields = deepcopy(
            base_entry.get("fields")
            if isinstance(base_entry.get("fields"), dict)
            else {}
        )
        if corrected_index >= len(base_entries):
            for field in controlled_fields:
                merged_fields[field] = ""

        corrected_fields = corrected_entry.get("fields") or {}
        for field, value in corrected_fields.items() if isinstance(corrected_fields, dict) else []:
            # Empty cells emitted for display are not user instructions to
            # clear separately mapped fields. A field owned by this rule may
            # still be intentionally cleared, and every nonblank correction
            # remains authoritative.
            plain_value = value.get("value") if isinstance(value, dict) else value
            if field in controlled_fields or not is_blankish(plain_value):
                merged_fields[field] = value

        merged_entries.append({
            **base_entry,
            **corrected_entry,
            "fields": merged_fields,
        })
    return merged_entries


def _field_pattern_rule_excludes_row(rule):
    if not isinstance(rule, dict):
        return False
    visual_pattern = _authoritative_visual_pattern(rule)
    if not isinstance(visual_pattern, dict):
        return False
    # Ignore is field-level: it suppresses the selected interpretation roles
    # while preserving the source item and every unrelated mapped field.
    if clean(visual_pattern.get("type")) == "ignore_fields":
        return False
    return visual_pattern.get("excludeRow") is True or visual_pattern.get("exclude_row") is True


def _field_pattern_rule_ignores_fields(rule):
    if not isinstance(rule, dict):
        return False
    visual_pattern = _authoritative_visual_pattern(rule)
    return (
        isinstance(visual_pattern, dict)
        and clean(visual_pattern.get("type")) == "ignore_fields"
    )


def _visual_pattern_tagged_field_rows(row, headers, config=None):
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    visual_pattern = _authoritative_visual_pattern(active_rule)
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
    segment_roles = {
        clean(segment.get("role"))
        for segment in segments
        if isinstance(segment, dict)
    }
    if {"mpn", "alternateList"}.issubset(segment_roles):
        # MPN plus alternate-list tags always describe multiple identity rows.
        # Let the identity parser emit them instead of flattening the tagged
        # values into one generic row. A marker operation is optional.
        return []
    group_separator = str(
        visual_pattern.get("groupSeparator")
        or visual_pattern.get("group_separator")
        or ""
    )
    groups = str(source_value).split(group_separator) if group_separator else [str(source_value)]
    parsed_rows = []

    for group_text in groups:
        parsed = _visual_pattern_segment_values(group_text, visual_pattern)
        if not visual_pattern.get("authoritativeSegments"):
            parsed = _normalize_visual_segment_values(parsed)
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
    visual_pattern = _authoritative_visual_pattern(active_rule)
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
        for entry_index, entry in enumerate(correction.get("entries") or []):
            if not isinstance(entry, dict):
                continue
            raw_fields = entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
            corrected_rows.append({
                role: clean(value.get("value") if isinstance(value, dict) else value)
                for role, value in raw_fields.items()
                if role in ROLE_KEYS
            } | {
                "_relation": clean(entry.get("relation"))
                or ("Primary" if entry_index == 0 else f"Alternate {entry_index}"),
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


def _semantic_pattern_excludes_row(row, headers, roles, config=None):
    rules = _semantic_pattern_rules(config)
    if not rules:
        return False
    for unit in _field_review_mapping_units(headers, roles, config=config):
        if unit.get("relationship") != "shared" and unit.get("mappedFields") != ["mpn"]:
            continue
        source_column = unit.get("sourceColumn")
        source_value = _row_cell(row, source_column, headers, preserve_delimiters=True)
        if is_blankish(source_value):
            continue
        for fragment in _semantic_identity_fragments(
            source_value,
            unit.get("mappedFields") or [],
        ):
            pattern_key = _semantic_pattern_key(
                source_column,
                unit.get("mappedFields") or [],
                fragment.get("grammar"),
            )
            if _field_pattern_rule_excludes_row(rules.get(pattern_key)):
                return True
    return False


def _infer_semantic_pattern_entries_for_row(row, headers, roles, selected_columns, config=None):
    if (config or {}).get("_semanticPatternPass"):
        return []
    rules = _semantic_pattern_rules(config)
    active_rule = (
        (config or {}).get("_activeFieldPatternRule")
        or (config or {}).get("_active_field_pattern_rule")
        or {}
    )
    allow_automatic_unclassified = not _field_pattern_rule_has_content(active_rule)

    combined_entries = []
    ignored_fragments = []
    semantic_source_columns = set()
    for unit in _field_review_mapping_units(headers, roles, config=config):
        if "primary" not in (unit.get("scopes") or []):
            continue
        if unit.get("relationship") != "shared" and unit.get("mappedFields") != ["mpn"]:
            continue
        source_column = unit.get("sourceColumn")
        mapped_fields = unit.get("mappedFields") or []
        source_value = _row_cell(row, source_column, headers, preserve_delimiters=True)
        if is_blankish(source_value):
            continue
        fragments = _semantic_identity_fragments(source_value, mapped_fields)
        if not any(
            _semantic_pattern_key(source_column, mapped_fields, fragment.get("grammar")) in rules
            or (
                allow_automatic_unclassified
                and _semantic_grammar_is_unclassified(
                    fragment.get("grammar"),
                    mapped_fields,
                )
            )
            for fragment in fragments
        ):
            continue

        for fragment in fragments:
            pattern_key = _semantic_pattern_key(
                source_column,
                mapped_fields,
                fragment.get("grammar"),
            )
            rule = rules.get(pattern_key) or {}
            if (
                not rule
                and allow_automatic_unclassified
                and _semantic_grammar_is_unclassified(
                    fragment.get("grammar"),
                    mapped_fields,
                )
            ):
                rule = _automatic_unclassified_rule(
                    source_column,
                    mapped_fields,
                    pattern_key,
                )
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
            if _field_pattern_rule_ignores_fields(rule):
                ignored_fragments.append((fragment_row, fragment_config))
                continue
            fragment_entries = _infer_field_entries_for_row(
                fragment_row,
                headers,
                roles,
                selected_columns,
                config=fragment_config,
            )
            if fragment_entries:
                semantic_source_columns.add(source_column)
            combined_entries.extend(fragment_entries)

    for fragment_row, fragment_config in ignored_fragments:
        ignored_entries = _infer_field_entries_for_row(
            fragment_row,
            headers,
            roles,
            selected_columns,
            config=fragment_config,
        )
        if ignored_entries:
            ignored_entry = ignored_entries[0]
            ignored_entry["relation"] = "Ignored"
            ignored_entry["ignoredIdentity"] = True
            combined_entries.append(ignored_entry)

    for index, entry in enumerate(combined_entries):
        entry["index"] = index
        if not entry.get("ignoredIdentity") and clean(entry.get("relation")) != "Ignored":
            entry["relation"] = "Primary" if index == 0 else f"Alternate {index}"
    return _pair_semantic_entries_with_separate_manufacturers(
        combined_entries,
        row,
        headers,
        roles,
        semantic_source_columns,
    )


def _infer_field_entries_for_row(row, headers, roles, selected_columns, config=None):
    config = config or {}
    active_rule = (
        config.get("_activeFieldPatternRule")
        or config.get("_active_field_pattern_rule")
        or {}
    )
    if _field_pattern_rule_excludes_row(active_rule):
        return []
    if (
        not config.get("_semanticPatternPass")
        and _semantic_pattern_excludes_row(row, headers, roles, config=config)
    ):
        return []
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
    visual_owned_fields = _visual_pattern_owned_fields(config=config)
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
    pattern_owned_fields = ignored_fields | visual_owned_fields | tagged_fields | manual_fields
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
                if role not in ROLE_KEYS:
                    continue
                entry_fields[role] = _direct_factwise_field(
                    value,
                    manual_source_header,
                    1.0,
                    "User-confirmed manual interpretation",
                )
            entries.append(_build_factwise_entry(
                entry_index,
                entry_fields,
                clean(parsed.get("_relation"))
                or ("Primary" if entry_index == 0 else f"Alternate {entry_index}"),
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
    def should_split_mapped_field(role, header):
        if not header:
            return False
        mapped_roles = [
            mapped_role
            for mapped_role, mapped_header in (roles or {}).items()
            if clean(mapped_header) == clean(header)
        ]
        if len(mapped_roles) > 1:
            return True
        field_rule = _field_rule(config, role)
        delimiter = _configured_delimiter(field_rule)
        return bool(delimiter and delimiter not in {"none", "no_split", "auto"})

    cpn_parts = (
        _split_alternate_value(cpn_value, config, "cpn")
        if should_split_mapped_field("cpn", cpn_header)
        else []
    )
    mpn_parts = (
        _split_alternate_value(mpn_value, config, "mpn")
        if should_split_mapped_field("mpn", mpn_header)
        else []
    )
    manufacturer_parts = (
        _split_alternate_value(manufacturer_value, config, "manufacturer")
        if should_split_mapped_field("manufacturer", manufacturer_header)
        else []
    )
    mpn_field_rule = _field_rule(config, "mpn")
    preserve_complete_mpn_values = bool(
        mpn_field_rule.get("preserveOriginalValue")
        or mpn_field_rule.get("preserve_original_value")
    )
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
    detected_mpn_count = len(mpn_parts) if mpn_parts else (0 if is_blankish(primary_mpn_value) else 1)
    detected_manufacturer_count = (
        len(manufacturer_parts)
        if manufacturer_parts
        else (0 if is_blankish(primary_manufacturer_value) else 1)
    )
    if cpn_header and not is_blankish(primary_cpn_value):
        set_field("cpn", primary_cpn_value, cpn_header, 0.72, "Direct from mapped CPN column", overwrite=True)

    if mpn_header:
        if not is_blankish(primary_mpn_value):
            if preserve_complete_mpn_values:
                fields["mpn"] = _direct_factwise_field(
                    primary_mpn_value,
                    mpn_header,
                    1.0,
                    "Complete MPN record confirmed by user",
                )
            else:
                fields["mpn"] = _mpn_factwise_field(
                    primary_mpn_value,
                    mpn_header,
                    "Backend MPN value/pattern lookup in mapped MPN column",
                )

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
        return _attach_mpn_manufacturer_pairing_check(
            entries,
            manufacturer_mapped=bool(manufacturer_header),
            detected_mpn_count=len(same_cell_identity_pairs),
            detected_manufacturer_count=sum(
                1 for pair in same_cell_identity_pairs
                if not is_blankish(pair.get("manufacturer"))
            ),
        )

    entry_count = max(len(cpn_parts), len(mpn_parts), len(manufacturer_parts), 1)
    if mpn_header and (mpn_parts or not is_blankish(primary_mpn_value)):
        # MPN is the identity anchor for alternates. Manufacturer parsing can
        # over-split multi-word names, but it must never create an extra
        # alternate row with no MPN.
        entry_count = max(len(mpn_parts), 1)
        if len(mpn_parts) > 1 and len(manufacturer_parts) > len(mpn_parts):
            manufacturer_parts = manufacturer_parts[:len(mpn_parts)]
    entries = [_build_factwise_entry(0, fields, "Primary")]
    if (
        visual_owned_fields
        and not _field_pattern_rule_ignores_fields(active_rule)
        and not any(
            clean((fields.get(role) or {}).get("value"))
            for role in visual_owned_fields
            if isinstance(fields.get(role), dict)
        )
    ):
        entries[0]["needsReview"] = True
        entries[0]["reviewReason"] = "confirmed_rule_did_not_match"

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
        combined_entries = entries + separate_column_entries
        return _attach_mpn_manufacturer_pairing_check(
            combined_entries,
            manufacturer_mapped=bool(manufacturer_header),
            detected_mpn_count=detected_mpn_count,
            detected_manufacturer_count=detected_manufacturer_count,
        )

    if entry_count <= 1:
        return _attach_mpn_manufacturer_pairing_check(
            entries,
            manufacturer_mapped=bool(manufacturer_header),
            detected_mpn_count=detected_mpn_count,
            detected_manufacturer_count=detected_manufacturer_count,
        )

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
            if preserve_complete_mpn_values:
                alt_fields["mpn"] = _direct_factwise_field(
                    mpn_parts[entry_index],
                    mpn_header,
                    1.0,
                    "Complete MPN record confirmed by user",
                )
            else:
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
        entries.append(_build_factwise_entry(entry_index, alt_fields, f"Alternate {entry_index}"))

    return _attach_mpn_manufacturer_pairing_check(
        entries,
        manufacturer_mapped=bool(manufacturer_header),
        detected_mpn_count=detected_mpn_count,
        detected_manufacturer_count=detected_manufacturer_count,
    )


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


def _confirmed_request_rule_for_roles(rule, roles=None):
    """Discard destructive one-to-one suggestions that the user never chose."""
    if not isinstance(rule, dict):
        return {}
    next_rule = dict(rule)
    fields = rule.get("fields") if isinstance(rule.get("fields"), dict) else {}
    next_fields = {}
    for role, field_rule in fields.items():
        if not isinstance(field_rule, dict):
            continue
        header = clean((roles or {}).get(role))
        mapped_roles = [
            mapped_role
            for mapped_role, mapped_header in (roles or {}).items()
            if header and clean(mapped_header) == header
        ]
        if len(mapped_roles) == 1 and field_rule.get("customerConfirmed") is not True:
            continue
        next_fields[role] = dict(field_rule)
    next_rule["fields"] = next_fields
    return next_rule


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
    structure_scope = override.get("structureScope") or override.get("structure_scope")
    if not isinstance(structure_scope, dict) or not structure_scope:
        structure_scope = base.get("structureScope") or base.get("structure_scope")
    if isinstance(structure_scope, dict) and structure_scope:
        merged["structureScope"] = dict(structure_scope)
        merged["structureSignature"] = clean(
            override.get("structureSignature")
            or override.get("structure_signature")
            or base.get("structureSignature")
            or base.get("structure_signature")
            or structure_scope.get("signature")
        )
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
    authoritative_correction = (
        override.get("authoritativeCorrection")
        or override.get("authoritative_correction")
        or base.get("authoritativeCorrection")
        or base.get("authoritative_correction")
    )
    if isinstance(authoritative_correction, dict) and authoritative_correction:
        merged["authoritativeCorrection"] = deepcopy(authoritative_correction)
    authoritative_visual_pattern = _authoritative_visual_pattern(merged)
    if authoritative_visual_pattern:
        merged["visualPattern"] = authoritative_visual_pattern
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


def _normalized_structure_header(value):
    return re.sub(r"[^a-z0-9]+", "", clean(value).lower())


def _bom_pattern_structure_scope(headers, roles=None, config=None):
    """Build the exact workbook-layout scope for learned parser rules."""
    safe_headers = [clean(header) for header in (headers or [])]
    safe_roles = roles if isinstance(roles, dict) else {}
    safe_config = config if isinstance(config, dict) else {}
    role_columns = {}
    for role in ROLE_KEYS:
        header = clean(safe_roles.get(role))
        if not header or header not in safe_headers:
            continue
        role_columns[role] = {
            "header": _normalized_structure_header(header),
            "index": safe_headers.index(header),
        }

    alternate_groups = []
    for group in _configured_alternate_column_groups(safe_config):
        if not isinstance(group, dict):
            continue
        alternate_groups.append({
            role: (
                safe_headers.index(clean(group.get(role)))
                if clean(group.get(role)) in safe_headers
                else -1
            )
            for role in ("cpn", "mpn", "manufacturer")
        })

    scope = {
        "headers": [_normalized_structure_header(header) for header in safe_headers],
        "roleColumns": role_columns,
        "identityLayout": clean(safe_config.get("identityLayout") or safe_config.get("identity_layout")),
        "rowPlacement": clean(safe_config.get("rowPlacement") or safe_config.get("row_placement")),
        "alternateLayout": clean(safe_config.get("alternateLayout") or safe_config.get("alternate_layout")),
        "sameGroupKeyColumn": (
            {
                "header": _normalized_structure_header(clean(
                    safe_config.get("sameGroupKeyColumn")
                    or safe_config.get("same_group_key_column")
                )),
                "index": safe_headers.index(clean(
                    safe_config.get("sameGroupKeyColumn")
                    or safe_config.get("same_group_key_column")
                )),
            }
            if clean(
                safe_config.get("sameGroupKeyColumn")
                or safe_config.get("same_group_key_column")
            ) in safe_headers
            else None
        ),
        "alternateColumns": alternate_groups,
    }
    signature_basis = repr((
        tuple(scope["headers"]),
        tuple(
            (role, item["header"], item["index"])
            for role, item in sorted(role_columns.items())
        ),
        scope["identityLayout"],
        scope["rowPlacement"],
        scope["alternateLayout"],
        (
            scope["sameGroupKeyColumn"]["header"],
            scope["sameGroupKeyColumn"]["index"],
        ) if scope["sameGroupKeyColumn"] else None,
        tuple(
            tuple((role, group.get(role, -1)) for role in ("cpn", "mpn", "manufacturer"))
            for group in alternate_groups
        ),
    ))
    scope["signature"] = hashlib.sha256(signature_basis.encode("utf-8")).hexdigest()
    return scope


def _rule_structure_signature(payload, parser_rule=None):
    parser_rule = parser_rule if isinstance(parser_rule, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    scope = (
        payload.get("structure_scope")
        or payload.get("structureScope")
        or parser_rule.get("structureScope")
        or parser_rule.get("structure_scope")
        or {}
    )
    return clean(
        payload.get("structure_signature")
        or payload.get("structureSignature")
        or parser_rule.get("structureSignature")
        or parser_rule.get("structure_signature")
        or (scope.get("signature") if isinstance(scope, dict) else "")
    )


def load_saved_bom_field_pattern_rules(structure_signature=""):
    global_rules = {}
    structure_rules = {}
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
        saved_structure_signature = _rule_structure_signature(payload, parser_rule)
        library_scope = clean(payload.get("library_scope") or parser_rule.get("libraryScope"))
        if library_scope == "global":
            global_rules[shape] = _merge_pattern_rules(global_rules.get(shape), parser_rule)
            global_rules[shape]["matchedLibraryScope"] = "global"
        elif structure_signature and saved_structure_signature == clean(structure_signature):
            structure_rules[shape] = _merge_pattern_rules(structure_rules.get(shape), parser_rule)
            structure_rules[shape]["matchedLibraryScope"] = "structure"

    rules = dict(global_rules)
    for shape, parser_rule in structure_rules.items():
        rules[shape] = _merge_pattern_rules(rules.get(shape), parser_rule)
        rules[shape]["matchedLibraryScope"] = "structure"
    return rules


def load_saved_bom_pattern_interpretations(structure_signature=""):
    """Return saved semantic rules with identity/version metadata for review."""
    global_interpretations = {}
    structure_interpretations = {}
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
            saved_structure_signature = _rule_structure_signature(payload, parser_rule)
            library_scope = clean(payload.get("library_scope") or parser_rule.get("libraryScope"))
            interpretation = {
                "patternKey": pattern_key,
                "ruleId": stored.id,
                "version": int(payload.get("version") or 1),
                "updatedAt": stored.updated_at.isoformat() if stored.updated_at else None,
                "rule": parser_rule,
            }
            if library_scope == "global":
                interpretation["matchScope"] = "global"
                global_interpretations[pattern_key] = interpretation
            elif structure_signature and saved_structure_signature == clean(structure_signature):
                interpretation["matchScope"] = "structure"
                structure_interpretations[pattern_key] = interpretation
    except Exception:
        return {}
    return {**global_interpretations, **structure_interpretations}


def save_bom_field_pattern_rule(
    rule,
    description="User-taught BOM field pattern",
    library_scope="structure",
):
    if not _field_pattern_rule_has_content(rule):
        return None
    shape = clean(rule.get("shape"))
    pattern_key = clean(rule.get("patternKey") or rule.get("pattern_key"))
    library_scope = "global" if clean(library_scope) == "global" else "structure"
    structure_scope = rule.get("structureScope") or rule.get("structure_scope") or {}
    structure_scope = dict(structure_scope) if isinstance(structure_scope, dict) else {}
    structure_signature = clean(
        rule.get("structureSignature")
        or rule.get("structure_signature")
        or structure_scope.get("signature")
    )
    structure_fingerprint = clean(
        rule.get("structureFingerprint")
        or rule.get("structure_fingerprint")
    )
    if not shape and not pattern_key:
        return None
    parser_rule = {
        "shape": shape,
        "fields": rule.get("fields") if isinstance(rule.get("fields"), dict) else {},
    }
    if pattern_key:
        parser_rule["patternKey"] = pattern_key
    if library_scope == "global":
        structure_scope = {}
        structure_signature = ""
        structure_fingerprint = ""
    if structure_signature:
        parser_rule["structureSignature"] = structure_signature
        parser_rule["structureScope"] = structure_scope
    if structure_fingerprint:
        parser_rule["structureFingerprint"] = structure_fingerprint
    identity_groups = rule.get("identityGroups") or rule.get("identity_groups")
    if isinstance(identity_groups, list) and identity_groups:
        parser_rule["identityGroups"] = identity_groups
    expansions = rule.get("expansions") or rule.get("expansionRules") or rule.get("expansion_rules")
    if isinstance(expansions, list) and expansions:
        parser_rule["expansions"] = expansions
    visual_pattern = _authoritative_visual_pattern(rule)
    if isinstance(visual_pattern, dict) and visual_pattern:
        parser_rule["visualPattern"] = dict(visual_pattern)
    authoritative_correction = (
        rule.get("authoritativeCorrection")
        or rule.get("authoritative_correction")
    )
    if isinstance(authoritative_correction, dict) and authoritative_correction:
        parser_rule["authoritativeCorrection"] = deepcopy(authoritative_correction)
    parser_rule["libraryScope"] = library_scope

    try:
        from excel_mapper.models import ColumnRule
        pattern_identity = f"pattern:{pattern_key}" if pattern_key else shape
        storage_identity = (
            f"global|{pattern_identity}"
            if library_scope == "global"
            else f"structure:{structure_signature}|{pattern_identity}"
        )
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
                    "structure_signature": structure_signature,
                    "structure_scope": structure_scope,
                    "structure_fingerprint": structure_fingerprint,
                    "library_scope": library_scope,
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
            "scope": library_scope,
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

    composition = visual_pattern.get("mpnComposition") or visual_pattern.get("mpn_composition") or {}
    composition_operation = clean(composition.get("operation")) if isinstance(composition, dict) else ""
    segments = visual_pattern.get("segments") or []
    if isinstance(segments, list) and segments:
        for group_start, group_end in group_ranges:
            group_text = text[group_start:group_end]
            cursor = 0
            for segment_index, segment in enumerate(segments):
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
                    before_span = _find_visual_token_span(
                        group_text,
                        before,
                        cursor,
                        segment.get("beforeOccurrence") or segment.get("before_occurrence") or 1,
                    )
                    if before_span is None:
                        break
                    value_start = before_span[1]
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
                    after_index = _find_visual_token(
                        group_text,
                        after,
                        value_start,
                        segment.get("afterOccurrence") or segment.get("after_occurrence") or 1,
                    )
                    if after_index >= 0:
                        value_end = after_index
                else:
                    next_segment_start = _next_visual_segment_start(
                        group_text,
                        segments,
                        segment_index,
                        value_start,
                    )
                    if next_segment_start >= 0:
                        value_end = next_segment_start
                if role == "mpn" and not visual_pattern.get("authoritativeSegments"):
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
                if role == "mpn" and composition_operation == "insert_alternate_at_marker":
                    raw_template = group_text[value_start:value_end]
                    marker_parts = _split_visual_mpn_at_marker(raw_template, composition)
                    marker = str(
                        composition.get("markerSequence")
                        or composition.get("marker")
                        or ""
                    )
                    if marker_parts and marker:
                        marker_start = value_start + len(marker_parts[0])
                        _add_interpretation_span(
                            spans,
                            group_start + marker_start,
                            group_start + marker_start + len(marker),
                            "insertionMarker",
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


def _normalized_source_value_span(source_text, field_value):
    """Locate a normalized edited value in its punctuated customer source."""
    source_chars = []
    source_positions = []
    for index, character in enumerate(str(source_text or "")):
        if character.isalnum():
            source_chars.append(character.upper())
            source_positions.append(index)
    target = "".join(
        character.upper()
        for character in str(field_value or "")
        if character.isalnum()
    )
    if len(target) < 3 or not source_chars:
        return None
    normalized_source = "".join(source_chars)
    normalized_start = normalized_source.find(target)
    if normalized_start < 0:
        return None
    normalized_end = normalized_start + len(target) - 1
    span_start = source_positions[normalized_start]
    span_end = source_positions[normalized_end] + 1
    closing_pairs = {")": "(", "]": "[", "}": "{", ">": "<"}
    while span_end < len(str(source_text or "")):
        closing = str(source_text)[span_end]
        opening = closing_pairs.get(closing)
        if not opening:
            break
        selected = str(source_text)[span_start:span_end]
        if selected.count(opening) <= selected.count(closing):
            break
        span_end += 1
    return span_start, span_end


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
            matched = False
            while search_from < len(text):
                start = upper_text.find(field_value.upper(), search_from)
                if start < 0:
                    break
                end = start + len(field_value)
                if not any(index in occupied for index in range(start, end)):
                    _add_interpretation_span(spans, start, end, role, len(text))
                    occupied.update(range(start, end))
                    matched = True
                    break
                search_from = start + 1
            if matched:
                continue
            normalized_span = _normalized_source_value_span(text, field_value)
            if not normalized_span:
                continue
            start, end = normalized_span
            if any(index in occupied for index in range(start, end)):
                continue
            _add_interpretation_span(spans, start, end, role, len(text))
            occupied.update(range(start, end))
    return sorted(spans, key=lambda item: (item["start"], item["end"], item["role"]))


def _interpretation_spans_by_column(row, headers, source_columns, active_rule, entries):
    visual_pattern = _authoritative_visual_pattern(active_rule)
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
    mpn_mapped_roles = [
        role
        for role, header in (roles or {}).items()
        if clean(header) and clean(header) == mpn_header
    ]
    # A dedicated MPN column is already a customer assertion about the whole
    # cell. Splitting and prefix removal are destructive and must be taught.
    mpn_rule = {} if len(mpn_mapped_roles) == 1 else _discover_mpn_rule_for_values(mpn_values)
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
    manufacturer_mapped_roles = [
        role
        for role, header in (roles or {}).items()
        if clean(header) and clean(header) == manufacturer_header
    ]
    manufacturer_rule = (
        {}
        if len(manufacturer_mapped_roles) == 1
        else _discover_manufacturer_rule_for_values(manufacturer_values, target_counts=target_counts)
    )
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
    config=None,
    entries=None,
    group=None,
    visual_pattern=None,
    has_manual_edits=False,
    base_rule=None,
    field_rules=None,
):
    """Derive reusable backend parser rules from one corrected teach-popup row."""
    safe_headers = [clean(header) for header in (headers or [])]
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    corrected_entries = entries if isinstance(entries, list) else []
    base_rule = deepcopy(base_rule) if isinstance(base_rule, dict) else {}
    rule = {
        **base_rule,
        "shape": clean((group or {}).get("shape") or ""),
        "fields": deepcopy(base_rule.get("fields")) if isinstance(base_rule.get("fields"), dict) else {},
        "expansions": deepcopy(
            base_rule.get("expansions")
            or base_rule.get("expansionRules")
            or base_rule.get("expansion_rules")
            or []
        ),
    }
    structure_scope = _bom_pattern_structure_scope(safe_headers, safe_roles, config)
    rule["structureScope"] = structure_scope
    rule["structureSignature"] = structure_scope["signature"]
    pattern_key = clean((group or {}).get("patternKey") or (group or {}).get("pattern_key"))
    if pattern_key:
        rule["patternKey"] = pattern_key
    manual_entries = []
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
        submitted_roles = {
            clean(role)
            for entry in corrected_entries
            if isinstance(entry, dict)
            for role in (
                entry.get("fields") if isinstance(entry.get("fields"), dict) else {}
            )
            if clean(role) in ROLE_KEYS
        }
        corrected_roles = mapped_roles | submitted_roles
        for entry_index, entry in enumerate(corrected_entries):
            fields = entry.get("fields") if isinstance(entry, dict) and isinstance(entry.get("fields"), dict) else {}
            manual_entries.append({
                "relation": (
                    clean(entry.get("relation"))
                    if isinstance(entry, dict)
                    else ""
                ) or ("Primary" if entry_index == 0 else f"Alternate {entry_index}"),
                "fields": {
                    role: clean(fields.get(role).get("value") if isinstance(fields.get(role), dict) else fields.get(role))
                    for role in corrected_roles
                },
            })
        if source_value and manual_entries and corrected_roles and has_manual_edits:
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

    for role, field_rule in (field_rules or {}).items() if isinstance(field_rules, dict) else []:
        if clean(role) not in ROLE_KEYS or not isinstance(field_rule, dict):
            continue
        rule["fields"][clean(role)] = {
            **(rule["fields"].get(clean(role)) or {}),
            **field_rule,
            "customerConfirmed": True,
        }

    correction_source_header = clean(
        (visual_pattern or {}).get("sourceHeader")
        or (visual_pattern or {}).get("source_header")
    )
    rule["authoritativeCorrection"] = {
        "version": 1,
        "sourceHeader": correction_source_header,
        "sourceValue": _row_cell(
            row,
            correction_source_header,
            safe_headers,
            preserve_delimiters=True,
        ) if correction_source_header else "",
        "hasManualEdits": bool(has_manual_edits),
        "entries": manual_entries if has_manual_edits else [],
        "fieldRules": deepcopy(field_rules) if isinstance(field_rules, dict) else {},
        "visualPattern": deepcopy(visual_pattern) if isinstance(visual_pattern, dict) else {},
    }

    if not rule["expansions"]:
        rule.pop("expansions", None)
    return rule


def build_bom_field_pattern_teach_result(
    headers,
    row,
    roles=None,
    config=None,
    entries=None,
    group=None,
    tagged_spans=None,
    source_header="",
    alternate_delimiter="",
    alternate_mode="append",
    alternate_joiner="",
    ignored_fields=None,
    has_manual_edits=False,
    visual_pattern=None,
    base_rule=None,
    field_rules=None,
    prefer_field_rules=False,
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

    safe_tagged_spans = _safe_visual_teach_spans(source_value, tagged_spans)
    tagged_roles = {
        clean(span.get("role"))
        for span in safe_tagged_spans
        if clean(span.get("role"))
    }
    has_tagged_interpretation = any(
        role not in {"", "groupSeparator"}
        for role in tagged_roles
    )
    configured_alternate_delimiter = _configured_delimiter({
        "delimiter": alternate_delimiter,
    })
    repeated_prefix_layout = _repeated_fixed_width_mpn_prefix_layout(source_value)
    base_mpn_rule = (
        (base_rule or {}).get("fields", {}).get("mpn", {})
        if isinstance((base_rule or {}).get("fields"), dict)
        else {}
    )
    requested_mpn_rule = {
        **(base_mpn_rule if isinstance(base_mpn_rule, dict) else {}),
        **(
            (field_rules or {}).get("mpn", {})
            if isinstance((field_rules or {}).get("mpn"), dict)
            else {}
        ),
    }
    requested_prefix_mode = clean(
        requested_mpn_rule.get("prefixMode")
        or requested_mpn_rule.get("prefix_mode")
    )
    try:
        requested_prefix_length = int(float(clean(
            requested_mpn_rule.get("stripPrefix")
            or requested_mpn_rule.get("strip_prefix")
            or 0
        )))
    except (TypeError, ValueError):
        requested_prefix_length = 0
    repeated_mpn_field_split = bool(
        repeated_prefix_layout
        and not _configured_delimiter(requested_mpn_rule)
        and clean(safe_roles.get("mpn")) == source_header
        and requested_prefix_mode == "first_n_chars"
        and requested_prefix_length == int(repeated_prefix_layout.get("prefixLength") or 0)
    )
    complete_mpn_field_split = bool(
        clean(alternate_mode) == "complete"
        and configured_alternate_delimiter
        and configured_alternate_delimiter in str(source_value or "")
        and clean(safe_roles.get("mpn")) == source_header
        and "mpn" in tagged_roles
        and tagged_roles.issubset({"mpn", "ignore"})
    )
    if complete_mpn_field_split or repeated_mpn_field_split:
        # A complete-MPN delimiter applies to records, even when the user has
        # highlighted the whole multi-record cell as MPN. Parsing that highlight
        # as one visual segment would collapse every record before cleanup.
        field_rules = deepcopy(field_rules) if isinstance(field_rules, dict) else {}
        field_rules["mpn"] = {
            **requested_mpn_rule,
            "delimiter": (
                "repeated_prefix"
                if repeated_mpn_field_split
                else "\\n" if configured_alternate_delimiter == "\n" else configured_alternate_delimiter
            ),
            "preserveOriginalValue": True,
        }
        manufacturer_header = clean(safe_roles.get("manufacturer"))
        manufacturer_value = (
            _row_cell(row, manufacturer_header, safe_headers, preserve_delimiters=True)
            if manufacturer_header and manufacturer_header != source_header
            else ""
        )
        source_records = (
            _fixed_width_prefix_segments(source_value, field_rules["mpn"])
            if repeated_mpn_field_split
            else _split_explicit_delimiter(source_value, configured_alternate_delimiter)
        )
        manufacturer_records = _split_explicit_delimiter(
            manufacturer_value,
            configured_alternate_delimiter,
        )
        if (
            not repeated_mpn_field_split
            and source_records
            and len(manufacturer_records) == len(source_records)
        ):
            field_rules["manufacturer"] = {
                **(field_rules.get("manufacturer") or {}),
                "delimiter": "\\n" if configured_alternate_delimiter == "\n" else configured_alternate_delimiter,
                "preserveOriginalValue": True,
            }
        prefer_field_rules = True
    else:
        prefer_field_rules = bool(prefer_field_rules and not has_tagged_interpretation)
    backend_visual_pattern = {} if prefer_field_rules else dict(visual_pattern or {})
    if isinstance(tagged_spans, list) and not prefer_field_rules:
        backend_visual_pattern = derive_visual_pattern_from_tagged_spans(
            source_value=source_value,
            source_header=source_header,
            tagged_spans=tagged_spans,
            alternate_delimiter=alternate_delimiter,
            alternate_mode=alternate_mode,
            alternate_joiner=alternate_joiner,
            ignored_fields=ignored_fields,
        )
        if backend_visual_pattern:
            backend_visual_pattern["authoritativeSegments"] = True
    rule = derive_bom_field_pattern_rule_from_correction(
        headers=safe_headers,
        row=row,
        roles=safe_roles,
        config=config,
        entries=entries if has_manual_edits else [],
        group=group,
        visual_pattern=backend_visual_pattern,
        has_manual_edits=has_manual_edits,
        base_rule={
            key: value
            for key, value in (base_rule or {}).items()
            if not prefer_field_rules or key not in {"visualPattern", "visual_pattern"}
        } if isinstance(base_rule, dict) else {},
        field_rules=field_rules,
    )
    rule["authoritativeCorrection"] = {
        **(rule.get("authoritativeCorrection") or {}),
        "taggedSpans": deepcopy(safe_tagged_spans),
        "alternateDelimiter": str(alternate_delimiter or ""),
        "alternateMode": clean(alternate_mode) or "append",
        "alternateJoiner": str(alternate_joiner or ""),
        "ignoredFields": [
            clean(field)
            for field in (ignored_fields or [])
            if clean(field) in ROLE_KEYS
        ],
    }
    if isinstance(rule.get("visualPattern"), dict) and rule["visualPattern"]:
        rule["visualPattern"] = _authoritative_visual_pattern(rule)
        rule["authoritativeCorrection"]["visualPattern"] = deepcopy(
            rule["visualPattern"]
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
    if source_header and safe_tagged_spans:
        # The confirmed example is authoritative. Derived spans are useful for
        # replayed rows, but must never expand or replace the user's selection.
        spans[source_header] = deepcopy(safe_tagged_spans)
    pattern = _visual_pattern_display_pattern(backend_visual_pattern, source_value)
    mapped_fields = [
        role
        for role in ROLE_KEYS
        if source_header and clean(safe_roles.get(role)) == source_header
    ]
    return {
        "source": "backend",
        "rule": rule,
        "controls": _field_pattern_control_state(rule),
        "visualPattern": backend_visual_pattern,
        "pattern": pattern,
        "title": _field_review_title(mapped_fields),
        "mappedFields": mapped_fields,
        "entries": interpreted_entries,
        "interpretationSpansByColumn": spans,
        "authoritativeCorrection": rule.get("authoritativeCorrection") or {},
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


def _roles_for_mapping_unit(roles, config, unit):
    """Bind parsing roles to the primary or alternate source represented by a unit."""
    scopes = list((unit or {}).get("scopes") or [])
    alternate_scope = next(
        (scope for scope in scopes if clean(scope).startswith("alternate-")),
        "",
    )
    if not alternate_scope or "primary" in scopes:
        return dict(roles or {})

    try:
        group_index = int(alternate_scope.rsplit("-", 1)[-1]) - 1
    except (TypeError, ValueError):
        return dict(roles or {})
    groups = _configured_alternate_column_groups(config)
    if group_index < 0 or group_index >= len(groups):
        return dict(roles or {})

    group = groups[group_index]
    scoped_roles = {
        role: clean(group.get(role))
        for role in ROLE_KEYS
        if clean(group.get(role))
    }
    return scoped_roles


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


def _build_split_field_review_step(
    units,
    groups,
    case,
    require_split_evidence=True,
    shared_identity_units=None,
):
    split_fields = []
    identity_groups = []
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
                "targetGroups": [
                    {"id": group.get("id"), "shape": group.get("shape")}
                    for group in groups or []
                    if group.get("shape")
                ],
                "candidateRules": candidate_rules,
                "delimiterOptions": delimiter_options,
                "previews": {
                    option["value"]: _split_field_preview(samples, field, option["value"])
                    for option in delimiter_options
                },
            })

    for unit in shared_identity_units or []:
        source_column = clean(unit.get("sourceColumn"))
        identity_roles = [
            field
            for field in (unit.get("mappedFields") or [])
            if field in {"cpn", "mpn", "manufacturer"}
        ]
        if not source_column or len(identity_roles) < 2:
            continue

        candidate_rules = []
        identity_key = _identity_group_rule_key({
            "header": source_column,
            "roles": identity_roles,
        })
        for group in groups or []:
            suggested_groups = (
                (group.get("suggestedRule") or {}).get("identityGroups")
                or (group.get("suggestedRule") or {}).get("identity_groups")
                or []
            )
            rule = next(
                (
                    item for item in suggested_groups
                    if _identity_group_rule_key(item) == identity_key
                ),
                None,
            )
            if isinstance(rule, dict):
                candidate_rules.append({
                    "groupId": group.get("id"),
                    "shape": group.get("shape"),
                    "rule": rule,
                })

        identity_groups.append({
            "sourceColumn": source_column,
            "header": source_column,
            "roles": identity_roles,
            "groupIds": [group.get("id") for group in groups or [] if group.get("id")],
            "targetGroups": [
                {"id": group.get("id"), "shape": group.get("shape")}
                for group in groups or []
                if group.get("shape")
            ],
            "candidateRules": candidate_rules,
            "delimiterOptions": delimiter_options,
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
        "identityGroups": identity_groups,
        "sourceColumns": list(dict.fromkeys(item["sourceColumn"] for item in split_fields)),
        "mappedFields": list(dict.fromkeys(item["field"] for item in split_fields)),
    }


def _build_semantic_review_patterns(headers, roles, config, row_shape_groups, options=None):
    """Build globally deduplicated, fragment-level patterns for user review."""
    options = options or {}
    units = _field_review_mapping_units(headers, roles, config=config)
    semantic_units = [
        unit for unit in units
        if (
            unit.get("relationship") == "shared"
            or unit.get("mappedFields") == ["mpn"]
            or (
                any(
                    clean(scope).startswith("alternate-")
                    for scope in (unit.get("scopes") or [])
                )
                and any(
                    field in {"mpn", "manufacturer", "cpn"}
                    for field in (unit.get("mappedFields") or [])
                )
            )
        )
    ]
    structure_signature = _bom_pattern_structure_scope(headers, roles, config).get("signature")
    saved_interpretations = load_saved_bom_pattern_interpretations(structure_signature)
    draft_rules = {}
    for key in ("fieldPatternRules", "field_pattern_rules", "patternRules", "pattern_rules"):
        if isinstance(options.get(key), dict):
            draft_rules.update(options.get(key))

    patterns = {}
    for group in row_shape_groups or []:
        for raw_sample in group.get("_rawSamples") or []:
            row = raw_sample.get("row") or {}
            source_row = raw_sample.get("sourceRow")
            for unit in semantic_units:
                source_column = unit.get("sourceColumn")
                mapped_fields = unit.get("mappedFields") or []
                unit_roles = _roles_for_mapping_unit(roles, config, unit)
                source_value = _row_cell(row, source_column, headers, preserve_delimiters=True)
                if is_blankish(source_value):
                    continue
                for fragment in _semantic_identity_fragments(source_value, mapped_fields):
                    grammar = clean(fragment.get("grammar"))
                    if not grammar:
                        continue
                    # Plain one-to-one values are direct mappings, not patterns.
                    # Only surface the MPN column when backend value recognition
                    # found additional customer text that needs interpretation.
                    if (
                        unit.get("relationship") == "one_to_one"
                        and len(mapped_fields) == 1
                        and grammar == _pattern_display_token(mapped_fields[0])
                    ):
                        continue
                    pattern_key = _semantic_pattern_key(source_column, mapped_fields, grammar)
                    automatic_unclassified = _semantic_grammar_is_unclassified(
                        grammar,
                        mapped_fields,
                    )
                    stored = saved_interpretations.get(pattern_key)
                    draft_rule = draft_rules.get(pattern_key) if isinstance(draft_rules.get(pattern_key), dict) else {}
                    parser_rule = (
                        _automatic_unclassified_rule(
                            source_column,
                            mapped_fields,
                            pattern_key,
                        )
                        if automatic_unclassified
                        else draft_rule or ((stored or {}).get("rule") if stored else {}) or {}
                    )
                    parser_rule = _semantic_rule_for_source(parser_rule, source_column)
                    has_saved_interpretation = bool(parser_rule)
                    detected_position_rule = (
                        _mpn_position_prefix_rule(
                            fragment.get("rawValue") or "",
                            source_column=source_column,
                        )
                        if mapped_fields == ["mpn"]
                        else {}
                    )
                    detected_mpn_rule = (
                        (detected_position_rule.get("fields") or {}).get("mpn") or {}
                    )
                    if (
                        parser_rule
                        and clean(detected_mpn_rule.get("delimiter")) == "repeated_prefix"
                        and grammar.startswith("<PREFIX><MPN>")
                    ):
                        parser_rule = deepcopy(parser_rule)
                        parser_fields = (
                            deepcopy(parser_rule.get("fields"))
                            if isinstance(parser_rule.get("fields"), dict)
                            else {}
                        )
                        parser_fields["mpn"] = {
                            **(parser_fields.get("mpn") or {}),
                            **detected_mpn_rule,
                        }
                        parser_rule["fields"] = parser_fields
                        parser_rule.pop("visualPattern", None)
                        parser_rule.pop("visual_pattern", None)
                    if not parser_rule:
                        parser_rule = _infer_marker_alternate_visual_rule(
                            fragment.get("rawValue") or "",
                            source_column,
                            mapped_fields,
                        )
                        if not parser_rule and detected_position_rule:
                            parser_rule = detected_position_rule
                        if parser_rule:
                            parser_rule["patternKey"] = pattern_key
                    visual_pattern = (
                        parser_rule.get("visualPattern")
                        or parser_rule.get("visual_pattern")
                        or {}
                    ) if isinstance(parser_rule, dict) else {}
                    visual_segments = (
                        visual_pattern.get("segments")
                        if isinstance(visual_pattern.get("segments"), list)
                        else []
                    ) if isinstance(visual_pattern, dict) else []
                    has_alternate_list = (
                        "<ALTERNATE_" in grammar
                        or any(clean(segment.get("role")) == "alternateList" for segment in visual_segments)
                        or (
                            clean(
                                (config or {}).get("alternateLayout")
                                or (config or {}).get("alternate_layout")
                            ) == "inside_selected_mpn_columns"
                            and "mpn" in mapped_fields
                            and "<SUFFIX>" in grammar
                        )
                    )
                    interpretation_pattern = (
                        _visual_pattern_display_pattern(
                            visual_pattern,
                            fragment.get("rawValue") or "",
                        )
                        if visual_pattern and has_saved_interpretation
                        else ""
                    ) or grammar
                    if automatic_unclassified:
                        interpretation_pattern = "<UNCLASSIFIED_TEXT>"
                    item = patterns.setdefault(pattern_key, {
                        "id": pattern_key,
                        "patternKey": pattern_key,
                        "shape": pattern_key,
                        "grammar": grammar,
                        "hasAlternateList": has_alternate_list,
                        "interpretationPattern": interpretation_pattern,
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
                        "controls": _field_pattern_control_state(parser_rule),
                        "storedInterpretation": stored,
                        "recognized": bool(automatic_unclassified or stored or draft_rule),
                        "ignored": _field_pattern_rule_excludes_row(parser_rule),
                        "ignoresFields": _field_pattern_rule_ignores_fields(parser_rule),
                        "recognitionScope": (
                            "backend"
                            if automatic_unclassified
                            else clean((stored or {}).get("matchScope")) or ("session" if draft_rule else "")
                        ),
                        "draftInterpretation": {"rule": draft_rule} if draft_rule else None,
                        "automaticUnclassified": automatic_unclassified,
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
                        "extraction": deepcopy(fragment.get("extraction") or {}),
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
                    for config_key in (
                        "semanticPatternRules",
                        "semantic_pattern_rules",
                        "fieldPatternRules",
                        "field_pattern_rules",
                        "_activeFieldPatternRule",
                        "_active_field_pattern_rule",
                    ):
                        fragment_config.pop(config_key, None)
                    fragment_config["_semanticPatternPass"] = True
                    if parser_rule:
                        fragment_config = _config_with_active_rule(fragment_config, parser_rule)
                    entries = _infer_field_entries_for_row(
                        fragment_row,
                        headers,
                        unit_roles,
                        [source_column],
                        config=fragment_config,
                    )
                    rule_fallback_used = False
                    if not parser_rule:
                        # A detected grammar may identify only some of the
                        # fields mapped to a shared customer column. Do not copy
                        # that entire cell into roles the grammar did not find.
                        unclassified_roles = {
                            role
                            for role in mapped_fields
                            if _pattern_display_token(role) not in grammar
                        }
                        if unclassified_roles and not entries:
                            preview_fields = {
                                role: _blank_factwise_field()
                                for role in FACTWISE_FIELD_LABELS
                            }
                            for role in FACTWISE_FIELD_LABELS:
                                if role in unclassified_roles:
                                    continue
                                mapped_header = clean((unit_roles or {}).get(role))
                                mapped_value = (
                                    _row_cell(fragment_row, mapped_header, headers)
                                    if mapped_header
                                    else ""
                                )
                                if not is_blankish(mapped_value):
                                    preview_fields[role] = _direct_factwise_field(
                                        mapped_value,
                                        mapped_header,
                                    )
                            entries = [_build_factwise_entry(0, preview_fields, "Primary")]
                        for entry in entries:
                            entry_fields = entry.get("fields") if isinstance(entry, dict) else None
                            if not isinstance(entry_fields, dict):
                                continue
                            for role in unclassified_roles:
                                entry_fields[role] = _blank_factwise_field()
                    if _field_pattern_rule_ignores_fields(parser_rule) and entries:
                        entries = entries[:1]
                        entries[0]["relation"] = "Ignored"
                        entries[0]["ignoredIdentity"] = True
                    spans = _interpretation_spans_by_column(
                        fragment_row,
                        headers,
                        [source_column],
                        {} if rule_fallback_used else parser_rule,
                        entries,
                    )
                    confirmed_spans = spans.get(source_column) or []
                    if stored and visual_pattern and confirmed_spans and not rule_fallback_used:
                        rendered_interpretation_pattern = (
                            _visual_pattern_display_from_tagged_spans(
                                occurrence["rawValue"],
                                (0, len(occurrence["rawValue"])),
                                confirmed_spans,
                                visual_pattern,
                            )
                        )
                        if (
                            rendered_interpretation_pattern
                            and _visual_pattern_display_quality(
                                rendered_interpretation_pattern
                            ) > _visual_pattern_display_quality(
                                item.get("interpretationPattern") or ""
                            )
                        ):
                            item["interpretationPattern"] = rendered_interpretation_pattern
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
                        "ruleFallbackUsed": rule_fallback_used,
                        "replayNeedsReview": any(
                            bool(entry.get("needsReview"))
                            for entry in entries
                            if isinstance(entry, dict)
                        ),
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
    mpn_validations = _validate_semantic_pattern_mpns(ordered)
    for index, item in enumerate(ordered, start=1):
        automatic_unclassified = bool(item.get("automaticUnclassified"))
        has_saved_interpretation = bool(item.get("storedInterpretation"))
        has_interpretation = bool(
            automatic_unclassified
            or has_saved_interpretation
            or item.get("draftInterpretation")
        )
        ignores_fields = _field_pattern_rule_ignores_fields(
            item.get("suggestedRule") or {}
        )
        effective_grammar = (
            item.get("interpretationPattern")
            if has_interpretation
            else item.get("grammar")
        ) or item.get("grammar") or ""
        coverage = _semantic_interpretation_coverage(
            effective_grammar,
            item.get("mappedFields") or [],
            item.get("suggestedRule") or {},
            item.get("interpretations") or [],
        )
        mpn_validation = mpn_validations.get(clean(item.get("patternKey"))) or {
            "applicable": False,
            "valid": True,
        }
        if ignores_fields:
            mpn_validation = {
                "applicable": False,
                "valid": True,
                "ignored": True,
                "threshold": MPN_RECOGNITION_SIMILARITY_THRESHOLD,
                "generatedMpnCount": 0,
                "matchedMpnCount": 0,
                "matches": [],
                "failures": [],
                "reasons": [],
                "reason": "",
            }
        mpn_is_accepted = bool(
            mpn_validation.get("valid")
            or has_saved_interpretation
        )
        if (
            has_saved_interpretation
            and mpn_is_accepted
            and not mpn_validation.get("valid")
        ):
            mpn_validation = {
                **mpn_validation,
                "acceptedByUser": True,
                "advisoryOnly": True,
            }
        if not has_interpretation:
            coverage = {
                **coverage,
                "valid": False,
                "reason": "no_saved_interpretation",
            }
        elif not coverage.get("valid"):
            coverage["reason"] = "incomplete_grammar_coverage"
        elif not mpn_is_accepted:
            coverage = {
                **coverage,
                "valid": False,
                "reason": mpn_validation.get("reason") or "mpn_not_verified",
            }
        coverage["mpnValidation"] = mpn_validation
        item["recognitionValidation"] = coverage
        item["recognized"] = bool(
            automatic_unclassified
            or has_saved_interpretation
            or (
                has_interpretation
                and coverage.get("valid")
                and mpn_is_accepted
            )
        )
        if automatic_unclassified:
            item["recognitionScope"] = "backend"
        if has_interpretation:
            item["interpretationPattern"] = (
                "<UNCLASSIFIED_TEXT>"
                if automatic_unclassified
                else effective_grammar
            )
        item["title"] = f"Pattern {index}"
        item["occurrenceCount"] = len(item.get("occurrences") or [])
        item["rowCount"] = len({occ.get("sourceRow") for occ in item.get("occurrences") or []})
        item["sampledRowCount"] = len(item.get("samples") or [])
        if item.get("patternRows"):
            item["patternRows"][0]["occurrenceCount"] = item["occurrenceCount"]
        item["alternateEntryCount"] = max(
            [max(0, len(sample.get("entries") or []) - 1) for sample in item.get("samples") or []] or [0]
        )
        item["hasAlternateList"] = bool(
            item.get("hasAlternateList") or item["alternateEntryCount"] > 0
        )
        item["groupIds"] = list(item.get("rowShapeGroupIds") or [])
    return ordered


def _build_pattern_combinations(headers, patterns):
    """Group source rows by their ordered semantic-pattern sequence."""
    header_positions = {
        clean(header): index
        for index, header in enumerate(headers or [])
        if clean(header)
    }
    patterns_by_key = {
        clean(pattern.get("patternKey")): pattern
        for pattern in patterns or []
        if clean(pattern.get("patternKey"))
    }
    rows = {}

    for pattern_number, pattern in enumerate(patterns or [], start=1):
        pattern_key = clean(pattern.get("patternKey"))
        interpretations = {
            clean(item.get("occurrenceId")): item
            for item in pattern.get("interpretations") or []
            if clean(item.get("occurrenceId"))
        }
        for occurrence in pattern.get("occurrences") or []:
            occurrence_id = clean(occurrence.get("id"))
            interpretation = interpretations.get(occurrence_id) or {}
            source_row = occurrence.get("sourceRow")
            row_key = str(source_row)
            row = rows.setdefault(row_key, {
                "sourceRow": source_row,
                "left": interpretation.get("left") or [],
                "occurrences": [],
            })
            if not row.get("left") and interpretation.get("left"):
                row["left"] = interpretation.get("left") or []
            row["occurrences"].append({
                "patternKey": pattern_key,
                "patternNumber": pattern_number,
                "pattern": pattern.get("grammar") or "",
                "sourceColumn": occurrence.get("sourceColumn") or pattern.get("sourceColumn") or "",
                "mappedFields": pattern.get("mappedFields") or [],
                "occurrenceId": occurrence_id,
                "start": int(occurrence.get("start") or 0),
                "end": int(occurrence.get("end") or 0),
                "rawValue": occurrence.get("rawValue") or "",
                "extraction": deepcopy(occurrence.get("extraction") or {}),
                "entries": interpretation.get("entries") or [],
                "interpretationSpans": interpretation.get("interpretationSpans") or [],
            })

    combinations = {}
    for row in rows.values():
        row["occurrences"].sort(key=lambda item: (
            header_positions.get(clean(item.get("sourceColumn")), len(header_positions)),
            int(item.get("start") or 0),
            int(item.get("end") or 0),
            clean(item.get("patternKey")),
        ))
        occurrence_sequence = [item["patternKey"] for item in row["occurrences"]]
        if not occurrence_sequence:
            continue
        # Repeated occurrences affect this row's output, but they do not make
        # the row a different review combination. Preserve first-seen order so
        # genuinely different pattern order remains distinguishable.
        sequence = list(dict.fromkeys(occurrence_sequence))
        identity = "|".join(sequence)
        combination_id = f"combination-{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:20]}"
        combination = combinations.setdefault(combination_id, {
            "id": combination_id,
            "title": "",
            "patternKeys": sequence,
            "patterns": [],
            "matchingRowCount": 0,
            "sourceRows": [],
            "samples": [],
        })

        member_counts = {}
        for pattern_key in occurrence_sequence:
            member_counts[pattern_key] = member_counts.get(pattern_key, 0) + 1
        if not combination["patterns"]:
            seen = set()
            for occurrence in row["occurrences"]:
                pattern_key = occurrence["patternKey"]
                if pattern_key in seen:
                    continue
                seen.add(pattern_key)
                pattern = patterns_by_key.get(pattern_key) or {}
                combination["patterns"].append({
                    "patternKey": pattern_key,
                    "patternNumber": occurrence.get("patternNumber"),
                    "pattern": pattern.get("grammar") or occurrence.get("pattern") or "",
                    "sourceColumn": pattern.get("sourceColumn") or occurrence.get("sourceColumn") or "",
                    "mappedFields": pattern.get("mappedFields") or occurrence.get("mappedFields") or [],
                    "hasAlternateList": bool(pattern.get("hasAlternateList")),
                    "count": member_counts.get(pattern_key, 1),
                    "reviewed": bool(pattern.get("recognized")),
                })

        entries = []
        for occurrence in row["occurrences"]:
            for pattern_entry_index, entry in enumerate(occurrence.get("entries") or []):
                entries.append({
                    **entry,
                    "patternKey": occurrence["patternKey"],
                    "occurrenceId": occurrence["occurrenceId"],
                    "patternEntryIndex": pattern_entry_index,
                })
        for entry_index, entry in enumerate(entries):
            if clean(entry.get("relation")) != "Ignored":
                entry["relation"] = "Primary" if entry_index == 0 else f"Alternate {entry_index}"

        combination["sourceRows"].append(row["sourceRow"])
        combination["samples"].append({
            "sourceRow": row["sourceRow"],
            "left": row.get("left") or [],
            "occurrences": row["occurrences"],
            "patternCounts": member_counts,
            "entries": entries,
        })

    ordered = sorted(
        combinations.values(),
        key=lambda item: min(item.get("sourceRows") or [0]),
    )
    for index, combination in enumerate(ordered, start=1):
        combination["title"] = f"Combination {index}"
        combination["matchingRowCount"] = len(combination.get("samples") or [])
        for pattern in combination.get("patterns") or []:
            counts = [
                int((sample.get("patternCounts") or {}).get(pattern["patternKey"], 0))
                for sample in combination.get("samples") or []
            ]
            pattern["minCount"] = min(counts or [0])
            pattern["maxCount"] = max(counts or [0])
            pattern["countVaries"] = pattern["minCount"] != pattern["maxCount"]
    return ordered


def _build_direct_review_combinations(row_shape_groups, excluded_source_rows=None):
    """Return backend-owned previews for rows without semantic patterns."""
    excluded_source_rows = {str(row) for row in (excluded_source_rows or [])}
    combinations = []
    for index, group in enumerate(row_shape_groups or [], start=1):
        shape = clean(group.get("shape"))
        if not shape:
            continue
        group["patternKey"] = shape

        row_entries = list((group.get("rowEntries") or {}).values())
        source_samples = row_entries or list(group.get("samples") or [])
        samples = []
        for sample in source_samples:
            source_row = sample.get("sourceRow")
            if str(source_row) in excluded_source_rows:
                continue
            occurrence_id = str(source_row)
            entries = sample.get("entries") or []
            samples.append({
                "sourceRow": source_row,
                "left": sample.get("left") or [],
                "occurrences": [{
                    "patternKey": shape,
                    "occurrenceId": occurrence_id,
                    "sourceColumn": "",
                    "start": 0,
                    "end": 0,
                    "rawValue": "",
                    "entries": entries,
                    "interpretationSpans": [],
                }],
                "patternCounts": {shape: 1},
                "entries": entries,
            })

        samples.sort(key=lambda sample: sample.get("sourceRow") or 0)
        if not samples:
            continue
        combinations.append({
            "id": f"direct-{hashlib.sha256(shape.encode('utf-8')).hexdigest()[:20]}",
            "title": f"Direct mapping {index}",
            "patternKeys": [shape],
            "patterns": [],
            "matchingRowCount": int(group.get("rowCount") or len(samples)),
            "sourceRows": [sample.get("sourceRow") for sample in samples],
            "samples": samples,
            "directPreview": True,
        })
    return combinations


def _build_pattern_review_summary(patterns, combinations):
    """Summarize backend detection and provide navigation targets for review."""
    safe_patterns = [pattern for pattern in (patterns or []) if isinstance(pattern, dict)]
    safe_combinations = [
        combination for combination in (combinations or [])
        if isinstance(combination, dict)
    ]
    combination_ids_by_pattern = {}
    item_counts_by_row = {}
    for combination in safe_combinations:
        combination_id = clean(combination.get("id"))
        for pattern_key in combination.get("patternKeys") or []:
            pattern_key = clean(pattern_key)
            if pattern_key and combination_id:
                combination_ids_by_pattern.setdefault(pattern_key, []).append(combination_id)
        for sample_index, sample in enumerate(combination.get("samples") or []):
            if not isinstance(sample, dict):
                continue
            source_row = sample.get("sourceRow")
            row_key = str(source_row) if source_row is not None else f"{combination_id}:{sample_index}"
            entry_count = len([
                entry for entry in (sample.get("entries") or [])
                if isinstance(entry, dict)
            ])
            item_counts_by_row[row_key] = max(item_counts_by_row.get(row_key, 0), entry_count)

    recognized = []
    unrecognized = []
    for pattern in safe_patterns:
        pattern_key = clean(pattern.get("patternKey"))
        summary_pattern = {
            "patternKey": pattern_key,
            "pattern": pattern.get("interpretationPattern") or pattern.get("grammar") or "",
            "detectedPattern": pattern.get("grammar") or "",
            "sourceColumn": pattern.get("sourceColumn") or "",
            "mappedFields": pattern.get("mappedFields") or [],
            "occurrenceCount": int(pattern.get("occurrenceCount") or 0),
            "firstSourceRow": (
                (pattern.get("occurrences") or [{}])[0].get("sourceRow")
                if pattern.get("occurrences")
                else None
            ),
            "combinationIds": list(dict.fromkeys(combination_ids_by_pattern.get(pattern_key) or [])),
            "recognitionScope": clean(pattern.get("recognitionScope")),
            "recognitionValidation": pattern.get("recognitionValidation") or {},
        }
        if pattern.get("recognized"):
            recognized.append(summary_pattern)
        else:
            unrecognized.append(summary_pattern)

    return {
        "itemCount": sum(item_counts_by_row.values()),
        "sourceRowCount": len(item_counts_by_row),
        "patternCount": len(safe_patterns),
        "recognizedPatternCount": len(recognized),
        "unrecognizedPatternCount": len(unrecognized),
        "recognizedPatterns": recognized,
        "unrecognizedPatterns": unrecognized,
    }


def _review_entry_field_value(field):
    if isinstance(field, dict):
        return field.get("value") or ""
    return field or ""


def _review_entry_source_column(field):
    if isinstance(field, dict):
        return field.get("sourceColumn") or ""
    return ""


def _display_review_entries(entries, config=None):
    """Return backend-approved rows in the exact shape rendered by the popup."""
    raw_entries = [entry for entry in (entries or []) if isinstance(entry, dict)]
    alternate_layout = clean(
        (config or {}).get("alternateLayout")
        or (config or {}).get("alternate_layout")
    )
    filtered = [
        entry
        for index, entry in enumerate(raw_entries)
        if (
            index == 0
            or alternate_layout != "separate_columns"
            or clean(_review_entry_field_value((entry.get("fields") or {}).get("mpn")))
        )
    ]
    if not filtered and raw_entries:
        filtered = raw_entries[:1]

    display_entries = []
    for index, entry in enumerate(filtered):
        fields = entry.get("fields") or {}
        explicit_source_columns = (
            entry.get("sourceColumns")
            if isinstance(entry.get("sourceColumns"), dict)
            else {}
        )
        display_entries.append({
            "index": entry.get("index", index),
            "relation": (
                "Ignored"
                if clean(entry.get("relation")) == "Ignored"
                else "Primary" if index == 0 else f"Alternate {index}"
            ),
            "fields": {
                role: _review_entry_field_value(fields.get(role))
                for role in FACTWISE_FIELD_LABELS
            },
            "sourceColumns": {
                role: clean(explicit_source_columns.get(role))
                or _review_entry_source_column(fields.get(role))
                for role in FACTWISE_FIELD_LABELS
            },
        })
    return display_entries


def _visible_review_field_keys(entries, left, roles):
    selected_columns = {
        clean(item.get("column"))
        for item in (left or [])
        if isinstance(item, dict) and clean(item.get("column"))
    }
    visible = []
    for role in ROLE_KEYS:
        role_source = clean((roles or {}).get(role))
        has_mapped_source = bool(role_source and role_source in selected_columns)
        has_value = any(clean((entry.get("fields") or {}).get(role)) for entry in entries or [])
        has_entry_source = any(
            clean((entry.get("sourceColumns") or {}).get(role)) in selected_columns
            for entry in entries or []
        )
        if has_mapped_source or has_value or has_entry_source:
            visible.append(role)
    return visible


def _sync_review_display_rows(review):
    """Synchronize row statuses and return one backend-owned row per interpretation."""
    review = review if isinstance(review, dict) else {}
    authoritative_patterns = {
        clean(pattern.get("patternKey")): pattern
        for pattern in review.get("patterns") or []
        if isinstance(pattern, dict) and clean(pattern.get("patternKey"))
    }
    source_columns = []
    review_field_keys = []
    display_rows = []

    for review_row in review.get("rows") or []:
        if not isinstance(review_row, dict):
            continue
        for source_cell in review_row.get("left") or []:
            source_column = clean(source_cell.get("column")) if isinstance(source_cell, dict) else ""
            if source_column and source_column not in source_columns:
                source_columns.append(source_column)
        for field_key in review_row.get("visibleFieldKeys") or []:
            field_key = clean(field_key)
            if field_key and field_key not in review_field_keys:
                review_field_keys.append(field_key)

        synchronized_patterns = []
        for row_pattern in review_row.get("patterns") or []:
            if not isinstance(row_pattern, dict):
                continue
            pattern_key = clean(row_pattern.get("patternKey"))
            authoritative = authoritative_patterns.get(pattern_key) or {}
            recognized = bool(authoritative.get("recognized"))
            synchronized_patterns.append({
                **row_pattern,
                "recognized": recognized,
                "status": "recognized" if recognized else "unrecognized",
                "statusLabel": "Recognized" if recognized else "Needs review",
                "recognitionScope": clean(authoritative.get("recognitionScope")),
                "recognitionValidation": authoritative.get("recognitionValidation") or {},
                "teachContext": authoritative.get("teachContext") or row_pattern.get("teachContext"),
            })
        needs_review = any(not pattern.get("recognized") for pattern in synchronized_patterns)
        review_row["patterns"] = synchronized_patterns
        review_row["needsReview"] = needs_review

        entries = [
            entry for entry in review_row.get("entries") or []
            if isinstance(entry, dict)
        ]
        if not entries:
            entries = [{
                "relation": "Primary",
                "fields": {},
                "sourceColumns": {},
                "groupId": "",
                "occurrenceId": "",
                "patternEntryIndex": 0,
            }]
        for entry_index, entry in enumerate(entries):
            relation = clean(entry.get("relation")) or (
                "Primary" if entry_index == 0 else f"Alternate {entry_index}"
            )
            entry_pattern_key = clean(entry.get("patternKey"))
            entry_patterns = [
                pattern for pattern in synchronized_patterns
                if clean(pattern.get("patternKey")) == entry_pattern_key
            ]
            if not entry_patterns and not entry_pattern_key and len(synchronized_patterns) == 1:
                entry_patterns = synchronized_patterns[:1]
            entry_needs_review = any(
                not pattern.get("recognized") for pattern in entry_patterns
            )
            display_rows.append({
                "id": f"{review_row.get('id') or review_row.get('sourceRow')}:entry:{entry_index}",
                "reviewRowId": review_row.get("id") or "",
                "sourceRow": review_row.get("sourceRow"),
                "left": review_row.get("left") or [],
                "relation": relation,
                "fields": entry.get("fields") or {},
                "sourceColumns": entry.get("sourceColumns") or {},
                "patternKey": entry_pattern_key,
                "groupId": entry.get("groupId") or "",
                "occurrenceId": entry.get("occurrenceId") or "",
                "patternEntryIndex": entry.get("patternEntryIndex", entry_index),
                "visibleFieldKeys": review_row.get("visibleFieldKeys") or [],
                "patterns": entry_patterns,
                "needsReview": entry_needs_review,
                "mpnCount": int(review_row.get("mpnCount") or 0),
                "manufacturerCount": int(review_row.get("manufacturerCount") or 0),
                "hasPairingMismatch": bool(review_row.get("hasPairingMismatch")),
                "warnings": review_row.get("warnings") or [],
                "firstForSourceRow": entry_index == 0,
                "lastForSourceRow": entry_index == len(entries) - 1,
            })

    display = review.get("display") if isinstance(review.get("display"), dict) else {}
    display.update({
        "sourceColumns": source_columns,
        "reviewFieldKeys": review_field_keys,
        "displayRowPageSize": 25,
    })
    review["display"] = display
    review["displayRows"] = display_rows
    return review


def _build_backend_review_contract(
    summary,
    patterns,
    groups,
    review_rows,
    workflow,
    roles,
    config,
    headers,
    active_rules,
):
    """Build the presentation-ready review contract; React must not reclassify it."""
    summary = summary or {}
    recognized_keys = {
        clean(pattern.get("patternKey"))
        for pattern in summary.get("recognizedPatterns") or []
        if isinstance(pattern, dict)
    }
    summary_patterns = [
        {**pattern, "recognized": True, "status": "recognized", "statusLabel": "Recognized"}
        for pattern in summary.get("recognizedPatterns") or []
        if isinstance(pattern, dict)
    ] + [
        {**pattern, "recognized": False, "status": "unrecognized", "statusLabel": "Needs review"}
        for pattern in summary.get("unrecognizedPatterns") or []
        if isinstance(pattern, dict)
    ]

    def pattern_sort_key(pattern):
        first_source_row = pattern.get("firstSourceRow")
        try:
            return (0, int(first_source_row), clean(pattern.get("patternKey")))
        except (TypeError, ValueError):
            return (1, 0, clean(pattern.get("patternKey")))

    ordered_patterns = sorted(summary_patterns, key=pattern_sort_key)
    groups_by_pattern_key = {
        clean(group.get("patternKey")): group
        for group in groups or []
        if isinstance(group, dict) and clean(group.get("patternKey"))
    }
    workflow_steps_by_pattern_key = {
        clean(step.get("patternKey")): step
        for step in (workflow or {}).get("steps") or []
        if isinstance(step, dict) and step.get("type") == "teach_visual" and clean(step.get("patternKey"))
    }
    rows_by_pattern_key = {}
    for row_index, row in enumerate(review_rows or []):
        if not isinstance(row, dict):
            continue
        for occurrence in row.get("occurrences") or []:
            pattern_key = clean(occurrence.get("patternKey")) if isinstance(occurrence, dict) else ""
            if pattern_key and pattern_key not in rows_by_pattern_key:
                rows_by_pattern_key[pattern_key] = (row_index, row, occurrence)

    def teach_context(pattern, group, row_index, row, occurrence):
        pattern_key = clean(pattern.get("patternKey"))
        workflow_step = workflow_steps_by_pattern_key.get(pattern_key) or {}
        source_column = clean(occurrence.get("sourceColumn"))
        source_fragment = {
            key: value
            for key, value in occurrence.items()
            if key != "entries"
        }
        preview_entries = _compact_review_entries(occurrence.get("entries") or [])
        return {
            "groupId": group.get("id") or "",
            "workflowStepId": workflow_step.get("id") or "",
            "combinationId": row.get("combinationId") or (
                (pattern.get("combinationIds") or [""])[0]
            ),
            "reviewRowIndex": row_index,
            "reviewPage": row_index // 4,
            "controls": pattern.get("controls") or _field_pattern_control_state(
                group.get("suggestedRule") or {}
            ),
            "sample": {
                "sourceRow": row.get("sourceRow"),
                "left": row.get("left") or [],
                "sourceFragment": {
                    **source_fragment,
                    "id": occurrence.get("occurrenceId") or "",
                },
                "entries": preview_entries,
                "fields": preview_entries[0].get("fields", {}) if preview_entries else {},
                "interpretationSpansByColumn": {
                    source_column: occurrence.get("interpretationSpans") or []
                } if source_column else {},
                "patternRows": group.get("patternRows") or [],
                "primaryPatternRow": group.get("primaryPatternRow"),
            },
        }

    for pattern in ordered_patterns:
        pattern_key = clean(pattern.get("patternKey"))
        group = groups_by_pattern_key.get(pattern_key) or {}
        row_match = rows_by_pattern_key.get(pattern_key)
        workflow_step = workflow_steps_by_pattern_key.get(pattern_key) or {}
        pattern["mappedFieldLabels"] = [
            FACTWISE_FIELD_LABELS.get(field) or ROLE_LABELS.get(field) or field
            for field in pattern.get("mappedFields") or []
        ]
        pattern["mappedFieldsLabel"] = " + ".join(pattern["mappedFieldLabels"])
        pattern["groupId"] = group.get("id") or ""
        pattern["workflowStepId"] = workflow_step.get("id") or ""
        pattern["controls"] = pattern.get("controls") or _field_pattern_control_state(
            group.get("suggestedRule") or {}
        )
        if not row_match:
            pattern["teachContext"] = None
            continue
        row_index, row, occurrence = row_match
        pattern["reviewRowIndex"] = row_index
        pattern["teachContext"] = teach_context(pattern, group, row_index, row, occurrence)

    patterns_by_key = {
        clean(pattern.get("patternKey")): pattern
        for pattern in ordered_patterns
        if clean(pattern.get("patternKey"))
    }
    for row_index, row in enumerate(review_rows or []):
        occurrences_by_key = {
            clean(occurrence.get("patternKey")): occurrence
            for occurrence in row.get("occurrences") or []
            if isinstance(occurrence, dict) and clean(occurrence.get("patternKey"))
        }
        for row_pattern in row.get("patterns") or []:
            pattern_key = clean(row_pattern.get("patternKey"))
            occurrence = occurrences_by_key.get(pattern_key)
            pattern = patterns_by_key.get(pattern_key)
            group = groups_by_pattern_key.get(pattern_key) or {}
            if occurrence and pattern:
                row_pattern["teachContext"] = teach_context(
                    pattern,
                    group,
                    row_index,
                    row,
                    occurrence,
                )

    mapped_field_options = [
        {
            "key": role,
            "label": FACTWISE_FIELD_LABELS.get(role) or ROLE_LABELS.get(role) or role,
            "sourceColumn": clean((roles or {}).get(role)),
        }
        for role in ROLE_KEYS
        if clean((roles or {}).get(role)) in set(headers or [])
    ]
    field_filters = [{"key": "all", "label": "All mapped fields"}] + [
        {"key": option["key"], "label": option["label"]}
        for option in mapped_field_options
    ]
    patterns_by_field = {"all": ordered_patterns}
    for option in mapped_field_options:
        field = option["key"]
        patterns_by_field[field] = [
            pattern
            for pattern in ordered_patterns
            if field in (pattern.get("mappedFields") or [])
        ]

    mapping_units = (workflow or {}).get("mappingUnits") or []
    has_shared_mapping = any(
        isinstance(unit, dict) and unit.get("relationship") == "shared"
        for unit in mapping_units
    )
    alternate_layout = clean(
        (config or {}).get("alternateLayout")
        or (config or {}).get("alternate_layout")
    )
    public_review_rows = []
    for row in review_rows or []:
        public_row = {
            key: value
            for key, value in row.items()
            if key != "occurrences"
        }
        public_row["occurrences"] = [
            {
                key: occurrence.get(key)
                for key in (
                    "patternKey",
                    "occurrenceId",
                    "id",
                    "sourceColumn",
                    "start",
                    "end",
                    "rawValue",
                    "pattern",
                    "interpretationSpans",
                    "extraction",
                )
                if occurrence.get(key) is not None
            }
            for occurrence in row.get("occurrences") or []
            if isinstance(occurrence, dict)
        ]
        public_review_rows.append(public_row)

    return _sync_review_display_rows({
        "contractVersion": 3,
        "summary": {
            key: summary.get(key, 0)
            for key in (
                "itemCount",
                "sourceRowCount",
                "patternCount",
                "recognizedPatternCount",
                "unrecognizedPatternCount",
            )
        },
        "patterns": ordered_patterns,
        "patternsByField": patterns_by_field,
        "fieldFilters": field_filters,
        "mappedFieldOptions": mapped_field_options,
        "bulkParsing": _bulk_pattern_parsing_contract(mapped_field_options),
        "groups": [_compact_review_group(group) for group in groups or []],
        "rows": public_review_rows,
        "fields": [
            {"key": key, "label": label, "required": key == "mpn"}
            for key, label in FACTWISE_FIELD_LABELS.items()
        ],
        "workflow": workflow or {"steps": [], "nextStep": None},
        "activeRules": active_rules or {},
        "display": {
            "rowPageSize": 4,
            "reviewModeLabel": (
                "Shared-column interpretation"
                if has_shared_mapping
                else "One-to-one field interpretation"
            ),
            "allowAddAlternate": alternate_layout != "already_separate_rows",
        },
        "recognizedPatternKeys": sorted(key for key in recognized_keys if key),
    })


def _compact_review_entries(entries):
    compact = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        fields = {}
        for role, field in (entry.get("fields") or {}).items():
            if isinstance(field, dict):
                fields[role] = {
                    "value": field.get("value") or "",
                    "sourceColumn": field.get("sourceColumn") or "",
                }
            else:
                fields[role] = {"value": field or "", "sourceColumn": ""}
        compact.append({
            "index": entry.get("index"),
            "relation": entry.get("relation") or "",
            "fields": fields,
            **(
                {"warnings": entry.get("warnings")}
                if isinstance(entry.get("warnings"), list)
                else {}
            ),
            **(
                {"pairingCheck": entry.get("pairingCheck")}
                if isinstance(entry.get("pairingCheck"), dict)
                else {}
            ),
        })
    return compact


def _build_flat_pattern_review_rows(
    patterns,
    combinations,
    groups=None,
    roles=None,
    config=None,
    include_display_entries=False,
):
    """Return complete source rows for the UI without exposing combination navigation."""

    def compose_interpreted_entries(complete_entries, occurrences, interpreted_entries):
        """Replace each directly mapped identity with its backend interpretation."""
        composed = deepcopy(complete_entries or [])
        if not composed:
            return deepcopy(interpreted_entries or [])

        for occurrence in occurrences:
            occurrence_id = clean(
                occurrence.get("occurrenceId")
                or occurrence.get("id")
            )
            interpreted = [
                deepcopy(entry)
                for entry in (interpreted_entries or [])
                if (
                    isinstance(entry, dict)
                    and clean(entry.get("occurrenceId")) == occurrence_id
                )
            ]
            if not interpreted:
                interpreted = [
                    {
                        **deepcopy(entry),
                        "patternKey": clean(occurrence.get("patternKey")),
                        "occurrenceId": occurrence_id,
                        "patternEntryIndex": entry_index,
                    }
                    for entry_index, entry in enumerate(occurrence.get("entries") or [])
                    if isinstance(entry, dict)
                ]
            if not interpreted:
                continue
            source_column = clean(occurrence.get("sourceColumn"))
            mapped_fields = {
                clean(field)
                for field in (occurrence.get("mappedFields") or [])
                if clean(field) in ROLE_KEYS
            }
            target_index = next((
                index
                for index, entry in enumerate(composed)
                if any(
                    clean(
                        ((entry.get("fields") or {}).get(field) or {}).get("sourceColumn")
                        if isinstance((entry.get("fields") or {}).get(field), dict)
                        else ""
                    ) == source_column
                    for field in mapped_fields
                )
            ), None)
            if target_index is None:
                if len(composed) == 1 and len(occurrences) == 1:
                    target_index = 0
                else:
                    composed.extend(interpreted)
                    continue

            replacements = []
            for offset, interpreted_entry in enumerate(interpreted):
                base_index = target_index + offset
                base_entry = (
                    composed[base_index]
                    if base_index < len(composed)
                    else composed[target_index]
                )
                merged_entry = deepcopy(base_entry)
                merged_fields = merged_entry.setdefault("fields", {})
                for field, value in (interpreted_entry.get("fields") or {}).items():
                    if field in mapped_fields:
                        merged_fields[field] = deepcopy(value)
                merged_entry.update({
                    key: deepcopy(value)
                    for key, value in interpreted_entry.items()
                    if key != "fields"
                })
                replacements.append(merged_entry)
            composed[target_index:target_index + len(interpreted)] = replacements
        return composed

    patterns_by_key = {
        clean(pattern.get("patternKey")): pattern
        for pattern in (patterns or [])
        if isinstance(pattern, dict) and clean(pattern.get("patternKey"))
    }
    complete_entries_by_source_row = {}
    for group in groups or []:
        if not isinstance(group, dict):
            continue
        pattern_key = clean(group.get("patternKey") or group.get("shape"))
        if pattern_key and pattern_key not in patterns_by_key:
            patterns_by_key[pattern_key] = group
        for source_row, row_result in (group.get("rowEntries") or {}).items():
            if not isinstance(row_result, dict):
                continue
            entries = [
                entry
                for entry in (row_result.get("entries") or [])
                if isinstance(entry, dict)
            ]
            current = complete_entries_by_source_row.get(str(source_row)) or []
            if len(entries) > len(current):
                complete_entries_by_source_row[str(source_row)] = entries
    rows_by_key = {}
    for combination in combinations or []:
        if not isinstance(combination, dict):
            continue
        for sample_index, sample in enumerate(combination.get("samples") or []):
            if not isinstance(sample, dict):
                continue
            source_row = sample.get("sourceRow")
            row_key = str(source_row) if source_row is not None else f"{combination.get('id')}:{sample_index}"
            occurrences = []
            for occurrence in sample.get("occurrences") or []:
                if not isinstance(occurrence, dict):
                    continue
                pattern_key = clean(occurrence.get("patternKey"))
                pattern = patterns_by_key.get(pattern_key) or {}
                occurrences.append({
                    **occurrence,
                    "groupId": pattern.get("id") or "",
                    "entries": _compact_review_entries(occurrence.get("entries") or []),
                })
            row_patterns = []
            seen_patterns = set()
            for occurrence in occurrences:
                pattern_key = clean(occurrence.get("patternKey"))
                pattern = patterns_by_key.get(pattern_key)
                if not pattern or pattern_key in seen_patterns:
                    continue
                seen_patterns.add(pattern_key)
                row_patterns.append({
                    "patternKey": pattern_key,
                    "pattern": pattern.get("interpretationPattern") or pattern.get("grammar") or "",
                    "sourceColumn": pattern.get("sourceColumn") or occurrence.get("sourceColumn") or "",
                    "mappedFields": pattern.get("mappedFields") or [],
                    "recognized": bool(pattern.get("recognized")),
                    "recognitionScope": clean(pattern.get("recognitionScope")),
                    "recognitionValidation": _compact_recognition_validation(
                        pattern.get("recognitionValidation")
                    ),
                    "occurrenceId": occurrence.get("occurrenceId") or occurrence.get("id") or "",
                })
            display_entries = []
            if include_display_entries:
                complete_entries = complete_entries_by_source_row.get(str(source_row)) or []
                interpreted_entries = [
                    entry
                    for entry in (sample.get("entries") or [])
                    if isinstance(entry, dict)
                ]
                source_entries = compose_interpreted_entries(
                    complete_entries,
                    occurrences,
                    interpreted_entries,
                ) if interpreted_entries else complete_entries
                if source_entries:
                    for entry_index, entry in enumerate(_display_review_entries(
                        source_entries,
                        config=config,
                    )):
                        source_entry = (
                            source_entries[entry_index]
                            if entry_index < len(source_entries)
                            else {}
                        )
                        entry_source_columns = {
                            clean(source_column)
                            for source_column in (entry.get("sourceColumns") or {}).values()
                            if clean(source_column)
                        }
                        matching_occurrence = next((
                            occurrence
                            for occurrence in occurrences
                            if clean(occurrence.get("sourceColumn")) in entry_source_columns
                        ), {})
                        source_pattern_key = clean(source_entry.get("patternKey"))
                        source_occurrence_id = clean(source_entry.get("occurrenceId"))
                        if source_pattern_key:
                            matching_occurrence = next((
                                occurrence
                                for occurrence in occurrences
                                if (
                                    clean(occurrence.get("patternKey")) == source_pattern_key
                                    and (
                                        not source_occurrence_id
                                        or clean(
                                            occurrence.get("occurrenceId")
                                            or occurrence.get("id")
                                        ) == source_occurrence_id
                                    )
                                )
                            ), matching_occurrence)
                        display_entries.append({
                            **entry,
                            "patternKey": source_pattern_key or clean(matching_occurrence.get("patternKey")),
                            "groupId": matching_occurrence.get("groupId") or "",
                            "occurrenceId": (
                                source_occurrence_id
                                or matching_occurrence.get("occurrenceId")
                                or matching_occurrence.get("id")
                                or ""
                            ),
                            "patternEntryIndex": source_entry.get("patternEntryIndex", entry_index),
                        })
                else:
                    for occurrence in occurrences:
                        occurrence_id = occurrence.get("occurrenceId") or occurrence.get("id") or ""
                        for pattern_entry_index, entry in enumerate(_display_review_entries(
                            occurrence.get("entries") or [],
                            config=config,
                        )):
                            display_entries.append({
                                **entry,
                                "patternKey": clean(occurrence.get("patternKey")),
                                "groupId": occurrence.get("groupId") or "",
                                "occurrenceId": occurrence_id,
                                "patternEntryIndex": pattern_entry_index,
                            })
                for entry_index, entry in enumerate(display_entries):
                    if clean(entry.get("relation")) != "Ignored":
                        entry["relation"] = "Primary" if entry_index == 0 else f"Alternate {entry_index}"
            review_row = {
                "id": f"review-row-{row_key}",
                "sourceRow": source_row,
                "left": sample.get("left") or [],
                "entryCount": len(display_entries) if include_display_entries else len(sample.get("entries") or []),
                "occurrences": occurrences,
                "patterns": row_patterns,
                "combinationId": combination.get("id") or "",
            }
            if include_display_entries:
                review_row["entries"] = display_entries
                review_row["visibleFieldKeys"] = _visible_review_field_keys(
                    display_entries,
                    sample.get("left") or [],
                    roles or {},
                )
                pairing_source_entries = complete_entries or [
                    entry
                    for occurrence in occurrences
                    for entry in occurrence.get("entries") or []
                    if isinstance(entry, dict)
                ]
                pairing_checks = [
                    entry.get("pairingCheck")
                    for entry in pairing_source_entries
                    if isinstance(entry.get("pairingCheck"), dict)
                ]
                manufacturer_mapped = bool(clean((roles or {}).get("manufacturer")))
                if pairing_checks:
                    mpn_count = sum(int(check.get("mpnCount") or 0) for check in pairing_checks)
                    manufacturer_count = sum(
                        int(check.get("manufacturerCount") or 0)
                        for check in pairing_checks
                    )
                else:
                    mpn_count = sum(
                        1 for entry in display_entries
                        if clean((entry.get("fields") or {}).get("mpn"))
                    )
                    manufacturer_count = sum(
                        1 for entry in display_entries
                        if clean((entry.get("fields") or {}).get("manufacturer"))
                    )
                has_pairing_mismatch = bool(
                    manufacturer_mapped and mpn_count != manufacturer_count
                )
                warning = (
                    f"{mpn_count} MPNs detected, {manufacturer_count} manufacturers detected. "
                    "Values were paired by position; unmatched values were left blank."
                    if has_pairing_mismatch
                    else ""
                )
                review_row.update({
                    "mpnCount": mpn_count,
                    "manufacturerCount": manufacturer_count,
                    "hasPairingMismatch": has_pairing_mismatch,
                    "warnings": ([{
                        "type": "mpn_mfr_count_mismatch",
                        "message": warning,
                    }] if warning else []),
                })
            current = rows_by_key.get(row_key)
            if current is None or review_row["entryCount"] > int(current.get("entryCount") or 0):
                rows_by_key[row_key] = review_row

    def row_sort_key(row):
        source_row = row.get("sourceRow")
        try:
            return (0, int(source_row), "")
        except (TypeError, ValueError):
            return (1, 0, str(source_row or ""))

    return sorted(rows_by_key.values(), key=row_sort_key)


def _apply_following_item_row_review_relations(
    review_rows,
    source_rows,
    headers,
    roles,
    config,
    header_row_index=0,
):
    """Number review identities across physical rows using the normalizer layout."""
    alternate_layout = clean(
        (config or {}).get("alternateLayout")
        or (config or {}).get("alternate_layout")
    )
    if alternate_layout != "following_item_rows":
        return review_rows

    review_rows_by_source = {}
    for review_row in review_rows or []:
        if isinstance(review_row, dict):
            review_rows_by_source.setdefault(
                str(review_row.get("sourceRow")),
                [],
            ).append(review_row)

    item_column = clean(
        (config or {}).get("followingItemRowsItemColumn")
        or (config or {}).get("following_item_rows_item_column")
        or (roles or {}).get("cpn")
    )
    context_column = clean(
        (config or {}).get("followingItemRowsContextColumn")
        or (config or {}).get("following_item_rows_context_column")
    )
    cpn_mode = clean(
        (config or {}).get("followingItemRowsCpnMode")
        or (config or {}).get("following_item_rows_cpn_mode")
        or "primary"
    )
    configured_inherit_fields = (config or {}).get("alternateInheritFields")
    if not isinstance(configured_inherit_fields, list):
        configured_inherit_fields = (config or {}).get("alternate_inherit_fields")
    inherit_fields = set(configured_inherit_fields or [])
    context_roles = (
        "cpn",
        "description",
        "quantity",
        "uom",
        "level",
        "parent",
        "notes",
        "internalNotes",
    )
    has_context = False
    emitted_identity_count = 0
    context_fields = {}
    context_source_columns = {}

    for index, source_row_data in enumerate(source_rows or []):
        source_row = _source_row_number(source_row_data, index, header_row_index)
        item_value = (
            _row_cell(source_row_data, item_column, headers)
            if item_column
            else ""
        )
        context_value = (
            _row_cell(source_row_data, context_column, headers)
            if context_column
            else ""
        )
        source_review_rows = review_rows_by_source.get(str(source_row), [])
        if clean(context_value or item_value):
            has_context = True
            emitted_identity_count = 0
            context_entry = next((
                entry
                for review_row in source_review_rows
                for entry in (review_row.get("entries") or [])
                if isinstance(entry, dict) and clean(entry.get("relation")) != "Ignored"
            ), {})
            context_fields = dict(context_entry.get("fields") or {})
            context_source_columns = dict(context_entry.get("sourceColumns") or {})

        for review_row in source_review_rows:
            identity_entries = [
                entry
                for entry in (review_row.get("entries") or [])
                if (
                    isinstance(entry, dict)
                    and clean(entry.get("relation")) != "Ignored"
                    and (
                        clean((entry.get("fields") or {}).get("mpn"))
                        or clean((entry.get("fields") or {}).get("manufacturer"))
                    )
                )
            ]
            if not identity_entries:
                continue

            for local_index, entry in enumerate(identity_entries):
                relation_index = (
                    emitted_identity_count
                    if has_context
                    else local_index
                )
                entry["relation"] = (
                    "Primary"
                    if relation_index == 0
                    else f"Alternate {relation_index}"
                )
                is_primary = relation_index == 0
                entry_fields = entry.setdefault("fields", {})
                entry_source_columns = entry.setdefault("sourceColumns", {})
                for role in context_roles:
                    should_inherit = is_primary or role in inherit_fields
                    if role == "cpn" and cpn_mode != "column":
                        should_inherit = True
                    context_field_value = context_fields.get(role)
                    if should_inherit and not is_blankish(context_field_value):
                        entry_fields[role] = context_field_value
                        context_source_column = clean(
                            context_source_columns.get(role)
                        )
                        if context_source_column:
                            entry_source_columns[role] = context_source_column
                if has_context:
                    emitted_identity_count += 1

    return review_rows


def _apply_same_group_row_review_relations(review_rows, config):
    """Group review rows only by the explicitly selected source column."""
    alternate_layout = clean(
        (config or {}).get("alternateLayout")
        or (config or {}).get("alternate_layout")
    )
    if alternate_layout != "same_group_rows":
        return review_rows

    group_key_header = clean(
        (config or {}).get("sameGroupKeyColumn")
        or (config or {}).get("same_group_key_column")
    )

    configured_inherit_fields = (config or {}).get("alternateInheritFields")
    if not isinstance(configured_inherit_fields, list):
        configured_inherit_fields = (config or {}).get("alternate_inherit_fields")
    inherit_fields = set(configured_inherit_fields or [])
    seen_by_group = {}
    primary_by_group = {}

    for review_row in review_rows or []:
        group_key = clean(next((
            item.get("value")
            for item in (review_row.get("left") or [])
            if isinstance(item, dict) and clean(item.get("column")) == group_key_header
        ), ""))
        for entry in review_row.get("entries") or []:
            if not isinstance(entry, dict) or clean(entry.get("relation")) == "Ignored":
                continue
            fields = entry.setdefault("fields", {})
            source_columns = entry.setdefault("sourceColumns", {})
            if not group_key:
                entry["relation"] = "Primary"
                continue

            group_index = seen_by_group.get(group_key, 0)
            entry["relation"] = (
                "Primary" if group_index == 0 else f"Alternate {group_index}"
            )
            if group_index == 0:
                primary_by_group[group_key] = {
                    "fields": dict(fields),
                    "sourceColumns": dict(source_columns),
                }
            else:
                primary = primary_by_group.get(group_key) or {}
                primary_fields = primary.get("fields") or {}
                primary_sources = primary.get("sourceColumns") or {}
                for role in inherit_fields:
                    primary_value = primary_fields.get(role)
                    if not is_blankish(primary_value):
                        fields[role] = primary_value
                        primary_source = clean(primary_sources.get(role))
                        if primary_source:
                            source_columns[role] = primary_source
            seen_by_group[group_key] = group_index + 1

    return review_rows


def _compact_review_group(group):
    compact = {
        key: value
        for key, value in (group or {}).items()
        if key not in {"interpretations", "occurrences", "rowEntries", "samples"}
    }
    if "recognitionValidation" in compact:
        compact["recognitionValidation"] = _compact_recognition_validation(
            compact.get("recognitionValidation")
        )
    samples = []
    for sample in list((group or {}).get("samples") or [])[:1]:
        if not isinstance(sample, dict):
            continue
        samples.append({
            **sample,
            "entries": _compact_review_entries(sample.get("entries") or []),
            "fields": {
                role: {
                    "value": (field.get("value") if isinstance(field, dict) else field) or "",
                    "sourceColumn": (field.get("sourceColumn") if isinstance(field, dict) else "") or "",
                }
                for role, field in (sample.get("fields") or {}).items()
            },
        })
    compact["samples"] = samples
    return compact


def _compact_review_workflow(workflow):
    compact_steps = []
    for step in (workflow or {}).get("steps") or []:
        if not isinstance(step, dict):
            continue
        compact_step = dict(step)
        if "recognitionValidation" in compact_step:
            compact_step["recognitionValidation"] = _compact_recognition_validation(
                compact_step.get("recognitionValidation")
            )
        compact_step["occurrences"] = list(step.get("occurrences") or [])[:1]
        compact_step["interpretationRefs"] = list(step.get("interpretationRefs") or [])
        interpretation = step.get("interpretation")
        if isinstance(interpretation, dict):
            compact_step["interpretation"] = {
                **interpretation,
                "entries": _compact_review_entries(interpretation.get("entries") or []),
            }
        compact_steps.append(compact_step)

    compact = dict(workflow or {})
    compact["steps"] = compact_steps
    next_step_id = clean(((workflow or {}).get("nextStep") or {}).get("id"))
    compact["nextStep"] = next(
        (step for step in compact_steps if clean(step.get("id")) == next_step_id),
        None,
    )
    return compact


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
        if item.get("automaticUnclassified") and item.get("recognized"):
            continue
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
            "pattern": item.get("interpretationPattern") or item.get("grammar") or "",
            "hasAlternateList": bool(item.get("hasAlternateList")),
            "patternNumberForColumn": pattern_number,
            "patternCountForColumn": len(semantic_patterns),
            "groupIds": item.get("groupIds") or [],
            "occurrences": item.get("occurrences") or [],
            "occurrenceCount": item.get("occurrenceCount") or 0,
            "storedInterpretation": item.get("storedInterpretation"),
            "draftInterpretation": item.get("draftInterpretation"),
            "recognized": bool(item.get("recognized")),
            "recognitionValidation": item.get("recognitionValidation") or {},
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
            shared_identity_units=shared_units,
        )
        if split_step:
            steps.append(split_step)

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
        "directNormalize": False,
    }


def build_bom_field_pattern_groups(headers, rows, roles=None, config=None, selected_columns=None, options=None):
    """Build backend-owned field interpretation groups for the teach popup."""
    started_at = perf_counter()
    options = options or {}
    _require_valid_bom_setup(headers, roles, config)
    try:
        review_contract_version = int(
            options.get("reviewContractVersion")
            or options.get("review_contract_version")
            or 2
        )
    except (TypeError, ValueError):
        review_contract_version = 2
    safe_headers = [clean(header) for header in (headers or [])]
    safe_rows = rows if isinstance(rows, list) else []
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    safe_rows, block_structure = _prepare_backend_bom_rows(
        safe_headers,
        safe_rows,
        roles=safe_roles,
        config=config,
        header_row_index=int((options or {}).get("headerRowIndex") or 0),
    )
    customer_columns = _selected_customer_columns(
        safe_headers,
        safe_roles,
        selected_columns,
        config=config,
    )
    include_all_rows = bool(options.get("includeAllRows") or options.get("include_all_rows"))

    try:
        default_max_rows = len(safe_rows) if include_all_rows else 500
        max_rows = int(options.get("maxRows") or options.get("max_rows") or default_max_rows)
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
    prime_mpn_lookup([
        _row_cell(row, header, safe_headers)
        for row in safe_rows[:max_rows]
        for header in customer_columns
        if not is_blankish(_row_cell(row, header, safe_headers))
    ])
    groups_by_shape = {}
    for index, row in enumerate(safe_rows[:max_rows]):
        source_display_row = row.get("__sourceValues") if isinstance(row, dict) else None
        source_display_row = source_display_row if isinstance(source_display_row, dict) else row
        left_values = [
            {"column": header, "value": _row_cell(source_display_row, header, safe_headers)}
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
    structure_scope = _bom_pattern_structure_scope(safe_headers, safe_roles, config)
    saved_rules = load_saved_bom_field_pattern_rules(structure_scope["signature"])

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
        saved_rule_scope = clean(saved_rule.get("matchedLibraryScope"))
        if saved_rule_scope == "global":
            saved_rule = _global_rule_for_current_roles(saved_rule, safe_roles)
        user_rule = _confirmed_request_rule_for_roles(
            _pattern_rule_for_shape(options, shape),
            safe_roles,
        )
        active_rule = _merge_pattern_rules(_merge_pattern_rules(discovered_rule, saved_rule), user_rule)
        active_rule["shape"] = shape
        active_rule["structureScope"] = structure_scope
        active_rule["structureSignature"] = structure_scope["signature"]
        group["suggestedRule"] = active_rule
        if saved_rule:
            group["matchedSavedRule"] = True
            group["matchedSavedRuleScope"] = saved_rule_scope or "structure"
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
        group["controls"] = _field_pattern_control_state(group.get("suggestedRule") or {})

    semantic_patterns = _build_semantic_review_patterns(
        safe_headers,
        safe_roles,
        config or {},
        groups,
        options=options,
    )
    ignored_semantic_source_rows = {
        occurrence.get("sourceRow")
        for pattern in semantic_patterns
        if pattern.get("ignored")
        for occurrence in (pattern.get("occurrences") or [])
        if occurrence.get("sourceRow") is not None
    }
    semantic_patterns = [
        pattern for pattern in semantic_patterns
        if not pattern.get("ignored")
    ]
    pattern_combinations = _build_pattern_combinations(safe_headers, semantic_patterns)
    semantic_source_rows = ignored_semantic_source_rows | {
        sample.get("sourceRow")
        for combination in pattern_combinations
        for sample in (combination.get("samples") or [])
        if sample.get("sourceRow") is not None
    }
    semantic_source_row_keys = {str(item) for item in semantic_source_rows}
    if include_all_rows:
        # Semantic combinations contain only rows with a teachable fragment.
        # Parse the remaining source rows once so Review All Rows stays complete.
        for group in groups:
            group["rowEntries"] = {}
            active_rule = group.get("suggestedRule") or {"fields": {}}
            row_config = _config_with_active_rule(config, active_rule)
            for raw_sample in group.get("_rawSamples") or []:
                row = raw_sample.get("row")
                source_row = raw_sample.get("sourceRow")
                if source_row in ignored_semantic_source_rows:
                    continue
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
        pattern_combinations.extend(_build_direct_review_combinations(
            groups,
            excluded_source_rows=semantic_source_rows,
        ))
    review_summary = _build_pattern_review_summary(
        semantic_patterns,
        pattern_combinations,
    )
    review_rows = _build_flat_pattern_review_rows(
        semantic_patterns,
        pattern_combinations,
        groups=groups,
        roles=safe_roles,
        config=config,
        include_display_entries=review_contract_version >= 3,
    )
    review_rows = _apply_following_item_row_review_relations(
        review_rows,
        safe_rows,
        safe_headers,
        safe_roles,
        config or {},
        header_row_index=int(options.get("headerRowIndex") or 0),
    )
    review_rows = _apply_same_group_row_review_relations(
        review_rows,
        config or {},
    )
    public_pattern_combinations = []
    for combination in pattern_combinations:
        public_pattern_combinations.append({
            key: value
            for key, value in combination.items()
            if key != "samples"
        })

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

    public_groups = [_compact_review_group(group) for group in groups]
    public_patterns = [_compact_review_group(pattern) for pattern in semantic_patterns]
    public_review_workflow = _compact_review_workflow(review_workflow)
    requested_rules = options.get("fieldPatternRules") or options.get("field_pattern_rules") or {}
    active_rules = dict(requested_rules) if isinstance(requested_rules, dict) else {}
    for group in groups:
        rule_key = clean(group.get("patternKey") or group.get("shape"))
        if rule_key and isinstance(group.get("suggestedRule"), dict):
            active_rules[rule_key] = group["suggestedRule"]
    review_contract = None
    if review_contract_version >= 3:
        review_groups = semantic_patterns if semantic_patterns else groups
        review_contract = _build_backend_review_contract(
            review_summary,
            semantic_patterns,
            review_groups,
            review_rows,
            public_review_workflow,
            safe_roles,
            config or {},
            safe_headers,
            active_rules,
        )
    public_row_shape_groups = [
        {
            key: group.get(key)
            for key in ("id", "title", "shape", "patternKey", "rowCount")
            if group.get(key) is not None
        }
        for group in groups
    ]

    response = {
        "source": "backend",
        "selectedColumns": customer_columns,
        "groupCount": len(groups),
        "patternCount": len(semantic_patterns),
        "combinationCount": len(pattern_combinations),
        "reviewRowCount": len(review_rows),
        "sampleRowCount": sum(len(group["samples"]) for group in groups),
        "config": config or {},
        "blockStructure": block_structure,
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
    if review_contract_version >= 3:
        response["review"] = review_contract
    else:
        response.update({
            "fields": [
                {"key": key, "label": label, "required": key == "mpn"}
                for key, label in FACTWISE_FIELD_LABELS.items()
            ],
            "groups": public_groups,
            "rowShapeGroups": public_row_shape_groups,
            "patterns": public_patterns,
            "patternCombinations": public_pattern_combinations,
            "reviewRows": review_rows,
            "reviewSummary": review_summary,
            "reviewWorkflow": public_review_workflow,
        })
    return response


def refresh_bom_field_pattern_review_after_teach(
    review,
    teach_result,
    *,
    group=None,
    roles=None,
    config=None,
    active_rules=None,
    source_row=None,
    occurrence_id="",
    completed_step_id="",
    taught_source_value="",
):
    """Refresh one taught semantic pattern without repeating pattern discovery."""
    if not isinstance(review, dict) or int(review.get("contractVersion") or 0) < 3:
        return None

    group = group if isinstance(group, dict) else {}
    roles = roles if isinstance(roles, dict) else {}
    config = config if isinstance(config, dict) else {}
    teach_result = teach_result if isinstance(teach_result, dict) else {}
    rule = teach_result.get("rule") if isinstance(teach_result.get("rule"), dict) else {}
    pattern_key = clean(
        group.get("patternKey")
        or rule.get("patternKey")
        or group.get("shape")
        or rule.get("shape")
    )
    if not pattern_key or not rule:
        return None

    refreshed = deepcopy(review)
    refreshed["activeRules"] = dict(active_rules or {})
    source_header = clean(
        (teach_result.get("visualPattern") or {}).get("sourceHeader")
        or (teach_result.get("visualPattern") or {}).get("source_header")
    )
    pattern_record = next((
        pattern for pattern in refreshed.get("patterns") or []
        if isinstance(pattern, dict) and clean(pattern.get("patternKey")) == pattern_key
    ), {})
    if not source_header:
        source_header = clean(
            pattern_record.get("sourceColumn")
            or group.get("sourceColumn")
            or group.get("source_column")
        )
    mapped_fields = list(
        pattern_record.get("mappedFields")
        or teach_result.get("mappedFields")
        or [role for role in ROLE_KEYS if source_header and clean(roles.get(role)) == source_header]
    )
    if not source_header:
        mapped_headers = {
            clean(roles.get(role))
            for role in mapped_fields
            if clean(roles.get(role))
        }
        if len(mapped_headers) == 1:
            source_header = mapped_headers.pop()
    group_id = clean(pattern_record.get("groupId") or group.get("id"))
    taught_entries = teach_result.get("entries") if isinstance(teach_result.get("entries"), list) else []
    taught_source_value = str(taught_source_value or "")
    taught_spans = teach_result.get("interpretationSpansByColumn") or {}
    refreshed_interpretations = []

    parse_config = dict(config)
    for key in (
        "semanticPatternRules",
        "semantic_pattern_rules",
        "fieldPatternRules",
        "field_pattern_rules",
        "_activeFieldPatternRule",
        "_active_field_pattern_rule",
    ):
        parse_config.pop(key, None)
    parse_config["_semanticPatternPass"] = True
    parse_config = _config_with_active_rule(
        parse_config,
        _semantic_rule_for_source(rule, source_header),
    )

    for review_row in refreshed.get("rows") or []:
        if not isinstance(review_row, dict):
            continue
        row_patterns = review_row.get("patterns") or []
        if not any(
            isinstance(item, dict) and clean(item.get("patternKey")) == pattern_key
            for item in row_patterns
        ):
            continue

        reconstructed_row = {
            clean(item.get("column")): item.get("value") or ""
            for item in review_row.get("left") or []
            if isinstance(item, dict) and clean(item.get("column"))
        }
        review_source_row = review_row.get("sourceRow")
        reconstructed_row["__sourceRow"] = review_source_row
        source_value = str(reconstructed_row.get(source_header) or "")
        matching_fragments = [
            {
                "id": clean(occurrence.get("occurrenceId") or occurrence.get("id")),
                "start": int(occurrence.get("start") or 0),
                "end": int(occurrence.get("end") or 0),
                "rawValue": occurrence.get("rawValue") or "",
                "grammar": occurrence.get("pattern") or pattern_record.get("pattern") or "",
            }
            for occurrence in review_row.get("occurrences") or []
            if (
                isinstance(occurrence, dict)
                and clean(occurrence.get("patternKey")) == pattern_key
            )
        ]
        if not matching_fragments:
            for fragment in _semantic_identity_fragments(source_value, mapped_fields):
                fragment_key = _semantic_pattern_key(
                    source_header,
                    mapped_fields,
                    fragment.get("grammar"),
                )
                if fragment_key == pattern_key:
                    matching_fragments.append(fragment)

        existing_entries = [
            entry for entry in (review_row.get("entries") or [])
            if isinstance(entry, dict)
        ]
        target_indexes = [
            index for index, entry in enumerate(existing_entries)
            if clean(entry.get("patternKey")) == pattern_key
        ]
        insert_at = min(target_indexes) if target_indexes else len(existing_entries)
        retained_entries = [
            entry for entry in existing_entries
            if clean(entry.get("patternKey")) != pattern_key
        ]
        generated_entries = []
        if not matching_fragments and target_indexes and not _field_pattern_rule_excludes_row(rule):
            # Review contracts opened before occurrence metadata was added cannot
            # replay multiline cells from their whitespace-normalized preview.
            # Keep their backend-generated rows and validate the occurrence the
            # user explicitly confirmed instead of erasing the whole pattern.
            generated_entries = [
                deepcopy(existing_entries[index])
                for index in target_indexes
            ]
            if str(review_source_row) == str(source_row) and taught_spans.get(source_header):
                refreshed_interpretations.append({
                    "occurrenceId": clean(occurrence_id),
                    "sourceRow": review_source_row,
                    "interpretationSpans": taught_spans.get(source_header) or [],
                    "ruleFallbackUsed": False,
                    "entries": generated_entries,
                })
        for fragment in matching_fragments:
            start = int(fragment.get("start") or 0)
            end = int(fragment.get("end") or 0)
            generated_occurrence_id = clean(fragment.get("id")) or hashlib.sha256(
                (
                    f"{pattern_key}|{review_source_row}|{source_header}|"
                    f"{start}|{end}"
                ).encode("utf-8")
            ).hexdigest()[:20]
            fragment_value = str(fragment.get("rawValue") or "")
            fragment_row = dict(reconstructed_row)
            fragment_row[source_header] = fragment_value
            is_taught_occurrence = (
                str(review_source_row) == str(source_row)
                and (
                    (occurrence_id and generated_occurrence_id == clean(occurrence_id))
                    or (taught_source_value and fragment_value == taught_source_value)
                )
            )
            if is_taught_occurrence:
                interpreted_entries = taught_entries
                interpretation_spans = taught_spans.get(source_header) or []
                rule_fallback_used = False
            else:
                interpreted_entries = _infer_field_entries_for_row(
                    fragment_row,
                    list(reconstructed_row.keys()),
                    roles,
                    [source_header],
                    config=parse_config,
                )
                rule_fallback_used = False
                interpretation_spans = _interpretation_spans_by_column(
                    fragment_row,
                    list(reconstructed_row.keys()),
                    [source_header],
                    {} if rule_fallback_used else rule,
                    interpreted_entries,
                ).get(source_header) or []
            base_fragment_entries = [
                entry
                for entry in existing_entries
                if (
                    clean(entry.get("patternKey")) == pattern_key
                    and clean(entry.get("occurrenceId")) == generated_occurrence_id
                )
            ]
            interpreted_entries = _merge_confirmed_pattern_entries(
                base_fragment_entries,
                interpreted_entries,
                rule,
            )
            refreshed_interpretations.append({
                "occurrenceId": generated_occurrence_id,
                "sourceRow": review_source_row,
                "interpretationSpans": interpretation_spans,
                "ruleFallbackUsed": rule_fallback_used,
                "replayNeedsReview": any(
                    bool(entry.get("needsReview"))
                    for entry in interpreted_entries
                    if isinstance(entry, dict)
                ),
                "entries": interpreted_entries,
            })
            for occurrence in review_row.get("occurrences") or []:
                if (
                    isinstance(occurrence, dict)
                    and clean(occurrence.get("patternKey")) == pattern_key
                    and clean(occurrence.get("occurrenceId") or occurrence.get("id")) == generated_occurrence_id
                ):
                    occurrence["interpretationSpans"] = interpretation_spans
            for pattern_entry_index, entry in enumerate(_display_review_entries(
                interpreted_entries,
                config=config,
            )):
                generated_entries.append({
                    **entry,
                    "patternKey": pattern_key,
                    "groupId": group_id,
                    "occurrenceId": generated_occurrence_id,
                    "patternEntryIndex": pattern_entry_index,
                })

        merged_entries = (
            retained_entries[:insert_at]
            + generated_entries
            + retained_entries[insert_at:]
        )
        if _field_pattern_rule_ignores_fields(rule):
            if target_indexes or len(existing_entries) > 1:
                merged_entries = retained_entries + generated_entries[:1]
            else:
                merged_entries = generated_entries[:1] or retained_entries
        for entry_index, entry in enumerate(merged_entries):
            if clean(entry.get("relation")) != "Ignored":
                entry["relation"] = "Primary" if entry_index == 0 else f"Alternate {entry_index}"
        review_row["entries"] = merged_entries
        review_row["entryCount"] = len(merged_entries)
        review_row["visibleFieldKeys"] = _visible_review_field_keys(
            merged_entries,
            review_row.get("left") or [],
            roles,
        )
        for row_pattern in row_patterns:
            if isinstance(row_pattern, dict) and clean(row_pattern.get("patternKey")) == pattern_key:
                row_pattern["recognitionScope"] = "session"

    compact_taught_entries = _compact_review_entries(taught_entries)
    confirmed_visual_pattern = (
        teach_result.get("visualPattern")
        or rule.get("visualPattern")
        or rule.get("visual_pattern")
        or {}
    )
    confirmed_pattern = (
        _visual_pattern_display_pattern(
            confirmed_visual_pattern,
            taught_source_value,
        )
        or clean(pattern_record.get("pattern"))
    )
    group_replay_validation = _semantic_interpretation_coverage(
        confirmed_pattern,
        mapped_fields,
        rule,
        refreshed_interpretations,
    )
    confirmed_interpretations = []
    if taught_spans.get(source_header):
        confirmed_interpretations.append({
            "occurrenceId": clean(occurrence_id),
            "sourceRow": source_row,
            "interpretationSpans": taught_spans.get(source_header) or [],
            "entries": taught_entries,
            "ruleFallbackUsed": False,
        })
    confirmed_validation = _semantic_interpretation_coverage(
        confirmed_pattern,
        mapped_fields,
        rule,
        confirmed_interpretations,
    )
    mpn_validation = _validate_semantic_pattern_mpns([{
        "patternKey": pattern_key,
        "mappedFields": mapped_fields,
        "interpretations": refreshed_interpretations,
    }]).get(pattern_key) or {"applicable": False, "valid": True}
    ignores_fields = _field_pattern_rule_ignores_fields(rule)
    if ignores_fields:
        mpn_validation = {
            "applicable": False,
            "valid": True,
            "ignored": True,
            "threshold": MPN_RECOGNITION_SIMILARITY_THRESHOLD,
            "generatedMpnCount": 0,
            "matchedMpnCount": 0,
            "matches": [],
            "failures": [],
            "reasons": [],
            "reason": "",
        }
    # Replaying one reusable rule can be ambiguous for individual occurrences,
    # but that must never revoke the user's explicit confirmation. Surface the
    # replay failures separately while keeping the taught pattern recognized.
    interpretation_is_recognized = True
    if interpretation_is_recognized and not mpn_validation.get("valid"):
        mpn_validation = {
            **mpn_validation,
            "acceptedByUser": True,
            "advisoryOnly": True,
        }
    recognition_validation = {
        **group_replay_validation,
        "valid": True,
        "userConfirmed": True,
        "confirmedOccurrenceValid": bool(confirmed_validation.get("valid")),
        "groupReplayValid": bool(group_replay_validation.get("valid")),
        "replayNeedsReview": not bool(group_replay_validation.get("valid")),
        "mpnValidation": mpn_validation,
    }
    if not group_replay_validation.get("valid"):
        recognition_validation["reason"] = "incomplete_grammar_coverage"
    elif not mpn_validation.get("valid"):
        recognition_validation["warning"] = (
            mpn_validation.get("reason") or "mpn_not_verified"
        )
    for review_row in refreshed.get("rows") or []:
        for row_pattern in review_row.get("patterns") or [] if isinstance(review_row, dict) else []:
            if isinstance(row_pattern, dict) and clean(row_pattern.get("patternKey")) == pattern_key:
                row_pattern["recognized"] = interpretation_is_recognized
                row_pattern["pattern"] = confirmed_pattern
                row_pattern["recognitionValidation"] = _compact_recognition_validation(
                    recognition_validation
                )
    for pattern in refreshed.get("patterns") or []:
        if not isinstance(pattern, dict) or clean(pattern.get("patternKey")) != pattern_key:
            continue
        pattern.update({
            "recognized": interpretation_is_recognized,
            "status": "recognized" if interpretation_is_recognized else "unrecognized",
            "statusLabel": "Recognized" if interpretation_is_recognized else "Needs review",
            "recognitionScope": "session",
            "recognitionValidation": recognition_validation,
            "draftInterpretation": {"rule": rule},
            "pattern": confirmed_pattern,
            "detectedPattern": pattern.get("detectedPattern") or pattern.get("pattern") or "",
            "controls": teach_result.get("controls") or _field_pattern_control_state(rule),
        })
        teach_context = pattern.get("teachContext")
        if isinstance(teach_context, dict):
            teach_context["controls"] = teach_result.get("controls") or _field_pattern_control_state(rule)
            sample = teach_context.get("sample")
            if isinstance(sample, dict) and str(sample.get("sourceRow")) == str(source_row):
                sample["entries"] = compact_taught_entries
                sample["fields"] = compact_taught_entries[0].get("fields", {}) if compact_taught_entries else {}
                sample["interpretationSpansByColumn"] = taught_spans

    for review_group in refreshed.get("groups") or []:
        if not isinstance(review_group, dict):
            continue
        if not (
            clean(review_group.get("patternKey")) == pattern_key
            or (group_id and clean(review_group.get("id")) == group_id)
        ):
            continue
        review_group["suggestedRule"] = rule
        review_group["controls"] = teach_result.get("controls") or _field_pattern_control_state(rule)
        review_group["recognized"] = interpretation_is_recognized
        review_group["interpretationPattern"] = confirmed_pattern
        review_group["recognitionValidation"] = _compact_recognition_validation(
            recognition_validation
        )
        review_group["recognitionScope"] = "session"
        for sample in review_group.get("samples") or []:
            if isinstance(sample, dict) and str(sample.get("sourceRow")) == str(source_row):
                sample["entries"] = compact_taught_entries
                sample["fields"] = compact_taught_entries[0].get("fields", {}) if compact_taught_entries else {}
                sample["interpretationSpansByColumn"] = taught_spans

    patterns = [
        pattern for pattern in refreshed.get("patterns") or []
        if isinstance(pattern, dict)
    ]
    refreshed["patternsByField"] = {
        "all": patterns,
        **{
            option.get("key"): [
                pattern for pattern in patterns
                if option.get("key") in (pattern.get("mappedFields") or [])
            ]
            for option in refreshed.get("mappedFieldOptions") or []
            if isinstance(option, dict) and clean(option.get("key"))
        },
    }
    recognized_count = sum(1 for pattern in patterns if pattern.get("recognized"))
    summary = dict(refreshed.get("summary") or {})
    summary["patternCount"] = len(patterns)
    summary["recognizedPatternCount"] = recognized_count
    summary["unrecognizedPatternCount"] = max(0, len(patterns) - recognized_count)
    summary["itemCount"] = sum(int(row.get("entryCount") or 0) for row in refreshed.get("rows") or [])
    refreshed["summary"] = summary
    refreshed["recognizedPatternKeys"] = sorted(
        clean(pattern.get("patternKey"))
        for pattern in patterns
        if pattern.get("recognized") and clean(pattern.get("patternKey"))
    )

    workflow = refreshed.get("workflow") if isinstance(refreshed.get("workflow"), dict) else {}
    completed_ids = {
        clean(step_id)
        for step_id in workflow.get("completedStepIds") or []
        if clean(step_id)
    }
    if completed_step_id and interpretation_is_recognized:
        completed_ids.add(clean(completed_step_id))
    elif completed_step_id:
        completed_ids.discard(clean(completed_step_id))
    for step in workflow.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if clean(step.get("patternKey")) == pattern_key:
            step["storedInterpretation"] = {"rule": rule}
            step["draftInterpretation"] = {"rule": rule}
            step["pattern"] = confirmed_pattern
            step["recognized"] = interpretation_is_recognized
            step["controls"] = teach_result.get("controls") or _field_pattern_control_state(rule)
            step["recognitionValidation"] = _compact_recognition_validation(
                recognition_validation
            )
            if not interpretation_is_recognized:
                completed_ids.discard(clean(step.get("id")))
        step["completed"] = clean(step.get("id")) in completed_ids
    workflow["completedStepIds"] = sorted(completed_ids)
    workflow["nextStep"] = next((
        step for step in workflow.get("steps") or []
        if isinstance(step, dict) and not step.get("completed")
    ), None)
    refreshed["workflow"] = workflow
    return _sync_review_display_rows(refreshed)


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


def _normalize_same_group_rows(normalized_rows, config):
    """Assign relations using only the selected group-key column's values."""
    configured_inherit_fields = (config or {}).get("alternateInheritFields")
    if not isinstance(configured_inherit_fields, list):
        configured_inherit_fields = (config or {}).get("alternate_inherit_fields")
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
    seen_by_group = {}
    primary_by_group = {}
    output = []

    for row in normalized_rows or []:
        grouped = dict(row)
        group_key = clean(grouped.get("parentKey"))
        if not group_key:
            grouped["parentKey"] = str(grouped.get("sourceRow") or "")
            grouped["relation"] = "Primary"
            output.append(grouped)
            continue

        group_index = seen_by_group.get(group_key, 0)
        grouped["parentKey"] = group_key
        grouped["relation"] = (
            "Primary" if group_index == 0 else f"Alternate {group_index}"
        )
        grouped["rule"] = "same_group_rows"
        if group_index == 0:
            primary_by_group[group_key] = dict(grouped)
        else:
            primary = primary_by_group.get(group_key) or {}
            for role, output_field in output_field_by_role.items():
                primary_value = primary.get(output_field)
                if role in inherit_fields and not is_blankish(primary_value):
                    grouped[output_field] = primary_value
        seen_by_group[group_key] = group_index + 1
        output.append(grouped)

    return output


def _apply_parent_path_hierarchy(normalized_rows, config):
    """Read each row's own code and depth out of its parent path.

    A parent column may hold a whole trail (``>E49831AAAPB>J89822AA``) rather
    than a parent code. Read only for the parent, the trail still answers two
    questions the sheet's own columns get wrong: its depth is the row's BOM
    level, and its last segment is the row's own part number.

    That matters because THALES numbers a document by the part it belongs to, so
    dozens of drawings arrive sharing one CPN - the CPN of their own parent.
    Each then states itself as its own parent, and because they are the only
    rows carrying the top assembly's code, excluding them as documents deletes
    the root and every path running through it dangles.

    This is the backend half of the page's "Read levels and part numbers from
    the parent path" switch. It existed only in the browser, so rows normalised
    server-side - which is every row the agent produces - never got it.
    """
    from ..bom_tree import PATH_SEPARATORS, PATH_UNRESOLVED_TOLERANCE

    stated = [row for row in normalized_rows or [] if clean(row.get("parent"))]
    if not stated:
        return normalized_rows

    known = {clean(row.get("cpn")) for row in normalized_rows if clean(row.get("cpn"))}
    tolerance = len(stated) * PATH_UNRESOLVED_TOLERANCE

    def score(derive):
        """Edge count for one reading, or None if too much of it dangles."""
        edges = 0
        unresolved = 0
        for row in stated:
            parent = derive(row)
            # A row that is its own parent is a root: correct, but it says
            # nothing about structure, so it must not be scored as an edge.
            # Without this, reading a row's own trail as its parent's scores
            # perfectly and yields a tree of roots.
            if not parent or parent == clean(row.get("cpn")):
                continue
            if parent not in known:
                unresolved += 1
                if unresolved > tolerance:
                    return None
                continue
            edges += 1
        return edges

    def split(row, separator):
        return [segment.strip()
                for segment in clean(row.get("parent")).split(separator)
                if segment.strip()]

    baseline = score(lambda row: clean(row.get("parent")))
    if baseline is not None and baseline == len(stated):
        return normalized_rows  # already plain codes

    best = None
    for separator in PATH_SEPARATORS:
        if not any(separator in clean(row.get("parent")) for row in stated):
            continue
        for take_leaf in (False, True):
            def derive(row, separator=separator, take_leaf=take_leaf):
                segments = split(row, separator)
                if not segments:
                    return ""
                if take_leaf:
                    return segments[-1]
                return segments[-2] if len(segments) > 1 else ""

            edges = score(derive)
            if edges is None:
                continue
            if best is None or edges > best[0]:
                best = (edges, separator, take_leaf)

    if not best or best[0] <= (baseline or 0):
        return normalized_rows

    _edges, separator, take_leaf = best
    parsed = [(row, split(row, separator)) for row in stated]

    # Turning a path into a parent code is always safe: as it stands the value
    # matches no row at all.
    for row, segments in parsed:
        if not segments:
            continue
        row["parent"] = (segments[-1] if take_leaf
                         else (segments[-2] if len(segments) > 1 else ""))

    # Only a row's OWN trail states its depth and its own part number. A path
    # that names the parent says nothing about either.
    if take_leaf or (config or {}).get("parentPathLevels") is False:
        return normalized_rows

    for row, segments in parsed:
        if not segments:
            continue
        row["level"] = str(len(segments))
        stated_code = clean(row.get("cpn"))
        stated_parent = segments[-2] if len(segments) > 1 else ""
        # Fill what the sheet left empty, and overrule a code that names this
        # row's own parent - nothing is its own parent, so such a code is not
        # this row's identity. Any OTHER disagreement stands: the sheet stated
        # it, and overruling would silently re-identify real parts on every
        # sheet that writes both a code and a path.
        if not stated_code or (stated_parent and stated_code == stated_parent):
            row["cpn"] = segments[-1]
    return normalized_rows


def _alternate_group_key(values, source_row, config=None, source_values=None, headers=None):
    """The key rows are grouped by when looking for alternates.

    ``following_item_rows`` is the one layout whose alternates live on separate
    rows, identified by sharing the primary's CPN; there the CPN is the group.
    Every other layout keeps a line's alternates in the line's own cell, so the
    source row is the group and two rows can carry the same part without being
    read as each other's alternate.
    """
    layout = clean((config or {}).get("alternateLayout")
                   or (config or {}).get("alternate_layout"))
    if layout == "following_item_rows":
        return values.get("cpn") or str(source_row)
    if layout == "same_group_rows":
        group_key_header = clean(
            (config or {}).get("sameGroupKeyColumn")
            or (config or {}).get("same_group_key_column")
        )
        group_key = (
            _row_cell(source_values, group_key_header, headers or [])
            if group_key_header
            else ""
        )
        return clean(group_key) or str(source_row)
    return str(source_row)


def normalize_bom_rows(headers, rows, roles=None, config=None):
    """Normalize all mapped BOM fields through the backend inference contract."""
    _require_valid_bom_setup(headers, roles, config)
    safe_headers = [clean(header) for header in (headers or [])]
    original_rows = rows if isinstance(rows, list) else []
    safe_roles = {role: clean((roles or {}).get(role)) for role in ROLE_KEYS}
    safe_config = config if isinstance(config, dict) else {}
    header_row_index = int(safe_config.get("headerRowIndex") or safe_config.get("header_row_index") or 0)
    safe_rows, block_structure = _prepare_backend_bom_rows(
        safe_headers,
        original_rows,
        roles=safe_roles,
        config=safe_config,
        header_row_index=header_row_index,
    )
    selected_columns = _selected_customer_columns(
        safe_headers,
        safe_roles,
        [],
        config=safe_config,
    )
    pattern_rules = safe_config.get("fieldPatternRules") or safe_config.get("field_pattern_rules") or {}
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
    alternate_only_review_rows = set()
    alternate_identity_headers = {
        clean(group.get(role))
        for group in _configured_alternate_column_groups(safe_config)
        for role in ("cpn", "mpn", "manufacturer")
        if clean(group.get(role))
    }
    for group in result.get("groups") or []:
        for source_row, row_result in (group.get("rowEntries") or {}).items():
            entries_by_source_row[str(source_row)] = row_result.get("entries") or []
    for review_row in result.get("reviewRows") or []:
        source_row = review_row.get("sourceRow")
        primary_identity_headers = {
            clean(safe_roles.get(role))
            for role in ("cpn", "mpn", "manufacturer")
            if clean(safe_roles.get(role))
        }
        has_primary_occurrence = any(
            clean(occurrence.get("sourceColumn")) in primary_identity_headers
            for occurrence in review_row.get("occurrences") or []
            if isinstance(occurrence, dict)
        )
        has_alternate_occurrence = any(
            clean(occurrence.get("sourceColumn")) in alternate_identity_headers
            for occurrence in review_row.get("occurrences") or []
            if isinstance(occurrence, dict)
        )
        row_entries = [
            {
                **entry,
                "_occurrenceId": clean(
                    occurrence.get("occurrenceId") or occurrence.get("id")
                ),
                "_patternKey": clean(occurrence.get("patternKey")),
            }
            for occurrence in review_row.get("occurrences") or []
            if isinstance(occurrence, dict)
            for entry in occurrence.get("entries") or []
            if isinstance(entry, dict)
        ]
        if row_entries and has_alternate_occurrence and not has_primary_occurrence:
            alternate_only_review_rows.add(str(source_row))
        if row_entries and (
            has_primary_occurrence
            or str(source_row) not in entries_by_source_row
        ):
            entries_by_source_row[str(source_row)] = [
                {
                    **entry,
                    "relation": clean(entry.get("relation"))
                    or ("Primary" if index == 0 else f"Alternate {index}"),
                }
                for index, entry in enumerate(row_entries)
            ]

    confirmed_rows = (
        ((safe_config.get("fieldPatternOverrides") or {}).get("rows") or {})
        if isinstance(safe_config.get("fieldPatternOverrides"), dict)
        else {}
    )
    override_source = clean(
        (safe_config.get("fieldPatternOverrides") or {}).get("source")
        if isinstance(safe_config.get("fieldPatternOverrides"), dict)
        else ""
    )
    if _semantic_pattern_rules(safe_config) and override_source != "backend_user_corrections":
        confirmed_rows = {}
    normalized_rows = []
    skipped_rows = int(block_structure.get("skippedRowCount") or 0)
    consumed_headers = {header for header in safe_roles.values() if header}
    for index, row in enumerate(safe_rows):
        source_row = _source_row_number(row, index, header_row_index)
        if not any(not is_blankish(_row_cell(row, header, safe_headers)) for header in safe_headers):
            skipped_rows += 1
            continue
        override = confirmed_rows.get(str(source_row)) if isinstance(confirmed_rows, dict) else None
        row_shape = _pattern_shape_for_row(
            row,
            safe_headers,
            safe_roles,
            selected_columns,
            config=safe_config,
        )
        row_rule = _pattern_rule_for_shape(
            {"fieldPatternRules": pattern_rules},
            row_shape,
        )
        occurrence_overrides = (
            override.get("occurrences")
            if isinstance(override, dict)
            and isinstance(override.get("occurrences"), list)
            else []
        )
        reviewed_entries = entries_by_source_row.get(str(source_row)) or []
        if occurrence_overrides and reviewed_entries:
            # Occurrence IDs come from the semantic review result. Keep that
            # complete ordered row as the merge base so confirming one
            # fragment cannot replace or duplicate its siblings.
            entries = reviewed_entries
        elif row_rule:
            entries = _infer_field_entries_for_row(
                row,
                safe_headers,
                safe_roles,
                selected_columns,
                config=_config_with_active_rule(safe_config, row_rule),
            )
        elif str(source_row) in alternate_only_review_rows:
            # Alternate-column occurrence previews contain only that source
            # fragment. Parse the complete row so its primary and every
            # sibling alternate group remain present in normalized output.
            entries = _infer_field_entries_for_row(
                row,
                safe_headers,
                safe_roles,
                selected_columns,
                config=safe_config,
            )
        else:
            entries = reviewed_entries
        if not entries:
            entries = _infer_field_entries_for_row(
                row,
                safe_headers,
                safe_roles,
                selected_columns,
                config=safe_config,
            )
        if isinstance(override, dict):
            if isinstance(occurrence_overrides, list) and occurrence_overrides:
                overrides_by_occurrence = {
                    clean(item.get("occurrenceId")): item
                    for item in occurrence_overrides
                    if isinstance(item, dict) and clean(item.get("occurrenceId"))
                }
                merged_entries = []
                consumed_occurrences = set()

                def corrected_entries(occurrence_override, occurrence_id, base_entries):
                    corrected = _merge_confirmed_pattern_entries(
                        base_entries,
                        occurrence_override.get("entries") or [],
                        occurrence_override.get("rule") or {},
                    )
                    for corrected_entry in corrected:
                        corrected_fields = corrected_entry.get("fields") or {}
                        relation = clean(corrected_entry.get("relation"))
                        has_value = any(
                            not is_blankish(
                                field.get("value") if isinstance(field, dict) else field
                            )
                            for field in corrected_fields.values()
                        ) if isinstance(corrected_fields, dict) else False
                        if not has_value and relation != "Ignored":
                            continue
                        yield {
                            **corrected_entry,
                            "_occurrenceId": occurrence_id,
                            "_patternKey": clean(occurrence_override.get("patternKey")),
                        }

                for entry in entries:
                    occurrence_id = clean(
                        entry.get("_occurrenceId") or entry.get("occurrenceId")
                    ) if isinstance(entry, dict) else ""
                    occurrence_override = overrides_by_occurrence.get(occurrence_id)
                    if not occurrence_override:
                        merged_entries.append(entry)
                        continue
                    if occurrence_id in consumed_occurrences:
                        continue
                    consumed_occurrences.add(occurrence_id)
                    base_occurrence_entries = [
                        candidate
                        for candidate in entries
                        if isinstance(candidate, dict)
                        and clean(candidate.get("_occurrenceId") or candidate.get("occurrenceId")) == occurrence_id
                    ]
                    merged_entries.extend(corrected_entries(
                        occurrence_override,
                        occurrence_id,
                        base_occurrence_entries,
                    ))
                for occurrence_id, occurrence_override in overrides_by_occurrence.items():
                    if occurrence_id in consumed_occurrences:
                        continue
                    merged_entries.extend(corrected_entries(
                        occurrence_override,
                        occurrence_id,
                        [],
                    ))
                entries = merged_entries
            elif isinstance(override.get("entries"), list) and override.get("entries"):
                entries = override.get("entries")

        non_ignored_index = 0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if clean(entry.get("relation")) == "Ignored":
                continue
            entry["relation"] = (
                "Primary" if non_ignored_index == 0 else f"Alternate {non_ignored_index}"
            )
            non_ignored_index += 1

        for entry_index, entry in enumerate(entries):
            fields = entry.get("fields") if isinstance(entry, dict) else {}
            relation = clean(entry.get("relation")) if isinstance(entry, dict) else ""

            def field_value(role):
                value = fields.get(role) if isinstance(fields, dict) else ""
                return clean(value.get("value") if isinstance(value, dict) else value)

            values = {role: field_value(role) for role in FACTWISE_FIELD_LABELS}
            needs_review = bool(entry.get("needsReview")) if isinstance(entry, dict) else False
            if not any(values.values()) and relation != "Ignored" and not needs_review:
                continue
            confidences = [
                confidence_value
                for role, value in values.items()
                if value
                for confidence_value in [_factwise_field_confidence(role, fields.get(role))]
                if confidence_value is not None
            ] if isinstance(fields, dict) else []
            normalized = {
                "sourceRow": source_row,
                # What groups a row with its alternates.
                #
                # The customer part number groups them only when the sheet puts
                # alternates on their own rows under a shared CPN. Used
                # otherwise it groups by identity rather than by usage, and a
                # part consumed by two assemblies - a resistor in two boards -
                # looks like one part with an alternate. The second usage is
                # then dropped as a redundant alternate, silently: Honeywell's
                # HAB-45002226 lost 13 resistors from one sub-assembly and 4
                # ribbon cables from the top, and the BOM still validated.
                #
                # Alternates written inside one cell all expand from the same
                # source row, so the row number groups those correctly too.
                #
                # The stated parent is NOT a group key either, for the same
                # reason the CPN is not: it groups by position in the tree
                # rather than by line. Every sibling under one assembly shares
                # it, so a sheet that states its parents collapses to one group
                # per parent and `split_primaries_and_alternates` keeps a single
                # primary from each - the rest are read as its alternates and
                # never reach the tree. A 114-row LAM sheet came out as 4 rows,
                # and the three that survived reported their parents missing,
                # because the parents had been swallowed as alternates.
                "parentKey": _alternate_group_key(
                    values,
                    source_row,
                    safe_config,
                    source_values=row,
                    headers=safe_headers,
                ),
                "parent": values["parent"],
                "relation": relation or ("Primary" if entry_index == 0 else f"Alternate {entry_index}"),
                "needsReview": needs_review,
                "reviewReason": clean(entry.get("reviewReason")) if isinstance(entry, dict) else "",
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
    elif alternate_layout == "same_group_rows":
        normalized_rows = _normalize_same_group_rows(
            normalized_rows,
            safe_config,
        )

    # Before anything reads a level, a code or a parent off these rows.
    normalized_rows = _apply_parent_path_hierarchy(normalized_rows, safe_config)

    rows_by_source = {}
    warnings = []
    for normalized in normalized_rows:
        rows_by_source.setdefault(str(normalized.get("sourceRow")), []).append(normalized)
        if not clean(normalized.get("mpn")) and normalized.get("relation") != "Ignored":
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
        "blockStructure": block_structure,
        "warnings": warnings,
        "pairingCheck": {
            "checkedRows": checked_rows,
            "matchedRows": matched_rows,
            "issueRows": pairing_issues,
        },
        "progress": {
            "processed": len(original_rows),
            "total": len(original_rows),
            "outputRows": len(normalized_rows),
            "skippedRows": skipped_rows,
        },
    }


def clear_bom_role_inference_caches():
    _best_mpn_from_text.cache_clear()
    _best_manufacturer_from_text.cache_clear()
    _manufacturer_directory_words.cache_clear()
    _manufacturer_directory_spans.cache_clear()
    _manufacturer_segments_for_target_count.cache_clear()
    _split_manufacturer_part_by_directory.cache_clear()
