# Zonal CV Enhancement: Cropped-Region Preprocessing for Azure Table OCR

This document explains the idea, motivation, current implementation, affected files, API contract, benefits, limitations, validation plan, and next steps for enhancing zonal PDF table extraction using classical computer vision (CV) preprocessing before sending zones to Azure Document Intelligence.

## Summary

- When a user draws a zone around a table on the PDF, we:
  1) Crop exactly that region from the pre-rendered page image.
  2) Enhance the cropped image with OpenCV (contrast equalization, de-noising, light morphology, optional binarization, and sharpening).
  3) Send the enhanced image directly to Azure Document Intelligence for table extraction.
  4) Combine headers and rows across zones, then continue to the existing column-mapping flow.

The enhancement is controlled via an `enhance_preset` flag and can be disabled at runtime.

## Why this helps

- Improves clarity of header text and grid lines, often boosting Azure’s ability to:
  - Detect the table structure (rows/columns).
  - Correctly segment columns where scanned documents are faint/low-contrast.
  - Increase header detection reliability for mapping.
- Keeps the processing entirely local before Azure (no new cloud services/models).
- Adds negligible integration complexity and is easy to roll back (pass `enhance_preset: 'none'`).

## What changed (Code-level)

### New CV Enhancement

- File: `backend/excel_mapper/services/pdf_processor.py`
  - Added: `enhance_zone_image(image: PIL.Image, preset: str = 'adaptive') -> PIL.Image`
  - Added: `_choose_enhancement_preset(gray_img) -> str` to auto-select preset based on sharpness and contrast.
  - Presets:
    - `none`: return the original cropped image.
    - `basic`: grayscale + CLAHE + light unsharp mask.
    - `adaptive`: grayscale + CLAHE + adaptive threshold + small morphology (close) in H/V + median de-noise + light unsharp.
    - `auto` (implicit default): backend computes metrics and picks `adaptive` or `basic`.
  - Notes: Falls back to the original image on any error.

### Wire enhancement into zone processing

- File: `backend/excel_mapper/zone_views.py`
  - Endpoint: `POST /api/pdf/zones/<session_id>/process/`
  - Changes:
    - Accepts optional `zone_ids` to process a subset of zones.
    - Enhancement is automatic by default: if `enhance_preset` is omitted, backend uses `'auto'` and selects the best preset.
    - Optional override: `enhance_preset` may still be provided (`'adaptive'|'basic'|'none'`), but the recommended usage is to omit it so the backend auto-selects.
    - Crops zone via `PDFProcessor.crop_zone_from_image(...)`.
    - Enhances cropped image via `PDFProcessor.enhance_zone_image(...)`.
    - Sends the enhanced image to Azure via `AzureOCRService.extract_table_from_image(...)`.

### Existing components used (no changes required)

- File: `backend/excel_mapper/services/azure_ocr_service.py`
  - Method `extract_table_from_image(image)` converts a PIL image to bytes and calls Azure Document Intelligence (`prebuilt-layout`).
  - Has fallback when no tables are detected (line-based text parsing heuristics).

- File: `frontend/src/services/api.js`
  - `processPDFZones(sessionId, zoneIds, enhancePreset = 'adaptive')` was already present and sends both `zone_ids` and `enhance_preset` to the backend.

- File: `frontend/src/pages/PDFZoneSelection.js`
  - Uses `api.processPDFZones(sessionId, updatedZones.map(z => z.zone_id))`. You can optionally expose a UI toggle for `enhance_preset` in the future.

## API Contract

- Route: `POST /api/pdf/zones/{session_id}/process/`
- Request JSON:
  ```json
  {
    "zone_ids": ["zone_1696012345678", "zone_1696012349876"]
  }
  ```
  - `zone_ids` (optional): process only these zones; if omitted, process all stored zones for the session.
  - `enhance_preset` (optional): if omitted, backend uses automatic selection. Valid values: `'adaptive'|'basic'|'none'|'auto'`.

- Response JSON (unchanged schema):
  ```json
  {
    "session_id": "...",
    "extraction_id": 123,
    "headers": ["..."],
    "row_count": 42,
    "column_count": 8,
    "status": "completed",
    "message": "Zone processing completed successfully"
  }
  ```

## Detailed Enhancement Pipeline

Preset `'adaptive'`
- Grayscale conversion for stability.
- CLAHE (contrast-limited adaptive histogram equalization) to boost contrast in uneven lighting.
- Adaptive threshold (Gaussian) to binarize and suppress background noise.
- Small-kernel morphological close (horizontal and vertical) to strengthen grid lines without over-connecting characters.
- Median blur to remove speckles.
- Light unsharp mask on inverted image to sharpen characters, then invert back.

