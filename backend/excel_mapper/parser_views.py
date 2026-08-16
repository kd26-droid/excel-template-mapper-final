"""
Column Parser Views - Separate module for parsing complex column data

This module handles extracting structured data from complex cell values like:
    "GCM155...(MURATA,M001),C0402C...(KEMET,M002),..."

Into Factwise-compatible format:
    Spec Name | Spec Value | Spec Value | Spec Name | Spec Value | Tag | Tag |
    MPN       | GCM155...  | C0402C...  | Manufacturer | MURATA | M001 | M002 |
"""

import os
import re
import logging
from pathlib import Path
import pandas as pd
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .views import (
    get_session,
    save_session,
    hybrid_file_manager,
    make_unique_field_headers,
    read_session_grid,
    write_session_grid,
)
from .delimited_reader import read_delimited_text_safely
from .models import PDFSession, PDFExtractionResult

logger = logging.getLogger(__name__)

STRUCTURED_STATUS_GROUP_SEPARATOR = '__structured_status_block__'


# =============================================================================
# CORE PARSING LOGIC
# =============================================================================

def split_by_separator(text, separator, trim_values=True, drop_empty=True):
    """
    Split text by separator, handling edge cases.

    For separator like '),' we need to be careful:
    - "A(B,C),D(E,F)" split by '),' → ["A(B,C)", "D(E,F)"]
    """
    if text is None or not separator:
        parts = [text] if text is not None else []
    elif separator == STRUCTURED_STATUS_GROUP_SEPARATOR:
        parts = split_structured_status_blocks(text)
    else:
        parts = str(text).split(separator)

    # Intermediate parts lose the closing bracket when this separator is used.
    if separator == '),' and len(parts) > 1:
        # Re-add ')' to all parts except the last
        parts = [p + ')' if i < len(parts) - 1 else p for i, p in enumerate(parts)]

    if trim_values:
        parts = [str(part).strip() for part in parts]
    else:
        parts = [str(part) for part in parts]
    return [part for part in parts if not drop_empty or part != '']


def split_structured_status_blocks(text):
    """
    Split repeated blocks shaped like:
      <part number> (<manufacturer>) {<status>} [<reference>]

    The separator is structural, not a literal character, so spaces inside MPN,
    manufacturer, status, or reference text are preserved.
    """
    raw = str(text or '')
    matches = list(re.finditer(r'\{[^}]*\}\s*\[[^\]]*\]', raw))
    if not matches:
        return [raw]

    groups = []
    start = 0
    for match in matches:
        end = match.end()
        group = raw[start:end].strip()
        if group:
            groups.append(group)
        start = end
        while start < len(raw) and raw[start].isspace():
            start += 1

    tail = raw[start:].strip()
    if tail:
        groups.append(tail)
    return groups or [raw]


def find_delimiter_occurrence(text, delimiter, occurrence=1, start=0):
    """Find the zero-based index for the requested delimiter occurrence."""
    if not delimiter:
        return -1
    try:
        occurrence = max(1, int(occurrence or 1))
    except (TypeError, ValueError):
        occurrence = 1

    index = start
    found_count = 0
    while True:
        found_index = text.find(delimiter, index)
        if found_index == -1:
            return -1
        found_count += 1
        if found_count == occurrence:
            return found_index
        index = found_index + len(delimiter)


