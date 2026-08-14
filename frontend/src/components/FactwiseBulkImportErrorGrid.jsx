import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, useGridApiRef } from '@mui/x-data-grid';
import SaveIcon from '@mui/icons-material/Save';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import {
  getBulkImportErrorFileUrl,
  uploadFileToFactwiseBulkImport,
  processFactwiseBulkImport,
} from '../services/factwiseApi';
import api from '../services/api';
import FactwiseNewTagsPopup from './FactwiseNewTagsPopup';
import FactwiseDuplicateTagsPopup from './FactwiseDuplicateTagsPopup';

// Reads the FactWise-generated error file for a failed bulk_import_id and
// splits it into (headers, rows, per-row per-column error map).
//
// FactWise's format (see construct_utils.construct_file_with_errors):
//   - Last column is named "errors"
//   - Its value per row is a JSON dict {"1": ["Code"], "2": ["Code1","Code2"]}
//     where keys are 1-based column indices and commas were replaced with
//     semicolons to survive CSV. Rows with errors are sorted first.
async function loadErrorWorkbook(bulkImportId) {
  const urlResp = await getBulkImportErrorFileUrl(bulkImportId);
  if (!urlResp?.success || !urlResp?.url) {
    return { ok: false, error: urlResp?.error || 'Could not fetch error file from Factwise' };
  }
  try {
    const res = await fetch(urlResp.url);
    if (!res.ok) return { ok: false, error: `Error file HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheetName = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    if (!rows.length) return { ok: false, error: 'Error file is empty' };
    const rawHeaders = rows[0].map((h) => String(h ?? '').trim());
    // Detect the "errors" column (always LAST per FW).
    const errorColIdx = rawHeaders.findIndex((h) => h.toLowerCase() === 'errors');
    const dataHeaders = errorColIdx >= 0
      ? rawHeaders.slice(0, errorColIdx)
      : rawHeaders;
    // Deduplicate + fill blank headers so DataGrid column ids are stable.
    // IMPORTANT: these are DISPLAY/field keys only. FactWise groups repeated
    // columns by exact header text (column_index_map['Tag'] -> [i, j, k]), so
    // writing "Tag (2)" back into the retry file would make FW read only the
    // first Tag column. `dataHeaders` is kept verbatim for that write-back.
    const seen = new Set();
    const headers = dataHeaders.map((h, i) => {
      const base = h || `Column ${i + 1}`;
      let candidate = base;
      let n = 1;
      while (seen.has(candidate)) {
        n += 1;
        candidate = `${base} (${n})`;
      }
      seen.add(candidate);
      return candidate;
    });

    // Build the per-row per-column error map.
    // errorMap: { [rowId]: { [headerName]: string[] } }
    const errorMap = {};
    const dataRows = rows.slice(1);
    dataRows.forEach((row, idx) => {
      if (errorColIdx < 0) return;
      const raw = String(row[errorColIdx] ?? '').trim();
      if (!raw) return;
      let parsed = null;
      try {
        parsed = JSON.parse(raw.replace(/;/g, ','));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const perRow = {};
      Object.keys(parsed).forEach((colIndex1Based) => {
        const colIdx = parseInt(colIndex1Based, 10) - 1;
        if (Number.isNaN(colIdx) || colIdx < 0 || colIdx >= headers.length) return;
        const codes = Array.isArray(parsed[colIndex1Based]) ? parsed[colIndex1Based] : [];
        if (!codes.length) return;
        perRow[headers[colIdx]] = codes.map(String);
      });
      if (Object.keys(perRow).length) errorMap[idx] = perRow;
    });

    return {
      ok: true,
      headers,
      // Raw header text exactly as FactWise emitted it (duplicates intact) —
      // this is what must go back on the wire.
      originalHeaders: dataHeaders,
      dataRows,
      errorMap,
      sheetName: firstSheetName,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to parse error file' };
  }
}

// Build the retry xlsx from the grid's current state.
//
// The two header lists are NOT interchangeable and must stay index-aligned.
// `fieldKeys` are the deduped keys the grid uses on its row objects — "Tag",
// "Tag (2)", "Tag (3)" — because MUI DataGrid needs unique field names.
// `outHeaders` are the names actually written to the sheet, which have to be
// FactWise's own originals, duplicates and all.
//
// That distinction is the whole point. FactWise's item importer looks columns
// up by NAME and buckets duplicates by exact match:
//   column_index_map["Tag"] = [indexes of every column literally named "Tag"]
// Ship "Tag (2)" / "Tag (3)" as labels and FW sees a single "Tag" column and
// drops the rest of the values — which is why lodu/kaalu never reached the DB
// while the grid held all three. So cell i of every row is read by
// fieldKeys[i] and written under outHeaders[i].
function rowsToXlsxFile(fieldKeys, outHeaders, gridRows, fileName, sheetName = 'Sheet1') {
  const headerRow = fieldKeys.map((_, i) => outHeaders?.[i] ?? fieldKeys[i]);
  const aoa = [
    headerRow,
    ...gridRows.map((r) => fieldKeys.map((k) => r[k] ?? '')),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return new File([blob], fileName, { type: blob.type });
}

// Turn a Factwise error code into a short human label for the tooltip.
function humanizeErrorCode(code) {
  return String(code || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s+/, '')
    .replace(/^./, (c) => c.toUpperCase());
}

export default function FactwiseBulkImportErrorGrid({
  bulkImportId,
  resourceType,
  additionalInformation,
  onRetrySuccess,
  onRetryFailure,
  disabled = false,
  // When set + resource is ITEM, we mirror inline cell edits back into the
  // mapper's own session (debounced) via api.updateSessionData so the main
  // data editor behind the popup reflects the fixes too. Only meaningful for
  // 'ITEM' since only that grid maps 1:1 to the mapper's session rows.
  sessionId,
  onHostRowsUpdated,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [headers, setHeaders] = useState([]); // deduped field keys (grid)
  const [originalHeaders, setOriginalHeaders] = useState([]); // raw FW headers (file)
  const [rows, setRows] = useState([]); // {id, __hasErrors, [h]: v}[]
  const [errorMap, setErrorMap] = useState({}); // {rowId: {header: string[]}}
  const [sheetName, setSheetName] = useState('Sheet1');
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState(null);
  const [showOnlyErrors, setShowOnlyErrors] = useState(true);
  const apiRef = useGridApiRef();

  // We keep the freshest row snapshot in a ref because React batches
  // setState within a single event, and MUI DataGrid's async
  // processRowUpdate → setRows call happens INSIDE the same event as the
  // Save & retry button click. Reading `rows` (the state) in the click
  // handler therefore returns the pre-edit values. rowsRef is written
  // synchronously in processRowUpdate BEFORE the batched setState, so
  // runRetry always sees the latest inline edits.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const result = await loadErrorWorkbook(bulkImportId);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setLoading(false);
        return;
      }
      const objRows = result.dataRows.map((row, idx) => {
        const obj = { id: idx, __hasErrors: Boolean(result.errorMap[idx]) };
        result.headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      setHeaders(result.headers);
      setOriginalHeaders(result.originalHeaders || result.headers);
      setRows(objRows);
      setErrorMap(result.errorMap);
      setSheetName(result.sheetName);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bulkImportId]);

  const totalErrorRows = useMemo(
    () => rows.filter((r) => r.__hasErrors).length,
    [rows]
  );

  // FactWise emits DuplicateTag when the same tag is repeated on one item
  // (e.g. Tag_1='X', Tag_2='X'). FW's admin BulkImportPage shows a specific
  // popup with a "Continue" button that reuploads with
  // `ignore_duplicate_tags: true` so the BE silently dedupes and imports.
  // Mirror that behaviour here.
  const DUPLICATE_TAG_ERROR = 'DuplicateTag';
  const hasDuplicateTagErrors = useMemo(() => {
    for (const rowId of Object.keys(errorMap)) {
      const perRow = errorMap[rowId] || {};
      for (const header of Object.keys(perRow)) {
        if ((perRow[header] || []).includes(DUPLICATE_TAG_ERROR)) return true;
      }
    }
    return false;
  }, [errorMap]);

  // Copies FW's exact 3-state pattern from BulkImportPage.tsx:
  //   const [showDuplicateTagPopup, setShowDuplicateTagPopup] = useState<
  //       boolean | null
  //   >(null);
  //   if (hasDuplicateTagError && showDuplicateTagPopup === null) {
  //       setShowDuplicateTagPopup(true);
  //   }
  // The `null` initial state is what stops the popup from re-opening after
  // the user has already responded (Fix Errors OR Continue). Once it's set
  // to true/false, it stays non-null — the auto-open guard never fires
  // again. Our previous ref-based version reset itself whenever the error
  // set briefly transitioned false→true (e.g. between error-file loads
  // after a retry), which caused the popup to keep re-appearing in a loop.
  const [showDuplicateTagPopup, setShowDuplicateTagPopup] = useState(null);
  // A brand-new bulk_import_id means a fresh error state — reset to null so
  // the popup gets exactly one auto-open per new failure, same as FW's page
  // remount behaviour.
  useEffect(() => {
    setShowDuplicateTagPopup(null);
  }, [bulkImportId]);
  useEffect(() => {
    if (hasDuplicateTagErrors && showDuplicateTagPopup === null) {
      setShowDuplicateTagPopup(true);
    }
  }, [hasDuplicateTagErrors, showDuplicateTagPopup]);

  // FactWise emits ItemTagDoesNotExist per-cell when the sheet references a
  // tag that isn't in the Item Directory yet. Instead of forcing the user to
  // manually create every tag first (or edit the sheet to remove tags), we
  // offer a one-click "Create these tags and retry" — mirrors FactWise's own
  // NewTagsConfirmationPopup on the admin bulk-import page.
  const ITEM_TAG_ERROR = 'ItemTagDoesNotExist';
  const newTagsFromErrors = useMemo(() => {
    const set = new Set();
    Object.keys(errorMap).forEach((rowId) => {
      const perRow = errorMap[rowId] || {};
      const row = rows.find((r) => String(r.id) === String(rowId));
      if (!row) return;
      Object.keys(perRow).forEach((header) => {
        if ((perRow[header] || []).includes(ITEM_TAG_ERROR)) {
          const raw = row[header];
          if (raw !== null && raw !== undefined && String(raw).trim()) {
            String(raw)
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((tag) => set.add(tag));
          }
        }
      });
    });
    return Array.from(set);
  }, [errorMap, rows]);

  const visibleRows = useMemo(() => {
    if (!showOnlyErrors) return rows;
    return rows.filter((r) => r.__hasErrors);
  }, [rows, showOnlyErrors]);

  const columns = useMemo(() => headers.map((h) => ({
    field: h,
    headerName: h,
    minWidth: 160,
    flex: 1,
    editable: !disabled && !retrying,
    sortable: false,
    filterable: false,
    cellClassName: (params) => {
      const rowErrors = errorMap[params.id];
      return rowErrors?.[h] ? 'fw-error-cell' : '';
    },
    renderCell: (params) => {
      const codes = errorMap[params.id]?.[h];
      const value = params.value ?? '';
      if (!codes) return value;
      return (
        <Tooltip
          title={
            <Stack spacing={0.5} sx={{ py: 0.25 }}>
              {codes.map((c, i) => (
                <Typography key={i} variant="caption" sx={{ fontWeight: 500 }}>
                  {humanizeErrorCode(c)}
                </Typography>
              ))}
            </Stack>
          }
          arrow
          placement="top"
        >
          <Box
            component="span"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', overflow: 'hidden' }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 14, flexShrink: 0 }} />
            <Typography
              variant="body2"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {value}
            </Typography>
          </Box>
        </Tooltip>
      );
    },
  })), [headers, errorMap, disabled, retrying]);

  // Debounced push of the entire grid back into the mapper's own session so
  // the main data editor behind the popup shows the same fixes.
  //
  // For ITEM: the error grid's headers are the mapper's item headers (Item
  // code, Item name, Tag_N, Specification_*, …) so pushing them back to
  // /update-session-data is a 1:1 sync.
  //
  // For BOM: the error grid contains BOM-structure columns (parent_item_code,
  // sub_bom_code, quantity, …) which have no canonical mapping in the
  // mapper's session model. Calling /update-session-data with them would
  // 400 with "No matching headers found." We still surface an inline
  // message so users don't wonder why their BOM cell edits didn't reach
  // the main editor — the fixes DO count for the retry that this dialog
  // sends to FactWise, they just don't rewrite the mapper's local grid.
  const [syncMessage, setSyncMessage] = useState(null);
  const syncTimerRef = useRef(null);
  const scheduleHostSync = useCallback((nextRows) => {
    if (!sessionId) return;
    if (resourceType !== 'ITEM') {
      setSyncMessage(
        'Edit saved for the retry only — BOM cells can\'t be written back into the mapper\'s main editor (edit them there directly if you want the change persisted).'
      );
      return;
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      setSyncMessage('Saving to editor…');
      try {
        // Rename dedupe suffixes (Tag, "Tag (2)", "Tag (3)") into canonical
        // per-column names (Tag_1, Tag_2, Tag_3) so every repeated column's
        // edits reach the session — the mapper stores them under Tag_N
        // internally. Same trick for Specification_* / Customer_Identification_*.
        //
        // Old bug: we stripped the "(N)" suffix and used an OBJECT dict keyed
        // by the base name, so the second and third Tag columns collapsed
        // into the first. Any edit in the 2nd/3rd Tag cell was silently
        // dropped when syncing back to the main editor.
        const stripDedup = (h) => String(h || '').replace(/\s*\(\d+\)\s*$/, '').trim();
        const REPEATABLE_PATTERNS = [
          { base: 'Tag', canonical: (n) => `Tag_${n}` },
          { base: 'Specification Name', canonical: (n) => `Specification_Name_${n}` },
          { base: 'Specification Value', canonical: (n) => `Specification_Value_${n}` },
          { base: 'Customer Identification Name', canonical: (n) => `Customer_Identification_Name_${n}` },
          { base: 'Customer Identification Value', canonical: (n) => `Customer_Identification_Value_${n}` },
        ];
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
        const counters = new Map(); // base -> next index (1-based)
        const canonicalHeaderFor = (h) => {
          const original = stripDedup(h);
          const key = norm(original);
          const pat = REPEATABLE_PATTERNS.find((p) => norm(p.base) === key);
          if (!pat) return original;
          const n = (counters.get(key) || 0) + 1;
          counters.set(key, n);
          return pat.canonical(n);
        };

        const outgoingHeaders = [];
        const seen = new Set();
        const headerMap = []; // index-parallel: gridHeader -> outgoing canonical
        headers.forEach((h) => {
          const canonical = canonicalHeaderFor(h);
          if (!canonical || seen.has(canonical)) {
            headerMap.push(null);
            return;
          }
          seen.add(canonical);
          outgoingHeaders.push(canonical);
          headerMap.push(canonical);
        });
        const clean = nextRows.map((r) => {
          const out = {};
          headers.forEach((gridHeader, i) => {
            const canonical = headerMap[i];
            if (!canonical) return;
            out[canonical] = r[gridHeader] ?? '';
          });
          return out;
        });
        const resp = await api.updateSessionData(sessionId, {
          headers: outgoingHeaders,
          data: clean,
        });
        if (resp?.data?.success === false) {
          setSyncMessage(
            `Editor sync failed: ${resp?.data?.error || 'unknown error'}`
          );
          return;
        }
        // Refresh the mapper's local rowData so the grid behind the popup
        // renders the fix when the user closes this dialog.
        await onHostRowsUpdated?.();
        setSyncMessage('Editor updated.');
        setTimeout(() => setSyncMessage(null), 1500);
      } catch (err) {
        const msg =
          err?.response?.data?.error
          || err?.message
          || 'Editor sync failed';
        setSyncMessage(`Editor sync failed: ${msg}`);
      }
    }, 400);
  }, [resourceType, sessionId, headers, onHostRowsUpdated]);

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  }, []);

  const handleCellEdit = useCallback((newRow) => {
    // Compute next from the ref (not `rows`) so that if multiple edits
    // fire in the same microtask we don't clobber each other. Write the
    // ref BEFORE queuing setRows — the ref update is what makes the
    // subsequent Save & retry click see the latest value even though
    // React hasn't re-rendered yet.
    const next = rowsRef.current.map((r) => (r.id === newRow.id ? newRow : r));
    rowsRef.current = next;
    setRows(next);
    scheduleHostSync(next);
    return newRow;
  }, [scheduleHostSync]);

  const runRetry = useCallback(async (extraAdditionalInformation = {}) => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const fileName = `bom-mapper-fixed-${bulkImportId}.xlsx`;

      // Force-commit any cell that's still in edit mode BEFORE serializing.
      //
      // Why we can't rely on MUI DataGrid v6's own commit flow: a click on
      // "Save & retry" fires input.blur → cell's onBlur → processRowUpdate
      // (async) → setState(rows). That setState is batched by React AND
      // the callback returns a promise MUI awaits internally. By the time
      // our onClick runs, `rows` state is stale AND getRowModels() reflects
      // the last RENDERED rows (which is also stale). Even setTimeout(0)
      // isn't enough because React 18 defers renders to microtask flushes.
      //
      // Deterministic fix: read the editing input's raw value straight
      // from the DOM (data-id + data-field are set by MUI on the cell
      // wrapper), merge it into our local rows snapshot, and serialize
      // THAT snapshot. Also push the correction into React state + host
      // sync so subsequent renders and the main editor see the fix too.
      // Path A (fast path — no cell in edit mode): rowsRef already reflects
      //   every committed edit (see handleCellEdit + effect wiring above).
      //
      // Path B (a cell IS still in edit mode when Save & retry is clicked):
      //   this happens when the user typed a value then clicked Save without
      //   first pressing Tab/Enter AND MUI's blur-commit hasn't fired yet.
      //   Scrape the input value directly, merge into a local snapshot, and
      //   also fire the standard commit path so React/main editor stay in
      //   sync.
      // Force-commit ANY pending inline edit before serializing. Three
      // paths, each covering a different failure mode of MUI DataGrid v6:
      //
      //   1. Ask MUI directly which cells are in edit mode and stop them.
      //      apiRef.current.getCellsInEditMode() works even when the DOM's
      //      `.MuiDataGrid-cell--editing` class was already removed by an
      //      earlier blur — MUI's internal state is the source of truth.
      //
      //   2. Force-blur the focused element. In some browser paths the
      //      blur wouldn't fire when clicking a MUI Button (MUI cancels
      //      the mousedown default), so the input never triggers its own
      //      commit. Explicit blur closes that gap.
      //
      //   3. Scrape every INPUT/TEXTAREA inside the grid regardless of
      //      edit-mode class and merge any value that differs from what
      //      rowsRef already has. Belt-and-braces for the case where MUI
      //      already tore down the edit lifecycle but our processRowUpdate
      //      handler hasn't fired yet (React 18 batching).
      let liveRows = rowsRef.current;
      const overrides = {};
      try {
        const editing = apiRef?.current?.getCellsInEditMode?.() || {};
        for (const key of Object.keys(editing)) {
          const [rid, field] = key.split('-');
          const val = editing[key]?.value;
          if (rid && field && val !== undefined) {
            (overrides[rid] = overrides[rid] || {})[field] = val;
          }
          try {
            apiRef.current.stopCellEditMode({
              id: editing[key]?.id ?? rid,
              field,
              ignoreModifications: false,
            });
          } catch { /* best-effort */ }
        }
      } catch { /* best-effort */ }
      try {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } catch { /* best-effort */ }
      try {
        const gridRoot = apiRef?.current?.rootElementRef?.current
          || document.querySelector('.MuiDataGrid-root');
        const inputs = gridRoot
          ? Array.from(gridRoot.querySelectorAll('input, textarea'))
          : [];
        for (const input of inputs) {
          if (input.type === 'checkbox' || input.type === 'radio') continue;
          const cellEl = input.closest('[data-field], [role="cell"], [role="gridcell"]');
          if (!cellEl) continue;
          const field = cellEl.getAttribute('data-field');
          const rowEl = cellEl.closest('[role="row"]');
          const rid = rowEl?.getAttribute('data-id');
          if (!rid || !field) continue;
          const domVal = input.value;
          const rowFromRef = rowsRef.current.find(
            (r) => String(r.id) === String(rid)
          );
          const existing = rowFromRef?.[field] ?? '';
          if (String(domVal) !== String(existing)) {
            (overrides[rid] = overrides[rid] || {})[field] = domVal;
          }
        }
      } catch { /* best-effort */ }
      if (Object.keys(overrides).length) {
        liveRows = liveRows.map((r) => {
          const patch = overrides[String(r.id)];
          return patch ? { ...r, ...patch } : r;
        });
        rowsRef.current = liveRows;
        setRows(liveRows);
        scheduleHostSync(liveRows);
      }

      const file = rowsToXlsxFile(headers, originalHeaders, liveRows, fileName, sheetName);
      const uploaded = await uploadFileToFactwiseBulkImport(file, resourceType);
      if (!uploaded?.success) {
        setRetryMessage(uploaded?.error || 'Reupload failed');
        onRetryFailure?.(uploaded?.error || 'Reupload failed');
        return;
      }
      const processed = await processFactwiseBulkImport(
        uploaded.bulk_import_id,
        { ...(additionalInformation || {}), ...(extraAdditionalInformation || {}) }
      );
      if (!processed?.success) {
        setRetryMessage(processed?.error || 'Process failed');
        onRetryFailure?.(processed?.error || 'Process failed', uploaded.bulk_import_id);
        return;
      }
      const resp = processed?.response || processed;
      const rtype = resp?.response_type;
      if (rtype && rtype !== 'Success') {
        setRetryMessage(resp?.error || `Still failing (${rtype}) — see fresh errors above`);
        onRetryFailure?.(resp?.error || rtype, uploaded.bulk_import_id, resp);
        return;
      }
      setRetryMessage('Retry succeeded.');
      onRetrySuccess?.(resp, uploaded.bulk_import_id);
    } catch (e) {
      setRetryMessage(e?.message || 'Unexpected error');
      onRetryFailure?.(e?.message || 'Unexpected error');
    } finally {
      setRetrying(false);
    }
  }, [
    bulkImportId, headers, originalHeaders, rows, sheetName, resourceType, apiRef,
    additionalInformation, onRetryFailure, onRetrySuccess,
  ]);

  const handleSaveAndRetry = useCallback(() => runRetry({}), [runRetry]);

  // Open the same NewTagsConfirmationPopup FactWise's admin bulk-import page
  // uses so users can mark tags as synonyms of existing tags (not just
  // "create all as new"). The popup handles synonym lookup + selection and
  // hands back a {tag: {synonym: string}} payload.
  //
  // Auto-open behaviour mirrors FW's admin: whenever a fresh bulk_import_id
  // surfaces ItemTagDoesNotExist errors, the popup pops up on its own so
  // partial-create loops (Save creates tag A but tag B still fails, retry
  // shows tag B as new) don't require re-clicking "Review new tags" every
  // cycle. Same null|boolean pattern as the duplicate-tag popup.
  const [tagsPopupOpen, setTagsPopupOpen] = useState(null);
  useEffect(() => {
    setTagsPopupOpen(null);
  }, [bulkImportId]);
  useEffect(() => {
    if (newTagsFromErrors.length > 0 && tagsPopupOpen === null) {
      setTagsPopupOpen(true);
    }
  }, [newTagsFromErrors, tagsPopupOpen]);
  const handleOpenTagsPopup = useCallback(() => {
    if (!newTagsFromErrors.length) return;
    setTagsPopupOpen(true);
  }, [newTagsFromErrors]);

  const handleTagsPopupConfirm = useCallback((tagsPayload) => {
    setTagsPopupOpen(false);
    if (!tagsPayload || !Object.keys(tagsPayload).length) return;
    runRetry({
      ignore_new_tag_validation: true,
      new_tags: tagsPayload,
    });
  }, [runRetry]);

  const handleDuplicateTagsFix = useCallback(() => {
    setShowDuplicateTagPopup(false);
  }, []);

  const handleDuplicateTagsContinue = useCallback(() => {
    setShowDuplicateTagPopup(false);
    runRetry({ ignore_duplicate_tags: true });
  }, [runRetry]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading errored rows from Factwise…</Typography>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box sx={{
        py: 2, px: 2, borderRadius: 1.5,
        border: 1, borderColor: 'error.main',
        bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(239, 68, 68, 0.08)' : '#fef2f2',
      }}>
        <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
          {loadError}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Factwise typically only generates the editable error file when the failure is per-row.
          Template-level failures (missing whole columns, wrong file format) skip that step —
          fix the underlying issue in the mapper and retry.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      '& .fw-error-cell': {
        backgroundColor: (t) => t.palette.mode === 'dark'
          ? 'rgba(239, 68, 68, 0.28)'
          : 'rgba(239, 68, 68, 0.14)',
        color: (t) => t.palette.mode === 'dark' ? '#fecaca' : '#b91c1c',
        fontWeight: 600,
      },
    }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={2}
        sx={{ mb: 1, flexWrap: 'wrap' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Chip
            size="small"
            color="error"
            variant="outlined"
            icon={<ErrorOutlineIcon />}
            label={`${totalErrorRows} rows with errors`}
          />
          <Typography variant="caption" color="text.secondary">
            {rows.length} total · edit any red cell inline, then save &amp; retry.
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showOnlyErrors}
                onChange={(e) => setShowOnlyErrors(e.target.checked)}
              />
            }
            label={<Typography variant="caption">Show only error rows</Typography>}
            sx={{ mr: 0.5 }}
          />
          {hasDuplicateTagErrors && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowDuplicateTagPopup(true)}
              disabled={disabled || retrying}
            >
              Duplicate tags…
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={retrying ? <CircularProgress size={14} /> : <SaveIcon />}
            onClick={handleSaveAndRetry}
            disabled={disabled || retrying || !headers.length}
          >
            {retrying ? 'Retrying…' : 'Save & retry'}
          </Button>
        </Stack>
      </Stack>
      {newTagsFromErrors.length > 0 && (
        <Alert
          severity="info"
          icon={<LocalOfferIcon />}
          sx={{ mb: 1 }}
          action={
            <Button
              size="small"
              variant="contained"
              startIcon={retrying ? <CircularProgress size={14} /> : <LocalOfferIcon />}
              onClick={handleOpenTagsPopup}
              disabled={disabled || retrying}
            >
              Review new tags
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {newTagsFromErrors.length} new tag{newTagsFromErrors.length === 1 ? '' : 's'} referenced in the sheet don't exist in Factwise yet.
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
            {newTagsFromErrors.slice(0, 6).join(', ')}
            {newTagsFromErrors.length > 6 ? `, +${newTagsFromErrors.length - 6} more` : ''}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
            Click "Create tags &amp; retry" to have Factwise create these tags automatically and re-run the import.
          </Typography>
        </Alert>
      )}
      {retryMessage && (
        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
          {retryMessage}
        </Typography>
      )}
      {syncMessage && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 1,
            color: syncMessage.startsWith('Editor sync failed')
              ? 'error.main'
              : 'text.secondary',
          }}
        >
          {syncMessage}
        </Typography>
      )}
      <Box sx={{ height: 460, width: '100%' }}>
        <DataGrid
          apiRef={apiRef}
          rows={visibleRows}
          columns={columns}
          density="compact"
          disableRowSelectionOnClick
          hideFooterSelectedRowCount
          processRowUpdate={handleCellEdit}
          onProcessRowUpdateError={(err) => setRetryMessage(err?.message || 'Edit failed')}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          pageSizeOptions={[25, 50, 100]}
          getRowClassName={(params) => (params.row.__hasErrors ? 'fw-error-row' : '')}
        />
      </Box>

      <FactwiseNewTagsPopup
        open={tagsPopupOpen === true}
        onClose={() => setTagsPopupOpen(false)}
        tags={newTagsFromErrors}
        onConfirm={handleTagsPopupConfirm}
        submitting={retrying}
      />

      <FactwiseDuplicateTagsPopup
        open={showDuplicateTagPopup === true}
        onFix={handleDuplicateTagsFix}
        onContinue={handleDuplicateTagsContinue}
        submitting={retrying}
      />
    </Box>
  );
}
