import csv
import json
import os
import re
import shutil
import uuid
from pathlib import Path

import pandas as pd
from django.conf import settings
from django.http import FileResponse
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import IntermediateArtifact


ALLOWED_FORMATS = {
    IntermediateArtifact.FORMAT_XLSX,
    IntermediateArtifact.FORMAT_CSV,
    IntermediateArtifact.FORMAT_JSON,
}


def _safe_slug(value, fallback='artifact'):
    text = str(value or '').strip().lower()
    text = re.sub(r'[^a-z0-9._-]+', '-', text)
    text = text.strip('-._')
    return (text or fallback)[:80]


def _artifact_root(session_id):
    safe_session = _safe_slug(session_id, 'default-session')
    root = Path(settings.MEDIA_ROOT) / 'intermediate_artifacts' / safe_session
    root.mkdir(parents=True, exist_ok=True)
    return root


def _normalize_rows(headers, rows):
    headers = [str(header or '') for header in (headers or [])]
    normalized = []
    for row in rows or []:
        if isinstance(row, dict):
            normalized.append([row.get(header, '') for header in headers])
        else:
            values = list(row or [])
            normalized.append([
                values[index] if index < len(values) else ''
                for index, _header in enumerate(headers)
            ])
    return headers, normalized


def serialize_artifact(artifact):
    return {
        'id': artifact.id,
        'session_id': artifact.session_id,
        'artifact_type': artifact.artifact_type,
        'label': artifact.label,
        'file_format': artifact.file_format,
        'row_count': artifact.row_count,
        'column_count': artifact.column_count,
        'metadata': artifact.metadata or {},
        'created_at': artifact.created_at.isoformat() if artifact.created_at else None,
    }


def save_rows_artifact(session_id, artifact_type, headers, rows, label='', metadata=None, file_format='xlsx'):
    """Persist a grid snapshot and return the IntermediateArtifact record."""
    session_id = str(session_id or '').strip()
    artifact_type = str(artifact_type or '').strip()
    if not session_id:
        raise ValueError('session_id is required')
    if not artifact_type:
        raise ValueError('artifact_type is required')
    if file_format not in ALLOWED_FORMATS:
        raise ValueError(f'Unsupported artifact format: {file_format}')

    headers, normalized_rows = _normalize_rows(headers, rows)
    root = _artifact_root(session_id)
    stem = f"{_safe_slug(artifact_type)}-{uuid.uuid4().hex[:10]}"
    file_path = root / f"{stem}.{file_format}"

    if file_format == IntermediateArtifact.FORMAT_XLSX:
        pd.DataFrame(normalized_rows, columns=headers).to_excel(file_path, index=False, engine='openpyxl')
    elif file_format == IntermediateArtifact.FORMAT_CSV:
        with file_path.open('w', newline='', encoding='utf-8-sig') as handle:
            writer = csv.writer(handle)
            writer.writerow(headers)
            writer.writerows(normalized_rows)
    else:
        with file_path.open('w', encoding='utf-8') as handle:
            json.dump({'headers': headers, 'rows': normalized_rows}, handle, ensure_ascii=False)

    return IntermediateArtifact.objects.create(
        session_id=session_id[:120],
        artifact_type=artifact_type[:80],
        label=str(label or '')[:255],
        file_path=str(file_path),
        file_format=file_format,
        row_count=len(normalized_rows),
        column_count=len(headers),
        metadata=metadata or {},
    )


