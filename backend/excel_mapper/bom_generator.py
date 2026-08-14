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


# Set on a record by the grid merge (views.GRID_ROW_KEY) and carried through to
# `GenerationResult.bom_row_grid_rows`. A generated BOM row does not correspond
# to the row the user is looking at - rows are grouped by parentKey, documents
# are dropped, and one editor row can vanish into another's alternate column -
# so without this a validation message points at a row number that exists
# nowhere on screen.
GRID_ROW_KEY = '__grid_row__'


def grid_row_of(record):
    """The editor row a record came from, or None when it was never stamped."""
    if not isinstance(record, dict):
        return None
    value = record.get(GRID_ROW_KEY)
    return value if isinstance(value, int) else None


class GenerationResult(object):
    def __init__(self):
        self.item_headers = []
        self.item_rows = []
        self.bom_headers = []
        self.bom_rows = []
        # Parallel to bom_rows: the editor row each one came from, or None.
        self.bom_row_grid_rows = []
        self.errors = []
        self.warnings = []
        self.stats = {}

    @property
    def is_valid(self):
        return not self.errors


def _source_row_order(record):
    """``sourceRow`` as a number, for sorting.

    It has to be compared by value, not as text. Read as text, "10" sorts before
    "2" - the same reason a phone lists Track 10 before Track 2 - so on a sheet
    numbered 2..77 the row treated as first was row 10. That is how a capacitor
    came to be picked as the top of an assembly.

    A missing or non-numeric value sorts last rather than first, and the caller's
    positional tie-break then keeps those rows in sheet order.
    """
    text = _text(record.get(F_SOURCE_ROW))
    try:
        return (0, float(text))
    except (TypeError, ValueError):
        return (1, 0.0)


def _group_sort_key(item):
    """Order one group: primary first, then sheet order.

    ``item`` is ``(position, record)``, where position is the row's index in the
    input. Three levels, each only consulted when the one before it ties:

        1. relation  - the primary leads, then Alternate 1, 2, ...
        2. sourceRow - numerically, so the sheet's own order is preserved
        3. position  - the order the row already had, when sourceRow cannot say

    Level 3 is what guarantees sheet order survives even on rows whose sourceRow
    is blank or unparsable.
    """
    position, record = item
    rank = relation_rank(record.get(F_RELATION))
    return (
        rank if rank is not None else 9999,
        _source_row_order(record),
        position,
    )


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
        # The position is carried so sheet order can be the final tie-break -
        # see the sort below.
        groups.setdefault(key, []).append((index, record))

    ordered = OrderedDict()
    for key, rows in groups.items():
        ordered[key] = [record for _position, record in sorted(rows, key=_group_sort_key)]
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
        # The primary is the row this BOM line came from; its alternates were
        # folded sideways into the same line and have no line of their own.
        result.bom_row_grid_rows.append(grid_row_of(primary))

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


def split_primaries_and_alternates(records):
    """Map each parentKey to (primary record, [alternate records]).

    The tree is derived from primaries only. An alternate is the same BOM line
    seen from a different manufacturer, so it must not become a sibling row in
    the structure — it goes sideways into the alternate columns instead.
    """
    groups, _ungrouped = group_normalized_rows(records)
    primary_of = {}
    alternates_of = {}
    for key, rows in groups.items():
        primary = None
        alternates = []
        for row in rows:
            rank = relation_rank(row.get(F_RELATION))
            if rank == 0 and primary is None:
                primary = row
            else:
                alternates.append(row)
        if primary is None and rows:
            primary = rows[0]
            alternates = rows[1:]
        primary_of[key] = primary
        alternates_of[key] = alternates
    return primary_of, alternates_of


DEFAULT_BASE_QUANTITY = 1
DEFAULT_MEASUREMENT_UNIT = 'EA'


