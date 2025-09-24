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
    """Service for extracting tables from images using Azure Document Intelligence"""

    def __init__(self):
        self.endpoint = getattr(settings, 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT')
        self.key = getattr(settings, 'AZURE_DOCUMENT_INTELLIGENCE_KEY')

        if not self.endpoint or not self.key:
            raise ValueError("Azure Document Intelligence endpoint and key must be configured")

        self.client = DocumentIntelligenceClient(
            endpoint=self.endpoint,
            credential=AzureKeyCredential(self.key),
            api_version="2024-07-31-preview"
        )

        # Configuration
        self.config = getattr(settings, 'PDF_CONFIG', {
            'ocr_model': 'prebuilt-layout',
            'confidence_threshold': 0.7,
            'processing_timeout_seconds': 300,
        })

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

            if not result.tables:
                logger.warning("No tables found in document")
                return extraction_data

            extraction_data['table_count'] = len(result.tables)
            logger.info(f"Processing {len(result.tables)} tables")

            # Process each table
            for table_idx, table in enumerate(result.tables):
                table_data = self._extract_table_data(table, table_idx)
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

    def _extract_table_data(self, table, table_idx: int) -> Dict[str, any]:
        """
        Extract data from a single table

        Args:
            table: Table object from Azure result
            table_idx: Table index

        Returns:
            Dictionary with table data
        """
        try:
            # Initialize table structure
            table_data = {
                'table_id': f"table_{table_idx}",
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

                cell_matrix[row_idx][col_idx] = {
                    'content': cell.content or '',
                    'confidence': getattr(cell, 'confidence', 0.0),
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
                # Apply normalization per mode
                if alignment_mode == 'flatten':
                    table_headers = [_normalize_header_name(h) for h in table['headers']]
                else:
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
            if alignment_mode == 'flatten':
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
                    table_headers = [_normalize_header_name(h) for h in table['headers']]
                    logger.info(f"Flatten mode: processing table {table_idx + 1} with headers: {table_headers}")
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
