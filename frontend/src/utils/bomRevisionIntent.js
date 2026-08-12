// bomRevisionIntent.js
//
// The BOM and project the user has already named for the file in flight.
//
// Two dialogs ask the same two questions at opposite ends of the pipeline:
// BomStructureDialog at upload ("is this a revision, of what BOM, on which
// project?") and FactwiseProjectExportDialog at export ("which project, and
// does this replace one of its BOMs?"). Asking twice and ignoring the first
// answer is how a file the user declared a revision of BOM X leaves as a brand
// new BOM sitting next to X.
//
// Whichever dialog is answered first writes here; the other reads it as a
// PREFILL and nothing more. Both controls stay visible and editable, which is
// the same rule BomStructureDialog already applies to its unit and quantity
// defaults — a prefill the user is looking at is not a silent fallback.
//
// sessionStorage rather than module state: the two dialogs live on different
// routes, and the editor is reachable by URL, so a refresh there must not lose
// the answer. Per tab, so two BOMs worked on side by side do not overwrite each
// other.

const KEY = 'bom_revision_intent';

const EMPTY = {
  enterpriseBomId: null,
  bomCode: '',
  // The identity that survives revising, and what every project lookup is keyed
  // on. Carried so a re-open does not have to resolve it again.
  baseBomId: null,
  // Only the export side knows this — it comes from the project's BOM list, not
  // from the org-wide BOM list the upload dialog reads. The export side
  // re-derives it by matching enterpriseBomId, so the upload side leaves it null.
  bomModuleId: null,
  projectId: null,
  projectCode: '',
  projectName: '',
};

export function readBomRevisionIntent() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Nothing worth carrying is nothing to carry. Returning an all-null object
    // would make every caller's `if (intent)` guard useless.
    if (!parsed.enterpriseBomId && !parsed.projectId) return null;
    return { ...EMPTY, ...parsed };
  } catch (err) {
    return null;
  }
}

// Wholesale replace, not a merge. A merge looks safer and is not: clearing the
// BOM back to "create new" while keeping the same project has to erase
// enterpriseBomId, and a merge would faithfully preserve the stale one.
export function saveBomRevisionIntent(intent) {
  try {
    const next = { ...EMPTY, ...(intent || {}) };
    if (!next.enterpriseBomId && !next.projectId) {
      window.sessionStorage.removeItem(KEY);
      return;
    }
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    // Storage is unavailable in some embedded/private contexts. Losing a
    // prefill is not worth breaking the dialog that was trying to save it.
  }
}

export function clearBomRevisionIntent() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch (err) {
    /* see above */
  }
}
