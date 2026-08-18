"""Validate a generated BOM sheet before it can be previewed or downloaded.

This is deliberately separate from item-directory validation. The two sheets
have different shapes and different required fields: demanding `Item code` or
`Item type` on a BOM row is the wrong ruleset, and demanding `Raw material code`
on an item row is equally wrong.

Rules are graded:

    errors    block the export - the file would fail the FactWise import
    warnings  allowed through - worth telling the user, not worth stopping them

Two principles beyond the individual rules:

    Report causes, not symptoms. One mistake must produce one issue. A blank
    item code otherwise surfaces twice - once as `item_code_blank` and once as
    `raw_or_sub_missing` - and the user goes looking for a second fix that does
    not exist.

    Do not re-check what an earlier stage already enforced. Level contiguity
    belongs to `bom_tree._detect_level_jumps`, which derives it from the tree
    rather than from row order and blocks generation before this module runs.

See BOM_GENERATION_PLAN.md section 7 and BOM_VALIDATION_PLAN.md.
"""

from collections import OrderedDict, defaultdict

# The alternate block's shape is defined by the generator; reading it back has to
# use the same definition or the two drift silently.
from .bom_generator import BOM_ALTERNATE_GROUP


BASE_REQUIRED = ['Finished good code', 'BOM ID', 'BOM name', 'Level', 'Quantity']

# Properties of the BOM block, not of the row: every row sharing a BOM ID must
# agree on these, or the import silently builds the wrong BOM.
BLOCK_CONSTANT = ['BOM name', 'Finished good code', 'Level']


def _text(value):
    if value is None:
        return ''
    return str(value).strip()


def _first_index(headers, name):
    for index, header in enumerate(headers or []):
        if _text(header) == name:
            return index
    return -1


def _alternate_groups(headers):
    """Index each alternate group as its (code, quantity) column positions.

    The group repeats verbatim once per alternate (``BOM_ALTERNATE_GROUP`` in
    bom_generator), so its columns cannot be looked up by name — every group has
    the same headers. A group is located by its code column and the rest are read
    positionally from there.
    """
    headers = headers or []
    groups = []
    for index, header in enumerate(headers):
        if _text(header) != 'Alternate raw material code':
            continue
        group = {'code': index, 'quantity': -1}
        for offset in range(1, len(BOM_ALTERNATE_GROUP)):
            position = index + offset
            if position >= len(headers):
                break
            if _text(headers[position]) == 'Alternate quantity':
                group['quantity'] = position
        groups.append(group)
    return groups


def _cell(row, index):
    if index < 0 or index >= len(row):
        return ''
    return _text(row[index])


def _attach_grid_rows(issues, bom_row_grid_rows):
    """Translate BOM row numbers into the editor's row numbers.

    A ``row`` on an issue indexes the *generated* BOM, which is not what the user
    is looking at: rows are grouped by parentKey, documents are dropped, and an
    alternate is folded into its primary's line. Pointing at a generated row
    number sends the user hunting through a sheet where it does not exist.

    ``grid_row`` is added only when the mapping is known - a row invented by the
    generator, such as an authored finished good, has no editor row and is left
    without one rather than given a wrong one.
    """
    if not bom_row_grid_rows:
        return

    def translate(line):
        position = line - 1
        if 0 <= position < len(bom_row_grid_rows):
            return bom_row_grid_rows[position]
        return None

    for issue in issues:
        if 'row' in issue:
            grid_row = translate(issue['row'])
            if grid_row is not None:
                issue['grid_row'] = grid_row
        if issue.get('rows'):
            mapped = [translate(line) for line in issue['rows']]
            mapped = [line for line in mapped if line is not None]
            if mapped:
                issue['grid_rows'] = mapped


