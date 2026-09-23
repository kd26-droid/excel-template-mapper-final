from pathlib import Path

import pandas as pd


ENCODINGS_TO_TRY = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1', 'windows-1252']
DELIMITER_CANDIDATES = [',', ';', '\t', '|']

# How many physical lines one record may absorb before the wrap reading is
# abandoned. A record CAN legitimately span many lines - a manufacturer list runs
# to a dozen - but a buffer that has swallowed forty and still has not reached
# the header's width is not a wrapped record, it is a row this parser cannot
# count. Without a bound it takes the rest of the file with it: one unterminated
# bracket has been measured collapsing 61 rows into 1.
MAX_WRAPPED_LINES = 40


def split_delimited_line_safely(line, delimiter, group_aware=True):
    """Split one line, honouring quotes and - while they balance - brackets.

    Brackets are treated as grouping so that a comma INSIDE one does not split a
    cell: THALES writes manufacturer references like `Y2552860 (B724, 26X6)`.
    That only holds while the brackets balance. `group_aware` is how the function
    tells itself they did not: a line ending mid-group was never grouped, and
    re-reading it on quotes alone is the honest fallback. Left standing, an
    unclosed bracket swallows every delimiter after it and the short row it
    produces then drags the following lines in through `_rejoin_wrapped_lines`.
    """
    cells = []
    current = []
    in_quotes = False
    group_depth = 0
    index = 0
    text = str(line or '')

    while index < len(text):
        char = text[index]

        if char == '"':
            if in_quotes and index + 1 < len(text) and text[index + 1] == '"':
                current.append(char)
                current.append(text[index + 1])
                index += 2
                continue
            # Treat a quote as structure only when it opens a cell or closes an
            # already quoted one. Supplier exports carry stray trailing quotes in
            # unquoted cells (`... [1126658]"`); letting those toggle quote mode
            # merged the rest of the file into one logical record.
            if in_quotes or not ''.join(current).strip():
                in_quotes = not in_quotes
            current.append(char)
            index += 1
            continue

        if not in_quotes:
            if group_aware:
                if char in '([{':
                    group_depth += 1
                elif char in ')]}' and group_depth > 0:
                    group_depth -= 1

            if char == delimiter and group_depth == 0:
                cells.append(_clean_cell(''.join(current)))
                current = []
                index += 1
                continue

        current.append(char)
        index += 1

    if group_aware and group_depth > 0:
        return split_delimited_line_safely(line, delimiter, group_aware=False)

    cells.append(_clean_cell(''.join(current)))
    return cells


def count_delimited_fields_safely(line, delimiter, group_aware=True):
    return len(split_delimited_line_safely(line, delimiter, group_aware=group_aware))


def detect_delimiter_safely(text):
    sample = [line for line in str(text or '').splitlines() if line.strip()][:25]
    if not sample:
        return ','

    best_delimiter = ','
    best_score = -1
    for delimiter in DELIMITER_CANDIDATES:
        counts = [count_delimited_fields_safely(line, delimiter) for line in sample]
        usable_counts = [count for count in counts if count > 1]
        if not usable_counts:
            continue

        target_width = max(set(usable_counts), key=usable_counts.count)
        consistency = sum(1 for count in counts if count == target_width)
        delimiter_hits = sum(str(line).count(delimiter) for line in sample)
        score = (target_width * 4) + (consistency * 3) + delimiter_hits

        if score > best_score:
            best_score = score
            best_delimiter = delimiter

    return best_delimiter


def decode_delimited_bytes(raw):
    """Decode delimited text, detecting UTF-16 before falling back to bytes-as-latin.

    Trying encodings in order and catching UnicodeDecodeError cannot find UTF-16:
    NUL is a valid UTF-8 codepoint, so a UTF-16 file "decodes" without raising
    into NUL-separated garbage, and latin-1 maps every byte so it never fails
    either. The BOM, or the parity of where the NULs fall, is the only reliable
    signal - so look for it first.
    """
    data = bytes(raw or b'')
    if data[:2] == b'\xff\xfe':
        return data.decode('utf-16le', errors='replace').lstrip('﻿')
    if data[:2] == b'\xfe\xff':
        return data.decode('utf-16be', errors='replace').lstrip('﻿')

    sample = data[:2000]
    even_nulls = sum(1 for index, byte in enumerate(sample) if byte == 0 and index % 2 == 0)
    odd_nulls = sum(1 for index, byte in enumerate(sample) if byte == 0 and index % 2 == 1)
    null_threshold = max(8, len(sample) * 0.1)
    if odd_nulls > null_threshold and odd_nulls > even_nulls * 3:
        return data.decode('utf-16le', errors='replace')
    if even_nulls > null_threshold and even_nulls > odd_nulls * 3:
        return data.decode('utf-16be', errors='replace')

    text = data.decode('utf-8', errors='replace')
    # A replacement char means the bytes were not UTF-8. These files are usually
    # latin-1, and reading them as UTF-8 mangles every accented character.
    return data.decode('iso-8859-1') if '�' in text else text


