from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import BomWorkflowTemplate


def _clean_name(value):
    return str(value or '').strip()[:200]


def _clean_dict(value):
    return value if isinstance(value, dict) else {}


@api_view(['GET', 'POST'])
def bom_workflow_templates(request):
    if request.method == 'GET':
        templates = BomWorkflowTemplate.objects.all()
        return Response({
            'success': True,
            'templates': [template.to_dict() for template in templates],
        })

    name = _clean_name(request.data.get('name'))
    if not name:
        return Response({'success': False, 'error': 'Template name is required'}, status=status.HTTP_400_BAD_REQUEST)

    workflow = _clean_dict(request.data.get('workflow'))
    if not workflow:
        return Response({'success': False, 'error': 'Workflow data is required'}, status=status.HTTP_400_BAD_REQUEST)

    template, created = BomWorkflowTemplate.objects.update_or_create(
        name=name,
        defaults={
            'description': str(request.data.get('description') or '').strip(),
            'source_signature': _clean_dict(request.data.get('source_signature')),
            'workflow': workflow,
        },
    )
    return Response({
        'success': True,
        'created': created,
        'template': template.to_dict(),
        'message': f'Workflow template "{template.name}" saved successfully',
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['GET', 'DELETE'])
def bom_workflow_template_detail(request, template_id):
    try:
        template = BomWorkflowTemplate.objects.get(id=template_id)
    except BomWorkflowTemplate.DoesNotExist:
        return Response({'success': False, 'error': 'Workflow template not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        name = template.name
        template.delete()
        return Response({'success': True, 'message': f'Workflow template "{name}" deleted successfully'})

    template.increment_usage()
    return Response({'success': True, 'template': template.to_dict()})
