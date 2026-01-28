"""
Column Parser Views - Separate module for parsing complex column data

This module handles extracting structured data from complex cell values like:
    "GCM155...(MURATA,M001),C0402C...(KEMET,M002),..."

Into Factwise-compatible format:
    Spec Name | Spec Value | Spec Value | Spec Name | Spec Value | Tag | Tag |
    MPN       | GCM155...  | C0402C...  | Manufacturer | MURATA | M001 | M002 |
"""

import re
import logging
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .views import get_session, save_session, hybrid_file_manager
from .bom_header_mapper import BOMHeaderMapper

logger = logging.getLogger(__name__)


# =============================================================================
# CORE PARSING LOGIC
# =============================================================================

def split_by_separator(text, separator):
    """
    Split text by separator, handling edge cases.

    For separator like '),' we need to be careful:
    - "A(B,C),D(E,F)" split by '),' → ["A(B,C)", "D(E,F)"]
    """
    if not text or not separator:
        return [text] if text else []

    # Simple split, then clean up
    parts = text.split(separator)

    # If separator was '),' the last part won't have ')' stripped
    # But intermediate parts will be missing their closing ')'
    if separator == '),':
        # Re-add ')' to all parts except the last
        parts = [p + ')' if i < len(parts) - 1 else p for i, p in enumerate(parts)]

    return [p.strip() for p in parts if p.strip()]


def extract_part(text, extraction_type, char1='', char2=''):
    """
    Extract a part from text based on extraction type.

    extraction_type:
        - 'before': Everything before char1
        - 'after': Everything after char1
        - 'between': Everything between char1 and char2
    """
    if not text:
        logger.debug(f"🔍 EXTRACT: empty text")
        return ''

    text = str(text).strip()
    result = ''

    if extraction_type == 'before':
        if not char1:
            logger.warning(f"🔍 EXTRACT before: char1 is EMPTY!")
            return text
        idx = text.find(char1)
        if idx == -1:
            result = text  # char not found, return whole text
        else:
            result = text[:idx].strip()
        logger.debug(f"🔍 EXTRACT before '{char1}': '{text[:30]}...' → '{result}'")

    elif extraction_type == 'after':
        if not char1:
            logger.warning(f"🔍 EXTRACT after: char1 is EMPTY!")
            return ''
        idx = text.find(char1)
        if idx == -1:
            result = ''  # char not found
        else:
            result = text[idx + len(char1):].strip()
        logger.debug(f"🔍 EXTRACT after '{char1}': '{text[:30]}...' → '{result}'")

    elif extraction_type == 'between':
        if not char1:
            logger.warning(f"🔍 EXTRACT between: char1 is EMPTY!")
            return ''
        idx1 = text.find(char1)
        if idx1 == -1:
            result = ''
        else:
            # Find char2 AFTER char1
            idx2 = text.find(char2, idx1 + len(char1)) if char2 else -1
            if idx2 == -1:
                # char2 not found, return everything after char1
                result = text[idx1 + len(char1):].strip()
            else:
                result = text[idx1 + len(char1):idx2].strip()
        logger.debug(f"🔍 EXTRACT between '{char1}' and '{char2}': '{text[:30]}...' → '{result}'")

    else:
        logger.warning(f"🔍 EXTRACT unknown type: {extraction_type}")
        result = text

    return result


_parse_log_count = 0

