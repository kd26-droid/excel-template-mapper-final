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
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
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
import { postToFactwiseParent, useFactwise } from '../contexts/FactwiseContext';
import {
  fetchProjects,
  fetchProjectBomVersions,
  fetchModuleTemplates,
} from '../services/factwiseApi';
import FactwiseBulkImportErrorGrid from './FactwiseBulkImportErrorGrid';
import { readBomRevisionIntent, saveBomRevisionIntent } from '../utils/bomRevisionIntent';

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
    || phase === PHASES.ITEMS_SETTLING
    || phase === PHASES.BOM_UPLOADING
    || phase === PHASES.BOM_PROCESSING
    || phase === PHASES.BOM_ERROR
  ) return 1;
  if (
    phase === PHASES.BOM_DONE
    || phase === PHASES.BOM_SETTLING
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
    case PHASES.ITEMS_SETTLING: return 'Waiting for Factwise to index the new items before uploading BOM…';
    case PHASES.BOM_UPLOADING: return 'Uploading BOM file to Factwise…';
    case PHASES.BOM_PROCESSING: return 'Validating BOM structure…';
    case PHASES.BOM_ERROR: return 'BOM import failed — items were saved. See errors below.';
    case PHASES.BOM_DONE: return 'BOM imported. Moving to project step…';
    case PHASES.BOM_SETTLING: return 'Waiting for Factwise to finish building the BOM before attaching it to the project…';
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
  // If the user made edits to the main data editor between opens, the
  // checkpoint's item_bulk_import_id / bom_bulk_import_id / project_id from
  // an earlier attempt is stale. Reset every time the dialog transitions
  // closed → open so we always start from a fresh state that reflects
  // whatever's currently in the mapper's session.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      orchestration.reset();
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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
    markRetrySucceeded,
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
  // Empty → "create a new BOM in this project". Otherwise one key per slot to
  // move, each `${bom_module_id}::${enterprise_bom_id}::${bom_code}`. A list
  // because the same BOM can occupy several slots in one project and a
  // revision that reached only one would leave the rest on the old version.
  const [reviseTargetKeys, setReviseTargetKeys] = useState([]);
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
  // "create new vs revise which" checkboxes).
  useEffect(() => {
    if (modeDraft !== PROJECT_MODES.EXISTING || !pickedProject?.project_id) {
      setProjectBoms([]);
      setReviseTargetKeys([]);
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
    setReviseTargetKeys(
      [`${reviseBomModuleId}::${reviseEnterpriseBomId}::${reviseBomCode || ''}`]
    );
  }, [reviseBomModuleId, reviseEnterpriseBomId, reviseBomCode]);

  // ---------------------------------------------------------------------------
  // Carry-over from BomStructureDialog.
  //
  // That dialog asked "is this a revision, of what BOM, on which project?" back
  // at upload, before the file was even parsed. Re-asking here with NEW PROJECT
  // and "Create new BOM" preselected is how a file the user declared a revision
  // of BOM X leaves as a second BOM sitting next to X.
  //
  // Applied at most once per opening, and never over a checkpoint: an export
  // already in flight has a real answer, and this is a guess about a fresh one.
  // Keyed on `open` rather than mount so the checkpoint rehydrate above has
  // settled long before this reads `phase`.
  //
  // The intent is read ONCE and held until consumed, not re-read where it is
  // used. The write-back further down fires the moment the project lands —
  // before the project's BOM list has even been requested — and it would
  // rewrite the stored intent with a null BOM, so a second read here would find
  // the very thing it came for already erased. Held in state rather than a ref
  // because the write-back has to wait on it, and a ref would not re-run it.
  const [pendingIntent, setPendingIntent] = useState(null);
  const intentAppliedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      intentAppliedRef.current = false;
      setPendingIntent(null);
      return;
    }
    if (intentAppliedRef.current) return;
    intentAppliedRef.current = true;
    if (phase !== PHASES.IDLE || existingProjectId || pickedProject) return;
    const intent = readBomRevisionIntent();
    if (!intent?.projectId) return;
    setPendingIntent(intent.enterpriseBomId ? intent : null);
    setModeDraft(PROJECT_MODES.EXISTING);
    setPickedProject({
      project_id: intent.projectId,
      project_code: intent.projectCode || '',
      project_name: intent.projectName || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The revise radio can only be set once the project's BOM list is in, and the
  // effect above resets it to '' on every project change — so this runs after
  // the fetch lands. Matching on enterprise_bom_id is what supplies the
  // bom_module_id: the upload dialog reads the org-wide BOM list, which does not
  // carry one.
  useEffect(() => {
    if (!open || !pendingIntent?.enterpriseBomId || reviseTargetKeys.length || !projectBoms.length) return;
    // Consumed either way — if the BOM is not on this project, retrying on the
    // next project the user picks would apply a target they did not ask for.
    setPendingIntent(null);
    // Matched on the base BOM when the upload dialog resolved one, so every
    // slot holding that BOM is selected regardless of which revision each sits
    // at. Falling back to the exact revision finds only slots that happen to be
    // on the same one.
    const matches = pendingIntent.baseBomId
      ? projectBoms.filter(b => String(b.base_bom_id) === String(pendingIntent.baseBomId))
      : projectBoms.filter(b => String(b.enterprise_bom_id) === String(pendingIntent.enterpriseBomId));
    // No match means that BOM is not on this project. Leaving it on "create
    // new" is correct — revising it here is not something FactWise offers, and
    // silently picking a different BOM would be worse than asking.
    const usable = matches.filter(b => b.bom_module_id && b.enterprise_bom_id);
    if (!usable.length) return;
    setReviseTargetKeys(
      usable.map(b => `${b.bom_module_id}::${b.enterprise_bom_id}::${b.bom_code || ''}`)
    );
  }, [open, pendingIntent, projectBoms, reviseTargetKeys]);

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

  // A project restored from a checkpoint or carried over from the upload dialog
  // is not in the search results until a search happens to return it. MUI drops
  // a value it cannot find in `options` and warns, so it is spliced in until the
  // real row arrives.
  const projectChoices = useMemo(() => {
    if (!pickedProject?.project_id) return projectOptions;
    if (projectOptions.some(p => p.project_id === pickedProject.project_id)) return projectOptions;
    return [pickedProject, ...projectOptions];
  }, [projectOptions, pickedProject]);

  const parsedReviseTargets = useMemo(() => reviseTargetKeys.map((key) => {
    const [bomModuleId, enterpriseBomId, bomCode] = key.split('::');
    return { bomModuleId, enterpriseBomId, bomCode };
  }), [reviseTargetKeys]);

  // The single-target fields the checkpoint and the summary still speak in.
  // Only the first — they are display and rehydrate aids; the run itself reads
  // the full list. Memoised because the write-back effect below depends on it,
  // and a fresh object each render would have it saving on every render.
  const primaryReviseTarget = useMemo(
    () => parsedReviseTargets[0] || { bomModuleId: null, enterpriseBomId: null, bomCode: null },
    [parsedReviseTargets]
  );

  // A revise call is rejected outright unless the target shares a base BOM with
  // what the slot currently holds, so offering slots from a different BOM is
  // offering a guaranteed 400. The base comes from the upload dialog when it
  // carried one, and otherwise from whatever the user picks first — after which
  // the rest of the list narrows to match.
  const lockedBaseBomId = useMemo(() => {
    if (pendingIntent?.baseBomId) return String(pendingIntent.baseBomId);
    const firstId = parsedReviseTargets[0]?.enterpriseBomId;
    if (!firstId) return null;
    const row = projectBoms.find(b => String(b.enterprise_bom_id) === String(firstId));
    return row?.base_bom_id ? String(row.base_bom_id) : null;
  }, [pendingIntent, parsedReviseTargets, projectBoms]);

  // Rows with no base_bom_id cannot be shown to share one, so they drop out
  // once a base is locked rather than being offered on the strength of a null.
  const revisableBoms = useMemo(() => {
    if (!lockedBaseBomId) return projectBoms;
    return projectBoms.filter(b => String(b.base_bom_id) === lockedBaseBomId);
  }, [projectBoms, lockedBaseBomId]);

  const toggleReviseTarget = useCallback((key) => {
    setReviseTargetKeys(prev => (prev.includes(key)
      ? prev.filter(k => k !== key)
      : [...prev, key]));
  }, []);

  // Write back, so the answer given here prefills the next upload's structure
  // dialog. Only in EXISTING mode — NEW PROJECT says nothing about a revision
  // either way, and treating it as "no revision" would wipe an answer the user
  // gave at upload just because they glanced at the other tab.
  //
  // Below parsedReviseTarget rather than beside the read effects above: the dep
  // array is evaluated during render, so referencing it any earlier is a TDZ
  // error, not merely untidy.
  useEffect(() => {
    if (!open || modeDraft !== PROJECT_MODES.EXISTING || !pickedProject?.project_id) return;
    // A carried BOM that has not been matched to this project's BOM list yet is
    // still the best answer we have. Writing over it with the empty radio would
    // lose it if the dialog were closed before the list arrived.
    if (pendingIntent) return;
    saveBomRevisionIntent({
      enterpriseBomId: primaryReviseTarget.enterpriseBomId || null,
      bomCode: primaryReviseTarget.bomCode || '',
      baseBomId: lockedBaseBomId,
      // Only when unambiguous — several slots have no single module id, and the
      // upload dialog re-derives them from the base BOM anyway.
      bomModuleId: parsedReviseTargets.length === 1
        ? primaryReviseTarget.bomModuleId
        : null,
      projectId: pickedProject.project_id,
      projectCode: pickedProject.project_code || '',
      projectName: pickedProject.project_name || '',
    });
  }, [open, modeDraft, pickedProject, parsedReviseTargets, primaryReviseTarget,
      lockedBaseBomId, pendingIntent]);

  const buildRunPayload = useCallback(() => ({
    mode: modeDraft,
    projectName: nameDraft?.trim(),
    templateId: pickedTemplate?.template_id || null,
    templateName: pickedTemplate?.name || null,
    existingProjectId: pickedProject?.project_id || null,
    existingProjectName: pickedProject?.project_name || null,
    reviseEnterpriseBomId: primaryReviseTarget.enterpriseBomId || null,
    reviseBomModuleId: primaryReviseTarget.bomModuleId || null,
    // What the run actually iterates. One sequential PUT per entry.
    reviseBomModuleIds: parsedReviseTargets.map(t => t.bomModuleId).filter(Boolean),
    reviseBomCode: primaryReviseTarget.bomCode || null,
  }), [modeDraft, nameDraft, pickedTemplate, pickedProject, parsedReviseTargets,
       primaryReviseTarget]);

  const handleStart = useCallback(() => {
    runFromCheckpoint(buildRunPayload());
  }, [runFromCheckpoint, buildRunPayload]);

  // Advance the orchestrator's phase to reflect the retry that just
  // succeeded (item or bom) BEFORE resuming — otherwise runFromCheckpoint
  // sees state.phase === ITEMS_ERROR / BOM_ERROR and re-runs the failed
  // step from scratch with empty additional_information, undoing the
  // Save-side new_tags / ignore_duplicate_tags flags.
  const handleGridRetrySuccess = useCallback((resp, bulkImportId) => {
    const kind = phase === PHASES.BOM_ERROR ? 'BOM' : 'ITEM';
    markRetrySucceeded(kind, resp, bulkImportId);
    runFromCheckpoint(buildRunPayload());
  }, [phase, markRetrySucceeded, runFromCheckpoint, buildRunPayload]);

  const { fwOrigin } = useFactwise();
  const openTarget = projectId || existingProjectId;
  const handleOpenInFactwise = useCallback(() => {
    if (!openTarget) return;
    // Newly-created projects start in DRAFT (/<id>/draft), existing ones go
    // to /<id>/view. When we're inside FW's iframe, postMessage to parent so
    // it navigates in-place. When opened as a standalone tab, fw_origin was
    // supplied in the launch URL so we can open a fresh FW tab from here.
    const suffix = mode === PROJECT_MODES.EXISTING ? 'view' : 'draft';
    const path = `/custom/cost-tracking/projects/${openTarget}/${suffix}`;
    const inIframe = window.parent && window.parent !== window;
    if (inIframe) {
      postToFactwiseParent('NAVIGATE', { url: path });
      return;
    }
    if (fwOrigin) {
      window.open(fwOrigin + path, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback — no origin passed. Best effort: same-tab navigation.
      window.location.href = path;
    }
  }, [openTarget, mode, fwOrigin]);

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
              options={projectChoices}
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
                  <FormControl disabled={configFrozen} component="fieldset" variant="standard">
                    <FormGroup>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={reviseTargetKeys.length === 0}
                            // Only ever turned ON here. Unticking it would have
                            // to mean "revise something" without saying what,
                            // so it clears when a slot below is ticked instead.
                            onChange={() => setReviseTargetKeys([])}
                          />
                        }
                        label={
                          <Typography variant="body2">
                            <strong>Create new BOM</strong> in this project
                          </Typography>
                        }
                      />
                      {revisableBoms.length === 0 ? (
                        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 4 }}>
                          {projectBoms.length
                            ? 'No BOM in this project shares a base BOM with the one being revised.'
                            : 'Project has no BOMs yet.'}
                        </Typography>
                      ) : (
                        revisableBoms.map((b) => {
                          const bomModuleId = b.bom_module_id || b.module_id || b.id;
                          const enterpriseBomId = b.enterprise_bom_id || b.base_bom_id;
                          const label = [b.bom_code, b.bom_name].filter(Boolean).join(' — ') || bomModuleId;
                          const key = `${bomModuleId}::${enterpriseBomId}::${b.bom_code || ''}`;
                          return (
                            <FormControlLabel
                              key={key}
                              disabled={!bomModuleId || !enterpriseBomId}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={reviseTargetKeys.includes(key)}
                                  onChange={() => toggleReviseTarget(key)}
                                />
                              }
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
                    </FormGroup>
                  </FormControl>
                )}
                <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                  {reviseTargetKeys.length > 1
                    ? `Revising creates one new revision in the BOM directory and repoints all ${reviseTargetKeys.length} selected slots to it, one at a time. A failure partway leaves the earlier ones moved.`
                    : 'Revising creates a new revision in the BOM directory and repoints this project\'s BOM to it. Both places are updated.'}
                  {lockedBaseBomId && projectBoms.length > revisableBoms.length
                    ? ' Only BOMs that are revisions of the same BOM are listed — FactWise rejects anything else.'
                    : ''}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          {phaseLabel(phase, Boolean(reviseEnterpriseBomId))
            || (modeDraft === PROJECT_MODES.NEW
              ? 'Click "Start export" to send items, BOM, and create the project.'
              : reviseTargetKeys.length
                ? `Click "Start export" to send items and revise ${reviseTargetKeys.length === 1 ? 'the picked BOM' : `the ${reviseTargetKeys.length} picked BOMs`} inside this project.`
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
            sessionId={sessionId}
            onHostRowsUpdated={refreshHost}
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
