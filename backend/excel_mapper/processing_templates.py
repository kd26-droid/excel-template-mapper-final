from difflib import SequenceMatcher
import uuid

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import ProcessingTemplate


def _clean_name(value):
    return str(value or '').strip()[:200]


def _clean_status(value):
    allowed = {choice[0] for choice in ProcessingTemplate.STATUS_CHOICES}
    status_value = str(value or ProcessingTemplate.STATUS_DRAFT).strip().lower()
    return status_value if status_value in allowed else ProcessingTemplate.STATUS_DRAFT


def _clean_dict(value):
    return value if isinstance(value, dict) else {}


def _clean_list(value):
    return value if isinstance(value, list) else []


def _clean_version(value):
    try:
        return max(1, int(value or 1))
    except (TypeError, ValueError):
        return 1


def _normalize_key(value):
    return ''.join(ch.lower() for ch in str(value or '') if ch.isalnum())


def _header_keys(value):
    raw = str(value or '').strip()
    normalized = _normalize_key(raw)
    words = [word for word in ''.join(ch.lower() if ch.isalnum() else ' ' for ch in raw).split() if word]
    keys = {normalized}
    if len(words) > 1:
        keys.add(''.join(word[0] for word in words))

    aliases = {
        'qty': 'quantity',
        'quantity': 'qty',
        'mfr': 'manufacturer',
        'manufacturer': 'mfr',
        'mpn': 'manufacturerpartnumber',
        'manufacturerpartnumber': 'mpn',
        'uom': 'unitofmeasure',
        'unitofmeasure': 'uom',
    }
    for key in list(keys):
        if key in aliases:
            keys.add(aliases[key])
    return {key for key in keys if key}


def _similarity_score(left, right):
    left_keys = _header_keys(left)
    right_keys = _header_keys(right)
    if not left_keys or not right_keys:
        return 0
    if left_keys.intersection(right_keys):
        return 100
    return max(
        round(SequenceMatcher(None, left_key, right_key).ratio() * 100)
        for left_key in left_keys
        for right_key in right_keys
    )


def _match_header(saved_header, current_headers, threshold=80):
    if not saved_header:
        return {'saved_header': saved_header, 'matched_header': '', 'score': 0, 'status': 'missing'}

    best_header = ''
    best_score = 0
    for current_header in current_headers:
        score = _similarity_score(saved_header, current_header)
        if score > best_score:
            best_header = current_header
            best_score = score

    return {
        'saved_header': saved_header,
        'matched_header': best_header if best_score >= threshold else '',
        'score': best_score,
        'status': 'matched' if best_score >= threshold else 'missing',
    }


def _validate_source_requirements(template, current_requirements):
    saved_requirements = template.source_requirements or {}
    current_requirements = _clean_dict(current_requirements)
    threshold = int(current_requirements.get('header_match_threshold') or 80)
    errors = []
    warnings = []
    header_matches = []

    saved_count = int(saved_requirements.get('source_count') or 0)
    current_count = int(current_requirements.get('source_count') or 0)
    if saved_count != current_count:
        errors.append(
            f'Template expects {saved_count} source file(s), but current setup has {current_count}.'
        )

    saved_sources = saved_requirements.get('sources') if isinstance(saved_requirements.get('sources'), list) else []
    current_sources = current_requirements.get('sources') if isinstance(current_requirements.get('sources'), list) else []

    for index, saved_source in enumerate(saved_sources):
        current_source = current_sources[index] if index < len(current_sources) else {}
        saved_headers = saved_source.get('headers') if isinstance(saved_source, dict) and isinstance(saved_source.get('headers'), list) else []
        current_headers = current_source.get('headers') if isinstance(current_source, dict) and isinstance(current_source.get('headers'), list) else []
        source_matches = []
        for saved_header in saved_headers:
            match = _match_header(saved_header, current_headers, threshold)
            source_matches.append(match)
        missing = [match for match in source_matches if match['status'] != 'matched']
        if missing:
            errors.append(
                f'Source {index + 1} is missing {len(missing)} required header(s) at {threshold}% match strictness.'
            )
        header_matches.append({
            'source_position': index + 1,
            'matches': source_matches,
        })

    provider_snapshot = template.provider_snapshot or {}
    selected_providers = provider_snapshot.get('selected_providers')
    if selected_providers:
        warnings.append('Provider credential validation will be checked in the replay chunk.')

    return {
        'valid': not errors,
        'errors': errors,
        'warnings': warnings,
        'header_match_threshold': threshold,
        'header_matches': header_matches,
    }


def _clean_rows(value):
    return value if isinstance(value, list) else []


def _headers_from_rows(rows):
    headers = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            if key not in seen:
                headers.append(key)
                seen.add(key)
    return headers


