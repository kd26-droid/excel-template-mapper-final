import re

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import EditorDefaultSettings


EDITOR_DEFAULT_FIELD_MAP = {
    'procurement_entity_name': 'Procurement entity name',
    'item_type': 'Item type',
    'procurement_item': 'Procurement item',
    'sales_item': 'Sales item',
    'measurement_unit': 'Measurement unit',
}


def _clean(value):
    if value is None:
        return ''
    return re.sub(r'\s+', ' ', str(value).replace('\u00a0', ' ')).strip()


def _key(value):
    return re.sub(r'[^a-z0-9]+', '', _clean(value).lower())


def _truthy_or_none(value):
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        return value
    text = _clean(value).lower()
    if text in {'true', '1', 'yes', 'y'}:
        return True
    if text in {'false', '0', 'no', 'n'}:
        return False
    return None


def _entity_from_request(request):
    data = getattr(request, 'data', {}) or {}
    return (
        _clean(data.get('entity_name'))
        or _clean(request.GET.get('entity_name'))
        or _clean(request.headers.get('X-Entity-Name'))
        or (
            _clean(getattr(request.user, 'username', ''))
            if getattr(request, 'user', None) and getattr(request.user, 'is_authenticated', False)
            else ''
        )
    )


def _entity_id_from_request(request):
    data = getattr(request, 'data', {}) or {}
    return (
        _clean(data.get('entity_id'))
        or _clean(request.GET.get('entity_id'))
        or _clean(request.headers.get('X-Entity-Id'))
    )


def _column_index(headers, target):
    target_key = _key(target)
    for index, header in enumerate(headers or []):
        if _key(header) == target_key:
            return index
    return None


def _row_get(row, index, header):
    if isinstance(row, dict):
        return row.get(header, '')
    return row[index] if index < len(row) else ''


def _row_set(row, index, header, value):
    if isinstance(row, dict):
        row[header] = value
        return
    while len(row) <= index:
        row.append('')
    row[index] = value


def serialize_editor_defaults(settings_obj):
    return {
        'entity_id': settings_obj.entity_id or '',
        'entity_name': settings_obj.entity_name,
        'item_type': settings_obj.item_type or '',
        'procurement_item': settings_obj.procurement_item,
        'sales_item': settings_obj.sales_item,
        'measurement_unit': settings_obj.measurement_unit or '',
        'item_code_rule': settings_obj.item_code_rule or {},
        'ui_defaults': settings_obj.ui_defaults or {},
        'updated_at': settings_obj.updated_at.isoformat() if settings_obj.updated_at else None,
    }


def get_editor_defaults_for_entity(entity_name, entity_id=None):
    """Find a row by entity_id first, then by name.

    The name lookup is case-insensitive and stays as a fallback for two
    reasons: rows written before entity_id existed carry no id, and a launch
    URL does not always carry one either. It is a fallback and not the key —
    an exact, case-sensitive name match is what made a differently-spelled
    launch look like the settings had been wiped.
    """
    entity_id = _clean(entity_id)
    if entity_id:
        found = EditorDefaultSettings.objects.filter(entity_id=entity_id).first()
        if found:
            return found
    entity_name = _clean(entity_name)
    if not entity_name:
        return None
    return EditorDefaultSettings.objects.filter(entity_name__iexact=entity_name).first()


def _sanitize_item_code_rule(raw_rule):
    """Store only a rule the caller actually asked for.

    An empty dict means "no server-side item code rule" — the client sends that
    for the modes this table cannot express (join, copy, if/else) and when the
    user has chosen nothing. Defaulting the mode to `prefix_sequence` here turned
    every one of those into a prefix-less serial, which is what silently numbered
    blank item codes 1, 2, 3 for anyone under that entity, on any machine.
    """
    if not isinstance(raw_rule, dict) or not raw_rule:
        return {}
    mode = _clean(raw_rule.get('mode'))
    if mode not in {'prefix_sequence', 'fixed'}:
        return {}
    rule = {
        'mode': mode,
        'prefix': _clean(raw_rule.get('prefix')),
    }
    if mode == 'fixed':
        rule['value'] = _clean(raw_rule.get('value'))
        return {key: value for key, value in rule.items() if value not in ('', None)}

    try:
        rule['start'] = int(raw_rule.get('start', 1))
    except (TypeError, ValueError):
        rule['start'] = 1
    try:
        rule['padding'] = max(0, int(raw_rule.get('padding', 0)))
    except (TypeError, ValueError):
        rule['padding'] = 0
    rule['increment'] = _truthy_or_none(raw_rule.get('increment', True)) is not False
    return rule