def extract_part(text, extraction_type, char1='', char2='', trim_value=True, char1_occurrence=1, char2_occurrence=1):
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

    text = str(text)
    result = ''

    if extraction_type == 'before':
        if not char1:
            logger.warning(f"🔍 EXTRACT before: char1 is EMPTY!")
            return text
        idx = find_delimiter_occurrence(text, char1, char1_occurrence)
        if idx == -1:
            result = text  # char not found, return whole text
        else:
            result = text[:idx]
        logger.debug(f"🔍 EXTRACT before '{char1}': '{text[:30]}...' → '{result}'")

    elif extraction_type == 'after':
        if not char1:
            logger.warning(f"🔍 EXTRACT after: char1 is EMPTY!")
            return ''
        idx = find_delimiter_occurrence(text, char1, char1_occurrence)
        if idx == -1:
            result = ''  # char not found
        else:
            result = text[idx + len(char1):]
        logger.debug(f"🔍 EXTRACT after '{char1}': '{text[:30]}...' → '{result}'")

    elif extraction_type == 'between':
        if not char1:
            logger.warning(f"🔍 EXTRACT between: char1 is EMPTY!")
            return ''
        idx1 = find_delimiter_occurrence(text, char1, char1_occurrence)
        if idx1 == -1:
            result = ''
        else:
            # Find char2 AFTER char1
            idx2 = find_delimiter_occurrence(text, char2, char2_occurrence) if char2 else -1
            if idx2 != -1 and idx2 <= idx1:
                idx2 = text.find(char2, idx1 + len(char1))
            if idx2 == -1:
                # char2 not found, return everything after char1
                result = text[idx1 + len(char1):]
            else:
                result = text[idx1 + len(char1):idx2]
        logger.debug(f"🔍 EXTRACT between '{char1}' and '{char2}': '{text[:30]}...' → '{result}'")

    else:
        logger.warning(f"🔍 EXTRACT unknown type: {extraction_type}")
        result = text

    return result.strip() if trim_value else result


def normalize_extraction_rule(extraction):
    """Return a common extraction tuple for current and legacy rule shapes."""
    if 'type' in extraction:
        return extraction.get('type'), extraction.get('char1', ''), extraction.get('char2', '')

    start = extraction.get('start', 0)
    end = extraction.get('end', '')
    if start == 0 or start == '0':
        return 'before', str(end) if end else '', ''
    if end == '' or end is None or end == 'end':
        return 'after', str(start), ''
    return 'between', str(start), str(end)


def extraction_sort_key(extraction):
    try:
        return int(extraction.get('part_index') or 0)
    except (TypeError, ValueError):
        return 0


def append_extracted_value(result, extraction, value, drop_empty):
    """Append a parsed value using the same output routing as normal extraction."""
    if drop_empty and value == '':
        return

    output_type = extraction.get('output_type', 'spec')
    spec_name = extraction.get('spec_name', '')
    custom_name = str(extraction.get('custom_name') or '').strip()

    if output_type == 'discard':
        return
    if output_type == 'spec' and spec_name:
        result['spec'].setdefault(spec_name, []).append(value)
    elif output_type == 'tag':
        result['tag'].append(value)
    elif output_type == 'custom' and custom_name:
        result['custom'].setdefault(custom_name, []).append(value)
    elif output_type in ('direct', 'factwise'):
        target_column = str(extraction.get('target_column') or '').strip()
        if target_column:
            result['direct'].setdefault(target_column, []).append(value)


def is_final_parenthetical_structured_pattern(extractions, split_mode):
    """
    Detect the generic MPN/MFR/extra shape built by the Structured split UI.
    The row parser can then preserve MPN-internal parentheses and use the final
    parenthesized group before any trailing status/reference block as MFR.
    """
    if split_mode != 'pattern' or len(extractions) < 2:
        return False

    ordered = sorted(extractions, key=extraction_sort_key)
    second_type, second_char1, second_char2 = normalize_extraction_rule(ordered[1])
    first_type, _, _ = normalize_extraction_rule(ordered[0])
    if first_type != 'before':
        return False
    return second_type == 'between' and second_char1 == '(' and second_char2 == ')'