def read_delimited_text_safely(file_path, header=0, encoding=None, **kwargs):
    last_error = None

    if not encoding:
        try:
            text = decode_delimited_bytes(Path(file_path).read_bytes())
            return dataframe_from_delimited_text(text, header=header, **kwargs)
        except Exception as exc:
            last_error = exc

    encodings = [encoding] if encoding else ENCODINGS_TO_TRY
    for candidate_encoding in encodings:
        try:
            text = Path(file_path).read_text(encoding=candidate_encoding)
            return dataframe_from_delimited_text(text, header=header, **kwargs)
        except (UnicodeDecodeError, UnicodeError) as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = exc
            continue

    raise last_error or Exception("Could not read delimited text file")


def dataframe_from_delimited_text(text, header=0, **kwargs):
    delimiter = kwargs.pop('sep', None) or kwargs.pop('delimiter', None)
    kwargs.pop('engine', None)
    kwargs.pop('encoding', None)
    kwargs.pop('on_bad_lines', None)
    dtype = kwargs.pop('dtype', None)
    keep_default_na = kwargs.pop('keep_default_na', True)
    nrows = kwargs.pop('nrows', None)
    names = kwargs.pop('names', None)
    skiprows = kwargs.pop('skiprows', None)

    delimiter = detect_delimiter_safely(text) if delimiter in (None, 'infer') else delimiter
    # Blank lines are rows. Dropping them renumbers everything below, and row
    # numbers are the contract: `__sourceRow` is what a user's "row 12" means and
    # what every pattern answer is addressed by. Only a trailing run goes, since
    # that carries no rows - a file ending in a newline is not a file with an
    # extra empty record.
    raw_lines = str(text or '').splitlines()
    while raw_lines and not raw_lines[-1].strip():
        raw_lines.pop()
    if not raw_lines:
        return pd.DataFrame(columns=names or [])

    first_populated = next((line for line in raw_lines if line.strip()), raw_lines[0])
    expected_width = count_delimited_fields_safely(first_populated, delimiter)
    lines = _rejoin_wrapped_lines(raw_lines, delimiter, expected_width)
    rows = [split_delimited_line_safely(line, delimiter) for line in lines]
    if not rows:
        return pd.DataFrame(columns=names or [])

    unwrapped = _unwrap_single_column_records(rows, delimiter)
    if unwrapped is not None:
        return dataframe_from_delimited_text(
            '\n'.join(unwrapped),
            header=header,
            dtype=dtype,
            keep_default_na=keep_default_na,
            nrows=nrows,
            names=names,
            skiprows=skiprows,
            **kwargs
        )

    # Before the header is chosen, so `header=0` means the first row that
    # survives - what pandas does, and what the paginated readers in views.py
    # assume when they pass a range of physical line numbers.
    rows = _apply_skiprows(rows, skiprows)
    if not rows:
        return pd.DataFrame(columns=names or [])

    if header is None:
        data_rows = rows
        columns = list(names) if names is not None else _default_columns(_max_width(data_rows))
    else:
        header_index = int(header or 0)
        if header_index >= len(rows):
            return pd.DataFrame(columns=names or [])
        columns = list(names) if names is not None else _normalize_columns(rows[header_index])
        data_rows = rows[header_index + 1:]

    if nrows is not None:
        data_rows = data_rows[:int(nrows)]

    width = max(len(columns), _max_width(data_rows))
    if len(columns) < width:
        columns = columns + [f'Unnamed: {index}' for index in range(len(columns), width)]
    normalized_rows = [_normalize_row(row, width) for row in data_rows]

    df = pd.DataFrame(normalized_rows, columns=columns[:width])
    if dtype is not None:
        try:
            df = df.astype(dtype)
        except Exception:
            pass
    if not keep_default_na:
        df = df.fillna('')
    return df


