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
        'entity_name': settings_obj.entity_name,
        'item_type': settings_obj.item_type or '',
        'procurement_item': settings_obj.procurement_item,
        'sales_item': settings_obj.sales_item,
        'measurement_unit': settings_obj.measurement_unit or '',
        'item_code_rule': settings_obj.item_code_rule or {},
        'updated_at': settings_obj.updated_at.isoformat() if settings_obj.updated_at else None,
    }


def get_editor_defaults_for_entity(entity_name):
    entity_name = _clean(entity_name)
    if not entity_name:
        return None
    return EditorDefaultSettings.objects.filter(entity_name=entity_name).first()


def _sanitize_item_code_rule(raw_rule):
    if not isinstance(raw_rule, dict):
        return {}
    mode = _clean(raw_rule.get('mode') or 'prefix_sequence')
    if mode not in {'prefix_sequence', 'fixed'}:
        mode = 'prefix_sequence'
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


def upsert_editor_defaults(entity_name, payload):
    entity_name = _clean(entity_name)
    if not entity_name:
        raise ValueError('entity_name is required until login entity context is wired in.')

    defaults = {}
    if 'item_type' in payload:
        defaults['item_type'] = _clean(payload.get('item_type'))
    if 'procurement_item' in payload:
        defaults['procurement_item'] = _truthy_or_none(payload.get('procurement_item'))
    if 'sales_item' in payload:
        defaults['sales_item'] = _truthy_or_none(payload.get('sales_item'))
    if 'measurement_unit' in payload:
        defaults['measurement_unit'] = _clean(payload.get('measurement_unit'))
    if 'item_code_rule' in payload:
        defaults['item_code_rule'] = _sanitize_item_code_rule(payload.get('item_code_rule'))

    settings_obj, _created = EditorDefaultSettings.objects.update_or_create(
        entity_name=entity_name,
        defaults=defaults,
    )
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

    return output_rows, {
        'entity_name': settings_obj.entity_name,
        'applied': applied,
        'skipped_missing_columns': sorted(set(skipped)),
    }


@api_view(['GET', 'POST'])
def editor_default_settings(request):
    entity_name = _entity_from_request(request)
    if not entity_name:
        return Response({
            'success': False,
            'error': 'entity_name is required until login entity context is wired in.',
        }, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'GET':
        settings_obj = get_editor_defaults_for_entity(entity_name)
        payload = serialize_editor_defaults(settings_obj) if settings_obj else {
            'entity_name': entity_name,
            'item_type': '',
            'procurement_item': None,
            'sales_item': None,
            'measurement_unit': '',
            'item_code_rule': {},
            'updated_at': None,
        }
        return Response({'success': True, 'settings': payload})

    try:
        settings_obj = upsert_editor_defaults(entity_name, request.data or {})
    except ValueError as exc:
        return Response({'success': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'success': True, 'settings': serialize_editor_defaults(settings_obj)})


@api_view(['POST'])
def editor_default_apply_preview(request):
    entity_name = _entity_from_request(request)
    settings_obj = get_editor_defaults_for_entity(entity_name)
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
