# BOM Mapper Status Handoff

Date: 2026-07-31  
Branch: `tejchange`

## Executive Summary

The BOM Mapper has moved from a basic Excel mapping tool into a broader BOM preparation workflow. The current application supports Excel/PDF ingestion, multi-source merge, BOM normalization, MPN/MFR extraction, manufacturer matching, MPN validation, editable final output, FactWise ID/tag tooling, download/export, provider credential settings, and backend persistence foundations for intermediate troubleshooting files.

The main user-facing BOM Normalizer flow is implemented and ready for end-to-end testing with real demo sheets. Remaining work is mainly validation/testing, production hardening, and any UI polish coming from the designer branch.

## Current Main Flows

### 1. Standard Mapper Flow

Frontend:
- Upload source file and FactWise/client template.
- Select sheets and headers.
- Map source columns to FactWise template columns.
- Preview mapped data in an editable workbook-like grid.
- Resize and work with columns in a more Excel-like way.
- Hide/show preview columns through dropdown checkbox controls.
- Continue from compare/merge output into the BOM mapping flow.
- Download final mapped workbook.
- Save mapping templates and reuse mapping logic.

Backend:
- Stores upload sessions in memory and persisted session JSON files.
- Reads Excel/CSV sources and applies selected mappings.
- Maintains session snapshots for mapped data, edited data, formula-enhanced data, and current headers.
- Generates downloadable Excel/CSV outputs.
- Supports dashboard/history loading from persisted sessions.

Status:
- Implemented.
- Needs final regression testing after latest UI merge/styling changes.

### 2. Compare / Merge Sheet Flow

Frontend:
- Compare/merge source sheets before mapping.
- Supports selecting primary/secondary sources.
- Supports matching on a common column.
- Allows matched/unmatched filtering.
- Allows selecting which columns should continue forward.
- Supports "use merged sheet as base" for additional merges.
- Back button behavior has been adjusted to move one step back instead of jumping to the initial upload page.
- Download and continue actions are available from the merge result page.

Backend:
- Applies sheet joins through the `sheet-join/apply` flow.
- Creates merged source output that can be used as a later mapping source.
- Preserves selected columns and merge result metadata.
- Supports merged output as another source for chained merge workflows.

Status:
- Implemented.
- Chained Excel merge flow is working.
- PDF merge conversion is implemented enough for testing but still needs broader real-file validation.

### 3. BOM Normalizer Flow

Route:
- `/bom-normalizer`
- `/bom-normaliser`

Frontend:
- Standalone BOM normalization workflow separate from the old mapper.
- Upload one or more sources.
- Detect sheets and allow sheet selection for multi-sheet Excel files.
- Preview source data before configuration.
- Configure important source columns:
  - MPN
  - MFR
  - CPN
  - quantity
  - UOM
  - alternate MPN/MFR columns
  - BOM level where present
- Supports source preview and column information on setup pages.
- Supports dropdown checkbox visible-column filtering.
- Supports search in normalized output.
- Supports low-confidence filter by clicking the low-confidence indicator.
- Allows deleting rows and alternates.
- Handles primary deletion with warning and promotes alternate rows correctly.
- Re-numbers alternates after delete.
- Shows normalized output in an editable sheet-like table.
- Supports downloads through a single download dropdown.
- Groups tools under a tools dropdown.
- Includes FactWise ID creation.
- Includes tag creation.
- Includes manufacturer match as an optional action, not a forced step.
- Manufacturer match changes are shown with per-change checkboxes so user can choose which suggested changes to apply.
- Manufacturer DB/status bubbles and extra messages were removed to reduce clutter.
- Parser/settings UI is implemented and compacted.
- UI refinements requested for BOM Normalizer are considered implemented; remaining item is full end-to-end testing.

Backend / Logic:
- Normalization algorithm registry exists in frontend logic for current prototype.
- Column auto-detection uses header keyword matching/fuzzy style logic to prefill likely MPN/MFR/quantity/UOM/etc.
- Learned/updated header aliases can be expanded based on user selection patterns.
- Delimiter detection attempts to infer delimiters from cell contents and falls back to auto-detect.
- Handles scenarios:
  - only MPN columns
  - only MFR columns
  - all MPNs in one cell
  - all MFRs in one cell
  - MPNs and MFRs in same cell
  - MPNs and MFRs in separate cells
  - alternates in separate rows
  - alternates in separate columns
  - grouped BOM rows where title/description row is separate from primary/alternate material rows