def upsert_editor_defaults(entity_name, payload, entity_id=None):
    entity_name = _clean(entity_name)
    entity_id = _clean(entity_id)
    if not entity_name and not entity_id:
        raise ValueError('entity_id or entity_name is required to save editor defaults.')

    settings_obj = get_editor_defaults_for_entity(entity_name, entity_id)
    if settings_obj is None:
        settings_obj = EditorDefaultSettings(entity_name=entity_name)

    # A row found by name under a known id adopts that id, so the next launch
    # resolves it directly and a rename no longer strands it.
    if entity_id:
        settings_obj.entity_id = entity_id
    if entity_name:
        settings_obj.entity_name = entity_name

    if 'item_type' in payload:
        settings_obj.item_type = _clean(payload.get('item_type'))
    if 'procurement_item' in payload:
        settings_obj.procurement_item = _truthy_or_none(payload.get('procurement_item'))
    if 'sales_item' in payload:
        settings_obj.sales_item = _truthy_or_none(payload.get('sales_item'))
    if 'measurement_unit' in payload:
        settings_obj.measurement_unit = _clean(payload.get('measurement_unit'))
    if 'item_code_rule' in payload:
        settings_obj.item_code_rule = _sanitize_item_code_rule(payload.get('item_code_rule'))
    if 'ui_defaults' in payload:
        raw_ui = payload.get('ui_defaults')
        settings_obj.ui_defaults = raw_ui if isinstance(raw_ui, dict) else {}

    settings_obj.save()
    return settings_obj


def _item_code_value(rule, sequence_index):
    mode = rule.get('mode') or 'prefix_sequence'
    if mode == 'fixed':
        return _clean(rule.get('value'))
    try:
        start = int(rule.get('start', 1))
    except (TypeError, ValueError):
        start = 1
    try:
        padding = max(0, int(rule.get('padding', 0)))
    except (TypeError, ValueError):
        padding = 0
    increment = rule.get('increment', True) is not False
    number = start + sequence_index if increment else start
    suffix = str(number).zfill(padding) if padding else str(number)
    return f"{rule.get('prefix') or ''}{suffix}"


LOCKED_IDENTITY_COLUMNS = {
    'procurement_entity_name': False,
    'item_type': True,
    'procurement_item': False,
    'sales_item': False,
    'measurement_unit': True,
}


#: What a join uses when the settings never recorded one.
#:
#: The Settings box SHOWS "_" as its value when nothing is stored, but a field
#: the user never types in writes nothing back - so the rule saved with no
#: separator at all and the join came out "TAG 15-400HELLERMANNTYTON", which
#: reads as a real item code and is not one. Absent means the default; an
#: explicitly emptied box is a deliberate "" and is left alone.
JOIN_DEFAULT_SEPARATOR = '_'


def _join_separator(value):
    return JOIN_DEFAULT_SEPARATOR if value is None else str(value)


#: Which rows an MPN check is allowed to touch.
#:
#: Three modes, because "check everything" and "check nothing unless" are
#: different questions and a sheet usually wants one or the other:
#:
#:   always     - every row with an MPN, which is what it always did.
#:   only_when  - check ONLY the rows the conditions match. An allow-list, for
#:                a sheet where a small marked subset is worth the API calls.
#:   skip_when  - check every row EXCEPT the ones the conditions match. A
#:                block-list, for a sheet carrying drawings or obsolete lines
#:                that would burn a provider quota for nothing.
#:
#: Several conditions are joined by `match`: 'all' is AND, 'any' is OR.
MPN_RULE_MODES = ('always', 'only_when', 'skip_when')
MPN_RULE_OPERATORS = ('contains', 'not_contains', 'equals', 'not_equals',
                      'is_empty', 'is_not_empty')


