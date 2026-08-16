import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useFactwise } from '../contexts/FactwiseContext';
import {
  uploadFileToFactwiseBulkImport,
  processFactwiseBulkImport,
  createFactwiseProject,
  fetchModuleTemplates,
  fetchCurrencies,
  attachBomToProject,
  reviseEnterpriseBom,
  fetchEnterpriseBomCodes,
  fetchEnterpriseBomDetail,
  submitEnterpriseBom,
} from '../services/factwiseApi';
import { reviseSlots, summariseSlotResults, SLOT_OUTCOMES } from '../services/bomSlotReviseRunner';
import api from '../services/api';

// Rewrites the mapper's BOM Excel so every occurrence of the sheet's main
// BOM ID in the BOM ID / Sub BOM ID columns becomes `targetCode`. Needed for
// the revise flow — FactWise's BOM_UPDATE validator errors with
// UnreferencedSubBOMConfiguration on any BOM ID row that isn't the target
// BOM's code AND isn't referenced as a sub-BOM.
// Locate the actual header row in a FactWise-format BOM sheet. Row 4 is the
// spec, but blankrows handling in some paths can shift things — so scan.
// Returns { headerRow, headers } or { headerRow: -1 } if not found.
function locateBomHeaderRow(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    const row = aoa[r] || [];
    for (const cell of row) {
      const v = String(cell || '').trim().toLowerCase();
      if (v === 'bom id' || v === 'raw material code' || v === 'finished good code') {
        return { headerRow: r, headers: row.map((h) => String(h ?? '').trim()) };
      }
    }
  }
  return { headerRow: -1, headers: [] };
}

// Rebuild the sheet's array-of-arrays into FactWise's canonical layout:
// rows 1-3 spacer (row 3 gets a single space so trimmers don't drop it),
// row 4 headers, row 5+ data. openpyxl/Aditya's parser reads absolute row
// 4 as headers, so this positioning matters — SheetJS's aoa_to_sheet will
// otherwise compact away empty leading rows.
function buildFactwiseFormatAoa(headers, dataRows) {
  const width = headers.length;
  const emptyRow = new Array(width).fill('');
  const spacerRow3 = new Array(width).fill('');
  spacerRow3[0] = ' ';
  return [emptyRow, [...emptyRow], spacerRow3, headers, ...dataRows];
}

async function retargetBomSheetToCode(file, targetCode) {
  if (!targetCode) return file;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: true,
    });
    if (!aoa.length) return file;
    const { headerRow, headers } = locateBomHeaderRow(aoa);
    if (headerRow < 0) return file;

    const idxBomId = headers.findIndex(
      (h) => /^bom\s*id$/i.test(h) || /^bom_code$/i.test(h)
    );
    const idxSubBomId = headers.findIndex(
      (h) => /^sub\s*bom\s*id$/i.test(h) || /^sub_bom_code$/i.test(h)
    );
    if (idxBomId < 0) return file;

    const dataRows = aoa.slice(headerRow + 1);

    // First pass: build the set of Sub BOM IDs referenced anywhere. Any BOM ID
    // that IS also a Sub BOM ID represents a legitimate sub-BOM in the tree
    // and must stay named the same. All other BOM ID values are candidates
    // for the "main" BOM row — those get retargeted to targetCode.
    const referencedAsSub = new Set();
    if (idxSubBomId >= 0) {
      for (const row of dataRows) {
        const v = String(row?.[idxSubBomId] ?? '').trim();
        if (v) referencedAsSub.add(v);
      }
    }

    // Renames map: whatever the mapper called the main BOM → targetCode.
    const renames = {};
    for (const row of dataRows) {
      const v = String(row?.[idxBomId] ?? '').trim();
      if (!v) continue;
      if (referencedAsSub.has(v)) continue; // real sub-BOM, leave alone
      if (!renames[v]) renames[v] = targetCode;
    }
    if (!Object.keys(renames).length) return file;

    for (const row of dataRows) {
      if (!Array.isArray(row)) continue;
      const b = String(row[idxBomId] ?? '').trim();
      if (b && renames[b]) row[idxBomId] = renames[b];
      // Also rewrite Sub BOM ID cells that pointed at the mapper's main code
      // (children of the top-level BOM must reference the new code).
      if (idxSubBomId >= 0) {
        const s = String(row[idxSubBomId] ?? '').trim();
        if (s && renames[s]) row[idxSubBomId] = renames[s];
      }
    }

    // Rebuild in canonical FactWise layout (row 4 header) so downstream
    // parsers that index by absolute row see the right thing.
    const finalAoa = buildFactwiseFormatAoa(headers, dataRows);
    const newWs = XLSX.utils.aoa_to_sheet(finalAoa);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, 'BOM Data');
    const out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return new File([blob], file.name, { type: blob.type });
  } catch {
    return file;
  }
}

// Recursively flatten an R4 BOM's item tree into a { raw_material_code:
// {quantity, cost_per_unit, measurement_unit} } map. Sub-BOM entries are
// walked but not indexed by themselves — only leaf raw materials go into
// the map. Alternates are indexed too since a mapper-authored sheet can
// list either primary or alternate item codes in `Raw material code`.
function flattenR4ItemsByCode(bomItems, out = {}) {
  const list = Array.isArray(bomItems) ? bomItems : [];
  for (const item of list) {
    const rm = item?.raw_material_item;
    if (rm?.code) {
      const key = String(rm.code).trim();
      if (key && !(key in out)) {
        out[key] = {
          quantity: item?.quantity ?? null,
          cost_per_unit: item?.cost_per_unit ?? null,
          measurement_unit_id: item?.measurement_unit ?? null,
        };
      }
    }
    const alts = Array.isArray(item?.alternates) ? item.alternates : [];
    for (const altWrap of alts) {
      const alt = altWrap?.alternate_bom_item || altWrap;
      const altCode = alt?.raw_material_item?.code;
      if (altCode) {
        const key = String(altCode).trim();
        if (key && !(key in out)) {
          out[key] = {
            quantity: alt?.quantity ?? null,
            cost_per_unit: alt?.cost_per_unit ?? null,
            measurement_unit_id: alt?.measurement_unit ?? null,
          };
        }
      }
    }
    const subs = Array.isArray(item?.sub_bom_items) ? item.sub_bom_items : [];
    if (subs.length) flattenR4ItemsByCode(subs, out);
  }
  return out;
}

// Populate empty Cost per unit cells in the revision sheet from R4's
// stored costs. Mapper's bom_generator never writes cost (no F_COST
// constant, cost was never a mapper field concept), so left as-is every
// row has empty cost → Aditya's revision-preview parses "" as 0 → diffs
// against R4's real cost on every item → 100% false-positive noise.
// Skips cells the user explicitly populated (respects intentional cost
// changes when a source Excel with cost mapped somehow lands here).
async function hydrateRevisionSheetFromR4(file, r4CostByCode) {
  if (!r4CostByCode || !Object.keys(r4CostByCode).length) return file;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: true,
    });
    if (!aoa.length) return file;
    const { headerRow, headers } = locateBomHeaderRow(aoa);
    if (headerRow < 0) return file;

    const idxRawMat = headers.findIndex(
      (h) => /^raw\s*material\s*code$/i.test(h)
    );
    const idxCost = headers.findIndex(
      (h) => /^cost\s*per\s*unit$/i.test(h)
    );
    if (idxRawMat < 0 || idxCost < 0) return file;

    const dataRows = aoa.slice(headerRow + 1);
    let hydratedCount = 0;
    for (const row of dataRows) {
      if (!Array.isArray(row)) continue;
      const code = String(row[idxRawMat] ?? '').trim();
      if (!code) continue;
      const existingCost = row[idxCost];
      if (existingCost !== '' && existingCost !== null && existingCost !== undefined) {
        continue; // user (or upstream) explicitly set cost — leave alone
      }
      const r4 = r4CostByCode[code];
      if (r4 && r4.cost_per_unit !== null && r4.cost_per_unit !== undefined) {
        row[idxCost] = r4.cost_per_unit;
        hydratedCount += 1;
      }
    }
    if (!hydratedCount) return file;

    const finalAoa = buildFactwiseFormatAoa(headers, dataRows);
    const newWs = XLSX.utils.aoa_to_sheet(finalAoa);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, 'BOM Data');
    const out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return new File([blob], file.name, { type: blob.type });
  } catch {
    return file;
  }
}