- Filters non-MPN separator text like `or` from alternate parsing.
- Avoids treating pipe-separated non-MPN fragments as valid alternates where possible.
- BOM level defaults are handled when BOM column is missing.
- Normalization confidence is calculated from parser certainty, column detection quality, and row completeness.

Status:
- Implemented.
- Needs testing across all received BOM examples.
- Future backend migration of parser algorithms is recommended, but for prototype status this is marked complete.

## PDF Handling

Frontend:
- PDF upload support exists.
- User can choose extraction style:
  - native/table extraction
  - OCR
  - zone mapping
  - compare native vs OCR where available
- Zone mapping redirects into BOM Normalizer flow instead of old mapper flow.
- PDF output can be used without merge.
- PDF output can be used as base for another merge, matching the Excel "use merged sheet as base" behavior.
- Grouped BOM option appears for PDF/BOM patterns where grouped rows are expected.
- Grouped BOM configuration includes whether the first row is title/description or primary material.

Backend:
- PDF sessions are stored through `PDFSession`, `PDFPage`, `PDFZone`, and `PDFExtractionResult`.
- Uploaded PDFs are stored under media PDF session storage.
- Supports native PDF extraction and Azure OCR path.
- Zone mapping extracts selected PDF areas into tabular data.
- Converted PDF output is converted into CSV/session-style source data so the downstream flow is similar to Excel.

Status:
- Implemented.
- Zone mapping path is preferred for demo reliability.
- Azure OCR can produce different counts depending on OCR quality; this is expected and should be tested per PDF.

## Manufacturer Directory and Matching

Frontend:
- Manufacturer match is optional.
- User can run manufacturer matching only when needed.
- Suggested changes are displayed with checkboxes.
- User can apply selected changes only.
- UI no longer forces manufacturer DB load/status into the normal flow.

Backend:
- Manufacturer directory is stored backend-side as JSON data.
- Manufacturer endpoints:
  - `GET /api/manufacturers/`
  - `GET /api/manufacturers/search/`
- Manufacturer aliases/synonyms are loaded and searched efficiently.
- Matching tries to map exact and close aliases without being overly loose.

Status:
- Implemented.
- Needs real-world manufacturer-list verification over more files.

## MPN Parsing and Validation

Frontend:
- Split MPN functionality supports user-selected MPN column.
- Manufacturer split/match is separate from Split MPN to avoid confusion.
- MPN validation provider selection supports multiple selected providers through checkbox dropdown.
- Settings page lets user configure provider credentials.

Backend:
- DigiKey validation exists.
- Mouser validation exists.
- Element14 validation added.
- Provider credentials are stored per browser/workspace scope through encrypted backend records.
- Local `.env` provider credentials are allowed only for localhost/backend-local demo usage.
- Deployed usage must use user-provided credentials, not company `.env` credentials.
- MPN cache exists through `GlobalMpnCache`.
- Similar/canonical MPN suggestions are generated for invalid MPNs using similarity scoring.
- Canonical suggestions are intentionally stricter than random partial matches.
- Empty MPN cells are handled without validation failure.

Provider credential endpoints:
- `GET /api/settings/provider-credentials/`
- `POST /api/settings/provider-credentials/`
- `DELETE /api/settings/provider-credentials/<provider>/`
- `POST /api/settings/provider-credentials/<provider>/test/`

Status:
- Implemented.
- Real credential test pending for Element14 and production provider keys.

## FactWise ID, Tags, and Derived Columns

Frontend:
- FactWise ID creation exists on mapped data workbook.
- Same FactWise ID style functionality has been added to BOM Normalizer.
- Prefix, number length/digits, increment behavior, and example preview are supported.
- Does not create duplicate FactWise ID/item-code columns unnecessarily.
- Add Tags functionality exists.
- Create-column functionality supports:
  - blank column creation
  - concatenating values from two or more columns
  - warning when the target column already has data
  - no warning when the target column is blank

