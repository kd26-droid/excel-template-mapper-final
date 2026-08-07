"""Derive BOM tree structure from a level column.

This is the spine of BOM generation. Item directory generation, BOM sheet
generation, the tree preview and BOM validation all read what this produces;
none of them re-derive structure themselves.

The input is normalized rows plus the name of the column holding the level. The
customer sheet supplies levels only — parent links are derived from row order,
because almost no customer sheet carries an explicit parent column.

Rules (see BOM_GENERATION_PLAN.md section 5):

    level        integer, >= 0, never jumps by more than +1
    parent       nearest row above whose level is exactly one less
    leaf         no deeper level follows before the level returns to its own
    block        one parent node that has children
    block level  depth of that parent, 1-based from the top of the sheet

Note that a BOM row's ``Level`` is its *parent's* depth, not its own. Level is a
property of the block, and every row in a block shares it.
"""

import re
from collections import OrderedDict


# Rafael-style exports wrap every cell as =CONCATENATE("  3"). The quoted text
# matters twice over: it carries the value *and* its leading spaces encode the
# indent, so the quotes have to be unwrapped without stripping what is inside.
_CONCATENATE_RE = re.compile(r'^\s*=\s*CONCATENATE\s*\(\s*"(.*)"\s*\)\s*$', re.IGNORECASE)


def unwrap_cell(value):
    """Return the literal text of a cell, unwrapping spreadsheet formula noise."""
    if value is None:
        return ''
    text = str(value)
    match = _CONCATENATE_RE.match(text)
    if match:
        text = match.group(1)
    return text


