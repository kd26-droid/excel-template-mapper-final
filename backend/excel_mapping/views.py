from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import json
import pandas as pd
from io import BytesIO

from .serializers import (
    FileUploadSerializer,
    UploadSessionSerializer,
    ColumnMappingRequestSerializer,
    EditedDataSerializer,
    ColumnMappingSerializer
)
from .models import UploadSession, ColumnMapping, ProcessedData
from .utils import (
    generate_session_id,
    extract_excel_columns,
    read_excel_data,
    mock_ai_column_mapping,
    apply_column_mapping,
    generate_mock_upload_history,
    validate_excel_file
)

# Temporary storage for uploaded files (in production, use proper file storage)
temp_file_storage = {}


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_files(request):
    """API endpoint to upload user Excel file and Factwise template"""
    serializer = FileUploadSerializer(data=request.data)
    
    if not serializer.is_valid():
        return Response({
            'error': 'Invalid file upload',
            'details': serializer.errors
        }, status=status.HTTP_400_BAD_REQUEST)
    
    user_file = serializer.validated_data['user_file']
    template_file = serializer.validated_data['template_file']
    
    # Validate files
    user_valid, user_msg = validate_excel_file(user_file)
    template_valid, template_msg = validate_excel_file(template_file)
    
    if not user_valid:
        return Response({
            'error': f'User file validation failed: {user_msg}'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if not template_valid:
        return Response({
            'error': f'Template file validation failed: {template_msg}'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Generate session ID
        session_id = generate_session_id()
        
        # Read file contents
        user_file_content = user_file.read()
        template_file_content = template_file.read()
        
        # Store files temporarily
        temp_file_storage[session_id] = {
            'user_file': user_file_content,
            'template_file': template_file_content,
            'user_file_name': user_file.name,
            'template_file_name': template_file.name
        }
        
        # Extract column headers
        user_columns = extract_excel_columns(user_file_content, user_file.name)
        template_columns = extract_excel_columns(template_file_content, template_file.name)
        
        return Response({
            'session_id': session_id,
            'user_columns': user_columns,
            'template_columns': template_columns,
            'user_file_name': user_file.name,
            'template_file_name': template_file.name,
            'message': 'Files uploaded successfully'
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error processing files: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def get_column_mapping(request):
    """API endpoint to get AI-suggested column mappings"""
    session_id = request.data.get('session_id')
    
    if not session_id or session_id not in temp_file_storage:
        return Response({
            'error': 'Invalid session ID or session expired'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        file_data = temp_file_storage[session_id]
        
        # Extract columns again
        user_columns = extract_excel_columns(
            file_data['user_file'], 
            file_data['user_file_name']
        )
        template_columns = extract_excel_columns(
            file_data['template_file'], 
            file_data['template_file_name']
        )
        
        # Generate mock AI mappings
        mappings = mock_ai_column_mapping(template_columns, user_columns)
        
        return Response({
            'session_id': session_id,
            'mappings': mappings,
            'template_columns': template_columns,
            'user_columns': user_columns
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error generating column mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_column_mapping(request):
    """API endpoint to save user-confirmed column mappings"""
    serializer = ColumnMappingRequestSerializer(data=request.data)
    
    if not serializer.is_valid():
        return Response({
            'error': 'Invalid mapping data',
            'details': serializer.errors
        }, status=status.HTTP_400_BAD_REQUEST)
    
    session_id = serializer.validated_data['session_id']
    mappings = serializer.validated_data['mappings']
    
    if session_id not in temp_file_storage:
        return Response({
            'error': 'Invalid session ID or session expired'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        file_data = temp_file_storage[session_id]
        
        # Create upload session record
        upload_session = UploadSession.objects.create(
            session_id=session_id,
            template_name=file_data['template_file_name'],
            user_file_name=file_data['user_file_name'],
            template_file_name=file_data['template_file_name']
        )
        
        # Save column mappings
        for mapping in mappings:
            ColumnMapping.objects.create(
                upload_session=upload_session,
                template_column=mapping.get('template_column', ''),
                user_column=mapping.get('user_column', ''),
                confidence_score=mapping.get('confidence_score', 0.0),
                is_manual=mapping.get('is_manual', False)
            )
        
        return Response({
            'message': 'Column mappings saved successfully',
            'session_id': session_id
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error saving column mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_mapped_data(request):
    """API endpoint to get mapped data for editing"""
    session_id = request.GET.get('session_id')
    
    if not session_id or session_id not in temp_file_storage:
        return Response({
            'error': 'Invalid session ID or session expired'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        file_data = temp_file_storage[session_id]
        
        # Get saved mappings
        upload_session = UploadSession.objects.get(session_id=session_id)
        mappings = list(upload_session.mappings.values(
            'template_column', 'user_column', 'confidence_score', 'is_manual'
        ))
        
        # Read user data
        user_data = read_excel_data(
            file_data['user_file'], 
            file_data['user_file_name'],
            max_rows=50  # Limit for demo
        )
        
        # Apply mappings
        mapped_data = apply_column_mapping(user_data, mappings)
        
        # Convert to list of dictionaries for frontend
        data_rows = mapped_data.to_dict('records')
        
        # Update rows processed
        upload_session.rows_processed = len(data_rows)
        upload_session.save()
        
        return Response({
            'session_id': session_id,
            'columns': list(mapped_data.columns),
            'data': data_rows,
            'total_rows': len(data_rows)
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error getting mapped data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_edited_data(request):
    """API endpoint to save user-edited spreadsheet data"""
    serializer = EditedDataSerializer(data=request.data)
    
    if not serializer.is_valid():
        return Response({
            'error': 'Invalid edited data',
            'details': serializer.errors
        }, status=status.HTTP_400_BAD_REQUEST)
    
    session_id = serializer.validated_data['session_id']
    edited_data = serializer.validated_data['data']
    
    try:
        upload_session = UploadSession.objects.get(session_id=session_id)
        
        # Clear existing processed data
        ProcessedData.objects.filter(upload_session=upload_session).delete()
        
        # Save edited data
        for row_index, row_data in enumerate(edited_data):
            for column_name, value in row_data.items():
                ProcessedData.objects.create(
                    upload_session=upload_session,
                    row_index=row_index,
                    column_name=column_name,
                    edited_value=str(value) if value is not None else ''
                )
        
        # Update session status
        upload_session.status = 'completed'
        upload_session.rows_processed = len(edited_data)
        upload_session.save()
        
        return Response({
            'message': 'Data saved successfully',
            'session_id': session_id,
            'rows_saved': len(edited_data)
        }, status=status.HTTP_200_OK)
    
    except UploadSession.DoesNotExist:
        return Response({
            'error': 'Session not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({
            'error': f'Error saving edited data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_upload_dashboard(request):
    """API endpoint to get dashboard data with upload history"""
    try:
        # For now, return mock data. In production, query actual database
        mock_uploads = generate_mock_upload_history()
        
        # Also include real uploads from database
        real_uploads = UploadSession.objects.all().order_by('-upload_date')[:10]
        real_uploads_data = UploadSessionSerializer(real_uploads, many=True).data
        
        # Combine mock and real data
        all_uploads = list(real_uploads_data) + mock_uploads
        
        return Response({
            'uploads': all_uploads,
            'total_count': len(all_uploads)
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error fetching dashboard data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def download_processed_file(request):
    """API endpoint to download processed Excel file (mock implementation)"""
    session_id = request.GET.get('session_id')
    
    if not session_id:
        return Response({
            'error': 'Session ID required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Mock implementation - in production, generate actual Excel file
        return Response({
            'message': 'File download would start here',
            'session_id': session_id,
            'download_url': f'/api/files/download/{session_id}.xlsx'
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({
            'error': f'Error preparing download: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def health_check(request):
    """Simple health check endpoint"""
    return Response({
        'status': 'healthy',
        'message': 'Excel Mapper API is running'
    }, status=status.HTTP_200_OK)
