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
        # A word belongs to a column only if it actually sits inside a drawn box.
        # When boxes overlap and a word falls inside more than one, pick the box
        # whose center is nearest — the word sits most squarely in that column.
        # A word inside NO box (e.g. a column the user didn't zone, sitting in the
        # gap between two zones) returns None and is dropped, rather than being
        # force-assigned to the nearest column and polluting it. Zones are a strict
        # filter: what you draw over is what you get.
        containing = [j for j in range(n_cols)
                      if column_ranges[j][0] <= center_x <= column_ranges[j][1]]
        if not containing:
            return None
        return min(containing, key=lambda j: abs(centers[j] - center_x))

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
            if idx is None:
                # Falls in a gap between drawn columns — not part of any zone.
                dropped += 1
                continue
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


def detect_column_ranges(words: List[Word], region: Dict[str, float],
                         min_gap_ratio: float = 0.012) -> List[Range]:
    """Infer column x-ranges inside one region from where the words are not.

    A ruled table leaves vertical whitespace between columns. Projecting every
    word onto the x-axis and looking for gaps wide enough to be deliberate finds
    those channels without the user having to draw one box per column.

    ``min_gap_ratio`` is a fraction of the region width, so it scales with page
    size rather than assuming a DPI. Gaps narrower than that are treated as
    ordinary word spacing.

    Returns [] when nothing convincing is found, so the caller can fall back to
    the zones the user actually drew instead of inventing a layout.
    """
    if not words:
        return []

    left = region['x0']
    right = region['x1']
    width = right - left
    if width <= 0:
        return []

    min_gap = max(width * min_gap_ratio, 1.0)

    spans = sorted(
        ((max(w['x0'], left), min(w['x1'], right)) for w in words),
        key=lambda s: s[0],
    )
    spans = [(a, b) for a, b in spans if b > a]
    if not spans:
        return []

    # Merge overlapping/adjacent word spans into occupied bands; whatever sits
    # between two bands is a candidate column gap.
    bands: List[List[float]] = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= bands[-1][1]:
            bands[-1][1] = max(bands[-1][1], end)
        else:
            bands.append([start, end])

    columns: List[Range] = []
    current_start = bands[0][0]
    current_end = bands[0][1]
    for start, end in bands[1:]:
        if start - current_end >= min_gap:
            columns.append((current_start, current_end))
            current_start = start
        current_end = max(current_end, end)
    columns.append((current_start, current_end))

    # One column means no gap was convincing enough — report nothing rather than
    # claim the whole region is a single column.
    return columns if len(columns) > 1 else []


def extract_ruled_table(pdf_page, rect: Dict[str, float]) -> Dict[str, Any]:
    """Extract a table from one region using the PDF's own ruling lines.

    A bordered table already declares its column boundaries as drawn lines, so
    nothing has to be inferred: the user marks the table area and the grid comes
    from the file. This is what lets a single zone replace one-zone-per-column.

    Falls back to whitespace-inferred columns when the region has no ruling, and
    reports which strategy produced the result so the caller can say so rather
    than silently guessing.
    """
    crop = pdf_page.crop((rect['x0'], rect['top'], rect['x1'], rect['bottom']))

    # 'lines' vertically keeps real column edges; horizontally it merges a
    # wrapped description into its own cell instead of splitting it across rows.
    for horizontal in ('lines', 'text'):
        try:
            table = crop.extract_table({
                'vertical_strategy': 'lines',
                'horizontal_strategy': horizontal,
            })
        except Exception:
            table = None
        if table and len(table) > 1 and len(table[0]) > 1:
            rows = [[('' if cell is None else str(cell).replace('\n', ' ').strip())
                     for cell in row] for row in table]
            return {
                'rows': rows,
                'n_columns': max(len(r) for r in rows),
                'strategy': 'ruling_lines_%s' % horizontal,
                'dropped': 0,
            }

    # No usable ruling: fall back to the vertical whitespace channels between
    # words. Weaker — centred headers in wide columns can mislead it — so it is
    # only reached when the file gives us nothing better.
    words = [
        {'text': w['text'], 'x0': w['x0'], 'x1': w['x1'],
         'top': w['top'], 'bottom': w['bottom']}
        for w in crop.extract_words()
    ]
    if not words:
        return {'rows': [], 'n_columns': 0, 'strategy': 'none', 'dropped': 0}

    region = {'x0': rect['x0'], 'x1': rect['x1']}
    columns = detect_column_ranges(words, region)
    if not columns:
        return {'rows': [], 'n_columns': 0, 'strategy': 'none', 'dropped': 0}

    result = words_to_table(words, columns)
    return {
        'rows': result['rows'],
        'n_columns': len(columns),
        'strategy': 'whitespace_gaps',
        'dropped': result['dropped'],
    }