def save_file_artifact(session_id, artifact_type, source_path, label='', metadata=None, file_format=None, row_count=0, column_count=0):
    """Copy an existing generated file into durable artifact storage."""
    session_id = str(session_id or '').strip()
    artifact_type = str(artifact_type or '').strip()
    if not session_id:
        raise ValueError('session_id is required')
    if not artifact_type:
        raise ValueError('artifact_type is required')

    source = Path(source_path)
    if not source.exists():
        raise ValueError('source file does not exist')

    inferred_format = (source.suffix or '').lstrip('.').lower()
    file_format = file_format or inferred_format or IntermediateArtifact.FORMAT_XLSX
    if file_format not in ALLOWED_FORMATS:
        raise ValueError(f'Unsupported artifact format: {file_format}')

    root = _artifact_root(session_id)
    target_name = f"{_safe_slug(artifact_type)}-{uuid.uuid4().hex[:10]}.{file_format}"
    target_path = root / target_name
    shutil.copy2(source, target_path)

    return IntermediateArtifact.objects.create(
        session_id=session_id[:120],
        artifact_type=artifact_type[:80],
        label=str(label or '')[:255],
        file_path=str(target_path),
        file_format=file_format,
        row_count=int(row_count or 0),
        column_count=int(column_count or 0),
        metadata=metadata or {},
    )


@api_view(['GET'])
def intermediate_artifacts(request):
    session_id = str(request.query_params.get('session_id') or '').strip()
    queryset = IntermediateArtifact.objects.all()
    if session_id:
        queryset = queryset.filter(session_id=session_id)

    artifact_type = str(request.query_params.get('artifact_type') or '').strip()
    if artifact_type:
        queryset = queryset.filter(artifact_type=artifact_type)

    limit = request.query_params.get('limit')
    try:
        limit = max(1, min(int(limit), 200)) if limit else 100
    except (TypeError, ValueError):
        limit = 100

    return Response({
        'success': True,
        'artifacts': [serialize_artifact(artifact) for artifact in queryset[:limit]],
    })


@api_view(['POST'])
def save_intermediate_artifact(request):
    data = request.data or {}
    headers = data.get('headers') or []
    rows = data.get('rows') or []
    if not isinstance(headers, list) or not isinstance(rows, list):
        return Response({'success': False, 'error': 'headers and rows must be arrays'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        artifact = save_rows_artifact(
            session_id=data.get('session_id'),
            artifact_type=data.get('artifact_type'),
            headers=headers,
            rows=rows,
            label=data.get('label') or '',
            metadata=data.get('metadata') if isinstance(data.get('metadata'), dict) else {},
            file_format=data.get('file_format') or IntermediateArtifact.FORMAT_XLSX,
        )
    except ValueError as exc:
        return Response({'success': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        return Response({'success': False, 'error': f'Failed to save artifact: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({'success': True, 'artifact': serialize_artifact(artifact)}, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def download_intermediate_artifact(request, artifact_id):
    try:
        artifact = IntermediateArtifact.objects.get(id=artifact_id)
    except IntermediateArtifact.DoesNotExist:
        return Response({'success': False, 'error': 'Artifact not found'}, status=status.HTTP_404_NOT_FOUND)

    file_path = Path(artifact.file_path)
    media_root = Path(settings.MEDIA_ROOT).resolve()
    try:
        resolved_path = file_path.resolve()
    except OSError:
        return Response({'success': False, 'error': 'Artifact file path is invalid'}, status=status.HTTP_404_NOT_FOUND)

    if media_root not in resolved_path.parents and resolved_path != media_root:
        return Response({'success': False, 'error': 'Artifact file path is outside media storage'}, status=status.HTTP_400_BAD_REQUEST)
    if not resolved_path.exists():
        return Response({'success': False, 'error': 'Artifact file is missing'}, status=status.HTTP_404_NOT_FOUND)

    download_name = os.path.basename(resolved_path)
    return FileResponse(open(resolved_path, 'rb'), as_attachment=True, filename=download_name)


@api_view(['DELETE'])
def delete_intermediate_artifact(request, artifact_id):
    try:
        artifact = IntermediateArtifact.objects.get(id=artifact_id)
    except IntermediateArtifact.DoesNotExist:
        return Response({'success': False, 'error': 'Artifact not found'}, status=status.HTTP_404_NOT_FOUND)

    file_path = Path(artifact.file_path)
    try:
        resolved_path = file_path.resolve()
        media_root = Path(settings.MEDIA_ROOT).resolve()
        if resolved_path.exists() and (media_root in resolved_path.parents or resolved_path == media_root):
            resolved_path.unlink()
    except OSError:
        pass
    artifact.delete()
    return Response({'success': True})
