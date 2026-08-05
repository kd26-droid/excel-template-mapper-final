"""Validate a generated BOM sheet before it can be previewed or downloaded.

This is deliberately separate from item-directory validation. The two sheets
have different shapes and different required fields: demanding `Item code` or
`Item type` on a BOM row is the wrong ruleset, and demanding `Raw material code`
on an item row is equally wrong.

Rules are graded:

    errors    block the export - the file would fail the FactWise import
    warnings  allowed through - worth telling the user, not worth stopping them

See BOM_GENERATION_PLAN.md section 7.
"""

from collections import OrderedDict, defaultdict


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


def _alternate_code_indexes(headers):
    return [index for index, header in enumerate(headers or [])
            if _text(header) == 'Alternate raw material code']


def _cell(row, index):
    if index < 0 or index >= len(row):
        return ''
    return _text(row[index])


def validate_bom(bom_headers, bom_rows, item_rows=None):
    """Return {'errors': [...], 'warnings': [...], 'stats': {...}}.

    Each issue carries a ``row`` (1-based, matching what the user sees) so the
    UI can point at the offending line rather than saying "something is wrong".
    """
    errors = []
    warnings = []

    idx = {name: _first_index(bom_headers, name) for name in [
        'Finished good code', 'BOM ID', 'BOM name', 'Level', 'Quantity',
        'Raw material code', 'Sub BOM ID', 'Description', 'Base quantity',
        'Measurement unit',
    ]}
    alternate_indexes = _alternate_code_indexes(bom_headers)

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
    previous_level = None

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

        # 2 - a level may only deepen one step at a time
        if level is not None:
            if previous_level is not None and level > previous_level + 1:
                errors.append({
                    'rule': 'level_jump', 'row': line, 'field': 'Level',
                    'message': 'Row %d jumps from level %d to %d; levels may only increase by one.'
                               % (line, previous_level, level),
                })
            previous_level = level

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
            errors.append({
                'rule': 'raw_or_sub_missing', 'row': line,
                'message': 'Row %d has neither a Raw material code nor a Sub BOM ID.' % line,
            })

        # 6 - quantity must be a positive number
        if not quantity:
            errors.append({
                'rule': 'quantity_missing', 'row': line, 'field': 'Quantity',
                'message': 'Row %d has no Quantity.' % line,
            })
        else:
            try:
                if float(quantity) <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append({
                    'rule': 'quantity_invalid', 'row': line, 'field': 'Quantity',
                    'message': 'Row %d has Quantity "%s"; it must be a number greater than zero.'
                               % (line, quantity),
                })

        child = raw_code or sub_bom
        if bom_id and child:
            block_children[bom_id].append((child, line))
        if child:
            referenced_codes.add(child)
        for alternate_index in alternate_indexes:
            alternate = _cell(row, alternate_index)
            if alternate:
                referenced_codes.add(alternate)

        if idx['Description'] >= 0 and not _cell(row, idx['Description']):
            warnings.append({
                'rule': 'description_missing', 'row': line,
                'message': 'Row %d has no Description.' % line,
            })

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
            errors.append({
                'rule': 'item_code_blank',
                'count': blank_item_codes,
                'message': ('%d item row(s) have no Item code, so BOM rows cannot reference them. '
                            'Generate item codes before exporting.' % blank_item_codes),
            })

        if duplicate_item_codes:
            errors.append({
                'rule': 'item_code_duplicate',
                'codes': duplicate_item_codes[:10],
                'count': len(duplicate_item_codes),
                'message': ('%d item code(s) are used by more than one item, so BOM references '
                            'are ambiguous.' % len(duplicate_item_codes)),
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