def parse_final_parenthetical_group(text, trim_values=True):
    """
    Parse:
      <MPN possibly containing parentheses> (<MFR>) {status} [ref]

    This is shape-based rather than value-based.
    """
    text = str(text or '')
    if trim_values:
        text = text.strip()

    extra = ''
    extra_match = re.search(r'\s*(\{[^}]*\}\s*\[[^\]]*\])\s*$', text)
    core = text
    if extra_match:
        extra = extra_match.group(1)
        core = text[:extra_match.start()]

    if trim_values:
        core = core.strip()
        extra = extra.strip()

    mfr = ''
    mfr_match = re.search(r'\s*\(([^()]*)\)\s*$', core)
    if mfr_match:
        mfr = mfr_match.group(1)
        mpn = core[:mfr_match.start()]
    else:
        mpn = core

    if trim_values:
        mpn = mpn.strip()
        mfr = mfr.strip()

    return [mpn, mfr, extra]


def parse_status_parenthetical_group(text, trim_values=True):
    """
    Parse Thales-like entries:
      <MPN>@<package> (<qualifier>) (<MFR>) {status} [ref]
      <MPN> (<MFR>) {status} [ref]

    Manual split points are chosen from one sample, but rows in the same column
    can omit @/qualifier text. Shape parsing keeps those rows from falling back
    to the full source string as MPN.
    """
    text = str(text or '')
    if trim_values:
        text = text.strip()

    extra = ''
    extra_match = re.search(r'\s*(\{[^}]*\}\s*\[[^\]]*\])\s*$', text)
    core = text
    if extra_match:
        extra = extra_match.group(1)
        core = text[:extra_match.start()]

    if trim_values:
        core = core.strip()
        extra = extra.strip()

    mfr = ''
    mfr_match = re.search(r'\s*\(([^()]*)\)\s*$', core)
    if mfr_match:
        mfr = mfr_match.group(1)
        mpn_side = core[:mfr_match.start()]
    else:
        mpn_side = core

    ignored_parts = []
    qualifier_match = re.search(r'\s*(\([^()]*\))\s*$', mpn_side)
    while qualifier_match:
        ignored_parts.insert(0, qualifier_match.group(1))
        mpn_side = mpn_side[:qualifier_match.start()]
        qualifier_match = re.search(r'\s*(\([^()]*\))\s*$', mpn_side)

    mpn = mpn_side
    if '@' in mpn_side and extra:
        at_index = mpn_side.find('@')
        package_text = mpn_side[at_index:]
        if package_text:
            ignored_parts.insert(0, package_text)
        mpn = mpn_side[:at_index]

    if trim_values:
        mpn = mpn.strip().rstrip(',').strip()
        mfr = mfr.strip()

    ignored = ' '.join([part for part in ignored_parts + ([extra] if extra else []) if part]).strip()
    return {'mpn': mpn, 'manufacturer': mfr, 'ignored': ignored}


def is_status_parenthetical_manual_split(pattern_config, extractions, split_mode):
    """Detect manual Parse Fields configs made from Thales structured blocks."""
    if split_mode != 'pattern':
        return False
    if pattern_config.get('group_separator') != STRUCTURED_STATUS_GROUP_SEPARATOR:
        return False

    has_mpn_output = False
    has_secondary_output = False
    has_at_boundary = False
    for extraction in extractions:
        ext_type, char1, char2 = normalize_extraction_rule(extraction)
        output_type = extraction.get('output_type', 'spec')
        target_column = str(extraction.get('target_column') or '').strip()
        if char1 == '@' or char2 == '@':
            has_at_boundary = True
        if output_type in ('direct', 'factwise') and target_column == 'MPN':
            has_mpn_output = True
            continue
        if output_type != 'discard':
            has_secondary_output = True

    return has_mpn_output and has_secondary_output and has_at_boundary


