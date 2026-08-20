"""
Simple zone management views for PDF processing
Handles zone selection, storage, and OCR processing
"""
import logging
import re
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
        # Zones were drawn on the low-DPI preview image. For OCR we render each
        # page at full OCR DPI on demand (cached per page) and scale the zone
        # coordinates up to that image, so recognition quality is unchanged.
        ocr_page_cache = {}

        for zone in zones:
            zone.processing_status = 'processing'
            zone.save()

            try:
                # Get page for zone
                page = PDFPage.objects.get(
                    pdf_session=pdf_session,
                    page_number=zone.page_number
                )

                if zone.page_number not in ocr_page_cache:
                    ocr_pd = pdf_processor.convert_single_page(
                        pdf_session.original_pdf_path, session_id, zone.page_number,
                        dpi=pdf_processor.config.get('image_dpi', 300), optimize=True,
                    )
                    prev_w = page.width or ocr_pd['width']
                    prev_h = page.height or ocr_pd['height']
                    ocr_page_cache[zone.page_number] = {
                        'path': ocr_pd['image_path'],
                        'sx': (ocr_pd['width'] / prev_w) if prev_w else 1.0,
                        'sy': (ocr_pd['height'] / prev_h) if prev_h else 1.0,
                    }
                oc = ocr_page_cache[zone.page_number]
                c = zone.coordinates or {}
                scaled_coords = {
                    'x': int(round(c.get('x', 0) * oc['sx'])),
                    'y': int(round(c.get('y', 0) * oc['sy'])),
                    'width': int(round(c.get('width', 0) * oc['sx'])),
                    'height': int(round(c.get('height', 0) * oc['sy'])),
                }
                crop_pad = 8
                scaled_coords = {
                    'x': max(0, scaled_coords['x'] - crop_pad),
                    'y': max(0, scaled_coords['y'] - crop_pad),
                    'width': scaled_coords['width'] + (crop_pad * 2),
                    'height': scaled_coords['height'] + (crop_pad * 2),
                }

                # Crop zone from the high-DPI OCR image
                zone_image = pdf_processor.crop_zone_from_image(
                    oc['path'],
                    scaled_coords
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

                # Extract table using Azure OCR. Some scanned engineering PDFs
                # lose text after aggressive table enhancement, so retry with
                # the original crop and a lighter enhancement before declaring
                # the zone empty.
                ocr_attempts = [
                    ('enhanced', enhanced_image),
                    ('original', zone_image),
                ]
                try:
                    basic_image = pdf_processor.enhance_zone_image(zone_image, preset='basic')
                    ocr_attempts.append(('basic', basic_image))
                except Exception as basic_err:
                    logger.warning(f"Basic OCR enhancement skipped | zone_id={zone.zone_id} | error={basic_err}")

                def score_ocr_table(result):
                    headers = [str(header or '').strip() for header in result.get('headers', [])]
                    rows = result.get('rows', []) or []
                    if not headers or not rows:
                        return -1
                    header_text = ' '.join(headers).lower()
                    semantic_hits = sum(
                        1 for keyword in ('find', 'part', 'description', 'desc')
                        if keyword in header_text
                    )
                    placeholder_count = sum(
                        1 for header in headers
                        if header.lower().startswith('column_') or header.lower().startswith('column ')
                    )
                    populated_cells = sum(
                        1 for row in rows[:20]
                        for cell in row
                        if str(cell).strip()
                    )
                    return (
                        semantic_hits * 50
                        + min(len(headers), 20) * 3
                        + min(len(rows), 50)
                        + min(populated_cells, 80)
                        - placeholder_count * 25
                    )

                zone_result = {'headers': [], 'rows': []}
                best_attempt_name = None
                best_attempt_score = -1
                for attempt_name, attempt_image in ocr_attempts:
                    attempt_result = ocr_service.extract_table_from_image(attempt_image)
                    attempt_headers = attempt_result.get('headers', [])
                    attempt_rows = attempt_result.get('rows', [])
                    attempt_score = score_ocr_table(attempt_result)
                    logger.info(
                        f"OCR attempt | zone_id={zone.zone_id} | attempt={attempt_name} | "
                        f"headers={len(attempt_headers)} | rows={len(attempt_rows)} | score={attempt_score}"
                    )
                    if attempt_score > best_attempt_score:
                        zone_result = attempt_result
                        best_attempt_name = attempt_name
                        best_attempt_score = attempt_score

                    placeholder_headers = [
                        header for header in attempt_headers
                        if str(header or '').strip().lower().startswith(('column_', 'column '))
                    ]
                    has_semantic_headers = any(
                        keyword in ' '.join(str(header or '').lower() for header in attempt_headers)
                        for keyword in ('find', 'part', 'description', 'desc')
                    )
                    if attempt_headers and attempt_rows and has_semantic_headers and not placeholder_headers:
                        break
                zone_headers = zone_result.get('headers', [])
                zone_rows = zone_result.get('rows', [])

                logger.info(f"📑 Zone result | zone_id={zone.zone_id} | attempt={best_attempt_name} | score={best_attempt_score} | headers={len(zone_headers)} | rows={len(zone_rows)} | headers_sample={zone_headers[:8]}")

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

        if not any(result.get('headers') and result.get('rows') for result in all_zone_results):
            return Response({
                'error': 'No table data was found inside the selected zone. Redraw the box tightly around the table, or try "Each column separately" if the scan is too faint for whole-table OCR.'
            }, status=status.HTTP_400_BAD_REQUEST)

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
        try:
            import pandas as pd
            from .pdf_views import repair_pdf_dataframe_headers
            repaired_df = repair_pdf_dataframe_headers(
                pd.DataFrame(all_data_rows, columns=headers),
                context='zone_ocr',
            )
            if not repaired_df.empty:
                headers = list(repaired_df.columns)
                all_data_rows = repaired_df.values.tolist()
        except Exception as repair_error:
            logger.warning(f"PDF zone header repair skipped: {repair_error}")

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
        import pandas as pd

        if all_data_rows:
            df = pd.DataFrame(all_data_rows, columns=headers)

            from .pdf_views import create_mapping_session_from_dataframe

            session_data = create_mapping_session_from_dataframe(
                pdf_session=pdf_session,
                session_id=session_id,
                df=df,
                source_type='pdf_zonal',
            )

            save_session(session_id, session_data)

        # Update PDF session status
        pdf_session.processing_status = 'completed'
        pdf_session.save()

        return Response({
            'session_id': session_id,
            'extraction_id': extraction.id,
            'headers': headers,
            'data': all_data_rows,
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



def _rows_look_equal(a, b):
    """True when two extracted rows carry the same text, ignoring spacing.

    Used to spot a header repeated at the top of a later page. Compared loosely
    because a repeated header can be re-wrapped differently by the extractor.
    """
    def norm(row):
        return [re.sub(r'\s+', ' ', str(cell or '')).strip().lower() for cell in (row or [])]
    left, right = norm(a), norm(b)
    if not any(left) or not any(right):
        return False
    width = min(len(left), len(right))
    return width > 0 and left[:width] == right[:width]


def _zone_table_header_score(row):
    """Score whether a table-zone row looks like a column header.

    PDF zone extraction can start on a data row when the user marks only the
    body or when the provider misses the top ruled line. Dropping row 0 blindly
    then loses a real BOM line, so table mode only promotes a row to headers
    when it has header-like labels.
    """
    def plain(text):
        text = re.sub(r'\s+', ' ', str(text or '')).strip().lower()
        return (
            text.replace('é', 'e')
                .replace('è', 'e')
                .replace('ê', 'e')
                .replace('à', 'a')
                .replace('ç', 'c')
                .replace('ù', 'u')
        )

    cells = [re.sub(r'\s+', ' ', str(cell or '')).strip() for cell in (row or [])]
    non_blank = [cell for cell in cells if cell]
    if len(non_blank) < 2:
        return 0

    joined = plain(' '.join(non_blank))
    keyword_hits = sum(
        1 for pattern in (
            r'\bfind\s*(?:no|num|number|nbr)?\.?\b',
            r'\brepere\b',
            r'\bitem\s*(?:no|num|number)?\.?\b',
            r'\bpart\s*(?:no|num|number|nbr)?\.?\b',
            r'\bdescription\b',
            r'\bdesc\b',
            r'\bfabricant\b',
            r'\bmanufacturer\b',
            r'\breference\b',
            r'\bcaracteristiques?\b',
            r'\bcharacteristics?\b',
            r'\bquantite\b',
            r'\bquantity\b',
            r'\blongueur\b',
            r'\blength\b',
            r'\bindice\b',
            r'\bindex\b',
            r'\bassy\b',
            r'\bassembly\b',
            r'\bbom\b',
        )
        if re.search(pattern, joined)
    )
    assembly_column_hits = sum(
        1 for cell in non_blank
        if re.fullmatch(r'(?:a|assy|assembly)\s*\d{1,2}', cell, flags=re.IGNORECASE)
    )
    numeric_only_hits = sum(
        1 for cell in non_blank
        if re.fullmatch(r'\d{1,4}', cell)
    )
    long_data_hits = sum(
        1 for cell in non_blank
        if len(cell) > 18 and not re.search(
            r'\b(description|part|find|assy|assembly|bom|fabricant|manufacturer|reference|'
            r'caracteristiques?|characteristics?|quantite|quantity|longueur|length)\b',
            plain(cell),
            flags=re.IGNORECASE,
        )
    )
    part_number_hits = sum(
        1 for cell in non_blank
        if re.search(r'[A-Z]?\d{4,}[-/][A-Z0-9-]+', cell, flags=re.IGNORECASE)
    )
    labelish_hits = sum(
        1 for cell in non_blank
        if re.search(r'[A-Za-z]', cell) and len(cell) <= 28 and not re.search(r'[+\-/]\d|%', cell)
    )

    score = (
        keyword_hits * 25
        + min(assembly_column_hits, 8) * 8
        + min(labelish_hits, 8) * 3
        - numeric_only_hits * 10
        - long_data_hits * 8
        - part_number_hits * 15
    )
    # Rows just above the real table header often contain revision/assembly
    # numbers plus one real-looking label (for example "5 52 4 42 ... PART NO.").
    # They are metadata, not column headers, and should not beat the row below
    # with actual labels such as A6/A5/.../PART NO./DESCRIPTION.
    if keyword_hits < 2 and numeric_only_hits >= 2 and assembly_column_hits == 0:
        score -= 35
    return score


@api_view(['POST'])
def process_column_zones(request, session_id):
    """
    Extract a table by treating the drawn zones as COLUMNS.

    Unlike process_zones (which crops each zone and OCRs it separately, and so
    collapses blank cells), this reads the PDF's word positions and buckets each
    word into a column by where it sits and into a row by its line. Blank cells
    stay blank, rows never desync, and repeated page headers/footers are excluded
    because they fall outside the drawn zones' vertical span.

    Nothing here is specific to any document: the columns are whatever the user
    drew, in whatever positions, on however many pages.
    """
    try:
        import pdfplumber
        from .services.coordinate_table_extractor import (
            scale_rect_to_pdf, extract_table_from_pdf_words, extract_ruled_table,
        )

        pdf_session = PDFSession.objects.get(session_id=session_id)

        zones = PDFZone.objects.filter(pdf_session=pdf_session).order_by('page_number', 'zone_id')
        if not zones.exists():
            return Response({'error': 'No columns marked yet. Draw a box around each column first.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Image-pixel dimensions the zones were drawn against, per page.
        page_dims = {p.page_number: (p.width, p.height)
                     for p in PDFPage.objects.filter(pdf_session=pdf_session)}

        merge_wrapped = str(request.data.get('merge_wrapped', False)).lower() in ('1', 'true', 'yes', 'on')

        # Optional user-supplied column names, in left-to-right order. Positions
        # are kept (a blank name falls back to Column_N for that slot).
        column_labels = [str(x).strip() for x in (request.data.get('column_labels') or [])]

        skip_top_rows = 0
        try:
            skip_top_rows = max(0, int(request.data.get('skip_top_rows') or 0))
        except (TypeError, ValueError):
            skip_top_rows = 0
        page_words = {}
        column_zones = {}

        with pdfplumber.open(pdf_session.original_pdf_path) as pdf:
            for zone in zones:
                page = zone.page_number
                if page < 1 or page > len(pdf.pages):
                    continue
                pdf_page = pdf.pages[page - 1]
                img_w, img_h = page_dims.get(page, (pdf_page.width, pdf_page.height))

                rect = scale_rect_to_pdf(
                    zone.coordinates, img_w, img_h, pdf_page.width, pdf_page.height
                )
                column_zones.setdefault(page, []).append(rect)

                if page not in page_words:
                    page_words[page] = [
                        {'text': w['text'], 'x0': w['x0'], 'x1': w['x1'],
                         'top': w['top'], 'bottom': w['bottom']}
                        for w in pdf_page.extract_words()
                    ]

        # Two ways to read the marked area, chosen by the user rather than
        # guessed at:
        #   'columns' - each box is one column (precise, needs a box per column)
        #   'table'   - one box is the whole table, and the columns come from the
        #               PDF's own ruling lines inside it
        zone_mode = str(request.data.get('zone_mode') or 'columns').strip().lower()
        strategy_used = 'coordinate_column_zones'

        if zone_mode == 'table':
            rows = []
            n_cols = 0
            dropped = 0
            with pdfplumber.open(pdf_session.original_pdf_path) as pdf:
                for page in sorted(column_zones):
                    if page < 1 or page > len(pdf.pages):
                        continue
                    pdf_page = pdf.pages[page - 1]
                    # Several boxes on one page are treated as one region so a
                    # sloppily drawn pair of boxes still reads as one table.
                    rects = column_zones[page]
                    region = {
                        'x0': min(r['x0'] for r in rects),
                        'x1': max(r['x1'] for r in rects),
                        'top': min(r['top'] for r in rects),
                        'bottom': max(r['bottom'] for r in rects),
                    }
                    page_result = extract_ruled_table(pdf_page, region)
                    if not page_result['rows']:
                        continue
                    strategy_used = page_result['strategy']
                    dropped += page_result['dropped']
                    page_rows = page_result['rows']
                    # Some documents repeat the header on every page and some do
                    # not, so drop a later page's first row only when it actually
                    # matches the header already captured. Dropping it blindly
                    # deletes a real line item from any PDF that does not repeat.
                    if rows and page_rows and _rows_look_equal(page_rows[0], rows[0]):
                        page_rows = page_rows[1:]
                    rows.extend(page_rows)
                    n_cols = max(n_cols, page_result['n_columns'])
            result = {'rows': rows, 'n_columns': n_cols, 'dropped': dropped}
        else:
            result = extract_table_from_pdf_words(page_words, column_zones, merge_wrapped=merge_wrapped)

        rows = result['rows']
        n_cols = result['n_columns']

        # Drop the first N rows (e.g. a captured page header) if requested.
        if skip_top_rows and rows:
            rows = rows[skip_top_rows:]

        if not rows:
            return Response({
                'error': 'No text found inside the columns you marked. This PDF may be a scan '
                         '(its text is not selectable) — use "Extract with OCR (scanned PDF)" instead.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Use the name the user typed for each slot, falling back to a generic
        # name where none was given.
        if zone_mode == 'table' and rows:
            # Prefer the table's own header row, but do not blindly drop row 0:
            # if the marked/cropped area starts at the first item row, row 0 is
            # real BOM data and must be preserved.
            scored_rows = [(_zone_table_header_score(row), index, row) for index, row in enumerate(rows[:12])]
            best_score, header_index, header_row = max(scored_rows, key=lambda item: item[0])
            if best_score >= 35:
                headers = [
                    (str(header_row[i]).strip() if i < len(header_row) and str(header_row[i]).strip() else f'Column_{i + 1}')
                    for i in range(n_cols)
                ]
                header_rows_to_drop = {header_index}
                for nearby_index in (header_index - 1, header_index + 1):
                    if 0 <= nearby_index < len(rows) and _zone_table_header_score(rows[nearby_index]) >= 35:
                        header_rows_to_drop.add(nearby_index)
                rows = [row for index, row in enumerate(rows) if index not in header_rows_to_drop]
            else:
                headers = [f'Column_{i + 1}' for i in range(n_cols)]
        else:
            headers = [
                (column_labels[i] if i < len(column_labels) and column_labels[i] else f'Column_{i + 1}')
                for i in range(n_cols)
            ]

        try:
            import pandas as pd
            from .pdf_views import repair_pdf_dataframe_headers
            repaired_df = repair_pdf_dataframe_headers(
                pd.DataFrame(rows, columns=headers),
                context='zone_text',
            )
            if not repaired_df.empty:
                headers = list(repaired_df.columns)
                rows = repaired_df.values.tolist()
                n_cols = len(headers)
        except Exception as repair_error:
            logger.warning(f"PDF text-zone header repair skipped: {repair_error}")

        quality_metrics = {
            'total_rows': len(rows),
            'total_columns': n_cols,
            'words_outside_columns': result['dropped'],
            'merged_continuation_rows': result.get('merged_continuation_rows', 0),
            'method': strategy_used,
        }
        extraction = PDFExtractionResult.objects.create(
            pdf_session=pdf_session,
            extracted_headers=headers,
            extracted_data=rows,
            confidence_scores={'overall_confidence': 1.0, 'header_confidence': {}},
            quality_metrics=quality_metrics,
            table_count=1,
        )

        import pandas as pd
        from .pdf_views import create_mapping_session_from_dataframe
        from .views import save_session

        df = pd.DataFrame(rows, columns=headers)
        session_data = create_mapping_session_from_dataframe(
            pdf_session=pdf_session, session_id=session_id, df=df, source_type='pdf_zonal',
        )
        save_session(session_id, session_data)

        pdf_session.processing_status = 'completed'
        pdf_session.save()

        logger.info(
            f"🧭 Column-zone extraction | session={session_id} | rows={len(rows)} | "
            f"cols={n_cols} | words_outside={result['dropped']}"
        )

        return Response({
            'session_id': session_id,
            'extraction_id': extraction.id,
            'headers': headers,
            'data': rows,
            'row_count': len(rows),
            'column_count': n_cols,
            'words_outside_columns': result['dropped'],
            'sample_rows': rows[:10],
            'status': 'completed',
            'message': f'Extracted {len(rows)} rows into {n_cols} columns by position',
        }, status=status.HTTP_200_OK)

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error in column-zone extraction: {e}", exc_info=True)
        return Response({'error': f'Column-zone extraction failed: {str(e)}'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