def validate_bom(bom_headers, bom_rows, item_rows=None, bom_row_grid_rows=None):
    """Return {'errors': [...], 'warnings': [...], 'stats': {...}}.

    Each issue carries a ``row`` (1-based) identifying the generated BOM line.
    When ``bom_row_grid_rows`` is supplied - one editor row number per generated
    row - issues also carry ``grid_row`` / ``grid_rows``, which is what the UI
    should actually point at. See ``_attach_grid_rows``.
    """
    errors = []
    warnings = []

    idx = {name: _first_index(bom_headers, name) for name in [
        'Finished good code', 'BOM ID', 'BOM name', 'Level', 'Quantity',
        'Raw material code', 'Sub BOM ID', 'Description', 'Base quantity',
        'Measurement unit',
    ]}
    alternate_groups = _alternate_groups(bom_headers)

    missing_columns = [name for name in BASE_REQUIRED if idx.get(name, -1) < 0]
    if missing_columns:
        errors.append({
            'rule': 'missing_columns',
            'message': 'The BOM sheet is missing required columns: %s.' % ', '.join(missing_columns),
        })
        return {'errors': errors, 'warnings': warnings, 'stats': {}}

    block_identity = {}
    block_children = defaultdict(list)
    known_bom_ids = set()
    referenced_codes = set()
    # (Sub BOM ID, row) pairs — checked against known_bom_ids, not items.
    referenced_sub_boms = set()
    # Deferred so they can be folded into `item_code_blank`, which is the same
    # fact seen from the other side. See where they are emitted below.
    rows_without_child = []
    rows_without_unit = []

    for position, row in enumerate(bom_rows or []):
        line = position + 1
        bom_id = _cell(row, idx['BOM ID'])
        bom_name = _cell(row, idx['BOM name'])
        finished_good = _cell(row, idx['Finished good code'])
        raw_code = _cell(row, idx['Raw material code'])
        sub_bom = _cell(row, idx['Sub BOM ID'])
        quantity = _cell(row, idx['Quantity'])
        level_text = _cell(row, idx['Level'])

        if bom_id:
            known_bom_ids.add(bom_id)

        # 3 - the three block identifiers must be present
        for name, value in (('BOM ID', bom_id), ('BOM name', bom_name),
                            ('Finished good code', finished_good)):
            if not value:
                errors.append({
                    'rule': 'missing_required', 'row': line, 'field': name,
                    'message': 'Row %d has no %s.' % (line, name),
                })

        # 1 - Level must be a non-negative whole number
        level = None
        if not level_text:
            errors.append({
                'rule': 'level_missing', 'row': line, 'field': 'Level',
                'message': 'Row %d has no Level.' % line,
            })
        else:
            try:
                number = float(level_text)
                if number != int(number) or int(number) < 0:
                    raise ValueError
                level = int(number)
            except (TypeError, ValueError):
                errors.append({
                    'rule': 'level_invalid', 'row': line, 'field': 'Level',
                    'message': 'Row %d has Level "%s"; it must be a whole number.'
                               % (line, level_text),
                })

        # 2 - level contiguity is NOT checked here. `bom_tree._detect_level_jumps`
        # already enforces it at derive time, from the tree rather than from row
        # order, and its errors block generation before this ever runs. The
        # sequential scan that used to live here was order-dependent: it flagged a
        # legitimately re-sorted sheet and passed a broken hierarchy that happened
        # to be sorted tidily.

        # 4 - block identity must be constant within a BOM ID
        if bom_id:
            identity = {'BOM name': bom_name, 'Finished good code': finished_good,
                        'Level': level_text}
            existing = block_identity.get(bom_id)
            if existing is None:
                block_identity[bom_id] = identity
            else:
                for field in BLOCK_CONSTANT:
                    if existing.get(field) != identity.get(field):
                        errors.append({
                            'rule': 'block_inconsistent', 'row': line, 'field': field,
                            'message': ('BOM ID "%s" has conflicting %s ("%s" and "%s"); '
                                        'every row of one BOM must agree.'
                                        % (bom_id, field, existing.get(field), identity.get(field))),
                        })

        # 5 - exactly one of Raw material code / Sub BOM ID
        if raw_code and sub_bom:
            errors.append({
                'rule': 'raw_and_sub', 'row': line,
                'message': 'Row %d has both a Raw material code and a Sub BOM ID; it must have exactly one.' % line,
            })
        elif not raw_code and not sub_bom:
            # Held back rather than reported here. `Raw material code` is the
            # row's own item code, so a blank one is the same problem as
            # `item_code_blank` wearing different words — reporting both sends
            # the user hunting for a second fix that does not exist. Emitted
            # below only when no blank item code explains it.
            rows_without_child.append(line)

        # 6 - quantity must be a number, and not a negative one.
        #
        # Zero is allowed. A sheet legitimately carries a zero-quantity line -
        # a DNP part, an optional fitment, a placeholder the assembly does not
        # currently consume - and blocking the whole export over it forces the
        # user to invent a quantity that is not true. What cannot be read as a
        # quantity at all, or is below zero, is still an error.
        #
        # Fractions are quantities too and must pass: real sheets consume 0.010
        # of a reel or 0.25 m of wire, so "must be a whole number" would reject
        # correct data.
        if not quantity:
            errors.append({
                'rule': 'quantity_missing', 'row': line, 'field': 'Quantity',
                'message': 'Row %d has no Quantity.' % line,
            })
        else:
            try:
                if float(quantity) < 0:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append({
                    'rule': 'quantity_invalid', 'row': line, 'field': 'Quantity',
                    # The offending cell contents travel with the issue so the UI
                    # can act on exactly these values - replace just them, or
                    # delete just their rows - instead of the whole column.
                    'value': quantity,
                    'message': 'Row %d has Quantity "%s"; it must be a number that is not negative.'
                               % (line, quantity),
                })

        child = raw_code or sub_bom
        if bom_id and child:
            block_children[bom_id].append((child, line))
        # Only a RAW MATERIAL code is a reference to an item. A Sub BOM ID
        # references a BOM, and the two are no longer the same string: a
        # sub-assembly now carries its own item code AND its own BOM code, so
        # its part can keep the number the sheet gave it while its BOM takes a
        # free one. Checking a Sub BOM ID against the item directory reported
        # the BOM code missing as an item, which it is supposed to be.
        #
        # Sub BOM IDs are checked below against `known_bom_ids` instead — a
        # sub-BOM must exist as a BOM, which is the real requirement.
        if raw_code:
            referenced_codes.add(raw_code)
        elif sub_bom:
            referenced_sub_boms.add((sub_bom, line))

        # 6b - the alternate block. Unique to the BOM sheet: the item directory
        # has no concept of a substitute part, so nothing else can check this.
        # A missing alternate quantity or unit is deliberately NOT flagged - the
        # generator inherits the primary's, which is right, because an alternate
        # is the same BOM line from a different manufacturer.
        seen_alternates = {}
        for slot, group in enumerate(alternate_groups, start=1):
            alternate = _cell(row, group['code'])
            if not alternate:
                continue
            referenced_codes.add(alternate)

            if raw_code and alternate == raw_code:
                errors.append({
                    'rule': 'alternate_is_primary', 'row': line,
                    'message': 'Row %d lists "%s" as an alternate for itself.' % (line, alternate),
                })
            elif alternate in seen_alternates:
                errors.append({
                    'rule': 'alternate_duplicate', 'row': line,
                    'message': 'Row %d lists "%s" as an alternate twice (slots %d and %d).'
                               % (line, alternate, seen_alternates[alternate], slot),
                })
            else:
                seen_alternates[alternate] = slot

            # Same rule as the primary's Quantity above, for the same reasons:
            # zero and fractions pass, negatives and non-numbers do not.
            alternate_quantity = _cell(row, group['quantity'])
            if alternate_quantity:
                try:
                    if float(alternate_quantity) < 0:
                        raise ValueError
                except (TypeError, ValueError):
                    errors.append({
                        'rule': 'alternate_quantity_invalid', 'row': line,
                        'message': ('Row %d has Alternate quantity "%s" for "%s"; it must be a '
                                    'number that is not negative.'
                                    % (line, alternate_quantity, alternate)),
                    })

        # The BOM line's unit says how the part is CONSUMED. It is not the item
        # sheet's Measurement unit, which says how the part is STOCKED - a part
        # stocked in metres and consumed in centimetres is legitimate, so the
        # item sheet passing tells us nothing about this column.
        if idx['Measurement unit'] >= 0 and not _cell(row, idx['Measurement unit']):
            rows_without_unit.append(line)

    # 7 - a Sub BOM ID must point at a block that exists in this sheet
    for position, row in enumerate(bom_rows or []):
        sub_bom = _cell(row, idx['Sub BOM ID'])
        if sub_bom and sub_bom not in known_bom_ids:
            errors.append({
                'rule': 'sub_bom_unresolved', 'row': position + 1, 'field': 'Sub BOM ID',
                'message': 'Row %d points at Sub BOM ID "%s", which is not a BOM in this sheet.'
                           % (position + 1, sub_bom),
            })

    # 8 - the same child twice in one block. Across blocks it is legitimate:
    # a part may be used in several sub-assemblies.
    for bom_id, children in block_children.items():
        seen = {}
        for child, line in children:
            if child in seen:
                errors.append({
                    'rule': 'duplicate_child', 'row': line,
                    'message': 'BOM "%s" lists "%s" twice (rows %d and %d).'
                               % (bom_id, child, seen[child], line),
                })
            else:
                seen[child] = line

    # 9 - no node may be reachable from itself
    _detect_cycles(block_children, errors)

    # 10a - a Sub BOM ID must name a BOM built in this same file.
    #
    # Checked against BOM IDs, NOT the item directory. A sub-assembly now
    # carries its own item code AND its own BOM code, so its part can keep the
    # number the sheet gave it while its BOM takes a free one. Treating a Sub
    # BOM ID as an item reference reported the BOM code missing as an item —
    # which it is supposed to be.
    #
    # Outside the `item_rows is not None` block below: this needs no item
    # directory, and nesting it there would skip it whenever one is absent.
    dangling_sub_boms = sorted(
        {code for code, _line in referenced_sub_boms if code and code not in known_bom_ids}
    )
    if dangling_sub_boms:
        errors.append({
            'rule': 'sub_bom_not_found',
            'codes': dangling_sub_boms[:20],
            'count': len(dangling_sub_boms),
            'message': ('%d Sub BOM ID(s) do not match any BOM in this sheet: %s. '
                        'A sub-BOM must be built somewhere in the same file.'
                        % (len(dangling_sub_boms),
                           ', '.join(dangling_sub_boms[:5])
                           + ('...' if len(dangling_sub_boms) > 5 else ''))),
        })

    # 10 - referential integrity against the item directory
    item_codes = set()
    blank_item_codes = 0
    duplicate_item_codes = []
    if item_rows is not None:
        seen_items = set()
        for item in item_rows:
            code = _text(item.get('Item code') if isinstance(item, dict) else '')
            if not code:
                blank_item_codes += 1
                continue
            if code in seen_items:
                duplicate_item_codes.append(code)
            seen_items.add(code)
        item_codes = seen_items

        missing = sorted(code for code in referenced_codes if code and code not in item_codes)
        if missing:
            errors.append({
                'rule': 'referential_integrity',
                'codes': missing[:20],
                'count': len(missing),
                'message': ('%d code(s) used in the BOM do not exist in the item directory: %s. '
                            'The import will fail on the second file.'
                            % (len(missing), ', '.join(missing[:5]) + ('...' if len(missing) > 5 else ''))),
            })

        if blank_item_codes:
            # The BOM rows left without a child are the same rows, counted from
            # the BOM side. Folded into one message with one fix instead of two
            # errors that look unrelated.
            message = ('%d item row(s) have no Item code, so BOM rows cannot reference them. '
                       'Generate item codes before exporting.' % blank_item_codes)
            if rows_without_child:
                message += (' %d BOM row(s) have no Raw material code as a result.'
                            % len(rows_without_child))
            errors.append({
                'rule': 'item_code_blank',
                'count': blank_item_codes,
                'rows': rows_without_child[:50],
                'message': message,
            })
            rows_without_child = []

        if duplicate_item_codes:
            # Rows that merely repeat the same item are collapsed on the way out
            # and never reach here. What is left is a code whose rows disagree,
            # which is a real conflict: two different parts are claiming it.
            errors.append({
                'rule': 'item_code_duplicate',
                'codes': duplicate_item_codes[:10],
                'count': len(duplicate_item_codes),
                'message': ('%d item code(s) are shared by rows that describe different parts, '
                            'so BOM references to them are ambiguous. Either give the rows '
                            'different item codes, or make them match exactly if they are the '
                            'same part. Deleting a row also removes it from the BOM.'
                            % len(duplicate_item_codes)),
            })

        # Finished goods sit at the top of their BOM, so they are never a child
        # and would otherwise be reported as unused on every single export.
        finished_good_codes = {
            _cell(row, idx['Finished good code']) for row in (bom_rows or [])
        }
        finished_good_codes.discard('')
        unreferenced = [code for code in item_codes
                        if code not in referenced_codes and code not in finished_good_codes]
        if unreferenced:
            warnings.append({
                'rule': 'item_unreferenced',
                'count': len(unreferenced),
                'message': '%d item(s) are not used by any BOM row.' % len(unreferenced),
            })

    # Anything still here was not explained by a blank item code, so it is a real
    # structural gap in its own right - a multi-level row that should have
    # carried a Sub BOM ID and did not.
    for line in rows_without_child:
        errors.append({
            'rule': 'raw_or_sub_missing', 'row': line,
            'message': 'Row %d has neither a Raw material code nor a Sub BOM ID.' % line,
        })

    # Aggregated, not one per row: a list of forty near-identical lines is how
    # the real blocker gets lost. The affected rows travel on the issue so the
    # UI can still point at them.
    if rows_without_unit:
        warnings.append({
            'rule': 'measurement_unit_missing',
            'field': 'Measurement unit',
            'count': len(rows_without_unit),
            'rows': rows_without_unit[:50],
            'message': ('%d BOM row(s) have no Measurement unit.' % len(rows_without_unit)),
        })

    _attach_grid_rows(errors, bom_row_grid_rows)
    _attach_grid_rows(warnings, bom_row_grid_rows)

    return {
        'errors': errors,
        'warnings': warnings,
        'stats': {
            'rows': len(bom_rows or []),
            'blocks': len(known_bom_ids),
            'referenced_codes': len(referenced_codes),
            'item_codes': len(item_codes),
        },
    }


def _detect_cycles(block_children, errors):
    children_of = {bom_id: [child for child, _line in children]
                   for bom_id, children in block_children.items()}
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {}

    def visit(code, trail):
        state = colour.get(code, WHITE)
        if state == GREY:
            cycle = trail[trail.index(code):] + [code] if code in trail else [code, code]
            errors.append({
                'rule': 'cycle',
                'message': 'Cycle detected in the BOM: %s.' % ' -> '.join(cycle),
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