def _mpn_condition_matches(value, operator, expected=''):
    """One condition against one cell. Case- and whitespace-insensitive."""
    text = str(value or '').strip()
    wanted = str(expected or '').strip()
    if operator == 'is_empty':
        return not text
    if operator == 'is_not_empty':
        return bool(text)
    lowered = text.casefold()
    wanted_lower = wanted.casefold()
    if operator == 'equals':
        return lowered == wanted_lower
    if operator == 'not_equals':
        return lowered != wanted_lower
    if operator == 'contains':
        return wanted_lower in lowered
    if operator == 'not_contains':
        return wanted_lower not in lowered
    # An operator nobody recognises must not quietly match everything.
    return False


def saved_mpn_validation_rule(settings_obj):
    """The Settings panel's MPN validation rule, or None when it is 'always'.

    Returns {'mode', 'match', 'conditions': [{'column','operator','value'}]}.
    A rule with no usable condition is no rule: guessing one would silently
    stop checking a sheet the user expected to be checked.
    """
    ui = (getattr(settings_obj, 'ui_defaults', None) or {}) if settings_obj else {}
    mode = str(ui.get('mpnValidationMode') or 'always').strip()
    if mode not in MPN_RULE_MODES or mode == 'always':
        return None

    match = str(ui.get('mpnValidationMatch') or 'all').strip()
    if match not in ('all', 'any'):
        match = 'all'

    conditions = []
    for raw_condition in (ui.get('mpnValidationConditions') or []):
        if not isinstance(raw_condition, dict):
            continue
        column = str(raw_condition.get('column') or '').strip()
        operator = str(raw_condition.get('operator') or 'contains').strip()
        if not column or operator not in MPN_RULE_OPERATORS:
            continue
        conditions.append({
            'column': column,
            'operator': operator,
            'value': str(raw_condition.get('value') or ''),
        })
    if not conditions:
        return None
    return {'mode': mode, 'match': match, 'conditions': conditions}


def mpn_rule_allows_row(rule, row_dict):
    """Whether this row should be sent to the providers.

    True when there is no rule, so every caller can ask unconditionally.
    A condition naming a column the sheet does not have never matches - the
    sheet simply cannot answer it - which keeps a rule saved for one customer
    from silently emptying another customer's check.
    """
    if not rule:
        return True
    results = []
    for condition in rule['conditions']:
        column = condition['column']
        if column not in (row_dict or {}):
            results.append(False)
            continue
        results.append(_mpn_condition_matches(
            row_dict.get(column), condition['operator'], condition['value']))
    matched = all(results) if rule['match'] == 'all' else any(results)
    return matched if rule['mode'] == 'only_when' else not matched


