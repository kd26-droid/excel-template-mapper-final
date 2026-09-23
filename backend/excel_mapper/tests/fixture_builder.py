"""Real .xlsx and .csv fixtures for the file-reading code paths.

Every fixture is *generated*, not committed as binary, so that what a fixture
means - which row is struck, which cells are merged, which encoding it is in -
is readable as code and shows up in a diff. Byte-exactness is preserved where it
matters: the encoding fixtures build `bytes` directly rather than letting a
writer choose.

Callers pass a directory (normally a `tempfile.TemporaryDirectory`) and get back
a path. Nothing here writes into the repo.

Used by test_delimited_reader, test_sheet_reader, test_upload_pipeline and
test_cell_styles - the file-reading paths that had no tests at all before.
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill


# The same little BOM underlies most fixtures, so a test that changes one
# variable (encoding, a stray quote, a blank line) is comparing like with like.
BASE_HEADERS = ["Item Code", "Description", "Qty", "Manufacturer"]
BASE_ROWS = [
    ["R-1002", "10k resistor 0805", "4", "YAGEO"],
    ["C-3310", "100nF capacitor", "12", "MURATA"],
    ["D-7781", "Schottky diode", "8", "VISHAY"],
]


def write_bytes(directory, name, data):
    """Write raw bytes and return the path. The encoding fixtures need this."""
    path = Path(directory) / name
    path.write_bytes(data)
    return str(path)


def _csv_text(headers=None, rows=None, delimiter=","):
    lines = [delimiter.join(headers if headers is not None else BASE_HEADERS)]
    lines.extend(
        delimiter.join(row) for row in (rows if rows is not None else BASE_ROWS)
    )
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# CSV fixtures
# --------------------------------------------------------------------------

def csv_plain(directory, name="plain.csv"):
    """4 physical lines, 1 header + 3 data. The control for every other case."""
    return write_bytes(directory, name, _csv_text().encode("utf-8"))


def csv_interior_blank_rows(directory, name="interior_blanks.csv"):
    """A blank line between data rows.

    Physical lines: 1 header, 1 data, 1 blank, 2 data = 5. Any reader that drops
    the blank reports 4 and every `__sourceRow` after it is off by one.
    """
    text = "\n".join([
        ",".join(BASE_HEADERS),
        ",".join(BASE_ROWS[0]),
        "",
        ",".join(BASE_ROWS[1]),
        ",".join(BASE_ROWS[2]),
    ]) + "\n"
    return write_bytes(directory, name, text.encode("utf-8"))


def csv_unclosed_bracket(directory, name="unclosed_bracket.csv"):
    """A cell opens `(` and never closes it - THALES writes `Y2552860 (B724, 26X6)`.

    Bracket-aware splitting stops treating commas as delimiters after the `(`, so
    without a fallback the row collapses to fewer fields than the header has.
    """
    rows = [
        BASE_ROWS[0],
        ["C-3310", "Y2552860 (B724, 26X6", "12", "MURATA"],
        BASE_ROWS[2],
    ]
    return write_bytes(directory, name, _csv_text(rows=rows).encode("utf-8"))


def csv_stray_trailing_quote(directory, name="stray_quote.csv"):
    """An unbalanced `"` at the end of an unquoted cell (`... [1126658]"`).

    Toggling quote mode on it swallows the rest of the line, and then the
    following lines when the rejoin tries to reach the header's width.
    """
    rows = [
        ["R-1002", 'Alt ref [1126658]"', "4", "YAGEO"],
        BASE_ROWS[1],
        BASE_ROWS[2],
    ]
    return write_bytes(directory, name, _csv_text(rows=rows).encode("utf-8"))


def csv_runaway_record(directory, name="runaway.csv", tail_rows=60):
    """One unterminated bracket followed by many good rows.

    Unbounded line-rejoining absorbs the whole tail into a single record, so the
    cost of one bad cell is every row after it.
    """
    lines = [",".join(BASE_HEADERS), "R-1002,Ref (B724,4,YAGEO"]
    lines.extend(
        f"P-{index:04d},Part {index},1,YAGEO" for index in range(tail_rows)
    )
    return write_bytes(directory, name, ("\n".join(lines) + "\n").encode("utf-8"))


def csv_wrapped_record(directory, name="wrapped.csv"):
    """A record genuinely split across two physical lines by an unquoted newline.

    SAP and THALES ARTDOC exports do this. Rejoining is correct here - the test
    is that it still happens once blank-line preservation lands.
    """
    text = "\n".join([
        ",".join(BASE_HEADERS),
        "R-1002,10k resistor",
        "0805,4,YAGEO",
        ",".join(BASE_ROWS[1]),
    ]) + "\n"
    return write_bytes(directory, name, text.encode("utf-8"))


def csv_title_block_header_row_4(directory, name="title_block.csv"):
    """Header on physical row 4, under a report caption and a blank line.

    This is the shape header detection exists for, and the blank line on row 3
    is exactly what a reader that strips blanks gets wrong.
    """
    text = "\n".join([
        "Part list for Assembly X",
        "Report date 2026-09-22",
        "",
        ",".join(BASE_HEADERS),
        ",".join(BASE_ROWS[0]),
        ",".join(BASE_ROWS[1]),
        ",".join(BASE_ROWS[2]),
    ]) + "\n"
    return write_bytes(directory, name, text.encode("utf-8"))


def csv_excel_rewrapped_semicolon(directory, name="excel_rewrapped.csv"):
    """Excel re-saved a semicolon export: each record quoted whole, comma-padded.

    The reader should unwrap this back into real columns.
    """
    text = "\n".join([
        '"Item Code;Description;Qty;Manufacturer",,,',
        '"R-1002;10k resistor 0805;4;YAGEO",,,',
        '"C-3310;100nF capacitor;12;MURATA",,,',
        '"D-7781;Schottky diode;8;VISHAY",,,',
    ]) + "\n"
    return write_bytes(directory, name, text.encode("utf-8"))


def csv_single_column_with_commas(directory, name="single_column.csv"):
    """The do-not-unwrap negative: one real column whose values contain commas.

    Shaped like the Excel-rewrapped case, but unwrapping would invent columns.
    """
    text = "\n".join([
        '"Refs"',
        '"MN1, MN2, MN7"',
        '"MN3, MN4"',
        '"MN5, MN6, MN8"',
    ]) + "\n"
    return write_bytes(directory, name, text.encode("utf-8"))


def csv_utf16le_with_bom(directory, name="utf16_bom.csv"):
    """UTF-16LE with a byte-order mark - what Excel writes as "Unicode Text"."""
    return write_bytes(directory, name, _csv_text().encode("utf-16"))


def csv_utf16le_no_bom(directory, name="utf16_no_bom.csv"):
    """UTF-16LE with no BOM.

    The trap: decoding these bytes as UTF-8 does not raise - NUL is a valid
    codepoint - so an encoding loop that only catches UnicodeDecodeError accepts
    garbage on the first attempt and never reaches a working encoding.
    """
    return write_bytes(directory, name, _csv_text().encode("utf-16-le"))


def csv_latin1_accented(directory, name="latin1.csv"):
    """Accented headers in latin-1. Decoding as UTF-8 raises, so the fallback runs."""
    headers = ["Référence", "Désignation", "Qté", "Fabricant"]
    rows = [
        ["R-1002", "Résistance 10k", "4", "YAGEO"],
        ["C-3310", "Condensateur 100nF", "12", "MURATA"],
    ]
    return write_bytes(
        directory, name, _csv_text(headers, rows).encode("latin-1")
    )


# --------------------------------------------------------------------------
# XLSX fixtures
# --------------------------------------------------------------------------

def _save(workbook, directory, name):
    path = Path(directory) / name
    workbook.save(path)
    return str(path)


def xlsx_plain(directory, name="plain.xlsx", sheet_title="Sheet1"):
    """Header on row 1. The control."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_title
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    return _save(workbook, directory, name)