def parse_cell_single_pattern(cell_value, pattern_config):
    """
    Parse a single cell using ONE pattern configuration.
    Returns parsed result or None if pattern doesn't match.
    """
    global _parse_log_count

    if not cell_value:
        return {'spec': {}, 'tag': []}

    cell_value = str(cell_value).strip()

    # Split into groups
    separator = pattern_config.get('group_separator', '')
    if separator:
        groups = split_by_separator(cell_value, separator)
    else:
        groups = [cell_value]

    # Initialize result
    result = {'spec': {}, 'tag': []}

    extractions = pattern_config.get('extractions', [])

    # Log first 3 cells in detail
    _parse_log_count += 1
    if _parse_log_count <= 3:
        logger.info(f"{'='*60}")
        logger.info(f"📊 PARSE_CELL #{_parse_log_count}")
        logger.info(f"   Cell value: {cell_value[:80]}...")
        logger.info(f"   Separator: '{separator}'")
        logger.info(f"   Groups found: {len(groups)}")
        logger.info(f"   First group: {groups[0][:50] if groups else 'NONE'}...")
        logger.info(f"   Extractions count: {len(extractions)}")
        for i, ext in enumerate(extractions):
            logger.info(f"   Extraction {i}: type={ext.get('type')}, char1='{ext.get('char1')}', char2='{ext.get('char2')}', output={ext.get('output_type')}, name={ext.get('spec_name')}")

    if not extractions:
        logger.error(f"❌ NO EXTRACTIONS DEFINED! pattern_config={pattern_config}")
        return result

    # Process each extraction for each group
    for extraction in extractions:
        # Support both formats:
        #   Backend format: {type, char1, char2}
        #   Frontend format: {start, end}
        if 'type' in extraction:
            ext_type = extraction['type']
            char1 = extraction.get('char1', '')
            char2 = extraction.get('char2', '')
        else:
            # Convert frontend format (start/end) to backend format
            start = extraction.get('start', 0)
            end = extraction.get('end', '')
            if start == 0 or start == '0':
                ext_type = 'before'
                char1 = str(end) if end else ''
                char2 = ''
            elif end == '' or end is None or end == 'end':
                ext_type = 'after'
                char1 = str(start)
                char2 = ''
            else:
                ext_type = 'between'
                char1 = str(start)
                char2 = str(end)
        output_type = extraction.get('output_type', 'spec')
        spec_name = extraction.get('spec_name', '')

        for group in groups:
            value = extract_part(group, ext_type, char1, char2)

            if _parse_log_count <= 3:
                logger.info(f"   → Extracted: type={ext_type}, char1='{char1}', char2='{char2}' → '{value[:30] if value else 'EMPTY'}'")

            if output_type == 'spec' and spec_name:
                if spec_name not in result['spec']:
                    result['spec'][spec_name] = []
                result['spec'][spec_name].append(value)
            elif output_type == 'tag':
                result['tag'].append(value)

    if _parse_log_count <= 3:
        logger.info(f"   Result: specs={list(result['spec'].keys())}, tags={len(result['tag'])}")

    return result


def pattern_matches(cell_value, pattern_config):
    """
    Check if a pattern matches the cell value.
    More lenient matching - returns True if ANY of the key delimiters are present.
    """
    if not cell_value:
        return False

    cell_value = str(cell_value).strip()

    # If no extractions defined, pattern doesn't match
    extractions = pattern_config.get('extractions', [])
    if not extractions:
        return False

    # Check if the FIRST extraction's delimiter exists (more lenient)
    first_ext = extractions[0]
    char1 = first_ext.get('char1', '')

    if char1 and char1 in cell_value:
        return True

    # Also check group separator
    separator = pattern_config.get('group_separator', '')
    if separator and separator in cell_value:
        return True

    return False


def parse_cell(cell_value, parser_config):
    """
    Parse a single cell using parser configuration.

    Supports MULTIPLE PATTERNS - tries each pattern in order until one matches.

    parser_config = {
        'patterns': [
            {
                'name': 'Standard MPN format',
                'group_separator': '),',
                'extractions': [
                    {'type': 'before', 'char1': '(', 'output_type': 'spec', 'spec_name': 'MPN'},
                    {'type': 'between', 'char1': '(', 'char2': ',', 'output_type': 'spec', 'spec_name': 'Manufacturer'},
                    {'type': 'between', 'char1': ',', 'char2': ')', 'output_type': 'tag'},
                ]
            },
            {
                'name': 'Simple comma-separated',
                'group_separator': ',',
                'extractions': [
                    {'type': 'before', 'char1': '', 'output_type': 'spec', 'spec_name': 'MPN'},
                ]
            }
        ],
        # Legacy single-pattern format (for backwards compatibility)
        'group_separator': '),',
        'extractions': [...]
    }

    Returns:
        {
            'spec': {
                'MPN': ['GCM155...', 'C0402C...', ...],
                'Manufacturer': ['MURATA', 'KEMET', ...],
            },
            'tag': ['M001', 'M002', ...],
            'matched_pattern': 'Standard MPN format'  # Which pattern matched
        }
    """
    if not cell_value:
        return {'spec': {}, 'tag': [], 'matched_pattern': None}

    cell_value = str(cell_value).strip()

    # Check if multi-pattern config
    patterns = parser_config.get('patterns', [])

    if patterns:
        # Just use the FIRST pattern - no matching check needed
        # The user defined the pattern, trust it
        pattern = patterns[0]
        result = parse_cell_single_pattern(cell_value, pattern)
        result['matched_pattern'] = pattern.get('name', 'User Pattern')
        return result

    else:
        # Legacy single-pattern format
        result = parse_cell_single_pattern(cell_value, parser_config)
        result['matched_pattern'] = 'default'
        return result


