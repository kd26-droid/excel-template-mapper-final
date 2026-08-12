import React, { useCallback, useMemo, useState } from 'react';
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
import { openInFactwise } from '../contexts/FactwiseContext';
import FactwiseBulkImportErrorGrid from './FactwiseBulkImportErrorGrid';

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
  ) return 1;
  if (phase === PHASES.DONE) return STEP_ORDER.length;
  return 0;
}

function stepStatus(phase, index) {
  const current = phaseToStepIndex(phase);
  if (index < current) return 'completed';
  if (index === current) {
    if (phase === PHASES.ITEMS_ERROR || phase === PHASES.BOM_ERROR) return 'error';
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
    case PHASES.BOM_UPLOADING: return 'Uploading BOM file to Factwise…';
    case PHASES.BOM_PROCESSING: return 'Validating BOM structure…';
    case PHASES.BOM_ERROR: return 'BOM import failed — items were saved. See errors below.';
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
  const {
    phase,
    itemCreated,
    itemUpdated,
    bomIds,
    lastError,
    lastResponseType,
    lastBulkImportId,
    isRunning,
    runFromCheckpoint,
    reset,
  } = orchestration;

  const [retryMessage] = useState(null);

  const activeStep = phaseToStepIndex(phase);
  const isDone = phase === PHASES.DONE;
  const hasError = phase === PHASES.ITEMS_ERROR || phase === PHASES.BOM_ERROR;
  const canStart = !isRunning && !isDone;

  const handleStart = useCallback(() => {
    runFromCheckpoint({ stopAfterBom: true });
  }, [runFromCheckpoint]);

  const handleGridRetrySuccess = useCallback(() => {
    runFromCheckpoint({ stopAfterBom: true });
  }, [runFromCheckpoint]);

  const handleOpenBomDirectory = useCallback(() => {
    openInFactwise('/admin/BOM/');
  }, []);

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
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 650 }}>
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

        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {phaseLabel(phase)
            || 'Click "Start export" to send items to the Item Directory first, then the BOM. The BOM references item codes that must exist in Factwise, so items are imported before it.'}
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
            disabled={isRunning}
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
              Open BOM Directory in Factwise
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
