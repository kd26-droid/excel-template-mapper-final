"""
Coordinate-based table extraction.

Some PDFs render as clean visual columns but expose a flattened or unreliable
text order, so rule/heuristic parsing mis-splits them. The words themselves,
however, carry accurate x/y positions. This module rebuilds a table purely from
those positions and a set of user-supplied column x-ranges (drawn as column
zones): each word is bucketed into a column by its horizontal position and into
a row by its line, so blank cells stay blank and rows never desync.

Nothing here knows about any particular document, column name, or customer. The
caller supplies the column ranges (from drawn zones) and the positioned words
(from any provider — a PDF text layer, OCR, etc.).
"""

from typing import List, Tuple, Dict, Any, Optional


Word = Dict[str, Any]          # {'text', 'x0', 'x1', 'top', 'bottom'}
Range = Tuple[float, float]    # (x_start, x_end)


def derive_column_cuts(column_ranges: List[Range]) -> List[float]:
    """
    Turn column x-ranges into the vertical cut lines between them.

    A cut sits in the middle of the gap between two adjacent columns, so a word
    is judged by which side of the gap it falls on. This tolerates imprecise
    drawing: the zones mark roughly where columns are, the cuts land in the
    whitespace between them.
    """
    ordered = sorted(column_ranges, key=lambda r: r[0])
    return [(ordered[i][1] + ordered[i + 1][0]) / 2.0 for i in range(len(ordered) - 1)]


def column_of(center_x: float, cuts: List[float]) -> int:
    """Column index for a word center, given the cut lines."""
    for i, cut in enumerate(cuts):
        if center_x < cut:
            return i
    return len(cuts)