def append_status_parenthetical_values(result, extractions, parsed, drop_empty):
    """Route shape-parsed MPN/MFR values through the user's chosen outputs."""
    manufacturer_used = False
    ignored_used = False
    for extraction in sorted(extractions, key=extraction_sort_key):
        output_type = extraction.get('output_type', 'spec')
        target_column = str(extraction.get('target_column') or '').strip()
        if output_type == 'discard':
            continue

        value = ''
        if output_type in ('direct', 'factwise') and target_column == 'MPN':
            value = parsed.get('mpn', '')
        elif output_type in ('direct', 'factwise') and target_column == 'MFR':
            value = parsed.get('manufacturer', '')
            manufacturer_used = True
        elif not manufacturer_used:
            value = parsed.get('manufacturer', '')
            manufacturer_used = True
        elif not ignored_used:
            value = parsed.get('ignored', '')
            ignored_used = True

        append_extracted_value(result, extraction, value, drop_empty)


_parse_log_count = 0

def parse_cell_single_pattern(cell_value, pattern_config):
    """
    Parse a single cell using ONE pattern configuration.
    Returns parsed result or None if pattern doesn't match.
    """
    global _parse_log_count

    if not cell_value:
        return {'spec': {}, 'tag': [], 'custom': {}, 'direct': {}}

    trim_values = bool(pattern_config.get('trim_values', True))
    drop_empty = bool(pattern_config.get('drop_empty', True))
    cell_value = str(cell_value)
    if trim_values:
        cell_value = cell_value.strip()

    # Split into groups
    separator = pattern_config.get('group_separator', '')
    if separator:
        groups = split_by_separator(cell_value, separator, trim_values, drop_empty)
    else:
        groups = [cell_value]

    # Initialize result
    result = {'spec': {}, 'tag': [], 'custom': {}, 'direct': {}}

    extractions = pattern_config.get('extractions', [])
    split_mode = str(pattern_config.get('split_mode') or 'pattern')
    delimiter = str(pattern_config.get('delimiter') or '')
    try:
        chunk_size = max(1, int(pattern_config.get('chunk_size') or 1))
    except (TypeError, ValueError):
        chunk_size = 1

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

    if is_final_parenthetical_structured_pattern(extractions, split_mode):
        ordered_extractions = sorted(extractions, key=extraction_sort_key)
        for group in groups:
            values = parse_final_parenthetical_group(group, trim_values)
            for extraction, value in zip(ordered_extractions, values):
                append_extracted_value(result, extraction, value, drop_empty)
                if _parse_log_count <= 3:
                    logger.info(f"   â†’ Smart final-parenthetical extract: '{value[:30] if value else 'EMPTY'}'")

        if _parse_log_count <= 3:
                logger.info(f"   Result: specs={list(result['spec'].keys())}, tags={len(result['tag'])}, custom={list(result['custom'].keys())}, direct={list(result['direct'].keys())}")
        return result

    if is_status_parenthetical_manual_split(pattern_config, extractions, split_mode):
        for group in groups:
            parsed = parse_status_parenthetical_group(group, trim_values)
            append_status_parenthetical_values(result, extractions, parsed, drop_empty)
            if _parse_log_count <= 3:
                logger.info(
                    f"   → Smart status-parenthetical extract: "
                    f"mpn='{parsed.get('mpn', '')[:30]}', "
                    f"mfr='{parsed.get('manufacturer', '')[:30]}'"
                )

        if _parse_log_count <= 3:
            logger.info(f"   Result: specs={list(result['spec'].keys())}, tags={len(result['tag'])}, custom={list(result['custom'].keys())}, direct={list(result['direct'].keys())}")
        return result

    # Process each extraction for each group
    for extraction in extractions:
        # Support both current {type, char1, char2} and legacy {start, end}.
        ext_type, char1, char2 = normalize_extraction_rule(extraction)
        try:
            part_index = max(0, int(extraction.get('part_index') or 0))
        except (TypeError, ValueError):
            part_index = 0

        for group in groups:
            if split_mode == 'delimiter':
                values = str(group).split(delimiter) if delimiter else [str(group)]
                values = [value.strip() if trim_values else value for value in values]
                if drop_empty:
                    values = [value for value in values if value != '']
                value = values[part_index] if part_index < len(values) else ''
            elif split_mode == 'characters':
                text = str(group)
                values = [text[index:index + chunk_size] for index in range(0, len(text), chunk_size)]
                values = [value.strip() if trim_values else value for value in values]
                if drop_empty:
                    values = [value for value in values if value != '']
                value = values[part_index] if part_index < len(values) else ''
            else:
                value = extract_part(
                    group,
                    ext_type,
                    char1,
                    char2,
                    trim_values,
                    extraction.get('char1_occurrence', 1),
                    extraction.get('char2_occurrence', 1),
                )

            if drop_empty and value == '':
                continue

            if _parse_log_count <= 3:
                logger.info(f"   → Extracted: type={ext_type}, char1='{char1}', char2='{char2}' → '{value[:30] if value else 'EMPTY'}'")

            append_extracted_value(result, extraction, value, drop_empty)

    if _parse_log_count <= 3:
        logger.info(f"   Result: specs={list(result['spec'].keys())}, tags={len(result['tag'])}, custom={list(result['custom'].keys())}, direct={list(result['direct'].keys())}")

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
        return {'spec': {}, 'tag': [], 'custom': {}, 'direct': {}, 'matched_pattern': None}

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
    structured_status_blocks = re.findall(r'\{[^}]*\}\s*\[[^\]]*\]', s)
    has_paren_comma = '(' in s and ',' in s and ')' in s
    has_pipe = '|' in s
    has_semicolon = ';' in s

    if len(structured_status_blocks) >= 2:
        return ('structured_status_blocks', STRUCTURED_STATUS_GROUP_SEPARATOR)
    elif has_paren_comma:
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
    max_custom_counts = {}
    direct_outputs = []
    seen_direct_outputs = set()

    for row in data:
        cell_value = row[source_idx] if source_idx < len(row) else ''
        parsed = parse_cell(cell_value, parser_config)
        parsed_rows.append(parsed)

        # Update max counts
        for spec_name, values in parsed['spec'].items():
            current_max = max_spec_counts.get(spec_name, 0)
            max_spec_counts[spec_name] = max(current_max, len(values))

        max_tag_count = max(max_tag_count, len(parsed['tag']))
        for custom_name, values in parsed.get('custom', {}).items():
            max_custom_counts[custom_name] = max(max_custom_counts.get(custom_name, 0), len(values))

        for target_column in parsed.get('direct', {}).keys():
            if target_column and target_column not in seen_direct_outputs:
                seen_direct_outputs.add(target_column)
                direct_outputs.append(target_column)

    logger.info(f"   Parsed {len(parsed_rows)} rows")
    logger.info(f"   max_spec_counts: {max_spec_counts}")
    logger.info(f"   max_tag_count: {max_tag_count}")
    logger.info(f"   max_custom_counts: {max_custom_counts}")
    logger.info(f"   direct_outputs: {direct_outputs}")

    # Build output definitions once. Multiple delimiter parts aimed at one
    # specification belong to one pair, not one duplicated pair per part.
    spec_outputs = []
    seen_spec_outputs = set()
    for extraction in extractions:
        if extraction.get('output_type') != 'spec':
            continue
        name = str(extraction.get('spec_name') or '').strip()
        if not name or name not in max_spec_counts:
            continue
        try:
            requested_pair = int(extraction.get('spec_pair_index') or 0)
        except (TypeError, ValueError):
            requested_pair = 0
        include_name = extraction.get('include_spec_name', True) is not False
        key = (name, requested_pair, include_name)
        if key not in seen_spec_outputs:
            seen_spec_outputs.add(key)
            spec_outputs.append({
                'name': name,
                'pair_index': requested_pair,
                'include_name': include_name,
            })

    existing_tag_indexes = [
        int(match.group(1)) for header in headers
        for match in [re.match(r'^Tag_(\d+)$', str(header or ''))] if match
    ]
    if 'Tag' in headers:
        existing_tag_indexes.append(1)
    tag_start_index = max(existing_tag_indexes, default=0) + 1

    existing_spec_indexes = [
        int(match.group(1)) for header in headers
        for match in [re.match(r'^Specification_(?:Name|Value)_(\d+)(?:_|$)', str(header or ''))] if match
    ]
    if 'Specification name' in headers or 'Specification value' in headers:
        existing_spec_indexes.append(1)
    next_spec_index = max(existing_spec_indexes, default=0) + 1
    assigned_spec_indexes = set(existing_spec_indexes)
    for output in spec_outputs:
        if output['pair_index'] > 0:
            assigned_spec_indexes.add(output['pair_index'])
            continue
        while next_spec_index in assigned_spec_indexes:
            next_spec_index += 1
        output['pair_index'] = next_spec_index
        assigned_spec_indexes.add(next_spec_index)
        next_spec_index += 1

    # IMPORTANT: Headers must be unique for dict-based merge to work.
    new_headers = []
    for output in spec_outputs:
        name = output['name']
        pair_index = output['pair_index']
        value_count = max_spec_counts[name]
        if output['include_name']:
            new_headers.append(f'Specification_Name_{pair_index}')
        for i in range(value_count):
            value_suffix = f'_{i + 1}' if value_count > 1 or not output['include_name'] else ''
            new_headers.append(f'Specification_Value_{pair_index}{value_suffix}')

    custom_outputs = []
    seen_custom_outputs = set()
    for extraction in extractions:
        if extraction.get('output_type') != 'custom':
            continue
        name = str(extraction.get('custom_name') or '').strip()
        if name and name in max_custom_counts and name not in seen_custom_outputs:
            seen_custom_outputs.add(name)
            existing_indexes = []
            numbered_pattern = re.compile(rf'^{re.escape(name)}_(\d+)$', re.IGNORECASE)
            for header in headers:
                match = numbered_pattern.match(str(header or ''))
                if match:
                    existing_indexes.append(int(match.group(1)))
                elif str(header or '').lower() == name.lower():
                    existing_indexes.append(1)
            custom_outputs.append({
                'name': name,
                'start_index': max(existing_indexes, default=0) + 1,
            })

    for output in custom_outputs:
        for offset in range(max_custom_counts[output['name']]):
            new_headers.append(f"{output['name']}_{output['start_index'] + offset}")

    for target_column in direct_outputs:
        new_headers.append(target_column)

    for i in range(max_tag_count):
        new_headers.append(f'Tag_{tag_start_index + i}')

    logger.info(f"   New headers count: {len(new_headers)}")
    logger.info(f"   First 10 headers: {new_headers[:10]}")

    # Build new data
    new_data = []

    for parsed in parsed_rows:
        row_values = []

        for output in spec_outputs:
            name = output['name']
            if output['include_name']:
                row_values.append(name)
            values = parsed['spec'].get(name, [])
            for i in range(max_spec_counts[name]):
                row_values.append(values[i] if i < len(values) else '')

        for output in custom_outputs:
            values = parsed.get('custom', {}).get(output['name'], [])
            for i in range(max_custom_counts[output['name']]):
                row_values.append(values[i] if i < len(values) else '')

        for target_column in direct_outputs:
            values = [value for value in parsed.get('direct', {}).get(target_column, []) if value not in (None, '')]
            row_values.append(' | '.join(str(value) for value in values))

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
            'tags': max_tag_count,
            'custom': max_custom_counts,
            'direct': direct_outputs,
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

