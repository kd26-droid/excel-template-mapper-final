import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import LaunchIcon from '@mui/icons-material/Launch';
import HistoryIcon from '@mui/icons-material/History';
import {
  PHASES,
  PROJECT_MODES,
  useFactwiseProjectExport,
} from '../hooks/useFactwiseProjectExport';
import { postToFactwiseParent } from '../contexts/FactwiseContext';
import {
  fetchProjects,
  fetchProjectBomVersions,
  fetchModuleTemplates,
} from '../services/factwiseApi';
import FactwiseBulkImportErrorGrid from './FactwiseBulkImportErrorGrid';

const STEP_ORDER = [
  { key: 'items', label: 'Import items into Factwise' },
  { key: 'bom', label: 'Import BOM structure' },
  { key: 'project', label: 'Project + attach BOM' },
];

function phaseToStepIndex(phase) {
  if (
    phase === PHASES.ITEMS_UPLOADING
    || phase === PHASES.ITEMS_PROCESSING
    || phase === PHASES.ITEMS_ERROR
  ) return 0;
  if (
    phase === PHASES.ITEMS_DONE
    || phase === PHASES.BOM_UPLOADING
    || phase === PHASES.BOM_PROCESSING
    || phase === PHASES.BOM_ERROR
  ) return 1;
  if (
    phase === PHASES.BOM_DONE
    || phase === PHASES.PROJECT_CREATING
    || phase === PHASES.PROJECT_ERROR
    || phase === PHASES.ATTACH_BOM
    || phase === PHASES.ATTACH_BOM_ERROR
  ) return 2;
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
      || phase === PHASES.PROJECT_ERROR
      || phase === PHASES.ATTACH_BOM_ERROR
    ) return 'error';
    return 'active';
  }
  return 'pending';
}

// Human-readable label for the current phase.
function phaseLabel(phase, isRevising) {
  switch (phase) {
    case PHASES.ITEMS_UPLOADING: return 'Uploading items file to Factwise…';
    case PHASES.ITEMS_PROCESSING: return 'Validating items against Factwise directory…';
    case PHASES.ITEMS_ERROR: return 'Item import failed — see errors below.';
    case PHASES.ITEMS_DONE: return 'Items imported. Starting BOM upload…';
    case PHASES.BOM_UPLOADING: return 'Uploading BOM file to Factwise…';
    case PHASES.BOM_PROCESSING: return 'Validating BOM structure…';
    case PHASES.BOM_ERROR: return 'BOM import failed — items were saved. See errors below.';
    case PHASES.BOM_DONE: return 'BOM imported. Moving to project step…';
    case PHASES.PROJECT_CREATING: return 'Creating project in Factwise…';
    case PHASES.PROJECT_ERROR: return 'Project creation failed — items and BOM were saved. See error below.';
    case PHASES.ATTACH_BOM: return isRevising
      ? 'Revising BOM inside the project…'
      : 'Attaching BOM to the project…';
    case PHASES.ATTACH_BOM_ERROR: return 'BOM attach failed — project exists, retry to link the BOM.';
    case PHASES.DONE: return 'Export complete.';
    default: return '';
  }
}

function retryLabelForPhase(phase) {
  if (phase === PHASES.ITEMS_ERROR) return 'Retry item import';
  if (phase === PHASES.BOM_ERROR) return 'Retry BOM import (items are kept)';
  if (phase === PHASES.PROJECT_ERROR) return 'Retry project creation';
  if (phase === PHASES.ATTACH_BOM_ERROR) return 'Retry BOM attach';
  return 'Retry';
}

