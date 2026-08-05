"""Generate the FactWise Item Directory and BOM sheets from normalized rows.

Input is the BOM Normalizer's output contract (see
``BASE_NORMALIZED_EXPORT_COLUMNS`` in ``bomNormalizerAlgorithms.js``):

    sourceRow, parentKey, relation, level, cpn, description,
    mpn, manufacturer, quantity, uom, Item code, rule, confidence, discardedText

Two columns carry the structure:

    relation    'Primary' or 'Alternate N'
    parentKey   groups one primary with its alternates

The same rows expand in opposite directions:

    normalized rows
        |--> ITEM sheet: one row per normalized row      (each is a buyable part)
        '--> BOM  sheet: one row per parentKey group     (alternates go sideways
                                                          into repeated columns)

This module deliberately does **not** invent item codes. The editor's Factwise
ID rule fills ``Item code`` from columns the user chooses, so generation links
rows by ``parentKey``/``sourceRow`` and the real codes are resolved at export.
That is why BOM export must run *after* item codes exist.
"""

import re
from collections import OrderedDict


# --- normalized input contract -------------------------------------------------

F_SOURCE_ROW = 'sourceRow'
F_PARENT_KEY = 'parentKey'
F_RELATION = 'relation'
F_LEVEL = 'level'
F_CPN = 'cpn'
F_DESCRIPTION = 'description'
F_MPN = 'mpn'
F_MANUFACTURER = 'manufacturer'
F_QUANTITY = 'quantity'
F_UOM = 'uom'
F_ITEM_CODE = 'Item code'

_ALTERNATE_RE = re.compile(r'^\s*alternate\s*(\d+)?\s*$', re.IGNORECASE)
_PRIMARY_RE = re.compile(r'^\s*primary\s*$', re.IGNORECASE)


# --- BOM output schema ---------------------------------------------------------

# Columns 0-12 of the FactWise BOM import sheet. The alternate group that
# follows repeats once per alternate, exactly like Specification name/value/UOM
# in the item template.
BOM_BASE_COLUMNS = [
    'Finished good code',
    'BOM ID',
    'BOM name',
    'Base quantity',
    'BOM measurement unit',
    'BOM currency',
    'Level',
    'Raw material code',
    'Sub BOM ID',
    'Description',
    'Cost per unit',
    'Quantity',
    'Measurement unit',
]

BOM_ALTERNATE_GROUP = [
    'Alternate raw material code',
    'Alternate cost per unit',
    'Alternate quantity',
    'Alternate measurement unit',
]


def build_bom_headers(alternate_sets):
    """BOM sheet headers, widened by however many alternates the data needs.

    The count comes from the worst row in the sheet; nothing is capped here. A
    sheet with 30 alternates on one line legitimately produces 30 groups.
    """
    headers = list(BOM_BASE_COLUMNS)
    for _ in range(max(0, int(alternate_sets or 0))):
        headers.extend(BOM_ALTERNATE_GROUP)
    return headers


def _text(value):
    if value is None:
        return ''
    return str(value).strip()


def relation_rank(value):
    """Return 0 for a primary, N for 'Alternate N', or None when unrecognised.

    A bare 'Alternate' with no number is treated as the first alternate rather
    than discarded — losing a real part to a formatting quirk is worse than
    guessing its position.
    """
    text = _text(value)
    if not text or _PRIMARY_RE.match(text):
        return 0
    match = _ALTERNATE_RE.match(text)
    if match:
        return int(match.group(1)) if match.group(1) else 1
    return None


class GenerationResult(object):
    def __init__(self):
        self.item_headers = []
        self.item_rows = []
        self.bom_headers = []
        self.bom_rows = []
        self.errors = []
        self.warnings = []
        self.stats = {}

    @property
    def is_valid(self):
        return not self.errors


def group_normalized_rows(records):
    """Group normalized rows into one bucket per parentKey, primary first.

    Rows are kept in first-seen order so the generated sheet reads in the same
    order as the sheet the user was just looking at.
    """
    groups = OrderedDict()
    ungrouped = 0
    for index, record in enumerate(records or []):
        if not isinstance(record, dict):
            continue
        key = _text(record.get(F_PARENT_KEY))
        if not key:
            # No group key: treat the row as its own line rather than dropping it.
            key = 'row:%s' % (_text(record.get(F_SOURCE_ROW)) or index)
            ungrouped += 1
        groups.setdefault(key, []).append(record)

    ordered = OrderedDict()
    for key, rows in groups.items():
        ordered[key] = sorted(
            rows,
            key=lambda row: (
                relation_rank(row.get(F_RELATION)) if relation_rank(row.get(F_RELATION)) is not None else 9999,
                _text(row.get(F_SOURCE_ROW)),
            ),
        )
    return ordered, ungrouped


def generate_item_rows(records):
    """One item row per normalized row — each is a distinct buyable part.

    Deduplication happens on ``Item code``, but only once codes exist. Until the
    editor's Factwise ID rule has run they are blank, so rows pass through and
    the blank-code failure is raised at export instead.
    """
    headers = ['Item code', 'CPN Code', 'MPN Code', 'Item name', 'Description',
               'Item type', 'Measurement unit', 'Manufacturer']
    rows = []
    seen_codes = {}
    duplicates = []

    for record in records or []:
        if not isinstance(record, dict):
            continue
        code = _text(record.get(F_ITEM_CODE))
        description = _text(record.get(F_DESCRIPTION))
        row = {
            'Item code': code,
            'CPN Code': _text(record.get(F_CPN)),
            'MPN Code': _text(record.get(F_MPN)),
            'Item name': description,
            'Description': description,
            # Flat sheets are all raw materials; the finished good is appended
            # separately by the caller because it is authored, not extracted.
            'Item type': 'Raw material',
            'Measurement unit': _text(record.get(F_UOM)),
            'Manufacturer': _text(record.get(F_MANUFACTURER)),
        }
        if code:
            if code in seen_codes:
                duplicates.append(code)
                continue
            seen_codes[code] = True
        rows.append(row)

    return headers, rows, duplicates


