from pathlib import Path

import pandas as pd


ENCODINGS_TO_TRY = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1', 'windows-1252']
DELIMITER_CANDIDATES = [',', ';', '\t', '|']


def split_delimited_line_safely(line, delimiter):
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
            in_quotes = not in_quotes
            current.append(char)
            index += 1
            continue

        if not in_quotes:
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

    cells.append(_clean_cell(''.join(current)))
    return cells


def count_delimited_fields_safely(line, delimiter):
    return len(split_delimited_line_safely(line, delimiter))


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


def read_delimited_text_safely(file_path, header=0, encoding=None, **kwargs):
    encodings = [encoding] if encoding else ENCODINGS_TO_TRY
    last_error = None

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

    delimiter = detect_delimiter_safely(text) if delimiter in (None, 'infer') else delimiter
    raw_lines = [line for line in str(text or '').splitlines() if line.strip()]
    if not raw_lines:
        return pd.DataFrame(columns=names or [])

    expected_width = count_delimited_fields_safely(raw_lines[0], delimiter)
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
            **kwargs
        )

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
    still hold the original delimited record. Hand those records back so the
    delimiter can be sniffed again on what the row actually is. Returns None when
    the file genuinely splits into columns, which is the normal case.
    """
    if len(rows) < 2:
        return None

    records = []
    for row in rows:
        filled = [str(cell).strip() for cell in row if str(cell or '').strip()]
        if len(filled) != 1:
            return None
        records.append(filled[0])

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
    if expected_width < 2:
        return lines

    joined = []
    buffer = None
    for line in lines:
        buffer = line if buffer is None else f'{buffer}\n{line}'
        if count_delimited_fields_safely(buffer, delimiter) >= expected_width:
            joined.append(buffer)
            buffer = None

    if buffer is not None:
        joined.append(buffer)
    return joined


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