def cluster_lines(words: List[Word], tol_ratio: float = 0.6) -> List[List[Word]]:
    """
    Group words into visual lines by their vertical position.

    Words within a fraction of a line-height of each other belong to the same
    row. The tolerance is derived from the median word height, so it adapts to
    the document's font size instead of a hardcoded pixel value.
    """
    positioned = [w for w in words if w.get('top') is not None]
    if not positioned:
        return []

    ordered = sorted(positioned, key=lambda w: (w['top'], w['x0']))
    heights = sorted(
        (w['bottom'] - w['top'])
        for w in ordered
        if w.get('bottom') is not None and (w['bottom'] - w['top']) > 0
    )
    median_h = heights[len(heights) // 2] if heights else 10.0
    tol = median_h * tol_ratio

    lines: List[List[Word]] = []
    current = [ordered[0]]
    baseline = ordered[0]['top']
    for w in ordered[1:]:
        if abs(w['top'] - baseline) <= tol:
            current.append(w)
        else:
            lines.append(current)
            current = [w]
            baseline = w['top']
    lines.append(current)
    return lines


def words_to_table(
    words: List[Word],
    column_ranges: List[Range],
    *,
    joiner: str = ' ',
) -> Dict[str, Any]:
    """
    Bucket positioned words into a table using the given column x-ranges.

    Returns {'rows': List[List[str]], 'n_columns': int, 'dropped': int}.
    'dropped' counts words that fell outside every column (should be ~0 when the
    columns cover the data); it is a coverage signal, not an error.
    """
    if not column_ranges:
        raise ValueError('column_ranges is required')

    n_cols = len(column_ranges)
    centers = [(r[0] + r[1]) / 2.0 for r in column_ranges]
    left_edge = min(r[0] for r in column_ranges)
    right_edge = max(r[1] for r in column_ranges)

    def column_for(center_x):
        # Prefer a box that actually contains the word. When boxes overlap and a
        # word falls inside more than one, pick the box whose center is nearest —
        # the word sits most squarely in that column. This keeps a value in its
        # own narrow column even if a neighbouring box was drawn over it.
        containing = [j for j in range(n_cols)
                      if column_ranges[j][0] <= center_x <= column_ranges[j][1]]
        pool = containing if containing else range(n_cols)
        return min(pool, key=lambda j: abs(centers[j] - center_x))

    rows: List[List[str]] = []
    dropped = 0
    for line in cluster_lines(words):
        cells = [''] * n_cols
        for w in sorted(line, key=lambda w: w['x0']):
            center = (w['x0'] + w['x1']) / 2.0
            # Words clearly outside every drawn column are inter-column noise.
            if center < left_edge or center > right_edge:
                dropped += 1
                continue
            idx = column_for(center)
            cells[idx] = (cells[idx] + joiner + w['text']).strip() if cells[idx] else w['text']
        rows.append(cells)

    return {'rows': rows, 'n_columns': n_cols, 'dropped': dropped}


def merge_wrapped_rows(rows: List[List[str]], anchor_index: int = 0, joiner: str = ' ') -> List[List[str]]:
    """
    Merge continuation lines into the row above them.

    In tables with wrapped cells, a single item spans several visual lines: the
    first line carries the identity column (e.g. a description or part number),
    the rest continue other columns. A line whose anchor column is blank is
    treated as a continuation and its non-empty cells are appended to the
    previous emitted row. Rows are left untouched when the anchor is filled, so a
    table with one line per row (no wrapping) passes through unchanged.
    """
    if not rows:
        return rows

    merged: List[List[str]] = []
    for row in rows:
        anchor_blank = anchor_index < len(row) and not str(row[anchor_index]).strip()
        if anchor_blank and merged:
            target = merged[-1]
            for i, cell in enumerate(row):
                text = str(cell).strip()
                if not text:
                    continue
                if i < len(target) and str(target[i]).strip():
                    target[i] = f"{target[i]}{joiner}{text}"
                elif i < len(target):
                    target[i] = text
        else:
            merged.append(list(row))
    return merged


def scale_rect_to_pdf(
    rect_px: Dict[str, float],
    image_w: float,
    image_h: float,
    pdf_w: float,
    pdf_h: float,
) -> Dict[str, float]:
    """
    Map a zone rectangle drawn in image pixels to PDF-point coordinates.

    Zones are stored in the rendered image's pixel space; a text-layer provider
    needs them in the PDF's point space. Both axes scale independently.
    """
    sx = pdf_w / image_w if image_w else 1.0
    sy = pdf_h / image_h if image_h else 1.0
    return {
        'x0': rect_px['x'] * sx,
        'x1': (rect_px['x'] + rect_px['width']) * sx,
        'top': rect_px['y'] * sy,
        'bottom': (rect_px['y'] + rect_px['height']) * sy,
    }


def extract_table_from_pdf_words(
    page_words_by_page: Dict[int, List[Word]],
    column_zones_by_page: Dict[int, List[Dict[str, float]]],
    *,
    merge_wrapped: bool = False,
    anchor_index: int = 0,
) -> Dict[str, Any]:
    """
    Build one concatenated table from column zones across pages.

    page_words_by_page: {page_number: [word, ...]} in the same coordinate space
        as the zone rects passed in column_zones_by_page.
    column_zones_by_page: {page_number: [{'x0','x1','top','bottom'}, ...]} — the
        column rectangles for that page (already in word coordinate space).

    Rows from every page are appended in page order, so a table split across
    pages becomes one continuous table. Column count is taken from the widest
    page's zone set.
    """
    all_rows: List[List[str]] = []
    total_dropped = 0
    n_columns = 0

    for page_number in sorted(column_zones_by_page):
        zones = sorted(column_zones_by_page[page_number], key=lambda z: z['x0'])
        if not zones:
            continue
        column_ranges = [(z['x0'], z['x1']) for z in zones]
        n_columns = max(n_columns, len(column_ranges))

        region_top = min(z['top'] for z in zones)
        region_bottom = max(z['bottom'] for z in zones)
        region_left = min(z['x0'] for z in zones)
        region_right = max(z['x1'] for z in zones)

        words = [
            w for w in page_words_by_page.get(page_number, [])
            if region_top <= ((w['top'] + w['bottom']) / 2.0) <= region_bottom
            and region_left <= ((w['x0'] + w['x1']) / 2.0) <= region_right
        ]

        result = words_to_table(words, column_ranges)
        all_rows.extend(result['rows'])
        total_dropped += result['dropped']

    rows_before_merge = len(all_rows)
    if merge_wrapped:
        all_rows = merge_wrapped_rows(all_rows, anchor_index=anchor_index)

    return {
        'rows': all_rows,
        'n_columns': n_columns,
        'dropped': total_dropped,
        'merged_continuation_rows': rows_before_merge - len(all_rows) if merge_wrapped else 0,
    }
