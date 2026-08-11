import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useFactwise } from '../contexts/FactwiseContext';
import {
  uploadFileToFactwiseBulkImport,
  processFactwiseBulkImport,
  createFactwiseProject,
  fetchModuleTemplates,
  fetchCurrencies,
  attachBomToProject,
  reviseProjectBom,
  reviseEnterpriseBom,
  fetchEnterpriseBomCodes,
} from '../services/factwiseApi';
import api from '../services/api';

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
  BOM_UPLOADING: 'BOM_UPLOADING',
  BOM_PROCESSING: 'BOM_PROCESSING',
  BOM_ERROR: 'BOM_ERROR',
  BOM_DONE: 'BOM_DONE',
  PROJECT_CREATING: 'PROJECT_CREATING',
  PROJECT_ERROR: 'PROJECT_ERROR',
  ATTACH_BOM: 'ATTACH_BOM',
  ATTACH_BOM_ERROR: 'ATTACH_BOM_ERROR',
  DONE: 'DONE',
};

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

  // Rehydrate from localStorage on mount (so refresh doesn't lose progress).
  useEffect(() => {
    const saved = loadCheckpoint(sessionId);
    if (saved) setState({ ...emptyState, ...saved });
  }, [sessionId]);

  const patch = useCallback((delta) => {
    setState((prev) => {
      const next = { ...prev, ...delta };
      saveCheckpoint(sessionId, next);
      return next;
    });
  }, [sessionId]);

  const reset = useCallback(() => {
    clearCheckpoint(sessionId);
    setState(emptyState);
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

      // If the mapper's BOM code collides with an existing ONGOING enterprise
      // BOM, FactWise rejects the BOM_DASHBOARD import with "Cannot update
      // submitted BOM". Rewrite colliding codes with a unique suffix so the
      // import lands as a fresh new BOM. The attach step still uses
      // reviseProjectBom to repoint the project's module correctly.
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

      patch({
        phase: PHASES.BOM_DONE,
        bomIds,
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

      // User's explicit revision target — if set, revise the matching project
      // BOM module in-place; otherwise attach as a new project BOM.
      const reviseBomModuleId = saved.reviseBomModuleId || null;

      const attached = [];
      const revisedModules = [];
      for (const bomId of bomIds) {
        if (reviseBomModuleId) {
          const res = await reviseProjectBom({
            projectId,
            bomModuleId: reviseBomModuleId,
            enterpriseBomId: bomId,
          });
          if (!res?.success) {
            patch({
              phase: PHASES.ATTACH_BOM_ERROR,
              lastError: res?.error || `Revise failed for BOM ${bomId}`,
              attachedBomIds: attached,
              revisedProjectBomModules: revisedModules,
            });
            return { ok: false };
          }
          revisedModules.push(reviseBomModuleId);
        } else {
          const res = await attachBomToProject({
            projectId,
            enterpriseBomId: bomId,
            currencyId,
          });
          if (!res?.success) {
            patch({
              phase: PHASES.ATTACH_BOM_ERROR,
              lastError: res?.error || `Attach failed for BOM ${bomId}`,
              attachedBomIds: attached,
              revisedProjectBomModules: revisedModules,
            });
            return { ok: false };
          }
          attached.push(bomId);
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
    reviseBomCode,
  } = {}) => {
    if (!isEmbedded || !entityId) {
      patch({ lastError: 'Factwise session not available' });
      return;
    }
    const effectiveMode = mode || state.mode || PROJECT_MODES.NEW;

    if (effectiveMode === PROJECT_MODES.EXISTING && !(existingProjectId || state.existingProjectId)) {
      patch({ lastError: 'Please pick a project to export into.' });
      return;
    }
    if (effectiveMode === PROJECT_MODES.NEW && !(projectName || state.projectName)) {
      patch({ lastError: 'Please enter a project name.' });
      return;
    }

    // Persist config first so later steps can read from checkpoint.
    patch({
      mode: effectiveMode,
      projectName: projectName || state.projectName,
      templateId: templateId || state.templateId,
      templateName: templateName || state.templateName,
      existingProjectId: existingProjectId || state.existingProjectId,
      existingProjectName: existingProjectName || state.existingProjectName,
      // Revision selection is per-run — allow explicit undefined to CLEAR.
      reviseEnterpriseBomId: reviseEnterpriseBomId === undefined
        ? state.reviseEnterpriseBomId
        : reviseEnterpriseBomId,
      reviseBomModuleId: reviseBomModuleId === undefined
        ? state.reviseBomModuleId
        : reviseBomModuleId,
      reviseBomCode: reviseBomCode === undefined
        ? state.reviseBomCode
        : reviseBomCode,
      // Seed projectId directly when targeting an existing project so we skip
      // the project-creation phase.
      projectId:
        effectiveMode === PROJECT_MODES.EXISTING
          ? (existingProjectId || state.existingProjectId || state.projectId)
          : state.projectId,
    });

    const startPhase = state.phase;

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

    // Project creation (only for NEW mode; EXISTING mode skips straight to attach)
    if (effectiveMode === PROJECT_MODES.NEW) {
      const projectDone =
        startPhase === PHASES.ATTACH_BOM
        || startPhase === PHASES.ATTACH_BOM_ERROR
        || startPhase === PHASES.DONE;
      if (!projectDone) {
        const res = await runProjectStep(projectName || state.projectName);
        if (!res.ok) return;
      }
    }

    // Attach BOMs (create or revise per BOM already in project)
    if (startPhase !== PHASES.DONE) {
      await runAttachBomStep();
    }
  }, [isEmbedded, entityId, state.phase, state.projectName, state.templateId, state.templateName, state.mode, state.existingProjectId, state.existingProjectName, state.projectId, state.reviseEnterpriseBomId, state.reviseBomModuleId, state.reviseBomCode, patch, runItemStep, runBomStep, runProjectStep, runAttachBomStep]);

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
    reset,
  };
}
