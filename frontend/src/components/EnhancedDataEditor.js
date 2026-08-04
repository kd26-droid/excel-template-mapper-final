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
  Menu
} from '@mui/material';
import { Pagination } from '@mui/material';
import {
  Save as SaveIcon,
  Download as DownloadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Edit as EditIcon,
  Description as TemplateIcon,
  Check as CheckIcon,
  ArrowBack as ArrowBackIcon,
  AutoAwesome as AutoAwesomeIcon,
  ContentCopy as ContentCopyIcon,
  EditNote as EditNoteIcon,
  Badge as BadgeIcon,
  Close as CloseIcon,
  Map as MapIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  DeleteSweep as DeleteSweepIcon,
  FolderOpen as FolderOpenIcon,
  AccountTree as AccountTreeIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  MoreVert as MoreVertIcon,
  Build as BuildIcon,
  VerifiedUser as VerifiedUserIcon,
  ContentCut as ContentCutIcon,
  Add as AddIcon,
  DeleteOutline as DeleteIcon
} from '@mui/icons-material';
import api from '../services/api';
import * as XLSX from 'xlsx';
import FormulaBuilder from './FormulaBuilder';
import BomTreePreview from './BomTreePreview';
import ColumnParser from './ColumnParser/ColumnParser';
import { LoaderCard } from './LoaderOverlay';
import { getDataSynchronizer, cleanupSynchronizer } from '../utils/DataSynchronizer';
import { useThemeContext } from '../utils/ThemeContext';

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
const DEFAULT_VALIDATION_COLUMN_MAPPINGS = [
  { column: 'MPN valid', providers: ['digikey'] },
  { column: 'MPN Status', providers: ['digikey'] },
  { column: 'EOL Status', providers: ['digikey'] },
  { column: 'Discontinued', providers: ['digikey'] },
  { column: 'DKPN', providers: ['digikey'] },
  { column: 'Canonical MPN', providers: ['digikey'] },
  { column: 'Category', providers: ['digikey'] },
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
  if (col.startsWith('Tag_') || col === 'Tag') return 'Tag';
  if (col.startsWith('Specification_Name_') || col === 'Specification name') return 'Specification name';
  if (col.startsWith('Specification_Value_') || col === 'Specification value') return 'Specification value';
  if (col.startsWith('Customer_Identification_Name_') || col === 'Customer identification name' || col === 'Custom identification name') return 'Customer identification name';
  if (col.startsWith('Customer_Identification_Value_') || col === 'Customer identification value' || col === 'Custom identification value') return 'Customer identification value';

  // General fallback: a "<base>_<n>" column that has 2+ siblings sharing the
  // same base is a split-generated run — show them all under "<base>".
  const m = String(col).match(/^(.+)_(\d+)$/);
  if (m) {
    const base = m[1];
    let siblings = 0;
    for (const h of allHeaders) {
      const hm = String(h).match(/^(.+)_(\d+)$/);
      if (hm && hm[1] === base) siblings += 1;
    }
    if (siblings >= 2) return base;
  }
  return col;
};

const EnhancedDataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
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
  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalPages, setTotalPages] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  // Formula Builder state
  const [formulaBuilderOpen, setFormulaBuilderOpen] = useState(false);
  const [columnParserOpen, setColumnParserOpen] = useState(false);
  const [createColumnDialogOpen, setCreateColumnDialogOpen] = useState(false);
  const [createColumnTarget, setCreateColumnTarget] = useState('Item name');
  const [createColumnContentType, setCreateColumnContentType] = useState('concat');
  const [createColumnFirst, setCreateColumnFirst] = useState('');
  const [createColumnSecond, setCreateColumnSecond] = useState('');
  const [createColumnSeparator, setCreateColumnSeparator] = useState(' ');
  const [createColumnMode, setCreateColumnMode] = useState('fill_empty');
  const [createColumnSaving, setCreateColumnSaving] = useState(false);
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
  const [exportProjectSelectedColumns, setExportProjectSelectedColumns] = useState({});
  const [exportProjectSelectAll, setExportProjectSelectAll] = useState(true);
  const [selectedExistingProject, setSelectedExistingProject] = useState(null);
  const [exportProjectSuccess, setExportProjectSuccess] = useState(false);
  const [factwiseExportDialogOpen, setFactwiseExportDialogOpen] = useState(false);
  const [factwisePreviewOpen, setFactwisePreviewOpen] = useState(false);
  const [factwisePreviewType, setFactwisePreviewType] = useState('item');
  const [factwisePreviewDownloading, setFactwisePreviewDownloading] = useState('');

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
  const [factwiseSerialPrefix, setFactwiseSerialPrefix] = useState('SFO');
  const [factwiseSerialStart, setFactwiseSerialStart] = useState(1);
  const [factwiseSerialPadding, setFactwiseSerialPadding] = useState(2);
  const [factwiseSerialIncrement, setFactwiseSerialIncrement] = useState(true);
  
  // Store factwise ID rule for template saving
  const [factwiseIdRule, setFactwiseIdRule] = useState(null);
  
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
  const [defaultBusy, setDefaultBusy] = useState(false);
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
  const [requiredDefaults, setRequiredDefaults] = useState({});
  const [requiredFilling, setRequiredFilling] = useState(false);
  const pendingExportRef = useRef(null);
  // Item code gets special export handling: it must be filled AND unique. This
  // holds the detected blanks/duplicates and the user's chosen fix strategy.
  const [itemCodeIssue, setItemCodeIssue] = useState(null); // { field, blanks, dupRows, dupValues }
  const [itemCodeCfg, setItemCodeCfg] = useState({
    blank: 'prefix_sequence', duplicate: 'suffix', prefix: 'ITEM-', separator: '-', start: 1, padding: 4,
  });
  // "Highlight duplicates so I can edit them" — the column + the set of repeated
  // values whose cells the grid should mark. Cleared with the banner's Clear button.
  const [dupHighlight, setDupHighlight] = useState(null); // { field, values: Set<string> }

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

  // Fetch a specific page from backend (server-side pagination)
  const fetchPageData = useCallback(async (targetPage = page, size = pageSize) => {
    if (!sessionId) return;
    try {
      setPageLoading(true);
      // Give server-side mapping enough time to finish instead of canceling page loads.
      const timeoutMs = size >= 5000 ? 180000 : (size > 1000 ? 120000 : 90000);
      if (size > 1000) {
        showSnackbar(`Loading ${size} rows, this may take a moment...`, 'info');
      }
      
      const resp = await api.getMappedDataWithSpecs(sessionId, targetPage, size, true, { 
        force_fresh: true, 
        _fresh: Date.now(),
        timeoutMs
      });
      
      const payload = resp?.data || {};
      const headers = payload.headers || [];
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const pg = payload.pagination || { page: targetPage, total_pages: 1, total_rows: rows.length };
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
          h.startsWith('Tag_') || h.startsWith('Specification_Name_') || h.startsWith('Specification_Value_') || h.startsWith('Customer_Identification_') ||
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
          ...headers.map(col => ({
            headerName: deriveDisplayName(col, headers),
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
      setTotalPages(Math.max(1, Math.ceil(nextTotalRows / size)));
      setPage(pg.page || targetPage);

      // Reset virtualization window to the full page
      setVisibleRange({ start: 0, end: rows.length });

      // Recompute unknowns for this page quickly
      let unknownCount = 0;
      for (const r of rows) {
        for (const v of Object.values(r)) {
          if (v && String(v).toLowerCase() === 'unknown') unknownCount++;
        }
      }
      setUnknownCellsCount(unknownCount);
    } catch (e) {
      console.error('Page fetch failed:', e);
      if (e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        showSnackbar(`Loading timed out for ${size} rows. Try a smaller page size.`, 'error');
      } else {
        showSnackbar(`Failed to load page ${targetPage}: ${e.message}`, 'error');
      }
    } finally {
      setPageLoading(false);
    }
  }, [sessionId, page, pageSize, columnDefs, showSnackbar, isMpnValidationColumn]);

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
        h.startsWith('Customer_Identification_') ||
        h === 'Tag' || 
        h === 'Factwise ID' ||
        (h.includes('Specification') && (h.includes('Name') || h.includes('Value'))) ||
        (h.includes('Customer') && h.includes('Identification'))
      );
      
      setFormulaColumns(detectedFormulaColumns);
      
      // Calculate column counts
      const tagColumns = viewHeaders.filter(h => h.startsWith('Tag_') || h === 'Tag');
      const specNameColumns = viewHeaders.filter(h => h.startsWith('Specification_Name_') || h === 'Specification name');
      const customerNameColumns = viewHeaders.filter(h => h.startsWith('Customer_Identification_Name_'));
      
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
          const isFormulaColumn = detectedFormulaColumns.includes(col) || col.startsWith('Tag_') || col.startsWith('Specification_') || col.startsWith('Customer_Identification_') || col === 'Tag' || col.includes('Specification') || col.includes('Customer identification') || col.includes('Custom identification') || col === 'Factwise ID';
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
          // Re-apply formulas once if Tag columns are expected but missing
          if (hasTagRules && !formulasReapplied) {
            try {
              await api.applyFormulas(sessionId, sessionMeta.formula_rules);
            } catch (_) {}
            formulasReapplied = true;
          }

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
          serialIncrement: factwiseSerialIncrement
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
          serialIncrement: factwiseSerialIncrement
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
  }, [firstColumn, secondColumn, operator, factwiseGenerationMode, factwiseSerialPrefix, factwiseSerialStart, factwiseSerialPadding, factwiseSerialIncrement, showSnackbar, fetchDataSynchronized, updateDataIntegrity]);

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
          h.startsWith('Customer_Identification_') ||
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
        const customerColumns = newHeaders.filter(h => h.startsWith('Customer_Identification_Name_') || h === 'Customer identification name' || h === 'Custom identification name');
        
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

  // ─── DIALOG HANDLERS ────────────────────────────────────────────────────────
  const handleOpenFormulaBuilder = useCallback(() => {
    setFormulaBuilderOpen(true);
  }, []);

  const handleCloseFormulaBuilder = useCallback(() => {
    setFormulaBuilderOpen(false);
  }, []);

  const dataColumnFields = useMemo(() => (
    (columnDefs || [])
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field)
  ), [columnDefs]);

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

  const handleOpenCreateColumnDialog = useCallback(() => {
    const fields = dataColumnFields;
    setCreateColumnTarget(prev => prev || (fields.includes('Item name') ? 'Item name' : ''));
    if (!createColumnFirst && fields.length > 0) {
      setCreateColumnFirst(fields[0]);
    }
    if (!createColumnSecond && fields.length > 1) {
      const first = createColumnFirst || fields[0];
      setCreateColumnSecond(fields.find(field => field !== first) || fields[1]);
    }
    setCreateColumnDialogOpen(true);
  }, [dataColumnFields, createColumnFirst, createColumnSecond]);

  const buildCreatedColumnDef = useCallback((field) => ({
    headerName: field,
    field,
    tooltipField: field,
    editable: true,
    sortable: true,
    filter: true,
    resizable: true,
    width: columnWidths[field] || 180,
    headerClass: 'ag-header-cell-excel',
    cellStyle: { padding: '12px 16px', borderRight: '1px solid #e0e0e0' }
  }), [columnWidths]);

  const handleCreateConcatenatedColumn = useCallback(async () => {
    const target = String(createColumnTarget || '').trim();
    if (!target) {
      showSnackbar('Enter a target column name', 'warning');
      return;
    }
    if (createColumnContentType === 'concat' && (!createColumnFirst || !createColumnSecond)) {
      showSnackbar('Select two source columns', 'warning');
      return;
    }

    try {
      setCreateColumnSaving(true);
      const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';
      const updatedRows = (rowData || []).map(row => {
        const copy = { ...row };
        const generated = createColumnContentType === 'blank'
          ? ''
          : [copy[createColumnFirst], copy[createColumnSecond]]
            .map(value => value === null || value === undefined ? '' : String(value).trim())
            .filter(Boolean)
            .join(createColumnSeparator);
        if (createColumnMode === 'overwrite' || isBlank(copy[target])) {
          copy[target] = generated;
        }
        return copy;
      });

      if (!dataColumnFields.includes(target)) {
        setColumnDefs(prev => [...prev, buildCreatedColumnDef(target)]);
      }

      setRowData(updatedRows);
      setHasUnsavedChanges(false);
      await api.saveEditedData(sessionId, { rows: updatedRows });
      setCreateColumnDialogOpen(false);
      showSnackbar(
        createColumnContentType === 'blank'
          ? `${target} blank column saved`
          : `${target} updated from selected columns`,
        'success'
      );
    } catch (error) {
      console.error('Create column failed:', error);
      showSnackbar(error.response?.data?.error || error.message || 'Failed to create column', 'error');
    } finally {
      setCreateColumnSaving(false);
    }
  }, [
    createColumnTarget,
    createColumnContentType,
    createColumnFirst,
    createColumnSecond,
    createColumnSeparator,
    createColumnMode,
    rowData,
    dataColumnFields,
    buildCreatedColumnDef,
    sessionId,
    showSnackbar
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
    setFactwiseSerialPrefix('SFO');
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
      const defaults = defaultValues || {};
      const rules = Array.isArray(appliedFormulas) ? appliedFormulas : [];
      let currentMappings = null;
      let currentFactwiseRules = null;

      try {
        const existing = await api.getExistingMappings(sessionId);
        currentMappings = existing?.data?.mappings || null;
        currentFactwiseRules = existing?.data?.session_metadata?.factwise_rules || null;
      } catch (_) {}

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
        mpnValidationMetadata
      );
      if (resp?.data?.success && processingTemplateContext) {
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
            }
          ],
          metadata: {
            mapping_template_id: resp.data.template_id,
            processing_path: processingTemplateContext.processingPath || '',
            saved_from_session_id: sessionId,
          }
        });
      }
      const elapsed = Date.now() - opStart;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      if (resp?.data?.success) {
        setTemplateSaved(true);
        showSnackbar(`Template "${saveName}" saved successfully!`, 'success');
        handleCloseSaveTemplateDialog();
      } else {
        showSnackbar(resp?.data?.error || 'Failed to save template', 'error');
      }
    } catch (e) {
      showSnackbar('Failed to save template', 'error');
    } finally {
      setTemplateSaving(false);
    }
  }, [sessionId, templateName, dynamicColumnCounts, defaultValues, appliedFormulas, factwiseIdRule, mpnValidationCompleted, originalMpnColumn, mpnColumn, mpnManufacturerColumn, isExistingProcessingTemplate, processingTemplateContext, showSnackbar, handleCloseSaveTemplateDialog]);

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
    'Item code', 'Item name', 'Item type', 'Measurement unit', 'Procurement entity name'
  ]), []);

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
  const runGuardedExport = useCallback(async (exportFn) => {
    const { isFactwiseSheet, present } = getFactwiseRequiredGaps();
    if (!isFactwiseSheet || present.length === 0) {
      exportFn();
      return;
    }
    const itemCodeField = present.find(p => p.req === 'Item code')?.field || null;
    let gaps = [];
    let icIssue = null;
    try {
      const resp = await api.requiredFieldReport(sessionId, present.map(p => p.field), itemCodeField ? [itemCodeField] : []);
      const counts = (resp?.data?.gaps || []).reduce((m, g) => { m[g.field] = g.emptyCount; return m; }, {});
      gaps = present.map(p => ({ ...p, emptyCount: counts[p.field] || 0 })).filter(g => g.emptyCount > 0);
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
      })).filter(g => g.emptyCount > 0);
    }
    // Item code gets its own section; keep other required fields as simple fills.
    const otherGaps = gaps.filter(g => g.field !== itemCodeField);
    if (otherGaps.length > 0 || icIssue) {
      setRequiredGaps(otherGaps);
      setItemCodeIssue(icIssue);
      setRequiredDefaults({});
      pendingExportRef.current = exportFn;
      setRequiredDialogOpen(true);
      return;
    }
    exportFn();
  }, [getFactwiseRequiredGaps, sessionId, rowData]);

  const handleFillRequiredAndExport = useCallback(async () => {
    try {
      // "Highlight" is not a fix — mark the duplicate cells in the grid and stop,
      // so the user can edit them by hand. Don't touch data, don't export.
      if (itemCodeIssue && itemCodeIssue.dupRows > 0 && itemCodeCfg.duplicate === 'highlight') {
        setDupHighlight({
          field: itemCodeIssue.field,
          values: new Set((itemCodeIssue.dupValues || []).map(v => String(v).trim())),
        });
        setRequiredDialogOpen(false);
        setItemCodeIssue(null);
        pendingExportRef.current = null;
        showSnackbar(`Highlighted ${itemCodeIssue.dupRows} rows with duplicate Item codes — edit them, then export again.`, 'info');
        return;
      }
      setRequiredFilling(true);
      // 1) Resolve Item code blanks/duplicates first (it must be filled AND unique).
      if (itemCodeIssue) {
        const blankStrategy = itemCodeIssue.blanks > 0 ? itemCodeCfg.blank : 'leave';
        const duplicateStrategy = itemCodeIssue.dupRows > 0 ? itemCodeCfg.duplicate : 'leave';
        if (blankStrategy !== 'leave' || duplicateStrategy !== 'leave') {
          await api.resolveItemCode(sessionId, {
            column: itemCodeIssue.field,
            blankStrategy,
            duplicateStrategy,
            prefix: itemCodeCfg.prefix,
            separator: itemCodeCfg.separator || '-',
            start: parseInt(itemCodeCfg.start, 10) || 1,
            padding: parseInt(itemCodeCfg.padding, 10) || 0,
          });
        }
      }
      // 2) Fill the other required fields with their chosen default values.
      const defaults = {};
      requiredGaps.forEach(g => {
        const def = (requiredDefaults[g.field] || '').trim();
        if (def) defaults[g.field] = def;
      });
      if (Object.keys(defaults).length > 0) {
        await api.fillRequiredDefaults(sessionId, defaults);
      }
      await fetchDataSynchronized();
      setRequiredDialogOpen(false);
      setItemCodeIssue(null);
      const fn = pendingExportRef.current;
      pendingExportRef.current = null;
      if (fn) fn();
    } catch (e) {
      showSnackbar(e.response?.data?.error || e.message || 'Could not apply the fixes', 'error');
    } finally {
      setRequiredFilling(false);
    }
  }, [sessionId, requiredGaps, requiredDefaults, itemCodeIssue, itemCodeCfg, fetchDataSynchronized, showSnackbar]);

  const handleExportToProject = useCallback(() => {
    const cols = {};
    columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .forEach(col => { cols[col.field] = true; });
    setExportProjectSelectedColumns(cols);
    setExportProjectSelectAll(true);
    setExportProjectName(`Project Export - ${new Date().toLocaleDateString()}`);
    setExportProjectMode('NEW');
    setSelectedExistingProject(null);
    setExportProjectSuccess(false);
    setExportProjectDialogOpen(true);
  }, [columnDefs]);

  const getCurrentExportColumnOrder = useCallback(() => (
    columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field)
  ), [columnDefs]);

  const openFactwisePreview = useCallback((type) => {
    setFactwisePreviewType(type);
    setFactwisePreviewOpen(true);
  }, []);

  const handleChooseFactwiseDestination = useCallback((destination) => {
    setFactwiseExportDialogOpen(false);
    if (destination === 'project') {
      handleExportToProject();
      return;
    }
    runGuardedExport(() => openFactwisePreview(destination));
  }, [handleExportToProject, runGuardedExport, openFactwisePreview]);

  const downloadFactwisePreview = useCallback(async (format) => {
    const columnOrder = getCurrentExportColumnOrder();
    const label = factwisePreviewType === 'bom' ? 'bom_directory' : 'item_directory';
    const extension = format === 'csv' ? 'csv' : 'xlsx';
    const mime = format === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    try {
      setFactwisePreviewDownloading(format);
      const response = await api.downloadProcessedFile(sessionId, format === 'csv' ? 'csv' : 'excel', columnOrder);
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

  const factwiseBomPreview = useMemo(() => {
    const rows = Array.isArray(rowData) ? rowData : [];
    const cols = (columnDefs || []).filter(col => col.field && col.field !== '__row_number__');
    const findField = (...needles) => {
      const loweredNeedles = needles.map(n => String(n).toLowerCase());
      const match = cols.find(col => {
        const name = String(col.headerName || col.field || '').toLowerCase();
        return loweredNeedles.some(needle => name.includes(needle));
      });
      return match?.field || null;
    };
    const itemCodeField = findField('item code', 'item_code', 'factwise id', 'part number');
    const mpnField = findField('mpn', 'manufacturer part', 'part no');
    const manufacturerField = findField('manufacturer', 'mfr', 'producer');
    const qtyField = findField('qty', 'quantity');
    const parent = rows.find(row => itemCodeField && row[itemCodeField])?.[itemCodeField]
      || rows.find(row => mpnField && row[mpnField])?.[mpnField]
      || 'BOM Preview';
    const materialRows = rows
      .filter(row => row && Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== ''))
      .slice(0, 5);
    const children = materialRows.slice(0, 4).map((row, index) => {
      const code = (mpnField && row[mpnField]) || (itemCodeField && row[itemCodeField]) || `RAW MATERIAL ${index + 1}`;
      const maker = manufacturerField && row[manufacturerField] ? `_${row[manufacturerField]}` : '';
      const qty = qtyField && row[qtyField] ? ` (${row[qtyField]})` : ` (${index === 0 ? '7.0' : index === 1 ? '2.0' : index === 2 ? '4.0' : '1.0'})`;
      return `${String(code).trim()}${String(maker).trim()}${qty}`;
    });
    return {
      parent: String(parent).trim(),
      children,
      overflow: Math.max(0, Math.max(totalRows || rows.length, rows.length) - children.length)
    };
  }, [columnDefs, rowData, totalRows]);

  const handleExportProjectConfirm = useCallback(() => {
    const selectedCols = Object.entries(exportProjectSelectedColumns)
      .filter(([, selected]) => selected)
      .map(([field]) => field);

    if (selectedCols.length === 0) {
      showSnackbar('Please select at least one column to export', 'warning');
      return;
    }

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
  }, [showSnackbar, exportProjectSelectedColumns, exportProjectMode, selectedExistingProject]);

  const handleExportProjectToggleSelectAll = useCallback(() => {
    const newVal = !exportProjectSelectAll;
    setExportProjectSelectAll(newVal);
    setExportProjectSelectedColumns(prev => {
      const updated = {};
      Object.keys(prev).forEach(key => { updated[key] = newVal; });
      return updated;
    });
  }, [exportProjectSelectAll]);

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
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
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
    setToolsMenuAnchor(null);
    const headers = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    setMpnColumn(prev => prev || detectMpnColumn(headers));
    setMpnSplitDialogOpen(true);
  }, [columnDefs, detectMpnColumn]);

  const handleOpenManufacturerMatchDialog = useCallback(() => {
    setToolsMenuAnchor(null);
    const headers = columnDefs
      .filter(col => col.field && col.field !== '__row_number__')
      .map(col => col.field);
    setMpnColumn(prev => prev || detectMpnColumn(headers));
    setMpnManufacturerColumn(prev => prev || detectManufacturerColumn(headers));
    setManufacturerMatchDialogOpen(true);
  }, [columnDefs, detectMpnColumn, detectManufacturerColumn]);

  const handleOpenProducerParseDialog = useCallback(() => {
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

  // "Tag_1" → "Tag  (← Manufacturer)" or "(= default)". No annotation if neither.
  const columnLabel = useCallback((field, headerName) => {
    const base = headerName || field;
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
      showSnackbar(`Copied "${copySource}" into "${copyTarget}" (${resp.data.changed} cells).`, 'success');
      setCopyColOpen(false);
      await fetchDataSynchronized();
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not copy the column.'), 'error');
    } finally {
      setCopyBusy(false);
    }
  }, [copySource, copyTarget, copyOnlyEmpty, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

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
      showSnackbar(`Set "${defaultCol}" for ${resp.data.changed} cell${resp.data.changed !== 1 ? 's' : ''}.`, 'success');
      setDefaultColOpen(false);
      await fetchDataSynchronized();
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not set the default value.'), 'error');
    } finally {
      setDefaultBusy(false);
    }
  }, [defaultCol, defaultValue, defaultOnlyEmpty, defaultMode, condCol, condOp, condCompare, condThen, condElse, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

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
      setDeleteRowsOpen(false);
      await fetchDataSynchronized();
    } catch (e) {
      showSnackbar(getFriendlyErrorMessage(e, 'Could not delete rows.'), 'error');
    } finally {
      setDelBusy(false);
    }
  }, [delCol, delOp, delCompare, sessionId, showSnackbar, fetchDataSynchronized, getFriendlyErrorMessage]);

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

  const buildSplitColsPayload = useCallback(() => {
    const chosen = splitColsCandidates.find(col => col.field === splitColsConfig.sourceColumn);
    return {
      sourceColumn: splitColsConfig.sourceColumn,
      sourceColumnIndex: chosen ? chosen.index : null,
      destinationPrefix: splitColsConfig.destinationPrefix.trim(),
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
  }, [splitColsConfig, splitColsCandidates]);

  const handleOpenSplitColsDialog = useCallback(() => {
    setToolsMenuAnchor(null);
    refreshColumnSourceMap();
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

  const handleCorrectionFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Only allow Excel uploads
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
      showSnackbar('Please upload an Excel file (.xlsx or .xls)', 'error');
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
    navigate(`/mapping/${sessionId}`);
  }, [hasUnsavedChanges, navigate, sessionId, dynamicColumnCounts]);

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
  const rowSearchQuery = rowSearchTerm.trim().toLowerCase();
  const displayedRows = (rowData || [])
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      if (!mpnFilterInvalidOnly && rowFilterMode !== 'invalid_mpn') return true;
      const providerValues = [
        row['MPN valid (DigiKey)'] ?? row['MPN valid'],
        row['MPN valid (Mouser)'],
        row['MPN valid (Element14)']
      ];
      return providerValues.some(value => String(value || '').toLowerCase() === 'no');
    })
    .filter(({ row }) => {
      if (rowFilterMode !== 'unknown') return true;
      return Object.values(row || {}).some(value =>
        String(value ?? '').trim().toLowerCase() === 'unknown'
      );
    })
    .filter(({ row }) => {
      if (!rowSearchQuery) return true;
      return Object.values(row || {}).some(value =>
        String(value ?? '').toLowerCase().includes(rowSearchQuery)
      );
    });
  const editorSubtitle = `${sessionId ? `Session ${sessionId}` : 'Active workbook'} - ${totalRows.toLocaleString()} rows`;
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

      {/* Create Column Dialog */}
      <Dialog open={createColumnDialogOpen} onClose={() => setCreateColumnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Column</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 1, pb: 2 }}>
          <DialogContentText sx={{ mb: 2.25, color: t.text.secondary, fontSize: 14.5, lineHeight: 1.55 }}>
            Fill a required column by joining two existing columns.
          </DialogContentText>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                size="small"
                label="Target column"
                value={createColumnTarget}
                onChange={(e) => setCreateColumnTarget(e.target.value)}
                helperText="Use Item name for the compulsory item-name field, or enter a new column name."
              />
            </Grid>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Column content</InputLabel>
                <Select
                  label="Column content"
                  value={createColumnContentType}
                  onChange={(e) => setCreateColumnContentType(e.target.value)}
                >
                  <MenuItem value="concat">Join two columns</MenuItem>
                  <MenuItem value="blank">Blank column</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {createColumnContentType === 'concat' && (
              <>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>First column</InputLabel>
                    <Select
                      label="First column"
                      value={createColumnFirst}
                      onChange={(e) => setCreateColumnFirst(e.target.value)}
                    >
                      {dataColumnFields.map(field => (
                        <MenuItem key={field} value={field}>{field}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Second column</InputLabel>
                    <Select
                      label="Second column"
                      value={createColumnSecond}
                      onChange={(e) => setCreateColumnSecond(e.target.value)}
                    >
                      {dataColumnFields.map(field => (
                        <MenuItem key={field} value={field}>{field}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Separator"
                    value={createColumnSeparator}
                    onChange={(e) => setCreateColumnSeparator(e.target.value)}
                    helperText="Example: space, -, _, or /"
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Apply mode</InputLabel>
                <Select
                  label="Apply mode"
                  value={createColumnMode}
                  onChange={(e) => setCreateColumnMode(e.target.value)}
                >
                  <MenuItem value="fill_empty">Fill empty cells only</MenuItem>
                  <MenuItem value="overwrite">Overwrite all rows</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          {createColumnTargetExists && createColumnTargetHasData && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              A column named {createColumnTarget} already has values. This will still run, but choose Fill empty cells only to preserve existing values.
            </Alert>
          )}
          <Alert severity="info" sx={{ mt: 2 }}>
            {createColumnContentType === 'blank'
              ? 'Blank columns are useful when the user wants to fill values manually later.'
              : 'Blank source values are skipped, so no extra separator is added when one side is empty.'}
          </Alert>
        </DialogContent>
        <DialogActions sx={{
          px: 3,
          py: 2,
          borderTop: `1px solid ${t.border.subtle}`,
          bgcolor: isDarkMode ? 'rgba(8, 13, 24, 0.72)' : 'rgba(248, 250, 252, 0.9)',
          gap: 1
        }}>
          <Button onClick={() => setCreateColumnDialogOpen(false)} disabled={createColumnSaving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateConcatenatedColumn}
            disabled={
              createColumnSaving ||
              !createColumnTarget ||
              (createColumnContentType === 'concat' && (!createColumnFirst || !createColumnSecond))
            }
            startIcon={createColumnSaving ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
          >
            {createColumnSaving ? 'Saving...' : 'Create'}
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
                  onClick={handleBackToMapping}
                  sx={iconButtonSx}
                  aria-label="Back to mapping"
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
                    Enhanced Data Editor
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

              <Button
                size="small"
                onClick={handleOpenCreateColumnDialog}
                disabled={createColumnSaving || syncStatus.inProgress}
                startIcon={<AutoAwesomeIcon sx={{ fontSize: 18 }} />}
                sx={{ ...outlinedActionSx, display: 'none' }}
                variant="outlined"
              >
                Create Column
              </Button>
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
              <Button
                size="small"
                onClick={handleOpenCreateColumnDialog}
                disabled={createColumnSaving || syncStatus.inProgress}
                startIcon={<AutoAwesomeIcon sx={{ fontSize: 18 }} />}
                sx={primaryActionSx}
                variant="contained"
              >
                Create Column
              </Button>
              <Button
                size="small"
                onClick={() => setFactwiseExportDialogOpen(true)}
                disabled={downloadLoading || syncStatus.inProgress}
                startIcon={<FolderOpenIcon sx={{ fontSize: 18 }} />}
                sx={exportFactwiseActionSx}
                variant="outlined"
              >
                Export to FactWise
              </Button>
              <Button
                size="small"
                onClick={handleAutoFitAll}
                disabled={syncStatus.inProgress}
                sx={outlinedActionSx}
                variant="outlined"
              >
                Auto-fit All
              </Button>
              <Tooltip title="Rebuild template columns">
                <span>
                  <Button
                    size="small"
                    onClick={handleRebuildColumns}
                    disabled={rebuildingColumns || syncStatus.inProgress}
                    sx={outlinedActionSx}
                    variant="outlined"
                  >
                    {rebuildingColumns ? 'Rebuilding...' : 'Rebuild Columns'}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={isExistingProcessingTemplate ? 'Existing templates cannot be saved from this run' : (templateSaved ? 'Template already saved' : 'Save this workflow template')}>
                <span>
                  <Button
                    size="small"
                    onClick={handleSaveTemplateFromToolbar}
                    disabled={templateSaving || syncStatus.inProgress || isExistingProcessingTemplate || templateSaved}
                    startIcon={templateSaving ? <CircularProgress size={16} /> : <SaveIcon sx={{ fontSize: 18 }} />}
                    sx={outlinedActionSx}
                    variant="outlined"
                  >
                    {templateSaving ? 'Saving...' : (templateSaved ? 'Template Saved' : 'Save Template')}
                  </Button>
                </span>
              </Tooltip>

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
              </Box>
              <Menu
                anchorEl={toolsMenuAnchor}
                open={Boolean(toolsMenuAnchor)}
                onClose={() => setToolsMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 220, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
              >
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenFormulaBuilder(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><AutoAwesomeIcon sx={{ color: '#9c27b0' }} /></ListItemIcon>
                  <ListItemText>Add Tags</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenCreateColumnDialog(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><AddIcon sx={{ color: '#2e7d32' }} /></ListItemIcon>
                  <ListItemText>Add Column</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleOpenSplitColsDialog} disabled={syncStatus.inProgress || splitColsRunning}>
                  <ListItemIcon>
                    {splitColsRunning ? <CircularProgress size={18} /> : <ContentCutIcon sx={{ color: '#0277bd' }} />}
                  </ListItemIcon>
                  <ListItemText>{splitColsRunning ? 'Splitting...' : 'Split into Columns'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenSmartExpand(); }} disabled={syncStatus.inProgress || mpnSplitting}>
                  <ListItemIcon>
                    {mpnSplitting ? <CircularProgress size={18} /> : <AccountTreeIcon sx={{ color: '#00796b' }} />}
                  </ListItemIcon>
                  <ListItemText>{mpnSplitting ? 'Expanding…' : 'Expand Alternates into Rows'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setCopySource(''); setCopyTarget(''); setCopyOnlyEmpty(false); setCopyColOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><ContentCopyIcon sx={{ color: '#1976d2' }} /></ListItemIcon>
                  <ListItemText>Copy a column into another</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setDefaultCol(''); setDefaultValue(''); setDefaultOnlyEmpty(true); setDefaultColOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><EditNoteIcon sx={{ color: '#7b1fa2' }} /></ListItemIcon>
                  <ListItemText>Set a default value for a column</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setDelCol(''); setDelOp('is_empty'); setDelCompare(''); setDeleteRowsOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><DeleteIcon sx={{ color: '#c62828' }} /></ListItemIcon>
                  <ListItemText>Delete rows by condition</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setExportBomOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><DownloadIcon sx={{ color: '#ea580c' }} /></ListItemIcon>
                  <ListItemText>Export BOM</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenFactwiseIdDialog(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><BadgeIcon sx={{ color: '#2e7d32' }} /></ListItemIcon>
                  <ListItemText>Create FactWise ID</ListItemText>
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleSaveTemplateFromToolbar(); }} disabled={syncStatus.inProgress || isExistingProcessingTemplate || templateSaved}>
                  <ListItemIcon><TemplateIcon sx={{ color: '#6a1b9a' }} /></ListItemIcon>
                  <ListItemText>{templateSaved ? 'Template Saved' : 'Save Template'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); sessionStorage.setItem('navigatedFromDataEditor', 'true'); navigate(`/mapping/${sessionId}`); }}>
                  <ListItemIcon><MapIcon sx={{ color: '#2196f3' }} /></ListItemIcon>
                  <ListItemText>View Column Mapping</ListItemText>
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
              <Button
                onClick={(e) => setRowFilterMenuAnchor(e.currentTarget)}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={<FilterListIcon />}
                sx={{
                  ...outlinedActionSx,
                  ml: { xs: 0, md: 'auto' },
                  borderColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly) ? t.color.primary : t.border.default,
                  backgroundColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly) ? t.state.infoBg : t.surface.controlSoft,
                  '&:hover': {
                    backgroundColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly) ? t.state.infoBg : t.action.hover,
                    borderColor: (rowFilterMode !== 'all' || mpnFilterInvalidOnly) ? t.color.primary : t.border.hover
                  }
                }}
              >
                Filter
              </Button>
              <Menu
                anchorEl={rowFilterMenuAnchor}
                open={Boolean(rowFilterMenuAnchor)}
                onClose={() => setRowFilterMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '8px', mt: 1, minWidth: 210, border: `1px solid ${t.border.default}`, boxShadow: t.shadow.card } }}
              >
                <MenuItem onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('all'); setMpnFilterInvalidOnly(false); }}>
                  <ListItemIcon>{rowFilterMode === 'all' && !mpnFilterInvalidOnly ? <CheckIcon sx={{ color: t.color.primary }} /> : null}</ListItemIcon>
                  <ListItemText>All rows</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('unknown'); setMpnFilterInvalidOnly(false); }}>
                  <ListItemIcon>{rowFilterMode === 'unknown' ? <CheckIcon sx={{ color: t.color.warningText }} /> : <ErrorIcon sx={{ color: t.color.warningText }} />}</ListItemIcon>
                  <ListItemText>Unknown values</ListItemText>
                </MenuItem>
                <MenuItem
                  onClick={() => { setRowFilterMenuAnchor(null); setRowFilterMode('invalid_mpn'); setMpnFilterInvalidOnly(false); }}
                  disabled={!hasMpnValidationColumns}
                >
                  <ListItemIcon>{(rowFilterMode === 'invalid_mpn' || mpnFilterInvalidOnly) ? <CheckIcon sx={{ color: t.color.danger }} /> : <VerifiedUserIcon sx={{ color: t.color.danger }} />}</ListItemIcon>
                  <ListItemText>Invalid MPN rows</ListItemText>
                </MenuItem>
              </Menu>
              <TextField
                value={rowSearchTerm}
                onChange={(e) => setRowSearchTerm(e.target.value)}
                placeholder="Search rows..."
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
                      // each batch warms ~8 MPNs into the cache, then we rebuild the
                      // grid from whatever's cached so far (cache_only, no API) and
                      // push it to the screen — so results appear batch by batch.
                      const CHUNK = 8;
                      let offset = 0;
                      let total = 0;
                      let shown = false;
                      setMpnProgress({ done: 0, total: 0 });
                      // eslint-disable-next-line no-constant-condition
                      while (true) {
                        const resp = await api.warmMPNs(sessionId, effectiveMpnColumn, offset, CHUNK, mpnManufacturerColumn);
                        const d = resp?.data || {};
                        total = d.total || 0;
                        setMpnProgress({ done: Math.min(d.validated || 0, total), total });
                        // Build + render the grid from the cache so far (live fill-in).
                        try {
                          await api.validateMPNs(sessionId, effectiveMpnColumn, mpnManufacturerColumn, true);
                          if (!shown) { setShowMpnColumns(true); shown = true; }
                          await fetchDataSynchronized();
                        } catch (_) { /* keep warming even if a partial render hiccups */ }
                        if (d.done || total === 0) break;
                        offset += CHUNK;
                      }
                      setMpnProgress(null);
                      setMpnValidationCompleted(true);
                      showSnackbar('MPN validation complete', 'success');
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
                  onClick={() => { setMpnMenuAnchor(null); setMpnFilterInvalidOnly(v => !v); }}
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
                action={<Button color="inherit" size="small" onClick={() => setDupHighlight(null)}>Clear highlight</Button>}
              >
                Duplicate <strong>{columnLabel(dupHighlight.field, dupHighlight.field)}</strong> values are highlighted in amber ({dupHighlight.values.size} value{dupHighlight.values.size === 1 ? '' : 's'}). Edit them so each is unique, then export again.
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
                          const isDupHighlighted = !!(dupHighlight && col.field === dupHighlight.field && cellValue.trim() && dupHighlight.values.has(cellValue.trim()));
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
            {/* Bottom pagination controls */}
            <Box sx={paginationBarSx}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">Rows per page</Typography>
                <Select size="small" value={pageSize} onChange={(e) => { const v = parseInt(e.target.value, 10); setPage(1); setPageSize(v); fetchPageData(1, v); }}>
                  {[50,100,200,500,1000,2000,3000].map(sz => <MenuItem key={sz} value={sz}>{sz}</MenuItem>)}
                </Select>
                <Typography variant="body2" color="text.secondary">
                  Page {page} of {Math.max(1, totalPages)} | Total: {totalRows.toLocaleString()}
                </Typography>
              </Box>
              <Pagination count={Math.max(1, totalPages)} page={page} onChange={(_, p) => { setPage(p); fetchPageData(p, pageSize); }} color="primary" size="small" shape="rounded" />
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Enhanced Formula Builder */}
      <FormulaBuilder
        open={formulaBuilderOpen}
        onClose={handleCloseFormulaBuilder}
        sessionId={sessionId}
        availableColumns={columnDefs.filter(col => {
          // Show ALL columns except system columns
          // This allows formulas to check any column (source data, Tags, Specifications, etc.)
          // and enables advanced use cases like conditional tagging and cascading rules
          if (!col.field || col.field === '__row_number__') return false;

          // Include everything else - all data columns, Tag columns, Specification columns, etc.
          return true;
        }).map(col => col.field || col.headerName).filter(Boolean)}
        onApplyFormulas={handleApplyFormulasSynchronized}
        initialRules={appliedFormulas}
        columnExamples={columnExamples}
        columnFillStats={columnFillStats}
      />

      {/* Column Parser Dialog */}
      {columnParserOpen && (
        <ColumnParser
          sessionId={sessionId}
          onClose={() => setColumnParserOpen(false)}
          onApply={(result) => {
            showSnackbar(`Parser applied! Added ${result.new_headers_count} new columns.`, 'success');
            fetchDataSynchronized(); // Refresh data
          }}
        />
      )}

      {/* Smart Expand — one entry point. Genuinely inspects the columns, shows a
          short assistant-style analysis, then applies the right transform in one
          click. The manual chooser below is the "Configure manually" fallback. */}
      <Dialog open={smartExpandOpen} onClose={() => smartPhase !== 'applying' && setSmartExpandOpen(false)} maxWidth="sm" fullWidth
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
      <Dialog open={reviewOpen} onClose={() => !reviewBusy && setReviewOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Review manufacturer names
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {reviewRows.length} row{reviewRows.length === 1 ? '' : 's'} need a quick check — the manufacturers didn't line up
            with the number of parts. Click between two words to add or remove a break. Each segment is one manufacturer.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
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
        maxWidth={exportBomFullscreen ? false : 'lg'} fullWidth fullScreen={exportBomFullscreen}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Export BOM</span>
          <Button size="small" onClick={() => setExportBomFullscreen(f => !f)}>
            {exportBomFullscreen ? 'Exit full screen' : 'Full screen'}
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Review the BOM below, then export it — as an Excel sheet, or to FactWise.
          </Typography>
          {/* BOM tree preview */}
          {exportBomOpen && <BomTreePreview sessionId={sessionId} fullscreen={exportBomFullscreen} height={exportBomFullscreen ? 'calc(100vh - 280px)' : 420} />}
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
      <Dialog open={alternatesChooserOpen} onClose={() => setAlternatesChooserOpen(false)} maxWidth="sm" fullWidth>
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
      <Dialog open={altColsDialogOpen} onClose={() => setAltColsDialogOpen(false)} maxWidth="sm" fullWidth>
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
      <Dialog open={producerParseDialogOpen} onClose={() => setProducerParseDialogOpen(false)} maxWidth="sm" fullWidth>
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
        onClose={() => setRequiredDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            width: 'min(760px, calc(100vw - 40px))',
            maxHeight: 'min(760px, calc(100vh - 48px))',
            borderRadius: '16px',
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle>Before export — fix these for FactWise</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            FactWise won't accept the sheet with these issues. Choose how to fix each, or go back and edit it yourself.
          </DialogContentText>

          {/* Item code — must be filled AND unique */}
          {itemCodeIssue && (
            <Box sx={{
              border: `1px solid ${t.border.default}`,
              borderRadius: '14px',
              p: 2,
              mb: 2,
              bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.58)' : '#ffffff'
            }}>
              <Typography variant="body2" sx={{ fontWeight: 760, color: t.text.heading }}>Item code</Typography>
              <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
                {[itemCodeIssue.blanks > 0 && `${itemCodeIssue.blanks} blank`,
                  itemCodeIssue.dupRows > 0 && `${itemCodeIssue.dupRows} duplicate rows`]
                  .filter(Boolean).join(' · ')}
              </Typography>

              {itemCodeIssue.blanks > 0 && (
                <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                  <InputLabel>For blank Item codes</InputLabel>
                  <Select label="For blank Item codes" value={itemCodeCfg.blank}
                    onChange={(e) => setItemCodeCfg(prev => ({ ...prev, blank: e.target.value }))}>
                    <MenuItem value="prefix_sequence">Generate a code — prefix + running number</MenuItem>
                    <MenuItem value="leave">Leave blank — I'll fill them in the sheet</MenuItem>
                  </Select>
                </FormControl>
              )}

              {itemCodeIssue.dupRows > 0 && (
                <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                  <InputLabel>For duplicate Item codes</InputLabel>
                  <Select label="For duplicate Item codes" value={itemCodeCfg.duplicate}
                    onChange={(e) => setItemCodeCfg(prev => ({ ...prev, duplicate: e.target.value }))}>
                    <MenuItem value="highlight">Highlight them so I can edit them myself</MenuItem>
                    <MenuItem value="delete">Delete duplicate rows — keep the first, remove the rest</MenuItem>
                    <MenuItem value="suffix">Add a suffix — keep first, later ones become …-2, -3</MenuItem>
                    <MenuItem value="prefix_sequence">Replace duplicates — prefix + running number</MenuItem>
                    <MenuItem value="leave">Leave as-is (may fail import)</MenuItem>
                  </Select>
                </FormControl>
              )}

              {((itemCodeIssue.blanks > 0 && itemCodeCfg.blank === 'prefix_sequence') ||
                (itemCodeIssue.dupRows > 0 && itemCodeCfg.duplicate === 'prefix_sequence')) && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' }, gap: 1.25 }}>
                  <TextField size="small" label="Prefix" value={itemCodeCfg.prefix}
                    onChange={(e) => setItemCodeCfg(prev => ({ ...prev, prefix: e.target.value }))} />
                  <TextField size="small" label="Start #" type="number" value={itemCodeCfg.start}
                    onChange={(e) => setItemCodeCfg(prev => ({ ...prev, start: e.target.value }))} />
                  <TextField size="small" label="Digits" type="number" value={itemCodeCfg.padding}
                    onChange={(e) => setItemCodeCfg(prev => ({ ...prev, padding: e.target.value }))} />
                </Box>
              )}
              {itemCodeIssue.dupRows > 0 && itemCodeCfg.duplicate === 'suffix' && (
                <TextField size="small" label="Suffix separator" value={itemCodeCfg.separator}
                  onChange={(e) => setItemCodeCfg(prev => ({ ...prev, separator: e.target.value }))} sx={{ width: 160 }} />
              )}
            </Box>
          )}

          {/* Other required fields — one value fills every blank */}
          <Box sx={{ display: 'grid', gap: 1.25 }}>
          {requiredGaps.map(g => (
            <Box
              key={g.field}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '220px minmax(0, 1fr)' },
                alignItems: 'center',
                gap: 1.5
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700, color: t.text.heading }}>{g.headerName}</Typography>
                <Typography variant="caption" color="error">{g.emptyCount} blank {g.emptyCount === 1 ? 'cell' : 'cells'}</Typography>
              </Box>
              <TextField
                size="small"
                fullWidth
                placeholder={`Default value for ${g.headerName}`}
                value={requiredDefaults[g.field] || ''}
                onChange={(e) => setRequiredDefaults(prev => ({ ...prev, [g.field]: e.target.value }))}
              />
            </Box>
          ))}
          </Box>
          <Alert severity="info" sx={{ mt: 2, borderRadius: '12px' }}>
            Anything set to “leave” exports as-is. Blank required fields left empty may be rejected by FactWise.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setRequiredDialogOpen(false); setItemCodeIssue(null); pendingExportRef.current = null; }} disabled={requiredFilling}>
            Go back and edit myself
          </Button>
          <Button
            onClick={handleFillRequiredAndExport}
            variant="contained"
            disabled={requiredFilling}
          >
            {requiredFilling
              ? 'Applying…'
              : (itemCodeIssue && itemCodeIssue.dupRows > 0 && itemCodeCfg.duplicate === 'highlight'
                  ? 'Highlight duplicates'
                  : 'Apply & continue')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Split Values Into Columns */}
      <Dialog open={splitColsDialogOpen} onClose={() => setSplitColsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Split into Columns</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            When one cell holds several values &mdash; for example <code>C3, C4, C5</code> &mdash; this puts each value
            in its own column, <strong>replacing the original column in place</strong>. Give them a FactWise clustered
            name (e.g. <code>Tag</code> or <code>Specification value</code>) and every column carries that same name —
            no <code>Tag&nbsp;1&nbsp;/&nbsp;Tag&nbsp;2</code> numbering. It sizes to the widest cell, so a row with 13
            values makes 13 columns.
          </DialogContentText>

            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                <InputLabel>Column to split</InputLabel>
                <Select
                  label="Column to split"
                  value={splitColsConfig.sourceColumn}
                  onChange={(e) => {
                    const field = e.target.value;
                    const cand = splitColsCandidates.find(c => c.field === field);
                    // Auto-fill the output name from the column's FactWise name
                    // (e.g. "Specification value", "Tag") so the split columns land
                    // in the right cluster — no typing, no casing mistakes.
                    setSplitColsConfig(prev => ({
                      ...prev,
                      sourceColumn: field,
                      destinationPrefix: cand ? cand.label : (prev.destinationPrefix || field),
                    }));
                  }}
                >
                  {splitColsCandidates.map(col => (
                    <MenuItem key={`${col.field}-${col.index}`} value={col.field}>{columnLabel(col.field, col.label)}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 190 }}>
                <InputLabel>Split by</InputLabel>
                <Select
                  label="Split by"
                  value={splitColsConfig.splitMode}
                  onChange={(e) => setSplitColsConfig(prev => ({ ...prev, splitMode: e.target.value }))}
                >
                  <MenuItem value="delimiter">A delimiter</MenuItem>
                  <MenuItem value="characters">Every N characters</MenuItem>
                </Select>
              </FormControl>

              {splitColsConfig.splitMode === 'delimiter' ? (
                <>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Delimiter</InputLabel>
                    <Select
                      label="Delimiter"
                      value={splitColsConfig.delimiter}
                      onChange={(e) => setSplitColsConfig(prev => ({ ...prev, delimiter: e.target.value }))}
                    >
                      <MenuItem value="comma">Comma ,</MenuItem>
                      <MenuItem value="semicolon">Semicolon ;</MenuItem>
                      <MenuItem value="pipe">Pipe |</MenuItem>
                      <MenuItem value="slash">Slash /</MenuItem>
                      <MenuItem value="newline">New line</MenuItem>
                      <MenuItem value="tab">Tab</MenuItem>
                      <MenuItem value="space">Space</MenuItem>
                      <MenuItem value="custom">Custom character...</MenuItem>
                    </Select>
                  </FormControl>

                  {splitColsConfig.delimiter === 'custom' && (
                    <TextField
                      size="small"
                      label="Custom delimiter"
                      sx={{ minWidth: 160 }}
                      value={splitColsConfig.customDelimiter}
                      onChange={(e) => setSplitColsConfig(prev => ({ ...prev, customDelimiter: e.target.value }))}
                      helperText="Any character or text"
                    />
                  )}
                </>
              ) : (
                <TextField
                  size="small"
                  type="number"
                  label="Characters per column"
                  sx={{ minWidth: 190 }}
                  InputProps={{ inputProps: { min: 1 } }}
                  value={splitColsConfig.chunkSize}
                  onChange={(e) => setSplitColsConfig(prev => ({ ...prev, chunkSize: e.target.value }))}
                  helperText="e.g. 3 turns ABCDEFGH into ABC | DEF | GH"
                />
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="Output column name"
                sx={{ minWidth: 220, flex: 1 }}
                value={splitColsConfig.destinationPrefix}
                onChange={(e) => setSplitColsConfig(prev => ({ ...prev, destinationPrefix: e.target.value }))}
                helperText={
                  splitColsConfig.destinationPrefix.trim()
                    ? `Auto-filled from the column — all new columns will be named "${splitColsConfig.destinationPrefix.trim()}" (clustered). Edit only if needed.`
                    : 'Pick a column above — this fills in automatically.'
                }
              />
              <TextField
                size="small"
                type="number"
                label="Max columns"
                sx={{ minWidth: 160 }}
                InputProps={{ inputProps: { min: 0 } }}
                value={splitColsConfig.maxColumns}
                onChange={(e) => setSplitColsConfig(prev => ({ ...prev, maxColumns: e.target.value }))}
                helperText="Blank = as many as needed"
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={splitColsConfig.trim}
                    onChange={(e) => setSplitColsConfig(prev => ({ ...prev, trim: e.target.checked }))}
                  />
                }
                label="Trim spaces"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={splitColsConfig.dropEmpty}
                    onChange={(e) => setSplitColsConfig(prev => ({ ...prev, dropEmpty: e.target.checked }))}
                  />
                }
                label="Drop empty values"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={splitColsConfig.keepSourceColumn}
                    onChange={(e) => setSplitColsConfig(prev => ({ ...prev, keepSourceColumn: e.target.checked }))}
                  />
                }
                label="Keep the original column"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={splitColsConfig.overwriteExisting}
                    onChange={(e) => setSplitColsConfig(prev => ({ ...prev, overwriteExisting: e.target.checked }))}
                  />
                }
                label="Fill existing columns of this name (e.g. the template's Tag_1, Tag_2 …)"
              />
            </Box>

            {Number(splitColsConfig.maxColumns) > 0 && (
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>If a row has more values than fit</InputLabel>
                <Select
                  label="If a row has more values than fit"
                  value={splitColsConfig.onOverflow}
                  onChange={(e) => setSplitColsConfig(prev => ({ ...prev, onOverflow: e.target.value }))}
                >
                  <MenuItem value="review">Flag the extra values for review</MenuItem>
                  <MenuItem value="truncate">Drop the extras quietly</MenuItem>
                </Select>
              </FormControl>
            )}

            {splitColsError && <Alert severity="error" sx={{ mt: 2 }}>{splitColsError}</Alert>}

            {splitColsPreview && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="success" sx={{ mb: 1 }}>
                  {splitColsPreview.columns_created} column(s) created from {splitColsPreview.rows_split} row(s)
                  holding more than one value. Widest row had {splitColsPreview.widest_row}.
                  {splitColsPreview.overflow_rows > 0 && ` ${splitColsPreview.overflow_rows} row(s) overflowed.`}
                </Alert>
                <Box sx={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                  <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                    <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: '#fafafa' }}>
                      <Box component="tr">
                        {splitColsPreview.headers.map(header => (
                          <Box
                            component="th"
                            key={header}
                            sx={{
                              p: 0.75,
                              textAlign: 'left',
                              borderBottom: '1px solid #e0e0e0',
                              whiteSpace: 'nowrap',
                              fontWeight: splitColsPreview.new_columns?.includes(header) ? 700 : 500,
                              color: splitColsPreview.new_columns?.includes(header) ? '#0277bd' : 'inherit'
                            }}
                          >
                            {header}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    <Box component="tbody">
                      {splitColsPreview.data.map((row, rowIndex) => (
                        <Box component="tr" key={rowIndex}>
                          {splitColsPreview.headers.map(header => (
                            <Box
                              component="td"
                              key={header}
                              sx={{ p: 0.75, borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}
                            >
                              {row[header]}
                            </Box>
                          ))}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              </Box>
            )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setSplitColsDialogOpen(false); setColumnParserOpen(true); }}
            disabled={splitColsRunning}
            sx={{ mr: 'auto', color: '#0891b2', textTransform: 'none' }}
          >
            Advanced: structured parse…
          </Button>
          <Button onClick={() => setSplitColsDialogOpen(false)} disabled={splitColsRunning}>Cancel</Button>
          <Button
            onClick={handlePreviewSplitCols}
            disabled={splitColsPreviewLoading || splitColsRunning || !splitColsConfig.sourceColumn}
          >
            {splitColsPreviewLoading ? 'Previewing...' : 'Preview'}
          </Button>
          <Button
            onClick={handleApplySplitCols}
            variant="contained"
            startIcon={splitColsRunning ? <CircularProgress size={16} /> : <ContentCutIcon />}
            disabled={splitColsRunning || !splitColsConfig.sourceColumn || !splitColsConfig.destinationPrefix.trim()}
          >
            {splitColsRunning ? 'Splitting...' : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* MPN Split Dialog */}
      <Dialog open={mpnSplitDialogOpen} onClose={() => setMpnSplitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Expand Alternates · Packed in one column</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Select the MPN column to expand into one row per MPN. Cells are split only when they contain clear separators or recognized supplier prefixes; plain spaces stay part of the MPN.
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
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
            MPN Prefix Cleanup
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
          <FormControlLabel
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
            multiline
            minRows={2}
            label="Always strip these prefixes"
            value={mpnSplitOptions.extraPrefixes}
            onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, extraPrefixes: e.target.value }))}
            sx={{ mt: 1 }}
            helperText="Example: AGILE. One per line or comma separated."
          />
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
      <Dialog open={manufacturerMatchDialogOpen} onClose={() => setManufacturerMatchDialogOpen(false)} maxWidth="md" fullWidth>
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
            margin="normal"
            label="Template Name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
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
                    placeholder="SFO"
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
                        checked={factwiseSerialIncrement}
                        onChange={(event) => setFactwiseSerialIncrement(event.target.checked)}
                      />
                    }
                    label="Increase number for each row"
                  />
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
                {factwiseSerialIncrement ? `, ${(factwiseSerialPrefix || '')}${String((Number(factwiseSerialStart) || 1) + 1).padStart(Math.max(0, Number(factwiseSerialPadding) || 0), '0')}` : ' for every row'}
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
        maxWidth="xs"
        fullWidth
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

      {/* FactWise export destination chooser */}
      <Dialog
        open={factwiseExportDialogOpen}
        onClose={() => setFactwiseExportDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '14px', overflow: 'hidden', maxWidth: 560 } }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid #e5e7eb',
          bgcolor: '#f8fafc'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <FolderOpenIcon sx={{ color: '#2563eb' }} />
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 650 }}>
              Export to FactWise
            </Typography>
          </Box>
          <IconButton onClick={() => setFactwiseExportDialogOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, py: 2.5 }}>
          <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
            Choose where this prepared sheet should go.
          </Typography>
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {[
              {
                key: 'project',
                title: 'Export to Project',
                helper: 'Send selected columns into a new or existing project.',
                icon: <FolderOpenIcon sx={{ color: '#ea580c' }} />
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
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  px: 2,
                  py: 1.4,
                  bgcolor: '#fff',
                  '&:hover': { bgcolor: '#f8fafc', borderColor: '#bfdbfe' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 38 }}>{option.icon}</ListItemIcon>
                <ListItemText
                  primary={option.title}
                  secondary={option.helper}
                  primaryTypographyProps={{ fontWeight: 650, fontSize: 14, color: '#0f172a' }}
                  secondaryTypographyProps={{ fontSize: 12.5, color: '#64748b', mt: 0.25 }}
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
          if (!factwisePreviewDownloading) setFactwisePreviewOpen(false);
        }}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { borderRadius: '12px', overflow: 'hidden', maxWidth: factwisePreviewType === 'bom' ? 1068 : 980 } }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid #e5e7eb',
          bgcolor: '#fff'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {factwisePreviewType === 'bom'
              ? <AccountTreeIcon sx={{ color: '#16a34a' }} />
              : <BadgeIcon sx={{ color: '#2563eb' }} />}
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 650 }}>
              {factwisePreviewType === 'bom' ? 'Export BOM' : 'Export Item Directory'}
            </Typography>
          </Box>
          {factwisePreviewType === 'bom' ? (
            <Button sx={{ fontSize: 12, fontWeight: 700, color: '#1976d2' }}>
              FULL SCREEN
            </Button>
          ) : (
            <Button
              onClick={() => setFactwisePreviewOpen(false)}
              disabled={Boolean(factwisePreviewDownloading)}
              sx={{ minWidth: 0, color: '#64748b' }}
            >
              <CloseIcon fontSize="small" />
            </Button>
          )}
        </DialogTitle>
        <DialogContent sx={{ px: 3, py: 2.5 }}>
          {factwisePreviewType === 'bom' ? (
            <>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 2 }}>
                Review the BOM below, then export it as an Excel sheet, or to FactWise.
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 1.5 }}>
                High-level view - open full screen to drill into every raw material.
              </Typography>
              <Box
                sx={{
                  position: 'relative',
                  height: 374,
                  overflow: 'hidden',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  bgcolor: '#fff',
                  backgroundImage: 'radial-gradient(#e5e7eb 0.8px, transparent 0.8px)',
                  backgroundSize: '22px 22px'
                }}
              >
                <Box sx={{ position: 'absolute', left: '50%', top: 56, width: 2, height: 68, bgcolor: '#9ca3af' }} />
                <Box sx={{ position: 'absolute', left: '14%', right: '9%', top: 124, height: 2, bgcolor: '#c4c9d1' }} />
                {[14, 33, 52, 71, 88].map((left, index) => (
                  <Box
                    key={left}
                    sx={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: 124,
                      width: 2,
                      height: 40,
                      bgcolor: '#c4c9d1',
                      display: index >= Math.min(factwiseBomPreview.children.length, 4) && !(index === 4 && factwiseBomPreview.overflow > 0) ? 'none' : 'block'
                    }}
                  />
                ))}
                <Box
                  sx={{
                    position: 'absolute',
                    left: '50%',
                    top: 54,
                    transform: 'translateX(-50%)',
                    minWidth: 176,
                    height: 46,
                    px: 2,
                    border: '1px solid #aeb7c2',
                    borderRadius: '8px',
                    bgcolor: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 800,
                    color: '#0f172a',
                    boxShadow: '0 1px 2px rgba(15,23,42,0.06)'
                  }}
                >
                  <Box component="span" sx={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {factwiseBomPreview.parent}
                  </Box>
                  <KeyboardArrowDownIcon sx={{ fontSize: 16, ml: 0.5 }} />
                </Box>
                {(factwiseBomPreview.children.length ? factwiseBomPreview.children : ['Raw material preview']).slice(0, 4).map((label, index) => {
                  const positions = [14, 33, 52, 71];
                  return (
                    <Box
                      key={`${label}-${index}`}
                      sx={{
                        position: 'absolute',
                        left: `${positions[index]}%`,
                        top: 164,
                        transform: 'translateX(-50%)',
                        width: 174,
                        minHeight: 48,
                        px: 1.5,
                        py: 0.8,
                        borderRadius: '8px',
                        bgcolor: '#fde047',
                        border: '1px solid #eab308',
                        color: '#854d0e',
                        fontSize: 11,
                        fontWeight: 800,
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 8px 18px -14px rgba(161,98,7,0.8)'
                      }}
                    >
                      <Box component="span" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {label}
                      </Box>
                    </Box>
                  );
                })}
                {factwiseBomPreview.overflow > 0 && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: '88%',
                      top: 164,
                      transform: 'translateX(-50%)',
                      width: 174,
                      minHeight: 32,
                      px: 1.5,
                      py: 0.8,
                      borderRadius: '8px',
                      border: '1px dashed #cbd5e1',
                      bgcolor: '#f8fafc',
                      color: '#64748b',
                      fontSize: 11,
                      fontWeight: 800,
                      textAlign: 'center'
                    }}
                  >
                    +{factwiseBomPreview.overflow} more raw materials
                  </Box>
                )}
                <Box sx={{ position: 'absolute', left: 14, bottom: 14, display: 'grid', gap: 3 }}>
                  <Button size="small" sx={{ minWidth: 28, width: 28, height: 28, p: 0, bgcolor: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}>+</Button>
                  <Button size="small" sx={{ minWidth: 28, width: 28, height: 28, p: 0, bgcolor: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}>-</Button>
                  <Button size="small" sx={{ minWidth: 28, width: 28, height: 28, p: 0, bgcolor: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}>⛶</Button>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1.2 }}>
                {[
                  ['#ffffff', 'Finished good'],
                  ['#93c5fd', 'Sub-assembly'],
                  ['#bbf7d0', 'Sub-sub-assembly'],
                  ['#fde047', 'Raw material'],
                  ['#d1d5db', 'Alternate']
                ].map(([color, label]) => (
                  <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: '#64748b' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, border: '1px solid #cbd5e1' }} />
                    {label}
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ color: '#64748b', mb: 1 }}>
                Review the item directory below, then download it for FactWise.
              </Typography>
              <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 1.5 }}>
                Preview shows the current page. The downloaded file includes the full processed sheet.
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360, borderRadius: '10px' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {columnDefs
                        .filter(col => col.field && col.field !== '__row_number__')
                        .slice(0, 10)
                        .map(col => (
                          <TableCell key={col.field} sx={{ fontWeight: 700, bgcolor: '#f8fafc', whiteSpace: 'nowrap' }}>
                            {col.headerName || col.field}
                          </TableCell>
                        ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(rowData || []).slice(0, 8).map((row, rowIndex) => (
                      <TableRow key={row.id || rowIndex} hover>
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
                                color: '#334155'
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
                <Typography variant="caption" sx={{ color: '#64748b' }}>
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
          borderTop: '1px solid #e5e7eb',
          bgcolor: '#f8fafc'
        }}>
          <Button
            onClick={() => setFactwisePreviewOpen(false)}
            disabled={Boolean(factwisePreviewDownloading)}
            sx={{
              textTransform: 'none',
              borderRadius: '8px',
              color: factwisePreviewType === 'bom' ? '#1976d2' : '#475569',
              mr: factwisePreviewType === 'bom' ? 'auto' : 0,
              fontWeight: factwisePreviewType === 'bom' ? 700 : 500
            }}
          >
            Cancel
          </Button>
          {factwisePreviewType === 'bom' ? (
            <>
              <Button
                variant="contained"
                onClick={() => downloadFactwisePreview('excel')}
                disabled={Boolean(factwisePreviewDownloading)}
                startIcon={factwisePreviewDownloading === 'excel' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <FolderOpenIcon />}
                sx={{
                  textTransform: 'none',
                  borderRadius: '4px',
                  fontWeight: 700,
                  bgcolor: '#ea580c',
                  '&:hover': { bgcolor: '#c2410c' }
                }}
              >
                Export to FactWise
              </Button>
              <Button
                variant="contained"
                onClick={() => downloadFactwisePreview('excel')}
                disabled={Boolean(factwisePreviewDownloading)}
                startIcon={factwisePreviewDownloading === 'excel' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <DownloadIcon />}
                sx={{
                  textTransform: 'none',
                  borderRadius: '4px',
                  fontWeight: 700,
                  bgcolor: '#ea580c',
                  '&:hover': { bgcolor: '#c2410c' }
                }}
              >
                Export Sheet
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outlined"
                onClick={() => downloadFactwisePreview('csv')}
                disabled={Boolean(factwisePreviewDownloading)}
                startIcon={factwisePreviewDownloading === 'csv' ? <CircularProgress size={16} /> : <DownloadIcon />}
                sx={{ textTransform: 'none', borderRadius: '8px' }}
              >
                Download CSV
              </Button>
              <Button
                variant="contained"
                onClick={() => downloadFactwisePreview('excel')}
                disabled={Boolean(factwisePreviewDownloading)}
                startIcon={factwisePreviewDownloading === 'excel' ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <DownloadIcon />}
                sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 650 }}
              >
                Download XLSX
              </Button>
            </>
          )}
        </DialogActions>
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
            Upload an Excel file (.xlsx or .xls) with corrected data. The file should have the same headers as the exported data.
            Only matching headers will be updated; unmatched columns are ignored.
          </DialogContentText>

          {/* File Upload */}
          <Box sx={{ mb: 3 }}>
            <input
              accept=".xlsx,.xls"
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
          sx: { borderRadius: '12px', overflow: 'hidden' }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #e0e0e0',
          py: 2
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderOpenIcon sx={{ color: '#e65100' }} />
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '18px' }}>
              Export to Project
            </Typography>
          </Box>
          {!exportProjectLoading && (
            <IconButton onClick={() => setExportProjectDialogOpen(false)} size="small">
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>

        {exportProjectLoading ? (
          <DialogContent sx={{ px: 4, py: 8, textAlign: 'center' }}>
            <CircularProgress size={56} sx={{ color: '#e65100', mb: 3 }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
              Exporting to Project...
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
              Please wait
            </Typography>
          </DialogContent>
        ) : exportProjectSuccess ? (
          <>
            <DialogContent sx={{ px: 4, py: 5, textAlign: 'center' }}>
              <Box sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                backgroundColor: '#e8f5e9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px'
              }}>
                <CheckCircleIcon sx={{ fontSize: 48, color: '#2e7d32' }} />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#2e7d32', mb: 1.5 }}>
                Exported Successfully
              </Typography>
              <Typography variant="body1" sx={{ color: 'text.secondary', mb: 1 }}>
                Data has been exported to project
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
                {exportProjectMode === 'NEW'
                  ? exportProjectName
                  : `${selectedExistingProject?.project_code} — ${selectedExistingProject?.project_name}`}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
                {Object.values(exportProjectSelectedColumns).filter(v => v).length} columns exported
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, justifyContent: 'center', backgroundColor: '#f8f9fa', borderTop: '1px solid #e0e0e0' }}>
              <Button
                variant="contained"
                onClick={() => setExportProjectDialogOpen(false)}
                sx={{
                  backgroundColor: '#2e7d32',
                  '&:hover': { backgroundColor: '#1b5e20' },
                  textTransform: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  px: 4
                }}
              >
                Done
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent sx={{ px: 3, py: 3 }}>
              {/* Export Mode Selection */}
              <FormControl component="fieldset" sx={{ mb: 2, width: '100%' }}>
                <FormLabel component="legend" sx={{ fontSize: '14px', fontWeight: 500, mb: 0.5 }}>
                  Export to
                </FormLabel>
                <RadioGroup
                  row
                  value={exportProjectMode}
                  onChange={(e) => setExportProjectMode(e.target.value)}
                >
                  <FormControlLabel
                    value="NEW"
                    control={<Radio sx={{ py: 0.5 }} />}
                    label="New Project"
                  />
                  <FormControlLabel
                    value="EXISTING"
                    control={<Radio sx={{ py: 0.5 }} />}
                    label="Existing Project"
                  />
                </RadioGroup>
              </FormControl>

              <Divider sx={{ mb: 2 }} />

              {/* Project Name */}
              {exportProjectMode === 'NEW' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5, fontWeight: 500 }}>
                    Project Name
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={exportProjectName}
                    onChange={(e) => setExportProjectName(e.target.value)}
                    placeholder="Enter project name..."
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                  />
                </Box>
              )}

              {exportProjectMode === 'EXISTING' && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5, fontWeight: 500 }}>
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
                    renderOption={(props, option) => (
                      <li {...props} key={option.project_id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', py: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '14px', color: '#1565c0', minWidth: 90 }}>
                            {option.project_code}
                          </Typography>
                          <Typography variant="body2" sx={{ fontSize: '14px', ml: 3, flex: 1 }}>
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
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <>
                              <SearchIcon sx={{ color: 'text.secondary', fontSize: 20, mr: 0.5 }} />
                              {params.InputProps.startAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    noOptionsText="No projects found"
                    ListboxProps={{ style: { maxHeight: '300px' } }}
                  />
                </Box>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Fields to Export Section */}
              <Box sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    Fields to be exported
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Checkbox
                      checked={exportProjectSelectAll}
                      indeterminate={
                        !exportProjectSelectAll &&
                        Object.values(exportProjectSelectedColumns).some(v => v)
                      }
                      onChange={handleExportProjectToggleSelectAll}
                      size="small"
                      sx={{ color: '#2e7d32', '&.Mui-checked': { color: '#2e7d32' } }}
                    />
                    <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '13px' }}>
                      SELECT ALL
                    </Typography>
                  </Box>
                </Box>

                <Box sx={{
                  maxHeight: '280px',
                  overflowY: 'auto',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  backgroundColor: '#fafafa'
                }}>
                  <Grid container>
                    {Object.entries(exportProjectSelectedColumns).map(([field, checked]) => {
                      const colDef = columnDefs.find(c => c.field === field);
                      const label = colDef?.headerName || field;
                      return (
                        <Grid item xs={6} key={field}>
                          <Box sx={{
                            display: 'flex',
                            alignItems: 'center',
                            px: 1.5,
                            py: 0.25,
                            borderBottom: '1px solid #f0f0f0',
                            '&:hover': { backgroundColor: '#f5f5f5' }
                          }}>
                            <Checkbox
                              checked={checked}
                              size="small"
                              sx={{ color: '#2e7d32', '&.Mui-checked': { color: '#2e7d32' } }}
                              onChange={(e) => {
                                const newChecked = e.target.checked;
                                setExportProjectSelectedColumns(prev => ({
                                  ...prev,
                                  [field]: newChecked
                                }));
                                const allVals = { ...exportProjectSelectedColumns, [field]: newChecked };
                                setExportProjectSelectAll(Object.values(allVals).every(v => v));
                              }}
                            />
                            <Typography variant="body2" sx={{
                              fontSize: '13px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {label}
                            </Typography>
                          </Box>
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>

                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                  {Object.values(exportProjectSelectedColumns).filter(v => v).length} of{' '}
                  {Object.keys(exportProjectSelectedColumns).length} columns selected
                </Typography>
              </Box>
            </DialogContent>

            <DialogActions sx={{
              px: 3,
              py: 2,
              backgroundColor: '#f8f9fa',
              borderTop: '1px solid #e0e0e0',
              gap: 1
            }}>
              <Button
                variant="outlined"
                color="error"
                onClick={() => setExportProjectDialogOpen(false)}
                sx={{ textTransform: 'none', borderRadius: '8px' }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleExportProjectConfirm}
                disabled={
                  (exportProjectMode === 'NEW' && !exportProjectName.trim()) ||
                  (exportProjectMode === 'EXISTING' && !selectedExistingProject) ||
                  Object.values(exportProjectSelectedColumns).every(v => !v)
                }
                startIcon={<FolderOpenIcon />}
                sx={{
                  backgroundColor: '#e65100',
                  '&:hover': { backgroundColor: '#bf360c' },
                  textTransform: 'none',
                  borderRadius: '8px',
                  fontWeight: 600
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
    </Box>
  );
};

export default EnhancedDataEditor;
