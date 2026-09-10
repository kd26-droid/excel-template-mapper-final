"""
Working views for Excel Template Mapper application.
Optimized for smooth Excel to Excel mapping functionality.
"""

import os
import uuid
import logging
import csv
import math
from pathlib import Path
from datetime import datetime, timedelta, timezone as datetime_timezone
from typing import Dict, Any, Optional
import unicodedata

import pandas as pd
from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError
from django.http import FileResponse, Http404, JsonResponse, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView
from django.views.decorators.cache import never_cache
from openpyxl import Workbook
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill
import numpy as np
from collections import defaultdict, Counter
import re
import traceback
import json
import tempfile
import shutil

from .delimited_reader import (
    ENCODINGS_TO_TRY,
    dataframe_from_delimited_text,
    read_delimited_text_safely,
)
from .bom_header_mapper import BOMHeaderMapper
from .services.bom_directory_learning import learn_confirmed_bom_field_patterns
from .services.bom_role_inference import (
    ROLE_KEYS,
    build_bom_field_pattern_groups,
    build_bom_field_pattern_teach_result,
    infer_bom_roles,
    normalize_bom_rows,
    save_bom_field_pattern_rule,
)
from .services.bom_structure_patterns import build_structure_profile, match_bom_structures
from .default_template import (
    get_sfo_template_metadata,
    get_sfo_template_path,
    get_sfo_reference_headers,
    get_sfo_reference_optional_map,
    SFO_TEMPLATE_NAME,
)
from .models import MappingTemplate, TagTemplate, ColumnRule, PDFSession, PDFExtractionResult, Project
from .editor_defaults import apply_editor_defaults_to_rows, get_editor_defaults_for_entity
try:
    # Prefer relative import; fall back gracefully on any import error
    from .azure_storage import hybrid_file_manager
except Exception:
    # Fallback to local file manager if azure_storage is not available
    import os
    import uuid
    from pathlib import Path
    from typing import Tuple
    
    class LocalFileManager:
        def __init__(self):
            # SESSION_DATA_ROOT lets deployments put uploads + session files on a
            # persistent volume (e.g. Azure App Service's /home) so they survive
            # redeploys. Defaults to the app dir (ephemeral) for local/dev.
            import os as _os
            _root = Path(_os.environ.get('SESSION_DATA_ROOT') or settings.BASE_DIR)
            self.local_upload_dir = _root / 'uploaded_files'
            self.local_temp_dir = _root / 'temp_downloads'
            self._ensure_local_directories()
        
        def _ensure_local_directories(self):
            self.local_upload_dir.mkdir(parents=True, exist_ok=True)
            self.local_temp_dir.mkdir(parents=True, exist_ok=True)
        
        def save_upload_file(self, file, prefix="upload") -> Tuple[str, str]:
            file_extension = Path(file.name).suffix
            unique_filename = f"{uuid.uuid4()}_{prefix}{file_extension}"
            local_file_path = self.local_upload_dir / unique_filename
            
            with open(local_file_path, 'wb+') as destination:
                for chunk in file.chunks():
                    destination.write(chunk)
            
            return str(local_file_path), file.name
        
        def get_file_path(self, file_identifier: str) -> str:
            return file_identifier
    
    hybrid_file_manager = LocalFileManager()

# Configure logging
logger = logging.getLogger(__name__)

# === Canonicalizer for header labels ===
def _canon(s: str) -> str:
    """
    Canonicalize header strings for consistent comparison.
    Handles NBSP, whitespace, case differences, and punctuation variations.
    """
    return (
        str(s or "")
        .replace("\u00a0", " ")  # Replace non-breaking space with regular space
        .replace("\r", " ")      # Replace carriage return with space
        .replace("\n", " ")      # Replace newline with space
        .strip()                 # Remove leading/trailing whitespace
        .lower()                 # Convert to lowercase
        .replace(" ", "")        # Remove all spaces
        .replace("_", "")        # Remove underscores
        .replace("-", "")        # Remove hyphens
    )


def _spec_pair_key(header: str, kind: str) -> Optional[str]:
    raw = str(header or "").strip()
    internal_match = re.match(rf"^specification_{kind}_(\d+)$", raw, re.IGNORECASE)
    if internal_match:
        return f"internal_{internal_match.group(1)}"

    external_match = re.match(rf"^specification\s+{kind}(?:\.(\d+))?$", raw, re.IGNORECASE)
    if external_match:
        return f"external_{external_match.group(1) or 'base'}"

    normalized = re.sub(r"[^a-z0-9]+", " ", str(header or "").lower()).strip()
    match = re.match(rf"^specification {kind}(?: (\d+))?$", normalized)
    if match:
        return f"normalized_{match.group(1) or 'base'}"
    return None


def _is_blank_cell(value) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    text = str(value).strip()
    return text == "" or text.lower() in {"nan", "none", "null"}


def _clean_text(value) -> str:
    if _is_blank_cell(value):
        return ""
    return str(value).replace("\u00a0", " ").strip()


def _norm_loose(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _clean_text(value).lower()).strip()


def _looks_like_repeated_header_row(row, columns) -> bool:
    values = [_norm_loose(v) for v in row.tolist() if _clean_text(v)]
    if len(values) < 2:
        return False
    header_keys = {_norm_loose(c) for c in columns if _clean_text(c)}
    if not header_keys:
        return False
    matches = sum(1 for value in values if value in header_keys)
    return matches >= max(2, int(len(values) * 0.6 + 0.999))


def _looks_like_section_title_row(row) -> bool:
    values = [_clean_text(v) for v in row.tolist() if _clean_text(v)]
    if not values:
        return True
    if len(values) != 1:
        return False

    text = values[0]
    compact = re.sub(r"[^A-Za-z0-9]", "", text)
    if len(compact) > 40:
        return False
    has_letters = bool(re.search(r"[A-Za-z]", text))
    looks_like_title = text == text.upper() or len(compact) <= 28
    looks_like_part = bool(re.search(r"[A-Za-z]+\d|\d+[A-Za-z]", text))
    return has_letters and looks_like_title and not looks_like_part


def drop_non_data_rows(df: pd.DataFrame, context: str = "") -> pd.DataFrame:
    """Drop visual BOM separators: blank rows, repeated headers, and one-cell section titles."""
    if df is None or df.empty:
        return df

    keep_indices = []
    dropped_blank = 0
    dropped_header = 0
    dropped_title = 0

    for index, row in df.iterrows():
        values = [_clean_text(v) for v in row.tolist()]
        if not any(values):
            dropped_blank += 1
            continue
        if _looks_like_repeated_header_row(row, df.columns):
            dropped_header += 1
            continue
        if _looks_like_section_title_row(row):
            dropped_title += 1
            continue
        keep_indices.append(index)

    if len(keep_indices) == len(df):
        return df

    logger.info(
        "Dropped %s non-data row(s)%s: blank=%s, repeated_header=%s, section_title=%s",
        len(df) - len(keep_indices),
        f" in {context}" if context else "",
        dropped_blank,
        dropped_header,
        dropped_title,
    )
    return df.loc[keep_indices].reset_index(drop=True)


def cleanup_empty_spec_pairs(headers: list, rows: list) -> int:
    """Deliberately does nothing. The grid is exported exactly as it stands.

    This used to clear `Specification name` whenever the paired
    `Specification value` was blank, and it ran on every session save as well as
    on export. A name typed without a value yet was therefore wiped moments
    later, with nothing to show the user why.

    Specification (name/value/UOM) and custom identification (name/value) are
    written as whole groups even when parts are empty, so a half-filled group is
    a normal in-progress state, not something to repair. The user may complete it
    in the exported sheet, so the export must preserve what they entered rather
    than second-guess it.

    Kept as a no-op instead of deleting the call sites, so any future caller
    inherits the same behaviour.
    """
    return 0

def _headers_from_rows(rows, fallback_headers=None):
    if fallback_headers:
        return list(fallback_headers)
    if isinstance(rows, list) and rows:
        first = rows[0]
        if isinstance(first, dict):
            return list(first.keys())
    return []


def enforce_empty_spec_pair_rule(session_data: dict) -> int:
    """Apply spec-pair cleanup to every saved row snapshot in the session."""
    if not isinstance(session_data, dict):
        return 0

    cleaned = 0
    fallback_headers = (
        session_data.get("enhanced_headers")
        or session_data.get("current_template_headers")
        or session_data.get("template_headers")
        or []
    )

    for key in ("edited_data", "formula_enhanced_data", "mapped_data"):
        rows = session_data.get(key)
        if isinstance(rows, list):
            cleaned += cleanup_empty_spec_pairs(_headers_from_rows(rows, fallback_headers), rows)

    enhanced_data = session_data.get("enhanced_data")
    if isinstance(enhanced_data, dict):
        headers = enhanced_data.get("headers") or fallback_headers
        rows = enhanced_data.get("data") or enhanced_data.get("rows")
        if isinstance(rows, list):
            cleaned += cleanup_empty_spec_pairs(headers, rows)
    elif isinstance(enhanced_data, list):
        cleaned += cleanup_empty_spec_pairs(_headers_from_rows(enhanced_data, fallback_headers), enhanced_data)

    return cleaned

def read_csv_with_encoding(file_path, header_row, **kwargs):
    """
    Helper function to read CSV files with proper encoding detection.
    Tries multiple encodings to handle various CSV formats.
    """
    return read_delimited_text_safely(file_path, header=header_row, **kwargs)


def _looks_like_delimited_text_file(file_path) -> bool:
    try:
        with open(file_path, 'rb') as handle:
            sample = handle.read(4096)
        if not sample:
            return False
        # Real XLS/XLSX files start with binary/OLE/ZIP signatures. Supplier
        # exports often use .xls for plain tab-delimited text.
        if sample.startswith(b'\xD0\xCF\x11\xE0') or sample.startswith(b'PK\x03\x04'):
            return False
        return b'\t' in sample or b',' in sample or b';' in sample
    except Exception:
        return False


def read_spreadsheet_or_delimited(file_path, sheet_name=None, header=0, **kwargs):
    path_text = str(file_path).lower()
    if path_text.endswith('.csv') or _looks_like_delimited_text_file(file_path):
        return read_csv_with_encoding(
            file_path,
            header,
            sep=None,
            engine='python',
            **kwargs
        )
    return pd.read_excel(file_path, sheet_name=sheet_name, header=header, **kwargs)


PACKED_CELL_DELIMITERS = ('\t', ';', '|', ',')


def _cell_as_upload_text(value) -> str:
    if _is_blank_cell(value):
        return ''
    return str(value).replace('\u00a0', ' ').strip()


def _split_packed_cell(value, delimiter):
    return [part.strip() for part in _cell_as_upload_text(value).split(delimiter)]


def _detect_packed_cell_delimiter(header_value):
    """Pick a delimiter when one spreadsheet cell clearly contains many columns."""
    text = _cell_as_upload_text(header_value)
    if not text:
        return None

    best = None
    for delimiter in PACKED_CELL_DELIMITERS:
        parts = [part for part in _split_packed_cell(text, delimiter) if part]
        delimiter_count = text.count(delimiter)
        if delimiter_count < 2 or len(parts) < 3:
            continue
        score = (len(parts), delimiter_count)
        if best is None or score > best[0]:
            best = (score, delimiter)
    return best[1] if best else None


def _read_raw_upload_table(file_path, sheet_name=None):
    """Read upload rows positionally so we can repair packed one-cell tables."""
    path_text = str(file_path).lower()
    if path_text.endswith('.csv') or _looks_like_delimited_text_file(file_path):
        return read_csv_with_encoding(
            file_path,
            header=None,
            sep=None,
            engine='python',
            dtype=str,
            keep_default_na=False
        )
    return pd.read_excel(
        file_path,
        sheet_name=sheet_name,
        header=None,
        dtype=str,
        keep_default_na=False
    )


def _non_empty_cells(row_values):
    cells = []
    for index, value in enumerate(row_values):
        text = _cell_as_upload_text(value)
        if text:
            cells.append((index, text))
    return cells


def _read_physical_rows(file_path, sheet_name=None):
    """One dataframe row per physical line, with no rejoining of any kind.

    The ordinary reader tries to repair wrapped lines while parsing, which is
    right for a merely wrapped file and wrong for one whose fields are shifted:
    it merged 139 of the THALES export's 959 lines across record boundaries
    before anything could see where the boundaries were. The repair below has to
    decide that itself, so it reads the lines as written.
    """
    path_text = str(file_path).lower()
    if not (path_text.endswith('.csv') or _looks_like_delimited_text_file(file_path)):
        raw = pd.read_excel(file_path, sheet_name=sheet_name, header=None,
                            dtype=str, keep_default_na=False)
        if isinstance(raw, dict):
            return raw.get(sheet_name) if sheet_name in raw else next(iter(raw.values()), None)
        return raw
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            with open(file_path, encoding=encoding, newline='') as handle:
                rows = list(csv.reader(handle))
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        return None
    if not rows:
        return None
    width = max(len(row) for row in rows)
    return pd.DataFrame([row + [''] * (width - len(row)) for row in rows])


def _maybe_repair_spilled_rows_upload(client_path, sheet_name, header_row):
    """
    Rejoin rows a converter split because one column held several values.

    An XML/CSV conversion that treats a REPEATING element as a single scalar
    writes the first value in its column and drops each extra onto a line of its
    own. The extra lands in column 0 - not the column it belongs to - and on the
    last of them the record's remaining columns resume, shifted left by the width
    of everything before that column. THALES exports arrive this way: 613 of 958
    lines were fragments, 49 manufacturer part numbers were read as levels, and
    export-control codes ended up in the Quantity column.

    Nothing here knows the customer or the headers. A row is a fragment when the
    column that starts a record is empty on it, and the shift is found by asking
    which offset puts a fragment's trailing values back under a column where the
    intact rows carry those same values. A file with no fragments scores nothing
    and is returned untouched.
    """
    try:
        raw = _read_physical_rows(client_path, sheet_name)
        if raw is None or raw.empty:
            return None

        header_index = max(0, int(header_row or 1) - 1)
        if header_index >= len(raw.index):
            return None

        headers = [str(value or '').strip() for value in raw.iloc[header_index].tolist()]
        width = len(headers)
        if width < 4:
            return None

        body = [
            [('' if pd.isna(cell) else str(cell).strip()) for cell in row]
            for row in raw.iloc[header_index + 1:].values.tolist()
        ]
        body = [row + [''] * (width - len(row)) for row in body]
        if len(body) < 4:
            return None

        def filled(row):
            return [index for index, cell in enumerate(row) if cell]

        density = [
            sum(1 for row in body if row[index]) / float(len(body))
            for index in range(width)
        ]

        # The column that says "a record starts here". Density alone cannot find
        # it: when most lines are fragments, even a mandatory column looks sparse
        # (Parents sits at 0.30 on the THALES file). The densest column after the
        # first is the one every real record fills, and a fragment is a line that
        # has a value in column 0 while that column is empty.
        ranked = sorted(range(1, width), key=lambda index: density[index], reverse=True)
        anchors = [ranked[0]] if ranked and density[ranked[0]] > 0 else []
        if not anchors:
            return None

        def is_fragment(row):
            return bool(row[0]) and not any(row[index] for index in anchors)

        fragments = [index for index, row in enumerate(body) if is_fragment(row)]
        if len(fragments) < max(3, len(body) * 0.05):
            return None

        # Where the spilled value belongs, measured by VALUE rather than by
        # "lands on something non-empty". Any shift can drop a cell onto a
        # populated column by luck - on the THALES file that scored a shift of 2
        # as highly as the true 25 - but only the real one puts "EAR99" back
        # under Re-export_Regl1, where the intact records also say EAR99.
        column_values = [set() for _ in range(width)]
        fragment_set = set(fragments)
        for row_index, row in enumerate(body):
            if row_index in fragment_set:
                continue
            for index in filled(row):
                column_values[index].add(row[index])

        best_shift, best_hits = 0, 0
        for shift in range(1, width):
            hits = 0
            for row_index in fragments:
                row = body[row_index]
                for index in filled(row):
                    if index == 0:
                        continue
                    destination = index + shift
                    if destination < width and row[index] in column_values[destination]:
                        hits += 1
            if hits > best_hits:
                best_shift, best_hits = shift, hits
        if best_shift <= 0 or best_hits < 1:
            return None

        merged = []
        spilled_values = 0
        realigned_cells = 0
        for row in body:
            if not is_fragment(row) or not merged:
                merged.append(list(row))
                continue
            target = merged[-1]
            value = row[0]
            if value:
                existing = target[best_shift]
                target[best_shift] = (existing + '\n' + value) if existing else value
                spilled_values += 1
            for index in filled(row):
                if index == 0:
                    continue
                destination = index + best_shift
                if destination < width and not target[destination]:
                    target[destination] = row[index]
                    realigned_cells += 1

        if len(merged) == len(body):
            return None

        repaired = pd.DataFrame(merged, columns=headers)
        upload_dir = getattr(hybrid_file_manager, 'local_upload_dir', Path(settings.BASE_DIR) / 'uploaded_files')
        upload_dir = Path(upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        repaired_path = upload_dir / f"{uuid.uuid4()}_spilled_rows_repaired.xlsx"
        repaired.to_excel(repaired_path, index=False, sheet_name='Repaired')

        logger.info(
            "Repaired spilled-row upload %s: %s fragments folded into %s records "
            "(column %s, %s realigned cells)",
            client_path, len(fragments), len(merged), best_shift, realigned_cells,
        )
        return {
            'client_path': str(repaired_path),
            'sheet_name': 'Repaired',
            'header_row': 1,
            'client_headers': headers,
            'source_transform': {
                'type': 'spilled_row_repair',
                'original_path': str(client_path),
                'fragments': len(fragments),
                'rows_before': len(body),
                'rows_after': len(merged),
                'target_column_index': best_shift,
                'target_column': headers[best_shift] if best_shift < width else '',
                'values_rejoined': spilled_values,
                'cells_realigned': realigned_cells,
            }
        }
    except Exception as exc:
        logger.warning("Spilled-row repair skipped for %s: %s", client_path, exc)
        return None


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def repair_spilled_rows(request):
    """Repair a file whose rows were split by a bad export, without a session.

    The BOM Normalizer parses the file in the browser, so the upload-time repair
    never sees it - by the time anything reaches the server the damage has been
    baked into a well-formed workbook. This lets the normalizer hand the ORIGINAL
    bytes over first and read back a repaired sheet.

    Returns the repaired .xlsx on 200, or 204 when the file needs nothing. Any
    failure is a 204 as well: the caller must be able to carry on with the file
    the user chose, so this can never be the reason an upload stops working.
    """
    upload = request.FILES.get('clientFile') or request.FILES.get('file')
    if not upload:
        return Response(status=status.HTTP_204_NO_CONTENT)

    temp_path = None
    try:
        upload_dir = Path(getattr(hybrid_file_manager, 'local_upload_dir',
                                  Path(settings.BASE_DIR) / 'uploaded_files'))
        upload_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(str(upload.name or 'upload.csv')).suffix or '.csv'
        temp_path = upload_dir / f"{uuid.uuid4()}_repair_probe{suffix}"
        with open(temp_path, 'wb') as handle:
            for chunk in upload.chunks():
                handle.write(chunk)

        sheet_name = (request.data.get('sheetName') or '').strip() or None
        try:
            header_row = int(request.data.get('headerRow') or 1)
        except (TypeError, ValueError):
            header_row = 1

        transform = _maybe_repair_spilled_rows_upload(str(temp_path), sheet_name, header_row)
        if not transform:
            return Response(status=status.HTTP_204_NO_CONTENT)

        note = transform['source_transform']
        logger.info(
            "Normalizer pre-upload repair on %s: %s -> %s rows into %r",
            upload.name, note['rows_before'], note['rows_after'], note['target_column'],
        )
        response = FileResponse(
            open(transform['client_path'], 'rb'),
            as_attachment=True,
            filename='repaired.xlsx',
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        # Read by the caller so it can tell the user what was changed.
        response['X-Repair-Applied'] = '1'
        response['X-Repair-Rows-Before'] = str(note['rows_before'])
        response['X-Repair-Rows-After'] = str(note['rows_after'])
        response['X-Repair-Target-Column'] = str(note['target_column'])
        response['Access-Control-Expose-Headers'] = (
            'X-Repair-Applied, X-Repair-Rows-Before, X-Repair-Rows-After, X-Repair-Target-Column'
        )
        return response
    except Exception as exc:
        logger.warning("Spilled-row probe failed for %s: %s", getattr(upload, 'name', '?'), exc)
        return Response(status=status.HTTP_204_NO_CONTENT)
    finally:
        try:
            if temp_path and Path(temp_path).exists():
                Path(temp_path).unlink()
        except Exception:
            pass


def _maybe_expand_packed_cell_upload(client_path, sheet_name, header_row):
    """
    Normalize files where each logical row was pasted/exported into one cell.

    This is delimiter-based only; it does not know or care what the headers are.
    If the chosen header row has one non-empty cell containing many semicolon,
    tab, pipe, or comma-separated labels, the whole table is rewritten as a
    normal workbook so all later mapping/export code sees real columns.
    """
    try:
        raw = _read_raw_upload_table(client_path, sheet_name=sheet_name)
        if isinstance(raw, dict):
            raw = raw.get(sheet_name) if sheet_name in raw else next(iter(raw.values()), pd.DataFrame())
        if raw is None or raw.empty:
            return None

        header_index = max(0, int(header_row or 1) - 1)
        if header_index >= len(raw.index):
            return None

        header_cells = _non_empty_cells(raw.iloc[header_index].tolist())
        if len(header_cells) != 1:
            return None

        source_column_index, header_text = header_cells[0]
        delimiter = _detect_packed_cell_delimiter(header_text)
        if not delimiter:
            return None

        headers = [part for part in _split_packed_cell(header_text, delimiter) if part]
        if len(headers) < 3:
            return None

        rows = []
        max_width = len(headers)
        for _, row in raw.iloc[header_index + 1:].iterrows():
            values = row.tolist()
            row_cells = _non_empty_cells(values)
            if not row_cells:
                continue

            # Prefer the same cell as the header. If the row also only has one
            # non-empty cell elsewhere, split that one; this tolerates shifted
            # pasted blocks without baking in any source-specific knowledge.
            if source_column_index < len(values) and _cell_as_upload_text(values[source_column_index]):
                packed_text = values[source_column_index]
            elif len(row_cells) == 1:
                packed_text = row_cells[0][1]
            else:
                return None

            parts = _split_packed_cell(packed_text, delimiter)
            if len([part for part in parts if part]) <= 1 and delimiter not in _cell_as_upload_text(packed_text):
                continue
            max_width = max(max_width, len(parts))
            rows.append(parts)

        if max_width > len(headers):
            headers = headers + [f'Column {index + 1}' for index in range(len(headers), max_width)]

        normalized_rows = [
            list(row[:max_width]) + [''] * max(0, max_width - len(row))
            for row in rows
        ]
        normalized_df = pd.DataFrame(normalized_rows, columns=headers[:max_width])

        upload_dir = getattr(hybrid_file_manager, 'local_upload_dir', Path(settings.BASE_DIR) / 'uploaded_files')
        upload_dir = Path(upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        normalized_path = upload_dir / f"{uuid.uuid4()}_packed_cell_expanded.xlsx"
        normalized_df.to_excel(normalized_path, index=False, sheet_name='Expanded')

        logger.info(
            "Expanded packed one-cell upload %s using delimiter %r into %s columns and %s rows",
            client_path,
            delimiter,
            len(headers[:max_width]),
            len(normalized_rows),
        )
        return {
            'client_path': str(normalized_path),
            'sheet_name': 'Expanded',
            'header_row': 1,
            'client_headers': headers[:max_width],
            'source_transform': {
                'type': 'packed_cell_delimiter_expand',
                'delimiter': delimiter,
                'source_column_index': source_column_index,
                'original_path': str(client_path),
                'columns': len(headers[:max_width]),
                'rows': len(normalized_rows),
            }
        }
    except Exception as exc:
        logger.warning("Packed-cell upload expansion skipped for %s: %s", client_path, exc)
        return None


def generate_template_columns(tags_count=3, spec_pairs_count=3, customer_id_pairs_count=1):
    """
    Generate complete template column headers including all standard template fields.
    Always includes the 6 core Factwise headers, standard template fields, and dynamic columns.
    Default: 3 tags, 3 spec pairs, 1 custom identification pair.
    """
    # Start with core Factwise headers - these must always be present
    headers = [
        "Item code", "Item name", "Description", "Item type", "Measurement unit", "Procurement entity name"
    ]
    
    # Add standard template fields that should always be present
    headers.extend([
        "Notes", "Internal notes", "Procurement item", "Sales item", "Preferred vendor code"
    ])
    
    # Add dynamic Tag columns (default 3)
    for i in range(1, tags_count + 1):
        headers.append(f"Tag_{i}")
    
    # Add dynamic Specification pairs (default 3)
    for i in range(1, spec_pairs_count + 1):
        headers.extend([f"Specification_Name_{i}", f"Specification_Value_{i}"])
    
    # Add dynamic Customer Identification pairs (default 1)
    for i in range(1, customer_id_pairs_count + 1):
        headers.extend([f"Custom_Identification_Name_{i}", f"Custom_Identification_Value_{i}"])
    
    return headers

# Utility: normalize template/display headers to internal numbered headers
def normalize_headers_to_internal(headers: list, existing_headers: Optional[list] = None) -> list:
    """
    UPDATED: Preserve user's original template column names without converting to numbered format.

    This function now:
    - Preserves original column names like "Tag", "Specification Name", "Specification Value" as-is
    - Only recognizes explicitly numbered patterns (Tag_1, Specification_Name_1, etc.) as dynamic columns
    - Does NOT convert "Specification Name" to "Specification_Name_1" anymore

    This prevents conflicts between user's template columns and dynamically added numbered columns.
    """
    logger.debug(f"🔄 normalize_headers_to_internal called with {len(headers)} headers")
    logger.debug(f"Input headers: {headers}")
    logger.debug(f"Existing headers: {existing_headers}")

    if not headers or not isinstance(headers, list):
        logger.warning(f"Invalid headers input: {headers}")
        return headers

    # UPDATED: Simply return headers as-is, preserving user's original column names
    # Only strip whitespace from each header
    normalized = []
    for h in headers:
        h_str = str(h).strip() if h is not None else ''
        normalized.append(h_str)
        logger.debug(f"Preserved header as-is: '{h_str}'")

    logger.info(f"🔄 normalize_headers_to_internal: Preserved {len(normalized)} headers without conversion")
    return normalized


def _strip_pandas_duplicate_suffix(header: str) -> str:
    """Turn pandas duplicate names like 'Tag.1' back into the real Excel label."""
    value = str(header or "").strip()
    return re.sub(r"\.\d+$", "", value)


# A repeated template column carries its slot number as part of its name -
# 'Tag (2)', 'Specification value (3)' - so that one column has exactly one
# identity from the template workbook all the way to the export boundary, where
# `SLOT_SUFFIX_RE` is stripped back to the shared label FactWise groups on.
#
# Parenthesised rather than 'Tag 2' on purpose: 'Alternate UoM 1' is a real
# FactWise column whose name genuinely ends in a digit, and a bare-number scheme
# could not tell the two apart.
SLOT_SUFFIX_RE = re.compile(r"\s*\(\d+\)\s*$")


def _strip_slot_suffix(header: str) -> str:
    """'Tag (2)' -> 'Tag'. The label a slot shares with its siblings."""
    return SLOT_SUFFIX_RE.sub("", str(header or "").strip())


def slot_number(header: str) -> int:
    """The slot a repeated column occupies, or 0 when it carries no number."""
    match = SLOT_SUFFIX_RE.search(str(header or "").strip())
    return int(match.group(0).strip().strip("()")) if match else 0


def _template_label_key(header: str) -> str:
    value = _strip_slot_suffix(_strip_pandas_duplicate_suffix(header))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


# The internal field behind each repeated template label. The grid stores these
# ('Tag_2'); the template workbook and the mapping canvas show the numbered
# label ('Tag (2)'). A mapping saved against the label alone never reaches a
# column, because no grid column is called that.
_INTERNAL_PREFIX_BY_SLOT_LABEL = {
    "tag": "Tag_",
    "specification name": "Specification_Name_",
    "specification value": "Specification_Value_",
    "specification uom": "Specification_UOM_",
    "custom identification name": "Custom_Identification_Name_",
    "custom identification value": "Custom_Identification_Value_",
}


def internal_name_for_slot_label(header: str) -> str:
    """'Tag (2)' -> 'Tag_2'. Empty string when the header is not a numbered slot."""
    index = slot_number(header)
    if not index:
        return ""
    prefix = _INTERNAL_PREFIX_BY_SLOT_LABEL.get(_template_label_key(header))
    return f"{prefix}{index}" if prefix else ""


def derive_sfo_column_counts(headers: list) -> dict:
    """Derive dynamic group counts from SFO-style repeated destination headers.

    Counted from the headers, not assumed. This returned the constants 3/3/1
    whatever it was passed, which meant the destination template could not
    change shape: build_sfo_clustered_headers rebuilds each group from the
    count, so adding a fourth "Tag (4)" column to the template had it stripped
    straight back out again on upload.

    A template with no dynamic columns at all still needs one slot of each -
    the mapping canvas has to offer somewhere to put a tag - so the floor is 1.
    """
    counted = derive_sfo_column_counts_from_headers(headers or [])
    return {
        "tags_count": max(counted["tags_count"], 1),
        "spec_pairs_count": max(counted["spec_pairs_count"], 1),
        "customer_id_pairs_count": max(counted["customer_id_pairs_count"], 1),
    }


BOM_DESTINATION_HEADERS = ["Level", "Quantity", "Base BOM Qty"]


def add_bom_destination_headers(headers: list) -> list:
    """Add the first BOM fields we want available in the current destination list."""
    output = list(headers or [])
    existing = {_template_label_key(header) for header in output}

    insert_at = len(output)
    for anchor in ("Procurement entity name", "Preferred vendor code"):
        try:
            insert_at = min(insert_at, next(i for i, h in enumerate(output) if _template_label_key(h) == _template_label_key(anchor)))
        except StopIteration:
            pass

    missing = [header for header in BOM_DESTINATION_HEADERS if _template_label_key(header) not in existing]
    if missing:
        output[insert_at:insert_at] = missing

    return output


def build_sfo_clustered_headers(base_headers: list, tags_count: int, spec_pairs_count: int, customer_id_pairs_count: int) -> list:
    """Preserve SFO template order while expanding repeated import columns as clustered duplicate labels."""
    headers = [_strip_pandas_duplicate_suffix(h) for h in (base_headers or []) if str(h or "").strip()]
    if not headers:
        headers = [
            "Item code", "ERP Code", "CPN Code", "MPN Code", "HSN Code", "Item name",
            "Description", "Item type", "Measurement unit", "Alternate UoM 1", "Notes",
            "SAP Description", "Specification name", "Specification value", "Specification UOM",
            "Custom identification name", "Custom identification value", "Procurement item",
            "Procurement item price currency code", "Procurement item price", "Sales item",
            "Tag", "Procurement entity name", "Preferred vendor code",
            "Alternate Item Name for Preferred Vendor",
        ]

    def group_kind(header: str) -> Optional[str]:
        key = _template_label_key(header)
        if key == "tag" or re.match(r"^tag \d+$", key):
            return "tag"
        if key in {"specification name", "specification value", "specification uom"}:
            return "spec"
        if key in {
            "custom identification name", "custom identification value",
        }:
            return "customer"
        if re.match(r"^(tag|specification name|specification value|custom identification name|custom identification value) \d+$", key):
            return "dynamic"
        if re.match(r"^(tag|specification_name|specification_value|custom_identification_name|custom_identification_value)_\d+$", str(header or "").strip().lower()):
            return "dynamic"
        return None

    anchors = {}
    static_headers = []
    for header in headers:
        kind = group_kind(header)
        if kind in {"tag", "spec", "customer"} and kind not in anchors:
            anchors[kind] = len(static_headers)
        if kind:
            continue
        static_headers.append(header)

    def insert_group(kind: str, group_headers: list):
        index = anchors.get(kind)
        if index is None:
            index = len(static_headers)
        static_headers[index:index] = group_headers
        for other_kind, other_index in list(anchors.items()):
            if other_kind != kind and other_index >= index:
                anchors[other_kind] = other_index + len(group_headers)

    # Numbered, not repeated. Emitting three columns all called "Tag" is what
    # forced every later stage to invent its own way of telling them apart -
    # internal slot keys, ' @@dup1' row keys, '__2' field ids - and any two of
    # those meeting in one header list is where the column bugs came from. The
    # number is stripped once, at the export boundary, because that is the only
    # place a shared label is required.
    def numbered(labels: list, count: int) -> list:
        return [f"{label} ({slot})"
                for slot in range(1, max(0, int(count or 0)) + 1)
                for label in labels]

    insert_group("spec", numbered(["Specification name", "Specification value", "Specification UOM"], spec_pairs_count))
    insert_group("customer", numbered(["Custom identification name", "Custom identification value"], customer_id_pairs_count))
    insert_group("tag", numbered(["Tag"], tags_count))

    # The default workbook now carries Level / Quantity / Base BOM Qty as real
    # columns, so this adds nothing there. It still matters for an uploaded
    # template that lacks them - the mapping page offers those columns whatever
    # the workbook says, and a destination the matcher cannot see is a column
    # the user can never fill.
    return add_bom_destination_headers(static_headers)


def _internal_dynamic_index(header: str, prefix: str) -> int:
    match = re.match(rf"^{re.escape(prefix)}_(\d+)$", str(header or "").strip(), re.IGNORECASE)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except Exception:
        return 0


def derive_sfo_column_counts_from_headers(headers: list) -> dict:
    """Count SFO dynamic slots without double-counting mixed repeated + internal headers."""
    tag_repeated = 0
    spec_repeated = 0
    customer_repeated = 0
    tag_internal_max = 0
    spec_internal_max = 0
    customer_internal_max = 0

    for header in headers or []:
        label_key = _template_label_key(header)
        tag_repeated += 1 if label_key == "tag" else 0
        spec_repeated += 1 if label_key == "specification name" else 0
        customer_repeated += 1 if label_key in {"custom identification name", "custom identification name", "custom identification name"} else 0

        raw = str(header or "").strip()
        tag_internal_max = max(tag_internal_max, _internal_dynamic_index(raw, "Tag"))
        spec_internal_max = max(spec_internal_max, _internal_dynamic_index(raw, "Specification_Name"))
        customer_internal_max = max(customer_internal_max, _internal_dynamic_index(raw, "Custom_Identification_Name"))

    return {
        "tags_count": max(tag_repeated, tag_internal_max, 0),
        "spec_pairs_count": max(spec_repeated, spec_internal_max, 0),
        "customer_id_pairs_count": max(customer_repeated, customer_internal_max, 0),
    }



def _counts_matching_headers(headers, tags_count, spec_pairs_count, customer_id_pairs_count):
    """Slot counts that cannot be smaller than the headers they describe."""
    present = derive_sfo_column_counts_from_headers(headers or [])
    return {
        'tags_count': max(int(tags_count or 0), present['tags_count']),
        'spec_pairs_count': max(int(spec_pairs_count or 0), present['spec_pairs_count']),
        'customer_id_pairs_count': max(int(customer_id_pairs_count or 0), present['customer_id_pairs_count']),
    }


def get_sfo_slot_key(header: str, occurrence: int) -> str:
    """Return the internal key for a repeated SFO header occurrence."""
    index = max(1, int(occurrence or 1))
    label_key = _template_label_key(header)
    if label_key == "tag":
        return f"Tag_{index}"
    if label_key == "specification name":
        return f"Specification_Name_{index}"
    if label_key == "specification value":
        return f"Specification_Value_{index}"
    if label_key == "specification uom":
        return f"Specification_UOM_{index}"
    if label_key in {"custom identification name", "custom identification name", "custom identification name"}:
        return f"Custom_Identification_Name_{index}"
    if label_key in {"custom identification value", "custom identification value", "custom identification value"}:
        return f"Custom_Identification_Value_{index}"
    return str(header or "")


def get_sfo_slot_keys(headers: list) -> list:
    seen = defaultdict(int)
    slot_keys = []
    for header in headers or []:
        label_key = _template_label_key(header)
        if label_key in {
            "tag",
            "specification name", "specification value", "specification uom",
            "custom identification name", "custom identification value",
            "custom identification name", "custom identification value",
            "custom identification name", "custom identification value",
        }:
            seen[label_key] += 1
            slot_keys.append(get_sfo_slot_key(header, seen[label_key]))
        else:
            slot_keys.append(str(header or ""))
    return slot_keys


def make_unique_field_headers(headers: list) -> list:
    """Create JSON-safe field keys while keeping SFO slots stable."""
    slot_keys = get_sfo_slot_keys(headers or [])
    seen = defaultdict(int)
    unique = []
    for header, slot_key in zip(headers or [], slot_keys):
        key = slot_key or str(header or "")
        seen[key] += 1
        if seen[key] > 1:
            key = f"{key}__{seen[key]}"
        unique.append(key)
    return unique

# In-memory store for each session
SESSION_STORE = {}

# Cache control and snapshot helper functions
def no_store(resp: Response) -> Response:
    """Add no-store cache headers to prevent caching issues across workers."""
    resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp["Pragma"] = "no-cache"
    resp["Expires"] = "0"
    return resp

def increment_template_version(session_id):
    """Increment template version for a session to track changes."""
    if session_id in SESSION_STORE:
        current_version = SESSION_STORE[session_id].get('template_version', 0)
        new_version = current_version + 1
        SESSION_STORE[session_id]['template_version'] = new_version
        save_session_to_file(session_id, SESSION_STORE[session_id])
        logger.info(f"🔄 Template version incremented for session {session_id}: {current_version} → {new_version}")
        return new_version
    return 0

def get_template_version(session_id):
    """Get current template version for a session."""
    if session_id in SESSION_STORE:
        return SESSION_STORE[session_id].get('template_version', 0)
    return 0

def _externalize_formula_rules(rules, session_info=None):
    """Return a copy of formula rules with internal targets shown as external labels for UI.
    Example: Tag_4 -> Tag, Specification_Name_1 -> 'Specification name' (already handled by converter).
    """
    try:
        ext = []
        for r in (rules or []):
            rule = dict(r or {})
            tcol = rule.get('target_column')
            if isinstance(tcol, str) and tcol:
                try:
                    rule['target_column'] = convert_internal_to_external_name(tcol)
                except Exception:
                    pass
            ext.append(rule)
        return ext
    except Exception:
        return rules or []

def build_snapshot(info: dict) -> dict:
    """Build canonical snapshot of session state."""
    return {
        "version": info.get("version", 0),
        "template_version": info.get("template_version", 0),
        "headers": info.get("enhanced_headers") or info.get("current_template_headers") or info.get("template_headers") or [],
        "mappings": info.get("mappings") or {"mappings": []},
        "default_values": info.get("default_values") or {},
        "counts": {
            "tags_count": info.get("tags_count", 3),
            "spec_pairs_count": info.get("spec_pairs_count", 3),
            "customer_id_pairs_count": info.get("customer_id_pairs_count", 1),
        },
        "formula_rules": _externalize_formula_rules(info.get("formula_rules") or [], info),
        "factwise_rules": info.get("factwise_rules") or [],
    }

# Session persistence helper functions
def save_session_to_file(session_id, session_data):
    """Save session data to file for persistence."""
    try:
        session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
        import json
        with open(session_file, 'w') as f:
            # Convert paths to strings for JSON serialization
            serializable_data = {}
            for key, value in session_data.items():
                if isinstance(value, Path):
                    serializable_data[key] = str(value)
                else:
                    serializable_data[key] = value
            json.dump(serializable_data, f)
        logger.info(f"💾 Saved session {session_id} to file")
    except Exception as e:
        logger.warning(f"Failed to save session {session_id}: {e}")

def load_session_from_file(session_id):
    """Load session data from file."""
    try:
        session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
        if session_file.exists():
            import json
            with open(session_file, 'r') as f:
                session_data = json.load(f)
            logger.info(f"📂 Loaded session {session_id} from file")
            return session_data
    except Exception as e:
        logger.warning(f"Failed to load session {session_id}: {e}")
    return None

def get_session_consistent(session_id: str):
    """
    Get session from consistent storage (cache-first approach for Azure multi-worker).
    1) Try Redis cache first (shared across workers)
    2) Fallback to in-process memory
    3) Fallback to file snapshot
    """
    # Try cache first (shared across Azure workers)
    data = cache.get(f"mapper:session:{session_id}")
    if data:
        logger.info(f"🔍 Session {session_id} found in cache")
        SESSION_STORE[session_id] = data
        return data
    
    # Fallback to old in-memory store
    if session_id in SESSION_STORE:
        data = SESSION_STORE[session_id]
        # Warm cache for next time
        cache.set(f"mapper:session:{session_id}", data, 86400)
        logger.info(f"🔄 Session {session_id} found in memory, warmed cache")
        return data
    
    # Final fallback to file snapshot
    logger.info(f"🔍 Session {session_id} not in cache/memory, trying file")
    data = load_session_from_file(session_id)
    if data:
        # Warm both cache and memory
        cache.set(f"mapper:session:{session_id}", data, 86400)
        SESSION_STORE[session_id] = data
        logger.info(f"🔄 Restored session {session_id} from file, warmed cache/memory")
        return data
    
    logger.warning(f"❌ Session {session_id} not found anywhere")
    return None

def get_session(session_id):
    """
    Universal session retrieval that works across multiple workers.
    Checks memory first, then loads from file if needed.
    Returns session data or None if not found.
    """
    if session_id in SESSION_STORE:
        logger.info(f"🔍 Session {session_id} found in memory")
        return SESSION_STORE[session_id]
    
    # Try to load from file
    logger.info(f"🔍 Session {session_id} not in memory, trying file")
    session_data = load_session_from_file(session_id)
    if session_data:
        SESSION_STORE[session_id] = session_data
        logger.info(f"🔄 Restored session {session_id} from file to memory")
        logger.info(f"🔍 Session keys: {list(session_data.keys())}")
        return session_data
    
    logger.warning(f"❌ Session {session_id} not found in memory or file")
    return None

def save_session(session_id, session_data, persist_file=True):
    """
    Universal session saving that persists across multiple workers.
    Saves to cache (shared), memory, and file.
    """
    try:
        # Preserve critical flags like source_type across partial updates
        existing = None
        try:
            existing = SESSION_STORE.get(session_id)
            if not existing:
                existing = load_session_from_file(session_id)
        except Exception:
            existing = None

        if existing and 'source_type' in existing and 'source_type' not in session_data:
            session_data['source_type'] = existing['source_type']

        # As a last resort, infer PDF sessions from database
        if 'source_type' not in session_data:
            try:
                from .models import PDFSession
                if PDFSession.objects.filter(session_id=session_id).exists():
                    session_data['source_type'] = 'pdf'
            except Exception:
                pass

        try:
            cleaned_spec_pairs = enforce_empty_spec_pair_rule(session_data)
            if cleaned_spec_pairs:
                logger.info(f"Cleaned {cleaned_spec_pairs} empty Specification name/value pairs before saving session")
        except Exception as spec_cleanup_err:
            logger.warning(f"Spec pair cleanup before save skipped: {spec_cleanup_err}")

        # Save to shared cache first (critical for Azure multi-worker)
        cache.set(f"mapper:session:{session_id}", session_data, 86400)
        # Keep compatibility with existing in-memory store
        SESSION_STORE[session_id] = session_data
        # Persist to file/blob storage
        if persist_file:
            save_session_to_file(session_id, session_data)
        locations = "cache, memory, and file" if persist_file else "cache and memory"
        logger.info(f"💾 Saved session {session_id} to {locations}")
    except Exception as e:
        logger.error(f"Failed to save session {session_id}: {e}")


# Utility: Fast total row count without loading full DataFrame
def _count_total_data_rows(file_path: str, sheet_name: Optional[str], header_row: int) -> int:
    """Return total number of data rows after the header row.
    Works for both CSV and Excel. For Excel, uses openpyxl read-only mode.
    """
    try:
        p = Path(file_path)
        if str(p).lower().endswith('.csv'):
            # Count lines in a streaming fashion
            with open(p, 'rb') as f:
                # Count newline occurrences; this is approximate but sufficient
                total_lines = 0
                for _ in f:
                    total_lines += 1
            data_rows = max(0, total_lines - (header_row + 1))
            return data_rows
        else:
            # Excel: use openpyxl to get max_row, then adjust for header row
            wb = load_workbook(filename=str(p), read_only=True, data_only=True)
            ws = wb[sheet_name] if sheet_name in wb.sheetnames else wb[wb.sheetnames[0]]
            max_row = ws.max_row or 0
            # Try to trim trailing entirely empty rows
            # Scan backward until a row with any non-empty cell is found
            last_data_row = 0
            for r in range(max_row, 0, -1):
                has_val = False
                for cell in ws.iter_rows(min_row=r, max_row=r, values_only=True):
                    # cell is a tuple of values for that row
                    if any(v is not None and str(v).strip() != '' for v in cell):
                        has_val = True
                        break
                if has_val:
                    last_data_row = r
                    break
            if last_data_row == 0:
                return 0
            data_rows = max(0, last_data_row - (header_row + 1))
            return data_rows
    except Exception as e:
        logger.warning(f"Failed to count total data rows: {e}")
        # Fallback: unknown
        return 0


# Use hybrid file manager from azure_storage module
# This automatically handles Azure Blob Storage when available,
# falls back to local storage for development


def _eval_default_rule_condition(cell, operator, compare):
    """Evaluate one conditional-default test against a cell value."""
    c = str(cell or '').strip()
    cl = c.lower()
    cmp = str(compare or '').strip().lower()
    if operator == 'is_empty':
        return c == ''
    if operator == 'not_empty':
        return c != ''
    if operator == 'equals':
        return cl == cmp
    if operator == 'not_equals':
        return cl != cmp
    if operator == 'contains':
        return cmp in cl
    return False


def apply_default_value_rules(headers, rows, rules, only_empty=False):
    """Apply conditional default-value rules to a built grid (list-of-lists rows).

    rules: { target_col: { column, operator, compare, then, else } }
      - column:   the OTHER column whose value the rule tests
      - operator: is_empty | not_empty | equals | not_equals | contains
      - then:     value written when the condition is true
      - else:     value written when false (omit to leave the cell as-is)

    Returns the number of cells changed. Safe no-op if rules/headers/rows are empty
    or the referenced columns aren't present.
    """
    if not rules or not headers or not rows:
        return 0

    # Columns are matched by BOTH their sheet name and their internal slot key.
    #
    # The template repeats headers on purpose - three columns all called "Tag",
    # several "Specification name". The mapping page refers to those by slot
    # (`Tag_2`), which is the only way to say WHICH one. Matching on the sheet
    # name alone meant a rule saved against `Tag_2` matched no column at all, so
    # every rule on a Tag or Specification field silently did nothing.
    #
    # get_sfo_slot_key is what the mapping path already uses for this, so the two
    # now agree on what a column is called.
    hindex = {}
    occurrence = {}
    for position, header in enumerate(headers):
        name = str(header or '')
        occurrence[name] = occurrence.get(name, 0) + 1
        slot_key = get_sfo_slot_key(name, occurrence[name])
        # First occurrence wins for the bare name, so a rule keyed on a plain
        # unique column keeps behaving exactly as it did.
        hindex.setdefault(name, position)
        hindex.setdefault(slot_key, position)
    changed = 0
    for target, rule in rules.items():
        if not isinstance(rule, dict):
            continue
        cond_col = str(rule.get('column') or '').strip()
        if target not in hindex or cond_col not in hindex:
            continue
        ti = hindex[target]
        ci = hindex[cond_col]
        operator = str(rule.get('operator') or 'is_empty')
        compare = rule.get('compare')
        then_val = '' if rule.get('then') is None else str(rule.get('then'))
        raw_else = rule.get('else')
        has_else = raw_else is not None
        else_val = '' if raw_else is None else str(raw_else)
        for row in rows:
            if ti >= len(row) or ci >= len(row):
                continue
            if only_empty and str(row[ti] or '').strip():
                continue
            if _eval_default_rule_condition(row[ci], operator, compare):
                row[ti] = then_val
                changed += 1
            elif has_else:
                row[ti] = else_val
                changed += 1
    return changed


def apply_column_mappings(client_file, mappings, sheet_name=None, header_row=0, session_id=None):
    """
    Apply column mappings to transform client data to template format.
    Now supports multiple source columns mapping to the same template column name (with identical names).
    Includes ALL template columns, even unmapped ones (which will be empty).
    """
    try:
        logger.info(f"🔍 apply_column_mappings received mappings: {mappings}")
        
        # Get template headers - use dynamic columns if available, otherwise read from file
        template_headers = []
        if session_id and session_id in SESSION_STORE:
            info = SESSION_STORE[session_id]
            
            # Prefer canonical current headers (persisted). Avoid using enhanced headers directly
            # to prevent flip-flopping between operation-specific snapshots.
            canonical_headers = info.get("current_template_headers")
            if canonical_headers and isinstance(canonical_headers, list) and len(canonical_headers) > 0:
                # Use the canonical headers from the uploaded template file directly
                template_headers = normalize_headers_to_internal(canonical_headers)
                logger.info(f"🔍 Using {len(template_headers)} canonical template headers from session")
            else:
                # Fallback to reading from template file
                template_headers = SESSION_STORE[session_id].get("template_headers", [])
                if not template_headers:
                    try:
                        from .bom_header_mapper import BOMHeaderMapper
                        mapper = BOMHeaderMapper()
                        template_headers = mapper.read_excel_headers(
                            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
                            sheet_name=info.get("template_sheet_name"),
                            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
                        )
                        # Store in session for future use
                        SESSION_STORE[session_id]["template_headers"] = template_headers
                        logger.info(f"🔍 Read and cached {len(template_headers)} template headers from file")
                    except Exception as e:
                        logger.warning(f"Could not read template headers: {e}")
                else:
                    logger.info(f"🔍 Found {len(template_headers)} template headers from session")
        
        # Build canonical lookup from template headers -> exact header text
        canon_to_template = {_canon(h): h for h in (template_headers or [])}

        # Handle new mapping format from frontend
        if isinstance(mappings, dict) and 'mappings' in mappings:
            # New format: ordered list of individual mappings
            mapping_list = mappings['mappings']
            logger.info(f"🔍 Processing new mapping format with {len(mapping_list)} mappings")
            
            # Extract and save default values if provided
            if 'default_values' in mappings and session_id and session_id in SESSION_STORE:
                default_values = mappings['default_values']
                SESSION_STORE[session_id]["default_values"] = default_values
            if 'default_value_rules' in mappings and session_id and session_id in SESSION_STORE:
                SESSION_STORE[session_id]["default_value_rules"] = mappings['default_value_rules'] or {}
        else:
            # Fallback to old format for compatibility - convert to preserve order better
            mapping_list = []
            logger.info(f"🔍 Converting old format mappings: {mappings}")
            
            # Process in the order they appear in the original dict to preserve user intent
            # Don't sort alphabetically as that changes the user's intended order
            
            for template_column, source_info in mappings.items():
                if isinstance(source_info, list):
                    # Multiple sources mapped to same target - this was the problematic case
                    logger.info(f"🔍 Old format: Multiple sources {source_info} -> {template_column}")
                    for source_column in source_info:
                        mapping_list.append({'source': source_column, 'target': template_column})
                        logger.info(f"🔍 Converted: {source_column} -> {template_column}")
                else:
                    # Single source mapping
                    logger.info(f"🔍 Old format: Single source {source_info} -> {template_column}")
                    mapping_list.append({'source': source_info, 'target': template_column})
            
            logger.info(f"🔍 Converted old format to {len(mapping_list)} individual mappings")
        
        # Resolve local path if using Azure Blob Storage and read the client data
        client_local_path = hybrid_file_manager.get_file_path(client_file)

        # Optional pagination inputs: derive from caller if present via context
        offset = None
        limit = None
        try:
            if session_id and SESSION_STORE.get(session_id, {}).get('__paginate__'):
                hints = SESSION_STORE[session_id]['__paginate__']
                offset = int(hints.get('offset')) if 'offset' in hints else None
                limit = int(hints.get('limit')) if 'limit' in hints else None
        except Exception:
            offset = None
            limit = None

        # Helper to read only headers quickly
        def _read_only_headers() -> list:
            try:
                df0 = read_spreadsheet_or_delimited(
                    client_local_path,
                    sheet_name=sheet_name,
                    header=header_row,
                    nrows=0
                )
                return [str(c).strip() for c in df0.columns]
            except Exception:
                return []

        # Read the DataFrame – full or paginated slice
        # CRITICAL FIX: Special handling for PDF sessions where CSV has no headers
        is_pdf_session = session_id and session_id in SESSION_STORE and str(SESSION_STORE[session_id].get("source_type", "")).startswith("pdf")
        pdf_headers = None

        if is_pdf_session:
            # Get headers from PDF extraction data instead of CSV file
            try:
                from .models import PDFSession, PDFExtractionResult
                pdf_session = PDFSession.objects.get(session_id=session_id)
                pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').values('extracted_headers').first()
                if pdf_extraction and pdf_extraction.get('extracted_headers'):
                    pdf_headers = pdf_extraction.get('extracted_headers')
                    logger.info(f"🔍 PDF session detected, using extracted headers: {pdf_headers}")
            except Exception as e:
                logger.error(f"🔍 Error getting PDF headers for session {session_id}: {e}")
                # Fallback to session store data created by OCR pipeline
                try:
                    pdf_headers = (SESSION_STORE.get(session_id) or {}).get('headers')
                    if pdf_headers:
                        logger.info(f"🔍 Using headers from session store for PDF session {session_id}")
                except Exception:
                    pdf_headers = None

        if offset is None or limit is None:
            if str(client_local_path).lower().endswith('.csv') or _looks_like_delimited_text_file(client_local_path):
                if is_pdf_session and pdf_headers:
                    # PDF CSV has no headers, read with header=None and provide column names
                    df = read_spreadsheet_or_delimited(client_local_path, header=None, names=pdf_headers)
                    logger.info(f"🔍 PDF session: Read CSV without headers, applied PDF headers: {pdf_headers}")
                else:
                    df = read_spreadsheet_or_delimited(client_local_path, header=header_row)
            else:
                result = read_spreadsheet_or_delimited(client_local_path, sheet_name=sheet_name, header=header_row)
                # Handle multiple sheets case
                if isinstance(result, dict):
                    first_sheet_name = list(result.keys())[0]
                    df = result[first_sheet_name]
                else:
                    df = result
        else:
            # Paginated read: read only the requested slice efficiently
            if is_pdf_session and pdf_headers:
                cols = pdf_headers
            else:
                cols = _read_only_headers()

            if str(client_local_path).lower().endswith('.csv') or _looks_like_delimited_text_file(client_local_path):
                if is_pdf_session and pdf_headers:
                    # PDF CSV has no headers, skip only the offset rows (no header row to skip)
                    skiprows = max(0, int(offset)) if offset > 0 else None
                    df = read_spreadsheet_or_delimited(
                        client_local_path,
                        header=None,
                        names=pdf_headers,
                        skiprows=skiprows,
                        nrows=int(limit)
                    )
                    logger.info(f"🔍 PDF session paginated: Read CSV without headers, offset={offset}, limit={limit}")
                else:
                    # Skip header_row+1 data rows plus the offset
                    skip_start = header_row + 1
                    skip_end = skip_start + max(0, int(offset))
                    skiprows = list(range(skip_start, skip_end)) if skip_end > skip_start else None
                    df = read_spreadsheet_or_delimited(
                        client_local_path,
                        header=None,
                        names=cols if cols else None,
                        skiprows=skiprows,
                        nrows=int(limit)
                    )
            else:
                # Excel: set header=None and supply names; skip header_row + 1 + offset rows from top
                skiprows = header_row + 1 + max(0, int(offset))
                df = pd.read_excel(
                    client_local_path,
                    sheet_name=sheet_name,
                    header=None,
                    names=cols if cols else None,
                    skiprows=skiprows,
                    nrows=int(limit)
                )
        
        # Clean column names
        df.columns = [str(col).strip() for col in df.columns]
        df = drop_non_data_rows(df, context="apply_column_mappings")
        
        # Build canonical lookup for df columns (for source snapping)
        df_canon = {_canon(c): c for c in df.columns}
        
        # Normalize mapping_list targets to the exact template header spelling
        # === DETAILED LOGGING FOR DEBUGGING ===
        logger.info(f"📊 APPLY_MAPPINGS: Processing {len(mapping_list)} mappings")
        logger.info(f"📊 TEMPLATE HEADERS AVAILABLE: {template_headers}")

        normalized_list = []
        for m in mapping_list:
            t_raw = m.get("target", "")
            s_raw = m.get("source", "")
            # Snap target to real template header if found, otherwise keep original
            t = canon_to_template.get(_canon(t_raw), t_raw)
            if t_raw != t:
                logger.info(f"📊 MAPPING NORMALIZED: '{s_raw}' -> '{t_raw}' (normalized to '{t}')")
            else:
                logger.info(f"📊 MAPPING: '{s_raw}' -> '{t}'")
            normalized_list.append({"source": s_raw, "target": t})
        mapping_list = normalized_list

        # Log all mappings grouped by target type
        template_mappings = [m for m in mapping_list if not any(m['target'].endswith(f'_{i}') for i in range(1, 100))]
        dynamic_mappings = [m for m in mapping_list if any(m['target'].endswith(f'_{i}') for i in range(1, 100))]
        logger.info(f"📊 TEMPLATE COLUMN MAPPINGS: {template_mappings}")
        logger.info(f"📊 DYNAMIC COLUMN MAPPINGS: {dynamic_mappings}")

        # Build column order - ALWAYS preserve original template column order
        mapping_dict = {}  # target -> list of mappings for that target
        
        for mapping in mapping_list:
            target = mapping['target']
            if target not in mapping_dict:
                mapping_dict[target] = []
            mapping_dict[target].append(mapping)
        
        # ALWAYS use original template headers order - never reorder based on mapping status
        column_order = template_headers.copy() if template_headers else []
        logger.info(f"🔧 DEBUG apply_column_mappings: template_headers = {template_headers}")
        logger.info(f"🔧 DEBUG apply_column_mappings: column_order = {column_order}")
        
        # Check if standard headers are present in template_headers
        standard_headers_check = [
            # Core Factwise headers
            "Item code", "Item name", "Description", "Item type", "Measurement unit", "Procurement entity name",
            # Standard template fields that should behave like core headers when mapped
            "Notes", "Internal notes", "Procurement item", "Sales item", "Preferred vendor code"
        ]
        missing_standard = [h for h in standard_headers_check if h not in template_headers]
        if missing_standard:
            logger.warning(f"🚨 CRITICAL: Missing standard headers in template_headers: {missing_standard}")
        else:
            logger.info(f"✅ All standard headers present in template_headers")
        
        # Get session default values for unmapped fields
        session_default_values = {}
        if session_id and session_id in SESSION_STORE:
            session_default_values = SESSION_STORE[session_id].get("default_values", {})
        
        # Process each row - match the header logic
        transformed_rows = []
        column_slot_keys = get_sfo_slot_keys(column_order)
        for _, row in df.iterrows():
            transformed_row = []
            
            for target_column, target_key in zip(column_order, column_slot_keys):
                mappings_for_target = mapping_dict.get(target_key) or mapping_dict.get(target_column)
                default_key = target_key if target_key in session_default_values else target_column
                if mappings_for_target:
                    # This column has mappings - for numbered fields, take the first mapping only
                    # For our numbered fields (Tag_1, Tag_2, etc.), there should be exactly one mapping per target
                    # Take the first (and usually only) mapping
                    mapping = mappings_for_target[0]
                    source_column = mapping['source']
                    
                    # IMPORTANT: Handle default value mappings (from template apply)
                    if source_column and source_column.startswith("__DEFAULT__"):
                        # Extract default value from special source format: "__DEFAULT__value"
                        default_value = source_column[11:]  # Remove "__DEFAULT__" prefix
                        transformed_row.append(default_value)
                        logger.info(f"🔧 Applied default value '{default_value}' to column '{target_column}'")
                    elif source_column:
                        # Snap source to exact df column if needed
                        src = df_canon.get(_canon(source_column), source_column)
                        if src in df.columns:
                            value = row.get(src, "")
                            if pd.isna(value):
                                value = ""
                            else:
                                value = str(value).strip()
                        else:
                            value = ""

                        # If the mapped source yields an empty value, fall back to session default if available
                        if (value == "" or value is None) and default_key in session_default_values:
                            default_value = session_default_values.get(default_key, "")
                            value = str(default_value)
                            logger.info(f"🔧 Applied session default value '{default_value}' to mapped column '{target_column}' due to empty source value")

                        transformed_row.append(value)
                    else:
                        # Source column missing - fall back to default if available
                        if default_key in session_default_values:
                            default_value = session_default_values.get(default_key, "")
                            transformed_row.append(str(default_value))
                            logger.info(f"🔧 Applied session default value '{default_value}' to unmapped/missing-source column '{target_column}'")
                        else:
                            transformed_row.append("")  # Empty value for missing source columns
                        
                    # Handle additional mappings to the same target (rare with numbered system)
                    for additional_mapping in mappings_for_target[1:]:
                        additional_source = additional_mapping['source']
                        if additional_source:
                            # Snap additional source to exact df column if needed
                            additional_src = df_canon.get(_canon(additional_source), additional_source)
                            if additional_src in df.columns:
                                additional_value = row.get(additional_src, "")
                                if pd.isna(additional_value):
                                    additional_value = ""
                                else:
                                    additional_value = str(additional_value).strip()
                                transformed_row.append(additional_value)
                            else:
                                transformed_row.append("")
                        else:
                            transformed_row.append("")
                else:
                    # Unmapped template column - check for default value, otherwise empty
                    if default_key in session_default_values:
                        default_value = session_default_values[default_key]
                        transformed_row.append(str(default_value))
                        logger.info(f"🔧 Applied session default value '{default_value}' to unmapped column '{target_column}'")
                    else:
                        transformed_row.append("")  # Empty value for truly unmapped columns
            
            transformed_rows.append(transformed_row)
        
        # Preserve duplicate SFO headers because the FactWise import template accepts
        # multiple "Tag" / "Specification value" columns by position.
        final_headers = list(column_order)
        
        # Apply conditional default-value rules (if / else based on another column).
        # These run AFTER the whole grid is built so the condition can read the mapped
        # value of another column in the same row. Rows align to final_headers here.
        session_default_rules = {}
        rule_warning = ''
        if session_id and session_id in SESSION_STORE:
            session_default_rules = SESSION_STORE[session_id].get("default_value_rules", {}) or {}
        if session_default_rules:
            ragged = [r for r in transformed_rows if len(r) != len(final_headers)]
            if ragged:
                # Writing by position into a row of the wrong width would put the
                # value under a different column, so the rules are not run. This
                # used to happen in silence, which looked exactly like the rules
                # not working at all.
                rule_warning = (
                    'This sheet does not match the template: %d of %d rows have a '
                    'different number of columns, so the conditional default rules '
                    'were not applied.' % (len(ragged), len(transformed_rows))
                )
                logger.warning('🔧 %s' % rule_warning)
            else:
                n = apply_default_value_rules(final_headers, transformed_rows, session_default_rules, only_empty=False)
                logger.info(f"🔧 Applied {len(session_default_rules)} conditional default rule(s): {n} cells set")

        # Return data structure that includes column order and data
        logger.info(f"🔧 DEBUG apply_column_mappings: final_headers = {final_headers}")
        final_standard_check = [h for h in standard_headers_check if h in final_headers]
        logger.info(f"🔧 DEBUG apply_column_mappings: final_headers contains {len(final_standard_check)}/{len(standard_headers_check)} standard headers: {final_standard_check}")

        return {
            'headers': final_headers,
            'data': transformed_rows,
            # Present only when something was skipped. Callers surface it so a
            # rule that did not run says so instead of looking broken.
            'warning': rule_warning,
        }

    except Exception as e:
        logger.error(f"Error in apply_column_mappings: {e}")
        return {'headers': [], 'data': []}


@api_view(['POST'])
def update_session_data(request):
    """
    Update session data with corrected values while preserving structure
    """
    try:
        session_id = request.data.get('session_id')
        headers = request.data.get('headers', [])
        data_rows = request.data.get('data', [])
        try:
            logger.info(f"📝 CORRECTION: Received update for session {session_id}: headers={len(headers)} rows={len(data_rows)}")
            if headers:
                logger.info(f"📝 CORRECTION: First 10 headers: {headers[:10]}")
            if data_rows:
                sample_keys = list(data_rows[0].keys()) if isinstance(data_rows[0], dict) else []
                logger.info(f"📝 CORRECTION: First row keys: {sample_keys}")
        except Exception:
            pass

        if not session_id:
            return Response({
                'success': False,
                'error': 'No session ID provided'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not headers or not data_rows:
            return Response({
                'success': False,
                'error': 'Headers and data are required'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Get session info
        info = get_session_consistent(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Build canonical template headers (full set) using session counts
        tags_count = info.get('tags_count', 3)
        spec_pairs_count = info.get('spec_pairs_count', 3)
        customer_id_pairs_count = info.get('customer_id_pairs_count', 1)

        base_headers = [
            'Item code', 'Item name', 'Description', 'Item type', 'Measurement unit',
            'Procurement entity name', 'Notes', 'Internal notes', 'Procurement item', 'Sales item', 'Preferred vendor code'
        ]

        canonical_headers = []
        canonical_headers.extend(base_headers)
        for i in range(1, max(1, int(tags_count)) + 1):
            canonical_headers.append(f'Tag_{i}')
        for i in range(1, max(1, int(spec_pairs_count)) + 1):
            canonical_headers.append(f'Specification_Name_{i}')
            canonical_headers.append(f'Specification_Value_{i}')
        for i in range(1, max(1, int(customer_id_pairs_count)) + 1):
            canonical_headers.append(f'Custom_Identification_Name_{i}')
            canonical_headers.append(f'Custom_Identification_Value_{i}')

        # Prefer the fuller header set between session headers and canonical
        existing_headers = (
            info.get('current_template_headers') or
            info.get('enhanced_headers') or
            info.get('mapped_headers') or
            info.get('client_headers') or
            canonical_headers
        )
        # If still empty, attempt to derive from any existing data rows
        if not existing_headers:
            try:
                current_data = info.get('formula_enhanced_data') or info.get('mapped_data') or info.get('data')
                if current_data and isinstance(current_data, list):
                    if isinstance(current_data[0], dict):
                        existing_headers = list(current_data[0].keys())
            except Exception:
                existing_headers = canonical_headers

        # Build tolerant header mapping from uploaded headers to the current dataset's canonical headers.
        def _norm(h: str) -> str:
            try:
                s = str(h or '').strip().lower()
                s = s.replace('_', ' ')
                s = ' '.join(s.split())
                # Keep only alphanumerics and single spaces
                filtered = ''.join(ch for ch in s if ch.isalnum() or ch == ' ')
                return ' '.join(filtered.split())
            except Exception:
                return ''

        # Use the larger set to avoid losing dynamic columns
        chosen_headers = existing_headers or canonical_headers
        if len(chosen_headers) < len(canonical_headers):
            chosen_headers = canonical_headers
        canonical_headers = list(chosen_headers)
        # Map normalized canonical name -> canonical header
        canon_lookup = {_norm(h): h for h in canonical_headers}

        # Enumerated canonical targets (ordered by suffix) for generic incoming headers
        import re
        def _suffix_idx(name: str) -> int:
            try:
                m = re.search(r"(\d+)$", str(name or ''))
                return int(m.group(1)) if m else 0
            except Exception:
                return 0

        tag_targets = sorted([h for h in canonical_headers if isinstance(h, str) and h.strip().lower().startswith('tag_')], key=_suffix_idx)
        spec_name_targets = sorted([h for h in canonical_headers if isinstance(h, str) and _norm(h).startswith('specification name')], key=_suffix_idx)
        spec_value_targets = sorted([h for h in canonical_headers if isinstance(h, str) and _norm(h).startswith('specification value')], key=_suffix_idx)
        cust_name_targets = sorted([h for h in canonical_headers if isinstance(h, str) and _norm(h).startswith('custom identification name')], key=_suffix_idx)
        cust_value_targets = sorted([h for h in canonical_headers if isinstance(h, str) and _norm(h).startswith('custom identification value')], key=_suffix_idx)

        tag_i = 0
        specn_i = 0
        specv_i = 0
        custn_i = 0
        custv_i = 0

        # Build mapping from incoming header -> canonical header
        header_map = {}
        for h in headers:
            hn = _norm(h)
            mapped = None
            if hn in canon_lookup:
                mapped = canon_lookup[hn]
            elif hn == 'tag' and tag_i < len(tag_targets):
                mapped = tag_targets[tag_i]; tag_i += 1
            elif hn == 'specification name' and specn_i < len(spec_name_targets):
                mapped = spec_name_targets[specn_i]; specn_i += 1
            elif hn == 'specification value' and specv_i < len(spec_value_targets):
                mapped = spec_value_targets[specv_i]; specv_i += 1
            elif hn == 'custom identification name' and custn_i < len(cust_name_targets):
                mapped = cust_name_targets[custn_i]; custn_i += 1
            elif hn == 'custom identification value' and custv_i < len(cust_value_targets):
                mapped = cust_value_targets[custv_i]; custv_i += 1

            if mapped:
                header_map[h] = mapped

        matching_headers = sorted(set(header_map.values())) if header_map else []
        logger.info(f"📝 CORRECTION: Mapped {len(matching_headers)} headers to canonical; example: {matching_headers[:10]}")

        if not matching_headers:
            return Response({
                'success': False,
                'error': 'No matching headers found. Upload file must contain headers that exist in the current dataset.',
                'details': {
                    'received_headers': headers,
                    'expected_headers': existing_headers
                }
            }, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"🔄 Updating session {session_id} data with {len(data_rows)} rows and {len(matching_headers)} matching headers")

        # FULL REPLACE: Build new dataset strictly from uploaded rows
        # Normalize incoming rows using header_map first
        normalized_rows = []
        for r in data_rows:
            try:
                nr = {}
                for in_h, val in r.items():
                    mapped_h = header_map.get(in_h)
                    if not mapped_h:
                        # Fallback: direct canonical match by normalized name
                        nh = _norm(in_h)
                        mapped_h = canon_lookup.get(nh)
                    if mapped_h:
                        nr[mapped_h] = val
                normalized_rows.append(nr)
            except Exception:
                normalized_rows.append({})

        # Construct rows with all canonical headers in order and drop entirely blank rows
        updated_rows = []
        dropped_blank = 0
        for nr in normalized_rows:
            row_out = {h: nr.get(h, '') for h in canonical_headers}
            # Determine if the row is entirely blank (ignore whitespace and common placeholders)
            non_empty = False
            for v in row_out.values():
                s = '' if v is None else str(v).strip()
                if s and s.lower() not in ('none', 'null', 'nan'):
                    non_empty = True
                    break
            if non_empty:
                updated_rows.append(row_out)
            else:
                dropped_blank += 1
        logger.info(f"📝 CORRECTION: Built {len(updated_rows)} normalized rows with {len(canonical_headers)} canonical headers (dropped {dropped_blank} blank rows)")

        # Update session info: persist updated rows as the active dataset for Data Editor
        info['data'] = updated_rows
        # Make the corrected dataset the primary enhanced data source so Data Editor renders it immediately
        info['formula_enhanced_data'] = updated_rows
        info['enhanced_headers'] = canonical_headers
        # Clear any conflicting caches
        if 'mapped_data' in info:
            del info['mapped_data']

        # Mark correction mode to bypass cleanup and prefer enhanced data
        info['uploaded_via_correction'] = True
        logger.info(f"📝 CORRECTION: Session {session_id} saved with uploaded_via_correction=True; template_version will increment")

        # Update template version to trigger refresh
        info['template_version'] = info.get('template_version', 0) + 1

        # Save updated session
        save_session(session_id, info)

        logger.info(f"✅ Session {session_id} data updated successfully with {len(updated_rows)} rows")

        return Response({
            'success': True,
            'message': f'Data updated successfully. {len(matching_headers)} columns updated across {len(updated_rows)} rows.',
            'updated_rows': len(updated_rows),
            'updated_columns': len(matching_headers),
            'template_version': info['template_version']
        })

    except Exception as e:
        logger.error(f"Error updating session data: {e}")
        return Response({
            'success': False,
            'error': f'Failed to update session data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def health_check(request):
    """Health check endpoint."""
    return Response({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })

@api_view(['GET'])
def get_session_snapshot(request, session_id):
    """Get canonical snapshot of session state."""
    info = get_session(session_id)
    if not info:
        return no_store(Response({"success": False, "error": "Invalid session"}, status=400))
    return no_store(Response({"success": True, "snapshot": build_snapshot(info)}))


@api_view(['POST'])
def debug_session(request):
    """Debug endpoint to check session data."""
    session_id = request.data.get('session_id')
    if session_id in SESSION_STORE:
        session_data = SESSION_STORE[session_id].copy()
        # Remove sensitive file paths for security
        session_data.pop('client_path', None)
        session_data.pop('template_path', None)
        
        # Add extra debug info for mappings
        mappings = session_data.get('mappings')
        if mappings:
            logger.info(f"🔍 DEBUG Session {session_id} mappings: {mappings}")
            logger.info(f"🔍 DEBUG Mappings type: {type(mappings)}")
            if isinstance(mappings, dict):
                logger.info(f"🔍 DEBUG Mappings keys: {list(mappings.keys())}")
                if 'mappings' in mappings:
                    logger.info(f"🔍 DEBUG New format detected with {len(mappings['mappings'])} individual mappings")
                else:
                    logger.info(f"🔍 DEBUG Old format detected")
        
        return Response({'session_data': session_data})
    else:
        return Response({'error': 'Session not found'}, status=404)


def _is_user_confirmed_bom_structure(match):
    if not isinstance(match, dict):
        return False
    workflow = match.get('workflow') if isinstance(match.get('workflow'), dict) else {}
    source_signature = match.get('source_signature') if isinstance(match.get('source_signature'), dict) else {}
    return (
        bool(workflow.get('userTouched')) or
        bool(source_signature.get('userTouched')) or
        workflow.get('mappingSource') == 'user_confirmed' or
        source_signature.get('mappingSource') == 'user_confirmed'
    )


def _finalize_bom_inference_with_structure(inferred_result, learned_matches, request_config=None, min_structure_score=0.88):
    """Return the backend-authoritative roles/config for BOM Normalizer."""
    inferred_roles = inferred_result.get('roles') if isinstance(inferred_result, dict) else {}
    inferred_roles = inferred_roles if isinstance(inferred_roles, dict) else {}
    request_config = request_config if isinstance(request_config, dict) else {}
    eligible_matches = [
        match for match in (learned_matches or [])
        if isinstance(match, dict) and float(match.get('score') or 0) >= min_structure_score
    ]
    matched = next(
        (
            match for match in eligible_matches
            if _is_user_confirmed_bom_structure(match)
        ),
        eligible_matches[0] if eligible_matches else None,
    )
    learned_is_authoritative = _is_user_confirmed_bom_structure(matched)
    learned_roles = matched.get('resolved_roles') if matched else {}
    learned_roles = learned_roles if isinstance(learned_roles, dict) else {}

    final_roles = {}
    role_sources = {}
    for role in ROLE_KEYS:
        inferred_header = str(inferred_roles.get(role) or '').strip()
        learned_header = str(learned_roles.get(role) or '').strip()
        if learned_is_authoritative and learned_header:
            final_roles[role] = learned_header
            role_sources[role] = 'user_confirmed_structure'
        elif inferred_header:
            final_roles[role] = inferred_header
            role_sources[role] = 'inferred'
        elif learned_header:
            final_roles[role] = learned_header
            role_sources[role] = 'learned_structure'
        else:
            final_roles[role] = ''
            role_sources[role] = ''

    learned_config = matched.get('resolved_config') if matched else {}
    learned_config = learned_config if isinstance(learned_config, dict) else {}
    final_config = {
        **learned_config,
        **request_config,
    }

    return final_roles, final_config, matched, role_sources


@api_view(['POST'])
def bom_role_inference(request):
    """Infer BOM normalizer role mappings from headers and sampled row values."""
    try:
        headers = request.data.get('headers') or []
        rows = request.data.get('rows')
        if rows is None:
            rows = request.data.get('dataRows')
        if rows is None:
            rows = request.data.get('data') or []
        options = request.data.get('options') or {}
        if 'sampleSize' in request.data and 'sampleSize' not in options:
            options = {**options, 'sampleSize': request.data.get('sampleSize')}
        source_signature = request.data.get('sourceSignature') or request.data.get('source_signature') or {}
        config = request.data.get('config') or options.get('config') or {}

        if not isinstance(headers, list):
            return Response({
                'success': False,
                'error': 'headers must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rows, list):
            return Response({
                'success': False,
                'error': 'rows must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)

        result = infer_bom_roles(headers, rows, options=options)
        request_config = config if isinstance(config, dict) else {}
        learned_matches = match_bom_structures(
            headers=headers,
            rows=rows,
            roles=result.get('roles') or {},
            config=request_config,
            source_signature=source_signature if isinstance(source_signature, dict) else {},
            limit=3,
        ).get('matches', [])
        final_roles, final_config, applied_structure, role_sources = _finalize_bom_inference_with_structure(
            result,
            learned_matches,
            request_config=request_config,
        )
        inferred_roles = result.get('roles') or {}
        structure_profile = build_structure_profile(
            headers=headers,
            rows=rows,
            roles=final_roles,
            config=final_config,
            source_signature=source_signature if isinstance(source_signature, dict) else {},
        )
        response_payload = {
            **result,
            'roles': final_roles,
            'config': final_config,
            'inferredRoles': inferred_roles,
            'roleSources': role_sources,
            'appliedStructure': applied_structure,
            'structureProfile': structure_profile,
            'matchedStructures': learned_matches,
        }
        return Response({
            'success': True,
            **response_payload,
        })
    except Exception as exc:
        logger.error("BOM role inference failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def bom_field_pattern_inference(request):
    """Return backend-owned field pattern groups for the BOM Normalizer teach popup."""
    try:
        headers = request.data.get('headers') or []
        rows = request.data.get('rows')
        if rows is None:
            rows = request.data.get('dataRows')
        if rows is None:
            rows = request.data.get('data') or []
        roles = request.data.get('roles') or {}
        config = request.data.get('config') or {}
        selected_columns = request.data.get('selectedColumns') or request.data.get('selected_columns') or []
        options = request.data.get('options') or {}

        if not isinstance(headers, list):
            return Response({
                'success': False,
                'error': 'headers must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rows, list):
            return Response({
                'success': False,
                'error': 'rows must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(roles, dict):
            roles = {}
        if not isinstance(config, dict):
            config = {}
        if not isinstance(selected_columns, list):
            selected_columns = []
        if not isinstance(options, dict):
            options = {}

        result = build_bom_field_pattern_groups(
            headers=headers,
            rows=rows,
            roles=roles,
            config=config,
            selected_columns=selected_columns,
            options=options,
        )
        return Response({
            'success': True,
            **result,
        })
    except Exception as exc:
        logger.error("BOM field pattern inference failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def bom_normalize(request):
    """Return backend-authoritative normalized BOM rows."""
    try:
        headers = request.data.get('headers') or []
        rows = request.data.get('rows') or []
        roles = request.data.get('roles') or {}
        config = request.data.get('config') or {}
        if not isinstance(headers, list):
            return Response({'success': False, 'error': 'headers must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rows, list):
            return Response({'success': False, 'error': 'rows must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(roles, dict):
            roles = {}
        if not isinstance(config, dict):
            config = {}
        return Response({
            'success': True,
            **normalize_bom_rows(headers, rows, roles=roles, config=config),
        })
    except Exception as exc:
        logger.error("Backend BOM normalization failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def bom_field_pattern_apply(request):
    """Apply all confirmed semantic patterns and return one normalized preview."""
    try:
        headers = request.data.get('headers') or []
        rows = request.data.get('rows') or []
        roles = request.data.get('roles') or {}
        config = request.data.get('config') or {}
        groups = request.data.get('groups') or request.data.get('patterns') or []
        persist = request.data.get('persist', True) is not False
        if not isinstance(headers, list):
            return Response({'success': False, 'error': 'headers must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rows, list):
            return Response({'success': False, 'error': 'rows must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(roles, dict):
            roles = {}
        if not isinstance(config, dict):
            config = {}
        if not isinstance(groups, list):
            return Response({'success': False, 'error': 'groups must be a list'}, status=status.HTTP_400_BAD_REQUEST)

        unresolved = [
            group.get('patternKey') or group.get('id')
            for group in groups
            if isinstance(group, dict) and group.get('confirmed') is False
        ]
        if unresolved:
            return Response({
                'success': False,
                'error': 'Every detected pattern must be confirmed before it can be applied.',
                'unresolvedPatternKeys': unresolved,
            }, status=status.HTTP_400_BAD_REQUEST)

        learning = learn_confirmed_bom_field_patterns(groups) if persist else {
            'success': True,
            'saved_pattern_rules': [],
        }
        normalized = normalize_bom_rows(headers, rows, roles=roles, config=config)
        return Response({
            'success': True,
            **normalized,
            'learning': learning,
        })
    except Exception as exc:
        logger.error("BOM field pattern apply failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def bom_field_pattern_learning(request):
    """Persist user-confirmed MPN/MFR values from the teach popup."""
    try:
        groups = request.data.get('groups') or []
        if not isinstance(groups, list):
            return Response({
                'success': False,
                'error': 'groups must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)

        result = learn_confirmed_bom_field_patterns(groups)
        return Response(result)
    except Exception as exc:
        logger.error("BOM field pattern learning failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def bom_field_pattern_teaching(request):
    """Derive reusable parser rules from one user-corrected teach popup row."""
    try:
        headers = request.data.get('headers') or []
        row = request.data.get('row') or {}
        roles = request.data.get('roles') or {}
        entries = request.data.get('entries') or []
        group = request.data.get('group') or {}
        visual_pattern = request.data.get('visualPattern') or request.data.get('visual_pattern') or {}
        tagged_spans = request.data.get('taggedSpans') or request.data.get('tagged_spans')
        source_header = request.data.get('sourceHeader') or request.data.get('source_header') or ''
        alternate_delimiter = request.data.get('alternateDelimiter') or request.data.get('alternate_delimiter') or '/'
        alternate_mode = request.data.get('alternateMode') or request.data.get('alternate_mode') or 'append'
        ignored_fields = request.data.get('ignoredFields') or request.data.get('ignored_fields') or []
        has_manual_edits = request.data.get('hasManualEdits') is True or request.data.get('has_manual_edits') is True
        persist = request.data.get('persist', True)

        if not isinstance(headers, list):
            return Response({
                'success': False,
                'error': 'headers must be a list',
            }, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(row, dict):
            return Response({
                'success': False,
                'error': 'row must be an object',
            }, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(roles, dict):
            roles = {}
        if not isinstance(entries, list):
            entries = []
        if not isinstance(group, dict):
            group = {}
        if not isinstance(visual_pattern, dict):
            visual_pattern = {}

        teach_result = build_bom_field_pattern_teach_result(
            headers=headers,
            row=row,
            roles=roles,
            entries=entries,
            group=group,
            tagged_spans=tagged_spans,
            source_header=source_header,
            alternate_delimiter=alternate_delimiter,
            alternate_mode=alternate_mode,
            ignored_fields=ignored_fields,
            visual_pattern=visual_pattern,
            has_manual_edits=has_manual_edits,
        )
        rule = teach_result['rule']
        saved_rule = None
        if persist:
            saved_rule = save_bom_field_pattern_rule(
                rule,
                description='User-taught BOM field parser pattern',
            )
        return Response({
            'success': True,
            **teach_result,
            'saved_rule': saved_rule,
        })
    except Exception as exc:
        logger.error("BOM field pattern teaching failed: %s", exc, exc_info=True)
        return Response({
            'success': False,
            'error': str(exc),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_files(request):
    """
    Upload and process client and template files.
    Optimized for Excel to Excel mapping.
    """
    try:
        # Extract form data
        client_file = request.FILES.get('clientFile')
        template_file = request.FILES.get('templateFile')
        sheet_name = request.data.get('sheetName')
        header_row = int(request.data.get('headerRow', 1))
        default_template_metadata = get_sfo_template_metadata()
        template_sheet_name = request.data.get('templateSheetName') or default_template_metadata["template_sheet_name"]
        template_header_row = int(request.data.get('templateHeaderRow') or default_template_metadata["template_header_row"])
        use_template_id = request.data.get('useTemplateId')
        client_headers = []
        client_headers_json = request.data.get('clientHeaders')
        if client_headers_json:
            try:
                parsed_client_headers = json.loads(client_headers_json) if isinstance(client_headers_json, str) else client_headers_json
                if isinstance(parsed_client_headers, list):
                    client_headers = [str(header).strip() for header in parsed_client_headers if str(header).strip()]
            except (json.JSONDecodeError, TypeError, ValueError):
                logger.warning("Invalid clientHeaders JSON on upload; ignoring")
        
        # Extract formula rules if provided
        formula_rules_json = request.data.get('formulaRules')
        formula_rules = []
        if formula_rules_json:
            try:
                formula_rules = json.loads(formula_rules_json)
            except json.JSONDecodeError:
                logger.warning(f"Invalid formula rules JSON: {formula_rules_json}")

        # Answers from the BOM structure gate. Optional: PDFs and any caller that
        # skips the gate simply send nothing, and BOM generation treats a missing
        # value as "not asked yet" rather than "no BOM".
        bom_structure_json = request.data.get('bomStructure')
        bom_structure = None
        if bom_structure_json:
            if isinstance(bom_structure_json, dict):
                bom_structure = bom_structure_json
            else:
                try:
                    parsed = json.loads(bom_structure_json)
                    bom_structure = parsed if isinstance(parsed, dict) else None
                except (json.JSONDecodeError, TypeError):
                    logger.warning("Invalid bomStructure JSON on upload; ignoring")

        # Validation - the destination template is fixed to SFO Default Item.xlsx.
        if not client_file:
            return Response({
                'success': False,
                'error': 'Client file is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate file types
        allowed_extensions = ['.xlsx', '.xls', '.xlsm', '.csv']
        client_ext = Path(client_file.name).suffix.lower()
        
        if client_ext not in allowed_extensions:
            return Response({
                'success': False,
                'error': f'Only Excel (.xlsx, .xls, .xlsm) and CSV files are supported for client file'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if template_file:
            template_ext = Path(template_file.name).suffix.lower()
            if template_ext not in allowed_extensions:
                return Response({
                    'success': False,
                    'error': f'Only Excel (.xlsx, .xls, .xlsm) and CSV files are supported for template file'
                }, status=status.HTTP_400_BAD_REQUEST)

        # Save uploaded files
        client_path, client_original_name = hybrid_file_manager.save_upload_file(client_file, "client")
        if template_file:
            template_path, template_original_name = hybrid_file_manager.save_upload_file(template_file, "template")
        else:
            template_path = default_template_metadata["template_path"]
            template_original_name = default_template_metadata["original_template_name"]

        packed_cell_transform = _maybe_expand_packed_cell_upload(
            hybrid_file_manager.get_file_path(client_path),
            sheet_name,
            header_row
        )
        if packed_cell_transform:
            client_path = packed_cell_transform['client_path']
            sheet_name = packed_cell_transform['sheet_name']
            header_row = packed_cell_transform['header_row']
            client_headers = packed_cell_transform['client_headers']

        # Runs after the packed-cell pass so a file suffering both is handled in
        # the order it broke: split into columns first, then rejoined into rows.
        spilled_row_transform = _maybe_repair_spilled_rows_upload(
            hybrid_file_manager.get_file_path(client_path),
            sheet_name,
            header_row
        )
        if spilled_row_transform:
            client_path = spilled_row_transform['client_path']
            sheet_name = spilled_row_transform['sheet_name']
            header_row = spilled_row_transform['header_row']
            client_headers = spilled_row_transform['client_headers']

        template_packed_cell_transform = None
        if template_file:
            template_packed_cell_transform = _maybe_expand_packed_cell_upload(
                hybrid_file_manager.get_file_path(template_path),
                template_sheet_name,
                template_header_row
            )
            if template_packed_cell_transform:
                template_path = template_packed_cell_transform['client_path']
                template_sheet_name = template_packed_cell_transform['sheet_name']
                template_header_row = template_packed_cell_transform['header_row']

        # Generate session ID
        session_id = str(uuid.uuid4())

        template_headers = []
        try:
            mapper = BOMHeaderMapper()
            template_headers = mapper.read_excel_headers(
                file_path=hybrid_file_manager.get_file_path(template_path),
                sheet_name=template_sheet_name,
                header_row=template_header_row - 1 if template_header_row > 0 else 0
            )
        except Exception as template_header_error:
            logger.warning(f"Could not read SFO template headers during upload: {template_header_error}")

        if not template_headers and not template_file:
            template_headers = get_sfo_reference_headers()
            logger.info(f"Using built-in {SFO_TEMPLATE_NAME} reference headers during upload")

        default_counts = derive_sfo_column_counts(template_headers)
        clustered_template_headers = build_sfo_clustered_headers(
            template_headers,
            default_counts["tags_count"],
            default_counts["spec_pairs_count"],
            default_counts["customer_id_pairs_count"],
        )
        
        # Store session data using universal session saving
        session_data = {
            "client_path": client_path,
            "template_path": template_path,
            "original_client_name": client_original_name,
            "original_template_name": template_original_name,
            "sheet_name": sheet_name,
            "header_row": header_row,
            "client_headers": client_headers,
            "template_sheet_name": template_sheet_name,
            "template_header_row": template_header_row,
            "template_headers": clustered_template_headers or template_headers,
            "current_template_headers": clustered_template_headers or template_headers,
            "enhanced_headers": clustered_template_headers or template_headers,
            "created": timezone.now().isoformat(),
            "mappings": None,
            "edited_data": None,
            "original_template_id": None,
            "template_modified": False,
            "formula_rules": formula_rules if formula_rules else [],
            "tags_count": default_counts["tags_count"],
            "spec_pairs_count": default_counts["spec_pairs_count"],
            "customer_id_pairs_count": default_counts["customer_id_pairs_count"],
            "column_counts": default_counts,
            "template_source": "uploaded" if template_file else "default",
            "source_transforms": [packed_cell_transform["source_transform"]] if packed_cell_transform else [],
            "template_transforms": [template_packed_cell_transform["source_transform"]] if template_packed_cell_transform else [],
            # Answers from the BOM structure gate on the upload page: which
            # sheets hold a BOM, whether they have levels, and the finished good
            # authored for flat sheets. BOM generation reads this instead of
            # re-asking, so it has to survive a page reload.
            "bom_structure": bom_structure,
        }
        
        # Save session with universal persistence (critical for multi-worker environments)
        save_session(session_id, session_data)
        
        # Apply template if specified
        template_applied = False
        template_success = False
        applied_mappings = {}
        applied_formulas = False
        
        if use_template_id:
            try:
                template = MappingTemplate.objects.get(id=int(use_template_id))
                
                # Read client headers to apply template
                mapper = BOMHeaderMapper()
                client_headers = mapper.read_excel_headers(
                    file_path=hybrid_file_manager.get_file_path(client_path),
                    sheet_name=sheet_name,
                    header_row=header_row - 1 if header_row > 0 else 0
                )
                
                # Apply template mappings
                application_result = template.apply_to_headers(client_headers)
                
                if application_result['total_mapped'] > 0:
                    template_applied = True
                    template_success = True  # Consider success if any mappings work
                    applied_mappings = application_result['mappings']  # Old format
                    
                    # Use new format if available (preserves duplicates)
                    if 'mappings_new_format' in application_result and application_result['mappings_new_format']:
                        total_applied = application_result['total_mappings_with_duplicates']
                        new_format_mappings = {
                            "mappings": application_result['mappings_new_format']
                        }
                        logger.info(f"✅ Template applied successfully with {total_applied} mappings (including duplicates)")
                    else:
                        # Fallback to old format conversion
                        total_applied = application_result['total_mapped']
                        new_format_mappings = {
                            "mappings": [
                                {"source": source_col, "target": template_col}
                                for template_col, source_col in applied_mappings.items()
                            ]
                        }
                        logger.info(f"✅ Template applied successfully with {total_applied} mappings")
                    
                    # Update session with applied mappings
                    SESSION_STORE[session_id]["original_template_id"] = int(use_template_id)
                    SESSION_STORE[session_id]["mappings"] = new_format_mappings

                    # Conditional default rules must land on the session before the
                    # grid is built — apply_column_mappings runs them from there.
                    template_default_value_rules = getattr(template, 'default_value_rules', {}) or {}
                    if template_default_value_rules:
                        SESSION_STORE[session_id]["default_value_rules"] = template_default_value_rules

                    # The gate's answers travel with the template. Answers sent
                    # with this upload win — the user just gave them for this
                    # file, so they describe it better than a saved default.
                    template_bom_structure = getattr(template, 'bom_structure', None) or {}
                    if template_bom_structure and not SESSION_STORE[session_id].get("bom_structure"):
                        SESSION_STORE[session_id]["bom_structure"] = template_bom_structure
                        logger.info(f"Applied BOM structure from template {use_template_id}")
                    logger.info(f"🔄 Converted {len(applied_mappings)} unique mappings from template application")

                    # Restore defaults before building the mapped grid. The normal
                    # processing-template flow applies its mapping during upload,
                    # whereas the manual template endpoint applies it later. This
                    # path used to store defaults only after mapping, leaving the
                    # editor full of blanks even though the template contained the
                    # values selected in the import-warning dialog.
                    template_default_values = getattr(template, 'default_values', {}) or {}
                    if template_default_values:
                        SESSION_STORE[session_id]["default_values"] = template_default_values

                    template_factwise_rules = getattr(template, 'factwise_rules', []) or []
                    if template_factwise_rules:
                        SESSION_STORE[session_id]["factwise_rules"] = template_factwise_rules

                    # Materialize the mapped grid for every upload-time template
                    # application. Formula-free templates previously deferred this
                    # until the editor loaded, which also meant saved Fill/Create
                    # Column rules had no grid on which to run.
                    mapping_result = apply_column_mappings(
                        client_file=client_path,
                        mappings=new_format_mappings,
                        sheet_name=sheet_name,
                        header_row=header_row - 1 if header_row > 0 else 0,
                        session_id=session_id
                    )
                    SESSION_STORE[session_id]["mapped_data"] = mapping_result['data']
                    SESSION_STORE[session_id]["mapped_headers"] = mapping_result['headers']
                    SESSION_STORE[session_id]["formula_enhanced_data"] = mapping_result['data']
                    SESSION_STORE[session_id]["enhanced_headers"] = mapping_result['headers']

                    # Apply formula rules if they exist (from template or Step 3)
                    template_formula_rules = getattr(template, 'formula_rules', []) or []
                    
                    # CRITICAL FIX: Deduplicate rules to prevent duplicate columns
                    def _rule_signature(rule):
                        """Create a unique signature for a rule to identify duplicates."""
                        tgt = (rule.get('target_column') or '').strip().lower()
                        ctype = (rule.get('column_type') or '').strip().lower()
                        spec = (rule.get('specification_name') or '').strip().lower()
                        subs = rule.get('sub_rules') or []
                        norm = []
                        for sr in subs:
                            s = (sr.get('search_text') or '').strip().lower()
                            o = (sr.get('output_value') or sr.get('tag_value') or '').strip().lower()
                            cs = bool(sr.get('case_sensitive'))
                            norm.append((s, o, cs))
                        # order-insensitive signature
                        return (ctype, tgt, spec, tuple(sorted(norm)))
                    
                    combined_formula_rules = []
                    seen_signatures = set()
                    for r in (template_formula_rules or []) + (formula_rules or []):
                        if not r:
                            continue
                        sig = _rule_signature(r)
                        if sig in seen_signatures:
                            continue
                        seen_signatures.add(sig)
                        combined_formula_rules.append(r)
                    
                    if combined_formula_rules:
                        SESSION_STORE[session_id]["formula_rules"] = combined_formula_rules

                        # Convert to dict format for formula processing
                        dict_rows = []
                        for row_list in mapping_result['data']:
                            row_dict = {}
                            for i, header in enumerate(mapping_result['headers']):
                                if i < len(row_list):
                                    row_dict[header] = row_list[i]
                                else:
                                    row_dict[header] = ""
                            dict_rows.append(row_dict)
                        
                        # Apply formula rules to create enhanced data
                        formula_result = apply_formula_rules(
                            data_rows=dict_rows,
                            headers=mapping_result['headers'],
                            formula_rules=combined_formula_rules,
                            session_info=SESSION_STORE[session_id]
                        )
                        
                        # Store enhanced data in session
                        SESSION_STORE[session_id]["formula_enhanced_data"] = formula_result['data']
                        SESSION_STORE[session_id]["enhanced_headers"] = formula_result['headers']
                        applied_formulas = True

                    # Apply factwise rules if they exist
                    if template_factwise_rules:
                        # Fill/Create Column rules are what the warning dialog's
                        # "Use Fill Column" route saves. The upload-time template
                        # path previously handled only legacy factwise_id rules, so
                        # these rules were present in the template but never ran.
                        column_rules = [
                            rule for rule in template_factwise_rules
                            if rule.get("type") == "column_value"
                        ]
                        if column_rules:
                            current_data = (
                                SESSION_STORE[session_id].get("formula_enhanced_data")
                                or SESSION_STORE[session_id].get("mapped_data")
                                or []
                            )
                            current_headers = list(
                                SESSION_STORE[session_id].get("enhanced_headers")
                                or SESSION_STORE[session_id].get("mapped_headers")
                                or []
                            )
                            positional_rows = []
                            for row in current_data:
                                if isinstance(row, dict):
                                    positional_rows.append([row.get(header, '') for header in current_headers])
                                else:
                                    positional_rows.append(list(row))

                            for column_rule in column_rules:
                                current_headers, positional_rows, _changed = apply_column_value_rule(
                                    current_headers,
                                    positional_rows,
                                    column_rule
                                )

                            SESSION_STORE[session_id]["formula_enhanced_data"] = positional_rows
                            SESSION_STORE[session_id]["enhanced_headers"] = current_headers
                            SESSION_STORE[session_id]["current_template_headers"] = current_headers

                        # Apply each factwise rule with error handling
                        for rule in template_factwise_rules:
                            try:
                                if rule.get("type") == "factwise_id":
                                    first_column = rule.get("first_column")
                                    second_column = rule.get("second_column")
                                    operator = rule.get("operator", "_")
                                
                                    if first_column and second_column:
                                        # Get current data (either formula-enhanced or basic mapped)
                                        current_data = SESSION_STORE[session_id].get("formula_enhanced_data")
                                        current_headers = SESSION_STORE[session_id].get("enhanced_headers")
                                        
                                        if not current_data:
                                            # Use basic mapped data if no formula data exists
                                            mapping_result = apply_column_mappings(
                                                client_file=client_path,
                                                mappings=new_format_mappings,
                                                sheet_name=sheet_name,
                                                header_row=header_row - 1 if header_row > 0 else 0,
                                                session_id=session_id
                                            )
                                            current_data = mapping_result['data']
                                            current_headers = mapping_result['headers']
                                        
                                        # Check if required columns exist for Factwise ID
                                        if first_column not in current_headers:
                                            logger.warning(f"🆔 Factwise ID: First column '{first_column}' not found in headers: {current_headers}")
                                            continue  # Skip this factwise rule
                                        
                                        if second_column not in current_headers:
                                            logger.warning(f"🆔 Factwise ID: Second column '{second_column}' not found in headers: {current_headers}")
                                            continue  # Skip this factwise rule

                                        # Apply Factwise ID creation and map it to 'Item code' column
                                        first_col_idx = current_headers.index(first_column)
                                        second_col_idx = current_headers.index(second_column)

                                        # Determine target 'Item code' index; add if missing
                                        item_code_idx = None
                                        if "Item code" in current_headers:
                                            item_code_idx = current_headers.index("Item code")
                                            new_headers = list(current_headers)
                                            new_data_rows = []
                                        else:
                                            # Prepend 'Item code' if not present
                                            new_headers = ["Item code"] + list(current_headers)
                                            item_code_idx = 0
                                            new_data_rows = []

                                        if first_col_idx >= 0 and second_col_idx >= 0:
                                            for row in current_data:
                                                first_val = str(row[first_col_idx] if first_col_idx < len(row) else "").strip()
                                                second_val = str(row[second_col_idx] if second_col_idx < len(row) else "").strip()

                                                if first_val and second_val:
                                                    factwise_id = f"{first_val}{operator}{second_val}"
                                                elif first_val:
                                                    factwise_id = first_val
                                                elif second_val:
                                                    factwise_id = second_val
                                                else:
                                                    factwise_id = ""

                                                # Place into Item code column, adjusting row shape if we had to prepend
                                                if "Item code" in current_headers:
                                                    new_row = list(row)
                                                    # Ensure row length
                                                    while len(new_row) < len(new_headers):
                                                        new_row.append("")
                                                    new_row[item_code_idx] = factwise_id
                                                else:
                                                    new_row = [factwise_id] + list(row)

                                                new_data_rows.append(new_row)

                                            # Update session with Item code-enhanced data
                                            SESSION_STORE[session_id]["formula_enhanced_data"] = new_data_rows
                                            SESSION_STORE[session_id]["enhanced_headers"] = new_headers

                                            logger.info(f"🆔 Applied Factwise ID rule (mapped to 'Item code') from template during upload: {first_column} {operator} {second_column}")
                            except Exception as factwise_error:
                                logger.warning(f"🆔 Failed to apply Factwise ID rule during upload: {factwise_error}")
                                # Continue with other rules even if this one fails
                    
                    # Increment template usage
                    template.increment_usage()
                
            except Exception as e:
                import traceback
                logger.error(f"Template application failed: {e}")
                logger.error(f"Template application traceback: {traceback.format_exc()}")
                template_applied = True
                template_success = False

        # Template application mutates SESSION_STORE after the initial session save.
        # Persist the updated mappings/formulas before the editor opens, otherwise
        # another worker can read the stale snapshot with mappings=None.
        try:
            if session_id in SESSION_STORE:
                save_session(session_id, SESSION_STORE[session_id])
        except Exception as persist_error:
            logger.warning(f"Could not persist post-upload session {session_id}: {persist_error}")
        
        logger.info(f"Files uploaded successfully for session {session_id}")
        
        return Response({
            'success': True,
            'session_id': session_id,
            'message': 'Files uploaded successfully',
            'template_applied': template_applied,
            'template_success': template_success,
            'applied_mappings': applied_mappings,
            'applied_formulas': applied_formulas
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        logger.error(f"Error in upload_files: {e}")
        return Response({
            'success': False,
            'error': f'Upload failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def apply_sheet_join(request):
    """Expand/enrich a client workbook sheet with detail rows from another sheet."""
    try:
        session_id = request.data.get('session_id')
        base_sheet = request.data.get('base_sheet')
        detail_sheet = request.data.get('detail_sheet')
        base_key = request.data.get('base_key')
        detail_key = request.data.get('detail_key')
        # Kept in sync with SHEET_JOIN_IGNORE_OPTIONS in UploadFiles.js.
        raw_ignore = request.data.get('ignore_chars')
        ignore_chars = set(raw_ignore if isinstance(raw_ignore, list) else ['space'])
        ignore_patterns = [
            pattern for key, pattern in (
                ('space', r'\s+'),
                ('hyphen', r'-'),
                ('comma', r','),
                ('semicolon', r';'),
                ('apostrophe', r"['\u2018\u2019`]"),
                ('dot', r'\.'),
                ('slash', r'[/\\\\]'),
                ('underscore', r'_'),
            ) if key in ignore_chars
        ]
        detail_columns = request.data.get('detail_columns') or []
        output_mode = request.data.get('output_mode') or 'grouped'
        relationship_name = str(request.data.get('relationship_name') or '').strip()
        copied_base_columns = request.data.get('copied_base_columns') or []
        unique_id_mode = request.data.get('unique_id_mode') or 'auto'
        unique_id_base_column = request.data.get('unique_id_base_column') or base_key
        unique_id_detail_column = request.data.get('unique_id_detail_column') or ''
        unique_id_pattern = request.data.get('unique_id_pattern') or '{base}_{detail}'
        base_header_row = int(request.data.get('base_header_row') or 1)
        detail_header_row = int(request.data.get('detail_header_row') or 1)

        if not all([session_id, base_sheet, detail_sheet, base_key, detail_key]):
            return Response({
                'success': False,
                'error': 'session_id, base/detail sheets, and key columns are required'
            }, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        preview_headers = request.data.get('preview_headers') or []
        preview_rows = request.data.get('preview_rows') or []
        if isinstance(preview_headers, list) and isinstance(preview_rows, list) and preview_headers and preview_rows:
            output_df = pd.DataFrame(preview_rows)
            output_df = output_df.reindex(columns=[str(header) for header in preview_headers], fill_value='')

            upload_dir = getattr(hybrid_file_manager, 'local_upload_dir', Path(settings.BASE_DIR) / 'uploaded_files')
            upload_dir = Path(upload_dir)
            upload_dir.mkdir(parents=True, exist_ok=True)
            joined_filename = f"{uuid.uuid4()}_sheet_join_preview.xlsx"
            joined_path = upload_dir / joined_filename
            output_df.to_excel(joined_path, index=False, sheet_name='Sheet_Joined')

            info['client_path'] = str(joined_path)
            info['sheet_name'] = 'Sheet_Joined'
            info['header_row'] = 1
            info['client_headers'] = [str(header) for header in preview_headers]
            info['sheet_join'] = {
                'base_sheet': base_sheet,
                'detail_sheet': detail_sheet,
                'base_key': base_key,
                'detail_key': detail_key,
                'detail_columns': detail_columns,
                'output_mode': output_mode,
                'relationship_name': relationship_name,
                'copied_base_columns': copied_base_columns,
                'unique_id_mode': unique_id_mode,
                'unique_id_base_column': unique_id_base_column,
                'unique_id_detail_column': unique_id_detail_column,
                'unique_id_pattern': unique_id_pattern,
                'used_preview_rows': True,
            }
            info.pop('formula_enhanced_data', None)
            info.pop('enhanced_data', None)
            info.pop('edited_data', None)
            info.pop('enhanced_headers', None)
            info.pop('current_template_headers', None)
            save_session(session_id, info)

            return Response({
                'success': True,
                'headers': [str(header) for header in preview_headers],
                'rows': len(preview_rows),
                'matched_base_rows': None,
                'unmatched_base_rows': None,
                'expanded_rows': len(preview_rows),
                'orphan_detail_keys': None,
            })

        client_path = hybrid_file_manager.get_file_path(info['client_path'])
        if str(client_path).lower().endswith('.csv'):
            return Response({
                'success': False,
                'error': 'Sheet comparison requires an Excel workbook with multiple sheets'
            }, status=status.HTTP_400_BAD_REQUEST)

        base_df = pd.read_excel(client_path, sheet_name=base_sheet, header=max(0, base_header_row - 1), dtype=object)
        detail_df = pd.read_excel(client_path, sheet_name=detail_sheet, header=max(0, detail_header_row - 1), dtype=object)
        base_df = base_df.fillna('')
        detail_df = detail_df.fillna('')

        base_df.columns = [str(c).strip() for c in base_df.columns]
        detail_df.columns = [str(c).strip() for c in detail_df.columns]

        if base_key not in base_df.columns:
            return Response({'success': False, 'error': f'Base key column "{base_key}" not found'}, status=status.HTTP_400_BAD_REQUEST)
        if detail_key not in detail_df.columns:
            return Response({'success': False, 'error': f'Detail key column "{detail_key}" not found'}, status=status.HTTP_400_BAD_REQUEST)

        if not detail_columns:
            detail_columns = [c for c in detail_df.columns if c != detail_key]
        detail_columns = [c for c in detail_columns if c in detail_df.columns and c != detail_key]
        if not detail_columns:
            return Response({'success': False, 'error': 'Select at least one column from the second sheet'}, status=status.HTTP_400_BAD_REQUEST)

        base_headers = list(base_df.columns)
        copied_base_columns = [c for c in copied_base_columns if c in base_headers]
        if not copied_base_columns:
            copied_base_columns = base_headers
        if unique_id_base_column not in base_headers:
            unique_id_base_column = base_key
        if unique_id_detail_column not in detail_df.columns:
            unique_id_detail_column = detail_columns[0] if detail_columns else detail_key

        def norm_key(value):
            if value is None:
                return ''
            try:
                if pd.isna(value):
                    return ''
            except Exception:
                pass
            if isinstance(value, float) and math.isfinite(value) and value.is_integer():
                value = int(value)
            text = unicodedata.normalize('NFKC', str(value))
            text = re.sub(r'[\u200B-\u200D\uFEFF]', '', text)
            text = text.replace('\u00a0', ' ')
            text = re.sub(r'[‐‑‒–—−]', '-', text)
            text = re.sub(r"^'", '', text)
            text = re.sub(r'\.0+$', '', text)
            # The user says which punctuation is formatting and which is
            # identity - a space usually the former, a hyphen often the only
            # thing separating two variants. Must strip exactly the set the
            # UI stripped when it built the preview, or the applied join
            # matches a different set of rows than the one shown.
            for pattern in ignore_patterns:
                text = re.sub(pattern, '', text)
            if 'space' not in ignore_chars:
                text = re.sub(r'\s+', ' ', text).strip()
            return text.lower()

        def clean_value(value):
            if pd.isna(value):
                return ''
            return str(value).strip()

        def unique_non_empty(values):
            seen = set()
            cleaned = []
            for value in values:
                value = clean_value(value)
                if value and value not in seen:
                    cleaned.append(value)
                    seen.add(value)
            return cleaned

        def unique_output_name(name, existing):
            candidate = name
            suffix = 2
            while candidate in existing:
                candidate = f'{name} {suffix}'
                suffix += 1
            return candidate

        def make_unique_id(base_row, detail_row):
            base_value = clean_value(base_row.get(unique_id_base_column, ''))
            detail_value = clean_value(detail_row.get(unique_id_detail_column, '')) if detail_row is not None else ''
            if unique_id_mode == 'custom':
                return unique_id_pattern.replace('{base}', base_value).replace('{detail}', detail_value).strip('_- ')
            return f'{base_value}_{detail_value}'.strip('_- ')

        # Detail rows that are identical across every column being brought over
        # are collapsed to one.
        #
        # A manufacturer sheet is usually keyed per (assembly, part), not per
        # part: a part used in two assemblies is listed twice with the SAME
        # manufacturer part. Joining on part number then hands that part two
        # "manufacturers" which are the same manufacturer, so the second becomes
        # an alternate of the first — the part offered as a substitute for
        # itself, which FactWise rejects with "alternate is primary".
        #
        # Compared on the joined columns ONLY. Two rows differing just in a
        # column nobody is bringing over (the assembly they belong to) are the
        # same fact repeated; two rows differing in a joined column are genuine
        # alternates and both survive. Applied's MFG sheet: 98 rows, exactly one
        # redundant pair.
        detail_lookup = defaultdict(list)
        detail_seen = defaultdict(set)
        duplicate_detail_rows = 0
        for _, detail_row in detail_df.iterrows():
            key = norm_key(detail_row.get(detail_key, ''))
            if not key:
                continue
            signature = tuple(norm_key(detail_row.get(col, '')) for col in detail_columns)
            # An all-blank detail row carries nothing, so collapsing repeats of
            # it is right too — but only against other all-blank rows.
            if signature in detail_seen[key]:
                duplicate_detail_rows += 1
                continue
            detail_seen[key].add(signature)
            detail_lookup[key].append(detail_row)
        if duplicate_detail_rows:
            logger.info(
                f"SHEET JOIN: collapsed {duplicate_detail_rows} duplicate detail row(s) "
                f"— identical across the joined columns"
            )

        output_headers = list(base_headers)
        unique_id_col = 'Generated Row ID'
        detail_header_map = {}
        if output_mode == 'grouped':
            for col in detail_columns:
                out_col = relationship_name if relationship_name and len(detail_columns) == 1 else col
                if out_col in output_headers:
                    out_col = f'{out_col} (related)'
                out_col = unique_output_name(out_col, output_headers)
                detail_header_map[col] = out_col
                output_headers.append(out_col)
        else:
            for col in detail_columns:
                out_col = col
                if out_col in output_headers:
                    out_col = f'{col} (detail)'
                out_col = unique_output_name(out_col, output_headers)
                detail_header_map[col] = out_col
                output_headers.append(out_col)

        if output_mode == 'expanded':
            unique_id_col = unique_output_name(unique_id_col, output_headers)
            output_headers.insert(0, unique_id_col)

        output_rows = []
        matched_base_rows = 0
        unmatched_base_rows = 0
        expanded_rows = 0
        matched_detail_keys = set()

        for _, base_row in base_df.iterrows():
            base_key_value = norm_key(base_row.get(base_key, ''))
            matches = detail_lookup.get(base_key_value, []) if base_key_value else []

            if matches:
                matched_base_rows += 1
                matched_detail_keys.add(base_key_value)
                if output_mode == 'grouped':
                    row = {h: base_row.get(h, '') for h in base_headers}
                    for detail_col, out_col in detail_header_map.items():
                        row[out_col] = ' | '.join(unique_non_empty([detail_row.get(detail_col, '') for detail_row in matches]))
                    output_rows.append(row)
                    expanded_rows += 1
                else:
                    for match_index, detail_row in enumerate(matches):
                        row = {h: base_row.get(h, '') if (h in copied_base_columns or match_index == 0) else '' for h in base_headers}
                        row[unique_id_col] = make_unique_id(base_row, detail_row)
                        for detail_col, out_col in detail_header_map.items():
                            row[out_col] = detail_row.get(detail_col, '')
                        output_rows.append(row)
                        expanded_rows += 1
            else:
                unmatched_base_rows += 1
                row = {h: base_row.get(h, '') for h in base_headers}
                if output_mode == 'expanded':
                    row[unique_id_col] = make_unique_id(base_row, None)
                for out_col in detail_header_map.values():
                    row[out_col] = ''
                output_rows.append(row)

        detail_keys = {norm_key(v) for v in detail_df[detail_key].tolist() if norm_key(v)}
        orphan_detail_keys = detail_keys - {norm_key(v) for v in base_df[base_key].tolist() if norm_key(v)}

        output_df = pd.DataFrame(output_rows, columns=output_headers)
        upload_dir = getattr(hybrid_file_manager, 'local_upload_dir', Path(settings.BASE_DIR) / 'uploaded_files')
        upload_dir = Path(upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        joined_filename = f"{uuid.uuid4()}_sheet_join.xlsx"
        joined_path = upload_dir / joined_filename
        output_df.to_excel(joined_path, index=False, sheet_name='Sheet_Joined')

        info['client_path'] = str(joined_path)
        info['sheet_name'] = 'Sheet_Joined'
        info['header_row'] = 1
        info['client_headers'] = list(output_headers)
        info['sheet_join'] = {
            'base_sheet': base_sheet,
            'detail_sheet': detail_sheet,
            'base_key': base_key,
            'detail_key': detail_key,
            'detail_columns': detail_columns,
            'output_mode': output_mode,
            'relationship_name': relationship_name,
            'copied_base_columns': copied_base_columns,
            'unique_id_mode': unique_id_mode,
            'unique_id_base_column': unique_id_base_column,
            'unique_id_detail_column': unique_id_detail_column,
            'unique_id_pattern': unique_id_pattern,
            'matched_base_rows': matched_base_rows,
            'unmatched_base_rows': unmatched_base_rows,
            'expanded_rows': expanded_rows,
            'orphan_detail_keys': len(orphan_detail_keys),
        }
        info.pop('formula_enhanced_data', None)
        info.pop('enhanced_data', None)
        info.pop('edited_data', None)
        info.pop('enhanced_headers', None)
        info.pop('current_template_headers', None)
        save_session(session_id, info)

        return Response({
            'success': True,
            'headers': output_headers,
            'rows': len(output_rows),
            'matched_base_rows': matched_base_rows,
            'unmatched_base_rows': unmatched_base_rows,
            'expanded_rows': expanded_rows,
            'orphan_detail_keys': len(orphan_detail_keys),
        })
    except Exception as e:
        logger.error(f"Sheet join failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def cleanup_rows(request):
    """
    Remove rows where the primary column is empty.
    Overwrites the client file so all downstream processing uses clean data.
    """
    try:
        session_id = request.data.get('session_id')
        primary_column = request.data.get('primary_column')

        if not session_id or not primary_column:
            return Response({'success': False, 'error': 'session_id and primary_column required'}, status=400)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Session not found'}, status=404)

        client_path = hybrid_file_manager.get_file_path(info['client_path'])
        sheet_name = info.get('sheet_name')
        header_row = info.get('header_row', 1)
        actual_header_row = header_row - 1 if header_row > 0 else 0
        ext = Path(str(client_path)).suffix.lower()
        is_pdf_session = str(info.get('source_type', '')).startswith('pdf')

        deleted_rows_preview = []  # Store deleted row data for user review

        if is_pdf_session and not os.path.exists(str(client_path)):
            try:
                pdf_session = PDFSession.objects.get(session_id=session_id)
                pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                if not pdf_extraction:
                    return Response({'success': False, 'error': 'PDF extraction data not found for cleanup'}, status=400)

                pdf_headers = list(pdf_extraction.extracted_headers or info.get('client_headers') or [])
                pdf_rows = pdf_extraction.extracted_data or []
                restored_df = pd.DataFrame(pdf_rows)

                if restored_df.empty and not pdf_rows:
                    return Response({'success': False, 'error': 'PDF extracted rows not found for cleanup'}, status=400)

                if pdf_headers:
                    if len(pdf_headers) < restored_df.shape[1]:
                        pdf_headers.extend([f'Column_{i+1}' for i in range(len(pdf_headers), restored_df.shape[1])])
                    while restored_df.shape[1] < len(pdf_headers):
                        restored_df[restored_df.shape[1]] = ''
                    restored_df = restored_df.iloc[:, :len(pdf_headers)]
                    restored_df.columns = pdf_headers[:restored_df.shape[1]]

                hybrid_file_manager.local_temp_dir.mkdir(parents=True, exist_ok=True)
                rebuilt_path = hybrid_file_manager.local_temp_dir / f"pdf_client_{session_id}.csv"
                restored_df.to_csv(str(rebuilt_path), index=False, header=False)
                info['client_path'] = str(rebuilt_path)
                if pdf_headers:
                    info['client_headers'] = pdf_headers
                client_path = rebuilt_path
                ext = '.csv'
                logger.info(f"CLEANUP: Rebuilt missing PDF client CSV for {session_id}: {rebuilt_path}")
            except Exception as e:
                logger.error(f"CLEANUP: Could not rebuild missing PDF client CSV for {session_id}: {e}")
                return Response({'success': False, 'error': f'Could not rebuild PDF data for cleanup: {str(e)}'}, status=500)

        if ext == '.csv':
            # CSV handling. PDF extraction CSVs are intentionally saved without
            # headers, so use PDFExtractionResult/session headers instead.
            if is_pdf_session:
                pdf_headers = info.get('client_headers') or []
                try:
                    pdf_session = PDFSession.objects.get(session_id=session_id)
                    pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                    if pdf_extraction and pdf_extraction.extracted_headers:
                        pdf_headers = pdf_extraction.extracted_headers
                except Exception as e:
                    logger.warning(f"CLEANUP: Could not load PDF extraction headers for {session_id}: {e}")

                if not pdf_headers:
                    return Response({'success': False, 'error': 'PDF extracted headers not found for cleanup'}, status=400)

                df = pd.read_csv(str(client_path), header=None, dtype=str, keep_default_na=False)
                if len(pdf_headers) < df.shape[1]:
                    pdf_headers = list(pdf_headers) + [f'Column_{i+1}' for i in range(len(pdf_headers), df.shape[1])]
                df = df.iloc[:, :len(pdf_headers)]
                df.columns = pdf_headers[:df.shape[1]]
            else:
                df = read_csv_with_encoding(str(client_path), actual_header_row)

            if primary_column not in df.columns:
                return Response({'success': False, 'error': f'Column "{primary_column}" not found'}, status=400)

            total_before = len(df)
            mask = df[primary_column].notna() & (df[primary_column].astype(str).str.strip() != '')
            df_deleted = df[~mask]
            df_clean = df[mask].reset_index(drop=True)
            rows_deleted = total_before - len(df_clean)

            # Capture deleted rows with original row numbers (1-based, after header)
            csv_headers = list(df.columns)
            original_row_base = 1 if is_pdf_session else actual_header_row + 2
            for orig_idx, row in df_deleted.iterrows():
                row_dict = {'_original_row': int(orig_idx) + original_row_base}
                for col in csv_headers[:10]:  # First 10 columns max
                    val = row[col]
                    row_dict[str(col)] = str(val) if pd.notna(val) and str(val).strip() else ''
                deleted_rows_preview.append(row_dict)

            df_clean.to_csv(str(client_path), index=False, header=not is_pdf_session)
        else:
            # Excel handling.
            # Use pandas to read so both .xlsx (openpyxl) and legacy .xls (xlrd)
            # are supported. Read with header=None to preserve every raw row
            # (including any rows above the header) exactly as the old openpyxl
            # path did with iter_rows(values_only=True).
            read_kwargs = {'header': None}
            if sheet_name:
                read_kwargs['sheet_name'] = sheet_name
            raw_df = pd.read_excel(str(client_path), **read_kwargs)

            all_rows = [tuple(row) for row in raw_df.itertuples(index=False, name=None)]
            if len(all_rows) <= actual_header_row:
                return Response({'success': False, 'error': 'No data rows found'}, status=400)

            def _cell(v):
                # Normalise NaN/None so downstream checks and writes stay clean.
                return None if v is None or (isinstance(v, float) and pd.isna(v)) else v

            headers = [str(_cell(h)) if _cell(h) is not None else f'Column_{i}'
                       for i, h in enumerate(all_rows[actual_header_row])]
            if primary_column not in headers:
                return Response({'success': False, 'error': f'Column "{primary_column}" not found in headers: {headers[:10]}'}, status=400)

            col_idx = headers.index(primary_column)
            header_rows = all_rows[:actual_header_row + 1]
            data_rows = all_rows[actual_header_row + 1:]
            total_before = len(data_rows)

            kept_rows = []
            for row_num, row in enumerate(data_rows):
                val = _cell(row[col_idx]) if col_idx < len(row) else None
                if val is not None and str(val).strip() != '':
                    kept_rows.append(row)
                else:
                    # Capture deleted row with original row number
                    row_dict = {'_original_row': actual_header_row + 2 + row_num}  # 1-based Excel row
                    for i, h in enumerate(headers[:10]):  # First 10 columns max
                        cell_val = _cell(row[i]) if i < len(row) else None
                        row_dict[h] = str(cell_val) if cell_val is not None and str(cell_val).strip() else ''
                    deleted_rows_preview.append(row_dict)

            rows_deleted = total_before - len(kept_rows)

            # Rewrite the Excel file. openpyxl can only write .xlsx, so a legacy
            # .xls client file is converted to .xlsx and the session path updated
            # to point at the new file for all downstream processing.
            new_wb = Workbook()
            new_ws = new_wb.active
            if sheet_name:
                new_ws.title = sheet_name

            for row in header_rows:
                new_ws.append([_cell(v) for v in row])
            for row in kept_rows:
                new_ws.append([_cell(v) for v in row])

            if ext == '.xls':
                new_client_path = str(Path(str(client_path)).with_suffix('.xlsx'))
                new_wb.save(new_client_path)
                if new_client_path != str(client_path):
                    try:
                        os.remove(str(client_path))
                    except OSError:
                        pass
                    # Point the session at the converted file so every later
                    # read (which resolves info['client_path']) uses it.
                    info['client_path'] = new_client_path
                    client_path = new_client_path
            else:
                new_wb.save(str(client_path))

        # Store cleanup metadata in session (limit preview to 50 rows to avoid bloating session)
        # Only update if rows were actually deleted, or if no prior cleanup exists
        if rows_deleted > 0 or not info.get('rows_deleted'):
            info['primary_column'] = primary_column
            info['rows_deleted'] = (info.get('rows_deleted', 0) or 0) + rows_deleted
            info['total_rows_before'] = info.get('total_rows_before') or total_before
            info['total_rows_after'] = total_before - rows_deleted
            info['deleted_rows_preview'] = (info.get('deleted_rows_preview') or []) + deleted_rows_preview[:50]
        save_session(session_id, info)

        logger.info(f"CLEANUP: Removed {rows_deleted}/{total_before} rows where '{primary_column}' was empty for session {session_id}")

        return Response({
            'success': True,
            'primary_column': primary_column,
            'rows_deleted': rows_deleted,
            'total_rows_before': total_before,
            'total_rows_after': total_before - rows_deleted,
            'deleted_rows_preview': deleted_rows_preview[:50]
        })

    except Exception as e:
        logger.error(f"Error in cleanup_rows: {e}\n{traceback.format_exc()}")
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
@never_cache
def get_headers(request, session_id):
    """Get headers from uploaded files."""
    try:
        # Use consistent session retrieval (cache->memory->file) for multi-worker
        info = get_session_consistent(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mapper = BOMHeaderMapper()

        # Cross-worker consistency: if file snapshot has newer template_version, refresh memory
        try:
            file_snapshot = load_session_from_file(session_id)
            if file_snapshot and file_snapshot.get('template_version', 0) > info.get('template_version', 0):
                SESSION_STORE[session_id] = file_snapshot
                info = file_snapshot
                logger.info(f"🔄 Refreshed in-memory session {session_id} from file (newer template_version)")
        except Exception:
            pass
        
        cached_client_headers = [
            str(header).strip()
            for header in (info.get("client_headers") or [])
            if str(header).strip()
        ]

        # Read client headers (support Azure Blob by resolving to local cache)
        # For PDF sessions, get headers from PDF extraction data instead of CSV file
        if str(info.get("source_type", "")).startswith("pdf"):
            try:
                from .models import PDFSession, PDFExtractionResult
                pdf_session = PDFSession.objects.get(session_id=session_id)
                pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                if pdf_extraction:
                    client_headers = pdf_extraction.extracted_headers
                    logger.info(f"🔍 Using PDF extracted headers for session {session_id}: {client_headers}")
                else:
                    # Fallback to CSV reading if no extraction found
                    client_headers = mapper.read_excel_headers(
                        file_path=hybrid_file_manager.get_file_path(info["client_path"]),
                        sheet_name=info["sheet_name"]
                        ,
                        header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
                    )
                    logger.warning(f"🔍 No PDF extraction found for session {session_id}, fallback to CSV headers")
            except Exception as e:
                logger.error(f"🔍 Error getting PDF headers for session {session_id}: {e}")
                # Fallback to session store headers or CSV reading
                client_headers = (SESSION_STORE.get(session_id) or {}).get('headers')
                if not client_headers:
                    client_headers = mapper.read_excel_headers(
                        file_path=hybrid_file_manager.get_file_path(info["client_path"]),
                        sheet_name=info["sheet_name"],
                        header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
                    )
        else:
            client_headers = mapper.read_excel_headers(
                file_path=hybrid_file_manager.get_file_path(info["client_path"]),
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
            )
        if not client_headers and cached_client_headers:
            client_headers = cached_client_headers
            logger.info(f"get_headers: using cached client headers for session {session_id}: {len(client_headers)} columns")
        elif client_headers and client_headers != cached_client_headers:
            info["client_headers"] = client_headers
            save_session(session_id, info)
        
        # Read template headers (allow enhanced headers override)
        template_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        if not template_headers and info.get('template_source') == 'default':
            template_headers = get_sfo_reference_headers()
            logger.info(f"get_headers: using built-in {SFO_TEMPLATE_NAME} reference headers")

        # CRITICAL: Always store template_headers in session after reading from file
        # This ensures updateColumnCounts has access to the base template headers
        if template_headers and not info.get('template_headers'):
            info['template_headers'] = template_headers
            save_session(session_id, info)
            logger.info(f"🔍 get_headers: Stored template_headers in session: {len(template_headers)} columns")

        # Try to read optional/mandatory annotations from rows above headers (substring match)
        template_optionals_map = {}
        try:
            import pandas as pd
            template_path = hybrid_file_manager.get_file_path(info["template_path"])
            template_header_row_idx = info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
            if template_header_row_idx > 0:
                # Read all rows above the header row to scan for annotations
                if str(template_path).lower().endswith('.csv'):
                    df_ann = read_delimited_text_safely(template_path, header=None, nrows=template_header_row_idx)
                else:
                    df_ann = pd.read_excel(template_path, sheet_name=info.get("template_sheet_name"), header=None, nrows=template_header_row_idx)
                # For each header column, scan upward for any cell containing 'optional'
                for idx, header in enumerate(template_headers):
                    is_optional = False
                    if idx < df_ann.shape[1] and df_ann.shape[0] > 0:
                        col_series = df_ann.iloc[:, idx]
                        for cell in col_series[::-1]:  # scan from nearest row upward
                            try:
                                text = str(cell).strip().lower()
                            except Exception:
                                text = ''
                            if 'optional' in text:
                                is_optional = True
                                break
                            if 'mandatory' in text:
                                # Explicit mandatory marker above; stop scanning
                                is_optional = False
                                break
                    template_optionals_map[str(header)] = is_optional
        except Exception as e:
            logger.warning(f"Optional/Mandatory annotations not read: {e}")
        if not template_optionals_map and info.get('template_source') == 'default':
            template_optionals_map = get_sfo_reference_optional_map()
        enhanced_headers = info.get("enhanced_headers")
        
        # Debug logging
        logger.info(f"🔍 Session {session_id} - enhanced_headers: {enhanced_headers}")
        logger.info(f"🔍 Session {session_id} - template_headers from file: {template_headers}")
        
        # Get column counts from session (with defaults)
        tags_count = info.get('tags_count', 3)
        spec_pairs_count = info.get('spec_pairs_count', 3)
        customer_id_pairs_count = info.get('customer_id_pairs_count', 1)
        
        # Helper functions for robust special-column detection (case/trim tolerant)
        # Match a numbered dynamic column in EITHER spelling.
        #
        # One column, two names: the template workbook writes 'Tag (1)', the
        # grid writes 'Tag_1'. The regeneration below removes the dynamic
        # columns and re-adds a fresh set, so a spelling these predicates do not
        # recognise is kept AND then added again.
        #
        # They used to match `^tag_\d+$` against a bare lower() — the internal
        # spelling only. The SFO template ships the label spelling, so its 14
        # dynamic columns survived the filter and 14 internal ones were appended
        # on top: 38 template columns became 54, with two columns claiming the
        # name Tag_1 (which is where the 'Tag_1__2' keys came from).
        #
        # `build_sfo_clustered_headers` already accepts both spellings; these
        # were the half of the same pipeline left behind when the header shape
        # moved internal, so the two disagreed about what a tag column is.
        import re

        def _norm(h: str) -> str:
            """Lower-cased, with '_' and punctuation flattened to spaces.

            'Tag_1' and 'Tag (1)' both become 'tag 1', so one pattern covers
            both spellings.
            """
            try:
                text = _strip_pandas_duplicate_suffix(str(h or '').strip().lower())
                return re.sub(r'[^a-z0-9]+', ' ', text).strip()
            except Exception:
                return ''

        def _is_numbered(h: str, base: str) -> bool:
            return bool(re.match(rf'^{base} \d+$', _norm(h)))

        def _is_tag(h: str) -> bool:
            return _is_numbered(h, 'tag')
        def _is_spec_name(h: str) -> bool:
            return _is_numbered(h, 'specification name')
        def _is_spec_value(h: str) -> bool:
            return _is_numbered(h, 'specification value')
        def _is_cust_name(h: str) -> bool:
            return _is_numbered(h, 'custom identification name')
        def _is_cust_value(h: str) -> bool:
            return _is_numbered(h, 'custom identification value')

        # Prefer enhanced headers if present to preserve dynamically added columns (e.g., Tag_4)
        if enhanced_headers and isinstance(enhanced_headers, list) and len(enhanced_headers) > 0:
            # Normalize any external-style headers to internal numbered headers
            template_headers_to_use = normalize_headers_to_internal(enhanced_headers)
            # Persist normalized variant back to session to avoid drift
            info["enhanced_headers"] = template_headers_to_use
            info["current_template_headers"] = template_headers_to_use
            save_session(session_id, info)
            # Derive counts from enhanced headers to keep session in sync
            try:
                derived_counts = derive_sfo_column_counts_from_headers(template_headers_to_use)
                derived_tags = derived_counts["tags_count"]
                derived_spec_pairs = derived_counts["spec_pairs_count"]
                derived_customer_pairs = derived_counts["customer_id_pairs_count"]
                if derived_tags != tags_count or derived_spec_pairs != spec_pairs_count or derived_customer_pairs != customer_id_pairs_count:
                    info['tags_count'] = derived_tags
                    info['spec_pairs_count'] = derived_spec_pairs
                    info['customer_id_pairs_count'] = derived_customer_pairs
                    # The session keeps a second copy of these under
                    # `column_counts`, and the mapping page reads that one.
                    # Healing only the top-level keys left the two disagreeing:
                    # the editor drew 3 specification triplets from the headers
                    # while the mapping page drew 1 from the stale dict, and
                    # saving from there pushed triplets 2 and 3 out of the
                    # clustered block to the end of the sheet.
                    info['column_counts'] = {
                        'tags_count': derived_tags,
                        'spec_pairs_count': derived_spec_pairs,
                        'customer_id_pairs_count': derived_customer_pairs,
                    }
                    template_headers_to_use = build_sfo_clustered_headers(
                        template_headers_to_use,
                        derived_tags,
                        derived_spec_pairs,
                        derived_customer_pairs,
                    )
                    info["enhanced_headers"] = template_headers_to_use
                    info["current_template_headers"] = template_headers_to_use
                    save_session(session_id, info)
                    logger.info(f"🔍 Synchronized counts from enhanced headers: tags={derived_tags}, spec={derived_spec_pairs}, customer={derived_customer_pairs}")
            except Exception:
                pass
            logger.info(f"🔍 Using enhanced_headers from session as canonical headers: {template_headers_to_use}")

            # Add MPN validation columns to enhanced headers if MPN validation has been performed
            try:
                mpn_validation = info.get('mpn_validation') or {}
                logger.info(f"🔧 DEBUG get_headers (enhanced path): mpn_validation exists: {bool(mpn_validation)}")
                logger.info(f"🔧 DEBUG get_headers (enhanced path): mpn_validation keys: {list(mpn_validation.keys()) if mpn_validation else 'None'}")

                if mpn_validation.get('column') and mpn_validation.get('results'):

                    # Add base MPN validation columns
                    base_validation_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                    for mpn_col in base_validation_columns:
                        if mpn_col not in template_headers_to_use:
                            template_headers_to_use.append(mpn_col)

                    # Determine number of canonical MPN columns needed
                    results_map = mpn_validation.get('results', {})
                    max_canonical_mpns = 1  # Default to at least 1
                    for raw_mpn, res in results_map.items():
                        all_canonicals = res.get('all_canonical_mpns', [])
                        if len(all_canonicals) > max_canonical_mpns:
                            max_canonical_mpns = min(len(all_canonicals), 5)  # Cap at 5 columns

                    # Add canonical MPN columns
                    canonical_columns = [f'DigiKey Canonical MPN{" " + str(i) if i > 1 else ""}' for i in range(1, max_canonical_mpns + 1)]
                    for canonical_col in canonical_columns:
                        if canonical_col not in template_headers_to_use:
                            template_headers_to_use.append(canonical_col)


                    # Update session with enhanced headers including MPN validation columns
                    info['enhanced_headers'] = template_headers_to_use
                    save_session(session_id, info)
            except Exception as e:
                logger.warning(f"MPN validation column injection in enhanced headers path skipped: {e}")
        # Otherwise, generate headers based on counts
        elif tags_count > 0 or spec_pairs_count > 0 or customer_id_pairs_count > 0:
            regenerated_headers = []
            
            # Add non-dynamic headers first
            for h in template_headers:
                if not (_is_tag(h) or _is_spec_name(h) or _is_spec_value(h) or _is_cust_name(h) or _is_cust_value(h)):
                    regenerated_headers.append(h)
            
            # Add Tag columns with simple numbering
            for i in range(tags_count):
                regenerated_headers.append(f'Tag_{i+1}')
            
            # Add Specification pairs with simple numbering
            for i in range(spec_pairs_count):
                regenerated_headers.append(f'Specification_Name_{i+1}')
                regenerated_headers.append(f'Specification_Value_{i+1}')
            
            # Add Custom identification pairs with simple numbering
            for i in range(customer_id_pairs_count):
                regenerated_headers.append(f'Custom_Identification_Name_{i+1}')
                regenerated_headers.append(f'Custom_Identification_Value_{i+1}')

            # Store canonical headers in session
            info["current_template_headers"] = regenerated_headers
            info["enhanced_headers"] = regenerated_headers
            save_session(session_id, info)
            template_headers_to_use = regenerated_headers
            logger.info(f"🔍 Regenerated canonical template headers based on counts: {template_headers_to_use}")
        else:
            template_headers_to_use = template_headers
            logger.info(f"🔍 Using template_headers from file: {template_headers_to_use}")
            info['template_headers'] = template_headers
            save_session(session_id, info)
        
        # Use template headers from the uploaded template file (not hardcoded defaults)
        complete_template_headers = list(template_headers_to_use) if template_headers_to_use else list(template_headers)

        # Add MPN validation columns if MPN validation has been performed
        try:
            mpn_validation = info.get('mpn_validation') or {}
            logger.info(f"🔧 DEBUG get_headers: mpn_validation exists: {bool(mpn_validation)}")
            logger.info(f"🔧 DEBUG get_headers: mpn_validation keys: {list(mpn_validation.keys()) if mpn_validation else 'None'}")
            if mpn_validation.get('column'):
                logger.info(f"🔧 DEBUG get_headers: MPN column found: {mpn_validation.get('column')}")
            if mpn_validation.get('results'):
                logger.info(f"🔧 DEBUG get_headers: MPN results found: {len(mpn_validation.get('results', {}))}")

            if mpn_validation.get('column') and mpn_validation.get('results'):

                # Add base MPN validation columns
                base_validation_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                for mpn_col in base_validation_columns:
                    if mpn_col not in complete_template_headers:
                        complete_template_headers.append(mpn_col)

                # Determine number of canonical MPN columns needed
                results_map = mpn_validation.get('results', {})
                max_canonical_mpns = 1  # Default to at least 1
                for raw_mpn, res in results_map.items():
                    all_canonicals = res.get('all_canonical_mpns', [])
                    if len(all_canonicals) > max_canonical_mpns:
                        max_canonical_mpns = min(len(all_canonicals), 5)  # Cap at 5 columns

                # Add canonical MPN columns
                canonical_columns = [f'DigiKey Canonical MPN{" " + str(i) if i > 1 else ""}' for i in range(1, max_canonical_mpns + 1)]
                for canonical_col in canonical_columns:
                    if canonical_col not in complete_template_headers:
                        complete_template_headers.append(canonical_col)

        except Exception as e:
            logger.warning(f"MPN validation column injection in headers API skipped: {e}")
        
        # Use template columns from uploaded file (same as complete_template_headers)
        template_columns = list(complete_template_headers)
        
        # Compute template_optionals aligned to the headers being returned
        def is_special_optional(h: str) -> bool:
            h_lower = (h or '').lower()
            return (h == 'Tag' or h.startswith('Tag_') or
                   'specification' in h_lower or
                   'item identifications' in h_lower or
                   'custom identification' in h_lower or
                   'custom_identification' in h_lower)
        
        template_optionals = []
        for h in complete_template_headers:  # Use complete_template_headers to match what's being returned
            if is_special_optional(h):
                template_optionals.append(True)
            else:
                template_optionals.append(bool(template_optionals_map.get(str(h), False)))
        
        # Prepare session metadata (robust PDF detection)
        is_pdf_session = str(info.get("source_type", "")).startswith("pdf")
        if not is_pdf_session:
            try:
                from .models import PDFSession as _PDFSession
                is_pdf_session = _PDFSession.objects.filter(session_id=session_id).exists()
            except Exception:
                is_pdf_session = False

        session_metadata = {
            'is_from_pdf': is_pdf_session,
            'header_confidence_scores': {},
            'original_template_id': info.get('original_template_id'),
            'template_applied': info.get('template_applied', False),
            'template_name': info.get('template_name', ''),
            # Externalize internal Tag_N to 'Tag' for UI/session_metadata
            'formula_rules': _externalize_formula_rules(info.get('formula_rules', []), info),
            'factwise_rules': info.get('factwise_rules', [])
        }

        # Get header confidence scores for PDF sessions
        if is_pdf_session:
            try:
                from .models import PDFSession, PDFExtractionResult
                pdf_session = PDFSession.objects.get(session_id=session_id)
                pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                if pdf_extraction and hasattr(pdf_extraction, 'confidence_scores') and pdf_extraction.confidence_scores:
                    # Extract header-level confidence scores if available
                    confidence_data = pdf_extraction.confidence_scores
                    if isinstance(confidence_data, dict):
                        # Check if we have header-specific confidence scores
                        header_confidence = confidence_data.get('header_confidence', {})
                        if header_confidence:
                            session_metadata['header_confidence_scores'] = header_confidence
                            logger.info(f"📊 Including header confidence scores for PDF session {session_id}: {header_confidence}")
                        else:
                            # Fallback: use overall confidence for all headers
                            overall_confidence = confidence_data.get('overall_confidence', 0.9)
                            session_metadata['header_confidence_scores'] = {header: overall_confidence for header in client_headers}
                            logger.info(f"📊 Using overall confidence {overall_confidence} for all PDF headers in session {session_id}")
                    else:
                        # Legacy fallback: assume high confidence if no detailed scores
                        session_metadata['header_confidence_scores'] = {header: 0.9 for header in client_headers}
                        logger.info(f"📊 Using default confidence for PDF headers in session {session_id}")
            except Exception as e:
                logger.error(f"📊 Error getting PDF confidence scores for session {session_id}: {e}")
                # Provide default confidence scores for PDF sessions even if we can't get detailed ones
                session_metadata['header_confidence_scores'] = {header: 0.8 for header in client_headers}

        return no_store(Response({
            'success': True,
            'client_headers': client_headers,
            'template_headers': complete_template_headers,  # Always return complete headers
            'template_columns': template_columns,
            'template_optionals': template_optionals,
            # Derived from the headers being returned, never from the stored
            # count alone: the mapping page draws its slots from this, and a
            # stored value that had drifted below the sheet showed 1
            # specification pair next to an editor showing 3.
            'column_counts': _counts_matching_headers(
                complete_template_headers,
                tags_count,
                spec_pairs_count,
                customer_id_pairs_count,
            ),
            'client_file': info.get('original_client_name', ''),
            'template_file': info.get('original_template_name', ''),
            'session_metadata': session_metadata
        }))
        
    except Exception as e:
        logger.error(f"Error in get_headers: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to get headers: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR))


@api_view(['POST'])
def mapping_suggestions(request):
    """Get AI-powered mapping suggestions."""
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Use consistent session retrieval (cache -> memory -> file) for Azure multi-worker
        info = get_session_consistent(session_id)
        # If a newer file snapshot exists, refresh in-memory session (cross-worker sync)
        try:
            file_snapshot = load_session_from_file(session_id)
            if file_snapshot and file_snapshot.get('template_version', 0) > info.get('template_version', 0):
                SESSION_STORE[session_id] = file_snapshot
                info = file_snapshot
                logger.info(f"🔄 Refreshed in-memory session {session_id} from file (newer template_version) in download_file")
        except Exception:
            pass
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mapper = BOMHeaderMapper()

        # Get mapping suggestions from files
        mapping_results = mapper.map_headers_to_template(
            client_file=hybrid_file_manager.get_file_path(info["client_path"]),
            template_file=hybrid_file_manager.get_file_path(info["template_path"]),
            client_sheet_name=info["sheet_name"],
            template_sheet_name=info.get("template_sheet_name"),
            client_header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            template_header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0,
            # Level / Quantity / Base BOM Qty are added to the destination list by
            # `add_bom_destination_headers`, not by the template workbook, so the
            # matcher never saw them as candidates. The mapping page offered
            # `Quantity` while auto-mapping could not fill it, and a BOM Normalizer
            # upload - whose `quantity` column is an exact name match - arrived in
            # the editor with an empty Quantity column that looked like the
            # normalizer had dropped it.
            extra_template_headers=BOM_DESTINATION_HEADERS,
        )

        # Get template headers from file
        template_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )

        # Store template headers in session for later use
        info['template_headers'] = template_headers
        info['current_template_headers'] = template_headers
        save_session(session_id, info)
        logger.info(f"🔍 Stored template_headers in session: {template_headers}")

        # Get client headers from file, with cached upload-detected headers as a
        # fallback for workbooks where the second read cannot recover the header row.
        client_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["client_path"]),
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        if not client_headers and info.get("client_headers"):
            client_headers = [
                str(header).strip()
                for header in (info.get("client_headers") or [])
                if str(header).strip()
            ]
        
        # Prepare AI suggestions in format expected by frontend
        ai_suggestions = {}
        for result in mapping_results:
            if result['mapped_client_header'] and result['confidence'] >= 40:
                ai_suggestions[result['template_header']] = {
                    'suggested_column': result['mapped_client_header'],
                    'confidence': result['confidence'],
                    'is_specification_mapping': False
                }
        
        # Headers are already loaded above based on template mode
        
        return Response({
            'success': True,
            'ai_suggestions': ai_suggestions,
            'mapping_details': mapping_results,
            'template_headers': template_headers,
            'client_headers': client_headers,
            'user_columns': client_headers,
            'template_columns': template_headers,
            'specification_opportunity': {'detected': False},
            'session_metadata': {
                'original_template_id': info.get('original_template_id'),
                'template_applied': info.get('template_applied', False)
            }
        })
        
    except Exception as e:
        logger.error(f"Error in mapping_suggestions: {e}")
        return Response({
            'success': False,
            'error': f'Failed to generate suggestions: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_mappings(request):
    """Save column mappings for a session."""
    try:
        session_id = request.data.get('session_id')
        mappings = request.data.get('mappings', {})
        default_values = request.data.get('default_values', {})
        default_value_rules = request.data.get('default_value_rules', {})
        header_corrections = request.data.get('header_corrections', {})
        apply_now = request.data.get('apply_now') in [True, 'true', 'True', '1', 1]
        
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'No session ID provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # CRITICAL FIX: Check if this is a destructive operation (empty mappings)
        # If mappings array is empty, this likely means user is deleting columns
        # In this case, we should NOT overwrite existing mappings
        is_destructive_operation = False
        force_persist = request.data.get('force_persist') in [True, 'true', 'True', '1', 1]
        if isinstance(mappings, list) and len(mappings) == 0:
            is_destructive_operation = True
            logger.warning(f"🔧 WARNING: Received empty mappings array - this is likely a destructive operation")
        elif isinstance(mappings, dict) and 'mappings' in mappings and isinstance(mappings['mappings'], list) and len(mappings['mappings']) == 0:
            is_destructive_operation = True
            logger.warning(f"🔧 WARNING: Received empty mappings.mappings array - this is likely a destructive operation")
        
        # If this is a destructive operation, preserve existing mappings
        if is_destructive_operation and not force_persist:
            existing_mappings = info.get("mappings", {})
            if existing_mappings and isinstance(existing_mappings, dict) and 'mappings' in existing_mappings:
                logger.info(f"🔧 PRESERVING existing mappings from destructive operation: {len(existing_mappings['mappings'])} mappings")
                # Only update default values, keep existing mappings
                cleaned_default_values = {}
                if default_values and isinstance(default_values, dict):
                    for field_name, value in default_values.items():
                        if value is not None and value != "":
                            cleaned_default_values[field_name] = str(value).strip()
                info["default_values"] = cleaned_default_values
                
                # Mark template as modified if it was originally from a saved template
                if info.get("original_template_id"):
                    info["template_modified"] = True
                
                # Persist session using universal saving
                save_session(session_id, info)
                
                return Response({
                    'success': True,
                    'message': 'Default values updated, existing mappings preserved'
                })
        
        # CRITICAL FIX: Get existing used columns from session to maintain state
        # This prevents mappings from disappearing when navigating back
        existing_used_columns = set()
        
        # First, try to get existing mappings from the session
        if 'mappings' in info and isinstance(info['mappings'], dict) and 'mappings' in info['mappings']:
            for mapping in info['mappings']['mappings']:
                target = mapping.get('target', '')
                if target.startswith(('Tag_', 'Specification_Name_', 'Specification_Value_', 'Custom_Identification_Name_', 'Custom_Identification_Value_')):
                    existing_used_columns.add(target)
        
        # If no existing mappings found, try to get from other session data
        if not existing_used_columns:
            # Check if we have column counts that indicate what should exist
            tags_count = info.get('tags_count', 3)
            spec_pairs_count = info.get('spec_pairs_count', 3)
            customer_id_pairs_count = info.get('customer_id_pairs_count', 1)
            
            # Generate expected column names based on counts
            for i in range(1, tags_count + 1):
                existing_used_columns.add(f'Tag_{i}')
            for i in range(1, spec_pairs_count + 1):
                existing_used_columns.add(f'Specification_Name_{i}')
                existing_used_columns.add(f'Specification_Value_{i}')
            for i in range(1, customer_id_pairs_count + 1):
                existing_used_columns.add(f'Custom_Identification_Name_{i}')
                existing_used_columns.add(f'Custom_Identification_Value_{i}')
            
        
        
        # Normalize mappings format and save
        # Accept both array format [{source, target}, ...] and object with .mappings
        normalized = mappings
        if isinstance(mappings, dict) and 'mappings' in mappings and isinstance(mappings['mappings'], list):
            normalized = mappings  # already in new format
        elif isinstance(mappings, list):
            normalized = { 'mappings': mappings }
        elif isinstance(mappings, dict):
            # old format {target: source} -> new format list
            normalized = { 'mappings': [ {'source': src, 'target': tgt} for tgt, src in mappings.items() ] }

        if isinstance(normalized, dict) and 'mappings' in normalized:
            def _same_name_header(headers, wanted):
                wanted_key = _template_label_key(wanted)
                for header in headers or []:
                    if _template_label_key(header) == wanted_key:
                        return str(header)
                return ''

            client_headers_for_identity = info.get('client_headers') or []
            template_headers_for_identity = (
                info.get('enhanced_headers')
                or info.get('current_template_headers')
                or info.get('template_headers')
                or []
            )
            mapped_source_keys = {
                _template_label_key(mapping.get('source'))
                for mapping in normalized.get('mappings', [])
                if isinstance(mapping, dict)
            }
            mapped_target_keys = {
                _template_label_key(mapping.get('target'))
                for mapping in normalized.get('mappings', [])
                if isinstance(mapping, dict)
            }
            for identity_column in ('Notes', 'Internal notes'):
                source_header = _same_name_header(client_headers_for_identity, identity_column)
                target_header = _same_name_header(template_headers_for_identity, identity_column)
                source_key = _template_label_key(source_header)
                target_key = _template_label_key(target_header)
                if source_header and target_header and source_key not in mapped_source_keys and target_key not in mapped_target_keys:
                    normalized['mappings'].append({'source': source_header, 'target': target_header})
                    mapped_source_keys.add(source_key)
                    mapped_target_keys.add(target_key)
                    logger.info(f"SAVE_MAPPINGS: Added default identity mapping '{source_header}' -> '{target_header}'")
        
        # Convert external column names to internal names for mapping storage
        # Use centralized conversion functions to ensure consistency
        if isinstance(normalized, dict) and 'mappings' in normalized:
            converted_mappings = []
            used_columns = existing_used_columns.copy()  # Start with existing used columns
            
            for mapping in normalized['mappings']:
                converted_mapping = mapping.copy()
                target = mapping.get('target', '')
                
                # CRITICAL FIX: Handle both external and internal names properly
                # If target is already an internal name (e.g., Tag_1), preserve it
                # If target is an external name (e.g., Tag), check if it exists in template first

                # Get template headers to check if target exists as-is
                template_headers = info.get('template_headers', []) or []
                enhanced_headers = info.get('enhanced_headers', []) or info.get('current_template_headers', []) or []
                all_headers = list(set(template_headers + enhanced_headers))

                if target.startswith(('Tag_', 'Specification_Name_', 'Specification_Value_', 'Custom_Identification_Name_', 'Custom_Identification_Value_')):
                    # Target is already an internal name, just track it
                    used_columns.add(target)
                elif internal_name_for_slot_label(target):
                    # A numbered slot LABEL ('Tag (2)'), which is what both the
                    # mapping canvas and the template workbook show. It is also
                    # present in template_headers, so without this branch the
                    # next one preserved it verbatim and the mapping pointed at
                    # a column name the grid does not have - the values silently
                    # never arrived. Unnumbered labels ('Tag') keep their own
                    # branch below, which allocates the next free slot.
                    internal_name = internal_name_for_slot_label(target)
                    converted_mapping['target'] = internal_name
                    used_columns.add(internal_name)
                    logger.info(f"📊 SAVE_MAPPINGS: Converted slot label '{target}' -> '{internal_name}'")
                elif target in all_headers:
                    # Target exists as-is in the template headers - DO NOT CONVERT
                    # This preserves user's original column names like "Specification value", "Tag", etc.
                    logger.info(f"📊 SAVE_MAPPINGS: Preserving target '{target}' as-is (exists in template headers)")
                    pass  # Keep converted_mapping['target'] unchanged
                elif target in ['Tag', 'Specification name', 'Specification value', 'Custom identification name', 'Custom identification value']:
                    # Target is an external name that doesn't exist in template - convert to internal name
                    internal_name = convert_external_to_internal_name(target, info, used_columns)
                    converted_mapping['target'] = internal_name
                    used_columns.add(internal_name)
                    logger.info(f"📊 SAVE_MAPPINGS: Converted '{target}' -> '{internal_name}' (not in template headers)")
                else:
                    # Regular column mapping, no conversion needed
                    pass
                converted_mappings.append(converted_mapping)
            
            normalized['mappings'] = converted_mappings
        
        info["mappings"] = normalized
        
        # CRITICAL FIX: Ensure default values are properly stored
        # Filter out empty strings and None values, but keep actual default values
        cleaned_default_values = {}
        if default_values and isinstance(default_values, dict):
            for field_name, value in default_values.items():
                # Only store non-empty values (but allow "0" and other valid defaults)
                if value is not None and value != "":
                    cleaned_default_values[field_name] = str(value).strip()
        info["default_values"] = cleaned_default_values

        # Conditional default-value rules ({target: {column, operator, ...}}). Kept
        # separate from the plain string defaults so the many places that read
        # default_values never see a dict where they expect a string.
        cleaned_default_rules = {}
        if default_value_rules and isinstance(default_value_rules, dict):
            for field_name, rule in default_value_rules.items():
                if isinstance(rule, dict) and str(rule.get('column') or '').strip():
                    cleaned_default_rules[field_name] = rule
        info["default_value_rules"] = cleaned_default_rules

        # Store header corrections for PDF sessions
        if header_corrections and isinstance(header_corrections, dict):
            info["header_corrections"] = header_corrections

        # Mark template as modified if it was originally from a saved template
        if info.get("original_template_id"):
            info["template_modified"] = True

        if not apply_now:
            save_session(session_id, info)
            return Response({
                'success': True,
                'message': 'Mappings saved successfully',
                'applied': False
            })

        # CRITICAL FIX: Apply column mappings immediately after saving
        # This ensures data is transformed and ready for Review page
        logger.info(f"🔧 FIX: Applying column mappings after save_mappings")
        try:
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=normalized,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            logger.info(f"✅ Column mappings applied in save_mappings: {len(mapping_result.get('headers', []))} headers, {len(mapping_result.get('data', []))} rows")

            # A Review from Column Mapping is a new mapped-grid boundary. Any
            # editor snapshots from a previous Review must not win over the
            # freshly applied mappings, otherwise a deleted edge can still look
            # populated in the editor (for example Notes -> Notes).
            for stale_grid_key in ("edited_data", "enhanced_data", "formula_enhanced_data"):
                info.pop(stale_grid_key, None)

            # Store mapped data as both mapped_data and formula_enhanced_data
            info["mapped_data"] = mapping_result['data']
            info["mapped_headers"] = mapping_result['headers']

            # CRITICAL FIX: Don't overwrite formula_enhanced_data if formulas have been applied!
            # If formula_rules exist, formula_enhanced_data contains the computed Tag values
            # Overwriting it would erase all formula-generated values
            has_formula_rules = info.get("formula_rules") and len(info.get("formula_rules", [])) > 0
            if not has_formula_rules:
                # No formulas, safe to use mapped data
                info["formula_enhanced_data"] = mapping_result['data']
                # The mapping result is built from the template, which carries
                # the template's own slot counts. Storing it verbatim discarded
                # any Tag / Specification / Custom identification slots added on
                # the mapping page: the rows kept their extra columns while the
                # header list shrank back, so those columns vanished from the
                # export and no tool could address them.
                mapped_headers = mapping_result['headers']
                slot_counts = _counts_matching_headers(
                    mapped_headers,
                    info.get('tags_count', 3),
                    info.get('spec_pairs_count', 3),
                    info.get('customer_id_pairs_count', 1),
                )
                info["enhanced_headers"] = build_sfo_clustered_headers(
                    mapped_headers,
                    slot_counts['tags_count'],
                    slot_counts['spec_pairs_count'],
                    slot_counts['customer_id_pairs_count'],
                )
                info["current_template_headers"] = info["enhanced_headers"]
                logger.info(f"✅ Stored transformed data in session (no formulas, safe to overwrite)")
        except Exception as mapping_error:
            logger.warning(f"⚠️ Failed to apply column mappings in save_mappings: {mapping_error}")
            # Continue even if mapping fails - user can still retry

        # Persist session using universal saving
        save_session(session_id, info)

        return Response({
            'success': True,
            'message': 'Mappings saved successfully',
            'applied': True,
            'enhanced_headers': info.get('enhanced_headers') or info.get('mapped_headers') or [],
            'mapped_headers': info.get('mapped_headers') or [],
            'template_version': info.get('template_version') or info.get('version') or 0
        })
        
    except Exception as e:
        logger.error(f"Error in save_mappings: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return Response({
            'success': False,
            'error': f'Failed to save mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@never_cache
def get_existing_mappings(request, session_id):
    """Get existing mappings for a session."""
    try:
        # Use consistent session retrieval to avoid stale/missing fields across workers
        session_data = get_session_consistent(session_id)
        if not session_data:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        # Cross-worker refresh if file snapshot is newer
        try:
            file_snapshot = load_session_from_file(session_id)
            if file_snapshot and file_snapshot.get('template_version', 0) > session_data.get('template_version', 0):
                SESSION_STORE[session_id] = file_snapshot
                session_data = file_snapshot
                logger.info(f"🔄 Refreshed session {session_id} from file in get_existing_mappings")
        except Exception:
            pass
        mappings = session_data.get("mappings", {})
        default_values = session_data.get("default_values", {})
        default_value_rules = session_data.get("default_value_rules", {}) or {}

        # Note: Mappings normalization happens below at lines 2501-2511
        # Don't prematurely wrap mappings here - let normalization handle all formats
        
        # IMPORTANT: Derive column counts from default values if missing from session
        # This handles cases where templates were applied before the column count saving fix
        tags_count = session_data.get("tags_count", 3)
        spec_pairs_count = session_data.get("spec_pairs_count", 3)
        customer_id_pairs_count = session_data.get("customer_id_pairs_count", 1)
        
        
        # If column counts are missing but we have default values, derive them
        if (tags_count == 3 and spec_pairs_count == 3 and customer_id_pairs_count == 1 
            and default_values and session_data.get("original_template_id")):
            # Count Tag_ fields in default values
            tag_fields = [field for field in default_values.keys() if field.startswith("Tag_")]
            if tag_fields:
                # Extract numbers from Tag_1, Tag_2, etc. and find the maximum
                tag_numbers = []
                for field in tag_fields:
                    try:
                        num = int(field.split('_')[1])
                        tag_numbers.append(num)
                    except (IndexError, ValueError):
                        pass
                if tag_numbers:
                    tags_count = max(tag_numbers)
                    logger.info(f"🔍 Derived tags_count={tags_count} from default values: {tag_fields}")
        
        # Include session metadata for template state restoration
        session_metadata = {
            'template_applied': bool(session_data.get("original_template_id")),
            'original_template_id': session_data.get("original_template_id"),
            'template_name': None,  # Will be filled if we have template
            'template_success': True,  # Assume success if template was applied
            # Externalize internal Tag_N to 'Tag' for UI to prevent confusion
            'formula_rules': _externalize_formula_rules(session_data.get("formula_rules", []), session_data),
            'header_corrections': session_data.get("header_corrections", {}),
            'factwise_rules': session_data.get("factwise_rules", []),
            # IMPORTANT: Include column counts so frontend shows all dynamic columns
            'column_counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            }
        }

        # Add PDF metadata if session is from PDF (robust detection)
        source_type = session_data.get("source_type")
        is_pdf_session = str(source_type or "").startswith("pdf")
        if not is_pdf_session:
            try:
                from .models import PDFSession as _PDFSession
                is_pdf_session = _PDFSession.objects.filter(session_id=session_id).exists()
            except Exception:
                is_pdf_session = False

        if is_pdf_session:
            # Get header confidence scores from database (same logic as headers endpoint)
            header_confidence_scores = {}
            try:
                from .models import PDFSession, PDFExtractionResult
                pdf_session = PDFSession.objects.get(session_id=session_id)
                pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                extracted_headers_list = list(pdf_extraction.extracted_headers) if pdf_extraction and pdf_extraction.extracted_headers else []
                if pdf_extraction and hasattr(pdf_extraction, 'confidence_scores') and pdf_extraction.confidence_scores:
                    # Extract header-level confidence scores if available
                    confidence_data = pdf_extraction.confidence_scores
                    if isinstance(confidence_data, dict):
                        # Check if we have header-specific confidence scores
                        header_confidence = confidence_data.get('header_confidence', {})
                        if header_confidence:
                            header_confidence_scores = header_confidence
                            logger.info(f"📊 MAPPINGS: Including header confidence scores for PDF session {session_id}: {header_confidence}")
                        else:
                            # Fallback: use overall confidence for all headers
                            overall_confidence = confidence_data.get('overall_confidence', 0.9)
                            headers_for_mapping = extracted_headers_list
                            header_confidence_scores = {header: overall_confidence for header in headers_for_mapping}
                            logger.info(f"📊 MAPPINGS: Using overall confidence {overall_confidence} for all PDF headers in session {session_id}")
                    else:
                        # Legacy fallback: assume high confidence if no detailed scores
                        headers_for_mapping = extracted_headers_list
                        header_confidence_scores = {header: 0.9 for header in headers_for_mapping}
                        logger.info(f"📊 MAPPINGS: Using default confidence for PDF headers in session {session_id}")
            except Exception as e:
                logger.error(f"📊 MAPPINGS: Error getting PDF confidence scores for session {session_id}: {e}")
                # Provide default confidence scores for PDF sessions even if we can't get detailed ones
                try:
                    # best-effort: reuse extracted headers if we already fetched them
                    header_list_fallback = extracted_headers_list
                except Exception:
                    header_list_fallback = []
                header_confidence_scores = {header: 0.8 for header in header_list_fallback}


            # Add PDF metadata to session metadata
            session_metadata.update({
                'is_from_pdf': True,
                'header_confidence_scores': header_confidence_scores,
            })
        else:
            session_metadata.update({
                'is_from_pdf': False,
                'header_confidence_scores': {},
            })
        
        # Get template name if template was applied
        if session_metadata['original_template_id']:
            try:
                from .models import MappingTemplate
                template = MappingTemplate.objects.get(id=session_metadata['original_template_id'])
                session_metadata['template_name'] = template.name
            except Exception:
                session_metadata['template_name'] = 'Applied Template'
        
        # Normalize mappings to always return { mappings: [{"source": "...", "target": "..."}] } format
        normalized_mappings = {}
        if isinstance(mappings, dict) and 'mappings' in mappings and isinstance(mappings['mappings'], list):
            normalized_mappings = mappings
        elif isinstance(mappings, list):
            normalized_mappings = {'mappings': mappings}
        elif isinstance(mappings, dict):
            # old shape {target: source}
            normalized_mappings = {'mappings': [{'source': s, 'target': t} for t, s in mappings.items()]}
        else:
            normalized_mappings = {'mappings': []}

        return no_store(Response({
            'success': True,
            'mappings': normalized_mappings,                # <— one shape
            'default_values': default_values,
            'default_value_rules': default_value_rules,
            'session_metadata': session_metadata
        }))
        
    except Exception as e:
        logger.error(f"Error in get_existing_mappings: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to get mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR))


def calculate_data_quality_metrics(data_rows, headers, header_confidence_scores, confidence_data):
    """Calculate data quality metrics for frontend display."""
    try:
        total_cells = len(data_rows) * len(headers) if data_rows and headers else 0

        if total_cells == 0:
            return {
                'total_cells': 0,
                'high_quality_count': 0,
                'medium_quality_count': 0,
                'low_quality_count': 0,
                'average_confidence': 0.0,
                'header_quality': {},
                'row_quality': []
            }

        # Get row-level confidence from PDF extraction if available
        row_confidences = confidence_data.get('rows', {}) if confidence_data else {}
        # Normalize row_confidences keys (accept 'row_0' style and numeric strings)
        normalized_row_conf = {}
        try:
            for k, v in (row_confidences.items() if isinstance(row_confidences, dict) else []):
                key_str = str(k)
                if key_str.startswith('row_'):
                    idx = key_str.split('row_')[-1]
                    if idx.isdigit():
                        normalized_row_conf[idx] = v
                elif key_str.isdigit():
                    normalized_row_conf[key_str] = v
        except Exception:
            normalized_row_conf = {}

        # Calculate header quality metrics (column-centric)
        header_quality = {}
        for header in headers:
            header_conf = header_confidence_scores.get(header, 0.8)  # Default to 0.8
            header_quality[header] = {
                'confidence': header_conf,
                'quality_level': (
                    'high' if header_conf > 0.8 else
                    'medium' if header_conf > 0.6 else
                    'low'
                )
            }

        # Calculate overall quality metrics
        high_quality_count = 0
        medium_quality_count = 0
        low_quality_count = 0
        total_confidence = 0.0

        # Calculate row-level quality
        row_quality = []
        for row_idx, row in enumerate(data_rows):
            row_conf = normalized_row_conf.get(str(row_idx), 0.8)  # Default to 0.8

            # Combine row confidence with header confidences for overall row quality
            header_avg = sum(header_quality[h]['confidence'] for h in headers) / len(headers) if headers else 0.8
            combined_confidence = (row_conf + header_avg) / 2

            quality_level = (
                'high' if combined_confidence > 0.8 else
                'medium' if combined_confidence > 0.6 else
                'low'
            )

            row_quality.append({
                'index': row_idx,
                'confidence': combined_confidence,
                'quality_level': quality_level
            })

            # Count for totals
            if quality_level == 'high':
                high_quality_count += len(headers)
            elif quality_level == 'medium':
                medium_quality_count += len(headers)
            else:
                low_quality_count += len(headers)

            total_confidence += combined_confidence * len(headers)

        average_confidence = total_confidence / total_cells if total_cells > 0 else 0.0

        return {
            'total_cells': total_cells,
            'high_quality_count': high_quality_count,
            'medium_quality_count': medium_quality_count,
            'low_quality_count': low_quality_count,
            'average_confidence': round(average_confidence, 3),
            'header_quality': header_quality,
            'row_quality': row_quality
        }

    except Exception as e:
        logger.error(f"Error calculating data quality metrics: {e}")
        return {
            'total_cells': 0,
            'high_quality_count': 0,
            'medium_quality_count': 0,
            'low_quality_count': 0,
            'average_confidence': 0.0,
            'header_quality': {},
            'row_quality': []
        }


# Upper bound on rows the data endpoint will return in one response. The editor
# loads the whole sheet so that search and column filters cover every row, so this
# has to clear any realistic BOM rather than the old 5000-row page ceiling.
MAX_DATA_PAGE_SIZE = 200000


@api_view(['GET'])
@never_cache
def data_view(request):
    """Get transformed data with applied mappings."""
    try:
        session_id = request.GET.get('session_id')
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        
        # Validate page parameters and set reasonable limits for large datasets.
        # The editor asks for the whole sheet in one call so that search, column
        # filters and paging all operate over the full dataset rather than over
        # whichever page happened to be loaded — hence the high ceiling.
        page = max(1, page)
        page_size = max(1, min(MAX_DATA_PAGE_SIZE, page_size))
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        
        # Log performance for large page sizes
        if page_size > 1000:
            logger.info(f"🔍 Large page size requested: {page_size} rows on page {page} for session {session_id}")
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'No session ID provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Robust, multi-worker safe session retrieval (cache -> memory -> file)
        info = get_session_consistent(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found. Please upload files again.'
            }, status=status.HTTP_400_BAD_REQUEST)
        # Cross-worker consistency: if file snapshot has newer template_version, refresh memory
        try:
            file_snapshot = load_session_from_file(session_id)
            if file_snapshot and file_snapshot.get('template_version', 0) > info.get('template_version', 0):
                SESSION_STORE[session_id] = file_snapshot
                info = file_snapshot
                logger.info(f"🔄 Refreshed in-memory session {session_id} from file (newer template_version)")
        except Exception as _e:
            pass

        # === DETAILED LOGGING FOR DATA_VIEW ===
        logger.info(f"📊 DATA_VIEW: Session {session_id}")
        logger.info(f"📊 DATA_VIEW: template_headers = {info.get('template_headers')}")
        logger.info(f"📊 DATA_VIEW: enhanced_headers = {info.get('enhanced_headers')}")
        logger.info(f"📊 DATA_VIEW: current_template_headers = {info.get('current_template_headers')}")
        logger.info(f"📊 DATA_VIEW: column_counts = {info.get('column_counts')}")
        raw_mappings_for_log = info.get('mappings') or []
        editor_defaults_entity = (
            str(request.GET.get('entity_name') or '').strip()
            or str(request.headers.get('X-Entity-Name') or '').strip()
            or str(info.get('editor_defaults_entity_name') or '').strip()
            or str(info.get('entity_name') or '').strip()
        )
        if editor_defaults_entity and info.get('editor_defaults_entity_name') != editor_defaults_entity:
            info['editor_defaults_entity_name'] = editor_defaults_entity
            save_session(session_id, info)
        logger.info(f"📊 DATA_VIEW: mappings count = {len(raw_mappings_for_log)}")

        def _normalize_session_rows(value):
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                rows = value.get('data') or value.get('rows')
                return rows if isinstance(rows, list) else []
            return []

        def _normalize_session_headers(value, fallback=None):
            if isinstance(value, dict) and isinstance(value.get('headers'), list):
                return value.get('headers')
            return fallback or []

        # If manual edits exist, serve them immediately without requiring mappings
        edited_data = info.get('edited_data')
        edited_rows = _normalize_session_rows(edited_data)
        active_enhanced_data = info.get('enhanced_data')
        has_active_enhanced_data = (
            isinstance(active_enhanced_data, dict)
            and isinstance(active_enhanced_data.get('headers'), list)
            and isinstance(active_enhanced_data.get('data'), list)
            and bool(active_enhanced_data.get('data'))
        )
        if edited_rows and not has_active_enhanced_data:
            headers_to_use = _normalize_session_headers(edited_data, info.get('enhanced_headers') or info.get('current_template_headers') or info.get('template_headers') or [])

            # Build transformed rows from edited_data
            transformed_rows = []
            for r in edited_rows:
                if isinstance(r, dict):
                    transformed_rows.append({h: r.get(h, '') for h in headers_to_use})
                elif isinstance(r, list):
                    transformed_rows.append({h: (r[idx] if idx < len(r) else '') for idx, h in enumerate(headers_to_use)})

            # Quality + metadata calculation as usual
            final_headers = headers_to_use
            # Keep specification columns clustered (name, then all its values) in the
            # editor too, so dynamic split columns don't drift to the end — matching
            # the export. Rows are dicts keyed by header, so reordering headers is
            # enough.
            _ord = _cluster_factwise_columns(final_headers)
            if _ord != list(range(len(final_headers))):
                final_headers = [final_headers[i] for i in _ord]
            total_rows = len(transformed_rows)
            final_data = transformed_rows[start_idx:end_idx]
            editor_defaults_summary = None
            settings_obj = get_editor_defaults_for_entity(editor_defaults_entity)
            if settings_obj:
                final_data, editor_defaults_summary = apply_editor_defaults_to_rows(
                    final_headers,
                    final_data,
                    settings_obj,
                    sequence_offset=start_idx,
                    locked_codes=locked_identity_codes(info, final_headers, final_data),
                )
            confidence_data = {}
            header_confidence_scores = {}
            quality_metrics = calculate_data_quality_metrics(final_data, final_headers, header_confidence_scores, confidence_data)

            return no_store(Response({
                'success': True,
                'headers': final_headers,
                'data': final_data,
                'total_rows': total_rows,
                'formula_rules': info.get('formula_rules', []),
                'template_version': info.get('template_version', 0),
                'editor_defaults': editor_defaults_summary,
                'quality_metrics': quality_metrics,
                'header_confidence_scores': header_confidence_scores,
                'target_column_confidence_scores': header_confidence_scores,
                'is_from_pdf': str(info.get('source_type', '')).startswith('pdf'),
                'cleanup_info': {
                    'primary_column': info.get('primary_column'),
                    'rows_deleted': info.get('rows_deleted', 0),
                    'total_rows_before': info.get('total_rows_before'),
                    'total_rows_after': info.get('total_rows_after'),
                    'deleted_rows_preview': info.get('deleted_rows_preview', []),
                } if info.get('rows_deleted') else None,
                'pagination': {
                    'page': page,
                    'page_size': page_size,
                    'total_rows': total_rows,
                    'total_pages': max(1, (total_rows + page_size - 1) // page_size)
                }
            }))
        
        # Always process fresh data - no caching
        mappings = info.get("mappings")
        # If mappings missing, try to refresh from file to handle multi-worker race
        if not mappings:
            refreshed = load_session_from_file(session_id)
            if refreshed and refreshed.get("mappings"):
                SESSION_STORE[session_id] = refreshed
                info = refreshed
                mappings = info.get("mappings")
                logger.info(f"🔄 Refreshed session {session_id} from file to load latest mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
        else:
            formatted_mappings = mappings
        
        # Prefer manually edited data first (permanent edits from the editor)
        edited_data = info.get('edited_data')
        enhanced_data = info.get("formula_enhanced_data")
        enhanced_headers = info.get("enhanced_headers")
        edited_rows = _normalize_session_rows(edited_data)
        enhanced_rows = _normalize_session_rows(enhanced_data)

        logger.info(f"🔍 DATA_VIEW_START: edited_data={len(edited_data) if edited_data else 0}, formula_enhanced_data={bool(enhanced_data)}, enhanced_headers={len(enhanced_headers) if enhanced_headers else 0}")

        template_just_applied = info.get("original_template_id") is not None
        # Prefer enhanced data if present (e.g., user uploaded corrected CSV) even when force_fresh=true
        force_fresh_param = request.GET.get('force_fresh', 'false').lower() == 'true'
        if info.get('uploaded_via_correction') and enhanced_rows and enhanced_headers:
            force_fresh_mapping = False
        else:
            force_fresh_mapping = (template_just_applied and not (enhanced_rows and enhanced_headers)) or (force_fresh_param and not (enhanced_rows and enhanced_headers))
        # Stability option for consumers like DataEditor: avoid cleaning headers by page slice
        stable_headers = request.GET.get('stable', 'false').lower() == 'true'

        using_enhanced = False

        # 1) FIRST PRIORITY: Check if we have MPN-enhanced data (has both enhanced_data and enhanced_headers)
        mpn_enhanced_data = info.get('enhanced_data')
        logger.info(f"🔍 DATA_VIEW_MPN_CHECK: mpn_enhanced_data exists={bool(mpn_enhanced_data)}, has headers={bool(mpn_enhanced_data.get('headers') if mpn_enhanced_data else False)}, header count in mpn_enhanced_data={len(mpn_enhanced_data.get('headers', [])) if mpn_enhanced_data else 0}, enhanced_headers from session={len(enhanced_headers) if enhanced_headers else 0}")
        if mpn_enhanced_data and mpn_enhanced_data.get('headers') and mpn_enhanced_data.get('data') and enhanced_headers:
            logger.info(f"📊 DATA_VIEW: Using MPN-enhanced data with {len(enhanced_headers)} headers")
            mpn_data_rows = mpn_enhanced_data['data']
            mpn_headers = mpn_enhanced_data['headers']

            # CRITICAL: Convert list-of-lists to dict format using mpn_headers as keys
            if mpn_data_rows and isinstance(mpn_data_rows[0], list):
                logger.info(f"🔄 DATA_VIEW_MPN_CONVERT: Converting {len(mpn_data_rows)} rows from list-of-lists to dict using {len(mpn_headers)} headers")
                logger.info(f"🔍 DATA_VIEW_MPN_HEADERS: {mpn_headers}")
                mpn_field_headers = make_unique_field_headers(mpn_headers)
                transformed_rows = []
                for row_idx, row_list in enumerate(mpn_data_rows):
                    row_dict = {}
                    for idx, field_header in enumerate(mpn_field_headers):
                        row_dict[field_header] = row_list[idx] if idx < len(row_list) else ''
                    transformed_rows.append(row_dict)
                    if row_idx == 0:  # Log first row
                        logger.info(f"🔍 DATA_VIEW_ROW_0: MPN valid={row_dict.get('MPN valid (DigiKey)')}, DKPN={row_dict.get('DigiKey Part Number')}, MPN valid (Mouser)={row_dict.get('MPN valid (Mouser)')}, MPNR={row_dict.get('MPNR')}")
            else:
                transformed_rows = mpn_data_rows

            # Use the SAME headers the rows were built from. enhanced_headers can
            # drift shorter than enhanced_data (a canonical rebuild regenerates the
            # header list from template+counts but leaves enhanced_data untouched),
            # which would hide any extra columns actually present in the rows —
            # split outputs (e.g. Reference Designator_1..N) and MPN validation
            # columns. Trusting the grid's own headers keeps them visible and keeps
            # headers aligned with row values.
            headers_to_use = mpn_headers
            using_enhanced = True
            # Heal the drift so downstream paths (export, rebuild) see the full set.
            try:
                if list(enhanced_headers or []) != list(mpn_headers or []):
                    info['enhanced_headers'] = list(mpn_headers)
                    info['current_template_headers'] = list(mpn_headers)
                    save_session(session_id, info)
            except Exception:
                pass
        # 2) Edited data takes second priority (but should include MPN columns if they exist)
        elif edited_rows:
            headers_to_use = _normalize_session_headers(edited_data, enhanced_headers or info.get('current_template_headers') or info.get('template_headers') or [])
            # Rebuild rows to include all headers in order
            transformed_rows = []
            for r in edited_rows:
                if isinstance(r, dict):
                    transformed_rows.append({h: r.get(h, '') for h in headers_to_use})
                elif isinstance(r, list):
                    transformed_rows.append({h: (r[idx] if idx < len(r) else '') for idx, h in enumerate(headers_to_use)})
            using_enhanced = True
            try:
                info['enhanced_headers'] = headers_to_use
                save_session(session_id, info)
            except Exception:
                pass
        # 3) Otherwise use enhanced (correction / formula) data
        elif enhanced_rows and enhanced_headers and not force_fresh_mapping and not mpn_enhanced_data:
            transformed_rows = enhanced_rows
            headers_to_use = _normalize_session_headers(enhanced_data, enhanced_headers)
            using_enhanced = True
            # Persist canonical headers to avoid worker drift
            try:
                info["current_template_headers"] = headers_to_use
                save_session(session_id, info)
            except Exception:
                pass
        else:
            # fresh mapping – process only requested page to avoid heavy work on large datasets
            # Provide pagination hints for apply_column_mappings
            try:
                SESSION_STORE.setdefault(session_id, {})['__paginate__'] = {'offset': start_idx, 'limit': page_size}
            except Exception:
                pass
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=formatted_mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            # Clear pagination hint to avoid affecting other endpoints
            try:
                if '__paginate__' in SESSION_STORE.get(session_id, {}):
                    del SESSION_STORE[session_id]['__paginate__']
            except Exception:
                pass

            # Check if enhanced data with MPN validation exists
            enhanced_data = info.get('enhanced_data')
            if enhanced_data and enhanced_data.get('headers') and enhanced_data.get('data'):
                transformed_rows = enhanced_data['data']
                headers_to_use = enhanced_data['headers']
                using_enhanced = True
            else:
                transformed_rows = mapping_result['data']
                headers_to_use = mapping_result['headers']
                using_enhanced = False
            
            # CRITICAL FIX: If we forced fresh mapping due to template application, we need to re-apply formulas
            # to ensure Tag columns are populated with the correct data from the original file
            if force_fresh_mapping and template_just_applied:
                # Clear any stale enhanced data that might interfere and update local variables
                if "formula_enhanced_data" in info:
                    del info["formula_enhanced_data"]
                if "enhanced_headers" in info:
                    del info["enhanced_headers"]
                # Update local variables to reflect the clearing
                enhanced_data = None
                enhanced_headers = None
        
        # Apply formula rules if they exist to create unique tag columns
        formula_rules = info.get("formula_rules", [])
        
        # Ensure formula column headers are included in headers_to_use
        if formula_rules:
            formula_headers = []
            for rule in formula_rules:
                target_col = rule.get('target_column')
                if target_col and target_col not in headers_to_use:
                    formula_headers.append(target_col)
            
            if formula_headers:
                headers_to_use.extend(formula_headers)
        
        # De-dup rules as you already do...
        formula_rules = info.get('formula_rules', [])

        # Convert list-based data to dict format BEFORE applying formulas
        if transformed_rows and len(transformed_rows) > 0 and isinstance(transformed_rows[0], list):
            dict_rows = []
            field_headers = make_unique_field_headers(headers_to_use)
            for row_list in transformed_rows:
                row_dict = {}
                
                for i, header in enumerate(field_headers):
                    if i < len(row_list):
                        row_dict[header] = row_list[i]
                    else:
                        # Handle missing values
                        row_dict[header] = ""
                
                dict_rows.append(row_dict)
            transformed_rows = dict_rows

        # Inject MPN validation columns with multiple canonical MPNs if available
        # SKIP this if we're using MPN-enhanced data (it already has the columns populated)
        try:
            mpn_validation = info.get('mpn_validation') or {}
            mpn_header = mpn_validation.get('column')
            results_map = mpn_validation.get('results') or {}
            if mpn_header and isinstance(transformed_rows, list) and transformed_rows and not using_enhanced:
                from .services.digikey_service import DigiKeyClient
                client_norm = DigiKeyClient.normalize_mpn

                # Limit canonical MPN columns to reasonable number (max 5) to avoid excessive blank columns
                max_canonical_mpns = 1
                for row in transformed_rows:
                    if isinstance(row, dict):
                        raw = row.get(mpn_header, '')
                        norm = client_norm(raw)
                        res = results_map.get(norm, {})
                        all_canonicals = res.get('all_canonical_mpns', [])
                        if len(all_canonicals) > max_canonical_mpns:
                            max_canonical_mpns = min(len(all_canonicals), 5)  # Cap at 5 columns

                # Add base MPN validation columns to headers if not present
                base_validation_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                for mpn_col in base_validation_columns:
                    if mpn_col not in headers_to_use:
                        headers_to_use.append(mpn_col)

                # Add multiple canonical MPN columns based on maximum needed
                canonical_columns = []
                for i in range(max_canonical_mpns):
                    if i == 0:
                        col_name = 'DigiKey Canonical MPN'
                    else:
                        col_name = f'DigiKey Canonical MPN {i + 1}'

                    canonical_columns.append(col_name)
                    if col_name not in headers_to_use:
                        headers_to_use.append(col_name)

                # Populate all MPN validation data for each row
                for row in transformed_rows:
                    if isinstance(row, dict):
                        raw = row.get(mpn_header, '')
                        norm = client_norm(raw)
                        res = results_map.get(norm, {})
                        if not res:
                            # No MPN, or not validated yet (progressive fill hasn't
                            # reached this row) — keep every column blank so the editor
                            # never shows a false "No" for an unvalidated row.
                            for col in base_validation_columns + list(canonical_columns):
                                row[col] = ''
                            continue
                        lifecycle = res.get('lifecycle') or {}
                        all_canonicals = res.get('all_canonical_mpns', [])

                        # Set base MPN validation columns, fixing invalid MPNs to have blank status fields
                        is_valid = res.get('valid', False)
                        row['MPN valid (DigiKey)'] = 'Yes' if is_valid else 'No'

                        # Only populate status fields for valid MPNs, leave blank for invalid
                        if is_valid:
                            row['DigiKey Status'] = lifecycle.get('status') or 'Unknown'
                            row['DigiKey EOL Status'] = 'Yes' if lifecycle.get('endOfLife') else 'No'
                            row['DigiKey Discontinued'] = 'Yes' if lifecycle.get('discontinued') else 'No'
                            row['DigiKey Part Number'] = res.get('dkpn') or ''
                        else:
                            # Invalid MPNs should have blank status fields
                            row['DigiKey Status'] = ''
                            row['DigiKey EOL Status'] = ''
                            row['DigiKey Discontinued'] = ''
                            row['DigiKey Part Number'] = ''

                        # Add category information from DigiKey (only for valid MPNs)
                        if is_valid:
                            category_info = res.get('category', {})
                            row['DigiKey Category'] = category_info.get('name', '') if category_info else ''
                        else:
                            row['DigiKey Category'] = ''

                        # Set multiple canonical MPN columns (show suggestions for both valid and invalid MPNs)
                        for i, col_name in enumerate(canonical_columns):
                            if i < len(all_canonicals):
                                row[col_name] = all_canonicals[i]  # Show canonical suggestions for both valid and invalid MPNs
                            else:
                                row[col_name] = ''  # Empty if no more canonical MPNs

                logger.info(f"🔧 DEBUG data_view: Added MPN validation columns with {max_canonical_mpns} canonical MPN variants: {base_validation_columns + canonical_columns}")
        except Exception as _me:
            logger.warning(f"MPN validation injection skipped: {_me}")

        # IMPORTANT: apply formulas only if we did NOT use the enhanced branch
        logger.info(f"🔍 DATA_VIEW_FORMULA_CHECK: formula_rules={bool(formula_rules)}, has_transformed_rows={bool(transformed_rows)}, using_enhanced={using_enhanced}, will_apply_formulas={formula_rules and transformed_rows and not using_enhanced}")
        if formula_rules and transformed_rows and not using_enhanced:
            logger.info(f"⚠️ DATA_VIEW_FORMULA: Applying formulas, current headers_to_use={len(headers_to_use)}")
            formula_result = apply_formula_rules(transformed_rows, headers_to_use, formula_rules, replace_existing=False, session_info=info)
            transformed_rows = formula_result['data']
            headers_to_use = formula_result['headers']
            logger.info(f"⚠️ DATA_VIEW_FORMULA: After formulas, headers_to_use={len(headers_to_use)}, OVERWRITING enhanced_headers!")
            # Persist canonically across workers but avoid storing large full datasets
            info['enhanced_headers'] = headers_to_use
            info['current_template_headers'] = headers_to_use
            info['version'] = info.get('version', 0) + 1
            # Do NOT store full enhanced data here; data is paginated and can be recomputed per page
            save_session(session_id, info)
        
        # Apply factwise ID rules if they exist
        factwise_rules = info.get("factwise_rules", [])
        
        for factwise_rule in factwise_rules:
            if factwise_rule.get("type") == "factwise_id" and transformed_rows:
                try:
                    first_col = factwise_rule.get("first_column")
                    second_col = factwise_rule.get("second_column")
                    operator = factwise_rule.get("operator", "_")
                    strategy = factwise_rule.get("strategy", "fill_only_null")
                    
                    
                    if first_col and second_col and first_col in headers_to_use and second_col in headers_to_use:
                        first_idx = headers_to_use.index(first_col)
                        second_idx = headers_to_use.index(second_col)
                        
                        
                        # Map into Item code rather than creating a new column
                        # Normalize headers to find Item code variant
                        def norm(s: str) -> str:
                            return str(s).strip().lower().replace(' ', '').replace('_', '').replace('-', '')

                        item_header = None
                        for h in headers_to_use:
                            if norm(h) == norm('item code'):
                                item_header = h
                                break

                        if not item_header:
                            # If no Item code header exists yet, create one at the beginning
                            headers_to_use.insert(0, 'Item code')
                            item_header = 'Item code'
                            # Persist canonical headers
                            try:
                                info["current_template_headers"] = headers_to_use
                                save_session(session_id, info)
                            except Exception:
                                pass
                            for i, row in enumerate(transformed_rows):
                                if isinstance(row, dict):
                                    first_val = row.get(first_col, "")
                                    second_val = row.get(second_col, "")
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    row[item_header] = factwise_id
                                else:
                                    first_val = row[first_idx] if first_idx < len(row) else ""
                                    second_val = row[second_idx] if second_idx < len(row) else ""
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    row.insert(0, factwise_id)
                        else:
                            # Fill existing Item code per strategy
                            for i, row in enumerate(transformed_rows):
                                if isinstance(row, dict):
                                    first_val = row.get(first_col, "")
                                    second_val = row.get(second_col, "")
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    if strategy == 'override_all' or not row.get(item_header):
                                        row[item_header] = factwise_id
                                else:
                                    first_val = row[first_idx] if first_idx < len(row) else ""
                                    second_val = row[second_idx] if second_idx < len(row) else ""
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    # Find index of item_header
                                    try:
                                        item_idx = headers_to_use.index(item_header)
                                    except ValueError:
                                        item_idx = None
                                    if item_idx is not None:
                                        if strategy == 'override_all' or (item_idx < len(row) and (row[item_idx] is None or str(row[item_idx]).strip() == "")):
                                            # Ensure row length and assign
                                            while len(row) <= item_idx:
                                                row.append("")
                                            row[item_idx] = factwise_id
                            
                            if i == 0:  # Log first row for debugging
                                                pass
                    else:
                        logger.warning(f"🔧 DEBUG: Columns not found - first_col '{first_col}' in headers: {first_col in headers_to_use}, second_col '{second_col}' in headers: {second_col in headers_to_use}")
                            
                except Exception as e:
                    logger.warning(f"Factwise ID application failed: {e}")
                    import traceback
                    logger.warning(f"Traceback: {traceback.format_exc()}")

        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data could be transformed'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # List-to-dict conversion already done above before formula processing

        # FIXED: Only normalize 'Tag' column if it's NOT in the user's original template headers
        # If user's template has 'Tag' column, keep it separate from Tag_1, Tag_2, etc.
        try:
            original_template_headers = info.get('template_headers', []) or []
            tag_is_in_original_template = 'Tag' in original_template_headers

            if not tag_is_in_original_template and isinstance(headers_to_use, list) and 'Tag' in headers_to_use and isinstance(transformed_rows, list) and len(transformed_rows) > 0:
                # Only do this redistribution if 'Tag' is NOT in the original template
                logger.info(f"📊 DATA_VIEW: 'Tag' is NOT in original template, redistributing to Tag_N columns")
                tag_n_headers = [h for h in headers_to_use if isinstance(h, str) and h.startswith('Tag_')]
                try:
                    tag_n_headers.sort(key=lambda x: int(x.split('_')[1]))
                except Exception:
                    tag_n_headers.sort()
                if isinstance(transformed_rows[0], dict):
                    for row in transformed_rows:
                        val = str(row.get('Tag', '') or '').strip()
                        if not val:
                            continue
                        placed = False
                        for tcol in tag_n_headers:
                            cur = str(row.get(tcol, '') or '').strip()
                            if not cur:
                                row[tcol] = val
                                placed = True
                                break
                        if not placed and tag_n_headers:
                            last = tag_n_headers[-1]
                            cur = str(row.get(last, '') or '').strip()
                            if cur:
                                parts = [p.strip() for p in cur.split(',')]
                                if val not in parts:
                                    row[last] = f"{cur}, {val}"
                            else:
                                row[last] = val
                        row.pop('Tag', None)
            elif tag_is_in_original_template:
                logger.info(f"📊 DATA_VIEW: 'Tag' IS in original template, keeping it separate from Tag_N columns")
                # DO NOT redistribute or remove 'Tag' column - user wants it as a separate column
        except Exception:
            pass

        # Avoid dropping Tag_N columns in correction mode (we want to keep full template footprint)
        # CRITICAL FIX: Also preserve Tag columns that have formula rules
        if not info.get('uploaded_via_correction'):
            try:
                if isinstance(headers_to_use, list) and headers_to_use and transformed_rows:
                    tag_headers = [h for h in headers_to_use if isinstance(h, str) and h.startswith('Tag_')]

                    # Get Tag columns that have formula rules - these should NEVER be removed
                    formula_tag_columns = set()
                    formula_rules = info.get("formula_rules", [])
                    if formula_rules:
                        for rule in formula_rules:
                            if isinstance(rule, dict) and rule.get('column_type') == 'Tag':
                                target_col = rule.get('target_column', '')
                                if target_col and target_col.startswith('Tag_'):
                                    formula_tag_columns.add(target_col)

                    # Build a set of Tag_N with any data
                    non_empty = set()
                    if isinstance(transformed_rows[0], dict):
                        for h in tag_headers:
                            for row in transformed_rows:
                                if str(row.get(h, '') or '').strip():
                                    non_empty.add(h)
                                    break
                    else:
                        for h in tag_headers:
                            try:
                                idx = headers_to_use.index(h)
                            except ValueError:
                                continue
                            for row in transformed_rows:
                                if idx < len(row) and str(row[idx] or '').strip():
                                    non_empty.add(h)
                                    break

                    # Remove Tag_N columns that are entirely empty, BUT preserve formula-based Tag columns
                    to_remove = [h for h in tag_headers if h not in non_empty and h not in formula_tag_columns]
                    if to_remove:
                        headers_to_use = [h for h in headers_to_use if h not in to_remove]
                        if isinstance(transformed_rows[0], dict):
                            for row in transformed_rows:
                                for h in to_remove:
                                    row.pop(h, None)
                        # list-of-lists cleanup will be handled later with cleaned headers if needed

                    # Log preserved formula columns
                    preserved_formula_tags = [h for h in tag_headers if h in formula_tag_columns and h not in non_empty]
                    if preserved_formula_tags:
                        pass
            except Exception as cleanup_err:
                logger.warning(f"Tag cleanup in data_view failed: {cleanup_err}")
                pass
        
        # Apply default values for unmapped fields
        default_values = info.get("default_values", {})

        if default_values and transformed_rows:
            slot_to_header = {}
            try:
                field_headers_for_defaults = make_unique_field_headers(headers_to_use or [])
                slot_to_header = {
                    slot_key: field_header
                    for slot_key, field_header in zip(get_sfo_slot_keys(headers_to_use or []), field_headers_for_defaults)
                }
            except Exception:
                slot_to_header = {}
            
            for field_name, default_value in default_values.items():
                # CRITICAL FIX: Handle both internal and external field names for default values
                matched_field = None
                
                # First, try exact match (most common case)
                if field_name in headers_to_use:
                    matched_field = field_name
                elif field_name in slot_to_header:
                    matched_field = slot_to_header[field_name]
                else:
                    # Handle internal names (e.g., "Specification_Name_1")
                    if field_name.startswith('Specification_Name_'):
                        matched_field = slot_to_header.get(field_name)
                    elif field_name.startswith('Specification_Value_'):
                        matched_field = slot_to_header.get(field_name)
                    elif field_name.startswith('Custom_Identification_Name_'):
                        matched_field = slot_to_header.get(field_name)
                    elif field_name.startswith('Custom_Identification_Value_'):
                        matched_field = slot_to_header.get(field_name)
                    elif field_name.startswith('Tag_'):
                        matched_field = slot_to_header.get(field_name)
                    # Handle external names (e.g., "Specification name")
                    elif field_name == "Specification name":
                        # Find the first available Specification_Name_X column
                        for header in headers_to_use:
                            if header.startswith('Specification_Name_'):
                                matched_field = header
                                break
                    elif field_name == "Specification value":
                        # Find the first available Specification_Value_X column
                        for header in headers_to_use:
                            if header.startswith('Specification_Value_'):
                                matched_field = header
                                break
                    elif field_name == "Custom identification name":
                        # Find the first available Custom_Identification_Name_X column
                        for header in headers_to_use:
                            if header.startswith('Custom_Identification_Name_'):
                                matched_field = header
                                break
                    elif field_name == "Custom identification value":
                        # Find the first available Custom_Identification_Value_X column
                        for header in headers_to_use:
                            if header.startswith('Custom_Identification_Value_'):
                                matched_field = header
                                break
                    elif field_name == "Tag":
                        # Find the first available Tag_X column
                        for header in headers_to_use:
                            if header.startswith('Tag_'):
                                matched_field = header
                                break
                
                if matched_field:
                    
                    # CRITICAL FIX: Apply default values more intelligently
                    # Apply defaults to all rows for unmapped fields to ensure consistency
                    rows_updated = 0
                    for row in transformed_rows:
                        current_value = row.get(matched_field, None)
                        # Apply default if field is None, empty string, "nan", or doesn't exist
                        # This ensures all rows get the default value for unmapped fields
                        if (current_value is None or 
                            current_value == "" or 
                            current_value == "nan" or 
                            str(current_value).strip() == "" or
                            str(current_value).lower() == "nan"):
                            row[matched_field] = default_value
                            rows_updated += 1
                        # Also apply if the field value is the same as the default (indicating it was already set)
                        elif str(current_value).strip() == str(default_value).strip():
                            rows_updated += 1
                    
                else:
                    if re.match(r"^(Tag|Specification_(Name|Value|UOM)|Custom_Identification_(Name|Value))_\d+$", str(field_name or "")):
                        logger.warning(f"Default value target '{field_name}' has no matching SFO slot in current headers; skipping")
                        continue
                    # If the default-only field is missing from headers, add it canonically and populate
                    headers_to_use.append(field_name)
                    for row in transformed_rows:
                        if isinstance(row, dict):
                            row[field_name] = default_value
                    try:
                        info["current_template_headers"] = headers_to_use
                        save_session(session_id, info)
                    except Exception:
                        pass
        else:
            if not default_values:
                pass
            if not transformed_rows:
        
        # Implement pagination
        # We already paginated at read-time. Compute total_rows accurately for UI.
                pass
        if using_enhanced:
            total_rows = len(transformed_rows)
            paginated_rows = transformed_rows[start_idx:end_idx]
        else:
            try:
                client_local_path = hybrid_file_manager.get_file_path(info["client_path"])
                total_rows = _count_total_data_rows(client_local_path, info.get("sheet_name"), info.get("header_row", 1) - 1 if info.get("header_row", 1) > 0 else 0)
            except Exception:
                # Fallback to current page length if counting fails
                total_rows = start_idx + len(transformed_rows)
            paginated_rows = transformed_rows
        
        # Use the headers we determined above (either enhanced or template headers)
        
        # Include formula rules in response if they exist
        formula_rules = info.get("formula_rules", [])
        
        # Convert internal column names to external names for frontend display
        # Internal: Tag_1, Tag_2, etc. -> External: Tag (always generic name)
        # Internal: Specification_Name_1, Specification_Value_1, etc. -> External: Specification name, Specification value
        # Internal: Custom_Identification_Name_1, Custom_Identification_Value_1, etc. -> External: Custom identification name, Custom identification value
        external_headers = []
        internal_to_external_mapping = {}
        
        for header in headers_to_use:
            if header.startswith('Tag_') or header == 'Tag':
                # Always show "Tag" regardless of how many tags exist
                external_header = 'Tag'
            elif header.startswith('Specification_Name_') or header == 'Specification name':
                external_header = 'Specification name'
            elif header.startswith('Specification_Value_') or header == 'Specification value':
                external_header = 'Specification value'
            elif header.startswith('Custom_Identification_Name_') or header == 'Custom identification name':
                external_header = 'Custom identification name'
            elif header.startswith('Custom_Identification_Value_') or header == 'Custom identification value':
                external_header = 'Custom identification value'
            else:
                external_header = header
            
            external_headers.append(external_header)
            internal_to_external_mapping[header] = external_header
        
        # CRITICAL FIX: PRESERVE ALL TEMPLATE COLUMNS - Don't remove any columns
        # The user expects to see the complete template structure, even if columns are empty
        # Only remove truly unnecessary columns that are completely outside the template
        cleaned_headers = []
        cleaned_external_headers = []
        cleaned_internal_to_external = {}
        
        # Build canonical sets for ALL template columns (core + dynamic)
        template_norm = set()
        
        # Add core headers
        core_headers = [
            "Item code",
            "Item name",
            "Description",
            "Item type",
            "Measurement unit",
            "Procurement entity name",
            "Notes",
            "Internal notes",
            "Procurement item",
            "Sales item",
            "Preferred vendor code",
        ]
        for h in core_headers:
            template_norm.add(_canon(h))
        
        # Add dynamic headers based on session counts
        if session_id and session_id in SESSION_STORE:
            session_info = SESSION_STORE[session_id]
            tags_count = session_info.get('tags_count', 3)
            spec_pairs_count = session_info.get('spec_pairs_count', 3)
            customer_id_pairs_count = session_info.get('customer_id_pairs_count', 1)
            
            # Add Tag columns
            for i in range(1, tags_count + 1):
                template_norm.add(_canon(f"Tag_{i}"))
            
            # Add Specification columns  
            for i in range(1, spec_pairs_count + 1):
                template_norm.add(_canon(f"Specification_Name_{i}"))
                template_norm.add(_canon(f"Specification_Value_{i}"))
            
            # Add Customer Identification columns
            for i in range(1, customer_id_pairs_count + 1):
                template_norm.add(_canon(f"Custom_Identification_Name_{i}"))
                template_norm.add(_canon(f"Custom_Identification_Value_{i}"))

            # Add MPN validation columns if they exist in session
            mpn_validation = session_info.get('mpn_validation', {})
            if mpn_validation.get('digikey_results') or mpn_validation.get('mouser_results') or mpn_validation.get('results'):
                # Add DigiKey columns
                template_norm.add(_canon('MPN valid (DigiKey)'))
                template_norm.add(_canon('DigiKey Status'))
                template_norm.add(_canon('DigiKey EOL Status'))
                template_norm.add(_canon('DigiKey Discontinued'))
                template_norm.add(_canon('DigiKey Part Number'))
                template_norm.add(_canon('DigiKey Canonical MPN'))
                template_norm.add(_canon('DigiKey Category'))

                # Add Mouser columns if present
                if mpn_validation.get('mouser_results'):
                    template_norm.add(_canon('MPN valid (Mouser)'))
                    template_norm.add(_canon('Mouser Status'))
                    template_norm.add(_canon('MPNR'))
                    template_norm.add(_canon('Mouser Canonical MPN'))
                    template_norm.add(_canon('Mouser Category'))


        for i, header in enumerate(headers_to_use):
            header_canon = _canon(header)
            is_template_column = header_canon in template_norm
            
            # ALWAYS keep template columns, regardless of whether they have data
            if is_template_column:
                cleaned_headers.append(header)
                if i < len(external_headers):
                    cleaned_external_headers.append(external_headers[i])
                    cleaned_internal_to_external[header] = external_headers[i]
                logger.debug(f"🔧 CLEANUP: PRESERVED template column '{header}' (template structure)")
            else:
                # For non-template columns, check if they have data
                has_data = False
                for row in transformed_rows:
                    if isinstance(row, dict):
                        value = row.get(header, '')
                    elif isinstance(row, list) and i < len(row):
                        value = row[i] if row[i] is not None else ''
                    else:
                        value = ''
                    
                    if value and str(value).strip() and str(value).strip().lower() not in ['', 'none', 'null', 'nan']:
                        has_data = True
                        break
                
                if has_data:
                    cleaned_headers.append(header)
                    if i < len(external_headers):
                        cleaned_external_headers.append(external_headers[i])
                        cleaned_internal_to_external[header] = external_headers[i]
                    logger.debug(f"🔧 CLEANUP: Kept non-template column '{header}' (has data)")
        # Update the variables to use cleaned versions
        if not stable_headers:
            headers_to_use = cleaned_headers
            external_headers = cleaned_external_headers
            internal_to_external_mapping = cleaned_internal_to_external

            # Also clean up the paginated_rows to only include data for kept columns
            original_header_count = len([h for h in (info.get('current_template_headers', []) or info.get('enhanced_headers', []) or [])])
            if len(cleaned_headers) < original_header_count:
                cleaned_paginated_rows = []
                original_headers = [h for h in headers_to_use]  # Keep original reference

                for row in paginated_rows:
                    if isinstance(row, dict):
                        # Keep only fields that correspond to cleaned headers
                        cleaned_row = {header: row.get(header, '') for header in cleaned_headers}
                        cleaned_paginated_rows.append(cleaned_row)
                    elif isinstance(row, list):
                        # Keep only columns that correspond to cleaned headers indices
                        cleaned_row = []
                        original_headers_list = list(info.get('current_template_headers', [])) or headers_to_use
                        for header in cleaned_headers:
                            try:
                                idx = original_headers_list.index(header)
                                cleaned_row.append(row[idx] if idx < len(row) else '')
                            except (ValueError, IndexError):
                                cleaned_row.append('')
                        cleaned_paginated_rows.append(cleaned_row)
                    else:
                        cleaned_paginated_rows.append(row)

                paginated_rows = cleaned_paginated_rows
        
        # Do not clear original_template_id; keep template-applied state for dashboard and restores

        # Include formula rules in response so frontend can display them (externalized for UI)
        formula_rules = _externalize_formula_rules(info.get('formula_rules', []), info)
        
        # FINAL SAFETY: ensure dict rows do not include stray keys not present in headers_to_use
        try:
            if isinstance(paginated_rows, list) and paginated_rows and isinstance(paginated_rows[0], dict):
                allowed = set(headers_to_use) | set(make_unique_field_headers(headers_to_use))
                cleaned = []
                for row in paginated_rows:
                    cleaned.append({k: v for k, v in row.items() if k in allowed})
                paginated_rows = cleaned
        except Exception:
            pass

        # Apply header corrections if they exist (for PDF sessions)
        final_headers = headers_to_use
        final_data = paginated_rows
        header_corrections = info.get('header_corrections', {})
        if header_corrections and isinstance(header_corrections, dict):
            corrected_headers = []
            header_mapping = {}
            for header in headers_to_use:
                # Find the corrected header name
                corrected_header = header
                for original, corrected in header_corrections.items():
                    if header == original:
                        corrected_header = corrected
                        header_mapping[original] = corrected
                        break
                corrected_headers.append(corrected_header)
            final_headers = corrected_headers

            # Update data rows to use corrected headers as keys
            if header_mapping and final_data and isinstance(final_data, list) and len(final_data) > 0 and isinstance(final_data[0], dict):
                corrected_data = []
                for row in final_data:
                    corrected_row = {}
                    for key, value in row.items():
                        corrected_key = header_mapping.get(key, key)
                        corrected_row[corrected_key] = value
                    corrected_data.append(corrected_row)
                final_data = corrected_data

        # Cluster specification columns (name then all its values) so dynamic split
        # columns stay beside their spec in the editor, matching the export instead
        # of drifting to the end.
        _ord = _cluster_factwise_columns(final_headers)
        if _ord != list(range(len(final_headers))):
            reordered = [final_headers[i] for i in _ord]
            if final_data and isinstance(final_data[0], list):
                final_data = [[row[i] if i < len(row) else '' for i in _ord] for row in final_data]
            final_headers = reordered

        # Get confidence data for quality metrics (robust PDF detection)
        confidence_data = {}
        header_confidence_scores = {}

        is_pdf_session_flag = False
        try:
            is_pdf_session = str(info.get('source_type', '')).startswith('pdf')
            if not is_pdf_session:
                try:
                    from .models import PDFSession as _PDFSession
                    is_pdf_session = _PDFSession.objects.filter(session_id=session_id).exists()
                except Exception:
                    is_pdf_session = False
            is_pdf_session_flag = is_pdf_session

            if is_pdf_session:
                try:
                    from .models import PDFSession, PDFExtractionResult
                    pdf_session = PDFSession.objects.get(session_id=session_id)
                    pdf_extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                    if pdf_extraction and getattr(pdf_extraction, 'confidence_scores', None):
                        confidence_data = pdf_extraction.confidence_scores or {}
                except Exception as e:
                    logger.error(f"📊 APPLY TEMPLATE: Error getting PDF confidence for {session_id}: {e}")
                    confidence_data = {}
                # Build header_confidence_scores aligned to final_headers
                header_conf_map = {}
                try:
                    header_conf_map = (confidence_data.get('header_confidence') or {}) if isinstance(confidence_data, dict) else {}
                except Exception:
                    header_conf_map = {}
                # Default overall fallback
                overall_conf = 0.8
                try:
                    qm = confidence_data.get('quality_metrics') or {}
                    overall_conf = float(qm.get('header_confidence') or qm.get('overall_confidence') or 0.8)
                except Exception:
                    overall_conf = 0.8

                # Column confidence based on mapping: assign source header confidence to target columns
                target_column_confidence = {}
                try:
                    # Build normalized header confidence for source headers (case-insensitive)
                    def _norm(h: str) -> str:
                        try:
                            return ''.join(ch for ch in str(h or '').lower().strip() if ch.isalnum())
                        except Exception:
                            return ''
                    norm_conf = {_norm(k): float(v) for k, v in (header_conf_map.items() if isinstance(header_conf_map, dict) else [])}
                    # Pull mappings from session
                    src_mappings = info.get('mappings')
                    if isinstance(src_mappings, dict) and 'mappings' in src_mappings:
                        mapping_list = src_mappings['mappings']
                    elif isinstance(src_mappings, list):
                        mapping_list = src_mappings
                    else:
                        # Old object format {target: source}
                        mapping_list = [{'source': s, 'target': t} for t, s in (src_mappings or {}).items()]

                    for m in (mapping_list or []):
                        try:
                            src = (m.get('source') or '').strip()
                            tgt = (m.get('target') or '').strip()
                            if not src or not tgt:
                                continue
                            # Only set if known; avoid defaulting to overall_conf here
                            conf = norm_conf.get(_norm(src))
                            if conf is None:
                                continue
                            prev = target_column_confidence.get(tgt)
                            if prev is None or conf > prev:
                                target_column_confidence[tgt] = conf
                        except Exception:
                            continue
                except Exception:
                    target_column_confidence = {}

                # Build header_confidence_scores for final headers using mapping-based confidence
                # If a column has no mapping-based confidence and is entirely blank, set 0.0 (not 80%)
                header_confidence_scores = {}
                try:
                    # Determine blank columns in final_data
                    all_blank = {h: True for h in final_headers}
                    if isinstance(final_data, list) and final_data:
                        if isinstance(final_data[0], dict):
                            for row in final_data:
                                for h in final_headers:
                                    if not all_blank[h]:
                                        continue
                                    val = str(row.get(h, '') or '').strip()
                                    if val:
                                        all_blank[h] = False
                        else:
                            idx_map = {h: i for i, h in enumerate(final_headers)}
                            for row in final_data:
                                for h, i in idx_map.items():
                                    if not all_blank[h]:
                                        continue
                                    if i is not None and i < len(row):
                                        val = str(row[i] or '').strip()
                                        if val:
                                            all_blank[h] = False
                    for h in final_headers:
                        if h in target_column_confidence:
                            header_confidence_scores[h] = float(target_column_confidence[h])
                        elif all_blank.get(h, False):
                            header_confidence_scores[h] = 0.0
                        else:
                            # Leave unset to avoid misleading defaults; frontend can fallback gracefully
                            pass
                except Exception:
                    # Fallback: use mapping-only
                    header_confidence_scores = {h: float(c) for h, c in target_column_confidence.items()}
        except Exception as e:
            logger.warning(f"Could not retrieve PDF confidence data: {e}")

        # Calculate data quality metrics
        quality_metrics = calculate_data_quality_metrics(
            final_data,
            final_headers,
            header_confidence_scores,
            confidence_data
        )

        # Enforce full canonical template headers in the response, regardless of data sparsity
        try:
            tags_count = int(info.get('tags_count', 3))
            spec_pairs_count = int(info.get('spec_pairs_count', 3))
            customer_id_pairs_count = int(info.get('customer_id_pairs_count', 1))

            # Use the SFO import shape as the canonical editor/export shape.
            # Slot keys such as Tag_1 are internal only; headers remain repeated Tag columns.
            base_headers = info.get('template_headers') or info.get('current_template_headers') or []
            canonical_headers = build_sfo_clustered_headers(
                base_headers,
                tags_count,
                spec_pairs_count,
                customer_id_pairs_count,
            )

            # Add MPN validation columns if they exist
            mpn_validation = info.get('mpn_validation', {})
            # Check for BOTH digikey_results and mouser_results (new structure) OR results (old structure)
            has_mpn_results = (mpn_validation.get('digikey_results') or mpn_validation.get('mouser_results') or mpn_validation.get('results'))
            if mpn_validation.get('column') and has_mpn_results:
                logger.info(f"🔍 DATA_VIEW_CANONICAL: Adding MPN columns to canonical_headers, has_digikey={bool(mpn_validation.get('digikey_results'))}, has_mouser={bool(mpn_validation.get('mouser_results'))}")
                # Add base MPN validation columns
                base_mpn_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                for mpn_col in base_mpn_columns:
                    if mpn_col not in canonical_headers:
                        canonical_headers.append(mpn_col)

                validation_columns_added = mpn_validation.get('validation_columns_added') or []
                if isinstance(validation_columns_added, list):
                    for mpn_col in validation_columns_added:
                        if mpn_col and mpn_col not in canonical_headers:
                            canonical_headers.append(mpn_col)
                else:
                    canonical_counts = validation_columns_added.get('canonical_counts', 5) if isinstance(validation_columns_added, dict) else 5
                    for i in range(1, canonical_counts + 1):
                        canonical_mpn_col = f'DigiKey Canonical MPN{" " + str(i) if i > 1 else ""}'
                        if canonical_mpn_col not in canonical_headers:
                            canonical_headers.append(canonical_mpn_col)

                # Add Mouser columns if Mouser validation was performed
                if mpn_validation.get('mouser_results'):
                    logger.info(f"🔍 DATA_VIEW_CANONICAL: Adding Mouser columns to canonical_headers")
                    mouser_columns = ['MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category']
                    for mouser_col in mouser_columns:
                        if mouser_col not in canonical_headers:
                            canonical_headers.append(mouser_col)

            # Preserve any response headers already produced by enhanced/validated data.
            # This keeps validation/parser/source-specific columns from being dropped by
            # the canonical template rebuild when metadata is older or partially shaped.
            for existing_header in final_headers:
                if existing_header and existing_header not in canonical_headers:
                    canonical_headers.append(existing_header)

            # Rebuild data rows to include all canonical headers in order
            rebuilt_rows = []
            logger.info(f"🔍 DATA_VIEW_REBUILD: final_data has {len(final_data)} rows, format={'dict' if (final_data and isinstance(final_data[0], dict)) else 'list'}, final_headers has {len(final_headers)} items, canonical_headers has {len(canonical_headers)} items")
            if isinstance(final_data, list) and final_data:
                if isinstance(final_data[0], dict):
                    canonical_field_headers = make_unique_field_headers(canonical_headers)
                    for row in final_data:
                        rebuilt = {}
                        for display_header, field_header in zip(canonical_headers, canonical_field_headers):
                            rebuilt[field_header] = row.get(field_header, row.get(display_header, ''))
                        rebuilt_rows.append(rebuilt)
                else:
                    # list-of-lists -> dict rows using current final_headers index mapping
                    idx_map = {h: i for i, h in enumerate(final_headers)}
                    for row in final_data:
                        rebuilt = {}
                        for h in canonical_headers:
                            i = idx_map.get(h)
                            val = ''
                            if i is not None and i < len(row):
                                val = row[i] if row[i] is not None else ''
                            rebuilt[h] = val
                        rebuilt_rows.append(rebuilt)
            else:
                rebuilt_rows = []

            final_headers = canonical_headers
            final_data = rebuilt_rows

            # Persist canonical headers to session to avoid drift across workers
            try:
                info['enhanced_headers'] = canonical_headers
                save_session(session_id, info)
            except Exception:
                pass
        except Exception as _e:
            # Non-fatal; keep computed headers/data
            pass

        # =========================================================================
        # MERGE PARSER COLUMNS (if parser was applied)
        # =========================================================================
        parser_columns = info.get('parser_columns')
        if parser_columns and parser_columns.get('headers') and parser_columns.get('data'):
            try:
                parser_headers = parser_columns['headers']
                parser_data = parser_columns['data']  # List of lists, one per row

                logger.info(f"📊 DATA_VIEW: Merging {len(parser_headers)} parser columns into response")

                # Add parser headers to final_headers
                final_headers = list(final_headers) + parser_headers

                # Merge parser data into each row
                merged_final_data = []
                for i, row in enumerate(final_data):
                    if isinstance(row, dict):
                        # Add parser values to the dict
                        new_row = dict(row)
                        if i < len(parser_data):
                            for j, parser_header in enumerate(parser_headers):
                                if j < len(parser_data[i]):
                                    new_row[parser_header] = parser_data[i][j] if parser_data[i][j] is not None else ''
                                else:
                                    new_row[parser_header] = ''
                        else:
                            # Pad with empty values
                            for parser_header in parser_headers:
                                new_row[parser_header] = ''
                        merged_final_data.append(new_row)
                    else:
                        merged_final_data.append(row)

                final_data = merged_final_data
                logger.info(f"📊 DATA_VIEW: Final headers count after parser merge: {len(final_headers)}")
            except Exception as parser_merge_err:
                logger.error(f"📊 DATA_VIEW: Error merging parser columns: {parser_merge_err}")

        try:
            cleaned_spec_pairs = cleanup_empty_spec_pairs(final_headers, final_data)
            if cleaned_spec_pairs:
                logger.info(f"Cleaned {cleaned_spec_pairs} empty Specification name/value pairs from data response")
        except Exception as spec_cleanup_err:
            logger.warning(f"Spec pair cleanup in data_view skipped: {spec_cleanup_err}")

        display_headers = list(final_headers or [])

        # An assembly is a Finished good in the editor too, not only on the way
        # out of the download.
        #
        # `_apply_sub_assembly_item_types` already does this, but it is called
        # from download_file, so the corrected type existed only in the exported
        # file. The grid the user is looking at said every one of these rows was
        # a raw material — filter Item type for "Finished good" and nothing came
        # back, while the export contained seven. Two answers to one question.
        #
        # Resolved from the popup's answers via the same join `locked_identity_
        # codes` uses, NOT by generating a BOM: this runs on every load of the
        # editor, and BOM generation is far too heavy for that. It also works
        # before a BOM has ever been generated, which is the state the user is
        # in when they first reach this page.
        _type_authored_assemblies(info, display_headers, final_data)

        # The authored finished good, onto the page being returned.
        #
        # Also done to the stored grid below, but that only runs once a grid
        # exists — on the FIRST load there is no `edited_data` yet, and without
        # this the row the user just authored would be missing from the very
        # screen they land on. Appending in both places is safe: the helper
        # skips anything already present by Item code.
        if isinstance(final_data, list):
            final_data, display_headers = _append_authored_finished_good(
                info, final_data, display_headers
            )

        # And onto the STORED grid, not just the page being returned.
        #
        # `final_data` is one page, rebuilt per request — typing it makes the
        # editor look right and changes nothing else. Every tool that has to
        # leave these rows alone (Fill column, Settings defaults, the editor
        # defaults above) resolves them through `_sub_assembly_codes_from_grid`,
        # which joins on the STORED grid's Item code. Leave that blank and the
        # lock set comes back empty, so a bulk "set Item type to Raw material"
        # would quietly turn all seven finished goods back into bought-in parts
        # and the BOMs would reference items that no longer claim to be made.
        stored = info.get('edited_data')
        stored_rows = stored.get('data') if isinstance(stored, dict) else stored
        stored_headers = (
            stored.get('headers') if isinstance(stored, dict) else None
        ) or display_headers
        if isinstance(stored_rows, list) and stored_rows:
            dirty = _type_authored_assemblies(info, stored_headers, stored_rows)

            # Drop an authored row that the sheet turns out to contain itself.
            #
            # An earlier load could append a finished good before its real row
            # was recognised — the sheet's row carried the ID rule's code
            # ("MPN1 SAMSUNG") rather than the answered one ("CPN1"), so the
            # append saw no match. Once the real row is corrected to "CPN1"
            # there are two rows for one item, which the item export reports as
            # a conflict and refuses to collapse.
            #
            # The appended one is identifiable: it has no CPN, because it never
            # came from a sheet row.
            fg_codes = {str(g['code']).strip() for g in _authored_finished_goods(info)}
            fg_codes.discard('')
            code_i = _grid_column_index(stored_headers, 'Item code')
            cpn_i = _grid_column_index(stored_headers, 'CPN Code')
            if fg_codes and code_i >= 0 and cpn_i >= 0:
                def cell(row, position):
                    return str(row[position] or '').strip() if (
                        isinstance(row, list) and position < len(row)
                    ) else ''
                real = {cell(r, cpn_i) for r in stored_rows} & fg_codes
                if real:
                    kept = [
                        r for r in stored_rows
                        if not (cell(r, code_i) in real and not cell(r, cpn_i))
                    ]
                    if len(kept) != len(stored_rows):
                        stored_rows[:] = kept
                        dirty = True

            # A flat sheet's finished good has no row of its own.
            #
            # It was authored in the popup — a single-level sheet lists the
            # components but not the thing they build — so it exists only in
            # `bom_structure` and never came from the uploaded file. The item
            # EXPORT appends it (`_append_authored_finished_good`), but the
            # editor never did, so the user answered for a finished good and
            # then could not find it in the grid. Nor could they edit it, or
            # see that it would be created at all.
            #
            # Appended to the stored grid so the editor, the export and the BOM
            # all describe the same set of items. The helper skips anything
            # already present by Item code, so a multi-level sheet whose root IS
            # in the data is untouched, and repeat loads cannot duplicate it.
            before = len(stored_rows)
            appended_rows, appended_headers = _append_authored_finished_good(
                info, stored_rows, stored_headers
            )
            if len(appended_rows) != before or appended_headers != stored_headers:
                if isinstance(stored, dict):
                    stored['data'] = appended_rows
                    stored['headers'] = appended_headers
                else:
                    info['edited_data'] = appended_rows
                dirty = True

            if dirty:
                save_session(session_id, info)

        field_headers = make_unique_field_headers(display_headers)
        response_data = []
        response_defaults = info.get("default_values", {}) or {}
        editor_defaults_summary = None
        settings_obj = get_editor_defaults_for_entity(editor_defaults_entity)
        if settings_obj and isinstance(final_data, list):
            final_data, editor_defaults_summary = apply_editor_defaults_to_rows(
                display_headers,
                final_data,
                settings_obj,
                sequence_offset=start_idx,
                locked_codes=locked_identity_codes(info, display_headers, final_data),
            )
        if isinstance(final_data, list):
            for row in final_data:
                if isinstance(row, dict):
                    normalized_row = {}
                    for field_header, display_header in zip(field_headers, display_headers):
                        value = row.get(field_header, row.get(display_header, ""))
                        if (value is None or str(value).strip() == "") and field_header in response_defaults:
                            value = response_defaults.get(field_header, "")
                        normalized_row[field_header] = value
                    response_data.append(normalized_row)
                elif isinstance(row, list):
                    normalized_row = {}
                    for idx, field_header in enumerate(field_headers):
                        value = row[idx] if idx < len(row) else ""
                        if (value is None or str(value).strip() == "") and field_header in response_defaults:
                            value = response_defaults.get(field_header, "")
                        normalized_row[field_header] = value
                    response_data.append(normalized_row)
                else:
                    response_data.append(row)
        else:
            response_data = final_data

        return no_store(Response({
            'success': True,
            'headers': field_headers,
            'display_headers': display_headers,
            'data': response_data,
            'total_rows': total_rows,
            'formula_rules': formula_rules,
            'template_version': info.get('template_version', 0),
            'editor_defaults': editor_defaults_summary,
            'quality_metrics': quality_metrics,
            'header_confidence_scores': header_confidence_scores,
            'target_column_confidence_scores': header_confidence_scores,
            'is_from_pdf': is_pdf_session_flag,
            'cleanup_info': {
                'primary_column': info.get('primary_column'),
                'rows_deleted': info.get('rows_deleted', 0),
                'total_rows_before': info.get('total_rows_before'),
                'total_rows_after': info.get('total_rows_after'),
                'deleted_rows_preview': info.get('deleted_rows_preview', []),
            } if info.get('rows_deleted') else None,
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total_rows': total_rows,
                'total_pages': (total_rows + page_size - 1) // page_size if total_rows > 0 else 1
            }
        }))
        
    except Exception as e:
        import traceback
        logger.error(f"Error in data_view: {e}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to get data: {str(e)}'
        }, status=500))


@api_view(['POST'])
def save_data(request):
    """Save edited data."""
    try:
        session_id = request.data.get('session_id')
        data = request.data.get('data', [])
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Normalize payload: accept { rows: [...] } or raw list
        rows_payload = None
        try:
            if isinstance(data, list):
                rows_payload = data
            elif isinstance(data, dict):
                # common shapes: { rows: [...] } or { data: [...] }
                rows_payload = data.get('rows') or data.get('data')
        except Exception:
            rows_payload = None

        if not isinstance(rows_payload, list):
            rows_payload = []

        # Ensure headers are preserved; prefer existing enhanced headers, else derive canonical/keys
        enhanced_headers = list(
            info.get('enhanced_headers')
            or info.get('current_template_headers')
            or info.get('template_headers')
            or []
        )
        if not enhanced_headers and rows_payload and isinstance(rows_payload[0], dict):
            enhanced_headers = list(rows_payload[0].keys())

        # The editor keys its rows by internal names (Tag_1, Specification_Name_2,
        # "Preferred vendor code__2" for a repeated header); this list holds display
        # headers (Tag (1), Specification name (2)). They are the same columns under
        # two names, matched by POSITION via make_unique_field_headers -- not by
        # string equality. Treating an internal name as an unknown display header
        # appended a phantom column per slot on every save, and the edited values
        # then landed in the phantom instead of the real column.
        field_keys = make_unique_field_headers(enhanced_headers)
        if rows_payload and isinstance(rows_payload[0], dict):
            known = set(enhanced_headers) | set(field_keys)
            for row in rows_payload:
                if not isinstance(row, dict):
                    continue
                for key in row.keys():
                    if key and key not in known:
                        enhanced_headers.append(key)
                        known.add(key)
            field_keys = make_unique_field_headers(enhanced_headers)

        # Rows stay positional, aligned to enhanced_headers -- the shape every other
        # grid writer uses (see write_session_grid). Keying by name would merge the
        # two "Preferred vendor code" columns into one.
        row_lists = []
        for row in rows_payload:
            if isinstance(row, dict):
                row_lists.append([
                    row.get(field, row.get(header, ''))
                    for field, header in zip(field_keys, enhanced_headers)
                ])
            elif isinstance(row, list):
                row_lists.append([
                    row[idx] if idx < len(row) else ''
                    for idx in range(len(enhanced_headers))
                ])
        cleanup_empty_spec_pairs(enhanced_headers, row_lists)

        write_session_grid(session_id, info, enhanced_headers, row_lists)
        info["formula_enhanced_data"] = row_lists

        # Bypass cleanup/mapping; prefer edited data immediately
        info['uploaded_via_correction'] = True
        save_session(session_id, info)
        
        return Response({
            'success': True,
            'message': 'Data saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in save_data: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@never_cache
def session_status(request, session_id):
    """Get session status including template version for change tracking."""
    try:
        info = get_session_consistent(session_id)
        # Cross-worker consistency: prefer file snapshot if newer
        try:
            file_snapshot = load_session_from_file(session_id)
            if file_snapshot and file_snapshot.get('template_version', 0) > info.get('template_version', 0):
                SESSION_STORE[session_id] = file_snapshot
                info = file_snapshot
                logger.info(f"🔄 STATUS: Refreshed in-memory session {session_id} from file (newer template_version)")
        except Exception:
            pass
        if not info:
            return no_store(Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND))
        
        template_version = info.get('template_version', 0)
        
        # Get header counts for completeness
        tags_count = info.get('tags_count', 3)
        spec_pairs_count = info.get('spec_pairs_count', 3)
        customer_id_pairs_count = info.get('customer_id_pairs_count', 1)
        
        # Get current headers
        headers = info.get('enhanced_headers') or info.get('current_template_headers') or info.get('template_headers') or []
        
        return no_store(Response({
            'success': True,
            'template_version': template_version,
            'session_id': session_id,
            'counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            },
            'headers_count': len(headers),
            'has_mappings': bool(info.get('mappings')),
            'has_formula_rules': bool(info.get('formula_rules')),
            'has_default_values': bool(info.get('default_values'))
        }))
        
    except Exception as e:
        logger.error(f"Error in session_status: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to get session status: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR))


@api_view(['POST'])
def rebuild_template(request):
    """Rebuild template and update column counts."""
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Increment template version
        new_version = increment_template_version(session_id)
        logger.info(f"🔄 Rebuilt template for session {session_id}, version: {new_version}")
        
        return Response({
            'success': True,
            'template_version': new_version,
            'message': 'Template rebuilt successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in rebuild_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to rebuild template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _cluster_factwise_columns(headers):
    """
    Return a column order (list of original indices) that groups every repeated
    FactWise structure — Specification name/value/uom, Tag, Customer
    identification — so all of a group's columns are CONTIGUOUS, anchored at the
    group's first occurrence. Non-group columns keep their relative order.

    Why: the FactWise importer collects a specification's values by scanning
    "from a Specification name column up to the next Specification name column".
    When dynamic Specification columns are appended at the end, unrelated columns
    (Tag, vendor codes, procurement…) sit between two Specification-name columns,
    so the importer swallows them — and blank cells (read as the string 'none')
    collide into false "Same specification value" duplicate errors. Clustering the
    groups makes the export import-safe without changing which columns exist.
    """
    import re

    def group_of(h):
        n = re.sub(r'\s+', ' ', str(h or '').strip().lower())
        if (n.startswith('specification name') or n.startswith('specification value')
                or n.startswith('specification uom')
                or re.match(r'^specification_(name|value|uom)_\d+$', n)):
            return 'spec'
        if n == 'tag' or re.match(r'^tag_\d+$', n):
            return 'tag'
        if (n.startswith('custom identification') or n.startswith('custom identification')
                or re.match(r'^custom_identification_(name|value)_\d+$', n)):
            return 'customer'
        return None

    groups = {}
    for i, h in enumerate(headers):
        g = group_of(h)
        if g:
            groups.setdefault(g, []).append(i)
    if not groups:
        return list(range(len(headers)))

    def spec_kind(h):
        n = re.sub(r'\s+', ' ', str(h or '').strip().lower())
        return 0 if 'name' in n else (2 if 'uom' in n else 1)

    def spec_sort_keys(spec_indices):
        """Map each spec column index to (family, name<value<uom, split index).

        Which specification a column belongs to is read from its name when the
        name says so, and from its position when it does not:

          Specification_Name_2   internal slot  -> family ('slot', 2)
          Specification name.1   pandas rename  -> family ('dup', 1)
          Specification name     plain label    -> family opens at this column

        Deciding that per column matters because one header list can carry both
        styles at once — an uploaded template repeats the plain label while the
        session also holds the internal slots — and a single all-or-nothing flag
        then read the plain labels as one family, emitting three names, then
        three values, then three UOMs instead of three name/value/UOM triplets.

        Families are ordered by where they first appear, so the block still reads
        in sheet order. Within a family: the single name first, then all of its
        values (value #1, #2, #3 …), then UOM — FactWise reads a spec's values
        from its name column up to the next name, so one name owns many values.
        """
        keys = {}
        first_seen = {}
        current = None
        opened = 0
        for position, j in enumerate(spec_indices):
            n = re.sub(r'\s+', ' ', str(headers[j] or '').strip().lower())
            kind = spec_kind(headers[j])
            m_slot = re.match(r'^specification_(name|value|uom)_(\d+)$', n)
            if m_slot:
                family, split = ('slot', int(m_slot.group(2))), 0
            else:
                # "_2, _3…" is a split sibling of the column before it (Designator,
                # Designator_2…), not a specification of its own.
                m_split = re.search(r'_(\d+)$', n)
                split = int(m_split.group(1)) if m_split else 0
                core = n[:m_split.start()] if m_split else n
                m_dup = re.search(r'\.(\d+)$', core)
                if m_dup:
                    family = ('dup', int(m_dup.group(1)))
                else:
                    if current is None or (kind == 0 and split == 0):
                        opened += 1
                        current = ('pos', opened)
                    family = current
            first_seen.setdefault(family, position)
            keys[j] = (family, kind, split)
        return {j: (first_seen[family], kind, split)
                for j, (family, kind, split) in keys.items()}

    # Within the spec group, group each specification's columns together by family.
    if 'spec' in groups:
        sort_keys = spec_sort_keys(groups['spec'])
        groups['spec'] = sorted(groups['spec'], key=lambda j: sort_keys[j])

    consumed = set()
    order = []
    for i, h in enumerate(headers):
        if i in consumed:
            continue
        g = group_of(h)
        if g:
            for j in groups[g]:
                if j not in consumed:
                    order.append(j)
                    consumed.add(j)
        else:
            order.append(i)
            consumed.add(i)
    return order


def _drop_bom_columns(rows, headers):
    """Remove BOM structure columns from an item-directory export.

    The working grid deliberately holds item and BOM fields together so the user
    can edit them in one place, but the two FactWise imports are separate files
    and the item importer does not know these columns.
    """
    if not headers:
        return rows, headers

    excluded = {_template_label_key(name) for name in BOM_DESTINATION_HEADERS}
    keep = [position for position, header in enumerate(headers)
            if _template_label_key(header) not in excluded]
    if len(keep) == len(headers):
        return rows, headers

    new_headers = [headers[position] for position in keep]
    new_rows = []
    for row in rows or []:
        if isinstance(row, list):
            new_rows.append([row[position] if position < len(row) else '' for position in keep])
        elif isinstance(row, dict):
            new_rows.append({header: row.get(header, '') for header in new_headers})
        else:
            new_rows.append(row)
    return new_rows, new_headers


def _authored_finished_goods(info):
    """Finished goods the user authored in the BOM structure gate.

    Flat sheets list components but not the thing they build, so the finished
    good is entered in the popup and lives only on the session.
    """
    goods = []
    sheets = ((info or {}).get('bom_structure') or {}).get('sheets') or {}
    for _sheet_name, answer in sheets.items():
        if not isinstance(answer, dict) or not answer.get('hasBom'):
            continue
        if answer.get('bomGenerationAvailable') is False:
            continue
        header = answer.get('bomHeader') or {}
        code = str(header.get('finishedGoodCode') or '').strip()
        if not code:
            continue
        goods.append({
            'code': code,
            'name': str(header.get('itemName') or '').strip() or code,
            'uom': str(header.get('measurementUnit') or '').strip(),
        })
    return goods


def _sub_assembly_item_codes(session_id):
    """Item codes that are sub-assemblies — they have a BOM of their own.

    The BOM Normalizer emits `level`, `parentKey` and `relation` but never says
    "this row is a sub-assembly"; that is worked out later by ``derive_tree``,
    from the fact that the next row sits one level deeper. So the mapped grid has
    no way of knowing, and every assembly reaches the item directory typed as a
    raw material — an item that FactWise would treat as bought-in while a BOM
    claims to produce it.

    Generation is asked rather than re-deriving here, so the item sheet cannot
    disagree with the BOM sheet about which codes are assemblies. A failure is
    swallowed: BOM export reports it properly, and the item export should still
    produce a file.
    """
    try:
        result, _bom_header, error_response = _generate_bom_for_session(session_id)
        if error_response is not None or result is None:
            return set()
        return {
            str(row.get('Item code') or '').strip()
            for row in (result.item_rows or [])
            if str(row.get('Item type') or '').strip() == 'Finished good'
            and str(row.get('Item code') or '').strip()
        }
    except Exception as exc:
        logger.warning(f"Could not determine sub-assembly item types: {exc}")
        return set()


def _sub_assembly_codes_from_grid(info, headers, rows):
    """Item codes of sub-assemblies, resolved from the popup's answers.

    The popup keys its sub-BOM answers by the customer's part number, because
    that is all the sheet has; the item code is generated later and only exists
    in the grid. Joining the two on ``CPN Code`` gives the item codes without
    re-deriving the tree, which matters here because this runs on every fill.
    """
    sheets = ((info or {}).get('bom_structure') or {}).get('sheets') or {}
    part_numbers = set()
    for answer in sheets.values():
        if isinstance(answer, dict):
            part_numbers.update(str(code).strip() for code in (answer.get('subBoms') or {}))
    part_numbers.discard('')
    if not part_numbers or not headers:
        return []

    cpn_index = _grid_column_index(headers, 'CPN Code')
    code_index = _grid_column_index(headers, 'Item code')
    if cpn_index < 0 or code_index < 0:
        return []

    # An Item code shared by several CPNs names a GROUP, not a part, so it
    # cannot stand in for one sub-assembly. The ID rule builds from MPN +
    # manufacturer, and a placeholder MPN ("TO SPECIFICATION") collapses every
    # row carrying it onto a single code — 132 rows over 62 distinct parts in
    # the sheet that produced this. One of those rows was a real sub-assembly,
    # so returning its code put the shared string into the assembly set, and the
    # Item-code fallback below then matched all 62 leaves and typed them
    # Finished good. A code that does not identify a row cannot resolve one.
    # The answer names ONE part, so it may only resolve to ONE item code, and
    # that code may only belong to that part. Both directions are checked
    # because both have failed: a placeholder MPN ("TO SPECIFICATION") collapses
    # every row carrying it onto one code, and a CPN column mapped to a
    # near-constant puts every row under one part number. Either way a single
    # real sub-assembly would otherwise hand its whole group to the caller,
    # which types all of them Finished good.
    cpns_of_code = {}
    codes_of_cpn = {}
    for row in rows or []:
        if not isinstance(row, list) or max(cpn_index, code_index) >= len(row):
            continue
        code = str(row[code_index] or '').strip()
        if not code:
            continue
        cpn = str(row[cpn_index] or '').strip()
        cpns_of_code.setdefault(code, set()).add(cpn)
        if cpn in part_numbers:
            codes_of_cpn.setdefault(cpn, set()).add(code)

    codes = []
    for found in codes_of_cpn.values():
        if len(found) != 1:
            continue
        code = next(iter(found))
        if len(cpns_of_code.get(code) or ()) == 1:
            codes.append(code)
    return codes


def _type_authored_assemblies(info, headers, rows):
    """Type the authored finished good and every sub-assembly as Finished good.

    "Anything with a BOM under it is a finished good" — the root the user
    authored in the structure gate, and every part they answered as a sub-BOM.
    Left as Raw material, FactWise treats them as bought-in while a BOM claims
    to produce them.

    Codes come from the popup's answers, not from deriving a tree: this runs on
    every editor load, and it has to work before any BOM has been generated.
    Sub-BOM answers are keyed by the customer's part number, so they are joined
    to the grid on ``CPN Code`` — the same join ``locked_identity_codes`` uses,
    which is what then protects the value from being bulk-filled away again.

    Mutates ``rows`` in place and returns how many it changed.
    """
    if not headers or not isinstance(rows, list):
        return 0

    # Match value -> the item code that row should carry.
    #
    # An assembly usually has NO generated Item code: the FactWise ID rule
    # builds from MPN + manufacturer and an assembly has neither, so the column
    # comes out blank on exactly the seven rows the user just named. But the
    # popup asked for those codes and they are on the session — a blank cell
    # here is an answer that was given and then dropped, and it is the code
    # FactWise needs to create the item at all.
    item_code_of = {}
    for good in _authored_finished_goods(info):
        code = str(good['code']).strip()
        if code:
            item_code_of[code] = code
    # Resolved item codes, for rows that already have one.
    for code in _sub_assembly_codes_from_grid(info, headers, rows):
        code = str(code).strip()
        if code:
            item_code_of.setdefault(code, code)
    # Sub-BOM answers are keyed by the customer's part number, which is what the
    # grid carries in CPN Code. `finishedGoodCode` is the item the sub-BOM
    # builds, and may have been renamed away from the sheet's own number.
    for answer in (((info or {}).get('bom_structure') or {}).get('sheets') or {}).values():
        if not isinstance(answer, dict):
            continue
        for part_number, sub in (answer.get('subBoms') or {}).items():
            part_number = str(part_number).strip()
            if not part_number:
                continue
            resolved = str((sub or {}).get('finishedGoodCode') or '').strip() or part_number
            item_code_of[part_number] = resolved

    codes = set(item_code_of)
    codes.discard('')
    if not codes:
        return 0

    # On a hierarchical sheet the answers name EVERY block, so a row they do not
    # claim is not an assembly — and saying so out loud is what lets a wrong
    # value heal. Without it `Finished good` is write-once: a stamp applied by a
    # bad match survives the fix to whatever caused it, because nothing ever
    # writes the type back down. Only an explicit `Finished good` is reverted;
    # blank is left for the editor defaults to fill.
    authoritative = any(
        answer.get('hasLevels')
        for answer in (((info or {}).get('bom_structure') or {}).get('sheets') or {}).values()
        if isinstance(answer, dict)
    )

    code_index = _grid_column_index(headers, 'Item code')
    type_index = _grid_column_index(headers, 'Item type')
    cpn_index = _grid_column_index(headers, 'CPN Code')
    if type_index < 0:
        return 0

    changed = 0
    for row in rows:
        if isinstance(row, list):
            def read(position):
                return str(row[position] or '').strip() if 0 <= position < len(row) else ''
            # The authored root has no generated Item code of its own, so the
            # part number is accepted too — that is the only handle it has.
            existing_code = read(code_index)
            # CPN first, ALWAYS. The sub-BOM answers are keyed by part number,
            # so CPN is the reliable handle; the row's own Item code is what may
            # be wrong. Checking Item code first let a row match on its own bad
            # code — `_sub_assembly_codes_from_grid` had added "SAMSUNG" to the
            # set, so the CPN9 row resolved to itself and was left alone.
            cpn_value = read(cpn_index)
            matched = cpn_value if cpn_value in codes else (
                existing_code if existing_code in codes else ''
            )
            if matched not in codes:
                if authoritative and read(type_index) == 'Finished good':
                    row[type_index] = 'Raw material'
                    changed += 1
                continue
            while len(row) <= max(type_index, code_index):
                row.append('')
            if str(row[type_index] or '').strip() != 'Finished good':
                row[type_index] = 'Finished good'
                changed += 1
            # The popup's code WINS, even over one the ID rule already wrote.
            #
            # The BOM sheet is generated from these answers, so its Finished
            # good code / Sub BOM ID cells carry them. If the item directory
            # holds something else the two files cannot be reconciled: the ID
            # rule builds from MPN + manufacturer, so this sheet's assemblies
            # came out as "MPN1 SAMSUNG" and — for one with no MPN at all —
            # bare "SAMSUNG", while the BOM referenced CPN1 and CPN9. The
            # import then fails on the second file with the sub-BOM missing
            # from the directory.
            wanted = item_code_of[matched]
            if code_index >= 0 and wanted and existing_code != wanted:
                row[code_index] = wanted
                changed += 1
        elif isinstance(row, dict):
            code_key = headers[code_index] if 0 <= code_index < len(headers) else None
            cpn_key = headers[cpn_index] if 0 <= cpn_index < len(headers) else None
            type_key = headers[type_index]
            existing_code = str(row.get(code_key) or '').strip() if code_key else ''
            cpn_value = str(row.get(cpn_key) or '').strip() if cpn_key else ''
            matched = cpn_value if cpn_value in codes else (
                existing_code if existing_code in codes else ''
            )
            if matched not in codes:
                if authoritative and str(row.get(type_key) or '').strip() == 'Finished good':
                    row[type_key] = 'Raw material'
                    changed += 1
                continue
            if str(row.get(type_key) or '').strip() != 'Finished good':
                row[type_key] = 'Finished good'
                changed += 1
            wanted = item_code_of[matched]
            if code_key and wanted and existing_code != wanted:
                row[code_key] = wanted
                changed += 1
    return changed


def _apply_sub_assembly_item_types(session_id, info, rows, headers):
    """Type every sub-assembly row in the item export as a Finished good."""
    sheets = ((info or {}).get('bom_structure') or {}).get('sheets') or {}
    if not any(answer.get('hasLevels') for answer in sheets.values() if isinstance(answer, dict)):
        return rows, 0
    codes = _sub_assembly_item_codes(session_id)
    if not codes or not headers:
        return rows, 0

    def index_of(name):
        for position, header in enumerate(headers):
            if _template_label_key(header) == _template_label_key(name):
                return position
        return -1

    code_index = index_of('Item code')
    type_index = index_of('Item type')
    if code_index < 0 or type_index < 0:
        return rows, 0

    changed = 0
    for row in rows or []:
        if isinstance(row, list):
            if code_index >= len(row):
                continue
            code = str(row[code_index] or '').strip()
            if code in codes and str(row[type_index] or '').strip() != 'Finished good':
                while len(row) <= type_index:
                    row.append('')
                row[type_index] = 'Finished good'
                changed += 1
        elif isinstance(row, dict):
            code = str(row.get(headers[code_index]) or '').strip()
            if code in codes and str(row.get(headers[type_index]) or '').strip() != 'Finished good':
                row[headers[type_index]] = 'Finished good'
                changed += 1
    return rows, changed


def _dedupe_item_rows(rows, headers):
    """Collapse repeated item rows, and report codes whose rows disagree.

    One grid row feeds one BOM line AND one item row. A part consumed in three
    assemblies is three grid rows on purpose — the BOM needs all three — but the
    item directory needs it once. Deleting the repeats to satisfy the directory
    is what silently strips those lines out of the BOM, so the collapse happens
    here, on the way out, and the grid keeps every row.

    Rows identical across every exported column collapse to the first: that is
    the same item listed again, and nothing is lost. Rows sharing an Item code
    but differing somewhere do NOT collapse — only the user knows which is
    right — so they are returned as conflicts and the caller blocks the export.

    Returns ``(rows, conflicting_codes)``.
    """
    if not headers:
        return rows, []

    code_index = -1
    for position, header in enumerate(headers):
        if _template_label_key(header) == _template_label_key('Item code'):
            code_index = position
            break
    if code_index < 0:
        return rows, []

    width = len(headers)

    def signature(row):
        # Padded to the header count so a row with trailing blanks trimmed off
        # still matches the identical row that kept them.
        cells = [str(cell or '').strip() for cell in row[:width]]
        return tuple(cells + [''] * (width - len(cells)))

    first_seen = {}
    conflicts = []
    output = []
    for row in rows or []:
        if not isinstance(row, list) or code_index >= len(row):
            output.append(row)
            continue
        code = str(row[code_index] or '').strip()
        if not code:
            # A blank code is a different failure with its own message. Passing
            # these through keeps that check's count honest.
            output.append(row)
            continue
        current = signature(row)
        if code not in first_seen:
            first_seen[code] = current
            output.append(row)
        elif first_seen[code] == current:
            continue
        else:
            if code not in conflicts:
                conflicts.append(code)
            output.append(row)

    return output, conflicts


def _append_authored_finished_good(info, rows, headers):
    """Append authored finished goods to an item-directory export.

    Values are placed by header name, so this works whatever column order the
    user chose. Anything already present (by Item code) is left alone so a
    repeated download cannot duplicate it.
    """
    goods = _authored_finished_goods(info)
    if not goods or not headers:
        return rows, headers

    def index_of(*names):
        for name in names:
            for position, header in enumerate(headers):
                if _template_label_key(header) == _template_label_key(name):
                    return position
        return -1

    code_index = index_of('Item code')
    if code_index < 0:
        # Nothing to key on; adding a row would produce an item with no code.
        return rows, headers

    name_index = index_of('Item name')
    description_index = index_of('Description')
    type_index = index_of('Item type')
    uom_index = index_of('Measurement unit')

    # Matched on CPN as well as Item code.
    #
    # A multi-level sheet contains its own finished good, so a row for it
    # already exists — but its Item code is whatever the FactWise ID rule
    # generated ("MPN1 SAMSUNG"), not the code the popup answered ("CPN1").
    # Keying on Item code alone therefore saw no match and appended a second
    # row for the same item.
    cpn_index = index_of('CPN Code')
    # Both row shapes. The stored grid holds lists, but a page assembled for the
    # editor holds dicts — and skipping those made `existing` empty, so the
    # helper concluded the finished good was missing and appended a SECOND one.
    # The row was right in the data and duplicated only on screen, which is a
    # confusing way to be wrong.
    code_header = headers[code_index] if 0 <= code_index < len(headers) else None
    cpn_header = headers[cpn_index] if 0 <= cpn_index < len(headers) else None
    existing = set()
    for row in rows or []:
        if isinstance(row, list):
            if code_index < len(row):
                existing.add(str(row[code_index] or '').strip())
            if 0 <= cpn_index < len(row):
                existing.add(str(row[cpn_index] or '').strip())
        elif isinstance(row, dict):
            for header in (code_header, cpn_header):
                if header is not None:
                    existing.add(str(row.get(header) or '').strip())
    existing.discard('')

    constants = _constant_column_values(rows, headers)

    def stamp_identity(target_row, good):
        """Write the authored identity onto a row, leaving everything else alone."""
        while len(target_row) <= max(code_index, name_index, description_index, type_index, uom_index):
            target_row.append('')
        target_row[code_index] = good['code']
        if name_index >= 0:
            target_row[name_index] = good['name']
        if description_index >= 0:
            target_row[description_index] = good['name']
        if type_index >= 0:
            target_row[type_index] = 'Finished good'
        if uom_index >= 0:
            target_row[uom_index] = good['uom']

    output = list(rows or [])
    for good in goods:
        if good['code'] in existing:
            # Already a row — usually because the sheet was exported and imported
            # back. Re-stamp its identity so it cannot have drifted away from what
            # the user authored (a bulk fill before the lock existed, an edit in
            # Excel, a stale template replay).
            for row in output:
                if isinstance(row, list) and code_index < len(row)                         and str(row[code_index] or '').strip() == good['code']:
                    stamp_identity(row, good)
            continue
        new_row = [''] * len(headers)
        # Enterprise-level values (procurement entity, buyer/seller flags) are
        # the same on every row, so the finished good inherits them. Without
        # this it exports with a blank `Procurement entity name`, which is a
        # required column, and the import fails on that row alone.
        for position, value in constants.items():
            if position < len(new_row):
                new_row[position] = value
        new_row[code_index] = good['code']
        if name_index >= 0:
            new_row[name_index] = good['name']
        if description_index >= 0:
            new_row[description_index] = good['name']
        if type_index >= 0:
            new_row[type_index] = 'Finished good'
        if uom_index >= 0:
            new_row[uom_index] = good['uom']
        output.append(new_row)
        existing.add(good['code'])

    return output, headers


def _constant_column_values(rows, headers):
    """Columns whose value we can safely inherit onto a synthesised row, as
    {index: value}.

    Enterprise-wide settings (Procurement entity name, currency, buyer/seller
    flags, etc.) are the same across every real row, so a synthesised
    finished-good row should carry them too. But we can NOT be strict about
    100% match — as soon as the user edits one row's Procurement entity name
    to something else (say, `ffg`), the column stops being "constant" and the
    synthesised row ends up blank, which then trips a RequiredField error on
    Factwise's item importer.

    Instead we accept the MAJORITY non-blank value across the sheet:
      - collect all non-blank values in the column
      - pick the most common one
      - if it appears in at least 60% of the non-blank rows, treat it as the
        column's enterprise value

    Codes / descriptions / MPNs still never inherit — see never_inherit below.
    """
    if not rows or not headers:
        return {}

    # Item identity must never be inherited, even if a sheet happens to have one
    # row and every column therefore looks constant.
    never_inherit = {
        _template_label_key(name) for name in
        ('Item code', 'Item name', 'Description', 'Item type', 'Measurement unit',
         'MPN Code', 'CPN Code', 'ERP Code', 'SAP Item ID', 'HSN Code')
    }

    from collections import Counter

    constants = {}
    for position, header in enumerate(headers):
        if _template_label_key(header) in never_inherit:
            continue
        values = []
        for row in rows:
            if not isinstance(row, list) or position >= len(row):
                continue
            v = str(row[position] or '').strip()
            if v:
                values.append(v)
        if not values:
            continue
        counter = Counter(values)
        majority_value, majority_count = counter.most_common(1)[0]
        # 60% threshold: on a sheet of ~100 items, this happily inherits when
        # 1-40 rows have been individually edited to a different value. Below
        # that we assume the column is genuinely variable (per-row) and skip.
        if majority_count / len(values) >= 0.6:
            constants[position] = majority_value
    return constants


# The export header cleanup below strips digits/underscores and applies
# str.capitalize(), which is right for dynamic slots (Specification_Name_3 ->
# "Specification name") but destroys acronyms: "CPN Code" -> "Cpn code".
# These restore the labels FactWise expects, keyed by the cleaned header
# lowercased with non-alphanumerics collapsed to single spaces.
#
# "SAP Item ID" was renamed to "ERP Code" in the destination template, so new
# sessions already carry the new label; the alias here keeps sessions created
# before the rename exporting under the same name.
EXPORT_HEADER_CANONICAL_LABELS = {
    'cpn code': 'CPN Code',
    'mpn code': 'MPN Code',
    'hsn code': 'HSN Code',
    'erp code': 'ERP Code',
    'sap item id': 'ERP Code',
    # The template spells it 'Specification UOM', and a numbered slot exports
    # that text verbatim. The legacy `Specification_UOM_3` path runs through
    # capitalize() and would emit 'Specification uom' instead - two header texts
    # for one column, which FactWise reads as two different columns because it
    # groups by exact text.
    'specification uom': 'Specification UOM',
}

# Old label -> new label, as _template_label_key sees them. Lets
# import_edited_sheet match a sheet exported under one name onto a grid built
# under the other.
IMPORT_HEADER_ALIASES = {
    'sap item id': 'erp code',
}



# Internal prefix -> the exact header text FactWise expects in an exported file.
# Mirrors frontend/src/utils/columnHeaderNames.js — keep the two in step.
_TEMPLATE_GROUP_PREFIXES = (
    ('Tag_', 'Tag'),
    ('Specification_Name_', 'Specification name'),
    ('Specification_Value_', 'Specification value'),
    ('Specification_UOM_', 'Specification UOM'),
    # FactWise's column is 'Custom identification'; the internal field keeps the
    # longer spelling because every saved session and mapping uses it. Only what
    # is written to the file changes — 'Custom identification name' is not a
    # column FactWise knows, so its values were dropped on import.
    ('Custom_Identification_Name_', 'Custom identification name'),
    ('Custom_Identification_Value_', 'Custom identification value'),
)

_DISPLAY_SUFFIX_RE = re.compile(r'\s*\(\d+\)\s*$')


def canonical_export_header(column):
    """The header text to write to a file for one column.

    Repeated template columns are shown in the app with their slot number
    (``Tag (2)``) so the user can tell three otherwise identical columns apart.
    FactWise groups repeats by EXACT header text, so every export has to put
    that number back: ``Tag_2`` and ``Tag (2)`` both go out as ``Tag``, and the
    importer sees one three-slot Tag group instead of three unknown columns.
    """
    name = str(column or '').strip()
    if not name:
        return name

    for prefix, canonical in _TEMPLATE_GROUP_PREFIXES:
        if name.startswith(prefix) and name[len(prefix):].isdigit():
            return canonical

    # Display label form: 'Tag (2)' -> 'Tag'. A trailing bare number is part of
    # the real name ('DigiKey Canonical MPN 2'), so only the bracketed form goes.
    stripped = _DISPLAY_SUFFIX_RE.sub('', name)
    if stripped != name:
        return stripped

    # Generic split-generated run: 'Reference Designator_7' -> 'Reference Designator'.
    match = re.match(r'^(.+)_(\d+)$', name)
    if match:
        return match.group(1).replace('_', ' ')

    return name


def _positional_row_keys(headers):
    """Unique dict keys for headers that legitimately repeat.

    The FactWise template repeats `Tag`, `Specification name/value/UOM` and
    `Preferred vendor code`. Keying rows by header name alone collapses those to
    one entry — the last occurrence wins — so anything written into the first
    Tag slot vanished on export and the last slot's value was copied across all
    of them. Suffixing repeats keeps each column addressable.
    """
    seen = {}
    keys = []
    for header in headers or []:
        name = str(header)
        count = seen.get(name, 0)
        seen[name] = count + 1
        # A marker no real FactWise header contains, so a suffixed key can
        # never collide with a genuine column name.
        keys.append(name if count == 0 else '%s @@dup%d' % (name, count))
    return keys


_POSITIONAL_KEY_SUFFIX_RE = re.compile(r' @@dup\d+$')


def _display_header(key):
    """The header a positional key stands for.

    Row dicts are keyed by ``_positional_row_keys``, so their keys carry the
    repeat marker. Anything that turns row keys back into column headings has to
    strip it, or the marker is written into the exported file as a column name.
    """
    return _POSITIONAL_KEY_SUFFIX_RE.sub('', str(key))


def _headers_with_repeats(ordered_headers, present_headers):
    """``ordered_headers``, topped up so every repeat present in the data survives.

    Comparing header names one at a time cannot distinguish "this column is
    already covered" from "this is a second Specification name" — the FactWise
    template repeats several columns by design. Counting is what tells them
    apart; matching by name alone either drops real repeats or, as it did here,
    re-appends them under their internal key.
    """
    output = list(ordered_headers)
    have = Counter(output)
    need = Counter(present_headers)
    for header in present_headers:
        if have[header] < need[header]:
            output.append(header)
            have[header] += 1
    return output


def _duplicate_highlight_positions(df, extra_columns=None):
    """Cells the editor would flag as duplicates, as {col_position: {row_positions}}.

    Duplicate Item codes are the error the editor highlights in amber, and the
    downloaded workbook used to lose that entirely — the user had to find the
    repeats again by eye in Excel. Positions rather than names because the
    export can legitimately carry repeated header labels (Tag, Specification).
    """
    targets = {_template_label_key('Item code')}
    for name in (extra_columns or []):
        key = _template_label_key(str(name or ''))
        if key:
            targets.add(key)

    positions = {}
    for pos, column in enumerate(df.columns):
        if _template_label_key(str(column or '')) not in targets:
            continue
        counts = Counter()
        values = []
        for value in df.iloc[:, pos].tolist():
            text = str(value if value is not None else '').strip()
            values.append(text)
            if text:
                counts[text] += 1
        repeated = {row for row, text in enumerate(values) if text and counts[text] > 1}
        if repeated:
            positions[pos] = repeated
    return positions


def _highlight_duplicate_cells(output_file, df, extra_columns=None):
    """Paint the duplicate cells amber in an already-written xlsx. Returns count."""
    positions = _duplicate_highlight_positions(df, extra_columns)
    if not positions:
        return 0

    from openpyxl import load_workbook
    workbook = load_workbook(output_file)
    sheet = workbook.active
    fill = PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid')
    font = Font(bold=True, color='92400E')
    painted = 0
    for col_pos, rows in positions.items():
        for row_pos in rows:
            # Row 1 is the header row, so grid row 0 is spreadsheet row 2.
            cell = sheet.cell(row=row_pos + 2, column=col_pos + 1)
            cell.fill = fill
            cell.font = font
            painted += 1
    workbook.save(output_file)
    return painted


@api_view(['GET', 'POST'])
def download_file(request, session_id=None):
    """Download processed/converted file."""
    try:
        # Support both URL path and query/form parameters for session_id
        if not session_id:
            # Fallback to old method for backwards compatibility
            if request.method == 'POST':
                session_id = request.data.get('session_id') or request.POST.get('session_id')
            else:
                session_id = request.GET.get('session_id')

        # Extract column order from request if provided
        requested_column_order = None
        export_type = 'item'
        highlight_duplicate_columns = []
        if request.method == 'POST':
            requested_column_order = request.data.get('column_order')
            export_type = str(request.data.get('export_type') or 'item').strip().lower()
            extra_highlight = request.data.get('highlight_duplicate_columns')
            if isinstance(extra_highlight, list):
                highlight_duplicate_columns = extra_highlight

        # The working grid holds item and BOM fields together so the user can
        # edit them in one place, but the two FactWise imports are different
        # files. BOM structure columns must not appear in an item directory
        # export: the item importer does not know them.
        if export_type == 'item' and requested_column_order:
            excluded = {_template_label_key(name) for name in BOM_DESTINATION_HEADERS}
            requested_column_order = [
                column for column in requested_column_order
                if _template_label_key(column) not in excluded
            ]


        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        def _download_rows(value):
            if isinstance(value, dict):
                rows = value.get('data') or value.get('rows')
                return rows if isinstance(rows, list) else []
            return value if isinstance(value, list) else []

        # Prefer the same live snapshots the editor mutates. Older enhanced_data
        # can lag behind manual edits/FactWise ID creation, so it is a fallback.
        edited_rows = _download_rows(info.get("edited_data"))
        formula_rows = _download_rows(info.get("formula_enhanced_data"))
        enhanced_data_result = info.get("enhanced_data")
        enhanced_rows = _download_rows(enhanced_data_result)

        # `edited_data` is written by write_session_grid, which always persists
        # the whole grid, so it is the editor's live state and is authoritative.
        # `enhanced_data` is the one that can lag behind manual edits, so only it
        # needs the stale-snapshot guard below.
        grid_is_authoritative = False

        if edited_rows:
            enhanced_data = edited_rows
            use_mpn_enhanced = False
            grid_is_authoritative = True
            logger.info(f"DOWNLOAD: Using edited data with {len(enhanced_data)} rows")
        elif formula_rows:
            enhanced_data = formula_rows
            use_mpn_enhanced = False
            grid_is_authoritative = True
            logger.info(f"DOWNLOAD: Using formula-enhanced data with {len(enhanced_data)} rows")
        elif enhanced_rows:
            enhanced_data = enhanced_rows
            use_mpn_enhanced = True
            logger.info(f"DOWNLOAD: Using enhanced data fallback with {len(enhanced_data)} rows")
        else:
            enhanced_data = []
            use_mpn_enhanced = False

        # If an old small snapshot is present while dataset is large, ignore it
        try:
            client_local_path = hybrid_file_manager.get_file_path(info["client_path"])
            total_rows_est = _count_total_data_rows(
                client_local_path,
                info.get("sheet_name"),
                info.get("header_row", 1) - 1 if info.get("header_row", 1) > 0 else 0
            )
        except Exception:
            total_rows_est = 0

        # A grid smaller than the uploaded file used to be treated as a stale
        # snapshot and thrown away, silently re-deriving the export from the raw
        # upload. But deleting rows is a normal thing to do in the editor, and it
        # makes the grid smaller by design — so the export came back with the
        # deleted rows restored, no generated Item codes and no Item types, and
        # nothing said it had happened. The live grid is now believed whatever
        # its size; the guard applies only to the snapshot that can lag.
        if enhanced_data and grid_is_authoritative and total_rows_est and len(enhanced_data) < total_rows_est:
            logger.info(
                f"DOWNLOAD: grid has {len(enhanced_data)} rows vs {total_rows_est} in the "
                f"uploaded file — exporting the grid, rows were deleted in the editor"
            )

        if enhanced_data and (grid_is_authoritative or total_rows_est == 0
                              or len(enhanced_data) >= total_rows_est):
            # Use formula-enhanced or MPN-enhanced data for download
            transformed_rows = enhanced_data
            # Use enhanced_headers if MPN-enhanced, otherwise use current_template_headers
            if use_mpn_enhanced:
                base_headers = info.get("enhanced_headers") or []
                logger.info(f"🔧 DOWNLOAD: Using MPN-enhanced data with {len(base_headers)} headers")
            else:
                base_headers = info.get("current_template_headers") or info.get("enhanced_headers") or []
                logger.info(f"🔧 DOWNLOAD: Using formula-enhanced data with {len(base_headers)} headers")

            # Rows are stored as position-aligned lists. Convert them to dicts keyed
            # by their real headers so that any later column reordering moves values
            # by NAME — otherwise reordering only relabels positions and scrambles
            # every cell (designators land under Procurement/Spec columns, etc.).
            if transformed_rows and isinstance(transformed_rows[0], list) and base_headers:
                transformed_rows = [
                    dict(zip(_positional_row_keys(base_headers),
                             [(row[i] if i < len(row) else '') for i in range(len(base_headers))]))
                    for row in transformed_rows
                ]

            # Inject MPN validation columns for enhanced data path as well
            try:
                mpn_validation = info.get('mpn_validation') or {}
                mpn_header = mpn_validation.get('column')
                # Check for new dual structure (digikey_results/mouser_results) or old structure (results)
                digikey_results_map = mpn_validation.get('digikey_results') or {}
                mouser_results_map = mpn_validation.get('mouser_results') or {}
                results_map = mpn_validation.get('results') or {}

                # Only inject if not using MPN-enhanced data (which already has the columns)
                if mpn_header and isinstance(transformed_rows, list) and transformed_rows and not use_mpn_enhanced:
                    from .services.digikey_service import DigiKeyClient
                    client_norm = DigiKeyClient.normalize_mpn

                    # Limit canonical MPN columns to reasonable number (max 5) to avoid excessive blank columns
                    max_canonical_mpns = 1
                    for row in transformed_rows:
                        if isinstance(row, dict) and 'MPN valid (DigiKey)' not in row:
                            raw = row.get(mpn_header, '')
                            norm = client_norm(raw)
                            res = results_map.get(norm, {})
                            all_canonicals = res.get('all_canonical_mpns', [])
                            if len(all_canonicals) > max_canonical_mpns:
                                max_canonical_mpns = min(len(all_canonicals), 5)  # Cap at 5 columns

                    # Add base MPN validation columns to base headers if not present
                    base_validation_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                    for mpn_col in base_validation_columns:
                        if mpn_col not in base_headers:
                            base_headers.append(mpn_col)

                    # Add multiple canonical MPN columns based on maximum needed
                    canonical_columns = []
                    for i in range(max_canonical_mpns):
                        if i == 0:
                            col_name = 'DigiKey Canonical MPN'
                        else:
                            col_name = f'DigiKey Canonical MPN {i + 1}'

                        canonical_columns.append(col_name)
                        if col_name not in base_headers:
                            base_headers.append(col_name)

                    # Populate all MPN validation data for each row if not already present
                    for row in transformed_rows:
                        # Only add MPN data if not already present (to avoid overwriting)
                        if isinstance(row, dict) and 'MPN valid (DigiKey)' not in row:
                            raw = row.get(mpn_header, '')
                            norm = client_norm(raw)
                            res = results_map.get(norm, {})
                            if not res:
                                # No MPN, or not validated yet — keep every column blank
                                # (never show a false "No" / "Unknown" for unreached rows).
                                for col in base_validation_columns + list(canonical_columns):
                                    row[col] = ''
                                continue
                            lifecycle = res.get('lifecycle') or {}
                            all_canonicals = res.get('all_canonical_mpns', [])

                            # Set base MPN validation columns
                            row['MPN valid (DigiKey)'] = 'Yes' if res.get('valid') else 'No'
                            row['DigiKey Status'] = lifecycle.get('status') or 'Unknown'
                            row['DigiKey EOL Status'] = 'Yes' if lifecycle.get('endOfLife') else 'No'
                            row['DigiKey Discontinued'] = 'Yes' if lifecycle.get('discontinued') else 'No'
                            row['DigiKey Part Number'] = res.get('dkpn') or ''

                            # Add category information from DigiKey (only for valid MPNs)
                            is_valid = res.get('valid', False)
                            if is_valid:
                                category_info = res.get('category', {})
                                row['DigiKey Category'] = category_info.get('name', '') if category_info else ''
                            else:
                                row['DigiKey Category'] = ''

                            # Set multiple canonical MPN columns
                            for i, col_name in enumerate(canonical_columns):
                                if i < len(all_canonicals):
                                    row[col_name] = all_canonicals[i]
                                else:
                                    row[col_name] = ''  # Empty if no more canonical MPNs

                    logger.info(f"🔧 DEBUG download_file: Added MPN validation columns to enhanced data: {base_validation_columns + canonical_columns}")
            except Exception as _me:
                logger.warning(f"Download: MPN validation injection for enhanced data skipped: {_me}")

            # Apply requested column order if provided, also for enhanced data
            if requested_column_order and isinstance(requested_column_order, list):
                # Use requested column order, but only include headers that exist in the data
                ordered_headers = []
                for header in requested_column_order:
                    if header in base_headers:
                        ordered_headers.append(header)

                # Add any additional headers not in the requested order (like MPN validation columns)
                for header in base_headers:
                    if header not in ordered_headers:
                        ordered_headers.append(header)

                all_headers = ordered_headers
                logger.info(f"🔧 DEBUG download_file: Applied requested column order to enhanced data: {all_headers}")
            else:
                all_headers = list(base_headers)
        else:
            # Fall back to regular mapped data
            # Ensure no pagination hints leak into full export
            try:
                if '__paginate__' in SESSION_STORE.get(session_id, {}):
                    del SESSION_STORE[session_id]['__paginate__']
            except Exception:
                pass
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            # Convert to dict rows for downstream formula and Factwise operations
            base_headers = mapping_result['headers']
            transformed_rows = []
            for row_list in mapping_result['data']:
                row_dict = {}
                for i, header in enumerate(base_headers):
                    row_dict[header] = row_list[i] if i < len(row_list) else ""
                transformed_rows.append(row_dict)

            # Apply requested column order if provided
            if requested_column_order and isinstance(requested_column_order, list):
                # Use requested column order, but only include headers that exist in the data
                ordered_headers = []
                for header in requested_column_order:
                    if header in base_headers:
                        ordered_headers.append(header)

                # Add any additional headers not in the requested order
                for header in base_headers:
                    if header not in ordered_headers:
                        ordered_headers.append(header)

                all_headers = ordered_headers
                logger.info(f"🔧 DEBUG download_file: Applied requested column order to mapping result: {all_headers}")
            else:
                all_headers = list(base_headers)

            # Apply formula rules if present to generate Tag/Specification/Customer columns
            try:
                formula_rules = info.get('formula_rules', []) or []
                if formula_rules:
                    formula_result = apply_formula_rules(transformed_rows, all_headers, formula_rules, replace_existing=False, session_info=info)
                    transformed_rows = formula_result.get('data', transformed_rows)
                    all_headers = formula_result.get('headers', all_headers)
            except Exception as _fe:
                logger.warning(f"Download: formula application skipped due to error: {_fe}")

            # Inject MPN validation for export if present (all columns)
            try:
                mpn_validation = info.get('mpn_validation') or {}
                mpn_header = mpn_validation.get('column')
                results_map = mpn_validation.get('results') or {}
                if mpn_header and isinstance(transformed_rows, list) and transformed_rows:
                    from .services.digikey_service import DigiKeyClient
                    client_norm = DigiKeyClient.normalize_mpn

                    # Limit canonical MPN columns to reasonable number (max 5) to avoid excessive blank columns
                    max_canonical_mpns = 1
                    for row in transformed_rows:
                        raw = row.get(mpn_header, '')
                        norm = client_norm(raw)
                        res = results_map.get(norm, {})
                        all_canonicals = res.get('all_canonical_mpns', [])
                        if len(all_canonicals) > max_canonical_mpns:
                            max_canonical_mpns = min(len(all_canonicals), 5)  # Cap at 5 columns

                    # Add base MPN validation columns
                    base_validation_columns = ['MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number', 'DigiKey Category']
                    for mpn_col in base_validation_columns:
                        if mpn_col not in all_headers:
                            all_headers.append(mpn_col)

                    # Add multiple canonical MPN columns based on maximum needed
                    canonical_columns = []
                    for i in range(max_canonical_mpns):
                        if i == 0:
                            col_name = 'DigiKey Canonical MPN'
                        else:
                            col_name = f'DigiKey Canonical MPN {i + 1}'

                        canonical_columns.append(col_name)
                        if col_name not in all_headers:
                            all_headers.append(col_name)

                    # Populate all MPN validation data for each row
                    for row in transformed_rows:
                        raw = row.get(mpn_header, '')
                        norm = client_norm(raw)
                        res = results_map.get(norm, {})
                        if not res:
                            # No MPN, or not validated yet — keep every column blank
                            # (never show a false "No" / "Unknown" for unreached rows).
                            for col in base_validation_columns + list(canonical_columns):
                                row[col] = ''
                            continue
                        lifecycle = res.get('lifecycle') or {}
                        all_canonicals = res.get('all_canonical_mpns', [])

                        # Set base MPN validation columns
                        row['MPN valid (DigiKey)'] = 'Yes' if res.get('valid') else 'No'
                        row['DigiKey Status'] = lifecycle.get('status') or 'Unknown'
                        row['DigiKey EOL Status'] = 'Yes' if lifecycle.get('endOfLife') else 'No'
                        row['DigiKey Discontinued'] = 'Yes' if lifecycle.get('discontinued') else 'No'
                        row['DigiKey Part Number'] = res.get('dkpn') or ''

                        # Add category information from DigiKey (only for valid MPNs)
                        is_valid = res.get('valid', False)
                        if is_valid:
                            category_info = res.get('category', {})
                            row['DigiKey Category'] = category_info.get('name', '') if category_info else ''
                        else:
                            row['DigiKey Category'] = ''

                        # Set multiple canonical MPN columns
                        for i, col_name in enumerate(canonical_columns):
                            if i < len(all_canonicals):
                                row[col_name] = all_canonicals[i]
                            else:
                                row[col_name] = ''  # Empty if no more canonical MPNs

                    logger.info(f"🔧 DEBUG download_file: Added MPN validation columns: {base_validation_columns + canonical_columns}")
            except Exception as _me:
                logger.warning(f"Download: MPN validation injection skipped: {_me}")

            # (FactWise ID rules are applied below, AFTER the if/else converges, so
            # both the enhanced-data and fresh-mapping download paths get them.)

        # Apply FactWise ID rules for BOTH download paths. This used to live only in
        # the fresh-mapping branch, so a template-applied download (which uses the
        # enhanced-data branch) came out with a blank Item code even though the
        # editor showed it. Runs at the converged level so every path gets it.
        try:
            factwise_rules = info.get('factwise_rules', []) or []
            for factwise_rule in factwise_rules:
                if not isinstance(factwise_rule, dict) or factwise_rule.get("type") != "factwise_id":
                    continue
                first_col = factwise_rule.get("first_column")
                second_col = factwise_rule.get("second_column")
                operator = factwise_rule.get("operator", "_")
                strategy = factwise_rule.get("strategy", "fill_only_null")
                generation_mode = factwise_rule.get("generation_mode", "columns")

                # rows here are dicts keyed by header (both paths converted above)
                if not (transformed_rows and isinstance(transformed_rows[0], dict)):
                    continue
                if 'Item code' not in all_headers:
                    all_headers = ['Item code'] + list(all_headers)
                    for row in transformed_rows:
                        row.setdefault('Item code', '')

                for row_index, row in enumerate(transformed_rows):
                    if generation_mode == 'serial':
                        try:
                            start_number = int(factwise_rule.get("serial_start", 1))
                        except Exception:
                            start_number = 1
                        try:
                            padding = max(0, int(factwise_rule.get("serial_padding", 0)))
                        except Exception:
                            padding = 0
                        increment_each_row = str(factwise_rule.get("serial_increment", True)).lower() not in ['false', '0', 'no', 'off']
                        current_number = start_number + row_index if increment_each_row else start_number
                        suffix = str(current_number).zfill(padding) if padding > 0 else str(current_number)
                        factwise_id = f"{factwise_rule.get('serial_prefix', '') or ''}{suffix}"
                    else:
                        first_val = str(row.get(first_col, "") or "").strip()
                        second_val = str(row.get(second_col, "") or "").strip()
                        factwise_id = (f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or ""))
                    if strategy == 'override_all':
                        row['Item code'] = factwise_id
                    elif not str(row.get('Item code', '') or '').strip():
                        row['Item code'] = factwise_id
            if factwise_rules:
                logger.info("🔧 DOWNLOAD: Applied FactWise ID rule(s) at converged level")
        except Exception as _ie:
            logger.warning(f"Download: factwise application skipped due to error: {_ie}")

        # Ensure default values are applied in the download path as well (parity with data_view)
        try:
            session_default_values = info.get("default_values", {}) or {}
            if session_default_values and transformed_rows:
                # If rows are dicts, apply directly; if lists, map via headers
                if transformed_rows and isinstance(transformed_rows[0], dict):
                    for field_name, default_value in session_default_values.items():
                        for row in transformed_rows:
                            current_value = row.get(field_name, "")
                            if not current_value or current_value == "":
                                row[field_name] = default_value
                elif transformed_rows and isinstance(transformed_rows[0], list) and all_headers:
                    # Build header index map
                    header_index = {h: idx for idx, h in enumerate(all_headers)}
                    slot_index = {slot_key: idx for idx, slot_key in enumerate(get_sfo_slot_keys(all_headers))}
                    for field_name, default_value in session_default_values.items():
                        # Exact match first
                        target_header = None
                        target_idx = None
                        if field_name in slot_index:
                            target_idx = slot_index[field_name]
                        elif field_name in header_index:
                            target_header = field_name
                        else:
                            # Case-insensitive normalized match
                            norm = field_name.lower().replace(' ', '_').replace('-', '_')
                            for h in all_headers:
                                if h.lower().replace(' ', '_').replace('-', '_') == norm:
                                    target_header = h
                                    break
                        if target_idx is None and target_header is not None:
                            target_idx = header_index.get(target_header)
                        if target_idx is not None:
                            for row in transformed_rows:
                                if target_idx < len(row):
                                    if row[target_idx] is None or str(row[target_idx]).strip() == "":
                                        row[target_idx] = default_value
        except Exception as _e:
            logger.warning(f"Download default application skipped due to error: {_e}")

        # =========================================================================
        # MERGE PARSER COLUMNS FOR DOWNLOAD (same logic as data_view)
        # =========================================================================
        parser_columns = info.get('parser_columns')
        if parser_columns and parser_columns.get('headers') and parser_columns.get('data'):
            try:
                parser_headers = parser_columns['headers']
                parser_data = parser_columns['data']

                logger.info(f"📊 DOWNLOAD: Merging {len(parser_headers)} parser columns")

                # Add parser headers to all_headers
                all_headers = list(all_headers) + parser_headers

                # Merge parser data into each row
                if isinstance(transformed_rows, list) and transformed_rows:
                    if isinstance(transformed_rows[0], dict):
                        # Dict rows - add keys
                        for i, row in enumerate(transformed_rows):
                            if i < len(parser_data):
                                for j, parser_header in enumerate(parser_headers):
                                    if j < len(parser_data[i]):
                                        row[parser_header] = parser_data[i][j] if parser_data[i][j] is not None else ''
                                    else:
                                        row[parser_header] = ''
                            else:
                                for parser_header in parser_headers:
                                    row[parser_header] = ''
                    else:
                        # List rows - extend each row
                        for i, row in enumerate(transformed_rows):
                            if i < len(parser_data):
                                transformed_rows[i] = list(row) + list(parser_data[i])
                            else:
                                transformed_rows[i] = list(row) + [''] * len(parser_headers)

                logger.info(f"📊 DOWNLOAD: Total headers after parser merge: {len(all_headers)}")
            except Exception as parser_err:
                logger.error(f"📊 DOWNLOAD: Error merging parser columns: {parser_err}")

        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data to download'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            cleaned_spec_pairs = cleanup_empty_spec_pairs(all_headers, transformed_rows)
            if cleaned_spec_pairs:
                logger.info(f"Cleaned {cleaned_spec_pairs} empty Specification name/value pairs from download")
        except Exception as spec_cleanup_err:
            logger.warning(f"Spec pair cleanup in download skipped: {spec_cleanup_err}")
        
        # For enhanced or dict data, use headers that actually exist in the data and normalize shape
        if isinstance(transformed_rows, list) and transformed_rows and isinstance(transformed_rows[0], dict):
            # Get headers that actually exist in the enhanced data
            # Row keys carry the repeat marker; column headings must not. Reading
            # the keys straight into headers is what wrote "Specification name
            # @@dup1" into the exported sheet as an extra column.
            actual_headers = [_display_header(key) for key in transformed_rows[0].keys()]
            logger.info(f"🔧 DEBUG download_file: Enhanced data has headers: {actual_headers}")
            
            # Use the canonical headers from session if available, but only include those that exist in the data
            canonical_headers = info.get("current_template_headers") or info.get("enhanced_headers") or all_headers or []

            # Use template headers for ordering, adding dynamic columns
            if canonical_headers:
                # Every match below is against the internal shape (Tag_4,
                # Specification_Name_4). A session storing the label shape
                # ('Tag (4)') matched nothing, so the export silently fell back
                # to the template's own slot count — added Tag / Specification /
                # Custom identification columns were missing from the file even
                # though the grid showed them.
                canonical_headers = normalize_headers_to_internal(canonical_headers)
                # Get base headers from template (non-dynamic columns)
                base_headers = normalize_headers_to_internal(info.get('template_headers') or [])
                correct_order = [h for h in base_headers if not (
                    h.startswith('Tag_') or h.startswith('Specification_') or h.startswith('Custom_Identification_')
                )]

                # Add Tag columns in correct order
                tag_headers = sorted([h for h in canonical_headers if h.startswith('Tag_')],
                                   key=lambda x: int(x.split('_')[1]) if '_' in x and x.split('_')[1].isdigit() else 0)
                correct_order.extend(tag_headers)

                # Add Specification columns in correct order
                spec_name_headers = sorted([h for h in canonical_headers if h.startswith('Specification_Name_')],
                                         key=lambda x: int(x.split('_')[2]) if len(x.split('_')) > 2 and x.split('_')[2].isdigit() else 0)
                spec_value_headers = sorted([h for h in canonical_headers if h.startswith('Specification_Value_')],
                                          key=lambda x: int(x.split('_')[2]) if len(x.split('_')) > 2 and x.split('_')[2].isdigit() else 0)

                # Interleave spec names and values
                for i in range(max(len(spec_name_headers), len(spec_value_headers))):
                    if i < len(spec_name_headers):
                        correct_order.append(spec_name_headers[i])
                    if i < len(spec_value_headers):
                        correct_order.append(spec_value_headers[i])

                # Add Customer ID columns in correct order
                customer_name_headers = sorted([h for h in canonical_headers if h.startswith('Custom_Identification_Name_')],
                                             key=lambda x: int(x.split('_')[3]) if len(x.split('_')) > 3 and x.split('_')[3].isdigit() else 0)
                customer_value_headers = sorted([h for h in canonical_headers if h.startswith('Custom_Identification_Value_')],
                                              key=lambda x: int(x.split('_')[3]) if len(x.split('_')) > 3 and x.split('_')[3].isdigit() else 0)

                # Interleave customer names and values
                for i in range(max(len(customer_name_headers), len(customer_value_headers))):
                    if i < len(customer_name_headers):
                        correct_order.append(customer_name_headers[i])
                    if i < len(customer_value_headers):
                        correct_order.append(customer_value_headers[i])

                # Add any remaining headers that weren't categorized
                for header in canonical_headers:
                    if header not in correct_order and header in actual_headers:
                        correct_order.append(header)

                # Filter to only headers that exist in the actual data and maintain order
                canonical_headers = [h for h in correct_order if h in actual_headers]
                logger.info(f"🔧 DEBUG download_file: Enforced canonical order: {canonical_headers}")

            # CRITICAL FIX: Use requested column order if provided, otherwise use canonical order
            if requested_column_order and isinstance(requested_column_order, list):
                # Use requested column order, but only include headers that exist in the data
                valid_headers = []
                for header in requested_column_order:
                    if header in actual_headers:
                        valid_headers.append(header)

                # Add any additional headers from data that aren't in the requested
                # order — by count, so a genuine second "Specification name" is
                # kept while an already-covered column is not duplicated.
                valid_headers = _headers_with_repeats(valid_headers, actual_headers)

                all_headers = valid_headers
                logger.info(f"🔧 DEBUG download_file: Using requested column order: {all_headers}")
            else:
                # Fallback to canonical order
                valid_headers = []
                for header in canonical_headers:
                    if header in actual_headers:
                        valid_headers.append(header)

                # Add any additional headers from data that aren't in canonical
                # (shouldn't happen but defensive) — counted, for the same reason.
                valid_headers = _headers_with_repeats(valid_headers, actual_headers)

                all_headers = valid_headers
                logger.info(f"🔧 DEBUG download_file: Using canonical headers for enhanced data: {all_headers}")
            
            # Convert dict format to list format for consistency
            converted_rows = []
            output_keys = _positional_row_keys(all_headers)
            # `actual_headers` was read off row 0 alone, so this loop used to
            # assume every row had the same shape as the first. A grid can hold
            # BOTH: rows that came through the normalizer are dicts, and a row
            # added later in the editor is a plain list. One list row among 113
            # dicts crashed the whole export with "'list' object has no
            # attribute 'get'" — a message naming a Python type and nothing
            # else, with no traceback, on an action as ordinary as editing a
            # cell.
            source_keys = _positional_row_keys(actual_headers)
            for row in transformed_rows:
                if isinstance(row, dict):
                    row_list = []
                    for key, header in zip(output_keys, all_headers):
                        # Fall back to the plain header for rows written by a
                        # step that never saw a duplicate (single-slot sheets).
                        value = row.get(key)
                        if value is None:
                            value = row.get(header, "")
                        row_list.append(value)
                    converted_rows.append(row_list)
                    continue
                # A list row is positional against `actual_headers`, so it is
                # re-indexed into the requested order rather than passed through
                # — appending it as-is would silently shift every cell whenever
                # the two orders differ.
                by_header = {}
                for position, header in enumerate(actual_headers):
                    if position < len(row):
                        by_header.setdefault(header, row[position])
                for position, key in enumerate(source_keys):
                    if position < len(row):
                        by_header.setdefault(key, row[position])
                converted_rows.append([
                    by_header.get(key, by_header.get(header, ""))
                    for key, header in zip(output_keys, all_headers)
                ])
            transformed_rows = converted_rows
        
        # Strip BOM structure columns here rather than from the requested column
        # order: several paths above rebuild `all_headers` from a canonical set,
        # which silently reinstates anything filtered earlier.
        if export_type == 'item':
            transformed_rows, all_headers = _drop_bom_columns(transformed_rows, all_headers)

        # A sub-assembly is the output of its own BOM, so it is a finished good
        # in the item directory even though the sheet listed it as just another
        # line. Only the popup-authored root used to get this, which left every
        # level below it typed as a raw material.
        if export_type == 'item':
            transformed_rows, retyped = _apply_sub_assembly_item_types(
                session_id, info, transformed_rows, all_headers
            )
            if retyped:
                logger.info(f"DOWNLOAD: typed {retyped} sub-assembly row(s) as Finished good")

        # A flat sheet has no finished good of its own — the user authored it in
        # the BOM structure gate — so it exists only in `bom_structure`, never in
        # the mapped grid. Without this the BOM would reference a finished good
        # the exported item directory does not contain, and the FactWise import
        # would fail on the second file.
        if export_type == 'item':
            transformed_rows, all_headers = _append_authored_finished_good(
                info, transformed_rows, all_headers
            )
            # The item directory lists each part once; the grid lists it once
            # per BOM line that consumes it. Collapse here rather than asking
            # the user to delete rows — deleting a row takes it out of the BOM
            # too. Genuinely conflicting rows are left alone and reported by
            # validation instead.
            transformed_rows, collapsed_conflicts = _dedupe_item_rows(
                transformed_rows, all_headers
            )
            if collapsed_conflicts:
                logger.warning(
                    "DOWNLOAD: %d item code(s) have rows that disagree: %s"
                    % (len(collapsed_conflicts), ', '.join(collapsed_conflicts[:5]))
                )

        # Create DataFrame with duplicate column names support
        if transformed_rows and all_headers:
            # CRITICAL FIX: Ensure data and headers are compatible
            try:
                # Check if we have the right number of columns
                if transformed_rows and isinstance(transformed_rows[0], list):
                    first_row_length = len(transformed_rows[0])
                    headers_length = len(all_headers)
                    
                    logger.info(f"🔧 DEBUG download_file: first_row_length={first_row_length}, headers_length={headers_length}")
                    logger.info(f"🔧 DEBUG download_file: all_headers={all_headers}")
                    
                    if first_row_length != headers_length:
                        logger.warning(f"🚨 Header/data mismatch in download: {headers_length} headers but {first_row_length} data columns")
                        # Pad or truncate headers to match data
                        if headers_length > first_row_length:
                            # Too many headers, truncate
                            all_headers = all_headers[:first_row_length]
                            logger.info(f"🔧 Truncated headers to match data: {all_headers}")
                        else:
                            # Too few headers, pad with generic names
                            for i in range(headers_length, first_row_length):
                                all_headers.append(f"Column_{i+1}")
                            logger.info(f"🔧 Padded headers to match data: {all_headers}")
                
                # Use pandas with list data and original headers for export
                df = pd.DataFrame(transformed_rows, columns=all_headers)
                logger.info(f"🔧 DEBUG download_file: Successfully created DataFrame with shape {df.shape}")
            except Exception as df_error:
                logger.error(f"🚨 DataFrame creation failed: {df_error}")
                # Fallback: create DataFrame without column specification
                try:
                    df = pd.DataFrame(transformed_rows)
                    logger.info(f"🔧 Fallback DataFrame created with shape {df.shape}")
                except Exception as fallback_error:
                    logger.error(f"🚨 Fallback DataFrame creation also failed: {fallback_error}")
                    raise fallback_error
        else:
            # Create empty DataFrame
            df = pd.DataFrame(columns=all_headers or [])

        # Cluster repeated FactWise groups (Specification/Tag/Custom identification)
        # so no unrelated column sits between two like columns — otherwise the
        # FactWise importer reports false "Same specification value" duplicates.
        # Reorder by POSITION so it is safe even with duplicate header names.
        try:
            if len(df.columns) > 0:
                order = _cluster_factwise_columns(list(df.columns))
                if order and order != list(range(len(df.columns))):
                    df = df.iloc[:, order]
                    logger.info(f"🧷 Clustered FactWise groups for export ({len(order)} columns reordered)")
        except Exception as _cluster_err:
            logger.warning(f"FactWise column clustering skipped: {_cluster_err}")

        # Clean column names for export only (remove numbers, underscores, dots)
        if not df.empty:
            import re
            final_columns = []
            for col in df.columns:
                # A numbered slot answers this on its own: 'Tag (2)' -> 'Tag'.
                # This is the export boundary the numbering exists for - inside
                # the app the column keeps its number so the three Tags are
                # tellable apart, and only the file gets the shared label that
                # FactWise's importer groups on.
                #
                # Taken before the blunt cleanup below because that one replaces
                # every digit with a space, which would leave 'Tag ( )'.
                name = str(col).strip()
                slot_label = _strip_slot_suffix(name)
                if slot_label != name:
                    final_columns.append(slot_label)
                    continue

                # Everything else that needs collapsing ends in `_N`: the internal
                # slot keys still minted elsewhere (Specification_Name_1, Tag_2,
                # Preferred vendor code__2) and the runs a split produces
                # (Reference Designator_1 .. _33), which share one export header.
                #
                # Matched as a SUFFIX rather than by deleting every digit. The old
                # rule replaced `[_\d.]` anywhere, so 'Alternate UoM 1' - a real
                # FactWise column whose name ends in a digit - exported as
                # 'Alternate uom'.
                run = re.match(r'^(.+?)_+(\d+)$', name)
                if run:
                    cleaned_col = re.sub(r'[_\.]', ' ', run.group(1))
                    cleaned_col = re.sub(r'\s+', ' ', cleaned_col).strip()
                    # Sentence case, as this path has always produced.
                    if cleaned_col:
                        cleaned_col = cleaned_col.capitalize()
                else:
                    # A column the destination template named. Export it exactly as
                    # the template spells it - that text is what FactWise matches on,
                    # and case-folding it here is what made the lookup below
                    # necessary in the first place.
                    cleaned_col = name

                # capitalize() flattens acronyms, so restore the labels FactWise
                # expects.
                lookup = re.sub(r'[^a-z0-9]+', ' ', cleaned_col.lower()).strip()
                canonical = EXPORT_HEADER_CANONICAL_LABELS.get(lookup)
                if canonical:
                    cleaned_col = canonical

                final_columns.append(cleaned_col or col)  # Fallback to original if cleaning fails
            
            df.columns = final_columns

        # Get format preference (default to Excel)
        if request.method == 'POST':
            format_type = (request.data.get('format') or request.POST.get('format', 'excel')).lower()
        else:
            format_type = request.GET.get('format', 'excel').lower()
        
        # Create output file
        output_dir = hybrid_file_manager.local_temp_dir
        
        from datetime import datetime
        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
        base_name = f"FactWise_Filled_{timestamp}"
        if format_type == 'csv':
            filename = f"{base_name}.csv"
            output_file = output_dir / filename
            df.to_csv(output_file, index=False)
            content_type = 'text/csv'
        else:  # Excel format (default)
            filename = f"{base_name}.xlsx"
            output_file = output_dir / filename
            df.to_excel(output_file, index=False, engine='openpyxl')
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            try:
                painted = _highlight_duplicate_cells(output_file, df, highlight_duplicate_columns)
                if painted:
                    logger.info(f"DOWNLOAD: highlighted {painted} duplicate cell(s) in {filename}")
            except Exception as highlight_error:
                # A missing highlight is not worth failing the download over.
                logger.warning(f"Duplicate highlighting skipped for {filename}: {highlight_error}")

        try:
            from .intermediate_artifacts import save_file_artifact
            save_file_artifact(
                session_id=session_id,
                artifact_type='mapped_download',
                source_path=output_file,
                label='Mapped workbook download',
                file_format='csv' if format_type == 'csv' else 'xlsx',
                row_count=len(df.index),
                column_count=len(df.columns),
                metadata={'source': 'download_file'},
            )
        except Exception as artifact_error:
            logger.warning(f"Intermediate artifact save skipped for download_file: {artifact_error}")

        response = FileResponse(
            open(output_file, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type=content_type
        )
        response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response['Pragma'] = 'no-cache'
        response['Expires'] = '0'
        
        return response
        
    except Exception as e:
        # With the traceback. "Download failed: 'list' object has no attribute
        # 'get'" names a Python type and nothing else — not the column, not the
        # row, not the step — so the only way to find it was to guess. The
        # message the user sees is unchanged; this is for the log.
        logger.error(f"Error in download_file: {e}", exc_info=True)
        return Response({
            'success': False,
            'error': f'Download failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def download_original_file(request, session_id=None):
    """Download original uploaded client file."""
    try:
        # Support both URL path and query parameters for session_id
        if not session_id:
            session_id = request.GET.get('session_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Three stray 'SESSION_STORE[session_id] = info' lines sat here, using
        # info before it was assigned, so every call died with UnboundLocalError.
        info = get_session_consistent(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        client_path = info["client_path"]
        original_name = info["original_client_name"]
        
        if not Path(client_path).exists():
            return Response({
                'success': False,
                'error': 'Original file not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        response = FileResponse(
            open(client_path, 'rb'),
            as_attachment=True,
            filename=original_name
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error in download_original_file: {e}")
        return Response({
            'success': False,
            'error': f'Download failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def download_template_file(request, session_id=None):
    """Download the built-in SFO destination template."""
    try:
        # Support both URL path and query parameters for session_id
        if not session_id:
            session_id = request.GET.get('session_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        template_path = get_sfo_template_path()
        logger.info(f"🔍 Template download for session {session_id}: returning SFO template from {template_path}")

        if not template_path.exists():
            return Response({
                'success': False,
                'error': f'{SFO_TEMPLATE_NAME} template file not found'
            }, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(
            open(template_path, 'rb'),
            as_attachment=True,
            filename=SFO_TEMPLATE_NAME
        )
        
        return response
    except Exception as e:
        logger.error(f"Error downloading template file: {e}")
        return Response({
            'success': False,
            'error': f'Template download failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def download_grid_excel(request):
    """Download Excel file with frontend grid data."""
    try:
        data = request.data
        session_id = data.get('session_id')
        headers = data.get('headers', [])
        rows = data.get('rows', [])
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create DataFrame from frontend data
        import pandas as pd
        df = pd.DataFrame(rows)
        
        # Ensure columns match headers
        if headers:
            df.columns = headers[:len(df.columns)]
        
        # Strip the display-only slot number so repeats go out under the shared
        # header FactWise groups on. This used to prune '_2' but leave the
        # underscores ('Specification_Name'), and did not recognise the 'Tag (2)'
        # label form at all — it only produced valid headers because the caller
        # happened to pre-clean them.
        if not df.empty and len(df.columns) > 0:
            df.columns = [canonical_export_header(col) for col in df.columns]
        
        # Generate filename with YYMMDD_HHMMSS
        from datetime import datetime
        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
        filename = f'FactWise_Filled_{timestamp}.xlsx'
        
        # Create temp file
        temp_file = os.path.join('temp_downloads', filename)
        os.makedirs('temp_downloads', exist_ok=True)
        
        # Save to Excel
        df.to_excel(temp_file, index=False)

        try:
            from .intermediate_artifacts import save_file_artifact
            save_file_artifact(
                session_id=session_id,
                artifact_type='grid_download',
                source_path=temp_file,
                label='Grid workbook download',
                file_format='xlsx',
                row_count=len(df.index),
                column_count=len(df.columns),
                metadata={'source': 'download_grid_excel'},
            )
        except Exception as artifact_error:
            logger.warning(f"Intermediate artifact save skipped for download_grid_excel: {artifact_error}")
        
        # Return file response
        response = FileResponse(
            open(temp_file, 'rb'),
            as_attachment=True,
            filename=filename
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error in download_grid_excel: {e}")
        return Response({
            'success': False,
            'error': f'Excel export failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def dashboard_view(request):
    """Get dashboard data."""
    try:
        # Get recent sessions from both memory and persisted session files.
        # Docker/backend restarts clear process memory, so relying only on
        # SESSION_STORE makes the dashboard look empty even though sessions were
        # saved to disk.
        session_map = dict(SESSION_STORE)
        try:
            session_files = list(hybrid_file_manager.local_temp_dir.glob("session_*.json"))
            for session_file in session_files:
                try:
                    session_id_from_file = session_file.stem.replace("session_", "", 1)
                    if session_id_from_file in session_map:
                        continue
                    loaded = load_session_from_file(session_id_from_file)
                    if loaded:
                        session_map[session_id_from_file] = loaded
                        SESSION_STORE[session_id_from_file] = loaded
                        cache.set(f"mapper:session:{session_id_from_file}", loaded, 86400)
                except Exception as file_error:
                    logger.warning(f"Dashboard could not load session file {session_file}: {file_error}")
        except Exception as scan_error:
            logger.warning(f"Dashboard could not scan persisted sessions: {scan_error}")

        def _created_sort_key(item):
            _, data = item
            created = data.get('created') or ''
            try:
                created_dt = datetime.fromisoformat(str(created).replace('Z', '+00:00'))
                if timezone.is_naive(created_dt):
                    created_dt = timezone.make_aware(created_dt, datetime_timezone.utc)
                return created_dt
            except Exception:
                return datetime.min.replace(tzinfo=datetime_timezone.utc)

        uploads = []
        for session_id, session_data in sorted(session_map.items(), key=_created_sort_key, reverse=True)[:25]:
            # Try to get row count from processed data or client data
            rows_processed = 0
            logger.info(f"Session {session_id}: Checking for data to calculate rows")
            logger.info(f"Session {session_id}: Session data keys: {list(session_data.keys())}")
            logger.info(f"Session {session_id}: edited_data type: {type(session_data.get('edited_data'))}")
            logger.info(f"Session {session_id}: client_data type: {type(session_data.get('client_data'))}")
            logger.info(f"Session {session_id}: client_path: {session_data.get('client_path')}")
            
            if session_data.get('edited_data'):
                try:
                    # If we have processed data, count the rows
                    if isinstance(session_data['edited_data'], list):
                        rows_processed = len(session_data['edited_data'])
                        logger.info(f"Session {session_id}: Got rows from edited_data list: {rows_processed}")
                    elif isinstance(session_data['edited_data'], dict) and 'data' in session_data['edited_data']:
                        rows_processed = len(session_data['edited_data']['data'])
                        logger.info(f"Session {session_id}: Got rows from edited_data dict: {rows_processed}")
                except Exception as e:
                    logger.warning(f"Session {session_id}: Error counting edited_data rows: {e}")
                    rows_processed = 0
            elif session_data.get('client_data'):
                try:
                    # Fallback to client data if processed data not available
                    if isinstance(session_data['client_data'], list):
                        rows_processed = len(session_data['client_data'])
                        logger.info(f"Session {session_id}: Got rows from client_data list: {rows_processed}")
                    elif isinstance(session_data['client_data'], dict) and 'data' in session_data['client_data']:
                        rows_processed = len(session_data['client_data']['data'])
                        logger.info(f"Session {session_id}: Got rows from client_data dict: {rows_processed}")
                except Exception as e:
                    logger.warning(f"Session {session_id}: Error counting client_data rows: {e}")
                    rows_processed = 0
            else:
                # Keep dashboard fast: do not open uploaded Excel files just to
                # count rows. Use already-processed session data when available.
                for key in ('formula_enhanced_data', 'mapped_data'):
                    data = session_data.get(key)
                    if isinstance(data, list):
                        rows_processed = len(data)
                        break
                    if isinstance(data, dict) and isinstance(data.get('data'), list):
                        rows_processed = len(data['data'])
                        break
                
                if rows_processed == 0:
                    logger.info(f"Session {session_id}: No edited_data, client_data, or client file found")
            
            logger.info(f"Session {session_id}: Final rows_processed: {rows_processed}")
            
            # Check if file is ready for download
            has_mappings = bool(session_data.get('mappings'))
            has_processed_data = bool(session_data.get('edited_data'))
            # Consider complete if user has gone through the mapping process
            is_complete = has_mappings
            
            # Generate the filename that would be used for download
            filled_sheet_name = None
            if is_complete:
                # Use the session creation time or current time for consistency
                session_created = session_data.get('created')
                if session_created:
                    try:
                        if isinstance(session_created, str):
                            created_dt = datetime.fromisoformat(session_created.replace('Z', '+00:00'))
                        else:
                            created_dt = session_created
                        timestamp = created_dt.strftime('%y%m%d_%H%M%S')
                        filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                        logger.info(f"Session {session_id}: Generated filled_sheet_name from session_created: {filled_sheet_name}")
                    except Exception as e:
                        # Fallback to current time if session time parsing fails
                        logger.warning(f"Session {session_id}: Error parsing session_created, using current time: {e}")
                        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
                        filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                        logger.info(f"Session {session_id}: Generated filled_sheet_name from current time: {filled_sheet_name}")
                else:
                    logger.info(f"Session {session_id}: No session_created, using current time")
                    timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
                    filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                    logger.info(f"Session {session_id}: Generated filled_sheet_name from current time: {filled_sheet_name}")
            else:
                logger.info(f"Session {session_id}: Not complete, no filled_sheet_name generated")
            
            uploads.append({
                'session_id': session_id,
                'client_file': session_data.get('original_client_name', 'Unknown'),
                'template_file': session_data.get('original_template_name', 'Unknown'),
                'filled_sheet_name': filled_sheet_name,
                'created': session_data.get('created', timezone.now().isoformat()),
                'has_mappings': is_complete,
                'rows_processed': rows_processed
            })
        
        # Get saved templates
        try:
            templates = MappingTemplate.objects.all().order_by('-created_at')[:10]
            saved_templates = [template.get_mapping_summary() for template in templates]
        except Exception:
            saved_templates = []
        
        return Response({
            'success': True,
            'uploads': uploads,
            'saved_templates': saved_templates
        })
        
    except Exception as e:
        logger.error(f"Error in dashboard_view: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get dashboard data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _hard_delete_session(session_id):
    """Permanently remove every trace of one upload/session.

    Hard delete, not soft: the persisted session_<id>.json file, the in-memory
    SESSION_STORE entry, the Redis/cache entry, any associated uploaded/generated
    files, and any PDF records are all removed. Returns a small report dict.
    """
    removed = {'session_file': False, 'memory': False, 'cache': False, 'pdf_rows': 0, 'files': 0}

    session_data = SESSION_STORE.get(session_id)
    if session_data is None:
        try:
            session_data = load_session_from_file(session_id)
        except Exception:
            session_data = None

    # 1) persisted session file
    try:
        session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
        if session_file.exists():
            session_file.unlink()
            removed['session_file'] = True
    except Exception as e:
        logger.warning(f"_hard_delete_session: could not remove session file for {session_id}: {e}")

    # 2) in-memory store
    if SESSION_STORE.pop(session_id, None) is not None:
        removed['memory'] = True

    # 3) cache
    try:
        cache.delete(f"mapper:session:{session_id}")
        removed['cache'] = True
    except Exception:
        pass

    # 4) associated uploaded / generated files
    if isinstance(session_data, dict):
        for key in ('client_path', 'template_path', 'enhanced_path', 'formula_enhanced_path', 'download_path'):
            p = session_data.get(key)
            if not p:
                continue
            try:
                fp = Path(str(p))
                if fp.exists() and fp.is_file():
                    fp.unlink()
                    removed['files'] += 1
            except Exception:
                pass

    # 5) PDF records (cascades to pages / zones / extractions)
    try:
        from .models import PDFSession
        deleted, _ = PDFSession.objects.filter(session_id=session_id).delete()
        removed['pdf_rows'] = deleted
    except Exception as e:
        logger.warning(f"_hard_delete_session: PDF row cleanup failed for {session_id}: {e}")

    return removed


@api_view(['DELETE'])
def delete_upload(request, session_id):
    """Hard-delete a single upload/session from the dashboard."""
    try:
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'},
                            status=status.HTTP_400_BAD_REQUEST)
        removed = _hard_delete_session(session_id)
        logger.info(f"🗑️ delete_upload hard-deleted {session_id}: {removed}")
        return Response({'success': True, 'session_id': session_id, 'removed': removed})
    except Exception as e:
        logger.error(f"delete_upload failed for {session_id}: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def delete_all_uploads(request):
    """Hard-delete every upload/session (bulk clear)."""
    try:
        ids = set(SESSION_STORE.keys())
        try:
            for f in hybrid_file_manager.local_temp_dir.glob("session_*.json"):
                ids.add(f.stem.replace("session_", "", 1))
        except Exception as e:
            logger.warning(f"delete_all_uploads: could not scan session files: {e}")

        count = 0
        for sid in list(ids):
            try:
                _hard_delete_session(sid)
                count += 1
            except Exception as e:
                logger.warning(f"delete_all_uploads: failed on {sid}: {e}")

        logger.info(f"🗑️ delete_all_uploads hard-deleted {count} session(s)")
        return Response({'success': True, 'deleted': count})
    except Exception as e:
        logger.error(f"delete_all_uploads failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Template management views
@api_view(['POST'])
def update_column_counts(request):
    """Update dynamic column counts for the current session."""
    try:
        session_id = request.data.get('session_id')
        tags_count = request.data.get('tags_count', 3)
        spec_pairs_count = request.data.get('spec_pairs_count', 3)
        customer_id_pairs_count = request.data.get('customer_id_pairs_count', 1)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Invalid session ID'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate counts are positive integers
        try:
            tags_count = max(0, int(tags_count))
            spec_pairs_count = max(0, int(spec_pairs_count))
            customer_id_pairs_count = max(0, int(customer_id_pairs_count))
        except (ValueError, TypeError):
            return Response({
                'success': False,
                'error': 'Column counts must be positive integers'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # The sheet itself is the floor. A caller may legitimately ASK for more
        # slots, but a count below what the grid already holds is always stale
        # state, not an instruction to delete columns — the editor used to post
        # its un-initialised 1/1/1 on the way to Modify Mappings, and that alone
        # rewrote a three-specification sheet as a one-specification one and
        # pushed the surviving triplets to the end.
        #
        # Removing slots deliberately is a different operation: it goes through
        # the -/+ control, which sends a count derived from what is on screen.
        present = derive_sfo_column_counts_from_headers(
            info.get('current_template_headers') or info.get('enhanced_headers') or []
        )
        requested = (tags_count, spec_pairs_count, customer_id_pairs_count)
        tags_count = max(tags_count, present['tags_count'])
        spec_pairs_count = max(spec_pairs_count, present['spec_pairs_count'])
        customer_id_pairs_count = max(customer_id_pairs_count, present['customer_id_pairs_count'])
        if requested != (tags_count, spec_pairs_count, customer_id_pairs_count):
            logger.info(
                f"📊 Raised stale counts {requested} to what the sheet holds: "
                f"({tags_count}, {spec_pairs_count}, {customer_id_pairs_count})"
            )

        # Store column counts in session (version will be bumped later atomically)
        info['tags_count'] = tags_count
        info['spec_pairs_count'] = spec_pairs_count
        info['customer_id_pairs_count'] = customer_id_pairs_count
        # Both copies, always together: the mapping page reads this dict while
        # the editor reads the headers, and letting them drift is what made one
        # screen show 1 specification pair and the other 3.
        info['column_counts'] = {
            'tags_count': tags_count,
            'spec_pairs_count': spec_pairs_count,
            'customer_id_pairs_count': customer_id_pairs_count,
        }
        
        # Get existing headers to preserve numbering
        existing_headers = info.get('current_template_headers') or info.get('enhanced_headers') or []
        
        # Generate new template columns based on counts (will be same as regenerated_headers)
        # This is kept for compatibility with existing code that expects template_columns
        template_columns = []

        # Build canonical headers by pruning/adding optional groups starting from original template headers
        try:
            base_headers = info.get('template_headers')
            if not base_headers:
                # Read from file if not cached
                mapper = BOMHeaderMapper()
                base_headers = mapper.read_excel_headers(
                    file_path=hybrid_file_manager.get_file_path(info["template_path"]),
                    sheet_name=info.get("template_sheet_name"),
                    header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
                )
                info['template_headers'] = base_headers
        except Exception:
            base_headers = []

        # FIXED: Only match NUMBERED dynamic columns (Tag_1, etc.), not user's original columns
        import re
        def _norm(h: str) -> str:
            try:
                return str(h or '').strip().lower()
            except Exception:
                return ''
        def _is_dynamic_tag(h: str) -> bool:
            return bool(re.match(r'^tag_\d+$', _norm(h)))
        def _is_dynamic_spec_name(h: str) -> bool:
            return bool(re.match(r'^specification_name_\d+$', _norm(h)))
        def _is_dynamic_spec_value(h: str) -> bool:
            return bool(re.match(r'^specification_value_\d+$', _norm(h)))
        def _is_dynamic_cust_name(h: str) -> bool:
            return bool(re.match(r'^custom_identification_name_\d+$', _norm(h)))
        def _is_dynamic_cust_value(h: str) -> bool:
            return bool(re.match(r'^custom_identification_value_\d+$', _norm(h)))

        # Use uploaded template headers as base, add dynamic columns if needed
        # Filter out ONLY numbered dynamic columns (Tag_1, Specification_Name_1, etc.)
        # Keep user's original columns like "Tag", "Specification Name", etc.

        # === DETAILED LOGGING FOR DEBUGGING ===
        logger.info(f"📊 UPDATE_COLUMN_COUNTS: Session {session_id}")
        logger.info(f"📊 ORIGINAL TEMPLATE HEADERS (from uploaded file): {base_headers}")

        regenerated_headers = build_sfo_clustered_headers(
            base_headers,
            tags_count,
            spec_pairs_count,
            customer_id_pairs_count,
        )

        logger.info(f"SFO TAG COLUMNS: {tags_count} repeated Tag header(s)")
        logger.info(f"SFO SPEC GROUPS: {spec_pairs_count} clustered Specification name/value/UOM group(s)")
        logger.info(f"SFO ITEM ID GROUPS: {customer_id_pairs_count} clustered Custom identification name/value group(s)")
        logger.info(f"FINAL COMBINED HEADERS: {regenerated_headers}")

        # The editor draws from `enhanced_headers`, but tools and the export read
        # `edited_data` / `enhanced_data` — separate stored grids that kept the
        # old column set. Adding a Tag or Specification slot therefore produced a
        # column you could see but nothing could write to ("Column Tag_5 is not
        # in the grid") and that never reached the exported file. Re-shape those
        # grids onto the new header list so all of them describe one sheet.
        for snapshot_key in ('edited_data', 'enhanced_data'):
            reshaped = _reshape_grid_snapshot(info.get(snapshot_key), regenerated_headers)
            if reshaped is not None:
                info[snapshot_key] = reshaped
                logger.info(
                    f"🔧 Re-shaped {snapshot_key} to {len(regenerated_headers)} columns"
                )

        # Compute template_optionals for the canonical headers (Tags/Spec/Customer always optional)
        def is_special_optional(h: str) -> bool:
            h_lower = (h or '').lower()
            return (h == 'Tag' or h.startswith('Tag_') or
                   'specification' in h_lower or
                   'item identifications' in h_lower or
                   'custom identification' in h_lower or
                   'custom_identification' in h_lower)

        template_optionals = [True if is_special_optional(h) else False for h in regenerated_headers]

        # Build canonical enhanced_headers and save to session BEFORE version bump
        info["current_template_headers"] = regenerated_headers
        info["enhanced_headers"] = regenerated_headers
        info['template_columns'] = regenerated_headers  # Use same headers for consistency
        info['template_optionals'] = template_optionals
        info['column_counts'] = {
            'tags_count': tags_count,
            'spec_pairs_count': spec_pairs_count,
            'customer_id_pairs_count': customer_id_pairs_count,
        }
        save_session(session_id, info)

        # Atomic version bump AFTER all data is saved
        new_version = increment_template_version(session_id)
        
        # Debug logging
        logger.info(f"🔧 Updated session {session_id} with canonical headers: {regenerated_headers}")
        logger.info(f"🔧 Session store now contains: {list(info.keys())}")

        return Response({
            'success': True,
            'template_version': new_version,
            'enhanced_headers': regenerated_headers,
            'template_optionals': template_optionals,
            'column_counts': info['column_counts'],
        })
        
    except Exception as e:
        logger.error(f"❌ Error updating column counts: {str(e)}")
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def generate_template_columns(tags_count, spec_pairs_count, customer_id_pairs_count, existing_headers=None):
    """Generate SFO import headers with repeated labels clustered in template order."""
    return build_sfo_clustered_headers(
        existing_headers or [],
        max(int(tags_count or 0), 0),
        max(int(spec_pairs_count or 0), 0),
        max(int(customer_id_pairs_count or 0), 0),
    )


@api_view(['POST'])
def save_mapping_template(request):
    """Save current session mapping as a reusable template."""
    try:
        session_id = request.data.get('session_id')
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        override_mappings = request.data.get('mappings')  # Optional mappings override
        override_formula_rules = request.data.get('formula_rules')  # Optional formula rules override
        override_factwise_rules = request.data.get('factwise_rules')  # Optional factwise rules override
        override_default_values = request.data.get('default_values')  # Optional default values override
        override_default_value_rules = request.data.get('default_value_rules')  # Optional conditional defaults override
        mpn_validation_metadata = request.data.get('mpn_validation_metadata', {})  # MPN validation metadata
        overwrite_existing = bool(request.data.get('overwrite_existing'))
        # Taken from the session rather than the request: these are the gate's
        # answers, and the editor that saves the template never sees them.
        bom_structure = (get_session_consistent(session_id) or {}).get('bom_structure') or {}
        
        if not template_name:
            return Response({
                'success': False,
                'error': 'Template name is required'
            }, status=status.HTTP_400_BAD_REQUEST)

        existing_template = MappingTemplate.objects.filter(name=template_name).first()
        if existing_template and not overwrite_existing:
            return Response({
                'success': False,
                'code': 'duplicate_template_name',
                'error': 'Template with this name already exists. Please enter another name.'
            }, status=status.HTTP_409_CONFLICT)
        
        # Handle two cases: session-based templates and standalone formula templates
        if session_id and session_id in SESSION_STORE:
            # Session-based template (normal case)
            info = SESSION_STORE[session_id]
            raw_mappings = override_mappings if override_mappings is not None else info.get("mappings")
            # CRITICAL FIX: Strip target_column AND fix source_column from formula rules before saving to template
            # This ensures rules are always dynamically assigned to next available Tag column when applied
            raw_formula_rules = override_formula_rules if override_formula_rules is not None else info.get("formula_rules", [])
            formula_rules = []
            for rule in raw_formula_rules:
                cleaned_rule = rule.copy()
                # Remove target_column so it's dynamically assigned on template application
                if 'target_column' in cleaned_rule:
                    del cleaned_rule['target_column']

                # CRITICAL FIX: If source_column is 'Tag', this is a bug from FormulaBuilder
                # The source should be a real data column, not the destination type
                if cleaned_rule.get('source_column') == 'Tag' or cleaned_rule.get('source_column') == cleaned_rule.get('column_type'):
                    logger.error(f"🚨 BUG: source_column='{cleaned_rule.get('source_column')}' matches column_type, this will never match any data!")
                    logger.error(f"🚨 Rule has invalid source_column, it should be a real data column name, not the destination type")
                    # Don't save broken rules
                    continue

                formula_rules.append(cleaned_rule)

            factwise_rules = override_factwise_rules if override_factwise_rules is not None else info.get("factwise_rules", [])
            # CRITICAL FIX: Get default values and ensure they are properly formatted
            raw_default_values = override_default_values if override_default_values is not None else info.get("default_values", {})
            
            # Clean default values to ensure they are properly stored
            default_values = {}
            if raw_default_values and isinstance(raw_default_values, dict):
                for field_name, value in raw_default_values.items():
                    # Only store fields that actually have non-empty default values
                    # Skip fields with None, empty strings, or whitespace-only values
                    if value is not None and str(value).strip() != "":
                        default_values[field_name] = str(value).strip()
                    else:
                        # Only log if this field was actually supposed to have a default value
                        # (i.e., if the user had set a value but it's now empty)
                        if field_name in ['Specification name', 'Procurement entity name', 'Custom identification name']:
                            pass

            # Conditional default-value rules (if/else against another column) set on
            # the mapping page. They live on the session, so without persisting them
            # here they died with the session and were silently lost every time the
            # template was reused.
            raw_default_value_rules = (
                override_default_value_rules if override_default_value_rules is not None
                else info.get("default_value_rules", {})
            )
            default_value_rules = {}
            if raw_default_value_rules and isinstance(raw_default_value_rules, dict):
                for field_name, rule in raw_default_value_rules.items():
                    if isinstance(rule, dict) and str(rule.get('column') or '').strip():
                        default_value_rules[field_name] = rule

            # Convert mappings from new format to old format for template storage
            if raw_mappings and isinstance(raw_mappings, dict) and 'mappings' in raw_mappings:
                # New format: {'mappings': [{'source': '...', 'target': '...'}, ...]}
                # For templates, we need to preserve all mappings including duplicates
                # Store both the old format dict and new format list for compatibility
                mappings = {}
                mapping_list = []
                
                for mapping_item in raw_mappings['mappings']:
                    source = mapping_item.get('source')
                    target = mapping_item.get('target')
                    if source and target:
                        # Store in new format list (preserves duplicates)
                        mapping_list.append({'source': source, 'target': target})
                        # Store in old format dict (for compatibility, will overwrite duplicates)
                        mappings[target] = source
                
                # Store both formats - use new format as primary, old format as fallback
                mappings = {
                    'new_format': mapping_list,
                    'old_format': mappings
                }
                logger.info(f"🔄 Converted {len(raw_mappings['mappings'])} mappings from new format, preserving duplicates")
            else:
                mappings = raw_mappings or {}
            
            if not mappings and not formula_rules:
                return Response({
                    'success': False,
                    'error': 'No mappings or formula rules to save'
                }, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Standalone template (formula-only from Dashboard)
            mappings = override_mappings or {}
            formula_rules = override_formula_rules or []
            factwise_rules = override_factwise_rules or []
            default_values = override_default_values or {}
            default_value_rules = override_default_value_rules or {}

            if not formula_rules:
                return Response({
                    'success': False,
                    'error': 'No formula rules provided for standalone template'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            info = None  # No session info for standalone templates
        
        # Read headers (only if we have session info)
        if info:
            mapper = BOMHeaderMapper()
            client_headers = mapper.read_excel_headers(
                file_path=info["client_path"],
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
            )

            # Use template headers from session (from uploaded template file)
            template_headers = info.get('current_template_headers') or info.get('template_headers') or []

            # Get column counts
            tags_count = request.data.get('tags_count') or info.get('tags_count', 3)
            spec_pairs_count = request.data.get('spec_pairs_count') or info.get('spec_pairs_count', 3)
            customer_id_pairs_count = request.data.get('customer_id_pairs_count') or info.get('customer_id_pairs_count', 1)

            logger.info(f"🔧 Using template headers from uploaded file for save_mapping_template ({len(template_headers)} headers): {template_headers}")
        else:
            # Standalone template - use empty headers
            client_headers = []
            template_headers = []
        
        # Get column counts from request, session, or use defaults (for standalone templates only)
        if not info:
            # Standalone template - use request or defaults
            tags_count = request.data.get('tags_count', 3)
            spec_pairs_count = request.data.get('spec_pairs_count', 3) 
            customer_id_pairs_count = request.data.get('customer_id_pairs_count', 1)
        
        # REMOVED: Broken normalization logic that corrupted source_column values
        # The old code was setting target_column='Tag' and converting Tag_4 → 'Tag'
        # This broke formulas because 'Tag' doesn't exist in source data
        # Now: target_column is already stripped above (line 4993), source_column stays correct

        # Create template with backward compatibility
        try:
            debug_log(session_id, f"Saving template '{template_name}'", {
                'factwise_rules': factwise_rules,
                'default_values': default_values,
                'mappings_count': len(raw_mappings.get('mappings', [])) if isinstance(raw_mappings, dict) else 0,
                'formula_rules_count': len(formula_rules),
                'column_counts': {
                    'tags_count': tags_count,
                    'spec_pairs_count': spec_pairs_count,
                    'customer_id_pairs_count': customer_id_pairs_count
                }
            })
            if existing_template and overwrite_existing:
                template = existing_template
                template.description = description
                template.template_headers = template_headers
                template.source_headers = client_headers
                template.mappings = mappings
                template.formula_rules = formula_rules  # Include normalized formula rules
                template.factwise_rules = factwise_rules  # Include factwise ID rules
                template.default_values = default_values  # Include default values
                template.default_value_rules = default_value_rules  # Conditional if/else defaults
                template.mpn_validation_metadata = mpn_validation_metadata  # Include MPN validation metadata
                template.bom_structure = bom_structure  # BOM structure gate answers
                template.tags_count = tags_count
                template.spec_pairs_count = spec_pairs_count
                template.customer_id_pairs_count = customer_id_pairs_count
                template.session_id = session_id
                template.save()
            else:
                template = MappingTemplate.objects.create(
                    name=template_name,
                    description=description,
                    template_headers=template_headers,
                    source_headers=client_headers,
                    mappings=mappings,
                    formula_rules=formula_rules,  # Include normalized formula rules
                    factwise_rules=factwise_rules,  # Include factwise ID rules
                    default_values=default_values,  # Include default values
                    default_value_rules=default_value_rules,  # Conditional if/else defaults
                    mpn_validation_metadata=mpn_validation_metadata,  # Include MPN validation metadata
                    bom_structure=bom_structure,  # BOM structure gate answers
                    tags_count=tags_count,
                    spec_pairs_count=spec_pairs_count,
                    customer_id_pairs_count=customer_id_pairs_count,
                    session_id=session_id
                )
        except IntegrityError as e:
            if 'unique' in str(e).lower() and 'name' in str(e).lower():
                return Response({
                    'success': False,
                    'code': 'duplicate_template_name',
                    'error': 'Template with this name already exists. Please enter another name.'
                }, status=status.HTTP_409_CONFLICT)
            raise e
        except Exception as e:
            # If new fields don't exist yet, create without them
            if ('formula_rules' in str(e) or 'factwise_rules' in str(e) or 'default_values' in str(e)
                    or 'default_value_rules' in str(e) or 'mpn_validation_metadata' in str(e)):
                try:
                    if existing_template and overwrite_existing:
                        template = existing_template
                        template.description = description
                        template.template_headers = template_headers
                        template.source_headers = client_headers
                        template.mappings = mappings
                        template.session_id = session_id
                        template.save()
                    else:
                        template = MappingTemplate.objects.create(
                            name=template_name,
                            description=description,
                            template_headers=template_headers,
                            source_headers=client_headers,
                            mappings=mappings,
                            session_id=session_id
                        )
                except IntegrityError as fallback_error:
                    if 'unique' in str(fallback_error).lower() and 'name' in str(fallback_error).lower():
                        return Response({
                            'success': False,
                            'code': 'duplicate_template_name',
                            'error': 'Template with this name already exists. Please enter another name.'
                        }, status=status.HTTP_409_CONFLICT)
                    raise fallback_error
            else:
                raise e
        
        # CRITICAL FIX: Return comprehensive response with all template data
        response_data = {
            'success': True,
            'message': f'Template "{template.name}" {"updated" if existing_template and overwrite_existing else "saved"} successfully',
            'updated': bool(existing_template and overwrite_existing),
            'template_id': template.id,
            'template_name': template.name,
            'description': template.description,
            'default_values': default_values,
            'default_value_rules': default_value_rules,
            'column_counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            }
        }
        
        debug_log(session_id, "Template saved successfully, returning comprehensive response", {
            'template_id': template.id,
            'template_name': template.name,
            'default_values_count': len(default_values) if default_values else 0,
            'response_keys': list(response_data.keys())
        })
        
        return Response(response_data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        logger.error(f"Error in save_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def update_mapping_template(request):
    """Update/overwrite an existing mapping template."""
    try:
        session_id = request.data.get('session_id')
        template_id = request.data.get('template_id')
        action = request.data.get('action')
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not template_id:
            return Response({
                'success': False,
                'error': 'Template ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the existing template
        try:
            template = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings to save'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Read headers
        mapper = BOMHeaderMapper()
        client_headers = mapper.read_excel_headers(
            file_path=info["client_path"],
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )

        # Prefer canonical dynamic headers if available
        canonical_headers = info.get("current_template_headers") or info.get("enhanced_headers")
        if canonical_headers and isinstance(canonical_headers, list) and len(canonical_headers) > 0:
            template_headers = canonical_headers
        else:
            template_headers = mapper.read_excel_headers(
                file_path=info["template_path"],
                sheet_name=info.get("template_sheet_name"),
                header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
            )
            # Normalize to internal numbered headers
            template_headers = normalize_headers_to_internal(template_headers)
        
        # Get formula rules from session if they exist
        formula_rules = info.get("formula_rules", [])
        
        # Update the template
        template.client_headers = client_headers
        template.template_headers = template_headers
        template.mappings = mappings
        template.formula_rules = formula_rules  # Update formula rules
        # Keep the gate's answers current too, so "Update template" from the
        # editor captures them the same way "Save template" does.
        if info.get('bom_structure'):
            template.bom_structure = info['bom_structure']

        # Also persist dynamic counts and default values if present
        tags_count = info.get('tags_count', getattr(template, 'tags_count', 1))
        spec_pairs_count = info.get('spec_pairs_count', getattr(template, 'spec_pairs_count', 1))
        customer_id_pairs_count = info.get('customer_id_pairs_count', getattr(template, 'customer_id_pairs_count', 1))
        default_values = info.get('default_values', getattr(template, 'default_values', {}))
        default_value_rules = info.get('default_value_rules', getattr(template, 'default_value_rules', {}))

        try:
            template.tags_count = int(tags_count)
            template.spec_pairs_count = int(spec_pairs_count)
            template.customer_id_pairs_count = int(customer_id_pairs_count)
        except Exception:
            logger.warning("🔧 DEBUG: Could not convert dynamic counts to int during update_mapping_template")
        try:
            template.default_values = default_values
        except Exception:
            logger.warning("🔧 DEBUG: Could not set default_values during update_mapping_template")
        try:
            template.default_value_rules = default_value_rules or {}
        except Exception:
            logger.warning("🔧 DEBUG: Could not set default_value_rules during update_mapping_template")
        
        # Update name and description if provided
        if template_name:
            template.name = template_name
        if description:
            template.description = description
        
        template.save()
        
        logger.info(
            f"Template {template.id} updated successfully with {len(mappings)} mappings, "
            f"{len(formula_rules)} formula rules, counts: tags={getattr(template,'tags_count',None)}, "
            f"spec_pairs={getattr(template,'spec_pairs_count',None)}, cust_pairs={getattr(template,'customer_id_pairs_count',None)}"
        )
        
        return Response({
            'success': True,
            'message': f'Template "{template.name}" updated successfully',
            'template_id': template.id
        })
        
    except Exception as e:
        logger.error(f"Error in update_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to update template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_mapping_templates(request):
    """Get all saved mapping templates."""
    try:
        templates = MappingTemplate.objects.all().order_by('-created_at')
        template_list = [template.get_mapping_summary() for template in templates]
        
        return Response({
            'success': True,
            'templates': template_list
        })
        
    except Exception as e:
        logger.error(f"Error in get_mapping_templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def delete_mapping_template(request, template_id):
    """Delete a saved mapping template."""
    try:
        # Get the template
        try:
            template = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        template_name = template.name
        template.delete()
        
        return Response({
            'success': True,
            'message': f'Template "{template_name}" deleted successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in delete_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to delete template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


TEMPLATE_EXPORT_FORMAT = 'factwise-mapping-template'
TEMPLATE_EXPORT_VERSION = 1


def _serialize_template_for_export(t):
    """Portable, environment-independent snapshot of a mapping template."""
    return {
        'format': TEMPLATE_EXPORT_FORMAT,
        'version': TEMPLATE_EXPORT_VERSION,
        'exported_at': datetime.utcnow().isoformat() + 'Z',
        'template': {
            'name': t.name,
            'description': t.description or '',
            'template_headers': t.template_headers,
            'source_headers': t.source_headers,
            'mappings': t.mappings,
            'formula_rules': t.formula_rules or [],
            'factwise_rules': t.factwise_rules or [],
            'default_values': t.default_values or {},
            'default_value_rules': getattr(t, 'default_value_rules', {}) or {},
            'mpn_validation_metadata': t.mpn_validation_metadata or {},
            'bom_structure': t.bom_structure or {},
            'tags_count': t.tags_count,
            'spec_pairs_count': t.spec_pairs_count,
            'customer_id_pairs_count': t.customer_id_pairs_count,
        },
    }


@api_view(['GET'])
def export_mapping_template(request, template_id):
    """Download a saved mapping template as a portable .fwtemplate.json file."""
    try:
        try:
            t = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({'success': False, 'error': 'Template not found'}, status=status.HTTP_404_NOT_FOUND)

        import json as _json, re as _re
        body = _json.dumps(_serialize_template_for_export(t), indent=2, ensure_ascii=False)
        safe = _re.sub(r'[^A-Za-z0-9._-]+', '_', t.name or 'template').strip('_') or 'template'
        resp = HttpResponse(body, content_type='application/json')
        resp['Content-Disposition'] = f'attachment; filename="{safe}.fwtemplate.json"'
        return resp
    except Exception as e:
        logger.error(f"export_mapping_template failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def import_mapping_template(request):
    """
    Create a mapping template from an exported .fwtemplate.json.

    Accepts the wrapped export ({format, template:{...}}), a bare template dict,
    or a multipart file upload under 'file'. Names are made unique so importing
    never clobbers an existing template.
    """
    try:
        import json as _json
        payload = None
        if request.FILES.get('file'):
            try:
                payload = _json.loads(request.FILES['file'].read().decode('utf-8'))
            except Exception:
                return Response({'success': False, 'error': 'Could not read the file as JSON.'},
                                status=status.HTTP_400_BAD_REQUEST)
        else:
            payload = request.data

        tpl = None
        if isinstance(payload, dict):
            if isinstance(payload.get('template'), dict):
                tpl = payload['template']
            elif 'template_headers' in payload and 'mappings' in payload:
                tpl = payload
        if not isinstance(tpl, dict) or 'template_headers' not in tpl or 'mappings' not in tpl:
            return Response({'success': False, 'error': 'Not a valid FactWise mapping-template file.'},
                            status=status.HTTP_400_BAD_REQUEST)

        base = str(tpl.get('name') or 'Imported template').strip() or 'Imported template'
        name = base
        n = 2
        while MappingTemplate.objects.filter(name=name).exists():
            name = f"{base} ({n})"
            n += 1

        def _int(v, d=1):
            try:
                return max(1, int(v))
            except (TypeError, ValueError):
                return d

        t = MappingTemplate.objects.create(
            name=name,
            description=tpl.get('description') or '',
            template_headers=tpl.get('template_headers') or [],
            source_headers=tpl.get('source_headers') or [],
            mappings=tpl.get('mappings') or [],
            formula_rules=tpl.get('formula_rules') or [],
            factwise_rules=tpl.get('factwise_rules') or [],
            default_values=tpl.get('default_values') or {},
            default_value_rules=tpl.get('default_value_rules') or {},
            mpn_validation_metadata=tpl.get('mpn_validation_metadata') or {},
            bom_structure=tpl.get('bom_structure') or {},
            tags_count=_int(tpl.get('tags_count')),
            spec_pairs_count=_int(tpl.get('spec_pairs_count')),
            customer_id_pairs_count=_int(tpl.get('customer_id_pairs_count')),
            session_id='imported',
        )
        logger.info(f"📥 Imported mapping template '{name}' (id={t.id})")
        return Response({'success': True, 'message': f'Imported template "{name}"',
                         'template': t.get_mapping_summary()})
    except Exception as e:
        logger.error(f"import_mapping_template failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def apply_mapping_template(request):
    """Apply a saved mapping template to a session."""
    try:
        session_id = request.data.get('session_id')
        template_id = request.data.get('template_id')
        
        logger.debug(f"Request data: {request.data}")
        
        info = get_session_consistent(session_id)
        if not session_id or not info:
            logger.error(f"❌ Invalid session_id: {session_id} (available: {list(SESSION_STORE.keys())})")
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not template_id:
            logger.error(f"❌ Template ID is required")
            return Response({
                'success': False,
                'error': 'Template ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the template
        try:
            template = MappingTemplate.objects.get(id=template_id)
            logger.info(f"✅ Found template: {template.name} (ID: {template.id})")
            logger.debug(f"Template details: tags_count={getattr(template, 'tags_count', 'N/A')}, "
                        f"spec_pairs_count={getattr(template, 'spec_pairs_count', 'N/A')}, "
                        f"customer_id_pairs_count={getattr(template, 'customer_id_pairs_count', 'N/A')}")
        except MappingTemplate.DoesNotExist:
            logger.error(f"❌ Template not found with ID: {template_id}")
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        info = SESSION_STORE[session_id]
        logger.debug(f"Session info keys: {list(info.keys())}")
        logger.debug(f"Session has client_path: {info.get('client_path')}")
        logger.debug(f"Session has sheet_name: {info.get('sheet_name')}")
        logger.debug(f"Session has header_row: {info.get('header_row')}")
        
        # Read client headers
        mapper = BOMHeaderMapper()
        logger.info(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info(f"🔍 [TEMPLATE_APPLY] Starting template application for session: {session_id}")
        logger.info(f"🔍 [TEMPLATE_APPLY] Template ID: {template_id}, Name: {template.name}")
        logger.info(f"🔍 [TEMPLATE_APPLY] Source type: {info.get('source_type', 'excel')}")
        logger.info(f"🔍 [TEMPLATE_APPLY] Client file path: {info['client_path']}")
        logger.info(f"🔍 [TEMPLATE_APPLY] Sheet name: {info['sheet_name']}, Header row: {info['header_row']}")

        # CRITICAL FIX: For PDF sessions, use PDF extracted headers instead of CSV headers
        # PDF CSV files don't have headers (header_row=1 but the file starts with data)
        source_type = info.get('source_type', 'excel')
        if str(source_type).startswith('pdf'):
            # Get PDF extracted headers from database
            try:
                pdf_session = PDFSession.objects.get(session_id=session_id)
                extraction = PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
                if extraction and extraction.extracted_headers:
                    client_headers = extraction.extracted_headers
                    logger.info(f"🔍 [TEMPLATE_APPLY] Using PDF extracted headers: {client_headers}")
                else:
                    logger.warning(f"⚠️ [TEMPLATE_APPLY] No PDF extraction found, falling back to CSV headers")
                    client_headers = mapper.read_excel_headers(
                        file_path=info["client_path"],
                        sheet_name=info["sheet_name"],
                        header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
                    )
            except PDFSession.DoesNotExist:
                logger.warning(f"⚠️ [TEMPLATE_APPLY] PDFSession not found, falling back to CSV headers")
                client_headers = mapper.read_excel_headers(
                    file_path=info["client_path"],
                    sheet_name=info["sheet_name"],
                    header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
                )
        else:
            client_headers = mapper.read_excel_headers(
                file_path=info["client_path"],
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
            )
        logger.info(f"🔍 [TEMPLATE_APPLY] Read {len(client_headers)} client headers: {client_headers}")

        # Apply template mappings
        logger.info(f"🔍 [TEMPLATE_APPLY] Applying template mappings...")
        logger.info(f"🔍 [TEMPLATE_APPLY] Template has {len(template.mappings.get('new_format', []) if isinstance(template.mappings, dict) else [])} mappings")
        application_result = template.apply_to_headers(client_headers)
        logger.info(f"🔍 [TEMPLATE_APPLY] ✅ Template application result:")
        logger.info(f"🔍 [TEMPLATE_APPLY]   - Total mapped: {application_result.get('total_mapped', 0)}")
        logger.info(f"🔍 [TEMPLATE_APPLY]   - Mappings (new format): {len(application_result.get('mappings_new_format', []))}")
        logger.info(f"🔍 [TEMPLATE_APPLY]   - Mappings details: {application_result.get('mappings_new_format', [])}")
        
        if application_result['total_mapped'] > 0:
            logger.info(f"✅ Template applied successfully with {application_result['total_mapped']} mappings")
            
            # Update session with applied template ID
            SESSION_STORE[session_id]["original_template_id"] = template_id
            logger.debug(f"Updated session with original_template_id: {template_id}")
            
            # CRITICAL FIX: DO NOT clear formula data after template application
            # The formula_enhanced_data and enhanced_headers contain the Tag values that were just computed
            # Clearing them causes empty Tag columns when navigating to DataEditor
            # Instead, we'll let apply_formulas re-populate them if formulas exist
            logger.debug("Preserving formula_enhanced_data and enhanced_headers after template application")
            
            # CRITICAL FIX: Apply column counts from template and include counts implied by formula rules
            template_tags_count = getattr(template, 'tags_count', 1)
            template_spec_pairs_count = getattr(template, 'spec_pairs_count', 1)
            template_customer_id_pairs_count = getattr(template, 'customer_id_pairs_count', 1)
            
            logger.debug(f"Template column counts - Tags: {template_tags_count}, Spec pairs: {template_spec_pairs_count}, Customer pairs: {template_customer_id_pairs_count}")
            
            # Count mapped fields in the template (use exact counts of distinct indices)
            template_mappings = getattr(template, 'mappings', {})
            mapped_tag_indices = set()
            mapped_spec_indices = set()
            mapped_customer_indices = set()

            def _extract_index(name: str, prefix: str) -> int:
                try:
                    return int(name.replace(prefix, '').strip('_'))
                except Exception:
                    return None

            logger.debug(f"Analyzing template mappings: {template_mappings}")
            
            if isinstance(template_mappings, dict) and 'new_format' in template_mappings:
                logger.debug(f"Processing new_format mappings: {template_mappings['new_format']}")
                for mapping in template_mappings['new_format']:
                    target = mapping.get('target', '') or ''
                    if target.startswith('Tag_'):
                        idx = _extract_index(target, 'Tag_')
                        if idx:
                            mapped_tag_indices.add(idx)
                            logger.debug(f"Found mapped Tag_{idx}")
                    elif target.startswith('Specification_Name_'):
                        idx = _extract_index(target, 'Specification_Name_')
                        if idx:
                            mapped_spec_indices.add(idx)
                            logger.debug(f"Found mapped Specification_Name_{idx}")
                    elif target.startswith('Custom_Identification_Name_'):
                        idx = _extract_index(target, 'Custom_Identification_Name_')
                        if idx:
                            mapped_customer_indices.add(idx)
                            logger.debug(f"Found mapped Custom_Identification_Name_{idx}")
            elif isinstance(template_mappings, dict):
                logger.debug(f"Processing old format mappings: {template_mappings}")
                for target in (template_mappings or {}).keys():
                    target = target or ''
                    if target.startswith('Tag_'):
                        idx = _extract_index(target, 'Tag_')
                        if idx:
                            mapped_tag_indices.add(idx)
                            logger.debug(f"Found mapped Tag_{idx}")
                    elif target.startswith('Specification_Name_'):
                        idx = _extract_index(target, 'Specification_Name_')
                        if idx:
                            mapped_spec_indices.add(idx)
                            logger.debug(f"Found mapped Specification_Name_{idx}")
                    elif target.startswith('Custom_Identification_Name_'):
                        idx = _extract_index(target, 'Custom_Identification_Name_')
                        if idx:
                            mapped_customer_indices.add(idx)
                            logger.debug(f"Found mapped Custom_Identification_Name_{idx}")
            
            logger.debug(f"Mapped indices found - Tags: {mapped_tag_indices}, Spec: {mapped_spec_indices}, Customer: {mapped_customer_indices}")
            
            # Also consider formula_rules implied counts (distinct Tag_N targets)
            # IMPORTANT: Normalize Tag rules to generic targets for portability; assign fresh Tag_N at apply-time
            fr_raw = getattr(template, 'formula_rules', []) or []
            fr = []
            tag_formula_count = 0  # Count how many Tag-type formula rules we have
            for _r in fr_raw:
                r = dict(_r or {})
                if (r or {}).get('column_type', 'Tag') == 'Tag':
                    # REMOVED: Broken logic that set target_column='Tag' and corrupted source_column
                    # The source_column should remain as the actual data column (e.g., 'UOM', 'DigiKey Category')
                    # NOT changed to generic 'Tag' which doesn't exist in source data
                    # target_column will be dynamically assigned during apply_formulas
                    tag_formula_count += 1  # Count this Tag rule
                fr.append(r)
            logger.debug(f"Formula rules: {fr}")
            formula_tag_targets = [r.get('target_column') for r in fr if (r or {}).get('column_type', 'Tag') == 'Tag']
            formula_tag_indices = set()
            for t in formula_tag_targets:
                if t and str(t).startswith('Tag_'):
                    idx = _extract_index(str(t), 'Tag_')
                    if idx:
                        formula_tag_indices.add(idx)

            # CRITICAL FIX: Account for Tag-type formula rules when calculating tags_count
            # Each Tag-type formula rule needs its own Tag column
            mapped_tag_max = max(mapped_tag_indices) if mapped_tag_indices else 0
            formula_tag_max = max(formula_tag_indices) if formula_tag_indices else 0
            # Add the number of Tag formula rules to the base count from mappings
            tags_count = max(mapped_tag_max + tag_formula_count, formula_tag_max)
            logger.info(f"🔧 FIX: Template tag calculation - mapped_max={mapped_tag_max}, formula_rules={tag_formula_count}, final={tags_count}")
            # Ensure at least 1 Tag column if template declared any tags
            if tags_count == 0 and template_tags_count > 0:
                tags_count = template_tags_count
            else:
                tags_count = max(tags_count, template_tags_count)

            # For specs/customers, keep existing behavior by distinct counts
            spec_pairs_count = max(template_spec_pairs_count, len(mapped_spec_indices))
            customer_id_pairs_count = max(template_customer_id_pairs_count, len(mapped_customer_indices))
            
            
            SESSION_STORE[session_id]["tags_count"] = tags_count
            SESSION_STORE[session_id]["spec_pairs_count"] = spec_pairs_count
            SESSION_STORE[session_id]["customer_id_pairs_count"] = customer_id_pairs_count
            
            # Get existing template headers to preserve tag numbering
            existing_template_headers = getattr(template, 'template_headers', [])
            
            # CRITICAL FIX: Prevent tag duplication by checking existing headers first
            # Only regenerate if we don't already have the right number of dynamic columns
            existing_dynamic_columns = [h for h in existing_template_headers if any(h.startswith(prefix) for prefix in ['Tag_', 'Specification_Name_', 'Specification_Value_', 'Custom_Identification_']) or h in ['Tag', 'Specification name', 'Specification value', 'Custom identification name', 'Custom identification value']]
            
            debug_log(session_id, "Checking existing dynamic columns before regeneration", {
                'existing_dynamic_count': len(existing_dynamic_columns),
                'expected_tags_count': tags_count,
                'expected_spec_pairs_count': spec_pairs_count,
                'existing_dynamic_columns': existing_dynamic_columns[:10],  # Log first 10 for readability
                'tag_columns': [h for h in existing_dynamic_columns if h.startswith('Tag_') or h == 'Tag'],
                'spec_columns': [h for h in existing_dynamic_columns if h.startswith('Specification_') or h in ['Specification name', 'Specification value']],
                'customer_columns': [h for h in existing_dynamic_columns if h.startswith('Custom_Identification_') or h in ['Custom identification name', 'Custom identification value']]
            })
            
            # Only regenerate if counts don't match or if no dynamic columns exist
            should_regenerate = (not existing_template_headers) and (
                len([h for h in existing_dynamic_columns if h.startswith('Tag_') or h == 'Tag']) != tags_count or
                len([h for h in existing_dynamic_columns if h.startswith('Specification_Name_') or h == 'Specification name']) != spec_pairs_count or
                len([h for h in existing_dynamic_columns if h.startswith('Custom_Identification_Name_') or h == 'Custom identification name']) != customer_id_pairs_count or
                len(existing_dynamic_columns) == 0
            )
            
            if should_regenerate:
                debug_log(session_id, "Regenerating dynamic columns due to count mismatch", {
                    'existing_tags': len([h for h in existing_dynamic_columns if h.startswith('Tag_') or h == 'Tag']),
                    'expected_tags': tags_count,
                    'existing_specs': len([h for h in existing_dynamic_columns if h.startswith('Specification_Name_') or h == 'Specification name']),
                    'expected_specs': spec_pairs_count,
                    'existing_customers': len([h for h in existing_dynamic_columns if h.startswith('Custom_Identification_Name_') or h == 'Custom identification name'])
                })
                
                regenerated_headers = generate_template_columns(
                    tags_count, 
                    spec_pairs_count, 
                    customer_id_pairs_count, 
                    existing_headers=existing_template_headers
                )
                SESSION_STORE[session_id]["current_template_headers"] = regenerated_headers
                SESSION_STORE[session_id]["enhanced_headers"] = regenerated_headers
            else:
                debug_log(session_id, "Using existing dynamic columns (no regeneration needed)", {
                    'existing_headers_count': len(existing_template_headers),
                    'dynamic_columns_count': len(existing_dynamic_columns)
                })
                # Keep existing headers to prevent duplication
                regenerated_headers = existing_template_headers
                SESSION_STORE[session_id]["current_template_headers"] = regenerated_headers
                SESSION_STORE[session_id]["enhanced_headers"] = regenerated_headers
            
            # IMPORTANT: Save session immediately after setting column counts
            save_session(session_id, SESSION_STORE[session_id])
            
            
            # IMPORTANT: Ensure session mappings are in list (new-format) and preserve duplicates
            current_session_mappings = SESSION_STORE[session_id].get("mappings")
            if isinstance(current_session_mappings, dict) and 'mappings' in current_session_mappings:
                # OK: already new format
                pass
            elif isinstance(current_session_mappings, list):
                SESSION_STORE[session_id]["mappings"] = {"mappings": current_session_mappings}
            elif isinstance(current_session_mappings, dict):
                # Old format dict -> convert to list
                converted = [{"source": v, "target": k} for k, v in current_session_mappings.items()]
                SESSION_STORE[session_id]["mappings"] = {"mappings": converted}
            
            # FIXED: Store FactWise rules in session for frontend display
            factwise_rules = getattr(template, 'factwise_rules', []) or []
            if factwise_rules:
                SESSION_STORE[session_id]["factwise_rules"] = factwise_rules
            
            # CRITICAL FIX: Preserve duplicates by using the new-format list from application_result
            # The application_result contains the actual mappings that were successfully applied
            new_format_list = application_result.get('mappings_new_format', [])
            if not new_format_list and 'mappings' in application_result:
                # Fallback: convert old format to new format
                old_mappings = application_result['mappings']
                if isinstance(old_mappings, dict):
                    new_format_list = [{"source": v, "target": k} for k, v in old_mappings.items()]
                elif isinstance(old_mappings, list):
                    new_format_list = old_mappings

            # Remove reserved Tag column logic to avoid duplicate blank Tag columns.
            
            # Store mappings in new format to preserve duplicates
            new_format_mappings = {"mappings": new_format_list}
            SESSION_STORE[session_id]["mappings"] = new_format_mappings
            logger.info(f"🔄 Stored {len(new_format_list)} mappings in new-format list for session (duplicates preserved)")
            
            # CRITICAL: Update mappingsCacheRef equivalent on backend
            # This ensures the frontend can restore mappings even if edges are cleared
            SESSION_STORE[session_id]["cached_mappings"] = new_format_list

            # Restore conditional default rules BEFORE the grid is built —
            # apply_column_mappings reads them off the session and runs them once the
            # whole row exists, which is what lets the condition see another column.
            template_default_value_rules = getattr(template, 'default_value_rules', {}) or {}
            if template_default_value_rules:
                SESSION_STORE[session_id]["default_value_rules"] = template_default_value_rules
                logger.info(f"🔧 Restored {len(template_default_value_rules)} conditional default rule(s) from template")

            # CRITICAL FIX: ALWAYS apply column mappings after template application
            # This transforms source columns to target columns (e.g., MFR → Tag_1)
            # Must happen regardless of whether formula_rules exist
            logger.info(f"🔍 [TEMPLATE_APPLY] ━━━ Applying column mappings ━━━")
            logger.info(f"🔍 [TEMPLATE_APPLY] Mappings to apply: {new_format_mappings}")
            logger.info(f"🔍 [TEMPLATE_APPLY] Number of mappings: {len(new_format_list)}")

            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=new_format_mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            logger.info(f"🔍 [TEMPLATE_APPLY] ✅ Column mappings applied:")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - Headers count: {len(mapping_result.get('headers', []))}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - Data rows count: {len(mapping_result.get('data', []))}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - Mapped headers: {mapping_result.get('headers', [])}")

            # Store the basic mapped data as baseline
            SESSION_STORE[session_id]["mapped_data"] = mapping_result['data']
            SESSION_STORE[session_id]["mapped_headers"] = mapping_result['headers']

            # Apply formula rules if they exist (on top of mapped data)
            formula_rules = fr  # use normalized rules
            if formula_rules:
                # Always assign fresh Tag_N targets when applying a template to avoid reusing stale Tag_N
                try:
                    info_for_alloc = SESSION_STORE[session_id]
                    # Build a set of currently mapped Tag_N targets to avoid reusing them
                    used_tag_set = set()
                    current_maps = info_for_alloc.get('mappings')
                    if isinstance(current_maps, dict) and 'mappings' in current_maps:
                        for m in (current_maps['mappings'] or []):
                            tgt = (m or {}).get('target')
                            if isinstance(tgt, str) and tgt.startswith('Tag_'):
                                used_tag_set.add(tgt)
                    elif isinstance(current_maps, list):
                        for m in current_maps:
                            tgt = (m or {}).get('target')
                            if isinstance(tgt, str) and tgt.startswith('Tag_'):
                                used_tag_set.add(tgt)

                    processed_rules = []
                    for idx, r in enumerate(formula_rules or []):
                        rr = dict(r or {})
                        if rr.get('column_type', 'Tag') == 'Tag':
                            try:
                                next_tag = get_next_available_tag_column(info_for_alloc, used_tag_set)
                                rr['target_column'] = next_tag
                                used_tag_set.add(next_tag)
                            except Exception as _e:
                                logger.warning(f"Could not allocate Tag column for rule {idx+1}: {_e}")
                        processed_rules.append(rr)
                    formula_rules = processed_rules
                except Exception as _e:
                    logger.warning(f"Failed to pre-assign Tag targets for template rules: {_e}")

                SESSION_STORE[session_id]["formula_rules"] = formula_rules
                logger.info(f"🔧 Applying {len(formula_rules)} formula rules on top of mapped data")

                # Convert to dict format for formula processing and enrich with any missing source columns
                dict_rows = []
                cur_headers = list(mapping_result['headers'])
                # Identify rule source columns not present in mapped headers
                missing_sources = []
                try:
                    desired_sources = []
                    for r in (formula_rules or []):
                        try:
                            src = (r or {}).get('source_column')
                            if src and isinstance(src, str):
                                desired_sources.append(src)
                        except Exception:
                            pass
                    missing_sources = [s for s in desired_sources if s not in cur_headers]
                except Exception:
                    missing_sources = []
                # If missing, read directly from client file
                source_columns_data = {}
                if missing_sources:
                    try:
                        client_path2 = hybrid_file_manager.get_file_path(info["client_path"])
                        hdr_row2 = info["header_row"] - 1 if info.get("header_row", 1) > 0 else 0
                        if str(client_path2).lower().endswith('.csv'):
                            raw_df2 = read_csv_with_encoding(client_path2, header_row=hdr_row2)
                        else:
                            raw_df2 = pd.read_excel(client_path2, sheet_name=info.get("sheet_name"), header=hdr_row2)
                        def _norm2(h: str) -> str:
                            return ''.join(ch for ch in str(h or '').strip().lower() if ch.isalnum())
                        df_cols_map2 = {_norm2(c): c for c in raw_df2.columns}
                        for s in missing_sources:
                            key2 = df_cols_map2.get(_norm2(s))
                            if key2 is not None:
                                source_columns_data[s] = raw_df2[key2].astype(str).fillna("").tolist()
                                if s not in cur_headers:
                                    cur_headers.append(s)
                    except Exception as _e:
                        logger.warning(f"Could not enrich source columns from client file (template apply): {_e}")

                for row_idx, row_list in enumerate(mapping_result['data']):
                    row_dict = {}
                    for i, header in enumerate(mapping_result['headers']):
                        row_dict[header] = row_list[i] if i < len(row_list) else ""
                    for s, col_values in source_columns_data.items():
                        try:
                            row_dict[s] = col_values[row_idx] if row_idx < len(col_values) else ""
                        except Exception:
                            row_dict[s] = ""
                    dict_rows.append(row_dict)

                # Apply formula rules to create enhanced data
                formula_result = apply_formula_rules(
                    data_rows=dict_rows,
                    headers=cur_headers,
                    formula_rules=formula_rules,
                    session_info=SESSION_STORE[session_id]
                )

                # Persist formula-enhanced data (takes precedence over basic mapped data)
                logger.info(f"✅ Applied {len(formula_rules)} formula rules from template; persisting enhanced data")
                try:
                    SESSION_STORE[session_id]["formula_enhanced_data"] = formula_result.get('data', [])
                    SESSION_STORE[session_id]["enhanced_headers"] = formula_result.get('headers', mapping_result['headers'])
                    save_session(session_id, SESSION_STORE[session_id])
                    logger.info(f"✅ Persisted formula-enhanced data: {len(formula_result.get('data', []))} rows with {len(formula_result.get('headers', []))} headers")
                except Exception as _e:
                    logger.warning(f"Failed to persist formula-enhanced data: {_e}")
            else:
                # No formula rules: use basic mapped data as enhanced data
                logger.info(f"🔧 No formula rules in template; using basic mapped data as enhanced data")
                SESSION_STORE[session_id]["formula_enhanced_data"] = mapping_result['data']
                SESSION_STORE[session_id]["enhanced_headers"] = mapping_result['headers']
                save_session(session_id, SESSION_STORE[session_id])
            
            # Apply default values before Factwise rules so defaulted columns can
            # participate in Item code generation during template reuse.
            default_values = getattr(template, 'default_values', {}) or {}
            if default_values:
                SESSION_STORE[session_id]["default_values"] = default_values
                current_data = SESSION_STORE[session_id].get("formula_enhanced_data") or SESSION_STORE[session_id].get("mapped_data")
                current_headers = SESSION_STORE[session_id].get("enhanced_headers") or SESSION_STORE[session_id].get("mapped_headers")
                if current_data and current_headers:
                    for row in current_data:
                        for field_name, default_value in default_values.items():
                            if field_name not in current_headers:
                                continue
                            field_index = current_headers.index(field_name)
                            if isinstance(row, list):
                                while len(row) <= field_index:
                                    row.append("")
                                if row[field_index] is None or str(row[field_index]).strip() == "":
                                    row[field_index] = default_value
                            elif isinstance(row, dict):
                                if field_name not in row or row[field_name] is None or str(row[field_name]).strip() == "":
                                    row[field_name] = default_value
                    SESSION_STORE[session_id]["formula_enhanced_data"] = current_data
                    SESSION_STORE[session_id]["mapped_data"] = current_data
                    save_session(session_id, SESSION_STORE[session_id])

            # Apply factwise rules if they exist
            factwise_rules = getattr(template, 'factwise_rules', []) or []
            if factwise_rules:
                SESSION_STORE[session_id]["factwise_rules"] = factwise_rules

                # Unified Fill/Create Column rules are applied after mappings,
                # formulas and defaults so their source columns are ready.
                column_rules = [rule for rule in factwise_rules if rule.get('type') == 'column_value']
                if column_rules:
                    current_data = (
                        SESSION_STORE[session_id].get("formula_enhanced_data")
                        or SESSION_STORE[session_id].get("mapped_data")
                        or []
                    )
                    current_headers = list(
                        SESSION_STORE[session_id].get("enhanced_headers")
                        or SESSION_STORE[session_id].get("mapped_headers")
                        or []
                    )
                    positional_rows = []
                    for row in current_data:
                        if isinstance(row, dict):
                            positional_rows.append([row.get(header, '') for header in current_headers])
                        else:
                            positional_rows.append(list(row))
                    for column_rule in column_rules:
                        current_headers, positional_rows, _changed = apply_column_value_rule(
                            current_headers, positional_rows, column_rule
                        )
                    SESSION_STORE[session_id]["formula_enhanced_data"] = positional_rows
                    SESSION_STORE[session_id]["enhanced_headers"] = current_headers
                    SESSION_STORE[session_id]["current_template_headers"] = current_headers
                    save_session(session_id, SESSION_STORE[session_id])
                
                # Apply each factwise rule with error handling
                for rule in [rule for rule in factwise_rules if rule.get('type') == 'factwise_id']:
                    try:
                        if rule.get("type") == "factwise_id":
                            # Apply the Factwise ID rule by calling the existing function logic
                            first_column = rule.get("first_column")
                            second_column = rule.get("second_column")
                            operator = rule.get("operator", "_")
                        
                        if first_column and second_column:
                            # Get current data (either formula-enhanced or basic mapped)
                            current_data = SESSION_STORE[session_id].get("formula_enhanced_data")
                            current_headers = SESSION_STORE[session_id].get("enhanced_headers")
                            
                            if not current_data:
                                # Use basic mapped data if no formula data exists
                                mapping_result = apply_column_mappings(
                                    client_file=info["client_path"],
                                    mappings=new_format_mappings,
                                    sheet_name=info["sheet_name"],
                                    header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                                    session_id=session_id
                                )
                                current_data = mapping_result['data']
                                current_headers = mapping_result['headers']
                            
                            # Use template column names directly for FactWise ID creation
                            # The FactWise rule stores template column names, and we should use them directly
                            # after the data has been mapped to template format
                            
                            # Check if the template columns exist in the current headers
                            if first_column not in current_headers:
                                logger.warning(f"🆔 Template Factwise ID: First template column '{first_column}' not found in current headers: {current_headers}")
                                continue  # Skip this factwise rule
                            
                            if second_column not in current_headers:
                                logger.warning(f"🆔 Template Factwise ID: Second template column '{second_column}' not found in current headers: {current_headers}")
                                continue  # Skip this factwise rule
                            
                            # Apply FactWise ID creation using template column data
                            # Map directly into 'Item code' so it's available immediately after apply
                            factwise_id_column = []
                            first_col_idx = current_headers.index(first_column)
                            second_col_idx = current_headers.index(second_column)
                            strategy = (rule.get("strategy") or "fill_only_null")
                            
                            
                            if first_col_idx >= 0 and second_col_idx >= 0:
                                for row in current_data:
                                    if isinstance(row, dict):
                                        first_val = str(row.get(first_column, "")).strip()
                                        second_val = str(row.get(second_column, "")).strip()
                                    else:
                                        first_val = str(row[first_col_idx] if first_col_idx < len(row) else "").strip()
                                        second_val = str(row[second_col_idx] if second_col_idx < len(row) else "").strip()
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    factwise_id_column.append(factwise_id)
                                
                                # Map into Item code (or create it if missing)
                                new_headers = list(current_headers)
                                item_idx = None
                                for i_h, h in enumerate(new_headers):
                                    if str(h).strip().lower().replace(" ", "_") == "item_code":
                                        item_idx = i_h
                                        new_headers[i_h] = "Item code"
                                        break
                                new_data_rows = []
                                if item_idx is None:
                                    new_headers = ["Item code"] + new_headers
                                    for i, row in enumerate(current_data):
                                        new_row = [factwise_id_column[i]] + list(row)
                                        new_data_rows.append(new_row)
                                else:
                                    for i, row in enumerate(current_data):
                                        if isinstance(row, list):
                                            new_row = list(row)
                                            while len(new_row) <= item_idx:
                                                new_row.append("")
                                            if strategy == 'override_all' or not str(new_row[item_idx] or '').strip():
                                                new_row[item_idx] = factwise_id_column[i]
                                            new_data_rows.append(new_row)
                                        else:
                                            # dict rows
                                            new_row = dict(row)
                                            if strategy == 'override_all' or not str(new_row.get('Item code', '') or '').strip():
                                                new_row['Item code'] = factwise_id_column[i]
                                            new_data_rows.append(new_row)
                                
                                # Update session with Item code-enhanced data
                                SESSION_STORE[session_id]["formula_enhanced_data"] = new_data_rows
                                SESSION_STORE[session_id]["enhanced_headers"] = new_headers
                                try:
                                    SESSION_STORE[session_id]["current_template_headers"] = new_headers
                                except Exception:
                                    pass
                                save_session(session_id, SESSION_STORE[session_id])
                                
                                logger.info(f"🆔 Applied Factwise ID rule to 'Item code' from template: {first_column} {operator} {second_column}")
                    except Exception as factwise_error:
                        logger.warning(f"🆔 Failed to apply Factwise ID rule from template: {factwise_error}")
                        # Continue with other rules even if this one fails
            
            # CRITICAL FIX: Apply default values if they exist
            default_values = getattr(template, 'default_values', {}) or {}
            if default_values:
                # Store default values in session immediately for frontend access
                SESSION_STORE[session_id]["default_values"] = default_values
                
                # CRITICAL: Save session immediately to ensure default values are persisted
                save_session(session_id, SESSION_STORE[session_id])
                
                # Apply default values to current data if available
                current_data = SESSION_STORE[session_id].get("formula_enhanced_data") or SESSION_STORE[session_id].get("mapped_data")
                current_headers = SESSION_STORE[session_id].get("enhanced_headers") or SESSION_STORE[session_id].get("mapped_headers")
                
                if current_data and current_headers:
                    # Apply default values to each row
                    for row in current_data:
                        for field_name, default_value in default_values.items():
                            if field_name in current_headers:
                                field_index = current_headers.index(field_name)
                                
                                # Only apply if the field is empty
                                if isinstance(row, list) and field_index < len(row):
                                    if not row[field_index] or str(row[field_index]).strip() == "":
                                        row[field_index] = default_value
                                elif isinstance(row, dict):
                                    if field_name not in row or not row[field_name] or str(row[field_name]).strip() == "":
                                        row[field_name] = default_value
                    
                    # Update both data sources to ensure consistency
                    SESSION_STORE[session_id]["formula_enhanced_data"] = current_data
                    SESSION_STORE[session_id]["mapped_data"] = current_data
            
            # Final save before template application completion. Keep the new-format
            # mapping list so duplicate/dynamic mappings survive template reuse.
            info['mappings'] = new_format_mappings or info.get('mappings')
            info['enhanced_headers'] = regenerated_headers
            info['default_values'] = default_values or info.get('default_values', {})
            info['default_value_rules'] = template_default_value_rules or info.get('default_value_rules', {})
            # Carry the BOM gate's answers over, but never overwrite answers the
            # user has already given for this upload — a template is a default,
            # not an override.
            saved_bom_structure = getattr(template, 'bom_structure', None) or {}
            if saved_bom_structure and not info.get('bom_structure'):
                info['bom_structure'] = saved_bom_structure
                logger.info(f"Applied BOM structure from template to session {session_id}")

            # Store MPN validation metadata from template if available
            mpn_metadata = getattr(template, 'mpn_validation_metadata', {})
            if mpn_metadata:
                info['mpn_validation_metadata'] = mpn_metadata

                # AUTO-RESTORE MPN COLUMNS FROM CACHE
                try:
                    mpn_column = mpn_metadata.get('mpn_column')
                    if mpn_column:

                        # Import the MPN restore function locally to avoid circular imports
                        from .mpn_views import mpn_restore_from_cache
                        from rest_framework.request import Request
                        from django.http import QueryDict

                        # Create a mock request object for the MPN restore function
                        mock_request = type('MockRequest', (), {})()
                        mock_request.data = {
                            'session_id': session_id,
                            'mpn_header': mpn_column,
                            'manufacturer_header': mpn_metadata.get('manufacturer_column')
                        }

                        # Call the MPN restore function
                        restore_response = mpn_restore_from_cache(mock_request)

                        if hasattr(restore_response, 'data') and restore_response.data.get('success'):
                            cache_hits = restore_response.data.get('cache_hits', 0)
                            columns_added = restore_response.data.get('columns_added', [])
                            uncached_count = restore_response.data.get('uncached_count', 0)

                            logger.info(f"✅ MPN cache restore successful: {cache_hits} cache hits, {len(columns_added)} columns added, {uncached_count} uncached MPNs")

                            if columns_added:
                                # Refresh the session data after MPN columns were added
                                info = get_session_consistent(session_id)
                                if info and 'enhanced_data' in info:
                                    regenerated_headers = info['enhanced_data'].get('headers', regenerated_headers)
                                    logger.info(f"🔄 Updated headers after MPN restore: {len(regenerated_headers)} columns")

                            if uncached_count > 0:
                                logger.info(f"⚠️  {uncached_count} MPNs need validation - user should run MPN validation for new parts")
                        else:
                            error_msg = restore_response.data.get('error', 'Unknown error') if hasattr(restore_response, 'data') else 'Response error'
                            logger.warning(f"⚠️  MPN cache restore failed: {error_msg}")

                except Exception as e:
                    logger.warning(f"⚠️  MPN cache restore failed with exception: {e}")
                    # Don't fail template application if MPN restore fails
                    pass

            info['column_counts'] = {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count,
            }
            save_session(session_id, info)
            
            # Atomic version bump AFTER all data is saved
            new_version = increment_template_version(session_id)
            
            # Increment template usage
            template.increment_usage()

            logger.info(f"🔍 [TEMPLATE_APPLY] ━━━ Preparing response ━━━")
            logger.info(f"🔍 [TEMPLATE_APPLY] Response will contain:")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - client_headers: {client_headers}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - enhanced_headers count: {len(regenerated_headers)}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - mappings_new_format count: {len(new_format_list)}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - total_mapped: {application_result.get('total_mapped', 0)}")
            logger.info(f"🔍 [TEMPLATE_APPLY]   - column_counts: {info['column_counts']}")
            logger.info(f"🔍 [TEMPLATE_APPLY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

            return no_store(Response({
                'success': True,
                'template_version': new_version,
                'enhanced_headers': regenerated_headers,
                # Return filtered mappings to frontend to avoid applying direct mapping to reserved Tag_N
                'mappings': {k: v for k, v in (application_result.get('mappings', {}) or {}).items() if not (isinstance(k, str) and k.startswith('Tag_') and k not in [m.get('target') for m in new_format_list])},
                'mappings_new_format': new_format_list,
                'default_values': default_values,
                'column_counts': info['column_counts'],
                'total_mapped': application_result.get('total_mapped', 0),
                # Include formula rules to help frontends reflect tag rules immediately
                'formula_rules': _externalize_formula_rules(SESSION_STORE.get(session_id, {}).get('formula_rules', []), SESSION_STORE.get(session_id, {})),
                # CRITICAL FIX: Include client_headers for PDF sessions so frontend can create edges
                'client_headers': client_headers,
            }))
        else:
            return Response({
                'success': False,
                'error': 'No columns could be mapped from this template'
            }, status=status.HTTP_400_BAD_REQUEST)
        
    except Exception as e:
        logger.error(f"Error in apply_mapping_template: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to apply template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR))


class BOMHeaderMappingView(APIView):
    """Legacy API view for BOM header mapping."""
    
    def post(self, request):
        return Response({
            'success': True,
            'message': 'Use the new mapping endpoints instead'
        })


# ─── FORMULA MANAGEMENT ENDPOINTS ──────────────────────────────────────────────

def apply_formula_rules(data_rows, headers, formula_rules, replace_existing=False, session_info=None):
    """
    Apply formula rules with manual sub-rules to data rows and return modified data with new columns.
    
    New Rule Structure with Sub-Rules:
    - source_column: Column to check
    - column_type: 'Tag' or 'Specification Value' 
    - specification_name: Static name for specification column (only if column_type='Specification Value')
    - sub_rules: Array of conditions [
        { search_text: 'CAP', output_value: 'Capacitor', case_sensitive: false },
        { search_text: 'DIODE', output_value: 'Diode', case_sensitive: false }
      ]
    
    Logic:
    - Each rule defines ONE column (Tag or Specification)
    - Sub-rules define multiple conditions within that rule
    - First matching sub-rule wins per row
    - Multiple rules can create multiple columns
    
    Args:
        data_rows: List of dictionaries representing the data
        headers: List of column headers
        formula_rules: List of formula rule dictionaries with sub_rules
        replace_existing: If True, replace existing formula columns instead of creating new ones
    
    Returns:
        Dict with modified data and new headers
    """
    if not data_rows or not formula_rules:
        return {'data': data_rows, 'headers': headers, 'new_columns': []}
    
    # Create a copy of the data to avoid modifying original
    modified_data = [row.copy() for row in data_rows]
    new_headers = headers.copy()
    new_columns = []

    # CRITICAL FIX: Only mark Tag columns as "used" if they're actually mapped
    # This allows formulas to reuse unmapped Tag columns
    mapped_tag_columns = set()
    if session_info:
        mappings = session_info.get("mappings", [])

        # Handle both dict and list formats
        # Session stores as: {'mappings': [{'source': ..., 'target': ...}]}
        if isinstance(mappings, dict):
            actual_mappings = mappings.get('mappings', [])
        elif isinstance(mappings, list):
            actual_mappings = mappings
        else:
            actual_mappings = []

        for m in actual_mappings:
            target = m.get('target', '')
            if target and target.startswith('Tag_'):
                mapped_tag_columns.add(target)

    # Track column usage for auto-naming - ONLY track mapped Tag columns
    # This allows formulas to reuse unmapped Tag columns
    used_column_names = set()
    for h in headers:
        if h.startswith('Tag_'):
            # Only include mapped Tag columns
            if h in mapped_tag_columns:
                used_column_names.add(h)

    
    # Process each rule separately (each rule creates its own column) 
    # FIXED: Don't use counters for tags - always use "Tag" to ensure isolation
    spec_counter = 1
    
    for rule_index, rule in enumerate(formula_rules):
        source_column = rule.get('source_column')
        column_type = rule.get('column_type', 'Tag')
        specification_name = rule.get('specification_name', '')
        sub_rules = rule.get('sub_rules', [])
        
        # Skip rule if missing required fields
        if not source_column or not sub_rules:
            continue


        # Determine column name based on type - SIMPLIFIED TAG COLUMN MANAGEMENT
        if column_type == 'Tag':
            # Check if this rule already has a target column specified
            target_column = rule.get('target_column')
            
            # Initialize column_name to None to ensure it's always assigned
            column_name = None
            
            direct_target = False
            if target_column and target_column.startswith('Tag_'):
                # Use the specified target column if it exists
                column_name = target_column
                direct_target = True
                if column_name not in used_column_names:
                    pass
                else:
                    logger.warning(f"🔧 DEBUG: Specified Tag column '{column_name}' already exists, creating new one")
                    column_name = None  # Reset to None so we create a new one
            elif target_column == 'Tag':
                # CRITICAL FIX: Convert old-style 'Tag' to use first available numbered Tag column
                # Find the first available numbered Tag column in headers
                for header in headers:
                    if header.startswith('Tag_') and header not in used_column_names:
                        column_name = header
                        direct_target = True  # CRITICAL FIX: Set direct_target=True so values are written!
                        break
            
            # If we don't have a valid column_name yet, create a new one
            if not column_name or column_name in used_column_names:
                # Use centralized function to get next available Tag column
                # This ensures consistency with mapping logic
                # Pass session info to get proper context
                if session_info is None:
                    session_info = {'current_template_headers': headers, 'enhanced_headers': headers}
                column_name = get_next_available_tag_column(session_info, used_column_names)

            # CRITICAL: Update rule's target_column so preservation logic works correctly
            # This ensures data_view knows which column to preserve when checking formula rules
            rule['target_column'] = column_name

            # Evaluate matches first without mutating rows
            tag_assignments = []  # list of (row_index, value)
            for idx, row in enumerate(modified_data):
                match_value = None
                for sub_rule in sub_rules:
                    search_text = sub_rule.get('search_text', '')
                    output_value = sub_rule.get('output_value', '')
                    case_sensitive = sub_rule.get('case_sensitive', False)
                    if not search_text or not output_value:
                        continue
                    # Special handling: if source_column is generic 'Tag', search across all Tag_N columns
                    if source_column == 'Tag':
                        tag_cols_scan = [h for h in new_headers if isinstance(h, str) and h.startswith('Tag_')]
                        found = False
                        for tcol in tag_cols_scan:
                            cell = str(row.get(tcol, ''))
                            search_text_compare = search_text if case_sensitive else str(search_text).lower()
                            cell_value_compare = cell if case_sensitive else cell.lower()
                            if search_text_compare in cell_value_compare:
                                found = True
                                break
                        if found:
                            match_value = str(output_value)
                            break
                        else:
                            continue
                    # Default: single source column lookup
                    cell_value = str(row.get(source_column, ''))
                    search_text_compare = search_text if case_sensitive else str(search_text).lower()
                    cell_value_compare = cell_value if case_sensitive else cell_value.lower()

                    if search_text_compare in cell_value_compare:
                        match_value = str(output_value)
                        break
                if match_value is not None and str(match_value).strip() != '':
                    tag_assignments.append((idx, match_value))

            if tag_assignments:
                if direct_target:
                    # Respect explicit Tag_N target: write directly to that column
                    if column_name not in new_headers:
                        new_headers.append(column_name)
                        new_columns.append(column_name)
                        used_column_names.add(column_name)
                    # Ensure column exists in all rows
                    for row in modified_data:
                        if column_name not in row:
                            row[column_name] = ''
                    # Apply all assignments directly into the targeted Tag column
                    for idx, value in tag_assignments:
                        existing_value = str(modified_data[idx].get(column_name, '')).strip()
                        if existing_value and existing_value != value:
                            existing_values = [v.strip() for v in existing_value.split(',')]
                            if value not in existing_values:
                                modified_data[idx][column_name] = f"{existing_value}, {value}"
                        else:
                            modified_data[idx][column_name] = value
                    # Skip generic placement into existing Tag columns
                else:
                    # Try to fit matches into existing Tag columns first (per-row first empty slot)
                    existing_tag_cols = [h for h in new_headers if h.startswith('Tag_')]
                    # Sort by numeric index to preserve order
                    try:
                        existing_tag_cols.sort(key=lambda x: int(x.split('_')[1]))
                    except Exception:
                        existing_tag_cols.sort()

                    unresolved = []
                    # Ensure all existing tag columns are present in each row
                    for row in modified_data:
                        for tcol in existing_tag_cols:
                            if tcol not in row:
                                row[tcol] = ''

                    for idx, value in tag_assignments:
                        placed = False
                        # Place into first empty existing Tag column for this row
                        for tcol in existing_tag_cols:
                            current = str(modified_data[idx].get(tcol, '') or '').strip()
                            if not current:
                                modified_data[idx][tcol] = value
                                placed = True
                                break
                            # If already contains the value, treat as placed
                            existing_values = [v.strip() for v in current.split(',')]
                            if value in existing_values:
                                placed = True
                                break
                        if not placed:
                            unresolved.append((idx, value))

                    # If we still have unresolved assignments, create exactly one new Tag column
                    if unresolved:
                        # CRITICAL FIX: Never enforce tag cap for dynamic formula additions
                        # Tags added via "Add Tags" button should always create new columns, not merge
                        # Only enforce cap during initial template mapping (not via formulas)
                        is_pdf_session = session_info and str(session_info.get('source_type', '')).startswith('pdf')
                        tag_cap = 0
                        # Never enforce cap for formula additions - they should always create new columns
                        enforce_cap = False


                        if enforce_cap and len(existing_tag_cols) >= tag_cap:
                            # Do not add a new Tag column; fold unresolved values into the last Tag column
                            target_fold_col = existing_tag_cols[-1] if existing_tag_cols else None
                            if target_fold_col:
                                for idx, value in unresolved:
                                    existing_value = str(modified_data[idx].get(target_fold_col, '')).strip()
                                    if existing_value and existing_value != value:
                                        existing_values = [v.strip() for v in existing_value.split(',')]
                                        if value not in existing_values:
                                            modified_data[idx][target_fold_col] = f"{existing_value}, {value}"
                                    else:
                                        modified_data[idx][target_fold_col] = value
                            else:
                                # No existing Tag_N columns — initialize the chosen column_name without growing headers list
                                for row in modified_data:
                                    if column_name not in row:
                                        row[column_name] = ''
                                for idx, value in unresolved:
                                    modified_data[idx][column_name] = value
                        else:
                            # Create new Tag column (no cap restriction for PDF or dynamic additions)
                            if column_name not in new_headers:
                                new_headers.append(column_name)
                                new_columns.append(column_name)
                                used_column_names.add(column_name)
                            # Initialize column in all rows
                            for row in modified_data:
                                if column_name not in row:
                                    row[column_name] = ''
                            # Apply unresolved assignments
                            for idx, value in unresolved:
                                existing_value = str(modified_data[idx].get(column_name, '')).strip()
                                if existing_value and existing_value != value:
                                    existing_values = [v.strip() for v in existing_value.split(',')]
                                    if value not in existing_values:
                                        modified_data[idx][column_name] = f"{existing_value}, {value}"
                                else:
                                    modified_data[idx][column_name] = value
        elif column_type == 'Specification Value' and specification_name:
            # Try to use generic specification column names first
            name_column = 'Specification name'
            value_column = 'Specification value'

            # If generic names are already used, create numbered versions
            if name_column in used_column_names or value_column in used_column_names:
                name_column = f"Specification_Name_{spec_counter}"
                value_column = f"Specification_Value_{spec_counter}"
                
                # Find next available specification column numbers
                while name_column in used_column_names or value_column in used_column_names:
                    spec_counter += 1
                    name_column = f"Specification_Name_{spec_counter}"
                    value_column = f"Specification_Value_{spec_counter}"
            
            # Evaluate matches first without mutating rows
            spec_assignments = []  # list of (row_index, value)
            for idx, row in enumerate(modified_data):
                match_value = None
                for sub_rule in sub_rules:
                    search_text = sub_rule.get('search_text', '')
                    output_value = sub_rule.get('output_value', '')
                    case_sensitive = sub_rule.get('case_sensitive', False)
                    if not search_text or not output_value:
                        continue
                    cell_value = str(row.get(source_column, ''))
                    search_text_compare = search_text if case_sensitive else str(search_text).lower()
                    cell_value_compare = cell_value if case_sensitive else cell_value.lower()
                    if search_text_compare in cell_value_compare:
                        match_value = str(output_value)
                        break
                if match_value is not None and str(match_value).strip() != '':
                    spec_assignments.append((idx, match_value))

            # Only add spec columns if at least one row matched
            if spec_assignments:
                if name_column not in new_headers:
                    new_headers.append(name_column)
                    new_columns.append(name_column)
                    used_column_names.add(name_column)
                if value_column not in new_headers:
                    new_headers.append(value_column)
                    new_columns.append(value_column)
                    used_column_names.add(value_column)
                # Initialize columns
                for row in modified_data:
                    if name_column not in row:
                        row[name_column] = specification_name
                    if value_column not in row:
                        row[value_column] = ''
                # Apply assignments
                for idx, value in spec_assignments:
                    existing_value = str(modified_data[idx].get(value_column, '')).strip()
                    if existing_value and existing_value != value:
                        existing_values = [v.strip() for v in existing_value.split(',')]
                        if value not in existing_values:
                            modified_data[idx][value_column] = f"{existing_value}, {value}"
                    else:
                        modified_data[idx][value_column] = value
                spec_counter += 1
    return {
        'data': modified_data,
        'headers': new_headers,
        'new_columns': new_columns,
        'total_rows': len(modified_data)
    }


@api_view(['POST'])
def apply_formulas(request):
    """Apply formula rules to session data and return updated data."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        
        
        info = get_session(session_id)
        if not session_id or not info:
            logger.error(f"🔧 DEBUG: Session {session_id} not found")
            return no_store(Response({'success': False, 'error': 'Invalid session'}, status=400))
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Session info already retrieved via get_session_consistent
        enhanced_headers = info.get("enhanced_headers", []) or info.get("current_template_headers", [])

        # Get all existing columns from all sources
        template_headers = info.get("template_headers", [])
        client_headers = list(info.get("source_headers", {}).keys())


        # Need to get actual mappings FIRST before assigning Tag columns
        # CRITICAL: Get mappings from request first (frontend might not have saved yet)
        # Fall back to session if not provided in request
        mappings_from_request = request.data.get('mappings')


        if mappings_from_request:
            mappings = mappings_from_request
        else:
            # Get fresh session data to ensure we have the latest mappings
            info = SESSION_STORE[session_id]
            mappings = info.get("mappings")

        # CRITICAL FIX: Only include Tag columns that are actually MAPPED, not all Tag columns in headers
        # This allows formula rules to reuse unmapped Tag columns instead of creating new ones
        mapped_tag_columns = set()

        # Extract actual mappings list - handle both dict and list formats
        if isinstance(mappings, dict):
            actual_mappings = mappings.get('mappings', [])
        elif isinstance(mappings, list):
            actual_mappings = mappings
        else:
            actual_mappings = []

        for m in actual_mappings:
            target = m.get('target', '')
            if target and target.startswith('Tag_'):
                mapped_tag_columns.add(target)


        # Build all_existing_columns excluding unmapped Tag columns
        all_columns = set(template_headers + client_headers + enhanced_headers)
        all_existing_columns = set()
        for col in all_columns:
            if col.startswith('Tag_'):
                # Only include Tag columns that are actually mapped
                if col in mapped_tag_columns:
                    all_existing_columns.add(col)
            else:
                # Include all non-Tag columns
                all_existing_columns.add(col)


        # CRITICAL FIX: Always dynamically assign Tag columns based on current session state
        # Even if rules have target_column from template, reassign to next available in THIS session
        # This allows templates to work across different sessions with different Tag column usage
        updated_formula_rules = []
        for idx, rule in enumerate(formula_rules):
            updated_rule = rule.copy()
            if updated_rule.get('column_type', 'Tag') == 'Tag':
                target = updated_rule.get('target_column')

                # ALWAYS allocate next available Tag_N for this session (ignore template's target_column)
                try:
                    next_tag = get_next_available_tag_column(info, set(all_existing_columns))
                    updated_rule['target_column'] = next_tag
                    all_existing_columns.add(next_tag)
                except Exception as e:
                    logger.warning(f"Failed to allocate Tag column for rule {idx+1}: {e}")
            updated_formula_rules.append(updated_rule)

        # Persist updated rules back to session so subsequent applications reuse same Tag_N
        formula_rules = updated_formula_rules
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
        else:
            formatted_mappings = mappings
        
        # Always start from fresh mapped data - no caching
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=formatted_mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        
        # Convert to dict format for formula processing
        dict_rows = []
        for row_list in mapping_result['data']:
            row_dict = {}
            for i, header in enumerate(mapping_result['headers']):
                if i < len(row_list):
                    row_dict[header] = row_list[i]
                else:
                    row_dict[header] = ""
            dict_rows.append(row_dict)
        transformed_rows = dict_rows
        current_headers = mapping_result['headers']
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data available to apply formulas'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Apply formula rules (always create new unique columns)
        formula_result = apply_formula_rules(transformed_rows, current_headers, formula_rules, replace_existing=False, session_info=info)
        
        
        # Persist canonical state
        info['formula_rules'] = formula_rules
        # Avoid persisting full enhanced data for very large datasets; compute per page instead
        SMALL_DATA_THRESHOLD = 2000
        if len(formula_result.get('data', [])) <= SMALL_DATA_THRESHOLD:
            info['formula_enhanced_data'] = formula_result['data']
        else:
            info.pop('formula_enhanced_data', None)
        info['enhanced_headers'] = formula_result['headers']
        info['current_template_headers'] = formula_result['headers']

        # Dynamic Tag column expansion: persist increased Tag count in session
        try:
            new_tag_indices = []
            for h in formula_result.get('headers', []) or []:
                if isinstance(h, str) and h.startswith('Tag_'):
                    try:
                        new_tag_indices.append(int(h.split('_')[1]))
                    except Exception:
                        pass
            if new_tag_indices:
                max_tag = max(new_tag_indices)
                prev = int(info.get('tags_count', 3))
                if max_tag > prev:
                    info['tags_count'] = max_tag
        except Exception as _e:
            logger.warning(f"Could not persist dynamic tags_count: {_e}")
        
        # Increment template version when formulas create new columns
        new_version = increment_template_version(session_id)
        
        # Also bump general version for compatibility
        info['version'] = info.get('version', 0) + 1
        save_session(session_id, info)

        # CRITICAL: Return updated formula_rules with target_column assigned
        # This ensures the frontend has the correct target_column for template saving
        updated_formula_rules = info.get('formula_rules', formula_rules)

        return no_store(Response({
            'success': True,
            'snapshot': build_snapshot(info),
            'new_columns': formula_result.get('new_columns', []),
            'total_rows': formula_result.get('total_rows', 0),
            'rules_applied': len(formula_rules),
            'template_version': new_version,
            'formula_rules': updated_formula_rules,  # Return updated rules with target_column
            'message': f'Applied {len(formula_rules)} formula rules successfully'
        }, status=200))
        
    except Exception as e:
        logger.error(f"Error in apply_formulas: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to apply formulas: {str(e)}'
        }, status=500))


@api_view(['POST'])
def preview_formulas(request):
    """Preview the results of applying formula rules without saving."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        sample_size = int(request.data.get('sample_size', 5))
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the current transformed data
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        # Convert to dict format for preview
        dict_rows = []
        for row_list in mapping_result['data']:
            row_dict = {}
            for i, header in enumerate(mapping_result['headers']):
                if i < len(row_list):
                    row_dict[header] = row_list[i]
                else:
                    row_dict[header] = ""
            dict_rows.append(row_dict)
        transformed_rows = dict_rows
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data available for preview'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get current headers
        mapper = BOMHeaderMapper()
        current_headers = mapper.read_excel_headers(
            file_path=info["template_path"],
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        # Apply formula rules to get preview
        formula_result = apply_formula_rules(transformed_rows, current_headers, formula_rules, session_info=info)
        
        # Calculate statistics for each rule
        rule_stats = []
        for i, rule in enumerate(formula_rules):
            source_column = rule.get('source_column')
            search_text = str(rule.get('search_text', '')).lower()
            case_sensitive = rule.get('case_sensitive', False)
            
            matches = 0
            for row in transformed_rows:
                source_value = str(row.get(source_column, '')).strip()
                if case_sensitive:
                    text_match = search_text in source_value
                else:
                    text_match = search_text in source_value.lower()
                
                if text_match:
                    matches += 1
            
            rule_stats.append({
                'rule_index': i,
                'matches': matches,
                'total_rows': len(transformed_rows),
                'match_percentage': round((matches / len(transformed_rows)) * 100, 1) if transformed_rows else 0
            })
        
        # Get sample data for preview (first few rows)
        sample_data = formula_result['data'][:sample_size]
        
        return Response({
            'success': True,
            'preview_data': sample_data,
            'headers': formula_result['headers'],
            'new_columns': formula_result['new_columns'],
            'rule_statistics': rule_stats,
            'total_rows': len(transformed_rows),
            'sample_size': len(sample_data),
            'message': f'Preview generated for {len(formula_rules)} rules'
        })
        
    except Exception as e:
        logger.error(f"Error in preview_formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to preview formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_formula_templates(request):
    """Get predefined formula templates for common use cases."""
    try:
        # Predefined templates for common component types
        templates = {
            'electronics_basic': {
                'name': 'Electronics Components (Basic)',
                'description': 'Common electronic components',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'cap',
                        'tag_value': 'Capacitor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description', 
                        'search_text': 'res',
                        'tag_value': 'Resistor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'ic',
                        'tag_value': 'Integrated Circuit',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'led',
                        'tag_value': 'LED',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'electronics_advanced': {
                'name': 'Electronics Components (Advanced)',
                'description': 'Extended electronic components classification',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'capacitor',
                        'tag_value': 'Capacitor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'resistor',
                        'tag_value': 'Resistor', 
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'inductor',
                        'tag_value': 'Inductor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'diode',
                        'tag_value': 'Diode',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'transistor',
                        'tag_value': 'Transistor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'mechanical': {
                'name': 'Mechanical Parts',
                'description': 'Common mechanical hardware components',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'screw',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'bolt',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'washer',
                        'tag_value': 'Hardware',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'nut',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'value_classification': {
                'name': 'Value-based Classification',
                'description': 'Classify components by value ranges',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'pf',
                        'tag_value': 'Low Value Capacitor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'uf',
                        'tag_value': 'High Value Capacitor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'ohm',
                        'tag_value': 'Standard Resistor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    }
                ]
            }
        }
        
        return Response({
            'success': True,
            'templates': templates,
            'total_templates': len(templates)
        })
        
    except Exception as e:
        logger.error(f"Error in get_formula_templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_custom_formulas(request):
    """Save custom formula rules to session for reuse."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        template_name = request.data.get('template_name', 'Custom Formula Set')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules to save'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Save to session store
        if 'custom_formula_templates' not in SESSION_STORE[session_id]:
            SESSION_STORE[session_id]['custom_formula_templates'] = {}
        
        template_id = f"custom_{len(SESSION_STORE[session_id]['custom_formula_templates']) + 1}"
        SESSION_STORE[session_id]['custom_formula_templates'][template_id] = {
            'name': template_name,
            'rules': formula_rules,
            'created_at': datetime.now().isoformat(),
            'usage_count': 0
        }
        
        return Response({
            'success': True,
            'template_id': template_id,
            'message': f'Saved {len(formula_rules)} formula rules as "{template_name}"'
        })
        
    except Exception as e:
        logger.error(f"Error in save_custom_formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_enhanced_data(request):
    """Get data enhanced with formula results."""
    try:
        session_id = request.GET.get('session_id')
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        
        # Check if we have formula-enhanced data
        enhanced_data = info.get("formula_enhanced_data")
        enhanced_headers = info.get("enhanced_headers")
        
        if enhanced_data and enhanced_headers:
            # Use formula-enhanced data
            data_to_return = enhanced_data
            headers_to_return = enhanced_headers
        else:
            # Fall back to regular mapped data
            mappings = info.get("mappings")
            if not mappings:
                return Response({
                    'success': False,
                    'error': 'No data available. Please create mappings first.'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            # Convert to dict format
            dict_rows = []
            for row_list in mapping_result['data']:
                row_dict = {}
                for i, header in enumerate(mapping_result['headers']):
                    if i < len(row_list):
                        row_dict[header] = row_list[i]
                    else:
                        row_dict[header] = ""
                dict_rows.append(row_dict)
            data_to_return = dict_rows
            headers_to_return = mapping_result['headers']
        
        if not data_to_return:
            return Response({
                'success': False,
                'error': 'No data available'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # FIXED: Only normalize 'Tag' column if it's NOT in the user's original template headers
        # If user's template has 'Tag' column, keep it separate from Tag_1, Tag_2, etc.
        try:
            original_template_headers = info.get('template_headers', []) or []
            tag_is_in_original_template = 'Tag' in original_template_headers

            if not tag_is_in_original_template and isinstance(headers_to_return, list) and 'Tag' in headers_to_return and isinstance(data_to_return, list) and len(data_to_return) > 0:
                # Only do this redistribution if 'Tag' is NOT in the original template
                logger.info(f"📊 SAVE_DATA: 'Tag' is NOT in original template, redistributing to Tag_N columns")
                # Build ordered list of Tag_N headers
                tag_n_headers = [h for h in headers_to_return if isinstance(h, str) and h.startswith('Tag_')]
                try:
                    tag_n_headers.sort(key=lambda x: int(x.split('_')[1]))
                except Exception:
                    tag_n_headers.sort()
                if isinstance(data_to_return[0], dict):
                    for row in data_to_return:
                        val = str(row.get('Tag', '') or '').strip()
                        if not val:
                            continue
                        placed = False
                        for tcol in tag_n_headers:
                            cur = str(row.get(tcol, '') or '').strip()
                            if not cur:
                                row[tcol] = val
                                placed = True
                                break
                        if not placed and tag_n_headers:
                            last = tag_n_headers[-1]
                            cur = str(row.get(last, '') or '').strip()
                            if cur:
                                parts = [p.strip() for p in cur.split(',')]
                                if val not in parts:
                                    row[last] = f"{cur}, {val}"
                            else:
                                row[last] = val
                        row.pop('Tag', None)
                else:
                    tag_idx = headers_to_return.index('Tag')
                    # indices of Tag_N
                    tag_n_indices = []
                    for h in tag_n_headers:
                        try:
                            tag_n_indices.append(headers_to_return.index(h))
                        except ValueError:
                            pass
                    for row in data_to_return:
                        if tag_idx < len(row):
                            val = str(row[tag_idx] or '').strip()
                        else:
                            val = ''
                        if not val:
                            continue
                        placed = False
                        for idx in tag_n_indices:
                            if idx < len(row):
                                cur = str(row[idx] or '').strip()
                                if not cur:
                                    row[idx] = val
                                    placed = True
                                    break
                        if not placed and tag_n_indices:
                            last_idx = tag_n_indices[-1]
                            if last_idx < len(row):
                                cur = str(row[last_idx] or '').strip()
                                if cur:
                                    parts = [p.strip() for p in cur.split(',')]
                                    if val not in parts:
                                        row[last_idx] = f"{cur}, {val}"
                                else:
                                    row[last_idx] = val
                    # remove Tag column value; keep headers cleanup below
                # Finally drop 'Tag' header
                headers_to_return = [h for h in headers_to_return if h != 'Tag']
            elif tag_is_in_original_template:
                logger.info(f"📊 SAVE_DATA: 'Tag' IS in original template, keeping it separate from Tag_N columns")
                # DO NOT redistribute or remove 'Tag' column - user wants it as a separate column
        except Exception:
            pass

        # Dynamic Tag column expansion: ensure we have enough Tag_N columns for all tag values
        try:
            if isinstance(headers_to_return, list) and isinstance(data_to_return, list) and len(data_to_return) > 0:
                # Work only with dict-style rows (the enhanced path uses dicts)
                if isinstance(data_to_return[0], dict):
                    # Collect existing Tag_N headers, sorted
                    tag_n_headers = [h for h in headers_to_return if isinstance(h, str) and h.startswith('Tag_')]
                    def _tag_index(name: str) -> int:
                        try:
                            return int(str(name).split('_')[1])
                        except Exception:
                            return 0
                    tag_n_headers.sort(key=_tag_index)

                    # Helper to extract all tags from a row (from Tag_N and any generic Tag remnants)
                    def _extract_tags(row: dict) -> list:
                        vals = []
                        # From numbered Tag_N columns
                        for col in tag_n_headers:
                            v = str(row.get(col, '') or '').strip()
                            if v:
                                parts = [p.strip() for p in v.split(',') if p.strip()]
                                vals.extend(parts)
                        # From any leftover generic 'Tag'
                        if 'Tag' in row:
                            v = str(row.get('Tag', '') or '').strip()
                            if v:
                                parts = [p.strip() for p in v.split(',') if p.strip()]
                                vals.extend(parts)
                        # Deduplicate preserving order
                        seen = set()
                        uniq = []
                        for t in vals:
                            if t not in seen:
                                seen.add(t)
                                uniq.append(t)
                        return uniq

                    # Determine max tags needed across rows
                    max_needed = 0
                    for row in data_to_return:
                        tags = _extract_tags(row)
                        if len(tags) > max_needed:
                            max_needed = len(tags)

                    # If we need more Tag_N columns, append them
                    current_count = len(tag_n_headers)
                    if max_needed > current_count:
                        # Find highest existing index
                        highest_idx = 0
                        for h in tag_n_headers:
                            highest_idx = max(highest_idx, _tag_index(h))
                        # Append new Tag_N headers sequentially
                        new_headers = []
                        for i in range(current_count + 1, max_needed + 1):
                            idx = highest_idx + (i - current_count)
                            new_headers.append(f'Tag_{idx}')
                        # If there were no Tag_N columns initially, start from 1
                        if current_count == 0:
                            new_headers = [f'Tag_{i}' for i in range(1, max_needed + 1)]
                        # Add to headers, keeping order: append at end
                        headers_to_return.extend(new_headers)
                        # Refresh tag_n_headers list
                        tag_n_headers = [h for h in headers_to_return if isinstance(h, str) and h.startswith('Tag_')]
                        tag_n_headers.sort(key=_tag_index)

                    # Now distribute tags per row across Tag_1..Tag_N
                    for row in data_to_return:
                        tags = _extract_tags(row)
                        # Clear all Tag_N columns first
                        for col in tag_n_headers:
                            row[col] = ''
                        # Assign sequentially
                        for i, t in enumerate(tags, start=1):
                            if i-1 < len(tag_n_headers):
                                row[tag_n_headers[i-1]] = t
                        # Remove leftover generic 'Tag' key if still present
                        if 'Tag' in row:
                            row.pop('Tag', None)
        except Exception as _e:
            logger.warning(f"Dynamic Tag expansion skipped due to error: {_e}")

        # Cleanup: drop any Tag_N columns that are empty-only
        # CRITICAL FIX: Don't remove Tag columns that have formula rules
        try:
            if isinstance(headers_to_return, list) and len(headers_to_return) > 0:
                tag_n_headers = [h for h in headers_to_return if isinstance(h, str) and h.startswith('Tag_')]

                # Get Tag columns that have formula rules - these should NEVER be removed
                formula_tag_columns = set()
                formula_rules = info.get("formula_rules", [])
                if formula_rules:
                    for rule in formula_rules:
                        if isinstance(rule, dict) and rule.get('column_type') == 'Tag':
                            target_col = rule.get('target_column', '')
                            if target_col and target_col.startswith('Tag_'):
                                formula_tag_columns.add(target_col)

                def col_empty_only(col_name: str) -> bool:
                    if not data_to_return:
                        return True
                    if isinstance(data_to_return[0], dict):
                        for row in data_to_return:
                            if str(row.get(col_name, '') or '').strip():
                                return False
                        return True
                    else:
                        if col_name not in headers_to_return:
                            return True
                        idx = headers_to_return.index(col_name)
                        for row in data_to_return:
                            if idx < len(row) and str(row[idx] or '').strip():
                                return False
                        return True

                # Remove empty-only Tag_N headers, BUT preserve formula-based Tag columns
                for h in list(tag_n_headers):
                    if h in formula_tag_columns:
                        continue  # Skip removal for formula columns

                    if col_empty_only(h):
                        if h in headers_to_return:
                            headers_to_return.remove(h)
                        if isinstance(data_to_return[0], dict):
                            for row in data_to_return:
                                row.pop(h, None)
                        else:
                            # list-of-lists: recompute index after header removal is tricky; skip for list rows
                            pass
        except Exception as cleanup_error:
            logger.warning(f"Tag cleanup error: {cleanup_error}")
            pass

        # Implement pagination
        total_rows = len(data_to_return)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_data = data_to_return[start_idx:end_idx]
        
        return Response({
            'success': True,
            'data': paginated_data,
            'headers': headers_to_return,
            'has_formulas': bool(enhanced_data),
            'formula_rules': info.get("formula_rules", []),
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total_rows': total_rows,
                'total_pages': (total_rows + page_size - 1) // page_size
            }
        })
        
    except Exception as e:
        logger.error(f"Error in get_enhanced_data: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get enhanced data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def check_column_conflicts(request):
    """Check for column name conflicts before applying formulas."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get current headers (both mapped and original)
        mapper = BOMHeaderMapper()
        template_headers = mapper.read_excel_headers(
            file_path=info["template_path"],
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        client_headers = mapper.read_excel_headers(
            file_path=info["client_path"],
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        
        # Get enhanced headers (includes numbered fields like Tag_1, Tag_2)
        enhanced_headers = info.get("enhanced_headers", []) or info.get("current_template_headers", [])
        all_existing_columns = set(template_headers + client_headers + enhanced_headers)
        
        # Check for conflicts and provide smart numbering
        conflicts = []
        suggestions = {}
        
        for rule in formula_rules:
            target_column = rule.get('target_column') or 'Tag'
            column_type = rule.get('column_type', 'Tag')
            
            # Smart numbering for Tag and Specification columns
            if column_type == 'Tag':
                # Use centralized function to get next available Tag column
                suggested_name = get_next_available_tag_column(info, set(all_existing_columns))
                
                # Check if the target column already exists or conflicts
                if target_column in all_existing_columns:
                    # Target column already exists, suggest using it
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': target_column,
                        'conflicting_column': target_column,
                        'conflict_type': 'column_exists',
                        'suggested_name': target_column,
                        'message': f'Tag column already exists, will use existing column'
                    })
                    suggestions[target_column] = target_column
                elif target_column != suggested_name:
                    # Suggest auto-numbering
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': target_column,
                        'conflicting_column': target_column,
                        'conflict_type': 'auto_numbering',
                        'suggested_name': suggested_name,
                        'message': f'Auto-assigned to next available tag number'
                    })
                    suggestions[target_column] = suggested_name
                    # Reserve the suggested name
                    all_existing_columns.add(suggested_name)
                else:
                    # Target column matches suggested name, no conflict
                    all_existing_columns.add(suggested_name)
                    
            elif column_type == 'Specification Value':
                spec_name = rule.get('specification_name', 'Unknown')
                base_column = f"Specification_Value_{spec_name}"
                
                if base_column in all_existing_columns:
                    # Find next available specification number
                    spec_numbers = []
                    for col in all_existing_columns:
                        if col.startswith(f'Specification_Value_{spec_name}_') and col.split('_')[-1].isdigit():
                            spec_numbers.append(int(col.split('_')[-1]))
                    
                    next_spec_number = max(spec_numbers, default=0) + 1
                    suggested_name = f"Specification_Value_{spec_name}_{next_spec_number}"
                    
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': base_column,
                        'conflicting_column': base_column,
                        'conflict_type': 'auto_numbering',
                        'suggested_name': suggested_name,
                        'message': f'Auto-assigned specification number for {spec_name}'
                    })
                    
                    suggestions[base_column] = suggested_name
                    all_existing_columns.add(suggested_name)  # Reserve this name
            else:
                # Generic conflict resolution for other column types
                if target_column in all_existing_columns:
                    base_name = target_column
                    counter = 1
                    suggested_name = f"{base_name}_{counter}"
                    while suggested_name in all_existing_columns:
                        counter += 1
                        suggested_name = f"{base_name}_{counter}"
                    
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': target_column,
                        'conflicting_column': target_column,
                        'conflict_type': 'existing_column',
                        'suggested_name': suggested_name,
                        'message': f'Column already exists, using numbered variant'
                    })
                    
                    suggestions[target_column] = suggested_name
                    all_existing_columns.add(suggested_name)  # Reserve this name
        
        return Response({
            'success': True,
            'conflicts': conflicts,
            'suggestions': suggestions,
            'existing_columns': list(all_existing_columns),
            'has_conflicts': len(conflicts) > 0
        })
        
    except Exception as e:
        logger.error(f"Error checking column conflicts: {e}")
        return Response({
            'success': False,
            'error': f'Failed to check conflicts: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def clear_formulas(request):
    """Clear all formula rules and remove generated columns from session data."""
    try:
        session_id = request.data.get('session_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        
        # Track what we're removing for user feedback
        cleared_items = []
        
        # Check if there are formula rules to clear
        if info.get("formula_rules"):
            cleared_items.append(f"{len(info['formula_rules'])} formula rules")
            # Clear formula rules
            SESSION_STORE[session_id]["formula_rules"] = []
        
        # Check if there's enhanced data to clear
        if info.get("formula_enhanced_data"):
            cleared_items.append("formula-generated data")
            # Clear formula-enhanced data
            SESSION_STORE[session_id]["formula_enhanced_data"] = None
        
        # Check if there are enhanced headers to clear
        if info.get("enhanced_headers"):
            original_headers = info.get("enhanced_headers", [])
            mappings = info.get("mappings", {})
            
            # Handle different mapping formats
            if isinstance(mappings, list):
                # List format: [{'source': 'A', 'target': 'B'}, ...]
                template_columns = [m.get('target', '') for m in mappings if isinstance(m, dict)]
            elif isinstance(mappings, dict):
                template_columns = list(mappings.keys())
            else:
                template_columns = []
            
            # Find formula-generated columns (columns not in original mappings)
            formula_columns = [h for h in original_headers if h not in template_columns]
            if formula_columns:
                cleared_items.append(f"{len(formula_columns)} generated columns")
            
            # Clear enhanced headers
            SESSION_STORE[session_id]["enhanced_headers"] = None
        
        # If no formulas were found to clear
        if not cleared_items:
            return Response({
                'success': True,
                'message': 'No formulas or generated columns found to clear',
                'cleared_items': []
            })
        
        # Log the clearing action
        logger.info(f"Cleared formulas for session {session_id}: {', '.join(cleared_items)}")
        
        return Response({
            'success': True,
            'message': f'Successfully cleared: {", ".join(cleared_items)}',
            'cleared_items': cleared_items
        })
        
    except Exception as e:
        logger.error(f"Error clearing formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to clear formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==============================================
# SAVED COLUMN RULE VIEWS
# ==============================================

@api_view(['GET', 'POST'])
def column_rules(request):
    """List saved column rules, or save a new one.

    The POST body carries `rule` verbatim — the same object the Fill/Create
    Column dialog sends to fill_or_create_column — so a saved rule can be
    replayed against any session without translation.
    """
    if request.method == 'GET':
        rules = ColumnRule.objects.all()
        return Response({
            'success': True,
            'rules': [r.get_summary() for r in rules],
            'total': rules.count(),
        })

    name = str(request.data.get('name') or '').strip()
    rule = request.data.get('rule') or {}
    if not name:
        return Response({'success': False, 'error': 'A name is required'},
                        status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(rule, dict) or not rule.get('value_mode'):
        return Response({'success': False, 'error': 'A rule with a value_mode is required'},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        # Saving the same name again replaces it — the Settings screen edits in
        # place rather than accumulating near-duplicates.
        saved, created = ColumnRule.objects.update_or_create(
            name=name,
            defaults={
                'description': str(request.data.get('description') or ''),
                'rule': rule,
            },
        )
        return Response({'success': True, 'created': created, 'rule': saved.get_summary()})
    except Exception as e:
        logger.error(f"Error saving column rule: {e}")
        return Response({'success': False, 'error': f'Failed to save rule: {str(e)}'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def column_rule_detail(request, rule_id):
    """Delete a saved column rule."""
    try:
        ColumnRule.objects.filter(id=rule_id).delete()
        return Response({'success': True})
    except Exception as e:
        logger.error(f"Error deleting column rule {rule_id}: {e}")
        return Response({'success': False, 'error': f'Failed to delete rule: {str(e)}'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==============================================
# TAG TEMPLATE VIEWS
# ==============================================

@api_view(['POST'])
def save_tag_template(request):
    """Save a new tag template with formula rules."""
    try:
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        formula_rules = request.data.get('formula_rules', [])
        
        if not template_name:
            return Response({
                'success': False,
                'error': 'Template name is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'Formula rules are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if template name already exists
        if TagTemplate.objects.filter(name=template_name).exists():
            return Response({
                'success': False,
                'error': f'Template "{template_name}" already exists'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create new tag template
        tag_template = TagTemplate.objects.create(
            name=template_name,
            description=description,
            formula_rules=formula_rules
        )
        
        logger.info(f"Created tag template: {template_name} with {len(formula_rules)} rules")
        
        return Response({
            'success': True,
            'template_id': tag_template.id,
            'message': f'Tag template "{template_name}" saved successfully',
            'template': tag_template.get_template_summary()
        })
        
    except Exception as e:
        logger.error(f"Error saving tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_tag_templates(request):
    """Get all saved tag templates."""
    try:
        templates = TagTemplate.objects.all()
        template_data = [template.get_template_summary() for template in templates]
        
        return Response({
            'success': True,
            'templates': template_data,
            'total_templates': len(template_data)
        })
        
    except Exception as e:
        logger.error(f"Error getting tag templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get tag templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def delete_tag_template(request, template_id):
    """Delete a tag template."""
    try:
        template = TagTemplate.objects.get(id=template_id)
        template_name = template.name
        template.delete()
        
        logger.info(f"Deleted tag template: {template_name}")
        
        return Response({
            'success': True,
            'message': f'Tag template "{template_name}" deleted successfully'
        })
        
    except TagTemplate.DoesNotExist:
        return Response({
            'success': False,
            'error': 'Tag template not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error deleting tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to delete tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def apply_tag_template(request, template_id):
    """Get formula rules from a tag template for application."""
    try:
        template = TagTemplate.objects.get(id=template_id)
        
        # Increment usage count
        template.increment_usage()
        
        logger.info(f"Applied tag template: {template.name}")
        
        # Externalize internal target names for UI clarity
        try:
            rules_ext = _externalize_formula_rules(template.formula_rules, None)
        except Exception:
            rules_ext = template.formula_rules
        return Response({
            'success': True,
            'template_name': template.name,
            'formula_rules': rules_ext,
            'message': f'Tag template "{template.name}" applied successfully'
        })
        
    except TagTemplate.DoesNotExist:
        return Response({
            'success': False,
            'error': 'Tag template not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error applying tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to apply tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def create_factwise_id(request):
    """Create a Factwise ID by combining two existing columns and map it to 'Item code'.
    Supports strategy: 'fill_only_null' (default) or 'override_all'. Treats variants of Item code as same.
    """
    try:
        session_id = request.data.get('session_id')
        first_column = request.data.get('first_column')
        second_column = request.data.get('second_column')
        operator = request.data.get('operator', '_')
        strategy = request.data.get('strategy', 'fill_only_null')
        generation_mode = request.data.get('generation_mode', 'columns')
        serial_prefix = request.data.get('serial_prefix', '')
        serial_start = request.data.get('serial_start', 1)
        serial_padding = request.data.get('serial_padding', 0)
        serial_increment = request.data.get('serial_increment', True)
        
        info = get_session_consistent(session_id)
        if not session_id or not info:
            return no_store(Response({'success': False, 'error': 'Invalid session'}, status=400))
        
        if generation_mode == 'serial':
            first_column = first_column or ''
            second_column = second_column or ''
        elif not first_column or not second_column:
            return no_store(Response({
                'success': False,
                'error': 'Both first_column and second_column are required'
            }, status=400))
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found for this session'
            }, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"🆔 Creating Factwise ID: {first_column} {operator} {second_column}")
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
        else:
            formatted_mappings = mappings
        
        def normalize_current_dataset(raw_data, raw_headers):
            if not raw_data or not raw_headers or not isinstance(raw_headers, list):
                return None, None
            headers_list = list(raw_headers)
            data_list = raw_data.get('data') if isinstance(raw_data, dict) and 'data' in raw_data else raw_data
            if not isinstance(data_list, list) or not data_list:
                return headers_list, []
            if isinstance(data_list[0], dict):
                normalized_rows = []
                for row in data_list:
                    normalized_rows.append([row.get(h, "") for h in headers_list])
                return headers_list, normalized_rows
            return headers_list, data_list

        # Get the current data - prefer edited/enhanced/session data so default values,
        # MPN splits, formulas, and prior grid edits are preserved when recomputing Item code.
        headers = None
        data_rows = None

        current_sources = [
            (info.get("edited_data"), info.get("enhanced_headers") or info.get("current_template_headers")),
            (info.get("enhanced_data"), None),
            (info.get("formula_enhanced_data"), info.get("enhanced_headers")),
            (info.get("mapped_data"), info.get("mapped_headers")),
        ]

        for raw_data, raw_headers in current_sources:
            if isinstance(raw_data, dict):
                raw_headers = raw_data.get('headers') or raw_headers
            candidate_headers, candidate_rows = normalize_current_dataset(raw_data, raw_headers)
            if candidate_headers and candidate_rows is not None:
                headers = candidate_headers
                data_rows = candidate_rows
                break

        if headers is not None and data_rows is not None:
            logger.info(f"🆔 Using current session data for Factwise ID: {len(headers)} headers, {len(data_rows)} rows")
        else:
            # Fall back to fresh mapped data if no enhanced data exists
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=formatted_mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            
            if not mapping_result or not mapping_result.get('data'):
                return Response({
                    'success': False,
                    'error': 'No data available for processing'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            headers = mapping_result['headers']
            data_rows = mapping_result['data']

        # Apply stored default values before creating Factwise IDs. This keeps
        # defaulted Tag/spec fields usable as Factwise inputs even if the grid
        # has not been explicitly saved as edited rows.
        default_values = info.get("default_values", {}) or {}
        if default_values and headers and data_rows:
            header_index = {h: i for i, h in enumerate(headers)}
            slot_index = {slot_key: i for i, slot_key in enumerate(get_sfo_slot_keys(headers))}
            for field_name, default_value in default_values.items():
                field_idx = slot_index.get(field_name, header_index.get(field_name))
                if field_idx is None or default_value is None or str(default_value).strip() == "":
                    continue
                for row in data_rows:
                    while len(row) <= field_idx:
                        row.append("")
                    if row[field_idx] is None or str(row[field_idx]).strip() == "":
                        row[field_idx] = str(default_value).strip()
        
        # Helper function to convert external names to internal names
        def convert_external_to_internal_name(external_name):
            """Convert external display names to internal column names."""
            external_name_lower = external_name.lower().strip()
            
            # Handle Custom identification name variations
            if external_name_lower in ['custom identification name', 'custom identification name']:
                # Find the first available Custom_Identification_Name_* column
                for header in headers:
                    if header.startswith('Custom_Identification_Name_'):
                        return header
                return None
            
            # Handle Custom identification value variations
            elif external_name_lower in ['custom identification value', 'custom identification value']:
                # Find the first available Custom_Identification_Value_* column
                for header in headers:
                    if header.startswith('Custom_Identification_Value_'):
                        return header
                return None
            
            # Handle Specification name variations
            elif external_name_lower in ['specification name']:
                # Find the first available Specification_Name_* column
                for header in headers:
                    if header.startswith('Specification_Name_'):
                        return header
                return None
            
            # Handle Specification value variations
            elif external_name_lower in ['specification value']:
                # Find the first available Specification_Value_* column
                for header in headers:
                    if header.startswith('Specification_Value_'):
                        return header
                return None
            
            # Handle Procurement entity name variations
            elif external_name_lower in ['procurement entity name']:
                # Look for exact match first, then try variations
                for header in headers:
                    if header.lower() == external_name_lower:
                        return header
                # If not found, return None
                return None
            
            # For other columns, try exact match first
            for header in headers:
                if header.lower() == external_name_lower:
                    return header
            
            # If no exact match, return the original name (might be a regular column)
            return external_name
        
        first_col_idx = -1
        second_col_idx = -1
        if generation_mode != 'serial':
            # Convert external names to internal names
            first_column_internal = convert_external_to_internal_name(first_column)
            second_column_internal = convert_external_to_internal_name(second_column)

            logger.info(f"  First column: '{first_column}' -> '{first_column_internal}'")
            logger.info(f"  Second column: '{second_column}' -> '{second_column_internal}'")
            logger.info(f"  Available headers: {headers}")

            # Find column indices using internal names
            for i, header in enumerate(headers):
                if header == first_column_internal:
                    first_col_idx = i
                elif header == second_column_internal:
                    second_col_idx = i
            
            if first_col_idx == -1 or second_col_idx == -1:
                missing_columns = []
                if first_col_idx == -1:
                    missing_columns.append(first_column)
                if second_col_idx == -1:
                    missing_columns.append(second_column)

                return Response({
                    'success': False,
                    'error': f'Columns not found: {", ".join(missing_columns)}'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create Factwise ID values
        factwise_id_column = []
        if generation_mode == 'serial':
            try:
                start_number = int(serial_start)
            except Exception:
                start_number = 1
            try:
                padding = max(0, int(serial_padding))
            except Exception:
                padding = 0
            increment_each_row = str(serial_increment).lower() not in ['false', '0', 'no', 'off']
            for row_index, _row in enumerate(data_rows):
                current_number = start_number + row_index if increment_each_row else start_number
                suffix = str(current_number).zfill(padding) if padding > 0 else str(current_number)
                factwise_id_column.append(f"{serial_prefix or ''}{suffix}")
        else:
            for row in data_rows:
                first_val = str(row[first_col_idx]) if first_col_idx < len(row) and row[first_col_idx] is not None else ""
                second_val = str(row[second_col_idx]) if second_col_idx < len(row) and row[second_col_idx] is not None else ""

                if first_val and second_val:
                    factwise_id = f"{first_val}{operator}{second_val}"
                elif first_val:
                    factwise_id = first_val
                elif second_val:
                    factwise_id = second_val
                else:
                    factwise_id = ""

                factwise_id_column.append(factwise_id)

        # Helper to normalize header names
        def norm(s: str) -> str:
            return str(s).strip().lower().replace(' ', '').replace('_', '').replace('-', '')

        # Map Factwise ID into 'Item code' (create if missing). Treat Item code variants as same.
        item_idx = None
        new_headers = list(headers)
        for i, h in enumerate(new_headers):
            if norm(h) == norm('item code'):
                item_idx = i
                new_headers[i] = 'Item code'
                break

        new_data_rows = []
        if item_idx is None:
            new_headers = ['Item code'] + new_headers
            for i, row in enumerate(data_rows):
                new_row = [factwise_id_column[i]] + list(row)
                new_data_rows.append(new_row)
        else:
            for i, row in enumerate(data_rows):
                new_row = list(row)
                while len(new_row) < len(new_headers):
                    new_row.append("")
                if strategy == 'override_all':
                    new_row[item_idx] = factwise_id_column[i]
                else:  # fill only null/empty
                    current_val = new_row[item_idx]
                    if current_val is None or str(current_val).strip() == "":
                        new_row[item_idx] = factwise_id_column[i]
                new_data_rows.append(new_row)

        new_row_dicts = [
            {header: (row[idx] if idx < len(row) else "") for idx, header in enumerate(new_headers)}
            for row in new_data_rows
        ]
        
        # Store Factwise ID rule for template saving and reuse
        factwise_id_rule = {
            "type": "factwise_id",
            "first_column": first_column,
            "second_column": second_column,
            "operator": operator,
            "strategy": strategy,
            "generation_mode": generation_mode,
            "serial_prefix": serial_prefix,
            "serial_start": serial_start,
            "serial_padding": serial_padding,
            "serial_increment": serial_increment
        }
        
        # Update session headers for immediate UI reflect
        # Avoid persisting full data for large datasets; data pages are recomputed on demand
        SMALL_DATA_THRESHOLD = 2000
        if len(new_data_rows) <= SMALL_DATA_THRESHOLD:
            info["formula_enhanced_data"] = new_data_rows
        else:
            # Ensure any previous large cache is cleared
            info.pop("formula_enhanced_data", None)
        info["enhanced_headers"] = new_headers
        if info.get("edited_data"):
            info["edited_data"] = new_row_dicts
        if isinstance(info.get("enhanced_data"), dict) and info["enhanced_data"].get("data"):
            info["enhanced_data"] = {
                **info["enhanced_data"],
                "headers": new_headers,
                "data": new_data_rows,
            }
        # Persist canonical headers to avoid alternating states across requests
        try:
            info["current_template_headers"] = new_headers
        except Exception:
            pass
            
        debug_log(session_id, "Updated session with Factwise ID data", {
            'new_headers_count': len(new_headers),
            'new_data_rows_count': len(new_data_rows),
            'factwise_id_rule': factwise_id_rule
        })
        
        # Initialize factwise_rules if not exists
        if "factwise_rules" not in info:
            info["factwise_rules"] = []
        
        # Add or update the Factwise ID rule (only keep one), using internal column names
        info["factwise_rules"] = [rule for rule in info.get("factwise_rules", []) if rule.get("type") != "factwise_id"]
        info["factwise_rules"].append(factwise_id_rule)
        
        # CRITICAL FIX: Ensure session is fully saved before returning response
        # This prevents the race condition where frontend fetches stale data
        debug_log(session_id, "Saving session before returning Factwise ID response", {
            'session_keys': list(info.keys()),
            'has_formula_enhanced_data': 'formula_enhanced_data' in info,
            'has_enhanced_headers': 'enhanced_headers' in info
        })
        
        # Force immediate session save to prevent race conditions
        try:
            save_session(session_id, info)
            # Verify session was saved by checking if it's accessible
            if session_id in SESSION_STORE:
                debug_log(session_id, "Session saved successfully", {
                    'session_keys_after_save': list(SESSION_STORE[session_id].keys()),
                    'data_persisted': 'formula_enhanced_data' in SESSION_STORE[session_id]
                })
            else:
                debug_log(session_id, "WARNING: Session not found after save", level='warning')
        except Exception as save_error:
            debug_log(session_id, f"Error saving session: {save_error}", level='error')
            # Continue anyway, but log the error
        
        # Save all updated data and headers before version bump
        if len(new_data_rows) <= SMALL_DATA_THRESHOLD:
            info["formula_enhanced_data"] = new_data_rows
        else:
            info.pop("formula_enhanced_data", None)
        info["enhanced_headers"] = new_headers
        if info.get("edited_data"):
            info["edited_data"] = new_row_dicts
        if isinstance(info.get("enhanced_data"), dict) and info["enhanced_data"].get("data"):
            info["enhanced_data"] = {
                **info["enhanced_data"],
                "headers": new_headers,
                "data": new_data_rows,
            }
        info["current_template_headers"] = new_headers
        save_session(session_id, info)
        
        # Atomic version bump AFTER all data is saved
        new_version = increment_template_version(session_id)
        
        logger.info(f"🆔 Successfully created Factwise ID mapped into 'Item code' with {len(factwise_id_column)} entries (strategy={strategy})")
        
        return no_store(Response({
            'success': True,
            'template_version': new_version,
            'enhanced_headers': new_headers,
            'rows': len(new_data_rows),
            'message': 'Factwise ID created and mapped to Item code'
        }))
        
    except Exception as e:
        logger.error(f"Error creating Factwise ID: {e}")
        return no_store(Response({
            'success': False,
            'error': f'Failed to create Factwise ID: {str(e)}'
        }, status=500))


def _latest_pdf_extraction_for_session(session_id):
    """Return the most recent extraction record for a PDF-backed session, if any."""
    try:
        pdf_session = PDFSession.objects.get(session_id=session_id)
        return PDFExtractionResult.objects.filter(pdf_session=pdf_session).order_by('-created_at').first()
    except Exception:
        return None


def _cell_text(value):
    """Normalize a source cell to a trimmed string."""
    if value is None:
        return ''
    try:
        if pd.isna(value):
            return ''
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def read_session_source(session_id, info):
    """
    Read the current source table for a session.

    Returns (headers, rows, extraction) where rows are dicts keyed by header and
    extraction is the PDFExtractionResult backing the session, or None for
    spreadsheet sessions.
    """
    extraction = _latest_pdf_extraction_for_session(session_id)
    if extraction and extraction.extracted_headers:
        headers = [str(h) for h in extraction.extracted_headers]
        rows = []
        for raw_row in (extraction.extracted_data or []):
            if isinstance(raw_row, dict):
                rows.append({h: _cell_text(raw_row.get(h)) for h in headers})
            else:
                rows.append({h: _cell_text(raw_row[i] if i < len(raw_row) else '') for i, h in enumerate(headers)})
        return headers, rows, extraction

    client_path = hybrid_file_manager.get_file_path(info.get('client_path'))
    header_row = (info.get('header_row', 1) or 1) - 1
    if str(client_path).lower().endswith('.csv'):
        df = read_csv_with_encoding(client_path, header_row, dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(client_path, sheet_name=info.get('sheet_name'), header=header_row, dtype=str)

    headers = [str(c).strip() for c in df.columns]
    rows = [
        {header: _cell_text(value) for header, value in zip(headers, record)}
        for record in df.values.tolist()
    ]
    return headers, rows, extraction


def write_session_source(session_id, info, headers, rows, extraction=None):
    """Persist a rewritten source table so mapping and header endpoints see the new shape."""
    table = [[row.get(header, '') for header in headers] for row in rows]

    if extraction is not None:
        extraction.extracted_headers = headers
        extraction.extracted_data = table
        extraction.save(update_fields=['extracted_headers', 'extracted_data'])

        # PDF client CSVs are written without a header row; the mapping layer
        # re-attaches headers from the extraction record.
        csv_path = hybrid_file_manager.get_file_path(info.get('client_path'))
        pd.DataFrame(table).to_csv(str(csv_path), index=False, header=False)
        info['client_headers'] = headers
        return str(csv_path)

    target_dir = Path(hybrid_file_manager.local_temp_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    csv_path = target_dir / f"source_expanded_{session_id}.csv"
    pd.DataFrame(table, columns=headers).to_csv(str(csv_path), index=False)

    info['client_path'] = str(csv_path)
    info['sheet_name'] = None
    info['header_row'] = 1
    info['client_headers'] = headers
    return str(csv_path)


def _apply_editor_defaults_for_session(headers, rows, info):
    entity_name = str((info or {}).get('editor_defaults_entity_name') or (info or {}).get('entity_name') or '').strip()
    if not entity_name:
        return headers, rows
    settings_obj = get_editor_defaults_for_entity(entity_name)
    if not settings_obj:
        return headers, rows
    output_rows, summary = apply_editor_defaults_to_rows(
        headers, rows, settings_obj,
        locked_codes=locked_identity_codes(info, headers, rows),
    )
    if isinstance(info, dict):
        info['editor_defaults_last_applied'] = summary
    return headers, output_rows


def _reshape_grid_snapshot(snapshot, new_headers):
    """Re-key one stored grid onto `new_headers`, keeping values by position.

    Slots are matched by their unique field name (Tag_1, Specification_Value_2),
    so a column keeps its data wherever it lands in the new order and a newly
    added slot arrives empty.
    """
    if not isinstance(snapshot, dict):
        return None
    old_headers = list(snapshot.get('headers') or [])
    rows = snapshot.get('data')
    if not old_headers or rows is None:
        return None

    old_fields = make_unique_field_headers(old_headers)
    new_fields = make_unique_field_headers(new_headers)
    position_of = {field: index for index, field in enumerate(old_fields)}

    reshaped = []
    for row in rows:
        if isinstance(row, dict):
            values = [row.get(header, '') for header in old_headers]
        else:
            values = list(row)
        reshaped.append([
            (values[position_of[field]] if field in position_of and position_of[field] < len(values) else '')
            for field in new_fields
        ])
    return {'headers': list(new_headers), 'data': reshaped}


def read_session_grid(session_id, info):
    """
    Read the mapped grid the review screen shows: destination headers and rows.

    Rows stay as lists because the grid may legitimately repeat a header (several
    source columns can map onto the same template column), so keying by name
    would silently merge those columns.

    Prefers snapshots later steps have already written, so transforms chain.
    """
    def _as_lists(headers, data):
        # Rows may be stored as lists (positional) OR dicts (keyed by header),
        # depending on which transform last wrote them. For dicts, pull values BY
        # HEADER NAME — never list(dict), which yields the KEYS (header names) and
        # made every grid op see "MPN Code" as the value of every cell.
        out = []
        for row in (data or []):
            if isinstance(row, dict):
                out.append([row.get(h, '') for h in headers])
            else:
                out.append(list(row))
        return out

    for key in ('edited_data', 'enhanced_data'):
        snapshot = info.get(key)
        if isinstance(snapshot, dict) and snapshot.get('headers') and snapshot.get('data'):
            hdrs = list(snapshot['headers'])
            rows = _as_lists(hdrs, snapshot['data'])
            return _apply_editor_defaults_for_session(hdrs, rows, info)

    # Formula/tag operations store their latest full-grid result separately.
    # Prefer it over rebuilding the basic mapping so later column operations
    # compose with, rather than erase, those generated values.
    formula_data = info.get('formula_enhanced_data')
    formula_headers = info.get('enhanced_headers')
    if isinstance(formula_data, list) and formula_headers:
        hdrs = list(formula_headers)
        rows = _as_lists(hdrs, formula_data)
        return _apply_editor_defaults_for_session(hdrs, rows, info)

    mapping = info.get('mappings')
    if not mapping:
        return None, None

    result = apply_column_mappings(
        client_file=info['client_path'],
        mappings=mapping if isinstance(mapping, dict) else {'mappings': mapping},
        sheet_name=info.get('sheet_name'),
        header_row=info['header_row'] - 1 if info.get('header_row', 1) > 0 else 0,
        session_id=session_id
    )
    hdrs = list(result.get('headers') or [])
    rows = _as_lists(hdrs, result.get('data'))
    return _apply_editor_defaults_for_session(hdrs, rows, info)


def write_session_grid(session_id, info, headers, rows):
    """Persist a rewritten grid, matching how the other review-screen tools save."""
    snapshot = {'headers': list(headers), 'data': [list(row) for row in rows]}
    info['enhanced_data'] = snapshot
    info['edited_data'] = snapshot
    info['enhanced_headers'] = list(headers)
    info['current_template_headers'] = list(headers)
    return snapshot


def _grid_column_index(headers, field_name):
    """Resolve either a displayed header or a unique editor field such as Tag_2."""
    field_name = str(field_name or '').strip()
    if not field_name:
        return -1
    unique_fields = make_unique_field_headers(headers or [])
    if field_name in unique_fields:
        return unique_fields.index(field_name)
    if field_name in (headers or []):
        return list(headers).index(field_name)
    return -1


def _legacy_factwise_id_as_column_rule(rule):
    """Keep older saved templates working through the unified column-rule engine."""
    if not isinstance(rule, dict) or rule.get('type') != 'factwise_id':
        return None
    generation_mode = rule.get('generation_mode', 'columns')
    return {
        'type': 'column_value',
        'target_mode': 'new',
        'target_column': 'Item code',
        'value_mode': 'serial' if generation_mode == 'serial' else 'join',
        'source_columns': [rule.get('first_column'), rule.get('second_column')],
        'separator': rule.get('operator', '_'),
        'write_mode': 'overwrite' if rule.get('strategy') == 'override_all' else 'fill_empty',
        'serial_prefix': rule.get('serial_prefix', ''),
        'serial_start': rule.get('serial_start', 1),
        'serial_padding': rule.get('serial_padding', 0),
        'serial_increment': rule.get('serial_increment', True),
    }


# A finished good authored in the BOM structure gate is not an ordinary row: its
# code, name, type and unit came from the user answering a question, not from the
# uploaded sheet. Bulk fills must leave those alone, or "set every Item type to
# Raw material" quietly turns the finished good into a raw material.
#
# Everything else — buyer/seller flags, procurement entity, tags, specs — is
# still filled normally, so the row stays consistent with the rest of the sheet.
def locked_identity_codes(info, headers, rows):
    """Item codes whose identity columns no bulk write may touch.

    The authored finished good and every row answered as a sub-BOM in the
    structure gate. A sub-assembly's item code is what its children point at,
    so renumbering it silently re-points the tree; its Item type is what makes
    it an assembly rather than a purchased part.

    Every path that writes these columns resolves the set here, so a row is not
    protected in the Fill dialog and wide open to the Settings defaults.
    """
    codes = [good['code'] for good in _authored_finished_goods(info)]
    codes.extend(_sub_assembly_codes_from_grid(info, headers, rows))
    return {str(code).strip() for code in codes if str(code).strip()}


AUTHORED_FINISHED_GOOD_LOCKED_COLUMNS = {
    'item code', 'item name', 'description', 'item type', 'measurement unit',
}


def apply_column_value_rule(headers, rows, raw_rule, locked_item_codes=None):
    """Apply one reusable fill/create rule to a positional grid.

    ``locked_item_codes`` names rows whose identity columns must not be touched
    (see AUTHORED_FINISHED_GOOD_LOCKED_COLUMNS).
    """
    rule = _legacy_factwise_id_as_column_rule(raw_rule) or dict(raw_rule or {})
    if rule.get('type') != 'column_value':
        return list(headers or []), [list(row) for row in (rows or [])], 0

    output_headers = list(headers or [])
    output_rows = [list(row) for row in (rows or [])]
    target = str(rule.get('target_column') or '').strip()
    if not target:
        raise ValueError('Target column is required')

    target_index = _grid_column_index(output_headers, target)
    target_mode = str(rule.get('target_mode') or 'existing')
    if target_index < 0:
        if target_mode != 'new':
            raise ValueError(f'Column "{target}" is not in the grid')
        output_headers.append(target)
        target_index = len(output_headers) - 1
        for row in output_rows:
            row.append('')

    value_mode = str(rule.get('value_mode') or 'fixed')
    # The editor historically called this mode "concat" while reusable rules
    # use "join". Accept both so current requests and older templates compose.
    if value_mode == 'concat':
        value_mode = 'join'
    source_columns = [str(value or '').strip() for value in (rule.get('source_columns') or []) if str(value or '').strip()]
    source_indexes = [_grid_column_index(output_headers, source) for source in source_columns]
    if value_mode in {'copy', 'join'} and (not source_indexes or any(index < 0 for index in source_indexes)):
        missing = [source for source, index in zip(source_columns, source_indexes) if index < 0]
        raise ValueError(f'Source column not found: {", ".join(missing) or "select a source column"}')

    condition = rule.get('condition') if isinstance(rule.get('condition'), dict) else None
    prepared_branches = []
    else_source_index = -1
    if value_mode == 'conditional':
        raw_branches = (condition or {}).get('branches')
        if not isinstance(raw_branches, list) or not raw_branches:
            # Backward compatibility for previously saved single if/else rules.
            raw_branches = [{
                'column': (condition or {}).get('column'),
                'operator': (condition or {}).get('operator'),
                'compare': (condition or {}).get('compare'),
                'output_value': (condition or {}).get('then'),
                'output_source_column': (condition or {}).get('then_source_column'),
            }]

        for branch in raw_branches:
            branch = branch if isinstance(branch, dict) else {}
            condition_column = str(branch.get('column') or '').strip()
            condition_index = _grid_column_index(output_headers, condition_column)
            if condition_index < 0:
                raise ValueError(f'Condition column "{condition_column}" is not in the grid')
            output_source_column = str(branch.get('output_source_column') or '').strip()
            output_source_index = -1
            if output_source_column:
                output_source_index = _grid_column_index(output_headers, output_source_column)
                if output_source_index < 0:
                    raise ValueError(f'Condition output column "{output_source_column}" is not in the grid')
            # Several values mean "any of these" and MUST stay a list -
            # condition_matches below is built for that shape. Flattening it with
            # str() produced the literal text "['asd', 'asdfaf']", so a contains
            # test looked for those brackets inside the cell and never matched.
            raw_compare = branch.get('compare')
            if isinstance(raw_compare, (list, tuple)):
                compare_value = [str(value) for value in raw_compare]
            else:
                compare_value = str(raw_compare or '')

            prepared_branches.append({
                'condition_index': condition_index,
                'operator': str(branch.get('operator') or 'is_empty'),
                'compare': compare_value,
                'output_value': '' if branch.get('output_value') is None else str(branch.get('output_value')),
                'output_source_index': output_source_index,
            })

        else_source_column = str((condition or {}).get('else_source_column') or '').strip()
        if else_source_column:
            else_source_index = _grid_column_index(output_headers, else_source_column)
            if else_source_index < 0:
                raise ValueError(f'Otherwise-value column "{else_source_column}" is not in the grid')

    try:
        serial_start = int(rule.get('serial_start', 1))
    except (TypeError, ValueError):
        serial_start = 1
    try:
        serial_padding = max(0, int(rule.get('serial_padding', 0)))
    except (TypeError, ValueError):
        serial_padding = 0
    serial_increment = str(rule.get('serial_increment', True)).lower() not in {'false', '0', 'no', 'off'}
    write_mode = str(rule.get('write_mode') or 'fill_empty')
    changed = 0

    def condition_matches(cell, branch):
        value = str(cell or '').strip()
        lowered = value.lower()
        operator = branch['operator']

        # A branch may carry several values, matched as "any of these". They are
        # kept as a list rather than split from a comma-joined string because
        # component descriptions are full of commas ("CAPACITOR 0.22U, 10V",
        # "CAP; 0,1uF"), so splitting one would quietly match far more than the
        # user meant.
        raw_compare = branch.get('compare')
        if isinstance(raw_compare, (list, tuple)):
            compares = [str(v).strip().lower() for v in raw_compare if str(v).strip()]
        else:
            single = str(raw_compare or '').strip().lower()
            compares = [single] if single else ['']

        if operator == 'is_empty':
            return value == ''
        # 'is_not_empty' is what the Settings rule builder used to send; an
        # unknown operator falls through to False, so those rules matched
        # nothing at all. Accepted as an alias rather than dropped, so rules
        # already saved with it start working instead of staying dead.
        if operator in ('not_empty', 'is_not_empty'):
            return value != ''
        if operator == 'equals':
            return any(lowered == c for c in compares)
        if operator == 'not_equals':
            # "not any of them" — a row matching any listed value is excluded.
            return all(lowered != c for c in compares)
        if operator == 'contains':
            return any(c in lowered for c in compares)
        # Offered by the rule builder since it shipped, but never implemented
        # here, so both silently matched nothing.
        if operator == 'starts_with':
            return any(lowered.startswith(c) for c in compares)
        if operator == 'ends_with':
            return any(lowered.endswith(c) for c in compares)
        return False

    # Resolve the lock once: which rows are protected, for this target column.
    target_is_locked = _template_label_key(target) in AUTHORED_FINISHED_GOOD_LOCKED_COLUMNS
    locked_codes = {str(code).strip() for code in (locked_item_codes or []) if str(code).strip()}
    item_code_index = _grid_column_index(output_headers, 'Item code') if (target_is_locked and locked_codes) else -1

    # "duplicates" writes only to rows repeating a value already seen above them,
    # so the first row keeping each value is left alone and the repeats are given
    # something new. Rewriting every copy — including the first — would discard
    # the original value entirely, which is never what "fix the duplicates" means.
    duplicate_rows = set()
    if write_mode == 'duplicates':
        seen_values = set()
        for row_index, row in enumerate(output_rows):
            value = str(row[target_index] or '').strip() if target_index < len(row) else ''
            if not value:
                continue
            if value in seen_values:
                duplicate_rows.add(row_index)
            else:
                seen_values.add(value)

    # A generated serial must not collide with a value the rule is leaving in
    # place. `fill_empty` on a sheet already holding '003' used to generate '003'
    # for another row, so the tool meant to fix blank item codes handed back a
    # sheet failing `item_code_duplicate` instead - and duplicate item codes make
    # every BOM reference to them ambiguous.
    #
    # Only the values that SURVIVE this pass are reserved: under `overwrite`
    # nothing survives, so the sequence stays exactly as before.
    reserved_values = set()
    if value_mode == 'serial':
        for row_index, row in enumerate(output_rows):
            if write_mode == 'duplicates':
                rewritten = row_index in duplicate_rows
            elif write_mode == 'overwrite':
                rewritten = True
            else:
                rewritten = not str(row[target_index] or '').strip() if target_index < len(row) else True
            if not rewritten and target_index < len(row):
                value = str(row[target_index] or '').strip()
                if value:
                    reserved_values.add(value)

    for row_index, row in enumerate(output_rows):
        while len(row) < len(output_headers):
            row.append('')
        if write_mode == 'duplicates':
            if row_index not in duplicate_rows:
                continue
        elif write_mode != 'overwrite' and str(row[target_index] or '').strip():
            continue
        if item_code_index >= 0 and str(row[item_code_index] or '').strip() in locked_codes:
            # Authored finished good: its identity is not the sheet's to rewrite.
            continue

        should_write = True
        if value_mode == 'blank':
            generated = ''
        elif value_mode == 'fixed':
            generated = '' if rule.get('fixed_value') is None else str(rule.get('fixed_value'))
        elif value_mode == 'copy':
            generated = row[source_indexes[0]] if source_indexes else ''
        elif value_mode == 'join':
            values = [str(row[index] or '').strip() for index in source_indexes]
            generated = str(rule.get('separator') or '').join(value for value in values if value)
        elif value_mode == 'serial':
            prefix = rule.get('serial_prefix', '') or ''
            number = serial_start + row_index if serial_increment else serial_start

            def serial_at(value):
                suffix = str(value).zfill(serial_padding) if serial_padding else str(value)
                return f"{prefix}{suffix}"

            generated = serial_at(number)
            # Step past anything already taken. Bounded by the row count so a
            # pathological column cannot spin here.
            if serial_increment:
                limit = number + len(output_rows) + 1
                while generated in reserved_values and number < limit:
                    number += 1
                    generated = serial_at(number)
            reserved_values.add(generated)
        elif value_mode == 'conditional':
            matching_branch = next(
                (branch for branch in prepared_branches if condition_matches(row[branch['condition_index']], branch)),
                None,
            )
            if matching_branch:
                source_index = matching_branch['output_source_index']
                generated = row[source_index] if source_index >= 0 else matching_branch['output_value']
            elif else_source_index >= 0:
                generated = row[else_source_index]
            elif 'else' in (condition or {}):
                generated = '' if (condition or {}).get('else') is None else str((condition or {}).get('else'))
            else:
                should_write = False
                generated = row[target_index]
        else:
            raise ValueError(f'Unsupported column value mode: {value_mode}')

        if should_write and row[target_index] != generated:
            row[target_index] = generated
            changed += 1

    return output_headers, output_rows, changed


@api_view(['POST'])
def fill_or_create_column(request):
    """Fill an existing destination column or create a new reusable column."""
    try:
        session_id = request.data.get('session_id')
        rule = request.data.get('rule')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rule, dict):
            return Response({'success': False, 'error': 'rule required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data found for this session'}, status=status.HTTP_400_BAD_REQUEST)

        clean_rule = dict(rule)
        clean_rule['type'] = 'column_value'
        if clean_rule.get('value_mode') == 'concat':
            clean_rule['value_mode'] = 'join'
        clean_rule['target_column'] = str(clean_rule.get('target_column') or '').strip()
        if clean_rule.get('target_mode') == 'new' and _grid_column_index(headers, clean_rule['target_column']) >= 0:
            return Response({
                'success': False,
                'error': f'Column "{clean_rule["target_column"]}" already exists. Use Fill existing column.',
            }, status=status.HTTP_400_BAD_REQUEST)
        # Rows created by the BOM structure gate keep their own identity, so a
        # bulk fill cannot turn the finished good into a raw material. The same
        # protection covers sub-assemblies: each is the output of its own BOM, so
        # typing it as a raw material would contradict the BOM sheet. Their codes
        # are resolved from the popup's answers by part number, which is cheap —
        # asking generation here would re-derive the whole tree on every fill.
        locked_codes = locked_identity_codes(info, headers, rows)
        new_headers, new_rows, changed = apply_column_value_rule(
            headers, rows, clean_rule, locked_item_codes=locked_codes
        )
        write_session_grid(session_id, info, new_headers, new_rows)

        target = clean_rule['target_column']
        # Filling a column twice is a normal way to work: join MPN + manufacturer
        # first, then copy CPN into whatever that left blank. Both rules matter,
        # and in that order. Dropping every earlier rule for the column threw the
        # first step away, so replaying the template produced a different sheet
        # than the user had made — silently.
        #
        # An overwrite is different: it rewrites the whole column, so anything
        # that ran before it on that column can no longer be observed and is
        # dropped. A fill_empty only completes what came before, so it is kept.
        replaces_column = str(clean_rule.get('write_mode') or '').strip().lower() == 'overwrite'

        def _same_rule(a, b):
            """True when a rule is being re-applied unchanged, ignoring stamps."""
            ignore = {'applied_at'}
            return ({k: v for k, v in (a or {}).items() if k not in ignore}
                    == {k: v for k, v in (b or {}).items() if k not in ignore})

        retained_rules = []
        for existing in info.get('factwise_rules') or []:
            if existing.get('type') == 'column_value' and existing.get('target_column') == target:
                if replaces_column or _same_rule(existing, clean_rule):
                    continue
            if target == 'Item code' and existing.get('type') == 'factwise_id' and replaces_column:
                continue
            retained_rules.append(existing)

        # Stamped so the saved template can replay these in the order they were
        # actually run, rather than in whatever order the save path assembles.
        clean_rule['applied_at'] = timezone.now().isoformat()
        retained_rules.append(clean_rule)
        info['factwise_rules'] = retained_rules
        save_session(session_id, info)
        new_version = increment_template_version(session_id)
        return Response({
            'success': True,
            'changed': changed,
            'headers': new_headers,
            'template_version': new_version,
            'rule': clean_rule,
        })
    except ValueError as exc:
        return Response({'success': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.error(f'fill_or_create_column failed: {exc}', exc_info=True)
        return Response({'success': False, 'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _normalize_group_config(groups, target_fields, source_headers):
    """
    Validate the group configuration and return it as a list of column lists.

    A group is an ordered tuple of source columns that lines up with
    target_fields, so ["Manufacturer", "Manufacturer PartNo"] fills
    ["Manufacturer", "MPN"]. Single-column groups may be given as bare strings.
    """
    if not target_fields:
        raise ValueError('target_fields is required')
    if len(set(target_fields)) != len(target_fields):
        raise ValueError('target_fields must be unique')
    if not groups or len(groups) < 2:
        raise ValueError('At least two column groups are required to expand into rows')

    width = len(target_fields)
    normalized = []
    for position, group in enumerate(groups, start=1):
        columns = [group] if isinstance(group, str) else list(group or [])
        if len(columns) != width:
            raise ValueError(
                f'Group {position} has {len(columns)} column(s) but {width} target field(s) were given'
            )
        missing = [column for column in columns if column not in source_headers]
        if missing:
            raise ValueError(f'Group {position} refers to columns not in the source: {", ".join(missing)}')
        normalized.append(columns)

    seen = {}
    for position, columns in enumerate(normalized, start=1):
        for column in columns:
            if column in seen:
                raise ValueError(f'Column "{column}" is used by both group {seen[column]} and group {position}')
            seen[column] = position

    return normalized


def build_expanded_headers(source_headers, groups, target_fields):
    """
    Lay out the post-expansion headers.

    Grouped columns collapse into the target fields, which take the position of
    the first grouped column so the output keeps the source's column order.
    """
    grouped_columns = {column for group in groups for column in group}
    first_group_index = min(source_headers.index(column) for column in grouped_columns)

    headers = []
    for index, header in enumerate(source_headers):
        if index == first_group_index:
            headers.extend(target_fields)
        if header not in grouped_columns:
            headers.append(header)
    return headers


@api_view(['POST'])
def expand_column_groups(request):
    """
    Fold repeated column groups into rows.

    Columns that mean the same thing often sit side by side on a single source
    row: a manufacturer/MPN pair next to its alternate pair, or an item code
    next to its alternate item codes. This turns each group into its own row and
    copies every other column on that source row down into all of them.

        target_fields: ["Manufacturer", "MPN"]
        groups: [["Manufacturer", "Manufacturer PartNo"],
                 ["Manufacturer S S", "Manufacturer PartNo S S"]]

    Groups can be any width. Four single-column groups turn one row into four.
    Nothing here is tied to a customer, a file, or a particular column name.
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        target_fields = [str(f).strip() for f in (request.data.get('target_fields') or []) if str(f).strip()]
        on_partial = str(request.data.get('on_partial') or 'review')
        if on_partial not in ('review', 'emit', 'skip'):
            on_partial = 'review'
        keep_rows_without_groups = bool(request.data.get('keep_rows_without_groups', False))
        preview = bool(request.data.get('preview', False))
        preview_rows = max(1, min(int(request.data.get('preview_rows') or 20), 200))

        source_headers, source_rows, extraction = read_session_source(session_id, info)
        if not source_headers or not source_rows:
            return Response({
                'success': False,
                'error': 'No source data found for this session'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            groups = _normalize_group_config(request.data.get('groups'), target_fields, source_headers)
        except ValueError as config_error:
            return Response({
                'success': False,
                'error': str(config_error),
                'source_headers': source_headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        grouped_columns = {column for group in groups for column in group}
        carried_columns = [h for h in source_headers if h not in grouped_columns]
        collisions = [f for f in target_fields if f in carried_columns]
        if collisions:
            return Response({
                'success': False,
                'error': f'Target field(s) collide with columns that are kept as-is: {", ".join(collisions)}',
                'source_headers': source_headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        output_headers = build_expanded_headers(source_headers, groups, target_fields)

        expanded_rows = []
        review_rows = []
        empty_groups = 0
        partial_groups = 0
        rows_without_groups = 0

        for row_number, source_row in enumerate(source_rows, start=1):
            carried = {column: source_row.get(column, '') for column in carried_columns}
            emitted_for_row = 0

            for group_index, group in enumerate(groups, start=1):
                values = [source_row.get(column, '') for column in group]
                filled = [value for value in values if value != '']

                if not filled:
                    empty_groups += 1
                    continue

                if len(filled) < len(values):
                    partial_groups += 1
                    blanks = [column for column, value in zip(group, values) if value == '']
                    review_rows.append({
                        'row': row_number,
                        'group': group_index,
                        'reason': f'Incomplete group; no value in {", ".join(blanks)}',
                        'values': dict(zip(group, values)),
                    })
                    if on_partial != 'emit':
                        continue

                output_row = dict(carried)
                output_row.update(dict(zip(target_fields, values)))
                output_row['_source_row'] = row_number
                expanded_rows.append(output_row)
                emitted_for_row += 1

            if emitted_for_row == 0:
                rows_without_groups += 1
                if keep_rows_without_groups:
                    output_row = dict(carried)
                    output_row.update({field: '' for field in target_fields})
                    output_row['_source_row'] = row_number
                    expanded_rows.append(output_row)

        if not expanded_rows:
            return Response({
                'success': False,
                'error': 'No rows were produced. Check the group columns, or allow rows with no filled group.',
                'source_headers': source_headers,
                'review_rows': review_rows[:50],
            }, status=status.HTTP_400_BAD_REQUEST)

        summary = {
            'source_rows': len(source_rows),
            'output_rows': len(expanded_rows),
            'groups': len(groups),
            'empty_groups_skipped': empty_groups,
            'partial_groups': partial_groups,
            'partial_handling': on_partial,
            'rows_without_groups': rows_without_groups,
            'target_fields': target_fields,
        }

        preview_payload = [
            {header: row.get(header, '') for header in output_headers}
            for row in expanded_rows[:preview_rows]
        ]

        if preview:
            return Response({
                'success': True,
                'preview': True,
                'headers': output_headers,
                'data': preview_payload,
                'review_rows': review_rows[:50],
                **summary,
            })

        write_session_source(session_id, info, output_headers, expanded_rows, extraction)

        # The source shape changed, so anything derived from the old columns is stale.
        for derived_key in ('mappings', 'mapped_data', 'edited_data', 'enhanced_data', 'formula_enhanced_data'):
            info.pop(derived_key, None)

        history = list(info.get('source_transforms') or [])
        history.append({
            'type': 'expand_column_groups',
            'applied_at': datetime.utcnow().isoformat(),
            'config': {
                'target_fields': target_fields,
                'groups': groups,
                'on_partial': on_partial,
                'keep_rows_without_groups': keep_rows_without_groups,
            },
            'summary': summary,
        })
        info['source_transforms'] = history
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(
            f"🔁 expand_column_groups on {session_id}: {len(source_rows)} rows -> {len(expanded_rows)} rows "
            f"across {len(groups)} groups"
        )

        return Response({
            'success': True,
            'preview': False,
            'message': f'{len(source_rows)} source rows expanded into {len(expanded_rows)} rows',
            'template_version': new_version,
            'headers': output_headers,
            'data': preview_payload,
            'review_rows': review_rows[:50],
            **summary,
        })
    except Exception as e:
        logger.error(f"expand_column_groups failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Friendly names the UI offers for the usual separators. Anything else the user
# types is used verbatim, so unusual separators still work.
DELIMITER_PRESETS = {
    'comma': ',',
    'semicolon': ';',
    'pipe': '|',
    'newline': '\n',
    'tab': '\t',
    'space': ' ',
    'slash': '/',
}


def resolve_delimiter(value):
    """Turn a preset name or a literal separator into the string to split on."""
    if value is None:
        return ','
    text = str(value)
    key = text.strip().lower()
    if key in DELIMITER_PRESETS:
        return DELIMITER_PRESETS[key]
    # Let callers send escapes like "\n" without sending a real newline.
    text = text.replace('\\n', '\n').replace('\\t', '\t')
    return text or ','


def split_cell_values(value, mode='delimiter', delimiter=',', chunk_size=0, trim=True, drop_empty=True):
    """
    Split one cell into its individual values.

    mode 'delimiter'  splits on a separator, so "C3, C4, C5" gives three values.
    mode 'characters' cuts every chunk_size characters, for fixed-width codes.
    """
    text = _cell_text(value)
    if not text:
        return []

    if mode == 'characters':
        size = max(1, int(chunk_size or 1))
        parts = [text[i:i + size] for i in range(0, len(text), size)]
    else:
        parts = text.split(delimiter)

    if trim:
        parts = [part.strip() for part in parts]
    if drop_empty:
        parts = [part for part in parts if part != '']
    return parts


def _split_tag_slot_into_group(headers, rows, source_index, split_per_row, column_count, keep_source):
    """Replace one Tag cell with adjacent Tag cells at the same position."""
    generated_count = column_count
    replacement_headers = (['Tag'] if keep_source else []) + ['Tag'] * generated_count
    output_headers = list(headers[:source_index]) + replacement_headers + list(headers[source_index + 1:])
    output_rows = []

    for row, values in zip(rows, split_per_row):
        padded = list(row[:len(headers)]) + [''] * max(0, len(headers) - len(row))
        values = list(values[:column_count])
        if keep_source:
            replacement_values = [padded[source_index]] + values
        else:
            replacement_values = values
        expected = len(replacement_headers)
        replacement_values += [''] * (expected - len(replacement_values))
        output_rows.append(
            padded[:source_index] + replacement_values + padded[source_index + 1:]
        )

    return output_headers, output_rows, generated_count


def _split_spec_value_slot_into_group(headers, rows, source_index, split_per_row, column_count, keep_source):
    """Replace one Specification value with adjacent values for the same specification."""
    slot_keys = get_sfo_slot_keys(headers)
    source_key = slot_keys[source_index] if source_index < len(slot_keys) else ''
    if not re.match(r'^Specification_Value_\d+$', source_key):
        return None

    generated_count = column_count
    replacement_headers = (
        ['Specification value'] if keep_source else []
    ) + ['Specification value'] * generated_count
    output_headers = list(headers[:source_index]) + replacement_headers + list(headers[source_index + 1:])
    output_rows = []

    for row, values in zip(rows, split_per_row):
        padded = list(row[:len(headers)]) + [''] * max(0, len(headers) - len(row))
        values = list(values[:column_count])
        if keep_source:
            replacement_values = [padded[source_index]] + values
        else:
            replacement_values = values
        expected = len(replacement_headers)
        replacement_values += [''] * (expected - len(replacement_values))
        output_rows.append(
            padded[:source_index] + replacement_values + padded[source_index + 1:]
        )

    return output_headers, output_rows, generated_count


@api_view(['POST'])
def split_column_into_columns(request):
    """
    Split one column's values into a numbered run of columns.

    A single cell often holds a list: reference designators as "C3, C4, C5", or
    any other packed set. Each value moves into its own column, so with the
    prefix "Tag" that cell becomes Tag_1=C3, Tag_2=C4, Tag_3=C5.

    Splitting is either on a delimiter the user picks once, or every N
    characters for fixed-width codes.

    This runs on the mapped grid, like the other review-screen tools, so the
    column being split is a destination column and mappings are left alone.

    The widest row decides how many columns are produced, capped by max_columns
    when one is given. Nothing here is tied to a particular column or customer.
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        source_column = str(request.data.get('source_column') or '').strip()
        destination_prefix = str(request.data.get('destination_prefix') or '').strip()
        if not source_column:
            return Response({'success': False, 'error': 'source_column required'}, status=status.HTTP_400_BAD_REQUEST)
        if not destination_prefix:
            return Response({'success': False, 'error': 'destination_prefix required'}, status=status.HTTP_400_BAD_REQUEST)

        split_mode = str(request.data.get('split_mode') or 'delimiter')
        if split_mode not in ('delimiter', 'characters'):
            split_mode = 'delimiter'
        delimiter = resolve_delimiter(request.data.get('delimiter', 'comma'))

        try:
            chunk_size = int(request.data.get('chunk_size') or 0)
        except (TypeError, ValueError):
            chunk_size = 0
        if split_mode == 'characters' and chunk_size < 1:
            return Response({
                'success': False,
                'error': 'chunk_size must be 1 or more when splitting every N characters'
            }, status=status.HTTP_400_BAD_REQUEST)

        trim = bool(request.data.get('trim', True))
        drop_empty = bool(request.data.get('drop_empty', True))
        keep_source_column = bool(request.data.get('keep_source_column', False))
        on_overflow = str(request.data.get('on_overflow') or 'review')
        if on_overflow not in ('review', 'truncate'):
            on_overflow = 'review'
        preview = bool(request.data.get('preview', False))
        preview_rows = max(1, min(int(request.data.get('preview_rows') or 20), 200))

        try:
            max_columns = int(request.data.get('max_columns') or 0)
        except (TypeError, ValueError):
            max_columns = 0
        max_columns = max(0, max_columns)

        headers, rows = read_session_grid(session_id, info)
        if headers is None:
            return Response({
                'success': False,
                'error': 'No mappings found. Map your columns before splitting.'
            }, status=status.HTTP_400_BAD_REQUEST)
        if not headers or not rows:
            return Response({'success': False, 'error': 'No data found for this session'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Resolve which column to split. A unique column name is authoritative —
        # this survives any off-by-one in the caller's index (e.g. a hidden
        # row-number column shifting positions). The index is only used to
        # disambiguate when the same header legitimately repeats in the grid.
        try:
            requested_index = int(request.data.get('source_column_index'))
        except (TypeError, ValueError):
            requested_index = None

        name_positions = [i for i, h in enumerate(headers) if h == source_column]
        if len(name_positions) == 1:
            source_index = name_positions[0]
        elif len(name_positions) > 1 and requested_index in name_positions:
            source_index = requested_index
        elif len(name_positions) > 1:
            source_index = name_positions[0]
        elif requested_index is not None and 0 <= requested_index < len(headers):
            source_index = requested_index
        else:
            return Response({
                'success': False,
                'error': f'Column "{source_column}" is not in the grid',
                'headers': headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        split_per_row = [
            split_cell_values(
                row[source_index] if source_index < len(row) else '',
                split_mode, delimiter, chunk_size, trim, drop_empty
            )
            for row in rows
        ]

        widest = max((len(values) for values in split_per_row), default=0)
        if widest == 0:
            hint = 'Check the delimiter.' if split_mode == 'delimiter' else 'Check the chunk size.'
            return Response({
                'success': False,
                'error': f'No values were produced from "{source_column}". {hint}',
                'headers': headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        column_count = min(widest, max_columns) if max_columns else widest
        new_columns = [f'{destination_prefix}_{i + 1}' for i in range(column_count)]
        overwrite_existing = bool(request.data.get('overwrite_existing', False))

        source_slots = get_sfo_slot_keys(headers)
        source_slot = source_slots[source_index] if source_index < len(source_slots) else source_column
        is_tag_group_split = bool(re.match(r'^Tag_\d+$', source_slot))
        is_spec_value_split = bool(re.match(r'^Specification_Value_\d+$', source_slot))

        if is_tag_group_split or is_spec_value_split:
            clashes = []
        else:
            kept_headers = [h for i, h in enumerate(headers) if keep_source_column or i != source_index]
            clashes = [c for c in new_columns if c in kept_headers]
        if clashes and not overwrite_existing:
            return Response({
                'success': False,
                'error': f'Output column(s) already exist: {", ".join(clashes)}. '
                         f'Turn on "Fill existing columns" to write into them, or use a different prefix.',
                'headers': headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        review_rows = []
        rows_split = 0
        rows_empty = 0
        overflow_rows = 0

        if is_tag_group_split:
            output_headers, output_rows, generated_count = _split_tag_slot_into_group(
                headers, rows, source_index, split_per_row, column_count, keep_source_column
            )
            new_columns = ['Tag'] * generated_count
            for row_number, values in enumerate(split_per_row, start=1):
                if not values:
                    rows_empty += 1
                elif len(values) > 1:
                    rows_split += 1
                if column_count and len(values) > column_count:
                    overflow_rows += 1
                    if on_overflow == 'review':
                        review_rows.append({
                            'row': row_number,
                            'reason': f'{len(values)} values but only {column_count} column(s) available',
                            'dropped': values[column_count:],
                        })
        elif is_spec_value_split:
            output_headers, output_rows, generated_count = _split_spec_value_slot_into_group(
                headers, rows, source_index, split_per_row, column_count, keep_source_column
            )
            new_columns = ['Specification value'] * generated_count
            for row_number, values in enumerate(split_per_row, start=1):
                if not values:
                    rows_empty += 1
                elif len(values) > 1:
                    rows_split += 1
                if column_count and len(values) > column_count:
                    overflow_rows += 1
                    if on_overflow == 'review':
                        review_rows.append({
                            'row': row_number,
                            'reason': f'{len(values)} values but only {column_count} column(s) available',
                            'dropped': values[column_count:],
                        })
        elif overwrite_existing:
            # Write the split values into columns that already carry this prefix
            # (e.g. the template's Tag_1 … Tag_N), creating only the ones missing.
            output_headers = [h for i, h in enumerate(headers) if keep_source_column or i != source_index]
            insert_at = min(source_index, len(output_headers))
            for offset, name in enumerate([c for c in new_columns if c not in output_headers]):
                output_headers.insert(insert_at + offset, name)
            name_to_out = {h: k for k, h in enumerate(output_headers)}

            output_rows = []
            for row_number, (row, values) in enumerate(zip(rows, split_per_row), start=1):
                if not values:
                    rows_empty += 1
                elif len(values) > 1:
                    rows_split += 1
                if column_count and len(values) > column_count:
                    overflow_rows += 1
                    if on_overflow == 'review':
                        review_rows.append({'row': row_number,
                                            'reason': f'{len(values)} values but only {column_count} column(s) available',
                                            'dropped': values[column_count:]})
                    values = values[:column_count]

                out = [''] * len(output_headers)
                for i, h in enumerate(headers):
                    if not keep_source_column and i == source_index:
                        continue
                    if h in name_to_out:
                        out[name_to_out[h]] = row[i] if i < len(row) else ''
                for i, name in enumerate(new_columns):
                    out[name_to_out[name]] = values[i] if i < len(values) else ''
                output_rows.append(out)
        else:
            # Put the new columns where the split column was, so column order survives.
            output_headers = []
            carried_indices = []
            for index, header in enumerate(headers):
                if index == source_index:
                    output_headers.extend(new_columns)
                    if keep_source_column:
                        output_headers.append(header)
                        carried_indices.append(index)
                else:
                    output_headers.append(header)
                    carried_indices.append(index)

            new_column_start = source_index
            output_rows = []
            for row_number, (row, values) in enumerate(zip(rows, split_per_row), start=1):
                if not values:
                    rows_empty += 1
                elif len(values) > 1:
                    rows_split += 1

                if column_count and len(values) > column_count:
                    overflow_rows += 1
                    if on_overflow == 'review':
                        review_rows.append({
                            'row': row_number,
                            'reason': f'{len(values)} values but only {column_count} column(s) available',
                            'dropped': values[column_count:],
                        })
                    values = values[:column_count]

                carried = [row[i] if i < len(row) else '' for i in carried_indices]
                padded = list(values) + [''] * (column_count - len(values))
                output_rows.append(
                    carried[:new_column_start] + padded + carried[new_column_start:]
                )

        grouped_counts = derive_sfo_column_counts_from_headers(output_headers) if (is_tag_group_split or is_spec_value_split) else None
        summary = {
            'source_rows': len(rows),
            'output_rows': len(output_rows),
            'columns_created': column_count,
            'widest_row': widest,
            'rows_split': rows_split,
            'rows_with_no_values': rows_empty,
            'overflow_rows': overflow_rows,
            'overflow_handling': on_overflow,
            'split_mode': split_mode,
            'new_columns': new_columns,
        }
        if grouped_counts:
            summary['column_counts'] = grouped_counts

        preview_payload = [
            dict(zip(output_headers, row)) for row in output_rows[:preview_rows]
        ]
        preview_row_values = [list(row) for row in output_rows[:preview_rows]]

        if preview:
            return Response({
                'success': True,
                'preview': True,
                'headers': output_headers,
                'data': preview_payload,
                'rows': preview_row_values,
                'review_rows': review_rows[:50],
                **summary,
            })

        if grouped_counts:
            info.update(grouped_counts)
        write_session_grid(session_id, info, output_headers, output_rows)

        history = list(info.get('source_transforms') or [])
        history.append({
            'type': 'split_column_into_columns',
            'applied_at': datetime.utcnow().isoformat(),
            'config': {
                'source_column': source_column,
                'source_column_index': source_index,
                'split_mode': split_mode,
                'delimiter': delimiter,
                'chunk_size': chunk_size,
                'destination_prefix': destination_prefix,
                'trim': trim,
                'drop_empty': drop_empty,
                'max_columns': max_columns,
                'on_overflow': on_overflow,
                'keep_source_column': keep_source_column,
            },
            'summary': summary,
        })
        info['source_transforms'] = history
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(
            f"✂️ split_column_into_columns on {session_id}: \"{source_column}\" -> "
            f"{column_count} column(s) across {len(output_rows)} rows"
        )

        return Response({
            'success': True,
            'preview': False,
            'message': f'"{source_column}" split into {column_count} column(s)',
            'template_version': new_version,
            'headers': output_headers,
            'data': preview_payload,
            'rows': preview_row_values,
            'review_rows': review_rows[:50],
            **summary,
        })
    except Exception as e:
        logger.error(f"split_column_into_columns failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _split_grid_rows(headers, rows, source_index, delimiter, copy_indices):
    """Split one cell into rows while copying only explicitly selected columns."""
    output_rows = []
    rows_split = 0
    rows_added = 0
    rows_without_values = 0
    width = len(headers)
    copied = {index for index in copy_indices if 0 <= index < width and index != source_index}

    for source_row in rows:
        original = list(source_row[:width]) + [''] * max(0, width - len(source_row))
        values = split_cell_values(
            original[source_index] if source_index < len(original) else '',
            mode='delimiter',
            delimiter=delimiter,
            trim=True,
            drop_empty=True,
        )

        if not values:
            rows_without_values += 1
            output_rows.append(original)
            continue

        first_row = list(original)
        first_row[source_index] = values[0]
        output_rows.append(first_row)

        if len(values) == 1:
            continue

        rows_split += 1
        rows_added += len(values) - 1
        for value in values[1:]:
            generated = [''] * width
            generated[source_index] = value
            for index in copied:
                generated[index] = original[index]
            output_rows.append(generated)

    return output_rows, {
        'source_rows': len(rows),
        'output_rows': len(output_rows),
        'rows_split': rows_split,
        'rows_added': rows_added,
        'rows_without_values': rows_without_values,
    }


@api_view(['POST'])
def split_column_into_rows(request):
    """Split one mapped-grid column into rows using an explicit delimiter."""
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        source_column = str(request.data.get('source_column') or '').strip()
        if not source_column:
            return Response({'success': False, 'error': 'source_column required'}, status=status.HTTP_400_BAD_REQUEST)

        raw_delimiter = request.data.get('delimiter', 'comma')
        if raw_delimiter is None or str(raw_delimiter) == '':
            return Response({'success': False, 'error': 'delimiter required'}, status=status.HTTP_400_BAD_REQUEST)
        delimiter = resolve_delimiter(raw_delimiter)

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No mapped data found for this session'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            requested_index = int(request.data.get('source_column_index'))
        except (TypeError, ValueError):
            requested_index = None

        positions = [index for index, header in enumerate(headers) if header == source_column]
        if requested_index is not None and 0 <= requested_index < len(headers) and headers[requested_index] == source_column:
            source_index = requested_index
        elif positions:
            source_index = positions[0]
        else:
            return Response({
                'success': False,
                'error': f'Column "{source_column}" is not in the grid',
                'headers': headers,
            }, status=status.HTTP_400_BAD_REQUEST)

        raw_copy_indices = request.data.get('copy_column_indices') or []
        if not isinstance(raw_copy_indices, list):
            return Response({'success': False, 'error': 'copy_column_indices must be a list'},
                            status=status.HTTP_400_BAD_REQUEST)

        copy_indices = []
        for value in raw_copy_indices:
            try:
                index = int(value)
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(headers) and index != source_index and index not in copy_indices:
                copy_indices.append(index)

        output_rows, summary = _split_grid_rows(headers, rows, source_index, delimiter, copy_indices)
        preview = bool(request.data.get('preview', False))
        try:
            preview_limit = max(1, min(int(request.data.get('preview_rows') or 20), 100))
        except (TypeError, ValueError):
            preview_limit = 20

        payload = {
            'success': True,
            'preview': preview,
            'headers': headers,
            'rows': output_rows[:preview_limit],
            'source_column': source_column,
            'source_column_index': source_index,
            'copy_column_indices': copy_indices,
            'copied_columns': [headers[index] for index in copy_indices],
            **summary,
        }
        if preview:
            return Response(payload)

        write_session_grid(session_id, info, headers, output_rows)
        history = list(info.get('source_transforms') or [])
        history.append({
            'type': 'split_column_into_rows',
            'applied_at': datetime.utcnow().isoformat(),
            'config': {
                'source_column': source_column,
                'source_column_index': source_index,
                'delimiter': delimiter,
                'copy_column_indices': copy_indices,
                'copied_columns': [headers[index] for index in copy_indices],
            },
            'summary': summary,
        })
        info['source_transforms'] = history
        save_session(session_id, info)
        payload['template_version'] = increment_template_version(session_id)

        logger.info(
            f"split_column_into_rows on {session_id}: {len(rows)} rows -> {len(output_rows)} rows "
            f"using {source_column!r}"
        )
        return Response(payload)
    except Exception as e:
        logger.error(f"split_column_into_rows failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def copy_column_values(request):
    """Copy one column's values into another column on the current grid.

    Both columns must already exist. Runs on the mapped grid like the other
    review-screen tools, so mappings are untouched.
    """
    try:
        session_id = request.data.get('session_id')
        source_column = str(request.data.get('source_column') or '').strip()
        target_column = str(request.data.get('target_column') or '').strip()
        only_empty = bool(request.data.get('only_empty', False))
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not source_column or not target_column:
            return Response({'success': False, 'error': 'source_column and target_column required'}, status=status.HTTP_400_BAD_REQUEST)
        if source_column == target_column:
            return Response({'success': False, 'error': 'Source and target are the same column'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data found for this session'}, status=status.HTTP_400_BAD_REQUEST)
        if source_column not in headers:
            return Response({'success': False, 'error': f'Column "{source_column}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)
        if target_column not in headers:
            return Response({'success': False, 'error': f'Column "{target_column}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)

        si = headers.index(source_column)
        ti = headers.index(target_column)
        changed = 0
        for row in rows:
            while len(row) <= max(si, ti):
                row.append('')
            if only_empty and str(row[ti] or '').strip():
                continue
            row[ti] = row[si] if si < len(row) else ''
            changed += 1

        write_session_grid(session_id, info, headers, rows)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)
        logger.info(f"📋 copy_column_values on {session_id}: \"{source_column}\" -> \"{target_column}\" ({changed} cells)")
        return Response({'success': True, 'changed': changed, 'template_version': new_version, 'headers': headers})
    except Exception as e:
        logger.error(f"copy_column_values failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def set_column_default(request):
    """Set a fixed value for cells in a column — all cells, or only the empty ones."""
    try:
        session_id = request.data.get('session_id')
        column = str(request.data.get('column') or '').strip()
        value = request.data.get('value', '')
        value = '' if value is None else str(value)
        only_empty = bool(request.data.get('only_empty', True))
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not column:
            return Response({'success': False, 'error': 'column required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data found for this session'}, status=status.HTTP_400_BAD_REQUEST)
        if column not in headers:
            return Response({'success': False, 'error': f'Column "{column}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)

        ci = headers.index(column)
        changed = 0

        # Optional conditional rule: fill the target based on another column's value.
        #   condition = {column, operator, compare, then, else}
        # e.g. { column: "MPN Code", operator: "is_empty",
        #        then: "Finished good", else: "RM" }
        condition = request.data.get('condition')
        if isinstance(condition, dict) and str(condition.get('column') or '').strip():
            cond_col = str(condition.get('column')).strip()
            if cond_col not in headers:
                return Response({'success': False, 'error': f'Condition column "{cond_col}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)
            cond_idx = headers.index(cond_col)
            operator = str(condition.get('operator') or 'is_empty')
            compare = '' if condition.get('compare') is None else str(condition.get('compare')).strip().lower()
            then_val = '' if condition.get('then') is None else str(condition.get('then'))
            raw_else = condition.get('else')
            has_else = raw_else is not None
            else_val = '' if raw_else is None else str(raw_else)

            def cond_is_true(cell):
                c = str(cell or '').strip()
                cl = c.lower()
                if operator == 'is_empty':
                    return c == ''
                if operator == 'not_empty':
                    return c != ''
                if operator == 'equals':
                    return cl == compare
                if operator == 'not_equals':
                    return cl != compare
                if operator == 'contains':
                    return compare in cl
                return False

            for row in rows:
                while len(row) <= max(ci, cond_idx):
                    row.append('')
                if only_empty and str(row[ci] or '').strip():
                    continue
                if cond_is_true(row[cond_idx]):
                    row[ci] = then_val
                    changed += 1
                elif has_else:
                    row[ci] = else_val
                    changed += 1
                # no else and condition false → leave the cell as-is

            write_session_grid(session_id, info, headers, rows)
            save_session(session_id, info)
            new_version = increment_template_version(session_id)
            logger.info(f"🖊️ set_column_default (conditional) on {session_id}: \"{column}\" by \"{cond_col}\" {operator} → {changed} cells")
            return Response({'success': True, 'changed': changed, 'template_version': new_version, 'headers': headers})

        for row in rows:
            while len(row) <= ci:
                row.append('')
            if only_empty and str(row[ci] or '').strip():
                continue
            row[ci] = value
            changed += 1

        write_session_grid(session_id, info, headers, rows)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)
        logger.info(f"🖊️ set_column_default on {session_id}: \"{column}\" = {value!r} ({'empty only' if only_empty else 'all'}, {changed} cells)")
        return Response({'success': True, 'changed': changed, 'template_version': new_version, 'headers': headers})
    except Exception as e:
        logger.error(f"set_column_default failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _value_fails_validation(value, validation):
    """Return True when a populated value breaks an optional required-field rule."""
    text = str(value or '').strip()
    if not text or not isinstance(validation, dict):
        return False

    kind = str(validation.get('kind') or '').strip().lower()
    if kind == 'alpha':
        # Allow human-readable units such as "Square metre", but no digits,
        # punctuation, or placeholders such as "--".
        return re.fullmatch(r'[A-Za-z]+(?:\s+[A-Za-z]+)*', text) is None
    if kind == 'allowed':
        allowed = {
            str(item or '').strip().casefold()
            for item in (validation.get('allowed_values') or [])
            if str(item or '').strip()
        }
        return bool(allowed) and text.casefold() not in allowed
    return False


@api_view(['POST'])
def fill_missing_values(request):
    """Analyze a column or fill user-selected empty/specific-value cells."""
    try:
        session_id = request.data.get('session_id')
        column = str(request.data.get('column') or '').strip()
        action = str(request.data.get('action') or 'apply').strip().lower()
        target_mode = str(request.data.get('target_mode') or 'empty').strip().lower()
        selected_values = request.data.get('selected_values') or []
        strategy = str(request.data.get('strategy') or '').strip().lower()
        default_value = request.data.get('default_value', '')
        default_value = '' if default_value is None else str(default_value).strip()
        source_column = str(request.data.get('source_column') or '').strip()
        validation = request.data.get('validation') or {}

        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not column:
            return Response({'success': False, 'error': 'column required'}, status=status.HTTP_400_BAD_REQUEST)
        if action not in {'analyze', 'apply'}:
            return Response({'success': False, 'error': 'action must be analyze or apply'}, status=status.HTTP_400_BAD_REQUEST)
        if action == 'apply':
            if target_mode not in {'empty', 'selected_values'}:
                return Response({'success': False, 'error': 'target_mode must be empty or selected_values'}, status=status.HTTP_400_BAD_REQUEST)
            if target_mode == 'selected_values' and (not isinstance(selected_values, list) or not selected_values):
                return Response({'success': False, 'error': 'Select at least one value to replace'}, status=status.HTTP_400_BAD_REQUEST)
            if strategy not in {'above', 'below', 'default', 'source_column'}:
                return Response({'success': False, 'error': 'strategy must be above, below, default, or source_column'}, status=status.HTTP_400_BAD_REQUEST)
            if strategy == 'default' and not default_value:
                return Response({'success': False, 'error': 'default_value required'}, status=status.HTTP_400_BAD_REQUEST)
            if strategy == 'source_column':
                if not source_column:
                    return Response({'success': False, 'error': 'source_column required'}, status=status.HTTP_400_BAD_REQUEST)
                if source_column == column:
                    return Response({'success': False, 'error': 'Pick a different column to copy from'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data found for this session'}, status=status.HTTP_400_BAD_REQUEST)

        ci = _grid_column_index(headers, column)
        if ci < 0:
            return Response({'success': False, 'error': f'Column "{column}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)

        for row in rows:
            while len(row) < len(headers):
                row.append('')

        if action == 'analyze':
            from collections import Counter
            counts = Counter()
            empty_count = 0
            for row in rows:
                text = str(row[ci] or '').strip()
                if text:
                    counts[text] += 1
                else:
                    empty_count += 1

            placeholders = {'-', '--', '---', 'n/a', 'na', 'null', 'none', '?'}
            allowed = validation.get('allowed_values') or [] if isinstance(validation, dict) else []
            value_options = []
            for value, count in counts.items():
                reason = ''
                if _value_fails_validation(value, validation):
                    kind = str((validation or {}).get('kind') or '').lower()
                    if kind == 'alpha':
                        reason = 'Contains numbers, punctuation, or symbols'
                    elif kind == 'allowed':
                        reason = f'Not an allowed value ({", ".join(str(item) for item in allowed)})'
                    else:
                        reason = 'Does not match this field rule'
                elif value.casefold() in placeholders:
                    reason = 'Looks like a placeholder'
                value_options.append({
                    'value': value,
                    'count': count,
                    'suggested': bool(reason),
                    'reason': reason,
                })

            value_options.sort(key=lambda item: (not item['suggested'], -item['count'], item['value'].casefold()))
            return Response({
                'success': True,
                'column': column,
                'total_rows': len(rows),
                'empty_count': empty_count,
                'values': value_options[:500],
                'distinct_value_count': len(value_options),
                'suggested_values': [item['value'] for item in value_options if item['suggested']],
            })

        selected_set = {
            str(value or '').strip()
            for value in selected_values
            if str(value or '').strip()
        }

        def is_problem(value):
            text = str(value or '').strip()
            if target_mode == 'empty':
                return text == ''
            return text in selected_set

        problem_mask = [is_problem(row[ci]) for row in rows]
        empty_found = sum(1 for row, problem in zip(rows, problem_mask) if problem and not str(row[ci] or '').strip())
        selected_found = sum(1 for row, problem in zip(rows, problem_mask) if problem and str(row[ci] or '').strip())
        changed = 0

        if strategy == 'default':
            for row, problem in zip(rows, problem_mask):
                if problem and row[ci] != default_value:
                    row[ci] = default_value
                    changed += 1
        elif strategy == 'source_column':
            si = _grid_column_index(headers, source_column)
            if si < 0:
                return Response({'success': False, 'error': f'Column "{source_column}" is not in the grid'}, status=status.HTTP_400_BAD_REQUEST)
            for row, problem in zip(rows, problem_mask):
                if not problem:
                    continue
                # Blank source cells are left alone so a half-filled source
                # column cannot wipe values the user already has.
                value = row[si]
                if not str(value or '').strip():
                    continue
                if row[ci] != value:
                    row[ci] = value
                    changed += 1
        elif strategy == 'above':
            nearest = None
            for row, problem in zip(rows, problem_mask):
                if problem:
                    if nearest is not None and row[ci] != nearest:
                        row[ci] = nearest
                        changed += 1
                else:
                    nearest = row[ci]
        else:  # below
            nearest = None
            for row, problem in zip(reversed(rows), reversed(problem_mask)):
                if problem:
                    if nearest is not None and row[ci] != nearest:
                        row[ci] = nearest
                        changed += 1
                else:
                    nearest = row[ci]

        unresolved = sum(1 for row in rows if is_problem(row[ci]))
        write_session_grid(session_id, info, headers, rows)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)
        logger.info(
            'fill_missing_values on %s: column=%s strategy=%s changed=%s unresolved=%s',
            session_id, column, strategy, changed, unresolved,
        )
        return Response({
            'success': True,
            'changed': changed,
            'unresolved': unresolved,
            'empty_found': empty_found,
            'selected_found': selected_found,
            'target_mode': target_mode,
            'template_version': new_version,
            'headers': headers,
        })
    except Exception as e:
        logger.error(f"fill_missing_values failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def expand_alternate_columns(request):
    """
    Expand side-by-side alternate columns into rows, ON THE CURRENT GRID.

    Some sources hold a primary supplier and an alternate supplier in separate
    side-by-side columns (e.g. BOM 4: Manufacturer / Manufacturer PartNo next to
    Manufacturer S S / Manufacturer PartNo S S). The alternate columns are
    usually left unmapped, so they never reach the mapped grid.

    This reads those alternate columns straight from the source and, for each
    current grid row, emits one extra row per alternate set — copying the row and
    overwriting the chosen destination columns with the alternate's values. The
    primary row (already in the grid from mapping) is kept as-is.

    Unlike the source-level expand, this writes onto the current grid, so it
    composes: a designator split (or anything else) already applied survives.

    Request:
      alternate_sets: [ [ {"target": "MPN Code", "source": "Manufacturer PartNo S S"},
                          {"target": "Preferred vendor code", "source": "Manufacturer S S"} ], ... ]
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        alternate_sets = request.data.get('alternate_sets') or []
        # Accept a single flat set too.
        if alternate_sets and isinstance(alternate_sets[0], dict):
            alternate_sets = [alternate_sets]
        pairs_flat = [p for s in alternate_sets for p in (s or [])]
        if not pairs_flat:
            return Response({'success': False, 'error': 'alternate_sets required (target → source pairs)'},
                            status=status.HTTP_400_BAD_REQUEST)

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No grid to expand for this session'},
                            status=status.HTTP_400_BAD_REQUEST)

        src_headers, src_rows, _extraction = read_session_source(session_id, info)
        if not src_headers or not src_rows:
            return Response({'success': False, 'error': 'No source data found for this session'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Validate columns.
        missing_targets = sorted({p.get('target') for p in pairs_flat if p.get('target') not in headers})
        missing_sources = sorted({p.get('source') for p in pairs_flat if p.get('source') not in src_headers})
        if missing_targets:
            return Response({'success': False, 'error': f'Destination column(s) not in the grid: {", ".join(missing_targets)}',
                             'headers': headers}, status=status.HTTP_400_BAD_REQUEST)
        if missing_sources:
            return Response({'success': False, 'error': f'Source column(s) not found: {", ".join(missing_sources)}',
                             'source_headers': src_headers}, status=status.HTTP_400_BAD_REQUEST)

        target_index = {h: i for i, h in enumerate(headers)}

        # Align each grid row to its source row. Fast path: identical counts →
        # match by position. Otherwise (primary-id filtering commonly drops some
        # source rows during mapping, so counts differ) → match by the values of
        # the directly-mapped columns, which survives added/removed rows.
        if len(rows) == len(src_rows):
            def src_for_row(i, row):
                return src_rows[i] if i < len(src_rows) else None
        else:
            m = info.get('mappings')
            mlist = m.get('mappings') if isinstance(m, dict) else m
            anchor = []
            seen_t = set()
            for it in (mlist or []):
                s = it.get('source') if isinstance(it, dict) else None
                t = it.get('target') if isinstance(it, dict) else None
                if s in src_headers and t in headers and t not in seen_t:
                    anchor.append((s, headers.index(t)))
                    seen_t.add(t)
            if not anchor:
                return Response({
                    'success': False,
                    'error': (f'Row counts differ from the source ({len(rows)} grid vs '
                              f'{len(src_rows)} source) and there are no stable mapped columns to '
                              f'line them up by. Run this before any step that changes rows.'),
                }, status=status.HTTP_400_BAD_REQUEST)
            src_by_key = {}
            for sr in src_rows:
                key = tuple(str(sr.get(s, '') or '').strip() for s, _ti in anchor)
                if key not in src_by_key:
                    src_by_key[key] = sr

            def src_for_row(i, row):
                key = tuple(str((row[ti] if ti < len(row) else '') or '').strip() for _s, ti in anchor)
                return src_by_key.get(key)

            unmatched = sum(1 for i, r in enumerate(rows) if src_for_row(i, list(r)) is None)
            if unmatched:
                return Response({
                    'success': False,
                    'error': (f'Could not line up {unmatched} of {len(rows)} rows with the source — '
                              f'a later step has likely already changed the rows. Run "expand '
                              f'alternate columns" earlier in your flow.'),
                }, status=status.HTTP_400_BAD_REQUEST)

        output_rows = []
        rows_expanded = 0
        alternates_emitted = 0
        for i, row in enumerate(rows):
            row = list(row)
            while len(row) < len(headers):
                row.append('')
            output_rows.append(row)  # primary row, already mapped
            src_row = src_for_row(i, row) or {}
            emitted_here = 0
            for aset in alternate_sets:
                values = {}
                complete = True
                for pair in (aset or []):
                    val = str(src_row.get(pair.get('source'), '') or '').strip()
                    if not val:
                        complete = False
                        break
                    values[pair.get('target')] = val
                if complete and values:
                    new_row = list(row)
                    for tgt, val in values.items():
                        new_row[target_index[tgt]] = val
                    output_rows.append(new_row)
                    alternates_emitted += 1
                    emitted_here += 1
            if emitted_here:
                rows_expanded += 1

        write_session_grid(session_id, info, headers, output_rows)
        history = list(info.get('source_transforms') or [])
        history.append({
            'type': 'expand_alternate_columns',
            'applied_at': datetime.utcnow().isoformat(),
            'config': {'alternate_sets': alternate_sets},
            'summary': {'rows_expanded': rows_expanded, 'alternates_emitted': alternates_emitted,
                        'output_rows': len(output_rows)},
        })
        info['source_transforms'] = history
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(f"↳ expand_alternate_columns on {session_id}: +{alternates_emitted} alternate rows "
                    f"({len(rows)} → {len(output_rows)})")
        return Response({
            'success': True,
            'message': f'Added {alternates_emitted} alternate row(s)',
            'template_version': new_version,
            'headers': headers,
            'rows_expanded': rows_expanded,
            'alternates_emitted': alternates_emitted,
            'output_rows': len(output_rows),
        })
    except Exception as e:
        logger.error(f"expand_alternate_columns failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _row_matches_condition(row, column, test, value=''):
    """Evaluate a single condition on a row's cell. Used for group segmentation."""
    cell = str(row.get(column, '') or '').strip()
    value = str(value or '')
    if test == 'blank':
        return cell == ''
    if test == 'not_blank':
        return cell != ''
    if test == 'equals':
        return cell == value.strip()
    if test == 'not_equals':
        return cell != value.strip()
    if test == 'is_number':
        try:
            float(cell.replace(',', ''))
            return True
        except (ValueError, AttributeError):
            return False
    if test == 'matches':
        try:
            return re.search(value, cell) is not None
        except re.error:
            return False
    return False


@api_view(['POST'])
def carry_forward_group(request):
    """
    Group rows under a parent/header row and reshape them into item rows.

    Some tables repeat a structure the import format can't use directly: a
    "parent" row establishes shared context (e.g. a base part with its
    description) and the rows beneath it are alternates/options for that parent.
    This walks the table, treats each row matching the parent condition as a
    group header, copies chosen columns down into the rows below it, and emits
    either just the child rows or the whole group.

    The parent condition, the columns to carry, and the emit policy are all
    caller-supplied — nothing here is tied to a document, column name, or vendor.

        parent_condition: {"column": "MFR", "test": "blank"}
        carry_columns: ["PartNo", "Description"]
        emit: "children"     # drop the parent header rows

    Test options: blank, not_blank, equals, not_equals, is_number, matches(regex).
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        condition = request.data.get('parent_condition') or {}
        parent_column = str(condition.get('column') or '').strip()
        parent_test = str(condition.get('test') or 'blank')
        parent_value = condition.get('value', '')
        if not parent_column:
            return Response({'success': False, 'error': 'parent_condition.column is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        carry_columns = [str(c).strip() for c in (request.data.get('carry_columns') or []) if str(c).strip()]
        fill_only_blank = bool(request.data.get('fill_only_blank', True))
        emit = str(request.data.get('emit') or 'children')
        if emit not in ('children', 'all'):
            emit = 'children'
        preview = bool(request.data.get('preview', False))
        preview_rows = max(1, min(int(request.data.get('preview_rows') or 20), 200))

        headers, rows, extraction = read_session_source(session_id, info)
        if not headers or not rows:
            return Response({'success': False, 'error': 'No source data found for this session'},
                            status=status.HTTP_400_BAD_REQUEST)
        if parent_column not in headers:
            return Response({'success': False, 'error': f'Column "{parent_column}" is not in the source',
                             'source_headers': headers}, status=status.HTTP_400_BAD_REQUEST)
        missing = [c for c in carry_columns if c not in headers]
        if missing:
            return Response({'success': False, 'error': f'Carry columns not in source: {", ".join(missing)}',
                             'source_headers': headers}, status=status.HTTP_400_BAD_REQUEST)

        output_rows = []
        review_rows = []
        parent_count = 0
        child_count = 0
        orphan_count = 0
        current_parent = None

        for row_number, row in enumerate(rows, start=1):
            is_parent = _row_matches_condition(row, parent_column, parent_test, parent_value)
            if is_parent:
                parent_count += 1
                current_parent = row
                if emit == 'all':
                    output_rows.append(dict(row))
                continue

            # child row
            child = dict(row)
            if current_parent is None:
                orphan_count += 1
                review_rows.append({'row': row_number, 'reason': 'Child row before any parent — no context to carry'})
            else:
                for col in carry_columns:
                    parent_val = str(current_parent.get(col, '') or '').strip()
                    if not parent_val:
                        continue
                    if fill_only_blank and str(child.get(col, '') or '').strip():
                        continue
                    child[col] = parent_val
            child_count += 1
            output_rows.append(child)

        if not output_rows:
            return Response({'success': False,
                             'error': 'No rows were produced. Check the parent condition and emit setting.',
                             'source_headers': headers, 'review_rows': review_rows[:50]},
                            status=status.HTTP_400_BAD_REQUEST)

        summary = {
            'source_rows': len(rows),
            'output_rows': len(output_rows),
            'parents': parent_count,
            'children': child_count,
            'orphans': orphan_count,
            'emit': emit,
            'parent_condition': {'column': parent_column, 'test': parent_test, 'value': parent_value},
            'carry_columns': carry_columns,
        }

        preview_payload = [{h: r.get(h, '') for h in headers} for r in output_rows[:preview_rows]]

        if preview:
            return Response({'success': True, 'preview': True, 'headers': headers,
                             'data': preview_payload, 'review_rows': review_rows[:50], **summary})

        write_session_source(session_id, info, headers, output_rows, extraction)
        for derived_key in ('mappings', 'mapped_data', 'edited_data', 'enhanced_data', 'formula_enhanced_data'):
            info.pop(derived_key, None)
        history = list(info.get('source_transforms') or [])
        history.append({'type': 'carry_forward_group', 'applied_at': datetime.utcnow().isoformat(),
                        'config': summary})
        info['source_transforms'] = history
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(f"🧷 carry_forward_group on {session_id}: {len(rows)} rows -> {len(output_rows)} "
                    f"(parents={parent_count}, children={child_count}, orphans={orphan_count})")

        return Response({'success': True, 'preview': False,
                         'message': f'{len(rows)} rows -> {len(output_rows)} item rows '
                                    f'({parent_count} parents removed)' if emit == 'children'
                                    else f'{len(rows)} rows regrouped',
                         'template_version': new_version, 'headers': headers,
                         'data': preview_payload, 'review_rows': review_rows[:50], **summary})
    except Exception as e:
        logger.error(f"carry_forward_group failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def stack_mapped_alternates(request):
    """
    Turn "two source columns mapped to one destination" into stacked rows.

    When a row lists a main and an alternate the same way — a main supplier's
    manufacturer/part next to an alternate's — the user maps both onto the same
    destination columns (e.g. both part-number columns to MPN Code, both
    manufacturer columns to the manufacturer field). This reads those mappings
    and, instead of jamming two values into one cell, gives each its own row:
    the main becomes one row, the alternate the next, everything else copied down.

    Destinations that receive more than one source are "alternates" and must all
    receive the SAME number of sources, so they pair up cleanly into rows. If
    they don't, the request is blocked rather than producing shifted data.

    Nothing here is specific to a document — it works off whatever mappings the
    user drew.
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        raw = request.data.get('mappings') or info.get('mappings')
        if isinstance(raw, dict) and 'mappings' in raw:
            raw = raw['mappings']
        pairs = []
        for m in (raw or []):
            if isinstance(m, dict):
                s, t = m.get('source'), m.get('target')
                if s and t:
                    pairs.append((str(s), str(t)))
        if not pairs:
            return Response({'success': False, 'error': 'No mappings found. Draw your mappings first.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Group sources by destination, keeping the order they were mapped
        # (dicts preserve insertion order on Python 3.7+).
        grouped = {}
        for s, t in pairs:
            grouped.setdefault(t, []).append(s)

        multi = {t: srcs for t, srcs in grouped.items() if len(srcs) > 1}
        if not multi:
            return Response({
                'success': False,
                'error': 'No alternates found. Map the alternate columns onto the same destinations as the '
                         'main ones (two source columns pointing at one destination), then try again.'
            }, status=status.HTTP_400_BAD_REQUEST)

        counts = {t: len(srcs) for t, srcs in multi.items()}
        n_rows_per_item = max(counts.values())
        mismatched = {t: c for t, c in counts.items() if c != n_rows_per_item}
        if mismatched:
            detail = '; '.join(f'"{t}" has {c}' for t, c in counts.items())
            return Response({
                'success': False,
                'error': f'These destinations have different numbers of sources ({detail}). '
                         f'Give each the same number of alternates so they can pair into rows.'
            }, status=status.HTTP_400_BAD_REQUEST)

        preview = bool(request.data.get('preview', False))
        preview_rows = max(1, min(int(request.data.get('preview_rows') or 20), 200))

        # Read the source once for detecting empty alternates (item with no S S).
        src_headers, src_rows, extraction = read_session_source(session_id, info)

        client_path = info.get('client_path')
        sheet_name = info.get('sheet_name')
        header_row = info.get('header_row', 1)
        header_row = header_row - 1 if header_row and header_row > 0 else 0

        # For each slot (main, alt1, alt2 …) run a clean single-source-per-target
        # mapping so the destination naming is correct and nothing shifts.
        slot_results = []
        for slot in range(n_rows_per_item):
            slot_mappings = [
                {'source': (srcs[slot] if len(srcs) > 1 else srcs[0]), 'target': t}
                for t, srcs in grouped.items()
            ]
            res = apply_column_mappings(
                client_path, {'mappings': slot_mappings},
                sheet_name=sheet_name, header_row=header_row, session_id=session_id
            )
            slot_results.append(res)

        headers = slot_results[0].get('headers') or []
        alt_source_cols_by_slot = {slot: [srcs[slot] for srcs in multi.values()] for slot in range(1, n_rows_per_item)}

        output_rows = []
        n = min(len(r.get('data') or []) for r in slot_results)
        for k in range(n):
            output_rows.append(slot_results[0]['data'][k])          # main row for this item
            src_row = src_rows[k] if k < len(src_rows) else {}
            for slot in range(1, n_rows_per_item):
                alt_cols = alt_source_cols_by_slot[slot]
                if all(str(src_row.get(c, '') or '').strip() == '' for c in alt_cols):
                    continue                                          # this item has no such alternate
                output_rows.append(slot_results[slot]['data'][k])

        summary = {
            'source_rows': n,
            'output_rows': len(output_rows),
            'rows_per_item': n_rows_per_item,
            'alternate_destinations': list(multi.keys()),
        }
        preview_payload = [dict(zip(headers, row)) for row in output_rows[:preview_rows]]

        if preview:
            return Response({'success': True, 'preview': True, 'headers': headers,
                             'data': preview_payload, **summary})

        snapshot = {'headers': list(headers), 'data': [list(r) for r in output_rows]}
        info['enhanced_data'] = snapshot
        info['edited_data'] = snapshot
        info['enhanced_headers'] = list(headers)
        info['current_template_headers'] = list(headers)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(f"🧬 stack_mapped_alternates on {session_id}: {n} items -> {len(output_rows)} rows "
                    f"({n_rows_per_item} per item across {list(multi.keys())})")

        return Response({'success': True, 'preview': False,
                         'message': f'{n} items expanded into {len(output_rows)} rows',
                         'template_version': new_version, 'headers': headers,
                         'data': preview_payload, **summary})
    except Exception as e:
        logger.error(f"stack_mapped_alternates failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def apply_factwise_id_to_grid(headers, rows, factwise_rules):
    """Replay reusable column rules for validation/export compatibility."""
    if not factwise_rules:
        return headers, rows
    current_headers = list(headers)
    current_rows = [list(row) for row in rows]
    for rule in factwise_rules:
        if not isinstance(rule, dict) or rule.get('type') not in {'factwise_id', 'column_value'}:
            continue
        try:
            current_headers, current_rows, _changed = apply_column_value_rule(
                current_headers, current_rows, rule
            )
        except ValueError as exc:
            logger.warning(f'Could not replay column rule during validation/export: {exc}')
    return current_headers, current_rows


@api_view(['POST'])
def required_field_report(request):
    """
    Count blank cells across the FULL grid for the given columns.

    The editor fetches rows one page at a time, so the frontend can only see the
    current page. This reports true blank counts over every row so the export
    required-field guard shows the correct number (e.g. 251, not just 100).
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        columns = request.data.get('columns') or []
        if not isinstance(columns, list) or not columns:
            return Response({'success': False, 'error': 'columns (list) required'},
                            status=status.HTTP_400_BAD_REQUEST)

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': True, 'gaps': [], 'total_rows': 0})

        # The 'Item code' (and similar) columns may be GENERATED by a FactWise ID
        # rule that is applied at display/export time but not written into the stored
        # grid. Apply those rules here too, otherwise this check reports the column as
        # all-blank while the user (and the actual export) see it filled.
        #
        # Replayed as fill-only, whatever the rule's own write_mode says. This
        # report exists to describe what is ALREADY there, so it must never
        # rewrite a stored value: a join rule whose source column has since been
        # emptied re-derives a worse value than the one on the sheet. That is how
        # a grid holding 422 unique item codes was reported as "5 blank cells,
        # 6 duplicate rows" - the numbers were of the recomputed column, and the
        # exported file, correctly, had neither.
        replay_rules = [
            dict(rule, write_mode='fill_empty')
            for rule in (info.get('factwise_rules') or [])
            if isinstance(rule, dict)
        ]
        headers, rows = apply_factwise_id_to_grid(headers, rows, replay_rules)

        gaps = []
        for column in columns:
            if column not in headers:
                continue
            idx = headers.index(column)
            empty = 0
            for row in rows:
                v = row[idx] if idx < len(row) else ''
                if str(v or '').strip() == '':
                    empty += 1
            if empty > 0:
                gaps.append({'field': column, 'emptyCount': empty})

        # Optional duplicate report for key columns (e.g. Item code must be unique
        # in FactWise). Reports how many rows carry a value that repeats.
        #
        # For Item code this asks the question the EXPORT asks, not "does this
        # string appear twice in the grid".
        #
        # A part consumed in two assemblies is two grid rows on purpose — the BOM
        # needs both, with their own quantities — and the item export collapses
        # them: `_drop_bom_columns` removes Level/Quantity, then
        # `_dedupe_item_rows` merges rows that are then identical. So the file
        # FactWise receives already has each code once.
        #
        # Counting raw grid repeats warned about 22 rows that were never going
        # to reach FactWise as duplicates — and the remedy it offered, Fill
        # Column, would have given one physical part two item codes and split it
        # into two items with the BOM lines pointing at different ones. Only a
        # genuine conflict (same code, rows disagreeing about what the part IS)
        # is worth stopping for.
        duplicates = []
        item_code_key = _template_label_key('Item code')
        for column in (request.data.get('dupe_columns') or []):
            if column not in headers:
                continue
            idx = headers.index(column)
            from collections import Counter

            if _template_label_key(column) == item_code_key:
                export_rows, export_headers = _drop_bom_columns(
                    [list(row) for row in rows], list(headers)
                )
                _kept, conflicting = _dedupe_item_rows(export_rows, export_headers)
                conflicting = set(conflicting)
                counts = Counter()
                for row in rows:
                    v = str((row[idx] if idx < len(row) else '') or '').strip()
                    if v and v in conflicting:
                        counts[v] += 1
            else:
                counts = Counter()
                for row in rows:
                    v = str((row[idx] if idx < len(row) else '') or '').strip()
                    if v:
                        counts[v] += 1

            dup_rows = sum(c for c in counts.values() if c > 1)
            dup_values = sum(1 for c in counts.values() if c > 1)
            if dup_rows > 0:
                # The actual repeated values, so the UI can highlight those cells for
                # manual editing (capped to keep the payload small).
                dup_value_list = [v for v, c in counts.items() if c > 1][:1000]
                duplicates.append({
                    'field': column,
                    'duplicateRows': dup_rows,
                    'duplicateValues': dup_values,
                    'values': dup_value_list,
                })

        invalids = []
        boolean_truths = {'true', 'false'}
        for column in (request.data.get('boolean_columns') or []):
            if column not in headers:
                continue
            idx = headers.index(column)
            invalid_count = 0
            samples = []
            for row in rows:
                v = row[idx] if idx < len(row) else ''
                text = str(v or '').strip()
                if not text:
                    continue
                if text.lower() not in boolean_truths:
                    invalid_count += 1
                    if len(samples) < 10 and text not in samples:
                        samples.append(text)
            if invalid_count > 0:
                invalids.append({
                    'field': column,
                    'invalidCount': invalid_count,
                    'allowedValues': ['TRUE', 'FALSE'],
                    'values': samples,
                })

        # Additional required-field validators are sent explicitly by the UI so
        # this endpoint remains reusable and does not guess roles from headers.
        validators = request.data.get('validators') or {}
        if isinstance(validators, dict):
            already_reported = {item['field'] for item in invalids}
            for column, validation in validators.items():
                if column not in headers or column in already_reported or not isinstance(validation, dict):
                    continue
                idx = headers.index(column)
                kind = str(validation.get('kind') or '').strip().lower()
                values = [
                    str((row[idx] if idx < len(row) else '') or '').strip()
                    for row in rows
                ]
                populated = [value for value in values if value]

                if kind == 'single_value':
                    distinct = []
                    for value in populated:
                        if value not in distinct:
                            distinct.append(value)
                    if len(distinct) > 1:
                        invalids.append({
                            'field': column,
                            'invalidCount': len(populated),
                            'kind': kind,
                            'values': distinct[:10],
                        })
                    continue

                bad_values = [value for value in populated if _value_fails_validation(value, validation)]
                if bad_values:
                    samples = []
                    for value in bad_values:
                        if value not in samples:
                            samples.append(value)
                        if len(samples) >= 10:
                            break
                    invalids.append({
                        'field': column,
                        'invalidCount': len(bad_values),
                        'kind': kind,
                        'allowedValues': validation.get('allowed_values') or [],
                        'values': samples,
                    })

        return Response({
            'success': True,
            'gaps': gaps,
            'duplicates': duplicates,
            'invalids': invalids,
            'warnings': _incomplete_group_warnings(headers, rows),
            'total_rows': len(rows),
        })
    except Exception as e:
        logger.error(f"required_field_report failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



def _incomplete_group_warnings(headers, rows):
    """Report half-filled specification / customer-identification groups.

    These groups are written whole — name, value and (for specs) UOM — so a name
    with no value is a normal in-progress state, not corruption. Nothing is
    cleared or blocked; the user is told which rows are incomplete so they can
    fill the value or drop the name before importing.
    """
    if not headers or not rows:
        return []

    groups = [
        ('Specification name', 'Specification value', 'specification'),
        ('Custom identification name', 'Custom identification value', 'custom identification'),
    ]

    warnings = []
    for name_label, value_label, description in groups:
        name_positions = [i for i, h in enumerate(headers)
                          if _template_label_key(h) == _template_label_key(name_label)]
        value_positions = [i for i, h in enumerate(headers)
                           if _template_label_key(h) == _template_label_key(value_label)]

        for slot, (name_index, value_index) in enumerate(zip(name_positions, value_positions), start=1):
            affected = 0
            for row in rows:
                if not isinstance(row, list):
                    continue
                name = str((row[name_index] if name_index < len(row) else '') or '').strip()
                value = str((row[value_index] if value_index < len(row) else '') or '').strip()
                if name and not value:
                    affected += 1
            if affected:
                warnings.append({
                    'kind': 'incomplete_group',
                    'field': name_label,
                    'slot': slot,
                    'count': affected,
                    'message': (
                        f'{affected} row(s) have a {description} name in slot {slot} '
                        f'with no matching value.'
                    ),
                    'suggestion': f'Fill the {value_label.lower()}, or remove the name.',
                })
    return warnings


@api_view(['POST'])
def fill_required_defaults(request):
    """
    Fill blank cells in the named columns with a default value.

    Used by the export required-field guard. It writes straight onto the current
    grid so every existing column is preserved — unlike the canonical
    update-session-data path, which rebuilds to template columns and would drop
    dynamically-added columns (e.g. MPN validation results).
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        defaults = request.data.get('defaults') or {}
        if not isinstance(defaults, dict) or not defaults:
            return Response({'success': False, 'error': 'defaults (column -> value) required'},
                            status=status.HTTP_400_BAD_REQUEST)

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data to fill for this session'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Match the way editor_defaults resolves columns: normalized, not
        # exact. An exact match skips silently when the session header differs
        # only in case or spacing ("Measurement Unit"), which reads as "the
        # default does not work" with no error anywhere.
        def _header_key(value):
            return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())

        header_index_by_key = {}
        for position, header in enumerate(headers):
            header_index_by_key.setdefault(_header_key(header), position)

        # Finished goods and sub-assemblies keep their identity columns: their
        # item code is what the rest of the BOM points at, and their Item type
        # is what makes them an assembly rather than a purchased part.
        locked_codes = locked_identity_codes(info, headers, rows)
        item_code_index = header_index_by_key.get(_header_key('Item code'))
        # Row identities, not a counter: this loops per column, so counting each
        # skip would report five protected rows once per column filled.
        locked_row_ids = set()

        filled_counts = {}
        skipped_columns = []
        for column, value in defaults.items():
            value = str(value or '').strip()
            if not value:
                continue
            idx = header_index_by_key.get(_header_key(column))
            if idx is None:
                skipped_columns.append(column)
                continue
            column_is_locked = (
                _template_label_key(column) in AUTHORED_FINISHED_GOOD_LOCKED_COLUMNS
                and locked_codes and item_code_index is not None
            )
            n = 0
            for row in rows:
                while len(row) <= idx:
                    row.append('')
                if (
                    column_is_locked
                    and item_code_index < len(row)
                    and str(row[item_code_index] or '').strip() in locked_codes
                ):
                    locked_row_ids.add(id(row))
                    continue
                if str(row[idx] or '').strip() == '':
                    row[idx] = value
                    n += 1
            filled_counts[column] = n

        write_session_grid(session_id, info, headers, rows)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(f"🩹 fill_required_defaults on {session_id}: {filled_counts}")
        if skipped_columns:
            logger.info(f"🩹 fill_required_defaults skipped (no such column): {skipped_columns}")
        return Response({'success': True, 'headers': headers, 'rows': len(rows),
                         'filled': filled_counts, 'skipped_columns': skipped_columns,
                         'locked_rows_skipped': len(locked_row_ids),
                         'template_version': new_version})
    except Exception as e:
        logger.error(f"fill_required_defaults failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def cleanup_grid_rows(request):
    """
    Remove rows from the current mapped grid where the chosen key column is empty.

    This is the "primary column" cleanup, but run at the Review step (mapping →
    editor) on the MAPPED grid, so it works the same for every source type
    (Excel, OCR, PDF zonal) and lets the user pick a destination column like
    "Item code" as the key.
    """
    try:
        session_id = request.data.get('session_id')
        column = str(request.data.get('column') or '').strip()
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not column:
            return Response({'success': False, 'error': 'column required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No grid to clean for this session'},
                            status=status.HTTP_400_BAD_REQUEST)
        if column not in headers:
            return Response({'success': False, 'error': f'Column "{column}" is not in the grid', 'headers': headers},
                            status=status.HTTP_400_BAD_REQUEST)

        idx = headers.index(column)
        kept = [r for r in rows if str((r[idx] if idx < len(r) else '') or '').strip()]
        removed = len(rows) - len(kept)

        if removed > 0:
            write_session_grid(session_id, info, headers, kept)
            save_session(session_id, info)
            new_version = increment_template_version(session_id)
        else:
            new_version = info.get('template_version')

        logger.info(f"🧹 cleanup_grid_rows on {session_id}: removed {removed} rows with empty '{column}' "
                    f"({len(rows)} → {len(kept)})")
        return Response({'success': True, 'removed': removed, 'remaining': len(kept),
                         'column': column, 'template_version': new_version})
    except Exception as e:
        logger.error(f"cleanup_grid_rows failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# What identifies a grid row well enough to delete it by position. Used to check
# that the row the editor pointed at is still the row sitting there.
ROW_IDENTITY_COLUMNS = ('Item code', 'CPN Code', 'MPN Code', 'Item name')


@api_view(['POST'])
def delete_rows_conditional(request):
    """Delete rows from the current grid where a column meets a condition.

    Request: { session_id, column, operator, compare }
      operator: is_empty | not_empty | equals | not_equals | contains
    e.g. delete every row where "MPN Code" is_empty.

    Or, to delete one named row outright: { session_id, rows, row_values }
      rows        1-based position in the grid, as the editor numbers the row
      row_values  that row's cells as the caller sees them, keyed by header

    The editor's per-row delete button takes the second form. It is the same
    deletion — same BOM guard, same write, same response — selected by position
    instead of by condition, so there is one place where a grid row can be
    removed rather than two that can drift apart.

    ``row_values`` is the safety interlock, and a position alone is NOT enough
    to delete on. The editor's row list does not always come from the same
    snapshot this endpoint reads: ``data_view`` serves ``enhanced_data`` when
    one is active, while ``read_session_grid`` prefers ``edited_data``, and the
    two can differ in length. Position 40 of one is then not position 40 of the
    other, and deleting by number alone would take the wrong row. So the row at
    that position has to still hold the values the user was looking at, on every
    header the two sides share, or the delete is refused.
    """
    try:
        session_id = request.data.get('session_id')
        column = str(request.data.get('column') or '').strip()
        operator = str(request.data.get('operator') or 'is_empty')
        compare = '' if request.data.get('compare') is None else str(request.data.get('compare')).strip().lower()
        raw_positions = request.data.get('rows')
        by_position = isinstance(raw_positions, list) and len(raw_positions) > 0
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not column and not by_position:
            return Response({'success': False, 'error': 'column required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No grid for this session'}, status=status.HTTP_400_BAD_REQUEST)
        if not by_position and column not in headers:
            return Response({'success': False, 'error': f'Column "{column}" is not in the grid', 'headers': headers},
                            status=status.HTTP_400_BAD_REQUEST)

        idx = headers.index(column) if column in headers else -1

        positions = set()
        if by_position:
            for value in raw_positions:
                try:
                    position = int(value)
                except (TypeError, ValueError):
                    continue
                if 1 <= position <= len(rows):
                    positions.add(position)
            if not positions:
                return Response({
                    'success': False,
                    'error': ('That row is no longer in this sheet. Refresh the page and '
                              'try again.'),
                    'stale': True,
                }, status=status.HTTP_409_CONFLICT)

            # Confirm the row still holds what the user was looking at. See the
            # note in the docstring: the editor's row numbering and this grid can
            # come from different snapshots, so the number alone can point at a
            # different row.
            #
            # Only the identity columns are compared, not the whole row. The
            # question being asked is "is this still the row the user clicked",
            # not "are the two snapshots byte-identical" — and they are not: a
            # descriptive column can hold a value in one and be blank in the
            # other, which says nothing about whether this is the same part.
            # Comparing everything turned every such row into a false "refresh
            # and try again" the user could do nothing about.
            header_counts = Counter(str(h) for h in headers)
            row_values = request.data.get('row_values') or {}
            compared = 0
            if isinstance(row_values, dict):
                for position in sorted(positions):
                    row = rows[position - 1]
                    for name in ROW_IDENTITY_COLUMNS:
                        if name not in row_values or header_counts.get(name, 0) != 1:
                            continue
                        column_index = _grid_column_index(headers, name)
                        if column_index < 0:
                            continue
                        actual = row[column_index] if column_index < len(row) else ''
                        expected = row_values.get(name)
                        if not str(actual or '').strip() and not str(expected or '').strip():
                            continue
                        compared += 1
                        if str(actual or '').strip() != str(expected or '').strip():
                            return Response({
                                'success': False,
                                'error': ('This sheet has changed since the page was loaded, so '
                                          'the row you picked is no longer the row at that '
                                          'position. Refresh and try again.'),
                                'stale': True,
                            }, status=status.HTTP_409_CONFLICT)
            if not compared:
                # Nothing identified the row, so there is no way to tell whether
                # the position still means what the caller thinks. Deleting on
                # the number alone is how the wrong row gets removed.
                return Response({
                    'success': False,
                    'error': ('This row has no item code, part number or name to identify it '
                              'by, so it cannot be deleted individually. Use Tools → Delete '
                              'rows by condition instead.'),
                    'unidentifiable': True,
                }, status=status.HTTP_400_BAD_REQUEST)

        def matches(cell):
            c = str(cell or '').strip()
            cl = c.lower()
            if operator == 'is_empty':
                return c == ''
            if operator == 'not_empty':
                return c != ''
            if operator == 'equals':
                return cl == compare
            if operator == 'not_equals':
                return cl != compare
            if operator == 'contains':
                return compare in cl
            return False

        def selected(position, row):
            if by_position:
                return position in positions
            return matches(row[idx] if idx < len(row) else '')

        # The BOM's own rows survive any condition.
        #
        # The finished good and every sub-assembly are structure, not data: a
        # BOM references them, and deleting one leaves that BOM pointing at an
        # item the directory no longer contains. They are also the rows most
        # likely to match a condition by accident — an assembly has no MPN and
        # no manufacturer, so "delete where MPN is empty" takes all of them.
        #
        # Bulk fills already refuse to touch these (see locked_identity_codes);
        # deletion is a separate endpoint and had no such guard, so the tool
        # that was safest to reach for was the one that removed the BOM.
        # Deleting one deliberately is still possible — one row at a time, where
        # the user can see which row it is.
        locked_codes = locked_identity_codes(info, headers, rows)
        code_index = _grid_column_index(headers, 'Item code')
        cpn_index = _grid_column_index(headers, 'CPN Code')

        def is_locked(row):
            if not locked_codes:
                return False
            for position in (code_index, cpn_index):
                if 0 <= position < len(row):
                    if str(row[position] or '').strip() in locked_codes:
                        return True
            return False

        # Keep rows that weren't selected for deletion, plus any the BOM needs.
        kept = []
        protected = 0
        for position, r in enumerate(rows, start=1):
            if not selected(position, r):
                kept.append(r)
            elif is_locked(r):
                kept.append(r)
                protected += 1
        removed = len(rows) - len(kept)

        if removed > 0:
            write_session_grid(session_id, info, headers, kept)
            save_session(session_id, info)
            new_version = increment_template_version(session_id)
        else:
            new_version = info.get('template_version')

        criterion = (f"rows {sorted(positions)}" if by_position
                     else f"\"{column}\" {operator} {compare!r}")
        logger.info(f"🗑️ delete_rows_conditional on {session_id}: removed {removed} rows where "
                    f"{criterion} ({len(rows)} → {len(kept)}); "
                    f"kept {protected} BOM row(s) the selection also matched")
        # `protected` is reported, not swallowed: the user asked for those rows
        # to go and they did not, so the count has to be visible or the tool
        # looks like it silently under-deleted.
        return Response({'success': True, 'removed': removed, 'remaining': len(kept),
                         'protected': protected,
                         'column': column, 'template_version': new_version})
    except Exception as e:
        logger.error(f"delete_rows_conditional failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def download_demo_bom_sheet(request, session_id):
    """DEMO: return a pre-made 'golden' export .xlsx for a recognized input, so the
    "Export BOM Sheet" button always produces a perfect sheet regardless of the live
    processing. Drop files in excel_mapper/data/demo_exports/ and map them in
    manifest.json — { "match substring (filename or sheet)": "file.xlsx" }. Falls back
    to default.xlsx if present, else 404 with a clear message.
    """
    try:
        import json as _json
        from django.http import FileResponse
        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        base = os.path.join(os.path.dirname(__file__), 'data', 'demo_exports')
        # Normalize away separators so "bom1" matches "BOM_1.xls", "BOM 1.xlsx", "BOM-1"…
        def _norm(s):
            return re.sub(r'[^a-z0-9]', '', str(s or '').lower())
        name = _norm(info.get('original_client_name'))
        sheet = _norm(info.get('sheet_name'))
        manifest = {}
        try:
            with open(os.path.join(base, 'manifest.json'), 'r', encoding='utf-8') as fh:
                manifest = _json.load(fh) or {}
        except Exception:
            manifest = {}
        chosen = None
        for key, fname in manifest.items():
            if str(key).startswith('_'):  # skip _comment etc.
                continue
            k = _norm(key)
            if k and (k in name or k in sheet):
                chosen = fname
                break
        if not chosen and os.path.exists(os.path.join(base, 'default.xlsx')):
            chosen = 'default.xlsx'
        if not chosen:
            return Response({'success': False, 'error': 'No demo export sheet is configured for this input yet.'},
                            status=status.HTTP_404_NOT_FOUND)
        file_path = os.path.join(base, chosen)
        if not os.path.exists(file_path):
            return Response({'success': False, 'error': f'Demo export file "{chosen}" is missing on the server.'},
                            status=status.HTTP_404_NOT_FOUND)
        return FileResponse(
            open(file_path, 'rb'),
            as_attachment=True,
            filename=chosen,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
    except Exception as e:
        logger.error(f"download_demo_bom_sheet failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _match_demo_export_file(info):
    """Return (filename, matched_key) for the golden export matched to this input,
    or (None, None). matched_key lets callers honor the manifest's _no_preview list."""
    base = os.path.join(os.path.dirname(__file__), 'data', 'demo_exports')
    def _norm(s):
        return re.sub(r'[^a-z0-9]', '', str(s or '').lower())
    name = _norm(info.get('original_client_name'))
    sheet = _norm(info.get('sheet_name'))
    manifest = {}
    try:
        import json as _json
        with open(os.path.join(base, 'manifest.json'), 'r', encoding='utf-8') as fh:
            manifest = _json.load(fh) or {}
    except Exception:
        manifest = {}
    for key, fname in manifest.items():
        if str(key).startswith('_'):
            continue
        nk = _norm(key)
        if nk and (nk in name or nk in sheet):
            return fname, key
    if os.path.exists(os.path.join(base, 'default.xlsx')):
        return 'default.xlsx', None
    return None, None


def _demo_no_preview_keys():
    """Manifest keys (normalized) whose preview is intentionally suppressed — the
    golden sheet still downloads, but the Export BOM tree isn't shown yet."""
    base = os.path.join(os.path.dirname(__file__), 'data', 'demo_exports')
    def _norm(s):
        return re.sub(r'[^a-z0-9]', '', str(s or '').lower())
    try:
        import json as _json
        with open(os.path.join(base, 'manifest.json'), 'r', encoding='utf-8') as fh:
            manifest = _json.load(fh) or {}
        return {_norm(k) for k in (manifest.get('_no_preview') or [])}
    except Exception:
        return set()


def _cell_text(value):
    return str(value or '').strip()


def _bom_header_key(value):
    return re.sub(r'[^a-z0-9]+', ' ', _cell_text(value).lower()).strip()


def _find_bom_header_row(table):
    required = {'bom id', 'raw material code'}
    for idx, row in enumerate((table or [])[:30]):
        keys = {_bom_header_key(cell) for cell in (row or [])}
        if required.issubset(keys) and ('finished good code' in keys or 'sub bom id' in keys):
            return idx
    return -1


def _read_source_table_for_bom_preview(info):
    """Read an uploaded BOM import workbook before it has been mapped."""
    try:
        import pandas as pd
        source_path = hybrid_file_manager.get_file_path(info.get('client_path'))
        if not source_path:
            return [], []

        if str(source_path).lower().endswith('.csv'):
            df = read_delimited_text_safely(source_path, header=None, dtype=object)
        else:
            df = pd.read_excel(
                source_path,
                sheet_name=info.get('sheet_name') or 0,
                header=None,
                dtype=object,
            )

        table = df.fillna('').values.tolist()
        header_idx = _find_bom_header_row(table)
        if header_idx < 0:
            return [], []

        headers = [_cell_text(h) for h in table[header_idx]]
        rows = [list(row) for row in table[header_idx + 1:]]
        return headers, rows
    except Exception as e:
        logger.warning(f"Could not read source table for BOM preview: {e}")
        return [], []


def _build_bom_tree_from_table(headers, rows):
    """Build a nested preview tree from FactWise BOM import columns."""
    headers = [_cell_text(h) for h in (headers or [])]
    rows = [list(row) for row in (rows or [])]
    if _find_bom_header_row([headers]) != 0:
        return None, {'reason': 'missing_bom_headers'}

    hdr = [_bom_header_key(h) for h in headers]

    def ci(*names):
        wanted = {_bom_header_key(name) for name in names}
        for i, h in enumerate(hdr):
            if h in wanted:
                return i
        return -1

    c_fg = ci('finished good code')
    c_bom = ci('bom id')
    c_rm = ci('raw material code')
    c_sub = ci('sub bom id')
    c_desc = ci('description')
    c_qty = ci('quantity')
    c_level = ci('level')
    alt_cols = [i for i, h in enumerate(hdr) if h.startswith('alternate raw material code')]

    if c_bom < 0 or c_rm < 0:
        return None, {'reason': 'missing_required_columns'}

    from collections import defaultdict
    children = defaultdict(list)
    fg_order = []
    fg_bom_map = {}
    bom_level_map = {}

    for row in rows:
        def g(i):
            return row[i] if 0 <= i < len(row) else ''

        bom = _cell_text(g(c_bom))
        rm = _cell_text(g(c_rm))
        sub = _cell_text(g(c_sub)) if c_sub >= 0 else ''
        if not bom or (not rm and not sub):
            continue

        fg = _cell_text(g(c_fg)) if c_fg >= 0 else ''
        level = _cell_text(g(c_level)) if c_level >= 0 else ''
        if level:
            bom_level_map.setdefault(bom, level)
        if fg and fg not in fg_order:
            fg_order.append(fg)
        if fg:
            fg_bom_map.setdefault(fg, bom)

        children[bom].append({
            'code': rm or sub,
            'sub': sub,
            'qty': g(c_qty) if c_qty >= 0 else '',
            'level': level,
            'desc': _cell_text(g(c_desc)) if c_desc >= 0 else '',
            'alts': [_cell_text(g(i)) for i in alt_cols if _cell_text(g(i))],
        })

    if not children:
        return None, {'reason': 'no_bom_rows'}

    if not fg_order:
        fg_order = list(children.keys())
        fg_bom_map = {bom_id: bom_id for bom_id in fg_order}

    nid = [0]
    count = [0]
    MAX_NODES = 4000
    MAX_ALTS = 5

    def new_id():
        nid[0] += 1
        return f'n{nid[0]}'

    def build(bom_id, depth, seen):
        out = []
        for item in children.get(bom_id, []):
            if count[0] >= MAX_NODES:
                break
            count[0] += 1
            sub = item['sub']
            is_asm = bool(sub and sub in children and sub not in seen)
            kind = ('sfg' if depth == 0 else 'ssfg') if is_asm else 'component'
            node = {
                'id': new_id(),
                'label': item['code'],
                'qty': item['qty'],
                'level': bom_level_map.get(sub) if is_asm else item.get('level'),
                'bomId': sub or None,
                'kind': kind,
                'children': [],
            }
            for alt in item['alts'][:MAX_ALTS]:
                if count[0] >= MAX_NODES:
                    break
                count[0] += 1
                node['children'].append({
                    'id': new_id(),
                    'label': alt,
                    'kind': 'alternate',
                    'qty': None,
                    'level': item.get('level'),
                    'children': [],
                })
            if is_asm:
                node['children'].extend(build(sub, depth + 1, seen | {sub}))
            out.append(node)
        return out

    def build_fg(fg):
        fg_bom = fg_bom_map.get(fg) or (fg if fg in children else None)
        return {
            'id': new_id(),
            'label': fg,
            'kind': 'fg',
            'qty': None,
            'level': bom_level_map.get(fg_bom) if fg_bom else None,
            'bomId': fg_bom,
            'children': build(fg_bom, 0, {fg_bom}) if fg_bom else [],
        }

    sub_ids = {item['sub'] for items in children.values() for item in items if item['sub']}
    roots = [fg for fg in fg_order if fg_bom_map.get(fg) not in sub_ids] or fg_order[:1]
    if len(roots) == 1:
        tree = build_fg(roots[0])
    else:
        tree = {
            'id': 'root',
            'label': f'{len(roots)} finished goods',
            'kind': 'root',
            'qty': None,
            'bomId': None,
            'children': [build_fg(fg) for fg in roots],
        }

    return tree, {
        'finishedGoods': len(roots),
        'bomCount': len(children),
        'truncated': count[0] >= MAX_NODES,
    }


@api_view(['GET'])
def demo_bom_tree(request, session_id):
    """DEMO: parse the matched golden export .xlsx into a nested BOM tree for the
    Export BOM preview — Finished good → sub-assemblies → components → alternates,
    using the FactWise import columns (Finished good code, BOM ID, Level, Raw
    material code, Sub BOM ID, Quantity, Alternate raw material code…)."""
    try:
        import openpyxl
        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        headers, rows = read_session_grid(session_id, info)
        tree, meta = _build_bom_tree_from_table(headers or [], rows or [])
        source = 'grid'

        if not tree:
            source_headers, source_rows = _read_source_table_for_bom_preview(info)
            tree, meta = _build_bom_tree_from_table(source_headers, source_rows)
            source = 'source'

        if tree:
            return Response({
                'success': True,
                'tree': tree,
                'source': source,
                'finishedGoods': meta.get('finishedGoods', 0),
                'bomCount': meta.get('bomCount', 0),
                'truncated': meta.get('truncated', False),
            })

        chosen, matched_key = _match_demo_export_file(info)
        base = os.path.join(os.path.dirname(__file__), 'data', 'demo_exports')
        if not chosen or not os.path.exists(os.path.join(base, chosen)):
            return Response({'success': False, 'error': 'No BOM preview is available for this input yet.'},
                            status=status.HTTP_404_NOT_FOUND)
        # Some inputs download their golden sheet but intentionally have no preview yet.
        _no_prev = _demo_no_preview_keys()
        if matched_key is not None and re.sub(r'[^a-z0-9]', '', str(matched_key).lower()) in _no_prev:
            return Response({'success': False, 'error': 'No BOM preview is available for this input yet.'},
                            status=status.HTTP_404_NOT_FOUND)
        wb = openpyxl.load_workbook(os.path.join(base, chosen), read_only=True, data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not all_rows:
            return Response({'success': True, 'tree': None})
        # Some export sheets have preamble/instruction rows before the real header
        # row (e.g. BOM 5 has help text + a "Required, max 500…" row). Find the row
        # that actually holds the column names.
        header_idx = 0
        for idx, row in enumerate(all_rows[:15]):
            lowered = [str(c or '').strip().lower() for c in row]
            if 'raw material code' in lowered and 'bom id' in lowered:
                header_idx = idx
                break
        hdr = [str(h or '').strip().lower() for h in all_rows[header_idx]]

        def ci(*names):
            for i, h in enumerate(hdr):
                if h in names:
                    return i
            return -1
        c_fg, c_bom, c_level = ci('finished good code'), ci('bom id'), ci('level')
        c_rm, c_sub, c_desc, c_qty = ci('raw material code'), ci('sub bom id'), ci('description'), ci('quantity')
        alt_cols = [i for i, h in enumerate(hdr) if h.startswith('alternate raw material code')]

        from collections import defaultdict
        children = defaultdict(list)
        fg_order = []
        fg_bom_map = {}
        for r in all_rows[header_idx + 1:]:
            def g(i):
                return r[i] if (0 <= i < len(r)) else None
            bom = str(g(c_bom) or '').strip()
            rm = str(g(c_rm) or '').strip()
            sub = str(g(c_sub) or '').strip()
            # A row is a child if it names a raw material OR points to a sub-BOM. Sub-
            # assembly rows have an EMPTY raw material code (just a Sub BOM ID) — keep
            # them, or the whole sub-assembly hierarchy is lost.
            if not bom or (not rm and not sub):
                continue
            fg = str(g(c_fg) or '').strip()
            if fg and fg not in fg_order:
                fg_order.append(fg)
            if fg:
                fg_bom_map.setdefault(fg, bom)  # top BOM ID for this finished good
            alts = [str(g(i) or '').strip() for i in alt_cols if str(g(i) or '').strip()]
            children[bom].append({
                'code': rm or sub, 'sub': sub,
                'qty': g(c_qty), 'desc': str(g(c_desc) or '').strip(), 'alts': alts,
            })
        if not fg_order:
            return Response({'success': True, 'tree': None})

        nid = [0]
        count = [0]           # total nodes emitted (safety backstop; the preview is
        MAX_NODES = 4000      # collapsible, so it only renders expanded nodes)
        MAX_ALTS = 3          # alternates shown per component

        def new_id():
            nid[0] += 1
            return f'n{nid[0]}'

        def build(bom_id, depth, seen):
            out = []
            for item in children.get(bom_id, []):
                if count[0] >= MAX_NODES:
                    break
                count[0] += 1
                sub = item['sub']
                is_asm = bool(sub and sub in children and sub not in seen)
                kind = ('sfg' if depth == 0 else 'ssfg') if is_asm else 'component'
                node = {'id': new_id(), 'label': item['code'], 'qty': item['qty'],
                        'bomId': sub or None, 'kind': kind, 'children': []}
                for a in item['alts'][:MAX_ALTS]:
                    if count[0] >= MAX_NODES:
                        break
                    count[0] += 1
                    node['children'].append({'id': new_id(), 'label': a, 'kind': 'alternate', 'qty': None, 'children': []})
                if is_asm:
                    node['children'].extend(build(sub, depth + 1, seen | {sub}))
                out.append(node)
            return out

        def build_fg(fg):
            fg_bom = fg_bom_map.get(fg) or (fg if fg in children else None)
            return {'id': new_id(), 'label': fg, 'kind': 'fg', 'qty': None, 'bomId': None,
                    'children': build(fg_bom, 0, {fg_bom}) if fg_bom else []}

        # The TRUE finished goods are the FG codes that are NOT referenced as anyone's
        # Sub BOM ID — the others are sub-assemblies that also appear as their own
        # "Finished good code" block for their raw-material rows. Without this, each
        # sub-BOM wrongly showed up as a separate top-level finished good.
        sub_ids = {it['sub'] for lst in children.values() for it in lst if it['sub']}
        roots = [fg for fg in fg_order if fg not in sub_ids] or fg_order[:1]

        if len(roots) == 1:
            tree = build_fg(roots[0])
        else:
            # Multiple finished goods → group them under one root so the whole BOM shows.
            tree = {'id': 'root', 'label': f'{len(roots)} finished goods', 'kind': 'root',
                    'qty': None, 'bomId': None, 'children': [build_fg(fg) for fg in roots]}
        return Response({'success': True, 'tree': tree, 'file': chosen,
                         'finishedGoods': len(roots), 'truncated': count[0] >= MAX_NODES})
    except Exception as e:
        logger.error(f"demo_bom_tree failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def source_columns_preview(request, session_id):
    """
    List the raw source columns with a sample cell value each, so source-column
    dropdowns (e.g. the alternate-columns picker) can show what's inside — handy
    for Excel/PDF sources where the column name alone is ambiguous.
    """
    try:
        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        headers, rows, _ = read_session_source(session_id, info)
        headers = headers or []
        samples = {}
        for h in headers:
            for r in (rows or [])[:120]:
                v = r.get(h, '') if isinstance(r, dict) else ''
                v = str(v or '').strip()
                if v:
                    samples[h] = v[:40]
                    break
        return Response({'success': True, 'columns': headers, 'samples': samples})
    except Exception as e:
        logger.error(f"source_columns_preview failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def column_source_map(request, session_id):
    """
    For each destination column, report the source column mapped into it (and any
    default value). Lets the UI disambiguate duplicate-named columns in dropdowns
    — e.g. "Tag_1 (← Manufacturer)" vs "Tag_2 (← Designator)".
    """
    try:
        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)
        m = info.get('mappings')
        mlist = m.get('mappings') if isinstance(m, dict) else m
        sources = {}
        for it in (mlist or []):
            if not isinstance(it, dict):
                continue
            t = it.get('target')
            s = it.get('source')
            if t and s and t not in sources:  # first source per column
                sources[t] = s
        defaults = info.get('default_values') or {}
        return Response({'success': True, 'sources': sources, 'defaults': defaults})
    except Exception as e:
        logger.error(f"column_source_map failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def resolve_item_code(request):
    """
    Resolve blank and/or duplicate Item codes on the current grid, at export time.

    Item code is required AND must be unique in FactWise, but MPN-based codes are
    often blank on some rows, and CPN-based codes repeat heavily after MPN
    row-expansion. This fixes both, per the user's chosen strategy, writing onto
    the current grid so nothing else is disturbed.

    Request:
      column: 'Item code' (default)
      blank_strategy:     'prefix_sequence' | 'leave'
      duplicate_strategy: 'suffix' | 'prefix_sequence' | 'leave'
      prefix, separator ('-'), start (1), padding (0), increment (true)
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({'success': False, 'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({'success': False, 'error': 'Invalid session'}, status=status.HTTP_404_NOT_FOUND)

        column = str(request.data.get('column') or 'Item code').strip()
        blank_strategy = str(request.data.get('blank_strategy') or 'leave')
        duplicate_strategy = str(request.data.get('duplicate_strategy') or 'leave')
        prefix = str(request.data.get('prefix') or '')
        separator = str(request.data.get('separator') or '-')
        try:
            counter = int(request.data.get('start') or 1)
        except (TypeError, ValueError):
            counter = 1
        try:
            padding = max(0, int(request.data.get('padding') or 0))
        except (TypeError, ValueError):
            padding = 0
        increment_each_row = str(request.data.get('increment', True)).lower() not in {'false', '0', 'no', 'off'}

        headers, rows = read_session_grid(session_id, info)
        if not headers or rows is None:
            return Response({'success': False, 'error': 'No data for this session'}, status=status.HTTP_400_BAD_REQUEST)
        if column not in headers:
            return Response({'success': False, 'error': f'Column "{column}" is not in the grid'},
                            status=status.HTTP_400_BAD_REQUEST)

        idx = headers.index(column)
        # Same lock the Fill / Create Column dialog honours. Without it this
        # path renumbered sub-assemblies, and their codes are what the rest of
        # the BOM references.
        locked_codes = locked_identity_codes(info, headers, rows) if _template_label_key(column) in AUTHORED_FINISHED_GOOD_LOCKED_COLUMNS else set()
        # A set, not a counter: both passes below walk every row, so counting
        # each skip would report five protected rows as ten.
        locked_row_ids = set()
        used = set()
        for row in rows:
            v = str((row[idx] if idx < len(row) else '') or '').strip()
            if v:
                used.add(v)

        def next_code():
            nonlocal counter
            if not increment_each_row:
                num = str(counter).zfill(padding) if padding else str(counter)
                return f"{prefix}{num}"
            while True:
                num = str(counter).zfill(padding) if padding else str(counter)
                code = f"{prefix}{num}"
                counter += 1
                if code not in used:
                    used.add(code)
                    return code

        # Pass 1 — blanks.
        blanks_filled = 0
        for row in rows:
            while len(row) <= idx:
                row.append('')
            if str(row[idx] or '').strip() in locked_codes:
                locked_row_ids.add(id(row))
                continue
            if str(row[idx] or '').strip() == '':
                if blank_strategy == 'prefix_sequence':
                    row[idx] = next_code()
                    blanks_filled += 1

        # Pass 2 — duplicates (first occurrence kept; later ones resolved).
        dups_resolved = 0
        if duplicate_strategy == 'delete':
            # Delete the later duplicate ROWS entirely, keeping the first occurrence.
            # Detect duplicates on the EFFECTIVE Item code (apply any factwise_id rule),
            # so it matches the count the user saw and what would export.
            factwise_rules = info.get('factwise_rules') or []
            eff_headers, eff_rows = apply_factwise_id_to_grid(list(headers), [list(r) for r in rows], factwise_rules)
            eff_idx = eff_headers.index('Item code') if 'Item code' in eff_headers else idx
            effective = [
                str((eff_rows[i][eff_idx] if i < len(eff_rows) and eff_idx < len(eff_rows[i]) else '') or '').strip()
                for i in range(len(rows))
            ]
            seen_codes = set()
            kept = []
            for i, row in enumerate(rows):
                code = effective[i] if i < len(effective) else ''
                if code and code in seen_codes:
                    dups_resolved += 1
                    continue
                if code:
                    seen_codes.add(code)
                kept.append(row)
            rows = kept
        else:
            seen = {}
            for row in rows:
                v = str(row[idx] or '').strip()
                if not v:
                    continue
                if v in locked_codes:
                    # Its duplicate is the copy to rename, not this row.
                    seen.setdefault(v, 1)
                    locked_row_ids.add(id(row))
                    continue
                if v not in seen:
                    seen[v] = 1
                    continue
                seen[v] += 1
                if duplicate_strategy == 'suffix':
                    n = seen[v]
                    new_v = f"{v}{separator}{n}"
                    while new_v in used:
                        n += 1
                        new_v = f"{v}{separator}{n}"
                    seen[v] = n
                    used.add(new_v)
                    row[idx] = new_v
                    dups_resolved += 1
                elif duplicate_strategy == 'prefix_sequence':
                    row[idx] = next_code()
                    dups_resolved += 1

        write_session_grid(session_id, info, headers, rows)
        save_session(session_id, info)
        new_version = increment_template_version(session_id)

        logger.info(f"🆔 resolve_item_code on {session_id}: filled {blanks_filled} blanks, "
                    f"resolved {dups_resolved} duplicates ({blank_strategy}/{duplicate_strategy})")
        if locked_row_ids:
            logger.info(f"🔒 resolve_item_code left {len(locked_row_ids)} locked row(s) alone")
        return Response({'success': True, 'headers': headers, 'rows': len(rows),
                         'blanks_filled': blanks_filled, 'duplicates_resolved': dups_resolved,
                         'locked_rows_skipped': len(locked_row_ids),
                         'template_version': new_version})
    except Exception as e:
        logger.error(f"resolve_item_code failed: {e}", exc_info=True)
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def system_diagnostics(request):
    """Comprehensive system diagnostics for session persistence verification."""
    try:
        import psutil
        import os
        import platform
        from datetime import datetime, timedelta
        
        # System information with worker diagnostics
        system_info = {
            'platform': platform.platform(),
            'python_version': platform.python_version(),
            'cpu_count': psutil.cpu_count(),
            'memory_total_gb': round(psutil.virtual_memory().total / (1024**3), 2),
            'memory_used_gb': round(psutil.virtual_memory().used / (1024**3), 2),
            'pid': os.getpid(),
            'worker_id': os.environ.get('SERVER_SOFTWARE', 'Unknown'),
            'timestamp': datetime.utcnow().isoformat(),
        }
        
        # Session persistence analysis
        sessions_info = []
        session_files_count = 0
        
        if hybrid_file_manager.local_temp_dir.exists():
            session_files = list(hybrid_file_manager.local_temp_dir.glob("session_*.json"))
            session_files_count = len(session_files)
        
        for session_id, session_data in list(SESSION_STORE.items())[-10:]:  # Last 10 sessions
            session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
            sessions_info.append({
                'session_id': session_id[:8] + "...",  # Truncate for security
                'created': session_data.get('created'),
                'has_client_file': bool(session_data.get('client_path')),
                'has_template_file': bool(session_data.get('template_path')),
                'has_mappings': bool(session_data.get('mappings')),
                'template_modified': session_data.get('template_modified', False),
                'persisted_to_file': session_file.exists(),
            })
        
        # File system diagnostics
        file_system_info = {
            'temp_dir_exists': hybrid_file_manager.local_temp_dir.exists(),
            'upload_dir_exists': hybrid_file_manager.local_upload_dir.exists(),
            'temp_dir_path': str(hybrid_file_manager.local_temp_dir),
            'upload_dir_path': str(hybrid_file_manager.local_upload_dir),
        }
        
        # Azure storage diagnostics
        azure_available = hybrid_file_manager.azure_storage.is_available()
        
        # Session persistence health check
        persistence_health = {
            'memory_sessions_count': len(SESSION_STORE),
            'file_sessions_count': session_files_count,
            'universal_session_helpers_active': True,
            'single_worker_config_applied': True,
            'file_fallback_available': True,
        }
        
        # Fix status summary
        fix_status = {
            'issue_identified': 'Multi-worker Gunicorn session isolation',
            'primary_fix': 'Single worker configuration (workers=1)',
            'secondary_fix': 'Enhanced session persistence with file fallback',
            'affected_endpoints': ['/api/upload/', '/api/headers/{session_id}/', '/api/mapping/', '/api/data/'],
            'fix_applied': True,
            'expected_behavior': 'Sessions persist across all requests within same server instance',
            'deployment_required': True,
            'deployment_note': 'Restart Azure Web App to apply Gunicorn configuration changes',
        }
        
        return Response({
            'success': True,
            'system_info': system_info,
            'session_persistence': persistence_health,
            'file_system': file_system_info,
            'azure_storage_available': azure_available,
            'recent_sessions': sessions_info,
            'fix_status': fix_status,
            'diagnostics_timestamp': datetime.utcnow().isoformat(),
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'error': f'System diagnostics failed: {str(e)}',
            'timestamp': datetime.utcnow().isoformat(),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# Custom logging function for debugging template and default value issues
def debug_log(session_id, message, data=None, level='info'):
    """Enhanced logging for debugging template and default value issues"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    log_msg = f"[{timestamp}] 🔍 SESSION_{session_id}: {message}"
    if data is not None:
        log_msg += f" | DATA: {json.dumps(data, default=str)[:500]}"
    
    if level == 'error':
        logger.error(log_msg)
    elif level == 'warning':
        logger.warning(log_msg)
    else:
        logger.info(log_msg)

# Add this function near the top of the file, after imports
def get_next_available_tag_column(session_info, used_tag_columns=None):
    """
    Centralized function to get the next available Tag column name.
    This prevents duplicate Tag columns and ensures consistent numbering.

    CRITICAL: Checks used_tag_columns first (for mapped tags), then falls back to
    checking existing headers to avoid reusing tags with data.
    """
    if used_tag_columns is None:
        used_tag_columns = set()

    # Get existing Tag columns from headers
    existing_headers = session_info.get('current_template_headers', []) or session_info.get('enhanced_headers', []) or []
    existing_tag_columns = set([h for h in existing_headers if h.startswith('Tag_')])


    # Find next available number
    # Priority: Skip USED tags first, then skip EXISTING tags if they have data
    next_number = 1
    while True:
        tag_name = f'Tag_{next_number}'

        # Always skip if it's in used_tag_columns (mapped)
        if tag_name in used_tag_columns:
            next_number += 1
            continue

        # If it exists in headers but NOT in used_columns, we can potentially reuse it
        # BUT only if it's truly unmapped (used_tag_columns would be empty if no mappings exist yet)
        # In that case, skip existing tags too to avoid overwriting data
        if tag_name in existing_tag_columns and len(used_tag_columns) == 0:
            # No mappings exist yet (manual formula application), skip existing tags
            next_number += 1
            continue

        # Found an available tag!
        break

    return tag_name

def convert_internal_to_external_name(column_name):
    """
    Convert internal column names to external display names.
    Internal: Tag_1, Tag_2 -> External: Tag (always generic name)
    """
    if column_name.startswith('Tag_') or column_name == 'Tag':
        # Always show "Tag" regardless of how many tags exist
        return 'Tag'
    elif column_name.startswith('Specification_Name_') or column_name == 'Specification name':
        return 'Specification name'
    elif column_name.startswith('Specification_Value_') or column_name == 'Specification value':
        return 'Specification value'
    elif column_name.startswith('Custom_Identification_Name_') or column_name == 'Custom identification name':
        return 'Custom identification name'
    elif column_name.startswith('Custom_Identification_Value_') or column_name == 'Custom identification value':
        return 'Custom identification value'
    
    return column_name

def convert_external_to_internal_name(column_name, session_info, used_columns=None):
    """
    Convert external column names to internal names with proper numbering.
    External: Tag -> Internal: Tag_1, Tag_2, etc.
    """
    if used_columns is None:
        used_columns = set()
    
    if column_name == 'Tag':
        return get_next_available_tag_column(session_info, used_columns)
    elif column_name == 'Specification name':
        # Find next available spec number
        existing_headers = session_info.get('current_template_headers', []) or session_info.get('enhanced_headers', []) or []
        existing_spec_columns = [h for h in existing_headers if h.startswith('Specification_Name_')]
        next_number = 1
        while f'Specification_Name_{next_number}' in existing_spec_columns or f'Specification_Name_{next_number}' in used_columns:
            next_number += 1
        return f'Specification_Name_{next_number}'
    elif column_name == 'Specification value':
        # Find next available spec number
        existing_headers = session_info.get('current_template_headers', []) or session_info.get('enhanced_headers', []) or []
        existing_spec_columns = [h for h in existing_headers if h.startswith('Specification_Value_')]
        next_number = 1
        while f'Specification_Value_{next_number}' in existing_spec_columns or f'Specification_Value_{next_number}' in used_columns:
            next_number += 1
        return f'Specification_Value_{next_number}'
    elif column_name == 'Custom identification name':
        # Find next available customer number
        existing_headers = session_info.get('current_template_headers', []) or session_info.get('enhanced_headers', []) or []
        existing_customer_columns = [h for h in existing_headers if h.startswith('Custom_Identification_Name_')]
        next_number = 1
        while f'Custom_Identification_Name_{next_number}' in existing_customer_columns or f'Custom_Identification_Name_{next_number}' in used_columns:
            next_number += 1
        return f'Custom_Identification_Name_{next_number}'
    elif column_name == 'Custom identification value':
        # Find next available customer number
        existing_headers = session_info.get('current_template_headers', []) or session_info.get('enhanced_headers', []) or []
        existing_customer_columns = [h for h in existing_headers if h.startswith('Custom_Identification_Value_')]
        next_number = 1
        while f'Custom_Identification_Value_{next_number}' in existing_customer_columns or f'Custom_Identification_Value_{next_number}' in used_columns:
            next_number += 1
        return f'Custom_Identification_Value_{next_number}'
    
    return column_name


@api_view(['GET'])
def mpn_cache_stats(request):
    """Get global MPN cache statistics"""
    try:
        from .models import GlobalMpnCache

        stats = GlobalMpnCache.get_cache_stats()

        return Response({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        logger.error(f"Failed to get MPN cache stats: {e}")
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def mpn_cache_cleanup(request):
    """Clean up old MPN cache entries"""
    try:
        from .models import GlobalMpnCache

        # Get cleanup parameters
        cleanup_type = request.data.get('type', 'old')  # 'old' or 'invalid'
        days_old = request.data.get('days_old', 365 if cleanup_type == 'old' else 30)

        if cleanup_type == 'old':
            count = GlobalMpnCache.cleanup_old_entries(days_old=days_old)
            message = f"Cleaned up {count} old cache entries (>{days_old} days)"
        elif cleanup_type == 'invalid':
            count = GlobalMpnCache.cleanup_invalid_entries(days_old=days_old)
            message = f"Cleaned up {count} invalid cache entries (>{days_old} days)"
        else:
            return Response({
                'success': False,
                'error': 'Invalid cleanup type. Use "old" or "invalid".'
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message,
            'count': count
        })
    except Exception as e:
        logger.error(f"Failed to cleanup MPN cache: {e}")
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─── PROJECT MANAGEMENT ──────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
def project_list_create(request):
    """List existing projects or create a new one."""
    if request.method == 'GET':
        search = request.GET.get('search', '').strip()
        from django.db.models import Q
        projects = Project.objects.filter(status='ONGOING')
        if search:
            projects = projects.filter(
                Q(project_name__icontains=search) |
                Q(project_code__icontains=search)
            )
        projects = projects.order_by('-updated_at')[:50]
        return Response({
            'success': True,
            'projects': [p.to_dict() for p in projects]
        })

    elif request.method == 'POST':
        project_name = request.data.get('project_name', '').strip()
        project_code = request.data.get('project_code', '').strip()
        description = request.data.get('description', '').strip()

        if not project_name or not project_code:
            return Response({
                'success': False,
                'error': 'Project name and project code are required.'
            }, status=status.HTTP_400_BAD_REQUEST)

        if Project.objects.filter(project_code=project_code).exists():
            return Response({
                'success': False,
                'error': f'Project with code "{project_code}" already exists.'
            }, status=status.HTTP_400_BAD_REQUEST)

        project = Project.objects.create(
            project_name=project_name,
            project_code=project_code,
            description=description,
        )
        return Response({
            'success': True,
            'project': project.to_dict()
        }, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# BOM generation
# ---------------------------------------------------------------------------

def _normalized_records_from_grid(headers, rows):
    """Turn the session grid back into normalized-row dicts.

    The grid stores rows as lists because destination headers may repeat. The
    BOM generator wants dicts keyed by the normalizer's contract, so the first
    occurrence of each header wins — repeats only happen on destination
    template columns, never on the normalizer's own columns.
    """
    index_of = {}
    for position, header in enumerate(headers or []):
        name = str(header or '').strip()
        if name and name not in index_of:
            index_of[name] = position

    records = []
    for row in rows or []:
        record = {}
        for name, position in index_of.items():
            record[name] = row[position] if position < len(row) else ''
        records.append(record)
    return records


# Every field the BOM generator consumes, mapped from the normalizer's key to
# the destination-template header the editor shows it under. The two vocabularies
# are different — the editor speaks "Quantity", the generator speaks "quantity" —
# and matching is done through _template_label_key so case and spacing cannot
# break the join. Only `Item code` used to cross this bridge, which is why
# generating an ID showed up in validation and filling a quantity did not.
BOM_GRID_FIELDS = (
    ('Item code', 'Item code'),
    ('quantity', 'Quantity'),
    ('uom', 'Measurement unit'),
    ('description', 'Description'),
    ('mpn', 'MPN Code'),
    ('cpn', 'CPN Code'),
    ('manufacturer', 'Manufacturer'),
    ('level', 'Level'),
)


# Columns used to re-align the grid with the uploaded sheet after rows have been
# deleted. They have to be columns mapping copies across unchanged, so the two
# sides can be compared: `Item code` is no good because the editor generates it
# and the uploaded sheet's copy is still blank.
BOM_ALIGNMENT_FIELDS = (('cpn', 'CPN Code'), ('mpn', 'MPN Code'))

# Where a record's 1-based position in the editor's grid is stashed as it passes
# through generation, so validation can report a row the user can actually find.
# Underscored to keep it out of the normalizer's contract - it is transport, not
# data, and must never reach a generated sheet.
GRID_ROW_KEY = '__grid_row__'


def _greedy_subsequence(grid_keys, source_keys):
    """Match every grid key to a source key, in order, never reusing one."""
    matched = []
    cursor = 0
    for key in grid_keys:
        position = cursor
        while position < len(source_keys) and source_keys[position] != key:
            position += 1
        if position >= len(source_keys):
            return None
        matched.append(position)
        cursor = position + 1
    return matched


def _align_grid_to_records(grid_keys, source_keys):
    """Map each grid row to its source row when rows have been deleted.

    Deleting rows in the editor is the whole point of the editor, so it must not
    break BOM export. Row order is preserved by every editing tool, which makes
    the grid a *subsequence* of the uploaded sheet — and a subsequence can be
    matched even when individual keys repeat.

    The match is run from both ends and accepted only if the two agree. That is
    what makes a repeated key safe: with ``[A, B, A]`` in the sheet and ``[A]``
    left in the grid, matching from the left picks the first A and matching from
    the right picks the last, they disagree, and the caller is told rather than
    silently given the wrong row's structure.

    Returns source indices per grid row, or None when the alignment is
    impossible or ambiguous.
    """
    left = _greedy_subsequence(grid_keys, source_keys)
    if left is None:
        return None
    reversed_match = _greedy_subsequence(grid_keys[::-1], source_keys[::-1])
    if reversed_match is None:
        return None
    right = [len(source_keys) - 1 - position for position in reversed_match][::-1]
    return left if left == right else None


def _merge_grid_values_into_records(records, grid_headers, grid_rows):
    """Overlay the editor's grid onto the normalized records, by row position.

    The two halves of a BOM live in different places: ``parentKey``/``relation``
    only exist on the uploaded normalized sheet, while everything the user has
    since mapped, filled or corrected only exists in the mapped grid. Neither
    source has both, so they are joined by row position — mapping is
    row-preserving, so record *n* corresponds to grid row *n*.

    Authority is decided per *column*, not per cell. A column the grid actually
    carries is authoritative for every one of its rows, blanks included — the
    editor is what the user is looking at, so a quantity they cleared has to
    come out cleared and be caught by validation rather than quietly reverting
    to the uploaded value.

    "Carries" means the column exists in the grid AND has at least one non-blank
    value. A destination-template column that mapping never populated is empty
    for a different reason — nobody put anything there — and letting it win
    would wipe good data off the uploaded sheet.

    Returns ``(records, note)``. ``note['status'] == 'row_count_mismatch'`` means
    the join could not be trusted and NOTHING was applied — the caller must
    surface that, because silently falling back now discards real edits.
    """
    if not records or not grid_headers or not grid_rows:
        return records, {'status': 'no_grid'}

    index_of = {}
    for position, header in enumerate(grid_headers):
        key = _template_label_key(header)
        if key and key not in index_of:
            index_of[key] = position

    # Equal counts are matched by position. That stays tolerant of edits to the
    # alignment columns themselves — correcting an MPN in the editor must not
    # break export. It does assume the editor never re-orders rows.
    if len(grid_rows) == len(records):
        alignment = list(range(len(records)))
        deleted = []
    elif len(grid_rows) < len(records):
        key_columns = [(field, index_of.get(_template_label_key(header)))
                       for field, header in BOM_ALIGNMENT_FIELDS]
        key_columns = [(field, position) for field, position in key_columns if position is not None]
        alignment = None
        if key_columns:
            grid_keys = [
                tuple(str(row[position] or '').strip()
                      if isinstance(row, list) and position < len(row) else ''
                      for _field, position in key_columns)
                for row in grid_rows
            ]
            source_keys = [
                tuple(str(record.get(field) or '').strip() for field, _position in key_columns)
                for record in records
            ]
            alignment = _align_grid_to_records(grid_keys, source_keys)
        if alignment is None:
            return records, {
                'status': 'row_count_mismatch',
                'grid_rows': len(grid_rows),
                'source_rows': len(records),
            }
        matched = set(alignment)
        deleted = [position for position in range(len(records)) if position not in matched]
    else:
        # More rows in the editor than the sheet. A new row has no place in the
        # BOM structure — nothing says what it is a child of — so it cannot be
        # guessed at.
        return records, {
            'status': 'rows_added',
            'grid_rows': len(grid_rows),
            'source_rows': len(records),
        }

    columns = []
    skipped = []
    for field, header in BOM_GRID_FIELDS:
        position = index_of.get(_template_label_key(header))
        if position is None:
            continue
        populated = any(
            isinstance(row, list) and position < len(row) and str(row[position] or '').strip()
            for row in grid_rows
        )
        if populated:
            columns.append((field, position))
        else:
            skipped.append(header)
    if not columns:
        return records, {'status': 'no_matching_columns'}

    changed = {}
    kept = []
    for grid_position, (row, source_index) in enumerate(zip(grid_rows, alignment), start=1):
        record = records[source_index]
        # Stamped here because this is the only point where the two row spaces
        # are known to line up. Validation messages are useless without it: a
        # BOM row number indexes the *generated* sheet, which after grouping and
        # document exclusion is nothing like the row the user is looking at.
        record[GRID_ROW_KEY] = grid_position
        kept.append(record)
        if not isinstance(row, list):
            continue
        for field, position in columns:
            value = str(row[position] or '').strip() if position < len(row) else ''
            if str(record.get(field) or '').strip() == value:
                continue
            record[field] = value
            changed[field] = changed.get(field, 0) + 1

    # Only the rows still in the editor come back. A row the user deleted is
    # deleted — it does not belong in the BOM either.
    return kept, {
        'status': 'merged',
        'changed': changed,
        'empty_columns': skipped,
        'deleted_rows': len(deleted),
    }


def _has_normalizer_columns(records):
    """True when these rows came from the BOM Normalizer.

    ``parentKey`` and ``relation`` are what make alternates expressible, so a
    table without them cannot produce a correct BOM no matter what else it has.
    """
    if not records:
        return False
    first = records[0]
    return 'parentKey' in first and 'relation' in first


def _read_normalized_source_table(info):
    """Read the uploaded sheet using the session's own sheet/header settings."""
    try:
        source_path = hybrid_file_manager.get_file_path(info.get('client_path'))
        if not source_path:
            return [], []

        header_row = int(info.get('header_row') or 1)
        skiprows = max(0, header_row - 1)

        if str(source_path).lower().endswith('.csv'):
            df = read_delimited_text_safely(source_path, header=skiprows, dtype=object)
        else:
            df = pd.read_excel(
                source_path,
                sheet_name=info.get('sheet_name') or 0,
                skiprows=skiprows,
                dtype=object,
            )

        df = df.fillna('')
        headers = [str(column).strip() for column in df.columns]
        return headers, df.values.tolist()
    except Exception as exc:
        logger.warning(f"Could not read normalized source table: {exc}")
        return [], []


def _hierarchy_columns(records, answer):
    """Pick the level / code columns to derive a tree from.

    After normalization the rows are keyed by the normalizer's contract, so
    ``level`` and ``cpn`` are the usual answers. The user's own column name is
    the fallback for a sheet that reached generation without normalization.

    The tree is keyed on the *customer's* part number rather than ``Item code``,
    because item codes are generated later by the editor's Factwise ID rule and
    are still blank while the structure is being derived. The generator maps
    tree codes to item codes afterwards, so the two never have to agree here.
    """
    first = records[0] if records else {}
    level_column = 'level' if 'level' in first else (answer.get('levelColumn') or '')

    code_column = ''
    for candidate in ('cpn', 'Item code', 'mpn'):
        if candidate in first and any(str(r.get(candidate) or '').strip() for r in records):
            code_column = candidate
            break
    return level_column, code_column


def _generate_hierarchical_bom(records, answer, bom_header):
    """Derive a tree from levelled rows and generate its multi-level BOM.

    Returns (result, error_response); exactly one is set.
    """
    from .bom_tree import derive_tree, BomTreeError
    from .bom_generator import generate_multi_level_bom, split_primaries_and_alternates

    level_column, code_column = _hierarchy_columns(records, answer)
    if not level_column:
        return None, Response({
            'success': False,
            'error': 'No level column is available, so the BOM structure cannot be derived.',
            'needs': 'level_column',
        }, status=status.HTTP_400_BAD_REQUEST)
    if not code_column:
        return None, Response({
            'success': False,
            'error': ('No part number column has any values, so the BOM structure '
                      'cannot be derived.'),
            'needs': 'code_column',
        }, status=status.HTTP_400_BAD_REQUEST)

    # Alternates are the same BOM line from another manufacturer. They must not
    # become siblings in the tree, so the structure is derived from primaries and
    # the alternates are re-attached sideways by the generator.
    primary_of, alternates_of = split_primaries_and_alternates(records)
    primaries = [record for record in primary_of.values() if record] or records

    root = {
        'code': str(bom_header.get('finishedGoodCode') or '').strip(),
        'description': str(bom_header.get('itemName') or '').strip(),
        'uom': str(bom_header.get('measurementUnit') or '').strip(),
    }

    try:
        tree = derive_tree(
            primaries, level_column, code_column,
            description_column='description' if 'description' in (primaries[0] if primaries else {}) else None,
            quantity_column='quantity' if 'quantity' in (primaries[0] if primaries else {}) else None,
            uom_column='uom' if 'uom' in (primaries[0] if primaries else {}) else None,
            root=root,
            # Set by the normalizer only when the sheet states its parents. When
            # it is blank throughout, derive_tree falls back to level inference,
            # so level-only sheets take exactly the path they always did.
            parent_column='parent' if 'parent' in (primaries[0] if primaries else {}) else None,
            # The user's answer from the BOM structure gate. Absent on answers
            # saved before the checkbox existed, which keeps the old default.
            drop_documents=answer.get('dropDocuments', True) is not False,
        )
    except BomTreeError as exc:
        return None, Response({
            'success': False,
            'error': str(exc),
            'needs': 'tree_structure',
        }, status=status.HTTP_400_BAD_REQUEST)

    if not tree.is_valid:
        return None, Response({
            'success': False,
            'errors': tree.errors,
            'warnings': tree.warnings,
        }, status=status.HTTP_400_BAD_REQUEST)

    return generate_multi_level_bom(
        tree, bom_header, alternates_of, records, answer.get('subBoms') or {}
    ), None


def _generate_bom_for_session(session_id, apply_dup_policy=True):
    """Resolve a session's BOM answers and generate its sheets.

    Returns (result, bom_header, error_response). Exactly one of result /
    error_response is set. Flat versus hierarchical is decided by the answers
    captured in the BOM structure gate, so every caller routes identically.

    ``apply_dup_policy`` (default True) applies the session's stored
    ``bom_duplicate_policy`` (if any) to ``result.bom_rows`` before returning.
    The dup-policy detection endpoint calls this with ``apply_dup_policy=False``
    to see the RAW duplicate groups; every download / import / project-attach
    caller leaves it True so the policy is honoured.
    """
    from .bom_generator import (
        generate_flat_bom,
        apply_records_duplicate_policy,
        VALID_DUP_POLICIES,
    )

    info = get_session_consistent(session_id)
    if not info:
        return None, None, Response({'success': False, 'error': 'Invalid session'},
                                    status=status.HTTP_404_NOT_FOUND)

    sheets = (info.get('bom_structure') or {}).get('sheets') or {}
    answer = None
    for _sheet_name, sheet_answer in sheets.items():
        if not sheet_answer.get('hasBom'):
            continue
        # The user said this sheet is not tree-shaped, so no BOM is built from
        # it. That is the PM's step 4: refuse rather than guess a structure.
        if sheet_answer.get('bomGenerationAvailable') is False:
            return None, None, Response({
                'success': False,
                'error': ('This sheet was marked as not matching the BOM tree structure, '
                          'so a BOM is not generated for it.'),
                'needs': 'tree_confirmation',
            }, status=status.HTTP_400_BAD_REQUEST)
        answer = sheet_answer
        break

    if answer is None:
        return None, None, Response({
            'success': False,
            'error': 'No sheet in this upload was marked as containing a BOM.',
            'needs': 'bom_sheet',
        }, status=status.HTTP_400_BAD_REQUEST)

    is_hierarchical = bool(answer.get('hasLevels'))
    bom_header = answer.get('bomHeader')

    # A finished good is required either way. A flat sheet has no root at all; a
    # hierarchical sheet usually starts at level 1 and names its root in a
    # preamble above the table, which is not part of the data. Both are authored
    # in the BOM structure gate.
    if not bom_header:
        return None, None, Response({
            'success': False,
            'error': ('No finished good has been defined for this upload, so a BOM '
                      'cannot be generated yet.'),
            'needs': 'bom_header',
        }, status=status.HTTP_400_BAD_REQUEST)

    # The grid the user is looking at is the source of truth for values. It is
    # not the source of truth for *structure*, because mapping drops
    # `parentKey`/`relation` — they are not destination template columns. So the
    # uploaded sheet supplies the grouping and the grid is overlaid on top of it.
    # Generating from the uploaded sheet alone is what made every edit after
    # mapping invisible to BOM export.
    headers, rows = read_session_grid(session_id, info)

    # The authored finished good is an ITEM, not a source row.
    #
    # It has a place in the grid — the item directory has to contain the thing
    # the BOM builds — but it never came from the uploaded sheet, so it must not
    # take part in the grid↔source join below. That join is positional and
    # rejects any grid row the sheet does not have, so leaving it in made the
    # grid one row longer than the source and failed generation outright with
    # "rows added in the editor have no place in the BOM structure".
    #
    # It reaches the tree the proper way regardless: `root=` is passed to
    # derive_tree from the popup's answer, which is where a finished good the
    # sheet does not contain belongs.
    authored_codes = {
        str(good['code']).strip() for good in _authored_finished_goods(info)
    }
    authored_codes.discard('')
    # Only the APPENDED row, never a real one. A multi-level sheet contains its
    # own finished good, and that row IS a source row — it is the parent of
    # everything at the tier below. Matching on the code alone dropped it and
    # every child then reported `parent_not_found`. The appended row is the one
    # with no CPN: it was built from the popup's answer, not from a sheet row.
    if authored_codes and headers:
        code_index = _grid_column_index(headers, 'Item code')
        cpn_index = _grid_column_index(headers, 'CPN Code')
        if code_index >= 0:
            def is_appended(row):
                if not isinstance(row, list) or code_index >= len(row):
                    return False
                if str(row[code_index] or '').strip() not in authored_codes:
                    return False
                if cpn_index < 0:
                    return True
                return not str(
                    row[cpn_index] if cpn_index < len(row) else ''
                ).strip()
            rows = [row for row in (rows or []) if not is_appended(row)]

    records = _normalized_records_from_grid(headers or [], rows or [])
    if not _has_normalizer_columns(records):
        source_headers, source_rows = _read_normalized_source_table(info)
        source_records = _normalized_records_from_grid(source_headers, source_rows)
        if _has_normalizer_columns(source_records):
            source_records, join_note = _merge_grid_values_into_records(
                source_records, headers or [], rows or []
            )
            logger.info(f"BOM generation: grid join -> {join_note}")
            # Deleted rows are normal and handled. The two cases left are rows
            # the editor added, which have no place in the structure, and an
            # alignment too ambiguous to trust — both are reported rather than
            # guessed at, because guessing means giving a row another row's
            # parent.
            if join_note.get('status') == 'rows_added':
                return None, None, Response({
                    'success': False,
                    'error': (
                        'The editor has %d rows but the uploaded sheet has %d. Rows added '
                        'in the editor have no place in the BOM structure — nothing says '
                        'what they are part of. Add them in the BOM Normalizer instead, '
                        'or remove them before exporting.'
                        % (join_note.get('grid_rows', 0), join_note.get('source_rows', 0))
                    ),
                    'needs': 'rows_added',
                    'grid_rows': join_note.get('grid_rows', 0),
                    'source_rows': join_note.get('source_rows', 0),
                }, status=status.HTTP_400_BAD_REQUEST)
            if join_note.get('status') == 'row_count_mismatch':
                return None, None, Response({
                    'success': False,
                    'error': (
                        'The editor has %d rows and the uploaded sheet has %d, but the '
                        'remaining rows could not be matched to the sheet unambiguously. '
                        'This happens when CPN Code or MPN Code was edited on a row that '
                        'was also part of a deletion. Re-run the BOM Normalizer on the '
                        'current sheet, then export again.'
                        % (join_note.get('grid_rows', 0), join_note.get('source_rows', 0))
                    ),
                    'needs': 'row_count_mismatch',
                    'grid_rows': join_note.get('grid_rows', 0),
                    'source_rows': join_note.get('source_rows', 0),
                }, status=status.HTTP_400_BAD_REQUEST)
            records = source_records

    # Apply the duplicate-handling policy on the normalized records — AFTER
    # the grid ↔ source merge has succeeded, BEFORE tree derivation. Doing it
    # here (not on the raw grid) preserves the positional grid↔source join,
    # which needs the row counts to match; and doing it before the tree
    # builder prevents its own opportunistic same-parent same-code collapse
    # from hiding the same-level duplicates the user is trying to reshape.
    #
    # Default: aggregate_per_level. It's the only policy that produces a
    # correct BOM without needing a per-group target level pick — same-level
    # dups collapse into one summed row, across-level rows stay separate.
    if apply_dup_policy and records:
        stored_policy = (info.get('bom_duplicate_policy') or {})
        policy_name = stored_policy.get('policy')
        if policy_name not in VALID_DUP_POLICIES:
            policy_name = 'aggregate_per_level'
        per_group_levels = stored_policy.get('per_group_target_level') or {}
        per_group_qty = stored_policy.get('per_group_quantity') or {}
        try:
            records = apply_records_duplicate_policy(
                records, policy_name,
                per_group_target_level=per_group_levels,
                per_group_quantity=per_group_qty,
            )
        except Exception as dup_err:
            logger.warning('Records duplicate policy application failed: %s', dup_err)

    if is_hierarchical:
        result, error_response = _generate_hierarchical_bom(records, answer, bom_header)
        if error_response is not None:
            return None, None, error_response
    else:
        result = generate_flat_bom(records, bom_header)

    if not result.is_valid:
        return None, None, Response({
            'success': False,
            'errors': result.errors,
            'warnings': result.warnings,
        }, status=status.HTTP_400_BAD_REQUEST)

    return result, bom_header, None


@api_view(['GET'])
def generate_bom_sheet(request, session_id):
    """Generate the FactWise BOM sheet for a session from its normalized rows.

    Replaces the demo/golden-file path: everything returned here is built from
    what the user actually uploaded and normalized. Flat versus hierarchical is
    decided by the answers captured in the BOM structure gate.
    """
    from .bom_generator import bom_rows_as_lists

    result, _bom_header, error_response = _generate_bom_for_session(session_id)
    if error_response is not None:
        return error_response

    return Response({
        'success': True,
        'headers': result.bom_headers,
        'rows': bom_rows_as_lists(result),
        'item_headers': result.item_headers,
        'item_rows': result.item_rows,
        'stats': result.stats,
        'warnings': result.warnings,
    })


@api_view(['GET', 'POST', 'DELETE'])
def bom_duplicate_policy(request, session_id):
    """Detect duplicate BOM rows across / within levels, and store the user's
    chosen policy for how to handle them.

    A "duplicate" here is two or more BOM rows that describe the same physical
    part (identical on every column EXCEPT Level and Quantity). Same-level
    duplicates are usually a data error; across-level duplicates are usually
    a real modelling choice (a screw consumed in two sub-assemblies) that
    still deserves a deliberate collapse strategy.

    GET   -> returns { success, groups: [...], policy: {...} } where groups
             is the raw detection (unaffected by any stored policy). Empty
             list means nothing to ask the user.
    POST  -> body: { policy, per_group_target_level? }. Stores the choice on
             the session; every subsequent BOM download / import / project
             attach applies it via _generate_bom_for_session.
    DELETE -> clears the stored policy, so exports fall back to the raw sheet.
    """
    from .bom_generator import find_records_duplicate_groups, VALID_DUP_POLICIES

    info = get_session(session_id)
    if not info:
        return Response({'success': False, 'error': 'Invalid session'},
                        status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        if 'bom_duplicate_policy' in info:
            info.pop('bom_duplicate_policy', None)
            save_session(session_id, info)
        return Response({'success': True, 'policy': None})

    if request.method == 'POST':
        body = request.data or {}
        policy = str(body.get('policy') or '').strip()
        if policy not in VALID_DUP_POLICIES:
            return Response({
                'success': False,
                'error': ('Unknown policy %r. Expected one of: %s'
                          % (policy, ', '.join(sorted(VALID_DUP_POLICIES)))),
            }, status=status.HTTP_400_BAD_REQUEST)
        per_group = body.get('per_group_target_level') or {}
        if not isinstance(per_group, dict):
            return Response({
                'success': False,
                'error': 'per_group_target_level must be an object of {signature_id: level}.',
            }, status=status.HTTP_400_BAD_REQUEST)
        per_group_qty = body.get('per_group_quantity') or {}
        if not isinstance(per_group_qty, dict):
            return Response({
                'success': False,
                'error': 'per_group_quantity must be an object of {signature_id: quantity}.',
            }, status=status.HTTP_400_BAD_REQUEST)
        # Blanks are dropped rather than stored as "": an empty box in the
        # dialog means "no decision here, use the policy", and storing it would
        # read back as a decision to make the quantity zero.
        cleaned_qty = {}
        for key, value in per_group_qty.items():
            text = str(value).strip()
            if not text:
                continue
            try:
                float(text)
            except (TypeError, ValueError):
                return Response({
                    'success': False,
                    'error': 'Quantity for %r must be a number (decimals allowed).' % str(key),
                }, status=status.HTTP_400_BAD_REQUEST)
            cleaned_qty[str(key)] = text
        # Coerce every value to a string so the applier's ``==`` compares
        # cleanly regardless of whether the FE sent numbers or strings.
        info['bom_duplicate_policy'] = {
            'policy': policy,
            'per_group_target_level': {str(k): str(v) for k, v in per_group.items()},
            'per_group_quantity': cleaned_qty,
        }
        save_session(session_id, info)
        return Response({'success': True, 'policy': info['bom_duplicate_policy']})

    # GET: detect duplicates on the SAME records list the BOM generator will
    # see. That way signature_ids returned to the FE line up byte-for-byte
    # with what apply_records_duplicate_policy will act on.
    #
    # We call the generator with apply_dup_policy=False so the returned
    # ``result`` reflects the raw un-deduped tree. We then re-derive the
    # records list from the same session inputs the generator uses. Doing
    # this via the generator (rather than duplicating the grid ↔ source join
    # logic) keeps detection and application on the exact same shape.
    from .bom_generator import find_records_duplicate_groups as _detect
    result, _bh, error_response = _generate_bom_for_session(
        session_id, apply_dup_policy=False
    )
    if error_response is not None:
        # Generation failed (missing BOM structure, header, etc.) — no dup
        # groups to report. Return empty so the banner just stays hidden.
        return Response({
            'success': True,
            'groups': [],
            'policy': info.get('bom_duplicate_policy') or None,
        })
    # Rebuild the records list the generator saw. Cheapest way is to
    # re-derive from the session grid the same way _generate_bom_for_session
    # does — the generator doesn't return the intermediate records list.
    headers, rows = read_session_grid(session_id, info)
    from .bom_generator import (
        find_records_duplicate_groups,  # explicit import for clarity
    )
    # authored-FG filter mirrors _generate_bom_for_session so the record
    # list here matches what the generator ends up with.
    authored_codes = {
        str(good['code']).strip() for good in _authored_finished_goods(info)
    }
    authored_codes.discard('')
    if authored_codes and headers:
        code_index = _grid_column_index(headers, 'Item code')
        cpn_index = _grid_column_index(headers, 'CPN Code')
        if code_index >= 0:
            def _is_appended(row):
                if not isinstance(row, list) or code_index >= len(row):
                    return False
                if str(row[code_index] or '').strip() not in authored_codes:
                    return False
                if cpn_index < 0:
                    return True
                return not str(
                    row[cpn_index] if cpn_index < len(row) else ''
                ).strip()
            rows = [r for r in (rows or []) if not _is_appended(r)]
    records = _normalized_records_from_grid(headers or [], rows or [])
    if not _has_normalizer_columns(records):
        source_headers, source_rows = _read_normalized_source_table(info)
        source_records = _normalized_records_from_grid(source_headers, source_rows)
        if _has_normalizer_columns(source_records):
            source_records, _join = _merge_grid_values_into_records(
                source_records, headers or [], rows or []
            )
            records = source_records
    groups = find_records_duplicate_groups(records or [])
    return Response({
        'success': True,
        'groups': groups,
        'policy': info.get('bom_duplicate_policy') or None,
    })


@api_view(['GET', 'POST'])
def bom_revision_handoff(request, session_id):
    """Everything a caller needs to finish a revision this session started.

    The mapper does the first half of a revision — create the draft, retarget
    the sheet to the draft's code, upload it to blob storage — and then stops.
    It deliberately does NOT call ``bulk_import/process/`` or move the project's
    slots. Whoever picks this up does both, in that order.

    The ordering is the reason the slots are handed over rather than moved here:
    until the import is processed the new revision is an empty draft, so a slot
    pointed at it would be pointed at a BOM with no items in it.

    GET  -> the bundle, or 404 if this session never uploaded a revision.
    POST -> store the upload half. Body: bulkImportId, fileName, blobKey.

    The revision half is not posted: it is already on the session, because the
    BOM structure gate saved it as ``bom_structure.revision`` when the user
    answered the gate. Only the upload result has to come back from the browser.
    """
    info = get_session(session_id)
    if not info:
        return Response({'success': False, 'error': 'Invalid session'},
                        status=status.HTTP_404_NOT_FOUND)

    if request.method == 'POST':
        body = request.data or {}
        bulk_import_id = str(body.get('bulkImportId') or '').strip()
        if not bulk_import_id:
            return Response({'success': False, 'error': 'bulkImportId is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        info['bom_revision_handoff'] = {
            'bulk_import_id': bulk_import_id,
            'file_name': str(body.get('fileName') or '').strip(),
            'blob_key': str(body.get('blobKey') or '').strip(),
            # The draft the sheet was retargeted to and uploaded against. Not
            # the BOM the user picked — that one is now superseded.
            'enterprise_bom_id': str(body.get('enterpriseBomId') or '').strip(),
            'bom_code': str(body.get('bomCode') or '').strip(),
            'template_id': str(body.get('templateId') or '').strip(),
            'finished_good_id': str(body.get('finishedGoodId') or '').strip(),
            'entity_ids': [str(e) for e in (body.get('entityIds') or []) if e],
            'uploaded_at': datetime.now().isoformat(),
        }
        save_session(session_id, info)
        return Response({'success': True, 'handoff': info['bom_revision_handoff']})

    handoff = info.get('bom_revision_handoff')
    if not handoff:
        return Response({
            'success': False,
            'error': 'This session has not uploaded a BOM revision.',
        }, status=status.HTTP_404_NOT_FOUND)

    revision = (info.get('bom_structure') or {}).get('revision') or {}
    slots = revision.get('slots') or []

    # Four ids, flat. Everything here is something the caller cannot work out
    # for itself: the import to process, the draft to process it into, and the
    # project rows to point at that draft once it has.
    return Response({
        'success': True,
        'session_id': session_id,

        # The uuid bulk_import/process/ takes.
        'bulk_import_id': handoff.get('bulk_import_id'),

        # The BOM being revised INTO — the draft created by bom/admin/<id>/revise/
        # and the one the uploaded sheet was retargeted to. This is the
        # enterprise_bom_id that goes in the process/ body, and the one the
        # project slots move onto afterwards.
        'enterprise_bom_id': handoff.get('enterprise_bom_id'),

        # The revision it was created FROM — what the user picked, now
        # superseded. Top level rather than buried in details because the two
        # together are what a diff needs: show the user R4 against R5 and let
        # them decide before anything is committed.
        'superseded_enterprise_bom_id': revision.get('enterpriseBomId'),

        # Everything bulk_import/process/ needs, assembled. template_id,
        # finished_good_id and entity_ids all come off the draft's BOM detail,
        # which only the mapper fetched — they are not optional extras and the
        # import is rejected without them.
        'process_arguments': {
            'bulk_import_id': handoff.get('bulk_import_id'),
            'import_type': 'BOM_UPDATE',
            'enterprise_bom_id': handoff.get('enterprise_bom_id'),
            'template_id': handoff.get('template_id') or None,
            'finished_good_id': handoff.get('finished_good_id') or None,
            'entity_ids': handoff.get('entity_ids') or [],
        },

        # The generated sheet, readable. For the path where the user looks at
        # the diff and says no: nothing has been committed, but the work is not
        # thrown away — they can take the file. The blob SAS the upload used is
        # write-only and expired, so this serves it from the session instead.
        'sheet_download_url': f'/api/bom/download/{session_id}/',

        # The project holding the rows to move. Null when the user revised in
        # the BOM directory only and picked no project — then there is nothing
        # to move and bom_module_ids is empty.
        'project_id': revision.get('projectId'),

        # The project's own BOM uuids to revise onto the draft above. These are
        # LINKAGE ids (bom_module_id), not enterprise_bom_ids — the revise route
        # is the only one that names the parameter honestly, its siblings take
        # the same value under the name enterprise_bom_id.
        #
        # One PUT per id, sequentially with a fresh process_id each, and only
        # after the import has been processed: until then the draft has no items
        # and the slots would point at an empty BOM.
        'bom_module_ids': [
            slot.get('bomModuleId') for slot in slots if slot.get('bomModuleId')
        ],

        # Labels and context. Nothing here is required to finish the job — it is
        # what a confirmation screen needs to say which BOM, which project and
        # which file, without another round of lookups.
        'details': {
            'bom_code': handoff.get('bom_code'),
            'superseded_bom_code': revision.get('bomCode'),
            'base_bom_id': revision.get('baseBomId'),
            'project_code': revision.get('projectCode'),
            'project_name': revision.get('projectName'),
            'file_name': handoff.get('file_name'),
            'blob_key': handoff.get('blob_key'),
            'uploaded_at': handoff.get('uploaded_at'),
        },
    })


@api_view(['GET'])
def bom_tree(request, session_id):
    """Tree preview built from the generated BOM — not from a golden file.

    The generated table uses the real FactWise BOM columns, so the existing tree
    builder consumes it unchanged.
    """
    from .bom_generator import bom_rows_as_lists

    result, _bom_header, error_response = _generate_bom_for_session(session_id)
    if error_response is not None:
        return error_response

    tree, meta = _build_bom_tree_from_table(result.bom_headers, bom_rows_as_lists(result))
    if not tree:
        return Response({'success': False, 'error': 'The generated BOM produced no tree.'},
                        status=status.HTTP_404_NOT_FOUND)

    return Response({
        'success': True,
        'tree': tree,
        'source': 'generated',
        'finishedGoods': meta.get('finishedGoods', 0),
        'bomCount': meta.get('bomCount', 0),
        'truncated': meta.get('truncated', False),
        'stats': result.stats,
        'warnings': result.warnings,
    })


@api_view(['GET'])
def download_bom_sheet(request, session_id):
    """Download the generated BOM as .xlsx, laid out like the FactWise import.

    Layout matches FactWise's own admin export (what
    bom_revision_import_service and bom_revision_preview_service consume):

    - Sheet name: 'BOM Data' — bom_revision_preview_service.py falls back to
      workbook.active if the sheet is absent, but revision-import proper
      looks the sheet up by name, so being explicit is safer.
    - Rows 1-3: label / spacer rows (kept empty). The FactWise export puts a
      title in row 1 and instructions in rows 2-3, but the parsers only
      read HEADER_ROW=4, so blanks here work.
    - Row 4: column headers.
    - Row 5+: data rows.

    Previously this wrote headers at row 1 (no spacer rows, sheet named
    'BOM'), which meant every FactWise revision-import call — and Aditya's
    revision-preview endpoint — reported all 13 required columns as missing.
    """
    import openpyxl
    from django.http import HttpResponse
    from .bom_generator import bom_rows_as_lists

    result, _bom_header, error_response = _generate_bom_for_session(session_id)
    if error_response is not None:
        return error_response

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = 'BOM Data'
    # Rows 1-3: spacer. Column A gets a single space in row 3 so openpyxl
    # doesn't trim these rows on save — some readers (Aditya's included)
    # index by absolute row number and expect at least a physically-present
    # row above HEADER_ROW.
    sheet.cell(row=1, column=1, value=None)
    sheet.cell(row=2, column=1, value=None)
    sheet.cell(row=3, column=1, value=' ')
    for column_index, header in enumerate(result.bom_headers, start=1):
        sheet.cell(row=4, column=column_index, value=header)
    data_start_row = 5
    for row_offset, row_values in enumerate(bom_rows_as_lists(result)):
        for column_index, value in enumerate(row_values, start=1):
            sheet.cell(row=data_start_row + row_offset, column=column_index, value=value)

    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = 'attachment; filename="factwise_bom.xlsx"'
    workbook.save(response)
    return response



def _exported_item_rows(session_id):
    """The item rows the user would actually download, keyed by column name.

    Carries every exported column, not just the code. Validation needs the code
    to check references, but when two rows share a code it also has to say WHICH
    column disagrees - projecting to {'Item code': ...} threw that away and left
    the user told their rows "describe different parts" with no way to see how.

    Reads the same grid the item export writes, then adds the authored finished
    good exactly as the export does, so validation and the shipped file agree.
    Returns None when the grid cannot be read, and the caller falls back.
    """
    try:
        info = get_session_consistent(session_id)
        if not info:
            return None

        headers, rows = read_session_grid(session_id, info)
        if not headers:
            return None

        rows, headers = _append_authored_finished_good(info, list(rows or []), list(headers))
        # Level / Quantity / Base BOM Qty are per-BOM-line, not item attributes,
        # and the export strips them before collapsing. Leaving them in here made
        # the same part consumed in two places with different quantities compare
        # as two different items, so the gate blocked an export that ships fine.
        rows, headers = _drop_bom_columns(rows, headers)
        # Collapse exactly as the export does, so the duplicate rule fires on
        # what actually ships. Without this every part used in more than one
        # place reads as a duplicate item and blocks an export that is fine.
        rows, _conflicts = _dedupe_item_rows(rows, headers)

        code_index = -1
        for position, header in enumerate(headers):
            if _template_label_key(header) == _template_label_key('Item code'):
                code_index = position
                break
        if code_index < 0:
            return None

        # A grid may legitimately repeat a header, so later duplicates are
        # suffixed rather than silently overwriting the first.
        keys = []
        seen_headers = {}
        for header in headers:
            label = str(header or '').strip() or 'Column'
            seen_headers[label] = seen_headers.get(label, 0) + 1
            keys.append(label if seen_headers[label] == 1
                        else '%s #%d' % (label, seen_headers[label]))

        return [
            {key: str(row[position] or '').strip()
             for position, key in enumerate(keys) if position < len(row)}
            for row in rows
            if isinstance(row, list) and code_index < len(row)
        ]
    except Exception as exc:
        logger.warning(f"Could not read exported item rows for validation: {exc}")
        return None


@api_view(['GET'])
def validate_bom_sheet(request, session_id):
    """Validate the generated BOM against BOM rules only.

    Item-directory validation is a different ruleset and is not applied here:
    requiring `Item code` or `Item type` on a BOM row would report failures that
    are not real, and would hide the ones that are.
    """
    from .bom_generator import bom_rows_as_lists
    from .bom_validation import validate_bom

    result, _bom_header, error_response = _generate_bom_for_session(session_id)
    if error_response is not None:
        return error_response

    # Referential integrity has to be checked against the item directory the
    # user will actually download, not the generator's own copy of it. Checking
    # the copy is how a BOM can validate clean and still fail the FactWise
    # import on the second file.
    item_rows = _exported_item_rows(session_id) or result.item_rows

    report = validate_bom(
        result.bom_headers,
        bom_rows_as_lists(result),
        item_rows,
        bom_row_grid_rows=result.bom_row_grid_rows,
    )

    return Response({
        'success': True,
        'valid': not report['errors'],
        'errors': report['errors'],
        'warnings': report['warnings'] + result.warnings,
        'stats': report['stats'],
    })


# ---------------------------------------------------------------------------
# Import an edited sheet back into the same session
# ---------------------------------------------------------------------------

@api_view(['POST'])
def import_edited_sheet(request, session_id):
    """Replace a session's grid with an edited export of that same grid.

    Columns are matched by header NAME, not position, so reordering columns in
    Excel is safe. Columns the session does not know are ignored and reported
    rather than silently dropped; session columns absent from the upload keep
    their existing values, so a partial export cannot blank them.

    This writes into the current session, which is the point: mappings, tags and
    MPN validation stay attached instead of a re-upload creating a new session.
    """
    info = get_session_consistent(session_id)
    if not info:
        return Response({'success': False, 'error': 'Session not found'},
                        status=status.HTTP_404_NOT_FOUND)

    uploaded = request.FILES.get('file') or request.FILES.get('clientFile')
    if not uploaded:
        return Response({'success': False, 'error': 'No file was uploaded.'},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        name = str(uploaded.name or '').lower()
        if name.endswith('.csv'):
            raw_upload = uploaded.read()
            last_decode_error = None
            for encoding in ENCODINGS_TO_TRY:
                try:
                    frame = dataframe_from_delimited_text(raw_upload.decode(encoding), header=0, dtype=object)
                    break
                except (UnicodeDecodeError, UnicodeError) as exc:
                    last_decode_error = exc
                    continue
            else:
                raise last_decode_error or Exception("Could not decode CSV upload")
        else:
            frame = pd.read_excel(uploaded, dtype=object)
    except Exception as exc:
        logger.error(f"Import: could not read uploaded file: {exc}")
        return Response({'success': False, 'error': f'Could not read the file: {exc}'},
                        status=status.HTTP_400_BAD_REQUEST)

    frame = frame.fillna('')
    uploaded_headers = [str(column).strip() for column in frame.columns]
    uploaded_rows = frame.values.tolist()

    session_headers, session_rows = read_session_grid(session_id, info)
    session_headers = list(session_headers or [])
    session_rows = [list(row) for row in (session_rows or [])]

    if not session_headers:
        return Response({'success': False, 'error': 'This session has no grid to import into yet.'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Repeated headers (Tag, Specification name...) are matched left-to-right so
    # the Nth occurrence in the upload lands on the Nth occurrence in the grid.
    # Renamed destination columns are folded onto one key so a grid built before
    # the rename still matches a sheet exported after it (and vice versa).
    def _import_match_key(header):
        key = _template_label_key(header)
        return IMPORT_HEADER_ALIASES.get(key, key)

    remaining = {}
    for position, header in enumerate(session_headers):
        remaining.setdefault(_import_match_key(header), []).append(position)

    column_map = {}
    ignored = []
    for upload_position, header in enumerate(uploaded_headers):
        slots = remaining.get(_import_match_key(header))
        if slots:
            column_map[upload_position] = slots.pop(0)
        else:
            ignored.append(header)

    if not column_map:
        return Response({
            'success': False,
            'error': ('None of the uploaded columns match this sheet. '
                      'Export the sheet first, edit it, then import that file.'),
            'uploaded_columns': uploaded_headers[:20],
        }, status=status.HTTP_400_BAD_REQUEST)

    untouched = [session_headers[i] for slots in remaining.values() for i in slots]

    new_rows = []
    for upload_row in uploaded_rows:
        row = [''] * len(session_headers)
        for upload_position, session_position in column_map.items():
            value = upload_row[upload_position] if upload_position < len(upload_row) else ''
            row[session_position] = '' if value is None else str(value).strip()
        new_rows.append(row)

    # Columns missing from the upload keep their previous values where the row
    # still exists, so importing a trimmed export cannot wipe them out.
    if untouched:
        untouched_positions = [session_headers.index(h) for h in dict.fromkeys(untouched)]
        for index, row in enumerate(new_rows):
            if index < len(session_rows):
                for position in untouched_positions:
                    if position < len(session_rows[index]):
                        row[position] = session_rows[index][position]

    previous_row_count = len(session_rows)
    write_session_grid(session_id, info, session_headers, new_rows)
    save_session(session_id, info)
    increment_template_version(session_id)

    logger.info(
        f"Import: session {session_id} replaced {previous_row_count} rows with {len(new_rows)} "
        f"({len(column_map)} columns matched, {len(ignored)} ignored)"
    )

    return Response({
        'success': True,
        'imported_rows': len(new_rows),
        'previous_rows': previous_row_count,
        'matched_columns': len(column_map),
        'ignored_columns': ignored[:20],
        'untouched_columns': list(dict.fromkeys(untouched))[:20],
    })