def _unwrap_single_column_records(rows, outer_delimiter):
    """
    Excel re-saves a semicolon/tab export by quoting each whole record and padding
    the row with commas, so the file parses into one populated column whose cells
    still hold the original delimited record. Where the record itself contained the
    comma - a "MN1, MN2, MN7" reference list, a European decimal - Excel split it
    there too, leaving a row of fragments. Joining a row's cells back with the
    separator that split them rebuilds the record either way. Returns None when the
    file genuinely splits into columns, which is the normal case.
    """
    if len(rows) < 2:
        return None

    single_cell_rows = 0
    populated_rows = 0
    records = []
    for row in rows:
        cells = [str(cell) if cell is not None else '' for cell in row]
        populated = [cell for cell in cells if cell.strip()]
        # A blank line is a row of its own now, but it says nothing about whether
        # the file split into columns. Counting one as "at most one populated
        # cell" would push any sparse file over the threshold and invent columns.
        if populated:
            populated_rows += 1
            if len(populated) <= 1:
                single_cell_rows += 1
        # Interior blanks are real empty columns; only the padding run at the end goes.
        end = len(cells)
        while end > 0 and not cells[end - 1].strip():
            end -= 1
        records.append(outer_delimiter.join(cells[:end]))

    # Most rows carrying at most one populated cell is the wrapper's signature: the
    # record never really split into columns. Rows broken by a comma inside the
    # record are the minority, so this stays true for them.
    if populated_rows < 2 or single_cell_rows < populated_rows * 0.6:
        return None

    # Only retry when the recovered records form a table on a DIFFERENT separator.
    # If the same one wins again, the quoting was deliberate - a one-column file of
    # values that contain commas - and unwrapping would invent columns.
    return records if _splits_on_other_delimiter(records, outer_delimiter) else None


def _splits_on_other_delimiter(records, outer_delimiter):
    sample = records[:25]
    if len(sample) < 2:
        return False

    delimiter = detect_delimiter_safely('\n'.join(sample))
    if delimiter == outer_delimiter:
        return False

    widths = [count_delimited_fields_safely(record, delimiter) for record in sample]
    usable = [width for width in widths if width > 1]
    if not usable:
        return False

    target_width = max(set(usable), key=usable.count)
    agreeing = sum(1 for width in widths if width == target_width)
    return target_width > 1 and agreeing >= max(2, len(sample) // 2)


def _rejoin_wrapped_lines(lines, delimiter, expected_width):
    """Rebuild records that an unquoted newline split across physical lines.

    A line carrying fewer fields than the header is a continuation of the one
    above - SAP and THALES ARTDOC exports both do this. Two things keep that from
    running away: a blank line between records is a record of its own rather than
    a continuation, and a buffer that has held MAX_WRAPPED_LINES without reaching
    the header's width is given up on. Giving up costs one short row; not giving
    up costs every row after it.
    """
    if expected_width < 2:
        return lines

    joined = []
    buffer = None
    held = 0
    for line in lines:
        if buffer is None and not line.strip():
            joined.append(line)
            continue

        buffer = line if buffer is None else f'{buffer}\n{line}'
        held += 1
        if count_delimited_fields_safely(buffer, delimiter) >= expected_width:
            joined.append(buffer)
            buffer = None
            held = 0
            continue
        if held >= MAX_WRAPPED_LINES:
            joined.append(buffer)
            buffer = None
            held = 0

    if buffer is not None:
        joined.append(buffer)
    return joined


def _apply_skiprows(rows, skiprows):
    """Drop rows by position, the way pandas' `skiprows` does.

    An int skips that many leading rows; an iterable drops those 0-based
    positions. Anything unrecognised is ignored rather than raising - this reader
    is a drop-in for `pd.read_csv` on files pandas cannot handle, and a caller
    that passes something odd should get a frame, not a traceback.
    """
    if skiprows is None or isinstance(skiprows, bool):
        return rows
    if isinstance(skiprows, int):
        return rows[max(0, skiprows):]
    try:
        dropped = {int(index) for index in skiprows}
    except (TypeError, ValueError):
        return rows
    return [row for index, row in enumerate(rows) if index not in dropped]


def _clean_cell(value):
    text = str(value or '').strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        text = text[1:-1]
    return text.replace('""', '"')


def _normalize_columns(values):
    columns = []
    for index, value in enumerate(values):
        column = str(value or '').strip()
        columns.append(column or f'Unnamed: {index}')
    return columns


def _default_columns(width):
    return list(range(max(width, 0)))


def _max_width(rows):
    return max((len(row) for row in rows), default=0)


def _normalize_row(row, width):
    normalized = list(row[:width])
    if len(normalized) < width:
        normalized.extend([''] * (width - len(normalized)))
    return normalized