def _saved_item_code_rule(settings_obj):
    """The Settings panel's item code rule, in the modes only the browser ran.

    ``EditorDefaultSettings.item_code_rule`` can express prefix_sequence and
    fixed and nothing else - its own sanitiser returns {} for the rest. Copy,
    join and if/else are kept in ``ui_defaults`` and were applied by the editor
    page as it loaded, by handing them to ``fill_or_create_column``. So anything
    that never opens that page got no item codes at all: the agent, and every
    sheet taken straight from the normaliser into a session.

    That is not cosmetic on a sheet whose alternates are told apart only by
    their MPN, which is every THALES export. An alternate with no code of its
    own cannot be referenced, so all 364 of them were dropped from the generated
    BOM without a word - the BOM still validated, it was just missing every
    second source.

    Mirrors the rule EnhancedDataEditor builds from the same keys, so the two
    cannot drift apart.
    """
    ui = (getattr(settings_obj, 'ui_defaults', None) or {}) if settings_obj else {}
    mode = str(ui.get('itemCodeContentType') or '').strip()
    if mode not in ('copy', 'concat', 'conditional'):
        return None

    if mode == 'copy':
        source_columns = [ui.get('itemCodeCopyFromColumn')]
    elif mode == 'concat':
        source_columns = [ui.get('itemCodeJoinFirstColumn'),
                          ui.get('itemCodeJoinSecondColumn')]
    else:
        source_columns = []

    branches = []
    for branch in (ui.get('itemCodeConditionalBranches') or []):
        column = str((branch or {}).get('column') or '').strip()
        if not column:
            continue
        entry = {
            'column': column,
            'operator': (branch or {}).get('operator') or 'contains',
            'compare': (branch or {}).get('compare'),
            'output_value': ('' if (branch or {}).get('outputType') == 'empty'
                             else (branch or {}).get('outputValue')),
        }
        if (branch or {}).get('outputType') == 'column':
            entry['output_source_column'] = (branch or {}).get('outputColumn')
        elif (branch or {}).get('outputType') == 'join':
            # The item code every customer uses is a join - part number and
            # manufacturer - so a branch that could only name ONE column could
            # not express the normal case, only the exception to it.
            entry['output_source_columns'] = [
                (branch or {}).get('outputColumn'),
                (branch or {}).get('outputSecondColumn'),
            ]
            entry['output_separator'] = _join_separator((branch or {}).get('outputSeparator'))
        branches.append(entry)

    # A mode with nothing to read from is not a rule, and guessing one would
    # write item codes the user never asked for.
    if mode == 'conditional':
        if not branches:
            return None
    elif not all(str(column or '').strip() for column in source_columns):
        return None

    condition = None
    if mode == 'conditional':
        condition = {'branches': branches}
        else_source = str(ui.get('itemCodeElseValueSource') or 'default')
        if else_source == 'column':
            condition['else_source_column'] = ui.get('itemCodeElseValueColumn')
        elif else_source == 'join':
            condition['else_source_columns'] = [
                ui.get('itemCodeElseValueColumn'),
                ui.get('itemCodeElseSecondColumn'),
            ]
            condition['else_separator'] = _join_separator(ui.get('itemCodeElseSeparator'))
        elif else_source == 'empty':
            condition['else'] = ''
        elif str(ui.get('itemCodeElseDefaultValue') or '').strip():
            condition['else'] = ui.get('itemCodeElseDefaultValue')

    separator = ui.get('itemCodeSeparator')
    return {
        'type': 'column_value',
        'target_mode': 'existing',
        'target_column': 'Item code',
        'value_mode': mode,
        'source_columns': source_columns,
        'separator': ' ' if separator is None else separator,
        'write_mode': ui.get('itemCodeRowsToUpdate') or 'fill_empty',
        'condition': condition,
    }


#: Units a sheet writes one way and FactWise stores another.
#:
#: Only spellings whose meaning is not in doubt belong here. THALES writes "P"
#: for piece, the French abbreviation, and FactWise has no unit of that name at
#: all - so every row carrying it was rejected twice over, once as
#: UOM_NOT_FOUND on the line and again as INVALID_ITEM on the item, 526 errors
#: from a single letter. EA is FactWise's discrete unit and the mapper's own
#: default for a part, so that is where it lands.
#:
#: Matched case-insensitively. A unit FactWise already knows is never rewritten:
#: the point is to translate, not to overrule what the customer said.
#:
#: EMPTY ON PURPOSE. "P" was translated here for THALES, where it is the French
#: abbreviation for piece. But this table has no idea whose sheet it is reading,
#: and it runs on every export for every customer: elsewhere P is as likely to
#: mean pack, pair or pound, and a unit that quietly becomes EA is wrong in the
#: one direction nobody checks - an order for 40 pairs shipped as 40 pieces
#: reads as correct everywhere on the way out.
#:
#: A translation belongs to a customer, so it needs to hang off the entity, not
#: off the module. Until it does, THALES sheets carry P through to validation,
#: where it is rejected visibly and a person decides - which is worse for them
#: and safer for everyone else.
MEASUREMENT_UNIT_ALIASES = {}

