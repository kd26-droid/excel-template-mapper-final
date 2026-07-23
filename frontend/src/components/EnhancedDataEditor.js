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
  Badge as BadgeIcon,
  Close as CloseIcon,
  Map as MapIcon,
  Refresh as RefreshIcon,
  Sync as SyncIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  DeleteSweep as DeleteSweepIcon,
  FolderOpen as FolderOpenIcon,
  AccountTree as AccountTreeIcon,
  Search as SearchIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  MoreVert as MoreVertIcon,
  Build as BuildIcon,
  VerifiedUser as VerifiedUserIcon,
  ContentCut as ContentCutIcon
} from '@mui/icons-material';
import api from '../services/api';
import * as XLSX from 'xlsx';
import FormulaBuilder from './FormulaBuilder';
import ColumnParser from './ColumnParser/ColumnParser';
import { getDataSynchronizer, cleanupSynchronizer } from '../utils/DataSynchronizer';

const EnhancedDataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const synchronizer = useRef(null);
  const scrollContainerRef = useRef(null);

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ inProgress: false, operation: null });
  const [syncProgress, setSyncProgress] = useState(0);
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
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
  const [mpnValidationCompleted, setMpnValidationCompleted] = useState(false);
  const [mpnFilterInvalidOnly, setMpnFilterInvalidOnly] = useState(false);
  const [showMpnColumns, setShowMpnColumns] = useState(true);
  const [mpnSplitting, setMpnSplitting] = useState(false);
  const [mpnSplitDialogOpen, setMpnSplitDialogOpen] = useState(false);
  const [manufacturerMatchDialogOpen, setManufacturerMatchDialogOpen] = useState(false);
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

  // Helper function to identify MPN validation columns
  const isMpnValidationColumn = useCallback((columnName) => {
    // DigiKey columns
    const digikeyColumns = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'Category'];
    // Mouser columns
    const mouserColumns = ['MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category'];

    return digikeyColumns.includes(columnName) ||
           mouserColumns.includes(columnName) ||
           columnName === 'Canonical MPN' ||
           /^Canonical MPN \d+$/.test(columnName) ||
           /^MPN_\d+_DigiKey_(Valid|Canonical|PN)$/.test(columnName);
  }, []);

  // Filter columns based on MPN visibility toggle
  const getVisibleColumnDefs = useCallback(() => {
    if (!columnDefs || !Array.isArray(columnDefs)) return [];

    return columnDefs.filter(col => {
      // Always show row number column
      if (col.field === '__row_number__') return true;

      // Filter MPN columns based on toggle - check both field and headerName
      if (isMpnValidationColumn(col.field) || isMpnValidationColumn(col.headerName)) {
        return showMpnColumns;
      }

      // Show all other columns
      return true;
    });
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

  // MPN column tooltip meanings
  const getMpnColumnTooltip = useCallback((columnName) => {
    const mpnTooltips = {
      // DigiKey columns
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
      'Mouser Category': 'Product category from Mouser'
    };

    // Handle numbered canonical MPN columns
    if (columnName === 'Canonical MPN' || /^Canonical MPN \d+$/.test(columnName)) {
      return 'Official manufacturer part number format (standardized) - Multiple options available';
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
      if (['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN'].includes(name)) return false;
      if (name === 'Canonical MPN' || /^Canonical MPN \d+$/.test(name)) return false;
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
      const nameRegex = /^Specification_Name_(\d+)$/;
      const valueRegex = /^Specification_Value_(\d+)$/;
      const hasBaseName = headers.includes('Specification name');
      const hasBaseValue = headers.includes('Specification value');

      const pairs = {};
      headers.forEach(h => {
        const nm = h.match(nameRegex);
        if (nm) {
          const idx = nm[1];
          pairs[idx] = pairs[idx] || { name: null, value: null };
          pairs[idx].name = h;
        }
        const vm = h.match(valueRegex);
        if (vm) {
          const idx = vm[1];
          pairs[idx] = pairs[idx] || { name: null, value: null };
          pairs[idx].value = h;
        }
      });

      const toRemove = new Set();

      Object.values(pairs).forEach(pair => {
        if (!pair.name || !pair.value) return;
        const allEmpty = rows.every(r => isCellEmpty(r[pair.name]) && isCellEmpty(r[pair.value]));
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

      if (toRemove.size === 0) return { headers, rows };

      const prunedHeaders = headers.filter(h => !toRemove.has(h));
      const prunedRows = rows.map(row => {
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
            headerName: /^MPN_\d+_DigiKey_Valid$/.test(col) ? col.replace(/^MPN_(\d+)_DigiKey_Valid$/, 'MPN $1 — DigiKey Valid')
                      : /^MPN_\d+_Canonical$/.test(col) ? col.replace(/^MPN_(\d+)_Canonical$/, 'MPN $1 — Canonical')
                      : (col.startsWith('Tag_') || col === 'Tag') ? 'Tag'
                      : (col.startsWith('Specification_Name_') || col === 'Specification name') ? 'Specification name'
                      : (col.startsWith('Specification_Value_') || col === 'Specification value') ? 'Specification value'
                      : (col.startsWith('Customer_Identification_Name_') || col === 'Customer identification name' || col === 'Custom identification name') ? 'Customer identification name'
                      : (col.startsWith('Customer_Identification_Value_') || col === 'Customer identification value' || col === 'Custom identification value') ? 'Customer identification value'
                      : col,
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
      setTotalRows(pg.total_rows || rows.length);
      setTotalPages(pg.total_pages || 1);
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
        const baseMpnValidationColumns = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'MPN valid (Mouser)', 'Mouser Status', 'MPNR'];
        const canonicalMpnColumns = viewHeaders.filter(header =>
          header === 'Canonical MPN' || /^Canonical MPN \d+$/.test(header) || header === 'Mouser Canonical MPN'
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
        ...viewHeaders.filter(col => col && col.trim() !== '').map((col, index) => {
          let displayName = col;
          if (/^MPN_\d+_DigiKey_Valid$/.test(col)) {
            displayName = col.replace(/^MPN_(\d+)_DigiKey_Valid$/, 'MPN $1 — DigiKey Valid');
          } else if (/^MPN_\d+_Canonical$/.test(col)) {
            displayName = col.replace(/^MPN_(\d+)_Canonical$/, 'MPN $1 — Canonical');
          } else if (col.startsWith('Tag_') || col === 'Tag') {
            displayName = 'Tag';
          } else if (col.startsWith('Specification_Name_') || col === 'Specification name') {
            displayName = 'Specification name';
          } else if (col.startsWith('Specification_Value_') || col === 'Specification value') {
            displayName = 'Specification value';
          } else if (col.startsWith('Customer_Identification_Name_') || col === 'Customer identification name' || col === 'Custom identification name') {
            displayName = 'Customer identification name';
          } else if (col.startsWith('Customer_Identification_Value_') || col === 'Customer identification value' || col === 'Custom identification value') {
            displayName = 'Customer identification value';
          }
          
          const isUnmapped = data.unmapped_columns && data.unmapped_columns.includes(displayName);
          const isSpecificationColumn = displayName.toLowerCase().includes('specification');
          const isFormulaColumn = detectedFormulaColumns.includes(col) || col.startsWith('Tag_') || col.startsWith('Specification_') || col.startsWith('Customer_Identification_') || col === 'Tag' || col.includes('Specification') || col.includes('Customer identification') || col.includes('Custom identification') || col === 'Factwise ID';
          const isMpnValidationColumn = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'MPN valid (Mouser)', 'Mouser Status', 'MPNR', 'Mouser Canonical MPN', 'Mouser Category', 'Category'].includes(col) ||
            col === 'Canonical MPN' || /^Canonical MPN \d+$/.test(col) || /^MPN_\d+_DigiKey_(Valid|Canonical|PN)$/.test(col);
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
                headerName: /^MPN_\d+_DigiKey_Valid$/.test(col) ? col.replace(/^MPN_(\d+)_DigiKey_Valid$/, 'MPN $1 — DigiKey Valid')
                            : /^MPN_\d+_Canonical$/.test(col) ? col.replace(/^MPN_(\d+)_Canonical$/, 'MPN $1 — Canonical')
                            : (col.startsWith('Tag_') || col === 'Tag') ? 'Tag'
                            : (col.startsWith('Specification_Name_') || col === 'Specification name') ? 'Specification name'
                            : (col.startsWith('Specification_Value_') || col === 'Specification value') ? 'Specification value'
                            : (col.startsWith('Customer_Identification_Name_') || col === 'Customer identification name' || col === 'Custom identification name') ? 'Customer identification name'
                            : (col.startsWith('Customer_Identification_Value_') || col === 'Customer identification value' || col === 'Custom identification value') ? 'Customer identification value'
                            : col,
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
  const handleOpenSaveTemplateDialog = useCallback(() => {
    setTemplateSaveDialogOpen(true);
  }, []);

  const handleCloseSaveTemplateDialog = useCallback(() => {
    setTemplateSaveDialogOpen(false);
    setTemplateName('');
  }, []);

  const handleSaveTemplateSynchronized = useCallback(async () => {
    if (!templateName.trim()) {
      showSnackbar('Please enter a template name', 'error');
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
        templateName.trim(),
        `Saved from Data Editor (${rules.length} tag rules${mpnValidationCompleted ? ', MPN validated' : ''})`,
        currentMappings,
        rules,
        currentFactwiseRules,
        Object.keys(defaults).length > 0 ? defaults : null,
        counts,
        mpnValidationMetadata
      );
      const elapsed = Date.now() - opStart;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      if (resp?.data?.success) {
        showSnackbar(`Template "${templateName.trim()}" saved successfully!`, 'success');
        handleCloseSaveTemplateDialog();
      } else {
        showSnackbar(resp?.data?.error || 'Failed to save template', 'error');
      }
    } catch (e) {
      showSnackbar('Failed to save template', 'error');
    } finally {
      setTemplateSaving(false);
    }
  }, [sessionId, templateName, dynamicColumnCounts, defaultValues, appliedFormulas, factwiseIdRule, mpnValidationCompleted, originalMpnColumn, mpnColumn, mpnManufacturerColumn, showSnackbar, handleCloseSaveTemplateDialog]);

  // ─── DOWNLOAD HANDLERS ─────────────────────────────────────────────────────
  const handleDownloadConverted = useCallback(async () => {
    try {
      setDownloadLoading(true);
      // Extract column order from current columnDefs (excluding row number column)
      const currentColumnOrder = columnDefs
        .filter(col => col.field && col.field !== '__row_number__')
        .map(col => col.field);


      await api.downloadFileEnhanced(sessionId, 'converted', null, currentColumnOrder);
    } catch (e) {
      showSnackbar(e.message || 'Failed to download converted file', 'error');
    } finally {
      setDownloadLoading(false);
    }
  }, [sessionId, showSnackbar, columnDefs]);

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
    setMpnSplitDialogOpen(true);
  }, []);

  const handleOpenManufacturerMatchDialog = useCallback(() => {
    setManufacturerMatchDialogOpen(true);
  }, []);

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
        const totalRowsAfterSplit = response.data.total_rows || response.data.created_rows || 0;
        if (splitRows > 0) {
          const normalized = response.data.normalized_mpns || 0;
          showSnackbar(`Split ${splitRows} rows into ${totalRowsAfterSplit} rows. Cleaned ${normalized} MPNs.`, 'success');
        } else {
          showSnackbar('No multi-MPN cells found in the selected column', 'info');
        }
        setMpnColumn(response.data.mpn_header || selectedHeader);
        await fetchDataSynchronized();
      } else {
        showSnackbar(response.data?.error || 'Failed to split MPN cells', 'error');
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Failed to split MPN cells';
      showSnackbar(message, 'error');
    } finally {
      setMpnSplitting(false);
    }
  }, [columnDefs, mpnColumn, mpnManufacturerColumn, detectMpnColumn, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized]);

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
        const totalRowsAfterSplit = response.data.total_rows || response.data.created_rows || 0;
        const paired = response.data.paired_manufacturer_rows || 0;
        if (splitRows > 0) {
          showSnackbar(`Split ${splitRows} rows into ${totalRowsAfterSplit} rows and paired ${paired} manufacturers.`, 'success');
        } else {
          showSnackbar('No multi-MPN cells found in the selected column', 'info');
        }
        setMpnColumn(response.data.mpn_header || selectedHeader);
        await fetchDataSynchronized();
      } else {
        showSnackbar(response.data?.error || 'Failed to match manufacturers', 'error');
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Failed to match manufacturers';
      showSnackbar(message, 'error');
    } finally {
      setMpnSplitting(false);
    }
  }, [columnDefs, mpnColumn, mpnManufacturerColumn, detectMpnColumn, sessionId, buildMpnSplitOptionsPayload, showSnackbar, fetchDataSynchronized]);

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

  const handleCellEdit = useCallback((rowIndex, colIndex, newValue) => {
    const newRowData = [...rowData];
    const colKey = columnDefs[colIndex]?.field;
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
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center',
        minHeight: '60vh',
        gap: 2
      }}>
        <CircularProgress size={60} thickness={4} />
        <Typography variant="h6" color="text.secondary">
          {syncStatus.inProgress ? `${syncStatus.operation}...` : 'Loading your mapped data...'}
        </Typography>
        {syncStatus.inProgress && (
          <Typography variant="body2" color="text.secondary">
            <SyncIcon sx={{ fontSize: 16, mr: 1 }} />
            Synchronizing data with backend...
          </Typography>
        )}
        {dataIntegrity.lastValidated && (
          <Typography variant="body2" color="text.secondary">
            Last validated: {new Date(dataIntegrity.lastValidated).toLocaleTimeString()}
          </Typography>
        )}
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
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#f8fafc' }}>
      {syncNotice.visible && (
        <Box sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1100,
          bgcolor: '#fffbe6',
          borderBottom: '1px solid #ffe58f',
          color: '#ad8b00',
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {syncNotice.message}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button size="small" variant="outlined" onClick={fetchDataSynchronized} startIcon={<RefreshIcon />}>Refresh now</Button>
            <IconButton size="small" onClick={() => setSyncNotice(prev => ({ ...prev, visible: false }))}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      )}
      
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
            <strong>{cleanupInfo.rows_deleted} row{cleanupInfo.rows_deleted !== 1 ? 's' : ''} removed</strong> — column "{cleanupInfo.primary_column}" was empty ({cleanupInfo.total_rows_before} → {cleanupInfo.total_rows_after} rows)
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
        elevation={3}
        sx={{
          borderRadius: 0,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          position: 'sticky',
          top: 0,
          zIndex: 1000
        }}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 4 } }}>
          <Box sx={{ 
            py: 3,
            display: 'flex', 
            flexDirection: 'column',
            gap: 3
          }}>
            
            {/* Top Row - Back Arrow, Title, and Status */}
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              
              {/* Left - Back Arrow */}
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <IconButton
                  onClick={handleBackToMapping}
                  sx={{ 
                    color: 'white',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' }
                  }}
                >
                  <ArrowBackIcon />
                </IconButton>
              </Box>

              {/* Center - Title */}
              <Box sx={{ textAlign: 'center', flex: 1 }}>
                <Typography variant="h4" fontWeight="700" sx={{ lineHeight: 1.2 }}>
                  Enhanced Data Editor
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.9rem' }}>
                  Real-time synchronized editing with Azure deployment support
                </Typography>
              </Box>

              {/* Right - Status and Actions */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {/* Data Integrity Status */}
                {dataIntegrity.consistent ? (
                  <Tooltip title="Data is synchronized and consistent">
                    <CheckCircleIcon sx={{ color: '#4caf50' }} />
                  </Tooltip>
                ) : (
                  <Tooltip title="Data integrity issues detected">
                    <ErrorIcon sx={{ color: '#ff9800' }} />
                  </Tooltip>
                )}
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', mx: 1 }}>v{sessionVersion}</Typography>
                
              {/* Auto-fit All */}
              <Tooltip title="Auto-fit all columns to content">
                <span>
                  <Button
                    size="small"
                    onClick={handleAutoFitAll}
                    disabled={syncStatus.inProgress}
                    sx={{ 
                      color: 'white',
                      borderColor: 'rgba(255,255,255,0.6)',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' },
                      '&:disabled': { 
                        color: 'rgba(255,255,255,0.5)',
                        backgroundColor: 'rgba(255,255,255,0.05)'
                      }
                    }}
                    variant="outlined"
                  >
                    Auto‑fit All
                  </Button>
                </span>
              </Tooltip>

              {/* Manual Refresh */}
              <Tooltip title="Manual refresh with synchronization">
                <IconButton
                  onClick={handleManualRefresh}
                  disabled={syncStatus.inProgress}
                  sx={{ 
                    color: 'white',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' },
                    '&:disabled': { 
                      color: 'rgba(255,255,255,0.5)',
                      backgroundColor: 'rgba(255,255,255,0.05)'
                    }
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              {/* Rebuild Columns */}
              <Tooltip title="Rebuild template columns">
                <span>
                  <Button
                    size="small"
                    onClick={handleRebuildColumns}
                    disabled={rebuildingColumns || syncStatus.inProgress}
                    sx={{
                      color: 'white',
                      borderColor: 'rgba(255,255,255,0.6)',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      ml: 1,
                      textTransform: 'none',
                      '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' }
                    }}
                  >
                    {rebuildingColumns ? 'Rebuilding…' : 'Rebuild Columns'}
                  </Button>
                </span>
              </Tooltip>
              </Box>
            </Box>

            {/* Second Row - Clean Grouped Action Bar */}
            <Box sx={{
              display: 'flex',
              gap: 1.5,
              justifyContent: 'center',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              {/* PRIMARY: Download File */}
              <Button
                onClick={handleDownloadConverted}
                variant="contained"
                startIcon={<DownloadIcon />}
                disabled={downloadLoading || syncStatus.inProgress}
                sx={{
                  backgroundColor: '#1565c0',
                  color: 'white',
                  '&:hover': { backgroundColor: '#0d47a1' },
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2.5
                }}
              >
                Download
              </Button>

              {/* PRIMARY: Export to Project */}
              <Button
                onClick={handleExportToProject}
                variant="contained"
                startIcon={<FolderOpenIcon />}
                disabled={downloadLoading || syncStatus.inProgress}
                sx={{
                  backgroundColor: '#e65100',
                  color: 'white',
                  '&:hover': { backgroundColor: '#bf360c' },
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2.5
                }}
              >
                Export to Project
              </Button>

              <Button
                onClick={handleOpenManufacturerMatchDialog}
                variant="contained"
                startIcon={<AccountTreeIcon />}
                disabled={mpnSplitting || syncStatus.inProgress}
                sx={{
                  backgroundColor: '#00796b',
                  color: 'white',
                  '&:hover': { backgroundColor: '#004d40' },
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2.5
                }}
              >
                Manufacturer Match
              </Button>

              {/* Divider */}
              <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.3)', mx: 0.5 }} />

              {/* TOOLS dropdown */}
              <Button
                onClick={(e) => setToolsMenuAnchor(e.currentTarget)}
                variant="outlined"
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={<BuildIcon />}
                sx={{
                  color: 'white',
                  borderColor: 'rgba(255,255,255,0.5)',
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'white' },
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px'
                }}
              >
                Tools
              </Button>
              <Menu
                anchorEl={toolsMenuAnchor}
                open={Boolean(toolsMenuAnchor)}
                onClose={() => setToolsMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '10px', mt: 1, minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } }}
              >
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenFormulaBuilder(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><AutoAwesomeIcon sx={{ color: '#9c27b0' }} /></ListItemIcon>
                  <ListItemText>Add Tags</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); setColumnParserOpen(true); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><AutoAwesomeIcon sx={{ color: '#0891b2' }} /></ListItemIcon>
                  <ListItemText>Parse Column</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleOpenMpnSplitDialog} disabled={syncStatus.inProgress || mpnSplitting}>
                  <ListItemIcon>
                    {mpnSplitting ? <CircularProgress size={18} /> : <ContentCutIcon sx={{ color: '#f57c00' }} />}
                  </ListItemIcon>
                  <ListItemText>{mpnSplitting ? 'Splitting MPNs...' : 'Split MPN Cells'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenFactwiseIdDialog(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><BadgeIcon sx={{ color: '#2e7d32' }} /></ListItemIcon>
                  <ListItemText>Create FactWise ID</ListItemText>
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { setToolsMenuAnchor(null); handleOpenSaveTemplateDialog(); }} disabled={syncStatus.inProgress}>
                  <ListItemIcon><TemplateIcon sx={{ color: '#6a1b9a' }} /></ListItemIcon>
                  <ListItemText>Save Template</ListItemText>
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
                startIcon={mpnValidating ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <VerifiedUserIcon />}
                sx={{
                  color: 'white',
                  borderColor: mpnValidationCompleted ? '#4caf50' : 'rgba(255,255,255,0.5)',
                  backgroundColor: mpnValidationCompleted ? 'rgba(76,175,80,0.15)' : 'transparent',
                  '&:hover': { backgroundColor: mpnValidationCompleted ? 'rgba(76,175,80,0.25)' : 'rgba(255,255,255,0.1)', borderColor: 'white' },
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: '8px'
                }}
              >
                MPN
              </Button>
              <Menu
                anchorEl={mpnMenuAnchor}
                open={Boolean(mpnMenuAnchor)}
                onClose={() => setMpnMenuAnchor(null)}
                PaperProps={{ sx: { borderRadius: '10px', mt: 1, minWidth: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } }}
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
                            {col.headerName || col.field}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                </Box>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem
                  onClick={async () => {
                    setMpnMenuAnchor(null);
                    try {
                      if (!mpnColumn) return;
                      if (!originalMpnColumn && !isMpnValidationColumn(mpnColumn)) {
                        setOriginalMpnColumn(mpnColumn);
                      }
                      setMpnValidating(true);
                      await api.validateMPNs(sessionId, mpnColumn, mpnManufacturerColumn);
                      await fetchDataSynchronized();
                      setShowMpnColumns(true);
                      setMpnValidationCompleted(true);
                      showSnackbar('MPN validation complete', 'success');
                    } catch (e) {
                      const msg = e?.response?.data?.error || e.message || 'Unknown error';
                      if (e?.response?.status === 403) {
                        showSnackbar('MPN validation not configured. Complete Digi-Key setup on server.', 'error');
                      } else {
                        showSnackbar(`MPN validation failed: ${msg}`, 'error');
                      }
                    } finally {
                      setMpnValidating(false);
                    }
                  }}
                  disabled={!mpnColumn || mpnValidating || syncStatus.inProgress}
                >
                  <ListItemIcon><CheckIcon sx={{ color: '#f57c00' }} /></ListItemIcon>
                  <ListItemText>{mpnValidating ? 'Validating MPNs...' : 'Validate MPNs'}</ListItemText>
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
                      sx={{
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.5)',
                        borderRadius: '8px',
                        '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' }
                      }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Tooltip>
                  <Menu
                    anchorEl={moreMenuAnchor}
                    open={Boolean(moreMenuAnchor)}
                    onClose={() => setMoreMenuAnchor(null)}
                    PaperProps={{ sx: { borderRadius: '10px', mt: 1, minWidth: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } }}
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
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)', mb: 1 }}>
                  Validating MPNs with Digi-Key and Mouser. This can take a few minutes...
                </Typography>
                <LinearProgress
                  variant="indeterminate"
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: '#4caf50',
                      borderRadius: 3
                    }
                  }}
                />
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', mt: 1, display: 'block' }}>
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
            elevation={1}
            sx={{
              p: 3,
              mb: 2,
              border: '1px solid #e3f2fd',
              borderRadius: 2,
              background: 'linear-gradient(135deg, #e3f2fd 0%, #f8f9fa 100%)'
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#1976d2' }}>
                Column Quality
              </Typography>
              <IconButton
                size="small"
                onClick={() => setShowQualityPanel(false)}
                sx={{ color: '#666' }}
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
      <Box sx={{ flexGrow: 1, p: 2, overflow: 'hidden' }}>
        <Paper 
          elevation={2} 
          sx={{ 
            height: '100%', 
            overflow: 'auto',
            borderRadius: 2,
            border: '1px solid #e0e0e0'
          }}
          ref={scrollContainerRef}
        >
          <Box sx={{ p: 2 }}>
            {/* Top pagination controls */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">Rows per page</Typography>
                <Select size="small" value={pageSize} onChange={(e) => { const v = parseInt(e.target.value, 10); setPage(1); setPageSize(v); fetchPageData(1, v); }}>
                  {[50,100,200,500,1000,2000,3000].map(sz => <MenuItem key={sz} value={sz}>{sz}</MenuItem>)}
                </Select>
                <Typography variant="body2" color="text.secondary">
                  Total: {totalRows.toLocaleString()} | Showing {((page - 1) * pageSize + 1).toLocaleString()}-{Math.min(page * pageSize, totalRows).toLocaleString()}
                </Typography>
              </Box>
              <Pagination count={Math.max(1, totalPages)} page={page} onChange={(_, p) => { setPage(p); fetchPageData(p, pageSize); }} color="primary" size="small" shape="rounded" />
            </Box>
            {pageLoading && <LinearProgress sx={{ mb: 1 }} />}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ 
                width: '100%', 
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
                fontSize: '14px',
                fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif'
              }}>
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
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
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
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontWeight: 600,
                          color: '#2c3e50',
                          border: '1px solid #e9ecef',
                          backgroundColor: '#f8f9fa',
                          position: 'relative',
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
                                      color: '#666',
                                      cursor: 'help',
                                      ml: 0.5,
                                      '&:hover': { color: '#1976d2' }
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
                  {rowData
                    .filter(row => {
                      if (!mpnFilterInvalidOnly) return true;
                      const mv = row['MPN valid'];
                      return String(mv || '').toLowerCase() === 'no';
                    })
                    .map((row, realIndex) => {
                    // Neutral zebra striping; no quality-based highlighting
                    const rowBackgroundColor = realIndex % 2 === 0 ? '#f8f9fa' : 'white';

                    return (
                      <tr key={realIndex} style={{
                        backgroundColor: rowBackgroundColor,
                        height: `${rowHeight}px`
                      }}>
                        {getVisibleColumnDefs().map((col, colIndex) => {
                          const raw = row[col.field];
                          const cellValue = raw == null ? '' : String(raw);
                          const isUnknown = cellValue.toLowerCase() === 'unknown';
                          const isInvalidMpn = (mpnColumn && col.field === mpnColumn && String(row['MPN valid'] || '').toLowerCase() === 'no');
                          return (
                            <td key={`${col.field}-${realIndex}`} style={{
                              padding: '12px 16px',
                              border: '1px solid #e9ecef',
                              backgroundColor: isUnknown ? '#ffebee' : 'inherit',
                              color: isInvalidMpn ? '#d32f2f' : (isUnknown ? '#c62828' : 'inherit'),
                              fontWeight: isInvalidMpn ? '700' : (isUnknown ? '500' : 'normal'),
                              width: `${columnWidths[col.field] || (col.field === '__row_number__' ? 80 : 180)}px`
                            }}>
                              {col.field === 'datasheet' && cellValue.startsWith('http') ? (
                                <a href={cellValue} target="_blank" rel="noopener noreferrer">{cellValue}</a>
                              ) : (
                                <input
                                  type="text"
                                  value={cellValue}
                                  onChange={(e) => handleCellEdit(realIndex, colIndex, e.target.value)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    width: '100%',
                                    fontSize: 'inherit',
                                    fontFamily: 'inherit',
                                    color: 'inherit',
                                    fontWeight: 'inherit',
                                    outline: 'none'
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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

      {/* MPN Split Dialog */}
      <Dialog open={mpnSplitDialogOpen} onClose={() => setMpnSplitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Split MPN Cells</DialogTitle>
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
                    {col.headerName || col.field}
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
          <Typography variant="h6" fontWeight={700}>Manufacturer Match</Typography>
          <Typography variant="body2" color="text.secondary">
            Match split MPN rows to canonical manufacturers from a directory.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ border: '1px solid #e5e7eb', borderRadius: 1, p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                Target column
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>Manufacturer Column to Update</InputLabel>
                <Select
                  label="Manufacturer Column to Update"
                  value={mpnManufacturerColumn || ''}
                  onChange={(e) => setMpnManufacturerColumn(e.target.value || null)}
                >
                  {columnDefs
                    .filter(col => col.field && col.field !== '__row_number__')
                    .map(col => (
                      <MenuItem key={col.field} value={col.field}>
                        {col.headerName || col.field}
                      </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Uses the selected MPN column from MPN tools, or auto-detects one. Empty MPN cells are skipped.
              </Typography>
            </Box>

            <Box sx={{ border: '1px solid #e5e7eb', borderRadius: 1, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Manufacturer directory
                  </Typography>
                  {manufacturerDirectory.fileName && (
                    <Typography variant="caption" color="text.secondary">
                      {manufacturerDirectory.fileName}
                    </Typography>
                  )}
                </Box>
                <Button variant="outlined" component="label" size="small">
                  Upload Directory
                  <input
                    type="file"
                    hidden
                    accept=".xlsx,.xls,.csv"
                    onChange={handleManufacturerDirectoryUpload}
                  />
                </Button>
              </Box>

              {manufacturerDirectory.fileName ? (
                <Grid container spacing={1.5}>
                  <Grid item xs={12} sm={8}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Directory Sheet</InputLabel>
                      <Select
                        label="Directory Sheet"
                        value={manufacturerDirectory.sheetName}
                        onChange={(e) => updateManufacturerDirectorySheet(e.target.value)}
                      >
                        {manufacturerDirectory.sheetNames.map(sheet => (
                          <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Header Row"
                      value={manufacturerDirectory.headerRow}
                      onChange={(e) => updateManufacturerDirectoryHeaderRow(e.target.value)}
                      inputProps={{ min: 1 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Manufacturer Name Column</InputLabel>
                      <Select
                        label="Manufacturer Name Column"
                        value={manufacturerDirectory.nameColumn}
                        onChange={(e) => setManufacturerDirectory(prev => ({ ...prev, nameColumn: e.target.value, synonymColumns: prev.synonymColumns.filter(column => column !== e.target.value) }))}
                      >
                        {manufacturerDirectory.headers.map(header => (
                          <MenuItem key={header} value={header}>{header}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Synonym Columns</InputLabel>
                      <Select
                        multiple
                        label="Synonym Columns"
                        value={manufacturerDirectory.synonymColumns}
                        onChange={(e) => {
                          const value = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                          setManufacturerDirectory(prev => ({ ...prev, synonymColumns: value.filter(column => column !== prev.nameColumn) }));
                        }}
                        renderValue={(selected) => selected.length ? `${selected.length} selected` : 'None'}
                      >
                        {manufacturerDirectory.headers
                          .filter(header => header !== manufacturerDirectory.nameColumn)
                          .map(header => (
                            <MenuItem key={header} value={header}>
                              <Checkbox checked={manufacturerDirectory.synonymColumns.includes(header)} />
                              {header}
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={applyManufacturerDirectoryRules}
                      disabled={!manufacturerDirectory.nameColumn}
                    >
                      Apply Directory Rules
                    </Button>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Upload a manufacturer master to preserve names like NIC COMPONENTS and map synonyms to canonical manufacturers.
                </Alert>
              )}
            </Box>

            <Box sx={{ border: '1px solid #e5e7eb', borderRadius: 1, p: 1.5 }}>
              <Button
                size="small"
                disabled={!manufacturerDirectory.fileName}
                onClick={() => setManufacturerRulesExpanded(prev => !prev)}
              >
                {manufacturerRulesExpanded ? 'Hide advanced rules' : 'View advanced rules'}
              </Button>
              {!manufacturerDirectory.fileName && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  Upload a directory first
                </Typography>
              )}
              <Collapse in={manufacturerRulesExpanded}>
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={6}
                      label="Aliases"
                      value={mpnSplitOptions.manufacturerAliases}
                      onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, manufacturerAliases: e.target.value }))}
                      helperText="Use SOURCE=TARGET. Empty target discards the source."
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={6}
                      label="Discard Tokens"
                      value={mpnSplitOptions.manufacturerDiscardTokens}
                      onChange={(e) => setMpnSplitOptions(prev => ({ ...prev, manufacturerDiscardTokens: e.target.value }))}
                      helperText="One per line or comma separated."
                    />
                  </Grid>
                </Grid>
              </Collapse>
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
            disabled={mpnSplitting || !mpnColumn || !mpnManufacturerColumn}
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
          <Button onClick={handleSaveTemplateSynchronized} variant="contained" disabled={templateSaving}>
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
                      const display = truncated ? `${displayName} (${truncated})` : `${displayName} (Empty)`;
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
                      const display = truncated ? `${displayName} (${truncated})` : `${displayName} (Empty)`;
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
            <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Preview: {firstColumn} + "{operator}" + {secondColumn} = "FactWise ID"
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Example: "A123" + "{operator}" + "XYZ" = "A123{operator}XYZ"
              </Typography>
            </Box>
          )}

          {factwiseGenerationMode === 'serial' && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Preview: {(factwiseSerialPrefix || '')}{String(Number(factwiseSerialStart) || 1).padStart(Math.max(0, Number(factwiseSerialPadding) || 0), '0')}
                {factwiseSerialIncrement ? `, ${(factwiseSerialPrefix || '')}${String((Number(factwiseSerialStart) || 1) + 1).padStart(Math.max(0, Number(factwiseSerialPadding) || 0), '0')}` : ' for every row'}
              </Typography>
            </Box>
          )}

          <Alert severity="info" sx={{ mt: 2 }}>
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
        autoHideDuration={6000}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
          onClose={closeSnackbar} 
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EnhancedDataEditor;