def get_parser_headers_and_data(info):
    """Read source data for Column Parser across Excel, CSV, and PDF/OCR sessions."""
    headers = info.get('client_headers', []) or []
    data = info.get('data', []) or []
    source_type = str(info.get('source_type', ''))
    is_pdf_session = source_type.startswith('pdf')

    if is_pdf_session:
        session_id = info.get('session_id')

        try:
            pdf_session = PDFSession.objects.get(session_id=session_id)
            pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
            if pdf_extraction:
                if pdf_extraction.extracted_headers:
                    headers = list(pdf_extraction.extracted_headers)
                if not data and pdf_extraction.extracted_data:
                    data = pdf_extraction.extracted_data
        except Exception as e:
            logger.warning(f"PARSER: Could not load PDF extraction data for {session_id}: {e}")

        client_path = info.get('client_path')
        if client_path:
            try:
                actual_path = hybrid_file_manager.get_file_path(client_path)
                if os.path.exists(str(actual_path)):
                    df = read_delimited_text_safely(str(actual_path), header=None, dtype=str, keep_default_na=False)
                    if headers:
                        if len(headers) < df.shape[1]:
                            headers = list(headers) + [f'Column_{i+1}' for i in range(len(headers), df.shape[1])]
                        df = df.iloc[:, :len(headers)]
                    else:
                        headers = [f'Column_{i+1}' for i in range(df.shape[1])]
                    data = df.values.tolist()
                    logger.info(f"PARSER: Read PDF/OCR data: {len(headers)} headers and {len(data)} rows")
            except Exception as e:
                logger.warning(f"PARSER: Could not read PDF/OCR CSV file; using extraction data if available: {e}")

        return headers, data

    client_path = info.get('client_path')
    if client_path and (not headers or not data):
        try:
            actual_path = hybrid_file_manager.get_file_path(client_path)
            actual_header_row = (info.get('header_row', 1) or 1) - 1
            ext = Path(str(actual_path)).suffix.lower()

            if ext == '.csv':
                df = read_delimited_text_safely(str(actual_path), header=actual_header_row, dtype=str, keep_default_na=False)
                headers = list(df.columns)
                data = df.values.tolist()
            else:
                headers, data = get_client_headers_and_data(info)
        except Exception as e:
            logger.error(f"PARSER: Error reading parser source data: {e}")

    return headers, data