// Rewrites the mapper's BOM Excel so its BOM ID / Sub BOM ID cells that
// collide with an existing ONGOING enterprise BOM code get a unique suffix
// appended. Prevents FactWise's "Cannot update submitted BOM" error in the
// BOM_DASHBOARD path, which refuses to overwrite non-DRAFT BOMs.
// Returns the (possibly-new) File and the code map used.
async function renameCollidingBomCodes(file, existingCodes) {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    // blankrows:true (default) preserves the 3-row spacer FactWise's format
    // expects above HEADER_ROW=4. Without this, blank rows get stripped and
    // the rewritten sheet has headers on row 2 instead of row 4 — every
    // FactWise BOM parser then reports "Missing required columns" because
    // it reads absolute row 4 and finds empty cells.
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: true,
    });
    if (!aoa.length) return { file, renames: {} };
    const headers = aoa[0].map((h) => String(h ?? '').trim());
    const idxBomId = headers.findIndex(
      (h) => /^bom\s*id$/i.test(h) || /^bom_code$/i.test(h)
    );
    const idxSubBomId = headers.findIndex(
      (h) => /^sub\s*bom\s*id$/i.test(h) || /^sub_bom_code$/i.test(h)
    );
    if (idxBomId < 0) return { file, renames: {} };

    const existingSet = new Set(
      (existingCodes || []).map((c) => String(c || '').trim().toLowerCase())
    );

    // Compute one rename per unique conflicting code (stable across the sheet).
    const renames = {};
    const suffix = `_M${Date.now().toString(36)}`;
    for (let r = 1; r < aoa.length; r++) {
      const value = String(aoa[r][idxBomId] ?? '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (existingSet.has(key) && !renames[value]) {
        renames[value] = `${value}${suffix}`;
      }
    }
    if (!Object.keys(renames).length) return { file, renames: {} };

    // Apply renames to BOM ID and (if present) Sub BOM ID columns.
    for (let r = 1; r < aoa.length; r++) {
      const b = String(aoa[r][idxBomId] ?? '').trim();
      if (b && renames[b]) aoa[r][idxBomId] = renames[b];
      if (idxSubBomId >= 0) {
        const s = String(aoa[r][idxSubBomId] ?? '').trim();
        if (s && renames[s]) aoa[r][idxSubBomId] = renames[s];
      }
    }

    const newWs = XLSX.utils.aoa_to_sheet(aoa);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, sheetName);
    const out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const newFile = new File([blob], file.name, { type: blob.type });
    return { file: newFile, renames };
  } catch {
    // If anything about the client-side rewrite goes wrong, fall through to
    // the original file — FactWise will error clearly and the user can retry.
    return { file, renames: {} };
  }
}

// Phases the orchestration progresses through. Persisted in localStorage so
// the user can resume from wherever it failed, even after refreshing.
export const PHASES = {
  IDLE: 'IDLE',
  ITEMS_UPLOADING: 'ITEMS_UPLOADING',
  ITEMS_PROCESSING: 'ITEMS_PROCESSING',
  ITEMS_ERROR: 'ITEMS_ERROR',
  ITEMS_DONE: 'ITEMS_DONE',
  // Pause between item-create success and BOM upload so FactWise's Celery
  // worker finishes indexing the new items before BOMRevisionImport looks
  // them up.
  ITEMS_SETTLING: 'ITEMS_SETTLING',
  BOM_UPLOADING: 'BOM_UPLOADING',
  BOM_PROCESSING: 'BOM_PROCESSING',
  BOM_ERROR: 'BOM_ERROR',
  BOM_DONE: 'BOM_DONE',
  // Revise-only. Fires as the FIRST phase of any revise export, BEFORE any
  // FactWise-mutating call — no item upload, no /revise/, no sheet upload.
  // Dialog fetches R4 (read-only) + mapper's own bom_tree (read-only,
  // session-scoped) and shows a diff. Confirm sets the flag and re-enters
  // runFromCheckpoint to do the actual work. Reject → IDLE, no state to
  // unwind server-side.
  REVIEW_DIFF: 'REVIEW_DIFF',
  // Pause between BOM creation and BOM attach — the BOM record + its
  // bom_items are populated by an async pipeline; hitting attach before
  // /bom/{id}/admin/ returns the full item tree causes create_bom_module
  // to crash on empty alternates or missing IDs.
  BOM_SETTLING: 'BOM_SETTLING',
  PROJECT_CREATING: 'PROJECT_CREATING',
  PROJECT_ERROR: 'PROJECT_ERROR',
  ATTACH_BOM: 'ATTACH_BOM',
  ATTACH_BOM_ERROR: 'ATTACH_BOM_ERROR',
  DONE: 'DONE',
};

// Longer settle for larger imports — items/BOM Celery jobs can take 10-30s
// on production DBs when the file has 500+ rows. Poll actively where we
// can and fall back to sleep otherwise.
const ITEMS_SETTLE_MS = 5000;
const BOM_ATTACH_MAX_ATTEMPTS = 6;
const BOM_ATTACH_RETRY_BASE_MS = 4000;

// Transient FW-server messages that indicate "resource not fully persisted
// yet" — safe to retry. Anything else is treated as terminal.
const TRANSIENT_ATTACH_ERRORS = [
  'noneType',                          // create_bom_module hitting a null lookup
  "'NoneType' object has no attribute",
  'does not exist',
  'DoesNotExist',
  'not found',
  'IntegrityError',
];
function isTransientAttachError(msg) {
  const s = String(msg || '').toLowerCase();
  return TRANSIENT_ATTACH_ERRORS.some((t) => s.includes(t.toLowerCase()));
}

// Wait until FactWise's /bom/{id}/admin/ returns a non-empty bom_items list.
// Guards against attaching a freshly-created BOM whose Celery pipeline
// hasn't hydrated the item rows yet.
async function waitForBomReady({ enterpriseBomId, timeoutMs = 45000, intervalMs = 2500 }) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const resp = await fetchEnterpriseBomDetail(enterpriseBomId);
    if (resp?.success) {
      const items = Array.isArray(resp.bom?.bom_items) ? resp.bom.bom_items : [];
      if (items.length > 0) return { ok: true, items, attempts: attempt };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, error: `BOM ${enterpriseBomId} not hydrated after ${timeoutMs}ms` };
}

// New vs existing project target.
export const PROJECT_MODES = {
  NEW: 'NEW',
  EXISTING: 'EXISTING',
};

const TERMINAL_ERROR_PHASES = new Set([
  PHASES.ITEMS_ERROR,
  PHASES.BOM_ERROR,
  PHASES.PROJECT_ERROR,
  PHASES.ATTACH_BOM_ERROR,
]);

const CHECKPOINT_KEY = (sessionId) => `fw_project_export_ckpt:${sessionId || 'default'}`;