Backend:
- Existing mapper backend supports FactWise ID creation and tag/formula rules.
- Template persistence includes formula rules and FactWise rules.
- BOM Normalizer tooling currently uses frontend-side output transformation for the prototype.

Status:
- Implemented.
- Needs final regression test with mapping templates and exported files.

## Intermediate Backend Artifact Saving

Purpose:
- Store intermediate files so that if a user reports a failure later, the team can inspect every important stage:
  - upload/source extraction
  - merge result
  - normalized output
  - manufacturer-matched output
  - validated output
  - final mapped/downloaded workbook

Backend:
- New model: `IntermediateArtifact`.
- New migration: `0017_intermediateartifact`.
- Files are stored under:
  - `media/intermediate_artifacts/<session_id>/`
- Stores metadata in DB:
  - session id
  - artifact type
  - label
  - file path
  - format
  - row count
  - column count
  - custom metadata
  - created timestamp
- Supports repeated column headers by preserving row position instead of converting to name-keyed dictionaries.
- Existing mapped/grid downloads save backend copies automatically.

Artifact endpoints:
- `GET /api/intermediate-artifacts/?session_id=<id>`
- `POST /api/intermediate-artifacts/save/`
- `GET /api/intermediate-artifacts/<id>/download/`
- `DELETE /api/intermediate-artifacts/<id>/`

Frontend:
- API helpers added:
  - `getIntermediateArtifacts`
  - `saveIntermediateArtifact`
  - `downloadIntermediateArtifact`
  - `deleteIntermediateArtifact`
- BOM Normalizer and merge stages are ready to call these APIs for explicit checkpoints.

Status:
- Marked complete for project status.
- Smoke tested for save/list/download/delete.
- Full flow-level checkpoint testing still pending.

## Settings and Provider Credentials

Frontend:
- Settings page includes DigiKey, Mouser, and Element14.
- DigiKey requires client ID and client secret; optional fields remain optional.
- Mouser requires one API key.
- Element14 requires one API key.
- Test connection button exists per provider.
- Provider validation selection uses checkbox dropdown with only three provider choices:
  - DigiKey
  - Mouser
  - Element14
- Users can select any combination by checking multiple providers.

Backend:
- Provider credentials encrypted using app secret-derived Fernet encryption.
- Credentials are scoped by `scope_id`.
- MPN validation endpoints receive `provider_credential_scope_id`.
- Validation endpoints receive selected `validation_providers`.
- Local environment fallback is allowed only when backend host is localhost.
- Deployed app should not use company `.env` provider credentials.

Status:
- Implemented.
- Needs real provider credentials testing.

## History / Dashboard

Frontend:
- Dashboard/history exists for uploaded sessions.
- Saved merge/compare books and selected books have been iterated on.
- Auto-prefill was removed where it caused wrong selected-book state.
- Saved books should remain user-selected rather than automatically selected.

Backend:
- Sessions persist to JSON files.
- Dashboard loads both in-memory sessions and saved session files.
- Delete endpoints exist for single/all upload cleanup.
- Intermediate artifact backend now exists for future richer troubleshooting history.

Status:
- Implemented.
- Needs final real-session test after latest UI changes.

## Data Quality Fixes Implemented

Spec pair handling:
- If spec value is empty, spec name should also be empty.
- Applied across spec pair logic to avoid invalid FactWise imports.

MPN/MFR pairing:
- Improved matching when MPNs and manufacturers appear in one clipped/merged cell.
- Manufacturer matching uses directory aliases but avoids overly loose matches.
- Empty MPN cells no longer throw validation errors.
- Invalid MPNs can still show similar canonical suggestions where similarity is meaningful.

Alternate handling:
- Alternate rows can be deleted and re-numbered.
- Primary deletion warns the user and promotes alternate 1 to primary when confirmed.
- `or` and similar separator text is discarded from alternate candidates.
- Grouped BOM parsing supports title/description rows above primary rows.

Column handling:
- Visible column dropdown filters are available.
- Search/filter options exist in normalized output.
- User-selected columns are preserved into next steps.
- CPN column support added.

Status:
- Implemented.
- Needs broad regression test.

## Backend Files of Interest