export default function FactwiseProjectExportDialog({
  open,
  onClose,
  sessionId,
  getColumnOrder,
  refreshHost,
  defaultProjectName = '',
}) {
  const orchestration = useFactwiseProjectExport({ sessionId, getColumnOrder, refreshHost });
  const {
    phase,
    mode,
    projectName,
    templateId,
    templateName,
    existingProjectId,
    existingProjectName,
    reviseEnterpriseBomId,
    reviseBomModuleId,
    reviseBomCode,
    itemCreated,
    itemUpdated,
    bomIds,
    projectId,
    attachedBomIds,
    revisedProjectBomModules,
    lastError,
    lastResponseType,
    lastBulkImportId,
    isRunning,
    runFromCheckpoint,
    reset,
  } = orchestration;

  const [modeDraft, setModeDraft] = useState(mode || PROJECT_MODES.NEW);
  const [nameDraft, setNameDraft] = useState(projectName || defaultProjectName);
  const [pickedProject, setPickedProject] = useState(null);
  const [projectOptions, setProjectOptions] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  // Project template picker (NEW mode) — mirrors FactWise's EntityAndTemplateSelectionPopup.
  const [pickedTemplate, setPickedTemplate] = useState(null);
  const [templateOptions, setTemplateOptions] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(null);
  // Revision-target picker (only shown after project pick in EXISTING mode).
  // '' → "create new BOM" (default). Otherwise a value of shape
  // `${bom_module_id}::${enterprise_bom_id}::${bom_code}`.
  const [reviseTargetKey, setReviseTargetKey] = useState('');
  const [projectBoms, setProjectBoms] = useState([]);
  const [projectBomsLoading, setProjectBomsLoading] = useState(false);
  const [projectBomsError, setProjectBomsError] = useState(null);

  // Keep drafts in sync when checkpoint rehydrates.
  useEffect(() => {
    if (mode) setModeDraft(mode);
  }, [mode]);
  useEffect(() => {
    if (projectName) setNameDraft(projectName);
  }, [projectName]);
  useEffect(() => {
    if (existingProjectId && !pickedProject) {
      setPickedProject({
        project_id: existingProjectId,
        project_name: existingProjectName || '(loading…)',
        project_code: '',
      });
    }
  }, [existingProjectId, existingProjectName, pickedProject]);

  // Lazily load project templates the first time the user opens NEW mode.
  useEffect(() => {
    if (modeDraft !== PROJECT_MODES.NEW) return;
    if (templateOptions.length || templatesLoading) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    fetchModuleTemplates('PROJECT').then((res) => {
      if (cancelled) return;
      if (res?.success) {
        const templates = res.templates || [];
        setTemplateOptions(templates);
        // Preselect: (a) whatever the checkpoint saved (retry after a page refresh),
        // (b) otherwise the is_default template, (c) otherwise the first one.
        if (!pickedTemplate) {
          const preferred = (templateId && templates.find((t) => t.template_id === templateId))
            || templates.find((t) => t.is_default)
            || templates[0]
            || null;
          if (preferred) setPickedTemplate(preferred);
        }
      } else {
        setTemplatesError(res?.error || 'Failed to load project templates');
      }
      setTemplatesLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeDraft]);

  // Server-side project search — debounced, paginated. Fires only after the
  // user starts typing (or opens EXISTING mode for the first time with an
  // empty query, which returns the first page of results).
  const [projectSearchText, setProjectSearchText] = useState('');
  const projectSearchRef = useRef(0);
  const runProjectSearch = useCallback((text) => {
    const callId = ++projectSearchRef.current;
    setProjectsLoading(true);
    setProjectsError(null);
    fetchProjects({ searchText: text, pageNumber: 1, itemsPerPage: 15 })
      .then((res) => {
        // Ignore out-of-order responses.
        if (callId !== projectSearchRef.current) return;
        if (res?.success) {
          setProjectOptions(res.projects || []);
        } else {
          setProjectOptions([]);
          setProjectsError(res?.error || 'Failed to load projects');
        }
        setProjectsLoading(false);
      });
  }, []);

  // First open of EXISTING mode → fetch the first page silently so the
  // dropdown isn't empty before the user starts typing.
  useEffect(() => {
    if (modeDraft !== PROJECT_MODES.EXISTING) return;
    if (projectOptions.length || projectsLoading) return;
    runProjectSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeDraft]);

  // Debounce subsequent typing.
  useEffect(() => {
    if (modeDraft !== PROJECT_MODES.EXISTING) return;
    const t = setTimeout(() => {
      runProjectSearch(projectSearchText || '');
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSearchText, modeDraft]);

  // Whenever the picked project changes, refresh its BOM list (for the
  // "create new vs revise which" radio group).
  useEffect(() => {
    if (modeDraft !== PROJECT_MODES.EXISTING || !pickedProject?.project_id) {
      setProjectBoms([]);
      setReviseTargetKey('');
      return;
    }
    let cancelled = false;
    setProjectBomsLoading(true);
    setProjectBomsError(null);
    fetchProjectBomVersions(
      pickedProject.project_id,
      Array.isArray(pickedProject.boms) ? pickedProject.boms : []
    ).then((res) => {
      if (cancelled) return;
      if (res?.success) {
        setProjectBoms(res.boms || []);
      } else {
        setProjectBoms([]);
        setProjectBomsError(res?.error || 'Failed to load project BOMs');
      }
      setProjectBomsLoading(false);
    });
    return () => { cancelled = true; };
  }, [modeDraft, pickedProject]);

  // Rehydrate revise selection from checkpoint (if a prior in-flight export
  // had one selected and the browser was refreshed).
  useEffect(() => {
    if (!reviseBomModuleId || !reviseEnterpriseBomId) return;
    setReviseTargetKey(
      `${reviseBomModuleId}::${reviseEnterpriseBomId}::${reviseBomCode || ''}`
    );
  }, [reviseBomModuleId, reviseEnterpriseBomId, reviseBomCode]);

  const activeStep = phaseToStepIndex(phase);
  const isDone = phase === PHASES.DONE;
  const hasError =
    phase === PHASES.ITEMS_ERROR
    || phase === PHASES.BOM_ERROR
    || phase === PHASES.PROJECT_ERROR
    || phase === PHASES.ATTACH_BOM_ERROR;

  const canStart =
    !isRunning && !isDone && (
      modeDraft === PROJECT_MODES.NEW
        ? !!nameDraft?.trim() && !!pickedTemplate?.template_id
        : !!pickedProject?.project_id
    );

  const parsedReviseTarget = useMemo(() => {
    if (!reviseTargetKey) {
      return { bomModuleId: null, enterpriseBomId: null, bomCode: null };
    }
    const [bomModuleId, enterpriseBomId, bomCode] = reviseTargetKey.split('::');
    return { bomModuleId, enterpriseBomId, bomCode };
  }, [reviseTargetKey]);

  const buildRunPayload = useCallback(() => ({
    mode: modeDraft,
    projectName: nameDraft?.trim(),
    templateId: pickedTemplate?.template_id || null,
    templateName: pickedTemplate?.name || null,
    existingProjectId: pickedProject?.project_id || null,
    existingProjectName: pickedProject?.project_name || null,
    reviseEnterpriseBomId: parsedReviseTarget.enterpriseBomId || null,
    reviseBomModuleId: parsedReviseTarget.bomModuleId || null,
    reviseBomCode: parsedReviseTarget.bomCode || null,
  }), [modeDraft, nameDraft, pickedTemplate, pickedProject, parsedReviseTarget]);

  const handleStart = useCallback(() => {
    runFromCheckpoint(buildRunPayload());
  }, [runFromCheckpoint, buildRunPayload]);

  const handleGridRetrySuccess = useCallback(() => {
    runFromCheckpoint(buildRunPayload());
  }, [runFromCheckpoint, buildRunPayload]);

  const openTarget = projectId || existingProjectId;
  const handleOpenInFactwise = useCallback(() => {
    if (!openTarget) return;
    // Newly-created projects start in DRAFT — FactWise's own /custom/cost-tracking
    // create flow drops the user on /<id>/draft after create. Existing projects
    // (EXISTING mode) go to /<id>/view.
    const suffix = mode === PROJECT_MODES.EXISTING ? 'view' : 'draft';
    postToFactwiseParent('NAVIGATE', {
      url: `/custom/cost-tracking/projects/${openTarget}/${suffix}`,
    });
  }, [openTarget, mode]);

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

  const configFrozen = isRunning || isDone;

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
          Export to Factwise Project
        </Typography>
        {!isRunning && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent dividers>
        {stepperContent}

        {/* NEW vs EXISTING project mode */}
        <Tabs
          value={modeDraft}
          onChange={(_, v) => setModeDraft(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            value={PROJECT_MODES.NEW}
            label="New project"
            disabled={configFrozen}
          />
          <Tab
            value={PROJECT_MODES.EXISTING}
            label="Existing project"
            disabled={configFrozen}
          />
        </Tabs>

        {modeDraft === PROJECT_MODES.NEW ? (
          <Box sx={{ mb: 2 }}>
            <Stack spacing={1.5}>
              <TextField
                label="Project name"
                fullWidth
                size="small"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={configFrozen}
              />
              <Autocomplete
                size="small"
                options={templateOptions}
                value={pickedTemplate}
                onChange={(_, v) => setPickedTemplate(v)}
                getOptionLabel={(o) => {
                  if (!o) return '';
                  const bits = [o.name, o.entity_name].filter(Boolean);
                  return bits.join(' — ') || o.template_id;
                }}
                isOptionEqualToValue={(o, v) => o?.template_id === v?.template_id}
                disabled={configFrozen}
                loading={templatesLoading}
                renderOption={(props, option) => (
                  <li {...props} key={option.template_id}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: option.is_default ? 700 : 500 }}>
                        {option.name}
                        {option.is_default ? '  (default)' : ''}
                      </Typography>
                      {option.entity_name && (
                        <Typography variant="caption" color="text.secondary">
                          {option.entity_name}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Project template"
                    helperText={
                      templatesError
                        || 'Same list FactWise uses when you click "Create Project". Default is preselected.'
                    }
                    error={Boolean(templatesError)}
                  />
                )}
              />
            </Stack>
          </Box>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Autocomplete
              size="small"
              options={projectOptions}
              value={pickedProject}
              onChange={(_, v) => setPickedProject(v)}
              onInputChange={(_, value, reason) => {
                // Only re-search when the user is actually typing (not on
                // selection / reset / initial mount).
                if (reason === 'input') setProjectSearchText(value || '');
              }}
              filterOptions={(opts) => opts}
              getOptionLabel={(o) => {
                if (!o) return '';
                const parts = [o.project_code, o.project_name].filter(Boolean);
                return parts.join(' — ') || o.project_id;
              }}
              isOptionEqualToValue={(o, v) => o?.project_id === v?.project_id}
              disabled={configFrozen}
              loading={projectsLoading}
              noOptionsText={
                projectsLoading ? 'Searching…' : 'No matching projects'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Pick an existing project"
                  helperText={
                    projectsError
                      || 'Start typing to search. The BOM you send will either be attached fresh, or revise one of the project\'s existing BOMs — pick below.'
                  }
                  error={Boolean(projectsError)}
                />
              )}
            />

            {/* BOM selection: create new OR revise one of the project's existing BOMs */}
            {pickedProject?.project_id && (
              <Box sx={{ mt: 2, p: 1.5, borderRadius: 1.5, border: 1, borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75, fontWeight: 600 }}>
                  Where should this BOM go inside the project?
                </Typography>
                {projectBomsLoading ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={14} />
                    <Typography variant="caption">Loading project BOMs…</Typography>
                  </Stack>
                ) : projectBomsError ? (
                  <Typography variant="caption" color="error">
                    {projectBomsError}
                  </Typography>
                ) : (
                  <FormControl disabled={configFrozen}>
                    <RadioGroup
                      value={reviseTargetKey}
                      onChange={(_, v) => setReviseTargetKey(v)}
                    >
                      <FormControlLabel
                        value=""
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            <strong>Create new BOM</strong> in this project
                          </Typography>
                        }
                      />
                      {projectBoms.length === 0 ? (
                        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 4 }}>
                          Project has no BOMs yet.
                        </Typography>
                      ) : (
                        projectBoms.map((b) => {
                          const bomModuleId = b.bom_module_id || b.module_id || b.id;
                          const enterpriseBomId = b.enterprise_bom_id || b.base_bom_id;
                          const label = [b.bom_code, b.bom_name].filter(Boolean).join(' — ') || bomModuleId;
                          const key = `${bomModuleId}::${enterpriseBomId}::${b.bom_code || ''}`;
                          return (
                            <FormControlLabel
                              key={key}
                              value={key}
                              disabled={!bomModuleId || !enterpriseBomId}
                              control={<Radio size="small" />}
                              label={
                                <Typography variant="body2">
                                  Revise: <strong>{label}</strong>
                                  {b.version_label
                                    ? ` (currently ${b.version_label})`
                                    : ''}
                                </Typography>
                              }
                            />
                          );
                        })
                      )}
                    </RadioGroup>
                  </FormControl>
                )}
                <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                  Revising creates a new revision in the BOM directory and repoints this project's BOM to it. Both places are updated.
                </Typography>
              </Box>
            )}
          </Box>
        )}

        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {phaseLabel(phase, Boolean(reviseEnterpriseBomId))
            || (modeDraft === PROJECT_MODES.NEW
              ? 'Click "Start export" to send items, BOM, and create the project.'
              : reviseTargetKey
                ? 'Click "Start export" to send items and revise the picked BOM inside this project.'
                : 'Click "Start export" to send items and attach the BOM as a new module in this project.')}
        </Typography>

        {/* Progress summary */}
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
          {reviseEnterpriseBomId && (
            <Chip
              size="small"
              color="warning"
              icon={<HistoryIcon />}
              label={reviseBomCode
                ? `Revising BOM: ${reviseBomCode}`
                : `Revising BOM`}
            />
          )}
          {bomIds?.length > 0 && !reviseEnterpriseBomId && (
            <Chip
              size="small"
              color="success"
              icon={<CheckCircleIcon />}
              label={`${bomIds.length} BOM(s) created`}
            />
          )}
          {(projectId || existingProjectId) && (
            <Chip
              size="small"
              color="success"
              icon={<CheckCircleIcon />}
              label={mode === PROJECT_MODES.EXISTING ? 'Project targeted' : 'Project created'}
            />
          )}
          {attachedBomIds?.length > 0 && (
            <Chip
              size="small"
              color="success"
              icon={<CheckCircleIcon />}
              label={`${attachedBomIds.length} BOM(s) attached`}
            />
          )}
          {revisedProjectBomModules?.length > 0 && (
            <Chip
              size="small"
              color="warning"
              icon={<HistoryIcon />}
              label={`${revisedProjectBomModules.length} BOM(s) revised in project`}
            />
          )}
        </Stack>

        {/* Error card */}
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

        {/* Inline editable error grid (Factwise-style) */}
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

        {/* Done card */}
        {isDone && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Everything is now in Factwise.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              {itemCreated.length} items · {bomIds.length} BOM
              {reviseEnterpriseBomId ? ' (revised)' : ''} ·{' '}
              {mode === PROJECT_MODES.EXISTING
                ? `attached to "${existingProjectName || 'existing project'}"`
                : `project "${projectName}"`}
              {revisedProjectBomModules?.length > 0
                ? ` (${revisedProjectBomModules.length} in-project revision${revisedProjectBomModules.length === 1 ? '' : 's'})`
                : ''}
              .
            </Typography>
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {isDone ? (
          <>
            <Button onClick={handleResetAndClose}>Close</Button>
            {openTarget && (
              <Button
                variant="contained"
                startIcon={<LaunchIcon />}
                onClick={handleOpenInFactwise}
              >
                Open project in Factwise
              </Button>
            )}
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