const emptyState = {
  phase: PHASES.IDLE,
  mode: PROJECT_MODES.NEW,
  projectName: '',
  // Chosen project template id + display name (only used when mode === NEW).
  templateId: null,
  templateName: null,
  // Existing-project target (only used when mode === EXISTING).
  existingProjectId: null,
  existingProjectName: null,
  // User-chosen revision target (the ONGOING BOM they picked in the dialog).
  reviseEnterpriseBomId: null,
  reviseBomModuleId: null,
  // Every slot to move, as linkage ids. A project can hold the same BOM in
  // several slots at once and the user picks which of them follow the new
  // revision, so this is a list; `reviseBomModuleId` above stays for older
  // checkpoints written before it was one.
  reviseBomModuleIds: [],
  reviseBomCode: null,      // just for display
  // Set once we've called /bom/admin/<id>/revise/ — this is the new DRAFT id
  // we upload the bulk import against. Cached so retries don't re-revise.
  revisedNewEnterpriseBomId: null,
  // Cached from R5's admin detail (fetched during runBomStep Path A) so the
  // post-review confirm flow can call bulk_import/process/ without a second
  // round-trip. process/ needs all four of these as additional_information.
  revisedTemplateId: null,
  revisedFinishedGoodId: null,
  revisedEntityIds: [],
  revisedTargetBomCode: null,
  // Item step checkpoint
  itemBulkImportId: null,
  itemCreated: [],
  itemUpdated: [],
  // BOM step checkpoint
  bomBulkImportId: null,
  bomIds: [],
  // Project step checkpoint
  projectId: null,
  // BOM attach checkpoint
  attachedBomIds: [],
  revisedProjectBomModules: [], // bom_module_ids we revised in-place
  // Error surfaces
  lastError: null,
  lastResponseType: null,
  lastBulkImportId: null,
  // Revision review gate. Revise-mode exports STOP on REVIEW_DIFF as their
  // very first phase. Only after the user hits Confirm in the diff dialog
  // does this flip true, and runFromCheckpoint proceeds into the item →
  // revise → sheet-upload → handoff sequence. Reject resets to IDLE with
  // this still false and no FactWise state to unwind.
  revisionReviewConfirmed: false,
  // Sticky "we already exported this to Factwise" flags, persisted via the
  // checkpoint. Set to true after a successful runItemStep / BOM_DASHBOARD
  // runBomStep. runFromCheckpoint honors them across dialog opens — so a
  // user who exported items+BOM via the BOM Directory dialog and then
  // opens the Project dialog won't re-upload items and re-create the BOM.
  // Cleared by hard reset() (Start Over button); preserved by softReset()
  // (dialog transition closed→open). See runFromCheckpoint's itemDone
  // and bomDone checks.
  sessionExportedItems: false,
  sessionExportedBom: false,
};