def generate_flat_bom(records, bom_header):
    """Generate a single-level BOM: one block, one row per parentKey group.

    ``bom_header`` is what the popup collected for a flat sheet, because a flat
    component list contains no finished good of its own.
    """
    result = GenerationResult()

    finished_good = _text((bom_header or {}).get('finishedGoodCode'))
    if not finished_good:
        result.errors.append({
            'type': 'missing_finished_good',
            'message': 'A finished good code is required before a BOM can be generated.',
        })
        return result

    bom_id = _text((bom_header or {}).get('bomName')) or finished_good
    bom_name = bom_id
    base_quantity = (bom_header or {}).get('baseQuantity') or 1
    bom_uom = _text((bom_header or {}).get('measurementUnit'))

    groups, ungrouped = group_normalized_rows(records)
    if not groups:
        result.errors.append({
            'type': 'no_rows',
            'message': 'There are no normalized rows to build a BOM from.',
        })
        return result

    built = []
    max_alternates = 0
    unknown_relations = 0

    for key, rows in groups.items():
        primary = None
        alternates = []
        for row in rows:
            rank = relation_rank(row.get(F_RELATION))
            if rank is None:
                unknown_relations += 1
                alternates.append(row)
            elif rank == 0 and primary is None:
                primary = row
            else:
                alternates.append(row)

        # A group with no row marked Primary still has to produce a BOM line, so
        # the first row stands in and the substitution is reported.
        if primary is None:
            primary = rows[0]
            alternates = rows[1:]
            result.warnings.append({
                'type': 'no_primary',
                'group': key,
                'message': 'No row marked Primary in group "%s"; used the first row.' % key,
            })

        max_alternates = max(max_alternates, len(alternates))
        built.append((primary, alternates))

    result.bom_headers = build_bom_headers(max_alternates)

    for primary, alternates in built:
        row = OrderedDict((header, '') for header in result.bom_headers)
        row['Finished good code'] = finished_good
        row['BOM ID'] = bom_id
        row['BOM name'] = bom_name
        row['Base quantity'] = base_quantity
        row['BOM measurement unit'] = bom_uom
        row['Level'] = 1
        row['Raw material code'] = _text(primary.get(F_ITEM_CODE))
        row['Description'] = _text(primary.get(F_DESCRIPTION))
        row['Quantity'] = _text(primary.get(F_QUANTITY))
        row['Measurement unit'] = _text(primary.get(F_UOM))

        # Alternate groups are positional: the Nth alternate fills the Nth group.
        for position, alternate in enumerate(alternates):
            suffix = '' if position == 0 else '_%d' % (position + 1)
            base = position * len(BOM_ALTERNATE_GROUP) + len(BOM_BASE_COLUMNS)
            names = result.bom_headers[base:base + len(BOM_ALTERNATE_GROUP)]
            values = [
                _text(alternate.get(F_ITEM_CODE)),
                '',
                _text(alternate.get(F_QUANTITY)) or _text(primary.get(F_QUANTITY)),
                _text(alternate.get(F_UOM)) or _text(primary.get(F_UOM)),
            ]
            # Repeated headers collide in a dict, so alternate groups are stored
            # positionally and only flattened to a list on the way out.
            for name, value in zip(names, values):
                row['%s%s' % (name, suffix)] = value

        result.bom_rows.append(row)

    item_headers, item_rows, duplicate_codes = generate_item_rows(records)

    # The authored finished good is an item too — the item sheet holds every
    # node, raw materials plus the finished good.
    item_rows.append({
        'Item code': finished_good,
        'CPN Code': '',
        'MPN Code': '',
        'Item name': _text((bom_header or {}).get('itemName')) or finished_good,
        'Description': _text((bom_header or {}).get('itemName')) or finished_good,
        'Item type': 'Finished good',
        'Measurement unit': bom_uom,
        'Manufacturer': '',
    })

    result.item_headers = item_headers
    result.item_rows = item_rows

    if duplicate_codes:
        result.warnings.append({
            'type': 'duplicate_item_codes',
            'count': len(duplicate_codes),
            'codes': duplicate_codes[:10],
            'message': '%d rows shared an item code and were collapsed into one item.'
                       % len(duplicate_codes),
        })
    if ungrouped:
        result.warnings.append({
            'type': 'missing_parent_key',
            'count': ungrouped,
            'message': '%d rows had no group key and became their own BOM line.' % ungrouped,
        })
    if unknown_relations:
        result.warnings.append({
            'type': 'unknown_relation',
            'count': unknown_relations,
            'message': '%d rows had an unrecognised relation and were treated as alternates.'
                       % unknown_relations,
        })

    result.stats = {
        'bom_rows': len(result.bom_rows),
        'item_rows': len(result.item_rows),
        'alternate_sets': max_alternates,
        'bom_columns': len(result.bom_headers),
        'blocks': 1,
    }
    return result


def bom_rows_as_lists(result):
    """Flatten generated BOM rows to plain lists aligned with ``bom_headers``.

    Needed because the FactWise sheet repeats header names, which a dict cannot
    represent; the generator keys repeats internally and unwinds them here.
    """
    output = []
    for row in result.bom_rows:
        values = []
        counts = {}
        for header in result.bom_headers:
            seen = counts.get(header, 0)
            counts[header] = seen + 1
            key = header if seen == 0 else '%s_%d' % (header, seen + 1)
            values.append(row.get(key, ''))
        output.append(values)
    return output
