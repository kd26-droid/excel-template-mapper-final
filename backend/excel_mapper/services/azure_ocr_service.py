"""
Azure Document Intelligence service for table extraction from PDF images
"""
import os
import time
import logging
from typing import List, Dict, Tuple, Optional
import pandas as pd

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeResult, AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError
from django.conf import settings

logger = logging.getLogger(__name__)


class AzureOCRService:
    """Enhanced service for extracting tables from images using Azure Document Intelligence with zone processing"""

    def __init__(self):
        self.endpoint = getattr(settings, 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT')
        self.key = getattr(settings, 'AZURE_DOCUMENT_INTELLIGENCE_KEY')

        endpoint_text = str(self.endpoint or '').strip().lower()
        key_text = str(self.key or '').strip().lower()
        placeholder_config = (
            'your-resource-name' in endpoint_text or
            'your-azure-form-recognizer-key' in key_text or
            key_text in ('', 'none', 'null')
        )
        if not self.endpoint or not self.key or placeholder_config:
            raise ValueError(
                "Azure Document Intelligence is not configured. Set real "
                "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY "
                "in backend/.env, then rebuild the backend container."
            )

        self.client = DocumentIntelligenceClient(
            endpoint=self.endpoint,
            credential=AzureKeyCredential(self.key),
            api_version="2024-11-30"  # Latest GA version with improved table extraction
        )

        # Configuration with premium OCR model
        self.config = getattr(settings, 'PDF_CONFIG', {
            'ocr_model': 'prebuilt-read',  # Premium model for better accuracy
            'confidence_threshold': 0.7,
            'processing_timeout_seconds': 300,
            'enable_high_resolution': True,  # Enable high-resolution mode
            'features': ['OCR_HIGH_RESOLUTION']  # Premium OCR features
        })

    def analyze_zone(self, zone_image_bytes: bytes, zone_metadata: Dict = None) -> Dict[str, any]:
        """
        Analyze a cropped zone image for table extraction

        Args:
            zone_image_bytes: Enhanced zone image as bytes
            zone_metadata: Zone information including coordinates, type, etc.

        Returns:
            Dictionary with zone-specific extraction results
        """
        try:
            logger.info(f"Starting Azure OCR analysis for zone: {zone_metadata.get('zone_id', 'unknown')}")

            # Analyze the zone image
            poller = self.client.begin_analyze_document(
                model_id=self.config['ocr_model'],
                body=zone_image_bytes,
                content_type="application/octet-stream"
            )

            # Wait for completion with timeout
            result = poller.result()

            # Process results with zone context
            extraction_result = self._process_zone_analysis_result(result, zone_metadata)

            logger.info(f"Zone OCR completed. Found {extraction_result['table_count']} tables")
            return extraction_result

        except HttpResponseError as e:
            logger.error(f"Azure API error for zone analysis: {e}")
            raise Exception(f"Azure OCR zone analysis error: {e.message}")
        except Exception as e:
            logger.error(f"Error in zone OCR analysis: {e}")
            raise

    def _process_zone_analysis_result(self, result: AnalyzeResult, zone_metadata: Dict = None) -> Dict[str, any]:
        """
        Process Azure Document Intelligence analysis result for a specific zone

        Args:
            result: AnalyzeResult from Azure
            zone_metadata: Zone information for context

        Returns:
            Structured extraction data with zone context
        """
        try:
            zone_id = zone_metadata.get('zone_id', 'unknown') if zone_metadata else 'unknown'
            zone_type = zone_metadata.get('zone_type', 'table') if zone_metadata else 'table'

            extraction_data = {
                'zone_id': zone_id,
                'zone_type': zone_type,
                'zone_metadata': zone_metadata,
                'tables': [],
                'table_count': 0,
                'extracted_headers': [],
                'extracted_data': [],
                'confidence_scores': {},
                'quality_metrics': {},
                'processing_metadata': {
                    'ocr_model': self.config['ocr_model'],
                    'timestamp': time.time()
                }
            }

            # Extract paragraph-level confidence scores
            paragraph_confidences = {}
            if hasattr(result, 'paragraphs') and result.paragraphs:
                for para in result.paragraphs:
                    if hasattr(para, 'content') and hasattr(para, 'confidence'):
                        paragraph_confidences[para.content.strip()] = para.confidence

            extraction_data['paragraph_confidences'] = paragraph_confidences

            if not result.tables:
                logger.warning(f"No tables found in zone {zone_id}")
                return extraction_data

            extraction_data['table_count'] = len(result.tables)
            logger.info(f"Processing {len(result.tables)} tables in zone {zone_id}")

            # Process each table with zone context
            for table_idx, table in enumerate(result.tables):
                table_data = self._extract_zone_table_data(table, table_idx, paragraph_confidences, zone_metadata)
                extraction_data['tables'].append(table_data)

                # Combine data from all tables in zone
                if table_data['headers']:
                    extraction_data['extracted_headers'].extend(table_data['headers'])

                if table_data['data']:
                    extraction_data['extracted_data'].extend(table_data['data'])

                # Merge confidence scores
                extraction_data['confidence_scores'].update(table_data['confidence_scores'])

            # Calculate zone-specific quality metrics
            extraction_data['quality_metrics'] = self._calculate_zone_quality_metrics(extraction_data)

            return extraction_data

        except Exception as e:
            logger.error(f"Error processing zone analysis result: {e}")
            raise

    def _extract_zone_table_data(self, table, table_idx: int, paragraph_confidences: Dict[str, float], zone_metadata: Dict = None) -> Dict[str, any]:
        """
        Extract data from a table within a specific zone

        Args:
            table: Table object from Azure result
            table_idx: Table index within zone
            paragraph_confidences: Confidence scores from paragraphs
            zone_metadata: Zone context information

        Returns:
            Dictionary with zone table data
        """
        try:
            zone_type = zone_metadata.get('zone_type', 'table') if zone_metadata else 'table'

            table_data = {
                'zone_table_id': f"{zone_metadata.get('zone_id', 'unknown')}_table_{table_idx}",
                'table_id': f"table_{table_idx}",
                'row_count': table.row_count,
                'column_count': table.column_count,
                'headers': [],
                'data': [],
                'confidence_scores': {},
                'cells': [],
                'zone_context': zone_metadata
            }

            # Build cell matrix with zone-aware confidence scoring
            cell_matrix = {}
            for cell in table.cells:
                row_idx = cell.row_index
                col_idx = cell.column_index

                if row_idx not in cell_matrix:
                    cell_matrix[row_idx] = {}

                cell_content = cell.content or ''

                # Zone-aware confidence calculation
                if zone_type == 'header':
                    # Headers should have higher base confidence
                    synthetic_confidence = self._calculate_header_zone_confidence(cell_content, paragraph_confidences)
                else:
                    # Regular table data confidence
                    synthetic_confidence = self._calculate_synthetic_confidence(cell_content, paragraph_confidences)

                cell_matrix[row_idx][col_idx] = {
                    'content': cell_content,
                    'confidence': synthetic_confidence,
                    'kind': getattr(cell, 'kind', 'content'),
                    'zone_type': zone_type
                }

            # Header detection with zone context
            if zone_type == 'header':
                # For header zones, treat the entire zone as headers
                headers = self._extract_headers_from_header_zone(cell_matrix, table.column_count)
                header_confidences = {h: 0.9 for h in headers}  # High confidence for explicitly selected headers
                header_row_idx = 0
                data_rows = []  # No data rows in header zones
                row_confidences = {}
            else:
                # Regular table processing
                header_row_idx, headers, header_confidences = self._detect_headers(cell_matrix, table.column_count, table.row_count)

                # Extract data rows (skip header row)
                data_rows = []
                row_confidences = {}

                for row_idx in range(table.row_count):
                    if row_idx == header_row_idx:
                        continue  # Skip the header row
                    if row_idx in cell_matrix:
                        row_data = []
                        row_confidence_sum = 0.0
                        valid_cells = 0

                        for col_idx in range(table.column_count):
                            if col_idx in cell_matrix[row_idx]:
                                cell = cell_matrix[row_idx][col_idx]
                                content = cell['content'].strip()
                                row_data.append(content)
                                row_confidence_sum += cell['confidence']
                                valid_cells += 1
                            else:
                                row_data.append('')

                        data_rows.append(row_data)

                        # Calculate average confidence for this row
                        avg_confidence = row_confidence_sum / valid_cells if valid_cells > 0 else 0.0
                        row_confidences[f'row_{row_idx}'] = avg_confidence

            table_data['headers'] = headers
            table_data['data'] = data_rows
            table_data['confidence_scores']['headers'] = header_confidences
            table_data['confidence_scores']['rows'] = row_confidences
            table_data['header_row_index'] = header_row_idx

            return table_data

        except Exception as e:
            logger.error(f"Error extracting zone table data: {e}")
            raise

    def _extract_headers_from_header_zone(self, cell_matrix: Dict, column_count: int) -> List[str]:
        """
        Extract headers from a zone specifically designated as a header zone

        Args:
            cell_matrix: Matrix of cells
            column_count: Number of columns

        Returns:
            List of header strings
        """
        headers = []

        # For header zones, we may have multi-row headers
        # Combine text from all rows to form complete headers
        for col_idx in range(column_count):
            header_parts = []

            # Collect text from all rows for this column
            for row_idx in sorted(cell_matrix.keys()):
                if col_idx in cell_matrix[row_idx]:
                    content = cell_matrix[row_idx][col_idx]['content'].strip()
                    if content:
                        header_parts.append(content)

            # Combine header parts
            if header_parts:
                # Join with space, but remove duplicates
                combined_header = ' '.join(header_parts)
                headers.append(combined_header)
            else:
                headers.append(f'Column_{col_idx + 1}')

        return headers

    def _calculate_header_zone_confidence(self, cell_content: str, paragraph_confidences: Dict[str, float]) -> float:
        """
        Calculate confidence for cells in header zones (higher base confidence)

        Args:
            cell_content: Content of the cell
            paragraph_confidences: Paragraph confidence mapping

        Returns:
            Confidence score between 0.0 and 1.0
        """
        if not cell_content or not cell_content.strip():
            return 0.0

        # Start with higher base confidence for header zones
        base_confidence = 0.85

        # Check for paragraph matches
        cell_text = cell_content.strip()
        for para_text, confidence in paragraph_confidences.items():
            if cell_text in para_text or para_text in cell_text:
                return max(confidence, base_confidence)

        # Header-specific confidence adjustments
        confidence_score = base_confidence

        # Boost for typical header words
        header_words = ['item', 'product', 'name', 'description', 'quantity', 'price', 'code', 'id', 'number', 'type', 'category']
        if any(word in cell_text.lower() for word in header_words):
            confidence_score += 0.1

        # Ensure valid range
        return max(0.0, min(1.0, confidence_score))

    def _calculate_zone_quality_metrics(self, extraction_data: Dict[str, any]) -> Dict[str, any]:
        """
        Calculate quality metrics specific to zone processing

        Args:
            extraction_data: Zone extraction results

        Returns:
            Zone-specific quality metrics
        """
        try:
            metrics = {
                'zone_id': extraction_data.get('zone_id'),
                'zone_type': extraction_data.get('zone_type'),
                'overall_confidence': 0.0,
                'header_confidence': 0.0,
                'data_confidence': 0.0,
                'zone_completeness': 0.0,
                'zone_structure_score': 0.0,
                'zone_ocr_readiness': 0.0
            }

            if not extraction_data['tables']:
                return metrics

            # Calculate zone-specific confidence scores
            total_header_confidence = 0.0
            total_data_confidence = 0.0
            header_count = 0
            data_count = 0

            for table in extraction_data['tables']:
                # Header confidence
                if 'headers' in table['confidence_scores']:
                    for conf in table['confidence_scores']['headers'].values():
                        total_header_confidence += conf
                        header_count += 1

                # Data confidence
                if 'rows' in table['confidence_scores']:
                    for conf in table['confidence_scores']['rows'].values():
                        total_data_confidence += conf
                        data_count += 1

            metrics['header_confidence'] = total_header_confidence / header_count if header_count > 0 else 0.0
            metrics['data_confidence'] = total_data_confidence / data_count if data_count > 0 else 0.0
            metrics['overall_confidence'] = (metrics['header_confidence'] + metrics['data_confidence']) / 2

            # Zone completeness (specific to zone type)
            zone_type = extraction_data.get('zone_type', 'table')
            if zone_type == 'header':
                # For header zones, completeness is about having meaningful headers
                total_headers = sum(len(table['headers']) for table in extraction_data['tables'])
                meaningful_headers = sum(1 for table in extraction_data['tables']
                                       for header in table['headers']
                                       if header.strip() and not header.startswith('Column_'))
                metrics['zone_completeness'] = meaningful_headers / total_headers if total_headers > 0 else 0.0
            else:
                # For table zones, completeness is about filled cells
                total_cells = 0
                filled_cells = 0
                for table in extraction_data['tables']:
                    for row in table['data']:
                        for cell in row:
                            total_cells += 1
                            if str(cell).strip():
                                filled_cells += 1
                metrics['zone_completeness'] = filled_cells / total_cells if total_cells > 0 else 0.0

            # Zone structure score
            if extraction_data['tables']:
                # For zones, structure consistency within the zone
                consistent_structure = True
                expected_columns = extraction_data['tables'][0]['column_count']

                for table in extraction_data['tables']:
                    if table['column_count'] != expected_columns:
                        consistent_structure = False
                        break

                metrics['zone_structure_score'] = 1.0 if consistent_structure else 0.5

            # OCR readiness score (quality of the zone for OCR)
            metrics['zone_ocr_readiness'] = min(1.0,
                (metrics['overall_confidence'] * 0.4) +
                (metrics['zone_completeness'] * 0.3) +
                (metrics['zone_structure_score'] * 0.3)
            )

            return metrics

        except Exception as e:
            logger.error(f"Error calculating zone quality metrics: {e}")
            return metrics

    def analyze_pdf_file(self, file_path: str) -> Dict[str, any]:
        """
        Analyze entire PDF file for table extraction

        Args:
            file_path: Path to PDF file

        Returns:
            Dictionary with extraction results
        """
        try:
            logger.info(f"Starting Azure OCR analysis for PDF: {file_path}")

            with open(file_path, 'rb') as pdf_file:
                poller = self.client.begin_analyze_document(
                    model_id=self.config['ocr_model'],
                    body=pdf_file,
                    content_type="application/pdf"
                )

                # Wait for completion
                result = poller.result()

                # Process the results
                extraction_result = self._process_analysis_result(result)

                logger.info(f"Azure OCR analysis completed. Found {extraction_result['table_count']} tables")
                return extraction_result

        except HttpResponseError as e:
            logger.error(f"Azure API error: {e}")
            raise Exception(f"Azure OCR service error: {e.message}")
        except Exception as e:
            logger.error(f"Error in Azure OCR analysis: {e}")
            raise

    def analyze_image(self, image_path: str) -> Dict[str, any]:
        """
        Analyze a single image for table extraction

        Args:
            image_path: Path to image file

        Returns:
            Dictionary with extraction results
        """
        try:
            logger.info(f"Starting Azure OCR analysis for image: {image_path}")

            with open(image_path, 'rb') as image_file:
                poller = self.client.begin_analyze_document(
                    model_id=self.config['ocr_model'],
                    body=image_file,
                    content_type="application/octet-stream"
                )

                # Wait for completion
                result = poller.result()

                # Process the results
                extraction_result = self._process_analysis_result(result)

                logger.info(f"Azure OCR analysis completed. Found {extraction_result['table_count']} tables")
                return extraction_result

        except HttpResponseError as e:
            logger.error(f"Azure API error: {e}")
            raise Exception(f"Azure OCR service error: {e.message}")
        except Exception as e:
            logger.error(f"Error in Azure OCR analysis: {e}")
            raise

    def _process_analysis_result(self, result: AnalyzeResult) -> Dict[str, any]:
        """
        Process Azure Document Intelligence analysis result

        Args:
            result: AnalyzeResult from Azure

        Returns:
            Structured extraction data
        """
        try:
            extraction_data = {
                'tables': [],
                'table_count': 0,
                'extracted_headers': [],
                'extracted_data': [],
                'confidence_scores': {},
                'quality_metrics': {},
                'raw_result': None  # Store for debugging
            }

            # Extract paragraph-level confidence scores for synthetic confidence calculation
            paragraph_confidences = {}
            if hasattr(result, 'paragraphs') and result.paragraphs:
                logger.info(f"🔍 AZURE DEBUG: Found {len(result.paragraphs)} paragraphs with confidence scores")
                for para in result.paragraphs:
                    if hasattr(para, 'content') and hasattr(para, 'confidence'):
                        paragraph_confidences[para.content.strip()] = para.confidence
                        logger.info(f"🔍 AZURE DEBUG: Paragraph '{para.content[:50]}...' confidence: {para.confidence}")
            else:
                logger.info("🔍 AZURE DEBUG: No paragraphs with confidence found")

            # Store paragraph confidences for later use
            extraction_data['paragraph_confidences'] = paragraph_confidences

            if not result.tables:
                logger.warning("No tables found in document")
                return extraction_data

            extraction_data['table_count'] = len(result.tables)
            logger.info(f"Processing {len(result.tables)} tables")

            # Process each table
            for table_idx, table in enumerate(result.tables):
                table_data = self._extract_table_data(table, table_idx, paragraph_confidences)
                extraction_data['tables'].append(table_data)

                # Combine data from all tables
                if table_data['headers']:
                    extraction_data['extracted_headers'].extend(table_data['headers'])

                if table_data['data']:
                    extraction_data['extracted_data'].extend(table_data['data'])

                # Merge confidence scores
                extraction_data['confidence_scores'].update(table_data['confidence_scores'])

            # Calculate overall quality metrics
            extraction_data['quality_metrics'] = self._calculate_quality_metrics(extraction_data)

            logger.info(f"Extracted {len(extraction_data['extracted_headers'])} headers and {len(extraction_data['extracted_data'])} rows")
            return extraction_data

        except Exception as e:
            logger.error(f"Error processing analysis result: {e}")
            raise

    def _extract_table_data(self, table, table_idx: int, paragraph_confidences: Dict[str, float] = None) -> Dict[str, any]:
        """
        Extract data from a single table

        Args:
            table: Table object from Azure result
            table_idx: Table index
            paragraph_confidences: Dictionary of paragraph confidence scores

        Returns:
            Dictionary with table data
        """
        try:
            # Initialize table structure
            table_data = {
                'table_id': f"table_{table_idx}",
                'page_number': self._get_table_page_number(table),
                'row_count': table.row_count,
                'column_count': table.column_count,
                'headers': [],
                'data': [],
                'confidence_scores': {},
                'cells': []
            }

            # Build cell matrix
            cell_matrix = {}
            for cell in table.cells:
                row_idx = cell.row_index
                col_idx = cell.column_index

                if row_idx not in cell_matrix:
                    cell_matrix[row_idx] = {}

                # Debug: Log cell attributes to understand Azure response structure
                if row_idx == 0 and col_idx == 0:  # Log first cell only to avoid spam
                    cell_attrs = [attr for attr in dir(cell) if not attr.startswith('_')]
                    logger.info(f"🔍 AZURE DEBUG: Cell attributes: {cell_attrs}")
                    logger.info(f"🔍 AZURE DEBUG: Cell content: '{cell.content}'")
                    if hasattr(cell, 'confidence'):
                        logger.info(f"🔍 AZURE DEBUG: Cell confidence: {cell.confidence}")
                    else:
                        logger.info("🔍 AZURE DEBUG: Cell has NO confidence attribute")

                # Calculate synthetic confidence based on paragraph matching
                cell_content = cell.content or ''
                synthetic_confidence = self._calculate_synthetic_confidence(cell_content, paragraph_confidences or {})

                cell_matrix[row_idx][col_idx] = {
                    'content': cell_content,
                    'confidence': synthetic_confidence,
                    'kind': getattr(cell, 'kind', 'content')
                }

            # Intelligent header detection
            header_row_idx, headers, header_confidences = self._detect_headers(cell_matrix, table.column_count, table.row_count)

            table_data['headers'] = headers
            table_data['confidence_scores']['headers'] = header_confidences
            table_data['header_row_index'] = header_row_idx

            # Extract data rows (skip header row)
            data_rows = []
            row_confidences = {}

            # Skip the detected header row
            for row_idx in range(table.row_count):
                if row_idx == header_row_idx:
                    continue  # Skip the header row
                if row_idx in cell_matrix:
                    row_data = []
                    row_confidence_sum = 0.0
                    valid_cells = 0

                    for col_idx in range(table.column_count):
                        if col_idx in cell_matrix[row_idx]:
                            cell = cell_matrix[row_idx][col_idx]
                            content = cell['content'].strip()
                            row_data.append(content)
                            row_confidence_sum += cell['confidence']
                            valid_cells += 1
                        else:
                            row_data.append('')

                    data_rows.append(row_data)

                    # Calculate average confidence for this row
                    avg_confidence = row_confidence_sum / valid_cells if valid_cells > 0 else 0.0
                    row_confidences[f'row_{row_idx}'] = avg_confidence

            table_data['data'] = data_rows
            table_data['confidence_scores']['rows'] = row_confidences

            logger.debug(f"Extracted table {table_idx}: {len(table_data['headers'])} columns, {len(data_rows)} rows")
            return table_data

        except Exception as e:
            logger.error(f"Error extracting table data: {e}")
            raise

    def _get_table_page_number(self, table) -> int:
        try:
            regions = getattr(table, 'bounding_regions', None) or []
            if regions:
                return getattr(regions[0], 'page_number', None) or 0
        except Exception:
            return 0
        return 0

    def _calculate_quality_metrics(self, extraction_data: Dict[str, any]) -> Dict[str, any]:
        """
        Calculate quality metrics for the extraction

        Args:
            extraction_data: Extraction results

        Returns:
            Quality metrics dictionary
        """
        try:
            metrics = {
                'overall_confidence': 0.0,
                'header_confidence': 0.0,
                'data_confidence': 0.0,
                'completeness_score': 0.0,
                'table_structure_score': 0.0
            }

            if not extraction_data['tables']:
                return metrics

            # Calculate average confidence scores
            total_header_confidence = 0.0
            total_data_confidence = 0.0
            header_count = 0
            data_count = 0

            for table in extraction_data['tables']:
                # Header confidence
                if 'headers' in table['confidence_scores']:
                    for conf in table['confidence_scores']['headers'].values():
                        total_header_confidence += conf
                        header_count += 1

                # Data confidence
                if 'rows' in table['confidence_scores']:
                    for conf in table['confidence_scores']['rows'].values():
                        total_data_confidence += conf
                        data_count += 1

            metrics['header_confidence'] = total_header_confidence / header_count if header_count > 0 else 0.0
            metrics['data_confidence'] = total_data_confidence / data_count if data_count > 0 else 0.0
            metrics['overall_confidence'] = (metrics['header_confidence'] + metrics['data_confidence']) / 2

            # Completeness score (percentage of non-empty cells)
            total_cells = 0
            filled_cells = 0

            for table in extraction_data['tables']:
                for row in table['data']:
                    for cell in row:
                        total_cells += 1
                        if cell.strip():
                            filled_cells += 1

            metrics['completeness_score'] = filled_cells / total_cells if total_cells > 0 else 0.0

            # Table structure score (consistency of column counts)
            if extraction_data['tables']:
                expected_columns = len(extraction_data['tables'][0]['headers'])
                consistent_rows = 0
                total_rows = 0

                for table in extraction_data['tables']:
                    for row in table['data']:
                        total_rows += 1
                        if len(row) == expected_columns:
                            consistent_rows += 1

                metrics['table_structure_score'] = consistent_rows / total_rows if total_rows > 0 else 0.0

            return metrics

        except Exception as e:
            logger.error(f"Error calculating quality metrics: {e}")
            return metrics

    def validate_zone_extraction_quality(self, extraction_data: Dict[str, any]) -> Dict[str, any]:
        """
        Validate the quality of zone-specific extraction results

        Args:
            extraction_data: Zone extraction results

        Returns:
            Zone-specific validation results with recommendations
        """
        try:
            quality_metrics = extraction_data.get('quality_metrics', {})
            zone_type = extraction_data.get('zone_type', 'table')
            zone_id = extraction_data.get('zone_id', 'unknown')
            threshold = self.config['confidence_threshold']

            validation = {
                'zone_id': zone_id,
                'zone_type': zone_type,
                'is_valid': True,
                'warnings': [],
                'errors': [],
                'recommendations': [],
                'quality_grade': 'A'  # A, B, C, D, F
            }

            # Zone-specific validation rules
            overall_conf = quality_metrics.get('overall_confidence', 0.0)

            if zone_type == 'header':
                # Header zones should have high confidence and meaningful headers
                header_conf = quality_metrics.get('header_confidence', 0.0)
                completeness = quality_metrics.get('zone_completeness', 0.0)

                if header_conf < 0.8:
                    validation['warnings'].append(f"Header zone confidence low ({header_conf:.2f} < 0.8)")
                    validation['recommendations'].append("Review header text extraction - consider manual correction")

                if completeness < 0.7:
                    validation['warnings'].append(f"Header completeness low ({completeness:.2f} < 0.7)")
                    validation['recommendations'].append("Check if all important headers were captured in zone")

                # Grade header zones
                if header_conf >= 0.9 and completeness >= 0.8:
                    validation['quality_grade'] = 'A'
                elif header_conf >= 0.8 and completeness >= 0.7:
                    validation['quality_grade'] = 'B'
                elif header_conf >= 0.6 and completeness >= 0.5:
                    validation['quality_grade'] = 'C'
                elif header_conf >= 0.4:
                    validation['quality_grade'] = 'D'
                else:
                    validation['quality_grade'] = 'F'
                    validation['is_valid'] = False
                    validation['errors'].append("Header zone quality too low for reliable use")

            else:
                # Table zones validation
                data_conf = quality_metrics.get('data_confidence', 0.0)
                completeness = quality_metrics.get('zone_completeness', 0.0)
                structure_score = quality_metrics.get('zone_structure_score', 0.0)

                if data_conf < threshold:
                    validation['warnings'].append(f"Table data confidence low ({data_conf:.2f} < {threshold})")
                    validation['recommendations'].append("Review extracted table data for accuracy")

                if completeness < 0.5:
                    validation['warnings'].append(f"Table completeness low ({completeness:.2f} < 0.5)")
                    validation['recommendations'].append("Check for missing data in table zone")

                if structure_score < 0.8:
                    validation['warnings'].append(f"Table structure inconsistent ({structure_score:.2f} < 0.8)")
                    validation['recommendations'].append("Verify table boundaries and alignment")

                # Grade table zones
                avg_score = (data_conf + completeness + structure_score) / 3
                if avg_score >= 0.85:
                    validation['quality_grade'] = 'A'
                elif avg_score >= 0.7:
                    validation['quality_grade'] = 'B'
                elif avg_score >= 0.55:
                    validation['quality_grade'] = 'C'
                elif avg_score >= 0.4:
                    validation['quality_grade'] = 'D'
                else:
                    validation['quality_grade'] = 'F'
                    validation['is_valid'] = False
                    validation['errors'].append("Table zone quality too low for reliable use")

            # OCR readiness check
            ocr_readiness = quality_metrics.get('zone_ocr_readiness', 0.0)
            if ocr_readiness < 0.6:
                validation['warnings'].append(f"Zone OCR readiness low ({ocr_readiness:.2f} < 0.6)")
                validation['recommendations'].append("Consider image enhancement or zone reselection")

            return validation

        except Exception as e:
            logger.error(f"Error validating zone extraction quality: {e}")
            return {
                'zone_id': extraction_data.get('zone_id', 'unknown'),
                'zone_type': extraction_data.get('zone_type', 'unknown'),
                'is_valid': False,
                'warnings': [],
                'errors': [f"Validation error: {str(e)}"],
                'recommendations': ["Manual review required due to validation error"],
                'quality_grade': 'F'
            }

    def validate_extraction_quality(self, extraction_data: Dict[str, any]) -> Dict[str, any]:
        """
        Validate the quality of extraction results

        Args:
            extraction_data: Extraction results

        Returns:
            Validation results with recommendations
        """
        try:
            quality_metrics = extraction_data.get('quality_metrics', {})
            threshold = self.config['confidence_threshold']

            validation = {
                'is_valid': True,
                'warnings': [],
                'errors': [],
                'recommendations': []
            }

            # Check overall confidence
            overall_conf = quality_metrics.get('overall_confidence', 0.0)
            if overall_conf < threshold:
                validation['warnings'].append(f"Low overall confidence ({overall_conf:.2f} < {threshold})")
                validation['recommendations'].append("Consider manual review of extracted data")

            # Check header confidence
            header_conf = quality_metrics.get('header_confidence', 0.0)
            if header_conf < threshold:
                validation['warnings'].append(f"Low header confidence ({header_conf:.2f} < {threshold})")
                validation['recommendations'].append("Review and correct column headers manually")

            # Check completeness
            completeness = quality_metrics.get('completeness_score', 0.0)
            if completeness < 0.5:
                validation['warnings'].append(f"Low data completeness ({completeness:.2f} < 0.5)")
                validation['recommendations'].append("Check for missing data in extracted tables")

            # Check table structure
            structure_score = quality_metrics.get('table_structure_score', 0.0)
            if structure_score < 0.8:
                validation['warnings'].append(f"Inconsistent table structure ({structure_score:.2f} < 0.8)")
                validation['recommendations'].append("Verify table boundaries and column alignment")

            # Set overall validity
            if overall_conf < 0.3 or completeness < 0.2:
                validation['is_valid'] = False
                validation['errors'].append("Extraction quality too low for reliable use")

            return validation

        except Exception as e:
            logger.error(f"Error validating extraction quality: {e}")
            return {
                'is_valid': False,
                'warnings': [],
                'errors': [f"Validation error: {str(e)}"],
                'recommendations': ["Manual review required due to validation error"]
            }

    def convert_to_dataframe(self, extraction_data: Dict[str, any], alignment_mode: str = 'preserve') -> pd.DataFrame:
        """
        Convert extraction results to pandas DataFrame

        Args:
            extraction_data: Extraction results
            alignment_mode: 'preserve' to keep page/table structure, 'flatten' to align/merge columns across tables

        Returns:
            Combined DataFrame from all tables
        """
        try:
            if not extraction_data['tables']:
                return pd.DataFrame()

            # Combine all tables into a single DataFrame
            all_data = []

            # Normalize header helper (used in 'flatten' mode)
            def _normalize_header_name(h: str) -> str:
                key = (h or '').strip()
                key_lower = key.lower()
                # quick fast-path
                if alignment_mode != 'flatten':
                    return key

                # Canonicalize punctuation/spacing
                canon = (
                    key_lower
                    .replace('\u00a0', ' ')
                    .replace('\r', ' ')
                    .replace('\n', ' ')
                    .strip()
                )
                # Remove extra spaces
                while '  ' in canon:
                    canon = canon.replace('  ', ' ')
                # Alias map (synonyms → canonical)
                alias_map = {
                    'item code': 'Item code',
                    'item no': 'Item code',
                    'item number': 'Item code',
                    'code': 'Item code',
                    'part no': 'Item code',
                    'part number': 'Item code',
                    'part#': 'Item code',

                    'item name': 'Item name',
                    'product name': 'Item name',
                    'name': 'Item name',

                    'description': 'Description',
                    'desc': 'Description',

                    'qty': 'Quantity',
                    'quantity': 'Quantity',

                    'uom': 'Measurement unit',
                    'unit': 'Measurement unit',
                    'unit of measure': 'Measurement unit',
                    'measurement unit': 'Measurement unit',

                    'manufacturer': 'Manufacturer',
                    'mfr': 'Manufacturer',
                    'brand': 'Manufacturer',

                    'customer identification name': 'Customer_Identification_Name_1',
                    'customer id name': 'Customer_Identification_Name_1',
                    'customer identification value': 'Customer_Identification_Value_1',
                    'customer id value': 'Customer_Identification_Value_1',

                    'specification name': 'Specification_Name_1',
                    'spec name': 'Specification_Name_1',
                    'specification value': 'Specification_Value_1',
                    'spec value': 'Specification_Value_1',

                    'preferred vendor code': 'Preferred vendor code',
                    'vendor code': 'Preferred vendor code',

                    'procurement item': 'Procurement item',
                    'sales item': 'Sales item',
                    'procurement entity name': 'Procurement entity name',
                }
                if canon in alias_map:
                    return alias_map[canon]
                # Title-case non-mapped headers to keep display consistent
                return key if key else ''

            # Collect ALL unique headers from ALL tables
            all_headers_set = set()
            table_headers_list = []

            # First pass: collect all unique headers maintaining order
            for table_idx, table in enumerate(extraction_data['tables']):
                # Apply normalization ONLY in 'flatten' mode, not in 'align' or 'preserve'
                if alignment_mode == 'flatten':
                    table_headers = [_normalize_header_name(h) for h in table['headers']]
                else:
                    # Keep original headers without renaming
                    table_headers = table['headers']
                table_headers_list.append(table_headers)
                logger.info(f"Table {table_idx + 1} headers: {table_headers}")

                # Add headers to our master set
                for header in table_headers:
                    if header.strip():  # Only add non-empty headers
                        all_headers_set.add(header.strip())

            # Create ordered list of combined headers
            # Start with headers from the table with most columns, then add unique ones
            max_columns = 0
            primary_table_headers = []
            for table_headers in table_headers_list:
                if len(table_headers) > max_columns:
                    max_columns = len(table_headers)
                    primary_table_headers = table_headers

            # Build combined headers: start with primary table, add missing unique headers
            combined_headers = []
            for header in primary_table_headers:
                if header.strip():
                    combined_headers.append(header.strip())
                    all_headers_set.discard(header.strip())  # Remove from remaining set

            # Add any remaining unique headers from other tables
            for header in sorted(all_headers_set):  # Sort for consistency
                combined_headers.append(header)

            logger.info(f"Combined headers from all tables: {combined_headers}")
            logger.info(f"Total unique headers: {len(combined_headers)}")

            # Combine data from all tables
            if alignment_mode in ('flatten', 'align'):
                # Overlay rows by position across tables to align columns on same row index
                # 1) Determine maximum number of rows among tables
                table_rows_counts = [len(t['data']) for t in extraction_data['tables']]
                max_rows = max(table_rows_counts) if table_rows_counts else 0
                logger.info(f"Flatten mode: overlaying rows by position across {len(extraction_data['tables'])} tables, max_rows={max_rows}")

                # 2) Initialize row records with combined headers
                row_records = [{col: '' for col in combined_headers} for _ in range(max_rows)]

                def _clean_cell(val):
                    try:
                        s = str(val)
                        s = s.replace('\u00a0', ' ').replace('\r', ' ').replace('\n', ' ')
                        s = ' '.join(s.split())
                        return s.strip()
                    except Exception:
                        return '' if val is None else str(val)

                def _prefer(existing, incoming):
                    a = _clean_cell(existing)
                    b = _clean_cell(incoming)
                    if a and not b:
                        return a
                    if b and not a:
                        return b
                    if not a and not b:
                        return ''
                    return a if len(a) >= len(b) else b

                # 3) Fill row records from each table
                for table_idx, table in enumerate(extraction_data['tables']):
                    # Only normalize headers in 'flatten' mode, not 'align' mode
                    if alignment_mode == 'flatten':
                        table_headers = [_normalize_header_name(h) for h in table['headers']]
                    else:
                        table_headers = table['headers']
                    logger.info(f"{alignment_mode.capitalize()} mode: processing table {table_idx + 1} with headers: {table_headers}")
                    for row_idx, row in enumerate(table['data']):
                        if row_idx >= max_rows:
                            break
                        for col_idx, cell_value in enumerate(row):
                            if col_idx < len(table_headers):
                                header = table_headers[col_idx].strip()
                                if header and header in combined_headers:
                                    existing = row_records[row_idx].get(header, '')
                                    row_records[row_idx][header] = _prefer(existing, cell_value)

                # 4) Convert row records to list rows in combined_headers order
                for r in range(max_rows):
                    row_out = [row_records[r].get(h, '') for h in combined_headers]
                    # Treat rows with some non-empty cells as data
                    if any(str(c).strip() for c in row_out):
                        all_data.append(row_out)
                logger.info(f"Flatten mode: produced {len(all_data)} aligned rows")
            else:
                # preserve mode: append rows from each table as-is, mapped into combined header positions
                for table_idx, table in enumerate(extraction_data['tables']):
                    table_headers = table['headers']
                    logger.info(f"Processing data for table {table_idx + 1} with headers: {table_headers}")

                    for row_idx, row in enumerate(table['data']):
                        logger.debug(f"Table {table_idx + 1} row {row_idx + 1}: {row}")

                        # Create a new row with data mapped to combined headers
                        normalized_row = [''] * len(combined_headers)

                        # Map data from this table's row to the combined header positions
                        for col_idx, cell_value in enumerate(row):
                            if col_idx < len(table_headers):
                                table_header = table_headers[col_idx].strip()
                                if table_header and table_header in combined_headers:
                                    combined_col_idx = combined_headers.index(table_header)
                                    normalized_row[combined_col_idx] = str(cell_value) if cell_value is not None else ''
                                    logger.debug(f"Mapped '{cell_value}' from column '{table_header}' to position {combined_col_idx}")

                        # Only add rows that have some data (safe string checking)
                        has_data = any(str(cell).strip() for cell in normalized_row if cell is not None)
                        logger.debug(f"Row has data: {has_data}, normalized_row: {normalized_row}")

                        if has_data:
                            all_data.append(normalized_row)
                            logger.info(f"Added row from table {table_idx + 1}: {normalized_row}")
                        else:
                            logger.warning(f"Skipped empty row from table {table_idx + 1}: {row}")

            # Create DataFrame
            df = pd.DataFrame(all_data, columns=combined_headers)

            # Clean up empty rows and columns
            df = df.dropna(how='all')  # Remove completely empty rows

            # Optional additional cleanup in flatten mode
            if alignment_mode == 'flatten' and not df.empty:
                try:
                    # Trim and collapse internal whitespace for all cells
                    def _clean_cell(val):
                        try:
                            s = str(val)
                            s = s.replace('\u00a0', ' ').replace('\r', ' ').replace('\n', ' ')
                            s = ' '.join(s.split())  # collapse multiple spaces
                            return s.strip()
                        except Exception:
                            return val

                    df = df.applymap(_clean_cell)
                    # Do not consolidate or drop sparse columns in flatten mode; preserve union for mapping
                except Exception as e:
                    logger.warning(f"Flatten mode cleanup skipped due to error: {e}")

            # Remove any rows that contain only header names (header contamination)
            # This can happen if Azure OCR incorrectly includes header rows as data
            rows_to_remove = []
            for idx, row in df.iterrows():
                row_values = [str(val).strip().lower() for val in row if str(val).strip()]
                if row_values:
                    # Check if this row contains mostly header names
                    header_matches = 0
                    for header in combined_headers:
                        header_lower = header.lower().strip()
                        if header_lower in row_values:
                            header_matches += 1

                    # If more than 30% of the row contains header names, it's likely a header row
                    if header_matches / len([h for h in combined_headers if h.strip()]) > 0.3:
                        rows_to_remove.append(idx)
                        logger.warning(f"Removing potential header contamination row {idx}: {row.tolist()}")

                    # Additional check: if row contains exact header matches in corresponding positions
                    row_list = row.tolist()
                    exact_position_matches = 0
                    for col_idx, header in enumerate(combined_headers):
                        if col_idx < len(row_list):
                            cell_value = str(row_list[col_idx]).strip()
                            if cell_value.lower() == header.lower().strip():
                                exact_position_matches += 1

                    # If more than 50% of columns have exact header matches in correct positions, it's a header row
                    if exact_position_matches > 0 and exact_position_matches / len(combined_headers) > 0.5:
                        if idx not in rows_to_remove:  # Avoid duplicate removal
                            rows_to_remove.append(idx)
                            logger.warning(f"Removing exact header match contamination row {idx}: {row.tolist()}")

            # Additional filtering: Remove rows that have too many empty cells and seem like partial data
            # This handles cases where Azure OCR splits multi-column data across separate rows
            total_columns = len(combined_headers)
            for idx, row in df.iterrows():
                if idx not in rows_to_remove:  # Don't check already marked rows
                    non_empty_count = sum(1 for val in row if str(val).strip())

                    # If a row has very few non-empty cells (less than 20% of columns), it might be partial data
                    if non_empty_count > 0 and non_empty_count < max(2, total_columns * 0.2):
                        # Check if this row seems to contain only manufacturer/vendor data
                        row_values = [str(val).strip() for val in row if str(val).strip()]

                        # Common manufacturer/vendor patterns that shouldn't be in primary data
                        vendor_indicators = ['samsung', 'diodes', 'kemet', 'vishay', 'murata', 'fairchild', 'on semiconductor', 'kangdao']
                        status_indicators = ['ok', 'discontinued', 'available', 'alternate', 'gerber']

                        contains_vendor = any(any(indicator in val.lower() for indicator in vendor_indicators) for val in row_values)
                        contains_status = any(any(indicator in val.lower() for indicator in status_indicators) for val in row_values)

                        if contains_vendor or contains_status:
                            rows_to_remove.append(idx)
                            logger.warning(f"Removing partial data row {idx} (vendor/status only): {row.tolist()}")

            if rows_to_remove:
                df = df.drop(rows_to_remove)
                logger.info(f"Removed {len(rows_to_remove)} contaminated/partial rows from DataFrame")

            # Remove columns with empty headers (safer approach)
            columns_to_keep = []
            for col in df.columns:
                if str(col).strip():  # Keep columns with non-empty headers
                    columns_to_keep.append(col)

            if columns_to_keep:
                df = df[columns_to_keep]

            logger.info(f"Created DataFrame with {len(df)} rows and {len(df.columns)} columns")
            return df

        except Exception as e:
            logger.error(f"Error converting to DataFrame: {e}")
            return pd.DataFrame()

    def _detect_headers(self, cell_matrix: Dict, column_count: int, row_count: int) -> Tuple[int, List[str], Dict[str, float]]:
        """
        Intelligently detect which row contains headers.

        Headers are typically:
        1. Short, descriptive text (not numbers)
        2. Unique across columns
        3. Often in the first few rows
        4. May have different formatting/styling
        5. Contain common header keywords

        Args:
            cell_matrix: Matrix of cells by row/column
            column_count: Number of columns
            row_count: Number of rows

        Returns:
            Tuple of (header_row_index, headers_list, confidence_scores)
        """
        try:
            header_keywords = {
                'item', 'product', 'name', 'description', 'code', 'id', 'number', 'qty', 'quantity',
                'price', 'cost', 'amount', 'total', 'unit', 'type', 'category', 'model', 'part',
                'specification', 'spec', 'value', 'customer', 'vendor', 'supplier', 'date',
                'cpn', 'uom', 'manufacturer', 'brand', 'material', 'size', 'weight', 'color'
            }

            best_header_row = 0
            best_score = 0
            best_headers = []
            best_confidences = {}

            # Check first 3 rows for potential headers
            for row_idx in range(min(3, row_count)):
                if row_idx not in cell_matrix:
                    continue

                row_headers = []
                row_confidences = {}
                score = 0

                # Extract potential headers from this row
                for col_idx in range(column_count):
                    if col_idx in cell_matrix[row_idx]:
                        cell = cell_matrix[row_idx][col_idx]
                        header_text = cell['content'].strip()
                        row_headers.append(header_text)
                        row_confidences[header_text] = cell['confidence']
                    else:
                        row_headers.append('')
                        row_confidences[''] = 0.0

                # Score this row as potential headers
                # 1. Non-empty content score
                non_empty_count = sum(1 for h in row_headers if h.strip())
                if non_empty_count == 0:
                    continue

                score += (non_empty_count / column_count) * 30  # Max 30 points for coverage

                # 2. Text vs numbers score (headers should be mostly text)
                text_count = 0
                for header in row_headers:
                    if header.strip():
                        # Check if it's mostly text (not a pure number)
                        try:
                            float(header.strip())
                            # It's a number, lower score
                        except ValueError:
                            # It's text, higher score
                            text_count += 1

                score += (text_count / max(1, non_empty_count)) * 25  # Max 25 points for text content

                # 3. Uniqueness score (headers should be unique)
                unique_headers = set(h.strip().lower() for h in row_headers if h.strip())
                uniqueness_ratio = len(unique_headers) / max(1, non_empty_count)
                score += uniqueness_ratio * 20  # Max 20 points for uniqueness

                # 4. Header keyword bonus
                keyword_matches = 0
                for header in row_headers:
                    header_lower = header.strip().lower()
                    if any(keyword in header_lower for keyword in header_keywords):
                        keyword_matches += 1

                if keyword_matches > 0:
                    score += min(keyword_matches / max(1, non_empty_count), 1.0) * 15  # Max 15 points

                # 5. Length penalty for very long text (likely data, not headers)
                avg_length = sum(len(h.strip()) for h in row_headers if h.strip()) / max(1, non_empty_count)
                if avg_length > 50:  # Very long average length suggests data rows
                    score -= 10
                elif avg_length < 5:  # Very short might be codes or abbreviations
                    score -= 5

                # 6. Position bonus (earlier rows more likely to be headers)
                if row_idx == 0:
                    score += 10
                elif row_idx == 1:
                    score += 5

                logger.debug(f"Row {row_idx} header score: {score:.2f}, headers: {row_headers[:3]}...")

                if score > best_score:
                    best_score = score
                    best_header_row = row_idx
                    best_headers = row_headers
                    best_confidences = row_confidences

            # Fallback to row 0 if no good headers found
            if best_score < 20 and 0 in cell_matrix:
                logger.warning("No confident headers detected, falling back to row 0")
                best_header_row = 0
                best_headers = []
                best_confidences = {}

                for col_idx in range(column_count):
                    if col_idx in cell_matrix[0]:
                        cell = cell_matrix[0][col_idx]
                        header_text = cell['content'].strip()
                        best_headers.append(header_text)
                        best_confidences[header_text] = cell['confidence']
                    else:
                        best_headers.append('')
                        best_confidences[''] = 0.0

            # Generate better headers if extracted ones are poor
            if not any(h.strip() for h in best_headers):
                logger.warning("No valid headers found, generating default column names")
                best_headers = [f"Column_{i+1}" for i in range(column_count)]
                best_confidences = {h: 0.5 for h in best_headers}

            logger.info(f"Detected headers in row {best_header_row} with score {best_score:.2f}: {best_headers}")
            return best_header_row, best_headers, best_confidences

        except Exception as e:
            logger.error(f"Error in header detection: {e}")
            # Fallback to simple row 0 extraction
            headers = []
            confidences = {}

            if 0 in cell_matrix:
                for col_idx in range(column_count):
                    if col_idx in cell_matrix[0]:
                        cell = cell_matrix[0][col_idx]
                        header_text = cell['content'].strip()
                        headers.append(header_text)
                        confidences[header_text] = cell['confidence']
                    else:
                        headers.append('')
                        confidences[''] = 0.0
            else:
                headers = [f"Column_{i+1}" for i in range(column_count)]
                confidences = {h: 0.5 for h in headers}

            return 0, headers, confidences

    def _calculate_synthetic_confidence(self, cell_content: str, paragraph_confidences: Dict[str, float]) -> float:
        """
        Calculate synthetic confidence score for a cell based on paragraph matches and text quality.

        Since Azure table cells don't have confidence scores, we use:
        1. Paragraph confidence scores (if text matches)
        2. Text quality indicators (length, special chars, etc.)
        3. Default reasonable confidence for headers

        Args:
            cell_content: Content of the table cell
            paragraph_confidences: Dict mapping paragraph text to confidence scores

        Returns:
            Synthetic confidence score between 0.0 and 1.0
        """
        if not cell_content or not cell_content.strip():
            return 0.0

        cell_text = cell_content.strip()

        # Try to find matching paragraph confidence
        best_paragraph_confidence = None
        for para_text, confidence in paragraph_confidences.items():
            if cell_text in para_text or para_text in cell_text:
                best_paragraph_confidence = confidence
                break

        # If we found a paragraph match, use that confidence
        if best_paragraph_confidence is not None:
            logger.debug(f"🔍 Using paragraph confidence {best_paragraph_confidence} for cell '{cell_text[:20]}...'")
            return best_paragraph_confidence

        # Calculate synthetic confidence based on text quality indicators
        confidence_score = 0.7  # Base confidence for non-empty cells

        # Boost confidence for header-like text
        if any(indicator in cell_text.lower() for indicator in ['no.', 'name', 'id', 'description', 'status', 'category', 'type', 'unit']):
            confidence_score += 0.15

        # Boost confidence for well-formatted text
        if len(cell_text) >= 3 and cell_text.replace(' ', '').replace('-', '').replace('_', '').isalnum():
            confidence_score += 0.1

        # Reduce confidence for very short or suspicious text
        if len(cell_text) <= 2:
            confidence_score -= 0.2

        # Reduce confidence for text with many special characters
        special_char_ratio = sum(1 for c in cell_text if not c.isalnum() and c != ' ') / len(cell_text)
        if special_char_ratio > 0.3:
            confidence_score -= 0.15

        # Ensure confidence is in valid range
        confidence_score = max(0.0, min(1.0, confidence_score))

        logger.debug(f"🔍 Synthetic confidence {confidence_score} for cell '{cell_text[:20]}...'")
        return confidence_score

    def extract_table_from_image(self, image) -> Dict[str, any]:
        """
        Simple method to extract table data from a PIL Image
        Used for zone-based extraction

        Args:
            image: PIL Image object

        Returns:
            Dict with headers and rows
        """
        try:
            from io import BytesIO

            # Convert PIL Image to bytes
            buffer = BytesIO()
            image.save(buffer, format='PNG')
            image_bytes = buffer.getvalue()

            # Analyze with Azure
            logger.info("🔷 Azure OCR: begin analyze (prebuilt-layout) for zone image")
            poller = self.client.begin_analyze_document(
                model_id=self.config['ocr_model'],
                body=image_bytes,
                content_type="application/octet-stream"
            )

            result = poller.result()
            logger.info("🔷 Azure OCR: analysis completed")

            ruled_fallback = self._extract_ruled_table_from_ocr_words(result, image)

            # Extract tables
            if not result.tables or len(result.tables) == 0:
                logger.warning(f"No tables detected by Azure OCR. Tables found: {len(result.tables) if result.tables else 0}")
                if ruled_fallback.get('headers') and ruled_fallback.get('rows'):
                    logger.info(
                        "Using OCR ruled-grid fallback: headers=%s rows=%s",
                        len(ruled_fallback.get('headers', [])),
                        len(ruled_fallback.get('rows', [])),
                    )
                    return ruled_fallback
                logger.info(f"Attempting to extract as structured text instead...")

                # Fallback: Try to extract text line by line and treat as a simple table
                # This handles cases where Azure doesn't recognize table structure
                lines = []
                if result.paragraphs:
                    for para in result.paragraphs:
                        if para.content and para.content.strip():
                            lines.append(para.content.strip())

                if lines:
                    # Treat first line as headers, rest as data
                    # Try to split by common delimiters
                    first_line = lines[0]
                    logger.info(f"First line text: '{first_line}'")
                    logger.info(f"Total lines: {len(lines)}")

                    # Try tab, pipe, or multiple spaces as delimiters
                    if '\t' in first_line:
                        headers = [h.strip() for h in first_line.split('\t') if h.strip()]
                        rows = [[cell.strip() for cell in line.split('\t') if cell.strip()] for line in lines[1:]]
                    elif '|' in first_line:
                        headers = [h.strip() for h in first_line.split('|') if h.strip()]
                        rows = [[cell.strip() for cell in line.split('|') if cell.strip()] for line in lines[1:]]
                    else:
                        # Split by multiple spaces (2 or more)
                        import re
                        headers = [h for h in re.split(r'\s{2,}', first_line) if h.strip()]
                        rows = [[cell for cell in re.split(r'\s{2,}', line) if cell.strip()] for line in lines[1:]]

                    logger.info(f"📝 Fallback (text lines): headers={len(headers)} sample={headers[:8]} | rows={len(rows)}")
                    return {'headers': headers, 'rows': rows}

                return {'headers': [], 'rows': []}

            # Use first table
            table = result.tables[0]
            logger.info(f"📊 Azure tables detected: count={len(result.tables)} | first_table rc={table.row_count} cc={table.column_count}")

            # Build cell matrix
            cell_matrix = {}
            for cell in table.cells:
                row_idx = cell.row_index
                col_idx = cell.column_index

                if row_idx not in cell_matrix:
                    cell_matrix[row_idx] = {}

                cell_matrix[row_idx][col_idx] = cell.content or ''

            # Extract headers (assume first row)
            headers = []
            if 0 in cell_matrix:
                for col_idx in range(table.column_count):
                    headers.append(cell_matrix[0].get(col_idx, f'Column{col_idx+1}'))

            # Extract data rows
            rows = []
            for row_idx in range(1, table.row_count):
                if row_idx in cell_matrix:
                    row = []
                    for col_idx in range(table.column_count):
                        row.append(cell_matrix[row_idx].get(col_idx, ''))
                    rows.append(row)

            if ruled_fallback.get('headers') and ruled_fallback.get('rows') and len(ruled_fallback['headers']) > len(headers):
                logger.info(
                    "Replacing Azure table with OCR ruled-grid fallback: azure_cols=%s fallback_cols=%s fallback_rows=%s",
                    len(headers),
                    len(ruled_fallback['headers']),
                    len(ruled_fallback['rows']),
                )
                return ruled_fallback

            logger.info(f"📤 Azure table extraction: headers={len(headers)} sample={headers[:8]} | rows={len(rows)}")
            return {'headers': headers, 'rows': rows}

        except Exception as e:
            logger.error(f"Error extracting table from image: {e}")
            raise

    def _extract_ruled_table_from_ocr_words(self, result, image) -> Dict[str, any]:
        """
        Rebuild a scanned table from visible grid lines plus Azure OCR word boxes.

        Azure can read the text but still miss the table structure. The paragraph
        fallback flattens matrix BOMs into one value per row; this fallback keeps
        the visible cell grid and places words into cells by coordinates.
        """
        try:
            import bisect
            import re
            import cv2
            import numpy as np

            width, height = image.size
            if width < 40 or height < 40:
                return {'headers': [], 'rows': []}

            img = np.array(image.convert('RGB'))
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(12, width // 35), 1))
            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(12, height // 35)))
            horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
            vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=1)
            horizontal = cv2.dilate(horizontal, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1)), iterations=1)
            vertical = cv2.dilate(vertical, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3)), iterations=1)

            def line_positions(mask, axis, min_coverage):
                projection = (mask > 0).sum(axis=axis)
                candidate_indexes = np.where(projection >= min_coverage)[0].tolist()
                if not candidate_indexes:
                    return []
                groups = []
                current = [candidate_indexes[0]]
                for value in candidate_indexes[1:]:
                    if value <= current[-1] + 2:
                        current.append(value)
                    else:
                        groups.append(current)
                        current = [value]
                groups.append(current)
                return [int(round(sum(group) / len(group))) for group in groups]

            x_lines = line_positions(vertical, axis=0, min_coverage=max(10, int(height * 0.08)))
            y_lines = line_positions(horizontal, axis=1, min_coverage=max(10, int(width * 0.08)))

            def normalize_lines(lines, limit):
                if not lines:
                    return []
                lines = sorted(set(max(0, min(limit - 1, int(line))) for line in lines))
                if lines[0] > 8:
                    lines.insert(0, 0)
                if limit - 1 - lines[-1] > 8:
                    lines.append(limit - 1)
                cleaned = []
                for line in lines:
                    if not cleaned or line - cleaned[-1] >= 6:
                        cleaned.append(line)
                    else:
                        cleaned[-1] = int(round((cleaned[-1] + line) / 2))
                return cleaned

            x_lines = normalize_lines(x_lines, width)
            y_lines = normalize_lines(y_lines, height)
            if len(x_lines) < 3 or len(y_lines) < 3:
                return {'headers': [], 'rows': []}

            page = result.pages[0] if getattr(result, 'pages', None) else None
            words = getattr(page, 'words', []) if page else []
            if not words:
                return {'headers': [], 'rows': []}

            def point_xy(point):
                if hasattr(point, 'x') and hasattr(point, 'y'):
                    return float(point.x), float(point.y)
                if isinstance(point, dict):
                    return float(point.get('x', 0)), float(point.get('y', 0))
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    return float(point[0]), float(point[1])
                return 0.0, 0.0

            def polygon_points(polygon):
                if not polygon:
                    return []
                if (
                    isinstance(polygon, (list, tuple)) and
                    len(polygon) >= 4 and
                    all(isinstance(value, (int, float)) for value in polygon)
                ):
                    return [
                        (float(polygon[index]), float(polygon[index + 1]))
                        for index in range(0, len(polygon) - 1, 2)
                    ]
                return [point_xy(point) for point in polygon]

            raw_boxes = []
            max_x = 0.0
            max_y = 0.0
            for word in words:
                polygon = getattr(word, 'polygon', None) or getattr(word, 'bounding_polygon', None) or []
                points = polygon_points(polygon)
                if not points:
                    continue
                xs = [point[0] for point in points]
                ys = [point[1] for point in points]
                max_x = max(max_x, max(xs))
                max_y = max(max_y, max(ys))
                raw_boxes.append({
                    'text': getattr(word, 'content', '') or '',
                    'x0': min(xs),
                    'x1': max(xs),
                    'top': min(ys),
                    'bottom': max(ys),
                })

            if not raw_boxes:
                return {'headers': [], 'rows': []}

            scale_x = width / max_x if max_x and (max_x > width * 1.4 or max_x < width * 0.75) else 1.0
            scale_y = height / max_y if max_y and (max_y > height * 1.4 or max_y < height * 0.75) else 1.0
            n_rows = len(y_lines) - 1
            n_cols = len(x_lines) - 1
            cells = [[[] for _ in range(n_cols)] for _ in range(n_rows)]

            for box in raw_boxes:
                text = str(box['text']).strip()
                if not text:
                    continue
                cx = ((box['x0'] + box['x1']) / 2) * scale_x
                cy = ((box['top'] + box['bottom']) / 2) * scale_y
                if cx < x_lines[0] or cx > x_lines[-1] or cy < y_lines[0] or cy > y_lines[-1]:
                    continue
                col = bisect.bisect_right(x_lines, cx) - 1
                row = bisect.bisect_right(y_lines, cy) - 1
                if 0 <= row < n_rows and 0 <= col < n_cols:
                    cells[row][col].append((box['top'] * scale_y, box['x0'] * scale_x, text))

            table_rows = []
            for row in cells:
                values = []
                for cell_words in row:
                    ordered = sorted(cell_words, key=lambda item: (round(item[0] / 4), item[1]))
                    values.append(' '.join(item[2] for item in ordered).strip())
                if any(values):
                    table_rows.append(values)

            if len(table_rows) < 2:
                return {'headers': [], 'rows': []}

            # Crops often include a blank strip before/after the ruled table.
            # Remove columns that have no OCR text anywhere so those strips do
            # not become fake "Column_1"/"Column_N" fields.
            populated_columns = [
                col_index
                for col_index in range(n_cols)
                if any(
                    col_index < len(row) and str(row[col_index]).strip()
                    for row in table_rows
                )
            ]
            if len(populated_columns) >= 2 and len(populated_columns) < n_cols:
                table_rows = [
                    [row[col_index] if col_index < len(row) else '' for col_index in populated_columns]
                    for row in table_rows
                ]
                n_cols = len(populated_columns)

            non_empty_width = max(sum(1 for cell in row if str(cell).strip()) for row in table_rows)
            if non_empty_width < 2:
                return {'headers': [], 'rows': []}

            def header_score(row):
                lowered = ' '.join(str(cell).strip().lower() for cell in row if str(cell).strip())
                keyword_score = sum(
                    1 for keyword in ('part no', 'part', 'description', 'desc', 'find no', 'find')
                    if keyword in lowered
                )
                assembly_score = sum(
                    1 for cell in row
                    if re.fullmatch(r'\d{1,4}', str(cell).strip())
                )
                non_empty = sum(1 for cell in row if str(cell).strip())
                return (keyword_score * 4) + min(assembly_score, 6) + min(non_empty, 4)

            scored_rows = [(header_score(row), index, row) for index, row in enumerate(table_rows)]
            best_score, header_row_index, header_row = max(scored_rows, key=lambda item: item[0])
            first_row = table_rows[0]
            first_row_text = ' '.join(first_row).lower()
            first_row_looks_like_header = (
                any(keyword in first_row_text for keyword in ('part', 'description', 'desc', 'find')) or
                sum(1 for cell in first_row if re.fullmatch(r'\d{1,4}', str(cell).strip())) >= 2
            )

            if best_score >= 6 or first_row_looks_like_header:
                if best_score < 6:
                    header_row_index = 0
                    header_row = first_row

                headers = [
                    str(header_row[index]).strip() if index < len(header_row) and str(header_row[index]).strip() else f'Column_{index + 1}'
                    for index in range(n_cols)
                ]

                # Some engineering PDFs put the header block at the bottom of
                # the table. In that layout the useful data is above the
                # header, and the label rows below it are explanatory text.
                if header_row_index > 0:
                    data_rows = table_rows[:header_row_index]
                else:
                    data_rows = table_rows[1:]
            else:
                headers = [f'Column_{index + 1}' for index in range(n_cols)]
                data_rows = table_rows

            logger.info(
                "OCR ruled-grid fallback built table: rows=%s cols=%s x_lines=%s y_lines=%s header_row=%s",
                len(data_rows),
                len(headers),
                len(x_lines),
                len(y_lines),
                header_row_index if 'header_row_index' in locals() else None,
            )
            return {'headers': headers, 'rows': data_rows}
        except Exception as e:
            logger.warning(f"OCR ruled-grid fallback failed: {e}", exc_info=True)
            return {'headers': [], 'rows': []}
