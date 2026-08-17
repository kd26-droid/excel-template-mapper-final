import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import LaunchIcon from '@mui/icons-material/Launch';
import {
  PHASES,
  useFactwiseProjectExport,
} from '../hooks/useFactwiseProjectExport';
import { openInFactwise, postToFactwiseParent, useFactwise } from '../contexts/FactwiseContext';
import { fetchEnterpriseBomDetail } from '../services/factwiseApi';
import FactwiseBulkImportErrorGrid from './FactwiseBulkImportErrorGrid';
import BomCodeConflictPrompt from './BomCodeConflictPrompt';
import { readBomRevisionIntent } from '../utils/bomRevisionIntent';

// Two-step export flow: items first, then BOM. Same orchestrator + error grid
// used by the Project export dialog, minus the project creation / attach.
// The BOM sheet references item codes that must already exist in Factwise's
// Item Directory, so uploading BOM directly (as the old flow did) fails when
// any referenced item is missing.
const STEP_ORDER = [
  { key: 'items', label: 'Import items into Factwise' },
  { key: 'bom', label: 'Import BOM into BOM Directory' },
];

function phaseToStepIndex(phase) {
  if (
    phase === PHASES.ITEMS_UPLOADING
    || phase === PHASES.ITEMS_PROCESSING
    || phase === PHASES.ITEMS_ERROR
  ) return 0;
  if (
    phase === PHASES.ITEMS_DONE
    || phase === PHASES.ITEMS_SETTLING
    || phase === PHASES.BOM_UPLOADING
    || phase === PHASES.BOM_PROCESSING
    || phase === PHASES.BOM_ERROR
    || phase === PHASES.BOM_CODE_CONFLICT
  ) return 1;
  if (phase === PHASES.DONE) return STEP_ORDER.length;
  return 0;
}

function stepStatus(phase, index) {
  const current = phaseToStepIndex(phase);
  if (index < current) return 'completed';
  if (index === current) {
    if (
      phase === PHASES.ITEMS_ERROR
      || phase === PHASES.BOM_ERROR
      || phase === PHASES.BOM_CODE_CONFLICT
    ) return 'error';
    return 'active';
  }
  return 'pending';
}

function phaseLabel(phase) {
  switch (phase) {
    case PHASES.ITEMS_UPLOADING: return 'Uploading items file to Factwise…';
    case PHASES.ITEMS_PROCESSING: return 'Validating items against Factwise directory…';
    case PHASES.ITEMS_ERROR: return 'Item import failed — see errors below.';
    case PHASES.ITEMS_DONE: return 'Items imported. Starting BOM upload…';
    case PHASES.ITEMS_SETTLING: return 'Waiting for Factwise to index the new items before uploading BOM…';
    case PHASES.BOM_SETTLING: return 'Waiting for Factwise to finish building the BOM…';
    case PHASES.BOM_UPLOADING: return 'Uploading BOM file to Factwise…';
    case PHASES.BOM_PROCESSING: return 'Validating BOM structure…';
    case PHASES.BOM_ERROR: return 'BOM import failed — items were saved. See errors below.';
    case PHASES.REVIEW_DIFF: return 'Reviewing revision in Factwise… confirm or reject there to continue.';
    case PHASES.BOM_CODE_CONFLICT: return 'This BOM ID is already used in Factwise — pick a different one below.';
    case PHASES.DONE: return 'BOM imported into Factwise.';
    default: return '';
  }
}

function retryLabelForPhase(phase) {
  if (phase === PHASES.ITEMS_ERROR) return 'Retry item import';
  if (phase === PHASES.BOM_ERROR) return 'Retry BOM import (items are kept)';
  return 'Retry';
}

