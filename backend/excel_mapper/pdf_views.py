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


def analyze_pdf_complexity(pdf_path: str, total_pages: int) -> dict:
    """
    Analyze PDF complexity to determine if zonal mapping is needed
    Returns complexity analysis results
    """
    try:
        complexity_score = 0
        reasons = []

        # Rule 1: Only very large documents are considered complex based on page count
        if total_pages > 10:
            complexity_score += 30
            reasons.append(f"Very large document ({total_pages} pages)")
        elif total_pages > 5:
            complexity_score += 15
            reasons.append(f"Large document ({total_pages} pages)")

        # Rule 2: BOM-like filename patterns strongly indicate complexity
        filename = os.path.basename(pdf_path).lower()
        bom_keywords = ['bom', 'bill', 'material', 'parts', 'component', 'inventory', 'list']
        if any(keyword in filename for keyword in bom_keywords):
            complexity_score += 50
            reasons.append("BOM-related filename detected")

        # Rule 3: UUID-like filenames are neutral (many simple PDFs get UUID names)
        import re
        if re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', filename):
            complexity_score += 5  # Reduced from 25 to 5
            reasons.append("Generated document (UUID filename)")

        # Rule 4: Very large file size indicates complexity
        try:
            file_size = os.path.getsize(pdf_path)
            if file_size > 5 * 1024 * 1024:  # > 5MB
                complexity_score += 20
                reasons.append("Very large file size")
            elif file_size > 1024 * 1024:  # > 1MB
                complexity_score += 10
                reasons.append("Large file size")
        except Exception:
            pass

        # Determine if zonal mapping should be used (increased threshold)
        requires_zonal = complexity_score >= 70  # Increased from 50 to 70
        complexity_level = "complex" if requires_zonal else "simple"

        return {
            'complexity': complexity_level,
            'requires_zonal_mapping': requires_zonal,
            'complexity_score': complexity_score,
            'reasons': reasons,
            'total_pages': total_pages,
            'filename': filename
        }

    except Exception as e:
        logger.error(f"Error analyzing PDF complexity: {e}")
        # Default to simple processing on error
        return {
            'complexity': 'simple',
            'requires_zonal_mapping': False,
            'complexity_score': 0,
            'reasons': ['Error in complexity analysis - defaulting to simple'],
            'total_pages': total_pages,
            'filename': os.path.basename(pdf_path) if pdf_path else 'unknown'
        }


