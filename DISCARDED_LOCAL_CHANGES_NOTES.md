# Discarded Local Changes Notes

These notes capture the local/stashed changes that were applied but are being discarded instead of committed. They are recorded here so the ideas and fixes can be rebuilt cleanly later if needed.

## Routing and Navigation

- Change the default landing route from Dashboard to Upload Files.
  - `frontend/src/App.js`
  - `/` should render `UploadFiles`.
  - Dashboard should remain available at `/dashboard`.

- Update header navigation active state.
  - `frontend/src/components/Header.js`
  - Dashboard should point to `/dashboard`.
  - Upload Files should point to `/`.
  - `/upload` should still highlight Upload Files for backward compatibility.

## Upload / Merge Improvements

- Improve Excel header row detection.
  - Scan more early rows instead of assuming row 1.
  - Score candidate header rows based on filled cells, BOM-like keywords, data below, short label shape, metadata/title penalties, and numeric/prose penalties.
  - Goal: correctly detect real table headers when reports have title/metadata rows above the table.

- Preserve meaningful source columns.
  - Keep every named column, even if the name is generic like `A`, `1`, or `Column X`.
  - Keep blank-header columns if they contain any data.
  - Drop only columns with no header and no data.

- Add grouped-detail merge detection.
  - Detect when a secondary sheet has parent key rows with blank-key child/detail rows underneath.
  - Offer a conditional popup only when that structure is detected.
  - User can choose to keep simple merge or expand grouped rows.

- Grouped-detail expansion options.
  - Pick detail column.
  - Choose whether first detail line is auto-detected, description, or primary product.
  - Choose MPN/MFR delimiter: auto, slash, pipe, semicolon, custom, or none.
  - Configure generic ignore patterns for note/spec lines.
  - Output expanded value, manufacturer, role, group description, and ignored lines.

- Download merge preview should respect selected preview filter and visible columns.
  - Example: if user is viewing only matched rows, download only matched rows.

- Disable BOM Normalizer when an existing workflow template is selected.
  - Existing template flow should replay directly to mapped output, not allow user into normalizer.

## BOM Normalizer Improvements

- Improve normalizer header row detection and column preservation using the same generic logic as upload.

- Add alternate manufacturer inheritance.
  - New option: `Fill blank alternate manufacturer from primary`.
  - Alternate MFR is filled only when alternate manufacturer is blank.
  - Existing alternate manufacturer values are never overwritten.
  - Applies to split MPN/MFR cells and alternate-column groups.

- Fix embedded BOM Normalizer back behavior.
  - When BOM Normalizer is opened from main Upload flow, Source setup Back should return to normal Upload page.
  - Standalone BOM Normalizer should still go back to its own upload step.

## Backend Session/Template Safety

- Persist session after template application.
  - Template application mutates session mappings/formulas after the initial session save.
  - Save the updated session before editor opens so another worker does not read stale `mappings=None`.

- Guard `/api/data/` logging against `mappings=None`.
  - Avoid `object of type 'NoneType' has no len()` crash.

## Template Replay Issue Observed

- Current saved template `ABB` produced mostly blank/default mapped output.
- Root cause found:
  - `ABB` mapping template expects normalized columns like `mpn`, `manufacturer`, `description`, `uom`.
  - Existing-template replay applies that mapping directly to raw uploaded Excel headers.
  - This creates random/blank mapped output.

- Correct long-term fix:
  - A global template must save and replay the full processing recipe, not old row data.
  - Recipe should include:
    - source/header hints,
    - BOM Normalizer roles/config,
    - merge/normalization steps,
    - final column mappings,
    - defaults,
    - item code/tag/provider rules.
  - On next upload, selecting the template should run the recipe on the new sheet data and open the final mapped workbook.

## Files That Had Local Changes

- `backend/excel_mapper/views.py`
- `frontend/src/App.js`
- `frontend/src/components/Header.js`
- `frontend/src/lib/bomNormalizerAlgorithmRegistry.js`
- `frontend/src/pages/BomNormalizer.js`
- `frontend/src/pages/UploadFiles.js`