def xlsx_header_row_4(directory, name="header_row_4.xlsx"):
    """Header on row 4 under a title block - the normal BOM shape."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Part list for Assembly X"])
    sheet.append(["Report date 2026-09-22"])
    sheet.append([])
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    return _save(workbook, directory, name)


def xlsx_merged_title_banner(directory, name="merged_banner.xlsx", width=12):
    """A merged title spanning `width` columns above the real header.

    Expanding merges before detection turns this banner into `width` identical
    filled cells, which can outscore the real header. Detection must therefore
    run on unexpanded rows.
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.cell(row=1, column=1, value="ASSEMBLY X - PRODUCTION BILL OF MATERIALS")
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
    for index, header in enumerate(BASE_HEADERS, start=1):
        sheet.cell(row=2, column=index, value=header)
    for offset, row in enumerate(BASE_ROWS, start=3):
        for index, value in enumerate(row, start=1):
            sheet.cell(row=offset, column=index, value=value)
    return _save(workbook, directory, name)


def xlsx_struck_rows(directory, name="struck.xlsx", struck_row=3):
    """One data row struck through - the usual "this line is deleted" marking."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    for cell in sheet[struck_row]:
        cell.font = Font(strike=True)
    return _save(workbook, directory, name)


def xlsx_red_font_rows(directory, name="red_font.xlsx", red_row=3):
    """One data row in red text. FFCC0000 clears the r>=180/g<=100/b<=100 test."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    for cell in sheet[red_row]:
        cell.font = Font(color="FFCC0000")
    return _save(workbook, directory, name)


def xlsx_red_fill_rows(directory, name="red_fill.xlsx", red_row=3):
    """One data row with a red background fill rather than red text."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    fill = PatternFill(fill_type="solid", start_color="FFCC0000", end_color="FFCC0000")
    for cell in sheet[red_row]:
        cell.fill = fill
    return _save(workbook, directory, name)


def xlsx_outline_levels(directory, name="outline.xlsx"):
    """Row grouping, header on row 1. Levels are the sheet's own hierarchy."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    sheet.row_dimensions[3].outlineLevel = 2
    sheet.row_dimensions[4].outlineLevel = 2
    return _save(workbook, directory, name)


def xlsx_outline_levels_header_row_4(directory, name="outline_header_row_4.xlsx"):
    """Outline levels AND a header that is not row 1.

    The combination that breaks the synthetic level column: its label is written
    at dataframe position 0, which is the preamble, so the real header row gets a
    digit and the column ends up named "1".
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Part list for Assembly X"])
    sheet.append(["Report date 2026-09-22"])
    sheet.append([])
    sheet.append(BASE_HEADERS)
    for row in BASE_ROWS:
        sheet.append(row)
    sheet.row_dimensions[6].outlineLevel = 2
    sheet.row_dimensions[7].outlineLevel = 2
    return _save(workbook, directory, name)
