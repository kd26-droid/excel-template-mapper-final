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
async function retargetBomSheetToCode(file, targetCode) {
  if (!targetCode) return file;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    if (!aoa.length) return file;
    const headers = aoa[0].map((h) => String(h ?? '').trim());
    const idxBomId = headers.findIndex(
      (h) => /^bom\s*id$/i.test(h) || /^bom_code$/i.test(h)
    );
    const idxSubBomId = headers.findIndex(
      (h) => /^sub\s*bom\s*id$/i.test(h) || /^sub_bom_code$/i.test(h)
    );
    if (idxBomId < 0) return file;

    // First pass: build the set of Sub BOM IDs referenced anywhere. Any BOM ID
    // that IS also a Sub BOM ID represents a legitimate sub-BOM in the tree
    // and must stay named the same. All other BOM ID values are candidates
    // for the "main" BOM row — those get retargeted to targetCode.
    const referencedAsSub = new Set();
    if (idxSubBomId >= 0) {
      for (let r = 1; r < aoa.length; r++) {
        const v = String(aoa[r][idxSubBomId] ?? '').trim();
        if (v) referencedAsSub.add(v);
      }
    }

    // Renames map: whatever the mapper called the main BOM → targetCode.
    const renames = {};
    for (let r = 1; r < aoa.length; r++) {
      const v = String(aoa[r][idxBomId] ?? '').trim();
      if (!v) continue;
      if (referencedAsSub.has(v)) continue; // real sub-BOM, leave alone
      if (!renames[v]) renames[v] = targetCode;
    }
    if (!Object.keys(renames).length) return file;

    for (let r = 1; r < aoa.length; r++) {
      const b = String(aoa[r][idxBomId] ?? '').trim();
      if (b && renames[b]) aoa[r][idxBomId] = renames[b];
      // Also rewrite Sub BOM ID cells that pointed at the mapper's main code
      // (children of the top-level BOM must reference the new code).
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
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: false,
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
    setState((prev) => {
      const next = { ...prev, ...delta };
      saveCheckpoint(sessionId, next);
      // Sync the ref immediately so callers that patch() then read from
      // stateRef in the SAME microtask (e.g. handleGridRetrySuccess) get
      // the updated value without waiting for React's next render.
      stateRef.current = next;
      return next;
    });
  }, [sessionId]);

  const reset = useCallback(() => {
    clearCheckpoint(sessionId);
    setState(emptyState);
    stateRef.current = emptyState;
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
            const revised = await reviseEnterpriseBom(originalReviseId);
            if (!revised?.success || !revised?.enterprise_bom_id) {
              patch({
                phase: PHASES.BOM_ERROR,
                lastError: revised?.error || 'Could not create a BOM revision in Factwise',
              });
              return { ok: false };
            }
            newDraftId = revised.enterprise_bom_id;
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

        // FactWise's BOM_UPDATE validator requires the sheet's main BOM ID to
        // equal the target BOM's code. The mapper's Excel uses its own
        // bom_code (say "MAPPED_BOM_1"), so we rewrite the sheet so its main
        // BOM ID (and any Sub BOM ID references pointing at it) become the
        // draft's code (e.g. "ABB5_R2"). Real sub-BOMs keep their own codes.
        const retargetedFile = await retargetBomSheetToCode(file, targetBomCode);

        const uploaded = await uploadFileToFactwiseBulkImport(retargetedFile, 'BOM_REVISION');
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

        // STOP. A revision is handed over, not completed here.
        //
        // Everything needed to finish it is now readable from
        // GET /bom/revision-handoff/<sessionId>/ : the bulk_import_id and its
        // process arguments, the draft being imported into, and the project
        // slots to move once that import lands.
        //
        // Neither of the remaining calls can be made from here. `process/` is
        // the importer's to run, and the slot moves cannot happen until it has:
        // until then the draft has no items, and a slot pointed at it would be
        // pointed at an empty BOM.
        patch({ phase: PHASES.DONE, bomIds: [newDraftId] });
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
      patch({ phase: PHASES.BOM_DONE, bomIds });
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
      const bomIds = saved.bomIds || [];
      if (!projectId || !bomIds.length) {
        patch({
          phase: PHASES.ATTACH_BOM_ERROR,
          lastError: 'Missing project or BOM identifiers to attach.',
        });
        return { ok: false };
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

    // Item step
    const itemDone =
      startPhase === PHASES.ITEMS_DONE
      || startPhase === PHASES.BOM_UPLOADING
      || startPhase === PHASES.BOM_PROCESSING
      || startPhase === PHASES.BOM_DONE
      || startPhase === PHASES.PROJECT_CREATING
      || startPhase === PHASES.ATTACH_BOM
      || startPhase === PHASES.ATTACH_BOM_ERROR
      || startPhase === PHASES.DONE;
    if (!itemDone) {
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
      || startPhase === PHASES.DONE;
    if (!bomDone) {
      const res = await runBomStep();
      if (!res.ok) return;
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

  return {
    ...state,
    isEmbedded,
    isTerminalError: TERMINAL_ERROR_PHASES.has(state.phase),
    isRunning:
      state.phase !== PHASES.IDLE
      && state.phase !== PHASES.DONE
      && !TERMINAL_ERROR_PHASES.has(state.phase),
    runFromCheckpoint,
    runItemStep,
    runBomStep,
    runProjectStep,
    runAttachBomStep,
    markRetrySucceeded,
    reset,
  };
}
