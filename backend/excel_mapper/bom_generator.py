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


def drop_redundant_alternates(primary_code, alternates):
    """Remove alternates that repeat the primary, or each other.

    An alternate names a DIFFERENT manufacturer's part that may be substituted.
    One carrying the same item code as the primary says "you may substitute this
    part with itself" — no information at all, and FactWise rejects the file for
    it (``alternate_is_primary``). The same code in two alternate slots is the
    same statement made twice (``alternate_duplicate``).

    Both are dropped rather than reported, because neither is ambiguous. That is
    the difference from two rows disagreeing about what a part IS, where only
    the user knows which is right and blocking is correct: here there is nothing
    to decide and nothing to lose.

    Identity is the item code when there is one. Codes are generated later than
    this in some flows, so a blank one falls back to (MPN, manufacturer) — the
    pair an alternate actually varies.

    Returns ``(kept, dropped_count)``.
    """
    def identity(record):
        code = _text(record.get(F_ITEM_CODE))
        if code:
            return ('code', code.lower())
        mpn = _text(record.get(F_MPN)).lower()
        manufacturer = _text(record.get(F_MANUFACTURER)).lower()
        if mpn or manufacturer:
            return ('pair', mpn, manufacturer)
        return None

    seen = set()
    primary_key = _text(primary_code).lower()
    if primary_key:
        seen.add(('code', primary_key))

    kept = []
    dropped = 0
    for alternate in alternates or []:
        key = identity(alternate)
        # No identity at all — keep it. An empty alternate slot is a different
        # complaint with its own message, and silently eating rows here would
        # hide it.
        if key is None:
            kept.append(alternate)
            continue
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        kept.append(alternate)
    return kept, dropped


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

    # The BOM's own code, authored separately from the finished good.
    #
    # It used to be `bomName or finishedGoodCode`, which meant typing a BOM NAME
    # silently became the BOM's ID — and disagreed with the hierarchical path,
    # which always used the code. The two are different things: the finished
    # good is an ITEM in the directory, the BOM ID identifies the recipe that
    # builds it. Defaulting to the finished good keeps the common case where
    # they match.
    bom_id = _text((bom_header or {}).get('bomCode')) or finished_good
    bom_name = _text((bom_header or {}).get('bomName')) or bom_id
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
    redundant_alternates = 0

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

        # Before the width is measured, so a dropped alternate does not leave an
        # empty group of columns on every row of the sheet.
        alternates, redundant = drop_redundant_alternates(
            primary.get(F_ITEM_CODE), alternates
        )
        redundant_alternates += redundant

        max_alternates = max(max_alternates, len(alternates))
        built.append((primary, alternates))

    result.bom_headers = build_bom_headers(max_alternates)
    if redundant_alternates:
        result.warnings.append({
            'type': 'redundant_alternates',
            'count': redundant_alternates,
            'message': ('Dropped %d alternate(s) that repeated their own primary '
                        'or another alternate.' % redundant_alternates),
        })

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

    # Counted per parentKey, not per call: `alternates_for` runs twice for every
    # child — once to measure the sheet's width, once to write the cells — so
    # incrementing a plain counter would report double.
    groups_with_redundant = set()

    def alternates_for(row):
        key = _text((row.get('source') or {}).get(F_PARENT_KEY))
        if not key:
            return []
        # Filtered here rather than at the two call sites, because those two
        # must agree: drop an alternate in one and not the other and the sheet
        # carries an empty group of columns on every row.
        #
        # Compared against the child's own RESOLVED code — the same string that
        # lands in Raw material code / Sub BOM ID — so "alternate equals
        # primary" is judged on exactly what the sheet will say, including any
        # rename the user made in the structure gate.
        primary_code = resolved.get(row['code'], row['code'])
        kept, dropped = drop_redundant_alternates(primary_code, alternates_of.get(key, []))
        if dropped:
            groups_with_redundant.add(key)
        return kept

    max_alternates = 0
    for block in tree.blocks:
        for child in block['children']:
            max_alternates = max(max_alternates, len(alternates_for(child)))
    result.bom_headers = build_bom_headers(max_alternates)

    root_code = tree.root_code
    authored_base_quantity = (bom_header or {}).get('baseQuantity') or 1
    authored_uom = _text((bom_header or {}).get('measurementUnit'))
    authored_name = _text((bom_header or {}).get('bomName'))
    authored_bom_code = _text((bom_header or {}).get('bomCode'))

    sub_boms = sub_boms or {}

    # Every block has TWO identifiers, and they are not the same thing:
    #
    #   Finished good code  the ITEM this BOM builds        -> `resolved`
    #   BOM ID              the recipe's own code           -> `bom_code_of`
    #
    # They used to be forced equal for sub-assemblies, which meant giving a
    # sub-BOM a free code to dodge a duplicate also renamed the part — the
    # original item stopped being the one used, silently. Splitting them lets
    # `0043-13591` stay the part while its BOM becomes `0043-13591_BOM`.
    #
    # The invariant that must survive the split: a parent's `Sub BOM ID` has to
    # equal the child block's `BOM ID`. Both are read through `bom_code_for`
    # below and nowhere else, so they cannot drift — get that wrong and a parent
    # references a sub-BOM that was never written.
    #
    # The root is excluded: its two codes are authored in the popup's own form.
    bom_code_of = {}
    for code, override in sub_boms.items():
        if code == root_code:
            continue
        item = _text((override or {}).get('finishedGoodCode'))
        if item:
            resolved[code] = item
        bom = _text((override or {}).get('bomCode'))
        if bom:
            bom_code_of[code] = bom

    def bom_code_for(tree_code):
        """A block's BOM ID: its own code when given, else its item code."""
        return bom_code_of.get(tree_code) or resolved.get(tree_code, tree_code)

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
            # The root's BOM ID is authored separately from its finished good,
            # so the two can differ — a revision is exactly that case, where the
            # BOM becomes X_R5 while the finished good it builds is unchanged.
            block_bom_id = authored_bom_code or parent_code
            bom_name = authored_name or block_bom_id
        else:
            base_quantity = override.get('baseQuantity') or DEFAULT_BASE_QUANTITY
            block_uom = (_text(override.get('measurementUnit'))
                         or block.get('uom') or DEFAULT_MEASUREMENT_UNIT)
            # Its own code when the user gave it one, otherwise the item's —
            # the same fallback the root uses, so an untouched sheet generates
            # exactly what it always did.
            block_bom_id = bom_code_for(block['bom_id'])
            bom_name = _text(override.get('bomName')) or block_bom_id

        for child in block['children']:
            child_code = resolved.get(child['code'], child['code'])
            child_node = tree.nodes.get(child['code']) or {}
            is_assembly = not child_node.get('is_leaf', True)

            row = OrderedDict((header, '') for header in result.bom_headers)
            row['Finished good code'] = parent_code
            row['BOM ID'] = block_bom_id
            row['BOM name'] = bom_name
            row['Base quantity'] = base_quantity
            row['BOM measurement unit'] = block_uom
            row['Level'] = block['level']
            if is_assembly:
                # The child's BOM ID, not its item code — the two can now
                # differ, and this cell references the BOM.
                row['Sub BOM ID'] = bom_code_for(child['code'])
            else:
                # A leaf is a part, so this cell references the item.
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

    if groups_with_redundant:
        tree.warnings.append({
            'type': 'redundant_alternates',
            'count': len(groups_with_redundant),
            'message': ('Dropped alternates that repeated their own primary on %d BOM '
                        'line(s).' % len(groups_with_redundant)),
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


# --- duplicate policy ---------------------------------------------------------
#
# A part can legitimately appear on multiple BOM rows: three assemblies each
# consuming one screw is three separate rows of "screw" — the BOM needs all
# three. When those rows carry the same Raw material code and everything ELSE
# matches (description, MPN, manufacturer, UOM, sub-BOM id, alternates), the
# only differences are the sheet's structural columns: Level (which sub-assembly
# holds the part) and Quantity. The user decides what to do about that.
#
# The rule the caller enforces: rows in the same "identity group" are
# byte-identical on every column EXCEPT Level and Quantity. Two rows that
# disagree on Description, MPN, or Manufacturer are NOT the same part and never
# go into a group together — they are a separate concern reported by validation.

# Columns whose values do NOT enter the identity signature. Everything else
# does. Kept as a set of exact FactWise header labels so the signature works
# on both dict and list rows.
#
# Level + Quantity are what the policy negotiates over.
# The parent-BOM columns (Finished good code, BOM ID, BOM name, Base quantity,
# BOM measurement unit) are excluded too — they identify WHICH sub-assembly
# a row hangs under, and the whole point of the feature is to catch one part
# used in two different sub-assemblies. If we left them in the signature, a
# screw at Level 1 under FG=CPN1 and the same screw at Level 2 under
# sub-BOM CPN9 would never group (their parent-BOM columns differ), and the
# user would be told "no duplicates" for the exact case they're trying to
# consolidate.
BOM_DUP_IGNORED_COLUMNS = {
    'Level',
    'Quantity',
    'Finished good code',
    'BOM ID',
    'BOM name',
    'Base quantity',
    'BOM measurement unit',
    'BOM currency',
}


def _bom_row_signature(row, headers):
    """Identity signature for a BOM row: every cell EXCEPT Level and Quantity.

    Two rows share a signature iff they describe the same physical part in the
    same relation to the same parent BOM (Finished good code, Sub BOM ID,
    Alternate raw material code, etc. all match). Level and Quantity are what
    the policy is negotiating over, so they are excluded here.
    """
    def cell(header):
        raw = row.get(header) if isinstance(row, dict) else ''
        return str(raw or '').strip()
    return tuple(
        (header, cell(header))
        for header in headers
        if header not in BOM_DUP_IGNORED_COLUMNS
    )


def _record_identity(record):
    """A dict record's item identity: prefer Item code, fall back to CPN."""
    return (
        str(record.get(F_ITEM_CODE) or '').strip()
        or str(record.get(F_CPN) or '').strip()
    )


# Columns of a normalized record that are NOT part of the identity signature.
#
# level + quantity are what the policy is negotiating.
#
# parentKey / parent describe WHERE in the tree the row hangs — the whole
# feature exists to consolidate the same part used in different sub-
# assemblies, so tree location must not enter identity. If we kept parentKey
# in the signature, a screw at L2 under CPN1 and the same screw at L3 under
# CPN9 would never group together.
#
# sourceRow / __grid_row__ are per-row unique ids that always differ.
# rule / confidence / discardedText are normalizer diagnostics.
_RECORD_IDENTITY_SKIP = {
    F_LEVEL, F_QUANTITY, F_SOURCE_ROW,
    F_PARENT_KEY, 'parent',
    '__grid_row__',
    'rule', 'confidence', 'discardedText',
}


def _record_signature(record):
    keys = sorted(k for k in record.keys() if k not in _RECORD_IDENTITY_SKIP)
    return tuple((k, str(record.get(k) or '').strip()) for k in keys)


def find_records_duplicate_groups(records):
    """Detect duplicate item groups in the normalizer's records list.

    Same shape / semantics as ``find_grid_duplicate_groups`` but runs on
    dict-shaped records after the grid↔source merge. Preferred over the grid
    variant because the merge can drop or add records (deleted grid rows,
    inferred parents) — so the record list is what actually feeds BOM
    generation.
    """
    if not records:
        return []
    buckets = OrderedDict()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        identity = _record_identity(record)
        if not identity:
            continue
        sig = (identity, _record_signature(record))
        buckets.setdefault(sig, []).append(index)

    groups = []
    for (identity, sig), indices in buckets.items():
        if len(indices) < 2:
            continue
        first = records[indices[0]]
        description = str(first.get(F_DESCRIPTION) or '').strip()
        levels_seen = []
        occurrences = []
        for i in indices:
            r = records[i]
            level = str(r.get(F_LEVEL) or '').strip()
            qty = str(r.get(F_QUANTITY) or '').strip()
            occurrences.append({'row_index': i, 'level': level, 'quantity': qty})
            if level not in levels_seen:
                levels_seen.append(level)
        level_counts = {}
        for occ in occurrences:
            level_counts[occ['level']] = level_counts.get(occ['level'], 0) + 1
        has_same_level = any(c > 1 for c in level_counts.values())
        has_across_level = len(level_counts) > 1
        if has_same_level and has_across_level:
            kind = 'both'
        elif has_same_level:
            kind = 'same_level'
        else:
            kind = 'across_level'
        signature_id = 'g%08x' % (abs(hash(sig)) & 0xFFFFFFFF)
        groups.append({
            'signature_id': signature_id,
            'raw_material_code': identity,
            'description': description,
            'occurrences': occurrences,
            'kind': kind,
            'levels': levels_seen,
        })
    return groups


def apply_records_duplicate_policy(records, policy, per_group_target_level=None):
    """Apply a duplicate-handling policy to a normalized records list.

    Records use ``F_QUANTITY`` / ``F_LEVEL`` for the fields the policy
    negotiates, so mutation is straightforward. Returns a new list of records.
    """
    if policy not in VALID_DUP_POLICIES:
        raise ValueError('Unknown duplicate policy: %r' % policy)
    per_group_target_level = per_group_target_level or {}
    groups = find_records_duplicate_groups(records)
    if not groups:
        return list(records)

    row_to_group = {}
    for group in groups:
        gid = group['signature_id']
        target = per_group_target_level.get(gid) or group['levels'][0]
        for occ in group['occurrences']:
            row_to_group[occ['row_index']] = (gid, target)

    output = []
    per_bucket_qty = {}
    per_bucket_written = {}
    per_group_qty_total = {}
    per_group_written = {}

    for index, record in enumerate(records):
        if index not in row_to_group:
            output.append(dict(record) if isinstance(record, dict) else record)
            continue
        gid, target_level = row_to_group[index]
        row_level = str(record.get(F_LEVEL) or '').strip()
        row_qty = _num(record.get(F_QUANTITY))

        def write(target_record, qty=None, level=None):
            if qty is not None:
                target_record[F_QUANTITY] = _format_qty(qty)
            if level is not None:
                target_record[F_LEVEL] = level

        if policy == POLICY_KEEP_AT_ALL_LEVELS:
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write(output[per_bucket_written[bucket]], qty=per_bucket_qty[bucket])
                continue
            new_row = dict(record)
            write(new_row, qty=per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_IGNORE_OTHER_LEVELS:
            if row_level != target_level:
                continue
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write(output[per_bucket_written[bucket]], qty=per_bucket_qty[bucket])
                continue
            new_row = dict(record)
            write(new_row, qty=per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_PER_LEVEL:
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write(output[per_bucket_written[bucket]], qty=per_bucket_qty[bucket])
                continue
            new_row = dict(record)
            write(new_row, qty=per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_ALL_TO_ONE_LEVEL:
            per_group_qty_total[gid] = per_group_qty_total.get(gid, 0.0) + row_qty
            if gid in per_group_written:
                write(output[per_group_written[gid]], qty=per_group_qty_total[gid])
                continue
            new_row = dict(record)
            write(new_row, qty=per_group_qty_total[gid], level=target_level)
            per_group_written[gid] = len(output)
            output.append(new_row)

    return output


def find_grid_duplicate_groups(headers, rows):
    """Find duplicate item groups in the RAW editor grid (before BOM tree
    collapse). This is what the user sees in the mapper and what the
    dup-policy dialog exposes.

    Two rows are "the same item" iff they carry the same non-empty ``Item code``
    (fallback ``CPN Code``) AND every column matches except ``Level`` and
    ``Quantity`` (and the internal ``Base BOM Qty`` counterpart). Rows that
    disagree on Description, MPN, Manufacturer, etc. are NOT grouped — they
    are two different parts sharing a code, which validation catches later.

    Returns the same shape as ``find_bom_duplicate_groups``:
        [
          {'signature_id', 'raw_material_code', 'description',
           'kind': 'same_level' | 'across_level' | 'both',
           'levels': [...],
           'occurrences': [{'row_index', 'level', 'quantity'}, ...]},
          ...
        ]
    Only groups with 2+ rows are returned. row_index is the grid row
    position (0-based).
    """
    if not rows or not headers:
        return []

    # Locate the columns we care about, tolerant of the mapper's suffix
    # variants ("Item code" / "CPN Code" / "Level" / "Quantity"). Comparison is
    # by normalized label so "Item code" and "item code" match cleanly.
    def norm(name):
        return re.sub(r'[^a-z0-9]+', ' ', str(name or '').lower()).strip()

    def index_of(*labels):
        wanted = {norm(l) for l in labels}
        for i, h in enumerate(headers):
            if norm(h) in wanted:
                return i
        return -1

    code_i = index_of('Item code')
    cpn_i = index_of('CPN Code')
    level_i = index_of('Level')
    qty_i = index_of('Quantity')
    base_qty_i = index_of('Base BOM Qty')
    desc_i = index_of('Description')

    if code_i < 0 and cpn_i < 0:
        return []

    ignored_positions = {p for p in (level_i, qty_i, base_qty_i) if p >= 0}

    def cell(row, position):
        if position < 0 or position >= len(row):
            return ''
        return str(row[position] or '').strip()

    def signature(row):
        # Every cell except Level / Quantity / Base BOM Qty (dictionary
        # order via enumeration, so a two-row grid with the same values in
        # the same columns always matches). Row is a list here — the mapper
        # stores its grid as positional lists.
        parts = []
        for i in range(len(headers)):
            if i in ignored_positions:
                continue
            parts.append(cell(row, i))
        return tuple(parts)

    buckets = OrderedDict()
    for index, row in enumerate(rows):
        if not isinstance(row, list):
            continue
        item_code = cell(row, code_i) or cell(row, cpn_i)
        if not item_code:
            continue
        sig = (item_code, signature(row))
        buckets.setdefault(sig, []).append(index)

    groups = []
    for (item_code, sig), indices in buckets.items():
        if len(indices) < 2:
            continue
        first = rows[indices[0]]
        description = cell(first, desc_i)
        levels_seen = []
        occurrences = []
        for i in indices:
            row = rows[i]
            level = cell(row, level_i)
            qty = cell(row, qty_i)
            occurrences.append({'row_index': i, 'level': level, 'quantity': qty})
            if level not in levels_seen:
                levels_seen.append(level)
        level_counts = {}
        for occ in occurrences:
            level_counts[occ['level']] = level_counts.get(occ['level'], 0) + 1
        has_same_level = any(c > 1 for c in level_counts.values())
        has_across_level = len(level_counts) > 1
        if has_same_level and has_across_level:
            kind = 'both'
        elif has_same_level:
            kind = 'same_level'
        else:
            kind = 'across_level'
        signature_id = 'g%08x' % (abs(hash(sig)) & 0xFFFFFFFF)
        groups.append({
            'signature_id': signature_id,
            'raw_material_code': item_code,
            'description': description,
            'occurrences': occurrences,
            'kind': kind,
            'levels': levels_seen,
        })
    return groups


def find_bom_duplicate_groups(bom_rows, bom_headers):
    """Find groups of BOM rows describing the same part more than once.

    Returns a list of groups. Each group is a dict:
        {
          'signature_id': str,           # stable id per group (hash of sig)
          'raw_material_code': str,      # for display
          'description': str,            # for display
          'occurrences': [
              {'row_index': int, 'level': str, 'quantity': str},
              ...
          ],
          'kind': 'same_level' | 'across_level' | 'both',
          'levels': [str, ...],          # distinct levels in the group
        }

    Only groups with 2+ occurrences are returned. A single-occurrence "group"
    is not a duplicate; the caller does not need to hear about it.

    Signatures are built over every BOM column except Level and Quantity, so
    two rows disagreeing on Description/MPN/Manufacturer/etc. never collide.
    Those are a different problem, reported by validation.
    """
    if not bom_rows or not bom_headers:
        return []

    buckets = OrderedDict()
    for index, row in enumerate(bom_rows):
        signature = _bom_row_signature(row, bom_headers)
        buckets.setdefault(signature, []).append(index)

    groups = []
    for signature, indices in buckets.items():
        if len(indices) < 2:
            continue
        # Stable id from the signature — a hash keeps it short but survives
        # a JSON round-trip (tuples don't) so callers can round-trip a
        # policy keyed on it.
        signature_id = 'g%08x' % (abs(hash(signature)) & 0xFFFFFFFF)
        first_row = bom_rows[indices[0]]
        raw_code = (first_row.get('Raw material code') if isinstance(first_row, dict) else '') or ''
        sub_bom = (first_row.get('Sub BOM ID') if isinstance(first_row, dict) else '') or ''
        description = (first_row.get('Description') if isinstance(first_row, dict) else '') or ''
        occurrences = []
        levels_seen = []
        for i in indices:
            row = bom_rows[i]
            level = str((row.get('Level') if isinstance(row, dict) else '') or '').strip()
            qty = str((row.get('Quantity') if isinstance(row, dict) else '') or '').strip()
            occurrences.append({'row_index': i, 'level': level, 'quantity': qty})
            if level not in levels_seen:
                levels_seen.append(level)
        # Classify: same-level dup if any level has >1 occurrence; across-level
        # dup if there are 2+ distinct levels; both if both apply.
        level_counts = {}
        for occ in occurrences:
            level_counts[occ['level']] = level_counts.get(occ['level'], 0) + 1
        has_same_level = any(c > 1 for c in level_counts.values())
        has_across_level = len(level_counts) > 1
        if has_same_level and has_across_level:
            kind = 'both'
        elif has_same_level:
            kind = 'same_level'
        else:
            kind = 'across_level'
        groups.append({
            'signature_id': signature_id,
            'raw_material_code': raw_code or sub_bom,
            'description': description,
            'occurrences': occurrences,
            'kind': kind,
            'levels': levels_seen,
        })
    return groups


# The four policies the user can pick for each duplicate group. See the
# feature spec 2026-08-17: user asked for these four exact modes.
POLICY_IGNORE_OTHER_LEVELS = 'ignore_other_levels'      # 1
POLICY_KEEP_AT_ALL_LEVELS = 'keep_at_all_levels'        # 2
POLICY_AGGREGATE_PER_LEVEL = 'aggregate_per_level'      # 3
POLICY_AGGREGATE_ALL_TO_ONE_LEVEL = 'aggregate_all_to_one_level'  # 4

VALID_DUP_POLICIES = {
    POLICY_IGNORE_OTHER_LEVELS,
    POLICY_KEEP_AT_ALL_LEVELS,
    POLICY_AGGREGATE_PER_LEVEL,
    POLICY_AGGREGATE_ALL_TO_ONE_LEVEL,
}


def _num(value):
    """Best-effort float parse; blank/garbage → 0.0 so aggregation adds cleanly."""
    if value is None:
        return 0.0
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def apply_bom_duplicate_policy(bom_rows, bom_headers, policy, per_group_target_level=None):
    """Rewrite ``bom_rows`` according to a duplicate-handling policy.

    Args:
      bom_rows: list of dict rows (as produced by generate_flat_bom /
                generate_multi_level_bom before bom_rows_as_lists flattens
                them). Mutation-safe: this returns a new list.
      bom_headers: the header list in sheet order.
      policy: one of the POLICY_* constants above.
      per_group_target_level: dict {signature_id: level} — required for
                policies 1 and 4 to know which level survives. Extra entries
                are ignored; missing entries fall back to the group's FIRST
                level (usually the lowest / earliest in sheet order).

    Behaviour per policy:
      IGNORE_OTHER_LEVELS       Keep only the rows at the target level for
                                each group. If multiple rows exist at that
                                target level (same-level dups), their qty is
                                summed into one row.
      KEEP_AT_ALL_LEVELS        Leave rows exactly as they are. Same-level
                                dups are still summed into one row per level
                                (a same-level dup can never NOT be an error).
      AGGREGATE_PER_LEVEL       Collapse to ONE row per (identity, level).
                                Qty at each level = sum of that identity's
                                rows at that level. Across-level dups stay
                                separate.
      AGGREGATE_ALL_TO_ONE_LEVEL Collapse to ONE row per identity, placed at
                                the target level. Qty = sum across ALL levels.

    Rows outside any duplicate group are unchanged.
    """
    if policy not in VALID_DUP_POLICIES:
        raise ValueError('Unknown duplicate policy: %r' % policy)

    per_group_target_level = per_group_target_level or {}
    groups = find_bom_duplicate_groups(bom_rows, bom_headers)
    if not groups:
        return list(bom_rows)

    # Map row_index -> (signature_id, target_level_for_that_group) for fast
    # lookup while walking the row list.
    row_to_group = {}
    group_by_id = {}
    for group in groups:
        gid = group['signature_id']
        group_by_id[gid] = group
        target_level = per_group_target_level.get(gid) or group['levels'][0]
        for occ in group['occurrences']:
            row_to_group[occ['row_index']] = (gid, target_level)

    output = []
    # For AGGREGATE_PER_LEVEL and IGNORE_OTHER_LEVELS: track qty accumulator
    # per (signature_id, level) so we can rewrite once and skip subsequent
    # rows in the group.
    per_bucket_qty = {}
    per_bucket_written = {}
    # For AGGREGATE_ALL_TO_ONE_LEVEL: one accumulator per group.
    per_group_qty_total = {}
    per_group_written = {}

    for index, row in enumerate(bom_rows):
        if index not in row_to_group:
            output.append(dict(row) if isinstance(row, dict) else row)
            continue
        gid, target_level = row_to_group[index]
        row_level = str((row.get('Level') if isinstance(row, dict) else '') or '').strip()
        row_qty = _num(row.get('Quantity') if isinstance(row, dict) else '')

        if policy == POLICY_KEEP_AT_ALL_LEVELS:
            # Same-level dup rows still collapse to one row per level with
            # summed qty — a same-level dup is never valid to keep as two rows.
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                # Later same-level occurrence — update the earlier row's qty
                # and drop this one.
                written_index = per_bucket_written[bucket]
                output[written_index]['Quantity'] = _format_qty(per_bucket_qty[bucket])
                continue
            new_row = dict(row)
            new_row['Quantity'] = _format_qty(per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_IGNORE_OTHER_LEVELS:
            # Only rows at the target level survive. Multiple survivors sum.
            if row_level != target_level:
                continue
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                written_index = per_bucket_written[bucket]
                output[written_index]['Quantity'] = _format_qty(per_bucket_qty[bucket])
                continue
            new_row = dict(row)
            new_row['Quantity'] = _format_qty(per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_PER_LEVEL:
            # Same identity + same level collapses. Across-level rows stay
            # as their own (identity, level) row.
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                written_index = per_bucket_written[bucket]
                output[written_index]['Quantity'] = _format_qty(per_bucket_qty[bucket])
                continue
            new_row = dict(row)
            new_row['Quantity'] = _format_qty(per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_ALL_TO_ONE_LEVEL:
            # One row per identity, placed at target_level, qty = total sum.
            per_group_qty_total[gid] = per_group_qty_total.get(gid, 0.0) + row_qty
            if gid in per_group_written:
                written_index = per_group_written[gid]
                output[written_index]['Quantity'] = _format_qty(per_group_qty_total[gid])
                continue
            new_row = dict(row)
            new_row['Level'] = target_level
            new_row['Quantity'] = _format_qty(per_group_qty_total[gid])
            per_group_written[gid] = len(output)
            output.append(new_row)

    return output


def _format_qty(value):
    """Render a float qty as the sheet would — integer when whole, else short decimal."""
    if value == int(value):
        return str(int(value))
    # Trim trailing zeros for tidy display but preserve precision.
    return ('%.6f' % value).rstrip('0').rstrip('.')


def apply_grid_duplicate_policy(headers, rows, policy, per_group_target_level=None):
    """Apply a duplicate-handling policy to RAW editor grid rows.

    Mirrors ``apply_bom_duplicate_policy`` but operates on the mapper's grid
    (positional lists keyed by ``headers``) instead of the generated BOM
    rows. Detection runs on the grid (before the BOM tree collapses same-code
    same-parent rows), so the policy has to be applied at the same layer for
    the signature_ids to line up.

    Args:
      headers: list[str] — grid column names.
      rows: list[list] — positional row cells matching ``headers``.
      policy: one of VALID_DUP_POLICIES.
      per_group_target_level: {signature_id: level} for policies that need it.

    Returns a new list of rows.
    """
    if policy not in VALID_DUP_POLICIES:
        raise ValueError('Unknown duplicate policy: %r' % policy)

    per_group_target_level = per_group_target_level or {}
    groups = find_grid_duplicate_groups(headers, rows)
    if not groups:
        return list(rows)

    def norm(name):
        return re.sub(r'[^a-z0-9]+', ' ', str(name or '').lower()).strip()

    def index_of(*labels):
        wanted = {norm(l) for l in labels}
        for i, h in enumerate(headers):
            if norm(h) in wanted:
                return i
        return -1

    level_i = index_of('Level')
    qty_i = index_of('Quantity')
    if qty_i < 0:
        # Nothing to aggregate; return input untouched to avoid silent damage.
        return list(rows)

    row_to_group = {}
    for group in groups:
        gid = group['signature_id']
        target = per_group_target_level.get(gid) or group['levels'][0]
        for occ in group['occurrences']:
            row_to_group[occ['row_index']] = (gid, target)

    def cell(row, position):
        if position < 0 or position >= len(row):
            return ''
        return str(row[position] or '').strip()

    output = []
    per_bucket_qty = {}
    per_bucket_written = {}
    per_group_qty_total = {}
    per_group_written = {}

    for index, row in enumerate(rows):
        if index not in row_to_group:
            output.append(list(row) if isinstance(row, list) else row)
            continue
        if not isinstance(row, list):
            output.append(row)
            continue
        gid, target_level = row_to_group[index]
        row_level = cell(row, level_i)
        row_qty = _num(row[qty_i]) if qty_i < len(row) else 0.0

        def write_qty(target_row, value):
            while len(target_row) <= qty_i:
                target_row.append('')
            target_row[qty_i] = _format_qty(value)

        def write_level(target_row, value):
            if level_i < 0:
                return
            while len(target_row) <= level_i:
                target_row.append('')
            target_row[level_i] = value

        if policy == POLICY_KEEP_AT_ALL_LEVELS:
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write_qty(output[per_bucket_written[bucket]], per_bucket_qty[bucket])
                continue
            new_row = list(row)
            write_qty(new_row, per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_IGNORE_OTHER_LEVELS:
            if row_level != target_level:
                continue
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write_qty(output[per_bucket_written[bucket]], per_bucket_qty[bucket])
                continue
            new_row = list(row)
            write_qty(new_row, per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_PER_LEVEL:
            bucket = (gid, row_level)
            per_bucket_qty[bucket] = per_bucket_qty.get(bucket, 0.0) + row_qty
            if bucket in per_bucket_written:
                write_qty(output[per_bucket_written[bucket]], per_bucket_qty[bucket])
                continue
            new_row = list(row)
            write_qty(new_row, per_bucket_qty[bucket])
            per_bucket_written[bucket] = len(output)
            output.append(new_row)

        elif policy == POLICY_AGGREGATE_ALL_TO_ONE_LEVEL:
            per_group_qty_total[gid] = per_group_qty_total.get(gid, 0.0) + row_qty
            if gid in per_group_written:
                write_qty(output[per_group_written[gid]], per_group_qty_total[gid])
                continue
            new_row = list(row)
            write_level(new_row, target_level)
            write_qty(new_row, per_group_qty_total[gid])
            per_group_written[gid] = len(output)
            output.append(new_row)

    return output