def get_parser_destination_grid(session_id, info):
    """Return the mapped review grid using the same destination fields as the editor."""
    headers, rows = read_session_grid(session_id, info)
    if not headers or rows is None:
        return get_parser_headers_and_data(info)
    return make_unique_field_headers(headers), rows

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

    # Structured parsing runs on the mapped destination grid, just like the
    # delimiter-based Split into Columns tool.
    headers, data = get_parser_destination_grid(session_id, info)

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

    headers, data = get_parser_destination_grid(session_id, info)

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

    headers, data = get_parser_destination_grid(session_id, info)

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
    patterns = parser_config.get('patterns') or []
    active_pattern = patterns[0] if patterns else parser_config
    keep_source_column = active_pattern.get('keep_source_column', True) is not False
    source_removed = False

    if not keep_source_column:
        try:
            source_index = headers.index(source_column)
        except ValueError:
            return Response({
                'success': False,
                'error': f'Column "{source_column}" is not in the grid',
            })
        retained_headers = headers[:source_index] + headers[source_index + 1:]
        retained_rows = []
        for row in data:
            padded = list(row[:len(headers)]) + [''] * max(0, len(headers) - len(row))
            retained_rows.append(padded[:source_index] + padded[source_index + 1:])
        write_session_grid(session_id, info, retained_headers, retained_rows)
        source_removed = True

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
        'keep_source_column': keep_source_column,
        'applied': True
    }

    logger.info(f"📊 PARSER_APPLY: Stored {len(new_headers)} new parser columns for {len(new_data)} rows")

    save_session(session_id, info)

    return Response({
        'success': True,
        'new_headers_count': len(new_headers),
        'new_headers': new_headers,
        'new_data': new_data,
        'max_counts': result['max_counts'],
        'source_removed': source_removed,
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

    headers, _ = get_parser_destination_grid(session_id, info)
    logger.info(f"PARSER_GET_COLUMNS: Returning {len(headers)} columns")

    return Response({
        'success': True,
        'columns': headers
    })

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
