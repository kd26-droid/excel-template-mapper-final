"""
Simple zone management views for PDF processing
Handles zone selection, storage, and OCR processing
"""
import logging
import json
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import PDFSession, PDFPage, PDFZone, PDFExtractionResult
from .services.azure_ocr_service import AzureOCRService
from .services.pdf_processor import PDFProcessor

logger = logging.getLogger(__name__)


@api_view(['GET', 'POST'])
def get_zones(request, session_id):
    """
    GET: Retrieve all zones for a session
    POST: Create/update zones for a session
    """
    if request.method == 'GET':
        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
            zones = PDFZone.objects.filter(pdf_session=pdf_session).order_by('page_number', 'zone_id')

            zones_data = []
            for zone in zones:
                zones_data.append({
                    'id': zone.id,
                    'zone_id': zone.zone_id,
                    'page_number': zone.page_number,
                    'zone_type': zone.zone_type,
                    'coordinates': zone.coordinates,
                    'processing_status': zone.processing_status,
                    'continuation_of': zone.continuation_of_id if zone.continuation_of else None
                })

            return Response({
                'session_id': session_id,
                'zones': zones_data
            })

        except PDFSession.DoesNotExist:
            return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error getting zones: {e}")
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    elif request.method == 'POST':
        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
            zones_data = request.data.get('zones', [])

            # Delete existing zones for this session
            PDFZone.objects.filter(pdf_session=pdf_session).delete()

            # Create new zones
            created_zones = []
            for zone_data in zones_data:
                zone = PDFZone.objects.create(
                    pdf_session=pdf_session,
                    zone_id=zone_data.get('zone_id'),
                    page_number=zone_data.get('page_number'),
                    zone_type=zone_data.get('zone_type', 'table'),
                    coordinates=zone_data.get('coordinates'),
                    processing_status='pending'
                )
                created_zones.append({
                    'id': zone.id,
                    'zone_id': zone.zone_id,
                    'page_number': zone.page_number,
                    'zone_type': zone.zone_type,
                    'coordinates': zone.coordinates,
                    'processing_status': zone.processing_status
                })

            return Response({
                'session_id': session_id,
                'zones': created_zones,
                'message': f'Created {len(created_zones)} zones'
            }, status=status.HTTP_201_CREATED)

        except PDFSession.DoesNotExist:
            return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error creating zones: {e}")
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def process_zones(request, session_id):
    """
    Process selected zones through Azure OCR
    Supports: single header zone + multiple data zones
    """
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)
        pdf_processor = PDFProcessor()
        ocr_service = AzureOCRService()

        # Optional: process only specified zone_ids
        requested_zone_ids = request.data.get('zone_ids') or []
        # Use premium table_optimized preset for best OCR accuracy with Azure prebuilt-read
        enhance_preset = request.data.get('enhance_preset') or 'table_optimized'

        # Get zones for this session (filter if specific ids provided)
        zones_qs = PDFZone.objects.filter(pdf_session=pdf_session)
        if requested_zone_ids:
            zones_qs = zones_qs.filter(zone_id__in=requested_zone_ids)
        zones = zones_qs.order_by('page_number', 'zone_id')

        logger.info(f"🧭 Zonal processing start | session={session_id} | requested_zone_ids={len(requested_zone_ids)} | enhance_preset={enhance_preset} | total_selected={zones.count()}")

        if not zones.exists():
            return Response({
                'error': 'No zones found for processing'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Process ALL zones (both header and table types)
        # Each zone can have its own headers and data
        all_zone_results = []

        for zone in zones:
            zone.processing_status = 'processing'
            zone.save()

            try:
                # Get page for zone
                page = PDFPage.objects.get(
                    pdf_session=pdf_session,
                    page_number=zone.page_number
                )

                # Crop zone from page image
                zone_image = pdf_processor.crop_zone_from_image(
                    page.image_path,
                    zone.coordinates
                )

                try:
                    from PIL import Image
                    w, h = zone_image.size if hasattr(zone_image, 'size') else (None, None)
                except Exception:
                    w, h = (None, None)
                logger.info(f"✂️  Cropped zone | zone_id={zone.zone_id} | page={zone.page_number} | coords={zone.coordinates} | crop_wh={w}x{h}")

                # Enhance zone image for OCR if requested
                enhanced_image = pdf_processor.enhance_zone_image(zone_image, preset=enhance_preset)

                try:
                    ew, eh = enhanced_image.size if hasattr(enhanced_image, 'size') else (None, None)
                except Exception:
                    ew, eh = (None, None)
                logger.info(f"🧪 Enhanced zone image | zone_id={zone.zone_id} | preset={enhance_preset} | wh={ew}x{eh}")

                # Extract table using Azure OCR (enhanced image)
                zone_result = ocr_service.extract_table_from_image(enhanced_image)
                zone_headers = zone_result.get('headers', [])
                zone_rows = zone_result.get('rows', [])

                logger.info(f"📑 Zone result | zone_id={zone.zone_id} | headers={len(zone_headers)} | rows={len(zone_rows)} | headers_sample={zone_headers[:8]}")

                all_zone_results.append({
                    'zone_id': zone.zone_id,
                    'zone_type': zone.zone_type,
                    'headers': zone_headers,
                    'rows': zone_rows
                })

                zone.processing_status = 'completed'
                zone.save()

            except Exception as e:
                logger.error(f"Error processing zone {zone.zone_id}: {e}")
                zone.processing_status = 'failed'
                zone.save()
                continue

        # MULTI-PAGE TABLE CONTINUATION DETECTION
        # Group zones by matching headers for intelligent continuation
        def normalize_header(h):
            """Normalize header for comparison"""
            return str(h or '').strip().lower().replace(' ', '').replace('_', '')

        # Group zones with matching headers
        header_groups = {}
        for zone_result in all_zone_results:
            zone_headers = zone_result['headers']
            # Create signature from headers
            header_signature = '|'.join(normalize_header(h) for h in zone_headers)
            if header_signature not in header_groups:
                header_groups[header_signature] = []
            header_groups[header_signature].append(zone_result)

        logger.info(f"📊 Multi-page continuation: found {len(header_groups)} unique table structures")

        # If all zones have the same headers, they're part of a continuous table
        if len(header_groups) == 1:
            logger.info("✅ All zones have matching headers - treating as single continuous table")
            # All zones have same structure - simply concatenate rows
            continuous_headers = all_zone_results[0]['headers']
            continuous_rows = []
            for zone_result in all_zone_results:
                continuous_rows.extend(zone_result['rows'])
            logger.info(f"📄 Continuous table: {len(continuous_headers)} columns, {len(continuous_rows)} total rows across {len(all_zone_results)} zones")

            # Use continuous approach
            headers = continuous_headers
            all_data_rows = continuous_rows

        else:
            # Multiple table structures - use FLATTEN mode (overlay by position)
            logger.info(f"⚠️ Multiple table structures detected - using FLATTEN mode")

            # Step 1: Collect ALL unique headers from ALL zones
            all_headers_set = set()
            zone_headers_list = []

            for zone_result in all_zone_results:
                zone_headers = zone_result['headers']
                zone_headers_list.append(zone_headers)
                logger.info(f"Zone {zone_result['zone_id']} headers: {zone_headers}")

                # Add headers to our master set
                for header in zone_headers:
                    if header and header.strip():
                        all_headers_set.add(header.strip())

            # Step 2: Create ordered list of combined headers
            # Start with headers from the zone with most columns, then add unique ones
            max_columns = 0
            primary_zone_headers = []
            for zone_headers in zone_headers_list:
                if len(zone_headers) > max_columns:
                    max_columns = len(zone_headers)
                    primary_zone_headers = zone_headers

            # Build combined headers: start with primary zone, add missing unique headers
            combined_headers = []
            for header in primary_zone_headers:
                if header and header.strip():
                    combined_headers.append(header.strip())
                    all_headers_set.discard(header.strip())

            # Add any remaining unique headers from other zones
            for header in sorted(all_headers_set):  # Sort for consistency
                combined_headers.append(header)

            logger.info(f"🧩 Combined headers from all zones ({len(combined_headers)}): {combined_headers}")

            # If no headers found at all, return error
            if not combined_headers:
                return Response({
                    'error': 'No headers detected in any zone'
                }, status=status.HTTP_400_BAD_REQUEST)

            # Step 3: FLATTEN MODE - Overlay rows by position across zones to align columns on same row index
            # Determine maximum number of rows among zones
            zone_rows_counts = [len(zone_result['rows']) for zone_result in all_zone_results]
            max_rows = max(zone_rows_counts) if zone_rows_counts else 0
            logger.info(f"Flatten mode: overlaying rows by position across {len(all_zone_results)} zones, max_rows={max_rows}")

            # Initialize row records with combined headers
            row_records = [{col: '' for col in combined_headers} for _ in range(max_rows)]

            def _clean_cell(val):
                try:
                    s = str(val) if val is not None else ''
                    s = s.replace('\u00a0', ' ').replace('\r', ' ').replace('\n', ' ')
                    s = ' '.join(s.split())
                    return s.strip()
                except Exception:
                    return ''

            def _prefer(existing, incoming):
                """Prefer longer non-empty value when overlaying cells"""
                a = _clean_cell(existing)
                b = _clean_cell(incoming)
                if a and not b:
                    return a
                if b and not a:
                    return b
                if not a and not b:
                    return ''
                return a if len(a) >= len(b) else b

            # Fill row records from each zone and collect confidence scores
            total_rows_before = 0
            header_confidence_map = {}  # Track confidence for each header

            for zone_result in all_zone_results:
                zone_headers = zone_result['headers']
                zone_rows = zone_result['rows']
                total_rows_before += len(zone_rows)

                logger.info(f"Flatten mode: processing zone {zone_result['zone_id']} with {len(zone_rows)} rows and headers: {zone_headers}")

                # Collect confidence scores for headers in this zone (default to 0.85 for each header)
                for header in zone_headers:
                    if header and header.strip():
                        clean_header = header.strip()
                        if clean_header not in header_confidence_map:
                            # Default confidence for zone-extracted headers
                            header_confidence_map[clean_header] = 0.85

                for row_idx, row in enumerate(zone_rows):
                    if row_idx >= max_rows:
                        break
                    for col_idx, cell_value in enumerate(row):
                        if col_idx < len(zone_headers):
                            header = zone_headers[col_idx].strip() if zone_headers[col_idx] else ''
                            if header and header in combined_headers:
                                existing = row_records[row_idx].get(header, '')
                                row_records[row_idx][header] = _prefer(existing, cell_value)

            # Convert row records to list rows in combined_headers order
            all_data_rows = []
            for r in range(max_rows):
                row_out = [row_records[r].get(h, '') for h in combined_headers]
                # Only include rows with some non-empty cells
                if any(str(c).strip() for c in row_out):
                    all_data_rows.append(row_out)

            # Use combined_headers as the final headers
            headers = combined_headers

        # Build comprehensive confidence scores with per-header data
        # Handle both continuous and flatten modes
        if len(header_groups) == 1:
            # Continuous mode - all headers have same confidence
            header_confidence_scores = {h: 0.85 for h in headers}
        else:
            # Flatten mode - use collected confidence map
            header_confidence_scores = {h: header_confidence_map.get(h, 0.85) for h in headers}

        confidence_scores = {
            'overall_confidence': 0.85,
            'header_confidence': header_confidence_scores
        }

        # Build quality metrics
        quality_metrics = {
            'total_rows': len(all_data_rows),
            'total_columns': len(headers),
            'zones_processed': len(all_zone_results),
            'overall_confidence': 0.85,
            'header_confidence': sum(header_confidence_scores.values()) / len(header_confidence_scores) if header_confidence_scores else 0.85,
            'table_continuity': 'continuous' if len(header_groups) == 1 else 'mixed'
        }

        mode_desc = 'CONTINUOUS' if len(header_groups) == 1 else 'FLATTEN'
        logger.info(f"✅ Zonal processing done ({mode_desc}) | zones={len(all_zone_results)} | output_rows={len(all_data_rows)} | cols={len(headers)}")

        # Create extraction result
        extraction = PDFExtractionResult.objects.create(
            pdf_session=pdf_session,
            extracted_headers=headers,
            extracted_data=all_data_rows,
            confidence_scores=confidence_scores,
            quality_metrics=quality_metrics,
            table_count=len(all_zone_results)
        )

        # Create session for column mapping flow
        from .views import save_session
        from datetime import datetime
        from django.conf import settings
        from pathlib import Path
        import tempfile
        import pandas as pd

        # Create temporary CSV with extracted data
        if all_data_rows:
            df = pd.DataFrame(all_data_rows, columns=headers)
            temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)
            # CRITICAL FIX: Write CSV WITHOUT headers for PDF zonal flow
            # The downstream reader (views.py:793) reads with header=None and applies headers from PDF extraction
            # Writing headers here would cause them to appear as the first data row
            df.to_csv(temp_file.name, index=False, header=False)
            temp_file.close()

            # Get FACTWISE template path
            factwise_template_path = Path(settings.BASE_DIR) / 'FACTWISE.xlsx'
            if not factwise_template_path.exists():
                factwise_template_path = Path(settings.BASE_DIR) / 'test_files' / 'FACTWISE.xlsx'

            # Create session data
            session_data = {
                'session_id': session_id,
                'client_path': temp_file.name,
                'template_path': str(factwise_template_path),
                'original_client_name': pdf_session.file_name,
                'original_template_name': 'FACTWISE.xlsx',
                'sheet_name': 'PDF_Data',
                'header_row': 1,  # Note: Ignored for pdf_zonal - headers come from PDF extraction
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
                'source_type': 'pdf_zonal',  # Critical: This triggers special PDF CSV reading logic
                'client_headers': headers  # Store headers explicitly for PDF extraction
            }

            save_session(session_id, session_data)

        # Update PDF session status
        pdf_session.processing_status = 'completed'
        pdf_session.save()

        return Response({
            'session_id': session_id,
            'extraction_id': extraction.id,
            'headers': headers,
            'row_count': len(all_data_rows),
            'column_count': len(headers),
            'status': 'completed',
            'message': 'Zone processing completed successfully'
        }, status=status.HTTP_200_OK)

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error processing zones: {e}", exc_info=True)
        return Response({
            'error': f'Zone processing failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_zone_processing_status(request, session_id):
    """Get real-time processing status for zones"""
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)
        zones = PDFZone.objects.filter(pdf_session=pdf_session)

        zone_statuses = []
        for zone in zones:
            zone_statuses.append({
                'zone_id': zone.zone_id,
                'page_number': zone.page_number,
                'zone_type': zone.zone_type,
                'status': zone.processing_status
            })

        # Count statuses
        total = zones.count()
        completed = zones.filter(processing_status='completed').count()
        processing = zones.filter(processing_status='processing').count()
        failed = zones.filter(processing_status='failed').count()
        pending = zones.filter(processing_status='pending').count()

        overall_status = 'pending'
        if completed == total:
            overall_status = 'completed'
        elif processing > 0:
            overall_status = 'processing'
        elif failed > 0:
            overall_status = 'failed'

        return Response({
            'session_id': session_id,
            'overall_status': overall_status,
            'zones': zone_statuses,
            'summary': {
                'total': total,
                'completed': completed,
                'processing': processing,
                'failed': failed,
                'pending': pending
            }
        })

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error getting zone status: {e}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def manage_zone_links(request, session_id):
    """
    Link or unlink zones for table continuations
    Simple implementation: just mark continuation relationship
    """
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)
        action = request.data.get('action', 'link')
        zone_chain = request.data.get('zone_chain', [])

        if action == 'link' and len(zone_chain) >= 2:
            # Link zones in sequence
            for i in range(1, len(zone_chain)):
                current_zone_id = zone_chain[i]
                previous_zone_id = zone_chain[i-1]

                try:
                    current_zone = PDFZone.objects.get(
                        pdf_session=pdf_session,
                        zone_id=current_zone_id
                    )
                    previous_zone = PDFZone.objects.get(
                        pdf_session=pdf_session,
                        zone_id=previous_zone_id
                    )

                    current_zone.continuation_of = previous_zone
                    current_zone.save()

                except PDFZone.DoesNotExist:
                    continue

            return Response({
                'message': 'Zones linked successfully',
                'zone_chain': zone_chain
            })

        elif action == 'unlink':
            # Unlink specified zones
            for zone_id in zone_chain:
                try:
                    zone = PDFZone.objects.get(
                        pdf_session=pdf_session,
                        zone_id=zone_id
                    )
                    zone.continuation_of = None
                    zone.save()
                except PDFZone.DoesNotExist:
                    continue

            return Response({
                'message': 'Zones unlinked successfully',
                'zone_chain': zone_chain
            })

        else:
            return Response({
                'error': 'Invalid action or zone chain'
            }, status=status.HTTP_400_BAD_REQUEST)

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error managing zone links: {e}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def create_or_update_zones(request):
    """Legacy endpoint - redirects to new endpoint"""
    session_id = request.data.get('session_id')
    if not session_id:
        return Response({'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

    return get_zones(request, session_id)