def detect_delimiter_pattern(value):
    """
    Detect the delimiter pattern type for a value.
    Returns a tuple of (pattern_type, suggested_separator)
    """
    if not value:
        return ('empty', '')

    s = str(value).strip()

    # Check for common patterns
    has_paren_comma = '(' in s and ',' in s and ')' in s
    has_pipe = '|' in s
    has_semicolon = ';' in s

    if has_paren_comma:
        if '),' in s:
            return ('paren_comma_repeat', '),')
        return ('paren_comma', '')
    elif has_pipe:
        return ('pipe', '|')
    elif has_semicolon:
        return ('semicolon', ';')
    elif ',' in s:
        return ('comma', ',')
    else:
        return ('simple', '')


def analyze_column(data, column_index, sample_size=10):
    """
    Analyze ENTIRE column to detect ALL unique patterns.

    Returns:
        {
            'sample_values': [...],  # ALL non-empty values (up to sample_size)
            'total_values': int,  # Total non-empty values in column
            'patterns': [  # Unique patterns detected
                {
                    'type': 'paren_comma_repeat',
                    'count': 45,
                    'suggested_separator': '),'
                    'examples': ['MPN(MFR,CODE),MPN(MFR,CODE)', ...]
                },
                ...
            ],
            'has_parentheses': bool,
            'has_commas': bool,
            'suggested_separator': str,
            'detected_groups_count': int,
        }
    """
    all_values = []
    pattern_groups = {}  # {pattern_type: {'count': N, 'separator': str, 'examples': [...]}}

    # Analyze ALL rows
    for row in data:
        if column_index < len(row) and row[column_index]:
            val = str(row[column_index]).strip()
            if val:
                all_values.append(val)

                # Detect pattern
                pattern_type, separator = detect_delimiter_pattern(val)

                if pattern_type not in pattern_groups:
                    pattern_groups[pattern_type] = {
                        'type': pattern_type,
                        'count': 0,
                        'suggested_separator': separator,
                        'examples': []
                    }

                pattern_groups[pattern_type]['count'] += 1
                if len(pattern_groups[pattern_type]['examples']) < 3:
                    pattern_groups[pattern_type]['examples'].append(val)

    if not all_values:
        return {
            'sample_values': [],
            'total_values': 0,
            'patterns': [],
            'has_parentheses': False,
            'has_commas': False,
            'suggested_separator': '',
            'detected_groups_count': 0,
        }

    # Convert pattern_groups to list, sorted by count
    patterns = list(pattern_groups.values())
    patterns.sort(key=lambda x: x['count'], reverse=True)

    # Filter out 'empty' and 'simple' patterns
    patterns = [p for p in patterns if p['type'] not in ('empty', 'simple')]

    # Get sample values (most common pattern's examples first)
    sample_values = all_values[:sample_size]

    # Analyze first sample for legacy compatibility
    first = all_values[0] if all_values else ''
    has_parens = '(' in first and ')' in first
    has_commas = ',' in first

    # Use most common pattern's separator
    suggested = patterns[0]['suggested_separator'] if patterns else ''
    groups_count = 1
    if suggested and first:
        groups_count = first.count(suggested) + 1

    # Find COMMON delimiters that appear in ALL values
    # These are the safe ones to use as boundaries
    common_delimiters = set()
    potential_delims = ['(', ')', ',', '|', ';', ':', '[', ']', '{', '}']

    for delim in potential_delims:
        # Check if this delimiter appears in ALL non-empty values
        appears_in_all = True
        for val in all_values[:50]:  # Check first 50 values
            if delim not in str(val):
                appears_in_all = False
                break
        if appears_in_all:
            common_delimiters.add(delim)

    logger.info(f"📊 ANALYZE: Common delimiters found in ALL values: {common_delimiters}")

    return {
        'sample_values': sample_values,
        'total_values': len(all_values),
        'patterns': patterns,
        'has_parentheses': has_parens,
        'has_commas': has_commas,
        'suggested_separator': suggested,
        'detected_groups_count': groups_count,
        'common_delimiters': list(common_delimiters),  # Only these should be highlighted!
    }