def parse_level(value):
    """Parse a level cell into an int, or None when it is not a level.

    Accepts ``3``, ``3.0``, ``"  3"`` (indent-encoded) and
    ``=CONCATENATE("  3")``. Returns None for blanks and non-numeric text so the
    caller can skip title/section rows rather than guessing at them.
    """
    text = unwrap_cell(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    level = int(number)
    if level != number or level < 0:
        return None
    return level


class BomTreeError(Exception):
    """Raised when the rows cannot form a tree at all."""


_DASH_RE = re.compile(r'^[-‐-―]+$')


def parse_quantity(value):
    """Parse a quantity cell into a float, or None when it is not a number.

    Customer sheets write "not consumed" three different ways in the same file —
    THALES uses ``---`` for drawings, blank for section rows, and ``0`` for
    Gerber/paste data. All three parse to None or 0 here so one rule covers them.
    """
    text = unwrap_cell(value).strip()
    if not text or _DASH_RE.match(text):
        return None
    try:
        return float(text.replace(',', ''))
    except (TypeError, ValueError):
        return None


def is_document_row(record, quantity_column, code_column=None):
    """True when a row describes a document rather than a consumed part.

    Two things have to be true, not one.

    A BOM line says "this assembly consumes N of that part", so a row consuming
    nothing is a candidate - THALES files drawings (``Qty = ---``) and electronic
    data (``Qty = 0``) in the same table as its parts.

    But consuming nothing is NOT sufficient, and treating it as sufficient
    deleted real components. A drawing has no part number by design; a component
    has one whatever its quantity says. Honeywell's export writes ``0`` on 17
    genuine parts - a light sensor, an SSR relay, and 12 sub-assemblies - and
    dropping those removed whole branches of the tree from the generated BOM,
    reported only as a soft "some items are unused" warning.

    So a row is a document only when it consumes nothing AND carries no part
    number. Anything with a code stays, and a zero quantity on it is then caught
    by validation, where the user can see it and decide.
    """
    if not quantity_column:
        return False
    quantity = parse_quantity(record.get(quantity_column))
    if quantity is not None and quantity > 0:
        return False
    if code_column and unwrap_cell(record.get(code_column)).strip():
        return False
    return True


class BomTree(object):
    """The derived structure. Plain data — no formatting decisions live here."""

    def __init__(self, rows, nodes, blocks, errors, warnings, min_level,
                 documents=None, root_code=None):
        self.rows = rows            # per input row, with parent/leaf/depth added
        self.nodes = nodes          # code -> node dict (deduplicated)
        self.blocks = blocks        # list of block dicts, order preserved
        self.errors = errors        # structural failures; block generation
        self.warnings = warnings    # survivable oddities
        self.min_level = min_level
        self.documents = documents or []   # rows excluded as documents/data
        self.root_code = root_code         # authored root, when one was supplied

    @property
    def is_valid(self):
        return not self.errors

    @property
    def roots(self):
        return [row for row in self.rows if row['parent'] is None]

    def summary(self):
        """Counts for logging and tests.

        Rows and nodes are counted separately on purpose: a part used in three
        sub-assemblies is three leaf *rows* but one leaf *node*. Conflating them
        is the easiest way to misread this structure, so neither key is called
        plain "leaves".
        """
        leaf_rows = sum(1 for row in self.rows if row['is_leaf'])
        leaf_nodes = sum(1 for node in self.nodes.values() if node['is_leaf'])
        return {
            'rows': len(self.rows),
            'documents': len(self.documents),
            'nodes': len(self.nodes),
            'blocks': len(self.blocks),
            'roots': len(self.roots),
            'leaf_rows': leaf_rows,
            'assembly_rows': len(self.rows) - leaf_rows,
            'leaf_nodes': leaf_nodes,
            'assembly_nodes': len(self.nodes) - leaf_nodes,
            'errors': len(self.errors),
            'warnings': len(self.warnings),
        }


def derive_tree(records, level_column, code_column,
                description_column=None, quantity_column=None, uom_column=None,
                root=None, drop_documents=True, parent_column=None):
    """Derive tree structure from ``records`` (a list of dicts).

    Rows whose level cell does not parse are skipped and reported as warnings —
    that is how title banners, blank separators and section markers get dropped
    without special-casing any particular customer's layout.

    ``root`` is the level-0 finished good when the sheet does not contain it.
    THALES-style exports name the assembly in a preamble block above the table
    and start the table at level 1, so without this the level-1 rows look like
    several unrelated BOMs. When supplied, every top-level row is adopted by it.

    ``drop_documents`` removes rows that consume nothing (see ``is_document_row``).
    They are returned on the tree rather than discarded silently, so the caller
    can show what was excluded.

    ``parent_column`` names a column that states each row's parent outright. When
    any row fills it, the tree is built from those statements and the levels are
    not used to infer structure - an explicit answer beats one reconstructed from
    row order. Sheets without such a column are unaffected.
    """
    if not level_column:
        raise BomTreeError('A level column is required to derive a BOM tree.')
    if not code_column:
        raise BomTreeError('An item code column is required to derive a BOM tree.')

    errors = []
    warnings = []
    rows = []
    documents = []

    for index, record in enumerate(records or []):
        level = parse_level(record.get(level_column))
        code = unwrap_cell(record.get(code_column)).strip()
        if level is None:
            if any(str(v or '').strip() for v in record.values()):
                warnings.append({
                    'type': 'unparsable_level',
                    'row': index,
                    'message': 'Row skipped: level is blank or not a whole number.',
                })
            continue
        # Document rows are checked before the missing-code rule so that a
        # drawing (which has no part number by design) is reported as what it is
        # rather than as data loss.
        if drop_documents and quantity_column and is_document_row(record, quantity_column, code_column):
            documents.append({
                'row': index,
                'level': level,
                'code': code,
                'description': unwrap_cell(record.get(description_column)).strip() if description_column else '',
                'quantity': unwrap_cell(record.get(quantity_column)).strip(),
                # Kept so the caller can drop the same rows from the item sheet.
                # A drawing is not an item any more than it is a BOM line.
                'source': record,
            })
            continue
        if not code:
            warnings.append({
                'type': 'missing_code',
                'row': index,
                'message': 'Row skipped: no item code.',
            })
            continue
        rows.append({
            'row': index,
            'level': level,
            'code': code,
            'description': unwrap_cell(record.get(description_column)).strip() if description_column else '',
            'quantity': unwrap_cell(record.get(quantity_column)).strip() if quantity_column else '',
            'uom': unwrap_cell(record.get(uom_column)).strip() if uom_column else '',
            'parent': None,
            # What the sheet SAYS this row's parent is, when it says so at all.
            # Kept separate from 'parent' above, which is the resolved answer.
            'stated_parent': (unwrap_cell(record.get(parent_column)).strip()
                              if parent_column else ''),
            'depth': 0,
            'is_leaf': True,
            'source': record,
        })

    if not rows:
        raise BomTreeError('No rows with a usable level and item code were found.')

    min_level = min(row['level'] for row in rows)

    # Two ways to answer "what is this row's parent?", and the sheet decides.
    #
    # A sheet that names the parent outright is answering it directly, and that
    # answer is absolute: shuffle every row and the tree is identical. Inferring
    # from levels instead makes ROW ORDER part of the data, which is far more
    # fragile - a single mis-ordered row silently reparents everything under it.
    # So an explicit parent wins wherever one is given.
    stated = any(row['stated_parent'] for row in rows)

    if stated:
        # A row naming itself as its own parent is how these exports mark a root
        # (AMAT writes PARENT_PART == PART_NUMBER on the assembly line).
        known = {row['code'] for row in rows}
        for row in rows:
            parent = row['stated_parent']
            row['depth'] = row['level'] - min_level
            if not parent or parent == row['code']:
                row['parent'] = None
                continue
            if parent not in known:
                errors.append({
                    'type': 'parent_not_found',
                    'row': row['row'],
                    'code': row['code'],
                    'parent': parent,
                    'message': ('Row names "%s" as its parent, but no row in this '
                                'sheet has that code.' % parent),
                })
                row['parent'] = None
                continue
            row['parent'] = parent
    else:
        # Level inference. `open_at` holds the most recent code seen at each
        # level, so a row's parent is whatever is currently open one level above
        # it. Deeper entries are discarded on the way back up, which is what
        # stops a finished branch from adopting rows belonging to the next one.
        open_at = {}
        for row in rows:
            level = row['level']
            row['depth'] = level - min_level
            if level == min_level:
                row['parent'] = None
            else:
                parent = open_at.get(level - 1)
                if parent is None:
                    errors.append({
                        'type': 'orphan_row',
                        'row': row['row'],
                        'code': row['code'],
                        'level': level,
                        'message': (
                            'Level %d has no level %d row above it, so its parent '
                            'cannot be determined.' % (level, level - 1)
                        ),
                    })
                row['parent'] = parent
            open_at[level] = row['code']
            for deeper in [key for key in open_at if key > level]:
                del open_at[deeper]

    # Leaf classification. A row is an assembly when the row immediately after it
    # sits deeper; anything else terminates the branch.
    for position, row in enumerate(rows):
        following = rows[position + 1] if position + 1 < len(rows) else None
        row['is_leaf'] = not (following and following['level'] > row['level'])

    _detect_level_jumps(rows, errors)

    # An authored root adopts every top-level row, turning a forest into one
    # tree. Its own depth is one above the shallowest row, so the block levels
    # below it stay correctly ordered.
    root_code = unwrap_cell((root or {}).get('code')).strip() if root else ''
    if root_code:
        for row in rows:
            # A sheet that already contains its own root must not adopt it into
            # itself — that is a one-node cycle, not a tree.
            if row['parent'] is None and row['code'] != root_code:
                row['parent'] = root_code
            row['depth'] += 1

    nodes = _collect_nodes(rows)
    if root_code:
        # Inserted first so the item sheet lists the finished good before its
        # components, and re-inserted rather than patched when the code also
        # appears in the table.
        existing = nodes.pop(root_code, None)
        root_node = {
            'code': root_code,
            'description': unwrap_cell((root or {}).get('description')).strip()
                           or (existing or {}).get('description', ''),
            'uom': unwrap_cell((root or {}).get('uom')).strip()
                   or (existing or {}).get('uom', ''),
            'is_leaf': False,
            'occurrences': (existing or {}).get('occurrences', 0) + 1,
            'item_type': 'Finished good',
        }
        nodes = OrderedDict(
            [(root_code, root_node)] + [(k, v) for k, v in nodes.items() if k != root_code]
        )

    blocks = _build_blocks(rows, nodes)
    _detect_cycles(blocks, errors)

    # Several top-level rows mean this is a forest, not one tree. That is not
    # automatically wrong — a workbook may hold several BOMs — so it is reported
    # rather than rejected here, and the generation gate decides. THALES and
    # Rafael both land here without a root; SAFRAN does not.
    root_codes = [row['code'] for row in rows if row['parent'] is None]
    if len(root_codes) > 1:
        warnings.append({
            'type': 'multi_root',
            'count': len(root_codes),
            'codes': root_codes[:10],
            'message': ('%d separate top-level rows were found, so these rows are '
                        'several BOMs rather than one tree.' % len(root_codes)),
        })
    if documents:
        warnings.append({
            'type': 'document_rows',
            'count': len(documents),
            'codes': [d['code'] or d['description'] for d in documents[:10]],
            'message': ('%d rows consume no quantity and were excluded as documents '
                        'or reference data rather than parts.' % len(documents)),
        })

    return BomTree(rows, nodes, blocks, errors, warnings, min_level,
                   documents=documents, root_code=root_code or None)


def _detect_level_jumps(rows, errors):
    """A level may deepen by at most one step at a time."""
    previous = None
    for row in rows:
        if previous is not None and row['level'] > previous['level'] + 1:
            errors.append({
                'type': 'level_jump',
                'row': row['row'],
                'code': row['code'],
                'message': 'Level jumps from %d to %d; it may only increase by one.'
                           % (previous['level'], row['level']),
            })
        previous = row


def _collect_nodes(rows):
    """Deduplicate rows into nodes — one per distinct code.

    A code may legitimately appear many times (a part used in several
    sub-assemblies). It is one item and many BOM rows. Where duplicates disagree,
    the richer description wins, so a machine-generated stub cannot overwrite a
    real one; and any appearance as an assembly makes the node an assembly.
    """
    nodes = OrderedDict()
    for row in rows:
        code = row['code']
        node = nodes.get(code)
        if node is None:
            nodes[code] = {
                'code': code,
                'description': row['description'],
                'uom': row['uom'],
                'is_leaf': row['is_leaf'],
                'occurrences': 1,
            }
            continue
        node['occurrences'] += 1
        if len(row['description']) > len(node['description']):
            node['description'] = row['description']
        if not node['uom'] and row['uom']:
            node['uom'] = row['uom']
        if not row['is_leaf']:
            node['is_leaf'] = False

    for node in nodes.values():
        node['item_type'] = 'Raw material' if node['is_leaf'] else 'Finished good'
    return nodes


def _build_blocks(rows, nodes):
    """Group child rows under the parent that owns them.

    One block per node that has children. ``BOM ID`` and ``BOM name`` are keyed
    off the parent's item code, so a child that is itself an assembly gets
    ``Sub BOM ID`` equal to its own ``BOM ID`` — the link resolves with no
    lookup table and cannot drift between the two exported sheets.
    """
    by_parent = OrderedDict()
    for row in rows:
        if row['parent'] is None:
            continue
        by_parent.setdefault(row['parent'], []).append(row)

    depth_of = {}
    for row in rows:
        depth_of.setdefault(row['code'], row['depth'])

    blocks = []
    for parent_code, children in by_parent.items():
        parent_node = nodes.get(parent_code, {})
        blocks.append({
            'bom_id': parent_code,
            'bom_name': parent_code,
            'finished_good_code': parent_code,
            # Block level is 1-based from the top: the root's own block is 1.
            'level': depth_of.get(parent_code, 0) + 1,
            'description': parent_node.get('description', ''),
            'uom': parent_node.get('uom', ''),
            'children': children,
        })
    return blocks


def _detect_cycles(blocks, errors):
    """A node must never be reachable from itself."""
    children_of = {block['bom_id']: [row['code'] for row in block['children']]
                   for block in blocks}

    WHITE, GREY, BLACK = 0, 1, 2
    colour = {}

    def visit(code, trail):
        state = colour.get(code, WHITE)
        if state == GREY:
            cycle = trail[trail.index(code):] + [code] if code in trail else [code, code]
            errors.append({
                'type': 'cycle',
                'code': code,
                'message': 'Cycle detected: %s' % ' -> '.join(cycle),
            })
            return
        if state == BLACK:
            return
        colour[code] = GREY
        for child in children_of.get(code, []):
            visit(child, trail + [code])
        colour[code] = BLACK

    for bom_id in list(children_of):
        if colour.get(bom_id, WHITE) == WHITE:
            visit(bom_id, [])