def generate_multi_level_bom(tree, bom_header, alternates_of=None, records=None,
                             sub_boms=None):
    """Generate a multi-level BOM: one block per assembly, in sheet order.

    ``tree`` is what ``bom_tree.derive_tree`` produced, so structure is never
    re-derived here. Each block becomes a BOM ID; a child that is itself an
    assembly fills ``Sub BOM ID`` and a child that is not fills ``Raw material
    code``. The two are mutually exclusive — validation enforces the XOR.

    Codes are resolved through one map so ``BOM ID``, ``Sub BOM ID`` and ``Raw
    material code`` cannot drift apart: a sub-assembly's ``Sub BOM ID`` is by
    construction the same string as its own ``BOM ID`` one block down.
    """
    result = GenerationResult()
    alternates_of = alternates_of or {}

    if not tree.blocks:
        result.errors.append({
            'type': 'no_blocks',
            'message': 'No assembly in this sheet has any children, so there is no BOM to build.',
        })
        return result

    # A tree code is whatever column held the part number; the FactWise item
    # code may be generated separately. Resolve once, use everywhere.
    resolved = {}
    for row in tree.rows:
        source = row.get('source') or {}
        resolved.setdefault(row['code'], _text(source.get(F_ITEM_CODE)) or row['code'])
    for code in tree.nodes:
        resolved.setdefault(code, code)

    def alternates_for(row):
        key = _text((row.get('source') or {}).get(F_PARENT_KEY))
        return alternates_of.get(key, []) if key else []

    max_alternates = 0
    for block in tree.blocks:
        for child in block['children']:
            max_alternates = max(max_alternates, len(alternates_for(child)))
    result.bom_headers = build_bom_headers(max_alternates)

    root_code = tree.root_code
    authored_base_quantity = (bom_header or {}).get('baseQuantity') or 1
    authored_uom = _text((bom_header or {}).get('measurementUnit'))
    authored_name = _text((bom_header or {}).get('bomName'))

    sub_boms = sub_boms or {}

    # A sub-assembly's BOM code, when the user renamed it.
    #
    # Applied into `resolved` rather than at the point of use, because that map
    # is what BOTH `BOM ID` and the parent's `Sub BOM ID` are read through. Set
    # it here and the two cannot disagree; set it anywhere else and a renamed
    # sub-BOM would be referenced by its old code one block up, which imports as
    # a sub-BOM pointing at nothing.
    #
    # The root is excluded: its code is the finished good, authored in the
    # popup's own form, not in the per-assembly rows.
    for code, override in sub_boms.items():
        if code == root_code:
            continue
        renamed = _text((override or {}).get('bomCode'))
        if renamed:
            resolved[code] = renamed

    for block in tree.blocks:
        parent_code = resolved.get(block['bom_id'], block['bom_id'])
        is_root_block = block['bom_id'] == root_code

        # Every BOM's header is authored, not assumed. The root's comes from the
        # popup's finished-good form; a sub-assembly's comes from its own row in
        # the same step, keyed by part code. Falling back to the sheet's unit and
        # then to a default keeps an older saved answer working, but the normal
        # path is that all three values were on screen and confirmed.
        override = sub_boms.get(block['bom_id']) or {}
        if is_root_block:
            base_quantity = authored_base_quantity
            block_uom = authored_uom or block.get('uom') or DEFAULT_MEASUREMENT_UNIT
            bom_name = authored_name or parent_code
        else:
            base_quantity = override.get('baseQuantity') or DEFAULT_BASE_QUANTITY
            block_uom = (_text(override.get('measurementUnit'))
                         or block.get('uom') or DEFAULT_MEASUREMENT_UNIT)
            bom_name = _text(override.get('bomName')) or parent_code

        for child in block['children']:
            child_code = resolved.get(child['code'], child['code'])
            child_node = tree.nodes.get(child['code']) or {}
            is_assembly = not child_node.get('is_leaf', True)

            row = OrderedDict((header, '') for header in result.bom_headers)
            row['Finished good code'] = parent_code
            row['BOM ID'] = parent_code
            row['BOM name'] = bom_name
            row['Base quantity'] = base_quantity
            row['BOM measurement unit'] = block_uom
            row['Level'] = block['level']
            if is_assembly:
                row['Sub BOM ID'] = child_code
            else:
                row['Raw material code'] = child_code
            row['Description'] = child.get('description', '')
            row['Quantity'] = child.get('quantity', '')
            row['Measurement unit'] = child.get('uom', '')

            for position, alternate in enumerate(alternates_for(child)):
                suffix = '' if position == 0 else '_%d' % (position + 1)
                base = position * len(BOM_ALTERNATE_GROUP) + len(BOM_BASE_COLUMNS)
                names = result.bom_headers[base:base + len(BOM_ALTERNATE_GROUP)]
                values = [
                    _text(alternate.get(F_ITEM_CODE)),
                    '',
                    _text(alternate.get(F_QUANTITY)) or child.get('quantity', ''),
                    _text(alternate.get(F_UOM)) or child.get('uom', ''),
                ]
                for name, value in zip(names, values):
                    row['%s%s' % (name, suffix)] = value

            result.bom_rows.append(row)
            result.bom_row_grid_rows.append(grid_row_of(child.get('source')))

    # The item sheet holds every node AND every alternate. An alternate is a
    # different manufacturer's part with its own code, so it is a separate item
    # even though it shares a BOM line with its primary — leaving them out is
    # what makes the second import file fail on referential integrity.
    # Documents were dropped from the structure; drop them from the item sheet
    # too, along with the alternates that hang off them. Keyed by parentKey so
    # a drawing's whole group goes together.
    document_keys = set()
    for document in tree.documents:
        key = _text((document.get('source') or {}).get(F_PARENT_KEY))
        if key:
            document_keys.add(key)
    item_source = [
        record for record in (records or [])
        if not (document_keys and _text(record.get(F_PARENT_KEY)) in document_keys)
    ]

    item_headers, item_rows, duplicate_codes = generate_item_rows(item_source)

    assembly_codes = set()
    for code, node in tree.nodes.items():
        if not node.get('is_leaf', True):
            assembly_codes.add(resolved.get(code, code))

    # generate_item_rows types everything as a raw material because a flat sheet
    # has no assemblies. Here the tree knows better.
    for row in item_rows:
        if row['Item code'] in assembly_codes:
            row['Item type'] = 'Finished good'

    # Anything the tree knows about but the records do not — the authored root
    # above all, which exists only in the popup answers.
    seen_codes = {row['Item code'] for row in item_rows if row['Item code']}
    source_of = {}
    for row in tree.rows:
        source_of.setdefault(row['code'], row.get('source') or {})
    for code, node in tree.nodes.items():
        item_code = resolved.get(code, code)
        if item_code in seen_codes:
            continue
        seen_codes.add(item_code)
        source = source_of.get(code, {})
        description = node.get('description') or ''
        item_rows.append({
            'Item code': item_code,
            'CPN Code': _text(source.get(F_CPN)),
            'MPN Code': _text(source.get(F_MPN)),
            'Item name': description or item_code,
            'Description': description,
            'Item type': node.get('item_type') or ('Raw material' if node.get('is_leaf', True) else 'Finished good'),
            'Measurement unit': node.get('uom') or '',
            'Manufacturer': _text(source.get(F_MANUFACTURER)),
        })

    result.item_headers = item_headers
    result.item_rows = item_rows
    if duplicate_codes:
        tree.warnings.append({
            'type': 'duplicate_item_codes',
            'count': len(duplicate_codes),
            'codes': duplicate_codes[:10],
            'message': '%d rows shared an item code and were collapsed into one item.'
                       % len(duplicate_codes),
        })
    result.warnings = list(tree.warnings)
    result.errors = list(tree.errors)

    assemblies = sum(1 for node in tree.nodes.values() if not node.get('is_leaf', True))
    result.stats = {
        'bom_rows': len(result.bom_rows),
        'item_rows': len(result.item_rows),
        'alternate_sets': max_alternates,
        'bom_columns': len(result.bom_headers),
        'blocks': len(tree.blocks),
        'assemblies': assemblies,
        'documents_excluded': len(tree.documents),
        'levels': max((block['level'] for block in tree.blocks), default=0),
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