def apply_parser_to_data(data, headers, source_column, parser_config):
    """
    Apply parser to all rows and generate new columns.

    Returns:
        {
            'new_headers': [...],  # New headers to add
            'new_data': [...],     # New column values for each row
            'max_counts': {'MPN': 15, 'Manufacturer': 15, 'tags': 17}
        }
    """
    logger.info(f"📊 APPLY_PARSER_TO_DATA called")
    logger.info(f"   source_column: {source_column}")
    logger.info(f"   parser_config: {parser_config}")

    # Find source column index
    source_idx = None
    for i, h in enumerate(headers):
        if h == source_column:
            source_idx = i
            break

    if source_idx is None:
        logger.error(f"❌ Column '{source_column}' not found in headers: {headers[:5]}...")
        return {'error': f'Column "{source_column}" not found'}

    logger.info(f"   Found column at index: {source_idx}")

    # Get extractions from the correct place
    # Config can be: {patterns: [{extractions: [...]}]} or {extractions: [...]}
    patterns = parser_config.get('patterns', [])
    if patterns:
        extractions = patterns[0].get('extractions', [])
    else:
        extractions = parser_config.get('extractions', [])

    logger.info(f"   Extractions found: {len(extractions)}")
    for i, ext in enumerate(extractions):
        logger.info(f"   Extraction {i}: {ext}")

    if not extractions:
        logger.error("❌ NO EXTRACTIONS FOUND!")
        return {'error': 'No extractions defined in parser config'}

    # First pass: parse all cells and find max counts
    parsed_rows = []
    max_spec_counts = {}  # {spec_name: max_count}
    max_tag_count = 0

    for row in data:
        cell_value = row[source_idx] if source_idx < len(row) else ''
        parsed = parse_cell(cell_value, parser_config)
        parsed_rows.append(parsed)

        # Update max counts
        for spec_name, values in parsed['spec'].items():
            current_max = max_spec_counts.get(spec_name, 0)
            max_spec_counts[spec_name] = max(current_max, len(values))

        max_tag_count = max(max_tag_count, len(parsed['tag']))

    logger.info(f"   Parsed {len(parsed_rows)} rows")
    logger.info(f"   max_spec_counts: {max_spec_counts}")
    logger.info(f"   max_tag_count: {max_tag_count}")

    # Build new headers based on max counts
    # IMPORTANT: Headers must be UNIQUE for dict-based merge to work!
    new_headers = []
    spec_index = 0

    # For each spec type: Spec Name, Spec Value 1, Spec Value 2, ...
    for extraction in extractions:
        if extraction.get('output_type') == 'spec':
            name = extraction.get('spec_name', '')
            if name and name in max_spec_counts:
                spec_index += 1
                # Use unique header names with the spec name and index
                new_headers.append(f'Specification_Name_{spec_index}')  # e.g., Specification_Name_1
                for i in range(max_spec_counts[name]):
                    new_headers.append(f'Specification_Value_{spec_index}_{i+1}')  # e.g., Specification_Value_1_1

    # Tags - also make unique
    for i in range(max_tag_count):
        new_headers.append(f'Tag_{i+1}')

    logger.info(f"   New headers count: {len(new_headers)}")
    logger.info(f"   First 10 headers: {new_headers[:10]}")

    # Build new data
    new_data = []

    for parsed in parsed_rows:
        row_values = []

        # Add spec values in order (use the extractions variable we defined above)
        for extraction in extractions:
            if extraction.get('output_type') == 'spec':
                name = extraction.get('spec_name', '')
                if name and name in max_spec_counts:
                    # Add the spec name
                    row_values.append(name)

                    # Add values, padding with empty strings
                    values = parsed['spec'].get(name, [])
                    for i in range(max_spec_counts[name]):
                        if i < len(values):
                            row_values.append(values[i])
                        else:
                            row_values.append('')

        # Add tags
        tags = parsed['tag']
        for i in range(max_tag_count):
            if i < len(tags):
                row_values.append(tags[i])
            else:
                row_values.append('')

        new_data.append(row_values)

    logger.info(f"   Generated {len(new_data)} rows with {len(new_headers)} columns each")

    return {
        'new_headers': new_headers,
        'new_data': new_data,
        'max_counts': {
            'specs': max_spec_counts,
            'tags': max_tag_count
        }
    }


# =============================================================================
# HELPER FUNCTION TO READ DATA FROM FILE
# =============================================================================