export default function FactwiseBomDirectoryExportDialog({
  open,
  onClose,
  sessionId,
  getColumnOrder,
  refreshHost,
}) {
  const orchestration = useFactwiseProjectExport({ sessionId, getColumnOrder, refreshHost });
  // Reset checkpoint every time the dialog transitions closed → open so a
  // stale bulk_import_id from a previous run can't get reused after the
  // user has edited the main data editor between opens.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // softReset — clears phase + errors so the dialog starts fresh, but
      // KEEPS the sessionExportedItems / sessionExportedBom flags so a
      // subsequent Export to Project won't re-upload items or re-create
      // the BOM. Hard reset() only fires from the "Start over" button.
      orchestration.softReset();
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const {
    phase,
    itemCreated,
    itemUpdated,
    bomIds,
    lastError,
    lastResponseType,
    lastBulkImportId,
    bomCodeConflicts,
    isRunning,
    // Revise-mode fields — driven by the comparison hookup below.
    revisedNewEnterpriseBomId,
    bomBulkImportId,
    runFromCheckpoint,
    markRetrySucceeded,
    markRetryFailed,
    confirmRevisionDiff,
    cancelRevisionDiff,
    setBomCodeOverrides,
    reset,
  } = orchestration;

  const [retryMessage] = useState(null);

  // Revise intent from BomStructureDialog. If the user picked "Revise: X"
  // there with project=No, they explicitly asked for a new revision that
  // is pushed only to the BOM directory (no project involvement). Without
  // reading this intent, the BOM Directory export would fall back to
  // fresh-create semantics and produce a duplicate BOM under the same
  // finished-good code. Read once per dialog open (mirrors Project
  // dialog's pattern).
  const [reviseIntent, setReviseIntent] = useState(null);
  const intentReadRef = useRef(false);
  useEffect(() => {
    if (!open) { intentReadRef.current = false; setReviseIntent(null); return; }
    if (intentReadRef.current) return;
    intentReadRef.current = true;
    const intent = readBomRevisionIntent();
    if (intent?.enterpriseBomId) {
      setReviseIntent(intent);
    }
  }, [open]);

  const activeStep = phaseToStepIndex(phase);
  const isDone = phase === PHASES.DONE;
  // A question, not a failure — nothing has been uploaded yet. See the same
  // flag in FactwiseProjectExportDialog for why it stays out of `hasError`.
  const needsBomCode = phase === PHASES.BOM_CODE_CONFLICT;
  const hasError = phase === PHASES.ITEMS_ERROR || phase === PHASES.BOM_ERROR;
  // Both of these are waiting on the user, so neither may start a run:
  // REVIEW_DIFF wants Confirm/Reject in FW's preview tab, BOM_CODE_CONFLICT
  // wants a different BOM ID below. Buttons stay disabled either way so the
  // export can't be accidentally re-started out from under the prompt.
  const canStart = !isRunning && !isDone && !needsBomCode && phase !== PHASES.REVIEW_DIFF;

  // Pass the revise target into the orchestrator so runBomStep enters
  // Path A (create R5, upload, REVIEW_DIFF pause, submit) instead of
  // Path B (fresh-create duplicate). No project fields — this dialog is
  // BOM-directory-only. confirmRevisionDiff's hasProjectAttach check
  // will fall to DONE cleanly since no projectId + no reviseBomModuleIds.
  // Duplicate policy is silent by default (aggregate_per_level applied server-side).
  // User overrides via the editor's duplicate-handling banner, not this dialog.
  const handleStart = useCallback(() => {
    runFromCheckpoint({
      stopAfterBom: true,
      reviseEnterpriseBomId: reviseIntent?.enterpriseBomId || undefined,
      reviseBomCode: reviseIntent?.bomCode || undefined,
      reviseBomModuleId: undefined,
      reviseBomModuleIds: undefined,
    });
  }, [runFromCheckpoint, reviseIntent]);

  // Replacement BOM IDs supplied — record them and resume at the BOM step.
  const handleBomCodeChosen = useCallback((renames) => {
    setBomCodeOverrides(renames);
    runFromCheckpoint({ stopAfterBom: true });
  }, [setBomCodeOverrides, runFromCheckpoint]);

  // Advance phase before resuming so runFromCheckpoint skips the
  // just-succeeded step (see FactwiseProjectExportDialog for the full
  // rationale — same bug where a Save on the retry cleared new_tags on
  // the follow-up cycle).
  const handleGridRetrySuccess = useCallback((resp, bulkImportId) => {
    const kind = phase === PHASES.BOM_ERROR ? 'BOM' : 'ITEM';
    markRetrySucceeded(kind, resp, bulkImportId);
    runFromCheckpoint({
      stopAfterBom: true,
      reviseEnterpriseBomId: reviseIntent?.enterpriseBomId || undefined,
      reviseBomCode: reviseIntent?.bomCode || undefined,
    });
  }, [phase, markRetrySucceeded, runFromCheckpoint, reviseIntent]);

  // Swap the error grid over to the retry's new bulk_import_id when a
  // Save & retry produces a fresh error state — otherwise the grid stays
  // stuck on the original file even after the user has fixed some cells.
  const handleGridRetryFailure = useCallback((error, bulkImportId, resp) => {
    if (!bulkImportId) return;
    const kind = phase === PHASES.BOM_ERROR ? 'BOM' : 'ITEM';
    markRetryFailed(kind, error, bulkImportId, resp);
  }, [phase, markRetryFailed]);

  // -----------------------------------------------------------------------
  // Comparison hookup (revise-mode only) — mirrors the Project dialog's
  // wiring. Path A of runBomStep pauses on REVIEW_DIFF after creating R5
  // and uploading the sheet. This dialog then:
  //   1. auto-opens FactWise's comparison page in preview mode (a new,
  //      project-less route added to FW so this BOM-Directory-only flow
  //      doesn't need to fabricate a project_id in the URL)
  //   2. listens for the confirm/reject postMessage FW's page sends back
  //   3. delegates to confirmRevisionDiff / cancelRevisionDiff — which
  //      run the item upload → process → submit sequence (no attach step
  //      because this dialog is BOM-Directory-only)
  // -----------------------------------------------------------------------
  const { fwOrigin } = useFactwise();
  const previewPopupRef = useRef(null);

  const handleOpenComparisonInFactwise = useCallback(() => {
    const params = new URLSearchParams();
    if (revisedNewEnterpriseBomId) {
      params.set('preview_enterprise_bom_id', revisedNewEnterpriseBomId);
    }
    if (bomBulkImportId) {
      params.set('preview_bulk_import_id', bomBulkImportId);
    }
    if (window.location.origin) {
      params.set('callback_origin', window.location.origin);
    }
    // Project-less preview route — added to FactWise's Accounting.tsx
    // Switch specifically for this flow. Same BOMComparisonPageClean
    // component; page.useParams returns undefined project_id and the
    // preview-mode guard in its fetch effect skips the "missing
    // project_id" error.
    const path = `/custom/cost-tracking/bom-revision-preview?${params.toString()}`;
    const inIframe = window.parent && window.parent !== window;
    if (inIframe) {
      postToFactwiseParent('NAVIGATE', { url: path });
      return;
    }
    if (fwOrigin) {
      const popup = window.open(fwOrigin + path, 'fw_bom_revision_preview');
      previewPopupRef.current = popup || null;
    } else {
      window.location.href = path;
    }
  }, [fwOrigin, revisedNewEnterpriseBomId, bomBulkImportId]);

  // Fire the preview redirect the moment we hit REVIEW_DIFF. Same
  // one-shot guard as the Project dialog so the tab isn't re-opened on
  // every re-render.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!open) { redirectedRef.current = false; return; }
    if (redirectedRef.current) return;
    if (phase !== PHASES.REVIEW_DIFF) return;
    if (!reviseIntent?.enterpriseBomId) return;
    redirectedRef.current = true;
    handleOpenComparisonInFactwise();
  }, [open, phase, reviseIntent, handleOpenComparisonInFactwise]);

  // postMessage listener for confirm/reject from FW's preview page.
  // Same shape the Project dialog uses.
  useEffect(() => {
    if (!open) return undefined;
    const onMessage = (event) => {
      if (fwOrigin && event.origin !== fwOrigin) return;
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'FW_REVISION_PREVIEW_CONFIRMED') {
        confirmRevisionDiff?.();
        redirectedRef.current = false;
        const popup = previewPopupRef.current;
        if (popup && !popup.closed) { try { popup.close(); } catch (_) {} }
        previewPopupRef.current = null;
      } else if (data.type === 'FW_REVISION_PREVIEW_REJECTED') {
        cancelRevisionDiff?.('Revision rejected in FactWise. Adjust the sheet and export again.');
        redirectedRef.current = false;
        const popup = previewPopupRef.current;
        if (popup && !popup.closed) { try { popup.close(); } catch (_) {} }
        previewPopupRef.current = null;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, fwOrigin, confirmRevisionDiff, cancelRevisionDiff]);

  // Prefer opening the newly-created BOM directly at its admin edit page —
  // that's what the user actually wants to look at after a successful
  // export. Falls back to the directory listing only if we somehow don't
  // have the id (e.g. an old checkpoint that predates the bomIds field).
  const handleOpenBomDirectory = useCallback(async () => {
    const ids = Array.isArray(bomIds) ? bomIds.filter(Boolean) : [];
    if (!ids.length) {
      openInFactwise('/admin/BOM/');
      return;
    }
    if (ids.length === 1) {
      openInFactwise(`/admin/BOM/edit/${ids[0]}`);
      return;
    }

    // Open the TOP of the tree, not whichever id came back first.
    //
    // A multi-level export creates one BOM per assembly — this file made five —
    // and `bom_ids` arrives in no meaningful order, so "Open BOM" was a lottery
    // between the finished good and one of its sub-assemblies. The root is the
    // one NO other BOM references as a sub-BOM, which needs no knowledge of
    // what the popup was told and no extra lookup beyond these details.
    //
    // Falls back to the first id if the details cannot be read: landing on some
    // BOM beats refusing to open anything.
    let root = ids[0];
    try {
      const details = await Promise.all(ids.map(id => fetchEnterpriseBomDetail(id)));
      const childIds = new Set();
      details.forEach((detail) => {
        (detail?.bom?.bom_items || []).forEach((item) => {
          const child = item?.sub_bom?.enterprise_bom_id || item?.sub_bom;
          if (child) childIds.add(String(child));
        });
      });
      root = ids.find(id => !childIds.has(String(id))) || ids[0];
    } catch (err) {
      /* keep the fallback */
    }
    openInFactwise(`/admin/BOM/edit/${root}`);
  }, [bomIds]);

  const handleResetAndClose = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const stepperContent = useMemo(() => (
    <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
      {STEP_ORDER.map((step, idx) => {
        const status = stepStatus(phase, idx);
        return (
          <Step key={step.key} completed={status === 'completed'}>
            <StepLabel
              error={status === 'error'}
              icon={
                status === 'completed' ? <CheckCircleIcon color="success" fontSize="small" />
                : status === 'error' ? <ErrorOutlineIcon color="error" fontSize="small" />
                : status === 'active' && isRunning ? <CircularProgress size={18} />
                : undefined
              }
            >
              {step.label}
            </StepLabel>
          </Step>
        );
      })}
    </Stepper>
  ), [activeStep, phase, isRunning]);

  return (
    <Dialog
      open={open}
      onClose={isRunning ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '14px' } }}
    >
      <DialogTitle
        // component=div so the nested Typography variant="h6" doesn't render
        // as <h6> inside <h2> — invalid nesting per validateDOMNesting.
        component="div"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" component="h2" sx={{ fontWeight: 650 }}>
          Export to Factwise BOM Directory
        </Typography>
        {!isRunning && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent dividers>
        {stepperContent}

        {/* Revise-mode banner — surfaces the BOM that will be revised so
            the user can double-check before hitting Start. The intent
            comes from BomStructureDialog earlier in the flow (mode=revise
            + project=No selection). If nothing is shown here, this dialog
            will fresh-create a new BOM instead of revising. */}
        {reviseIntent && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Revising <strong>{reviseIntent.bomCode}</strong> — a new
              revision will be created in the BOM Directory.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              No project will be touched. If you also wanted to move a
              project's slot to this new revision, close and use
              &quot;Export to Factwise Project&quot; instead.
            </Typography>
          </Alert>
        )}

        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {phaseLabel(phase)
            || (reviseIntent
              ? 'Click "Start export" to send items to the Item Directory, then upload the sheet as a revision — you\'ll review the diff in Factwise before it commits.'
              : 'Click "Start export" to send items to the Item Directory first, then the BOM. The BOM references item codes that must exist in Factwise, so items are imported before it.')}
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
          {itemCreated?.length > 0 && (
            <Chip
              size="small"
              color="success"
              icon={<CheckCircleIcon />}
              label={`${itemCreated.length} items created`}
            />
          )}
          {itemUpdated?.length > 0 && (
            <Chip
              size="small"
              color="info"
              icon={<CheckCircleIcon />}
              label={`${itemUpdated.length} items updated`}
            />
          )}
          {bomIds?.length > 0 && (
            <Chip
              size="small"
              color="success"
              icon={<CheckCircleIcon />}
              label={`${bomIds.length} BOM(s) created`}
            />
          )}
        </Stack>

        {needsBomCode && (
          <BomCodeConflictPrompt
            conflicts={bomCodeConflicts || []}
            disabled={isRunning}
            onSubmit={handleBomCodeChosen}
          />
        )}

        {hasError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {lastError || 'Something went wrong.'}
              {lastResponseType && (
                <Chip
                  size="small"
                  label={lastResponseType}
                  sx={{ ml: 1, height: 20, fontSize: 11 }}
                />
              )}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              {lastBulkImportId
                ? 'Fix the red cells inline below and click "Save & retry" — earlier successful steps are skipped.'
                : `Fix the underlying issue and click "${retryLabelForPhase(phase)}".`}
            </Typography>
          </Alert>
        )}

        {hasError && lastBulkImportId && (
          <FactwiseBulkImportErrorGrid
            bulkImportId={lastBulkImportId}
            resourceType={phase === PHASES.ITEMS_ERROR ? 'ITEM' : 'BOM'}
            additionalInformation={
              phase === PHASES.BOM_ERROR ? { import_type: 'BOM_DASHBOARD' } : {}
            }
            onRetrySuccess={handleGridRetrySuccess}
            onRetryFailure={handleGridRetryFailure}
            disabled={isRunning}
            sessionId={sessionId}
            onHostRowsUpdated={refreshHost}
          />
        )}

        {isDone && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              BOM is now in Factwise.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              {itemCreated.length} items · {bomIds.length} BOM(s).
            </Typography>
          </Alert>
        )}
        {retryMessage && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {retryMessage}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {isDone ? (
          <>
            <Button onClick={handleResetAndClose}>Close</Button>
            <Button
              variant="contained"
              startIcon={<LaunchIcon />}
              onClick={handleOpenBomDirectory}
            >
              {/* Says which one it opens. "Open BOM" beside a "5 BOM(s)
                  created" chip reads as though it opens all of them. */}
              {Array.isArray(bomIds) && bomIds.length
                ? (bomIds.length > 1
                  ? 'Open top-level BOM in Factwise'
                  : 'Open BOM in Factwise')
                : 'Open BOM Directory in Factwise'}
            </Button>
          </>
        ) : needsBomCode ? (
          // The prompt's own button resumes the run — a retry here would only
          // re-ask the question it is already showing.
          <>
            <Button
              color="warning"
              onClick={handleResetAndClose}
              disabled={isRunning}
            >
              Start over
            </Button>
            <Button onClick={onClose} disabled={isRunning}>
              Dismiss
            </Button>
          </>
        ) : hasError ? (
          <>
            <Button
              color="warning"
              onClick={handleResetAndClose}
              disabled={isRunning}
            >
              Start over
            </Button>
            <Button onClick={onClose} disabled={isRunning}>
              Dismiss
            </Button>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={handleStart}
              disabled={isRunning || !canStart}
            >
              {retryLabelForPhase(phase)}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={isRunning}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleStart}
              disabled={!canStart}
              startIcon={isRunning ? <CircularProgress size={14} /> : null}
            >
              {isRunning ? 'Working…' : 'Start export'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
