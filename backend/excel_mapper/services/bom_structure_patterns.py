import hashlib
import json
import re
from difflib import SequenceMatcher


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

VALUE_PROFILE_SAMPLE_SIZE = 120

BOOLEAN_VALUES = {"TRUE", "FALSE", "YES", "NO", "Y", "N", "OUI", "NON", "1", "0"}
UOM_VALUES = {
    "EA", "EACH", "UNIT", "UNITS", "U", "PC", "PCS", "PIECE", "PIECES", "NO", "NO.",
    "NOS", "SET", "PAIR", "PR", "BOX", "BX", "PACK", "PK", "M", "CM", "MM", "KM",
    "IN", "FT", "YD", "KG", "G", "GM", "MG", "LB", "LBS", "OZ", "L", "ML",
    "M2", "M3", "SQM", "SQ M", "CU M", "HR", "H", "MIN", "SEC",
}


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def normalize_key(value):
    return re.sub(r"[^a-z0-9]+", "", clean(value).lower())


def normalize_words(value):
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def _norm_value_token(value):
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9.]+", " ", clean(value).upper())).strip()


def _stable_hash(value):
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _row_value(row, header, index):
    if isinstance(row, dict):
        return row.get(header, "")
    if isinstance(row, (list, tuple)):
        return row[index] if index < len(row) else ""
    return ""


def _column_values(headers, rows, index, sample_size=VALUE_PROFILE_SAMPLE_SIZE):
    header = headers[index] if index < len(headers) else ""
    return [
        _row_value(row, header, index)
        for row in (rows or [])[:sample_size]
    ]


def _ratio(count, total):
    return (count / total) if total else 0.0