- `backend/excel_mapper/models.py`
  - templates, PDF sessions, MPN cache, provider credentials, intermediate artifacts
- `backend/excel_mapper/views.py`
  - upload, mapping, session persistence, downloads, transforms
- `backend/excel_mapper/urls.py`
  - API route registration
- `backend/excel_mapper/mpn_views.py`
  - MPN validation, provider selection, parser validation
- `backend/excel_mapper/provider_credentials.py`
  - encrypted provider credential APIs
- `backend/excel_mapper/intermediate_artifacts.py`
  - durable intermediate artifact APIs
- `backend/excel_mapper/manufacturer_views.py`
  - manufacturer directory/search endpoints
- `backend/excel_mapper/pdf_views.py`
  - PDF upload/extraction/compare flow
- `backend/excel_mapper/zone_views.py`
  - PDF zone mapping
- `backend/excel_mapper/services/digikey_service.py`
- `backend/excel_mapper/services/mouser_service.py`
- `backend/excel_mapper/services/element14_service.py`

## Frontend Files of Interest

- `frontend/src/pages/BomNormalizer.js`
  - BOM Normalizer main workflow
- `frontend/src/lib/bomNormalizerAlgorithmRegistry.js`
  - parser/normalization logic registry
- `frontend/src/components/EnhancedDataEditor.js`
  - workbook-like editing tools
- `frontend/src/pages/Settings.js`
  - provider credentials and validation provider settings
- `frontend/src/services/api.js`
  - API client helpers
- `frontend/src/pages/ColumnMapping.js`
  - standard mapper flow
- `frontend/src/pages/PDFZoneSelection.js`
  - PDF zone mapping UI
- `frontend/src/App.js`
  - routes for `/bom-normalizer`, `/bom-normaliser`, `/preview`

## Verification Already Done

Backend:
- Python compile check passed for changed backend modules.
- `python manage.py check` passed inside Docker backend.
- Migration `0017_intermediateartifact` applied successfully.
- Intermediate artifact save/list/download/delete smoke test passed.

Frontend:
- Provider credential/API helper work previously built successfully.
- BOM Normalizer UI work is implemented, but full final regression testing is still pending after UI branch work.

## Testing Still Needed

Priority test list:
- End-to-end Excel upload to BOM Normalizer to download.
- Multi-sheet Excel selection.
- Excel merge of two sources.
- Use merged sheet as base for another merge.
- PDF zone mapping to BOM Normalizer.
- Grouped BOM PDF parsing with title row above primary material.
- All MPNs in one cell.
- All MFRs in one cell.
- MPN and MFR in same cell.
- Alternates in different columns.
- Alternates in different rows.
- Manufacturer match with selected checkbox changes.
- MPN validation using user-provided DigiKey credentials.
- MPN validation using user-provided Mouser credentials.
- MPN validation using user-provided Element14 credentials.
- Final mapped workbook download.
- Intermediate artifact records after final downloads and checkpoint saves.
- Dashboard/history after Docker restart.

## Known Notes / Risks

- Azure OCR can change row counts compared with zone mapping because OCR extraction quality depends on page layout and scan clarity.
- BOM Normalizer parser algorithms are frontend-side for the prototype; longer term, moving the algorithm registry to backend would make versioning and auditability stronger.
- Real provider testing is pending because successful provider validation requires live keys.
- Designer UI branch should be merged carefully with backend logic preserved from `tejchange`.
- The app currently uses session-scoped persistence rather than full authenticated tenant/user persistence.

## Overall Status

Feature status:
- Standard Mapper: implemented
- Compare/Merge Excel: implemented
- Chained merge using merged output as base: implemented
- PDF upload/extraction/zone mapping: implemented
- BOM Normalizer: implemented
- BOM Normalizer UI improvements: implemented
- Manufacturer directory/matching: implemented
- MPN parsing improvements: implemented
- MPN validation with DigiKey/Mouser/Element14: implemented
- Provider credential settings: implemented
- FactWise ID/tag tooling in BOM Normalizer: implemented
- Intermediate backend artifact saving: implemented
- Final end-to-end regression testing: pending

Recommended next action:
- Run one controlled full demo flow from upload through final download and record any remaining edge-case bugs.