function loadCheckpoint(sessionId) {
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY(sessionId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCheckpoint(sessionId, state) {
  try {
    window.localStorage.setItem(CHECKPOINT_KEY(sessionId), JSON.stringify(state));
  } catch { /* best-effort */ }
}

function clearCheckpoint(sessionId) {
  try {
    window.localStorage.removeItem(CHECKPOINT_KEY(sessionId));
  } catch { /* best-effort */ }
}

// Downloads the generated Excel from the mapper backend and wraps as File.
// exportType 'item' → the mapped/normalized rows in FactWise Item Directory shape.
// exportType 'bom'  → a DIFFERENT endpoint (downloadDemoBomSheet) that returns the
//                     BOM in FactWise BOM Directory shape (includes Finished good
//                     code, Assembly qty, etc). Same file the "Download" button
//                     inside the FactWise-export preview produces.
//
// Before downloading we call any refresher the host provided (usually
// EnhancedDataEditor's fetchDataSynchronized) so the mapper's local state, its
// column order, AND the BE session are all in sync — otherwise a user who just
// filled required warnings could see us upload the pre-fill snapshot.
async function buildFile(sessionId, columnOrder, exportType, prefix, refreshHost) {
  if (refreshHost) {
    try { await refreshHost(); } catch (_) { /* best-effort */ }
  }
  const response = exportType === 'bom'
    ? await api.downloadDemoBomSheet(sessionId)
    : await api.downloadProcessedFile(sessionId, 'excel', columnOrder, 'item');
  const blob = new Blob([response.data], {
    type: response.headers?.['content-type']
      || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const fileName = `bom-mapper-${prefix}-${sessionId || 'session'}.xlsx`;
  return new File([blob], fileName, { type: blob.type });
}

export function useFactwiseProjectExport({ sessionId, getColumnOrder, refreshHost } = {}) {
  const { isEmbedded, entityId } = useFactwise();
  const [state, setState] = useState(emptyState);
  // Ref mirror of state — used by runFromCheckpoint so it can read the
  // freshest phase / checkpoint EVEN when called immediately after a patch
  // in the same event handler (before React flushes the re-render). Without
  // this, markRetrySucceeded → runFromCheckpoint fires with the closure's
  // stale state.phase = 'ITEMS_ERROR' and re-runs the just-succeeded step
  // from scratch — dropping the new_tags / ignore_duplicate_tags flags.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Rehydrate from localStorage on mount (so refresh doesn't lose progress).
  useEffect(() => {
    const saved = loadCheckpoint(sessionId);
    if (saved) {
      const rehydrated = { ...emptyState, ...saved };
      setState(rehydrated);
      stateRef.current = rehydrated;
    }
  }, [sessionId]);

  const patch = useCallback((delta) => {
    // Write to the ref + localStorage BEFORE calling setState. React 18
    // defers the setState functional updater until the commit phase — if
    // we do saveCheckpoint inside the updater and the next await tick
    // fires before commit, the very next read (loadCheckpoint or
    // stateRef.current) sees stale data. Symptom: runProjectStep patches
    // projectId, runAttachBomStep immediately reads localStorage, gets
    // undefined → "Missing project or BOM identifiers to attach."
    // Retry works only because commit has fired by then.
    const next = { ...stateRef.current, ...delta };
    stateRef.current = next;
    saveCheckpoint(sessionId, next);
    setState(next);
  }, [sessionId]);

  const reset = useCallback(() => {
    clearCheckpoint(sessionId);
    setState(emptyState);
    stateRef.current = emptyState;
  }, [sessionId]);

  // Soft reset — clears the CURRENT run's phase and error surfaces so the
  // user starts fresh in the dialog, but keeps the sticky sessionExported
  // flags and the ids we'd need to attach an already-uploaded BOM to a
  // new project. Called on dialog transition closed→open so opening the
  // Project dialog after the BOM Directory dialog doesn't re-upload items
  // or re-create the BOM. A hard reset (via Start Over button) clears
  // everything and forces a fresh export.
  const softReset = useCallback(() => {
    const cur = stateRef.current;
    const next = {
      ...emptyState,
      sessionExportedItems: cur.sessionExportedItems,
      sessionExportedBom: cur.sessionExportedBom,
      // Keep the ids we'd need to attach an existing BOM into a new project.
      itemBulkImportId: cur.sessionExportedItems ? cur.itemBulkImportId : null,
      itemCreated: cur.sessionExportedItems ? cur.itemCreated : [],
      itemUpdated: cur.sessionExportedItems ? cur.itemUpdated : [],
      bomBulkImportId: cur.sessionExportedBom ? cur.bomBulkImportId : null,
      bomIds: cur.sessionExportedBom ? cur.bomIds : [],
    };
    saveCheckpoint(sessionId, next);
    setState(next);
    stateRef.current = next;
  }, [sessionId]);

  // -------- Item step --------
  const runItemStep = useCallback(async () => {
    patch({ phase: PHASES.ITEMS_UPLOADING, lastError: null, lastResponseType: null });
    try {
      const columnOrder = getColumnOrder?.() || null;
      const file = await buildFile(sessionId, columnOrder, 'item', 'items', refreshHost);
      const uploaded = await uploadFileToFactwiseBulkImport(file, 'ITEM');
      if (!uploaded?.success) {
        patch({
          phase: PHASES.ITEMS_ERROR,
          lastError: uploaded?.error || 'Item file upload failed',
        });
        return { ok: false };
      }
      patch({
        phase: PHASES.ITEMS_PROCESSING,
        itemBulkImportId: uploaded.bulk_import_id,
      });

      const processed = await processFactwiseBulkImport(uploaded.bulk_import_id, {});
      if (!processed?.success) {
        patch({
          phase: PHASES.ITEMS_ERROR,
          lastError: processed?.error || 'Item process call failed',
          lastBulkImportId: uploaded.bulk_import_id,
        });
        return { ok: false };
      }

      const resp = processed?.response || processed;
      const rtype = resp?.response_type;
      if (rtype && rtype !== 'Success') {
        patch({
          phase: PHASES.ITEMS_ERROR,
          lastError: resp?.error || `Item validation failed (${rtype})`,
          lastResponseType: rtype,
          lastBulkImportId: uploaded.bulk_import_id,
        });
        return { ok: false };
      }

      patch({
        phase: PHASES.ITEMS_DONE,
        itemCreated: resp?.created_identifiers || [],
        itemUpdated: resp?.updated_identifiers || [],
        // Sticky flag — future dialog opens will skip this step so items
        // aren't re-uploaded to the Item Directory. Cleared only by hard
        // reset (Start Over button).
        sessionExportedItems: true,
      });
      return { ok: true };
    } catch (error) {
      patch({
        phase: PHASES.ITEMS_ERROR,
        lastError: error?.message || 'Unexpected error during item step',
      });
      return { ok: false };
    }
  }, [patch, sessionId, getColumnOrder, refreshHost]);

  // -------- BOM step --------
  // Always upload as a fresh BOM_DASHBOARD create — regardless of whether the
  // dialog picked a revise target. FactWise's BOM_UPDATE validator is strict:
  //   - The sheet's main BOM ID must equal the target BOM's code
  //   - Any other BOM IDs in the sheet must be referenced as sub-BOMs
  // The mapper generates its own bom_code that won't match FactWise's
  // auto-generated revision code (e.g. ABB5_R2), so BOM_UPDATE always errors
  // with UnreferencedSubBOMConfiguration or similar structural checks.
  //
  // Instead we create a NEW BOM in the admin directory (unique bom_code from
  // the mapper) and — for EXISTING mode + revise target — the attach step
  // uses reviseProjectBom() to repoint the project's bom_module to the new
  // BOM. Old BOM stays in the admin directory as history. Project sees the
  // updated content.
  const runBomStep = useCallback(async () => {
    patch({ phase: PHASES.BOM_UPLOADING, lastError: null, lastResponseType: null });
    try {
      const columnOrder = getColumnOrder?.() || null;
      let file = await buildFile(sessionId, columnOrder, 'bom', 'bom', refreshHost);

      const saved = loadCheckpoint(sessionId) || {};
      const originalReviseId = saved.reviseEnterpriseBomId || null;
      const alreadyRevised = saved.revisedNewEnterpriseBomId || null;

      // -------- Path A: user picked "Revise: X" --------
      // Mirrors FactWise admin's EditBomPage bulk import:
      //   1. Call /bom/admin/<X>/revise/ to get a fresh DRAFT copy (X_R2). This
      //      new BOM has no project linkages, so item delete/recreate is safe.
      //   2. Fetch the DRAFT's detail to pull template_id + finished_good_id
      //      + entity_ids — required by BOMRevisionImport.
      //   3. Upload with resource_type = BOM_REVISION (routes to the correct
      //      import service).
      //   4. process/ with additional_information = { enterprise_bom_id: new_draft,
      //      template_id, finished_good_id, entity_ids }, import_type = BOM_UPDATE.
      //   5. Attach step later repoints the project's bom_module to new_draft.
      if (originalReviseId) {
        let newDraftId = alreadyRevised;
        if (!newDraftId) {
          // FactWise only lets you revise ONGOING BOMs. Check status first so
          // we can react intelligently instead of always calling revise/ and
          // hitting INVALID BOM STATUS:
          //   ONGOING  → normal path, create a fresh DRAFT copy to upload into
          //   DRAFT    → the picked BOM IS already a draft (maybe from a prior
          //              half-completed run) — reuse it directly
          //   REVISED  → the picked BOM has been superseded, stop and tell user
          const pickedDetailResp = await fetchEnterpriseBomDetail(originalReviseId);
          const pickedBom = pickedDetailResp?.bom;
          const pickedStatus = pickedBom?.bom_status;
          if (pickedStatus === 'ONGOING') {
            // Before calling /revise/, check whether an orphan DRAFT for
            // the next revision already exists. This happens whenever a
            // prior revise attempt didn't fully complete — user rejected
            // in the diff review, the flow errored between /revise/ and
            // handoff save, tab was closed mid-flight, etc. In all those
            // cases FactWise's admin_revise_bom deterministically builds
            // the same bom_code for R5 (`<code>_R<version+1>` or the
            // suffix-replace variant) and the unique-code constraint
            // rejects the second attempt with a 500. Reusing the orphan
            // instead of creating a duplicate is both correct (nothing
            // has been committed to that draft yet) and the ONLY way to
            // recover without a manual FactWise cleanup.
            const pickedBaseBomId = pickedBom?.base_bom_id;
            const nextVersion = (pickedBom?.version || 1) + 1;
            let existingDraftId = null;
            if (pickedBaseBomId) {
              const codesResp = await fetchEnterpriseBomCodes();
              if (codesResp?.success) {
                const orphan = (codesResp.boms || []).find((b) => (
                  String(b.base_bom_id) === String(pickedBaseBomId)
                  && Number(b.version) === Number(nextVersion)
                ));
                if (orphan?.enterprise_bom_id) {
                  const orphanDetail = await fetchEnterpriseBomDetail(orphan.enterprise_bom_id);
                  if (orphanDetail?.success && orphanDetail.bom?.bom_status === 'DRAFT') {
                    existingDraftId = orphan.enterprise_bom_id;
                  }
                }
              }
            }
            if (existingDraftId) {
              newDraftId = existingDraftId;
            } else {
              const revised = await reviseEnterpriseBom(originalReviseId);
              if (!revised?.success || !revised?.enterprise_bom_id) {
                patch({
                  phase: PHASES.BOM_ERROR,
                  lastError: revised?.error || 'Could not create a BOM revision in Factwise',
                });
                return { ok: false };
              }
              newDraftId = revised.enterprise_bom_id;
            }
          } else if (pickedStatus === 'DRAFT') {
            newDraftId = originalReviseId;
          } else {
            patch({
              phase: PHASES.BOM_ERROR,
              lastError:
                `Picked BOM is in "${pickedStatus || 'unknown'}" status, `
                + 'not ONGOING. Click "Start over", refresh the picker, and pick '
                + 'the current version instead.',
            });
            return { ok: false };
          }
          patch({ revisedNewEnterpriseBomId: newDraftId });
        }

        const detailResp = await fetchEnterpriseBomDetail(newDraftId);
        const draft = detailResp?.bom;
        const templateId = draft?.enterprise_item?.bom_template?.template_id || null;
        const finishedGoodId = draft?.enterprise_item?.enterprise_item_id || null;
        const targetBomCode = draft?.bom_code || null;
        const entityIds = (draft?.entities || [])
          .map((e) => e.buyer_entity_id || e.entity_id)
          .filter(Boolean);
        if (!templateId || !finishedGoodId || !targetBomCode) {
          patch({
            phase: PHASES.BOM_ERROR,
            lastError: detailResp?.error
              || "Could not read the revision's template / finished good / code — cannot proceed.",
          });
          return { ok: false };
        }
        // Cache these so the post-review confirm flow can call
        // bulk_import/process/ without re-fetching R5's admin detail.
        patch({
          revisedTemplateId: templateId,
          revisedFinishedGoodId: finishedGoodId,
          revisedEntityIds: entityIds,
          revisedTargetBomCode: targetBomCode,
        });

        // FactWise's BOM_UPDATE validator requires the sheet's main BOM ID to
        // equal the target BOM's code. The mapper's Excel uses its own
        // bom_code (say "MAPPED_BOM_1"), so we rewrite the sheet so its main
        // BOM ID (and any Sub BOM ID references pointing at it) become the
        // draft's code (e.g. "ABB5_R2"). Real sub-BOMs keep their own codes.
        let sheetFile = await retargetBomSheetToCode(file, targetBomCode);

        // Hydrate empty Cost per unit cells from R4's stored values. Mapper's
        // bom_generator never writes cost (no F_COST field). Without this
        // fill-in step, Aditya's revision-preview parses "" as 0 for every
        // row and the diff flags every item as "cost changed" against R4's
        // real cost. Only cells the user left blank are touched — a mapped-
        // source with real cost values takes precedence.
        try {
          const r4Detail = await fetchEnterpriseBomDetail(originalReviseId);
          if (r4Detail?.success && r4Detail.bom?.bom_items) {
            const r4Map = flattenR4ItemsByCode(r4Detail.bom.bom_items);
            sheetFile = await hydrateRevisionSheetFromR4(sheetFile, r4Map);
          }
        } catch (_) {
          // Hydration is best-effort — a fetch failure here only means
          // the diff will show cost changes on unchanged items. It does
          // not prevent the export from proceeding.
        }

        const uploaded = await uploadFileToFactwiseBulkImport(sheetFile, 'BOM_REVISION');
        if (!uploaded?.success) {
          patch({
            phase: PHASES.BOM_ERROR,
            lastError: uploaded?.error || 'BOM revision upload failed',
          });
          return { ok: false };
        }
        patch({
          phase: PHASES.BOM_PROCESSING,
          bomBulkImportId: uploaded.bulk_import_id,
        });

        // Record the upload against the session so it can be read back with
        // GET /bom/revision-handoff/<sessionId>/ — the editor's uuid is the only
        // handle an outside caller has on this flow. Written BEFORE processing,
        // because the point of exposing it is to let something else do the
        // processing; if that ever becomes the only path, the record is already
        // where it needs to be. Best effort: failing to record must not fail an
        // import that is otherwise fine.
        const handoffSaved = await api.saveBomRevisionHandoff(sessionId, {
          bulkImportId: uploaded.bulk_import_id,
          fileName: uploaded.file_name,
          blobKey: uploaded.blob_key || '',
          enterpriseBomId: newDraftId,
          bomCode: targetBomCode,
          templateId,
          finishedGoodId,
          // process/ wants these three alongside the bulk_import_id, and all of
          // them come off the draft's detail — which only this flow fetched.
          entityIds,
        }).catch(err => ({ error: err }));
        if (handoffSaved?.error) {
          // Not best-effort any more. The handoff IS the output of this flow —
          // the revision draft exists and the sheet is uploaded, and if nobody
          // can read back which BOM and which project they belong to, the run
          // has produced an orphan draft and nothing else.
          patch({
            phase: PHASES.BOM_ERROR,
            lastError: 'The BOM was uploaded but the revision handoff could not be '
                       + 'recorded, so nothing can finish it. Retry the export.',
            lastBulkImportId: uploaded.bulk_import_id,
          });
          return { ok: false };
        }

        // Sheet uploaded, handoff record saved. Everything needed for FW's
        // revision-preview page is now in place: R5 draft exists, sheet is
        // in blob keyed by bulk_import_id, handoff row is written.
        //
        // If the user hasn't reviewed the diff yet, PAUSE HERE. The export
        // dialog reacts to REVIEW_DIFF by opening FW's comparison page in
        // preview mode (Aditya's revision-preview endpoint). When the user
        // clicks Confirm in FW, a postMessage flips revisionReviewConfirmed
        // and re-enters this function; second time through, the block below
        // is skipped and we fall through to the item step + slot revise.
        //
        // Reject in FW cleans up via cancelRevisionDiff — R5 is left as an
        // orphan draft in the admin BOM directory (harmless, no items,
        // no project uses it), just like a manually-cancelled revision.
        if (!stateRef.current.revisionReviewConfirmed) {
          patch({
            phase: PHASES.REVIEW_DIFF,
            bomIds: [newDraftId],
          });
          return { ok: true, awaitingReview: true };
        }
        // Review confirmed — the caller (runFromCheckpoint) will now run
        // the item step and then the slot revise. runBomStep is done.
        patch({ phase: PHASES.BOM_DONE, bomIds: [newDraftId] });
        return { ok: true, handedOff: true };
      }

      // -------- Path B: fresh create --------
      const codesResp = await fetchEnterpriseBomCodes();
      if (codesResp?.success) {
        const existingCodes = (codesResp.boms || []).map((b) => b.bom_code);
        const rewritten = await renameCollidingBomCodes(file, existingCodes);
        file = rewritten.file;
      }

      const uploaded = await uploadFileToFactwiseBulkImport(file, 'BOM');
      if (!uploaded?.success) {
        patch({
          phase: PHASES.BOM_ERROR,
          lastError: uploaded?.error || 'BOM file upload failed',
        });
        return { ok: false };
      }
      patch({
        phase: PHASES.BOM_PROCESSING,
        bomBulkImportId: uploaded.bulk_import_id,
      });

      const processed = await processFactwiseBulkImport(
        uploaded.bulk_import_id,
        { import_type: 'BOM_DASHBOARD' }
      );
      if (!processed?.success) {
        patch({
          phase: PHASES.BOM_ERROR,
          lastError: processed?.error || 'BOM process call failed',
          lastBulkImportId: uploaded.bulk_import_id,
        });
        return { ok: false };
      }

      const resp = processed?.response || processed;
      const rtype = resp?.response_type;
      if (rtype && rtype !== 'Success') {
        patch({
          phase: PHASES.BOM_ERROR,
          lastError: resp?.error || `BOM validation failed (${rtype})`,
          lastResponseType: rtype,
          lastBulkImportId: uploaded.bulk_import_id,
        });
        return { ok: false };
      }

      const bomIds = resp?.bom_ids || [];
      // Publish DRAFT → ONGOING so the project can actually use it. FactWise's
      // BOM_DASHBOARD import leaves new BOMs in DRAFT status; without this
      // submit, attaching the BOM to a project shows an empty Add Item tab
      // and the project's own Submit BOM button silently fails.
      for (const id of bomIds) {
        const submitted = await submitEnterpriseBom(id);
        if (!submitted?.success) {
          patch({
            phase: PHASES.BOM_ERROR,
            lastError:
              submitted?.error
              || `BOM ${id} imported but could not be submitted to ONGOING.`,
          });
          return { ok: false };
        }
      }
      patch({
        phase: PHASES.BOM_DONE,
        bomIds,
        // Sticky flag — future dialog opens will skip this step. Combined
        // with sessionExportedItems, an "Export to BOM Directory" run
        // followed by "Export to Project" reuses the already-created BOM
        // (attach step reads bomIds from the checkpoint) instead of
        // uploading + creating duplicates.
        sessionExportedBom: true,
      });
      return { ok: true };
    } catch (error) {
      patch({
        phase: PHASES.BOM_ERROR,
        lastError: error?.message || 'Unexpected error during BOM step',
      });
      return { ok: false };
    }
  }, [patch, sessionId, getColumnOrder, refreshHost]);

  // -------- Project creation (only when mode === NEW) --------
  // Uses the template_id the dialog wrote to the checkpoint. That dialog offers
  // the same list of templates FactWise's own "Create Project" popup uses
  // (`/module_templates/full/?template_type=PROJECT`), with the default one
  // preselected. If somehow no id made it into the checkpoint we fall back to
  // the first is_default template so this step never silently blocks.
  const runProjectStep = useCallback(async (projectName) => {
    patch({ phase: PHASES.PROJECT_CREATING, projectName, lastError: null });
    try {
      const saved = loadCheckpoint(sessionId) || {};
      let templateId = saved.templateId || null;
      if (!templateId) {
        const tpls = await fetchModuleTemplates('PROJECT');
        const templates = tpls?.templates || [];
        const preferred = templates.find((t) => t.is_default) || templates[0];
        templateId = preferred?.template_id || null;
      }
      if (!templateId) {
        patch({
          phase: PHASES.PROJECT_ERROR,
          lastError: 'No project template available in Factwise. Pick one from the template dropdown and retry.',
        });
        return { ok: false };
      }

      const created = await createFactwiseProject({
        project_name: projectName,
        template_id: templateId,
      });
      if (!created?.success) {
        patch({
          phase: PHASES.PROJECT_ERROR,
          lastError: created?.error || 'Project create failed',
        });
        return { ok: false };
      }

      const projectId = created?.project_id || created?.data?.project_id;
      patch({ phase: PHASES.ATTACH_BOM, projectId });
      return { ok: true, projectId };
    } catch (error) {
      patch({
        phase: PHASES.PROJECT_ERROR,
        lastError: error?.message || 'Unexpected error during project step',
      });
      return { ok: false };
    }
  }, [patch, sessionId]);

  // -------- Attach BOMs (create or revise per BOM depending on what's already
  //           in the project) --------
  const runAttachBomStep = useCallback(async () => {
    patch({ phase: PHASES.ATTACH_BOM, lastError: null, lastResponseType: null });
    try {
      const saved = loadCheckpoint(sessionId) || {};
      const projectId = saved.projectId;
      const allBomIds = saved.bomIds || [];
      if (!projectId || !allBomIds.length) {
        patch({
          phase: PHASES.ATTACH_BOM_ERROR,
          lastError: 'Missing project or BOM identifiers to attach.',
        });
        return { ok: false };
      }

      // FactWise's BOM_DASHBOARD process returns EVERY BOM it created —
      // main BOM plus every sub-BOM in the hierarchy. Sub-BOMs are already
      // referenced by their parent's items (sub_bom_id foreign key), so
      // attaching them independently to the project both duplicates and
      // corrupts the linkage — the second attach hits create_project_boms
      // → add_section_id_via_name and errors because the sub-BOM's
      // custom_section names collide with the parent's already-attached
      // sections.
      //
      // Filter down to just the roots: fetch each BOM's detail, collect
      // every sub_bom_id referenced by any BOM in the set, and keep only
      // the ids that are NOT referenced by any other BOM. Those are the
      // top-level BOMs the project should actually attach.
      let bomIds = allBomIds;
      if (allBomIds.length > 1) {
        try {
          const details = await Promise.all(
            allBomIds.map((id) => fetchEnterpriseBomDetail(id))
          );
          const referencedAsSub = new Set();
          const collectSubs = (items) => {
            if (!Array.isArray(items)) return;
            for (const it of items) {
              if (it?.sub_bom_id) referencedAsSub.add(String(it.sub_bom_id));
              if (Array.isArray(it?.sub_bom_items)) collectSubs(it.sub_bom_items);
            }
          };
          details.forEach((d) => {
            if (d?.success && Array.isArray(d.bom?.bom_items)) {
              collectSubs(d.bom.bom_items);
            }
          });
          const roots = allBomIds.filter((id) => !referencedAsSub.has(String(id)));
          if (roots.length) bomIds = roots;
          // If our filter somehow dropped everything (unexpected — would
          // mean every BOM is a sub of every other, i.e. a cycle), fall
          // back to the original list so attach at least runs.
        } catch (_) {
          // Detail fetch failure — proceed with the unfiltered list rather
          // than block attach entirely. Duplicate-attach is still bad but
          // "attach nothing at all" is worse.
        }
      }

      const currResp = await fetchCurrencies();
      const currencies = currResp?.currencies || [];
      const preferredCurrency =
        currencies.find((c) => c.is_default)
        || currencies.find(
          (c) => (c.currency_code_abbreviation || c.code) === 'USD'
        )
        || currencies[0];
      const currencyId =
        preferredCurrency?.entry_id
        || preferredCurrency?.id
        || preferredCurrency?.currency_id;
      if (!currencyId) {
        patch({
          phase: PHASES.ATTACH_BOM_ERROR,
          lastError: 'No currency available to attach the BOM.',
        });
        return { ok: false };
      }

      // User's explicit revision targets — if any, move those project BOM slots
      // in place; otherwise attach as a new project BOM. Falls back to the
      // single-id field so a checkpoint written before multi-select still runs.
      const reviseBomModuleIds = saved.reviseBomModuleIds?.length
        ? saved.reviseBomModuleIds
        : (saved.reviseBomModuleId ? [saved.reviseBomModuleId] : []);

      const attached = [];
      const revisedModules = [];
      for (const bomId of bomIds) {
        // Poll the BOM until its item tree is hydrated by FactWise's async
        // Celery pipeline. Attaching before hydration returns NoneType /
        // missing-id errors from create_bom_module (bom_service.py:2490).
        //
        // This guards the revise path too, not just attach. A slot moved onto a
        // revision whose items have not landed yet has nothing to copy, and the
        // revise runs as one transaction — so it would commit an empty slot
        // rather than fail loudly.
        patch({ phase: PHASES.BOM_SETTLING });
        const ready = await waitForBomReady({ enterpriseBomId: bomId });
        if (!ready.ok) {
          patch({
            phase: PHASES.ATTACH_BOM_ERROR,
            lastError: ready.error,
            attachedBomIds: attached,
            revisedProjectBomModules: revisedModules,
          });
          return { ok: false };
        }
        patch({ phase: PHASES.ATTACH_BOM });

        if (reviseBomModuleIds.length) {
          // Sequencing, a fresh process_id per attempt, 409 replay handling and
          // the timed-out-means-rolled-back rule all live in the runner. It
          // reports PER SLOT, which is the point: each slot is its own
          // transaction, so a failure partway leaves the earlier ones already
          // moved and the user has to be told which.
          //
          // Deliberately NOT wrapped in the transient-error backoff below. That
          // loop retries by repeating the call, which for a revise is the one
          // thing you must not do blindly — the first attempt may have
          // committed. The runner decides by reading the process record
          // instead, which is the only safe way to know.
          const { ok, results } = await reviseSlots({
            projectId,
            targetEnterpriseBomId: bomId,
            slots: reviseBomModuleIds.map(bomModuleId => ({ bomModuleId })),
            onSlotResult: (result) => {
              if (result.outcome !== SLOT_OUTCOMES.REVISED) return;
              revisedModules.push(result.slot.bomModuleId);
              // Published as each one lands rather than at the end — a run over
              // several large slots can take minutes, and a checkpoint written
              // only on completion would lose the record of what moved if the
              // tab were closed midway.
              patch({ revisedProjectBomModules: [...revisedModules] });
            },
          });
          if (!ok) {
            patch({
              phase: PHASES.ATTACH_BOM_ERROR,
              lastError: [
                `Revise did not finish for BOM ${bomId}.`,
                ...summariseSlotResults(results),
              ].join('\n'),
              attachedBomIds: attached,
              revisedProjectBomModules: revisedModules,
            });
            return { ok: false };
          }
        } else {
          // Retry the attach on transient race errors — FW's
          // create_project_boms touches multiple tables and occasionally races
          // with the BOM Celery worker. Exponential backoff (~4s, 8s, 12s …)
          // up to BOM_ATTACH_MAX_ATTEMPTS. Terminal errors (KeyError on section
          // name, ValidationError etc.) fail fast.
          let lastError = null;
          let ok = false;
          for (let attempt = 1; attempt <= BOM_ATTACH_MAX_ATTEMPTS; attempt++) {
            const res = await attachBomToProject({
              projectId,
              enterpriseBomId: bomId,
              currencyId,
            });
            if (res?.success) {
              ok = true;
              attached.push(bomId);
              break;
            }
            lastError = res?.error || 'Attach failed';
            if (!isTransientAttachError(lastError) || attempt === BOM_ATTACH_MAX_ATTEMPTS) {
              break;
            }
            await new Promise((r) => setTimeout(r, BOM_ATTACH_RETRY_BASE_MS * attempt));
          }
          if (!ok) {
            patch({
              phase: PHASES.ATTACH_BOM_ERROR,
              lastError: `Attach failed for BOM ${bomId}: ${lastError}`,
              attachedBomIds: attached,
              revisedProjectBomModules: revisedModules,
            });
            return { ok: false };
          }
        }
      }
      patch({
        phase: PHASES.DONE,
        attachedBomIds: attached,
        revisedProjectBomModules: revisedModules,
      });
      return { ok: true };
    } catch (error) {
      patch({
        phase: PHASES.ATTACH_BOM_ERROR,
        lastError: error?.message || 'Unexpected error while attaching BOM',
      });
      return { ok: false };
    }
  }, [patch, sessionId]);

  // -------- Orchestrator --------
  const runFromCheckpoint = useCallback(async ({
    projectName,
    mode,
    templateId,
    templateName,
    existingProjectId,
    existingProjectName,
    reviseEnterpriseBomId,
    reviseBomModuleId,
    reviseBomModuleIds,
    reviseBomCode,
    // When true, orchestrator stops after BOM_DONE and marks DONE. Used by the
    // Export-to-BOM-Directory dialog which only needs items + BOM, no project.
    stopAfterBom = false,
  } = {}) => {
    if (!isEmbedded || !entityId) {
      patch({ lastError: 'Factwise session not available' });
      return;
    }
    // Read from ref, not state, so a patch() that ran earlier in this same
    // event handler (e.g. markRetrySucceeded before handleGridRetrySuccess
    // calls runFromCheckpoint) is visible immediately.
    const cur = stateRef.current;
    const effectiveMode = mode || cur.mode || PROJECT_MODES.NEW;

    // Project-related validations only when we're actually going to touch a project.
    if (!stopAfterBom) {
      if (effectiveMode === PROJECT_MODES.EXISTING && !(existingProjectId || cur.existingProjectId)) {
        patch({ lastError: 'Please pick a project to export into.' });
        return;
      }
      if (effectiveMode === PROJECT_MODES.NEW && !(projectName || cur.projectName)) {
        patch({ lastError: 'Please enter a project name.' });
        return;
      }
      // Existing-project exports MUST route through a revision. The old
      // behaviour — creating a brand new BOM under the same FG and adding
      // it alongside — was wrong: it produced a duplicate BOM record with
      // the same finished good rather than updating the one already in the
      // project. Force the user back to pick a revise target instead. The
      // revise flow (Path A in runBomStep) then routes through Aditya's
      // preview API and the handoff, and FactWise moves the slot itself.
      if (
        effectiveMode === PROJECT_MODES.EXISTING
        && !(reviseEnterpriseBomId || cur.reviseEnterpriseBomId)
      ) {
        patch({
          lastError:
            'Exporting into an existing project must revise one of its BOMs. '
            + 'Open the BOM step and pick "Revise: <BOM code>" for the BOM you '
            + 'want this sheet to update — creating a new BOM under the same '
            + 'finished good is no longer allowed.',
        });
        return;
      }
    }

    // Persist config first so later steps can read from checkpoint.
    patch({
      mode: effectiveMode,
      projectName: projectName || cur.projectName,
      templateId: templateId || cur.templateId,
      templateName: templateName || cur.templateName,
      existingProjectId: existingProjectId || cur.existingProjectId,
      existingProjectName: existingProjectName || cur.existingProjectName,
      // Revision selection is per-run — allow explicit undefined to CLEAR.
      reviseEnterpriseBomId: reviseEnterpriseBomId === undefined
        ? cur.reviseEnterpriseBomId
        : reviseEnterpriseBomId,
      reviseBomModuleId: reviseBomModuleId === undefined
        ? cur.reviseBomModuleId
        : reviseBomModuleId,
      reviseBomModuleIds: reviseBomModuleIds === undefined
        ? cur.reviseBomModuleIds
        : reviseBomModuleIds,
      reviseBomCode: reviseBomCode === undefined
        ? cur.reviseBomCode
        : reviseBomCode,
      // Seed projectId directly when targeting an existing project so we skip
      // the project-creation phase.
      projectId:
        effectiveMode === PROJECT_MODES.EXISTING
          ? (existingProjectId || cur.existingProjectId || cur.projectId)
          : cur.projectId,
    });

    // Re-read from ref AFTER the patch so startPhase reflects any advance
    // that just happened via markRetrySucceeded → patch (which sync-writes
    // stateRef.current).
    const startPhase = stateRef.current.phase;

    // Order matters here. For a revise-mode export, item upload has to be
    // DEFERRED until the user has confirmed the diff in FactWise's preview
    // page — otherwise items land in the Item Directory before the user has
    // agreed to the revision, which the user has explicitly asked us not to
    // do. So on the first pass through revise mode we skip runItemStep,
    // hit runBomStep (which creates R5, uploads the sheet, saves the
    // handoff, and pauses at REVIEW_DIFF), then return. The second pass —
    // triggered by confirmRevisionDiff after the user Confirms in FW — has
    // revisionReviewConfirmed=true, and runs items then.
    const cur2 = stateRef.current;
    const isReviseFlow = Boolean(cur2.reviseEnterpriseBomId);
    const deferItemsUntilReviewed =
      isReviseFlow && !cur2.revisionReviewConfirmed;

    // Item step
    const itemDone =
      startPhase === PHASES.ITEMS_DONE
      || startPhase === PHASES.BOM_UPLOADING
      || startPhase === PHASES.BOM_PROCESSING
      || startPhase === PHASES.BOM_DONE
      || startPhase === PHASES.PROJECT_CREATING
      || startPhase === PHASES.ATTACH_BOM
      || startPhase === PHASES.ATTACH_BOM_ERROR
      || startPhase === PHASES.DONE
      // Sticky across dialog opens — if this session already exported
      // items to the Item Directory (via any prior dialog run), skip.
      // The user can force a fresh upload via the Start Over button
      // (which calls hard reset() and clears this flag).
      || cur2.sessionExportedItems;
    if (!itemDone && !deferItemsUntilReviewed) {
      const res = await runItemStep();
      if (!res.ok) return;
      // Give FactWise's Celery worker time to index the newly-created items
      // before BOMRevisionImport looks them up. 2.5s was fine for tiny
      // uploads but 500+ row imports need noticeably longer — hitting BOM
      // upload too early makes the BOM sheet report "item does not exist"
      // for items we just POSTed.
      patch({ phase: PHASES.ITEMS_SETTLING });
      await new Promise((resolve) => setTimeout(resolve, ITEMS_SETTLE_MS));
    }

    // BOM step
    const bomDone =
      startPhase === PHASES.BOM_DONE
      || startPhase === PHASES.PROJECT_CREATING
      || startPhase === PHASES.ATTACH_BOM
      || startPhase === PHASES.ATTACH_BOM_ERROR
      || startPhase === PHASES.DONE
      // Sticky — if this session already created a BOM via the Directory
      // export, the ids sit in state (bomIds) and downstream attach uses
      // them. No point re-uploading + creating a duplicate BOM record.
      // Only honored in NON-revise flows: a revise export always needs
      // to run Path A to create the R5 draft.
      || (cur2.sessionExportedBom && !isReviseFlow);
    if (!bomDone) {
      const res = await runBomStep();
      if (!res.ok) return;
    }

    // Revise-mode review pause. runBomStep patches phase to REVIEW_DIFF on
    // the first pass through a revise flow — items haven't uploaded yet,
    // handoff is saved, R5 draft exists. The export dialog reads this
    // phase and opens FactWise's comparison page in preview mode. The
    // user reviews there, and on Confirm a postMessage flows back to the
    // export dialog which calls confirmRevisionDiff → sets the flag →
    // re-enters runFromCheckpoint. This pass through, item step runs
    // (deferItemsUntilReviewed is now false), BOM step is skipped
    // (bomDone from BOM_DONE), and we finish the slot revise below.
    if (stateRef.current.phase === PHASES.REVIEW_DIFF) {
      return;
    }

    // Export-to-BOM-Directory ends here — no project, no attach.
    if (stopAfterBom) {
      patch({ phase: PHASES.DONE });
      return;
    }

    // Project creation (only for NEW mode; EXISTING mode skips straight to attach)
    if (effectiveMode === PROJECT_MODES.NEW) {
      const projectDone =
        startPhase === PHASES.ATTACH_BOM
        || startPhase === PHASES.ATTACH_BOM_ERROR
        || startPhase === PHASES.DONE;
      if (!projectDone) {
        const res = await runProjectStep(projectName || stateRef.current.projectName);
        if (!res.ok) return;
      }
    }

    // Attach BOMs (create or revise per BOM already in project)
    if (startPhase !== PHASES.DONE) {
      await runAttachBomStep();
    }
  }, [isEmbedded, entityId, patch, runItemStep, runBomStep, runProjectStep, runAttachBomStep]);

  // Called by the error grid after a Save & retry (inline OR via New Tags
  // popup) succeeds. Without this the orchestrator's phase stays on
  // ITEMS_ERROR / BOM_ERROR, so the next runFromCheckpoint() re-runs the
  // failed step from scratch with EMPTY additional_information and the same
  // error surfaces again (mand → new tag not created → mand still flagged,
  // etc.). This action advances the checkpoint to the next successful phase
  // so runFromCheckpoint skips the item/bom step and moves on.
  const markRetrySucceeded = useCallback((kind, resp, bulkImportId) => {
    const cur = stateRef.current;
    if (kind === 'ITEM') {
      patch({
        phase: PHASES.ITEMS_DONE,
        itemBulkImportId: bulkImportId || cur.itemBulkImportId,
        itemCreated: resp?.created_identifiers || cur.itemCreated,
        itemUpdated: resp?.updated_identifiers || cur.itemUpdated,
        lastError: null,
        lastResponseType: 'Success',
      });
    } else if (kind === 'BOM') {
      const respBomIds = Array.isArray(resp?.bom_ids) ? resp.bom_ids : [];
      patch({
        phase: PHASES.BOM_DONE,
        bomIds: respBomIds.length ? respBomIds : cur.bomIds,
        lastError: null,
        lastResponseType: 'Success',
      });
    }
  }, [patch]);

  // Called when a Save & retry (or any error-grid retry) fails with a NEW
  // error state. Without this, the parent dialog's `lastBulkImportId` stayed
  // pinned to the FIRST failure — so the error grid kept rendering that
  // old error file even after the user fixed some cells and the retry
  // produced a fresh error file listing the REMAINING errors (e.g. an
  // `EntityDoesNotExist` on a different row). Symptom: user fixes cell A,
  // clicks Save & retry, retry fails on cell B, but the grid still shows
  // only cell A's row. Now patches lastBulkImportId + lastError so the
  // grid re-mounts on the new bulk_import_id.
  const markRetryFailed = useCallback((kind, error, bulkImportId, resp) => {
    const cur = stateRef.current;
    const rtype = resp?.response_type || cur.lastResponseType;
    const phase = kind === 'BOM' ? PHASES.BOM_ERROR : PHASES.ITEMS_ERROR;
    patch({
      phase,
      lastError: error || cur.lastError || 'Retry failed',
      lastResponseType: rtype,
      lastBulkImportId: bulkImportId || cur.lastBulkImportId,
    });
  }, [patch]);

  // Called by the export dialog when the user clicks Confirm inside FW's
  // preview page (postMessage bridges back). This is where the real work
  // actually happens — everything before this point (R5 draft creation,
  // sheet upload, handoff save) is safely reversible; everything from here
  // on is a commit.
  //
  // Sequence, in strict order:
  //   1. runItemStep — upload items to Item Directory. Deferred until
  //      confirm so we don't add items on a rejected revision.
  //   2. Settle briefly so FactWise indexes the newly-added items before
  //      the BOM_REVISION process/ tries to reference them by code.
  //   3. bulk_import/process/ on the ALREADY-UPLOADED BOM sheet (same
  //      bulk_import_id we showed the diff for). This is what actually
  //      populates R5 with the sheet's items; before this R5 is just a
  //      DRAFT clone of R4's items.
  //   4. Submit R5 (DRAFT → ONGOING). This is what triggers FactWise's
  //      admin_update_enterprise_bom_status logic to flip R4 from
  //      ONGOING → REVISED — the moment the revision becomes "real."
  //   5. Slot revise — for each project slot in reviseBomModuleIds,
  //      PUT /project/<pid>/boms/<mid>/revise/ to move it from R4 to R5.
  //      Delegated to runAttachBomStep which already handles this.
  //
  // On any failure, phase goes to *_ERROR and lastError carries the
  // reason. R5 has already been committed to the admin BOM directory
  // regardless — that's the tradeoff of splitting the flow around a
  // user-visible review. A failed step here means R5 is left as-is; the
  // user can retry or clean up via FactWise admin.
  const confirmRevisionDiff = useCallback(async () => {
    const cur = stateRef.current;
    const newDraftId = cur.revisedNewEnterpriseBomId;
    const bomBulkImportId = cur.bomBulkImportId;
    const templateId = cur.revisedTemplateId;
    const finishedGoodId = cur.revisedFinishedGoodId;
    const entityIds = cur.revisedEntityIds || [];
    if (!newDraftId || !bomBulkImportId || !templateId || !finishedGoodId) {
      patch({
        phase: PHASES.BOM_ERROR,
        lastError:
          'Cannot finalize revision — missing R5 draft id, bulk_import_id, '
          + 'or the revision context (template / finished good). Retry the '
          + 'export from Start.',
      });
      return;
    }
    patch({ revisionReviewConfirmed: true, lastError: null });

    // Step 1 — items
    const itemRes = await runItemStep();
    if (!itemRes.ok) return;
    // Step 2 — settle
    patch({ phase: PHASES.ITEMS_SETTLING });
    await new Promise((resolve) => setTimeout(resolve, ITEMS_SETTLE_MS));

    // Step 3 — process the BOM_REVISION sheet into R5's items
    patch({ phase: PHASES.BOM_PROCESSING });
    const processed = await processFactwiseBulkImport(bomBulkImportId, {
      import_type: 'BOM_UPDATE',
      enterprise_bom_id: newDraftId,
      template_id: templateId,
      finished_good_id: finishedGoodId,
      entity_ids: entityIds,
    });
    if (!processed?.success) {
      patch({
        phase: PHASES.BOM_ERROR,
        lastError: processed?.error || 'BOM revision process call failed',
        lastBulkImportId: bomBulkImportId,
      });
      return;
    }
    const resp = processed?.response || processed;
    const rtype = resp?.response_type;
    if (rtype && rtype !== 'Success') {
      patch({
        phase: PHASES.BOM_ERROR,
        lastError: resp?.error || `BOM revision validation failed (${rtype})`,
        lastResponseType: rtype,
        lastBulkImportId: bomBulkImportId,
      });
      return;
    }
    // FactWise's process/ returns bom_ids covering the whole draft chain
    // (main draft + any sub-draft revisions it triggered). Submit them all
    // so a revised sub-BOM inside R5 also promotes correctly.
    const bomIdsToSubmit = (resp?.bom_ids && resp.bom_ids.length)
      ? resp.bom_ids
      : [newDraftId];
    patch({ phase: PHASES.BOM_DONE, bomIds: bomIdsToSubmit });

    // Step 4 — submit each DRAFT → ONGOING (R5 goes ONGOING, R4 auto-flips
    // to REVISED via admin_update_enterprise_bom_status).
    for (const id of bomIdsToSubmit) {
      const submitted = await submitEnterpriseBom(id);
      if (!submitted?.success) {
        patch({
          phase: PHASES.BOM_ERROR,
          lastError:
            submitted?.error
            || `BOM ${id} imported but could not be submitted to ONGOING.`,
        });
        return;
      }
    }

    // Step 5 — slot revise for existing-project flows. NEW-mode revisions
    // don't happen (mode picker enforces revise-only for EXISTING), but be
    // defensive: only run attach if we actually have project + slots.
    const afterState = stateRef.current;
    const hasProjectAttach = Boolean(
      afterState.projectId
      && (afterState.reviseBomModuleIds?.length || afterState.reviseBomModuleId)
    );
    if (hasProjectAttach) {
      await runAttachBomStep();
    } else {
      patch({ phase: PHASES.DONE });
    }
  }, [patch, runItemStep, runAttachBomStep]);

  // Called when the user clicks Reject in FW's preview page. Nothing on the
  // FactWise side needs a formal undo: R5 exists as an empty DRAFT (harmless
  // — no items, no project uses it, admins can clean it up), and the sheet
  // sits in blob storage referenced by the handoff record. Simply reset to
  // IDLE so the user can adjust the sheet in the mapper and re-export.
  const cancelRevisionDiff = useCallback((reason) => {
    patch({
      phase: PHASES.IDLE,
      revisionReviewConfirmed: false,
      lastError: reason || null,
    });
  }, [patch]);

  return {
    ...state,
    isEmbedded,
    isTerminalError: TERMINAL_ERROR_PHASES.has(state.phase),
    isRunning:
      state.phase !== PHASES.IDLE
      && state.phase !== PHASES.DONE
      && state.phase !== PHASES.REVIEW_DIFF
      && !TERMINAL_ERROR_PHASES.has(state.phase),
    runFromCheckpoint,
    runItemStep,
    runBomStep,
    runProjectStep,
    runAttachBomStep,
    markRetrySucceeded,
    markRetryFailed,
    confirmRevisionDiff,
    cancelRevisionDiff,
    reset,
    softReset,
  };
}