@api_view(['GET', 'POST'])
def processing_templates(request):
    if request.method == 'GET':
        templates = ProcessingTemplate.objects.exclude(status=ProcessingTemplate.STATUS_ARCHIVED)
        return Response({
            'success': True,
            'templates': [template.to_dict(include_definition=False) for template in templates],
        })

    name = _clean_name(request.data.get('name'))
    if not name:
        return Response({'success': False, 'error': 'Template name is required'}, status=status.HTTP_400_BAD_REQUEST)

    template, created = ProcessingTemplate.objects.update_or_create(
        name=name,
        defaults={
            'description': str(request.data.get('description') or '').strip(),
            'status': _clean_status(request.data.get('status')),
            'version': _clean_version(request.data.get('version')),
            'source_requirements': _clean_dict(request.data.get('source_requirements')),
            'stages': _clean_list(request.data.get('stages')),
            'provider_snapshot': _clean_dict(request.data.get('provider_snapshot')),
            'metadata': _clean_dict(request.data.get('metadata')),
        },
    )

    return Response({
        'success': True,
        'created': created,
        'template': template.to_dict(),
        'message': f'Template "{template.name}" saved successfully',
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['GET', 'PATCH', 'DELETE'])
def processing_template_detail(request, template_id):
    try:
        template = ProcessingTemplate.objects.get(id=template_id)
    except ProcessingTemplate.DoesNotExist:
        return Response({'success': False, 'error': 'Template not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        name = template.name
        template.delete()
        return Response({'success': True, 'message': f'Template "{name}" deleted successfully'})

    if request.method == 'PATCH':
        if 'name' in request.data:
            name = _clean_name(request.data.get('name'))
            if not name:
                return Response({'success': False, 'error': 'Template name is required'}, status=status.HTTP_400_BAD_REQUEST)
            template.name = name
        if 'description' in request.data:
            template.description = str(request.data.get('description') or '').strip()
        if 'status' in request.data:
            template.status = _clean_status(request.data.get('status'))
        if 'version' in request.data:
            template.version = _clean_version(request.data.get('version'))
        if 'source_requirements' in request.data:
            template.source_requirements = _clean_dict(request.data.get('source_requirements'))
        if 'stages' in request.data:
            template.stages = _clean_list(request.data.get('stages'))
        if 'provider_snapshot' in request.data:
            template.provider_snapshot = _clean_dict(request.data.get('provider_snapshot'))
        if 'metadata' in request.data:
            template.metadata = _clean_dict(request.data.get('metadata'))
        template.save()
        return Response({
            'success': True,
            'template': template.to_dict(),
            'message': f'Template "{template.name}" updated successfully',
        })

    template.increment_usage()
    return Response({'success': True, 'template': template.to_dict()})


@api_view(['POST'])
def processing_template_validate(request, template_id):
    try:
        template = ProcessingTemplate.objects.get(id=template_id)
    except ProcessingTemplate.DoesNotExist:
        return Response({'success': False, 'error': 'Template not found'}, status=status.HTTP_404_NOT_FOUND)

    validation = _validate_source_requirements(template, request.data.get('source_requirements'))
    return Response({
        'success': True,
        'template_id': template.id,
        'validation': validation,
    }, status=status.HTTP_200_OK if validation['valid'] else status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
def processing_template_editor_session(request):
    headers = _clean_list(request.data.get('headers'))
    rows = _clean_rows(request.data.get('rows'))
    template_id = request.data.get('template_id')
    template_name = str(request.data.get('template_name') or '').strip()

    if not rows:
        return Response({'success': False, 'error': 'Rows are required'}, status=status.HTTP_400_BAD_REQUEST)

    if not headers:
        headers = _headers_from_rows(rows)

    if not headers:
        return Response({'success': False, 'error': 'Headers are required'}, status=status.HTTP_400_BAD_REQUEST)

    session_id = f"template_replay_{uuid.uuid4().hex[:16]}"
    normalized_rows = []
    for row in rows:
        if isinstance(row, dict):
            normalized_rows.append({header: row.get(header, '') for header in headers})
        elif isinstance(row, list):
            normalized_rows.append({header: row[index] if index < len(row) else '' for index, header in enumerate(headers)})

    session_data = {
        'session_id': session_id,
        'source_type': 'template_replay',
        'client_file': template_name or 'Template replay output',
        'original_client_name': template_name or 'Template replay output',
        'template_headers': list(headers),
        'current_template_headers': list(headers),
        'enhanced_headers': list(headers),
        'mapped_headers': list(headers),
        'enhanced_data': {
            'headers': list(headers),
            'data': normalized_rows,
        },
        'edited_data': {
            'headers': list(headers),
            'data': normalized_rows,
        },
        'mapped_data': normalized_rows,
        'template_replay': {
            'template_id': template_id,
            'template_name': template_name,
            'row_count': len(normalized_rows),
            'column_count': len(headers),
        },
    }

    try:
        from .views import save_session
        save_session(session_id, session_data)
    except Exception as exc:
        return Response({
            'success': False,
            'error': f'Could not create mapped workbook session: {exc}',
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({
        'success': True,
        'session_id': session_id,
        'row_count': len(normalized_rows),
        'column_count': len(headers),
    })