@api_view(['POST'])
def analyze_pdf_complexity_endpoint(request):
    """
    Analyze PDF complexity for a session
    POST /pdf/analyze-complexity/
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'error': 'session_id is required'}, status=400)

        # Get PDF session
        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
        except PDFSession.DoesNotExist:
            return Response({'error': 'Session not found'}, status=404)

        # Analyze complexity
        analysis = analyze_pdf_complexity(pdf_session.original_pdf_path, pdf_session.total_pages)

        # Store analysis results in session metadata
        pdf_session.processing_metadata = {
            **pdf_session.processing_metadata,
            'complexity_analysis': analysis
        }
        pdf_session.save()

        return Response(analysis)

    except Exception as e:
        logger.error(f"Error in analyze_pdf_complexity_endpoint: {e}")
        return Response({'error': 'Internal server error'}, status=500)


@api_view(['GET'])
def get_pdf_session(request, session_id):
    """Get PDF session details (robust fields)."""
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)

        # Get pages for this session
        pages_qs = PDFPage.objects.filter(pdf_session=pdf_session).order_by('page_number')
        pages = [
            {
                'page_number': p.page_number,
                'width': p.width,
                'height': p.height,
                'processed': bool(p.processed),
            }
            for p in pages_qs
        ]

        # Get latest extraction summary if available (robust to schema drift)
        extraction_summary = None
        try:
            latest = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
            if latest:
                extraction_summary = {
                    'extraction_id': latest.id,
                    'headers': latest.extracted_headers,
                    'row_count': len(latest.extracted_data or []),
                    'column_count': len(latest.extracted_headers or []),
                    'table_count': latest.table_count,
                    'quality_metrics': latest.quality_metrics,
                    'created_at': latest.created_at.isoformat()
                }
        except Exception as _e:
            # If DB schema lacks newer columns (e.g., zone_id), skip extraction summary
            extraction_summary = None

        return Response({
            'session_id': pdf_session.session_id,
            'original_pdf_path': pdf_session.original_pdf_path,
            'upload_timestamp': pdf_session.created_at.isoformat() if pdf_session.created_at else None,
            'status': pdf_session.processing_status,
            'total_pages': pdf_session.total_pages,
            'file_name': pdf_session.file_name,
            'file_size': pdf_session.file_size,
            'pages': pages,
            'extraction': extraction_summary
        })

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error getting PDF session {session_id}: {e}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_pdf_file(request, session_id):
    """Serve the original PDF file for a session"""
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)

        # Check if the PDF file exists
        if not os.path.exists(pdf_session.original_pdf_path):
            return Response({'error': 'PDF file not found'}, status=status.HTTP_404_NOT_FOUND)

        # Return the PDF file
        with open(pdf_session.original_pdf_path, 'rb') as pdf_file:
            response = HttpResponse(pdf_file.read(), content_type='application/pdf')
            response['Content-Disposition'] = f'inline; filename="{pdf_session.file_name}"'
            return response

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error serving PDF file for session {session_id}: {e}")
        return Response({'error': 'Internal server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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

            # Determine alignment mode from request (default: align)
            # 'align' = align rows across pages + keep original headers (recommended for multi-page PDFs)
            # 'preserve' = append rows sequentially + keep original headers
            # 'flatten' = align rows across pages + normalize headers (e.g., MFR → Manufacturer)
            alignment_mode = request.data.get('data_alignment', 'align')
            if alignment_mode not in ('preserve', 'flatten', 'align'):
                alignment_mode = 'align'

            # Convert to DataFrame format using requested alignment
            df = ocr_service.convert_to_dataframe(extraction_result, alignment_mode=alignment_mode)

            # Derive header-level confidence scores aligned to DataFrame headers
            # Fall back to overall/header confidence metric if detailed per-header scores are unavailable
            header_confidence_scores = {}
            try:
                # Prefer header confidence metric from quality metrics
                metrics = extraction_result.get('quality_metrics') or {}
                overall_header_conf = metrics.get('header_confidence')
                overall_conf = metrics.get('overall_confidence')

                # Build a mapping for each header in the final DataFrame
                if not df.empty:
                    inferred_conf = overall_header_conf if isinstance(overall_header_conf, (int, float)) else overall_conf
                    if inferred_conf is None:
                        inferred_conf = 0.8  # safe default
                    header_confidence_scores = {str(h): float(inferred_conf) for h in list(df.columns)}
            except Exception as _e:
                # Non-fatal; keep empty mapping
                header_confidence_scores = {str(h): 0.8 for h in list(df.columns)} if not df.empty else {}

            # Save extraction results (tolerate schema differences for page_numbers)
            try:
                pdf_extraction = PDFExtractionResult.objects.create(
                    pdf_session=pdf_session,
                    page_numbers=list(range(1, pdf_session.total_pages + 1)),
                    extracted_headers=list(df.columns) if not df.empty else [],
                    extracted_data=df.values.tolist() if not df.empty else [],
                    # Augment confidence_scores with header_confidence mapped to final headers
                    confidence_scores={
                        **(extraction_result.get('confidence_scores') or {}),
                        'header_confidence': header_confidence_scores
                    },
                    quality_metrics=extraction_result['quality_metrics'],
                    table_count=extraction_result['table_count']
                )
            except TypeError as te:
                # Backward compatibility: older schema may not have page_numbers field
                logger.warning(f"PDFExtractionResult create mismatch, retrying without page_numbers: {te}")
                qm = dict(extraction_result.get('quality_metrics') or {})
                try:
                    qm['page_numbers'] = list(range(1, pdf_session.total_pages + 1))
                except Exception:
                    pass
                pdf_extraction = PDFExtractionResult.objects.create(
                    pdf_session=pdf_session,
                    extracted_headers=list(df.columns) if not df.empty else [],
                    extracted_data=df.values.tolist() if not df.empty else [],
                    confidence_scores={
                        **(extraction_result.get('confidence_scores') or {}),
                        'header_confidence': header_confidence_scores
                    },
                    quality_metrics=qm,
                    table_count=extraction_result['table_count']
                )
            except Exception as db_e:
                # As a last resort, raw insert only known columns (DB may lack added fields like zone_id)
                logger.warning(f"PDFExtractionResult ORM insert failed, falling back to raw SQL: {db_e}")
                from django.db import connection
                import json as _json
                table = PDFExtractionResult._meta.db_table
                cols = ['pdf_session_id', 'extracted_headers', 'extracted_data', 'confidence_scores', 'quality_metrics', 'table_count']
                vals = [
                    pdf_session.id,
                    _json.dumps(list(df.columns) if not df.empty else []),
                    _json.dumps(df.values.tolist() if not df.empty else []),
                    _json.dumps({**(extraction_result.get('confidence_scores') or {}), 'header_confidence': header_confidence_scores}),
                    _json.dumps(extraction_result.get('quality_metrics') or {}),
                    int(extraction_result.get('table_count') or 0),
                ]
                placeholders = ','.join(['%s'] * len(cols))
                sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
                new_id = None
                with connection.cursor() as cur:
                    cur.execute(sql, vals)
                    try:
                        new_id = cur.lastrowid
                    except Exception:
                        new_id = None
                # Do not refetch via ORM to avoid schema mismatches; keep ID for response
                pdf_extraction = None

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
                    # CRITICAL: Save WITHOUT headers to avoid header row appearing as data in Review page
                    # The headers are stored separately in PDFExtractionResult.extracted_headers
                    # and applied when reading the CSV in apply_column_mappings (line 784)
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
                        'source_type': 'pdf',
                        'client_headers': list(df.columns) if not df.empty else []
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
                'extraction_id': getattr(pdf_extraction, 'id', None) or new_id,
                'headers': list(df.columns) if not df.empty else [],
                'data': df.values.tolist() if not df.empty else [],
                'table_count': extraction_result['table_count'],
                'quality_metrics': extraction_result['quality_metrics'],
                'validation': validation_result,
                # Provide header-level confidence scores for immediate UI use
                'header_confidence_scores': header_confidence_scores,
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
        try:
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
        except Exception as _e:
            # Gracefully degrade if table lacks columns introduced by newer models
            extraction_data = None

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
        try:
            page = PDFPage.objects.get(pdf_session=pdf_session, page_number=page_number)
        except PDFPage.DoesNotExist:
            # If the page record doesn't exist yet, try generating images now
            logger.info(f"Page record missing; generating images for session {session_id}")
            if not os.path.exists(pdf_session.original_pdf_path):
                return Response({'error': 'Original PDF file not found'}, status=status.HTTP_404_NOT_FOUND)
            pdf_processor = PDFProcessor()
            try:
                page_info = pdf_processor.convert_to_images(pdf_session.original_pdf_path, session_id)
                # Create or update page records
                for p in page_info:
                    PDFPage.objects.update_or_create(
                        pdf_session=pdf_session,
                        page_number=p['page_number'],
                        defaults={
                            'image_path': p['image_path'],
                            'width': p['width'],
                            'height': p['height']
                        }
                    )
                page = PDFPage.objects.get(pdf_session=pdf_session, page_number=page_number)
            except Exception as e:
                logger.error(f"Error generating page images for missing record: {e}")
                return Response({'error': f'Image generation failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Optional format conversion (png default)
        requested_format = (request.GET.get('format') or 'png').lower()
        if requested_format not in ('png', 'jpg', 'jpeg'):
            requested_format = 'png'

        # Check if image path exists and file is accessible
        if page.image_path and os.path.exists(page.image_path):
            if requested_format in ('jpg', 'jpeg'):
                # Convert on-the-fly to JPEG to support clients preferring JPG
                try:
                    from PIL import Image
                    from io import BytesIO
                    img = Image.open(page.image_path)
                    if img.mode in ('RGBA', 'LA'):
                        # Drop alpha for JPEG
                        background = Image.new('RGB', img.size, (255, 255, 255))
                        background.paste(img, mask=img.split()[-1])
                        img = background
                    else:
                        img = img.convert('RGB')
                    buf = BytesIO()
                    img.save(buf, format='JPEG', quality=85, optimize=True)
                    buf.seek(0)
                    response = HttpResponse(buf.read(), content_type='image/jpeg')
                    response['Cache-Control'] = 'max-age=3600'
                    return response
                except Exception as _e:
                    # Fallback to raw PNG if conversion fails
                    with open(page.image_path, 'rb') as f:
                        response = HttpResponse(f.read(), content_type='image/png')
                        response['Cache-Control'] = 'max-age=3600'
                        return response
            else:
                with open(page.image_path, 'rb') as f:
                    response = HttpResponse(f.read(), content_type='image/png')
                    response['Cache-Control'] = 'max-age=3600'  # Cache for 1 hour
                    return response

        # If image doesn't exist, generate it on-demand
        logger.info(f"Generating page image on-demand for session {session_id}, page {page_number}")

        # Check if original PDF exists
        if not os.path.exists(pdf_session.original_pdf_path):
            return Response({'error': 'Original PDF file not found'}, status=status.HTTP_404_NOT_FOUND)

        # Initialize PDF processor and generate images
        pdf_processor = PDFProcessor()

        try:
            # Generate images for the entire PDF
            page_info = pdf_processor.convert_to_images(pdf_session.original_pdf_path, session_id)

            # Update all pages with image paths
            for page_data in page_info:
                PDFPage.objects.filter(
                    pdf_session=pdf_session,
                    page_number=page_data['page_number']
                ).update(image_path=page_data['image_path'])

            # Now serve the requested page
            updated_page = PDFPage.objects.get(pdf_session=pdf_session, page_number=page_number)
            if updated_page.image_path and os.path.exists(updated_page.image_path):
                if requested_format in ('jpg', 'jpeg'):
                    try:
                        from PIL import Image
                        from io import BytesIO
                        img = Image.open(updated_page.image_path)
                        if img.mode in ('RGBA', 'LA'):
                            background = Image.new('RGB', img.size, (255, 255, 255))
                            background.paste(img, mask=img.split()[-1])
                            img = background
                        else:
                            img = img.convert('RGB')
                        buf = BytesIO()
                        img.save(buf, format='JPEG', quality=85, optimize=True)
                        buf.seek(0)
                        response = HttpResponse(buf.read(), content_type='image/jpeg')
                        response['Cache-Control'] = 'max-age=3600'
                        return response
                    except Exception:
                        with open(updated_page.image_path, 'rb') as f:
                            response = HttpResponse(f.read(), content_type='image/png')
                            response['Cache-Control'] = 'max-age=3600'
                            return response
                else:
                    with open(updated_page.image_path, 'rb') as f:
                        response = HttpResponse(f.read(), content_type='image/png')
                        response['Cache-Control'] = 'max-age=3600'  # Cache for 1 hour
                        return response
            else:
                return Response({'error': 'Failed to generate page image'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        except Exception as e:
            logger.error(f"Error generating page images: {e}")
            return Response({'error': f'Image generation failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    except (PDFSession.DoesNotExist, PDFPage.DoesNotExist):
        return Response({'error': 'Page not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error serving page image: {e}")
        return Response({'error': f'Image retrieval failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