#: Every column that carries one.
MEASUREMENT_UNIT_COLUMNS = ('Measurement unit', 'BOM UOM', 'Alternate measurement unit')


def _normalise_measurement_units(headers, rows):
    """Rewrite known unit spellings in place. Returns how many cells changed."""
    changed = 0
    for column in MEASUREMENT_UNIT_COLUMNS:
        index = _column_index(headers, column)
        if index is None:
            continue
        for row in rows:
            current = _clean(_row_get(row, index, headers[index]))
            replacement = MEASUREMENT_UNIT_ALIASES.get(current.lower())
            if replacement and replacement != current:
                _row_set(row, index, headers[index], replacement)
                changed += 1
    return changed


def apply_editor_defaults_to_rows(headers, rows, settings_obj, sequence_offset=0, locked_codes=None):
    if not settings_obj or not headers or rows is None:
        return rows, {'applied': {}, 'skipped_missing_columns': []}

    output_rows = [dict(row) if isinstance(row, dict) else list(row) for row in rows]
    applied = {}
    skipped = []
    # A finished good or sub-assembly keeps its identity: the code other rows
    # point at, and the Item type that makes it an assembly. The caller resolves
    # the set once (views.locked_identity_codes) and passes it here.
    locked = {str(code).strip() for code in (locked_codes or []) if str(code).strip()}
    item_code_index = _column_index(headers, 'Item code') if locked else None

    def _is_locked_row(row):
        if item_code_index is None:
            return False
        return _clean(_row_get(row, item_code_index, headers[item_code_index])) in locked

    value_defaults = {
        'procurement_entity_name': settings_obj.entity_name,
        'item_type': settings_obj.item_type,
        'procurement_item': settings_obj.procurement_item,
        'sales_item': settings_obj.sales_item,
        'measurement_unit': settings_obj.measurement_unit,
    }

    for field_key, value in value_defaults.items():
        if value is None or _clean(value) == '':
            continue
        target_header = EDITOR_DEFAULT_FIELD_MAP[field_key]
        index = _column_index(headers, target_header)
        if index is None:
            skipped.append(target_header)
            continue
        changed = 0
        column_is_locked = LOCKED_IDENTITY_COLUMNS.get(field_key, False)
        for row in output_rows:
            if column_is_locked and _is_locked_row(row):
                continue
            current = _row_get(row, index, headers[index])
            if _clean(current) == '':
                _row_set(row, index, headers[index], str(value))
                changed += 1
        if changed:
            applied[target_header] = changed

    item_rule = settings_obj.item_code_rule or {}
    if item_rule:
        index = _column_index(headers, 'Item code')
        if index is None:
            skipped.append('Item code')
        else:
            changed = 0
            sequence_index = max(0, int(sequence_offset or 0))
            # Item code is the strongest lock of all: it is the reference the
            # rest of the BOM resolves against.
            for row in output_rows:
                if _is_locked_row(row):
                    continue
                current = _row_get(row, index, headers[index])
                if _clean(current) == '':
                    value = _item_code_value(item_rule, sequence_index)
                    if value:
                        _row_set(row, index, headers[index], value)
                        changed += 1
                    sequence_index += 1
            if changed:
                applied['Item code'] = changed

    # The copy / join / if-else modes, which the typed rule above cannot hold.
    # Applied here rather than around this function because three callers reach
    # it directly - the editor's own grid fetch among them - and a rule that
    # only some of them run is the bug this is fixing.
    # Before anything reads a unit off these rows, and in the one place both the
    # grid and the export come through - so the screen and the file agree.
    unit_changes = _normalise_measurement_units(headers, output_rows)
    if unit_changes:
        applied['Measurement unit (translated)'] = unit_changes

    saved_rule = _saved_item_code_rule(settings_obj)
    if saved_rule:
        from .views import apply_column_value_rule

        # That engine works on a POSITIONAL grid, and these rows may be dicts
        # keyed by header. Handing it dicts makes its own `list(row)` yield the
        # header names, which it then joins and writes into every cell - the
        # whole sheet came out reading "MPN Code_Tag_1".
        from .views import make_unique_field_headers

        # ... and by whichever spelling each row actually uses. A repeated column
        # is labelled "Tag (1)" but stored under "Tag_1", so reading only the
        # label returned nothing for the manufacturer and every item code joined
        # from it came out as the MPN alone.
        wire = make_unique_field_headers(headers)

        def cell(row, index):
            value = _row_get(row, index, headers[index])
            if _clean(value) == '' and isinstance(row, dict) and index < len(wire):
                value = row.get(wire[index], value)
            return value

        positional = [
            [cell(row, index) for index in range(len(headers))]
            for row in output_rows
        ]
        try:
            _headers, filled, changed = apply_column_value_rule(
                headers, positional, saved_rule, locked_item_codes=locked_codes)
        except ValueError:
            # A rule naming a column this sheet does not have is the user's to
            # fix, and it must not take the rest of the defaults down with it.
            skipped.append('Item code')
        else:
            target = _column_index(headers, 'Item code')
            if changed and target is not None:
                written = 0
                for row, values in zip(output_rows, filled):
                    value = values[target] if target < len(values) else ''
                    # A join of empty inputs is empty, and in overwrite mode that
                    # would be written over a cell somebody had already filled.
                    # Rows with no MPN produce nothing here, so every repair that
                    # gave them a code - by hand or through the agent - was erased
                    # on the next read, and the sheet could not be made importable
                    # however many times it was fixed.
                    current = _row_get(row, target, headers[target])
                    if isinstance(row, dict) and headers[target] not in row and target < len(wire):
                        current = row.get(wire[target], current)
                    if _clean(value) == '' and _clean(current) != '':
                        continue
                    # Written back one cell at a time so each row keeps the shape
                    # it arrived in; the caller's rows are dicts or lists by turns,
                    # and under the key the row already uses so the cell is
                    # replaced rather than a second one added beside it.
                    if isinstance(row, dict) and headers[target] not in row and target < len(wire):
                        row[wire[target]] = value
                    else:
                        _row_set(row, target, headers[target], value)
                    written += 1
                if written:
                    applied['Item code'] = written

    return output_rows, {
        'entity_name': settings_obj.entity_name,
        'applied': applied,
        'skipped_missing_columns': sorted(set(skipped)),
    }


