from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import BomStructurePattern
from .services.bom_structure_patterns import (
    build_structure_profile,
    learn_bom_structure,
    match_bom_structures,
)


def _clean_list(value):
    return value if isinstance(value, list) else []


def _clean_dict(value):
    return value if isinstance(value, dict) else {}


@api_view(['GET', 'POST'])
def bom_structure_patterns(request):
    """List or learn reusable BOM source-sheet structures."""
    if request.method == 'GET':
        return Response({
            'success': True,
            'structures': [pattern.to_dict() for pattern in BomStructurePattern.objects.all()[:100]],
        })

    headers = _clean_list(request.data.get('headers'))
    rows = _clean_list(request.data.get('rows'))
    roles = _clean_dict(request.data.get('roles'))
    config = _clean_dict(request.data.get('config'))
    source_signature = _clean_dict(request.data.get('source_signature') or request.data.get('sourceSignature'))
    workflow = _clean_dict(request.data.get('workflow'))
    name = str(request.data.get('name') or source_signature.get('fileName') or source_signature.get('sheetName') or '').strip()

    if not headers:
        headers = _clean_list(source_signature.get('headers'))
    if not headers:
        return Response({'success': False, 'error': 'headers are required'}, status=status.HTTP_400_BAD_REQUEST)

    pattern, created = learn_bom_structure(
        name=name,
        headers=headers,
        rows=rows,
        roles=roles,
        config=config,
        source_signature=source_signature,
        workflow=workflow,
        confidence=request.data.get('confidence') or 1.0,
    )
    return Response({
        'success': True,
        'created': created,
        'structure': pattern.to_dict(),
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['POST'])
def bom_structure_match(request):
    """Return saved source structures that resemble the current sheet."""
    headers = _clean_list(request.data.get('headers'))
    rows = _clean_list(request.data.get('rows'))
    roles = _clean_dict(request.data.get('roles'))
    config = _clean_dict(request.data.get('config'))
    source_signature = _clean_dict(request.data.get('source_signature') or request.data.get('sourceSignature'))
    limit = request.data.get('limit') or 5

    if not headers:
        return Response({'success': False, 'error': 'headers are required'}, status=status.HTTP_400_BAD_REQUEST)

    result = match_bom_structures(
        headers=headers,
        rows=rows,
        roles=roles,
        config=config,
        source_signature=source_signature,
        limit=limit,
    )
    return Response({'success': True, **result})


@api_view(['POST'])
def bom_structure_profile(request):
    """Return the current sheet's structure profile without saving it."""
    headers = _clean_list(request.data.get('headers'))
    rows = _clean_list(request.data.get('rows'))
    roles = _clean_dict(request.data.get('roles'))
    config = _clean_dict(request.data.get('config'))
    source_signature = _clean_dict(request.data.get('source_signature') or request.data.get('sourceSignature'))

    if not headers:
        return Response({'success': False, 'error': 'headers are required'}, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        'success': True,
        'structureProfile': build_structure_profile(
            headers=headers,
            rows=rows,
            roles=roles,
            config=config,
            source_signature=source_signature,
        ),
    })
