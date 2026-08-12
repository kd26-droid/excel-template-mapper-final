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


# Separators a breadcrumb path might be written with. '/' and '\' are included
# because some exports use them, but a part number can legitimately contain one
# (THALES ships 'QCPF11/041'), so a separator is only ever adopted when it
# demonstrably resolves more parents than leaving the value alone.
PATH_SEPARATORS = ('>', '::', '|', '\\', '/')

# A candidate is rejected if it leaves more than this share of rows pointing at
# a parent that does not exist. Not zero: one malformed row should not veto a
# reading that works for the other eight hundred.
PATH_UNRESOLVED_TOLERANCE = 0.05


def _path_parent(value, separator, take_leaf):
    """Pull the parent's code out of one breadcrumb path."""
    segments = [segment.strip() for segment in value.split(separator)]
    segments = [segment for segment in segments if segment]
    if not segments:
        return ''
    if take_leaf:
        # The path names the parent, so its last segment is the parent.
        return segments[-1]
    # The path is the row's own trail, so the parent is the segment before the
    # row itself. A one-segment trail is the root and has no parent.
    return segments[-2] if len(segments) > 1 else ''


def _report_unusable_parent_paths(stated_rows, known, warnings):
    """Explain a parent column of paths that match nothing in the code column.

    Paths are built out of SOME identifier. When they match none of the codes,
    the usual cause is that the wrong source column was mapped as the part
    number - the paths are fine, the identity is not. Left alone this produces
    one parent_not_found per row and no clue which column to fix, so look for
    the column the paths were actually built from and name it.
    """
    segments = set()
    for row in stated_rows:
        for separator in PATH_SEPARATORS:
            if separator in row['stated_parent']:
                segments.update(part.strip()
                                for part in row['stated_parent'].split(separator)
                                if part.strip())
                break
    if not segments or segments & known:
        return

    # Every column of every row, scored by how much of it the paths are made of.
    tally = {}
    for row in stated_rows:
        for column, value in (row.get('source') or {}).items():
            text = unwrap_cell(value).strip()
            if not text:
                continue
            seen, hit = tally.setdefault(column, [0, 0])
            tally[column] = [seen + 1, hit + (1 if text in segments else 0)]

    best = ''
    best_share = 0.0
    for column, (seen, hit) in tally.items():
        share = hit / seen if seen else 0.0
        if share > best_share:
            best, best_share = column, share

    note = {
        'type': 'parent_paths_unusable',
        'count': len(stated_rows),
        'message': ('The parent column holds paths, but none of their segments '
                    'match a part number on this sheet, so no row can be placed.'),
    }
    if best_share >= 0.9:
        note['suggested_column'] = best
        note['message'] += (' They are built from "%s" - map that column as the '
                            'part number and re-run.' % best)
    warnings.append(note)


def _unpack_stated_parent_paths(rows, warnings):
    """Rewrite breadcrumb-path parents into plain parent codes, in place.

    A sheet may answer "what is this row's parent?" with a whole path rather
    than a code, and it may write either the parent's path or the row's own
    path. Both are unusable as given: the value is matched against row codes and
    never matches, so every row reports parent_not_found and the BOM comes out
    empty.

    Which convention a sheet uses cannot be assumed, so it is measured. Every
    (separator, reading) pair is scored by the number of real parent-child edges
    it produces, and one is adopted only if it beats leaving the values alone.
    Scoring counts edges rather than "did it resolve" on purpose: reading a
    row's own path as its parent's makes every row its own parent, which
    resolves perfectly and yields a tree of roots that says nothing.

    A sheet of plain codes contains no separator, scores no candidates, and is
    left untouched.
    """
    stated_rows = [row for row in rows if row['stated_parent']]
    if not stated_rows:
        return
    known = {row['code'] for row in rows if row['code']}
    tolerance = len(stated_rows) * PATH_UNRESOLVED_TOLERANCE

    def score(derive):
        """Edge count for one reading, or None if too much of it dangles."""
        edges = 0
        unresolved = 0
        for row in stated_rows:
            parent = derive(row)
            if not parent or parent == row['code']:
                continue  # a root; correct, but says nothing about structure
            if parent not in known:
                unresolved += 1
                if unresolved > tolerance:
                    return None
                continue
            edges += 1
        return edges

    baseline = score(lambda row: row['stated_parent'])
    if baseline is not None and baseline == len(stated_rows):
        return  # already plain codes, every row placed

    best = None
    for separator in PATH_SEPARATORS:
        if not any(separator in row['stated_parent'] for row in stated_rows):
            continue
        for take_leaf in (False, True):
            edges = score(lambda row, s=separator, t=take_leaf:
                          _path_parent(row['stated_parent'], s, t))
            if edges is None:
                continue
            if best is None or edges > best[0]:
                best = (edges, separator, take_leaf)

    if best is None or best[0] <= (baseline or 0):
        _report_unusable_parent_paths(stated_rows, known, warnings)
        return
    edges, separator, take_leaf = best
    for row in stated_rows:
        row['stated_parent'] = _path_parent(row['stated_parent'], separator,
                                            take_leaf)
    warnings.append({
        'type': 'parent_paths_unpacked',
        'count': len(stated_rows),
        'separator': separator,
        'edges': edges,
        'message': ('Parent column holds "%s"-separated paths, read as %s. '
                    '%d of %d rows were placed under a parent.'
                    % (separator,
                       "the parent's trail" if take_leaf
                       else "each row's own trail",
                       edges, len(stated_rows))),
    })


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
        # A parent may be given as a breadcrumb path rather than a code. Turn
        # those into codes first so the matching below has something to match.
        _unpack_stated_parent_paths(rows, warnings)
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

    # Leaf classification. A row is an assembly when something names it as a
    # parent, not when the row after it happens to sit deeper.
    #
    # The two agree on a sheet listed in tree order, which is why reading the
    # neighbouring row worked for as long as it did. But an explicit parent
    # column is order-free by design - that is the whole reason it outranks level
    # inference - and there a child may sit anywhere in the sheet. Judging by the
    # neighbour then calls an assembly a leaf, which routes it to 'Raw material
    # code' instead of 'Sub BOM ID' and silently drops its entire sub-BOM from
    # the export, while a real leaf gets sent to 'Sub BOM ID' and points at a BOM
    # that was never written.
    #
    # Under level inference the parent links were themselves derived from row
    # order, so this reads the same answer from the resolved structure instead of
    # re-deriving it from the sheet.
    named_as_parent = {row['parent'] for row in rows if row['parent']}
    for row in rows:
        row['is_leaf'] = row['code'] not in named_as_parent

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
