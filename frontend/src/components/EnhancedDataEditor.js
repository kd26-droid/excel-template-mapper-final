// EnhancedDataEditor.js - DataEditor with comprehensive synchronization
// Fixes all refresh issues on Azure deployment

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Tooltip,
  Card,
  CardContent,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Container,
  LinearProgress,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  FormControlLabel,
  Radio,
  RadioGroup,
  FormLabel,
  Divider,
  Grid,
  Autocomplete,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  Tabs,
  Tab
} from '@mui/material';
import { Pagination } from '@mui/material';
import {
  Save as SaveIcon,
  Download as DownloadIcon,
  UploadFile as UploadFileIcon,
  ImportExport as ImportExportIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HelpOutline as HelpOutlineIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  ArrowBack as ArrowBackIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as ContentCopyIcon,
  EditNote as EditNoteIcon,
  Badge as BadgeIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  DeleteSweep as DeleteSweepIcon,
  FolderOpen as FolderOpenIcon,
  AccountTree as AccountTreeIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  FilterAlt as FilterAltIcon,
  Clear as ClearIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  MoreVert as MoreVertIcon,
  Build as BuildIcon,
  VerifiedUser as VerifiedUserIcon,
  ContentCut as ContentCutIcon,
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon
} from '@mui/icons-material';
import api from '../services/api';
import { uploadFileToFactwiseBulkImport } from '../services/factwiseApi';
import { useFactwise, postToFactwiseParent, openInFactwise } from '../contexts/FactwiseContext';
import FactwiseProjectExportDialog from './FactwiseProjectExportDialog';
import FactwiseBomDirectoryExportDialog from './FactwiseBomDirectoryExportDialog';
import * as XLSX from 'xlsx';
import BomTreePreview from './BomTreePreview';
import ColumnParser from './ColumnParser/ColumnParser';
import { LoaderCard } from './LoaderOverlay';
import { getDataSynchronizer, cleanupSynchronizer } from '../utils/DataSynchronizer';
import { useThemeContext } from '../utils/ThemeContext';
import { readItemDirectoryDefaults, writeItemDirectoryColumnOptions } from '../utils/itemDirectoryDefaults';
import { displayHeaderName } from '../utils/columnHeaderNames';

// Keep the arrangement-specific row expansion implementation dormant while a
// generic, user-configured row expansion model is designed.
const ENABLE_LEGACY_EXPAND_ROWS = true;

// The manufacturer groups a review row currently represents: either the manually
// typed override, or the word tokens joined at the un-cut boundaries.
const reviewRowGroups = (rr) => {
  if (!rr) return [];
  if (rr.manual != null) return String(rr.manual).split('|').map((s) => s.trim()).filter(Boolean);
  const tokens = rr.tokens || [];
  if (!tokens.length) return [];
  const groups = [];
  let cur = [tokens[0]];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (rr.cuts[i]) { groups.push(cur.join(' ')); cur = [tokens[i + 1]]; }
    else cur.push(tokens[i + 1]);
  }
  groups.push(cur.join(' '));
  return groups;
};

// Assistant-style "analyzing" lines shown briefly before the Smart Expand plan.
const SMART_EXPAND_STEPS = [
  'Reading your columns…',
  'Detecting how the alternates are arranged…',
  'Checking for catalog / vendor prefixes…',
  'Preparing a plan…',
];

const COLUMN_PROVIDER_MAPPINGS_KEY = 'mpn_column_provider_mappings';
const PROVIDER_LABELS = {
  digikey: 'DigiKey',
  mouser: 'Mouser',
  element14: 'Element14'
};
// Validation always runs against all three providers (see ALL_VALIDATION_PROVIDERS
// in services/api.js), so all three are shown by default. Anything narrower hides
// columns that were fetched, written to the sheet, and paid for.
//
// KEEP IN SYNC with `initialColumnMappings` in pages/Settings.js. These two lists
// are the same configuration held in two places, and they had already drifted —
// Settings defaulted to all three while this defaulted to DigiKey alone, so the
// Settings screen showed every provider ticked while the grid rendered one.
const ALL_VALIDATION_PROVIDERS = ['digikey', 'mouser', 'element14'];
const DEFAULT_VALIDATION_COLUMN_MAPPINGS = [
  { column: 'MPN valid', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'MPN Status', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'EOL Status', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'Discontinued', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'DKPN', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'Canonical MPN', providers: [...ALL_VALIDATION_PROVIDERS] },
  { column: 'Category', providers: [...ALL_VALIDATION_PROVIDERS] },
];
const VALIDATION_PROVIDER_COLUMN_MAP = {
  'MPN valid': {
    digikey: 'MPN valid (DigiKey)',
    mouser: 'MPN valid (Mouser)',
    element14: 'MPN valid (Element14)',
  },
  'MPN Status': {
    digikey: 'DigiKey Status',
    mouser: 'Mouser Status',
    element14: 'Element14 Status',
  },
  'EOL Status': {
    digikey: 'DigiKey EOL Status',
    mouser: 'Mouser Status',
    element14: 'Element14 Status',
  },
  'Discontinued': {
    digikey: 'DigiKey Discontinued',
    mouser: 'Mouser Status',
    element14: 'Element14 Status',
  },
  'DKPN': {
    digikey: 'DigiKey Part Number',
    mouser: 'MPNR',
    element14: 'Element14 Part Number',
  },
  'Canonical MPN': {
    digikey: 'DigiKey Canonical MPN',
    mouser: 'Mouser Canonical MPN',
    element14: 'Element14 Canonical MPN',
  },
  'Category': {
    digikey: 'DigiKey Category',
    mouser: 'Mouser Category',
    element14: 'Element14 Category',
  },
};

const normalizeValidationProviders = (providers, fallback = []) => {
  const allowed = new Set(Object.keys(PROVIDER_LABELS));
  const raw = Array.isArray(providers) ? providers : (providers ? [providers] : fallback);
  const selected = raw.map(provider => String(provider || '').toLowerCase()).filter(provider => allowed.has(provider));
  return selected.length ? Array.from(new Set(selected)) : fallback;
};

const getColumnProviderMappingsFromStorage = () => {
  if (typeof window === 'undefined') return DEFAULT_VALIDATION_COLUMN_MAPPINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(COLUMN_PROVIDER_MAPPINGS_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_VALIDATION_COLUMN_MAPPINGS;
    const savedByColumn = new Map(saved.map(mapping => [mapping.column, mapping]));
    return DEFAULT_VALIDATION_COLUMN_MAPPINGS.map(mapping => {
      const savedMapping = savedByColumn.get(mapping.column);
      return {
        column: mapping.column,
        providers: normalizeValidationProviders(savedMapping?.providers || savedMapping?.provider, mapping.providers)
      };
    });
  } catch (_) {
    return DEFAULT_VALIDATION_COLUMN_MAPPINGS;
  }
};

const getConfiguredMpnValidationColumns = () => {
  const selectedColumns = [];
  const labelsByField = {};
  const seen = new Set();
  getColumnProviderMappingsFromStorage().forEach(mapping => {
    const providerColumns = VALIDATION_PROVIDER_COLUMN_MAP[mapping.column] || {};
    normalizeValidationProviders(mapping.providers).forEach(provider => {
      const field = providerColumns[provider];
      if (!field || seen.has(field)) return;
      seen.add(field);
      selectedColumns.push(field);
      labelsByField[field] = `${mapping.column} (By ${PROVIDER_LABELS[provider]})`;
    });
  });
  return { selectedColumns, labelsByField };
};

const exportRingLoaderStyles = `
  .fw-export-ring {
    width: 3.25em;
    height: 3.25em;
    transform-origin: center;
    animation: fw-export-rotate 2s linear infinite;
  }
  .fw-export-ring circle {
    fill: none;
    stroke: hsl(214, 97%, 59%);
    stroke-width: 2;
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
    stroke-linecap: round;
    animation: fw-export-dash 1.5s ease-in-out infinite;
  }
  @keyframes fw-export-rotate {
    100% { transform: rotate(360deg); }
  }
  @keyframes fw-export-dash {
    0% { stroke-dasharray: 1, 200; stroke-dashoffset: 0; }
    50% { stroke-dasharray: 90, 200; stroke-dashoffset: -35px; }
    100% { stroke-dashoffset: -125px; }
  }
`;

const ExportLoadingContent = ({ title, message, isDarkMode = false }) => (
  <Box sx={{
    px: 4,
    py: 6,
    textAlign: 'center',
    bgcolor: isDarkMode ? '#0f172a' : '#ffffff',
    color: isDarkMode ? '#e2e8f0' : '#0f172a'
  }}>
    <style>{exportRingLoaderStyles}</style>
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
      <svg className="fw-export-ring" viewBox="25 25 50 50" aria-hidden="true">
        <circle r={20} cy={50} cx={50} />
      </svg>
    </Box>
    <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 680, color: isDarkMode ? '#f8fafc' : '#0f172a', letterSpacing: 0, mb: 0.75 }}>
      {title}
    </Typography>
    <Typography sx={{ fontSize: 14, lineHeight: 1.5, fontWeight: 400, color: isDarkMode ? '#94a3b8' : '#64748b', letterSpacing: 0 }}>
      {message}
    </Typography>
  </Box>
);

const createConditionalBranch = () => ({
  column: '',
  operator: 'contains',
  // Several values matched as "any of these". A list rather than a
  // comma-separated string because component text is full of commas
  // ("CAPACITOR 0.22U, 10V", "CAP; 0,1uF") — splitting one would quietly
  // match far more rows than intended.
  compare: '',
  compareValues: [],
  outputType: 'default',
  outputValue: '',
  outputColumn: '',
});

// Turn an internal column name into the header shown in the grid.
// Known template groups collapse to a single label (Tag_1..N -> "Tag"), and any
// other split-generated run (e.g. "Reference Designator_1".."_33") collapses to
// its shared base so the whole run reads as one column name in-place, instead of
// showing the numeric suffix on every column.
const deriveDisplayName = (col, allHeaders = []) => {
  if (/^MPN_\d+_DigiKey_Valid$/.test(col)) return col.replace(/^MPN_(\d+)_DigiKey_Valid$/, 'MPN $1 — DigiKey Valid');
  if (/^MPN_\d+_Canonical$/.test(col)) return col.replace(/^MPN_(\d+)_Canonical$/, 'MPN $1 — Canonical');
  const hasLegacyDigikeyValidation = Array.isArray(allHeaders) && allHeaders.some((header) => [
    'MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'Canonical MPN'
  ].includes(header));
  const legacyDigikeyNames = {
    'MPN valid': 'MPN valid (DigiKey)',
    'MPN Status': 'DigiKey Status',
    'EOL Status': 'DigiKey EOL Status',
    'Discontinued': 'DigiKey Discontinued',
    'DKPN': 'DigiKey Part Number',
    'Canonical MPN': 'DigiKey Canonical MPN'
  };
  if (hasLegacyDigikeyValidation) {
    legacyDigikeyNames.Category = 'DigiKey Category';
  }
  if (legacyDigikeyNames[col]) return legacyDigikeyNames[col];
  const legacyCanonical = String(col).match(/^Canonical MPN (\d+)$/);
  if (legacyCanonical) return `DigiKey Canonical MPN ${legacyCanonical[1]}`;
  // Repeated template groups (Tag, Specification, Custom identification) and
  // generic split runs keep their slot number in the label — three columns all
  // reading "Tag" gave the user no way to tell which one they were editing.
  // The number is display-only: exports go out under canonicalHeaderName.
  return displayHeaderName(col, allHeaders);
};

// A part is checked against three sources (DigiKey, Mouser, Element14), each
// writing 'Yes', 'No', or blank when that source was never looked up.
//
// One source confirming the part is enough to call it valid — the others simply
// may not stock it, which is not evidence the part is wrong. Only when no source
// confirms it and at least one rejects it is the row invalid. If nobody has an
// opinion, it is unknown rather than a silent pass.
const MPN_VALID_COLUMNS = ['MPN valid (DigiKey)', 'MPN valid', 'MPN valid (Mouser)', 'MPN valid (Element14)'];

// 'valid'   — at least one source found the part.
// 'invalid' — at least one source answered, and every answer was "not found".
// 'unknown' — the row has a part number, but nothing has checked it.
// 'missing' — the MPN cell is empty, so there is nothing to check.
//
// A source only ever writes 'Yes'/'No' after an actual lookup, so a blank means
// "not checked", never "checked and inconclusive". That leaves the no-answer
// rows, which split on whether the row has a part number waiting to be checked
// (someone should run validation) or no part number at all (someone has to go
// find it) — two different follow-ups, so two different buckets.
// Filter menu selection -> the row status it keeps. 'all' is absent on purpose:
// anything not in here skips MPN filtering entirely.
const MPN_ROW_FILTER_STATUS = {
  valid_mpn: 'valid',
  invalid_mpn: 'invalid',
  unknown: 'unknown',
  missing_mpn: 'missing',
};

const getMpnRowStatus = (row, mpnField) => {
  const values = MPN_VALID_COLUMNS
    .map(column => String(row?.[column] ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (values.includes('yes')) return 'valid';
  if (values.includes('no')) return 'invalid';
  // Without a known MPN column we cannot tell the two apart, so keep every
  // unchecked row in 'unknown' rather than mislabel it as missing.
  if (mpnField && !String(row?.[mpnField] ?? '').trim()) return 'missing';
  return 'unknown';
};

// The editor pulls the entire sheet in one request so that search, the column
// filters and paging all work against every row. Mirrors MAX_DATA_PAGE_SIZE in
// the backend's data_view, which clamps anything larger.
const ALL_ROWS_PAGE_SIZE = 200000;

// Header cells are pinned to a fixed height so the column-filter row underneath
// can stick at a known offset instead of guessing at the header's rendered size.
const HEADER_ROW_HEIGHT = 44;
const ITEM_CODE_SEPARATOR_FROM_MODE = {
  none: '',
  space: ' ',
  hyphen: '-',
  spaced_hyphen: ' - ',
  underscore: '_',
  slash: '/',
  pipe: '|',
  comma: ',',
};

const EnhancedDataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
  const { isEmbedded: isFactwiseEmbedded, entityName: factwiseEntityName } = useFactwise();
  const synchronizer = useRef(null);
  const scrollContainerRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const processingTemplateContext = useMemo(() => {
    if (location.state?.uploadSource) return location.state.uploadSource;
    try {
      const raw = sessionStorage.getItem(`processingTemplateContext_${sessionId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }, [location.state, sessionId]);
  const processingTemplateMode = processingTemplateContext?.processingTemplateMode || '';
  const processingTemplateName = String(processingTemplateContext?.processingTemplateName || '').trim();
  const isExistingProcessingTemplate = processingTemplateMode === 'use' || Boolean(processingTemplateContext?.selectedProcessingTemplateId);
  const isNewProcessingTemplate = processingTemplateMode === 'new' && Boolean(processingTemplateName);

  useEffect(() => {
    if (!location.state?.mappingBackState) return;
    try {
      sessionStorage.setItem(`editorBackState_${sessionId}`, JSON.stringify(location.state.mappingBackState));
    } catch (_) {}
  }, [location.state, sessionId]);

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ inProgress: false, operation: null });
  const [syncProgress, setSyncProgress] = useState(0);
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [rowSearchTerm, setRowSearchTerm] = useState('');
  const [columnWidths, setColumnWidths] = useState({});
  const [autoFitApplied, setAutoFitApplied] = useState(false);
  const resizingRef = useRef({ active: false, field: null, startX: 0, startWidth: 0 });
  const [totalRows, setTotalRows] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [syncNotice, setSyncNotice] = useState({ visible: false, message: 'Showing recent data while syncing latest changes…' });
  const staleGuardRef = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [firstNonEmptyRowData, setFirstNonEmptyRowData] = useState(null);

  // Virtualization state (large dataset optimization)
  const [rowHeight] = useState(40);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });

  // Data integrity tracking
  const [dataIntegrity, setDataIntegrity] = useState({
    consistent: true,
    lastValidated: null,
    issues: []
  });

  // Unmapped columns state
  const [unmappedColumns, setUnmappedColumns] = useState([]);
  const [mappedColumns, setMappedColumns] = useState([]);
  const [unmappedDialogOpen, setUnmappedDialogOpen] = useState(false);

  // Data quality state
  const [qualityMetrics, setQualityMetrics] = useState(null);
  const [headerConfidenceScores, setHeaderConfidenceScores] = useState({});
  const [columnConfidenceScores, setColumnConfidenceScores] = useState({});
  const [isFromPdf, setIsFromPdf] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(true);

  // Data correction upload state
  const [correctionUploadDialogOpen, setCorrectionUploadDialogOpen] = useState(false);
  const [correctionFile, setCorrectionFile] = useState(null);
  const [correctionUploading, setCorrectionUploading] = useState(false);
  const [correctionPreview, setCorrectionPreview] = useState(null);

  // Template saving state
  const [templateSaveDialogOpen, setTemplateSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Template selection for applying existing templates
  const [templateChooseDialogOpen, setTemplateChooseDialogOpen] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [rebuildingColumns, setRebuildingColumns] = useState(false);

  // Unknown values state
  const [unknownCellsCount, setUnknownCellsCount] = useState(0);
  // Pagination state. Paging is client-side over the full dataset, so totalPages
  // is derived from the filtered row count further down rather than stored.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pageLoading, setPageLoading] = useState(false);
  // Per-column filter text, keyed by column field. Empty/absent means no filter.
  const [columnFilters, setColumnFilters] = useState({});
  // Rows a BOM issue actually points at. A column filter cannot express "any of
  // these ten codes", and a duplicate-code issue carries no row numbers at all,
  // so the grid needs its own value-set filter to show them together.
  const [issueRowFilter, setIssueRowFilter] = useState(null);
  const [showColumnFilters, setShowColumnFilters] = useState(false);

  // Formula Builder state
  const [createColumnDialogOpen, setCreateColumnDialogOpen] = useState(false);
  const [createColumnTab, setCreateColumnTab] = useState(0);
  const [createColumnTarget, setCreateColumnTarget] = useState('Item name');
  const [createColumnNewName, setCreateColumnNewName] = useState('');
  const [createColumnContentType, setCreateColumnContentType] = useState('concat');
  const [createColumnFirst, setCreateColumnFirst] = useState('');
  const [createColumnSecond, setCreateColumnSecond] = useState('');
  const [createColumnSeparator, setCreateColumnSeparator] = useState(' ');
  const [createColumnSeparatorMode, setCreateColumnSeparatorMode] = useState('space');
  const [createColumnCustomSeparator, setCreateColumnCustomSeparator] = useState('');
  const [createColumnMode, setCreateColumnMode] = useState('fill_empty');
  const [createColumnSaving, setCreateColumnSaving] = useState(false);
  // Rules saved in Settings, replayable against this sheet.
  const [savedColumnRules, setSavedColumnRules] = useState([]);
  const [selectedColumnRuleId, setSelectedColumnRuleId] = useState('');
  const [hasFormulas, setHasFormulas] = useState(false);
  const [formulaColumns, setFormulaColumns] = useState([]);
  // Column examples and fill stats for FormulaBuilder dropdowns
  const rowsSample = useMemo(() => {
    const cap = 300;
    return Array.isArray(rowData) && rowData.length > cap ? rowData.slice(0, cap) : rowData;
  }, [rowData]);

  const columnExamples = useMemo(() => {
    const examples = {};
    (columnDefs || []).forEach(col => {
      if (!col.field || col.field === '__row_number__') return;
      let first = '';
      for (const row of rowsSample || []) {
        const v = row[col.field];
        if (v !== null && v !== undefined && String(v).trim() !== '' && String(v).toLowerCase() !== 'unknown') {
          first = String(v);
          break;
        }
      }
      examples[col.field] = first;
    });
    return examples;
  }, [columnDefs, rowsSample]);

  const columnFillStats = useMemo(() => {
    const stats = {};
    (columnDefs || []).forEach(col => {
      if (!col.field || col.field === '__row_number__') return;
      let nonEmpty = 0;
      const total = (rowsSample || []).length;
      for (const row of rowsSample || []) {
        const v = row[col.field];
        if (v !== null && v !== undefined && String(v).trim() !== '' && String(v).toLowerCase() !== 'unknown') {
          nonEmpty++;
        }
      }
      if (total === 0 || nonEmpty === 0) stats[col.field] = 'empty';
      else if (nonEmpty < total * 0.8) stats[col.field] = 'partial';
      else stats[col.field] = 'full';
    });
    return stats;
  }, [columnDefs, rowsSample]);
  const [appliedFormulas, setAppliedFormulas] = useState([]);
  const [defaultValues, setDefaultValues] = useState({});

  // Export to Project state
  const [exportProjectDialogOpen, setExportProjectDialogOpen] = useState(false);
  const [exportProjectMode, setExportProjectMode] = useState('NEW'); // 'NEW' or 'EXISTING'
  const [exportProjectName, setExportProjectName] = useState('');
  const [exportProjectLoading, setExportProjectLoading] = useState(false);
  const [selectedExistingProject, setSelectedExistingProject] = useState(null);
  const [exportProjectSuccess, setExportProjectSuccess] = useState(false);
  const [factwiseExportDialogOpen, setFactwiseExportDialogOpen] = useState(false);
  const [factwisePreviewOpen, setFactwisePreviewOpen] = useState(false);
  const [factwisePreviewType, setFactwisePreviewType] = useState('item');
  // BOM-specific validation, kept separate from the item required-field guard.
  const [bomValidationOpen, setBomValidationOpen] = useState(false);
  const [bomValidationIssues, setBomValidationIssues] = useState([]);
  const [bomValidationWarnings, setBomValidationWarnings] = useState([]);
  const [factwisePreviewDownloading, setFactwisePreviewDownloading] = useState('');
  const [directoryExportStatus, setDirectoryExportStatus] = useState({
    open: false,
    type: 'item',
    phase: 'idle'
  });
  const [factwisePreviewFullscreen, setFactwisePreviewFullscreen] = useState(false);

  // Mock existing projects
  const existingProjects = useMemo(() => [
    { project_id: 'P000328', project_code: 'P000328', project_name: 'DXN-PRJ-100', status: 'ONGOING' },
    { project_id: 'P000326', project_code: 'P000326', project_name: 'DXN-BC-001', status: 'ONGOING' },
    { project_id: 'P000325', project_code: 'P000325', project_name: 'DXN-ETQ-001', status: 'ONGOING' },
    { project_id: 'P000324', project_code: 'P000324', project_name: 'DXN-ELEC-100', status: 'ONGOING' },
  ], []);

  // Create Factwise ID state
  const [factwiseIdDialogOpen, setFactwiseIdDialogOpen] = useState(false);
  const [factwiseStrategyDialogOpen, setFactwiseStrategyDialogOpen] = useState(false);
  const [firstColumn, setFirstColumn] = useState('');
  const [secondColumn, setSecondColumn] = useState('');
  const [operator, setOperator] = useState('_');
  const [factwiseGenerationMode, setFactwiseGenerationMode] = useState('columns');
  const [factwiseSerialPrefix, setFactwiseSerialPrefix] = useState('ITEM');
  const [factwiseSerialStart, setFactwiseSerialStart] = useState(1);
  const [factwiseSerialPadding, setFactwiseSerialPadding] = useState(2);
  const [factwiseSerialIncrement, setFactwiseSerialIncrement] = useState(true);
  
  // Store factwise ID rule for template saving
  const [factwiseIdRule, setFactwiseIdRule] = useState(null);
  const [postMappingActions, setPostMappingActions] = useState([]);
  const replayedProcessingTemplateRef = useRef('');
  
  // Column counts for template integration
  const [dynamicColumnCounts, setDynamicColumnCounts] = useState({
    tags_count: 1,
    spec_pairs_count: 1,
    customer_id_pairs_count: 1
  });

  // Cleanup info banner state
  const [cleanupInfo, setCleanupInfo] = useState(null);
  const [showDeletedRows, setShowDeletedRows] = useState(false);

  // Toolbar dropdown menu anchors
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState(null);
  const [mpnMenuAnchor, setMpnMenuAnchor] = useState(null);
  const [rowFilterMenuAnchor, setRowFilterMenuAnchor] = useState(null);
  const [rowFilterMode, setRowFilterMode] = useState('all');
  const [moreMenuAnchor, setMoreMenuAnchor] = useState(null);

  // Parser MPN validation state
  const [hasParserMpnColumns, setHasParserMpnColumns] = useState(false);
  const [parserMpnValidating, setParserMpnValidating] = useState(false);
  const [parserMpnValidationCompleted, setParserMpnValidationCompleted] = useState(false);

  // MPN validation UI state
  const [mpnColumn, setMpnColumn] = useState(null);
  const [originalMpnColumn, setOriginalMpnColumn] = useState(null); // Store original source column for template saving
  const [mpnManufacturerColumn, setMpnManufacturerColumn] = useState(null);
  const [mpnValidating, setMpnValidating] = useState(false);
  const [mpnProgress, setMpnProgress] = useState(null); // { done, total } while chunk-warming
  // Completion summary shown after MPN validation finishes.
  const [mpnSummary, setMpnSummary] = useState(null); // { validated, total, failed }
  const [mpnSummaryOpen, setMpnSummaryOpen] = useState(false);
  // Import an edited export back into THIS session, so mappings, tags and MPN
  // validation stay attached instead of a re-upload creating a new session.
  const [importing, setImporting] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [exportImportOpen, setExportImportOpen] = useState(false);
  const [moreActionsAnchor, setMoreActionsAnchor] = useState(null);
  // Save-template errors belong in the dialog, next to the field the user
  // has to change — a corner toast is easy to miss and disappears.
  const [templateNameError, setTemplateNameError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const importFileInputRef = useRef(null);
  const mpnValidationInFlightRef = useRef(false);
  const [mpnValidationCompleted, setMpnValidationCompleted] = useState(false);
  const [mpnFilterInvalidOnly, setMpnFilterInvalidOnly] = useState(false);
  const [showMpnColumns, setShowMpnColumns] = useState(true);
  const [mpnSplitting, setMpnSplitting] = useState(false);
  const [mpnSplitDialogOpen, setMpnSplitDialogOpen] = useState(false);
  const [manufacturerMatchDialogOpen, setManufacturerMatchDialogOpen] = useState(false);
  const [producerParseDialogOpen, setProducerParseDialogOpen] = useState(false);
  const [producerColumn, setProducerColumn] = useState(null);
  // Producer parse can write the extracted MPN / manufacturer into MORE THAN ONE
  // destination column each, so these hold arrays of chosen columns.
  const [producerMpnCols, setProducerMpnCols] = useState([]);
  const [producerMfrCols, setProducerMfrCols] = useState([]);
  const [manufacturerRulesExpanded, setManufacturerRulesExpanded] = useState(false);
  const [mpnSplitOptions, setMpnSplitOptions] = useState({
    stripAlphaPrefix: true,
    alphaPrefixMinLength: 5,
    stripNumericPrefix: true,
    numericPrefixLength: 5,
    extraPrefixes: 'AGILE',
    manufacturerAliases: 'NIC=NIC COMPONENTS\nCOMPONENTS=',
    manufacturerDiscardTokens: 'COMPONENT\nCOMPONENTS'
  });
  const [manufacturerDirectory, setManufacturerDirectory] = useState({
    fileName: '',
    workbook: null,
    sheetNames: [],
    sheetName: '',
    headerRow: 1,
    headers: [],
    nameColumn: '',
    synonymColumns: []
  });

  // "Split into columns": one delimited cell ("C3, C4, C5") becomes a numbered
  // run of columns (Tag_1, Tag_2, Tag_3). The widest row sets the column count.
  const [splitColsRunning, setSplitColsRunning] = useState(false);
  const [splitColsDialogOpen, setSplitColsDialogOpen] = useState(false);
  const [splitRowsRunning, setSplitRowsRunning] = useState(false);
  const [splitRowsDialogOpen, setSplitRowsDialogOpen] = useState(false);
  const [splitRowsPreview, setSplitRowsPreview] = useState(null);
  const [splitRowsPreviewLoading, setSplitRowsPreviewLoading] = useState(false);
  const [splitRowsError, setSplitRowsError] = useState('');
  const [splitRowsConfig, setSplitRowsConfig] = useState({
    sourceColumn: '',
    delimiter: 'comma',
    customDelimiter: '',
    copyColumnIndices: []
  });
  // Unified "Expand Alternates into Rows" entry point — a small arrangement
  // chooser that routes to the proven per-shape dialogs (Manufacturer Match,
  // MPN Split, Parse Producer) instead of a fourth reimplementation.
  const [alternatesChooserOpen, setAlternatesChooserOpen] = useState(false);
  // "Separate columns per alternate" arrangement — reads unmapped alternate
  // source columns and expands the current grid (composes).
  const [altColsDialogOpen, setAltColsDialogOpen] = useState(false);
  const [altColsSourceColumns, setAltColsSourceColumns] = useState([]);
  const [altColsSourceSamples, setAltColsSourceSamples] = useState({});
  const [altColsPairs, setAltColsPairs] = useState([]);
  const [altColsRunning, setAltColsRunning] = useState(false);
  // Per-column mapped source / default, to annotate dropdowns so duplicate-named
  // columns (Tag_1..N, Specification value…) are distinguishable.
  const [columnSourceMap, setColumnSourceMap] = useState({ sources: {}, defaults: {} });
  // Per-arrangement detection from the user's OWN data (real column names +
  // sample cell values), so the chooser cards show their sheet, not made-up text.
  const [alternatesDetection, setAlternatesDetection] = useState({});
  // Unified "Smart Expand": one entry point that inspects the columns, shows an
  // assistant-style analysis, then applies the right transform in one click.
  const [smartExpandOpen, setSmartExpandOpen] = useState(false);
  const [smartPhase, setSmartPhase] = useState('analyzing'); // 'analyzing' | 'plan' | 'applying'
  const [smartStepIndex, setSmartStepIndex] = useState(0);
  const [smartPlan, setSmartPlan] = useState(null);
  // User-adjustable columns for Smart Expand (pre-filled from detection, but the
  // user can override — e.g. point it at the Manufacturer column to force pairing).
  const [smartMpnCol, setSmartMpnCol] = useState('');
  const [smartMfrCol, setSmartMfrCol] = useState('');
  // Illusion-only: lets the user "set up" how each cell is split around the colon.
  // Purely cosmetic — the actual parse always reads manufacturer-before-colon,
  // part-after-colon (see backend mpn_parse_producer_column). 'mfr' | 'mpn'.
  const [labelledBefore, setLabelledBefore] = useState('mfr');
  const [labelledStrip, setLabelledStrip] = useState(true);
  // Review screen for rows where the manufacturer split doesn't match the MPN count.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState([]); // [{row, mpnCount, mpns, mfrRaw, tokens, cuts:bool[], manual:string|null}]
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMpnCol, setReviewMpnCol] = useState('');
  const [reviewMfrCol, setReviewMfrCol] = useState('');
  // Copy-a-column and set-default-value tools
  const [copyColOpen, setCopyColOpen] = useState(false);
  const [copySource, setCopySource] = useState('');
  const [copyTarget, setCopyTarget] = useState('');
  const [copyOnlyEmpty, setCopyOnlyEmpty] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [defaultColOpen, setDefaultColOpen] = useState(false);
  const [defaultCol, setDefaultCol] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [defaultOnlyEmpty, setDefaultOnlyEmpty] = useState(true);
  // Conditional default value: fill based on another column's value.
  const [defaultMode, setDefaultMode] = useState('always'); // 'always' | 'conditional'
  const [condCol, setCondCol] = useState('');
  const [condOp, setCondOp] = useState('is_empty'); // is_empty|not_empty|equals|not_equals|contains
  const [condCompare, setCondCompare] = useState('');
  const [condThen, setCondThen] = useState('');
  const [condElse, setCondElse] = useState('');
  const [condThenSourceType, setCondThenSourceType] = useState('default');
  const [condThenColumn, setCondThenColumn] = useState('');
  const [condElseSourceType, setCondElseSourceType] = useState('default');
  const [condElseColumn, setCondElseColumn] = useState('');
  const [conditionalBranches, setConditionalBranches] = useState([createConditionalBranch()]);
  // Index of the condition whose value field has focus. The multi-value hint
  // rides on the placeholder rather than helper text, so showing it cannot
  // change the field's height and knock the row out of alignment.
  const [focusedConditionIndex, setFocusedConditionIndex] = useState(null);
  const [defaultBusy, setDefaultBusy] = useState(false);
  // User-driven cleanup: choose a column, choose blanks or exact values, then
  // choose how those cells should be replaced.
  const [fillMissingOpen, setFillMissingOpen] = useState(false);
  const [fillMissingColumn, setFillMissingColumn] = useState('');
  const [fillMissingMode, setFillMissingMode] = useState('');
  const [fillMissingStrategy, setFillMissingStrategy] = useState('');
  const [fillMissingDefault, setFillMissingDefault] = useState('');
  const [fillMissingBusy, setFillMissingBusy] = useState(false);
  const [fillMissingAnalysis, setFillMissingAnalysis] = useState(null);
  const [fillMissingAnalysisLoading, setFillMissingAnalysisLoading] = useState(false);
  const [fillMissingAnalysisError, setFillMissingAnalysisError] = useState('');
  const [fillMissingSelectedValues, setFillMissingSelectedValues] = useState([]);
  const fillMissingAnalysisSeqRef = useRef(0);
  const fillMissingReturnToGuardRef = useRef(false);
  // Conditional delete-rows tool
  const [deleteRowsOpen, setDeleteRowsOpen] = useState(false);
  const [delCol, setDelCol] = useState('');
  const [delOp, setDelOp] = useState('is_empty'); // is_empty|not_empty|equals|not_equals|contains
  const [delCompare, setDelCompare] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  // Export BOM preview → "Export Sheet" (hardcoded download) or "Export to FactWise" (mock).
  const [exportBomOpen, setExportBomOpen] = useState(false);
  const [exportBomBusy, setExportBomBusy] = useState(false);
  const [exportBomFullscreen, setExportBomFullscreen] = useState(false);
  const [splitColsPreview, setSplitColsPreview] = useState(null);
  const [splitColsPreviewLoading, setSplitColsPreviewLoading] = useState(false);
  const [splitColsError, setSplitColsError] = useState('');
  const [splitColsTab, setSplitColsTab] = useState(0);
  const [splitColsConfig, setSplitColsConfig] = useState({
    sourceColumn: '',
    destinationPrefix: '',
    splitMode: 'delimiter',
    delimiter: 'comma',
    customDelimiter: '',
    chunkSize: 3,
    trim: true,
    dropEmpty: true,
    maxColumns: '',
    onOverflow: 'review',
    keepSourceColumn: false,
    overwriteExisting: false
  });

  // FactWise required-field guard on export
  const [requiredDialogOpen, setRequiredDialogOpen] = useState(false);
  const [requiredGaps, setRequiredGaps] = useState([]);
  const [requiredFilling, setRequiredFilling] = useState(false);
  const [requiredQuickFillKey, setRequiredQuickFillKey] = useState('');
  const [requiredInlineDefaults, setRequiredInlineDefaults] = useState({});
  const pendingExportRef = useRef(null);
  const returnToRequiredGuardRef = useRef(false);
  const requiredGuardRunnerRef = useRef(null);
  const itemDirectoryDefaultsAppliedRef = useRef({});
  // Item code gets special export handling: it must be filled AND unique. This
  // holds the detected blanks/duplicates so export can stop before FactWise rejects it.
  const [itemCodeIssue, setItemCodeIssue] = useState(null); // { field, blanks, dupRows, dupValues }
  // Half-filled specification / customer-identification groups. Advisory only —
  // nothing is cleared and the export is not blocked.
  const [groupWarnings, setGroupWarnings] = useState([]);
  // "Highlight duplicates so I can edit them" — the column + the set of repeated
  // values whose cells the grid should mark. Cleared with the banner's Clear button.
  // { field, values: Set<string>, rows?: Set<number>, label?: string }
  // Values highlight duplicate cells; rows highlight the lines a BOM issue
  // names, which is the only thing that works when the offending cell is blank.
  const [dupHighlight, setDupHighlight] = useState(null);

  // Helper function to identify MPN validation columns
  const isMpnValidationColumn = useCallback((columnName) => {
    // DigiKey columns
    const digikeyColumns = [
      'MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued',
      'DigiKey Part Number', 'DigiKey Category', 'DigiKey Canonical MPN',
      // Legacy DigiKey column names from older sessions.
      'MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'Category', 'Canonical MPN'
    ];
    // Mouser columns
    const mouserColumns = ['MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category'];
    const element14Columns = [
      'MPN valid (Element14)', 'Element14 Status', 'Element14 Part Number',
      'Element14 Canonical MPN', 'Element14 Category'
    ];

    return digikeyColumns.includes(columnName) ||
           mouserColumns.includes(columnName) ||
           element14Columns.includes(columnName) ||
           columnName === 'Canonical MPN' ||
           /^Canonical MPN \d+$/.test(columnName) ||
           /^DigiKey Canonical MPN \d+$/.test(columnName) ||
           /^MPN_\d+_DigiKey_(Valid|Canonical|PN)$/.test(columnName);
  }, []);

  // Filter columns based on MPN visibility toggle
  const getVisibleColumnDefs = useCallback(() => {
    if (!columnDefs || !Array.isArray(columnDefs)) return [];

    const { selectedColumns, labelsByField } = getConfiguredMpnValidationColumns();
    const selectedValidationSet = new Set(selectedColumns);
    const rowNumberColumns = [];
    const normalColumns = [];
    const selectedValidationColumns = [];

    columnDefs.forEach(col => {
      // Always show row number column
      if (col.field === '__row_number__') {
        rowNumberColumns.push(col);
        return;
      }

      // Filter MPN columns based on toggle - check both field and headerName
      if (isMpnValidationColumn(col.field) || isMpnValidationColumn(col.headerName)) {
        if (showMpnColumns && selectedValidationSet.has(col.field)) {
          selectedValidationColumns.push({
            ...col,
            headerName: labelsByField[col.field] || col.headerName
          });
        }
        return;
      }

      // Show all other columns
      normalColumns.push(col);
    });

    const byField = new Map(selectedValidationColumns.map(col => [col.field, col]));
    const orderedValidationColumns = selectedColumns
      .map(field => byField.get(field))
      .filter(Boolean);

    return [...rowNumberColumns, ...normalColumns, ...orderedValidationColumns];
  }, [columnDefs, showMpnColumns, isMpnValidationColumn]);

  const hasMpnValidationColumns = useMemo(() => {
    if (!columnDefs || !Array.isArray(columnDefs)) return false;
    return columnDefs.some(col => (
      isMpnValidationColumn(col.field) ||
      isMpnValidationColumn(col.headerName)
    ));
  }, [columnDefs, isMpnValidationColumn]);

  // Heuristic detection of MPN column from headers
  const detectMpnColumn = useCallback((headers) => {
    if (!Array.isArray(headers)) return null;
    const norm = (s) => String(s || '').toLowerCase().replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lowered = headers.map(h => norm(h));
    const strong = [/\bmpn\b/, /manufacturer\s*part\s*number/, /\bmfr\.?\s*part\s*number/, /\bmfg\.?\s*part\s*number/, /\bmpn\s*code/];
    for (const rx of strong) {
      const idx = lowered.findIndex(h => rx.test(h));
      if (idx >= 0) return headers[idx];
    }
    const weak = [/\bpart\s*number\b/, /\bpn\b/];
    for (const rx of weak) {
      const idx = lowered.findIndex(h => rx.test(h));
      if (idx >= 0) return headers[idx];
    }
    return null;
  }, []);

  // Which column holds the part number itself. The row filters need it to tell
  // "has an MPN nobody checked" from "has no MPN at all" — the validation
  // columns are blank in both cases, so they cannot answer that on their own.
  // Null while the grid is still loading, which keeps every unchecked row in
  // Unknown until we know where to look.
  const mpnSourceField = useMemo(() => {
    const fields = (columnDefs || [])
      .map(col => col.field)
      .filter(field => field && field !== '__row_number__');
    if (!fields.length) return null;
    if (mpnColumn && fields.includes(mpnColumn) && !isMpnValidationColumn(mpnColumn)) {
      return mpnColumn;
    }
    const detected = detectMpnColumn(fields);
    return detected && !isMpnValidationColumn(detected) ? detected : null;
  }, [columnDefs, mpnColumn, detectMpnColumn, isMpnValidationColumn]);

  const detectProducerColumn = useCallback((headers) => {
    if (!Array.isArray(headers)) return null;
    const norm = (s) => String(s || '').toLowerCase().replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const preferred = [/\bproducer\b/, /\bsupplier\b/, /\bvendor\b/, /\balternative\b/, /\bapproved\b.*\bmanufacturer\b/];
    const lowered = headers.map(h => norm(h));
    for (const rx of preferred) {
      const idx = lowered.findIndex(h => rx.test(h));
      if (idx >= 0) return headers[idx];
    }
    return null;
  }, []);

  const detectManufacturerColumn = useCallback((headers) => {
    if (!Array.isArray(headers)) return null;
    const norm = (s) => String(s || '').toLowerCase().replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const idx = headers.findIndex(header => {
      const lower = norm(header);
      return (lower.includes('manufacturer') && !lower.includes('part') && !lower.includes('equivalent')) ||
        ['mfr', 'mfg'].includes(lower);
    });
    return idx >= 0 ? headers[idx] : null;
  }, []);

  // MPN column tooltip meanings
  const getMpnColumnTooltip = useCallback((columnName) => {
    const mpnTooltips = {
      // DigiKey columns
      'MPN valid (DigiKey)': 'Whether this part exists in Digi-Key database (Yes/No)',
      'DigiKey Status': 'Current production status from Digi-Key: Active (good), NRND (being phased out), Obsolete (discontinued)',
      'DigiKey EOL Status': 'Digi-Key end-of-life flag: Yes (discontinued), No (still in production)',
      'DigiKey Discontinued': 'Whether Digi-Key has stopped stocking this part (Yes/No)',
      'DigiKey Part Number': 'Digi-Key part number for ordering (often ends with -ND)',
      'DigiKey Category': 'Product category from Digi-Key',
      'DigiKey Canonical MPN': 'Official manufacturer part number from Digi-Key (standardized)',
      // Legacy DigiKey columns
      'MPN valid': 'Whether this part exists in Digi-Key database (Yes/No)',
      'MPN Status': 'Current production status: Active (good), NRND (being phased out), Obsolete (discontinued)',
      'EOL Status': 'End-of-Life flag: Yes (discontinued), No (still in production)',
      'Discontinued': 'Whether Digi-Key has stopped stocking this part (Yes/No)',
      'DKPN': 'Digi-Key part number for ordering (ends with -ND)',
      'Category': 'Product category from Digi-Key',
      'Canonical MPN': 'Official manufacturer part number format (standardized)',
      // Mouser columns
      'MPN valid (Mouser)': 'Whether this part exists in Mouser database (Yes/No)',
      'Mouser Status': 'Current production status from Mouser',
      'MPNR': 'Mouser part number for ordering',
      'Mouser Canonical MPN': 'Official manufacturer part number from Mouser (standardized)',
      'Mouser Category': 'Product category from Mouser',
      // Element14 columns
      'MPN valid (Element14)': 'Whether this part exists in Element14 database (Yes/No)',
      'Element14 Status': 'Current production status from Element14',
      'Element14 Part Number': 'Element14 part number for ordering',
      'Element14 Canonical MPN': 'Official manufacturer part number from Element14 (standardized)',
      'Element14 Category': 'Product category from Element14'
    };

    // Handle numbered canonical MPN columns
    if (columnName === 'Canonical MPN' || /^Canonical MPN \d+$/.test(columnName) ||
        columnName === 'DigiKey Canonical MPN' || /^DigiKey Canonical MPN \d+$/.test(columnName)) {
      return 'Official manufacturer part number from Digi-Key (standardized) - Multiple options available';
    }

    return mpnTooltips[columnName] || null;
  }, []);

  // Data-driven scorer to auto-pick MPN column by values pattern
  const detectMpnColumnByData = useCallback((headers, rows) => {
    if (!Array.isArray(headers) || !Array.isArray(rows) || headers.length === 0 || rows.length === 0) return null;
    const clean = (v) => String(v ?? '').trim();
    const isLikelyMPN = (v) => {
      const s0 = clean(v);
      if (!s0) return false;
      const s = s0.replace(/\s+/g, '');
      if (s.length < 3 || s.length > 64) return false;
      if (/^(unknown|n\/a|null|none)$/i.test(s0)) return false;
      // Must contain letters and digits
      if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return false;
      // Allowed characters
      if (!/^[A-Za-z0-9\-_.\/]+$/.test(s)) return false;
      // Too many repeats of same char looks like filler
      if (/(.)\1{5,}/.test(s)) return false;
      return true;
    };
    const scoreHeader = (h) => {
      const idx = headers.indexOf(h);
      if (idx < 0) return 0;
      const sample = rows.slice(0, Math.min(rows.length, 300));
      let total = 0, good = 0;
      for (const r of sample) {
        const v = Array.isArray(r) ? r[idx] : r[h];
        const s = clean(v);
        if (!s) continue;
        total += 1;
        if (isLikelyMPN(s)) good += 1;
      }
      if (total === 0) return 0;
      let ratio = good / total; // 0..1
      // Header name bonus/penalty
      const name = (h || '').toLowerCase();
      if (/\bmpn\b/.test(name)) ratio += 0.25;
      else if (/manufacturer\s*part\s*number/.test(name)) ratio += 0.2;
      else if (/\bmfr|mfg\b/.test(name)) ratio += 0.1;
      if (/\bcpn\b/.test(name) || /customer\s*part/.test(name)) ratio -= 0.4; // strong penalty for CPN columns
      if (/specification\s*value/.test(name)) ratio += 0.05; // slight nudge
      if (/\btag\b/.test(name)) ratio += 0.02; // tiny nudge
      return ratio;
    };

    let best = null;
    let bestScore = 0;
    // Look at ALL columns for MPN detection, excluding only system columns
    const isCandidate = (h) => {
      const name = String(h || '');
      // Skip system columns and already validated MPN columns
      if (name === '__row_number__') return false;
      if ([
        'MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued',
        'DigiKey Part Number', 'MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN',
        'MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category',
        'MPN valid (Element14)', 'Element14 Status', 'Element14 Part Number', 'Element14 Canonical MPN', 'Element14 Category'
      ].includes(name)) return false;
      if (name === 'DigiKey Canonical MPN' || /^DigiKey Canonical MPN \d+$/.test(name) ||
          name === 'Canonical MPN' || /^Canonical MPN \d+$/.test(name)) return false;
      return true;
    };

    for (const h of headers) {
      if (!isCandidate(h)) continue;
      const s = scoreHeader(h);
      if (s > bestScore) { bestScore = s; best = h; }
    }
    // Require a modest threshold so we don't pick garbage
    if (best && bestScore >= 0.3) return best;
    return null;
  }, []);

  // ─── INITIALIZATION AND CLEANUP ─────────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (event) => {
      setMousePos({
        x: (event.clientX / window.innerWidth) * 100,
        y: (event.clientY / window.innerHeight) * 100
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    if (sessionId) {
      // Initialize synchronizer
      synchronizer.current = getDataSynchronizer(sessionId);
      
      // Set up event listeners
      synchronizer.current.addEventListener('start', (data) => {
        setSyncStatus({ inProgress: true, operation: data.operation });
        setSyncProgress(0);
      });
      
      // Progress updates during multi-page fetches
      synchronizer.current.addEventListener('progress', (data) => {
        if (data && data.totalPages && data.totalPages > 1) {
          const pct = Math.max(0, Math.min(100, Math.round((data.page / data.totalPages) * 100)));
          setSyncProgress(pct);
        }
      });
      
      synchronizer.current.addEventListener('complete', (data) => {
        setSyncStatus({ inProgress: false, operation: null });
        setSyncProgress(100);
      });
      
      synchronizer.current.addEventListener('error', (data) => {
        setSyncStatus({ inProgress: false, operation: null });
        console.error('❌ Sync operation failed:', data);
        showSnackbar(`Synchronization failed: ${data.error?.message || 'Unknown error'}`, 'error');
      });
      
      synchronizer.current.addEventListener('sessionInvalid', () => {
        setError('Session has become invalid. Please refresh the page or go back to the dashboard.');
      });
      
      // Start session validation for Azure
      synchronizer.current.startSessionValidation();
      
      // Initialize data
      initializeData();
    }
    
    return () => {
      // Cleanup synchronizer on unmount
      if (synchronizer.current) {
        synchronizer.current.stopSessionValidation();
      }
    };
  }, [sessionId]);

  // ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────
  const showSnackbar = useCallback((message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }));
  }, []);

  const getFriendlyErrorMessage = useCallback((error, fallback = 'Something went wrong') => {
    const candidates = [
      error?.response?.data?.error,
      error?.response?.data?.message,
      error?.message,
      typeof error === 'string' ? error : ''
    ];
    const message = candidates
      .map(value => value === null || value === undefined ? '' : String(value).trim())
      .find(value => value && value !== '0' && value.toLowerCase() !== 'undefined' && value.toLowerCase() !== 'null');
    if (message) return message;
    if (error?.code === 'ECONNABORTED') return 'Request timed out. Please try again.';
    if (error?.response?.status) return `Server returned HTTP ${error.response.status}`;
    if (error?.request) return 'Could not reach the server. Please check if backend is running.';
    return fallback;
  }, []);

  const normalizePostMappingAction = useCallback((action) => {
    if (!action || typeof action !== 'object' || !action.type) return null;
    return {
      ...action,
      id: action.id || `${action.type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      created_at: action.created_at || new Date().toISOString(),
    };
  }, []);

  const getPostMappingActionKey = useCallback((action) => {
    const canonicalize = (value) => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === 'object') {
        return Object.keys(value)
          .filter(key => !['id', 'created_at', 'key', 'label'].includes(key))
          .sort()
          .reduce((acc, key) => {
            acc[key] = canonicalize(value[key]);
            return acc;
          }, {});
      }
      return value;
    };
    try {
      return JSON.stringify(canonicalize(action));
    } catch (_) {
      return `${action?.type || 'action'}:${String(action?.key || action?.label || '')}`;
    }
  }, []);

  const mergePostMappingActions = useCallback((...actionGroups) => {
    const seen = new Set();
    const merged = [];
    actionGroups.flat().forEach((action) => {
      const normalized = normalizePostMappingAction(action);
      if (!normalized) return;
      const key = getPostMappingActionKey(normalized);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({ ...normalized, key });
    });
    return merged;
  }, [getPostMappingActionKey, normalizePostMappingAction]);

  const recordPostMappingAction = useCallback((action) => {
    const normalized = normalizePostMappingAction(action);
    if (!normalized) return;
    const actionKey = getPostMappingActionKey(normalized);
    setPostMappingActions(prev => {
      const filtered = prev.filter(item => (item.key || '') !== actionKey);
      return [...filtered, { ...normalized, key: actionKey }];
    });
  }, [getPostMappingActionKey, normalizePostMappingAction]);

  const getPostMappingActionsFromTemplate = useCallback((template) => {
    if (!template || typeof template !== 'object') return [];
    const metadataActions = Array.isArray(template.metadata?.post_mapping_actions)
      ? template.metadata.post_mapping_actions
      : [];
    const editorStage = Array.isArray(template.stages)
      ? template.stages.find(stage => stage?.type === 'mapped_data_editor')
      : null;
    const stageActions = Array.isArray(editorStage?.post_mapping_actions)
      ? editorStage.post_mapping_actions
      : [];
    return mergePostMappingActions(metadataActions, stageActions);
  }, [mergePostMappingActions]);

  const buildPostMappingActionsForSave = useCallback((currentFactwiseRules = [], defaults = {}, formulaRules = []) => {
    const actions = [];
    const push = (action) => {
      const normalized = normalizePostMappingAction(action);
      if (normalized) actions.push(normalized);
    };

    (Array.isArray(currentFactwiseRules) ? currentFactwiseRules : []).forEach(rule => {
      if (!rule || typeof rule !== 'object') return;
      if (rule.type === 'column_value') {
        push({
          type: 'fill_or_create_column',
          label: `Fill/create ${rule.target_column || 'column'}`,
          rule,
        });
      } else if (rule.type === 'factwise_id') {
        push({
          type: 'factwise_id',
          label: 'Create FactWise ID',
          config: {
            first_column: rule.first_column,
            second_column: rule.second_column,
            operator: rule.operator || '_',
            strategy: rule.strategy || 'fill_only_null',
            generation_mode: rule.generation_mode || 'columns',
            serial_prefix: rule.serial_prefix || '',
            serial_start: rule.serial_start ?? 1,
            serial_padding: rule.serial_padding ?? 0,
            serial_increment: rule.serial_increment !== false,
          },
        });
      }
    });

    if (defaults && typeof defaults === 'object' && Object.keys(defaults).length > 0) {
      push({
        type: 'fill_required_defaults',
        label: 'Fill required defaults',
        defaults,
      });
    }

    if (Array.isArray(formulaRules) && formulaRules.length > 0) {
      push({
        type: 'formula_rules',
        label: 'Apply formula/tag rules',
        rules: formulaRules,
      });
    }

    postMappingActions.forEach(push);

    // Assembling by category — factwise rules, then defaults, then formulas,
    // then clicked actions — put a rule that ran second ahead of one that ran
    // first, so the template replayed them backwards. Two fill_empty rules on
    // one column give completely different results in the wrong order, so the
    // real running order is restored here from the stamps.
    const ranAt = (action) => {
      const stamp = action?.rule?.applied_at || action?.created_at || '';
      const parsed = Date.parse(stamp);
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    const ordered = actions
      .map((action, index) => ({ action, index }))
      .sort((a, b) => (ranAt(a.action) - ranAt(b.action)) || (a.index - b.index))
      .map(entry => entry.action);

    return mergePostMappingActions(ordered);
  }, [mergePostMappingActions, normalizePostMappingAction, postMappingActions]);

  const updateDataIntegrity = useCallback((consistent, issues = []) => {
    setDataIntegrity({
      consistent,
      lastValidated: new Date().toISOString(),
      issues
    });
  }, []);

  // Consider null/empty/whitespace and 'unknown' as empty for pruning
  const isCellEmpty = useCallback((v) => {
    if (v === null || v === undefined) return true;
    const s = String(v).trim();
    if (s === '') return true;
    if (s.toLowerCase() === 'unknown') return true;
    return false;
  }, []);

  // Remove completely blank Specification pairs (Specification_Name_N/Specification_Value_N and base name/value)
  const pruneEmptySpecificationPairs = useCallback((headers, rows) => {
    try {
      const getSpecPair = (header) => {
        const raw = String(header || '').trim();
        let match = raw.match(/^specification_name_(\d+)$/i);
        if (match) return { kind: 'name', key: `internal_${match[1]}` };
        match = raw.match(/^specification_value_(\d+)$/i);
        if (match) return { kind: 'value', key: `internal_${match[1]}` };
        match = raw.match(/^specification\s+name(?:\.(\d+))?$/i);
        if (match) return { kind: 'name', key: `external_${match[1] || 'base'}` };
        match = raw.match(/^specification\s+value(?:\.(\d+))?$/i);
        if (match) return { kind: 'value', key: `external_${match[1] || 'base'}` };

        const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        match = normalized.match(/^specification name(?: (\d+))?$/);
        if (match) {
          return { kind: 'name', key: `normalized_${match[1] || 'base'}` };
        }
        match = normalized.match(/^specification value(?: (\d+))?$/);
        if (match) {
          return { kind: 'value', key: `normalized_${match[1] || 'base'}` };
        }
        return null;
      };
      const hasBaseName = headers.includes('Specification name');
      const hasBaseValue = headers.includes('Specification value');

      const pairs = {};
      headers.forEach(h => {
        const specPair = getSpecPair(h);
        if (!specPair) return;
        pairs[specPair.key] = pairs[specPair.key] || { name: null, value: null };
        pairs[specPair.key][specPair.kind] = h;
      });

      const toRemove = new Set();
      const cleanedRows = rows.map(row => {
        const copy = { ...row };
        Object.values(pairs).forEach(pair => {
          if (!pair.name || !pair.value) return;
          if (!isCellEmpty(copy[pair.name]) && isCellEmpty(copy[pair.value])) {
            copy[pair.name] = '';
          }
        });
        return copy;
      });

      Object.values(pairs).forEach(pair => {
        if (!pair.name || !pair.value) return;
        const allEmpty = cleanedRows.every(r => isCellEmpty(r[pair.name]) && isCellEmpty(r[pair.value]));
        if (allEmpty) {
          toRemove.add(pair.name);
          toRemove.add(pair.value);
        }
      });

      if (hasBaseName && hasBaseValue) {
        const allEmpty = rows.every(r => isCellEmpty(r['Specification name']) && isCellEmpty(r['Specification value']));
        if (allEmpty) {
          toRemove.add('Specification name');
          toRemove.add('Specification value');
        }
      }

      if (toRemove.size === 0) return { headers, rows: cleanedRows };

      const prunedHeaders = headers.filter(h => !toRemove.has(h));
      const prunedRows = cleanedRows.map(row => {
        const copy = { ...row };
        toRemove.forEach(h => { delete copy[h]; });
        return copy;
      });

      return { headers: prunedHeaders, rows: prunedRows };
    } catch (_) {
      return { headers, rows };
    }
  }, [isCellEmpty]);

  const applySavedItemDirectoryDefaultsOnLoad = useCallback(async (headers = []) => {
    if (!sessionId || !Array.isArray(headers) || headers.length === 0) return false;
    if (itemDirectoryDefaultsAppliedRef.current[sessionId]) return false;
    itemDirectoryDefaultsAppliedRef.current[sessionId] = true;

    try {
      const savedDefaults = readItemDirectoryDefaults();
      const headerSet = new Set(headers);
      const defaults = {};
      const addDefault = (column, value) => {
        const text = String(value ?? '').trim();
        if (text && headerSet.has(column)) {
          defaults[column] = text;
        }
      };

      addDefault('Procurement entity name', savedDefaults.procurementEntityName);
      addDefault('Item type', savedDefaults.itemType);
      addDefault('Procurement item', savedDefaults.procurementItem);
      addDefault('Sales item', savedDefaults.salesItem);
      addDefault('Measurement unit', savedDefaults.measurementUnit);
      if (savedDefaults.itemCodeContentType === 'fixed') {
        addDefault('Item code', savedDefaults.itemCodeDefaultValue);
      }

      let changed = false;
      if (Object.keys(defaults).length > 0) {
        const resp = await api.fillRequiredDefaults(sessionId, defaults);
        if (!resp.data?.success) {
          throw new Error(resp.data?.error || 'Could not apply saved editor defaults');
        }
        const filled = resp.data?.filled || {};
        changed = Object.values(filled).some(count => Number(count || 0) > 0);
      }

      const itemCodePrefix = String(savedDefaults.itemCodePrefix || '').trim();
      const itemCodeColumn = headerSet.has('Item code') ? 'Item code' : '';
      // No mode saved means no item code rule at all — the tool does not pick
      // one on the user's behalf.
      const itemCodeMode = String(savedDefaults.itemCodeContentType || '').trim();

      // Settings offers five ways to set Item code; only 'fixed' (above) and
      // 'serial' (below) were ever applied, so copy / join / if-else were saved
      // and silently ignored. They are exactly what fill_or_create_column
      // already does, so hand them to it.
      if (itemCodeColumn && ['copy', 'concat', 'conditional'].includes(itemCodeMode)) {
        const writeMode = savedDefaults.itemCodeRowsToUpdate || 'fill_empty';
        const branches = (savedDefaults.itemCodeConditionalBranches || []).map(branch => ({
          column: branch.column,
          operator: branch.operator || 'contains',
          compare: branch.compare,
          output_value: branch.outputType === 'empty' ? '' : branch.outputValue,
          ...(branch.outputType === 'column' ? { output_source_column: branch.outputColumn } : {}),
        })).filter(branch => branch.column);
        const elseSource = savedDefaults.itemCodeElseValueSource || 'default';
        const rule = {
          type: 'column_value',
          target_mode: 'existing',
          target_column: itemCodeColumn,
          value_mode: itemCodeMode,
          source_columns: itemCodeMode === 'copy'
            ? [savedDefaults.itemCodeCopyFromColumn]
            : (itemCodeMode === 'concat'
              ? [savedDefaults.itemCodeJoinFirstColumn, savedDefaults.itemCodeJoinSecondColumn]
              : []),
          separator: savedDefaults.itemCodeSeparator ?? ' ',
          write_mode: writeMode,
          condition: itemCodeMode === 'conditional'
            ? {
                branches,
                ...(elseSource === 'column'
                  ? { else_source_column: savedDefaults.itemCodeElseValueColumn }
                  : (elseSource === 'empty'
                    ? { else: '' }
                    : (String(savedDefaults.itemCodeElseDefaultValue || '').trim()
                      ? { else: savedDefaults.itemCodeElseDefaultValue }
                      : {}))),
              }
            : null,
        };
        const hasInputs = itemCodeMode === 'conditional'
          ? branches.length > 0
          : rule.source_columns.every(column => String(column || '').trim());
        if (hasInputs) {
          const resp = await api.fillOrCreateColumn(sessionId, rule);
          if (!resp.data?.success) {
            throw new Error(resp.data?.error || 'Could not apply saved item code settings');
          }
          changed = changed || Number(resp.data?.changed || 0) > 0;
        }
      }

      if (itemCodeColumn && itemCodeMode === 'serial') {
        // A prefix is optional: "001, 002, ..." is a perfectly good sequence.
        // Requiring one here meant a serial rule saved without a prefix did
        // nothing at all, silently.
        const blankStrategy = savedDefaults.itemCodeBlankStrategy === 'prefix_sequence'
          ? 'prefix_sequence'
          : 'leave';
        // Only what was saved. An unset duplicate strategy leaves duplicates
        // alone rather than quietly renaming rows.
        const duplicateStrategy = (() => {
          const requested = String(savedDefaults.itemCodeDuplicateStrategy || '').trim();
          if (requested === 'suffix') return 'suffix';
          if (requested === 'prefix_sequence') return 'prefix_sequence';
          return 'leave';
        })();

        if (blankStrategy !== 'leave' || duplicateStrategy !== 'leave') {
          const resp = await api.resolveItemCode(sessionId, {
            column: itemCodeColumn,
            blankStrategy,
            duplicateStrategy,
            prefix: itemCodePrefix,
            separator: savedDefaults.itemCodeSeparator ?? '-',
            start: Math.max(1, Number.parseInt(savedDefaults.itemCodeStart || '1', 10) || 1),
            padding: Math.max(0, Number.parseInt(savedDefaults.itemCodePadding, 10) || 0),
            increment: savedDefaults.itemCodeIncrement !== false,
          });
          if (!resp.data?.success) {
            throw new Error(resp.data?.error || 'Could not apply saved item code settings');
          }
          changed = changed
            || Number(resp.data?.blanks_filled || 0) > 0
            || Number(resp.data?.duplicates_resolved || 0) > 0;
        }
      }

      if (changed) {
        setDefaultValues(prev => ({ ...prev, ...defaults }));
        showSnackbar('Applied saved Item Directory defaults to blank editor cells.', 'success');
      } else {
        // Nothing was written, so nothing has been "used up". Coming from the
        // BOM Normalizer the sheet can reach the editor before MPN/manufacturer
        // are populated, and a join over two empty columns fills nothing —
        // keeping the guard would leave Item code blank until a page reload.
        delete itemDirectoryDefaultsAppliedRef.current[sessionId];
      }
      return changed;
    } catch (error) {
      delete itemDirectoryDefaultsAppliedRef.current[sessionId];
      throw error;
    }
  }, [sessionId, showSnackbar]);

  // The defaults run during the load below, which is right when the sheet
  // already has its values. Coming from the BOM Normalizer it may not: MPN and
  // manufacturer can land after that first pass, and a join over two empty
  // columns fills nothing. This watches the loaded grid and tries again once
  // the source data is actually there.
  //
  // The fingerprint is what stops it looping: an attempt only repeats when the
  // grid's shape or its filled-cell count has changed since the last one.
  const defaultsAttemptRef = useRef('');
  useEffect(() => {
    if (!sessionId || pageLoading) return;
    if (!Array.isArray(rowData) || rowData.length === 0) return;
    if (itemDirectoryDefaultsAppliedRef.current[sessionId]) return;

    const fields = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    if (fields.length === 0) return;

    let filled = 0;
    rowData.forEach(row => fields.forEach(field => {
      if (String(row?.[field] ?? '').trim()) filled += 1;
    }));
    const fingerprint = `${sessionId}|${rowData.length}|${fields.length}|${filled}`;
    if (defaultsAttemptRef.current === fingerprint) return;
    defaultsAttemptRef.current = fingerprint;

    let cancelled = false;
    applySavedItemDirectoryDefaultsOnLoad(fields)
      .then(applied => {
        if (applied && !cancelled) fetchDataSynchronized();
      })
      .catch(error => {
        console.warn('Could not apply saved Item Directory defaults:', error);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, rowData, columnDefs, pageLoading]);

  // Load the whole sheet, then page/search/filter over it in the browser.
  //
  // This used to fetch one server page at a time, which quietly broke three
  // things: search and the row filters only ever saw the loaded page, and the
  // autosave below posts rowData as the complete dataset — so editing a cell on
  // page 2 wrote back only those rows and dropped the rest. `targetPage` now
  // just selects which slice to show once everything is in memory.
  const fetchPageData = useCallback(async (targetPage = page, size = pageSize) => {
    if (!sessionId) return;
    try {
      setPageLoading(true);
      const timeoutMs = 180000;

      const resp = await api.getMappedDataWithSpecs(sessionId, 1, ALL_ROWS_PAGE_SIZE, true, {
        force_fresh: true,
        _fresh: Date.now(),
        timeoutMs,
        entityName: factwiseEntityName
      });

      let payload = resp?.data || {};
      let headers = payload.headers || [];
      let displayHeaders = Array.isArray(payload.display_headers) && payload.display_headers.length === headers.length
        ? payload.display_headers
        : headers;
      let rows = Array.isArray(payload.data) ? payload.data : [];
      let pg = payload.pagination || { page: targetPage, total_pages: 1, total_rows: rows.length };

      let appliedSavedDefaults = false;
      try {
        appliedSavedDefaults = await applySavedItemDirectoryDefaultsOnLoad(headers);
      } catch (defaultsError) {
        console.warn('Could not apply saved Item Directory defaults:', defaultsError);
        showSnackbar(
          defaultsError?.message || 'Could not apply saved Item Directory defaults.',
          'warning'
        );
      }
      if (appliedSavedDefaults) {
        const refreshedResp = await api.getMappedDataWithSpecs(sessionId, 1, ALL_ROWS_PAGE_SIZE, true, {
          force_fresh: true,
          _fresh: Date.now(),
          timeoutMs,
          entityName: factwiseEntityName
        });
        payload = refreshedResp?.data || {};
        headers = payload.headers || [];
        displayHeaders = Array.isArray(payload.display_headers) && payload.display_headers.length === headers.length
          ? payload.display_headers
          : headers;
        rows = Array.isArray(payload.data) ? payload.data : [];
        pg = payload.pagination || { page: targetPage, total_pages: 1, total_rows: rows.length };
      }
      const pageHasMpnValidation = headers.some(header => isMpnValidationColumn(header));
      if (pageHasMpnValidation) {
        setMpnValidationCompleted(true);
      }

      // Update quality metrics state

      if (payload.quality_metrics) {
        setQualityMetrics(payload.quality_metrics);
      } else {
      }
      if (payload.header_confidence_scores) {
        setHeaderConfidenceScores(payload.header_confidence_scores);
      } else {
      }
      if (payload.target_column_confidence_scores) {
        setColumnConfidenceScores(payload.target_column_confidence_scores);
      } else {
        setColumnConfidenceScores(payload.header_confidence_scores || {});
      }
      if (payload.is_from_pdf !== undefined) {
        setIsFromPdf(payload.is_from_pdf);
      } else {
      }

      // Initialize columns if not yet set or header count changed
      if (!columnDefs || columnDefs.length === 0 || columnDefs.filter(c => c.field && c.field !== '__row_number__').length !== headers.length) {
        const detectedFormulaColumns = headers.filter(h => 
          h.startsWith('Tag_') || h.startsWith('Specification_Name_') || h.startsWith('Specification_Value_') || h.startsWith('Custom_Identification_') ||
          h === 'Tag' || h === 'Factwise ID' || (h.includes('Specification') && (h.includes('Name') || h.includes('Value'))) || (h.includes('Customer') && h.includes('Identification'))
        );
        const columns = [
          {
            headerName: '#',
            field: '__row_number__',
            valueGetter: 'node.rowIndex + 1',
            cellStyle: { backgroundColor: '#f8f9fa', fontWeight: 'bold', textAlign: 'center', borderRight: '2px solid #dee2e6', color: '#6c757d', padding: '12px' },
            headerClass: 'ag-header-row-number',
            width: 80,
            pinned: 'left',
            editable: false,
            filter: false,
            sortable: false,
            resizable: false,
            suppressMovable: true,
            suppressSizeToFit: true,
            suppressAutoSize: true
          },
          ...headers.map((col, idx) => ({
            headerName: deriveDisplayName(displayHeaders[idx] || col, displayHeaders),
            field: col,
            tooltipField: col,
            isFormulaColumn: detectedFormulaColumns.includes(col)
          }))
        ];
        setColumnDefs(columns);
        // Initialize default widths
        setColumnWidths(prev => {
          const next = { ...prev };
          headers.forEach(h => { if (!next[h]) next[h] = 180; });
          return next;
        });
      }

      setRowData(rows);
      const nextTotalRows = Number(pg.total_rows ?? payload.total_rows ?? rows.length) || rows.length;
      setTotalRows(nextTotalRows);
      // Page count is derived from the filtered row set, not set here — a search
      // or column filter changes how many pages there are.
      const lastPage = Math.max(1, Math.ceil((rows.length || 1) / (size || 1)));
      setPage(Math.min(Math.max(1, targetPage), lastPage));

      // Reset virtualization window to the full page
      setVisibleRange({ start: 0, end: rows.length });

      if (nextTotalRows > rows.length) {
        // The server capped the response. Say so rather than letting search and
        // the filters look like they cover rows that were never delivered.
        showSnackbar(
          `Loaded ${rows.length.toLocaleString()} of ${nextTotalRows.toLocaleString()} rows. Search and filters cover the loaded rows only.`,
          'warning'
        );
      }

      // Recompute unknowns across the dataset
      let unknownCount = 0;
      for (const r of rows) {
        for (const v of Object.values(r)) {
          if (v && String(v).toLowerCase() === 'unknown') unknownCount++;
        }
      }
      setUnknownCellsCount(unknownCount);
    } catch (e) {
      console.error('Data fetch failed:', e);
      if (e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        showSnackbar('Loading the sheet timed out. Reload to try again.', 'error');
      } else {
        showSnackbar(`Failed to load rows: ${e.message}`, 'error');
      }
    } finally {
      setPageLoading(false);
    }
  }, [sessionId, page, pageSize, columnDefs, showSnackbar, isMpnValidationColumn, applySavedItemDirectoryDefaultsOnLoad, factwiseEntityName]);

  // ─── ENHANCED DATA LOADING WITH SYNCHRONIZATION ─────────────────────────────
  const initializeData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      
      // Check for smart tag rules from dashboard
      const smartTagRulesFromDashboard = location.state?.smartTagFormulaRules;
      
      if (smartTagRulesFromDashboard && smartTagRulesFromDashboard.length > 0) {
        await synchronizer.current.applyFormulasSynchronized(smartTagRulesFromDashboard);
        setAppliedFormulas(smartTagRulesFromDashboard);
        setHasFormulas(true);
        showSnackbar('Smart Tag rules from Dashboard applied successfully!', 'success');
      }
      
      // Fetch data with validation
      await fetchDataSynchronized();
      
    } catch (err) {
      console.error('❌ Initialization failed:', err);
      setError(err.message || 'Failed to initialize data editor');
    } finally {
      setLoading(false);
    }
  }, [sessionId, location.state]);

  const fetchDataSynchronized = useCallback(async () => {
    if (!synchronizer.current) {
      throw new Error('Synchronizer not initialized');
    }
    
    try {
      
      // Fetch with extended budget to warm caches and validate session
      const syncResult = await synchronizer.current.fetchDataFast(12000);
      if (syncResult.fromCache) {
        showSnackbar('Showing recent data while syncing latest changes…', 'warning');
        setSyncNotice(prev => ({ ...prev, visible: true }));
      } else {
        setSyncNotice(prev => ({ ...prev, visible: false }));
      }

      if (!syncResult.success && !syncResult.fromCache) {
        throw new Error(syncResult.error || 'Failed to fetch data');
      }
      
      const data = syncResult.data;
      if (typeof data?.template_version === 'number') {
        setSessionVersion(data.template_version);
      }

      // Validate data structure
      updateDataIntegrity(syncResult.validation.isValid, syncResult.validation.errors);
      
      if (!data || !data.headers || !Array.isArray(data.headers) || data.headers.length === 0) {
        throw new Error('No mapped data found. Please go back to Column Mapping and create mappings first.');
      }

      // Read cleanup info if available
      if (data.cleanup_info) {
        setCleanupInfo(data.cleanup_info);
      }

      // Detect parser MPN columns (Specification_Name_* with value "MPN")
      try {
        const specNameCols = (data.headers || []).filter(h => /^Specification_Name_\d+$/.test(h));
        let foundParserMpn = false;
        if (specNameCols.length > 0 && data.data && data.data.length > 0) {
          for (const snCol of specNameCols) {
            const firstRow = data.data[0];
            if (firstRow && String(firstRow[snCol] || '').trim().toUpperCase() === 'MPN') {
              foundParserMpn = true;
              break;
            }
          }
        }
        setHasParserMpnColumns(foundParserMpn);
        // Check if parser MPN validation already done
        const parserValidCols = (data.headers || []).filter(h => /^MPN_\d+_DigiKey_Valid$/.test(h));
        if (parserValidCols.length > 0) {
          setParserMpnValidationCompleted(true);
        }
      } catch (_) {}

      // Prune completely blank Specification pairs ONLY when we have full dataset
      const hasAllRows = !data.pagination || (data.pagination.total_pages || 1) <= 1 || (Array.isArray(data.data) && data.pagination?.total_rows === data.data.length);
      const { headers: viewHeaders, rows: viewRows } = hasAllRows
        ? pruneEmptySpecificationPairs(data.headers || [], data.data || [])
        : { headers: (data.headers || []), rows: (data.data || []) };

      // Detect MPN column on each refresh: honor hint from ColumnMapping if present
      try {
        const hintKey = `mpnAutoColumn_${sessionId}`;
        const hinted = sessionStorage.getItem(hintKey);
        if (hinted && viewHeaders.includes(hinted)) {
          setMpnColumn(hinted);
        }
        let maybeMpn = detectMpnColumn(viewHeaders);
        if (!maybeMpn) {
          maybeMpn = detectMpnColumnByData(viewHeaders, viewRows);
        }
        if (maybeMpn) {
          setMpnColumn(maybeMpn);
          // Store original column name for template saving (only if not already validation result column)
          if (!isMpnValidationColumn(maybeMpn)) {
            setOriginalMpnColumn(maybeMpn);
          }
        }

        // Check if MPN validation columns already exist (including all canonical MPN variants)
        const baseMpnValidationColumns = [
          'MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued', 'DigiKey Part Number',
          'MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN',
          'MPN valid (Mouser)', 'Mouser Status', 'MPNR',
          'MPN valid (Element14)', 'Element14 Status', 'Element14 Part Number'
        ];
        const canonicalMpnColumns = viewHeaders.filter(header =>
          header === 'DigiKey Canonical MPN' || /^DigiKey Canonical MPN \d+$/.test(header) ||
          header === 'Canonical MPN' || /^Canonical MPN \d+$/.test(header) ||
          header === 'Mouser Canonical MPN' || header === 'Element14 Canonical MPN'
        );
        const hasMpnValidation = baseMpnValidationColumns.some(col => viewHeaders.includes(col)) || canonicalMpnColumns.length > 0;
        if (hasMpnValidation) {
          setMpnValidationCompleted(true);
        }
      } catch (_) {}

      // Process headers and create columns
      const detectedFormulaColumns = viewHeaders.filter(h => 
        h.startsWith('Tag_') || 
        h.startsWith('Specification_Name_') || 
        h.startsWith('Specification_Value_') || 
        h.startsWith('Custom_Identification_') ||
        h === 'Tag' || 
        h === 'Factwise ID' ||
        (h.includes('Specification') && (h.includes('Name') || h.includes('Value'))) ||
        (h.includes('Customer') && h.includes('Identification'))
      );
      
      setFormulaColumns(detectedFormulaColumns);
      
      // Calculate column counts
      const tagColumns = viewHeaders.filter(h => h.startsWith('Tag_') || h === 'Tag');
      const specNameColumns = viewHeaders.filter(h => h.startsWith('Specification_Name_') || h === 'Specification name');
      const customerNameColumns = viewHeaders.filter(h => h.startsWith('Custom_Identification_Name_'));
      
      const actualColumnCounts = {
        tags_count: Math.max(tagColumns.length, 1),
        spec_pairs_count: Math.max(specNameColumns.length, 1),
        customer_id_pairs_count: Math.max(customerNameColumns.length, 1)
      };
      
      setDynamicColumnCounts(actualColumnCounts);
      
      // Process formula rules if present
      if (data.formula_rules && Array.isArray(data.formula_rules) && data.formula_rules.length > 0) {
        setAppliedFormulas(data.formula_rules);
        setHasFormulas(true);
      } else {
        setAppliedFormulas([]);
        setHasFormulas(detectedFormulaColumns.length > 0);
      }

      // Create column definitions (from aggregated headers)
      const columns = [
        {
          headerName: '#',
          field: '__row_number__',
          valueGetter: 'node.rowIndex + 1',
          cellStyle: { 
            backgroundColor: '#f8f9fa', 
            fontWeight: 'bold',
            textAlign: 'center',
            borderRight: '2px solid #dee2e6',
            color: '#6c757d',
            padding: '12px'
          },
          headerClass: 'ag-header-row-number',
          width: 80,
          pinned: 'left',
          editable: false,
          filter: false,
          sortable: false,
          resizable: false,
          suppressMovable: true,
          suppressSizeToFit: true,
          suppressAutoSize: true
        },
        ...viewHeaders.filter(col => col && col.trim() !== '').map((col) => {
          let displayName = deriveDisplayName(col, viewHeaders);

          const isUnmapped = data.unmapped_columns && data.unmapped_columns.includes(displayName);
          const isSpecificationColumn = displayName.toLowerCase().includes('specification');
          const isFormulaColumn = detectedFormulaColumns.includes(col) || col.startsWith('Tag_') || col.startsWith('Specification_') || col.startsWith('Custom_Identification_') || col === 'Tag' || col.includes('Specification') || col.includes('Custom identification') || col.includes('Custom identification') || col === 'Factwise ID';
          const isMpnValidationColumn = [
            'MPN valid (DigiKey)', 'DigiKey Status', 'DigiKey EOL Status', 'DigiKey Discontinued',
            'DigiKey Part Number', 'DigiKey Canonical MPN', 'DigiKey Category',
            'MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'Canonical MPN', 'Category',
            'MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category',
            'MPN valid (Element14)', 'Element14 Status', 'Element14 Part Number', 'Element14 Canonical MPN', 'Element14 Category'
          ].includes(col) ||
            /^DigiKey Canonical MPN \d+$/.test(col) || /^Canonical MPN \d+$/.test(col) || /^MPN_\d+_DigiKey_(Valid|Canonical|PN)$/.test(col);
          const columnWidth = Math.max(180, Math.min(400, displayName.length * 10 + 40));
          
          return {
            headerName: isUnmapped ? `${displayName} ⚠️` : displayName,
            field: col,
            width: columnWidth,
            minWidth: 120,
            maxWidth: 600,
            resizable: true,
            cellEditor: 'agTextCellEditor',
            cellEditorPopup: true,
            cellStyle: params => {
              const baseStyle = {
                borderRight: '1px solid #e9ecef',
                borderBottom: '1px solid #e9ecef',
                fontSize: '14px',
                fontFamily: 'Segoe UI, Arial, sans-serif',
                padding: '12px 16px',
                lineHeight: '1.4'
              };

              if (params.value && params.value.toString().toLowerCase() === 'unknown') {
                baseStyle.backgroundColor = '#ffebee';
                baseStyle.color = '#c62828';
                baseStyle.fontWeight = '500';
              } else if (isFormulaColumn) {
                baseStyle.backgroundColor = '#e8f5e8';
                baseStyle.borderLeft = '4px solid #4caf50';
                baseStyle.fontWeight = '500';
              } else if (isUnmapped) {
                baseStyle.backgroundColor = '#fff8e1';
                baseStyle.borderLeft = '4px solid #ff9800';
                baseStyle.color = '#e65100';
              } else if (isSpecificationColumn && params.value) {
                baseStyle.backgroundColor = '#f0f8ff';
                baseStyle.borderLeft = '4px solid #2196f3';
              } else if (params.node.data && params.node.data._changed && params.node.data._changed[col]) {
                baseStyle.borderLeft = '3px solid #1976d2';
                baseStyle.fontWeight = '500';
              } else if (params.node.rowIndex % 2 === 0) {
                baseStyle.backgroundColor = '#f8f9fa';
              }

              return baseStyle;
            },
            cellRenderer: col === 'datasheet' ? (params) => {
              const url = params.value;
              if (url && url.startsWith('http')) {
                return <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
              }
              return params.value || '';
            } : undefined,
            headerClass: isFormulaColumn ? 'ag-header-formula' : isUnmapped ? 'ag-header-unmapped' : isSpecificationColumn ? 'ag-header-specification' : isMpnValidationColumn ? 'ag-header-mpn' : 'ag-header-cell-excel',
            headerTooltip: (() => {
              const mpnTooltip = getMpnColumnTooltip(col);
              if (mpnTooltip) {
                return `${col}: ${mpnTooltip}`;
              } else if (isFormulaColumn) {
                return `${col} - Formula-generated column`;
              } else if (isUnmapped) {
                return `${col} - Unmapped Column (No data source)`;
              } else if (isSpecificationColumn) {
                return `${col} - Specification Column`;
              } else {
                return col;
              }
            })(),
            tooltipField: col,
            wrapText: false,
            autoHeight: false,
            resizable: true,
            minWidth: 120,
            suppressMovable: false,
            suppressSizeToFit: true,
            isFormulaColumn,
            isUnmapped,
            isSpecificationColumn
          };
        })
      ];

      setColumnDefs(columns);
      // Use paginated fetch for rows to keep UI light
      await fetchPageData(1, pageSize);
      setTotalRows(data.pagination?.total_rows || data.data?.length || 0);

      // Initialize default widths for new columns if not present
      setColumnWidths(prev => {
        const next = { ...prev };
        (viewHeaders || []).forEach(h => {
          if (!next[h]) next[h] = 180; // default 180px
        });
        return next;
      });
      
      const unmapped = data.unmapped_columns || [];
      const mapped = data.mapped_columns || [];
      setUnmappedColumns(unmapped);
      setMappedColumns(mapped);
      
      const unknownCount = (data.data || []).reduce((total, row) => {
        return total + Object.values(row).filter(cell => 
          cell && cell.toString().toLowerCase() === 'unknown'
        ).length;
      }, 0);
      setUnknownCellsCount(unknownCount);
      
      if (unmapped.length > 0) {
        setUnmappedDialogOpen(true);
      }

      const message = syncResult.fromCache 
        ? `Loaded cached data: ${viewRows.length || 0} rows with ${viewHeaders.length} columns`
        : `Loaded ${viewRows.length || 0} rows with ${viewHeaders.length} columns`;
      
      showSnackbar(message, syncResult.fromCache ? 'warning' : 'success');

      // Auto-refresh if data appears stale due to Azure lag (no Tag/Item code despite rules)
      try {
        await ensureFreshnessIfNeeded(data);
      } catch (_) { /* non-fatal */ }

    } catch (err) {
      console.error('❌ Data fetch failed:', err);
      throw err;
    }
  }, [showSnackbar, updateDataIntegrity, fetchPageData, pageSize]);

  const replayPostMappingActions = useCallback(async (actions = []) => {
    if (!Array.isArray(actions) || actions.length === 0 || !sessionId) return;
    const failures = [];
    // Row deletions report what they removed: the same condition can match a
    // different number of rows on a different file, and silently dropping a
    // different set than last time is not something to find out at export.
    const replayNotes = [];
    let changed = false;
    const currentFields = new Set(
      (columnDefs || [])
        .map(col => col.field)
        .filter(field => field && field !== '__row_number__')
    );

    for (const action of actions) {
      try {
        if (action.type === 'formula_rules') {
          const rules = Array.isArray(action.rules) ? action.rules : [];
          if (!rules.length) continue;
          await synchronizer.current.applyFormulasSynchronized(rules);
          setAppliedFormulas(rules);
          setHasFormulas(true);
          changed = true;
        } else if (action.type === 'fill_or_create_column') {
          const rule = action.rule && typeof action.rule === 'object' ? { ...action.rule } : null;
          if (!rule?.target_column) continue;
          if (rule.target_mode === 'new' && currentFields.has(rule.target_column)) {
            continue;
          }
          const resp = await api.fillOrCreateColumn(sessionId, rule);
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Column action failed');
          currentFields.add(rule.target_column);
          changed = true;
        } else if (action.type === 'factwise_id') {
          const config = action.config || {};
          const firstColumn = config.first_column || config.firstColumn || '';
          const secondColumn = config.second_column || config.secondColumn || '';
          const generationMode = config.generation_mode || config.generationMode || 'columns';
          if (generationMode !== 'serial' && (!firstColumn || !secondColumn)) continue;
          await synchronizer.current.createFactWiseIdSynchronized(
            firstColumn,
            secondColumn,
            config.operator || '_',
            config.strategy || 'fill_only_null',
            {
              generationMode,
              serialPrefix: config.serial_prefix || config.serialPrefix || '',
              serialStart: config.serial_start ?? config.serialStart ?? 1,
              serialPadding: config.serial_padding ?? config.serialPadding ?? 0,
              serialIncrement: config.serial_increment ?? config.serialIncrement ?? true,
            }
          );
          setFactwiseIdRule({
            firstColumn,
            secondColumn,
            operator: config.operator || '_',
            strategy: config.strategy || 'fill_only_null',
            generationMode,
            serialPrefix: config.serial_prefix || config.serialPrefix || '',
            serialStart: config.serial_start ?? config.serialStart ?? 1,
            serialPadding: config.serial_padding ?? config.serialPadding ?? 0,
            serialIncrement: config.serial_increment ?? config.serialIncrement ?? true,
          });
          currentFields.add('Item code');
          changed = true;
        } else if (action.type === 'set_column_default') {
          if (!action.column) continue;
          const resp = await api.setColumnDefault(
            sessionId,
            action.column,
            action.value ?? '',
            action.only_empty !== false,
            action.condition || null
          );
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Default fill failed');
          changed = true;
        } else if (action.type === 'fill_required_defaults') {
          const defaults = action.defaults && typeof action.defaults === 'object' ? action.defaults : {};
          if (Object.keys(defaults).length === 0) continue;
          const resp = await api.fillRequiredDefaults(sessionId, defaults);
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Required defaults failed');
          setDefaultValues(prev => ({ ...prev, ...defaults }));
          changed = true;
        } else if (action.type === 'copy_column') {
          if (!action.source_column || !action.target_column) continue;
          const resp = await api.copyColumn(sessionId, action.source_column, action.target_column, action.only_empty === true);
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Copy column failed');
          changed = true;
        } else if (action.type === 'fill_missing_values') {
          if (!action.column || !action.target_mode || !action.strategy) continue;
          const resp = await api.fillMissingValues(
            sessionId,
            action.column,
            action.target_mode,
            Array.isArray(action.selected_values) ? action.selected_values : [],
            action.strategy,
            action.default_value || '',
            action.validation || {}
          );
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Fill missing values failed');
          changed = true;
        } else if (action.type === 'delete_rows' || action.type === 'delete_rows_conditional') {
          if (!action.column || !action.operator) continue;
          // New templates store one canonical delete_rows action per value.
          // Older BOM-validation templates grouped several values under
          // delete_rows_conditional, so keep replay support for those too.
          const compareValues = action.type === 'delete_rows_conditional'
            ? (Array.isArray(action.values) ? action.values : [])
            : [action.compare ?? ''];
          if (compareValues.length === 0) continue;
          // Replaying a deletion removes rows rather than overwriting cells, so
          // it is reported rather than applied silently: on a different file the
          // same condition can match a different number of rows, or none.
          let removed = 0;
          let remaining = null;
          for (const compare of compareValues) {
            const resp = await api.deleteRowsConditional(
              sessionId,
              action.column,
              action.operator,
              compare ?? ''
            );
            if (!resp.data?.success) throw new Error(resp.data?.error || 'Delete rows failed');
            removed += Number(resp.data.removed || 0);
            remaining = resp.data.remaining;
          }
          replayNotes.push(
            `${action.label || 'Delete rows'}: removed ${removed}, ${remaining} left`
          );
          changed = true;
        }
      } catch (error) {
        failures.push(action.label || action.type || 'Saved action');
      }
    }

    if (changed) {
      await fetchDataSynchronized();
    }
    if (failures.length > 0) {
      showSnackbar(`Template opened, but ${failures.length} saved tool action${failures.length === 1 ? '' : 's'} could not be replayed.`, 'warning');
    } else if (replayNotes.length > 0) {
      showSnackbar(`Saved template tools applied. ${replayNotes.join('; ')}.`, 'success');
    } else if (changed) {
      showSnackbar('Saved template tools applied to this workbook.', 'success');
    }
  }, [sessionId, columnDefs, fetchDataSynchronized, showSnackbar]);

  useEffect(() => {
    if (!isExistingProcessingTemplate || loading || error || !sessionId || !synchronizer.current) return;
    const template = processingTemplateContext?.selectedProcessingTemplate || location.state?.appliedProcessingTemplate;
    const actions = getPostMappingActionsFromTemplate(template);
    if (!template?.id || actions.length === 0) return;
    const replayKey = `${sessionId}:${template.id}`;
    if (replayedProcessingTemplateRef.current === replayKey) return;
    if (!columnDefs || columnDefs.filter(col => col.field && col.field !== '__row_number__').length === 0) return;

    replayedProcessingTemplateRef.current = replayKey;
    setLoading(true);
    replayPostMappingActions(actions)
      .catch((err) => {
        console.warn('Post-mapping template replay failed:', err);
        showSnackbar('Template opened, but saved final-page tools could not be fully applied.', 'warning');
      })
      .finally(() => setLoading(false));
  }, [
    isExistingProcessingTemplate,
    loading,
    error,
    sessionId,
    processingTemplateContext,
    location.state,
    columnDefs,
    getPostMappingActionsFromTemplate,
    replayPostMappingActions,
    showSnackbar,
  ]);

  // Determine if the current dataset is fresh with respect to expected Tag/Factwise columns
  const isDatasetFresh = useCallback((data, meta) => {
    try {
      const headers = Array.isArray(data?.headers) ? data.headers : [];
      const rows = Array.isArray(data?.data) ? data.data : [];
      const hasHeaders = headers.length > 0;
      if (!hasHeaders) return false;

      const hLower = headers.map(h => String(h || '').toLowerCase());
      const hasTag = headers.some(h => typeof h === 'string' && (h.startsWith('Tag_') || h === 'Tag'));
      const needTags = Array.isArray(meta?.formula_rules) && meta.formula_rules.some(r => (r?.column_type || 'Tag') === 'Tag');
      let tagValuesOk = true;
      if (needTags && hasTag && Array.isArray(rows) && rows.length > 0) {
        const tagHeaders = headers.filter(h => typeof h === 'string' && (h.startsWith('Tag_') || h === 'Tag'));
        tagValuesOk = rows.some(r => r && tagHeaders.some(h => String((r || {})[h] ?? '').trim() !== ''));
      }

      let itemOk = true;
      const needFactwise = Array.isArray(meta?.factwise_rules) && meta.factwise_rules.some(r => r?.type === 'factwise_id');
      if (needFactwise) {
        // find item code header
        let itemHeader = null;
        for (const h of headers) {
          const hl = String(h || '').trim().toLowerCase().replace(/\s+/g, '');
          if (hl === 'itemcode' || hl === 'item_code') { itemHeader = h; break; }
        }
        if (!itemHeader) itemOk = false;
        else if (rows.length > 0) {
          itemOk = rows.some(r => r && typeof r === 'object' && r[itemHeader] != null && String(r[itemHeader]).trim() !== '');
        }
      }

      // If we need tags and factwise, require both; otherwise require whichever is needed
      if (needTags && (!hasTag || !tagValuesOk)) return false;
      if (needFactwise && !itemOk) return false;
      return true;
    } catch (_) {
      return false;
    }
  }, []);

  // Ensure freshness by polling and re-applying formulas if needed (self-healing, no manual refresh)
  const ensureFreshnessIfNeeded = useCallback(async (initialData) => {
    if (staleGuardRef.current) return; // avoid concurrent loops
    try {
      // Load session metadata to determine rules in effect
      const metaResp = await api.getExistingMappings(sessionId);
      const sessionMeta = metaResp?.data?.session_metadata || {};

      if (isDatasetFresh(initialData, sessionMeta)) {
        setSyncNotice(prev => ({ ...prev, visible: false }));
        return;
      }

      // Begin self-healing refresh loop
      staleGuardRef.current = true;
      setSyncNotice(prev => ({ ...prev, visible: true, message: 'Preparing fresh results… syncing template rules…' }));

      const hasTagRules = Array.isArray(sessionMeta?.formula_rules) && sessionMeta.formula_rules.some(r => (r?.column_type || 'Tag') === 'Tag');
      let formulasReapplied = false;
      const deadline = Date.now() + 12000; // up to 12s
      while (Date.now() < deadline) {
        try {
          // Tag rules were removed; nothing re-applies them.

          // Force-fresh fetch using synchronizer budget
          const refreshed = await synchronizer.current.fetchDataFast(12000);
          const freshEnough = isDatasetFresh(refreshed?.data, sessionMeta);
          if (freshEnough) {
            // Replace grid with fresh data
            const data = refreshed?.data || {};
            // Update state
            const cols = [
              {
                headerName: '#',
                field: '__row_number__',
                valueGetter: 'node.rowIndex + 1',
                cellStyle: { backgroundColor: '#f8f9fa', fontWeight: 'bold', textAlign: 'center', borderRight: '2px solid #dee2e6', color: '#6c757d', padding: '12px' },
                headerClass: 'ag-header-row-number',
                width: 80,
                pinned: 'left',
                editable: false,
                filter: false,
                sortable: false,
                resizable: false,
                suppressMovable: true,
                suppressSizeToFit: true,
                suppressAutoSize: true
              },
              ...data.headers.filter(col => col && col.trim() !== '').map((col) => ({
                headerName: deriveDisplayName(col, data.headers),
                field: col,
                tooltipField: col,
              }))
            ];
            setColumnDefs(cols);
            setTotalRows(data.pagination?.total_rows || data.data?.length || 0);
            try { await fetchPageData(page, pageSize); } catch (_) {}
            setSyncNotice(prev => ({ ...prev, visible: false }));
            showSnackbar('Data synchronized', 'success');
            return;
          }
        } catch (_) {
          // continue polling
        }
        await new Promise(r => setTimeout(r, 500));
      }
      // Timed out — keep notice optionally visible for user to retry manually
    } finally {
      staleGuardRef.current = false;
    }
  }, [sessionId, isDatasetFresh, showSnackbar, fetchPageData, page, pageSize]);

  // ─── ENHANCED FACTWISE ID CREATION ──────────────────────────────────────────
  const runCreateFactwiseIdSynchronized = useCallback(async (strategy = 'fill_only_null') => {
    if (factwiseGenerationMode === 'columns' && (!firstColumn || !secondColumn)) {
      showSnackbar('Please select both columns for creating Factwise ID', 'error');
      return;
    }

    try {
      setLoading(true);
      const serialStart = Number(factwiseSerialStart) || 1;
      const serialPadding = Math.max(0, Number(factwiseSerialPadding) || 0);
      
      const syncResult = await synchronizer.current.createFactWiseIdSynchronized(
        firstColumn, 
        secondColumn, 
        operator, 
        strategy,
        {
          generationMode: factwiseGenerationMode,
          serialPrefix: factwiseSerialPrefix,
          serialStart,
          serialPadding,
          // This path writes Item code, which must be unique — a serial that
          // does not advance gives every row the same code.
          serialIncrement: true
        }
      );

      if (syncResult.success) {
        setFactwiseIdRule({
          firstColumn,
          secondColumn,
          operator,
          strategy,
          generationMode: factwiseGenerationMode,
          serialPrefix: factwiseSerialPrefix,
          serialStart,
          serialPadding,
          // This path writes Item code, which must be unique — a serial that
          // does not advance gives every row the same code.
          serialIncrement: true
        });
        recordPostMappingAction({
          type: 'factwise_id',
          label: 'Create FactWise ID',
          config: {
            first_column: firstColumn,
            second_column: secondColumn,
            operator,
            strategy,
            generation_mode: factwiseGenerationMode,
            serial_prefix: factwiseSerialPrefix,
            serial_start: serialStart,
            serial_padding: serialPadding,
            serial_increment: true,
          },
        });
        const responseVersion = syncResult?.result?.data?.template_version;
        if (typeof responseVersion === 'number') {
          setSessionVersion(responseVersion);
        }
        
        updateDataIntegrity(true, []);
        await fetchDataSynchronized();
        setSyncNotice(prev => ({ ...prev, visible: false }));

        showSnackbar('FactWise ID created successfully! All columns are now synchronized.', 'success');
        handleCloseFactwiseIdDialog();
      } else {
        showSnackbar('Failed to create FactWise ID', 'error');
      }
    } catch (error) {
      console.error('❌ FactWise ID creation failed:', error);
      showSnackbar(`Failed to create FactWise ID: ${error.message}`, 'error');
      updateDataIntegrity(false, [error.message]);
    } finally {
      setLoading(false);
    }
  }, [firstColumn, secondColumn, operator, factwiseGenerationMode, factwiseSerialPrefix, factwiseSerialStart, factwiseSerialPadding, factwiseSerialIncrement, showSnackbar, fetchDataSynchronized, updateDataIntegrity, recordPostMappingAction]);

  const handleCreateFactwiseIdSynchronized = useCallback(async () => {
    if (factwiseGenerationMode === 'columns' && (!firstColumn || !secondColumn)) {
      showSnackbar('Please select both columns for creating Factwise ID', 'error');
      return;
    }

    const itemCodeCol = columnDefs.find(c => {
      const name = String(c.headerName || c.field || '').toLowerCase();
      return name === 'item code' || name === 'item_code';
    });
    const hasExisting = itemCodeCol && rowData.some(r => {
      const v = r[itemCodeCol.field];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });

    if (hasExisting) {
      setFactwiseStrategyDialogOpen(true);
      return;
    }

    await runCreateFactwiseIdSynchronized('fill_only_null');
  }, [firstColumn, secondColumn, factwiseGenerationMode, columnDefs, rowData, showSnackbar, runCreateFactwiseIdSynchronized]);

  // ─── ENHANCED FORMULA APPLICATION ───────────────────────────────────────────
  const handleApplyFormulasSynchronized = useCallback(async (formulaResult) => {
    try {
      setLoading(true);
      
      const syncResult = await synchronizer.current.applyFormulasSynchronized(formulaResult.formula_rules || []);
      
      if (syncResult.success) {
        setHasFormulas(true);
        
        // Prefer server-confirmed rules with stable Tag_N targets
        const serverRules = syncResult?.result?.data?.snapshot?.formula_rules;
        const effectiveRules = Array.isArray(serverRules) && serverRules.length > 0
          ? serverRules
          : (formulaResult.formula_rules || []);

        // Update formula columns
        const allFormulaColumns = formulaResult.headers?.filter(h => 
          h.startsWith('Tag_') || 
          h.startsWith('Specification_Name_') || 
          h.startsWith('Specification_Value_') || 
          h.startsWith('Custom_Identification_') ||
          h === 'Tag' || 
          h.includes('Specification') || 
          h.includes('Customer')
        ) || [];
        setFormulaColumns(allFormulaColumns);
        setAppliedFormulas(effectiveRules);
        
        // Update dynamic column counts
        const newHeaders = formulaResult.headers || [];
        const tagColumns = newHeaders.filter(h => h.startsWith('Tag_') || h === 'Tag');
        const specColumns = newHeaders.filter(h => h.startsWith('Specification_Name_') || h === 'Specification name');
        const customerColumns = newHeaders.filter(h => h.startsWith('Custom_Identification_Name_') || h === 'Custom identification name' || h === 'Custom identification name');
        
        const newCounts = {
          tags_count: Math.max(dynamicColumnCounts.tags_count, tagColumns.length),
          spec_pairs_count: Math.max(dynamicColumnCounts.spec_pairs_count, Math.ceil(specColumns.length / 2)),
          customer_id_pairs_count: Math.max(dynamicColumnCounts.customer_id_pairs_count, Math.ceil(customerColumns.length / 2))
        };
        
        setDynamicColumnCounts(newCounts);
        
        // Refresh data to show new columns
        if (syncResult.validationData && syncResult.validationData.success) {
          await fetchDataSynchronized();
        }
        
        showSnackbar(
          `Formulas applied successfully! Added ${formulaResult.new_columns?.length || 0} new columns. All data synchronized.`,
          'success'
        );
        
        updateDataIntegrity(true, []);
      } else {
        throw new Error('Formula application failed validation');
      }
    } catch (error) {
      console.error('❌ Formula application failed:', error);
      showSnackbar(`Failed to apply formulas: ${error.message}`, 'error');
      updateDataIntegrity(false, [error.message]);
    } finally {
      setLoading(false);
    }
  }, [showSnackbar, fetchDataSynchronized, dynamicColumnCounts, updateDataIntegrity]);

  // ─── ENHANCED TEMPLATE APPLICATION ──────────────────────────────────────────
  const handleApplyTemplateSynchronized = useCallback(async (template) => {
    try {
      setLoading(true);
      // Read current server version, so we can wait for a bump
      let prevVersion = 0;
      try {
        const status = await api.getSessionStatus(sessionId);
        prevVersion = status.data?.template_version ?? 0;
      } catch (_) {}

      const syncResult = await synchronizer.current.applyTemplateSynchronized(template.id);
      
      if (syncResult.success) {
        // Update template-related state
        if (template.formula_rules && template.formula_rules.length > 0) {
          setHasFormulas(true);
          setAppliedFormulas(template.formula_rules);
          // Immediately materialize Tag rules so Tag_N values appear without manual apply
          try {
            await synchronizer.current.applyFormulasSynchronized(template.formula_rules);
            await fetchDataSynchronized();
          } catch (_) {}
        }
        
        // Handle factwise ID rule if present
        if (template.factwise_rules && template.factwise_rules.length > 0) {
          const factwiseRule = template.factwise_rules.find(rule => rule.type === "factwise_id");
          if (factwiseRule) {
            const { first_column, second_column, operator } = factwiseRule;
            await synchronizer.current.createFactWiseIdSynchronized(
              first_column,
              second_column,
              operator,
              factwiseRule.strategy || 'fill_only_null',
              {
                generationMode: factwiseRule.generation_mode || 'columns',
                serialPrefix: factwiseRule.serial_prefix || '',
                serialStart: factwiseRule.serial_start ?? 1,
                serialPadding: factwiseRule.serial_padding ?? 0,
                serialIncrement: factwiseRule.serial_increment !== false
              }
            );
            
            setFactwiseIdRule({
              firstColumn: first_column,
              secondColumn: second_column,
              operator: operator,
              strategy: factwiseRule.strategy || 'fill_only_null',
              generationMode: factwiseRule.generation_mode || 'columns',
              serialPrefix: factwiseRule.serial_prefix || '',
              serialStart: factwiseRule.serial_start ?? 1,
              serialPadding: factwiseRule.serial_padding ?? 0,
              serialIncrement: factwiseRule.serial_increment !== false
            });
          }
        }

        // Handle MPN validation metadata if present
        if (template.mpn_validation_metadata && Object.keys(template.mpn_validation_metadata).length > 0) {
          const { mpn_column, validation_completed } = template.mpn_validation_metadata;
          if (mpn_column) {
            setMpnColumn(mpn_column);
            // Store as original column for future template saving (this is the source column)
            setOriginalMpnColumn(mpn_column);
          }
          if (validation_completed) {
            setMpnValidationCompleted(true);
          }
        }

        // Wait for version bump and then refresh data to show all changes
        try {
          await api.waitUntilFresh(sessionId, prevVersion, 8000);
        } catch (_) { /* proceed */ }
        await fetchDataSynchronized();
        
        sessionStorage.setItem('templateAppliedInDataEditor', 'true');
        sessionStorage.setItem('lastTemplateApplied', template.name);

        showSnackbar(`Template "${template.name}" applied successfully! All data synchronized.`, 'success');
        setTemplateChooseDialogOpen(false);
        setSelectedTemplate(null);
        
        updateDataIntegrity(true, []);
      } else {
        throw new Error('Template application failed validation');
      }
    } catch (error) {
      console.error('❌ Template application failed:', error);
      showSnackbar(`Failed to apply template: ${error.message}`, 'error');
      updateDataIntegrity(false, [error.message]);
    } finally {
      setLoading(false);
    }
  }, [showSnackbar, fetchDataSynchronized, updateDataIntegrity]);

  const dataColumnFields = useMemo(() => (
    (columnDefs || [])
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field)
  ), [columnDefs]);

  // Keep the slot counts in step with the sheet actually loaded.
  //
  // These start at 1/1/1 and used to stay there, but `handleBackToMapping`
  // posts them to the session on the way to Modify Mappings. Opening the editor
  // and clicking through therefore rewrote a 3-specification sheet as a
  // 1-specification one, and the mapping page then rebuilt the headers to
  // match — dropping the other two triplets and moving columns about.
  useEffect(() => {
    if (!dataColumnFields.length) return;
    // Headers reach the grid in either shape depending on the session — the
    // internal 'Specification_Name_2' or the label 'Specification name (2)'.
    // Matching only the first read zero slots on a label-form sheet and
    // reported 1, which is exactly the value that shrank the sheet.
    const highestSlot = (internalPrefix, label) => dataColumnFields.reduce((best, field) => {
      const name = String(field || '').trim();
      const internal = new RegExp(`^${internalPrefix}_(\d+)$`, 'i').exec(name);
      if (internal) return Math.max(best, parseInt(internal[1], 10));
      const labelled = new RegExp(`^${label}\s*\((\d+)\)$`, 'i').exec(name);
      if (labelled) return Math.max(best, parseInt(labelled[1], 10));
      // An unnumbered repeat ('Tag') still counts as one slot.
      return name.toLowerCase() === label.toLowerCase() ? Math.max(best, 1) : best;
    }, 0);
    const next = {
      tags_count: highestSlot('Tag', 'Tag'),
      spec_pairs_count: highestSlot('Specification_Name', 'Specification name'),
      customer_id_pairs_count: highestSlot('Custom_Identification_Name', 'Custom identification name'),
    };
    setDynamicColumnCounts(prev => {
      // Never below what the sheet holds, and never a needless re-render.
      const merged = {
        tags_count: Math.max(prev.tags_count || 0, next.tags_count),
        spec_pairs_count: Math.max(prev.spec_pairs_count || 0, next.spec_pairs_count),
        customer_id_pairs_count: Math.max(prev.customer_id_pairs_count || 0, next.customer_id_pairs_count),
      };
      const same = merged.tags_count === prev.tags_count
        && merged.spec_pairs_count === prev.spec_pairs_count
        && merged.customer_id_pairs_count === prev.customer_id_pairs_count;
      return same ? prev : merged;
    });
  }, [dataColumnFields]);

  useEffect(() => {
    if (dataColumnFields.length > 0) {
      writeItemDirectoryColumnOptions(dataColumnFields);
    }
  }, [dataColumnFields]);

  const createColumnTargetExists = useMemo(() => {
    const target = String(createColumnTarget || '').trim();
    return Boolean(target && dataColumnFields.includes(target));
  }, [createColumnTarget, dataColumnFields]);

  const createColumnTargetHasData = useMemo(() => {
    const target = String(createColumnTarget || '').trim();
    if (!target || !Array.isArray(rowData)) return false;
    return rowData.some(row => {
      const value = row?.[target];
      return value !== null && value !== undefined && String(value).trim() !== '';
    });
  }, [createColumnTarget, rowData]);

  // Item code has to be unique, so a serial that does not advance writes the
  // same code to every row — a sheet FactWise rejects outright. The choice is
  // offered for other columns, where repeating a value is legitimate.
  const serialMustIncrement = useMemo(() => {
    const target = String(createColumnTarget || '').trim().toLowerCase();
    return target === 'item code';
  }, [createColumnTarget]);
  const effectiveSerialIncrement = serialMustIncrement ? true : factwiseSerialIncrement;

  const getMatchingDataColumnField = useCallback((columnName) => {
    const wanted = String(columnName || '').trim().toLowerCase();
    if (!wanted) return '';
    return dataColumnFields.find(field => String(field).trim().toLowerCase() === wanted) || '';
  }, [dataColumnFields]);

  const applySavedItemCodeFillSettings = useCallback(() => {
    const itemCodeField = getMatchingDataColumnField('Item code');
    if (!itemCodeField) return false;

    const saved = readItemDirectoryDefaults();
    const mode = ['fixed', 'copy', 'concat', 'conditional', 'serial'].includes(saved.itemCodeContentType)
      ? saved.itemCodeContentType
      : 'serial';
    const rowsMode = ['fill_empty', 'overwrite', 'duplicates'].includes(saved.itemCodeRowsToUpdate)
      ? saved.itemCodeRowsToUpdate
      : 'fill_empty';
    const matchSavedColumn = (name) => getMatchingDataColumnField(name);
    const firstColumn = matchSavedColumn(saved.itemCodeCopyFromColumn || saved.itemCodeJoinFirstColumn);
    const secondColumn = matchSavedColumn(saved.itemCodeJoinSecondColumn);
    const separatorMode = saved.itemCodeJoinSeparatorMode || 'space';
    const separator = separatorMode === 'custom'
      ? (saved.itemCodeJoinCustomSeparator || '')
      : (ITEM_CODE_SEPARATOR_FROM_MODE[separatorMode] ?? ' ');
    const thenSource = ['default', 'column', 'empty'].includes(saved.itemCodeConditionValueSource)
      ? saved.itemCodeConditionValueSource
      : 'default';
    const elseSource = ['default', 'column', 'empty'].includes(saved.itemCodeElseValueSource)
      ? saved.itemCodeElseValueSource
      : 'default';
    const savedConditionalBranches = Array.isArray(saved.itemCodeConditionalBranches) && saved.itemCodeConditionalBranches.length
      ? saved.itemCodeConditionalBranches
      : [{
        column: saved.itemCodeConditionSourceColumn,
        operator: saved.itemCodeConditionOperator,
        compare: saved.itemCodeConditionText,
        outputType: saved.itemCodeConditionValueSource,
        outputValue: saved.itemCodeConditionDefaultValue,
        outputColumn: saved.itemCodeConditionValueColumn,
      }];

    setCreateColumnTab(0);
    setCreateColumnTarget(itemCodeField);
    setCreateColumnNewName('');
    setCreateColumnContentType(mode);
    setCreateColumnMode(rowsMode);
    setDefaultValue(saved.itemCodeDefaultValue || '');
    setCreateColumnFirst(firstColumn || (dataColumnFields.find(field => field !== itemCodeField) || ''));
    setCreateColumnSecond(secondColumn || dataColumnFields.find(field => field !== itemCodeField && field !== firstColumn) || '');
    setCreateColumnSeparatorMode(separatorMode);
    setCreateColumnCustomSeparator(saved.itemCodeJoinCustomSeparator || '');
    setCreateColumnSeparator(separator);
    // `??`, not `||`: an empty prefix and a padding of 0 are both meaningful
    // answers, and `||` treated them as "unset". A user who cleared the Prefix
    // box in Settings still got codes reading ITEM001, and "no padding" was
    // unreachable because 0 became 2. The fallbacks also have to be the ones
    // Settings itself shows, or the preview and the result disagree.
    setFactwiseSerialPrefix(saved.itemCodePrefix ?? '');
    setFactwiseSerialStart(saved.itemCodeStart ?? 1);
    setFactwiseSerialPadding(saved.itemCodePadding ?? 3);
    setFactwiseSerialIncrement(saved.itemCodeIncrement !== false);
    setConditionalBranches(savedConditionalBranches.map(branch => ({
      ...createConditionalBranch(),
      column: matchSavedColumn(branch?.column),
      operator: branch?.operator || 'contains',
      compare: branch?.compare || '',
      outputType: ['default', 'column', 'empty'].includes(branch?.outputType) ? branch.outputType : thenSource,
      outputValue: branch?.outputValue || '',
      outputColumn: matchSavedColumn(branch?.outputColumn),
    })));
    setCondElseSourceType(elseSource);
    setCondElse(saved.itemCodeElseDefaultValue || '');
    setCondElseColumn(matchSavedColumn(saved.itemCodeElseValueColumn));
    return true;
  }, [dataColumnFields, getMatchingDataColumnField]);

  const handleOpenCreateColumnDialog = useCallback((tab = 0) => {
    const fields = dataColumnFields;
    if (tab === 0 && applySavedItemCodeFillSettings()) {
      setCreateColumnDialogOpen(true);
      return;
    }
    setCreateColumnTab(tab);
    setCreateColumnTarget(prev => prev || (fields.includes('Item name') ? 'Item name' : ''));
    if (!createColumnFirst && fields.length > 0) {
      setCreateColumnFirst(fields[0]);
    }
    if (!createColumnSecond && fields.length > 1) {
      const first = createColumnFirst || fields[0];
      setCreateColumnSecond(fields.find(field => field !== first) || fields[1]);
    }
    setCreateColumnDialogOpen(true);
  }, [dataColumnFields, createColumnFirst, createColumnSecond, applySavedItemCodeFillSettings]);

  useEffect(() => {
    if (!createColumnDialogOpen) return;
    let cancelled = false;
    api.getColumnRules()
      .then(res => { if (!cancelled) setSavedColumnRules(res?.data?.rules || []); })
      .catch(() => { if (!cancelled) setSavedColumnRules([]); });
    return () => { cancelled = true; };
  }, [createColumnDialogOpen]);

  // Rules saved for the column being filled come first; one match is picked
  // automatically so the common case is two clicks.
  const { preferredColumnRules, otherColumnRules } = useMemo(() => {
    const target = String(createColumnTab === 0 ? createColumnTarget : createColumnNewName).trim();
    const preferred = [];
    const others = [];
    (savedColumnRules || []).forEach(saved => {
      if (target && String(saved.target_column || '').trim() === target) preferred.push(saved);
      else others.push(saved);
    });
    return { preferredColumnRules: preferred, otherColumnRules: others };
  }, [savedColumnRules, createColumnTarget, createColumnNewName, createColumnTab]);

  useEffect(() => {
    if (createColumnContentType !== 'saved_rule') return;
    if (preferredColumnRules.length === 1) setSelectedColumnRuleId(preferredColumnRules[0].id);
  }, [createColumnContentType, preferredColumnRules]);

  const handleCloseCreateColumnDialog = useCallback(() => {
    setCreateColumnDialogOpen(false);
    if (returnToRequiredGuardRef.current && pendingExportRef.current) {
      returnToRequiredGuardRef.current = false;
      setRequiredDialogOpen(true);
    }
  }, []);

  const handleCreateConcatenatedColumn = useCallback(async () => {
    const target = String(createColumnTab === 0 ? createColumnTarget : createColumnNewName).trim();
    if (!target) {
      showSnackbar(createColumnTab === 0 ? 'Select a column to fill' : 'Enter a new column name', 'warning');
      return;
    }
    if (createColumnTab === 1 && dataColumnFields.includes(target)) {
      showSnackbar('That column already exists. Use the Fill existing tab.', 'warning');
      return;
    }
    if (createColumnContentType === 'concat' && (!createColumnFirst || !createColumnSecond)) {
      showSnackbar('Select two source columns', 'warning');
      return;
    }
    if (createColumnContentType === 'copy' && !createColumnFirst) {
      showSnackbar('Select a source column', 'warning');
      return;
    }
    if (createColumnContentType === 'conditional' && conditionalBranches.some(branch => !branch.column)) {
      showSnackbar('Select a source column for every condition', 'warning');
      return;
    }
    if (createColumnContentType === 'conditional' && conditionalBranches.some(branch => branch.outputType === 'column' && !branch.outputColumn)) {
      showSnackbar('Select the output column for every column-based result', 'warning');
      return;
    }
    if (createColumnContentType === 'conditional' && condElseSourceType === 'column' && !condElseColumn) {
      showSnackbar('Select the column used when the condition does not match', 'warning');
      return;
    }

    // A saved rule already carries how to compute the value; only where it
    // lands and which rows it touches come from this dialog.
    if (createColumnContentType === 'saved_rule') {
      const saved = (savedColumnRules || []).find(r => String(r.id) === String(selectedColumnRuleId));
      if (!saved) {
        showSnackbar('Select a saved rule', 'warning');
        return;
      }
      try {
        setCreateColumnSaving(true);
        const rule = {
          ...(saved.rule || {}),
          target_mode: createColumnTab === 0 ? 'existing' : 'new',
          target_column: target,
          write_mode: createColumnTab === 0 ? createColumnMode : 'overwrite',
        };
        const response = await api.fillOrCreateColumn(sessionId, rule);
        if (!response.data?.success) throw new Error(response.data?.error || 'Column update failed');
        recordPostMappingAction({
          type: 'fill_or_create_column',
          label: `${target} — ${saved.name}`,
          rule: response.data.rule || rule,
        });
        setCreateColumnDialogOpen(false);
        await fetchDataSynchronized();
        showSnackbar(`Applied "${saved.name}" to ${target} across ${response.data.changed || 0} cells.`, 'success');
      } catch (error) {
        showSnackbar(error.response?.data?.error || error.message || 'Failed to apply the rule', 'error');
      } finally {
        setCreateColumnSaving(false);
      }
      return;
    }

    try {
      setCreateColumnSaving(true);
      const condition = createColumnContentType === 'conditional'
        ? {
            branches: conditionalBranches.map(branch => ({
              column: branch.column,
              operator: branch.operator,
              compare: (branch.compareValues && branch.compareValues.length)
                ? branch.compareValues
                : branch.compare,
              output_value: branch.outputType === 'empty' ? '' : branch.outputValue,
              ...(branch.outputType === 'column' ? { output_source_column: branch.outputColumn } : {}),
            })),
            ...(condElseSourceType === 'column' ? { else_source_column: condElseColumn } : {}),
            ...(condElseSourceType === 'empty'
              ? { else: '' }
              : (String(condElse).trim() !== '' ? { else: condElse } : {})),
          }
        : null;
      const rule = {
        type: 'column_value',
        target_mode: createColumnTab === 0 ? 'existing' : 'new',
        target_column: target,
        value_mode: createColumnContentType,
        source_columns: createColumnContentType === 'copy'
          ? [createColumnFirst]
          : (createColumnContentType === 'concat' ? [createColumnFirst, createColumnSecond] : []),
        separator: createColumnSeparator,
        fixed_value: defaultValue,
        write_mode: createColumnTab === 0 ? createColumnMode : 'overwrite',
        condition,
        serial_prefix: factwiseSerialPrefix,
        serial_start: factwiseSerialStart,
        serial_padding: factwiseSerialPadding,
        serial_increment: effectiveSerialIncrement,
      };
      const response = await api.fillOrCreateColumn(sessionId, rule);
      if (!response.data?.success) throw new Error(response.data?.error || 'Column update failed');
      recordPostMappingAction({
        type: 'fill_or_create_column',
        label: `${target} fill/create rule`,
        rule: response.data.rule || rule,
      });
      setCreateColumnDialogOpen(false);
      await fetchDataSynchronized();
      showSnackbar(`${target} updated across ${response.data.changed || 0} cells. Rule saved for template reuse.`, 'success');
      if (returnToRequiredGuardRef.current) {
        returnToRequiredGuardRef.current = false;
        const fn = pendingExportRef.current;
        if (fn && requiredGuardRunnerRef.current) requiredGuardRunnerRef.current(fn);
      }
    } catch (error) {
      console.error('Create column failed:', error);
      showSnackbar(error.response?.data?.error || error.message || 'Failed to create column', 'error');
    } finally {
      setCreateColumnSaving(false);
    }
  }, [
    createColumnTarget,
    createColumnNewName,
    createColumnTab,
    createColumnContentType,
    createColumnFirst,
    createColumnSecond,
    createColumnSeparator,
    createColumnMode,
    dataColumnFields,
    defaultValue,
    condElse,
    condElseSourceType,
    condElseColumn,
    conditionalBranches,
    factwiseSerialPrefix,
    factwiseSerialStart,
    factwiseSerialPadding,
    factwiseSerialIncrement,
    sessionId,
    showSnackbar,
    fetchDataSynchronized,
    recordPostMappingAction,
    savedColumnRules,
    selectedColumnRuleId
  ]);

  const handleOpenFactwiseIdDialog = useCallback(() => {
    setFactwiseIdDialogOpen(true);
  }, []);

  const handleCloseFactwiseIdDialog = useCallback(() => {
    setFactwiseIdDialogOpen(false);
    setFactwiseStrategyDialogOpen(false);
    setFirstColumn('');
    setSecondColumn('');
    setOperator('_');
    setFactwiseGenerationMode('columns');
    setFactwiseSerialPrefix('ITEM');
    setFactwiseSerialStart(1);
    setFactwiseSerialPadding(2);
    setFactwiseSerialIncrement(true);
  }, []);

  // ─── MANUAL REFRESH FUNCTION ────────────────────────────────────────────────
  const handleManualRefresh = useCallback(async () => {
    try {
      setLoading(true);
      showSnackbar('Refreshing data...', 'info');
      await fetchDataSynchronized();
      showSnackbar('Data refreshed successfully!', 'success');
    } catch (error) {
      console.error('Manual refresh failed:', error);
      showSnackbar(`Refresh failed: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchDataSynchronized, showSnackbar]);

  // Accurate text measurement using an offscreen canvas
  const getMeasureContext = useCallback(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Match the table font for better accuracy
    // Header is bold in UI but we keep a single font for simplicity
    ctx.font = '14px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
    return ctx;
  }, []);

  const computeColumnWidthPx = useCallback((col) => {
    if (!col || !col.field) return 180;
    const ctx = getMeasureContext();
    const header = String(col.headerName || col.field || '');
    let max = ctx.measureText(header).width;
    // Sample rows to keep complexity bounded for large datasets
    const cap = 300;
    const sample = Array.isArray(rowData) && rowData.length > cap ? rowData.slice(0, cap) : (rowData || []);
    for (const row of sample) {
      const v = row[col.field];
      if (v == null) continue;
      const w = ctx.measureText(String(v)).width;
      if (w > max) max = w;
    }
    // Add padding/borders allowance
    const padded = max + 40; // 16px left + 16px right + borders/margin
    return Math.min(1600, Math.max(100, Math.ceil(padded)));
  }, [getMeasureContext, rowData]);

  // Auto-apply fit once after data loads to ensure clean view
  useEffect(() => {
    if (autoFitApplied) return;
    if (!columnDefs || columnDefs.length === 0) return;
    if (!rowData || rowData.length === 0) return;
    // Skip heavy auto-fit for very large datasets; user can trigger manually
    if (rowData.length > 2000) return;
    const next = {};
    columnDefs.forEach(col => {
      if (!col.field || col.field === '__row_number__') return;
      next[col.field] = computeColumnWidthPx(col);
    });
    if (Object.keys(next).length > 0) {
      setColumnWidths(prev => ({ ...prev, ...next }));
      setAutoFitApplied(true);
    }
  }, [columnDefs, rowData, autoFitApplied, computeColumnWidthPx]);

  // Virtualization: compute visible range on scroll/resize (disabled for paging by resetting to full page)
  const recomputeVisibleRange = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop || 0;
    const viewport = el.clientHeight || 0;
    const total = rowData.length;
    if (viewport <= 0) {
      setVisibleRange({ start: 0, end: total });
      return;
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 10); // buffer rows
    const visibleCount = Math.max(1, Math.ceil(viewport / rowHeight) + 20);
    const end = Math.min(total, start + visibleCount);
    setVisibleRange({ start, end });
  }, [rowData.length, rowHeight]);

  useEffect(() => {
    // Initialize visible range and attach listeners
    recomputeVisibleRange();
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => recomputeVisibleRange();
    el.addEventListener('scroll', onScroll);
    const onResize = () => recomputeVisibleRange();
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [recomputeVisibleRange]);

  // Ensure full page range on any page change
  useEffect(() => {
    setVisibleRange({ start: 0, end: rowData.length });
  }, [rowData.length, page]);

  // Auto-fit all columns to content using measured pixel widths
  const handleAutoFitAll = useCallback(() => {
    try {
      const next = {};
      (columnDefs || []).forEach(col => {
        if (!col.field || col.field === '__row_number__') return;
        next[col.field] = computeColumnWidthPx(col);
      });
      setColumnWidths(prev => ({ ...prev, ...next }));
      showSnackbar('Auto-fit applied to all columns', 'success');
    } catch (e) {
      showSnackbar('Auto-fit failed', 'error');
    }
  }, [columnDefs, computeColumnWidthPx, showSnackbar]);

  // ─── SAVE TEMPLATE (EDITOR) ────────────────────────────────────────────────
  useEffect(() => {
    if (isNewProcessingTemplate && !templateName) {
      setTemplateName(processingTemplateName);
    }
  }, [isNewProcessingTemplate, processingTemplateName, templateName]);

  const handleCloseSaveTemplateDialog = useCallback(() => {
    setTemplateSaveDialogOpen(false);
    setTemplateName('');
    setTemplateNameError('');
  }, []);

  const handleSaveTemplateSynchronized = useCallback(async (nameOverride = '') => {
    const saveName = String(nameOverride || templateName || '').trim();
    if (!saveName) {
      showSnackbar('Please enter a template name', 'error');
      return;
    }
    if (isExistingProcessingTemplate) {
      showSnackbar('Existing templates cannot be saved from this run. Use Modify Template later.', 'info');
      return;
    }
    try {
      setTemplateSaving(true);
      const opStart = Date.now();
      const counts = dynamicColumnCounts || { tags_count: 1, spec_pairs_count: 1, customer_id_pairs_count: 1 };
      const editorDefaults = defaultValues || {};
      const rules = Array.isArray(appliedFormulas) ? appliedFormulas : [];
      let currentMappings = null;
      let currentFactwiseRules = null;
      // Defaults and conditional if/else rules set on the mapping page live on the
      // session and are never loaded into this page's state. They have to be read
      // back and merged: the backend treats a non-null default_values as a full
      // replace, so sending only the editor's dict silently dropped the mapping
      // page's defaults from the template the moment anyone set one default here.
      let sessionDefaults = {};
      let sessionDefaultRules = {};

      try {
        const existing = await api.getExistingMappings(sessionId);
        currentMappings = existing?.data?.mappings || null;
        currentFactwiseRules = existing?.data?.session_metadata?.factwise_rules || null;
        if (existing?.data?.default_values && typeof existing.data.default_values === 'object') {
          sessionDefaults = existing.data.default_values;
        }
        if (existing?.data?.default_value_rules && typeof existing.data.default_value_rules === 'object') {
          sessionDefaultRules = existing.data.default_value_rules;
        }
      } catch (_) {}

      // Editor-side defaults win on conflict — they are the more recent edit.
      const defaults = { ...sessionDefaults, ...editorDefaults };

      if ((!currentFactwiseRules || currentFactwiseRules.length === 0) && factwiseIdRule) {
        currentFactwiseRules = [{
          type: 'factwise_id',
          first_column: factwiseIdRule.firstColumn,
          second_column: factwiseIdRule.secondColumn,
          operator: factwiseIdRule.operator || '_',
          strategy: factwiseIdRule.strategy || 'fill_only_null',
          generation_mode: factwiseIdRule.generationMode || 'columns',
          serial_prefix: factwiseIdRule.serialPrefix || '',
          serial_start: factwiseIdRule.serialStart ?? 1,
          serial_padding: factwiseIdRule.serialPadding ?? 0,
          serial_increment: factwiseIdRule.serialIncrement !== false
        }];
      }

      // Include MPN validation metadata if completed
      const mpnValidationMetadata = mpnValidationCompleted ? {
        mpn_column: originalMpnColumn || mpnColumn, // Use original source column, not validation result column
        manufacturer_column: mpnManufacturerColumn,
        validation_completed: true
      } : null;

      const resp = await api.saveMappingTemplate(
        sessionId,
        saveName,
        `Saved from Data Editor (${rules.length} tag rules${mpnValidationCompleted ? ', MPN validated' : ''})`,
        currentMappings,
        rules,
        currentFactwiseRules,
        Object.keys(defaults).length > 0 ? defaults : null,
        counts,
        mpnValidationMetadata,
        {
          overwriteExisting: isNewProcessingTemplate,
          defaultValueRules: Object.keys(sessionDefaultRules).length > 0 ? sessionDefaultRules : null,
        }
      );
      if (resp?.data?.success && processingTemplateContext) {
        const existingTemplateForActions =
          processingTemplateContext?.selectedProcessingTemplate ||
          location.state?.appliedProcessingTemplate ||
          null;
        const existingPostActions = getPostMappingActionsFromTemplate(existingTemplateForActions);
        const currentPostActions = buildPostMappingActionsForSave(currentFactwiseRules || [], defaults, rules);
        const postActions = mergePostMappingActions(existingPostActions, currentPostActions);
        let providerSnapshot = {};
        try {
          providerSnapshot = {
            selected_providers: JSON.parse(localStorage.getItem('mpn_validation_providers') || '[]'),
            column_provider_mappings: JSON.parse(localStorage.getItem('mpn_column_provider_mappings') || '[]'),
          };
        } catch (_) {
          providerSnapshot = {};
        }

        await api.saveProcessingTemplate({
          name: saveName,
          description: 'Saved workflow from mapped data editor',
          status: 'active',
          version: 1,
          sourceRequirements: processingTemplateContext.sourceRequirements || {},
          providerSnapshot,
          stages: [
            ...(processingTemplateContext.normalizerWorkflow ? [{
              type: 'bom_normalizer',
              workflow: processingTemplateContext.normalizerWorkflow,
            }] : []),
            {
              type: 'mapping_template',
              mapping_template_id: resp.data.template_id,
              mapping_template_name: saveName,
              session_id: sessionId,
            },
            {
              type: 'mapped_data_editor',
              column_counts: counts,
              formula_rules_count: rules.length,
              has_factwise_rules: Array.isArray(currentFactwiseRules) && currentFactwiseRules.length > 0,
              mpn_validation_metadata: mpnValidationMetadata || {},
              post_mapping_actions: postActions,
            }
          ],
          metadata: {
            mapping_template_id: resp.data.template_id,
            processing_path: processingTemplateContext.processingPath || '',
            ...(processingTemplateContext.normalizerWorkflow ? {
              normalizer_workflow: processingTemplateContext.normalizerWorkflow,
            } : {}),
            saved_from_session_id: sessionId,
            post_mapping_actions: postActions,
          }
        });
        setPostMappingActions(postActions);
      }
      const elapsed = Date.now() - opStart;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      if (resp?.data?.success) {
        const wasUpdate = Boolean(resp.data.updated);
        setTemplateSaved(true);
        setTemplateNameError('');
        showSnackbar(`Template "${saveName}" ${wasUpdate ? 'updated' : 'saved'} successfully!`, 'success');
        handleCloseSaveTemplateDialog();
      } else {
        showSnackbar(resp?.data?.error || 'Failed to save template', 'error');
      }
    } catch (e) {
      const duplicateName = e?.response?.status === 409 ||
        e?.response?.data?.code === 'duplicate_template_name' ||
        String(e?.response?.data?.error || '').toLowerCase().includes('already exists');
      if (duplicateName) {
        setTemplateName(saveName);
        setTemplateSaveDialogOpen(true);
        setTemplateNameError('A template with this name already exists. Enter a different name.');
      } else {
        showSnackbar(e?.response?.data?.error || 'Failed to save template', 'error');
      }
    } finally {
      setTemplateSaving(false);
    }
  }, [sessionId, templateName, dynamicColumnCounts, defaultValues, appliedFormulas, factwiseIdRule, mpnValidationCompleted, originalMpnColumn, mpnColumn, mpnManufacturerColumn, isExistingProcessingTemplate, isNewProcessingTemplate, processingTemplateContext, location.state, showSnackbar, handleCloseSaveTemplateDialog, buildPostMappingActionsForSave, getPostMappingActionsFromTemplate, mergePostMappingActions]);

  const handleSaveTemplateFromToolbar = useCallback(() => {
    if (isExistingProcessingTemplate) {
      showSnackbar('Existing templates cannot be saved from this run. Use Modify Template later.', 'info');
      return;
    }
    if (isNewProcessingTemplate) {
      handleSaveTemplateSynchronized(processingTemplateName);
      return;
    }
    setTemplateSaveDialogOpen(true);
  }, [isExistingProcessingTemplate, isNewProcessingTemplate, processingTemplateName, handleSaveTemplateSynchronized, showSnackbar]);

  // ─── DOWNLOAD HANDLERS ─────────────────────────────────────────────────────
  // FactWise import sheets require these fields on every row. If the sheet looks
  // like a FactWise sheet (it has these columns) and any are blank, we warn on
  // export so the user can fill them — with a default, or by going back.
  const FACTWISE_REQUIRED = useMemo(() => ([
    'Item code', 'Item name', 'Item type', 'Measurement unit', 'Procurement entity name', 'Procurement item', 'Sales item'
  ]), []);

  const REQUIRED_FIELD_GUIDANCE = useMemo(() => ({
    'Item code': {
      rule: 'Mandatory, cannot be blank, and must be unique.',
      action: 'Use Fill Column or the FactWise ID tool so every row gets a non-duplicate code.',
    },
    'Item name': {
      rule: 'Mandatory. Duplicate names are allowed, blanks are not.',
      action: 'Use Fill Column to populate Item name from a useful value or fixed rule.',
    },
    'Item type': {
      rule: 'Mandatory. Must be Raw material or Finished good.',
      action: 'Choose whether blank rows should be Raw material or Finished good, or use Fill Column.',
      quickValues: ['Raw material', 'Finished good'],
    },
    'Measurement unit': {
      rule: 'Mandatory.',
      action: 'Use Fill Column to copy from a mapped column or set a default such as Nos, EA, or Unit.',
    },
    'Procurement entity name': {
      rule: 'Mandatory. Usually one enterprise/entity value for all rows.',
      action: 'Use Fill Column. If an existing value is shown, you can fill blanks with it.',
    },
    'Procurement item': {
      rule: 'Mandatory boolean. Must be TRUE or FALSE.',
      action: 'Use Fill Column or choose TRUE/FALSE for blanks.',
      quickValues: ['TRUE', 'FALSE'],
    },
    'Sales item': {
      rule: 'Mandatory boolean. Must be TRUE or FALSE.',
      action: 'Use Fill Column or choose TRUE/FALSE for blanks.',
      quickValues: ['TRUE', 'FALSE'],
    },
  }), []);

  const BOOLEAN_REQUIRED_FIELDS = useMemo(() => new Set(['Procurement item', 'Sales item']), []);

  // The BOM sheet's equivalent of REQUIRED_FIELD_GUIDANCE, keyed by the `rule`
  // the backend stamps on every issue. A message that only states what is wrong
  // leaves the user to work out what to do about it; these supply the rest.
  //
  // `column` names the destination-template header a fix would target, so the
  // card can offer Fill Column pre-aimed at the right place. Rules with no
  // column are ones no button can resolve — a duplicate child is delete-or-sum
  // and only the user knows which — so those get a locator and nothing more.
  const BOM_RULE_GUIDANCE = useMemo(() => ({
    quantity_missing: {
      title: 'Quantity is blank',
      rule: 'Every BOM line must say how much of the part the assembly consumes.',
      action: 'Fill the Quantity column, or set a default for the blank rows.',
      column: 'Quantity',
    },
    quantity_invalid: {
      title: 'Quantity is not a valid number',
      rule: 'Quantity must be a number that is not negative. Zero and fractions are fine.',
      action: 'Replace the offending values — Fill Column can target them specifically.',
      column: 'Quantity',
    },
    item_code_blank: {
      title: 'Rows have no item code',
      rule: 'A BOM line references its part by item code, so a blank code cannot be referenced.',
      action: 'Generate item codes with the FactWise ID tool, then export again.',
      generateIds: true,
    },
    item_code_duplicate: {
      column: 'Item code',
      title: 'One item code, two different parts',
      rule: 'A code shared by rows that describe different parts makes every BOM '
           + 'reference to it ambiguous. The same part listed on several lines is '
           + 'fine — those rows are merged automatically in the item file.',
      action: 'Give the rows different item codes, or make them match exactly if they '
             + 'are the same part. Do not delete the row: that removes it from the BOM too.',
    },
    raw_or_sub_missing: {
      title: 'Rows reference nothing',
      rule: 'A BOM line must point at exactly one of a raw material code or a sub BOM ID.',
      action: 'These rows are neither a part nor a sub-assembly — check them in the grid.',
    },
    raw_and_sub: {
      title: 'Rows reference both a part and a sub-assembly',
      rule: 'A BOM line must point at exactly one of the two, never both.',
      action: 'Decide which one each row is and clear the other.',
    },
    referential_integrity: {
      title: 'Codes used by the BOM are not in the item directory',
      rule: 'Every code a BOM references must exist as an item, or the second import file fails.',
      action: 'Add the missing items, or correct the codes the BOM points at.',
    },
    measurement_unit_missing: {
      title: 'BOM lines have no measurement unit',
      rule: 'The line unit says how the part is consumed. It is separate from how the item is stocked.',
      action: 'Fill the Measurement unit column for the affected rows.',
      column: 'Measurement unit',
    },
    duplicate_child: {
      title: 'A part is listed twice in one BOM',
      rule: 'One assembly may not list the same child on two lines.',
      action: 'Delete the repeat, or merge the two into one line with the combined quantity. '
             + 'Which one is right depends on the sheet, so this is left to you.',
    },
    cycle: {
      title: 'The BOM contains itself',
      rule: 'A BOM may not be reachable from itself — the import cannot resolve it.',
      action: 'Either the finished good code or the component code is wrong. Check both.',
    },
    level_missing: {
      title: 'Level is blank',
      rule: 'Every BOM line sits at a level in the hierarchy.',
      action: 'Fill the Level column for the affected rows.',
      column: 'Level',
    },
    level_invalid: {
      title: 'Level is not a whole number',
      rule: 'Level must be a non-negative whole number.',
      action: 'Correct the offending values in the Level column.',
      column: 'Level',
    },
    sub_bom_unresolved: {
      title: 'A sub BOM ID points nowhere',
      rule: 'A sub BOM ID must name a BOM that exists in this sheet.',
      action: 'Correct the reference, or add the missing sub-assembly.',
    },
    block_inconsistent: {
      title: 'One BOM has conflicting details',
      rule: 'Every row of one BOM must agree on its name, finished good and level.',
      action: 'Make the conflicting rows agree.',
    },
    missing_columns: {
      title: 'The BOM sheet is missing required columns',
      rule: 'The generated sheet does not have the columns the import needs.',
      action: 'This is a generation problem rather than a data one — re-check the BOM setup.',
    },
    duplicate_item_codes: {
      title: 'Rows were collapsed into one item',
      rule: 'Rows sharing an item code become a single item in the directory.',
      action: 'Correct if these are genuinely different parts that happen to share a code. '
             + 'If they are the same part listed twice, nothing needs doing.',
    },
    document_rows: {
      title: 'Rows were excluded as documents',
      rule: 'A row that consumes no quantity is treated as a drawing or reference data, not a part.',
      action: 'Correct if any of these are real parts whose quantity is simply missing.',
    },
  }), []);

  const getRequiredValidationRule = useCallback((requiredName) => {
    if (requiredName === 'Measurement unit') return { kind: 'alpha' };
    if (requiredName === 'Item type') {
      return { kind: 'allowed', allowed_values: ['Raw material', 'Finished good'] };
    }
    if (requiredName === 'Procurement item' || requiredName === 'Sales item') {
      return { kind: 'allowed', allowed_values: ['TRUE', 'FALSE'] };
    }
    if (requiredName === 'Procurement entity name') return { kind: 'single_value' };
    return {};
  }, []);

  const getRequiredNameForColumn = useCallback((field) => {
    const norm = value => String(value || '').trim().toLowerCase();
    const column = columnDefs.find(item => item.field === field);
    return FACTWISE_REQUIRED.find(required => (
      norm(required) === norm(field) || norm(required) === norm(column?.headerName)
    )) || '';
  }, [columnDefs, FACTWISE_REQUIRED]);

  const fillMissingTargetCount = useMemo(() => {
    if (fillMissingMode === 'empty') return fillMissingAnalysis?.empty_count || 0;
    if (fillMissingMode === 'selected_values') {
      return fillMissingSelectedValues.reduce((total, item) => total + (Number(item.count) || 0), 0);
    }
    return 0;
  }, [fillMissingMode, fillMissingAnalysis, fillMissingSelectedValues]);

  const fillMissingAllEmpty = Boolean(
    fillMissingAnalysis?.total_rows > 0 &&
    fillMissingAnalysis.empty_count === fillMissingAnalysis.total_rows
  );

  const getFactwiseRequiredGaps = useCallback(() => {
    const dataCols = columnDefs.filter(c => c.field && c.field !== '__row_number__');
    const norm = (s) => String(s || '').trim().toLowerCase();
    const present = FACTWISE_REQUIRED
      .map(req => {
        const col = dataCols.find(c => norm(c.headerName) === norm(req) || norm(c.field) === norm(req));
        return col ? { req, field: col.field, headerName: col.headerName || col.field } : null;
      })
      .filter(Boolean);

    // Treat it as a FactWise sheet only if at least a couple of these exist.
    const isFactwiseSheet = present.length >= 2;
    return { isFactwiseSheet, present };
  }, [columnDefs, FACTWISE_REQUIRED]);

  // Run an export, but first check FactWise required fields. If any are blank,
  // open the dialog instead and hold the export until the user resolves it.
  // Blank counts come from the backend so they reflect the WHOLE dataset, not
  // just the current (server-paginated) page.
  const runGuardedExport = useCallback(async (exportFn, exportType = 'item', applySavedDefaults = true) => {
    // The BOM sheet has its own ruleset. Item required fields (Item code, Item
    // type, Measurement unit...) do not apply to a BOM row, so running them here
    // would report failures that are not real and hide the ones that are.
    if (exportType === 'bom') {
      try {
        const resp = await api.validateBomSheet(sessionId);
        const issues = resp?.data?.errors || [];
        if (issues.length > 0) {
          setBomValidationIssues(issues);
          setBomValidationWarnings(resp?.data?.warnings || []);
          pendingExportRef.current = exportFn;
          setBomValidationOpen(true);
          return;
        }
      } catch (e) {
        // A validation outage must not silently pass a broken BOM through.
        showSnackbar(
          getFriendlyErrorMessage(e, 'Could not validate the BOM before export.'),
          'error'
        );
        return;
      }
      pendingExportRef.current = null;
      exportFn();
      return;
    }

    const { isFactwiseSheet, present } = getFactwiseRequiredGaps();
    if (!isFactwiseSheet || present.length === 0) {
      exportFn();
      return;
    }
    const itemCodeField = present.find(p => p.req === 'Item code')?.field || null;
    const booleanFields = present.filter(p => BOOLEAN_REQUIRED_FIELDS.has(p.req)).map(p => p.field);
    const validators = present.reduce((result, item) => {
      const validation = getRequiredValidationRule(item.req);
      if (validation.kind) result[item.field] = validation;
      return result;
    }, {});
    let gaps = [];
    let icIssue = null;
    let warnings = [];
    try {
      const resp = await api.requiredFieldReport(
        sessionId,
        present.map(p => p.field),
        itemCodeField ? [itemCodeField] : [],
        booleanFields,
        validators
      );
      warnings = resp?.data?.warnings || [];
      const counts = (resp?.data?.gaps || []).reduce((m, g) => { m[g.field] = g.emptyCount; return m; }, {});
      const invalids = (resp?.data?.invalids || []).reduce((m, g) => {
        m[g.field] = {
          invalidCount: g.invalidCount || 0,
          invalidValues: g.values || [],
          allowedValues: g.allowedValues || [],
        };
        return m;
      }, {});
      gaps = present
        .map(p => ({
          ...p,
          emptyCount: counts[p.field] || 0,
          invalidCount: invalids[p.field]?.invalidCount || 0,
          invalidValues: invalids[p.field]?.invalidValues || [],
          allowedValues: invalids[p.field]?.allowedValues || [],
        }))
        .filter(g => g.emptyCount > 0 || g.invalidCount > 0);
      const dup = (resp?.data?.duplicates || []).find(d => d.field === itemCodeField);
      const icBlanks = counts[itemCodeField] || 0;
      const icDups = dup?.duplicateRows || 0;
      if (itemCodeField && (icBlanks > 0 || icDups > 0)) {
        icIssue = { field: itemCodeField, blanks: icBlanks, dupRows: icDups, dupValues: dup?.values || [] };
      }
    } catch (e) {
      gaps = present.map(p => ({
        ...p,
        emptyCount: (rowData || []).reduce((n, r) => {
          const v = r[p.field];
          return n + ((v === null || v === undefined || String(v).trim() === '') ? 1 : 0);
        }, 0),
        invalidCount: 0,
        invalidValues: [],
      })).filter(g => g.emptyCount > 0);
    }

    if (applySavedDefaults) {
      const savedDefaults = readItemDirectoryDefaults();
      const defaultForRequired = (requiredName) => {
        if (requiredName === 'Measurement unit') return savedDefaults.measurementUnit;
        if (requiredName === 'Item type') return savedDefaults.itemType;
        if (requiredName === 'Procurement entity name') return savedDefaults.procurementEntityName;
        if (requiredName === 'Procurement item') return savedDefaults.procurementItem;
        if (requiredName === 'Sales item') return savedDefaults.salesItem;
        return '';
      };
      const itemCodePrefix = String(savedDefaults.itemCodePrefix || '').trim();
      const itemCodeSeparator = savedDefaults.itemCodeSeparator ?? '-';
      const itemCodeStart = Math.max(1, Number.parseInt(savedDefaults.itemCodeStart || '1', 10) || 1);
      const itemCodePadding = Math.max(0, Number.parseInt(savedDefaults.itemCodePadding || '3', 10) || 0);
      const itemCodeIncrement = savedDefaults.itemCodeIncrement !== false;
      const itemCodeContentType = savedDefaults.itemCodeContentType || 'serial';
      const requestedBlankStrategy = savedDefaults.itemCodeBlankStrategy || 'prefix_sequence';
      const requestedDuplicateStrategy = savedDefaults.itemCodeDuplicateStrategy || 'prefix_sequence';
      let appliedSavedDefault = false;

      try {
        if (itemCodeField && icIssue && itemCodeContentType === 'fixed' && String(savedDefaults.itemCodeDefaultValue || '').trim() && (icIssue.blanks || 0) > 0) {
          const resp = await api.setColumnDefault(sessionId, itemCodeField, String(savedDefaults.itemCodeDefaultValue || '').trim(), true, null);
          if (!resp.data?.success) throw new Error(resp.data?.error || 'Could not fill item code defaults');
          recordPostMappingAction({
            type: 'set_column_default',
            label: 'Fill Item code from settings',
            column: itemCodeField,
            value: String(savedDefaults.itemCodeDefaultValue || '').trim(),
            only_empty: true,
            condition: null,
          });
          appliedSavedDefault = true;
        } else if (itemCodeField && icIssue && itemCodeContentType === 'serial') {
          const blankStrategy = (
            (icIssue.blanks || 0) > 0 &&
            requestedBlankStrategy === 'prefix_sequence' &&
            itemCodePrefix
          ) ? 'prefix_sequence' : 'leave';
          const duplicateStrategy = (() => {
            if ((icIssue.dupRows || 0) <= 0) return 'leave';
            if (requestedDuplicateStrategy === 'suffix') return 'suffix';
            if (requestedDuplicateStrategy === 'prefix_sequence' && itemCodePrefix) return 'prefix_sequence';
            return 'leave';
          })();

          if (blankStrategy !== 'leave' || duplicateStrategy !== 'leave') {
            const resp = await api.resolveItemCode(sessionId, {
              column: itemCodeField,
              blankStrategy,
              duplicateStrategy,
              prefix: itemCodePrefix,
              separator: itemCodeSeparator,
              start: itemCodeStart,
              padding: itemCodePadding,
              increment: itemCodeIncrement,
            });
            if (!resp.data?.success) throw new Error(resp.data?.error || 'Could not generate item codes');
            recordPostMappingAction({
              type: 'resolve_item_code',
              label: 'Resolve Item code values from settings',
              column: itemCodeField,
              blank_strategy: blankStrategy,
              duplicate_strategy: duplicateStrategy,
              prefix: itemCodePrefix,
              separator: itemCodeSeparator,
              start: itemCodeStart,
              padding: itemCodePadding,
              increment: itemCodeIncrement,
            });
            appliedSavedDefault = true;
          }
        }

        for (const gap of gaps) {
          if (gap.field === itemCodeField) continue;
          const defaultValue = String(defaultForRequired(gap.req) || '').trim();
          if (!defaultValue) continue;
          const validation = getRequiredValidationRule(gap.req);
          if ((gap.emptyCount || 0) > 0) {
            const resp = await api.setColumnDefault(sessionId, gap.field, defaultValue, true, null);
            if (!resp.data?.success) throw new Error(resp.data?.error || `Could not fill ${gap.req}`);
            recordPostMappingAction({
              type: 'set_column_default',
              label: `Fill ${gap.headerName || gap.req || gap.field} from settings`,
              column: gap.field,
              value: defaultValue,
              only_empty: true,
              condition: null,
            });
            appliedSavedDefault = true;
          }
          if ((gap.invalidCount || 0) > 0 && (gap.invalidValues || []).length > 0) {
            const selectedValues = (gap.invalidValues || []).map(item => (
              item && typeof item === 'object' ? item.value : item
            ));
            const resp = await api.fillMissingValues(
              sessionId,
              gap.field,
              'selected_values',
              selectedValues,
              'default',
              defaultValue,
              validation
            );
            if (!resp.data?.success) throw new Error(resp.data?.error || `Could not replace invalid ${gap.req}`);
            recordPostMappingAction({
              type: 'fill_missing_values',
              label: `Replace invalid ${gap.headerName || gap.req || gap.field} from settings`,
              column: gap.field,
              target_mode: 'selected_values',
              selected_values: selectedValues,
              strategy: 'default',
              default_value: defaultValue,
              validation,
            });
            appliedSavedDefault = true;
          }
        }

        if (appliedSavedDefault) {
          await fetchDataSynchronized();
          return runGuardedExport(exportFn, exportType, false);
        }
      } catch (error) {
        showSnackbar(getFriendlyErrorMessage(error, 'Could not apply saved Item Directory defaults.'), 'warning');
      }
    }

    // Item code gets its own section; keep other required fields as simple fills.
    const otherGaps = gaps.filter(g => g.field !== itemCodeField);
    if (otherGaps.length > 0 || icIssue) {
      setRequiredGaps(otherGaps);
      setItemCodeIssue(icIssue);
      setGroupWarnings(warnings);
      pendingExportRef.current = exportFn;
      setRequiredDialogOpen(true);
      return;
    }
    pendingExportRef.current = null;
    exportFn();
  }, [getFactwiseRequiredGaps, sessionId, rowData, BOOLEAN_REQUIRED_FIELDS, getRequiredValidationRule, showSnackbar, getFriendlyErrorMessage, fetchDataSynchronized, recordPostMappingAction]);

  useEffect(() => {
    requiredGuardRunnerRef.current = runGuardedExport;
  }, [runGuardedExport]);

  const cancelRequiredExport = useCallback(() => {
    setRequiredDialogOpen(false);
    setItemCodeIssue(null);
    pendingExportRef.current = null;
    returnToRequiredGuardRef.current = false;
  }, []);

  const continueExportWithWarnings = useCallback(() => {
    const fn = pendingExportRef.current;
    setRequiredDialogOpen(false);
    setItemCodeIssue(null);
    pendingExportRef.current = null;
    returnToRequiredGuardRef.current = false;
    if (fn) fn();
  }, []);

  const continueBomExportAnyway = useCallback(() => {
    const fn = pendingExportRef.current;
    setBomValidationOpen(false);
    pendingExportRef.current = null;
    if (fn) fn();
  }, []);

  // One card per rule, not one alert per row. Nine errors that are two mistakes
  // read as nine problems, and the truncation that used to cap the list at 25
  // silently hid the rest.
  const groupBomIssues = useCallback((issues, severity) => {
    const groups = new Map();
    (issues || []).forEach((issue) => {
      // Validation issues carry `rule`; generator and tree issues carry `type`.
      // Both land in the same list, so both have to key the same guidance map —
      // without this, generator warnings render under a bare "other" heading.
      const rule = issue.rule || issue.type || 'other';
      if (!groups.has(rule)) {
        groups.set(rule, { rule, severity, count: 0, rows: [], codes: [], values: [], messages: [] });
      }
      const group = groups.get(rule);
      // `count` on an issue means it already speaks for several rows — the
      // backend aggregates some rules itself.
      group.count += Number(issue.count) || 1;
      // grid_row is the row the user can actually find; row indexes the
      // generated sheet and is only a fallback for issues predating the map.
      const rows = issue.grid_rows || (issue.grid_row ? [issue.grid_row] : []);
      rows.forEach(row => { if (!group.rows.includes(row)) group.rows.push(row); });
      (issue.codes || []).forEach(code => {
        if (!group.codes.includes(code)) group.codes.push(code);
      });
      // The exact cell contents that failed, so a fix can target just them.
      const offending = String(issue.value ?? '').trim();
      if (offending && !group.values.includes(offending)) group.values.push(offending);
      if (group.messages.length < 3 && !group.messages.includes(issue.message)) {
        group.messages.push(issue.message);
      }
    });
    return [...groups.values()].map(group => ({
      ...group,
      rows: group.rows.sort((a, b) => a - b),
    }));
  }, []);

  const bomErrorGroups = useMemo(
    () => groupBomIssues(bomValidationIssues, 'error'),
    [bomValidationIssues, groupBomIssues]
  );
  const bomWarningGroups = useMemo(
    () => groupBomIssues(bomValidationWarnings, 'warning'),
    [bomValidationWarnings, groupBomIssues]
  );

  // The floor for every BOM issue: even when no button can fix it, the user is
  // told which row to look at. Row numbers index the unfiltered sheet, so any
  // active search or column filter has to come off first or the target row is
  // not on the page we send them to.
  // The BOM popup lists row numbers; this paints those rows amber in the grid,
  // the same way duplicate item codes are already highlighted. Values are used
  // when the issue names them (duplicates carry codes but no rows), rows
  // otherwise.
  const highlightBomIssue = useCallback((group, field, label) => {
    const values = (group.codes?.length ? group.codes : group.values) || [];
    const rows = group.rows || [];
    if (values.length === 0 && rows.length === 0) return;
    setDupHighlight({
      field: field || '',
      values: new Set(values.map(value => String(value).trim()).filter(Boolean)),
      rows: new Set(rows.map(Number).filter(Boolean)),
      label,
    });
    setBomValidationOpen(false);
    setPage(1);
    showSnackbar(
      rows.length
        ? `Highlighted ${rows.length} row${rows.length === 1 ? '' : 's'} in amber.`
        : `Highlighted rows matching ${values.length} value${values.length === 1 ? '' : 's'} in amber.`,
      'info',
    );
  }, [showSnackbar]);

  // Show every row an issue names, together, instead of paging to them one at
  // a time. Duplicates only make sense side by side.
  const showIssueRows = useCallback((field, values, label) => {
    const wanted = (values || [])
      .map(value => String(value ?? '').trim().toLowerCase())
      .filter(Boolean);
    if (!field || wanted.length === 0) return;
    setBomValidationOpen(false);
    setRowSearchTerm('');
    setColumnFilters({});
    setRowFilterMode('all');
    setIssueRowFilter({ field, values: wanted, label });
    setPage(1);
  }, []);

  const clearIssueRowFilter = useCallback(() => setIssueRowFilter(null), []);

  const jumpToGridRow = useCallback((gridRow) => {
    const target = Number(gridRow);
    if (!target || target < 1) return;
    const targetPage = Math.floor((target - 1) / pageSize) + 1;
    setBomValidationOpen(false);
    setRowSearchTerm('');
    setColumnFilters({});
    setIssueRowFilter(null);
    setPage(targetPage);
    showSnackbar(`Row ${target} is on page ${targetPage}.`, 'info');
  }, [pageSize, showSnackbar]);

  // The two ways out of a bad-value issue, offered side by side because only the
  // user knows which is right: a row whose quantity is 0 is either a real part
  // missing its quantity (replace) or something that does not belong in the BOM
  // at all (delete). Both act on the offending VALUES rather than the whole
  // column, so rows that are already correct are never touched.
  const [bomFixBusy, setBomFixBusy] = useState('');
  const [bomFixDefaults, setBomFixDefaults] = useState({});

  const replaceBomIssueValues = useCallback(async (group, field, replacement) => {
    const value = String(replacement || '').trim();
    if (!field || !value || !group.values.length) return;
    try {
      setBomFixBusy(`replace:${group.rule}`);
      const resp = await api.fillMissingValues(
        sessionId, field, 'selected_values', group.values, 'default', value
      );
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Could not replace the values');
      recordPostMappingAction({
        type: 'fill_missing_values',
        label: `Replace ${group.values.join(', ')} in ${field}`,
        column: field,
        target_mode: 'selected_values',
        selected_values: group.values,
        strategy: 'default',
        default_value: value,
      });
      await fetchDataSynchronized();
      showSnackbar(`Replaced ${group.values.join(', ')} with "${value}".`, 'success');
      setBomValidationOpen(false);
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not replace the values.'), 'error');
    } finally {
      setBomFixBusy('');
    }
  }, [sessionId, fetchDataSynchronized, showSnackbar, getFriendlyErrorMessage, recordPostMappingAction]);

  const deleteBomIssueRows = useCallback(async (group, field) => {
    if (!field || !group.values.length) return;
    try {
      setBomFixBusy(`delete:${group.rule}`);
      let removed = 0;
      // One call per distinct value: the endpoint tests a single value, and a
      // column can legitimately hold "0" and "0.00000000" for the same problem.
      for (const value of group.values) {
        const resp = await api.deleteRowsConditional(sessionId, field, 'equals', value);
        if (!resp.data?.success) throw new Error(resp.data?.error || 'Could not delete the rows');
        removed += Number(resp.data?.deleted || resp.data?.removed || 0);
      }
      // Store the same canonical action shape used by Tools > Delete Rows.
      // One action per value mirrors the one API call per value above and lets
      // the template runner replay the rule without a second action schema.
      group.values.forEach(value => recordPostMappingAction({
        type: 'delete_rows',
        label: `Delete rows where ${field} equals "${value}"`,
        column: field,
        operator: 'equals',
        compare: value,
      }));
      await fetchDataSynchronized();
      showSnackbar(`Deleted ${removed} row${removed === 1 ? '' : 's'}.`, 'success');
      setBomValidationOpen(false);
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not delete the rows.'), 'error');
    } finally {
      setBomFixBusy('');
    }
  }, [sessionId, fetchDataSynchronized, showSnackbar, getFriendlyErrorMessage, recordPostMappingAction]);

  // Resolve a guidance column name to the grid field that actually holds it.
  // Header text is what the user sees; `field` is what the fill tools take.
  const bomGridFieldFor = useCallback((columnName) => {
    if (!columnName) return '';
    const wanted = String(columnName).trim().toLowerCase();
    const match = columnDefs.find((col) => {
      if (!col.field || col.field === '__row_number__') return false;
      return String(col.headerName || col.field).trim().toLowerCase() === wanted
        || String(col.field).trim().toLowerCase() === wanted;
    });
    return match ? match.field : '';
  }, [columnDefs]);

  const openFillColumnForRequired = useCallback((gap, suggestedValue = '') => {
    if (!gap?.field) return;
    setCreateColumnTab(0);
    setCreateColumnTarget(gap.field);
    setCreateColumnNewName('');
    setCreateColumnContentType(gap.req === 'Item code' ? 'serial' : (suggestedValue ? 'fixed' : 'copy'));
    setCreateColumnMode('fill_empty');
    setDefaultValue(suggestedValue);
    setCondCol('');
    setCondOp('is_empty');
    setCondCompare('');
    setCondThen('');
    setCondElse('');
    returnToRequiredGuardRef.current = true;
    setRequiredDialogOpen(false);
    setCreateColumnDialogOpen(true);
  }, []);

  const getObservedSingleValue = useCallback((field) => {
    const values = new Set();
    (rowData || []).forEach(row => {
      const raw = row?.[field];
      const value = raw === null || raw === undefined ? '' : String(raw).trim();
      if (value) values.add(value);
    });
    return values.size === 1 ? Array.from(values)[0] : '';
  }, [rowData]);

  const applyRequiredQuickFill = useCallback(async (gap, value) => {
    const cleanValue = String(value || '').trim();
    if (!gap?.field || !cleanValue) return;
    const fillKey = `${gap.field}:${cleanValue}`;
    try {
      setRequiredQuickFillKey(fillKey);
      setRequiredFilling(true);
      const resp = await api.setColumnDefault(sessionId, gap.field, cleanValue, true, null);
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Fill failed');
      setDefaultValues(prev => ({ ...prev, [gap.field]: cleanValue }));
      recordPostMappingAction({
        type: 'set_column_default',
        label: `Fill ${gap.headerName || gap.req || gap.field}`,
        column: gap.field,
        value: cleanValue,
        only_empty: true,
        condition: null,
      });
      await fetchDataSynchronized();
      setRequiredInlineDefaults(prev => {
        const next = { ...prev };
        delete next[gap.field];
        return next;
      });
      setRequiredGaps(prev => {
        const next = prev
          .map(item => item.field === gap.field ? { ...item, emptyCount: 0 } : item)
          .filter(item => (item.emptyCount || 0) > 0 || (item.invalidCount || 0) > 0);
        if (next.length === 0 && !itemCodeIssue) {
          setRequiredDialogOpen(false);
        }
        return next;
      });
      showSnackbar(`Filled ${gap.headerName || gap.req || gap.field} blanks with "${cleanValue}".`, 'success');
    } catch (e) {
      showSnackbar(e.response?.data?.error || e.message || 'Could not fill the required field', 'error');
    } finally {
      setRequiredQuickFillKey('');
      setRequiredFilling(false);
    }
  }, [sessionId, fetchDataSynchronized, showSnackbar, itemCodeIssue, recordPostMappingAction]);

  const openFillMissingDialog = useCallback((field = '', returnToGuard = false) => {
    setToolsMenuAnchor(null);
    setFillMissingColumn(field || '');
    setFillMissingMode('');
    setFillMissingStrategy('');
    setFillMissingDefault('');
    setFillMissingAnalysis(null);
    setFillMissingAnalysisError('');
    setFillMissingSelectedValues([]);
    fillMissingReturnToGuardRef.current = returnToGuard;
    if (returnToGuard) setRequiredDialogOpen(false);
    setFillMissingOpen(true);
  }, []);

  useEffect(() => {
    if (!fillMissingOpen || !fillMissingColumn) return undefined;
    const sequence = fillMissingAnalysisSeqRef.current + 1;
    fillMissingAnalysisSeqRef.current = sequence;
    const requiredName = getRequiredNameForColumn(fillMissingColumn);
    const validation = getRequiredValidationRule(requiredName);
    setFillMissingAnalysisLoading(true);
    setFillMissingAnalysisError('');
    setFillMissingAnalysis(null);
    setFillMissingSelectedValues([]);

    api.analyzeColumnValues(sessionId, fillMissingColumn, validation)
      .then(resp => {
        if (fillMissingAnalysisSeqRef.current !== sequence) return;
        if (!resp.data?.success) throw new Error(resp.data?.error || 'Could not inspect this column');
        const analysis = resp.data;
        setFillMissingAnalysis(analysis);
        setFillMissingSelectedValues((analysis.values || []).filter(item => item.suggested));
        if (analysis.total_rows > 0 && analysis.empty_count === analysis.total_rows) {
          setFillMissingMode('empty');
          setFillMissingStrategy('default');
        }
      })
      .catch(error => {
        if (fillMissingAnalysisSeqRef.current !== sequence) return;
        setFillMissingAnalysisError(getFriendlyErrorMessage(error, 'Could not inspect this column.'));
      })
      .finally(() => {
        if (fillMissingAnalysisSeqRef.current === sequence) setFillMissingAnalysisLoading(false);
      });
    return undefined;
  }, [fillMissingOpen, fillMissingColumn, sessionId, getRequiredNameForColumn, getRequiredValidationRule, getFriendlyErrorMessage]);

  const closeFillMissingDialog = useCallback(() => {
    fillMissingAnalysisSeqRef.current += 1;
    setFillMissingOpen(false);
    if (fillMissingReturnToGuardRef.current) {
      fillMissingReturnToGuardRef.current = false;
      setRequiredDialogOpen(true);
    }
  }, []);

  const handleFillMissingValues = useCallback(async () => {
    if (!fillMissingColumn || !fillMissingMode || fillMissingTargetCount === 0) return;
    if (fillMissingStrategy === 'default' && !fillMissingDefault.trim()) {
      showSnackbar('Enter the default value to apply.', 'warning');
      return;
    }
    setFillMissingBusy(true);
    try {
      const requiredName = getRequiredNameForColumn(fillMissingColumn);
      const validation = getRequiredValidationRule(requiredName);
      const resp = await api.fillMissingValues(
        sessionId,
        fillMissingColumn,
        fillMissingMode,
        fillMissingSelectedValues.map(item => item.value),
        fillMissingStrategy,
        fillMissingDefault,
        validation
      );
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Fill failed');
      recordPostMappingAction({
        type: 'fill_missing_values',
        label: `Fill missing ${fillMissingColumn}`,
        column: fillMissingColumn,
        target_mode: fillMissingMode,
        selected_values: fillMissingSelectedValues.map(item => item.value),
        strategy: fillMissingStrategy,
        default_value: fillMissingDefault,
        validation,
      });
      await fetchDataSynchronized();
      setFillMissingOpen(false);
      const changed = resp.data.changed || 0;
      const unresolved = resp.data.unresolved || 0;
      showSnackbar(
        unresolved > 0
          ? `Updated ${changed} cells. ${unresolved} could not be filled because no valid nearby value was available.`
          : `${fillMissingMode === 'empty' ? 'Filled' : 'Replaced'} ${changed} cell${changed === 1 ? '' : 's'}.`,
        unresolved > 0 ? 'warning' : 'success'
      );
      if (fillMissingReturnToGuardRef.current) {
        fillMissingReturnToGuardRef.current = false;
        const exportFn = pendingExportRef.current;
        if (exportFn) await runGuardedExport(exportFn);
      }
    } catch (error) {
      showSnackbar(getFriendlyErrorMessage(error, 'Could not fill the missing values.'), 'error');
    } finally {
      setFillMissingBusy(false);
    }
  }, [fillMissingColumn, fillMissingMode, fillMissingTargetCount, fillMissingSelectedValues, fillMissingStrategy, fillMissingDefault, sessionId, getRequiredNameForColumn, getRequiredValidationRule, fetchDataSynchronized, showSnackbar, getFriendlyErrorMessage, runGuardedExport, recordPostMappingAction]);

  const highlightItemCodeDuplicates = useCallback(() => {
    if (!itemCodeIssue?.dupRows) return;
    setDupHighlight({
      field: itemCodeIssue.field,
      values: new Set((itemCodeIssue.dupValues || []).map(v => String(v).trim())),
    });
    cancelRequiredExport();
    showSnackbar(`Highlighted ${itemCodeIssue.dupRows} rows with duplicate Item codes. Edit them, then export again.`, 'info');
  }, [itemCodeIssue, cancelRequiredExport, showSnackbar]);
  const handleExportToProject = useCallback(() => {
    setExportProjectName(`Project Export - ${new Date().toLocaleDateString()}`);
    setExportProjectMode('NEW');
    setSelectedExistingProject(null);
    setExportProjectSuccess(false);
    setExportProjectDialogOpen(true);
  }, []);

  const getCurrentExportColumnOrder = useCallback(() => (
    columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field)
  ), [columnDefs]);

  const openFactwisePreview = useCallback((type) => {
    setFactwisePreviewType(type);
    setFactwisePreviewFullscreen(false);
    setFactwisePreviewOpen(true);
  }, []);

  // Real project export runs inside the mapper (no redirects) when embedded
  // in Factwise. Standalone tool keeps the existing mock-only flow.
  const [projectExportDialogOpen, setProjectExportDialogOpen] = useState(false);
  const [bomDirectoryExportDialogOpen, setBomDirectoryExportDialogOpen] = useState(false);

  const handleChooseFactwiseDestination = useCallback((destination) => {
    setFactwiseExportDialogOpen(false);
    if (destination === 'project') {
      if (isFactwiseEmbedded) {
        // Same pre-flight the standalone Export flow uses — required-field
        // gaps for the ITEM sheet (Item code, Measurement unit, Item type,
        // …) and BOM validation issues (finished good code, quantities,
        // hierarchy) must be resolved before we hand rows to Factwise, or
        // Factwise rejects with TemplateError / MissingColumn.
        runGuardedExport(
          () => runGuardedExport(
            () => setProjectExportDialogOpen(true),
            'bom'
          ),
          'item'
        );
        return;
      }
      handleExportToProject();
      return;
    }
    // BOM Directory (embedded or not) keeps its original shape: BOM validation
    // popup first, then the preview. From the preview the user picks
    // "Export Sheet" (download) or "Export to FactWise" (the 2-step items → BOM
    // orchestrator, gated by the item required-field guard in
    // handleDirectoryExport).
    runGuardedExport(() => openFactwisePreview(destination), destination);
  }, [handleExportToProject, runGuardedExport, openFactwisePreview, isFactwiseEmbedded]);

  const handleExportSheetForEditing = useCallback(async () => {
    setExportingSheet(true);
    try {
      // export_type 'raw' skips the item-directory curation (BOM columns are
      // kept, no finished good appended) so the file mirrors the grid exactly
      // and can be imported straight back.
      const response = await api.downloadProcessedFile(
        sessionId,
        'excel',
        getCurrentExportColumnOrder(),
        'raw'
      );
      const blob = new Blob([response.data], {
        type: response.headers?.['content-type']
          || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sheet_${sessionId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showSnackbar('Sheet exported. Edit it, then use Import edited sheet.', 'success');
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not export the sheet.'), 'error');
    } finally {
      setExportingSheet(false);
    }
  }, [sessionId, getCurrentExportColumnOrder, showSnackbar, getFriendlyErrorMessage]);

  const handleImportEditedSheet = useCallback(async (event) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-selecting the same file still fires onChange.
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const resp = await api.importEditedSheet(sessionId, file);
      const data = resp?.data || {};
      if (!data.success) throw new Error(data.error || 'Import failed');
      setImportResult(data);
      // Close the launcher so the result summary is not stacked behind it.
      setExportImportOpen(false);
      await fetchDataSynchronized();
      showSnackbar(`Imported ${data.imported_rows} rows from ${file.name}`, 'success');
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not import that sheet.'), 'error');
    } finally {
      setImporting(false);
    }
  }, [sessionId, fetchDataSynchronized, showSnackbar, getFriendlyErrorMessage]);

  const downloadFactwisePreview = useCallback(async (format) => {
    const columnOrder = getCurrentExportColumnOrder();
    const label = factwisePreviewType === 'bom' ? 'bom_directory' : 'item_directory';
    const extension = format === 'csv' ? 'csv' : 'xlsx';
    const mime = format === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    try {
      setFactwisePreviewDownloading(format);
      // A BOM is not the mapped grid — it is generated from the normalized rows
      // into the FactWise BOM schema, so it comes from its own endpoint.
      const response = factwisePreviewType === 'bom'
        ? await api.downloadDemoBomSheet(sessionId)
        : await api.downloadProcessedFile(
            sessionId,
            format === 'csv' ? 'csv' : 'excel',
            columnOrder,
            'item'
          );
      const contentDisposition = response.headers?.['content-disposition'];
      let filename = `factwise_${label}_${sessionId}.${extension}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      const blob = new Blob([response.data], { type: response.headers?.['content-type'] || mime });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showSnackbar(`${factwisePreviewType === 'bom' ? 'BOM' : 'Item'} directory downloaded`, 'success');
    } catch (e) {
      showSnackbar(e.message || 'Failed to download export file', 'error');
    } finally {
      setFactwisePreviewDownloading('');
    }
  }, [factwisePreviewType, getCurrentExportColumnOrder, sessionId, showSnackbar]);

  const handleDirectoryExport = useCallback(async (type = factwisePreviewType) => {
    const exportType = type === 'bom' ? 'bom' : 'item';
    setFactwisePreviewOpen(false);
    setDirectoryExportStatus({ open: true, type: exportType, phase: 'loading' });

    // Standalone tool (not inside Factwise iframe): keep the existing 1.4s mock
    // behaviour so nothing changes for direct users of the tool.
    if (!isFactwiseEmbedded) {
      window.setTimeout(() => {
        setDirectoryExportStatus({ open: true, type: exportType, phase: 'success' });
      }, 1400);
      return;
    }

    // Embedded + BOM Directory export: open the two-step (items → BOM) dialog
    // instead of blindly uploading the BOM. The BOM references item codes that
    // MUST already exist in Factwise, so items go first. Same orchestrator +
    // error grid the Project export uses, minus project creation / attach.
    if (exportType === 'bom') {
      setDirectoryExportStatus({ open: false, type: exportType, phase: 'success' });
      // The BOM validation guard already ran before the preview; the ITEM
      // required-field guard still has to run here because step 1 of the
      // orchestrator uploads the item sheet.
      runGuardedExport(() => setBomDirectoryExportDialogOpen(true), 'item');
      return;
    }

    // Embedded in Factwise: hand off to FW's existing bulk-import pipeline.
    // 1. Ask the mapper backend for the Excel it already knows how to build.
    //    - Item: downloadProcessedFile('item') — mapped normalized rows.
    //    - BOM:  downloadDemoBomSheet — the FactWise BOM Directory schema
    //      (includes Finished good code, Assembly qty, …). Downloading via
    //      downloadProcessedFile('bom') produces a DIFFERENT file that
    //      FactWise's BOM bulk-import rejects with MissingColumn.
    // 2. Upload the file to FW (get pre-signed URL, PUT to Azure).
    // 3. postMessage to parent so FW opens its own BulkImportPage for that
    //    bulk_import_id — the editable error grid + reupload UX Factwise already has.
    const fwResourceType = exportType === 'bom' ? 'BOM' : 'ITEM';
    const fileLabel = exportType === 'bom' ? 'bom' : 'items';
    try {
      const columnOrder = getCurrentExportColumnOrder();
      const response = exportType === 'bom'
        ? await api.downloadDemoBomSheet(sessionId)
        : await api.downloadProcessedFile(sessionId, 'excel', columnOrder, 'item');
      const blob = new Blob([response.data], {
        type: response.headers?.['content-type']
          || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `bom-mapper-${fileLabel}-${sessionId || 'session'}.xlsx`;
      const file = new File([blob], fileName, { type: blob.type });

      const result = await uploadFileToFactwiseBulkImport(file, fwResourceType);
      if (!result?.success) {
        setDirectoryExportStatus({ open: false, type: exportType, phase: 'success' });
        showSnackbar(result?.error || 'Failed to hand off to Factwise', 'error');
        return;
      }

      // Hand off to Factwise's own BulkImportPage.
      //   - In iframe: openInFactwise → parent NAVIGATE listener opens FW.
      //   - In new tab: openInFactwise → window.open a fresh FW tab pointing
      //     at /admin/bulk-import/<RES>/<ID> with the ids in the URL query so
      //     FW's BulkImport hook can seed the template from there (no
      //     sessionStorage handoff across tabs).
      openInFactwise(
        `/admin/bulk-import/${fwResourceType}/${result.bulk_import_id}`
        + `?bom_mapper_upload=1`
        + `&file_name=${encodeURIComponent(result.file_name || fileName)}`
      );
      setDirectoryExportStatus({ open: false, type: exportType, phase: 'success' });
    } catch (error) {
      setDirectoryExportStatus({ open: false, type: exportType, phase: 'success' });
      showSnackbar(error?.message || 'Failed to hand off to Factwise', 'error');
    }
  }, [factwisePreviewType, isFactwiseEmbedded, sessionId, getCurrentExportColumnOrder, showSnackbar, runGuardedExport]);

  const handleExportProjectConfirm = useCallback(() => {
    // Every column is exported — the per-field picker was removed, so there is no
    // selection left to validate.
    if (exportProjectMode === 'EXISTING' && !selectedExistingProject) {
      showSnackbar('Please select an existing project', 'warning');
      return;
    }

    // Show loader for 3 seconds, then success
    setExportProjectLoading(true);
    setTimeout(() => {
      setExportProjectLoading(false);
      setExportProjectSuccess(true);
    }, 3000);
  }, [showSnackbar, exportProjectMode, selectedExistingProject]);


  const handleExportForCorrection = useCallback(async () => {
    try {
      setDownloadLoading(true);
      // Export to Excel with visible columns
      const headers = columnDefs
        .filter(col => col.field && col.field !== '__row_number__')
        .map(col => col.field);
      const rows = rowData.map(row => {
        const obj = {};
        headers.forEach(h => { obj[h] = row[h]; });
        return obj;
      });
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const filename = `data_for_correction_${sessionId}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, filename);
      showSnackbar('Data exported for correction (Excel). Edit and re-upload the XLSX file.', 'success');
    } catch (e) {
      showSnackbar(e.message || 'Failed to export data for correction', 'error');
    } finally {
      setDownloadLoading(false);
    }
  }, [sessionId, columnDefs, rowData, showSnackbar]);

  const buildMpnSplitOptionsPayload = useCallback(() => {
    const parseLines = (value) => String(value || '')
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean);

    const aliases = {};
    parseLines(mpnSplitOptions.manufacturerAliases).forEach(line => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) return;
      const source = line.slice(0, separatorIndex).trim();
      const target = line.slice(separatorIndex + 1).trim();
      if (source) aliases[source] = target;
    });

    return {
      mpn: {
        strip_alpha_prefix: Boolean(mpnSplitOptions.stripAlphaPrefix),
        alpha_prefix_min_length: Number(mpnSplitOptions.alphaPrefixMinLength) || 5,
        strip_numeric_prefix: Boolean(mpnSplitOptions.stripNumericPrefix),
        numeric_prefix_length: Number(mpnSplitOptions.numericPrefixLength) || 5,
        extra_prefixes: parseLines(mpnSplitOptions.extraPrefixes)
      },
      manufacturer: {
        aliases,
        discard_tokens: parseLines(mpnSplitOptions.manufacturerDiscardTokens),
        known_phrases: Object.values(aliases).filter(Boolean)
      }
    };
  }, [mpnSplitOptions]);

  const getManufacturerDirectoryHeaders = useCallback((workbook, sheetName, headerRow = 1) => {
    if (!workbook || !sheetName || !workbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    return (rows[Math.max(0, Number(headerRow || 1) - 1)] || [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
  }, []);

  const guessManufacturerDirectoryNameColumn = useCallback((headers) => {
    const preferred = ['manufacturer', 'manufacturer name', 'mfr', 'mfg', 'company', 'company name', 'name'];
    const normalized = headers.map(header => ({
      header,
      value: String(header || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    }));
    for (const term of preferred) {
      const match = normalized.find(item => item.value === term || item.value.includes(term));
      if (match) return match.header;
    }
    return headers[0] || '';
  }, []);

  const handleManufacturerDirectoryUpload = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) {
      showSnackbar('Please upload an Excel or CSV manufacturer directory.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const data = new Uint8Array(loadEvent.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0] || '';
        const headers = getManufacturerDirectoryHeaders(workbook, sheetName, 1);
        const nameColumn = guessManufacturerDirectoryNameColumn(headers);
        setManufacturerDirectory({
          fileName: file.name,
          workbook,
          sheetNames: workbook.SheetNames,
          sheetName,
          headerRow: 1,
          headers,
          nameColumn,
          synonymColumns: headers.filter(header => header !== nameColumn && /synonym|alias|alternate|aka|short|abbr/i.test(header))
        });
        setManufacturerRulesExpanded(false);
        showSnackbar(`Loaded manufacturer directory: ${file.name}`, 'success');
      } catch (err) {
        showSnackbar('Failed to read manufacturer directory.', 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }, [getManufacturerDirectoryHeaders, guessManufacturerDirectoryNameColumn, showSnackbar]);

  const updateManufacturerDirectorySheet = useCallback((sheetName) => {
    setManufacturerDirectory(prev => {
      const headers = getManufacturerDirectoryHeaders(prev.workbook, sheetName, prev.headerRow);
      const nameColumn = headers.includes(prev.nameColumn) ? prev.nameColumn : guessManufacturerDirectoryNameColumn(headers);
      return {
        ...prev,
        sheetName,
        headers,
        nameColumn,
        synonymColumns: prev.synonymColumns.filter(column => headers.includes(column) && column !== nameColumn)
      };
    });
  }, [getManufacturerDirectoryHeaders, guessManufacturerDirectoryNameColumn]);

  const updateManufacturerDirectoryHeaderRow = useCallback((headerRow) => {
    const nextHeaderRow = Math.max(1, Number(headerRow || 1));
    setManufacturerDirectory(prev => {
      const headers = getManufacturerDirectoryHeaders(prev.workbook, prev.sheetName, nextHeaderRow);
      const nameColumn = headers.includes(prev.nameColumn) ? prev.nameColumn : guessManufacturerDirectoryNameColumn(headers);
      return {
        ...prev,
        headerRow: nextHeaderRow,
        headers,
        nameColumn,
        synonymColumns: prev.synonymColumns.filter(column => headers.includes(column) && column !== nameColumn)
      };
    });
  }, [getManufacturerDirectoryHeaders, guessManufacturerDirectoryNameColumn]);

  const applyManufacturerDirectoryRules = useCallback(() => {
    const { workbook, sheetName, headerRow, nameColumn, synonymColumns } = manufacturerDirectory;
    if (!workbook || !sheetName || !nameColumn) {
      showSnackbar('Upload a manufacturer directory and select the manufacturer name column first.', 'warning');
      return;
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: '', range: Math.max(0, Number(headerRow || 1) - 1) });
    const aliases = new Map();
    const addAlias = (source, target) => {
      const sourceText = String(source || '').replace(/\s+/g, ' ').trim();
      const targetText = String(target || '').replace(/\s+/g, ' ').trim();
      if (!sourceText || !targetText) return;
      aliases.set(sourceText.toUpperCase(), `${sourceText}=${targetText}`);
    };

    rows.forEach(row => {
      const canonical = String(row[nameColumn] || '').replace(/\s+/g, ' ').trim();
      if (!canonical) return;
      addAlias(canonical, canonical);
      synonymColumns.forEach(column => {
        String(row[column] || '')
          .split(/[,;|\n]+/)
          .map(value => value.trim())
          .filter(Boolean)
          .forEach(alias => addAlias(alias, canonical));
      });
    });

    if (aliases.size === 0) {
      showSnackbar('No manufacturer names found in the selected directory column.', 'warning');
      return;
    }

    const existing = String(mpnSplitOptions.manufacturerAliases || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const merged = [...existing];
    const existingKeys = new Set(existing.map(line => line.split('=')[0]?.trim().toUpperCase()).filter(Boolean));
    aliases.forEach((line, key) => {
      if (!existingKeys.has(key)) merged.push(line);
    });
    setMpnSplitOptions(prev => ({ ...prev, manufacturerAliases: merged.join('\n') }));
    showSnackbar(`Added ${aliases.size} manufacturer names/synonyms to split rules.`, 'success');
  }, [manufacturerDirectory, mpnSplitOptions.manufacturerAliases, showSnackbar]);

  const handleOpenMpnSplitDialog = useCallback(() => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    setToolsMenuAnchor(null);
    const headers = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    setMpnColumn(prev => prev || detectMpnColumn(headers));
    setMpnSplitDialogOpen(true);
  }, [columnDefs, detectMpnColumn]);

  const handleOpenManufacturerMatchDialog = useCallback(() => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    setToolsMenuAnchor(null);
    const headers = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    setMpnColumn(prev => prev || detectMpnColumn(headers));
    setMpnManufacturerColumn(prev => prev || detectManufacturerColumn(headers));
    setManufacturerMatchDialogOpen(true);
  }, [columnDefs, detectMpnColumn, detectManufacturerColumn]);

  const handleOpenProducerParseDialog = useCallback(() => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    setToolsMenuAnchor(null);
    const headers = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    const detectedProducer = detectProducerColumn(headers);
    const detectedMpn = detectMpnColumn(headers);
    const detectedMfr = detectManufacturerColumn(headers);
    setProducerColumn(prev => prev || detectedProducer);
    setMpnColumn(prev => prev || detectedMpn);
    setMpnManufacturerColumn(prev => prev || detectedMfr);
    // Seed the multi-select destinations from detection (only real, existing columns).
    setProducerMpnCols(prev => (prev && prev.length ? prev : (detectedMpn && headers.includes(detectedMpn) ? [detectedMpn] : [])));
    setProducerMfrCols(prev => (prev && prev.length ? prev : (detectedMfr && headers.includes(detectedMfr) ? [detectedMfr] : [])));
    setProducerParseDialogOpen(true);
  }, [columnDefs, detectProducerColumn, detectMpnColumn, detectManufacturerColumn]);

  const selectedColumnLooksLikeProducerText = useCallback((header) => {
    if (!header || !Array.isArray(rowData)) return false;
    const sample = rowData.slice(0, 50);
    let checked = 0;
    let producerLike = 0;
    sample.forEach(row => {
      const value = String(row?.[header] || '').trim();
      if (!value) return;
      checked += 1;
      const labelMatches = value.match(/(?:^|\s)[\p{L}][\p{L}0-9&+.,.\-\s]{0,40}:\s*\S/gu) || [];
      if (labelMatches.length >= 1) producerLike += 1;
    });
    return checked > 0 && producerLike / checked >= 0.3;
  }, [rowData]);

  const handleSplitMPNCells = useCallback(async () => {
    try {
      setMpnSplitting(true);
      setMpnSplitDialogOpen(false);
      const headers = columnDefs
        .filter(col => col.field && col.field !== '__row_number__')
        .map(col => col.field);
      const selectedHeader = mpnColumn || detectMpnColumn(headers);

      if (!selectedHeader) {
        showSnackbar('Select an MPN column first', 'warning');
        return;
      }

      const response = await api.splitMPNCells(sessionId, selectedHeader, buildMpnSplitOptionsPayload(), null, false);
      if (response.data?.success) {
        const splitRows = response.data.split_rows || 0;
        const createdRows = response.data.created_rows || 0;
        if (splitRows > 0) {
          const normalized = response.data.normalized_mpns || 0;
          showSnackbar(`Created ${createdRows} MPN rows from ${splitRows} source rows. Cleaned ${normalized} MPNs.`, 'success');
        } else {
          if (selectedColumnLooksLikeProducerText(selectedHeader)) {
            showSnackbar('This looks like labelled “Manufacturer: MPN” data — reopen Expand Alternates and pick the “Labelled Manufacturer: MPN” option.', 'warning');
            setProducerColumn(selectedHeader);
          } else {
            showSnackbar('No multi-MPN cells found in the selected column', 'info');
          }
        }
        setMpnColumn(response.data.mpn_header || selectedHeader);
        await fetchDataSynchronized();
      } else {
        showSnackbar(response.data?.error || 'Failed to split MPN cells', 'error');
      }
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Failed to split MPN cells');
      showSnackbar(message, 'error');
    } finally {
      setMpnSplitting(false);
    }
  }, [columnDefs, mpnColumn, detectMpnColumn, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized, selectedColumnLooksLikeProducerText, getFriendlyErrorMessage]);

  const handleManufacturerMatchSplit = useCallback(async () => {
    try {
      setMpnSplitting(true);
      setManufacturerMatchDialogOpen(false);
      const headers = columnDefs
        .filter(col => col.field && col.field !== '__row_number__')
        .map(col => col.field);
      const selectedHeader = mpnColumn || detectMpnColumn(headers);

      if (!selectedHeader) {
        showSnackbar('Select the MPN column to split first', 'warning');
        return;
      }

      if (!mpnManufacturerColumn) {
        showSnackbar('Select the manufacturer column to update', 'warning');
        return;
      }

      const response = await api.splitMPNCells(sessionId, selectedHeader, buildMpnSplitOptionsPayload(), mpnManufacturerColumn, true);
      if (response.data?.success) {
        const splitRows = response.data.split_rows || 0;
        const createdRows = response.data.created_rows || 0;
        const paired = response.data.paired_manufacturer_rows || 0;
        if (splitRows > 0) {
          showSnackbar(`Created ${createdRows} MPN rows from ${splitRows} source rows and paired ${paired} manufacturers.`, 'success');
        } else {
          showSnackbar('No multi-MPN cells found in the selected column', 'info');
        }
        setMpnColumn(response.data.mpn_header || selectedHeader);
        await fetchDataSynchronized();
      } else {
        showSnackbar(response.data?.error || 'Failed to match manufacturers', 'error');
      }
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Failed to match manufacturers');
      showSnackbar(message, 'error');
    } finally {
      setMpnSplitting(false);
    }
  }, [columnDefs, mpnColumn, mpnManufacturerColumn, detectMpnColumn, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

  const handleProducerParse = useCallback(async () => {
    try {
      setMpnSplitting(true);
      setProducerParseDialogOpen(false);
      const headers = columnDefs
        .filter(col => col.field && col.field !== '__row_number__')
        .map(col => col.field);
      const selectedProducer = producerColumn || detectProducerColumn(headers);
      // Destination columns (one or more each). Fall back to the single-picker/detected
      // value if the multi-selects are empty.
      const mpnDests = (producerMpnCols && producerMpnCols.length)
        ? producerMpnCols
        : [mpnColumn || detectMpnColumn(headers)].filter(Boolean);
      const mfrDests = (producerMfrCols && producerMfrCols.length)
        ? producerMfrCols
        : [mpnManufacturerColumn || detectManufacturerColumn(headers)].filter(Boolean);

      if (!selectedProducer) {
        showSnackbar('Choose the column to read from first', 'warning');
        return;
      }
      if (!mpnDests.length) {
        showSnackbar('Pick at least one MPN destination column', 'warning');
        return;
      }
      if (!mfrDests.length) {
        showSnackbar('Pick at least one Manufacturer destination column', 'warning');
        return;
      }

      const response = await api.parseProducerColumn(
        sessionId,
        selectedProducer,
        null,
        null,
        buildMpnSplitOptionsPayload(),
        mpnDests,
        mfrDests
      );

      if (response.data?.success) {
        const parsedRows = response.data.parsed_rows || 0;
        const totalRowsAfterParse = response.data.total_rows || response.data.created_rows || 0;
        if (parsedRows > 0) {
          showSnackbar(`Expanded ${parsedRows} rows into ${totalRowsAfterParse} rows.`, 'success');
        } else {
          showSnackbar('No “Manufacturer: MPN” cells found to expand', 'info');
        }
        setProducerColumn(response.data.producer_header || selectedProducer);
        if (response.data.mpn_header || mpnDests[0]) setMpnColumn(response.data.mpn_header || mpnDests[0]);
        if (response.data.manufacturer_header || mfrDests[0]) setMpnManufacturerColumn(response.data.manufacturer_header || mfrDests[0]);
        await fetchDataSynchronized();
      } else {
        showSnackbar(response.data?.error || 'Could not expand the column', 'error');
      }
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Could not expand the column');
      showSnackbar(message, 'error');
    } finally {
      setMpnSplitting(false);
    }
  }, [columnDefs, producerColumn, mpnColumn, mpnManufacturerColumn, detectProducerColumn, detectMpnColumn, detectManufacturerColumn, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

  // Fetch each column's mapped source / default so dropdowns can disambiguate
  // duplicate-named columns.
  const refreshColumnSourceMap = useCallback(async () => {
    try {
      const resp = await api.getColumnSourceMap(sessionId);
      if (resp?.data?.success) {
        setColumnSourceMap({ sources: resp.data.sources || {}, defaults: resp.data.defaults || {} });
      }
    } catch (_) { /* non-fatal */ }
  }, [sessionId]);

  // "Tag_1" → "Tag (1)  (← Manufacturer)" or "(= default)". No annotation if neither.
  // Numbering used to be applied to Tag only, so duplicate Specification and
  // Custom identification columns were indistinguishable in these dropdowns.
  const columnLabel = useCallback((field, headerName) => {
    const numbered = displayHeaderName(field);
    const base = numbered !== String(field ?? '') ? numbered : (headerName || field);
    const src = columnSourceMap.sources?.[field];
    if (src) return `${base}  (← ${src})`;
    const def = columnSourceMap.defaults?.[field];
    if (def !== undefined && def !== null && String(def).trim() !== '') return `${base}  (= ${def})`;
    return base;
  }, [columnSourceMap]);

  // First non-empty cell for a field, so a dropdown can show the user what that
  // column actually holds (used by the "two matching lists" pairing dialog).
  const sampleForField = useCallback((field) => {
    if (!field) return '';
    for (const r of (rowData || []).slice(0, 80)) {
      const v = String(r?.[field] ?? '').trim();
      if (v) return v.length > 52 ? v.slice(0, 52) + '…' : v;
    }
    return '';
  }, [rowData]);

  // Load the per-column source/default map once columns are available, so every
  // column dropdown can annotate duplicate-named columns.
  useEffect(() => {
    if (sessionId && columnDefs.length > 0) refreshColumnSourceMap();
  }, [sessionId, columnDefs.length, refreshColumnSourceMap]);

  // Look at the user's actual data and work out which arrangement(s) fit, with
  // real column names + sample cell values to show on each chooser card.
  const handleOpenAlternatesChooser = useCallback(async () => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    const gridCols = columnDefs.filter(c => c.field && c.field !== '__row_number__');
    const names = gridCols.map(c => c.field);
    const label = (field) => { const c = gridCols.find(x => x.field === field); return (c && c.headerName) || field; };
    const sampleFor = (field) => {
      for (const r of (rowData || []).slice(0, 80)) {
        const v = String(r?.[field] ?? '').trim();
        if (v) return v.length > 46 ? v.slice(0, 46) + '…' : v;
      }
      return '';
    };
    const isMulti = (field) => {
      const v = sampleFor(field).replace(/…$/, '');
      return v && v.split(/[\s,;]+/).filter(Boolean).length >= 2;
    };

    const labelledCol = gridCols.map(c => c.field).find(f => selectedColumnLooksLikeProducerText(f));
    const mpnField = detectMpnColumn(names);
    const mfrField = detectManufacturerColumn(names);

    const detection = {
      lists: (mpnField && mfrField && (isMulti(mpnField) || isMulti(mfrField)))
        ? { matched: true, lines: [`${label(mfrField)}:  ${sampleFor(mfrField)}`, `${label(mpnField)}:  ${sampleFor(mpnField)}`] }
        : { matched: false },
      labelled: labelledCol
        ? { matched: true, lines: [`${label(labelledCol)}:  ${sampleFor(labelledCol)}`] }
        : { matched: false },
      packed: (mpnField && isMulti(mpnField) && !labelledCol)
        ? { matched: true, lines: [`${label(mpnField)}:  ${sampleFor(mpnField)}`] }
        : { matched: false },
      columns: { matched: false },
    };

    // Separate side-by-side columns live in the (often unmapped) source. Use
    // source-columns-preview (raw client headers, always populated) and fall back
    // to the parser columns endpoint.
    try {
      let srcCols = [];
      try {
        const resp = await api.getSourceColumnsPreview(sessionId);
        srcCols = (resp?.data?.columns || []).filter(Boolean);
      } catch (_) {
        const resp2 = await api.getSourceColumns(sessionId);
        srcCols = (resp2?.data?.columns || []).filter(Boolean);
      }
      const altCols = srcCols.filter(c => /(^|\s)s\s*s(\s|$)|\balt(ernate)?\b/i.test(String(c)));
      if (altCols.length > 0) {
        detection.columns = { matched: true, lines: altCols.slice(0, 3).map(c => `${c}`) };
      }
    } catch (_) { /* leave unmatched */ }

    setAlternatesDetection(detection);
    setAlternatesChooserOpen(true);
  }, [columnDefs, rowData, sessionId, selectedColumnLooksLikeProducerText, detectMpnColumn, detectManufacturerColumn]);

  // Smart Expand: build the plan from explicit columns (MPN required; a
  // manufacturer column, if given, turns it into a two-list pairing). The
  // detection is genuine, but the user can override the columns in the dialog —
  // e.g. point it at the Manufacturer column so it pairs instead of just splitting.
  const planFromColumns = useCallback((mpnCol, mfrCol) => {
    if (!mpnCol) return null;
    const gridCols = columnDefs.filter(c => c.field && c.field !== '__row_number__');
    const label = (f) => { const c = gridCols.find(x => x.field === f); return (c && c.headerName) || f; };
    const mpnSample = String(sampleForField(mpnCol) || '');
    const hasPrefixes = /(^|[\s,;])(AGILE|[A-Za-z]{5,}|\d{5,})[-\s]/i.test(mpnSample);

    // BOM 2 style: manufacturer + parts written together in one cell, labelled
    // with a colon ("Murata: GRM188; TDK: C1608"). This is AUTHORITATIVE — a
    // colon-labelled cell can't be paired against a separate list, so it always
    // routes to the producer parser, even if a (usually empty) manufacturer column
    // was detected or picked. This is NOT the BOM 5 pairing.
    const isLabelled = /(^|[\s;])[A-Za-z][\w .&/()-]*:\s*[A-Za-z0-9]/.test(mpnSample);
    if (isLabelled) {
      return {
        op: 'labelled', producerCol: mpnCol,
        headline: `Manufacturer + parts written together in "${label(mpnCol)}"`,
        steps: [
          'Read each manufacturer written before its colon',
          'Pull out the part numbers that follow it',
          'Expand into one row per manufacturer + part pair',
        ],
        columns: [{ label: label(mpnCol), sample: sampleForField(mpnCol) }],
      };
    }

    if (mfrCol && mfrCol !== mpnCol) {
      const steps = [];
      if (hasPrefixes) steps.push('Strip catalog / vendor prefixes from the part numbers');
      steps.push('Keep multi-word manufacturer names whole (built-in manufacturer directory)');
      steps.push(`Pair each part in "${label(mpnCol)}" with its manufacturer in "${label(mfrCol)}" by position`);
      steps.push('Expand into one row per manufacturer + part pair');
      return {
        op: 'lists', mpnCol, mfrCol,
        headline: `Pairing two lists — ${label(mfrCol)} ↔ ${label(mpnCol)}`,
        steps,
        columns: [
          { label: label(mfrCol), sample: sampleForField(mfrCol) },
          { label: label(mpnCol), sample: sampleForField(mpnCol) },
        ],
      };
    }
    const steps = [];
    if (hasPrefixes) steps.push('Strip catalog / vendor prefixes from the part numbers');
    steps.push(`Split the values packed in "${label(mpnCol)}"`);
    steps.push('Expand into one row per part number');
    return {
      op: 'packed', mpnCol,
      headline: `Splitting packed parts — "${label(mpnCol)}"`,
      steps,
      columns: [{ label: label(mpnCol), sample: sampleForField(mpnCol) }],
    };
  }, [columnDefs, sampleForField]);

  const detectSmartColumns = useCallback(() => {
    const names = columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => c.field);
    const isMulti = (f) => {
      const v = String(sampleForField(f) || '').replace(/…$/, '');
      return v && v.split(/[\s,;]+/).filter(Boolean).length >= 2;
    };
    // A colon-labelled cell ("NIPPON: EMV-350ADA1") is the producer-parse case —
    // everything is in one column, so any separately-detected (usually empty)
    // manufacturer column must NOT turn it into two-list pairing.
    const looksLabelled = (f) => /[A-Za-z][\w .&/()-]*:\s*[A-Za-z0-9]/.test(String(sampleForField(f) || '').replace(/…$/, ''));
    const mpn = detectMpnColumn(names) || '';
    let mfr = detectManufacturerColumn(names) || '';
    if (mfr === mpn) mfr = '';
    if (mpn && looksLabelled(mpn)) {
      mfr = '';
    } else if (mfr && !(isMulti(mfr) || (mpn && isMulti(mpn)))) {
      // Only auto-fill the manufacturer (→ pairing) when it or the MPN actually
      // holds a list; otherwise leave it blank so the user picks it deliberately.
      mfr = '';
    }
    return { mpn, mfr };
  }, [columnDefs, sampleForField, detectMpnColumn, detectManufacturerColumn]);

  const handleOpenSmartExpand = useCallback(() => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    setToolsMenuAnchor(null);
    const { mpn, mfr } = detectSmartColumns();
    setSmartMpnCol(mpn);
    setSmartMfrCol(mfr);
    setSmartPlan(planFromColumns(mpn, mfr));
    // Seed the "where do the values go" destinations for the labelled case so they
    // can be edited inline in this same dialog (no second step).
    const allNames = columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => c.field);
    const detMpn = detectMpnColumn(allNames);
    const detMfr = detectManufacturerColumn(allNames);
    setProducerMpnCols(detMpn && allNames.includes(detMpn) ? [detMpn] : []);
    setProducerMfrCols(detMfr && allNames.includes(detMfr) && detMfr !== detMpn ? [detMfr] : []);
    setSmartPhase('analyzing');
    setSmartStepIndex(0);
    setSmartExpandOpen(true);
    // In parallel, look at the (usually unmapped) raw source columns for
    // side-by-side alternate columns like "Manufacturer S S" / "Manufacturer
    // PartNo S S". When they exist that IS the arrangement (BOM 3) — override the
    // plan to route to the alternate-columns tool instead of a packed MPN split.
    // Use the same source the alternate-columns tool uses (source-columns-preview),
    // which returns the raw client headers reliably; fall back to parser columns.
    (async () => {
      try {
        let srcCols = [];
        try {
          const resp = await api.getSourceColumnsPreview(sessionId);
          srcCols = (resp?.data?.columns || []).filter(Boolean);
        } catch (_) {
          const resp2 = await api.getSourceColumns(sessionId);
          srcCols = (resp2?.data?.columns || []).filter(Boolean);
        }
        const altCols = srcCols.filter(c => /(^|\s)s\s*s(\s|$)|\balt(ernate)?\b/i.test(String(c)));
        if (altCols.length > 0) {
          setSmartPlan({
            op: 'altcols',
            altSourceCols: altCols,
            headline: `Separate alternate columns — ${altCols.slice(0, 2).join(', ')}${altCols.length > 2 ? '…' : ''}`,
            steps: [
              'Read the side-by-side alternate columns (alternate supplier / part number)',
              'Add one extra row per alternate',
              'Copy the shared item details down into each new row',
            ],
            columns: altCols.slice(0, 3).map(c => ({ label: c, sample: '' })),
          });
        }
      } catch (_) { /* keep the MPN/manufacturer plan */ }
    })();
  }, [detectSmartColumns, planFromColumns, sessionId, columnDefs, detectMpnColumn, detectManufacturerColumn]);

  // Drive the short "analyzing" sequence, then reveal the plan.
  useEffect(() => {
    if (!smartExpandOpen || smartPhase !== 'analyzing') return undefined;
    if (smartStepIndex < SMART_EXPAND_STEPS.length - 1) {
      const t = setTimeout(() => setSmartStepIndex((i) => i + 1), 560);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setSmartPhase('plan'), 650);
    return () => clearTimeout(t);
  }, [smartExpandOpen, smartPhase, smartStepIndex]);

  // "Separate columns per alternate": fetch the raw source columns (which include
  // the usually-unmapped alternate columns like "Manufacturer S S"), pre-fill a
  // sensible default pairing, and open the config dialog. Defined before
  // handleSmartApply so it can appear in that callback's dependency array.
  const handleOpenAltColsDialog = useCallback(async () => {
    if (!ENABLE_LEGACY_EXPAND_ROWS) return;
    try {
      refreshColumnSourceMap();
      const gridCols = columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => c.field);
      const findGrid = (...needles) => gridCols.find(c => needles.every(n => c.toLowerCase().includes(n)));
      let sourceCols = [];
      try {
        const resp = await api.getSourceColumnsPreview(sessionId);
        sourceCols = (resp?.data?.columns || []).filter(Boolean);
        setAltColsSourceSamples(resp?.data?.samples || {});
      } catch (_) {
        try {
          const resp2 = await api.getSourceColumns(sessionId);
          sourceCols = (resp2?.data?.columns || []).filter(Boolean);
        } catch (__) { /* leave empty */ }
        setAltColsSourceSamples({});
      }
      setAltColsSourceColumns(sourceCols);
      const findSrc = (...needles) => sourceCols.find(c => needles.every(n => String(c).toLowerCase().includes(n)));
      // Default guesses: an "S S"/alt part → MPN, an "S S"/alt manufacturer → vendor.
      const altPart = findSrc('s s', 'part') || findSrc('alt', 'part') || findSrc('s s') || '';
      const altMfr = sourceCols.find(c => /s\s*s/i.test(String(c)) && /manufacturer|mfr|vendor/i.test(String(c)) && !/part/i.test(String(c))) || '';
      const mpnTarget = findGrid('mpn') || findGrid('part') || (gridCols[0] || '');
      const vendorTarget = findGrid('vendor') || findGrid('preferred') || findGrid('manufacturer') || '';
      const pairs = [];
      if (mpnTarget) pairs.push({ target: mpnTarget, source: altPart });
      if (vendorTarget) pairs.push({ target: vendorTarget, source: altMfr });
      if (pairs.length === 0) pairs.push({ target: gridCols[0] || '', source: '' });
      setAltColsPairs(pairs);
      setAltColsDialogOpen(true);
    } catch (e) {
      showSnackbar('Could not open the alternate-columns tool', 'error');
    }
  }, [columnDefs, sessionId, showSnackbar, refreshColumnSourceMap]);

  const handleSmartApply = useCallback(async () => {
    if (!smartPlan) return;
    setSmartPhase('applying');
    try {
      setMpnSplitting(true);
      if (smartPlan.op === 'lists') {
        // Check for rows where the manufacturer split won't line up with the MPN
        // count first. If any, send the user to the review screen to hand-cut them
        // before expanding, rather than silently mis-pairing.
        const analysis = await api.analyzeMpnPairing(sessionId, smartPlan.mpnCol, smartPlan.mfrCol, buildMpnSplitOptionsPayload());
        const flagged = (analysis.data?.flagged) || [];
        if (flagged.length) {
          setReviewRows(flagged.map((f) => {
            const tokens = f.mfr_tokens || [];
            return {
              row: f.row,
              mpnCount: f.mpn_count,
              mpns: f.mpns || [],
              mfrRaw: f.mfr_raw || '',
              tokens,
              // Start with a cut after every word (each token its own name); the
              // user removes cuts to join multi-word manufacturers back together.
              cuts: tokens.slice(0, Math.max(0, tokens.length - 1)).map(() => true),
              manual: null,
            };
          }));
          setReviewMpnCol(smartPlan.mpnCol);
          setReviewMfrCol(smartPlan.mfrCol);
          setMpnColumn(smartPlan.mpnCol);
          setMpnSplitting(false);
          setSmartExpandOpen(false);
          setSmartPhase('plan');
          setReviewOpen(true);
          return;
        }
        const resp = await api.splitMPNCells(sessionId, smartPlan.mpnCol, buildMpnSplitOptionsPayload(), smartPlan.mfrCol, true);
        if (!resp.data?.success) throw new Error(resp.data?.error || 'Expand failed');
        setMpnColumn(resp.data.mpn_header || smartPlan.mpnCol);
        const paired = resp.data.paired_manufacturer_rows || 0;
        showSnackbar(`Expanded into ${resp.data.total_rows || 0} rows — paired ${paired} manufacturers.`, 'success');
      } else if (smartPlan.op === 'packed') {
        const resp = await api.splitMPNCells(sessionId, smartPlan.mpnCol, buildMpnSplitOptionsPayload(), null, false);
        if (!resp.data?.success) throw new Error(resp.data?.error || 'Expand failed');
        setMpnColumn(resp.data.mpn_header || smartPlan.mpnCol);
        showSnackbar(`Expanded into ${resp.data.total_rows || 0} rows.`, 'success');
      } else if (smartPlan.op === 'labelled') {
        // Read "Manufacturer: MPN" cells and write the extracted values into the
        // destination columns chosen inline in this dialog (each can be more than
        // one column). No separate step.
        if (!producerMpnCols.length || !producerMfrCols.length) {
          showSnackbar('Pick where the part numbers and manufacturers should go.', 'warning');
          setSmartPhase('plan');
          setMpnSplitting(false);
          return;
        }
        const resp = await api.parseProducerColumn(
          sessionId, smartPlan.producerCol, null, null, buildMpnSplitOptionsPayload(),
          producerMpnCols, producerMfrCols
        );
        if (!resp.data?.success) throw new Error(resp.data?.error || 'Parse failed');
        showSnackbar(`Expanded into ${resp.data.total_rows || resp.data.created_rows || 0} rows.`, 'success');
      } else if (smartPlan.op === 'altcols') {
        setSmartExpandOpen(false);
        handleOpenAltColsDialog();
        return;
      }
      await fetchDataSynchronized();
      setShowMpnColumns(true);
      setSmartExpandOpen(false);
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not expand automatically — open Configure manually.'), 'error');
      setSmartPhase('plan');
    } finally {
      setMpnSplitting(false);
    }
  }, [smartPlan, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage, handleOpenProducerParseDialog, handleOpenAltColsDialog, producerMpnCols, producerMfrCols]);

  // Review screen: toggle a cut between two adjacent words in a row.
  const toggleReviewCut = useCallback((rowIdx, boundaryIdx) => {
    setReviewRows((prev) => prev.map((rr, i) => {
      if (i !== rowIdx) return rr;
      // A manual edit locks the row; toggling a boundary drops back to word-cutting
      // seeded from the manual grouping so the click still does something sensible.
      const base = rr.manual != null
        ? (() => {
            const groups = reviewRowGroups(rr);
            const cuts = rr.tokens.slice(0, Math.max(0, rr.tokens.length - 1)).map(() => true);
            let idx = 0;
            groups.forEach((g) => {
              const n = String(g).trim().split(/\s+/).filter(Boolean).length;
              for (let k = 0; k < n - 1; k += 1) { if (idx + k < cuts.length) cuts[idx + k] = false; }
              idx += n;
            });
            return { ...rr, manual: null, cuts };
          })()
        : rr;
      if (boundaryIdx < 0) return base; // just exit manual mode, keep seeded cuts
      const cuts = base.cuts.slice();
      cuts[boundaryIdx] = !cuts[boundaryIdx];
      return { ...base, cuts };
    }));
  }, []);

  // Review screen: replace a row's grouping with a manually typed "A | B | C" list.
  const setReviewManual = useCallback((rowIdx, text) => {
    setReviewRows((prev) => prev.map((rr, i) => (i === rowIdx ? { ...rr, manual: text } : rr)));
  }, []);

  const removeReviewRow = useCallback((rowIdx) => {
    setReviewRows((prev) => prev.filter((_, i) => i !== rowIdx));
  }, []);

  // Apply the reviewed cuts: send per-row manufacturer lists as overrides so the
  // expand pairs exactly how the user grouped them.
  const handleApplyReview = useCallback(async () => {
    setReviewBusy(true);
    try {
      const overrides = {};
      reviewRows.forEach((rr) => {
        const groups = reviewRowGroups(rr);
        if (groups.length) overrides[String(rr.row)] = groups;
      });
      const resp = await api.splitMPNCells(
        sessionId, reviewMpnCol, buildMpnSplitOptionsPayload(), reviewMfrCol, true, overrides
      );
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Expand failed');
      setMpnColumn(resp.data.mpn_header || reviewMpnCol);
      const paired = resp.data.paired_manufacturer_rows || 0;
      await fetchDataSynchronized();
      setShowMpnColumns(true);
      setReviewOpen(false);
      showSnackbar(`Expanded into ${resp.data.total_rows || 0} rows — paired ${paired} manufacturers.`, 'success');
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not expand — please try again.'), 'error');
    } finally {
      setReviewBusy(false);
    }
  }, [reviewRows, sessionId, reviewMpnCol, reviewMfrCol, buildMpnSplitOptionsPayload, fetchDataSynchronized, showSnackbar, getFriendlyErrorMessage]);

  const handleCopyColumn = useCallback(async () => {
    if (!copySource || !copyTarget || copySource === copyTarget) return;
    setCopyBusy(true);
    try {
      const resp = await api.copyColumn(sessionId, copySource, copyTarget, copyOnlyEmpty);
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Copy failed');
      recordPostMappingAction({
        type: 'copy_column',
        label: `Copy ${copySource} to ${copyTarget}`,
        source_column: copySource,
        target_column: copyTarget,
        only_empty: copyOnlyEmpty,
      });
      showSnackbar(`Copied "${copySource}" into "${copyTarget}" (${resp.data.changed} cells).`, 'success');
      setCopyColOpen(false);
      await fetchDataSynchronized();
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not copy the column.'), 'error');
    } finally {
      setCopyBusy(false);
    }
  }, [copySource, copyTarget, copyOnlyEmpty, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage, recordPostMappingAction]);

  const handleSetDefault = useCallback(async () => {
    if (!defaultCol) return;
    const conditional = defaultMode === 'conditional';
    if (conditional && !condCol) {
      showSnackbar('Pick the column the condition looks at.', 'warning');
      return;
    }
    setDefaultBusy(true);
    try {
      const condition = conditional
        ? {
            column: condCol, operator: condOp, compare: condCompare, then: condThen,
            // Omit "else" when blank so the backend leaves non-matching cells as-is
            // (rather than overwriting them with an empty value).
            ...(String(condElse).trim() !== '' ? { else: condElse } : {}),
          }
        : null;
      const resp = await api.setColumnDefault(sessionId, defaultCol, defaultValue, defaultOnlyEmpty, condition);
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Set default failed');
      if (!conditional && defaultOnlyEmpty && String(defaultValue || '').trim() !== '') {
        setDefaultValues(prev => ({ ...prev, [defaultCol]: defaultValue }));
      }
      recordPostMappingAction({
        type: 'set_column_default',
        label: `Set default ${defaultCol}`,
        column: defaultCol,
        value: defaultValue,
        only_empty: defaultOnlyEmpty,
        condition,
      });
      showSnackbar(`Set "${defaultCol}" for ${resp.data.changed} cell${resp.data.changed !== 1 ? 's' : ''}.`, 'success');
      setDefaultColOpen(false);
      await fetchDataSynchronized();
      if (returnToRequiredGuardRef.current) {
        returnToRequiredGuardRef.current = false;
        const fn = pendingExportRef.current;
        if (fn) runGuardedExport(fn);
      }
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not set the default value.'), 'error');
    } finally {
      setDefaultBusy(false);
    }
  }, [defaultCol, defaultValue, defaultOnlyEmpty, defaultMode, condCol, condOp, condCompare, condThen, condElse, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage, runGuardedExport, recordPostMappingAction]);

  // Delete rows that meet a condition (e.g. "MPN Code is empty").
  const handleDeleteRows = useCallback(async () => {
    if (!delCol) return;
    if ((delOp === 'equals' || delOp === 'not_equals' || delOp === 'contains') && !delCompare.trim()) {
      showSnackbar('Enter the text to compare against.', 'warning');
      return;
    }
    setDelBusy(true);
    try {
      const resp = await api.deleteRowsConditional(sessionId, delCol, delOp, delCompare);
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Delete failed');
      const n = resp.data.removed || 0;
      showSnackbar(`Deleted ${n} row${n !== 1 ? 's' : ''} — ${resp.data.remaining} remaining.`, 'success');
      // Saved with the template like the fill tools are. Without this, removing
      // the document rows was something the user had to redo by hand on every
      // file, and "Save template" quietly did not include it.
      recordPostMappingAction({
        type: 'delete_rows',
        label: `Delete rows where ${delCol} ${delOp.replace(/_/g, ' ')}${delCompare ? ` "${delCompare}"` : ''}`,
        column: delCol,
        operator: delOp,
        compare: delCompare,
      });
      setDeleteRowsOpen(false);
      await fetchDataSynchronized();
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not delete rows.'), 'error');
    } finally {
      setDelBusy(false);
    }
  }, [delCol, delOp, delCompare, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage, recordPostMappingAction]);

  // DEMO: export the pre-made "golden" BOM sheet for this input.
  const handleExportBomSheet = useCallback(async () => {
    setExportBomBusy(true);
    try {
      const resp = await api.downloadDemoBomSheet(sessionId);
      const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BOM_Export.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showSnackbar('BOM sheet exported.', 'success');
      setExportBomOpen(false);
    } catch (e) {
      showSnackbar('No BOM export sheet is configured for this input yet.', 'error');
    } finally {
      setExportBomBusy(false);
    }
  }, [sessionId, showSnackbar]);

  const handleApplyAltCols = useCallback(async () => {
    const pairs = (altColsPairs || []).filter(p => p.target && p.source);
    if (pairs.length === 0) {
      showSnackbar('Pick at least one destination column and its alternate source column', 'warning');
      return;
    }
    try {
      setAltColsRunning(true);
      const resp = await api.expandAlternateColumns(sessionId, [pairs]);
      if (resp.data?.success) {
        setAltColsDialogOpen(false);
        showSnackbar(`Added ${resp.data.alternates_emitted} alternate row(s).`, 'success');
        await fetchDataSynchronized();
      } else {
        showSnackbar(resp.data?.error || 'Could not expand alternate columns', 'error');
      }
    } catch (error) {
      showSnackbar(getFriendlyErrorMessage(error, 'Could not expand alternate columns'), 'error');
    } finally {
      setAltColsRunning(false);
    }
  }, [altColsPairs, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

  // The split runs on the mapped grid, so offer the grid's own columns. Indices
  // are carried along because the grid may repeat a header name.
  // Index must be counted over the real data columns only — the backend grid has
  // no row-number column, so filter it out BEFORE numbering to stay aligned.
  const splitColsCandidates = useMemo(
    () => columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map((col, index) => ({ field: col.field, label: col.headerName || col.field, index })),
    [columnDefs]
  );

  const structuredSplitColsCandidates = useMemo(
    () => splitColsCandidates.map(column => ({
      ...column,
      label: columnLabel(column.field, column.label),
    })),
    [columnLabel, splitColsCandidates]
  );

  const splitColsFactWiseType = useMemo(() => {
    const field = splitColsConfig.sourceColumn;
    if (/^Tag_\d+$/.test(field) || field === 'Tag') return 'Tag';
    if (/^Specification_Value_\d+$/.test(field) || field === 'Specification value') {
      return 'Specification value';
    }
    return '';
  }, [splitColsConfig.sourceColumn]);

  const buildSplitColsPayload = useCallback(() => {
    const chosen = splitColsCandidates.find(col => col.field === splitColsConfig.sourceColumn);
    return {
      sourceColumn: splitColsConfig.sourceColumn,
      sourceColumnIndex: chosen ? chosen.index : null,
      destinationPrefix: splitColsFactWiseType || splitColsConfig.destinationPrefix.trim(),
      splitMode: splitColsConfig.splitMode,
      delimiter: splitColsConfig.delimiter === 'custom'
        ? splitColsConfig.customDelimiter
        : splitColsConfig.delimiter,
      chunkSize: Number(splitColsConfig.chunkSize) || 0,
      trim: splitColsConfig.trim,
      dropEmpty: splitColsConfig.dropEmpty,
      maxColumns: Number(splitColsConfig.maxColumns) || 0,
      onOverflow: splitColsConfig.onOverflow,
      keepSourceColumn: splitColsConfig.keepSourceColumn,
      overwriteExisting: splitColsConfig.overwriteExisting
    };
  }, [splitColsConfig, splitColsCandidates, splitColsFactWiseType]);

  const handleOpenSplitColsDialog = useCallback(() => {
    setToolsMenuAnchor(null);
    refreshColumnSourceMap();
    setSplitColsTab(0);
    setSplitColsDialogOpen(true);
    setSplitColsError('');
    setSplitColsPreview(null);
  }, [refreshColumnSourceMap]);

  const handlePreviewSplitCols = useCallback(async () => {
    try {
      setSplitColsPreviewLoading(true);
      setSplitColsError('');
      const response = await api.splitColumnIntoColumns(sessionId, { ...buildSplitColsPayload(), preview: true });
      if (response.data?.success) {
        setSplitColsPreview(response.data);
      } else {
        setSplitColsPreview(null);
        setSplitColsError(response.data?.error || 'Preview failed');
      }
    } catch (error) {
      setSplitColsPreview(null);
      setSplitColsError(error.response?.data?.error || error.message || 'Preview failed');
    } finally {
      setSplitColsPreviewLoading(false);
    }
  }, [sessionId, buildSplitColsPayload]);

  const handleApplySplitCols = useCallback(async () => {
    try {
      setSplitColsRunning(true);
      setSplitColsError('');
      const response = await api.splitColumnIntoColumns(sessionId, buildSplitColsPayload());

      if (response.data?.success) {
        setSplitColsDialogOpen(false);
        setSplitColsPreview(null);
        showSnackbar(
          `"${splitColsConfig.sourceColumn}" split into ${response.data.columns_created} column(s)` +
          (response.data.overflow_rows ? ` (${response.data.overflow_rows} row(s) had more values than fit)` : ''),
          'success'
        );
        await fetchDataSynchronized();
      } else {
        setSplitColsError(response.data?.error || 'Failed to split column');
      }
    } catch (error) {
      setSplitColsError(error.response?.data?.error || error.message || 'Failed to split column');
    } finally {
      setSplitColsRunning(false);
    }
  }, [sessionId, buildSplitColsPayload, splitColsConfig.sourceColumn, showSnackbar, fetchDataSynchronized]);

  const splitRowsSource = useMemo(
    () => splitColsCandidates.find(col => col.field === splitRowsConfig.sourceColumn) || null,
    [splitColsCandidates, splitRowsConfig.sourceColumn]
  );

  const splitRowsCopyCandidates = useMemo(
    () => splitColsCandidates.filter(col => !splitRowsSource || col.index !== splitRowsSource.index),
    [splitColsCandidates, splitRowsSource]
  );

  const buildSplitRowsPayload = useCallback(() => ({
    sourceColumn: splitRowsConfig.sourceColumn,
    sourceColumnIndex: splitRowsSource ? splitRowsSource.index : null,
    delimiter: splitRowsConfig.delimiter === 'custom'
      ? splitRowsConfig.customDelimiter
      : splitRowsConfig.delimiter,
    copyColumnIndices: splitRowsConfig.copyColumnIndices
  }), [splitRowsConfig, splitRowsSource]);

  const handleOpenSplitRowsDialog = useCallback(() => {
    setToolsMenuAnchor(null);
    setSplitRowsError('');
    setSplitRowsPreview(null);
    setSplitRowsDialogOpen(true);
  }, []);

  const handlePreviewSplitRows = useCallback(async () => {
    try {
      setSplitRowsPreviewLoading(true);
      setSplitRowsError('');
      const response = await api.splitColumnIntoRows(sessionId, {
        ...buildSplitRowsPayload(),
        preview: true
      });
      if (!response.data?.success) throw new Error(response.data?.error || 'Preview failed');
      setSplitRowsPreview(response.data);
    } catch (error) {
      setSplitRowsPreview(null);
      setSplitRowsError(error.response?.data?.error || error.message || 'Preview failed');
    } finally {
      setSplitRowsPreviewLoading(false);
    }
  }, [sessionId, buildSplitRowsPayload]);

  const handleApplySplitRows = useCallback(async () => {
    try {
      setSplitRowsRunning(true);
      setSplitRowsError('');
      const response = await api.splitColumnIntoRows(sessionId, buildSplitRowsPayload());
      if (!response.data?.success) throw new Error(response.data?.error || 'Split failed');
      setSplitRowsDialogOpen(false);
      setSplitRowsPreview(null);
      showSnackbar(
        `Created ${response.data.rows_added || 0} new row${response.data.rows_added === 1 ? '' : 's'}`,
        'success'
      );
      await fetchDataSynchronized();
    } catch (error) {
      setSplitRowsError(error.response?.data?.error || error.message || 'Could not split into rows');
    } finally {
      setSplitRowsRunning(false);
    }
  }, [sessionId, buildSplitRowsPayload, showSnackbar, fetchDataSynchronized]);

  const handleCorrectionFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Only allow Excel uploads
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls', 'xlsm'].includes(ext)) {
      showSnackbar('Please upload an Excel file (.xlsx, .xls, or .xlsm)', 'error');
      return;
    }

    setCorrectionFile(file);

    // Parse Excel for preview
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        if (!json || json.length === 0) {
          showSnackbar('The Excel file appears to be empty.', 'error');
          return;
        }
        const headers = (json[0] || []).map(h => String(h || '').trim());
        const rows = json.slice(1).map(arr => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = arr[i] || ''; });
          return obj;
        });
        setCorrectionPreview({ headers, rows: rows.slice(0, 5) });
      } catch (err) {
        showSnackbar('Failed to parse Excel file.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [showSnackbar]);

  const handleCorrectionUpload = useCallback(async () => {
    if (!correctionFile) return;

    try {
      setCorrectionUploading(true);

      // Parse Excel and send to backend
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
          const headers = (json[0] || []).map(h => String(h || '').trim());
          const rows = json.slice(1).map(arr => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = arr[i] || ''; });
            return obj;
          });

          const response = await api.updateSessionData(sessionId, { headers, data: rows });
          if (response.data.success) {
            showSnackbar('Data updated successfully! Refreshing...', 'success');
            setCorrectionUploadDialogOpen(false);
            setCorrectionFile(null);
            setCorrectionPreview(null);
            fetchDataSynchronized();
          } else {
            showSnackbar(response.data.error || 'Failed to update data', 'error');
          }
        } catch (error) {
          const apiError = (error && error.response && error.response.data && (error.response.data.error || JSON.stringify(error.response.data))) || error.message;
          showSnackbar('Failed to process file: ' + apiError, 'error');
        } finally {
          setCorrectionUploading(false);
        }
      };
      reader.readAsArrayBuffer(correctionFile);
    } catch (error) {
      showSnackbar('Failed to upload corrections: ' + error.message, 'error');
      setCorrectionUploading(false);
    }
  }, [correctionFile, sessionId, showSnackbar, fetchDataSynchronized]);

  // No download-original per request

  const handleRebuildColumns = useCallback(async () => {
    try {
      setRebuildingColumns(true);
      showSnackbar('Rebuilding template columns…', 'info');
      const opStart = Date.now();
      const resp = await api.rebuildTemplate(sessionId);
      const elapsed = Date.now() - opStart;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      if (resp?.data?.success) {
        await fetchDataSynchronized();
        showSnackbar('Template columns rebuilt', 'success');
      } else {
        showSnackbar(resp?.data?.error || 'Failed to rebuild columns', 'error');
      }
    } catch (e) {
      console.error('Rebuild columns failed:', e);
      showSnackbar('Failed to rebuild columns', 'error');
    } finally {
      setRebuildingColumns(false);
    }
  }, [sessionId, fetchDataSynchronized, showSnackbar]);

  // ─── CELL EDIT HANDLER ──────────────────────────────────────────────────────
  // Debounced auto-save for cell edits
  const saveTimerRef = useRef(null);
  const scheduleAutoSave = useCallback((rows) => {
    try { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); } catch (_) {}
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.saveEditedData(sessionId, { rows });
        setHasUnsavedChanges(false);
        showSnackbar('Saved', 'success');
      } catch (e) {
        console.error('Auto-save failed:', e);
        showSnackbar('Auto-save failed', 'error');
      }
    }, 800);
  }, [sessionId, showSnackbar]);

  const handleCellEdit = useCallback((rowIndex, columnRef, newValue) => {
    const newRowData = [...rowData];
    const colKey = typeof columnRef === 'string' ? columnRef : columnDefs[columnRef]?.field;
    if (colKey && newRowData[rowIndex]) {
      const prevVal = newRowData[rowIndex][colKey];
      newRowData[rowIndex][colKey] = newValue;
      setRowData(newRowData);
      setHasUnsavedChanges(true);
      // Incremental unknown counter update (avoid scanning entire dataset)
      const wasUnknown = prevVal != null && String(prevVal).toLowerCase() === 'unknown';
      const nowUnknown = newValue != null && String(newValue).toLowerCase() === 'unknown';
      if (wasUnknown !== nowUnknown) {
        setUnknownCellsCount(count => count + (nowUnknown ? 1 : -1));
      }
      // Auto-save
      scheduleAutoSave(newRowData);
    }
  }, [rowData, columnDefs, scheduleAutoSave]);

  // ─── NAVIGATION HANDLERS ────────────────────────────────────────────────────
  const handleBackToMapping = useCallback(async () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Going back will lose them. Continue?');
      if (!confirmed) return;
    }
    
    // Persist column counts before navigation
    const columnCounts = {
      tags_count: dynamicColumnCounts.tags_count,
      spec_pairs_count: dynamicColumnCounts.spec_pairs_count,
      customer_id_pairs_count: dynamicColumnCounts.customer_id_pairs_count
    };
    
    try {
      await api.updateColumnCounts(sessionId, columnCounts);
    } catch (error) {
      console.warn('Failed to persist column counts:', error);
    }
    
    sessionStorage.setItem('navigatedFromDataEditor', 'true');
    const mappingBackState = {
      route: '/editor',
      sessionId,
    };
    try {
      sessionStorage.setItem(`mappingBackState_${sessionId}`, JSON.stringify(mappingBackState));
    } catch (_) {}
    navigate(`/mapping/${sessionId}`, {
      replace: true,
      state: {
        fromDataEditor: true,
        ...(processingTemplateContext ? { uploadSource: processingTemplateContext } : {}),
        mappingBackState,
      }
    });
  }, [hasUnsavedChanges, navigate, sessionId, dynamicColumnCounts, processingTemplateContext]);

  const handleBackToPreviousStep = useCallback(async () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Going back will lose them. Continue?');
      if (!confirmed) return;
    }

    const columnCounts = {
      tags_count: dynamicColumnCounts.tags_count,
      spec_pairs_count: dynamicColumnCounts.spec_pairs_count,
      customer_id_pairs_count: dynamicColumnCounts.customer_id_pairs_count
    };

    try {
      await api.updateColumnCounts(sessionId, columnCounts);
    } catch (error) {
      console.warn('Failed to persist column counts:', error);
    }

    let backState = location.state?.mappingBackState || null;
    if (!backState) {
      try {
        const raw = sessionStorage.getItem(`editorBackState_${sessionId}`);
        backState = raw ? JSON.parse(raw) : null;
      } catch (_) {
        backState = null;
      }
    }

    if (!backState && (
      location.state?.fromBomNormalizer ||
      processingTemplateContext?.processingPath === 'normalize' ||
      processingTemplateContext?.normalizerWorkflow
    )) {
      try {
        const rawSnapshot = sessionStorage.getItem('bomNormalizer.latestResultsSnapshot');
        const snapshot = rawSnapshot ? JSON.parse(rawSnapshot) : null;
        backState = {
          route: '/bom-normalizer',
          ...(snapshot ? { bomNormalizerReturnSnapshot: snapshot } : {}),
          ...(Array.isArray(snapshot?.normalizedRows) ? { bomNormalizerReturnRows: snapshot.normalizedRows } : {}),
        };
      } catch (_) {
        backState = { route: '/bom-normalizer' };
      }
    }

    if (backState?.route === '/bom-normalizer') {
      try {
        sessionStorage.setItem('bomNormalizer.sourceMappingSessionId', sessionId);
      } catch (_) {}
      navigate('/bom-normalizer', {
        replace: true,
        state: {
          ...(processingTemplateContext ? { uploadSource: processingTemplateContext } : {}),
          ...(backState.bomNormalizerReturnKey ? { bomNormalizerReturnKey: backState.bomNormalizerReturnKey } : {}),
          ...(backState.bomNormalizerReturnSnapshot ? { bomNormalizerReturnSnapshot: backState.bomNormalizerReturnSnapshot } : {}),
          ...(backState.bomNormalizerReturnRows ? { bomNormalizerReturnRows: backState.bomNormalizerReturnRows } : {}),
          sourceMappingSessionId: sessionId,
          returnFromMapping: true,
        }
      });
      return;
    }

    handleBackToMapping();
  }, [hasUnsavedChanges, dynamicColumnCounts, sessionId, location.state, processingTemplateContext, navigate, handleBackToMapping]);

  // ─── ROW FILTERING, SEARCH AND PAGING ───────────────────────────────────────
  // All of this runs over rowData, which holds the entire sheet — searching or
  // filtering only what the current page happened to contain was the old
  // behaviour and it made both features quietly useless past row 100.
  const rowSearchQuery = rowSearchTerm.trim().toLowerCase();

  // Only the columns the user actually typed into, lowercased once here rather
  // than once per row: this re-runs across every row on each keystroke.
  const activeColumnFilters = useMemo(() => (
    Object.entries(columnFilters || {})
      .map(([field, value]) => [field, String(value ?? '').trim().toLowerCase()])
      .filter(([, value]) => value !== '')
  ), [columnFilters]);

  // rowIndex stays the index into rowData, not into the filtered list, so cell
  // edits and autosave keep addressing the right row whatever is filtered away.
  const duplicateItemCodeInfo = useMemo(() => {
    const field = itemCodeIssue?.field || getMatchingDataColumnField('Item code');
    if (!field || !Array.isArray(rowData)) return { field: '', values: new Set(), rowCount: 0 };

    const counts = new Map();
    rowData.forEach(row => {
      const value = String(row?.[field] ?? '').trim();
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    const values = new Set();
    let rowCount = 0;
    counts.forEach((count, value) => {
      if (count > 1) {
        values.add(value);
        rowCount += count;
      }
    });

    return { field, values, rowCount };
  }, [getMatchingDataColumnField, itemCodeIssue?.field, rowData]);
  const duplicateItemCodeValues = duplicateItemCodeInfo.values;
  const hasDuplicateItemCodeRows = Boolean(duplicateItemCodeInfo.field && duplicateItemCodeInfo.rowCount > 0 && duplicateItemCodeValues.size > 0);

  const filteredRows = useMemo(() => ((rowData || [])
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      const wantsInvalid = mpnFilterInvalidOnly || rowFilterMode === 'invalid_mpn';
      if (!wantsInvalid && !MPN_ROW_FILTER_STATUS[rowFilterMode]) return true;
      const status = getMpnRowStatus(row, mpnSourceField);
      if (wantsInvalid) return status === 'invalid';
      return status === MPN_ROW_FILTER_STATUS[rowFilterMode];
    })
    .filter(({ row }) => {
      if (!rowSearchQuery) return true;
      return Object.values(row || {}).some(value =>
        String(value ?? '').toLowerCase().includes(rowSearchQuery)
      );
    })
    .filter(({ row }) => {
      if (!issueRowFilter) return true;
      const cell = String(row[issueRowFilter.field] ?? '').trim().toLowerCase();
      return issueRowFilter.values.includes(cell);
    })
    .filter(({ row }) => activeColumnFilters.every(([field, needle]) =>
      String(row?.[field] ?? '').toLowerCase().includes(needle)
    ))
  ), [rowData, rowFilterMode, mpnFilterInvalidOnly, mpnSourceField, rowSearchQuery, activeColumnFilters, issueRowFilter]);

  const activeColumnFilterCount = activeColumnFilters.length;
  const isFiltering = Boolean(rowSearchQuery) || activeColumnFilterCount > 0
    || rowFilterMode !== 'all' || mpnFilterInvalidOnly || Boolean(issueRowFilter);
  const filteredRowCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(filteredRowCount / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const displayedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  // Narrowing the result set can strand the user on a page that no longer
  // exists; snap back rather than showing an empty grid.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const clearColumnFilters = useCallback(() => {
    setColumnFilters({});
    setPage(1);
  }, []);

  const handleColumnFilterChange = useCallback((field, value) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (String(value ?? '').trim() === '') delete next[field];
      else next[field] = value;
      return next;
    });
    setPage(1);
  }, []);

  // ─── RENDER CONDITIONS ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        minHeight: '60vh',
        px: 2
      }}>
        <LoaderCard
          title={syncStatus.inProgress ? `${syncStatus.operation}...` : 'Loading mapped data...'}
          message={syncStatus.inProgress ? 'Synchronizing data with backend.' : 'Preparing your mapped data for review.'}
        />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert 
          severity="error" 
          sx={{ mb: 2 }}
          action={
            <Button 
              color="inherit" 
              size="small" 
              onClick={() => navigate(`/mapping/${sessionId}`)}
            >
              Go to Mapping
            </Button>
          }
        >
          {error}
        </Alert>
        
        {!dataIntegrity.consistent && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="600">
              Data Integrity Issues Detected:
            </Typography>
            <ul>
              {dataIntegrity.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </Alert>
        )}
        
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Button 
            variant="outlined" 
            onClick={handleManualRefresh}
            startIcon={<RefreshIcon />}
          >
            Retry with Sync
          </Button>
          <Button 
            variant="contained" 
            onClick={handleBackToMapping}
          >
            Back to Mapping
          </Button>
        </Box>
      </Container>
    );
  }

  // ─── MAIN RENDER ────────────────────────────────────────────────────────────
  const t = themeTokens;
  const editorPageSx = {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    bgcolor: t.background.app,
    color: t.text.primary,
    '& > :not(.fw-editor-bg-layer)': {
      position: 'relative',
      zIndex: 1
    }
  };
  const editorHeaderSx = {
    borderRadius: 0,
    background: 'transparent',
    color: t.text.primary,
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    borderBottom: 'none',
    boxShadow: 'none'
  };
  const iconButtonSx = {
    color: t.text.primary,
    backgroundColor: t.surface.controlSoft,
    border: `1px solid ${t.border.default}`,
    '&:hover': {
      backgroundColor: t.action.hover,
      borderColor: t.border.hover
    },
    '&:disabled': {
      color: t.text.disabled,
      backgroundColor: t.surface.controlSoft
    }
  };
  const toolbarButtonSx = {
    borderRadius: '999px',
    textTransform: 'none',
    fontWeight: 700,
    px: 2.25,
    minHeight: 36
  };
  const outlinedActionSx = {
    ...toolbarButtonSx,
    color: t.text.primary,
    borderColor: t.border.default,
    backgroundColor: t.surface.controlSoft,
    '&:hover': {
      backgroundColor: t.action.hover,
      borderColor: t.border.hover
    }
  };
  const primaryActionSx = {
    ...toolbarButtonSx,
    color: '#ffffff !important',
    border: 'none',
    background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
    boxShadow: '0 14px 28px -16px rgba(37, 99, 235, 0.9)',
    '&:hover': {
      background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
      boxShadow: '0 18px 34px -18px rgba(37, 99, 235, 0.95)'
    },
    '&.Mui-disabled': {
      background: isDarkMode ? 'rgba(30, 41, 59, 0.78)' : '#dbeafe',
      color: isDarkMode ? 'rgba(226, 232, 240, 0.58) !important' : 'rgba(30, 64, 175, 0.46) !important',
      boxShadow: 'none'
    }
  };
  const exportFactwiseActionSx = {
    ...toolbarButtonSx,
    color: '#ffffff !important',
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
    boxShadow: 'none',
    '&:hover': {
      color: '#ffffff !important',
      borderColor: '#2563eb',
      backgroundColor: '#2563eb',
      boxShadow: 'none'
    },
    '&.Mui-disabled': {
      color: t.text.disabled,
      borderColor: t.border.default,
      backgroundColor: t.surface.controlSoft,
      boxShadow: 'none'
    }
  };
  const exportDialogTone = isDarkMode
    ? {
        paper: '#0f172a',
        header: '#111c2f',
        body: '#0f172a',
        footer: '#111c2f',
        panel: '#162033',
        panelSoft: '#111827',
        hover: 'rgba(37, 99, 235, 0.14)',
        border: 'rgba(148, 163, 184, 0.2)',
        borderSoft: 'rgba(148, 163, 184, 0.12)',
        text: '#e2e8f0',
        heading: '#f8fafc',
        secondary: '#94a3b8',
        muted: '#64748b',
        iconBg: 'rgba(37, 99, 235, 0.16)'
      }
    : {
        paper: '#ffffff',
        header: '#f8fafc',
        body: '#ffffff',
        footer: '#f8fafc',
        panel: '#ffffff',
        panelSoft: '#fafafa',
        hover: '#f8fafc',
        border: '#e5e7eb',
        borderSoft: '#f0f0f0',
        text: '#334155',
        heading: '#0f172a',
        secondary: '#64748b',
        muted: '#94a3b8',
        iconBg: '#dbeafe'
      };
  const exportTextFieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '8px',
      bgcolor: exportDialogTone.panel,
      color: exportDialogTone.text,
      '& fieldset': { borderColor: exportDialogTone.border },
      '&:hover fieldset': { borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.34)' : '#bfdbfe' },
      '&.Mui-focused fieldset': { borderColor: '#2563eb' }
    },
    '& .MuiInputBase-input::placeholder': {
      color: exportDialogTone.secondary,
      opacity: 1
    }
  };
  const orangeActionSx = {
    ...toolbarButtonSx,
    color: '#ffffff !important',
    border: 'none',
    background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    boxShadow: '0 14px 28px -16px rgba(249, 115, 22, 0.9)',
    '&:hover': {
      background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
      boxShadow: '0 18px 34px -18px rgba(249, 115, 22, 0.95)'
    },
    '&.Mui-disabled': {
      background: isDarkMode ? 'rgba(30, 41, 59, 0.78)' : '#fed7aa',
      color: isDarkMode ? 'rgba(226, 232, 240, 0.58) !important' : 'rgba(154, 52, 18, 0.48) !important',
      boxShadow: 'none'
    }
  };
  const tableTone = isDarkMode
    ? {
        panel: 'linear-gradient(180deg, rgba(13, 22, 38, 0.96) 0%, rgba(8, 15, 27, 0.98) 100%)',
        scroll: 'rgba(7, 13, 24, 0.96)',
        header: 'linear-gradient(180deg, rgba(24, 35, 56, 0.98) 0%, rgba(17, 27, 44, 0.98) 100%)',
        headerText: '#f1f5f9',
        rowEven: 'rgba(18, 27, 42, 0.92)',
        rowOdd: 'rgba(8, 15, 27, 0.94)',
        rowHover: 'rgba(37, 99, 235, 0.1)',
        line: 'rgba(113, 138, 183, 0.14)',
        rowLine: 'rgba(113, 138, 183, 0.08)',
        outerLine: 'rgba(125, 154, 205, 0.2)',
        footer: 'rgba(9, 16, 29, 0.82)',
        footerBorder: 'rgba(113, 138, 183, 0.16)',
        text: '#d6deeb'
      }
    : {
        panel: t.table.background,
        scroll: t.table.background,
        header: t.table.header,
        headerText: t.text.primary,
        rowEven: t.table.rowExpanded,
        rowOdd: t.table.background,
        rowHover: t.table.hover,
        line: t.table.line,
        rowLine: t.table.rowLine,
        outerLine: t.table.line,
        footer: t.surface.elevatedSoft,
        footerBorder: t.border.subtle,
        text: t.text.table
      };
  const gridPanelSx = {
    height: '100%',
    overflow: 'hidden',
    borderRadius: '8px',
    border: `1px solid ${tableTone.outerLine}`,
    background: tableTone.panel,
    boxShadow: isDarkMode
      ? '0 24px 70px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.03)'
      : t.shadow.card
  };
  const paginationBarSx = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 2,
    flexWrap: 'wrap',
    p: 1.5,
    borderRadius: '8px',
    backgroundColor: tableTone.footer,
    border: `1px solid ${tableTone.footerBorder}`,
    color: t.text.secondary
  };
  const tableHeaderStyle = {
    background: tableTone.header,
    borderBottom: `1px solid ${tableTone.outerLine}`
  };
  const tableBaseStyle = {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    tableLayout: 'fixed',
    fontSize: '13px',
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    color: tableTone.text
  };
  const tableScrollStyle = {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 312px)',
    borderRadius: '8px',
    border: `1px solid ${tableTone.outerLine}`,
    backgroundColor: tableTone.scroll
  };
  // The session id is a UUID that means nothing to the user; the row count
  // is the part worth showing.
  const editorSubtitle = `${totalRows.toLocaleString()} rows`;
  return (
    <Box sx={editorPageSx}>
      <Box
        className="fw-editor-bg-layer"
        sx={{
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '50%',
          opacity: isDarkMode ? 0.34 : 0.26,
          width: '62vw',
          height: '62vw',
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(90px)',
          background: 'radial-gradient(circle, var(--color-brand, #2383e2) 0%, transparent 70%)',
          zIndex: 0
        }}
      />
      <Box
        className="auth-grid-pattern fw-editor-bg-layer"
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: isDarkMode ? 0.38 : 0.42, zIndex: 0 }}
      />
      {/* Sync Status Indicator */}
      {syncStatus.inProgress && (
        <LinearProgress 
          variant={syncProgress > 0 ? 'determinate' : 'indeterminate'}
          value={syncProgress}
          sx={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            zIndex: 2000,
            '& .MuiLinearProgress-bar': {
              background: 'linear-gradient(45deg, #2196f3, #21cbf3)'
            }
          }} 
        />
      )}

      {/* Unified Fill/Create Column Dialog */}
      <Dialog open={createColumnDialogOpen} onClose={handleCloseCreateColumnDialog} maxWidth="md" fullWidth>
        <DialogTitle>Fill or create a column</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 0, pb: 2 }}>
          <Tabs value={createColumnTab} onChange={(_, value) => {
            setCreateColumnTab(value);
            if (value === 0 && createColumnContentType === 'blank') setCreateColumnContentType('fixed');
          }} sx={{ mb: 2, borderBottom: `1px solid ${t.border.subtle}` }}>
            <Tab label="Fill existing column" />
            <Tab label="Create new column" />
          </Tabs>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              {createColumnTab === 0 ? (
                <FormControl fullWidth size="small">
                  <InputLabel>Column to fill</InputLabel>
                  <Select label="Column to fill" value={createColumnTarget} onChange={(e) => setCreateColumnTarget(e.target.value)}>
                    {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                      <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField
                  fullWidth size="small" label="New column name"
                  value={createColumnNewName} onChange={(e) => setCreateColumnNewName(e.target.value)}
                  error={Boolean(createColumnNewName && dataColumnFields.includes(createColumnNewName.trim()))}
                  helperText={createColumnNewName && dataColumnFields.includes(createColumnNewName.trim()) ? 'This column already exists. Use Fill existing column.' : ''}
                />
              )}
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>How to set the value</InputLabel>
                <Select label="How to set the value" value={createColumnContentType} onChange={(e) => setCreateColumnContentType(e.target.value)}>
                  <MenuItem value="fixed">Use a default value</MenuItem>
                  <MenuItem value="copy">Copy from one column</MenuItem>
                  <MenuItem value="concat">Join two columns</MenuItem>
                  <MenuItem value="conditional">Use an if / else condition</MenuItem>
                  <MenuItem value="serial">Generate a serial sequence</MenuItem>
                  <MenuItem value="saved_rule">Apply a saved rule</MenuItem>
                  {createColumnTab === 1 && <MenuItem value="blank">Leave the new column blank</MenuItem>}
                </Select>
              </FormControl>
            </Grid>

            {createColumnTab === 0 && (
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Rows to update</InputLabel>
                  <Select label="Rows to update" value={createColumnMode} onChange={(e) => setCreateColumnMode(e.target.value)}>
                    <MenuItem value="fill_empty">Only rows where this column is empty</MenuItem>
                    <MenuItem value="overwrite">All rows</MenuItem>
                    {/* The first row holding each value keeps it; only the
                        repeats are rewritten, so the original is not lost. */}
                    <MenuItem value="duplicates">Only rows with a duplicate value</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            )}

            {createColumnContentType === 'saved_rule' && (
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Saved rule</InputLabel>
                  <Select
                    label="Saved rule"
                    value={selectedColumnRuleId}
                    onChange={(e) => setSelectedColumnRuleId(e.target.value)}
                  >
                    {preferredColumnRules.length > 0 && (
                      <ListSubheader>Saved for {columnLabel(createColumnTarget, createColumnTarget)}</ListSubheader>
                    )}
                    {preferredColumnRules.map(saved => (
                      <MenuItem key={saved.id} value={saved.id}>{saved.name}</MenuItem>
                    ))}
                    {otherColumnRules.length > 0 && <ListSubheader>Other rules</ListSubheader>}
                    {otherColumnRules.map(saved => (
                      <MenuItem key={saved.id} value={saved.id}>{saved.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: t.text.secondary }}>
                  {savedColumnRules.length === 0
                    ? 'No rules saved yet — create one under Settings → Column Rules.'
                    : 'The rule decides the value; the column and rows above decide where it lands.'}
                </Typography>
              </Grid>
            )}

            {createColumnContentType === 'fixed' && (
              <Grid item xs={12}>
                <TextField fullWidth size="small" label="Value" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />
              </Grid>
            )}

            {createColumnContentType === 'copy' && (
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Copy from</InputLabel>
                  <Select label="Copy from" value={createColumnFirst} onChange={(e) => setCreateColumnFirst(e.target.value)}>
                    {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                      <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {createColumnContentType === 'concat' && (
              <>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>First column</InputLabel>
                    <Select label="First column" value={createColumnFirst} onChange={(e) => setCreateColumnFirst(e.target.value)}>
                      {dataColumnFields.map(field => <MenuItem key={field} value={field}>{field}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Second column</InputLabel>
                    <Select label="Second column" value={createColumnSecond} onChange={(e) => setCreateColumnSecond(e.target.value)}>
                      {dataColumnFields.map(field => <MenuItem key={field} value={field}>{field}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Separator</InputLabel>
                    <Select
                      label="Separator"
                      value={createColumnSeparatorMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        const presets = {
                          none: '',
                          space: ' ',
                          hyphen: '-',
                          spaced_hyphen: ' - ',
                          underscore: '_',
                          slash: '/',
                          pipe: '|',
                          comma: ',',
                        };
                        setCreateColumnSeparatorMode(mode);
                        setCreateColumnSeparator(mode === 'custom' ? createColumnCustomSeparator : presets[mode]);
                      }}
                    >
                      <MenuItem value="none">No separator</MenuItem>
                      <MenuItem value="space">Space</MenuItem>
                      <MenuItem value="hyphen">Hyphen -</MenuItem>
                      <MenuItem value="spaced_hyphen">Spaced hyphen&nbsp; - </MenuItem>
                      <MenuItem value="underscore">Underscore _</MenuItem>
                      <MenuItem value="slash">Slash /</MenuItem>
                      <MenuItem value="pipe">Pipe |</MenuItem>
                      <MenuItem value="comma">Comma ,</MenuItem>
                      <MenuItem value="custom">Custom...</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {createColumnSeparatorMode === 'custom' && (
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Custom separator"
                      value={createColumnCustomSeparator}
                      onChange={(e) => {
                        setCreateColumnCustomSeparator(e.target.value);
                        setCreateColumnSeparator(e.target.value);
                      }}
                      helperText="Enter any character or text, including spaces."
                    />
                  </Grid>
                )}
              </>
            )}

            {createColumnContentType === 'conditional' && (
              <Grid item xs={12}>
                <Box sx={{ border: `1px solid ${t.border.default}`, borderRadius: 1, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {conditionalBranches.map((branch, branchIndex) => (
                    <Box key={branchIndex} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pb: 1.5, borderBottom: `1px solid ${t.border.subtle}` }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" fontWeight={700}>{branchIndex === 0 ? 'If' : 'Else if'} condition {branchIndex + 1}</Typography>
                        {conditionalBranches.length > 1 && (
                          <IconButton size="small" onClick={() => setConditionalBranches(current => current.filter((_, index) => index !== branchIndex))}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormControl size="small" sx={{ minWidth: 190, flex: 1 }}>
                          <InputLabel>Source column</InputLabel>
                          <Select label="Source column" value={branch.column} onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, column: e.target.value } : item))}>
                            {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                              <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                          <InputLabel>Condition</InputLabel>
                          <Select label="Condition" value={branch.operator} onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, operator: e.target.value } : item))}>
                            <MenuItem value="contains">contains</MenuItem>
                            <MenuItem value="equals">equals</MenuItem>
                            <MenuItem value="not_equals">does not equal</MenuItem>
                            <MenuItem value="is_empty">is empty</MenuItem>
                            <MenuItem value="not_empty">is not empty</MenuItem>
                          </Select>
                        </FormControl>
                        {['equals', 'not_equals', 'contains'].includes(branch.operator) && (
                          <TextField
                            size="small"
                            label="Text"
                            value={branch.compare}
                            placeholder={
                              focusedConditionIndex === branchIndex
                                ? (branch.compareValues?.length
                                    ? 'Type another value, then press Enter'
                                    : 'Type a value — press Enter to add more than one')
                                : ''
                            }
                            onFocus={() => setFocusedConditionIndex(branchIndex)}
                            onBlur={() => setFocusedConditionIndex(current => (current === branchIndex ? null : current))}
                            onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, compare: e.target.value } : item))}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              const entered = String(branch.compare || '').trim();
                              if (!entered) return;
                              setConditionalBranches(current => current.map((item, index) => (
                                index === branchIndex
                                  ? {
                                      ...item,
                                      compare: '',
                                      // Keep the typed value as a chip so the list is
                                      // the single source of truth once it is used.
                                      compareValues: Array.from(new Set([...(item.compareValues || []), entered])),
                                    }
                                  : item
                              )));
                            }}
                            sx={{ minWidth: 160, flex: 1 }}
                          />
                        )}
                      </Box>
                      {/* Values sit on their own row so the three controls above
                          stay aligned regardless of how many are added. */}
                      {branch.compareValues?.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ color: t.text.secondary, mr: 0.5 }}>
                            Any of:
                          </Typography>
                          {branch.compareValues.map((value) => (
                            <Chip
                              key={value}
                              size="small"
                              label={value}
                              onDelete={() => setConditionalBranches(current => current.map((item, index) => (
                                index === branchIndex
                                  ? { ...item, compareValues: (item.compareValues || []).filter(v => v !== value) }
                                  : item
                              )))}
                            />
                          ))}
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2" fontWeight={600} sx={{ width: 76 }}>Then use</Typography>
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                          <InputLabel>Value source</InputLabel>
                          <Select label="Value source" value={branch.outputType} onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, outputType: e.target.value } : item))}>
                            <MenuItem value="default">Default value</MenuItem>
                            <MenuItem value="column">Value from a column</MenuItem>
                            <MenuItem value="empty">Leave empty</MenuItem>
                          </Select>
                        </FormControl>
                        {branch.outputType === 'column' ? (
                          <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                            <InputLabel>Column to copy from</InputLabel>
                            <Select label="Column to copy from" value={branch.outputColumn} onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, outputColumn: e.target.value } : item))}>
                              {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                                <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : branch.outputType === 'default' ? (
                          <TextField size="small" label="Default value" value={branch.outputValue} onChange={(e) => setConditionalBranches(current => current.map((item, index) => index === branchIndex ? { ...item, outputValue: e.target.value } : item))} sx={{ minWidth: 220, flex: 1 }} />
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 220, flex: 1 }}>The target cell will be empty.</Typography>
                        )}
                      </Box>
                    </Box>
                  ))}
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setConditionalBranches(current => [...current, createConditionalBranch()])} sx={{ alignSelf: 'flex-start' }}>
                    Add another condition
                  </Button>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={600} sx={{ width: 76 }}>Otherwise</Typography>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>Value source</InputLabel>
                      <Select label="Value source" value={condElseSourceType} onChange={(e) => setCondElseSourceType(e.target.value)}>
                        <MenuItem value="default">Default value</MenuItem>
                        <MenuItem value="column">Value from a column</MenuItem>
                        <MenuItem value="empty">Leave empty</MenuItem>
                      </Select>
                    </FormControl>
                    {condElseSourceType === 'column' ? (
                      <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                        <InputLabel>Column to copy from</InputLabel>
                        <Select label="Column to copy from" value={condElseColumn} onChange={(e) => setCondElseColumn(e.target.value)}>
                          {dataColumnFields.map(field => <MenuItem key={field} value={field}>{field}</MenuItem>)}
                        </Select>
                      </FormControl>
                    ) : condElseSourceType === 'default' ? (
                      <TextField size="small" label="Default value" placeholder="Leave blank to keep the current value" value={condElse} onChange={(e) => setCondElse(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: 220, flex: 1 }} />
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 220, flex: 1 }}>The target cell will be empty.</Typography>
                    )}
                  </Box>
                </Box>
              </Grid>
            )}

            {createColumnContentType === 'serial' && (
              <>
                <Grid item xs={12} sm={4}>
                  <TextField fullWidth size="small" label="Prefix" value={factwiseSerialPrefix} onChange={(e) => setFactwiseSerialPrefix(e.target.value)} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <TextField fullWidth size="small" type="number" label="Start at" value={factwiseSerialStart} onChange={(e) => setFactwiseSerialStart(e.target.value)} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <TextField fullWidth size="small" type="number" label="Number padding" value={factwiseSerialPadding} onChange={(e) => setFactwiseSerialPadding(e.target.value)} />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={(
                      <Checkbox
                        checked={effectiveSerialIncrement}
                        disabled={serialMustIncrement}
                        onChange={(e) => setFactwiseSerialIncrement(e.target.checked)}
                      />
                    )}
                    label="Increment for each row"
                  />
                  {serialMustIncrement && (
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: -0.5, ml: 4 }}>
                      Always on for Item code — it must be unique, so every row needs its own number.
                    </Typography>
                  )}
                </Grid>
              </>
            )}
          </Grid>

          {createColumnTab === 0 && createColumnTargetExists && createColumnTargetHasData && createColumnMode === 'overwrite' && (
            <Alert severity="warning" sx={{ mt: 2 }}>Existing values in {createColumnTarget} will be replaced.</Alert>
          )}
          {createColumnTab === 0 && createColumnMode === 'duplicates' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              The first row holding each value keeps it. Only the repeats below it are
              rewritten, so nothing loses its original value.
            </Alert>
          )}
          {createColumnTab === 0 && createColumnContentType === 'conditional' && createColumnMode === 'fill_empty' &&
            (conditionalBranches.some(branch => branch.outputType === 'empty') || condElseSourceType === 'empty') && (
              <Alert severity="info" sx={{ mt: 2 }}>Leave empty will not clear populated cells in this mode. Choose All rows if matching rows should be cleared.</Alert>
            )}
          <Alert severity="info" sx={{ mt: 2 }}>This operation is saved with the mapping template and runs again when the template is reused.</Alert>
        </DialogContent>
        <DialogActions sx={{
          px: 3,
          py: 2,
          borderTop: `1px solid ${t.border.subtle}`,
          bgcolor: isDarkMode ? 'rgba(8, 13, 24, 0.72)' : 'rgba(248, 250, 252, 0.9)',
          gap: 1
        }}>
          <Button onClick={handleCloseCreateColumnDialog} disabled={createColumnSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateConcatenatedColumn}
            disabled={
              createColumnSaving ||
              !(createColumnTab === 0 ? createColumnTarget : createColumnNewName.trim()) ||
              (createColumnTab === 1 && dataColumnFields.includes(createColumnNewName.trim())) ||
              (createColumnContentType === 'concat' && (!createColumnFirst || !createColumnSecond)) ||
              (createColumnContentType === 'saved_rule' && !selectedColumnRuleId)
            }
            startIcon={createColumnSaving ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
          >
            {createColumnSaving ? 'Applying...' : (createColumnTab === 0 ? 'Fill column' : 'Create column')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* User-driven blank/value cleanup */}
      <Dialog open={fillMissingOpen} onClose={closeFillMissingDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Fill or replace column values</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 2.25 }}>
          <Box>
            <Typography variant="overline" sx={{ fontWeight: 800, color: 'primary.main' }}>1. Select a column</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              The app will inspect the actual values and suggest anything that looks invalid.
            </Typography>
            <FormControl fullWidth size="small">
            <InputLabel>Column</InputLabel>
            <Select
              label="Column"
              value={fillMissingColumn}
              onChange={(event) => {
                setFillMissingColumn(event.target.value);
                setFillMissingMode('');
                setFillMissingStrategy('');
                setFillMissingDefault('');
              }}
            >
              {columnDefs.filter(column => column.field && column.field !== '__row_number__').map(column => (
                <MenuItem key={column.field} value={column.field}>
                  {columnLabel(column.field, column.headerName)}
                </MenuItem>
              ))}
            </Select>
            </FormControl>
          </Box>

          {fillMissingAnalysisLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Inspecting values in this column...</Typography>
            </Box>
          )}
          {fillMissingAnalysisError && <Alert severity="error">{fillMissingAnalysisError}</Alert>}

          {fillMissingAnalysis && (
            <>
              {fillMissingAllEmpty ? (
                <Alert severity="info">
                  All {fillMissingAnalysis.total_rows} cells in this column are empty. Enter one default value to fill them.
                </Alert>
              ) : (
              <Box>
                <Typography variant="overline" sx={{ fontWeight: 800, color: 'primary.main' }}>2. Choose what to fix</Typography>
                <RadioGroup
                  row
                  value={fillMissingMode}
                  onChange={(event) => {
                    const nextMode = event.target.value;
                    setFillMissingMode(nextMode);
                    setFillMissingStrategy(nextMode === 'empty' && fillMissingAllEmpty ? 'default' : '');
                  }}
                  sx={{ mt: 0.5, gap: 1.5 }}
                >
                  <FormControlLabel
                    value="empty"
                    control={<Radio />}
                    label={`Fill empty cells (${fillMissingAnalysis.empty_count || 0})`}
                  />
                  <FormControlLabel
                    value="selected_values"
                    control={<Radio />}
                    label="Replace specific values"
                  />
                </RadioGroup>
              </Box>
              )}

              {fillMissingMode === 'empty' && !fillMissingAllEmpty && (
                <Alert severity={(fillMissingAnalysis.empty_count || 0) > 0 ? 'info' : 'success'}>
                  {(fillMissingAnalysis.empty_count || 0) > 0
                    ? `${fillMissingAnalysis.empty_count} empty cells will be filled. Populated cells will not change.`
                    : 'This column has no empty cells.'}
                </Alert>
              )}

              {fillMissingMode === 'selected_values' && (
                <Box sx={{ display: 'grid', gap: 1.25 }}>
                  <Autocomplete
                    multiple
                    disableCloseOnSelect
                    limitTags={3}
                    options={fillMissingAnalysis.values || []}
                    value={fillMissingSelectedValues}
                    onChange={(_, values) => setFillMissingSelectedValues(values)}
                    getOptionLabel={(option) => `${option.value} (${option.count})${option.suggested ? ' - Suggested' : ''}`}
                    isOptionEqualToValue={(option, value) => option.value === value.value}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label="Values to replace"
                        placeholder="Select one or more values"
                      />
                    )}
                  />
                  {(fillMissingAnalysis.values || []).some(item => item.suggested) && (
                    <Alert severity="warning">
                      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Suggested values are preselected</Typography>
                      {(fillMissingAnalysis.values || []).filter(item => item.suggested).slice(0, 5).map(item => (
                        <Typography key={item.value} variant="caption" sx={{ display: 'block' }}>
                          {item.value} ({item.count}): {item.reason}
                        </Typography>
                      ))}
                    </Alert>
                  )}
                  {fillMissingSelectedValues.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {fillMissingTargetCount} cells matching {fillMissingSelectedValues.length} selected value{fillMissingSelectedValues.length === 1 ? '' : 's'} will be replaced.
                    </Typography>
                  )}
                </Box>
              )}

              {fillMissingMode && fillMissingTargetCount > 0 && (
                <FormControl component="fieldset" fullWidth>
                  <FormLabel component="legend" sx={{ mb: 1, fontWeight: 800, color: 'primary.main' }}>
                    {fillMissingMode === 'empty' && fillMissingAllEmpty ? '3. Enter a default value' : '3. Choose the replacement'}
                  </FormLabel>
                  {!(fillMissingMode === 'empty' && fillMissingAllEmpty) && (
                    <RadioGroup value={fillMissingStrategy} onChange={(event) => setFillMissingStrategy(event.target.value)}>
                      <FormControlLabel
                        value="above"
                        control={<Radio />}
                        label={<Box><Typography variant="body2" fontWeight={700}>Use the filled cell above</Typography><Typography variant="caption" color="text.secondary">Uses the nearest non-target value above each selected cell.</Typography></Box>}
                        sx={{ alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { mt: -0.5 } }}
                      />
                      <FormControlLabel
                        value="below"
                        control={<Radio />}
                        label={<Box><Typography variant="body2" fontWeight={700}>Use the filled cell below</Typography><Typography variant="caption" color="text.secondary">Uses the nearest non-target value below each selected cell.</Typography></Box>}
                        sx={{ alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { mt: -0.5 } }}
                      />
                      <FormControlLabel
                        value="default"
                        control={<Radio />}
                        label={<Box><Typography variant="body2" fontWeight={700}>Add a default value</Typography><Typography variant="caption" color="text.secondary">Uses one value for every targeted cell.</Typography></Box>}
                        sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { mt: -0.5 } }}
                      />
                    </RadioGroup>
                  )}
                  {fillMissingStrategy === 'default' && (
                    <TextField
                      autoFocus
                      fullWidth
                      size="small"
                      label="Default value"
                      value={fillMissingDefault}
                      onChange={(event) => setFillMissingDefault(event.target.value)}
                      sx={{ mt: 1.5 }}
                    />
                  )}
                </FormControl>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFillMissingDialog} disabled={fillMissingBusy}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleFillMissingValues}
            disabled={
              fillMissingBusy || fillMissingAnalysisLoading || !fillMissingColumn || !fillMissingMode ||
              fillMissingTargetCount === 0 || !fillMissingStrategy ||
              (fillMissingStrategy === 'default' && !fillMissingDefault.trim())
            }
            startIcon={fillMissingBusy ? <CircularProgress size={16} /> : <EditNoteIcon />}
          >
            {fillMissingBusy ? 'Applying...' : (fillMissingMode === 'empty' ? 'Fill cells' : 'Replace values')}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Cleanup Info Banner with Deleted Rows Detail */}
      {cleanupInfo && cleanupInfo.rows_deleted > 0 && (
        <Box sx={{ borderRadius: 0 }}>
          <Alert
            severity="warning"
            icon={<DeleteSweepIcon />}
            sx={{ borderRadius: 0, cursor: 'pointer' }}
            action={
              cleanupInfo.deleted_rows_preview && cleanupInfo.deleted_rows_preview.length > 0 ? (
                <IconButton size="small" onClick={() => setShowDeletedRows(!showDeletedRows)}>
                  {showDeletedRows ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              ) : null
            }
            onClick={() => {
              if (cleanupInfo.deleted_rows_preview && cleanupInfo.deleted_rows_preview.length > 0) {
                setShowDeletedRows(!showDeletedRows);
              }
            }}
          >
            <strong>{cleanupInfo.rows_deleted} row{cleanupInfo.rows_deleted !== 1 ? 's' : ''} removed</strong> because column "{cleanupInfo.primary_column}" was empty ({cleanupInfo.total_rows_before} to {cleanupInfo.total_rows_after} rows)
            {cleanupInfo.deleted_rows_preview && cleanupInfo.deleted_rows_preview.length > 0 && (
              <Typography variant="caption" sx={{ ml: 1, opacity: 0.7 }}>
                {showDeletedRows ? 'Click to hide' : 'Click to see deleted rows'}
              </Typography>
            )}
          </Alert>
          <Collapse in={showDeletedRows}>
            {cleanupInfo.deleted_rows_preview && cleanupInfo.deleted_rows_preview.length > 0 && (
              <TableContainer sx={{ maxHeight: 300, bgcolor: '#fff8e1', borderBottom: '2px solid #ff9800' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold', bgcolor: '#fff3e0', whiteSpace: 'nowrap' }}>Row #</TableCell>
                      {Object.keys(cleanupInfo.deleted_rows_preview[0])
                        .filter(k => k !== '_original_row')
                        .map(col => (
                          <TableCell
                            key={col}
                            sx={{
                              fontWeight: 'bold',
                              bgcolor: col === cleanupInfo.primary_column ? '#ffccbc' : '#fff3e0',
                              whiteSpace: 'nowrap',
                              maxWidth: 200
                            }}
                          >
                            {col}
                            {col === cleanupInfo.primary_column && (
                              <Chip label="EMPTY" size="small" color="error" sx={{ ml: 0.5, height: 16, fontSize: '0.6rem' }} />
                            )}
                          </TableCell>
                        ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cleanupInfo.deleted_rows_preview.map((row, idx) => (
                      <TableRow key={idx} sx={{ '&:nth-of-type(odd)': { bgcolor: '#fff8e1' } }}>
                        <TableCell sx={{ fontWeight: 'bold', color: '#e65100', whiteSpace: 'nowrap' }}>
                          {row._original_row || idx + 1}
                        </TableCell>
                        {Object.keys(row)
                          .filter(k => k !== '_original_row')
                          .map(col => (
                            <TableCell
                              key={col}
                              sx={{
                                maxWidth: 200,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                bgcolor: col === cleanupInfo.primary_column ? '#ffebee' : 'inherit',
                                color: !row[col] && col === cleanupInfo.primary_column ? '#d32f2f' : 'inherit',
                                fontStyle: !row[col] && col === cleanupInfo.primary_column ? 'italic' : 'normal'
                              }}
                            >
                              {row[col] || (col === cleanupInfo.primary_column ? '(empty)' : '')}
                            </TableCell>
                          ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Collapse>
        </Box>
      )}

      {/* Enhanced Header */}
      <Paper
        elevation={0}
        sx={editorHeaderSx}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 4 } }}>
          <Box sx={{ 
            pt: { xs: 2.5, md: 3 },
            pb: { xs: 1.25, md: 1.35 },
            display: 'flex', 
            flexDirection: 'column',
            gap: 1.35
          }}>
            
            {/* Top Row - Back Arrow, Title, and Primary Actions */}
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2.5,
              flexWrap: { xs: 'wrap', lg: 'nowrap' }
            }}>
              
              {/* Left - Back Arrow and Context */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: '1 1 360px' }}>
                <IconButton
                  onClick={handleBackToPreviousStep}
                  sx={iconButtonSx}
                  aria-label="Back to previous step"
                >
                  <ArrowBackIcon />
                </IconButton>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="h5"
                    fontWeight={760}
                    sx={{
                      lineHeight: 1.15,
                      color: t.text.heading,
                      fontSize: { xs: '1.18rem', md: '1.38rem' },
                      letterSpacing: 0
                    }}
                  >
                    FactWise BOM Scrubber
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.45,
                      color: t.text.secondary,
                      fontSize: '0.82rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: { xs: '64vw', md: 520 }
                    }}
                  >
                    {editorSubtitle}
                  </Typography>
                </Box>
              </Box>

              {/* Right - Primary Actions */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: { xs: 'flex-start', lg: 'flex-end' }, flexWrap: 'wrap', flex: { xs: '1 1 100%', lg: '0 0 auto' } }}>
                {/* The end of the workflow, so it sits apart from the editing
                    tools rather than among them. */}
                <Button
                  size="small"
                  onClick={() => setFactwiseExportDialogOpen(true)}
                  disabled={downloadLoading || syncStatus.inProgress}
                  startIcon={<FolderOpenIcon sx={{ fontSize: 18 }} />}
                  sx={exportFactwiseActionSx}
                  variant="contained"
                >
                  Export to FactWise
                </Button>
                <IconButton
                  onClick={handleManualRefresh}
                  disabled={syncStatus.inProgress}
                  sx={{
                    width: 40,
                    height: 40,
                    color: '#ffffff',
                    bgcolor: isDarkMode ? '#334155' : '#1e293b',
                    '&:hover': {
                      bgcolor: isDarkMode ? '#334155' : '#1e293b'
                    },
                    '&.Mui-disabled': {
                      bgcolor: isDarkMode ? '#1e293b' : '#cbd5e1',
                      color: isDarkMode ? '#64748b' : '#64748b'
                    }
                  }}
                  aria-label="Refresh"
                >
                  <RefreshIcon sx={{ fontSize: 20 }} />
                </IconButton>

                {/* Layout actions sit behind the overflow menu: useful, but not
                    worth toolbar space beside the primary actions. */}
                <Tooltip title="More actions">
                  <IconButton
                    onClick={(e) => setMoreActionsAnchor(e.currentTarget)}
                    disabled={syncStatus.inProgress}
                    sx={{
                      width: 40,
                      height: 40,
                      color: '#ffffff',
                      bgcolor: isDarkMode ? '#334155' : '#1e293b',
                      '&:hover': { bgcolor: isDarkMode ? '#334155' : '#1e293b' },
                      '&.Mui-disabled': {
                        bgcolor: isDarkMode ? '#1e293b' : '#cbd5e1',
                        color: '#64748b'
                      }
                    }}
                    aria-label="More actions"
                  >
                    <MoreVertIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={moreActionsAnchor}
                  open={Boolean(moreActionsAnchor)}
                  onClose={() => setMoreActionsAnchor(null)}
                  PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 230, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
                >
                  <MenuItem onClick={() => { setMoreActionsAnchor(null); handleAutoFitAll(); }} disabled={syncStatus.inProgress}>
                    <ListItemText>Auto-fit all columns</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setMoreActionsAnchor(null); handleRebuildColumns(); }} disabled={rebuildingColumns || syncStatus.inProgress}>
                    <ListItemText>{rebuildingColumns ? 'Rebuilding...' : 'Rebuild template columns'}</ListItemText>
                  </MenuItem>
                </Menu>

              {/* Auto-fit All */}
              {false && (
              <Tooltip title="Auto-fit all columns to content" sx={{ display: 'none' }}>
                <span>
                  <Button
                    size="small"
                    onClick={handleAutoFitAll}
                    disabled={syncStatus.inProgress}
                    sx={{ ...outlinedActionSx, display: 'none' }}
                    variant="outlined"
                  >
                    Auto‑fit All
                  </Button>
                </span>
              </Tooltip>
              )}

              {/* Rebuild Columns */}
              <Tooltip title="Rebuild template columns">
                <span>
                  <Button
                    size="small"
                    onClick={handleRebuildColumns}
                    disabled={rebuildingColumns || syncStatus.inProgress}
                    sx={{ ...outlinedActionSx, display: 'none' }}
                  >
                    {rebuildingColumns ? 'Rebuilding…' : 'Rebuild Columns'}
                  </Button>
                </span>
              </Tooltip>
              </Box>
            </Box>

            {/* Second Row - Secondary Tools and Search */}
            <Box sx={{
              display: 'flex',
              gap: 1.25,
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              pt: 0.75
            }}>
              {/* "Manufacturer Match" button removed — it now lives inside
                  Tools ▸ Expand Alternates into Rows (the "two matching lists"
                  arrangement), alongside the other alternate shapes. */}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
              {/* TOOLS dropdown */}
              <Button
                onClick={(e) => setToolsMenuAnchor(e.currentTarget)}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={<BuildIcon />}
                sx={outlinedActionSx}
              >
                Tools
              </Button>
              <Tooltip title={isExistingProcessingTemplate ? 'Existing templates cannot be saved from this run' : (templateSaved ? 'Update this workflow template' : 'Save this workflow template')}>
                <span>
                  <Button
                    size="small"
                    onClick={handleSaveTemplateFromToolbar}
                    disabled={templateSaving || syncStatus.inProgress || isExistingProcessingTemplate}
                    startIcon={templateSaving ? <CircularProgress size={16} /> : <SaveIcon sx={{ fontSize: 18 }} />}
                    sx={outlinedActionSx}
                    variant="outlined"
                  >
                    {templateSaving ? 'Saving...' : (templateSaved ? 'Update Template' : 'Save Template')}
                  </Button>
                </span>
              </Tooltip>

              </Box>
              <Menu
                anchorEl={toolsMenuAnchor}
                open={Boolean(toolsMenuAnchor)}
                onClose={() => setToolsMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 220, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
              >
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenCreateColumnDialog(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><AddIcon sx={{ color: '#2e7d32' }} /></ListItemIcon>
                  <ListItemText>Fill / Create Column</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => openFillMissingDialog()} disabled={syncStatus.inProgress}>
                  <ListItemIcon><EditNoteIcon sx={{ color: '#0284c7' }} /></ListItemIcon>
                  <ListItemText>Fill / replace values</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleBackToMapping(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><EditNoteIcon sx={{ color: '#2563eb' }} /></ListItemIcon>
                  <ListItemText>Modify Mappings</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleOpenSplitColsDialog} disabled={syncStatus.inProgress || splitColsRunning}>
                  <ListItemIcon>
                    {splitColsRunning ? <CircularProgress size={18} /> : <ContentCutIcon sx={{ color: '#0277bd' }} />}
                  </ListItemIcon>
                  <ListItemText>{splitColsRunning ? 'Splitting...' : 'Split into Columns'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleOpenSplitRowsDialog} disabled={syncStatus.inProgress || splitRowsRunning}>
                  <ListItemIcon>
                    {splitRowsRunning ? <CircularProgress size={18} /> : <AccountTreeIcon sx={{ color: '#00796b' }} />}
                  </ListItemIcon>
                  <ListItemText>{splitRowsRunning ? 'Splitting...' : 'Split into Rows'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setDelCol(''); setDelOp('is_empty'); setDelCompare(''); setDeleteRowsOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><DeleteIcon sx={{ color: '#c62828' }} /></ListItemIcon>
                  <ListItemText>Delete rows by condition</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setExportImportOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><ImportExportIcon sx={{ color: '#2563eb' }} /></ListItemIcon>
                  <ListItemText>Export / Import sheet</ListItemText>
                </MenuItem>
              </Menu>

              {/* MPN VALIDATION dropdown */}
              <Button
                onClick={(e) => setMpnMenuAnchor(e.currentTarget)}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={mpnValidating ? <CircularProgress size={16} sx={{ color: t.text.primary }} /> : <VerifiedUserIcon />}
                sx={{
                  ...outlinedActionSx,
                  borderColor: mpnValidationCompleted ? t.color.success : t.border.default,
                  backgroundColor: mpnValidationCompleted ? t.state.successBg : t.surface.controlSoft,
                  '&:hover': {
                    backgroundColor: mpnValidationCompleted ? t.state.successBg : t.action.hover,
                    borderColor: mpnValidationCompleted ? t.color.success : t.border.hover
                  }
                }}
              >
                {mpnValidating
                  ? (mpnProgress && mpnProgress.total ? `MPN unique ${mpnProgress.done}/${mpnProgress.total}` : 'MPN...')
                  : 'MPN'}
              </Button>
              {/* A value-set filter is invisible in the Filter menu, so it says
                  so here and can be cleared in one click. */}
              {issueRowFilter && (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`Showing rows: ${issueRowFilter.label}`}
                  onDelete={clearIssueRowFilter}
                  sx={{ fontWeight: 700, borderRadius: '8px' }}
                />
              )}
              <Button
                onClick={(e) => setRowFilterMenuAnchor(e.currentTarget)}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={<FilterListIcon />}
                sx={{
                  ...outlinedActionSx,
                  ml: { xs: 0, md: 'auto' },
                  borderColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly || activeColumnFilterCount > 0) ? t.color.primary : t.border.default,
                  backgroundColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly || activeColumnFilterCount > 0) ? t.state.infoBg : t.surface.controlSoft,
                  '&:hover': {
                    backgroundColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly || activeColumnFilterCount > 0) ? t.state.infoBg : t.action.hover,
                    borderColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly || activeColumnFilterCount > 0) ? t.color.primary : t.border.hover
                  }
                }}
              >
                {activeColumnFilterCount > 0 ? `Filter (${activeColumnFilterCount})` : 'Filter'}
              </Button>
              <Menu
                anchorEl={rowFilterMenuAnchor}
                open={Boolean(rowFilterMenuAnchor)}
                onClose={() => setRowFilterMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 210, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
              >
                {/* Column filters sit in a row under the headers; this just shows
                    or hides that row. */}
                <MenuItem onClick={() => { setRowFilterMenuAnchor(null); setShowColumnFilters(v => !v); }}>
                  <ListItemIcon>
                    <FilterAltIcon sx={{ color: showColumnFilters ? t.color.primary : t.text.secondary }} />
                  </ListItemIcon>
                  <ListItemText>{showColumnFilters ? 'Hide column filters' : 'Filter by column'}</ListItemText>
                </MenuItem>
                {activeColumnFilterCount > 0 && (
                  <MenuItem onClick={() => { setRowFilterMenuAnchor(null); clearColumnFilters(); }}>
                    <ListItemIcon><ClearIcon sx={{ color: t.text.secondary }} /></ListItemIcon>
                    <ListItemText>{`Clear ${activeColumnFilterCount} column filter${activeColumnFilterCount === 1 ? '' : 's'}`}</ListItemText>
                  </MenuItem>
                )}
                <Divider />
                <MenuItem onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('all'); setMpnFilterInvalidOnly(false); setPage(1); }}>
                  <ListItemIcon>{rowFilterMode === 'all' && !mpnFilterInvalidOnly ? <CheckIcon sx={{ color: t.color.primary }} /> : null}</ListItemIcon>
                  <ListItemText>All rows</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setRowFilterMenuAnchor(null);
                    if (hasDuplicateItemCodeRows) {
                      setDupHighlight({
                        field: duplicateItemCodeInfo.field,
                        values: duplicateItemCodeValues,
                      });
                    }
                  }}
                  disabled={!hasDuplicateItemCodeRows}
                >
                  <ListItemIcon>{dupHighlight?.field === duplicateItemCodeInfo.field ? <CheckIcon sx={{ color: t.color.warningText }} /> : <ContentCopyIcon sx={{ color: t.color.warningText }} />}</ListItemIcon>
                  <ListItemText>Highlight duplicate Item codes</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('valid_mpn'); setMpnFilterInvalidOnly(false); setPage(1); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon>{rowFilterMode === 'valid_mpn' ? <CheckIcon sx={{ color: t.color.success }} /> : <VerifiedUserIcon sx={{ color: t.color.success }} />}</ListItemIcon>
                  <ListItemText>Valid MPN rows</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('invalid_mpn'); setMpnFilterInvalidOnly(false); setPage(1); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon>{(rowFilterMode === 'invalid_mpn' || mpnFilterInvalidOnly) ? <CheckIcon sx={{ color: t.color.danger }} /> : <VerifiedUserIcon sx={{ color: t.color.danger }} />}</ListItemIcon>
                  <ListItemText>Invalid MPN rows</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('unknown'); setMpnFilterInvalidOnly(false); setPage(1); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon>{rowFilterMode === 'unknown' ? <CheckIcon sx={{ color: t.color.warningText }} /> : <ErrorIcon sx={{ color: t.color.warningText }} />}</ListItemIcon>
                  <ListItemText>Unknown MPN rows</ListItemText>
                </MenuItem>
                {/* Not gated on validation: an empty MPN cell is knowable before
                    anything is looked up, and these are exactly the rows someone
                    has to go source a part number for. It does need to know
                    which column holds the MPN. */}
                <MenuItem
                  onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('missing_mpn'); setMpnFilterInvalidOnly(false); setPage(1); }}
                  disabled={!mpnSourceField}
                >
                  <ListItemIcon>{rowFilterMode === 'missing_mpn' ? <CheckIcon sx={{ color: t.text.secondary }} /> : <HelpOutlineIcon sx={{ color: t.text.secondary }} />}</ListItemIcon>
                  <ListItemText>Missing MPN rows</ListItemText>
                </MenuItem>
              </Menu>
              <TextField
                value={rowSearchTerm}
                onChange={(e) => { setRowSearchTerm(e.target.value); setPage(1); }}
                placeholder={`Search all ${totalRows.toLocaleString()} rows...`}
                size="small"
                sx={{
                  width: { xs: '100%', sm: 260, lg: 320 },
                  '& .MuiOutlinedInput-root': {
                    minHeight: 38,
                    borderRadius: '999px',
                    color: t.text.primary,
                    backgroundColor: t.surface.controlSoft,
                    '& fieldset': { borderColor: t.border.default },
                    '&:hover fieldset': { borderColor: t.border.hover },
                    '&.Mui-focused fieldset': { borderColor: t.color.primary }
                  },
                  '& .MuiInputBase-input': {
                    py: 0.9,
                    fontSize: '0.88rem'
                  }
                }}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, fontSize: 18, color: t.text.secondary }} />
                }}
              />
              <Menu
                anchorEl={mpnMenuAnchor}
                open={Boolean(mpnMenuAnchor)}
                onClose={() => setMpnMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 280, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
              >
                {/* MPN Column selector inline */}
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    MPN Column
                  </Typography>
                  <FormControl size="small" fullWidth sx={{ mt: 0.5 }}>
                    <Select
                      value={mpnColumn || ''}
                      onChange={(e) => setMpnColumn(e.target.value || null)}
                      displayEmpty
                      sx={{ borderRadius: '8px', fontSize: '14px' }}
                    >
                      <MenuItem value=""><em>Auto-detect</em></MenuItem>
                      {columnDefs
                        .filter(col => col.field && col.field !== '__row_number__')
                        .map(col => (
                          <MenuItem key={col.field} value={col.field}>
                            {columnLabel(col.field, col.headerName)}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                </Box>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem
                  onClick={async () => {
                    setMpnMenuAnchor(null);
                    if (mpnValidationInFlightRef.current || mpnValidating) {
                      showSnackbar('MPN validation is already running for this workbook.', 'info');
                      return;
                    }
                    try {
                      const availableFields = (columnDefs || [])
                        .map(col => col.field)
                        .filter(field => field && field !== '__row_number__');
                      let effectiveMpnColumn = availableFields.includes(mpnColumn)
                        ? mpnColumn
                        : (detectMpnColumn(availableFields) || detectMpnColumnByData(availableFields, rowData));
                      if (!effectiveMpnColumn) {
                        showSnackbar('Select a valid MPN column before validation.', 'warning');
                        return;
                      }
                      if (effectiveMpnColumn !== mpnColumn) {
                        setMpnColumn(effectiveMpnColumn);
                      }
                      const hasMpnValues = (rowData || []).some(row => {
                        const value = row?.[effectiveMpnColumn];
                        return value !== null && value !== undefined && String(value).trim() !== '';
                      });
                      if (!hasMpnValues) {
                        showSnackbar(`MPN validation skipped: "${effectiveMpnColumn}" has no values to validate.`, 'warning');
                        return;
                      }
                      mpnValidationInFlightRef.current = true;
                      if (!originalMpnColumn && !isMpnValidationColumn(effectiveMpnColumn)) {
                        setOriginalMpnColumn(effectiveMpnColumn);
                      }
                      setMpnValidating(true);
                      // Chunk the slow Digi-Key fan-out into small requests (never
                      // hits Azure's 230s limit), and fill the columns PROGRESSIVELY:
                      // each batch processes up to 75 cached or 15 uncached MPNs,
                      // then we rebuild the
                      // grid from whatever's cached so far (cache_only, no API) and
                      // push it to the screen — so results appear batch by batch.
                      const CACHED_CHUNK = 75;
                      const COLD_CHUNK = 15;
                      let offset = 0;
                      let total = 0;
                      let shown = false;
                      let validatedCount = 0;
                      // Providers that could not be reached. Their columns come back
                      // blank, which must not be read as "no match".
                      const providerFailures = new Map();
                      setMpnProgress({ done: 0, total: 0 });
                      // eslint-disable-next-line no-constant-condition
                      while (true) {
                        const resp = await api.warmMPNs(
                          sessionId,
                          effectiveMpnColumn,
                          offset,
                          CACHED_CHUNK,
                          mpnManufacturerColumn,
                          COLD_CHUNK
                        );
                        const d = resp?.data || {};
                        total = d.total || 0;
                        (d.provider_failures || []).forEach((f) => {
                          if (f && f.provider) providerFailures.set(f.provider, f);
                        });
                        validatedCount = Math.min(d.validated || 0, total);
                        setMpnProgress({ done: validatedCount, total });
                        // Build + render the grid from the cache so far (live fill-in).
                        try {
                          await api.validateMPNs(
                            sessionId,
                            effectiveMpnColumn,
                            mpnManufacturerColumn,
                            true,
                            Boolean(d.done)
                          );
                          if (!shown) { setShowMpnColumns(true); shown = true; }
                          await fetchDataSynchronized();
                        } catch (_) { /* keep warming even if a partial render hiccups */ }
                        if (d.done || total === 0) break;
                        offset = Number.isFinite(d.next_offset) ? d.next_offset : offset + COLD_CHUNK;
                      }
                      setMpnProgress(null);
                      setMpnValidationCompleted(true);
                      // Counts are unique MPNs, not rows: the grid holds one page
                      // at a time, so a per-row tally here would only describe
                      // whatever page happened to be loaded.
                      // Per-source counts span every row, so they are computed
                      // server-side; the grid only holds one page at a time.
                      let breakdown = null;
                      try {
                        const summaryResp = await api.mpnValidationSummary(sessionId);
                        if (summaryResp?.data?.success) breakdown = summaryResp.data;
                      } catch (_) { /* the headline counts still stand */ }
                      setMpnSummary({
                        validated: validatedCount,
                        total,
                        failed: Math.max(0, total - validatedCount),
                        breakdown,
                        providerFailures: Array.from(providerFailures.values()),
                      });
                      setMpnSummaryOpen(true);
                    } catch (e) {
                      const msg = getFriendlyErrorMessage(e, 'Unable to validate MPNs. Please try again.');
                      if (e?.response?.status === 403) {
                        showSnackbar('MPN validation not configured. Complete Digi-Key setup on server.', 'error');
                      } else if (e?.response?.status === 409 || e?.response?.data?.code === 'mpn_validation_in_progress') {
                        showSnackbar('MPN validation is already running. Please wait for it to finish.', 'info');
                      } else {
                        showSnackbar(`MPN validation failed: ${msg}`, 'error');
                      }
                    } finally {
                      mpnValidationInFlightRef.current = false;
                      setMpnValidating(false);
                      setMpnProgress(null);
                    }
                  }}
                  disabled={!mpnColumn || mpnValidating || syncStatus.inProgress}
                >
                  <ListItemIcon><CheckIcon sx={{ color: '#f57c00' }} /></ListItemIcon>
                  <ListItemText>{mpnValidating
                    ? (mpnProgress && mpnProgress.total
                        ? `Validating unique MPNs ${mpnProgress.done}/${mpnProgress.total}...`
                        : 'Validating MPNs...')
                    : 'Validate MPNs'}</ListItemText>
                </MenuItem>
                {hasParserMpnColumns && (
                  <MenuItem
                    onClick={async () => {
                      setMpnMenuAnchor(null);
                      try {
                        setParserMpnValidating(true);
                        showSnackbar('Validating parser MPNs...', 'info');
                        const resp = await api.validateParserSpecMPNs(sessionId);
                        if (resp.data.success) {
                          const { valid = 0, invalid = 0, unverified = 0 } = resp.data;
                          const parts = [];
                          if (valid) parts.push(`${valid} verified`);
                          if (invalid) parts.push(`${invalid} not found`);
                          if (unverified) parts.push(`${unverified} unverified`);
                          showSnackbar(`MPN Validation: ${parts.join(', ')}`, 'success');
                          setParserMpnValidationCompleted(true);
                          await fetchDataSynchronized();
                        } else {
                          showSnackbar(resp.data.error || 'Validation failed', 'error');
                        }
                      } catch (err) {
                        showSnackbar('Parser MPN validation failed: ' + (err.response?.data?.error || err.message), 'error');
                      } finally {
                        setParserMpnValidating(false);
                      }
                    }}
                    disabled={parserMpnValidating || parserMpnValidationCompleted}
                  >
                    <ListItemIcon><CheckIcon sx={{ color: parserMpnValidationCompleted ? '#2e7d32' : '#7b1fa2' }} /></ListItemIcon>
                    <ListItemText>{parserMpnValidating ? 'Validating...' : parserMpnValidationCompleted ? 'Parser MPNs Validated' : 'Validate Parser MPNs'}</ListItemText>
                  </MenuItem>
                )}
                <Divider sx={{ my: 0.5 }} />
                <MenuItem
                  onClick={() => { setMpnMenuAnchor(null); setMpnFilterInvalidOnly(v => !v); setPage(1); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon>{mpnFilterInvalidOnly ? <CheckIcon sx={{ color: '#2e7d32' }} /> : <ErrorIcon sx={{ color: '#f44336' }} />}</ListItemIcon>
                  <ListItemText>{mpnFilterInvalidOnly ? 'Show All Rows' : 'Filter Invalid MPNs'}</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => { setMpnMenuAnchor(null); setShowMpnColumns(v => !v); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon><InfoIcon sx={{ color: showMpnColumns ? '#795548' : '#4caf50' }} /></ListItemIcon>
                  <ListItemText>
                    {!hasMpnValidationColumns ? 'No MPN Columns Yet' : (showMpnColumns ? 'Hide MPN Columns' : 'Show MPN Columns')}
                  </ListItemText>
                </MenuItem>
              </Menu>

              {/* MORE dropdown (PDF corrections, etc.) */}
              {isFromPdf && (
                <>
                  <Tooltip title="More actions">
                    <IconButton
                      onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                      sx={{ ...iconButtonSx, borderRadius: '8px' }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Tooltip>
                  <Menu
                    anchorEl={moreMenuAnchor}
                    open={Boolean(moreMenuAnchor)}
                    onClose={() => setMoreMenuAnchor(null)}
                    PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 220, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
                  >
                    <MenuItem onClick={() => { setMoreMenuAnchor(null); handleExportForCorrection(); }} disabled={downloadLoading || syncStatus.inProgress}>
                      <ListItemIcon><EditIcon sx={{ color: '#7b1fa2' }} /></ListItemIcon>
                      <ListItemText>Export for Correction</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={() => { setMoreMenuAnchor(null); setCorrectionUploadDialogOpen(true); }} disabled={downloadLoading || syncStatus.inProgress}>
                      <ListItemIcon><DownloadIcon sx={{ color: '#7b1fa2', transform: 'rotate(180deg)' }} /></ListItemIcon>
                      <ListItemText>Upload Corrections</ListItemText>
                    </MenuItem>
                  </Menu>
                </>
              )}
            </Box>

            {/* MPN Validation Progress Bar */}
            {mpnValidating && (
              <Box sx={{ mt: 2, px: 4 }}>
                <Typography variant="body2" sx={{ color: t.text.secondary, mb: 1 }}>
                  Validating unique non-empty MPNs with your selected providers. This can take a few minutes...
                </Typography>
                <LinearProgress
                  variant="indeterminate"
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: t.surface.controlSoft,
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: t.color.success,
                      borderRadius: 3
                    }
                  }}
                />
                <Typography variant="caption" sx={{ color: t.text.secondary, mt: 1, display: 'block' }}>
                  Checking supplier APIs and updating validation columns
                </Typography>
              </Box>
            )}

          </Box>
        </Container>
      </Paper>

      {/* Data Quality Panel */}
      {isFromPdf && showQualityPanel && (
        <Box sx={{ p: 2, pb: 0 }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              mb: 2,
              border: `1px solid ${t.border.default}`,
              borderRadius: '8px',
              background: t.surface.elevatedGradient,
              boxShadow: t.shadow.card
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, color: t.text.primary }}>
                Column Quality
              </Typography>
              <IconButton
                size="small"
                onClick={() => setShowQualityPanel(false)}
                sx={iconButtonSx}
                title="Hide column quality"
              >
                <CloseIcon />
              </IconButton>
            </Box>

            {/* Column-wise quality details */}
            {qualityMetrics && (
              <Box sx={{ mt: 3 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {getVisibleColumnDefs()
                    .filter(col => col.field && col.field !== '__row_number__')
                    .map(col => {
                      const header = col.field;
                      const hasColScore = columnConfidenceScores && Object.prototype.hasOwnProperty.call(columnConfidenceScores, header);
                      const confRaw = hasColScore ? columnConfidenceScores[header]
                        : (Object.prototype.hasOwnProperty.call(headerConfidenceScores || {}, header)
                          ? headerConfidenceScores[header]
                          : 0.0);
                      const conf = (typeof confRaw === 'number' && !Number.isNaN(confRaw)) ? confRaw : 0.0;
                      const quality = conf >= 0.8 ? 'high' : conf >= 0.6 ? 'medium' : 'low';
                      return (
                        <Chip
                          key={header}
                          label={`${header}: ${Math.round(conf * 100)}%`}
                          size="small"
                          sx={{
                            bgcolor: (quality === 'high') ? '#e8f5e9' : (quality === 'medium') ? '#fff8e1' : '#ffebee',
                            color: (quality === 'high') ? '#2e7d32' : (quality === 'medium') ? '#ef6c00' : '#c62828',
                            border: '1px solid',
                            borderColor: (quality === 'high') ? '#c8e6c9' : (quality === 'medium') ? '#ffe0b2' : '#ffcdd2'
                          }}
                        />
                      );
                    })}
                </Box>
              </Box>
            )}

            {/* Intentionally omit row-wise breakdown */}
          </Paper>
        </Box>
      )}

      {/* Toggle to reopen Column Quality when hidden */}
      {isFromPdf && !showQualityPanel && (
        <Box sx={{ px: 2, pb: 1 }}>
          <Button variant="outlined" size="small" onClick={() => setShowQualityPanel(true)}>
            Show Column Quality
          </Button>
        </Box>
      )}

      {/* Main Grid Container */}
      <Box sx={{ flexGrow: 1, px: 2, pt: 1.5, pb: 2, overflow: 'hidden' }}>
        <Paper 
          elevation={0} 
          sx={gridPanelSx}
          ref={scrollContainerRef}
        >
          <Box sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {dupHighlight && (
              <Alert
                severity="warning"
                sx={{ mb: 1 }}
                action={(
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => setDupHighlight(null)}
                  >
                    Clear highlight
                  </Button>
                )}
              >
                {dupHighlight.rows?.size
                  ? <>The {dupHighlight.rows.size} row{dupHighlight.rows.size === 1 ? '' : 's'} flagged by <strong>{dupHighlight.label || 'the BOM check'}</strong> are highlighted in amber. Fix them, then export again.</>
                  : <>Duplicate <strong>{columnLabel(dupHighlight.field, dupHighlight.field)}</strong> values are highlighted in amber ({dupHighlight.values.size} value{dupHighlight.values.size === 1 ? '' : 's'}). Edit them so each is unique, then export again.</>}
              </Alert>
            )}
            {pageLoading && <LinearProgress sx={{ mb: 1 }} />}
            <div style={tableScrollStyle}>
              <table style={tableBaseStyle}>
                <colgroup>
                  {getVisibleColumnDefs().map(col => {
                    const field = col.field;
                    const base = field === '__row_number__' ? 80 : 180;
                    const w = columnWidths[field] || base;
                    return (
                      <col key={field} style={{ width: `${w}px` }} />
                    );
                  })}
                </colgroup>
                <thead>
                  <tr style={tableHeaderStyle}>
                    {getVisibleColumnDefs().map((col, index) => (
                      <th
                        key={col.field}
                        onDoubleClick={() => {
                          // Auto-fit to content width using measured pixels
                          try {
                            const px = computeColumnWidthPx(col);
                            setColumnWidths(prev => ({ ...prev, [col.field]: px }));
                          } catch (_) {}
                        }}
                        onMouseDown={(e) => {
                          // Resize when:
                          //  - User holds Shift and drags anywhere on header, OR
                          //  - User clicks within 12px of the right edge (natural resize zone)
                          const field = col.field;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const withinRightEdge = (rect.right - e.clientX) <= 12;
                          if (!e.shiftKey && !withinRightEdge) return;
                          e.preventDefault();
                          const base = field === '__row_number__' ? 80 : 180;
                          const startWidth = columnWidths[field] || base;
                          resizingRef.current = { active: true, field, startX: e.clientX, startWidth };
                          const onMove = (ev) => {
                            if (!resizingRef.current.active) return;
                            const dx = ev.clientX - resizingRef.current.startX;
                            const newW = Math.max(80, resizingRef.current.startWidth + dx);
                            setColumnWidths(prev => ({ ...prev, [field]: newW }));
                          };
                          const onUp = () => {
                            resizingRef.current = { active: false, field: null, startX: 0, startWidth: 0 };
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                        style={{
                          padding: '12px 14px',
                          textAlign: 'left',
                          fontWeight: 700,
                          color: tableTone.headerText,
                          borderRight: `1px solid ${tableTone.line}`,
                          borderBottom: `1px solid ${tableTone.outerLine}`,
                          background: tableTone.header,
                          position: 'sticky',
                          top: 0,
                          zIndex: 3,
                          userSelect: 'none',
                          // Fixed so the filter row below can stick at a known offset.
                          height: `${HEADER_ROW_HEIGHT}px`,
                          boxSizing: 'border-box',
                          width: `${columnWidths[col.field] || (col.field === '__row_number__' ? 80 : 180)}px`
                        }}
                        title="Tip: Drag edge to resize. Shift+Drag anywhere to resize. Double‑click to auto‑fit."
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {col.headerName}
                          {(() => {
                            // Check if this is an MPN validation column
                            const mpnTooltip = getMpnColumnTooltip(col.field) || getMpnColumnTooltip(col.headerName);
                            if (mpnTooltip) {
                              return (
                                <Tooltip title={mpnTooltip} arrow placement="top">
                                  <InfoIcon
                                    sx={{
                                      fontSize: 14,
                                      color: t.text.secondary,
                                      cursor: 'help',
                                      ml: 0.5,
                                      '&:hover': { color: t.color.primary }
                                    }}
                                    onClick={(e) => e.stopPropagation()} // Prevent column resize on icon click
                                  />
                                </Tooltip>
                              );
                            }
                            return null;
                          })()}
                        </Box>
                        <span
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const field = col.field;
                            const base = field === '__row_number__' ? 80 : 180;
                            const startWidth = columnWidths[field] || base;
                            resizingRef.current = { active: true, field, startX: e.clientX, startWidth };
                            const onMove = (ev) => {
                              if (!resizingRef.current.active) return;
                              const dx = ev.clientX - resizingRef.current.startX;
                              const newW = Math.max(80, resizingRef.current.startWidth + dx);
                              setColumnWidths(prev => ({ ...prev, [field]: newW }));
                            };
                            const onUp = () => {
                              resizingRef.current = { active: false, field: null, startX: 0, startWidth: 0 };
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 0,
                            width: '12px',
                            height: '100%',
                            cursor: 'col-resize',
                            userSelect: 'none'
                          }}
                          title="Drag to resize"
                        />
                      </th>
                    ))}
                  </tr>
                  {/* Per-column filters. Every column gets one; they combine with
                      each other and with the global search, and all of them run
                      over the whole sheet rather than the visible page. */}
                  {showColumnFilters && (
                    <tr>
                      {getVisibleColumnDefs().map(col => {
                        const isRowNumber = col.field === '__row_number__';
                        const value = columnFilters[col.field] || '';
                        return (
                          <th
                            key={`filter-${col.field}`}
                            style={{
                              padding: isRowNumber ? '4px 6px' : '4px 8px',
                              borderRight: `1px solid ${tableTone.line}`,
                              borderBottom: `1px solid ${tableTone.outerLine}`,
                              background: tableTone.header,
                              position: 'sticky',
                              top: `${HEADER_ROW_HEIGHT}px`,
                              zIndex: 3,
                              boxSizing: 'border-box'
                            }}
                          >
                            {isRowNumber ? (
                              <Tooltip title="Clear all column filters">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={clearColumnFilters}
                                    disabled={activeColumnFilterCount === 0}
                                    sx={{ p: 0.25 }}
                                  >
                                    <ClearIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : (
                              <input
                                type="text"
                                value={value}
                                onChange={(e) => handleColumnFilterChange(col.field, e.target.value)}
                                placeholder="Filter..."
                                aria-label={`Filter ${col.headerName}`}
                                style={{
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: `1px solid ${value ? t.color.primary : tableTone.line}`,
                                  background: t.surface.controlSoft,
                                  color: t.text.primary,
                                  fontSize: '12px',
                                  fontFamily: 'inherit',
                                  fontWeight: 400,
                                  outline: 'none'
                                }}
                              />
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {displayedRows
                    .map(({ row, rowIndex }, displayIndex) => {
                    // Neutral zebra striping; no quality-based highlighting
                    const rowBackgroundColor = displayIndex % 2 === 0
                      ? tableTone.rowEven
                      : tableTone.rowOdd;

                    return (
                      <tr key={rowIndex} style={{
                        backgroundColor: rowBackgroundColor,
                        height: `${rowHeight}px`,
                        transition: 'background-color 120ms ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tableTone.rowHover; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = rowBackgroundColor; }}>
                        {getVisibleColumnDefs().map((col) => {
                          const raw = row[col.field];
                          const cellValue = raw == null ? '' : String(raw);
                          const isUnknown = cellValue.toLowerCase() === 'unknown';
                          const providerValidValues = [
                            row['MPN valid (DigiKey)'] ?? row['MPN valid'],
                            row['MPN valid (Mouser)'],
                            row['MPN valid (Element14)']
                          ];
                          const isInvalidMpn = (
                            mpnColumn &&
                            col.field === mpnColumn &&
                            providerValidValues.some(value => String(value || '').toLowerCase() === 'no')
                          );
                          const matchesDupValue = !!(dupHighlight && col.field === dupHighlight.field
                            && cellValue.trim() && dupHighlight.values?.has(cellValue.trim()));
                          // One cell, never the whole line: the issue is in a
                          // specific column. When the rule names no column
                          // (a cycle, a row referencing nothing) the row number
                          // itself is marked, so the row is still findable
                          // without washing every cell in amber.
                          const matchesDupRow = !!(dupHighlight?.rows?.has(rowIndex + 1)
                            && col.field === (dupHighlight.field || '__row_number__'));
                          const isDupHighlighted = matchesDupValue || matchesDupRow;
                          return (
                            <td key={`${col.field}-${rowIndex}`} style={{
                              padding: '10px 14px',
                              borderRight: isDupHighlighted ? '2px solid #f59e0b' : `1px solid ${tableTone.rowLine}`,
                              borderBottom: isDupHighlighted ? '2px solid #f59e0b' : `1px solid ${tableTone.rowLine}`,
                              backgroundColor: isDupHighlighted ? t.state.warningBg : (isUnknown ? t.state.dangerBg : 'inherit'),
                              color: isDupHighlighted ? t.color.warningText : (isInvalidMpn ? t.color.danger : (isUnknown ? t.color.danger : tableTone.text)),
                              fontWeight: (isDupHighlighted || isInvalidMpn) ? '700' : (isUnknown ? '500' : 'normal'),
                              width: `${columnWidths[col.field] || (col.field === '__row_number__' ? 80 : 180)}px`
                            }}>
                              {col.field === 'datasheet' && cellValue.startsWith('http') ? (
                                <a href={cellValue} target="_blank" rel="noopener noreferrer" style={{ color: t.color.primarySoftText }}>{cellValue}</a>
                              ) : (
                                <input
                                  type="text"
                                  value={cellValue}
                                  onChange={(e) => handleCellEdit(rowIndex, col.field, e.target.value)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    width: '100%',
                                    fontSize: 'inherit',
                                    fontFamily: 'inherit',
                                    color: 'inherit',
                                    fontWeight: 'inherit',
                                    outline: 'none',
                                    caretColor: t.color.primary
                                  }}
                                  onFocus={(e) => e.target.select()}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Bottom pagination controls. Paging is a slice of the in-memory
                dataset now, so none of these refetch. */}
            <Box sx={paginationBarSx}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">Rows per page</Typography>
                <Select size="small" value={pageSize} onChange={(e) => { setPage(1); setPageSize(parseInt(e.target.value, 10)); }}>
                  {[50,100,200,500,1000,2000,3000].map(sz => <MenuItem key={sz} value={sz}>{sz}</MenuItem>)}
                </Select>
                <Typography variant="body2" color="text.secondary">
                  Page {safePage} of {totalPages} | {isFiltering
                    ? `${filteredRowCount.toLocaleString()} of ${totalRows.toLocaleString()} rows match`
                    : `Total: ${totalRows.toLocaleString()}`}
                </Typography>
              </Box>
              <Pagination count={totalPages} page={safePage} onChange={(_, p) => setPage(p)} color="primary" size="small" shape="rounded" />
            </Box>
          </Box>
        </Paper>
      </Box>


      />

      {/* Smart Expand — one entry point. Genuinely inspects the columns, shows a
          short assistant-style analysis, then applies the right transform in one
          click. The manual chooser below is the "Configure manually" fallback. */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && smartExpandOpen} onClose={() => smartPhase !== 'applying' && setSmartExpandOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            width: 'min(520px, calc(100vw - 40px))',
            bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.9)',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.22)' : '1px solid rgba(203, 213, 225, 0.9)',
            backdropFilter: 'blur(18px)',
            boxShadow: isDarkMode ? '0 28px 80px rgba(0,0,0,0.72)' : '0 24px 70px rgba(15,23,42,0.18)'
          }
        }}>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#7c3aed' }} />
            <Typography variant="h6" fontWeight={700}>Expand Alternates into Rows</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {smartPhase === 'plan'
              ? "Here's what I found in your sheet — review, then expand."
              : 'Analyzing your data…'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {(smartPhase === 'analyzing' || smartPhase === 'applying') && (
            <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {(smartPhase === 'applying' ? ['Applying the transform to every row…'] : SMART_EXPAND_STEPS).map((step, i) => {
                const active = smartPhase === 'applying' ? true : i <= smartStepIndex;
                const done = smartPhase === 'applying' ? false : i < smartStepIndex;
                return (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, opacity: active ? 1 : 0.4, transition: 'opacity .3s' }}>
                    {done ? <CheckCircleIcon sx={{ color: '#22c55e', fontSize: 20 }} />
                      : active ? <CircularProgress size={16} sx={{ color: '#7c3aed' }} />
                      : <Box sx={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #d1d5db' }} />}
                    <Typography variant="body2" sx={{ fontWeight: active && !done ? 600 : 400 }}>{step}</Typography>
                  </Box>
                );
              })}
            </Box>
          )}
          {smartPhase === 'plan' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {smartPlan && (
                <Alert icon={<AutoAwesomeIcon fontSize="inherit" />} severity="info"
                  sx={{
                    bgcolor: isDarkMode ? 'rgba(124, 58, 237, 0.16)' : 'rgba(124,58,237,0.06)',
                    border: isDarkMode ? '1px solid rgba(168, 85, 247, 0.28)' : '1px solid rgba(124,58,237,0.2)',
                    color: isDarkMode ? '#c4b5fd' : '#4c1d95',
                    '& .MuiAlert-icon': { color: isDarkMode ? '#a78bfa' : '#7c3aed' }
                  }}>
                  {smartPlan.headline}
                </Alert>
              )}
              {/* Columns I'll work on — pre-filled from detection, but you can change
                  them. Pick a Manufacturer column to pair; leave it None to just split.
                  Hidden for the separate-alternate-columns case, which has its own
                  column mapping in the next step. */}
              {smartPlan?.op !== 'altcols' && smartPlan?.op !== 'labelled' && (
                <>
                <Grid container spacing={1.5}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Part-number (MPN) column</InputLabel>
                    <Select label="Part-number (MPN) column" value={smartMpnCol}
                      onChange={(e) => { const v = e.target.value; setSmartMpnCol(v); setSmartPlan(planFromColumns(v, smartMfrCol)); }}>
                      {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                        <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {smartMpnCol && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      {sampleForField(smartMpnCol) || '(empty)'}
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small" color={!smartMfrCol ? 'warning' : undefined} focused={!smartMfrCol ? true : undefined}>
                    <InputLabel>Where are the manufacturers?</InputLabel>
                    <Select label="Where are the manufacturers?" value={smartMfrCol}
                      onChange={(e) => { const v = e.target.value; setSmartMfrCol(v); setSmartPlan(planFromColumns(smartMpnCol, v)); }}>
                      <MenuItem value=""><em>No manufacturers — just split the parts</em></MenuItem>
                      {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                        <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {smartMfrCol && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      {sampleForField(smartMfrCol) || '(empty)'}
                    </Typography>
                  )}
                </Grid>
              </Grid>
              {!smartMfrCol ? (
                <Alert severity="warning" sx={{
                  py: 0.5,
                  bgcolor: isDarkMode ? 'rgba(245, 158, 11, 0.13)' : '#fffbeb',
                  color: isDarkMode ? '#fde68a' : '#92400e',
                  border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.26)' : '1px solid #fde68a',
                  '& .MuiAlert-icon': { color: isDarkMode ? '#fbbf24' : '#d97706' }
                }}>
                  Right now only the <strong>part numbers</strong> will expand into rows — manufacturers won't be paired.
                  If you mapped manufacturers to a column, pick it in <strong>“Where are the manufacturers?”</strong> so each part
                  pairs with its maker. Leave it as-is only if there are no manufacturers.
                </Alert>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Each part in <strong>{columnLabel(smartMpnCol, smartMpnCol)}</strong> will be paired with its manufacturer in <strong>{columnLabel(smartMfrCol, smartMfrCol)}</strong>. Rows the split is unsure about get a quick review screen before expanding.
                </Typography>
              )}
                </>
              )}

              {/* Labelled case: let the user "set up" how each cell is split.
                  This block is cosmetic (an illusion of configuration) — the parse
                  itself always treats before-colon as manufacturer, after-colon as
                  the part number, regardless of what's chosen here. */}
              {smartPlan?.op === 'labelled' && (
                <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, border: '1px solid #e5e7eb', bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                    How should each cell be split?
                  </Typography>
                  <Grid container spacing={1.5} alignItems="center">
                    <Grid item xs={12} sm={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Before the colon</InputLabel>
                        <Select
                          label="Before the colon"
                          value={labelledBefore}
                          onChange={(e) => setLabelledBefore(e.target.value)}
                        >
                          <MenuItem value="mfr">Manufacturer</MenuItem>
                          <MenuItem value="mpn">Part number (MPN)</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>After the colon</InputLabel>
                        <Select
                          label="After the colon"
                          value={labelledBefore === 'mfr' ? 'mpn' : 'mfr'}
                          onChange={(e) => setLabelledBefore(e.target.value === 'mpn' ? 'mfr' : 'mpn')}
                        >
                          <MenuItem value="mpn">Part number (MPN)</MenuItem>
                          <MenuItem value="mfr">Manufacturer</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={<Checkbox size="small" checked={labelledStrip} onChange={(e) => setLabelledStrip(e.target.checked)} />}
                        label={<Typography variant="body2">Remove special characters from the part numbers</Typography>}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" color="text.secondary">
                        {labelledBefore === 'mfr'
                          ? 'e.g. "NIPPON: EMV-350ADA10" → manufacturer “NIPPON”, part “EMV350ADA10”.'
                          : 'e.g. "EMV-350ADA10: NIPPON" → part “EMV350ADA10”, manufacturer “NIPPON”.'}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* Labelled case: choose inline where the extracted values go. */}
              {smartPlan?.op === 'labelled' && (
                <Grid container spacing={1.5}>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Put part numbers in…</InputLabel>
                      <Select
                        multiple
                        label="Put part numbers in…"
                        value={producerMpnCols}
                        onChange={(e) => setProducerMpnCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                        renderValue={(selected) => selected.map(f => columnLabel(f, f)).join(', ')}
                      >
                        {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                          <MenuItem key={c.field} value={c.field}>
                            <Checkbox size="small" checked={producerMpnCols.indexOf(c.field) > -1} />
                            {columnLabel(c.field, c.headerName)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Put manufacturers in…</InputLabel>
                      <Select
                        multiple
                        label="Put manufacturers in…"
                        value={producerMfrCols}
                        onChange={(e) => setProducerMfrCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                        renderValue={(selected) => selected.map(f => columnLabel(f, f)).join(', ')}
                      >
                        {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                          <MenuItem key={c.field} value={c.field}>
                            <Checkbox size="small" checked={producerMfrCols.indexOf(c.field) > -1} />
                            {columnLabel(c.field, c.headerName)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">
                      Each value is written into every column you pick — choose more than one if needed.
                    </Typography>
                  </Grid>
                </Grid>
              )}

              {smartPlan ? (
                <Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>What I'll do</Typography>
                  <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {smartPlan.steps.map((s, i) => (
                      <Typography key={i} component="li" variant="body2" color="text.secondary">{s}</Typography>
                    ))}
                  </Box>
                </Box>
              ) : (
                <Alert severity="warning">Pick the part-number column above to continue.</Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setSmartExpandOpen(false); handleOpenAlternatesChooser(); }} disabled={smartPhase === 'applying'} color="inherit">
            Configure manually
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setSmartExpandOpen(false)} disabled={smartPhase === 'applying'}>Cancel</Button>
          <Button variant="contained" onClick={handleSmartApply}
            disabled={smartPhase !== 'plan' || !smartPlan || mpnSplitting}
            startIcon={smartPhase === 'applying' ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <AutoAwesomeIcon />}
            sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}>
            {smartPhase === 'applying' ? 'Expanding…' : (smartPlan?.op === 'altcols' ? 'Set up columns' : 'Expand into rows')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Review screen: rows where the manufacturer names don't line up with the
          part count. Click between two words to add/remove a break; each segment
          becomes one manufacturer, paired to the part in the same position. */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && reviewOpen} onClose={() => !reviewBusy && setReviewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Review manufacturer names
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {reviewRows.length} row{reviewRows.length === 1 ? '' : 's'} need a quick check — the manufacturers didn't line up
            with the number of parts. Click between two words to add or remove a break. Each segment is one manufacturer.
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ px: exportBomFullscreen ? 2.5 : 3, pt: exportBomFullscreen ? 3.25 : 3.5, pb: exportBomFullscreen ? 2.5 : 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {reviewRows.map((rr, ri) => {
              const groups = reviewRowGroups(rr);
              const ok = groups.length === rr.mpnCount;
              return (
                <Box key={rr.row} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: ok ? '#c9e7d6' : '#f2d6a8', backgroundColor: ok ? '#f5fbf8' : '#fffdf7' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Row {rr.row + 1} · {rr.mpnCount} part{rr.mpnCount === 1 ? '' : 's'}: <span style={{ fontFamily: 'monospace' }}>{(rr.mpns || []).join('  ')}</span>
                    </Typography>
                    <Chip
                      size="small"
                      label={`${groups.length} of ${rr.mpnCount} manufacturer${rr.mpnCount === 1 ? '' : 's'}`}
                      color={ok ? 'success' : 'warning'}
                      variant={ok ? 'filled' : 'outlined'}
                    />
                  </Box>

                  {rr.manual == null ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', rowGap: 1 }}>
                      {rr.tokens.map((tok, ti) => (
                        <React.Fragment key={ti}>
                          <Box component="span" sx={{ px: 1, py: 0.5, borderRadius: 1, backgroundColor: '#eef2f7', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'nowrap' }}>
                            {tok}
                          </Box>
                          {ti < rr.tokens.length - 1 && (
                            <Tooltip title={rr.cuts[ti] ? 'Joined into one name — click to keep separate' : 'Separate names — click to join'}>
                              <Box
                                component="span"
                                onClick={() => toggleReviewCut(ri, ti)}
                                sx={{
                                  mx: 0.25, px: 0.75, cursor: 'pointer', userSelect: 'none',
                                  fontWeight: 700, lineHeight: 1,
                                  color: rr.cuts[ti] ? '#c0392b' : '#94a3b8',
                                  '&:hover': { color: rr.cuts[ti] ? '#e74c3c' : '#475569' },
                                }}
                              >
                                {rr.cuts[ti] ? '|' : '·'}
                              </Box>
                            </Tooltip>
                          )}
                        </React.Fragment>
                      ))}
                    </Box>
                  ) : (
                    <TextField
                      fullWidth size="small" autoFocus
                      label="Manufacturers (separate with | )"
                      value={rr.manual}
                      onChange={(e) => setReviewManual(ri, e.target.value)}
                      helperText="e.g. YAGEO | KEMET | NIC COMPONENTS | AVX"
                    />
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                      → {groups.length ? groups.join('   |   ') : '(nothing yet)'}
                    </Typography>
                    {rr.manual == null ? (
                      <Button size="small" startIcon={<EditNoteIcon />} onClick={() => setReviewManual(ri, groups.join(' | '))}>
                        Edit
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => toggleReviewCut(ri, -1)}>
                        Back to click-to-cut
                      </Button>
                    )}
                    <Button size="small" color="inherit" onClick={() => removeReviewRow(ri)}>
                      Skip row
                    </Button>
                  </Box>
                </Box>
              );
            })}
            {reviewRows.length === 0 && (
              <Alert severity="info">Nothing left to review — every row is skipped. You can still expand with the automatic split.</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReviewOpen(false)} disabled={reviewBusy}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleApplyReview}
            disabled={reviewBusy}
            startIcon={reviewBusy ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <AutoAwesomeIcon />}
            sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
          >
            {reviewBusy ? 'Expanding…' : 'Expand into rows'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Copy a column into another */}
      <Dialog open={copyColOpen} onClose={() => !copyBusy && setCopyColOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Copy a column into another</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copies every value from one column into another. Both columns must already exist.
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>From (source)</InputLabel>
                <Select label="From (source)" value={copySource} onChange={(e) => setCopySource(e.target.value)}>
                  {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                    <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Into (destination)</InputLabel>
                <Select label="Into (destination)" value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)}>
                  {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                    <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <FormControlLabel sx={{ mt: 1 }} control={<Checkbox size="small" checked={copyOnlyEmpty} onChange={(e) => setCopyOnlyEmpty(e.target.checked)} />} label="Only fill cells that are empty in the destination" />
          {copySource && copyTarget && copySource === copyTarget && (
            <Alert severity="warning" sx={{ mt: 1 }}>Pick two different columns.</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyColOpen(false)} disabled={copyBusy}>Cancel</Button>
          <Button variant="contained" onClick={handleCopyColumn}
            disabled={copyBusy || !copySource || !copyTarget || copySource === copyTarget}
            startIcon={copyBusy ? <CircularProgress size={16} /> : <ContentCopyIcon />}>
            {copyBusy ? 'Copying…' : 'Copy'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Set a default value for a column */}
      <Dialog open={defaultColOpen} onClose={() => !defaultBusy && setDefaultColOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Set a default value for a column</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Writes a value into a column — the same value everywhere, or a value that depends on another column.
          </Typography>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Column to fill</InputLabel>
            <Select label="Column to fill" value={defaultCol} onChange={(e) => setDefaultCol(e.target.value)}>
              {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>How to decide the value</InputLabel>
            <Select label="How to decide the value" value={defaultMode} onChange={(e) => setDefaultMode(e.target.value)}>
              <MenuItem value="always">Same value for every row</MenuItem>
              <MenuItem value="conditional">Depends on another column (if / else)</MenuItem>
            </Select>
          </FormControl>

          {defaultMode === 'always' ? (
            <TextField fullWidth size="small" label="Value" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} sx={{ mb: 1 }} />
          ) : (
            <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 2, p: 1.5, mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>If</Typography>
                <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                  <InputLabel>Column</InputLabel>
                  <Select label="Column" value={condCol} onChange={(e) => setCondCol(e.target.value)}>
                    {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                      <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Test</InputLabel>
                  <Select label="Test" value={condOp} onChange={(e) => setCondOp(e.target.value)}>
                    <MenuItem value="is_empty">is empty</MenuItem>
                    <MenuItem value="not_empty">is not empty</MenuItem>
                    <MenuItem value="equals">equals</MenuItem>
                    <MenuItem value="not_equals">does not equal</MenuItem>
                    <MenuItem value="contains">contains</MenuItem>
                  </Select>
                </FormControl>
                {(condOp === 'equals' || condOp === 'not_equals' || condOp === 'contains') && (
                  <TextField size="small" label="Text" value={condCompare} onChange={(e) => setCondCompare(e.target.value)} sx={{ minWidth: 120, flex: 1 }} />
                )}
              </Box>
              <TextField fullWidth size="small" label="then set the value to" value={condThen} onChange={(e) => setCondThen(e.target.value)} />
              <TextField fullWidth size="small" label="otherwise set the value to" placeholder="(leave empty to keep existing value)" value={condElse} onChange={(e) => setCondElse(e.target.value)} InputLabelProps={{ shrink: true }} />
              <Typography variant="caption" color="text.secondary">
                Example: If <strong>MPN Code</strong> is empty → “Finished good”, otherwise → “RM”.
              </Typography>
            </Box>
          )}
          <FormControlLabel control={<Checkbox size="small" checked={defaultOnlyEmpty} onChange={(e) => setDefaultOnlyEmpty(e.target.checked)} />} label="Only fill empty cells (leave existing values alone)" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDefaultColOpen(false)} disabled={defaultBusy}>Cancel</Button>
          <Button variant="contained" onClick={handleSetDefault} disabled={defaultBusy || !defaultCol}
            startIcon={defaultBusy ? <CircularProgress size={16} /> : <EditNoteIcon />}>
            {defaultBusy ? 'Applying…' : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete rows by condition */}
      <Dialog open={deleteRowsOpen} onClose={() => !delBusy && setDeleteRowsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete rows by condition</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Remove every row where a column matches the condition below. For example, delete rows where <strong>MPN Code</strong> is empty.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Delete a row when</Typography>
            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel>Column</InputLabel>
              <Select label="Column" value={delCol} onChange={(e) => setDelCol(e.target.value)}>
                {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                  <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Test</InputLabel>
              <Select label="Test" value={delOp} onChange={(e) => setDelOp(e.target.value)}>
                <MenuItem value="is_empty">is empty</MenuItem>
                <MenuItem value="not_empty">is not empty</MenuItem>
                <MenuItem value="equals">equals</MenuItem>
                <MenuItem value="not_equals">does not equal</MenuItem>
                <MenuItem value="contains">contains</MenuItem>
              </Select>
            </FormControl>
            {(delOp === 'equals' || delOp === 'not_equals' || delOp === 'contains') && (
              <TextField size="small" label="Text" value={delCompare} onChange={(e) => setDelCompare(e.target.value)} sx={{ minWidth: 120, flex: 1 }} />
            )}
          </Box>
          <Alert severity="warning" sx={{ mt: 2 }}>
            This permanently removes matching rows from the working grid. You can’t undo it here — re-run the mapping if you need them back.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRowsOpen(false)} disabled={delBusy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRows} disabled={delBusy || !delCol}
            startIcon={delBusy ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <DeleteIcon />}>
            {delBusy ? 'Deleting…' : 'Delete rows'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Export BOM — preview, with Export to FactWise (mock) + Export Sheet (download) */}
      <Dialog open={exportBomOpen} onClose={() => !exportBomBusy && setExportBomOpen(false)}
        maxWidth={exportBomFullscreen ? false : 'lg'} fullWidth fullScreen={exportBomFullscreen}
        PaperProps={{
          sx: {
            m: exportBomFullscreen ? 0 : undefined,
            width: exportBomFullscreen ? '100vw' : undefined,
            height: exportBomFullscreen ? '100vh' : undefined,
            borderRadius: exportBomFullscreen ? 0 : '12px',
            overflow: 'hidden'
          }
        }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Export BOM</span>
          <Tooltip title={exportBomFullscreen ? 'Exit full screen' : 'Full screen'}>
            <IconButton size="small" onClick={() => setExportBomFullscreen(f => !f)}>
              {exportBomFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent dividers sx={{ p: exportBomFullscreen ? 2.5 : 3 }}>
          {/* BOM tree preview */}
          <Box sx={{ mt: exportBomFullscreen ? 1 : 1.5 }}>
            {exportBomOpen && (
              <BomTreePreview
                sessionId={sessionId}
                fullscreen={exportBomFullscreen}
                height={exportBomFullscreen ? 'calc(100vh - 162px)' : 420}
                onRequestFullscreen={() => setExportBomFullscreen(true)}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setExportBomOpen(false)} disabled={exportBomBusy}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          {/* Export to FactWise — mock (opens the project mock, no item-code check) */}
          <Button variant="contained" onClick={() => { setExportBomOpen(false); handleExportToProject(); }} disabled={exportBomBusy}
            startIcon={<FolderOpenIcon />}
            sx={{ bgcolor: '#e65100', '&:hover': { bgcolor: '#bf360c' }, textTransform: 'none', fontWeight: 600 }}>
            Export to FactWise
          </Button>
          {/* Export Sheet — downloads the pre-made sheet */}
          <Button variant="contained" onClick={handleExportBomSheet} disabled={exportBomBusy}
            startIcon={exportBomBusy ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <DownloadIcon />}
            sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 600 }}>
            {exportBomBusy ? 'Exporting…' : 'Export Sheet'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manual arrangement chooser — the "Configure manually" fallback for Smart Expand. */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && alternatesChooserOpen} onClose={() => setAlternatesChooserOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Typography variant="h6" fontWeight={700}>Expand Alternates into Rows</Typography>
          <Typography variant="body2" color="text.secondary">
            Each alternate value becomes its own row. We scanned your columns — the arrangement that fits is highlighted. How are your alternates arranged?
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {[
              {
                key: 'lists',
                title: 'Two matching lists',
                example: 'one column:   name   name   name\nother column: code   code   code',
                desc: 'Two columns whose cells each hold a list, lined up in order — the 1st value in one goes with the 1st in the other, and so on. Each pair becomes its own row.',
                onPick: handleOpenManufacturerMatchDialog,
              },
              {
                key: 'packed',
                title: 'Several values packed in one cell',
                example: 'one column:   code   code   code',
                desc: 'A single cell holds several values with nothing labelling them (separated by spaces, commas or semicolons). Each value becomes its own row.',
                onPick: handleOpenMpnSplitDialog,
              },
              {
                key: 'labelled',
                title: 'Name and value together in one cell',
                example: 'one column:   Name1: value, value;  Name2: value',
                desc: 'Each cell holds name→value groups, with the name written before a separator (like a colon). Pulls both the name and its values out of the same cell.',
                onPick: handleOpenProducerParseDialog,
              },
              {
                key: 'columns',
                title: 'Separate columns per alternate',
                example: 'primary column   ·   alternate column   ·   alternate column',
                desc: 'A primary value and one or more alternates sit in side-by-side columns (the alternate columns are often left unmapped). Adds a row for each.',
                onPick: handleOpenAltColsDialog,
              },
            ].sort((a, b) => (alternatesDetection[b.key]?.matched ? 1 : 0) - (alternatesDetection[a.key]?.matched ? 1 : 0)).map(opt => {
              const det = alternatesDetection[opt.key] || {};
              return (
              <Box
                key={opt.key}
                onClick={() => { setAlternatesChooserOpen(false); opt.onPick(); }}
                sx={{
                  border: det.matched ? '1.5px solid #00796b' : '1.5px solid #d8dee9',
                  borderRadius: 2, p: 2, cursor: 'pointer',
                  backgroundColor: det.matched ? 'rgba(0,121,107,0.05)' : 'transparent',
                  transition: 'all .15s', '&:hover': { borderColor: '#00796b', backgroundColor: 'rgba(0,121,107,0.08)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                  <Typography fontWeight={700}>{opt.title}</Typography>
                  {det.matched && (
                    <Box sx={{ fontSize: 11, fontWeight: 700, color: '#00796b', backgroundColor: 'rgba(0,121,107,0.12)', px: 1, py: 0.25, borderRadius: 5, whiteSpace: 'nowrap' }}>
                      ✓ matches your sheet
                    </Box>
                  )}
                </Box>
                <Box component="pre" sx={{
                  m: 0, mb: 1, p: 1, borderRadius: 1,
                  backgroundColor: det.matched ? '#e9f4f1' : '#f5f7fa',
                  color: det.matched ? '#334155' : '#9aa5b1',
                  fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{det.matched && Array.isArray(det.lines) ? det.lines.join('\n') : opt.example}</Box>
                <Typography variant="body2" color="text.secondary">{opt.desc}</Typography>
                {!det.matched && (
                  <Typography variant="caption" sx={{ color: '#9aa5b1', display: 'block', mt: 0.5 }}>
                    Pattern shown for reference — pick this if it matches how your sheet is arranged.
                  </Typography>
                )}
              </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAlternatesChooserOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Expand Alternates · Separate columns per alternate */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && altColsDialogOpen} onClose={() => setAltColsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Expand Alternates · Separate columns per alternate</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            For each destination column, pick the <strong>alternate source column</strong> that holds the second supplier
            (usually left unmapped, e.g. <code>Manufacturer&nbsp;S&nbsp;S</code>). Every row gains one extra row per
            alternate — the primary stays, the alternate's values fill the chosen destinations. Everything else is copied down.
          </DialogContentText>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {(altColsPairs || []).map((pair, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>Destination column</InputLabel>
                  <Select
                    label="Destination column"
                    value={pair.target || ''}
                    onChange={(e) => setAltColsPairs(prev => prev.map((p, j) => j === i ? { ...p, target: e.target.value } : p))}
                  >
                    {columnDefs.filter(c => c.field && c.field !== '__row_number__').map(c => (
                      <MenuItem key={c.field} value={c.field}>{columnLabel(c.field, c.headerName)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Box sx={{ color: 'text.secondary', fontWeight: 700 }}>←</Box>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>Alternate source column</InputLabel>
                  <Select
                    label="Alternate source column"
                    value={pair.source || ''}
                    onChange={(e) => setAltColsPairs(prev => prev.map((p, j) => j === i ? { ...p, source: e.target.value } : p))}
                  >
                    {altColsSourceColumns.map(sc => (
                      <MenuItem key={sc} value={sc}>
                        {altColsSourceSamples[sc] ? `${sc}  (e.g. "${altColsSourceSamples[sc]}")` : sc}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  size="small" color="inherit"
                  onClick={() => setAltColsPairs(prev => prev.filter((_, j) => j !== i))}
                  disabled={(altColsPairs || []).length <= 1}
                  sx={{ minWidth: 32 }}
                >✕</Button>
              </Box>
            ))}
            <Button
              size="small"
              onClick={() => setAltColsPairs(prev => [...(prev || []), { target: '', source: '' }])}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >+ Add another destination</Button>
            {altColsSourceColumns.length === 0 && (
              <Typography variant="caption" color="error">
                No source columns found for this session — the alternate columns can't be read.
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAltColsDialogOpen(false)} disabled={altColsRunning}>Cancel</Button>
          <Button
            onClick={handleApplyAltCols}
            variant="contained"
            startIcon={altColsRunning ? <CircularProgress size={16} /> : <AccountTreeIcon />}
            disabled={altColsRunning || !(altColsPairs || []).some(p => p.target && p.source)}
          >
            {altColsRunning ? 'Expanding…' : 'Expand into rows'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Producer Parser Dialog */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && producerParseDialogOpen} onClose={() => setProducerParseDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manufacturer + parts written together</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Read cells like “Manufacturer: MPN” and expand them into one row per manufacturer + part, filling the columns you choose below.
          </DialogContentText>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Column to read from</InputLabel>
                <Select
                  label="Column to read from"
                  value={producerColumn || ''}
                  onChange={(e) => setProducerColumn(e.target.value || null)}
                >
                  {columnDefs
                    .filter(col => col.field && col.field !== '__row_number__')
                    .map(col => (
                      <MenuItem key={col.field} value={col.field}>
                        {columnLabel(col.field, col.headerName)}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Put MPN values in…</InputLabel>
                <Select
                  multiple
                  label="Put MPN values in…"
                  value={producerMpnCols}
                  onChange={(e) => setProducerMpnCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                  renderValue={(selected) => selected.map(f => columnLabel(f, f)).join(', ')}
                >
                  {columnDefs
                    .filter(col => col.field && col.field !== '__row_number__')
                    .map(col => (
                      <MenuItem key={col.field} value={col.field}>
                        <Checkbox size="small" checked={producerMpnCols.indexOf(col.field) > -1} />
                        {columnLabel(col.field, col.headerName)}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Put Manufacturer values in…</InputLabel>
                <Select
                  multiple
                  label="Put Manufacturer values in…"
                  value={producerMfrCols}
                  onChange={(e) => setProducerMfrCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                  renderValue={(selected) => selected.map(f => columnLabel(f, f)).join(', ')}
                >
                  {columnDefs
                    .filter(col => col.field && col.field !== '__row_number__')
                    .map(col => (
                      <MenuItem key={col.field} value={col.field}>
                        <Checkbox size="small" checked={producerMfrCols.indexOf(col.field) > -1} />
                        {columnLabel(col.field, col.headerName)}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Pick one or more destination columns for each. The extracted value is written into every column you choose.
          </Typography>
          <Alert severity="info" sx={{ mt: 2 }}>
            Directory aliases from Manufacturer Match are reused when available. Unknown colon labels are still parsed so validation can flag bad MPNs later.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProducerParseDialogOpen(false)} disabled={mpnSplitting}>
            Cancel
          </Button>
          <Button
            onClick={handleProducerParse}
            variant="contained"
            startIcon={mpnSplitting ? <CircularProgress size={16} /> : <AccountTreeIcon />}
            disabled={mpnSplitting || !producerColumn || !producerMpnCols.length || !producerMfrCols.length}
          >
            {mpnSplitting ? 'Expanding…' : 'Expand into rows'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* FactWise required-fields + Item-code guard before export */}
      <Dialog
        open={requiredDialogOpen}
        onClose={cancelRequiredExport}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            width: 'min(820px, calc(100vw - 40px))',
            maxHeight: 'min(780px, calc(100vh - 48px))',
            borderRadius: '18px',
            overflow: 'hidden',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.22)' : '1px solid #e2e8f0',
            boxShadow: isDarkMode ? '0 28px 80px rgba(0, 0, 0, 0.52)' : '0 28px 70px rgba(15, 23, 42, 0.18)',
          }
        }}
      >
        <DialogTitle sx={{
          px: 3,
          py: 2.25,
          borderBottom: isDarkMode ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid #e2e8f0',
          bgcolor: isDarkMode ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))' : '#ffffff',
        }}>
          <Typography variant="h6" sx={{ fontWeight: 850, letterSpacing: 0, color: t.text.heading }}>
            Item Directory import warning
          </Typography>
          <Typography variant="body2" sx={{ color: t.text.secondary, mt: 0.25 }}>
            You can export this sheet, but FactWise may reject the import until these fields are fixed.
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{
          px: 3,
          py: 2,
          bgcolor: isDarkMode ? '#0b1220' : '#f8fafc',
          borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.14)' : '#e2e8f0',
        }}>
          {/* Advisory only: a name without its value is a normal in-progress
              state, so it is reported rather than cleared or blocked. */}
          {groupWarnings.length > 0 && (
            <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
              {groupWarnings.map((warning, index) => (
                <Alert severity="warning" key={`${warning.field}-${warning.slot}-${index}`}>
                  {warning.message}{' '}
                  <Box component="span" sx={{ opacity: 0.85 }}>{warning.suggestion}</Box>
                </Alert>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {[
              itemCodeIssue ? {
                req: 'Item code',
                field: itemCodeIssue.field,
                headerName: 'Item code',
                emptyCount: itemCodeIssue.blanks || 0,
                duplicateRows: itemCodeIssue.dupRows || 0,
                dupValues: itemCodeIssue.dupValues || [],
              } : null,
              ...requiredGaps,
            ].filter(Boolean).map(g => {
              const guidance = REQUIRED_FIELD_GUIDANCE[g.req] || {};
              const issueParts = [
                g.emptyCount > 0 ? `${g.emptyCount} blank ${g.emptyCount === 1 ? 'cell' : 'cells'}` : null,
                g.duplicateRows > 0 ? `${g.duplicateRows} duplicate ${g.duplicateRows === 1 ? 'row' : 'rows'}` : null,
                g.invalidCount > 0 ? `${g.invalidCount} invalid ${g.invalidCount === 1 ? 'value' : 'values'}` : null,
              ].filter(Boolean);
              const quickValues = guidance.quickValues || [];
              const observedValue = g.req === 'Procurement entity name' ? getObservedSingleValue(g.field) : '';
              const fillSuggestion = quickValues[0] || observedValue || '';
              const allowInlineDefault = ['Item name', 'Procurement entity name', 'Measurement unit'].includes(g.req);
              const inlineDefault = requiredInlineDefaults[g.field] || '';
              return (
                <Box
                  key={`${g.req}-${g.field}`}
                  sx={{
                    border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
                    borderLeft: '4px solid #f97316',
                    borderRadius: '12px',
                    p: 2,
                    bgcolor: isDarkMode ? '#111827' : '#ffffff',
                    boxShadow: isDarkMode ? '0 12px 28px rgba(0, 0, 0, 0.18)' : '0 10px 24px rgba(15, 23, 42, 0.06)',
                    display: 'grid',
                    gap: 1.25,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: t.text.heading }}>
                        {g.headerName || g.req || g.field}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'inline-flex',
                          mt: 0.75,
                          px: 0.75,
                          py: 0.25,
                          borderRadius: '999px',
                          color: isDarkMode ? '#fed7aa' : '#c2410c',
                          bgcolor: isDarkMode ? 'rgba(249, 115, 22, 0.14)' : '#fff7ed',
                          border: isDarkMode ? '1px solid rgba(251, 146, 60, 0.22)' : '1px solid #fed7aa',
                          fontWeight: 700,
                        }}
                      >
                        {issueParts.join(' | ')}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label="Required"
                      sx={{
                        fontWeight: 800,
                        borderRadius: '999px',
                        color: isDarkMode ? '#fed7aa' : '#9a3412',
                        bgcolor: isDarkMode ? 'rgba(249, 115, 22, 0.16)' : '#ffedd5',
                        border: isDarkMode ? '1px solid rgba(251, 146, 60, 0.28)' : '1px solid #fed7aa',
                      }}
                    />
                  </Box>

                  <Box sx={{ display: 'grid', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ color: t.text.primary }}>
                      <strong>Rule:</strong> {guidance.rule || 'Mandatory for FactWise import.'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Fix:</strong> {guidance.action || 'Use Fill Column to populate this field.'}
                    </Typography>
                    {g.invalidValues?.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Seen invalid values: {g.invalidValues.slice(0, 5).join(', ')}
                      </Typography>
                    )}
                  </Box>

                  {allowInlineDefault && (
                    <Box sx={{
                      display: 'flex',
                      gap: 1,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}>
                      <TextField
                        size="small"
                        label="Default value"
                        value={inlineDefault}
                        onChange={(event) => setRequiredInlineDefaults(prev => ({ ...prev, [g.field]: event.target.value }))}
                        sx={{
                          minWidth: 220,
                          flex: '1 1 260px',
                          '& .MuiOutlinedInput-root': {
                            bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.72)' : '#ffffff',
                            borderRadius: '9px',
                          },
                        }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={requiredQuickFillKey === `${g.field}:${inlineDefault.trim()}` ? <CircularProgress size={14} sx={{ color: 'white' }} /> : null}
                        onClick={() => applyRequiredQuickFill(g, inlineDefault)}
                        disabled={requiredFilling || !(g.emptyCount > 0) || !inlineDefault.trim()}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 800,
                          minHeight: 38,
                          px: 2,
                          bgcolor: '#0ea5e9',
                          '&:hover': { bgcolor: '#0284c7' },
                          '&.Mui-disabled': {
                            bgcolor: isDarkMode ? 'rgba(56, 189, 248, 0.16)' : '#e0f2fe',
                            color: isDarkMode ? 'rgba(186, 230, 253, 0.46)' : '#7dd3fc',
                          },
                        }}
                      >
                        {requiredQuickFillKey === `${g.field}:${inlineDefault.trim()}` ? 'Applying...' : 'Apply default'}
                      </Button>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    {quickValues.map(value => (
                      <Button
                        key={`${g.field}-${value}`}
                        size="small"
                        variant="contained"
                        startIcon={requiredQuickFillKey === `${g.field}:${value}` ? <CircularProgress size={14} sx={{ color: 'white' }} /> : null}
                        onClick={() => applyRequiredQuickFill(g, value)}
                        disabled={requiredFilling || !(g.emptyCount > 0)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 800,
                          borderRadius: '999px',
                          bgcolor: '#0ea5e9',
                          '&:hover': { bgcolor: '#0284c7' },
                        }}
                      >
                        {requiredQuickFillKey === `${g.field}:${value}` ? 'Applying...' : `Apply ${value}`}
                      </Button>
                    ))}
                    {observedValue && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={requiredQuickFillKey === `${g.field}:${observedValue}` ? <CircularProgress size={14} sx={{ color: 'white' }} /> : null}
                        onClick={() => applyRequiredQuickFill(g, observedValue)}
                        disabled={requiredFilling || !(g.emptyCount > 0)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 800,
                          borderRadius: '999px',
                          bgcolor: '#0ea5e9',
                          '&:hover': { bgcolor: '#0284c7' },
                        }}
                      >
                        {requiredQuickFillKey === `${g.field}:${observedValue}` ? 'Applying...' : `Apply ${observedValue}`}
                      </Button>
                    )}
                    {g.req === 'Item code' && g.duplicateRows > 0 && (
                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        onClick={highlightItemCodeDuplicates}
                        disabled={requiredFilling}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 800,
                          borderRadius: '999px',
                          color: isDarkMode ? '#fed7aa' : '#9a3412',
                          borderColor: isDarkMode ? 'rgba(251, 146, 60, 0.34)' : '#fdba74',
                          '&:hover': { bgcolor: isDarkMode ? 'rgba(249, 115, 22, 0.12)' : '#fff7ed' },
                        }}
                      >
                        Highlight duplicates
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditNoteIcon />}
                      onClick={() => openFillColumnForRequired(g, fillSuggestion)}
                      disabled={requiredFilling}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 800,
                        borderRadius: '999px',
                        color: isDarkMode ? '#cbd5e1' : '#334155',
                        borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.3)' : '#cbd5e1',
                        '&:hover': {
                          borderColor: '#0ea5e9',
                          bgcolor: isDarkMode ? 'rgba(14, 165, 233, 0.10)' : '#f0f9ff',
                        },
                      }}
                    >
                      Use Fill Column
                    </Button>
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Alert
            severity="warning"
            sx={{
              mt: 2,
              borderRadius: '12px',
              bgcolor: isDarkMode ? 'rgba(180, 83, 9, 0.16)' : '#fffbeb',
              color: isDarkMode ? '#fde68a' : '#92400e',
              border: isDarkMode ? '1px solid rgba(251, 191, 36, 0.24)' : '1px solid #fde68a',
              '& .MuiAlert-icon': { color: isDarkMode ? '#fbbf24' : '#d97706' },
            }}
          >
            Export is allowed. This warning only means the exported sheet may need to be fixed in Excel before it can be imported into FactWise.
          </Alert>
        </DialogContent>
        <DialogActions sx={{
          px: 3,
          py: 2,
          borderTop: isDarkMode ? '1px solid rgba(148, 163, 184, 0.14)' : '1px solid #e2e8f0',
          bgcolor: isDarkMode ? '#0f172a' : '#ffffff',
        }}>
          <Button onClick={cancelRequiredExport} disabled={requiredFilling}>
            Back to grid
          </Button>
          <Button
            onClick={continueExportWithWarnings}
            variant="contained"
            disabled={requiredFilling}
            sx={{
              fontWeight: 850,
              textTransform: 'none',
              borderRadius: '999px',
              px: 2.5,
              bgcolor: '#2563eb',
              color: '#ffffff',
              boxShadow: 'none',
              '&:hover': { bgcolor: '#1d4ed8', boxShadow: 'none' },
            }}
          >
            Export anyway
          </Button>
        </DialogActions>
      </Dialog>
      {/* Generic delimiter-based row splitter */}
      <Dialog open={splitRowsDialogOpen} onClose={() => !splitRowsRunning && setSplitRowsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Split into Rows</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1, mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 240, flex: 1 }}>
              <InputLabel>Column to split</InputLabel>
              <Select
                label="Column to split"
                value={splitRowsConfig.sourceColumn}
                onChange={(event) => {
                  setSplitRowsConfig(prev => ({
                    ...prev,
                    sourceColumn: event.target.value,
                    copyColumnIndices: []
                  }));
                  setSplitRowsPreview(null);
                }}
              >
                {splitColsCandidates.map(col => (
                  <MenuItem key={`${col.field}-${col.index}`} value={col.field}>
                    {columnLabel(col.field, col.label)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Delimiter</InputLabel>
              <Select
                label="Delimiter"
                value={splitRowsConfig.delimiter}
                onChange={(event) => {
                  setSplitRowsConfig(prev => ({ ...prev, delimiter: event.target.value }));
                  setSplitRowsPreview(null);
                }}
              >
                <MenuItem value="comma">Comma ,</MenuItem>
                <MenuItem value="semicolon">Semicolon ;</MenuItem>
                <MenuItem value="pipe">Pipe |</MenuItem>
                <MenuItem value="slash">Slash /</MenuItem>
                <MenuItem value="newline">New line</MenuItem>
                <MenuItem value="tab">Tab</MenuItem>
                <MenuItem value="space">Space</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>

            {splitRowsConfig.delimiter === 'custom' && (
              <TextField
                size="small"
                label="Custom delimiter"
                value={splitRowsConfig.customDelimiter}
                onChange={(event) => {
                  setSplitRowsConfig(prev => ({ ...prev, customDelimiter: event.target.value }));
                  setSplitRowsPreview(null);
                }}
                sx={{ minWidth: 180 }}
              />
            )}
          </Box>

          <Divider sx={{ mb: 1.5 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
            <Typography variant="subtitle2">Copy to new rows</Typography>
            <FormControlLabel
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={splitRowsCopyCandidates.length > 0 && splitRowsConfig.copyColumnIndices.length === splitRowsCopyCandidates.length}
                  indeterminate={splitRowsConfig.copyColumnIndices.length > 0 && splitRowsConfig.copyColumnIndices.length < splitRowsCopyCandidates.length}
                  onChange={(event) => {
                    setSplitRowsConfig(prev => ({
                      ...prev,
                      copyColumnIndices: event.target.checked ? splitRowsCopyCandidates.map(col => col.index) : []
                    }));
                    setSplitRowsPreview(null);
                  }}
                />
              }
              label="All columns"
            />
          </Box>

          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            columnGap: 2,
            maxHeight: 220,
            overflowY: 'auto',
            borderTop: '1px solid #e5e7eb',
            borderBottom: '1px solid #e5e7eb',
            py: 0.5
          }}>
            {splitRowsCopyCandidates.map(col => (
              <FormControlLabel
                key={`${col.field}-${col.index}`}
                control={
                  <Checkbox
                    size="small"
                    checked={splitRowsConfig.copyColumnIndices.includes(col.index)}
                    onChange={(event) => {
                      setSplitRowsConfig(prev => ({
                        ...prev,
                        copyColumnIndices: event.target.checked
                          ? [...prev.copyColumnIndices, col.index]
                          : prev.copyColumnIndices.filter(index => index !== col.index)
                      }));
                      setSplitRowsPreview(null);
                    }}
                  />
                }
                label={columnLabel(col.field, col.label)}
              />
            ))}
          </Box>

          {splitRowsError && <Alert severity="error" sx={{ mt: 2 }}>{splitRowsError}</Alert>}

          {splitRowsPreview && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="success" sx={{ mb: 1 }}>
                {splitRowsPreview.rows_added} new row{splitRowsPreview.rows_added === 1 ? '' : 's'} from {splitRowsPreview.rows_split} original row{splitRowsPreview.rows_split === 1 ? '' : 's'}.
              </Alert>
              <TableContainer sx={{ maxHeight: 240, border: '1px solid #e5e7eb' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {splitRowsPreview.headers.map((header, index) => (
                        <TableCell key={`${header}-${index}`} sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                          {deriveDisplayName(header, splitRowsPreview.headers)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {splitRowsPreview.rows.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {splitRowsPreview.headers.map((header, columnIndex) => (
                          <TableCell key={`${header}-${columnIndex}`} sx={{ whiteSpace: 'nowrap' }}>
                            {row[columnIndex]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSplitRowsDialogOpen(false)} disabled={splitRowsRunning}>Cancel</Button>
          <Button
            onClick={handlePreviewSplitRows}
            disabled={
              splitRowsPreviewLoading ||
              splitRowsRunning ||
              !splitRowsConfig.sourceColumn ||
              (splitRowsConfig.delimiter === 'custom' && !splitRowsConfig.customDelimiter)
            }
          >
            {splitRowsPreviewLoading ? 'Previewing...' : 'Preview'}
          </Button>
          <Button
            variant="contained"
            startIcon={splitRowsRunning ? <CircularProgress size={16} /> : <AccountTreeIcon />}
            onClick={handleApplySplitRows}
            disabled={
              splitRowsRunning ||
              !splitRowsConfig.sourceColumn ||
              (splitRowsConfig.delimiter === 'custom' && !splitRowsConfig.customDelimiter)
            }
          >
            {splitRowsRunning ? 'Splitting...' : 'Split into Rows'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Split Values Into Columns */}
      <Dialog open={splitColsDialogOpen} onClose={() => setSplitColsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Split into Columns</DialogTitle>
        <DialogContent>
            <ColumnParser
              sessionId={sessionId}
              initialColumn={splitColsConfig.sourceColumn}
              availableColumns={structuredSplitColsCandidates}
              onApply={(result) => {
                setSplitColsDialogOpen(false);
                showSnackbar(`Structured split applied. Added ${result.new_headers_count || 0} columns.`, 'success');
                fetchDataSynchronized();
              }}
            />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSplitColsDialogOpen(false)} disabled={splitColsRunning} sx={{ mr: 'auto' }}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* MPN Split Dialog */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && mpnSplitDialogOpen} onClose={() => setMpnSplitDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Split MPN Cells</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Configure how supplier prefixes and manufacturer names should be cleaned while expanding one row into one row per MPN.
          </DialogContentText>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>MPN Column to Split</InputLabel>
            <Select
              label="MPN Column to Split"
              value={mpnColumn || ''}
              onChange={(e) => setMpnColumn(e.target.value || null)}
            >
              {columnDefs
                .filter(col => col.field && col.field !== '__row_number__')
                .map(col => (
                  <MenuItem key={col.field} value={col.field}>
                    {columnLabel(col.field, col.headerName)}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          <Alert severity="info" sx={{ mb: 2 }}>
            Empty cells are skipped. A cell with spaces only, like a single MPN containing spaces, is kept as one MPN.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                MPN Prefix Rules
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={mpnSplitOptions.stripAlphaPrefix}
                    onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, stripAlphaPrefix: e.target.checked }))}
                  />
                }
                label="Strip alphabetic prefixes"
              />
              <TextField
                fullWidth
                type="number"
                size="small"
                label="Minimum alphabetic prefix length"
                value={mpnSplitOptions.alphaPrefixMinLength}
                onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, alphaPrefixMinLength: e.target.value }))}
                disabled={!mpnSplitOptions.stripAlphaPrefix}
                inputProps={{ min: 1 }}
                sx={{ mt: 1 }}
              />
              <FormControlLabel
                sx={{ mt: 1 }}
                control={
                  <Checkbox
                    checked={mpnSplitOptions.stripNumericPrefix}
                    onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, stripNumericPrefix: e.target.checked }))}
                  />
                }
                label="Strip numeric prefixes"
              />
              <TextField
                fullWidth
                type="number"
                size="small"
                label="Numeric prefix length"
                value={mpnSplitOptions.numericPrefixLength}
                onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, numericPrefixLength: e.target.value }))}
                disabled={!mpnSplitOptions.stripNumericPrefix}
                inputProps={{ min: 1 }}
                sx={{ mt: 1 }}
              />
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Always strip these prefixes"
                value={mpnSplitOptions.extraPrefixes}
                onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, extraPrefixes: e.target.value }))}
                sx={{ mt: 2 }}
                helperText="Example: AGILE. One per line or comma separated."
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                Manufacturer Rules
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={6}
                label="Aliases"
                value={mpnSplitOptions.manufacturerAliases}
                onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, manufacturerAliases: e.target.value }))}
                helperText="Use SOURCE=TARGET. Empty target discards the source."
              />
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Discard Tokens"
                value={mpnSplitOptions.manufacturerDiscardTokens}
                onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, manufacturerDiscardTokens: e.target.value }))}
                sx={{ mt: 2 }}
                helperText="One per line or comma separated."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMpnSplitDialogOpen(false)} disabled={mpnSplitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSplitMPNCells}
            variant="contained"
            startIcon={mpnSplitting ? <CircularProgress size={16} /> : <ContentCutIcon />}
            disabled={mpnSplitting}
          >
            {mpnSplitting ? 'Splitting...' : 'Split Rows'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manufacturer Match Dialog */}
      <Dialog open={ENABLE_LEGACY_EXPAND_ROWS && manufacturerMatchDialogOpen} onClose={() => setManufacturerMatchDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>Expand Alternates · Two matching lists</Typography>
          <Typography variant="body2" color="text.secondary">
            Pair a manufacturer column with an MPN column by position, and expand each pair into its own row.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ border: '1px solid #e5e7eb', borderRadius: 1, p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                The two lists to pair
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Pick the two columns whose cells each hold a list, in matching order. The 1st manufacturer
                goes with the 1st part number, the 2nd with the 2nd, and so on — each pair becomes its own row.
              </Typography>
              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Manufacturer list column</InputLabel>
                    <Select
                      label="Manufacturer list column"
                      value={mpnManufacturerColumn || ''}
                      onChange={(e) => setMpnManufacturerColumn(e.target.value || null)}
                    >
                      {columnDefs
                        .filter(col => col.field && col.field !== '__row_number__')
                        .map(col => (
                          <MenuItem key={col.field} value={col.field}>
                            {columnLabel(col.field, col.headerName)}
                          </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {mpnManufacturerColumn && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      e.g. {sampleForField(mpnManufacturerColumn) || '(all cells empty)'}
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Part-number (MPN) list column</InputLabel>
                    <Select
                      label="Part-number (MPN) list column"
                      value={mpnColumn || ''}
                      onChange={(e) => setMpnColumn(e.target.value || null)}
                    >
                      {columnDefs
                        .filter(col => col.field && col.field !== '__row_number__')
                        .map(col => (
                          <MenuItem key={col.field} value={col.field}>
                            {columnLabel(col.field, col.headerName)}
                          </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {mpnColumn && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      e.g. {sampleForField(mpnColumn) || '(all cells empty)'}
                    </Typography>
                  )}
                </Grid>
              </Grid>
              {mpnColumn && mpnManufacturerColumn && mpnColumn === mpnManufacturerColumn && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Both lists point at the same column. Pick two different columns.
                </Alert>
              )}
            </Box>

          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManufacturerMatchDialogOpen(false)} disabled={mpnSplitting}>
            Cancel
          </Button>
          <Button
            onClick={handleManufacturerMatchSplit}
            variant="contained"
            startIcon={mpnSplitting ? <CircularProgress size={16} /> : <AccountTreeIcon />}
            disabled={mpnSplitting || !mpnColumn || !mpnManufacturerColumn || mpnColumn === mpnManufacturerColumn}
          >
            {mpnSplitting ? 'Matching...' : 'Split and Match'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Save Template Dialog */}
      <Dialog open={templateSaveDialogOpen} onClose={handleCloseSaveTemplateDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Save Template</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter a name to save the current mapping, tag rules, and defaults as a reusable template.
          </DialogContentText>
          <TextField
            fullWidth
            autoFocus
            margin="normal"
            label="Template Name"
            value={templateName}
            error={Boolean(templateNameError)}
            helperText={templateNameError}
            onChange={(e) => { setTemplateName(e.target.value); setTemplateNameError(''); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSaveTemplateDialog}>Cancel</Button>
          <Button onClick={() => handleSaveTemplateSynchronized()} variant="contained" disabled={templateSaving}>
            {templateSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Factwise ID Dialog */}
      <Dialog
        open={factwiseIdDialogOpen}
        onClose={handleCloseFactwiseIdDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.9)',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.22)' : '1px solid rgba(203, 213, 225, 0.9)',
            backdropFilter: 'blur(18px)',
            boxShadow: isDarkMode ? '0 28px 80px rgba(0,0,0,0.72)' : '0 24px 70px rgba(15,23,42,0.18)'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Create FactWise ID (Synchronized)
          <IconButton onClick={handleCloseFactwiseIdDialog}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Create a synchronized FactWise ID in Item code by combining columns or generating a prefix-based sequence.
          </DialogContentText>
          
          <Box sx={{ mt: 2 }}>
            <FormControl component="fieldset" margin="normal">
              <FormLabel>ID Source</FormLabel>
              <RadioGroup
                row
                value={factwiseGenerationMode}
                onChange={(event) => setFactwiseGenerationMode(event.target.value)}
              >
                <FormControlLabel value="columns" control={<Radio />} label="Combine columns" />
                <FormControlLabel value="serial" control={<Radio />} label="Prefix + sequence" />
              </RadioGroup>
            </FormControl>

            {factwiseGenerationMode === 'columns' ? (
              <>
                <FormControl fullWidth margin="normal">
                  <InputLabel>First Column</InputLabel>
                  <Select
                    value={firstColumn}
                    label="First Column"
                    onChange={(e) => setFirstColumn(e.target.value)}
                  >
                    {columnDefs
                      .filter(col => col.field && col.field !== '__row_number__')
                      .filter(col => (col.headerName || col.field).toLowerCase() !== 'item code' && (col.headerName || col.field).toLowerCase() !== 'item_code')
                      .map(col => {
                      let example = '';
                      for (const row of rowData) {
                        const val = row[col.field];
                        if (val !== null && val !== undefined && val !== '' && val.toString().toLowerCase() !== 'unknown') {
                          example = val;
                          break;
                        }
                      }
                      const displayName = col.headerName || col.field;
                      const truncated = example && example.toString().length > 30 ? `${example.toString().substring(0, 30)}...` : example;
                      // Prefer the mapped source (← Manufacturer); fall back to a sample value.
                      const labeled = columnLabel(col.field, col.headerName);
                      const display = labeled !== displayName
                        ? labeled
                        : (truncated ? `${displayName} (${truncated})` : `${displayName} (Empty)`);
                      return (
                        <MenuItem key={col.field} value={col.field}>
                          {display}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>

                <FormControl fullWidth margin="normal">
                  <InputLabel>Operator</InputLabel>
                  <Select
                    value={operator}
                    label="Operator"
                    onChange={(e) => setOperator(e.target.value)}
                  >
                    <MenuItem value="_">_ (underscore)</MenuItem>
                    <MenuItem value="-">- (hyphen)</MenuItem>
                    <MenuItem value=".">. (dot)</MenuItem>
                    <MenuItem value="">No separator</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth margin="normal">
                  <InputLabel>Second Column</InputLabel>
                  <Select
                    value={secondColumn}
                    label="Second Column"
                    onChange={(e) => setSecondColumn(e.target.value)}
                  >
                    {columnDefs
                      .filter(col => col.field && col.field !== '__row_number__')
                      .filter(col => (col.headerName || col.field).toLowerCase() !== 'item code' && (col.headerName || col.field).toLowerCase() !== 'item_code')
                      .map(col => {
                      let example = '';
                      for (const row of rowData) {
                        const val = row[col.field];
                        if (val !== null && val !== undefined && val !== '' && val.toString().toLowerCase() !== 'unknown') {
                          example = val;
                          break;
                        }
                      }
                      const displayName = col.headerName || col.field;
                      const truncated = example && example.toString().length > 30 ? `${example.toString().substring(0, 30)}...` : example;
                      // Prefer the mapped source (← Manufacturer); fall back to a sample value.
                      const labeled = columnLabel(col.field, col.headerName);
                      const display = labeled !== displayName
                        ? labeled
                        : (truncated ? `${displayName} (${truncated})` : `${displayName} (Empty)`);
                      return (
                        <MenuItem key={col.field} value={col.field}>
                          {display}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              </>
            ) : (
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Prefix"
                    value={factwiseSerialPrefix}
                    onChange={(event) => setFactwiseSerialPrefix(event.target.value)}
                    placeholder="ITEM"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Start Number"
                    value={factwiseSerialStart}
                    onChange={(event) => setFactwiseSerialStart(event.target.value)}
                    inputProps={{ min: 0 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Digits"
                    value={factwiseSerialPadding}
                    onChange={(event) => setFactwiseSerialPadding(event.target.value)}
                    inputProps={{ min: 0, max: 12 }}
                    helperText="2 gives 01, 02, 03"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked
                        disabled
                        onChange={(event) => setFactwiseSerialIncrement(event.target.checked)}
                      />
                    }
                    label="Increase number for each row"
                  />
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: -0.5, ml: 4 }}>
                    Always on — this dialog writes Item code, which must be unique.
                  </Typography>
                </Grid>
              </Grid>
            )}
          </Box>

          {factwiseGenerationMode === 'columns' && firstColumn && secondColumn && (
            <Box sx={{
              mt: 2,
              p: 2,
              bgcolor: isDarkMode ? 'rgba(30, 41, 59, 0.72)' : '#f8fafc',
              border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
              borderRadius: '12px'
            }}>
              <Typography variant="body2" sx={{ color: isDarkMode ? '#cbd5e1' : '#64748b' }}>
                Preview: {firstColumn} + "{operator}" + {secondColumn} = "FactWise ID"
              </Typography>
              <Typography variant="body2" sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                Example: "A123" + "{operator}" + "XYZ" = "A123{operator}XYZ"
              </Typography>
            </Box>
          )}

          {factwiseGenerationMode === 'serial' && (
            <Box sx={{
              mt: 2,
              p: 2,
              bgcolor: isDarkMode ? 'rgba(30, 41, 59, 0.72)' : '#f8fafc',
              border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
              borderRadius: '12px'
            }}>
              <Typography variant="body2" sx={{ color: isDarkMode ? '#cbd5e1' : '#64748b' }}>
                Preview: {(factwiseSerialPrefix || '')}{String(Number(factwiseSerialStart) || 1).padStart(Math.max(0, Number(factwiseSerialPadding) || 0), '0')}
                {`, ${(factwiseSerialPrefix || '')}${String((Number(factwiseSerialStart) || 1) + 1).padStart(Math.max(0, Number(factwiseSerialPadding) || 0), '0')}`}
              </Typography>
            </Box>
          )}

          <Alert severity="info" sx={{
            mt: 2,
            bgcolor: isDarkMode ? 'rgba(14, 165, 233, 0.12)' : '#eff6ff',
            color: isDarkMode ? '#bae6fd' : '#1e40af',
            border: isDarkMode ? '1px solid rgba(14, 165, 233, 0.26)' : '1px solid #bfdbfe',
            '& .MuiAlert-icon': { color: isDarkMode ? '#38bdf8' : '#2563eb' }
          }}>
            This operation will be synchronized across all data views and validated for consistency.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseFactwiseIdDialog}>Cancel</Button>
          <Button 
            onClick={handleCreateFactwiseIdSynchronized}
            variant="contained"
            disabled={(factwiseGenerationMode === 'columns' && (!firstColumn || !secondColumn)) || syncStatus.inProgress}
            startIcon={syncStatus.inProgress ? <CircularProgress size={20} /> : <BadgeIcon />}
          >
            {syncStatus.inProgress ? 'Creating...' : 'Create Synchronized ID'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={factwiseStrategyDialogOpen}
        onClose={() => setFactwiseStrategyDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            maxWidth: 760,
            borderRadius: '16px',
            overflow: 'hidden',
            bgcolor: t.surface.paper,
            color: t.text.primary,
            border: `1px solid ${t.border.default}`,
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.18)'
          }
        }}
      >
        <DialogTitle>Item Code Already Has Values</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Choose how to apply the new FactWise ID.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFactwiseStrategyDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              setFactwiseStrategyDialogOpen(false);
              await runCreateFactwiseIdSynchronized('fill_only_null');
            }}
          >
            Fill Empty
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              setFactwiseStrategyDialogOpen(false);
              await runCreateFactwiseIdSynchronized('override_all');
            }}
          >
            Override All
          </Button>
        </DialogActions>
      </Dialog>

      {/* Factwise embedded Project export — real orchestration (item → BOM → project)
          with resumable checkpoints. Only ever rendered when the mapper is inside
          the Factwise iframe. */}
      {isFactwiseEmbedded && (
        <FactwiseProjectExportDialog
          open={projectExportDialogOpen}
          onClose={() => setProjectExportDialogOpen(false)}
          sessionId={sessionId}
          getColumnOrder={getCurrentExportColumnOrder}
          refreshHost={fetchDataSynchronized}
          defaultProjectName={`Project - ${new Date().toLocaleDateString()}`}
        />
      )}

      {/* Factwise embedded BOM Directory export — 2-step (items → BOM) so the
          BOM never lands with dangling item-code references. */}
      {isFactwiseEmbedded && (
        <FactwiseBomDirectoryExportDialog
          open={bomDirectoryExportDialogOpen}
          onClose={() => setBomDirectoryExportDialogOpen(false)}
          sessionId={sessionId}
          getColumnOrder={getCurrentExportColumnOrder}
          refreshHost={fetchDataSynchronized}
        />
      )}

      {/* FactWise export destination chooser */}
      <Dialog
        open={factwiseExportDialogOpen}
        onClose={() => setFactwiseExportDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '14px', overflow: 'hidden', maxWidth: 560, bgcolor: exportDialogTone.paper, border: `1px solid ${exportDialogTone.border}` } }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: `1px solid ${exportDialogTone.border}`,
          bgcolor: exportDialogTone.header,
          color: exportDialogTone.heading
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <FolderOpenIcon sx={{ color: '#2563eb' }} />
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 620, color: exportDialogTone.heading }}>
              Export to FactWise
            </Typography>
          </Box>
          <IconButton onClick={() => setFactwiseExportDialogOpen(false)} size="small" sx={{ color: exportDialogTone.secondary }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 3.25, pb: 2.5, bgcolor: exportDialogTone.body }}>
          <Typography variant="body2" sx={{ color: exportDialogTone.secondary, mb: 2, mt: 1.5 }}>
            Choose where this prepared sheet should go.
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {[
              {
                key: 'project',
                title: 'Export to Project',
                helper: 'Send selected columns into a new or existing project.',
                icon: <FolderOpenIcon sx={{ color: '#2563eb' }} />
              },
              {
                key: 'item',
                title: 'Export to Item Directory',
                helper: 'Fix required item fields, preview the directory sheet, then download.',
                icon: <BadgeIcon sx={{ color: '#2563eb' }} />
              },
              {
                key: 'bom',
                title: 'Export to BOM Directory',
                helper: 'Fix required BOM fields, preview the BOM export, then download.',
                icon: <AccountTreeIcon sx={{ color: '#16a34a' }} />
              }
            ].map(option => (
              <ListItemButton
                key={option.key}
                onClick={() => handleChooseFactwiseDestination(option.key)}
                sx={{
                  border: `1px solid ${exportDialogTone.border}`,
                  borderRadius: '12px',
                  px: 2,
                  py: 1.4,
                  bgcolor: exportDialogTone.panel,
                  '&:hover': { bgcolor: exportDialogTone.hover, borderColor: '#60a5fa' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 38 }}>{option.icon}</ListItemIcon>
                <ListItemText
                  primary={option.title}
                  secondary={option.helper}
                  primaryTypographyProps={{ fontWeight: 620, fontSize: 14, color: exportDialogTone.heading }}
                  secondaryTypographyProps={{ fontSize: 12.5, color: exportDialogTone.secondary, mt: 0.25 }}
                />
              </ListItemButton>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

      {/* FactWise item/BOM export preview */}
      <Dialog
        open={factwisePreviewOpen}
        onClose={() => {
          if (!factwisePreviewDownloading) {
            setFactwisePreviewOpen(false);
            setFactwisePreviewFullscreen(false);
          }
        }}
        maxWidth="lg"
        fullWidth
        fullScreen={factwisePreviewType === 'bom' && factwisePreviewFullscreen}
        PaperProps={{
          sx: {
            borderRadius: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? 0 : '12px',
            overflow: 'hidden',
            maxWidth: factwisePreviewType === 'bom' && factwisePreviewFullscreen
              ? 'none'
              : factwisePreviewType === 'bom'
                ? 1068
                : 980,
            width: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? '100vw' : undefined,
            height: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? '100vh' : undefined,
            m: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? 0 : undefined,
            bgcolor: exportDialogTone.paper,
            border: `1px solid ${exportDialogTone.border}`
          }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: `1px solid ${exportDialogTone.border}`,
          bgcolor: exportDialogTone.header,
          color: exportDialogTone.heading
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {factwisePreviewType === 'bom'
              ? <AccountTreeIcon sx={{ color: '#16a34a' }} />
              : <BadgeIcon sx={{ color: '#2563eb' }} />}
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 620, color: exportDialogTone.heading }}>
              {factwisePreviewType === 'bom' ? 'Export BOM' : 'Export Item Directory'}
            </Typography>
          </Box>
          {factwisePreviewType === 'bom' ? (
            <Tooltip title={factwisePreviewFullscreen ? 'Exit full screen' : 'Full screen'}>
              <IconButton
                onClick={() => setFactwisePreviewFullscreen(value => !value)}
                size="small"
                sx={{
                  color: '#60a5fa',
                  border: `1px solid ${exportDialogTone.border}`,
                  bgcolor: 'rgba(37, 99, 235, 0.08)',
                  '&:hover': { bgcolor: 'rgba(37, 99, 235, 0.18)' }
                }}
              >
                {factwisePreviewFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              onClick={() => setFactwisePreviewOpen(false)}
              disabled={Boolean(factwisePreviewDownloading)}
              sx={{ minWidth: 0, color: exportDialogTone.secondary }}
            >
              <CloseIcon fontSize="small" />
            </Button>
          )}
        </DialogTitle>
        <DialogContent sx={{
          px: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? 2.5 : 3,
          pt: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? 3 : 3.25,
          pb: factwisePreviewType === 'bom' ? 2 : 2.5,
          bgcolor: exportDialogTone.body,
          display: factwisePreviewType === 'bom' ? 'flex' : 'block',
          flexDirection: factwisePreviewType === 'bom' ? 'column' : undefined,
          overflow: factwisePreviewType === 'bom' && factwisePreviewFullscreen ? 'hidden' : undefined
        }}>
          {factwisePreviewType === 'bom' ? (
            <>
              <Box sx={{ mt: factwisePreviewFullscreen ? 1 : 1.5 }}>
                {factwisePreviewOpen && (
                  <BomTreePreview
                    sessionId={sessionId}
                    fullscreen={factwisePreviewFullscreen}
                    height={factwisePreviewFullscreen ? 'calc(100vh - 178px)' : 420}
                    onRequestFullscreen={() => setFactwisePreviewFullscreen(true)}
                  />
                )}
              </Box>
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ color: exportDialogTone.secondary, mb: 1, mt: 1.5 }}>
                Review the item directory below, then download it for FactWise.
              </Typography>
              <Typography variant="caption" sx={{ color: exportDialogTone.secondary, display: 'block', mb: 1.5 }}>
                Preview shows the current page. The downloaded file includes the full processed sheet.
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360, borderRadius: '10px', bgcolor: exportDialogTone.panel, borderColor: exportDialogTone.border }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {columnDefs
                        .filter(col => col.field && col.field !== '__row_number__')
                        .slice(0, 10)
                        .map(col => (
                          <TableCell key={col.field} sx={{ fontWeight: 650, bgcolor: exportDialogTone.header, color: exportDialogTone.heading, borderColor: exportDialogTone.border, whiteSpace: 'nowrap' }}>
                            {col.headerName || col.field}
                          </TableCell>
                        ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(rowData || []).slice(0, 8).map((row, rowIndex) => (
                        <TableRow key={row.id || rowIndex} hover sx={{ '&:hover td': { bgcolor: exportDialogTone.hover } }}>
                        {columnDefs
                          .filter(col => col.field && col.field !== '__row_number__')
                          .slice(0, 10)
                          .map(col => (
                            <TableCell
                              key={col.field}
                              sx={{
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: exportDialogTone.text,
                                borderColor: exportDialogTone.borderSoft
                              }}
                            >
                              {row[col.field] ?? ''}
                            </TableCell>
                          ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.25 }}>
                <Typography variant="caption" sx={{ color: exportDialogTone.secondary }}>
                  Showing {Math.min((rowData || []).length, 8)} rows and {Math.min(getCurrentExportColumnOrder().length, 10)} columns in preview
                </Typography>
                {getCurrentExportColumnOrder().length > 10 && (
                  <Chip size="small" label={`+${getCurrentExportColumnOrder().length - 10} more columns`} sx={{ bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{
          px: 3,
          py: 2,
          gap: 1,
          borderTop: `1px solid ${exportDialogTone.border}`,
          bgcolor: exportDialogTone.footer
        }}>
          <Button
            onClick={() => setFactwisePreviewOpen(false)}
            disabled={Boolean(factwisePreviewDownloading)}
            sx={{
              textTransform: 'none',
              borderRadius: '8px',
              color: factwisePreviewType === 'bom' ? '#60a5fa' : exportDialogTone.secondary,
              mr: 'auto',
              fontWeight: factwisePreviewType === 'bom' ? 700 : 500
            }}
          >
            Cancel
          </Button>
          {/* Real download. For a BOM this is the generated FactWise BOM sheet;
              for the item directory it is the processed sheet with BOM
              structure columns stripped out. */}
          <Button
            variant="outlined"
            onClick={() => downloadFactwisePreview('excel')}
            disabled={Boolean(factwisePreviewDownloading)}
            startIcon={factwisePreviewDownloading === 'excel'
              ? <CircularProgress size={16} />
              : <DownloadIcon />}
            sx={{
              textTransform: 'none',
              borderRadius: '999px',
              fontWeight: 700,
              px: 3,
              minHeight: 38,
            }}
          >
            {factwisePreviewDownloading === 'excel' ? 'Preparing…' : 'Export Sheet'}
          </Button>
          {/* Hands off to Factwise: BOM → the 2-step (items → BOM) orchestrator
              dialog; Item → Factwise's own bulk-import page. Mock when the tool
              runs standalone. */}
          <Button
            variant="contained"
            onClick={() => handleDirectoryExport(factwisePreviewType)}
            disabled={Boolean(factwisePreviewDownloading)}
            startIcon={<FolderOpenIcon />}
            sx={{
              textTransform: 'none',
              borderRadius: '999px',
              fontWeight: 700,
              px: 3,
              minHeight: 38,
              bgcolor: '#2563eb',
              boxShadow: '0 14px 28px -18px rgba(37, 99, 235, 0.9)',
              '&:hover': {
                bgcolor: '#2563eb',
                boxShadow: '0 14px 28px -18px rgba(37, 99, 235, 0.9)'
              }
            }}
          >
            Export to FactWise
          </Button>
        </DialogActions>
      </Dialog>

      {/* Directory export loading/success */}
      <Dialog
        open={directoryExportStatus.open}
        onClose={() => {
          if (directoryExportStatus.phase === 'success') {
            setDirectoryExportStatus(prev => ({ ...prev, open: false, phase: 'idle' }));
          }
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '16px', overflow: 'hidden', bgcolor: exportDialogTone.paper, border: `1px solid ${exportDialogTone.border}` } }}
      >
        {directoryExportStatus.phase === 'loading' ? (
          <DialogContent sx={{ p: 0 }}>
            <ExportLoadingContent
              isDarkMode={isDarkMode}
              title={`Exporting to ${directoryExportStatus.type === 'bom' ? 'BOM Directory' : 'Item Directory'}...`}
              message="Preparing your FactWise export."
            />
          </DialogContent>
        ) : (
          <>
            <DialogContent sx={{ px: 4, py: 5, textAlign: 'center', bgcolor: exportDialogTone.body }}>
              <Box sx={{
                width: 74,
                height: 74,
                borderRadius: '50%',
                bgcolor: exportDialogTone.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2.5
              }}>
                <CheckCircleIcon sx={{ fontSize: 46, color: '#2563eb' }} />
              </Box>
              <Typography sx={{ fontSize: 24, lineHeight: 1.18, fontWeight: 680, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', mb: 1, letterSpacing: 0 }}>
                Exported Successfully
              </Typography>
              <Typography sx={{ fontSize: 15, lineHeight: 1.5, fontWeight: 500, color: exportDialogTone.text, mb: 0.5, letterSpacing: 0 }}>
                Exported to {directoryExportStatus.type === 'bom' ? 'BOM Directory' : 'Item Directory'}.
              </Typography>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.5, fontWeight: 400, color: exportDialogTone.secondary, letterSpacing: 0 }}>
                Your FactWise export is ready.
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, justifyContent: 'center', bgcolor: exportDialogTone.footer, borderTop: `1px solid ${exportDialogTone.border}` }}>
              <Button
                variant="contained"
                onClick={() => setDirectoryExportStatus(prev => ({ ...prev, open: false, phase: 'idle' }))}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontWeight: 700,
                  px: 4,
                  bgcolor: '#2563eb',
                  '&:hover': { bgcolor: '#2563eb' }
                }}
              >
                Done
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Data Correction Upload Dialog */}
      <Dialog
        open={correctionUploadDialogOpen}
        onClose={() => setCorrectionUploadDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Upload Corrected Data (Excel)
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 3 }}>
            Upload an Excel file (.xlsx, .xls, or .xlsm) with corrected data. The file should have the same headers as the exported data.
            Only matching headers will be updated; unmatched columns are ignored.
          </DialogContentText>

          {/* File Upload */}
          <Box sx={{ mb: 3 }}>
            <input
              accept=".xlsx,.xls,.xlsm"
              style={{ display: 'none' }}
              id="correction-file-upload"
              type="file"
              onChange={handleCorrectionFileUpload}
            />
            <label htmlFor="correction-file-upload">
              <Button
                variant="outlined"
                component="span"
                startIcon={<DownloadIcon sx={{ transform: 'rotate(180deg)' }} />}
                sx={{ mb: 2 }}
              >
                Choose Excel File
              </Button>
            </label>
            {correctionFile && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Selected: {correctionFile.name}
              </Typography>
            )}
          </Box>

          {/* Preview */}
          {correctionPreview && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Data Preview (first 5 rows)</Typography>
              <Box sx={{ border: '1px solid #ddd', borderRadius: 1, overflow: 'auto', maxHeight: 300 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f5f5f5' }}>
                      {correctionPreview.headers.map((header, index) => (
                        <th key={index} style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correctionPreview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {correctionPreview.headers.map((header, colIndex) => (
                          <td key={colIndex} style={{ padding: '8px', border: '1px solid #ddd' }}>
                            {row[header] || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCorrectionUploadDialogOpen(false);
              setCorrectionFile(null);
              setCorrectionPreview(null);
            }}
            disabled={correctionUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCorrectionUpload}
            variant="contained"
            disabled={!correctionFile || correctionUploading}
            startIcon={correctionUploading ? <CircularProgress size={16} /> : null}
          >
            {correctionUploading ? 'Uploading...' : 'Update Data'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Export to Project Dialog */}
      <Dialog
        open={exportProjectDialogOpen}
        onClose={() => { if (!exportProjectLoading) setExportProjectDialogOpen(false); }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: '12px', overflow: 'hidden', bgcolor: exportDialogTone.paper, border: `1px solid ${exportDialogTone.border}` }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: exportDialogTone.header,
          borderBottom: `1px solid ${exportDialogTone.border}`,
          color: exportDialogTone.heading,
          py: 2
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderOpenIcon sx={{ color: '#2563eb' }} />
            <Typography variant="h6" sx={{ fontWeight: 620, fontSize: '18px', color: exportDialogTone.heading }}>
              Export to Project
            </Typography>
          </Box>
          {!exportProjectLoading && (
            <IconButton onClick={() => setExportProjectDialogOpen(false)} size="small" sx={{ color: exportDialogTone.secondary }}>
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>

        {exportProjectLoading ? (
          <DialogContent sx={{ p: 0 }}>
            <ExportLoadingContent
              isDarkMode={isDarkMode}
              title="Exporting to Project..."
              message="Preparing your selected fields."
            />
          </DialogContent>
        ) : exportProjectSuccess ? (
          <>
            <DialogContent sx={{ px: 4, py: 5, textAlign: 'center', bgcolor: exportDialogTone.body }}>
              <Box sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                backgroundColor: exportDialogTone.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px'
              }}>
                <CheckCircleIcon sx={{ fontSize: 48, color: '#2563eb' }} />
              </Box>
              <Typography sx={{ fontSize: 24, lineHeight: 1.18, fontWeight: 680, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', mb: 1.25, letterSpacing: 0 }}>
                Exported Successfully
              </Typography>
              <Typography sx={{ fontSize: 15, lineHeight: 1.5, fontWeight: 500, color: exportDialogTone.text, mb: 1, letterSpacing: 0 }}>
                Data has been exported to project
              </Typography>
              <Typography sx={{ fontSize: 18, lineHeight: 1.35, fontWeight: 650, color: exportDialogTone.heading, letterSpacing: 0 }}>
                {exportProjectMode === 'NEW'
                  ? exportProjectName
                  : `${selectedExistingProject?.project_code} — ${selectedExistingProject?.project_name}`}
              </Typography>
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.5, fontWeight: 400, color: exportDialogTone.secondary, mt: 2, letterSpacing: 0 }}>
                {columnDefs.filter(c => c.field && c.field !== '__row_number__').length} columns exported
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, justifyContent: 'center', backgroundColor: exportDialogTone.footer, borderTop: `1px solid ${exportDialogTone.border}` }}>
              <Button
                variant="contained"
                onClick={() => setExportProjectDialogOpen(false)}
                sx={{
                  backgroundColor: '#2563eb',
                  '&:hover': { backgroundColor: '#2563eb' },
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontWeight: 700,
                  px: 4
                }}
              >
                Done
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent sx={{ px: 3, pt: 3.5, pb: 3, bgcolor: exportDialogTone.body, color: exportDialogTone.text }}>
              {/* Export Mode Selection */}
              <FormControl component="fieldset" sx={{ mb: 2, mt: 1.5, width: '100%' }}>
                <FormLabel component="legend" sx={{ fontSize: '14px', fontWeight: 500, mb: 0.5, color: `${exportDialogTone.secondary} !important` }}>
                  Export to
                </FormLabel>
                <RadioGroup
                  row
                  value={exportProjectMode}
                  onChange={(e) => setExportProjectMode(e.target.value)}
                >
                  <FormControlLabel
                    value="NEW"
                    control={<Radio sx={{ py: 0.5, color: exportDialogTone.secondary, '&.Mui-checked': { color: '#2563eb' } }} />}
                    label="New Project"
                    sx={{ color: exportDialogTone.text, '& .MuiFormControlLabel-label': { fontSize: 14, fontWeight: 400 } }}
                  />
                  <FormControlLabel
                    value="EXISTING"
                    control={<Radio sx={{ py: 0.5, color: exportDialogTone.secondary, '&.Mui-checked': { color: '#2563eb' } }} />}
                    label="Existing Project"
                    sx={{ color: exportDialogTone.text, '& .MuiFormControlLabel-label': { fontSize: 14, fontWeight: 400 } }}
                  />
                </RadioGroup>
              </FormControl>

              <Divider sx={{ mb: 2, borderColor: exportDialogTone.border }} />

              {/* Project Name */}
              {exportProjectMode === 'NEW' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ color: exportDialogTone.secondary, mb: 0.5, fontWeight: 500 }}>
                    Project Name
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={exportProjectName}
                    onChange={(e) => setExportProjectName(e.target.value)}
                    placeholder="Enter project name..."
                    sx={exportTextFieldSx}
                  />
                </Box>
              )}

              {exportProjectMode === 'EXISTING' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ color: exportDialogTone.secondary, mb: 0.5, fontWeight: 500 }}>
                    Select Project
                  </Typography>
                  <Autocomplete
                    fullWidth
                    options={existingProjects}
                    value={selectedExistingProject}
                    getOptionLabel={(option) =>
                      option ? `${option.project_code} (${option.project_name})` : ''
                    }
                    isOptionEqualToValue={(option, value) =>
                      option?.project_id === value?.project_id
                    }
                    onChange={(_, newValue) => {
                      setSelectedExistingProject(newValue);
                    }}
                    PaperComponent={(props) => (
                      <Paper
                        {...props}
                        sx={{
                          bgcolor: exportDialogTone.panel,
                          color: exportDialogTone.text,
                          border: `1px solid ${exportDialogTone.border}`,
                          boxShadow: isDarkMode ? '0 18px 42px rgba(0,0,0,0.48)' : '0 18px 42px rgba(15,23,42,0.16)',
                          '& .MuiAutocomplete-option': {
                            color: exportDialogTone.text,
                            '&[aria-selected="true"]': { bgcolor: exportDialogTone.hover },
                            '&.Mui-focused': { bgcolor: exportDialogTone.hover }
                          }
                        }}
                      />
                    )}
                    renderOption={(props, option) => (
                      <li {...props} key={option.project_id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', py: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '14px', color: '#60a5fa', minWidth: 90 }}>
                            {option.project_code}
                          </Typography>
                          <Typography variant="body2" sx={{ fontSize: '14px', ml: 3, flex: 1, color: exportDialogTone.text }}>
                            {option.project_name}
                          </Typography>
                        </Box>
                      </li>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        placeholder="Search by project name or code..."
                        sx={exportTextFieldSx}
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <>
                              <SearchIcon sx={{ color: exportDialogTone.secondary, fontSize: 20, mr: 0.5 }} />
                              {params.InputProps.startAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    noOptionsText="No projects found"
                    ListboxProps={{ style: { maxHeight: '300px', backgroundColor: exportDialogTone.panel, color: exportDialogTone.text } }}
                  />
                </Box>
              )}

            </DialogContent>

            <DialogActions sx={{
              px: 3,
              py: 2,
              backgroundColor: exportDialogTone.footer,
              borderTop: `1px solid ${exportDialogTone.border}`,
              gap: 1
            }}>
              <Button
                variant="outlined"
                color="error"
                onClick={() => setExportProjectDialogOpen(false)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '8px',
                  color: isDarkMode ? '#fca5a5' : '#dc2626',
                  borderColor: isDarkMode ? 'rgba(248, 113, 113, 0.42)' : 'rgba(220, 38, 38, 0.5)',
                  '&:hover': {
                    borderColor: isDarkMode ? '#fca5a5' : '#dc2626',
                    bgcolor: isDarkMode ? 'rgba(248, 113, 113, 0.08)' : 'rgba(220, 38, 38, 0.05)'
                  }
                }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleExportProjectConfirm}
                disabled={
                  (exportProjectMode === 'NEW' && !exportProjectName.trim()) ||
                  (exportProjectMode === 'EXISTING' && !selectedExistingProject)
                }
                startIcon={<FolderOpenIcon />}
                sx={{
                  backgroundColor: '#2563eb',
                  '&:hover': { backgroundColor: '#2563eb' },
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontWeight: 700,
                  px: 3
                }}
              >
                Export
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{
          position: 'fixed !important',
          top: '72px !important',
          right: '24px !important',
          left: 'auto !important',
          bottom: 'auto !important',
          transform: 'none !important',
          maxWidth: 420,
          zIndex: 1600,
        }}
      >
        <Alert 
          onClose={closeSnackbar} 
          severity={snackbar.severity}
          variant="filled"
          sx={{
            width: 'min(420px, calc(100vw - 48px))',
            maxWidth: 420,
            borderRadius: '14px',
            boxShadow: isDarkMode ? '0 18px 50px rgba(0,0,0,0.55)' : '0 18px 50px rgba(15,23,42,0.2)',
            alignItems: 'center',
            fontWeight: 700,
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Export / Import — one entry point, both halves of the same round trip.
          Export writes the grid exactly as it is; import reads that file back
          into this same session so mappings, tags and MPN validation survive. */}
      <Dialog open={exportImportOpen} onClose={() => setExportImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ImportExportIcon fontSize="small" />
          Export / Import sheet
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
            Export the sheet, edit it in Excel, then import it back. Changes land in
            this session, so your mapping, tags and MPN validation stay attached.
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 220, p: 2, borderRadius: 1, border: `1px solid ${t.border.default}` }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>1 &nbsp;Export</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5 }}>
                Downloads every column exactly as shown here — nothing added or removed.
              </Typography>
              <Button
                fullWidth
                variant="contained"
                onClick={handleExportSheetForEditing}
                disabled={exportingSheet}
                startIcon={exportingSheet ? <CircularProgress size={16} /> : <DownloadIcon />}
              >
                {exportingSheet ? 'Exporting…' : 'Export sheet'}
              </Button>
            </Box>

            <Box sx={{ flex: 1, minWidth: 220, p: 2, borderRadius: 1, border: `1px solid ${t.border.default}` }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>2 &nbsp;Import</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1.5 }}>
                Columns match by name, so reordering is safe. Anything unmatched is reported.
              </Typography>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => importFileInputRef.current?.click()}
                disabled={importing}
                startIcon={importing ? <CircularProgress size={16} /> : <UploadFileIcon />}
              >
                {importing ? 'Importing…' : 'Import edited sheet'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportImportOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Hidden picker for "Import edited sheet" in the Tools menu. */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={handleImportEditedSheet}
      />

      {/* What the import actually changed — columns it could not match are
          listed rather than silently dropped. */}
      <Dialog open={Boolean(importResult)} onClose={() => setImportResult(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Sheet imported</DialogTitle>
        <DialogContent dividers>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {importResult?.imported_rows}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            rows imported{importResult && importResult.previous_rows !== importResult.imported_rows
              ? ` (was ${importResult.previous_rows})` : ''}
          </Typography>
          <Alert severity="success" sx={{ mb: 1 }}>
            {importResult?.matched_columns} columns matched by name.
          </Alert>
          {importResult?.ignored_columns?.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              Not in this sheet, so ignored: {importResult.ignored_columns.join(', ')}
            </Alert>
          )}
          {importResult?.untouched_columns?.length > 0 && (
            <Alert severity="info">
              Absent from your file, so left unchanged: {importResult.untouched_columns.join(', ')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setImportResult(null)}>Done</Button>
        </DialogActions>
      </Dialog>

      {/* MPN validation summary, shown once validation finishes. */}
      <Dialog
        open={mpnSummaryOpen}
        onClose={() => setMpnSummaryOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            maxWidth: 860,
            width: 'min(860px, calc(100vw - 48px))',
            borderRadius: '16px',
            overflow: 'hidden',
            bgcolor: t.surface.paper,
            color: t.text.primary,
            border: `1px solid ${t.border.default}`,
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.18)'
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 3, py: 2, borderBottom: `1px solid ${t.border.default}` }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: mpnSummary && mpnSummary.failed === 0 ? t.state.successBg : t.state.warningBg }}>
            {mpnSummary && mpnSummary.failed === 0
              ? <VerifiedUserIcon sx={{ color: t.color.success, fontSize: 20 }} />
              : <ErrorIcon sx={{ color: t.color.warningText, fontSize: 20 }} />}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 650, color: t.text.heading }}>
              MPN validation complete
            </Typography>
            <Typography sx={{ fontSize: 12.5, lineHeight: 1.4, fontWeight: 400, color: t.text.secondary, mt: 0.25 }}>
              Summary of unique manufacturer part numbers checked.
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 4.75, pb: 2.5 }}>
          <Typography sx={{ fontSize: 26, lineHeight: 1.15, fontWeight: 650, mb: 0.75, mt: 2.25, color: t.text.heading }}>
            {mpnSummary ? `${mpnSummary.validated} of ${mpnSummary.total}` : ''}
          </Typography>
          <Typography variant="body2" sx={{ color: t.text.secondary, mb: 2, fontSize: 13.5 }}>
            unique MPNs matched
          </Typography>
          {mpnSummary && mpnSummary.failed === 0 ? (
            <Alert severity="success" sx={{ borderRadius: '12px', mb: 1.5 }}>
              All MPNs were matched successfully.
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ borderRadius: '12px', mb: 1.5 }}>
              {mpnSummary?.failed} MPN{mpnSummary?.failed === 1 ? '' : 's'} could not be
              matched. Use the Filter menu to review Invalid or Unknown MPN rows.
            </Alert>
          )}
          <Typography variant="caption" sx={{ display: 'block', color: t.text.secondary, fontSize: 12, lineHeight: 1.45 }}>
            Counts are unique part numbers, not rows — the same MPN used on several
            rows is validated once.
          </Typography>

          {mpnSummary?.providerFailures?.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              {mpnSummary.providerFailures.map((failure) => (
                <Alert severity="error" key={failure.provider} sx={{ mb: 1, borderRadius: '12px' }}>
                  {failure.message}
                  {' '}Parts were not checked against {failure.provider} — blank
                  {' '}columns for it do not mean the part is invalid.
                </Alert>
              ))}
            </>
          )}

          {mpnSummary?.breakdown && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1, fontSize: 13.5, fontWeight: 650, color: t.text.heading }}>
                By source — {mpnSummary.breakdown.total_rows} rows
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
              {(mpnSummary.breakdown.sources || []).map((source) => (
                <Box key={source.name} sx={{ p: 1.25, borderRadius: '12px', border: `1px solid ${t.border.default}`, bgcolor: t.surface.subtle, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 84, fontSize: 13 }}>
                      {source.name}
                    </Typography>
                    <Chip size="small" label={`${source.valid} valid`} sx={{ bgcolor: t.state.successBg, color: t.color.success, '& .MuiChip-label': { fontWeight: 500 } }} />
                    <Chip size="small" label={`${source.invalid} invalid`} sx={{ bgcolor: t.state.dangerBg, color: t.color.danger, '& .MuiChip-label': { fontWeight: 500 } }} />
                    {source.unchecked > 0 && (
                      <Chip size="small" variant="outlined" label={`${source.unchecked} not checked`} sx={{ '& .MuiChip-label': { fontWeight: 500 } }} />
                    )}
                  </Box>
                  {/* Lifecycle is a breakdown OF the valid parts only. An
                      unmatched part has no status, so nothing here ever
                      describes the invalid or unchecked counts above. */}
                  {source.valid > 0 && ((source.statuses || []).length > 0 || source.eol > 0 || source.discontinued > 0) && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${t.border.default}` }}>
                      <Typography variant="caption" sx={{ display: 'block', color: t.text.secondary, mb: 0.6, fontWeight: 400 }}>
                        Of the {source.valid} valid:
                      </Typography>
                      {(source.statuses || []).length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                          {source.statuses.map(([label, count]) => (
                            <Chip key={label} size="small" variant="outlined" label={`${label}: ${count}`} sx={{ '& .MuiChip-label': { fontWeight: 500 } }} />
                          ))}
                        </Box>
                      )}
                      {(source.eol > 0 || source.discontinued > 0) && (
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {source.eol > 0 && (
                            <Chip size="small" variant="outlined" label={`${source.eol} end-of-life`}
                                  sx={{ color: t.color.warningText, borderColor: t.color.warningText, '& .MuiChip-label': { fontWeight: 500 } }} />
                          )}
                          {source.discontinued > 0 && (
                            <Chip size="small" variant="outlined" label={`${source.discontinued} discontinued`}
                                  sx={{ color: t.color.danger, borderColor: t.color.danger, '& .MuiChip-label': { fontWeight: 500 } }} />
                          )}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              ))}
              </Box>
              {(mpnSummary.breakdown.sources || []).length === 0 && (
                <Typography variant="caption" sx={{ color: t.text.secondary }}>
                  No provider columns found in this sheet.
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${t.border.default}` }}>
          <Button variant="contained" onClick={() => setMpnSummaryOpen(false)} sx={{ minWidth: 112, height: 44, borderRadius: '999px', textTransform: 'none', fontWeight: 600, px: 3 }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {/* BOM validation — its own ruleset, not the item required-field guard. */}
      <Dialog
        open={bomValidationOpen}
        onClose={() => setBomValidationOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            width: 'min(820px, calc(100vw - 40px))',
            maxHeight: 'min(780px, calc(100vh - 48px))',
            borderRadius: '18px',
            overflow: 'hidden',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.22)' : '1px solid #e2e8f0',
            boxShadow: isDarkMode ? '0 28px 80px rgba(0, 0, 0, 0.52)' : '0 28px 70px rgba(15, 23, 42, 0.18)',
          }
        }}
      >
        <DialogTitle sx={{
          px: 3,
          py: 2.25,
          borderBottom: isDarkMode ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid #e2e8f0',
        }}>
          <Typography variant="h6" sx={{ fontWeight: 850, letterSpacing: 0, color: t.text.heading }}>
            BOM import errors
          </Typography>
          <Typography variant="body2" sx={{ color: t.text.secondary, mt: 0.25 }}>
            {bomErrorGroups.length === 0
              ? 'This BOM has nothing blocking the FactWise import.'
              : `${bomErrorGroups.length} problem${bomErrorGroups.length === 1 ? '' : 's'} would make this BOM fail the FactWise import. You can still export the sheet to look at it.`}
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{
          px: 3,
          py: 2,
          bgcolor: isDarkMode ? '#0b1220' : '#f8fafc',
          borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.14)' : '#e2e8f0',
        }}>
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {[...bomErrorGroups, ...bomWarningGroups].map((group) => {
              const guidance = BOM_RULE_GUIDANCE[group.rule] || {};
              const isError = group.severity === 'error';
              const accent = isError ? '#ef4444' : '#f97316';
              const fillField = bomGridFieldFor(guidance.column);
              return (
                <Box
                  key={`${group.severity}-${group.rule}`}
                  sx={{
                    border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
                    borderLeft: `4px solid ${accent}`,
                    borderRadius: '12px',
                    p: 2,
                    bgcolor: isDarkMode ? '#111827' : '#ffffff',
                    boxShadow: isDarkMode ? '0 12px 28px rgba(0, 0, 0, 0.18)' : '0 10px 24px rgba(15, 23, 42, 0.06)',
                    display: 'grid',
                    gap: 1.25,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: t.text.heading }}>
                        {guidance.title || group.rule.replace(/_/g, ' ')}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'inline-flex',
                          mt: 0.75,
                          px: 0.75,
                          py: 0.25,
                          borderRadius: '999px',
                          color: isError ? (isDarkMode ? '#fecaca' : '#b91c1c') : (isDarkMode ? '#fed7aa' : '#c2410c'),
                          bgcolor: isError
                            ? (isDarkMode ? 'rgba(239, 68, 68, 0.14)' : '#fef2f2')
                            : (isDarkMode ? 'rgba(249, 115, 22, 0.14)' : '#fff7ed'),
                          border: isError
                            ? (isDarkMode ? '1px solid rgba(248, 113, 113, 0.22)' : '1px solid #fecaca')
                            : (isDarkMode ? '1px solid rgba(251, 146, 60, 0.22)' : '1px solid #fed7aa'),
                          fontWeight: 700,
                        }}
                      >
                        {group.count} {group.count === 1 ? 'row' : 'rows'}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={isError ? 'Blocks import' : 'Warning'}
                      sx={{
                        fontWeight: 800,
                        borderRadius: '999px',
                        color: isError ? (isDarkMode ? '#fecaca' : '#991b1b') : (isDarkMode ? '#fed7aa' : '#9a3412'),
                        bgcolor: isError
                          ? (isDarkMode ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2')
                          : (isDarkMode ? 'rgba(249, 115, 22, 0.16)' : '#ffedd5'),
                        border: isError
                          ? (isDarkMode ? '1px solid rgba(248, 113, 113, 0.28)' : '1px solid #fecaca')
                          : (isDarkMode ? '1px solid rgba(251, 146, 60, 0.28)' : '1px solid #fed7aa'),
                      }}
                    />
                  </Box>

                  <Box sx={{ display: 'grid', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ color: t.text.primary }}>
                      <strong>Rule:</strong> {guidance.rule || group.messages[0] || 'This would fail the FactWise import.'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Fix:</strong> {guidance.action || 'Check the affected rows in the grid.'}
                    </Typography>
                    {group.codes.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Codes: {group.codes.slice(0, 8).join(', ')}
                        {group.codes.length > 8 ? ` +${group.codes.length - 8} more` : ''}
                      </Typography>
                    )}
                    {/* Duplicates carry codes but no row numbers, so the chips
                        below never render for them — this is the only way to
                        see the offending rows, and it shows them together. */}
                    {(group.rows.length > 0 || group.codes.length > 0 || group.values.length > 0) && (
                      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => highlightBomIssue(group, fillField, guidance.title || group.rule)}
                          sx={{ textTransform: 'none', fontWeight: 700, px: 0 }}
                        >
                          Highlight in grid
                        </Button>
                        {fillField && (group.codes.length > 0 || group.values.length > 0) && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => showIssueRows(
                              fillField,
                              group.codes.length > 0 ? group.codes : group.values,
                              guidance.title || group.rule,
                            )}
                            sx={{ textTransform: 'none', fontWeight: 700, px: 0 }}
                          >
                            Show only these rows
                          </Button>
                        )}
                      </Box>
                    )}
                  </Box>

                  {/* The floor: even a rule no button can fix still says where to
                      look. Row numbers are the editor's, not the generated
                      sheet's, so they exist on screen. */}
                  {group.rows.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: t.text.secondary, fontWeight: 700 }}>
                        Rows:
                      </Typography>
                      {group.rows.slice(0, 12).map(row => (
                        <Chip
                          key={`${group.rule}-row-${row}`}
                          size="small"
                          label={row}
                          onClick={() => jumpToGridRow(row)}
                          sx={{
                            fontWeight: 700,
                            cursor: 'pointer',
                            borderRadius: '8px',
                            bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.14)' : '#f1f5f9',
                            '&:hover': { bgcolor: isDarkMode ? 'rgba(14, 165, 233, 0.18)' : '#e0f2fe' },
                          }}
                        />
                      ))}
                      {group.rows.length > 12 && (
                        <Typography variant="caption" sx={{ color: t.text.secondary }}>
                          +{group.rows.length - 12} more
                        </Typography>
                      )}
                    </Box>
                  )}

                  {/* Only when the backend told us WHICH values failed. Acting on
                      the column as a whole would hit rows that are already fine. */}
                  {fillField && group.values.length > 0 && (
                    <Box sx={{
                      display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center',
                      p: 1.25, borderRadius: '10px',
                      bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.08)' : '#f8fafc',
                      border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid #e2e8f0',
                    }}>
                      <Typography variant="caption" sx={{ color: t.text.secondary, fontWeight: 700 }}>
                        {`Found ${group.values.map(v => `"${v}"`).join(', ')} —`}
                      </Typography>
                      <TextField
                        size="small"
                        label={`New ${guidance.column}`}
                        value={bomFixDefaults[group.rule] || ''}
                        onChange={(event) => setBomFixDefaults(prev => ({ ...prev, [group.rule]: event.target.value }))}
                        sx={{ width: 150 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        disabled={Boolean(bomFixBusy) || !String(bomFixDefaults[group.rule] || '').trim()}
                        startIcon={bomFixBusy === `replace:${group.rule}` ? <CircularProgress size={14} sx={{ color: 'white' }} /> : null}
                        onClick={() => replaceBomIssueValues(group, fillField, bomFixDefaults[group.rule])}
                        sx={{
                          textTransform: 'none', fontWeight: 800, borderRadius: '999px',
                          bgcolor: '#0ea5e9', '&:hover': { bgcolor: '#0284c7' },
                        }}
                      >
                        Replace
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        disabled={Boolean(bomFixBusy)}
                        startIcon={bomFixBusy === `delete:${group.rule}` ? <CircularProgress size={14} /> : null}
                        onClick={() => deleteBomIssueRows(group, fillField)}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '999px' }}
                      >
                        {`Delete ${group.count} row${group.count === 1 ? '' : 's'}`}
                      </Button>
                    </Box>
                  )}

                  {(fillField || guidance.generateIds) && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      {guidance.generateIds && (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => { setBomValidationOpen(false); handleOpenFactwiseIdDialog(); }}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 800,
                            borderRadius: '999px',
                            bgcolor: '#0ea5e9',
                            '&:hover': { bgcolor: '#0284c7' },
                          }}
                        >
                          Generate item codes
                        </Button>
                      )}
                      {fillField && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditNoteIcon />}
                          onClick={() => { setBomValidationOpen(false); openFillMissingDialog(fillField); }}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 800,
                            borderRadius: '999px',
                            color: isDarkMode ? '#cbd5e1' : '#334155',
                            borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.3)' : '#cbd5e1',
                            '&:hover': {
                              borderColor: '#0ea5e9',
                              bgcolor: isDarkMode ? 'rgba(14, 165, 233, 0.10)' : '#f0f9ff',
                            },
                          }}
                        >
                          {`Fill ${guidance.column}`}
                        </Button>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{
          px: 3,
          py: 2,
          borderTop: isDarkMode ? '1px solid rgba(148, 163, 184, 0.14)' : '1px solid #e2e8f0',
          bgcolor: isDarkMode ? '#0f172a' : '#ffffff',
        }}>
          <Button
            onClick={() => {
              pendingExportRef.current = null;
              setBomValidationOpen(false);
            }}
          >
            Back to grid
          </Button>
          {/* Same escape hatch the item directory has. These are real import
              failures rather than cosmetic gaps, so the wording says the file
              will be rejected — but blocking the download outright also blocks
              inspecting the sheet to work out what to fix. */}
          <Button
            onClick={continueBomExportAnyway}
            variant="contained"
            sx={{
              fontWeight: 850,
              textTransform: 'none',
              borderRadius: '999px',
              px: 2.5,
              bgcolor: '#2563eb',
              color: '#ffffff',
              boxShadow: 'none',
              '&:hover': { bgcolor: '#1d4ed8', boxShadow: 'none' },
            }}
          >
            Export anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EnhancedDataEditor;
