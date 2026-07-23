"""
Native PDF extraction for selectable-text PDFs.

This complements Azure Document Intelligence. It first uses table extraction for
grid-like PDFs, then falls back to a BOM record-stream parser for text PDFs that
render records line-by-line instead of as a table.
"""
import logging
import re
from collections import Counter
from typing import Dict, List, Any

import pandas as pd
import pdfplumber

logger = logging.getLogger(__name__)


class NativePDFService:
    BOM_HEADERS = ["PartNo", "Count", "Description", "MFR", "MFR Part", "RoHS"]
    HEADER_SKIP = {"PartNo.", "Count Description", "MFR", "MFR Part", "RoHS"}
    PART_RE = re.compile(r"^(?:A3C\d{8}|\d{8,})(?:\s+[A-Z])?$")
    INLINE_ROW_RE = re.compile(r"^(?P<part>(?:A3C\d{8}|\d{8,})(?:\s+[A-Z])?)\s+(?P<count>---|\d+)\s+(?P<body>.+)$")
    ROHS_TAIL_RE = re.compile(
        r"\s+(?P<rohs>YES|NO|\d+\s+violated|\d+\s+prepared(?:,?\s+min\.\s+1\s+part\s+is\s+compliant)?(?:\s+\(computed\))?|\d+\s+compliant\s+\(computed\)|00\s+not\s+checked)$",
        re.IGNORECASE,
    )

    def analyze_pdf_file(self, file_path: str) -> Dict[str, Any]:
        pages = []
        table_candidates = []
        text_pages = []

        with pdfplumber.open(file_path) as pdf:
            for page_number, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ""
                text_pages.append((page_number, text))

                tables = page.extract_tables() or []
                pages.append({
                    "page_number": page_number,
                    "text_chars": len(text),
                    "table_count": len(tables),
                })

                for table in tables:
                    normalized = self._normalize_table(table)
                    if normalized:
                        headers, rows = normalized
                        table_candidates.append({
                            "page_number": page_number,
                            "headers": headers,
                            "rows": rows,
                        })

        if table_candidates:
            return self._build_table_result(table_candidates, pages)

        return self._build_record_result(text_pages, pages)

    def convert_to_dataframe(self, extraction_data: Dict[str, Any]) -> pd.DataFrame:
        headers = extraction_data.get("extracted_headers") or []
        rows = extraction_data.get("extracted_data") or []
        if not headers:
            return pd.DataFrame()
        return pd.DataFrame(rows, columns=headers)

    def _normalize_table(self, table):
        rows = []
        for row in table or []:
            clean = [self._clean_cell(cell) for cell in (row or [])]
            if any(clean):
                rows.append(clean)

        if len(rows) < 2:
            return None

        headers = rows[0]
        if not any(headers):
            return None

        width = max(len(headers), max((len(r) for r in rows[1:]), default=0))
        headers = self._dedupe_headers(headers + [""] * (width - len(headers)))
        data = [(r + [""] * (width - len(r)))[:width] for r in rows[1:]]
        data = [r for r in data if any(str(c).strip() for c in r)]

        if not data:
            return None

        return headers, data

    def _build_table_result(self, table_candidates: List[Dict[str, Any]], pages: List[Dict[str, Any]]) -> Dict[str, Any]:
        primary = max(table_candidates, key=lambda item: (len(item["headers"]), len(item["rows"])))
        headers = primary["headers"]
        all_rows = []

        for candidate in table_candidates:
            if candidate["headers"] == headers:
                all_rows.extend(candidate["rows"])

        quality_metrics = self._quality_metrics(headers, all_rows, pages, "native_table")
        return {
            "method": "native_table",
            "tables": table_candidates,
            "table_count": len(table_candidates),
            "extracted_headers": headers,
            "extracted_data": all_rows,
            "quality_metrics": quality_metrics,
            "confidence_scores": {"overall_confidence": quality_metrics["overall_confidence"]},
            "processing_metadata": {
                "pages": pages,
                "parser": "pdfplumber.extract_tables",
            },
        }

    def _build_record_result(self, text_pages, pages: List[Dict[str, Any]]) -> Dict[str, Any]:
        blocks = []

        for page_number, text in text_pages:
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            lines = [
                line for line in lines
                if not line.startswith(("Bill of material", "Revision state:", "Generated:", "Page ", "PartNo."))
                and line not in self.HEADER_SKIP
            ]

            inline_rows = []
            remaining_lines = []
            for line in lines:
                parsed_inline = self._parse_inline_bom_line(line)
                if parsed_inline:
                    inline_rows.append(parsed_inline)
                else:
                    remaining_lines.append(line)

            if inline_rows:
                blocks.extend({"page_number": page_number, "parsed_row": row} for row in inline_rows)
                lines = remaining_lines

            current = None
            for line in lines:
                if self.PART_RE.match(line):
                    if current:
                        blocks.append(current)
                    current = {"page_number": page_number, "lines": [line]}
                elif current:
                    current["lines"].append(line)
            if current:
                blocks.append(current)

        rows = []
        short_blocks = 0
        for block in blocks:
            parsed = block.get("parsed_row") or self._parse_bom_block(block["lines"])
            if parsed:
                rows.append(parsed)
            else:
                short_blocks += 1

        quality_metrics = self._quality_metrics(self.BOM_HEADERS, rows, pages, "native_record")
        quality_metrics["record_blocks"] = len(blocks)
        quality_metrics["short_blocks"] = short_blocks

        return {
            "method": "native_record",
            "tables": [{
                "headers": self.BOM_HEADERS,
                "data": rows,
                "row_count": len(rows),
                "column_count": len(self.BOM_HEADERS),
            }] if rows else [],
            "table_count": 1 if rows else 0,
            "extracted_headers": self.BOM_HEADERS if rows else [],
            "extracted_data": rows,
            "quality_metrics": quality_metrics,
            "confidence_scores": {"overall_confidence": quality_metrics["overall_confidence"]},
            "processing_metadata": {
                "pages": pages,
                "parser": "pdfplumber.extract_text + bom_record_parser",
            },
        }

    def _parse_bom_block(self, lines: List[str]):
        if len(lines) < 4:
            return None

        part_no = lines[0]
        count = lines[1]
        rest = [line for line in lines[2:] if line]
        if not rest:
            return None

        rohs = rest[-1]
        body = rest[:-1]

        if count == "---" and len(body) >= 3:
            description = " ".join(body[:-2])
            mfr = body[-2]
            mfr_part = body[-1]
        elif count != "---" and len(body) >= 3:
            description = " ".join(body[:-2])
            mfr = body[-2]
            mfr_part = body[-1]
        else:
            description = " ".join(body)
            mfr = ""
            mfr_part = ""

        return [part_no, count, description, mfr, mfr_part, rohs]

    def _parse_inline_bom_line(self, line: str):
        match = self.INLINE_ROW_RE.match(line)
        if not match:
            return None

        part_no = match.group("part")
        count = match.group("count")
        body = match.group("body").strip()

        rohs = ""
        rohs_match = self.ROHS_TAIL_RE.search(f" {body}")
        if rohs_match:
            rohs = rohs_match.group("rohs").strip()
            body = body[:len(body) - len(rohs)].strip()

        description = body
        mfr = ""
        mfr_part = ""

        if count == "---":
            tokens = body.split()
            if len(tokens) >= 4:
                mfr_part = tokens[-1]
                # Manufacturer names are usually uppercase words before the part number.
                mfr_tokens = []
                idx = len(tokens) - 2
                while idx >= 0:
                    token = tokens[idx]
                    if token.isupper() or token in {"CO.", "CO", "LTD", "LTD:", "CORP", "INC.", "INC"}:
                        mfr_tokens.insert(0, token)
                        idx -= 1
                    else:
                        break
                if mfr_tokens:
                    mfr = " ".join(mfr_tokens)
                    description = " ".join(tokens[:idx + 1]).strip()

        return [part_no, count, description, mfr, mfr_part, rohs]

    def _quality_metrics(self, headers: List[str], rows: List[List[str]], pages: List[Dict[str, Any]], method: str) -> Dict[str, Any]:
        row_count = len(rows)
        column_count = len(headers)
        total_cells = row_count * column_count if row_count and column_count else 0
        filled_cells = sum(1 for row in rows for cell in row if str(cell).strip())
        empty_ratio = 1 - (filled_cells / total_cells) if total_cells else 1

        widths = Counter(len(row) for row in rows)
        dominant_width_count = widths.most_common(1)[0][1] if widths else 0
        column_consistency = dominant_width_count / row_count if row_count else 0
        header_quality = sum(1 for h in headers if str(h).strip()) / column_count if column_count else 0
        text_chars = sum(page.get("text_chars", 0) for page in pages)

        if method == "native_record":
            row_score = min(row_count / 50, 1.0)
        else:
            row_score = min(row_count / 20, 1.0)

        overall = (
            0.30 * row_score +
            0.25 * column_consistency +
            0.20 * header_quality +
            0.15 * (1 - min(empty_ratio, 1)) +
            0.10 * (1.0 if text_chars > 100 else 0.0)
        )

        return {
            "overall_confidence": round(overall, 4),
            "row_count": row_count,
            "column_count": column_count,
            "empty_cell_ratio": round(empty_ratio, 4),
            "column_consistency": round(column_consistency, 4),
            "header_quality": round(header_quality, 4),
            "selectable_text_chars": text_chars,
            "page_count": len(pages),
            "method": method,
        }

    def _dedupe_headers(self, headers: List[str]) -> List[str]:
        seen = {}
        result = []
        for index, header in enumerate(headers):
            base = header.strip() or f"Column_{index + 1}"
            count = seen.get(base, 0)
            seen[base] = count + 1
            result.append(base if count == 0 else f"{base}.{count}")
        return result

    def _clean_cell(self, value) -> str:
        if value is None:
            return ""
        text = str(value).replace("\u00a0", " ").replace("\r", " ").replace("\n", " ")
        return " ".join(text.split()).strip()