@api_view(['GET', 'POST'])
def editor_default_settings(request):
    entity_name = _entity_from_request(request)
    entity_id = _entity_id_from_request(request)
    if not entity_name and not entity_id:
        return Response({
            'success': False,
            'error': 'entity_id or entity_name is required until login entity context is wired in.',
        }, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'GET':
        settings_obj = get_editor_defaults_for_entity(entity_name, entity_id)
        payload = serialize_editor_defaults(settings_obj) if settings_obj else {
            'entity_id': entity_id,
            'entity_name': entity_name,
            'item_type': '',
            'procurement_item': None,
            'sales_item': None,
            'measurement_unit': '',
            'item_code_rule': {},
            'ui_defaults': {},
            'updated_at': None,
        }
        return Response({'success': True, 'settings': payload})

    try:
        settings_obj = upsert_editor_defaults(entity_name, request.data or {}, entity_id)
    except ValueError as exc:
        return Response({'success': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'success': True, 'settings': serialize_editor_defaults(settings_obj)})


@api_view(['POST'])
def editor_default_apply_preview(request):
    entity_name = _entity_from_request(request)
    settings_obj = get_editor_defaults_for_entity(entity_name, _entity_id_from_request(request))
    if not settings_obj:
        return Response({
            'success': False,
            'error': 'No editor defaults found for this entity.',
        }, status=status.HTTP_404_NOT_FOUND)

    headers = request.data.get('headers') or []
    rows = request.data.get('rows') or []
    output_rows, summary = apply_editor_defaults_to_rows(headers, rows, settings_obj)
    return Response({
        'success': True,
        'headers': headers,
        'rows': output_rows,
        'summary': summary,
    })