def get_client_headers_and_data(info):
    """
    Get headers and data from the client file.

    Returns:
        (headers, data) tuple
    """
    headers = info.get('client_headers', [])
    data = info.get('data', [])

    # If not in session, read from file
    if not headers or not data:
        client_path = info.get('client_path')
        sheet_name = info.get('sheet_name')
        header_row = info.get('header_row', 1)

        if client_path:
            try:
                import openpyxl

                actual_path = hybrid_file_manager.get_file_path(client_path)
                actual_header_row = header_row - 1 if header_row > 0 else 0

                # Read with openpyxl
                wb = openpyxl.load_workbook(actual_path, data_only=True, read_only=True)

                # Get sheet
                if sheet_name:
                    ws = wb[sheet_name]
                else:
                    ws = wb.active

                # Read all rows
                all_rows = list(ws.iter_rows(values_only=True))

                if len(all_rows) > actual_header_row:
                    headers = list(all_rows[actual_header_row])
                    # Clean up None headers
                    headers = [h if h is not None else f'Column_{i}' for i, h in enumerate(headers)]
                    data = [list(row) for row in all_rows[actual_header_row + 1:]]

                wb.close()
                logger.info(f"📊 PARSER: Read {len(headers)} headers and {len(data)} rows from file")

            except Exception as e:
                logger.error(f"📊 PARSER: Error reading file: {e}")

    return headers, data


# =============================================================================
# API ENDPOINTS
# =============================================================================

@api_view(['POST'])
def parser_analyze_column(request):
    """
    Analyze a column to detect patterns.

    Request:
        {
            'session_id': str,
            'column_name': str
        }

    Response:
        {
            'success': bool,
            'sample_values': [...],
            'suggested_separator': str,
            'detected_groups_count': int,
            ...
        }
    """
    session_id = request.data.get('session_id')
    column_name = request.data.get('column_name')

    if not session_id or not column_name:
        return Response({'success': False, 'error': 'Missing session_id or column_name'})

    info = get_session(session_id)
    if not info:
        return Response({'success': False, 'error': 'Session not found'})

    # Get data and headers from file
    headers, data = get_client_headers_and_data(info)

    if not headers:
        return Response({'success': False, 'error': 'Could not read headers from file'})

    # Find column index
    column_idx = None
    for i, h in enumerate(headers):
        if h == column_name:
            column_idx = i
            break

    if column_idx is None:
        return Response({'success': False, 'error': f'Column "{column_name}" not found'})

    # Analyze
    analysis = analyze_column(data, column_idx)
    analysis['success'] = True
    analysis['column_name'] = column_name

    return Response(analysis)


@api_view(['POST'])
def parser_preview(request):
    """
    Preview parsing results without applying.
    """
    global _parse_log_count
    _parse_log_count = 0  # Reset log counter

    session_id = request.data.get('session_id')
    source_column = request.data.get('source_column')
    parser_config = request.data.get('parser_config', {})
    preview_rows = request.data.get('preview_rows', 5)

    logger.info(f"{'='*80}")
    logger.info(f"🚀 PARSER_PREVIEW called")
    logger.info(f"   session_id: {session_id}")
    logger.info(f"   source_column: {source_column}")
    logger.info(f"   parser_config: {parser_config}")
    logger.info(f"{'='*80}")

    if not session_id or not source_column:
        logger.error("❌ Missing required parameters")
        return Response({'success': False, 'error': 'Missing required parameters'})

    info = get_session(session_id)
    if not info:
        logger.error("❌ Session not found")
        return Response({'success': False, 'error': 'Session not found'})

    # Get data and headers from file
    headers, data = get_client_headers_and_data(info)

    if not headers:
        return Response({'success': False, 'error': 'Could not read data from file'})

    # Apply parser to ALL data to get accurate max counts
    result = apply_parser_to_data(data, headers, source_column, parser_config)

    if 'error' in result:
        return Response({'success': False, 'error': result['error']})

    # Return only preview rows
    preview_data = result['new_data'][:preview_rows]

    return Response({
        'success': True,
        'preview_headers': result['new_headers'],
        'preview_data': preview_data,
        'max_counts': result['max_counts'],
        'total_rows': len(data)
    })


