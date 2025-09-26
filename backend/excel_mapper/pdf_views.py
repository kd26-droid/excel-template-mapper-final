"""
PDF processing views for handling PDF upload and OCR
"""
import os
import json
import tempfile
import logging
import uuid
from datetime import datetime
from typing import Dict, Any

from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import PDFSession, PDFPage, PDFExtractionResult
from .services.pdf_processor import PDFProcessor
from .services.azure_ocr_service import AzureOCRService

logger = logging.getLogger(__name__)


@api_view(['POST'])
def upload_pdf(request):
    """
    Handle PDF file upload and create processing session
    """
    try:
        if 'file' not in request.FILES:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

        uploaded_file = request.FILES['file']

        # Validate file type
        if not uploaded_file.name.lower().endswith('.pdf'):
            return Response({'error': 'File must be a PDF'}, status=status.HTTP_400_BAD_REQUEST)

        # Generate session ID
        session_id = str(uuid.uuid4())

        # Save uploaded file temporarily
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, f"{session_id}.pdf")

        with open(file_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        # Initialize PDF processor
        pdf_processor = PDFProcessor()

        # Validate PDF file
        validation_result = pdf_processor.validate_pdf_file(file_path, uploaded_file.size)
        if not validation_result['valid']:
            os.remove(file_path)  # Clean up
            return Response({'error': validation_result['error']}, status=status.HTTP_400_BAD_REQUEST)

        # Create PDF session
        pdf_session = PDFSession.objects.create(
            session_id=session_id,
            original_pdf_path=file_path,
            total_pages=validation_result['page_count'],
            file_name=uploaded_file.name,
            file_size=uploaded_file.size,
            processing_status='pending'
        )

        # Convert PDF to images
        try:
            page_info = pdf_processor.convert_to_images(file_path, session_id)

            # Save page information to database
            for page_data in page_info:
                PDFPage.objects.create(
                    pdf_session=pdf_session,
                    page_number=page_data['page_number'],
                    image_path=page_data['image_path'],
                    width=page_data['width'],
                    height=page_data['height']
                )

            # Update session status
            pdf_session.processing_status = 'completed'
            pdf_session.save()

            logger.info(f"PDF upload successful: {session_id}")

            return Response({
                'session_id': session_id,
                'total_pages': validation_result['page_count'],
                'file_name': uploaded_file.name,
                'file_size': uploaded_file.size,
                'pages': page_info,
                'status': 'ready_for_processing'
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            # Clean up on error
            pdf_processor.cleanup_session_files(session_id)
            pdf_session.processing_status = 'failed'
            pdf_session.save()
            logger.error(f"Error processing PDF: {e}")
            return Response({'error': f'PDF processing failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    except Exception as e:
        logger.error(f"Error in PDF upload: {e}")
        return Response({'error': f'Upload failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def process_pdf_ocr(request):
    """
    Process PDF using Azure OCR for table extraction
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'error': 'Session ID required'}, status=status.HTTP_400_BAD_REQUEST)

        # Get PDF session
        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
        except PDFSession.DoesNotExist:
            return Response({'error': 'Invalid session ID'}, status=status.HTTP_404_NOT_FOUND)

        if pdf_session.processing_status != 'completed':
            return Response({'error': 'PDF not ready for OCR processing'}, status=status.HTTP_400_BAD_REQUEST)

        # Update status to processing
        pdf_session.processing_status = 'processing'
        pdf_session.save()

        # Initialize Azure OCR service
        try:
            ocr_service = AzureOCRService()
        except ValueError as e:
            # Azure credentials not configured
            pdf_session.processing_status = 'failed'
            pdf_session.save()
            logger.error(f"Azure OCR service initialization failed: {e}")
            return Response({
                'error': 'PDF processing service not configured. Azure Document Intelligence credentials are required.'
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            # Process the original PDF file with Azure OCR
            extraction_result = ocr_service.analyze_pdf_file(pdf_session.original_pdf_path)

            # Validate extraction quality
            validation_result = ocr_service.validate_extraction_quality(extraction_result)

            # Determine alignment mode from request (default: preserve)
            alignment_mode = request.data.get('data_alignment', 'preserve')
            if alignment_mode not in ('preserve', 'flatten'):
                alignment_mode = 'preserve'

            # Convert to DataFrame format using requested alignment
            df = ocr_service.convert_to_dataframe(extraction_result, alignment_mode=alignment_mode)

            # Save extraction results
            pdf_extraction = PDFExtractionResult.objects.create(
                pdf_session=pdf_session,
                page_numbers=list(range(1, pdf_session.total_pages + 1)),
                extracted_headers=list(df.columns) if not df.empty else [],
                extracted_data=df.values.tolist() if not df.empty else [],
                confidence_scores=extraction_result['confidence_scores'],
                quality_metrics=extraction_result['quality_metrics'],
                table_count=extraction_result['table_count']
            )

            # Update session status
            pdf_session.processing_status = 'completed'
            pdf_session.save()

            # Create compatible session for column mapping interface
            from .views import save_session
            import tempfile
            import os

            try:
                # Create a temporary CSV file with the extracted data
                if not df.empty:
                    temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)
                    # IMPORTANT: Save without headers to avoid header contamination in data rows
                    # The headers are stored separately in the session configuration
                    df.to_csv(temp_file.name, index=False, header=False)
                    temp_file.close()

                    # Get the default FACTWISE.xlsx template path
                    from django.conf import settings
                    from pathlib import Path

                    factwise_template_path = Path(settings.BASE_DIR) / 'FACTWISE.xlsx'
                    if not factwise_template_path.exists():
                        factwise_template_path = Path(settings.BASE_DIR) / 'test_files' / 'FACTWISE.xlsx'

                    # Create session data compatible with the existing system
                    session_data = {
                        'session_id': session_id,
                        'client_path': temp_file.name,
                        'template_path': str(factwise_template_path),
                        'original_client_name': pdf_session.file_name,
                        'original_template_name': 'FACTWISE.xlsx',
                        'sheet_name': 'PDF_Data',
                        'header_row': 1,  # Keep as 1 for compatibility, handled specially in apply_column_mappings
                        'template_sheet_name': 'Templates',
                        'template_header_row': 1,
                        'created': datetime.utcnow().isoformat(),
                        'mappings': None,
                        'edited_data': None,
                        'original_template_id': None,
                        'template_modified': False,
                        'formula_rules': [],
                        'is_fixed_template_mode': False,
                        'factwise_headers': None,
                        'tags_count': 3,
                        'spec_pairs_count': 3,
                        'customer_id_pairs_count': 1,
                        'template_version': 0,
                        'source_type': 'pdf'
                    }

                    # Save using the existing session management system
                    save_session(session_id, session_data)

                    logger.info(f"Created compatible session for PDF: {session_id}")

            except Exception as e:
                logger.error(f"Error creating compatible session: {e}")
                # Continue anyway, PDF processing was successful

            logger.info(f"PDF OCR processing completed: {session_id}")

            return Response({
                'session_id': session_id,
                'extraction_id': pdf_extraction.id,
                'headers': list(df.columns) if not df.empty else [],
                'data': df.values.tolist() if not df.empty else [],
                'table_count': extraction_result['table_count'],
                'quality_metrics': extraction_result['quality_metrics'],
                'validation': validation_result,
                'row_count': len(df) if not df.empty else 0,
                'column_count': len(df.columns) if not df.empty else 0,
                'status': 'completed',
                'alignment_mode': alignment_mode
            }, status=status.HTTP_200_OK)

        except Exception as e:
            # Update session status to failed
            pdf_session.processing_status = 'failed'
            pdf_session.save()
            logger.error(f"Error in OCR processing: {e}")
            return Response({'error': f'OCR processing failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    except Exception as e:
        logger.error(f"Error in PDF OCR processing: {e}")
        return Response({'error': f'Processing failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_pdf_session_status(request, session_id):
    """
    Get the status of a PDF processing session
    """
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)

        # Get pages
        pages = PDFPage.objects.filter(pdf_session=pdf_session).order_by('page_number')
        page_data = [
            {
                'page_number': page.page_number,
                'width': page.width,
                'height': page.height,
                'processed': page.processed
            }
            for page in pages
        ]

        # Get extraction results if available
        extraction_data = None
        extractions = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at')
        if extractions.exists():
            extraction = extractions.first()
            extraction_data = {
                'extraction_id': extraction.id,
                'headers': extraction.extracted_headers,
                'data': extraction.extracted_data,
                'confidence_scores': extraction.confidence_scores,
                'quality_metrics': extraction.quality_metrics,
                'table_count': extraction.table_count,
                'row_count': len(extraction.extracted_data),
                'column_count': len(extraction.extracted_headers)
            }

        return Response({
            'session_id': session_id,
            'status': pdf_session.processing_status,
            'file_name': pdf_session.file_name,
            'file_size': pdf_session.file_size,
            'total_pages': pdf_session.total_pages,
            'pages': page_data,
            'extraction': extraction_data,
            'created_at': pdf_session.created_at.isoformat(),
            'updated_at': pdf_session.updated_at.isoformat()
        }, status=status.HTTP_200_OK)

    except PDFSession.DoesNotExist:
        return Response({'error': 'Invalid session ID'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error getting session status: {e}")
        return Response({'error': f'Status check failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def cleanup_pdf_session(request):
    """
    Clean up temporary files for a PDF session
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'error': 'Session ID required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
        except PDFSession.DoesNotExist:
            return Response({'error': 'Invalid session ID'}, status=status.HTTP_404_NOT_FOUND)

        # Clean up temporary files
        pdf_processor = PDFProcessor()
        cleanup_success = pdf_processor.cleanup_session_files(session_id)

        # Remove original PDF file
        if os.path.exists(pdf_session.original_pdf_path):
            try:
                os.remove(pdf_session.original_pdf_path)
            except Exception as e:
                logger.warning(f"Could not remove original PDF file: {e}")

        return Response({
            'session_id': session_id,
            'cleanup_successful': cleanup_success,
            'message': 'Session files cleaned up'
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f"Error cleaning up session: {e}")
        return Response({'error': f'Cleanup failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_page_image(request, session_id, page_number):
    """
    Serve a page image for the frontend
    """
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)
        page = PDFPage.objects.get(pdf_session=pdf_session, page_number=page_number)

        if not os.path.exists(page.image_path):
            return Response({'error': 'Page image not found'}, status=status.HTTP_404_NOT_FOUND)

        with open(page.image_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type='image/png')
            response['Cache-Control'] = 'max-age=3600'  # Cache for 1 hour
            return response

    except (PDFSession.DoesNotExist, PDFPage.DoesNotExist):
        return Response({'error': 'Page not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error serving page image: {e}")
        return Response({'error': f'Image retrieval failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