Preset `'basic'`
- Grayscale + CLAHE + light unsharp masking (keeps natural gray background, mild enhancement).

Preset `'none'`
- Returns the original crop without changes.

All presets fall back to the original image on any unexpected failure.

## Will this help?

In most scanned or low-contrast PDFs, yes:
- Clearer text and stronger grid edges often improve Azure’s table and header detection accuracy.
- Especially helpful when page background is textured, the scan is faint, or print quality is inconsistent.

Edge cases and trade-offs:
- Very faint text: aggressive thresholding may remove content. Switch to `'basic'` or `'none'`.
- Extra CPU: enhancement adds a few milliseconds to hundreds of milliseconds per zone depending on size; typically acceptable vs. network roundtrip to Azure.
- Rotated/skewed scans: not addressed yet. A de-skew step can further improve results.

## Dependencies

- Already present in `backend/requirements.txt`:
  - `opencv-python`, `numpy` (used by enhancement)
  - `Pillow` (already used)
  - No new packages added.

## Validation Plan

- A/B test by preset per the same zones:
  - Run with `'none'`, `'basic'`, `'adaptive'` and compare:
    - Header count/quality
    - Row count
    - Azure’s reported table count
  - Log and sample outputs for review (optionally persist enhanced images in a debug mode).

- Manual scenarios:
  - Clean digital PDFs (should show parity across presets).
  - Scanned PDFs with low contrast (adaptive should outperform).
  - Multi-page with multiple tables and mixed quality.

## Logging & Troubleshooting

### Frontend Console
- Page image load: `🖼️ Loading page image { sessionId, page, url }`
- Rendering existing zones: `🧱 Rendering existing zones on page { page, count }`
- Zone creation: `✏️ Created zone: <type> <zone_id>`
- Label add: `🏷️ Adding label: <type> for zone: <zone_id>`
- Save payload: `📤 Sending zones to backend { sessionId, count, zones:[{ id, page, coords }] }`
- Save response: `💾 Zones saved { status, created }`
- Process response: `✅ Zones processed successfully { headers, rows, cols }`
- Errors: `❌ PDF zones processing failed: <details>` or `Error processing zones: <details>`

### Backend Logs (Django)
- Start: `🧭 Zonal processing start | session=... | requested_zone_ids=... | enhance_preset=... | total_selected=...`
- Crop: `✂️  Cropped zone | zone_id=... | page=... | coords=... | crop_wh=WxH`
- Enhancement auto choice: `🧮 Enhance:auto -> <preset> | varLap=... std=... dyn=...`
- Enhanced image: `🧪 Enhanced zone image | zone_id=... | preset=... | wh=WxH`
- Azure call: `🔷 Azure OCR: begin analyze ...`, `🔷 Azure OCR: analysis completed`
- Azure tables: `📊 Azure tables detected: count=N | first_table rc=R cc=C`
- Fallback (no tables): `📝 Fallback (text lines): headers=N sample=[...] | rows=K`
- Per-zone result: `📑 Zone result | zone_id=... | headers=N | rows=K | headers_sample=[...]`
- Combined: `🧩 Combined headers from all zones (N): [...]`
- Summary: `✅ Zonal processing done | zones=N | total_input_rows=K | normalized_rows=K2 | cols=C`

If Azure returns no tables consistently, validate zone coordinates, try larger zones that fully include header rows, or test with the `'basic'` preset override temporarily to compare.

## Next Steps (Optional)

- De-skew/dilate lines for rotated scans (Hough transform or projection profiles).
- Configurable UI toggle for `enhance_preset` in zone selection.
- Persist enhanced crops for debugging and QA when `DEBUG=true`.
- Heuristic to auto-pick preset based on quick local signal (e.g., variance of Laplacian for sharpness, background level).
- Table line detection (extract structural hints) to post-process Azure output.

## Rollback / Safety

- Pass `enhance_preset: 'none'` to disable enhancement without code changes.
- If needed, remove only the enhancement call in `zone_views.py` while keeping the crop-and-send path intact.

## Affected Files (for quick reference)

- Modified:
  - `backend/excel_mapper/services/pdf_processor.py`
    - Added `enhance_zone_image(...)`.
  - `backend/excel_mapper/zone_views.py`
    - `process_zones(...)` now accepts `zone_ids`, `enhance_preset`, enhances crops, and sends enhanced images to Azure.

- Referenced (unchanged):
  - `backend/excel_mapper/services/azure_ocr_service.py` (uses `extract_table_from_image(...)`).
  - `frontend/src/services/api.js` (`processPDFZones(...)` sends `zone_ids` and `enhance_preset`).
  - `frontend/src/pages/PDFZoneSelection.js` (draws zones, triggers processing).

---

If you want, we can add de-skew and a UI control for `enhance_preset` next.