def _is_numeric(value):
    return bool(re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", clean(value)))


def _is_code_like(value):
    text = clean(value)
    if len(text) < 4 or len(text) > 80:
        return False
    compact = re.sub(r"[^A-Za-z0-9]+", "", text)
    if len(compact) < 4:
        return False
    has_digit = bool(re.search(r"\d", compact))
    has_letter = bool(re.search(r"[A-Za-z]", compact))
    has_part_punctuation = bool(re.search(r"[-_/+.]", text))
    return has_digit and (has_letter or has_part_punctuation)


def _is_long_text(value):
    text = clean(value)
    return len(text) >= 18 and (len(text.split()) >= 3 or bool(re.search(r"\s", text)))


def _column_value_profile(header, values, index, total_rows):
    samples = [clean(value) for value in values if clean(value)]
    sample_total = len(samples)
    denominator = max(1, total_rows)
    tokens = [_norm_value_token(value) for value in samples]
    numeric_count = sum(1 for value in samples if _is_numeric(value))
    boolean_count = sum(1 for token in tokens if token in BOOLEAN_VALUES)
    uom_count = sum(1 for token in tokens if token in UOM_VALUES)
    code_count = sum(1 for value in samples if _is_code_like(value))
    long_text_count = sum(1 for value in samples if _is_long_text(value))
    dotted_level_count = sum(1 for value in samples if re.fullmatch(r"\d+(?:\.\d+){1,5}", clean(value)))
    avg_length = round(sum(len(value) for value in samples) / sample_total, 2) if sample_total else 0.0

    return {
        "index": index,
        "header": clean(header),
        "normalized_header": normalize_key(header),
        "fill_rate": round(_ratio(sample_total, denominator), 4),
        "unique_rate": round(_ratio(len(set(tokens)), sample_total), 4) if sample_total else 0.0,
        "numeric_rate": round(_ratio(numeric_count, sample_total), 4),
        "boolean_rate": round(_ratio(boolean_count, sample_total), 4),
        "uom_rate": round(_ratio(uom_count, sample_total), 4),
        "code_like_rate": round(_ratio(code_count, sample_total), 4),
        "long_text_rate": round(_ratio(long_text_count, sample_total), 4),
        "dotted_level_rate": round(_ratio(dotted_level_count, sample_total), 4),
        "average_length": avg_length,
    }


def _slot_from_header(header):
    words = normalize_words(header)
    match = re.search(r"(?:^| )([0-9]{1,2})$", words)
    if match:
        return match.group(1)
    compact = normalize_key(header)
    match = re.search(r"([0-9]{1,2})$", compact)
    return match.group(1) if match else ""


def _alternate_kind(header):
    words = normalize_words(header)
    compact = normalize_key(header)

    if re.search(r"\b(qty|quantity|qte|menge)\b", words):
        return "qty"
    if re.search(r"\b(uom|unit|unite|einheit|me)\b", words):
        return "uom"
    if (
        re.search(r"\b(cpn|customer\s+part|customer\s+pn|item\s+code|article)\b", words)
        or "customerpart" in compact
        or "customercode" in compact
        or "itemcode" in compact
    ):
        return "cpn"

    manufacturer_terms = (
        "mfg",
        "mfgr",
        "mfr",
        "manufacturer",
        "fabricant",
        "make",
        "maker",
        "brand",
        "supplier",
    )
    has_manufacturer_word = any(term in words.split() or term in compact for term in manufacturer_terms)
    has_part_word = bool(re.search(r"\b(part|pn|mpn|ref|reference|article)\b", words) or "part" in compact)
    has_name_word = bool(
        re.search(r"\b(name|nom|fabricant|make|maker|brand|supplier)\b", words)
        or "name" in compact
    )

    if has_manufacturer_word and has_part_word:
        return "mpn"
    if has_manufacturer_word and has_name_word:
        return "manufacturer"
    if re.search(r"\bmpn\b", words) or "partno" in compact or "partnumber" in compact:
        return "mpn"
    return ""


def detect_alternate_column_groups(headers):
    """Detect side-by-side alternate groups such as MFG Name2 + MFG part#2."""
    groups_by_slot = {}
    for index, header in enumerate(headers or []):
        header_text = clean(header)
        if not header_text:
            continue
        kind = _alternate_kind(header_text)
        if not kind:
            continue
        slot = _slot_from_header(header_text)
        if not slot:
            continue
        group = groups_by_slot.setdefault(slot, {"slot": slot})
        existing = group.get(kind)
        if not existing or index < existing.get("index", 10**9):
            group[kind] = {"header": header_text, "index": index}

    groups = []
    for slot, group in groups_by_slot.items():
        if not group.get("mpn") and not group.get("manufacturer"):
            continue
        if not group.get("mpn"):
            continue
        groups.append({
            "slot": slot,
            "cpn": group.get("cpn", {}).get("header", ""),
            "mpn": group.get("mpn", {}).get("header", ""),
            "manufacturer": group.get("manufacturer", {}).get("header", ""),
            "qty": group.get("qty", {}).get("header", ""),
            "uom": group.get("uom", {}).get("header", ""),
            "headers": [
                value.get("header")
                for key, value in group.items()
                if key != "slot" and isinstance(value, dict) and value.get("header")
            ],
        })

    return sorted(groups, key=lambda item: int(item["slot"]) if str(item["slot"]).isdigit() else 999)


def build_structure_profile(headers, rows=None, roles=None, config=None, source_signature=None):
    safe_headers = [clean(header) for header in (headers or [])]
    safe_rows = rows if isinstance(rows, list) else []
    roles = roles if isinstance(roles, dict) else {}
    config = config if isinstance(config, dict) else {}
    source_signature = source_signature if isinstance(source_signature, dict) else {}
    alternate_groups = (
        config.get("alternateColumnGroups")
        if isinstance(config.get("alternateColumnGroups"), list) and config.get("alternateColumnGroups")
        else detect_alternate_column_groups(safe_headers)
    )

    configured_layout = clean(config.get("alternateLayout"))
    if configured_layout == "separate_columns" or alternate_groups:
        layout = "alternate_columns"
    elif configured_layout:
        layout = configured_layout
    else:
        layout = clean(config.get("structure")) or "unknown"

    role_headers = {
        role: clean(roles.get(role))
        for role in ROLE_KEYS
        if clean(roles.get(role))
    }
    normalized_headers = [normalize_key(header) for header in safe_headers]
    column_profiles = [
        _column_value_profile(
            header,
            _column_values(safe_headers, safe_rows, index),
            index,
            min(len(safe_rows), VALUE_PROFILE_SAMPLE_SIZE),
        )
        for index, header in enumerate(safe_headers)
    ]
    role_positions = {
        role: safe_headers.index(header)
        for role, header in role_headers.items()
        if header in safe_headers
    }
    profile_basis = {
        "layout": layout,
        "headers": normalized_headers,
        "roles": {role: normalize_key(header) for role, header in role_headers.items()},
        "role_positions": role_positions,
        "column_shapes": [
            {
                "header": column["normalized_header"],
                "fill": round(column["fill_rate"], 1),
                "num": round(column["numeric_rate"], 1),
                "bool": round(column["boolean_rate"], 1),
                "uom": round(column["uom_rate"], 1),
                "code": round(column["code_like_rate"], 1),
                "text": round(column["long_text_rate"], 1),
            }
            for column in column_profiles
        ],
        "alternate_groups": [
            {
                "slot": clean(group.get("slot") or index + 1),
                "mpn": normalize_key(group.get("mpn")),
                "manufacturer": normalize_key(group.get("manufacturer")),
                "qty": normalize_key(group.get("qty")),
                "uom": normalize_key(group.get("uom")),
            }
            for index, group in enumerate(alternate_groups or [])
            if isinstance(group, dict)
        ],
    }

    return {
        "layout": layout,
        "header_count": len(safe_headers),
        "row_sample_count": len(safe_rows),
        "headers": safe_headers,
        "normalized_headers": normalized_headers,
        "column_profiles": column_profiles,
        "roles": role_headers,
        "role_positions": role_positions,
        "alternate_column_groups": alternate_groups or [],
        "source_hints": {
            "fileName": source_signature.get("fileName") or source_signature.get("file_name") or "",
            "sheetName": source_signature.get("sheetName") or source_signature.get("sheet_name") or "",
            "headerRowIndex": source_signature.get("headerRowIndex") if "headerRowIndex" in source_signature else source_signature.get("header_row_index"),
        },
        "fingerprint": _stable_hash(profile_basis),
    }


def _resolve_header(saved_header, current_headers, threshold=0.78):
    saved = clean(saved_header)
    if not saved:
        return ""
    current_headers = [clean(header) for header in (current_headers or [])]
    if saved in current_headers:
        return saved
    saved_key = normalize_key(saved)
    for header in current_headers:
        if normalize_key(header) == saved_key:
            return header

    best_header = ""
    best_score = 0.0
    for header in current_headers:
        score = SequenceMatcher(None, saved_key, normalize_key(header)).ratio()
        if score > best_score:
            best_header = header
            best_score = score
    return best_header if best_score >= threshold else ""


def resolve_saved_structure(pattern, current_headers):
    roles = {
        role: _resolve_header(header, current_headers)
        for role, header in (pattern.roles or {}).items()
        if role in ROLE_KEYS
    }
    config = dict(pattern.config or {})
    groups = []
    for group in config.get("alternateColumnGroups") or (pattern.structure_profile or {}).get("alternate_column_groups") or []:
        if not isinstance(group, dict):
            continue
        resolved = {
            "slot": group.get("slot") or str(len(groups) + 1),
            "cpn": _resolve_header(group.get("cpn"), current_headers),
            "mpn": _resolve_header(group.get("mpn"), current_headers),
            "mfr": _resolve_header(group.get("mfr") or group.get("manufacturer"), current_headers),
            "manufacturer": _resolve_header(group.get("manufacturer") or group.get("mfr"), current_headers),
            "qty": _resolve_header(group.get("qty"), current_headers),
            "uom": _resolve_header(group.get("uom"), current_headers),
        }
        if resolved["mpn"] or resolved["manufacturer"] or resolved["cpn"]:
            groups.append(resolved)
    if groups:
        config["alternateLayout"] = "separate_columns"
        config["alternateColumnGroups"] = groups
    return roles, config


def structure_similarity(saved_profile, current_profile):
    saved_headers = set(saved_profile.get("normalized_headers") or [])
    current_headers = set(current_profile.get("normalized_headers") or [])
    if not saved_headers or not current_headers:
        return 0.0
    intersection = len(saved_headers & current_headers)
    union = len(saved_headers | current_headers)
    header_score = intersection / union if union else 0.0
    order_score = SequenceMatcher(
        None,
        saved_profile.get("normalized_headers") or [],
        current_profile.get("normalized_headers") or [],
    ).ratio()

    saved_layout = saved_profile.get("layout") or ""
    current_layout = current_profile.get("layout") or ""
    layout_score = 1.0 if saved_layout and saved_layout == current_layout else 0.0

    saved_groups = saved_profile.get("alternate_column_groups") or []
    current_groups = current_profile.get("alternate_column_groups") or []
    group_score = 0.0
    if saved_groups or current_groups:
        saved_group_keys = {
            (
                normalize_key(group.get("mpn")),
                normalize_key(group.get("manufacturer") or group.get("mfr")),
            )
            for group in saved_groups
            if isinstance(group, dict)
        }
        current_group_keys = {
            (
                normalize_key(group.get("mpn")),
                normalize_key(group.get("manufacturer") or group.get("mfr")),
            )
            for group in current_groups
            if isinstance(group, dict)
        }
        if saved_group_keys and current_group_keys:
            group_score = len(saved_group_keys & current_group_keys) / len(saved_group_keys | current_group_keys)
    else:
        group_score = 1.0

    value_shape_score = _value_shape_similarity(
        saved_profile.get("column_profiles") or [],
        current_profile.get("column_profiles") or [],
    )

    return round(
        (header_score * 0.35)
        + (order_score * 0.20)
        + (value_shape_score * 0.25)
        + (layout_score * 0.10)
        + (group_score * 0.10),
        4,
    )


def _value_shape_similarity(saved_columns, current_columns):
    if not saved_columns or not current_columns:
        return 0.5

    current_by_header = {}
    for column in current_columns:
        current_by_header.setdefault(column.get("normalized_header") or "", []).append(column)

    scores = []
    for saved in saved_columns:
        key = saved.get("normalized_header") or ""
        candidates = current_by_header.get(key) or []
        if not candidates:
            current_index = saved.get("index")
            candidates = [
                column for column in current_columns
                if column.get("index") == current_index
            ]
        if not candidates:
            continue
        current = candidates[0]
        scores.append(_column_shape_similarity(saved, current))

    if not scores:
        return 0.0
    coverage = len(scores) / max(len(saved_columns), len(current_columns), 1)
    return round((sum(scores) / len(scores)) * coverage, 4)


def _column_shape_similarity(saved, current):
    metric_weights = {
        "fill_rate": 1.2,
        "numeric_rate": 1.0,
        "boolean_rate": 1.0,
        "uom_rate": 1.0,
        "code_like_rate": 1.0,
        "long_text_rate": 1.0,
        "dotted_level_rate": 0.8,
        "unique_rate": 0.5,
    }
    total_weight = sum(metric_weights.values())
    distance = sum(
        abs(float(saved.get(metric, 0.0) or 0.0) - float(current.get(metric, 0.0) or 0.0)) * weight
        for metric, weight in metric_weights.items()
    ) / total_weight
    length_delta = abs(float(saved.get("average_length", 0.0) or 0.0) - float(current.get("average_length", 0.0) or 0.0))
    length_penalty = min(length_delta / 40.0, 0.25)
    return max(0.0, min(1.0, 1.0 - distance - length_penalty))


def learn_bom_structure(name="", headers=None, rows=None, roles=None, config=None, source_signature=None, workflow=None, confidence=1.0):
    from excel_mapper.models import BomStructurePattern

    if not rows:
        source_rows = source_signature.get("rowSample") if isinstance(source_signature, dict) else None
        if not isinstance(source_rows, list) and isinstance(source_signature, dict):
            source_rows = source_signature.get("row_sample")
        rows = source_rows if isinstance(source_rows, list) else []

    profile = build_structure_profile(
        headers=headers,
        rows=rows,
        roles=roles,
        config=config,
        source_signature=source_signature,
    )
    template_name = clean(name)[:200]
    pattern, created = BomStructurePattern.objects.update_or_create(
        signature_hash=profile["fingerprint"],
        defaults={
            "name": template_name,
            "structure_type": profile["layout"],
            "source_signature": source_signature if isinstance(source_signature, dict) else {},
            "structure_profile": profile,
            "roles": roles if isinstance(roles, dict) else {},
            "config": config if isinstance(config, dict) else {},
            "workflow": workflow if isinstance(workflow, dict) else {},
            "confidence": float(confidence or 0.0),
            "sample_count": len(rows or []),
        },
    )
    if not created:
        pattern.usage_count += 1
        pattern.save(update_fields=["usage_count", "updated_at"])
    return pattern, created


def match_bom_structures(headers=None, rows=None, roles=None, config=None, source_signature=None, limit=5):
    from excel_mapper.models import BomStructurePattern

    current_profile = build_structure_profile(
        headers=headers,
        rows=rows,
        roles=roles,
        config=config,
        source_signature=source_signature,
    )
    matches = []
    for pattern in BomStructurePattern.objects.all()[:200]:
        score = structure_similarity(pattern.structure_profile or {}, current_profile)
        if score < 0.55:
            continue
        resolved_roles, resolved_config = resolve_saved_structure(pattern, headers or [])
        item = pattern.to_dict()
        item.update({
            "score": score,
            "resolved_roles": resolved_roles,
            "resolved_config": resolved_config,
        })
        matches.append(item)

    matches.sort(key=lambda item: (item["score"], item.get("usage_count", 0)), reverse=True)
    return {
        "structureProfile": current_profile,
        "matches": matches[:max(1, int(limit or 5))],
    }