@api_view(['POST'])
def parser_apply(request):
    """
    Apply parser and add new columns to session data.

    Request:
        {
            'session_id': str,
            'source_column': str,
            'parser_config': {...}
        }

    Response:
        {
            'success': bool,
            'new_headers_count': int,
            'message': str
        }
    """
    session_id = request.data.get('session_id')
    source_column = request.data.get('source_column')
    parser_config = request.data.get('parser_config', {})

    if not session_id or not source_column:
        return Response({'success': False, 'error': 'Missing required parameters'})

    info = get_session(session_id)
    if not info:
        return Response({'success': False, 'error': 'Session not found'})

    # Get data and headers from file
    headers, data = get_client_headers_and_data(info)

    if not headers:
        return Response({'success': False, 'error': 'Could not read data from file'})

    # Apply parser
    result = apply_parser_to_data(data, headers, source_column, parser_config)

    if 'error' in result:
        return Response({'success': False, 'error': result['error']})

    # =========================================================================
    # STORE PARSER COLUMNS SEPARATELY (don't corrupt existing data)
    # =========================================================================

    new_headers = result['new_headers']
    new_data = result['new_data']

    # Store parser columns separately - data_view will merge them
    info['parser_columns'] = {
        'headers': new_headers,
        'data': new_data,  # List of lists, one per row
        'source_column': source_column,
        'max_counts': result['max_counts']
    }

    # Store parser metadata for reference
    info['parser_result'] = {
        'source_column': source_column,
        'parser_config': parser_config,
        'new_headers': new_headers,
        'max_counts': result['max_counts'],
        'applied': True
    }

    logger.info(f"📊 PARSER_APPLY: Stored {len(new_headers)} new parser columns for {len(new_data)} rows")

    save_session(session_id, info)

    return Response({
        'success': True,
        'new_headers_count': len(new_headers),
        'max_counts': result['max_counts'],
        'message': f'Parser applied. Added {len(new_headers)} new columns.'
    })


@api_view(['GET'])
def parser_get_columns(request, session_id):
    """
    Get list of columns available for parsing.

    Response:
        {
            'success': bool,
            'columns': [...]
        }
    """
    info = get_session(session_id)
    if not info:
        return Response({'success': False, 'error': 'Session not found'})

    # Try to get headers from session first
    headers = info.get('client_headers', [])

    # If not in session, read from file
    if not headers:
        client_path = info.get('client_path')
        sheet_name = info.get('sheet_name')
        header_row = info.get('header_row', 1)

        if client_path:
            try:
                mapper = BOMHeaderMapper()
                # Resolve the actual file path and convert header_row to 0-indexed
                actual_path = hybrid_file_manager.get_file_path(client_path)
                actual_header_row = header_row - 1 if header_row > 0 else 0

                headers = mapper.read_excel_headers(
                    file_path=actual_path,
                    sheet_name=sheet_name,
                    header_row=actual_header_row
                )
                logger.info(f"📊 PARSER_GET_COLUMNS: Read {len(headers)} headers from file (header_row={actual_header_row})")
            except Exception as e:
                logger.error(f"📊 PARSER_GET_COLUMNS: Error reading headers: {e}")
                headers = []

    logger.info(f"📊 PARSER_GET_COLUMNS: Returning {len(headers)} columns")

    return Response({
        'success': True,
        'columns': headers
    })


# =============================================================================
# STANDALONE TEST FUNCTION (for testing without API)
# =============================================================================

def test_parser_standalone(excel_path, column_name, parser_config):
    """
    Test parser on an Excel file without needing the full app running.

    Usage:
        from excel_mapper.parser_views import test_parser_standalone

        result = test_parser_standalone(
            '/path/to/file.xlsx',
            'Vendor Parts',
            {
                'group_separator': '),',
                'extractions': [
                    {'type': 'before', 'char1': '(', 'output_type': 'spec', 'spec_name': 'MPN'},
                    {'type': 'between', 'char1': '(', 'char2': ',', 'output_type': 'spec', 'spec_name': 'Manufacturer'},
                    {'type': 'between', 'char1': ',', 'char2': ')', 'output_type': 'tag'},
                ]
            }
        )
    """
    import openpyxl

    # Load Excel
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb.active

    # Get headers from first row
    headers = [cell.value for cell in ws[1]]

    # Get data from remaining rows
    data = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        data.append(list(row))

    # Find column index
    column_idx = None
    for i, h in enumerate(headers):
        if h == column_name:
            column_idx = i
            break

    if column_idx is None:
        return {'error': f'Column "{column_name}" not found. Available: {headers}'}

    # Analyze
    analysis = analyze_column(data, column_idx)

    # Apply parser
    result = apply_parser_to_data(data, headers, column_name, parser_config)

    return {
        'analysis': analysis,
        'result': result
    }
