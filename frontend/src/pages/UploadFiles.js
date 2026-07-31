import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import LoaderOverlay, { useGlobalBlock } from '../components/LoaderOverlay';
import {
  Typography,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Box,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  Container,
  IconButton,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Radio,
  RadioGroup,
  Snackbar,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import {
  CloudUpload as CloudUploadIcon,
  LibraryBooks as LibraryBooksIcon,
  CheckCircle as CheckCircleIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  PlayArrow as PlayArrowIcon,
  Warning as WarningIcon,
  UploadFile as UploadFileIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Science as ScienceIcon,
  Add as AddIcon
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import api, { setGlobalLoaderCallback } from '../services/api';
import { useThemeContext } from '../utils/ThemeContext';

const IST_TIME_ZONE = 'Asia/Kolkata';

const parseHistoryDate = (value) => {
  if (!value) return null;
  const raw = String(value);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const date = new Date(hasTimezone ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatIstDateTime = (value, options = {}) => {
  const date = parseHistoryDate(value);
  if (!date) return 'Unknown time';
  return date.toLocaleString('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options
  });
};

// Vendor item templates (e.g. FactWise "Default Item.xlsx") keep help text and
// "Required / Optional" hints in the rows above the real header row, so the
// header row is often not row 1. Score the first few rows and pick the one that
// actually looks like column labels instead of assuming row 1.
const HEADER_SCAN_ROWS = 12;

const normalizeRowCells = (row = []) =>
  row.map(cell => (cell === null || cell === undefined ? '' : String(cell).trim()));

const scoreHeaderRow = (row = []) => {
  const filled = normalizeRowCells(row).filter(cell => cell !== '');
  if (filled.length === 0) return Number.NEGATIVE_INFINITY;

  const count = filled.length;
  const avgLength = filled.reduce((sum, cell) => sum + cell.length, 0) / count;
  const longCells = filled.filter(cell => cell.length > 60).length;
  const proseCells = filled.filter(cell => /[.!?](\s|$)/.test(cell) || cell.split(/\s+/).length > 8).length;
  const numericCells = filled.filter(cell => !Number.isNaN(Number(cell.replace(/,/g, '')))).length;
  const uniqueRatio = new Set(filled.map(cell => cell.toLowerCase())).size / count;

  return (
    count * 2                          // wide rows are more likely to be the header
    - (longCells / count) * 40         // help text is long
    - (proseCells / count) * 30        // help text reads like sentences
    - (numericCells / count) * 25      // numbers mean this is a data row
    - Math.max(0, avgLength - 30) * 0.6
    + uniqueRatio * 10                 // column labels are mostly distinct
  );
};

const readSheetRows = (workbook, sheetName) => {
  if (!workbook || !sheetName || !workbook.Sheets || !workbook.Sheets[sheetName]) return [];
  const ws = workbook.Sheets[sheetName];
  const opts = { header: 1, raw: false, defval: '', blankrows: true };
  // Force reading from literal row A1 so a blank leading row is INCLUDED. Excel's
  // used-range can start at row 2, which makes XLSX drop the blank row 1 — then
  // the frontend's row numbers no longer match the backend (pandas), which counts
  // that blank row. Anchoring at A1 keeps both sides on the same row numbering.
  try {
    if (ws['!ref']) {
      const r = XLSX.utils.decode_range(ws['!ref']);
      if (r.s.r > 0 || r.s.c > 0) {
        r.s.r = 0;
        r.s.c = 0;
        opts.range = XLSX.utils.encode_range(r);
      }
    }
  } catch (_) { /* fall back to default range */ }
  return XLSX.utils.sheet_to_json(ws, opts);
};

// Returns a 1-based row number, matching the "Header Row" field.
const detectHeaderRow = (workbook, sheetName) => {
  const rows = readSheetRows(workbook, sheetName).slice(0, HEADER_SCAN_ROWS);
  let bestRow = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestRow = index;
    }
  });

  return bestRow + 1;
};

const readHeadersAtRow = (workbook, sheetName, headerRow) => {
  const rows = readSheetRows(workbook, sheetName);
  const row = rows[Math.max(0, (Number(headerRow) || 1) - 1)];
  return row ? normalizeRowCells(row).filter(cell => cell !== '') : [];
};

// Stack several same-layout sheets into one sheet and return it as an .xlsx File.
// The first selected sheet's header is canonical; each sheet's rows are aligned to
// it by column NAME (so column-order differences are tolerated). The combined
// sheet always has its header on row 1, so it uploads like any normal single sheet.
const buildCombinedSheetFile = (workbook, sheetNames, headerRow, fileName) => {
  const hr = Math.max(1, Number(headerRow) || 1);
  let canonical = null;
  const dataRows = [];
  (sheetNames || []).forEach((sheet) => {
    const rows = readSheetRows(workbook, sheet);
    if (!rows || rows.length < hr) return;
    const header = (rows[hr - 1] || []).map((c) => String(c ?? '').trim());
    if (!canonical) canonical = header.slice();
    const idxByName = {};
    header.forEach((name, i) => { if (name && !(name in idxByName)) idxByName[name] = i; });
    for (let r = hr; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (row.every((c) => String(c ?? '').trim() === '')) continue; // skip blank lines
      dataRows.push(canonical.map((name) => {
        const si = idxByName[name];
        return si === undefined ? '' : (row[si] ?? '');
      }));
    }
  });
  if (!canonical) return null;
  const ws = XLSX.utils.aoa_to_sheet([canonical, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Combined');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const base = String(fileName || 'combined').replace(/\.(xlsx|xls|csv)$/i, '');
  return { file: new File([blob], `${base} (combined).xlsx`, { type: blob.type }), rows: dataRows.length };
};


const DropzoneFileStackIcon = ({ color = "#3b82f6", glowColor = "#22c55e", selected = false, isHovered = false, isDarkMode = true }) => {
  const cardBg = isDarkMode ? "#0f172a" : "#ffffff";
  const backCardBg = isDarkMode ? "#1e293b" : "#f8fafc";
  const strokeColor = isDarkMode ? "rgba(255,255,255,0.28)" : "rgba(15,23,42,0.16)";
  const cornerFill = isDarkMode ? "rgba(255,255,255,0.12)" : "rgba(37,99,235,0.08)";
  const lineMuted = isDarkMode ? "#94a3b8" : "#64748b";

  return (
    <Box sx={{ position: "relative", width: 130, height: 86, mx: "auto", mb: 1.5, display: "flex", justifyContent: "center", alignItems: "center", overflow: "visible" }}>
      {/* Glow Blur Circle */}
      <Box
        sx={{
          position: "absolute",
          width: isHovered ? 110 : 84,
          height: isHovered ? 78 : 56,
          borderRadius: "50%",
          background: selected
            ? `radial-gradient(circle, ${color}dd 0%, transparent 70%)`
            : `radial-gradient(circle, ${glowColor}bb 0%, transparent 70%)`,
          filter: isHovered ? "blur(22px)" : "blur(15px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 0,
          transition: "all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }}
      />
      <svg width="120" height="84" viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: "relative", zIndex: 1, overflow: "visible" }}>
        {/* Left Checkmark Card - fans out on hover */}
        <g style={{
          transform: isHovered ? "translate(12px, 16px) rotate(-16deg)" : "translate(40px, 10px) rotate(0deg)",
          opacity: isHovered ? 0.95 : 0.4,
          transition: "all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          transformOrigin: "bottom center"
        }}>
          <rect x="0" y="0" width="34" height="46" rx="6" fill={backCardBg} stroke={strokeColor} strokeWidth="1.5" />
          <path d="M10 22L15 27L24 18" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Right Lines Card - fans out on hover */}
        <g style={{
          transform: isHovered ? "translate(68px, 18px) rotate(16deg)" : "translate(40px, 10px) rotate(0deg)",
          opacity: isHovered ? 0.95 : 0.4,
          transition: "all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
          transformOrigin: "bottom center"
        }}>
          <rect x="0" y="0" width="34" height="46" rx="6" fill={backCardBg} stroke={strokeColor} strokeWidth="1.5" />
          <line x1="8" y1="14" x2="26" y2="14" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="22" x2="22" y2="22" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="30" x2="18" y2="30" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
        </g>
        {/* Main Center Arrow Card */}
        <g style={{
          transform: isHovered ? "translate(40px, 4px)" : "translate(40px, 10px)",
          transition: "all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)"
        }}>
          <rect x="0" y="0" width="40" height="54" rx="7" fill={cardBg} stroke={selected || isHovered ? color : strokeColor} strokeWidth="2" />
          <path d="M28 0V12H40" fill={cornerFill} stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="20" cy="30" r="11" fill="rgba(37, 99, 235, 0.25)" stroke={color} strokeWidth="1.5" />
          <path d="M20 35V25M20 25L16 29M20 25L24 29" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </Box>
  );
};

const UploadFiles = () => {
  const { isDarkMode, tokens: a } = useThemeContext();
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const Nn = {
    pageBg: a.background.app,
    modalBg: a.surface.elevatedGradient,
    modalBgSoft: a.surface.elevatedSoftGradient,
    modalBorder: a.border.modal,
    modalShadow: a.shadow.modal,
    text: a.text.primary,
    muted: a.text.secondary,
    divider: a.border.subtle,
    inputBg: a.surface.inputStrong,
    inputBorder: a.border.input,
    inputBorderHover: a.border.hover,
    tableBg: a.table.background,
    tableHeaderBg: a.table.header,
    tableText: a.text.table,
    tableHeaderText: a.text.heading,
    tableBorder: a.table.line,
    footerBg: a.surface.footer,
    infoBg: a.state.infoBg,
    infoText: a.color.infoText,
    backdrop: a.overlay.backdrop,
    cardBg: a.surface.cardGradient,
    cardBorder: a.border.default,
    dropzoneBg: a.dropzone.background,
    dropzoneSelectedBg: a.dropzone.selected,
    dropzoneActiveBg: a.dropzone.active,
    panelBg: a.surface.panel,
    panelBorder: a.border.panelAccent,
    subtlePanelBg: a.surface.subtle,
    whiteButtonBg: a.surface.paper,
    whiteButtonHoverBg: a.surface.elevated,
    whiteButtonText: a.color.dark,
    accent: a.border.focus,
    accentHover: a.color.primaryLight
  };

  const sheetJoinDraftDbName = 'excel-template-mapper-drafts';
  const sheetJoinDraftStoreName = 'files';
  const sheetJoinBomDraftKey = 'sheet-join-bom-draft';
  const sheetJoinComparisonListKey = 'sheet-join-comparison-history';
  const [globalLoading, setGlobalLoading] = useState(false);
  useGlobalBlock(globalLoading);
  
  // Setup global loader callback
  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);
  
  const [wizardStep, setWizardStep] = useState(0);
  const [isUserHovered, setIsUserHovered] = useState(false);
  const [isTemplateHovered, setIsTemplateHovered] = useState(false);
  const [showAllSourceColumns, setShowAllSourceColumns] = useState(false);
  const [showAllTemplateColumns, setShowAllTemplateColumns] = useState(false);
  const [userFile, setUserFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Client file sheet/header state
  const [clientSheetNames, setClientSheetNames] = useState([]);
  const [selectedClientSheet, setSelectedClientSheet] = useState('');
  // Multi-sheet combine: when a workbook has several same-layout sheets (e.g. one
  // per BOM), stack them into a single dataset and map once.
  const [combineSheetsMode, setCombineSheetsMode] = useState(false);
  const [selectedClientSheets, setSelectedClientSheets] = useState([]);
  const [clientHeaderRow, setClientHeaderRow] = useState(1);
  const [clientWorkbook, setClientWorkbook] = useState(null);
  const [clientHeaderPreview, setClientHeaderPreview] = useState([]);
  const [clientHeaderAutoDetected, setClientHeaderAutoDetected] = useState(false);

  // Template file state
  const [templateFile, setTemplateFile] = useState(null);
  const [templateSheetNames, setTemplateSheetNames] = useState([]);
  const [selectedTemplateSheet, setSelectedTemplateSheet] = useState('');
  const [templateHeaderRow, setTemplateHeaderRow] = useState(1);
  const [templateWorkbook, setTemplateWorkbook] = useState(null);
  const [templateHeaderPreview, setTemplateHeaderPreview] = useState([]);
  const [templateHeaderAutoDetected, setTemplateHeaderAutoDetected] = useState(false);

  // Template selection state
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  
  // Template compatibility error modal state
  const [compatibilityErrorOpen, setCompatibilityErrorOpen] = useState(false);
  const [compatibilityErrorData, setCompatibilityErrorData] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  
  // Formula rules state (for tag templates)
  const [formulaRules, setFormulaRules] = useState([]);

  // Tag Templates state
  const [availableTagTemplates, setAvailableTagTemplates] = useState([]);
  const [selectedTagTemplate, setSelectedTagTemplate] = useState(null);
  const [tagTemplatesLoading, setTagTemplatesLoading] = useState(false);
  const [tagTemplateSearchTerm, setTagTemplateSearchTerm] = useState('');

  // PDF alignment state - Use 'align' to keep exact headers AND align rows across pages
  // 'align' = align rows from different pages to same row level + keep original headers (MFR stays MFR)
  // 'preserve' = append rows sequentially (page 1 rows, then page 2 rows, etc.) + keep original headers
  // 'flatten' = align rows across pages + rename headers (MFR → Manufacturer)
  const pdfDataAlignment = 'preserve';

  // PDF processing choice dialog state
  const [pdfChoiceDialogOpen, setPdfChoiceDialogOpen] = useState(false);
  const [pendingPdfSessionId, setPendingPdfSessionId] = useState(null);

  // Primary column cleanup dialog state
  const [primaryColumnDialogOpen, setPrimaryColumnDialogOpen] = useState(false);
  const [primaryColumnSessionId, setPrimaryColumnSessionId] = useState(null);
  const [primaryColumnHeaders, setPrimaryColumnHeaders] = useState([]);
  const [selectedPrimaryColumn, setSelectedPrimaryColumn] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [pendingNavigateState, setPendingNavigateState] = useState(null);

  // Optional same-workbook sheet join state
  const [sheetJoinDialogOpen, setSheetJoinDialogOpen] = useState(false);
  const [sheetJoinSetup, setSheetJoinSetup] = useState(null);
  const [sheetJoinConfig, setSheetJoinConfig] = useState({
    baseSheet: '',
    detailSheet: '',
    baseHeaderRow: 1,
    detailHeaderRow: 1,
    baseKey: '',
    detailKey: '',
    relationshipName: '',
    outputMode: 'grouped',
    detailColumns: [],
    uniqueIdMode: 'auto',
    uniqueIdBaseColumn: '',
    uniqueIdDetailColumn: '',
    uniqueIdPattern: '',
    copiedBaseColumns: []
  });
  const [sheetJoinStage, setSheetJoinStage] = useState('match');
  const [sheetJoinPreview, setSheetJoinPreview] = useState(null);
  const [sheetJoinPreviewPage, setSheetJoinPreviewPage] = useState(0);
  const [sheetJoinColumnWidths, setSheetJoinColumnWidths] = useState({});
  const [sheetJoinVisibleColumns, setSheetJoinVisibleColumns] = useState([]);
  const [sheetJoinPreviewFilter, setSheetJoinPreviewFilter] = useState('all');
  const sheetJoinPreviewRowsPerPage = 50;
  const [sheetJoinToastOpen, setSheetJoinToastOpen] = useState(false);
  const [sheetJoinLegacyHeaderWarning, setSheetJoinLegacyHeaderWarning] = useState(false);
  const [savedSheetJoinComparisons, setSavedSheetJoinComparisons] = useState([]);
  const [activeSheetJoinComparisonId, setActiveSheetJoinComparisonId] = useState(null);
  const [sheetJoinSaveDialogOpen, setSheetJoinSaveDialogOpen] = useState(false);
  const [sheetJoinSaveName, setSheetJoinSaveName] = useState('');
  const [sheetJoinSaveLoading, setSheetJoinSaveLoading] = useState(false);
  const [sheetJoinDuplicateDialogOpen, setSheetJoinDuplicateDialogOpen] = useState(false);
  const [pendingSheetJoinDuplicate, setPendingSheetJoinDuplicate] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Check if template or smart tag rules were pre-selected from dashboard
  useEffect(() => {
    if (location.state?.selectedTemplate) {
      setSelectedTemplate(location.state.selectedTemplate);
    }
    if (location.state?.selectedTagTemplate) {
      setSelectedTagTemplate(location.state.selectedTagTemplate);
      setFormulaRules(location.state.selectedTagTemplate.formula_rules || []);
    }
    if (location.state?.smartTagFormulaRules) {
      setFormulaRules(location.state.smartTagFormulaRules);
      // Optionally, you might want to pre-fill template name/description if passed
      // setTemplateName(location.state.smartTagTemplateName || '');
      // setTemplateDescription(location.state.smartTagTemplateDescription || '');
    }
  }, [location.state]);

  // Load available templates when component mounts
  useEffect(() => {
    loadAvailableTemplates();
    loadAvailableTagTemplates();
    
    // Clear any stale persisted info when visiting upload page
    sessionStorage.removeItem('lastUploadedFiles');
    sessionStorage.removeItem('restoreUploadFromMapping');
  }, []);

  const loadAvailableTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const response = await api.getMappingTemplates();
      setAvailableTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error loading templates:', err);
      // Don't show error for templates, just log it
    } finally {
      setTemplatesLoading(false);
    }
  };

  const loadAvailableTagTemplates = async () => {
    setTagTemplatesLoading(true);
    try {
      const response = await api.getTagTemplates();
      setAvailableTagTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error loading tag templates:', err);
      // Don't show error for tag templates, just log it
    } finally {
      setTagTemplatesLoading(false);
    }
  };

  const openSheetJoinDraftDb = useCallback(() => new Promise((resolve, reject) => {
    const request = indexedDB.open(sheetJoinDraftDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sheetJoinDraftStoreName)) {
        db.createObjectStore(sheetJoinDraftStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }), [sheetJoinDraftDbName, sheetJoinDraftStoreName]);

  const loadSavedSheetJoinComparisons = useCallback(() => {
    try {
      const raw = localStorage.getItem(sheetJoinComparisonListKey);
      const list = raw ? JSON.parse(raw) : [];
      setSavedSheetJoinComparisons(Array.isArray(list) ? list : []);
    } catch (err) {
      setSavedSheetJoinComparisons([]);
    }
  }, [sheetJoinComparisonListKey]);

  useEffect(() => {
    loadSavedSheetJoinComparisons();
  }, [loadSavedSheetJoinComparisons]);

  const getUniqueSheetJoinComparisonName = useCallback((baseName, ignoreId = null) => {
    const cleanBase = (baseName || 'Comparison').trim();
    const existingNames = new Set(
      savedSheetJoinComparisons
        .filter(item => item.id !== ignoreId)
        .map(item => String(item.name || '').trim().toLowerCase())
    );
    if (!existingNames.has(cleanBase.toLowerCase())) return cleanBase;

    let index = 2;
    let candidate = `${cleanBase} copy`;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${cleanBase} copy ${index}`;
      index += 1;
    }
    return candidate;
  }, [savedSheetJoinComparisons]);

  const saveSheetJoinDraft = useCallback(async (preview, comparisonName = '', options = {}) => {
    if (!preview?.headers?.length) return null;
    const rows = preview.rows.map(row => {
      const cleanRow = {};
      preview.headers.forEach(header => {
        cleanRow[header] = row[header] ?? '';
      });
      return cleanRow;
    });
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: preview.headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet_Joined');
    const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const savedAt = new Date().toISOString();
    const safeName = comparisonName
      ? comparisonName.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim()
      : 'sheet_join_bom';
    const filename = `${safeName || 'sheet_join_bom'}_${savedAt.replace(/[:.]/g, '-')}.xlsx`;
    const comparisonId = options.overrideId || `sheet-join-comparison-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const draftKey = comparisonName ? comparisonId : sheetJoinBomDraftKey;

    const db = await openSheetJoinDraftDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(sheetJoinDraftStoreName, 'readwrite');
      tx.objectStore(sheetJoinDraftStoreName).put({
        blob,
        filename,
        comparisonName,
        savedAt,
        headers: preview.headers,
        rowCount: rows.length,
        baseHeaders: preview.config?.baseHeaders || [],
        detailHeaders: preview.config?.detailHeaders || [],
        previewHeaders: preview.headers,
        previewRows: preview.rows,
        previewSummary: preview.summary,
        previewConfig: preview.config
      }, draftKey);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    if (comparisonName) {
      const nextMeta = {
        id: comparisonId,
        name: comparisonName,
        filename,
        savedAt,
        rowCount: rows.length,
        baseSheet: preview.config.baseSheet,
        detailSheet: preview.config.detailSheet,
        baseKey: preview.config.baseKey,
        detailKey: preview.config.detailKey
      };
      const existingRaw = localStorage.getItem(sheetJoinComparisonListKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const existingList = Array.isArray(existing) ? existing : [];
      const nextList = [
        nextMeta,
        ...existingList.filter(item => item.id !== comparisonId)
      ].slice(0, 25);
      localStorage.setItem(sheetJoinComparisonListKey, JSON.stringify(nextList));
      setSavedSheetJoinComparisons(nextList);
    }

    return { blob, filename, workbook, comparisonName, id: comparisonId };
  }, [openSheetJoinDraftDb, sheetJoinBomDraftKey, sheetJoinComparisonListKey, sheetJoinDraftStoreName]);

  const applySheetJoinDraftToUpload = useCallback((draft, activeComparisonId = null) => {
    if (!draft?.blob || !draft?.filename) return;
    const file = new File([draft.blob], draft.filename, { type: draft.blob.type });
    const reader = new FileReader();
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target.result, { type: 'binary' });
      const sheets = workbook.SheetNames;
      setUserFile(file);
      setClientWorkbook(workbook);
      setClientSheetNames(sheets);
      setSelectedClientSheet(sheets[0] || 'Sheet_Joined');
      setClientHeaderRow(1);
      setSheetJoinSetup(null);
      setSheetJoinDialogOpen(false);
      setSheetJoinStage('match');
      setSheetJoinPreview(null);
      setActiveSheetJoinComparisonId(activeComparisonId);
      setSuccess('Related sheet data is saved as your new BOM/client file. Add the FW template when ready and continue normally.');
    };
    reader.readAsBinaryString(file);
  }, []);

  const getSheetHeaders = useCallback((sheetName, headerRow = 1) => {
    if (!clientWorkbook || !sheetName || !clientWorkbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json(clientWorkbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
    const row = rows[Math.max(0, Number(headerRow || 1) - 1)] || [];
    return row
      .map(value => String(value || '').trim())
      .filter(Boolean);
  }, [clientWorkbook]);

  const getSheetRecords = useCallback((sheetName, headerRow = 1) => {
    if (!clientWorkbook || !sheetName || !clientWorkbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json(clientWorkbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
    const headerIndex = Math.max(0, Number(headerRow || 1) - 1);
    const headers = (rows[headerIndex] || [])
      .map(value => String(value || '').trim())
      .filter(Boolean);

    return rows.slice(headerIndex + 1)
      .filter(row => row && row.some(value => String(value || '').trim()))
      .map(row => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = row[index] ?? '';
        });
        return record;
      });
  }, [clientWorkbook]);

  const guessKeyColumn = useCallback((headers) => {
    const normalized = headers.map(header => ({
      original: header,
      key: String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    }));
    const preferred = ['partnumber', 'partno', 'itemnumber', 'itemno', 'componentnumber'];
    for (const key of preferred) {
      const match = normalized.find(header => header.key === key || header.key.includes(key));
      if (match) return match.original;
    }
    return headers[0] || '';
  }, []);

  const defaultDetailColumns = useCallback((headers, keyColumn) => {
    const preferred = ['manufacturer part number', 'mpn', 'manufacturer name', 'manufacturer', 'description'];
    const lowerByHeader = new Map(headers.map(header => [header, String(header || '').toLowerCase()]));
    const picked = headers.filter(header =>
      header !== keyColumn && preferred.some(term => lowerByHeader.get(header)?.includes(term))
    );
    return picked.length > 0 ? picked : headers.filter(header => header !== keyColumn).slice(0, 4);
  }, []);

  const defaultCopiedBaseColumns = useCallback((headers) => {
    return headers.filter(Boolean);
  }, []);

  const sanitizeSheetJoinConfig = useCallback((config) => {
    const baseHeaders = getSheetHeaders(config.baseSheet, config.baseHeaderRow).length
      ? getSheetHeaders(config.baseSheet, config.baseHeaderRow)
      : (config.baseHeaders || []);
    const detailHeaders = getSheetHeaders(config.detailSheet, config.detailHeaderRow).length
      ? getSheetHeaders(config.detailSheet, config.detailHeaderRow)
      : (config.detailHeaders || []);
    // Don't auto-guess the primary match column — the user must pick it deliberately.
    const baseKey = baseHeaders.includes(config.baseKey) ? config.baseKey : '';
    const detailKey = detailHeaders.includes(config.detailKey) ? config.detailKey : guessKeyColumn(detailHeaders);
    const detailColumns = (config.detailColumns || []).filter(column => detailHeaders.includes(column) && column !== detailKey);
    const selectedDetailColumns = detailColumns.length ? detailColumns : defaultDetailColumns(detailHeaders, detailKey);

    return {
      ...config,
      baseKey,
      detailKey,
      detailColumns: selectedDetailColumns,
      copiedBaseColumns: defaultCopiedBaseColumns(baseHeaders),
      uniqueIdMode: 'auto',
      uniqueIdBaseColumn: baseKey,
      uniqueIdDetailColumn: selectedDetailColumns[0] || detailKey,
      uniqueIdPattern: '{base}_{detail}',
      baseHeaders,
      detailHeaders
    };
  }, [defaultCopiedBaseColumns, defaultDetailColumns, getSheetHeaders, guessKeyColumn]);

  const buildSheetJoinPreview = useCallback((config) => {
    const cleanConfig = sanitizeSheetJoinConfig(config);
    const baseHeaders = getSheetHeaders(cleanConfig.baseSheet, cleanConfig.baseHeaderRow);
    const detailHeaders = getSheetHeaders(cleanConfig.detailSheet, cleanConfig.detailHeaderRow);
    const baseRows = getSheetRecords(cleanConfig.baseSheet, cleanConfig.baseHeaderRow);
    const detailRows = getSheetRecords(cleanConfig.detailSheet, cleanConfig.detailHeaderRow);
    const selectedDetailColumns = cleanConfig.detailColumns.filter(column => detailHeaders.includes(column) && column !== cleanConfig.detailKey);
    const singleGroupedColumnName = cleanConfig.relationshipName.trim();

    const normalize = value => String(value || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
    const clean = value => String(value ?? '').trim();
    const uniqueValues = values => {
      const seen = new Set();
      return values
        .map(clean)
        .filter(value => {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        });
    };
    const uniqueName = (name, existing) => {
      let candidate = name;
      let suffix = 2;
      while (existing.includes(candidate)) {
        candidate = `${name} ${suffix}`;
        suffix += 1;
      }
      return candidate;
    };
    const makeId = (baseRow, detailRow = {}) => {
      const baseValue = clean(baseRow[cleanConfig.uniqueIdBaseColumn]);
      const detailValue = clean(detailRow[cleanConfig.uniqueIdDetailColumn]);
      if (cleanConfig.uniqueIdMode === 'custom') {
        return cleanConfig.uniqueIdPattern.replace('{base}', baseValue).replace('{detail}', detailValue).replace(/^[_-\s]+|[_-\s]+$/g, '');
      }
      return `${baseValue}_${detailValue}`.replace(/^[_-\s]+|[_-\s]+$/g, '');
    };

    const detailLookup = new Map();
    detailRows.forEach(row => {
      const key = normalize(row[cleanConfig.detailKey]);
      if (!key) return;
      if (!detailLookup.has(key)) detailLookup.set(key, []);
      detailLookup.get(key).push(row);
    });

    const headers = [...baseHeaders];
    const detailHeaderMap = {};
    if (cleanConfig.outputMode === 'grouped') {
      selectedDetailColumns.forEach(column => {
        const preferred = selectedDetailColumns.length === 1 && singleGroupedColumnName
          ? singleGroupedColumnName
          : column;
        const outputName = uniqueName(headers.includes(preferred) ? `${preferred} (related)` : preferred, headers);
        detailHeaderMap[column] = outputName;
        headers.push(outputName);
      });
    } else {
      selectedDetailColumns.forEach(column => {
        const outputName = uniqueName(headers.includes(column) ? `${column} (detail)` : column, headers);
        detailHeaderMap[column] = outputName;
        headers.push(outputName);
      });
    }

    let generatedIdHeader = 'Generated Row ID';
    if (cleanConfig.outputMode === 'expanded') {
      generatedIdHeader = uniqueName(generatedIdHeader, headers);
      headers.unshift(generatedIdHeader);
    }

    const rows = [];
    let matchedBaseRows = 0;
    let unmatchedBaseRows = 0;
    let expandedRows = 0;

    baseRows.forEach(baseRow => {
      const matches = detailLookup.get(normalize(baseRow[cleanConfig.baseKey])) || [];
      if (matches.length) {
        matchedBaseRows += 1;
        if (cleanConfig.outputMode === 'grouped') {
          const row = {};
          row.__sheetJoinStatus = 'matched';
          baseHeaders.forEach(header => { row[header] = baseRow[header] ?? ''; });
          selectedDetailColumns.forEach(column => {
            row[detailHeaderMap[column]] = uniqueValues(matches.map(match => match[column])).join(' | ');
          });
          rows.push(row);
          expandedRows += 1;
        } else {
          matches.forEach((detailRow, matchIndex) => {
            const row = {};
            row.__sheetJoinStatus = 'matched';
            row[generatedIdHeader] = makeId(baseRow, detailRow);
            baseHeaders.forEach(header => {
              row[header] = baseRow[header] ?? '';
            });
            selectedDetailColumns.forEach(column => {
              row[detailHeaderMap[column]] = detailRow[column] ?? '';
            });
            rows.push(row);
            expandedRows += 1;
          });
        }
      } else {
        unmatchedBaseRows += 1;
        const row = {};
        row.__sheetJoinStatus = 'unmatched';
        if (cleanConfig.outputMode === 'expanded') row[generatedIdHeader] = makeId(baseRow);
        baseHeaders.forEach(header => { row[header] = baseRow[header] ?? ''; });
        selectedDetailColumns.forEach(column => { row[detailHeaderMap[column]] = ''; });
        rows.push(row);
      }
    });

    const baseKeys = new Set(baseRows.map(row => normalize(row[cleanConfig.baseKey])).filter(Boolean));
    const detailKeys = new Set(detailRows.map(row => normalize(row[cleanConfig.detailKey])).filter(Boolean));
    const orphanDetailKeys = [...detailKeys].filter(key => !baseKeys.has(key)).length;

    return {
      config: {
        ...cleanConfig,
        baseHeaders,
        detailHeaders
      },
      headers,
      rows,
      summary: {
        matchedBaseRows,
        unmatchedBaseRows,
        expandedRows,
        orphanDetailKeys,
        outputRows: rows.length
      }
    };
  }, [getSheetHeaders, getSheetRecords, sanitizeSheetJoinConfig]);

  const onDropUserFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      let file = acceptedFiles[0];
      setError(null);
      setUserFile(file);
      setSheetJoinSetup(null);
      setActiveSheetJoinComparisonId(null);
      setSheetJoinLegacyHeaderWarning(false);
      setSheetJoinDialogOpen(false);
      
      // Read the file to extract sheet names and column headers for Excel/CSV files
      // Skip processing for PDF files as they will be handled by Azure OCR
      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const isPDF = file.name.toLowerCase().endsWith('.pdf');

      if (isPDF) {
        // For PDF files, we don't need to extract sheet names or headers
        // They will be processed by Azure OCR service
        setClientWorkbook(null);
        setClientSheetNames([]);
        setSelectedClientSheet('');
        setClientHeaderRow(1);
        return;
      }

      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          let workbook;
          
          if (isCSV) {
            // For CSV files, use text reading with proper parsing options
            workbook = XLSX.read(data, { 
              type: 'string',
              codepage: 65001, // UTF-8
              raw: false,
              dateNF: 'YYYY-MM-DD',
              cellDates: true,
              cellNF: false,
              cellText: false
            });
          } else {
            // For Excel files, use binary reading
            workbook = XLSX.read(data, { type: 'binary' });
          }
          
          const sheets = workbook.SheetNames;
          setClientWorkbook(workbook);
          setClientSheetNames(sheets);
          setSelectedClientSheet(sheets[0]); // Auto-select first sheet
          
          // Extract column headers from the first sheet
          if (sheets.length > 0) {
            // A1-anchored read so blank leading rows are counted the same way the
            // backend (pandas) counts them — otherwise the detected "Header Row"
            // is off by one and the backend reads a blank row (Unnamed columns).
            const jsonData = readSheetRows(workbook, sheets[0]);


            // Smart header detection: find the row with the most non-empty columns
            let bestHeaderRow = 0;
            let maxColumns = 0;

            // Check first 5 rows for potential headers
            for (let i = 0; i < Math.min(5, jsonData.length); i++) {
              if (jsonData[i]) {
                const nonEmptyColumns = jsonData[i].filter(header => 
                  header !== null && 
                  header !== undefined && 
                  header.toString().trim() !== ''
                ).length;
                
                
                if (nonEmptyColumns > maxColumns) {
                  maxColumns = nonEmptyColumns;
                  bestHeaderRow = i;
                }
              }
            }
            
            
            // Parse headers from the best header row
            if (jsonData.length > bestHeaderRow && jsonData[bestHeaderRow]) {
              const headers = jsonData[bestHeaderRow].filter(header => 
                header !== null && 
                header !== undefined && 
                header.toString().trim() !== ''
              );
              
              if (headers.length === 0) {
                console.warn('No valid headers found in the file');
                setError('No valid column headers found in the file. Please check the file format and ensure it has proper headers.');
                return;
              }
              
              // Update the header row setting to the detected row
              if (bestHeaderRow !== 0) {
                setClientHeaderRow(bestHeaderRow + 1);
                setClientHeaderAutoDetected(true);
              }
            } else {
              console.warn('No data found in the file');
              setError('The file appears to be empty or has no data.');
              return;
            }
          }
        } catch (err) {
          console.error('Error reading file:', err);
          const fileType = file.name.toLowerCase().endsWith('.csv') ? 'CSV' : 'Excel';
          
          // For CSV files, try fallback reading methods
          if (isCSV && !err.message.includes('fallback attempted')) {
            try {
              // Fallback: try reading as binary for CSV files with encoding issues
              const fallbackWorkbook = XLSX.read(evt.target.result, { 
                type: 'string',
                raw: true,
                codepage: 1252 // Windows-1252 (common alternative)
              });
              
              const fallbackSheets = fallbackWorkbook.SheetNames;
              setClientWorkbook(fallbackWorkbook);
              setClientSheetNames(fallbackSheets);
              setSelectedClientSheet(fallbackSheets[0]);
              
              if (fallbackSheets.length > 0) {
                const fallbackSheet = fallbackWorkbook.Sheets[fallbackSheets[0]];
                const fallbackJsonData = XLSX.utils.sheet_to_json(fallbackSheet, { 
                  header: 1,
                  raw: false,
                  defval: ''
                });
                
                
                if (fallbackJsonData.length > 0) {
                  // Same smart header detection for fallback
                  let bestHeaderRow = 0;
                  let maxColumns = 0;
                  
                  for (let i = 0; i < Math.min(5, fallbackJsonData.length); i++) {
                    if (fallbackJsonData[i]) {
                      const nonEmptyColumns = fallbackJsonData[i].filter(header => 
                        header !== null && 
                        header !== undefined && 
                        header.toString().trim() !== ''
                      ).length;
                      
                      if (nonEmptyColumns > maxColumns) {
                        maxColumns = nonEmptyColumns;
                        bestHeaderRow = i;
                      }
                    }
                  }
                  
                  if (maxColumns > 0) {
                    if (bestHeaderRow !== 0) {
                      setClientHeaderRow(bestHeaderRow + 1);
                      setClientHeaderAutoDetected(true);
                    }
                    return; // Success with fallback
                  }
                }
              }
              
              throw new Error('Fallback parsing also failed');
            } catch (fallbackErr) {
              console.error('Fallback CSV reading also failed:', fallbackErr);
              setError(`Error reading ${fileType} file. Please make sure it's a valid ${fileType} file with proper formatting. Both UTF-8 and Windows-1252 encoding attempts failed.`);
              return;
            }
          }
          
          setError(`Error reading ${fileType} file. Please make sure it's a valid ${fileType} file with proper formatting.`);
        }
      };
      
      // Use different reading methods for CSV vs Excel files
      if (isCSV) {
        reader.readAsText(file, 'UTF-8'); // Read CSV as text with UTF-8 encoding
      } else {
        reader.readAsBinaryString(file); // Read Excel as binary
      }

      // Do NOT persist to sessionStorage here.
      // Persistence only happens on successful upload
      // (so files only appear when coming back from mapping).
    }
  }, []);


  const { getRootProps: getUserRootProps, getInputProps: getUserInputProps, isDragActive: isUserDragActive } =
    useDropzone({
      onDrop: onDropUserFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'text/csv': ['.csv'],
        'application/csv': ['.csv'],
        'text/plain': ['.csv'],
        'application/pdf': ['.pdf']
      },
      maxFiles: 1
    });

  // Template file drop handler
  const onDropTemplateFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setError(null);
      setTemplateFile(file);

      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');

      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          let workbook;

          if (isCSV) {
            workbook = XLSX.read(data, {
              type: 'string',
              codepage: 65001,
              raw: false
            });
          } else {
            workbook = XLSX.read(data, { type: 'binary' });
          }

          const sheets = workbook.SheetNames;
          const firstSheet = sheets[0];
          setTemplateWorkbook(workbook);
          setTemplateSheetNames(sheets);
          setSelectedTemplateSheet(firstSheet);

          // Templates frequently carry description/"Required, Max 200 characters"
          // rows above the real headers, so detect the header row instead of
          // defaulting to 1 (which would map help text as column names).
          const detectedRow = detectHeaderRow(workbook, firstSheet);
          setTemplateHeaderRow(detectedRow);
          setTemplateHeaderAutoDetected(detectedRow > 1);
        } catch (err) {
          console.error('Error reading template file:', err);
          setError('Error reading template file. Please make sure it\'s a valid Excel or CSV file.');
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsBinaryString(file);
      }
    }
  }, []);

  const { getRootProps: getTemplateRootProps, getInputProps: getTemplateInputProps, isDragActive: isTemplateDragActive } =
    useDropzone({
      onDrop: onDropTemplateFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'text/csv': ['.csv'],
        'application/csv': ['.csv'],
        'text/plain': ['.csv']
      },
      maxFiles: 1
    });

  // Keep the header preview in sync with the sheet / header row actually being sent.
  useEffect(() => {
    if (!templateWorkbook || !selectedTemplateSheet) {
      setTemplateHeaderPreview([]);
      return;
    }
    setTemplateHeaderPreview(readHeadersAtRow(templateWorkbook, selectedTemplateSheet, templateHeaderRow));
  }, [templateWorkbook, selectedTemplateSheet, templateHeaderRow]);

  // Same header-row preview for the source/client file.
  useEffect(() => {
    if (!clientWorkbook || !selectedClientSheet) {
      setClientHeaderPreview([]);
      return;
    }
    setClientHeaderPreview(readHeadersAtRow(clientWorkbook, selectedClientSheet, clientHeaderRow));
  }, [clientWorkbook, selectedClientSheet, clientHeaderRow]);

  const handleClientSheetChange = (sheetName) => {
    setSelectedClientSheet(sheetName);
    if (!clientWorkbook) return;
    const detectedRow = detectHeaderRow(clientWorkbook, sheetName);
    setClientHeaderRow(detectedRow);
    setClientHeaderAutoDetected(detectedRow > 1);
  };

  const handleClientHeaderRowChange = (value) => {
    const parsed = Number(value);
    setClientHeaderRow(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
    setClientHeaderAutoDetected(false);
  };

  const handleTemplateSheetChange = (sheetName) => {
    setSelectedTemplateSheet(sheetName);
    if (!templateWorkbook) return;
    const detectedRow = detectHeaderRow(templateWorkbook, sheetName);
    setTemplateHeaderRow(detectedRow);
    setTemplateHeaderAutoDetected(detectedRow > 1);
  };

  const handleTemplateHeaderRowChange = (value) => {
    const parsed = Number(value);
    setTemplateHeaderRow(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
    setTemplateHeaderAutoDetected(false);
  };

  // Filter templates based on search term
  const filteredTemplates = availableTemplates.filter(template =>
    (template.name && template.name.toLowerCase().includes(templateSearchTerm.toLowerCase())) ||
    (template.description && template.description.toLowerCase().includes(templateSearchTerm.toLowerCase()))
  );

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    
    // Load formula rules from template if they exist
    if (template.formula_rules && template.formula_rules.length > 0) {
      setFormulaRules([...template.formula_rules]);
    } else {
      setFormulaRules([]);
    }
  };

  const handleRemoveTemplate = () => {
    setSelectedTemplate(null);
    setFormulaRules([]); // Clear formula rules when template is removed
  };

  // Filter tag templates based on search term
  const filteredTagTemplates = availableTagTemplates.filter(template =>
    (template.name && template.name.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase())) ||
    (template.description && template.description.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase()))
  );

  const handleSelectTagTemplate = (template) => {
    setSelectedTagTemplate(template);
    
    // Load formula rules from tag template
    if (template.formula_rules && template.formula_rules.length > 0) {
      setFormulaRules([...template.formula_rules]);
    } else {
      setFormulaRules([]);
    }
  };

  const handleRemoveTagTemplate = () => {
    setSelectedTagTemplate(null);
    // Don't clear formula rules as user might have manually created them
  };

  // Compatibility error modal handlers
  const handleContinueAnyway = () => {
    if (pendingSessionId) {
      setCompatibilityErrorOpen(false);
      setSuccess('Files uploaded. Proceeding to manual mapping due to template compatibility issues.');
      setTimeout(() => {
        showPrimaryColumnDialog(pendingSessionId);
      }, 1500);
    }
  };

  const handleTryDifferentTemplate = () => {
    setCompatibilityErrorOpen(false);
    setSelectedTemplate(null);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleUploadWithoutTemplate = () => {
    setCompatibilityErrorOpen(false);
    setSelectedTemplate(null);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleCloseCompatibilityError = () => {
    setCompatibilityErrorOpen(false);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleOpenSheetJoinSetup = () => {
    if (!clientWorkbook || clientSheetNames.length < 2) return;

    const baseSheet = sheetJoinSetup?.baseSheet || selectedClientSheet || clientSheetNames[0];
    const detailSheet = sheetJoinSetup?.detailSheet || clientSheetNames.find(sheet => sheet !== baseSheet) || clientSheetNames[1] || '';
    const baseHeaderRow = sheetJoinSetup?.baseHeaderRow || clientHeaderRow || 1;
    const detailHeaderRow = sheetJoinSetup?.detailHeaderRow || 1;
    const baseHeaders = getSheetHeaders(baseSheet, baseHeaderRow);
    const detailHeaders = getSheetHeaders(detailSheet, detailHeaderRow);
    // Don't auto-guess the primary match column — the user picks it deliberately.
    const baseKey = sheetJoinSetup?.baseKey || '';
    const detailKey = sheetJoinSetup?.detailKey || guessKeyColumn(detailHeaders);
    const defaultDetailColumnSelection = defaultDetailColumns(detailHeaders, detailKey);
    const defaultCopiedColumnSelection = defaultCopiedBaseColumns(baseHeaders);

    setSheetJoinConfig({
      baseSheet,
      detailSheet,
      baseHeaderRow,
      detailHeaderRow,
      baseKey,
      detailKey,
      relationshipName: sheetJoinSetup?.relationshipName || '',
      outputMode: sheetJoinSetup?.outputMode || 'grouped',
      detailColumns: sheetJoinSetup?.detailColumns || defaultDetailColumnSelection,
      uniqueIdMode: sheetJoinSetup?.uniqueIdMode || 'auto',
      uniqueIdBaseColumn: sheetJoinSetup?.uniqueIdBaseColumn || baseKey,
      uniqueIdDetailColumn: sheetJoinSetup?.uniqueIdDetailColumn || defaultDetailColumnSelection[0] || detailKey,
      uniqueIdPattern: sheetJoinSetup?.uniqueIdPattern || '{base}_{detail}',
      copiedBaseColumns: sheetJoinSetup?.copiedBaseColumns || defaultCopiedColumnSelection
    });
    setSheetJoinLegacyHeaderWarning(false);
    setSheetJoinStage('match');
    setSheetJoinPreview(null);
    setSheetJoinDialogOpen(true);
  };

  const handleCloseSheetJoinSetup = () => {
    setSheetJoinDialogOpen(false);
  };

  const handleProceedSheetJoinOptions = () => {
    if (!sheetJoinConfig.baseKey || !sheetJoinConfig.detailKey || !sheetJoinConfig.baseSheet || !sheetJoinConfig.detailSheet) return;
    const cleanConfig = sanitizeSheetJoinConfig(sheetJoinConfig);
    setSheetJoinConfig(cleanConfig);
    setSheetJoinStage('options');
  };

  const handlePreviewSheetJoin = () => {
    const baseRows = getSheetRecords(sheetJoinConfig.baseSheet, sheetJoinConfig.baseHeaderRow);
    const detailRows = getSheetRecords(sheetJoinConfig.detailSheet, sheetJoinConfig.detailHeaderRow);
    if ((!baseRows.length || !detailRows.length) && sheetJoinPreview?.rows?.length) {
      setSheetJoinVisibleColumns(sheetJoinPreview.headers);
      setSheetJoinPreviewFilter('all');
      setSheetJoinPreviewPage(0);
      setSheetJoinStage('preview');
      return;
    }

    const preview = buildSheetJoinPreview(sheetJoinConfig);
    setSheetJoinConfig(preview.config);
    setSheetJoinPreview(preview);
    setSheetJoinLegacyHeaderWarning(false);
    setSheetJoinVisibleColumns(preview.headers);
    setSheetJoinPreviewFilter('all');
    setSheetJoinPreviewPage(0);
    setSheetJoinStage('preview');
  };

  const handleSheetJoinPreviewCellChange = (rowIndex, header, value) => {
    setSheetJoinPreview(prev => {
      if (!prev) return prev;
      const rows = prev.rows.map((row, index) => (
        index === rowIndex ? { ...row, [header]: value } : row
      ));
      return { ...prev, rows };
    });
  };

  const handleDownloadSheetJoinPreview = () => {
    if (!sheetJoinPreview) return;
    const exportRows = sheetJoinPreview.rows.map(row => {
      const cleanRow = {};
      sheetJoinPreview.headers.forEach(header => {
        cleanRow[header] = row[header] ?? '';
      });
      return cleanRow;
    });
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: sheetJoinPreview.headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Merge_Preview');
    XLSX.writeFile(workbook, `${sheetJoinConfig.relationshipName || 'sheet_merge'}_preview.xlsx`);
  };

  const handleSheetJoinColumnResize = (header, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sheetJoinColumnWidths[header] || 180;

    const handleMove = (moveEvent) => {
      const nextWidth = Math.max(90, startWidth + moveEvent.clientX - startX);
      setSheetJoinColumnWidths(prev => ({ ...prev, [header]: nextWidth }));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleSaveSheetJoinSetup = useCallback(() => {
    const preview = sheetJoinPreview || buildSheetJoinPreview(sheetJoinConfig);

    const setup = {
      sourceType: 'same-workbook',
      ...preview.config,
      baseHeaderRow: Math.max(1, Number(preview.config.baseHeaderRow || 1)),
      detailHeaderRow: Math.max(1, Number(preview.config.detailHeaderRow || 1)),
      relationshipName: preview.config.relationshipName?.trim(),
      previewHeaders: preview.headers,
      previewRows: preview.rows.map(row => {
        const cleanRow = {};
        preview.headers.forEach(header => {
          cleanRow[header] = row[header] ?? '';
        });
        return cleanRow;
      }),
      previewSummary: preview.summary
    };

    setSheetJoinSetup(setup);
    setSheetJoinPreview(preview);
    setSheetJoinDialogOpen(false);
    setSheetJoinToastOpen(true);
  }, [buildSheetJoinPreview, sheetJoinConfig, sheetJoinPreview]);

  const getSavedSheetJoinDraft = useCallback(async (comparisonId) => {
    const db = await openSheetJoinDraftDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(sheetJoinDraftStoreName, 'readonly');
        const request = tx.objectStore(sheetJoinDraftStoreName).get(comparisonId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, [openSheetJoinDraftDb, sheetJoinDraftStoreName]);

  const handleOpenSavedComparison = useCallback(async (comparison) => {
    try {
      const draft = await getSavedSheetJoinDraft(comparison.id);
      if (!draft?.previewHeaders?.length) {
        setError('Saved merge book data was not found. Please recreate the merge.');
        return;
      }
      const storedConfig = draft.previewConfig || sheetJoinConfig;
      const uniqueList = (values) => [...new Set((values || []).filter(Boolean))];
      const workbookBaseHeaders = getSheetHeaders(storedConfig.baseSheet, storedConfig.baseHeaderRow);
      const workbookDetailHeaders = getSheetHeaders(storedConfig.detailSheet, storedConfig.detailHeaderRow);
      const fallbackDetailHeaders = uniqueList([
        storedConfig.detailKey,
        ...(storedConfig.detailColumns || [])
      ]);
      const fallbackBaseHeaders = uniqueList(
        storedConfig.copiedBaseColumns?.length
          ? storedConfig.copiedBaseColumns
          : (draft.previewHeaders || []).filter(header =>
              header !== 'Generated Row ID' &&
              !(storedConfig.detailColumns || []).includes(header)
            )
      );
      const previewConfig = {
        ...storedConfig,
        baseHeaders: workbookBaseHeaders.length
          ? workbookBaseHeaders
          : (draft.baseHeaders?.length ? draft.baseHeaders : (storedConfig.baseHeaders?.length ? storedConfig.baseHeaders : fallbackBaseHeaders)),
        detailHeaders: workbookDetailHeaders.length
          ? workbookDetailHeaders
          : (draft.detailHeaders?.length ? draft.detailHeaders : (storedConfig.detailHeaders?.length ? storedConfig.detailHeaders : fallbackDetailHeaders))
      };
      setSheetJoinLegacyHeaderWarning(!workbookDetailHeaders.length && !draft.detailHeaders?.length && !storedConfig.detailHeaders?.length);
      const preview = {
        headers: draft.previewHeaders,
        rows: draft.previewRows || [],
        summary: draft.previewSummary || {
          outputRows: draft.rowCount || 0,
          matchedBaseRows: 0,
          unmatchedBaseRows: 0,
          orphanDetailKeys: 0
        },
        config: previewConfig
      };
      setSheetJoinConfig(preview.config);
      setSheetJoinPreview(preview);
      setSheetJoinVisibleColumns(preview.headers);
      setSheetJoinPreviewPage(0);
      setSheetJoinPreviewFilter('all');
      setSheetJoinStage('preview');
      setSheetJoinDialogOpen(true);
    } catch (err) {
      setError('Failed to open saved merge book: ' + (err.message || err));
    }
  }, [getSavedSheetJoinDraft, getSheetHeaders, sheetJoinConfig]);

  const handleContinueSavedComparison = useCallback(async (comparison) => {
    try {
      const draft = await getSavedSheetJoinDraft(comparison.id);
      if (!draft?.blob) {
        setError('Saved merge book was not found. Please recreate the merge.');
        return;
      }
      applySheetJoinDraftToUpload(draft, comparison.id);
    } catch (err) {
      setError('Failed to continue with saved merge book: ' + (err.message || err));
    }
  }, [applySheetJoinDraftToUpload, getSavedSheetJoinDraft]);

  const saveNamedSheetJoinComparison = useCallback(async (preview, name, options = {}) => {
    await saveSheetJoinDraft(preview, name, options);
    handleSaveSheetJoinSetup();
    setSheetJoinSaveDialogOpen(false);
    setSheetJoinSaveName('');
    setPendingSheetJoinDuplicate(null);
    setSheetJoinDuplicateDialogOpen(false);
    setSuccess('Merge book saved. You can reopen it from the saved merge books on Upload.');
  }, [saveSheetJoinDraft, handleSaveSheetJoinSetup]);

  const handleSaveComparisonWithName = async () => {
    if (!sheetJoinSaveName.trim()) {
      setError('Merge book name is required');
      return;
    }
    const preview = sheetJoinPreview || buildSheetJoinPreview(sheetJoinConfig);
    const requestedName = sheetJoinSaveName.trim();
    const duplicate = savedSheetJoinComparisons.find(item =>
      String(item.name || '').trim().toLowerCase() === requestedName.toLowerCase()
    );
    if (duplicate) {
      setPendingSheetJoinDuplicate({ preview, name: requestedName, existing: duplicate });
      setSheetJoinDuplicateDialogOpen(true);
      return;
    }

    try {
      setSheetJoinSaveLoading(true);
      await saveNamedSheetJoinComparison(preview, requestedName);
    } catch (err) {
      setError('Failed to save merge book: ' + (err.message || err));
    } finally {
      setSheetJoinSaveLoading(false);
    }
  };

  const handleOverrideSavedComparison = async () => {
    if (!pendingSheetJoinDuplicate) return;
    try {
      setSheetJoinSaveLoading(true);
      await saveNamedSheetJoinComparison(
        pendingSheetJoinDuplicate.preview,
        pendingSheetJoinDuplicate.name,
        { overrideId: pendingSheetJoinDuplicate.existing.id }
      );
      if (activeSheetJoinComparisonId === pendingSheetJoinDuplicate.existing.id) {
        setActiveSheetJoinComparisonId(null);
      }
    } catch (err) {
      setError('Failed to override merge book: ' + (err.message || err));
    } finally {
      setSheetJoinSaveLoading(false);
    }
  };

  const handleSaveComparisonAsCopy = async () => {
    if (!pendingSheetJoinDuplicate) return;
    const copyName = getUniqueSheetJoinComparisonName(pendingSheetJoinDuplicate.name);
    try {
      setSheetJoinSaveLoading(true);
      await saveNamedSheetJoinComparison(pendingSheetJoinDuplicate.preview, copyName);
    } catch (err) {
      setError('Failed to save merge book copy: ' + (err.message || err));
    } finally {
      setSheetJoinSaveLoading(false);
    }
  };

  const handleContinueWithBomMapping = async () => {
    const preview = sheetJoinPreview || buildSheetJoinPreview(sheetJoinConfig);
    try {
      const draft = await saveSheetJoinDraft(preview);
      if (draft) {
        applySheetJoinDraftToUpload(draft, null);
      }
    } catch (err) {
      setError('Failed to save generated BOM file: ' + (err.message || err));
    }
  };

  const continueAfterOptionalSheetJoin = async (sessionId, navState = null) => {
    if (!sheetJoinSetup) {
      showPrimaryColumnDialog(sessionId, navState);
      return;
    }

    try {
      setSuccess('Applying sheet merge before mapping...');
      const response = await api.applySheetJoin({
        session_id: sessionId,
        base_sheet: sheetJoinSetup.baseSheet,
        detail_sheet: sheetJoinSetup.detailSheet,
        base_header_row: sheetJoinSetup.baseHeaderRow,
        detail_header_row: sheetJoinSetup.detailHeaderRow,
        base_key: sheetJoinSetup.baseKey,
        detail_key: sheetJoinSetup.detailKey,
        relationship_name: sheetJoinSetup.relationshipName,
        output_mode: sheetJoinSetup.outputMode,
        detail_columns: sheetJoinSetup.detailColumns,
        copied_base_columns: sheetJoinSetup.copiedBaseColumns,
        unique_id_mode: sheetJoinSetup.uniqueIdMode,
        unique_id_base_column: sheetJoinSetup.uniqueIdBaseColumn,
        unique_id_detail_column: sheetJoinSetup.uniqueIdDetailColumn,
        unique_id_pattern: sheetJoinSetup.uniqueIdPattern,
        preview_headers: sheetJoinSetup.previewHeaders,
        preview_rows: sheetJoinSetup.previewRows
      });
      setSuccess(`Sheet merge applied: ${response.data.rows} rows ready for mapping.`);
      setTimeout(() => showPrimaryColumnDialog(sessionId, navState), 800);
    } catch (err) {
      setError('Failed to apply sheet merge: ' + (err.response?.data?.error || err.message));
    }
  };

  // Primary column cleanup helpers
  const showPrimaryColumnDialog = async (sessionId, navState = null) => {
    // The primary-key cleanup moved to the Review step (mapping → editor), so it
    // runs the same for every source type (Excel, OCR, PDF zonal) and lets the
    // user pick a mapped column like "Item code" as the key. Here we just proceed
    // to mapping.
    navigate(`/mapping/${sessionId}`, navState ? { state: navState } : undefined);
  };

  const handleSkipCleanup = () => {
    setPrimaryColumnDialogOpen(false);
    const sid = primaryColumnSessionId;
    const navState = pendingNavigateState;
    setPrimaryColumnSessionId(null);
    setPendingNavigateState(null);
    navigate(`/mapping/${sid}`, navState ? { state: navState } : undefined);
  };

  const handleCleanup = async () => {
    if (!selectedPrimaryColumn) return;
    try {
      setCleanupLoading(true);
      const result = await api.cleanupRows(primaryColumnSessionId, selectedPrimaryColumn);
      setCleanupResult(result.data);
      setCleanupLoading(false);

      // Brief delay to show result, then navigate
      setTimeout(() => {
        setPrimaryColumnDialogOpen(false);
        const sid = primaryColumnSessionId;
        const navState = pendingNavigateState;
        setPrimaryColumnSessionId(null);
        setPendingNavigateState(null);
        navigate(`/mapping/${sid}`, navState ? { state: navState } : undefined);
      }, 2000);
    } catch (err) {
      setCleanupLoading(false);
      setError('Failed to clean up rows: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpload = async () => {
    if (!userFile) {
      setError('Please select a client file');
      return;
    }

    const isPDF = userFile.name.toLowerCase().endsWith('.pdf');

    // Template file is required for non-PDF files. PDF uploads can still fall back
    // to the default template, but if a template is selected it must be complete.
    if (!isPDF && !templateFile) {
      setError('Please select a template file');
      return;
    }

    if (!isPDF && clientSheetNames.length > 0) {
      if (combineSheetsMode) {
        if (selectedClientSheets.length < 1) {
          setError('Select at least one sheet to combine');
          return;
        }
      } else if (!selectedClientSheet) {
        setError('Please select a sheet from your client file');
        return;
      }
    }

    if (templateFile && templateSheetNames.length > 0 && !selectedTemplateSheet) {
      setError('Please select a sheet from your template file');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Handle PDF files differently
      if (isPDF) {
        const formData = new FormData();
        formData.append('file', userFile);
        if (templateFile) {
          formData.append('templateFile', templateFile);
          formData.append('templateSheetName', selectedTemplateSheet);
          formData.append('templateHeaderRow', templateHeaderRow.toString());
        }

        // Upload PDF file to PDF OCR endpoint
        const response = await api.uploadPDF(formData);
        setSuccess('PDF uploaded successfully! Choose processing method...');

        // Store session ID and show choice dialog
        setPendingPdfSessionId(response.data.session_id);
        setPdfChoiceDialogOpen(true);
        setLoading(false);

        return;
      }

      // Handle Excel/CSV files (existing logic)
      // If the user chose to combine several same-layout sheets, stack them into
      // one sheet client-side and upload that — the rest of the pipeline is
      // unchanged (it just sees a normal single-sheet file with header on row 1).
      let uploadClientFile = userFile;
      let uploadSheetName = selectedClientSheet;
      let uploadHeaderRow = clientHeaderRow;
      if (combineSheetsMode && selectedClientSheets.length > 1 && clientWorkbook) {
        const combined = buildCombinedSheetFile(clientWorkbook, selectedClientSheets, clientHeaderRow, userFile.name);
        if (combined && combined.file) {
          uploadClientFile = combined.file;
          uploadSheetName = 'Combined';
          uploadHeaderRow = 1;
        } else {
          setError('Could not combine the selected sheets. Check they share the same columns.');
          setLoading(false);
          return;
        }
      }

      const formData = new FormData();
      formData.append('clientFile', uploadClientFile);
      formData.append('sheetName', uploadSheetName);
      formData.append('headerRow', uploadHeaderRow.toString());
      formData.append('templateFile', templateFile);
      formData.append('templateSheetName', selectedTemplateSheet);
      formData.append('templateHeaderRow', templateHeaderRow.toString());

      // Add formula rules if they exist and NO mapping template is selected
      // When a template is selected, it already contains the rules, so don't send them again
      if (!selectedTemplate && formulaRules && formulaRules.length > 0) {
        formData.append('formulaRules', JSON.stringify(formulaRules));
      }

      let response;
      
      // Use template-aware upload only when no sheet merge needs to run first.
      if (selectedTemplate && !sheetJoinSetup) {
        response = await api.uploadFilesWithTemplate(formData, selectedTemplate.id);
        
        // Check template application results
        if (response.data.template_applied && response.data.template_success) {
          let successMessage = `Files uploaded successfully! Template "${selectedTemplate.name}" applied automatically.`;
          if (response.data.applied_formulas) {
            successMessage += ' Smart Tag formulas were also applied and new columns created.';
          }
          setSuccess(successMessage);
          
          setTimeout(() => {
            // Show primary column dialog before navigating
            continueAfterOptionalSheetJoin(response.data.session_id, {
              autoApplyTemplate: selectedTemplate,
              appliedTemplate: selectedTemplate,
              fromUpload: true,
              smartTagFormulaRules: formulaRules
            });
          }, 1500);
          
        } else {
          // Template failed to apply - show compatibility error modal
          const message = response.data.message || 'Template could not be applied to your files.';
          const appliedMappings = response.data.applied_mappings;
          const compatibilityDetails = response.data.compatibility_details;
          
          setCompatibilityErrorData({
            message,
            appliedMappings,
            compatibilityDetails,
            templateName: selectedTemplate.name
          });
          setPendingSessionId(response.data.session_id);
          setCompatibilityErrorOpen(true);
          setLoading(false);
          return;
        }
        
      } else {
        // No template selected, or sheet merge must run before template mapping.
        response = await api.uploadFiles(formData);
        setSuccess(sheetJoinSetup ? 'Files uploaded. Preparing sheet merge...' : 'Files uploaded successfully!');

        setTimeout(() => {
          continueAfterOptionalSheetJoin(response.data.session_id, selectedTemplate ? {
            autoApplyTemplate: selectedTemplate,
            appliedTemplate: selectedTemplate,
            fromUpload: true,
            smartTagFormulaRules: formulaRules
          } : null);
        }, 1500);
      }
      
    } catch (err) {
      console.error('Upload error:', err);
      
      // Check if this is a template compatibility error
      if (selectedTemplate && err.response?.status === 400 && err.response?.data?.compatibility_details) {
        setCompatibilityErrorData({
          message: err.response.data.error,
          compatibilityDetails: err.response.data.compatibility_details,
          templateName: selectedTemplate.name
        });
        setPendingSessionId(err.response.data.session_id);
        setCompatibilityErrorOpen(true);
      } else {
        let errorMessage = 'Error uploading files. Please try again.';
        
        if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        }
        
        if (selectedTemplate && err.response?.data?.error?.includes('template')) {
          errorMessage += ' The selected template may not be compatible with your files. Try uploading without a template to create custom mappings.';
        }
        
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle PDF processing choice
  const handlePdfProcessingChoice = async (processingMode) => {
    try {
      setLoading(true);
      setPdfChoiceDialogOpen(false);

      if (processingMode === 'zonal') {
        setSuccess('Proceeding to zone selection for optimal results...');
        setTimeout(() => {
          navigate(`/pdf-zones/${pendingPdfSessionId}`, {
            state: {
              fromUpload: true,
              pdfAlignment: pdfDataAlignment
            }
          });
        }, 1000);
      } else if (processingMode === 'compare') {
        setSuccess('Processing with native extraction and Azure OCR...');

        const compareResponse = await api.processPDFCompare({
          session_id: pendingPdfSessionId,
          data_alignment: pdfDataAlignment
        });
        const decision = compareResponse.data?.decision;
        const winner = decision?.winner ? `${decision.winner} extraction` : 'best extraction';
        setSuccess(`PDF processed successfully with ${winner}. Proceeding to column mapping...`);

        setTimeout(() => {
          showPrimaryColumnDialog(pendingPdfSessionId, {
            fromPDF: true,
            ocrData: compareResponse.data,
            pdfDecision: decision
          });
        }, 1500);
      } else {
        setSuccess('Processing with standard OCR...');

        // Process the PDF with standard OCR
        const ocrResponse = await api.processPDFOCR({
          session_id: pendingPdfSessionId,
          data_alignment: pdfDataAlignment
        });
        setSuccess('PDF processed successfully! Proceeding to column mapping...');

        setTimeout(() => {
          showPrimaryColumnDialog(pendingPdfSessionId, {
            fromPDF: true,
            ocrData: ocrResponse.data
          });
        }, 1500);
      }
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Error processing PDF. Please try again.');
    } finally {
      setLoading(false);
      setPendingPdfSessionId(null);
    }
  };

  const currentBaseHeaders = getSheetHeaders(sheetJoinConfig.baseSheet, sheetJoinConfig.baseHeaderRow);
  const currentDetailHeaders = getSheetHeaders(sheetJoinConfig.detailSheet, sheetJoinConfig.detailHeaderRow);
  const sheetJoinBaseHeaders = currentBaseHeaders.length
    ? currentBaseHeaders
    : (sheetJoinConfig.baseHeaders || sheetJoinPreview?.config?.baseHeaders || []);
  const sheetJoinDetailHeaders = currentDetailHeaders.length
    ? currentDetailHeaders
    : (sheetJoinConfig.detailHeaders || sheetJoinPreview?.config?.detailHeaders || []);
  const sheetJoinDetailLabel = (() => {
    const normalize = value => String(value || '').toLowerCase();
    const selectedColumns = sheetJoinConfig.detailColumns || [];
    const preferredColumn =
      selectedColumns.find(column => /\bmpn\b|manufacturer part number|mfg part/i.test(column)) ||
      selectedColumns.find(column => /manufacturer|mfg/i.test(column)) ||
      selectedColumns[0];
    const relationshipName = String(sheetJoinConfig.relationshipName || '').trim();
    const rawLabel = preferredColumn || relationshipName || 'secondary values';
    const lower = normalize(rawLabel);
    if (lower.includes('manufacturer part number') || lower === 'mpn' || lower.includes('mpn')) return 'MPNs';
    if (lower.includes('manufacturer')) return 'manufacturers';
    return rawLabel;
  })();
  const sheetJoinDetailSingularLabel = sheetJoinDetailLabel === 'MPNs'
    ? 'MPN'
    : (sheetJoinDetailLabel === 'manufacturers' ? 'manufacturer' : sheetJoinDetailLabel);
  const sheetJoinFilteredPreviewRows = sheetJoinPreview
    ? sheetJoinPreview.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => sheetJoinPreviewFilter === 'all' || row.__sheetJoinStatus === sheetJoinPreviewFilter)
    : [];
  const sheetJoinPreviewTotalPages = Math.max(1, Math.ceil(sheetJoinFilteredPreviewRows.length / sheetJoinPreviewRowsPerPage));
  const sheetJoinPreviewStart = sheetJoinPreviewPage * sheetJoinPreviewRowsPerPage;
  const visibleSheetJoinPreviewRows = sheetJoinFilteredPreviewRows.slice(sheetJoinPreviewStart, sheetJoinPreviewStart + sheetJoinPreviewRowsPerPage);
  const visibleSheetJoinPreviewColumns = sheetJoinPreview
    ? sheetJoinPreview.headers.filter(header => sheetJoinVisibleColumns.includes(header))
    : [];

  return (
    <Box sx={{ position: 'relative', minHeight: 'calc(100vh - 64px)', px: { xs: 1.5, md: 3 }, py: { xs: 2, md: 3 }, bgcolor: Nn.pageBg, color: Nn.text, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Background Glow */}
      <Box
        sx={{
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '50%',
          opacity: 0.32,
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
      {/* Grid Pattern */}
      <Box className="auth-grid-pattern" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.35, zIndex: 0 }} />

      {/* Main Glassmorphic Wizard Card */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          width: 'min(1100px, calc(100vw - 32px))',
          minHeight: '580px',
          borderRadius: '22px',
          border: `1px solid ${Nn.cardBorder}`,
          background: Nn.cardBg,
          backdropFilter: 'blur(28px)',
          boxShadow: Nn.modalShadow,
          color: Nn.text,
          p: { xs: 2.5, md: 3.5 },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}
      >
        {/* Top Header & Progress */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
              <Typography variant="h5" fontWeight="800" sx={{ color: Nn.text, letterSpacing: '-0.02em', fontSize: '1.4rem' }}>
                Upload Files
              </Typography>
              <Chip
                label={wizardStep === 0 ? "Step 1 of 2 • Files" : "Step 2 of 2 • Options"}
                size="small"
                sx={{ height: 22, fontSize: '11px', fontWeight: 700, bgcolor: 'rgba(37, 99, 235, 0.2)', color: '#60a5fa', border: '1px solid rgba(37, 99, 235, 0.4)', borderRadius: '999px' }}
              />
            </Box>
            <Typography variant="caption" sx={{ color: Nn.muted, fontSize: '0.85rem' }}>
              Select client data & target template to begin automated mapping.
            </Typography>
          </Box>
          {/* Progress bar */}
          <Box sx={{ display: 'flex', gap: 0.5, width: 80, mt: 1 }}>
            <Box sx={{ height: 4, flex: 1, borderRadius: 2, bgcolor: '#2563eb' }} />
            <Box sx={{ height: 4, flex: 1, borderRadius: 2, bgcolor: wizardStep === 1 ? '#2563eb' : 'rgba(255,255,255,0.15)' }} />
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2.5, borderRadius: '12px' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2.5, borderRadius: '12px' }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {/* STEP 1: Files Selection */}
        {wizardStep === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
            <Grid container spacing={2.5}>
              {/* Client File Dropzone Column */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 700, fontSize: 14, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  Client File
                  <Chip label="Required" size="small" sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(37, 99, 235, 0.2)', color: '#60a5fa', fontWeight: 700 }} />
                </Typography>

                <Box
                  {...getUserRootProps()}
                  onMouseEnter={() => setIsUserHovered(true)}
                  onMouseLeave={() => setIsUserHovered(false)}
                  className="fw-upload-dropzone"
                  sx={{
                    border: userFile
                      ? `1.5px solid ${Nn.accent}`
                      : (isUserDragActive || isUserHovered)
                      ? `1.5px dashed ${Nn.accent}`
                      : `1.5px dashed ${Nn.inputBorder}`,
                    borderRadius: '16px',
                    py: 3.5,
                    px: 2.5,
                    textAlign: 'center',
                    cursor: 'pointer',
                    minHeight: 190,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                    background: (isUserDragActive || isUserHovered)
                      ? Nn.dropzoneActiveBg
                      : userFile
                      ? Nn.dropzoneSelectedBg
                      : Nn.dropzoneBg,
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  <input {...getUserInputProps()} />
                  <DropzoneFileStackIcon
                    color="#3b82f6"
                    glowColor="#22c55e"
                    selected={!!userFile}
                    isHovered={isUserDragActive || isUserHovered}
                    isDarkMode={isDarkMode}
                  />
                  <Typography variant="body1" sx={{ color: Nn.text, fontWeight: 700, fontSize: '0.95rem', mt: 0.5, mb: 0.25 }}>
                    {userFile ? userFile.name : 'Drag and drop or select files'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: Nn.muted, fontSize: '0.8rem', mb: 2 }}>
                    Supported files: .xlsx, .xls, .csv, .pdf
                  </Typography>
                  <Button
                    variant="contained"
                    size="small"
                    sx={{
                      bgcolor: isDarkMode ? 'rgba(255,255,255,0.12)' : '#ffffff',
                      color: isDarkMode ? '#ffffff' : '#1e293b',
                      fontWeight: 600,
                      borderRadius: '20px',
                      px: 2.5,
                      py: 0.7,
                      fontSize: '0.85rem',
                      textTransform: 'none',
                      border: isDarkMode ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(15,23,42,0.15)',
                      boxShadow: 'none',
                      '&:hover': {
                        bgcolor: isDarkMode ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                        boxShadow: 'none',
                        border: isDarkMode ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.25)'
                      }
                    }}
                  >
                    {userFile ? 'Change file' : 'Select files'}
                  </Button>
                </Box>

                {/* Client File Sheet & Columns Preview Card */}
                {userFile && (
                  <Box sx={{ mt: 1.5, p: 2, borderRadius: '14px', border: `1px solid ${Nn.panelBorder}`, bgcolor: Nn.panelBg, boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CheckCircleIcon sx={{ color: '#4ade80', fontSize: 18 }} />
                        <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 800, fontSize: 14 }}>
                          {userFile.name}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={() => setUserFile(null)} sx={{ color: Nn.muted, '&:hover': { color: Nn.text } }}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    {clientSheetNames.length > 0 && (
                      <Box sx={{ pt: 1, borderTop: `1px solid ${Nn.divider}` }}>
                        <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                          <Grid item xs={7}>
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ color: Nn.muted }}>Sheet Name</InputLabel>
                              <Select
                                value={selectedClientSheet}
                                label="Sheet Name"
                                onChange={(e) => handleClientSheetChange(e.target.value)}
                                MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                                sx={{ borderRadius: '8px' }}
                              >
                                {clientSheetNames.map(s => (
                                  <MenuItem key={s} value={s}>{s}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={5}>
                            <TextField
                              label="Header Row"
                              type="number"
                              size="small"
                              fullWidth
                              InputProps={{ inputProps: { min: 1 } }}
                              value={clientHeaderRow}
                              onChange={(e) => handleClientHeaderRowChange(e.target.value)}
                              sx={{ '& input': { borderRadius: '8px' } }}
                            />
                          </Grid>
                        </Grid>

                        {clientSheetNames.length > 1 && (
                          <Box sx={{ mb: 1.5 }}>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={combineSheetsMode}
                                  onChange={(e) => setCombineSheetsMode(e.target.checked)}
                                  size="small"
                                  sx={{ color: '#60a5fa', '&.Mui-checked': { color: '#3b82f6' } }}
                                />
                              }
                              label={
                                <Typography variant="body2" sx={{ color: Nn.tableText, fontSize: 13, fontWeight: 600 }}>
                                  Combine multiple sheets into one (same layout, e.g. one sheet per BOM)
                                </Typography>
                              }
                            />
                          </Box>
                        )}

                        {clientHeaderPreview.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Typography variant="caption" sx={{ color: Nn.muted, fontSize: 12, fontWeight: 600, display: 'block', mb: 0.75 }}>
                              {clientHeaderAutoDetected
                                ? `Header row auto-detected at row ${clientHeaderRow} — ${clientHeaderPreview.length} source columns found.`
                                : `${clientHeaderPreview.length} source columns found on row ${clientHeaderRow}.`}
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, maxHeight: showAllSourceColumns ? 220 : 90, overflowY: 'auto', py: 0.5 }}>
                              {(showAllSourceColumns ? clientHeaderPreview : clientHeaderPreview.slice(0, 12)).map((h, i) => (
                                <Chip
                                  key={`${h}-${i}`}
                                  size="small"
                                  variant="outlined"
                                  label={h.length > 22 ? `${h.slice(0, 22)}…` : h}
                                  sx={{ height: 24, fontSize: 11, bgcolor: a.surface.subtle, borderColor: a.border.default, color: Nn.tableText, fontWeight: 600 }}
                                />
                              ))}
                              {clientHeaderPreview.length > 12 && (
                                <Chip
                                  size="small"
                                  onClick={() => setShowAllSourceColumns(!showAllSourceColumns)}
                                  label={showAllSourceColumns ? 'Show less' : `+${clientHeaderPreview.length - 12} more`}
                                  sx={{ height: 24, fontSize: 11, bgcolor: 'rgba(37, 99, 235, 0.25)', color: '#60a5fa', fontWeight: 800, cursor: 'pointer' }}
                                />
                              )}
                            </Box>
                          </Box>
                        )}

                        {clientSheetNames.length > 1 && (
                          <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<AddIcon />}
                              onClick={() => {
                                const bSheet = selectedClientSheet || clientSheetNames[0];
                                const dSheet = clientSheetNames.find(s => s !== bSheet) || clientSheetNames[1] || '';
                                setSheetJoinConfig(prev => ({ ...prev, baseSheet: bSheet, detailSheet: dSheet }));
                                setSheetJoinStage('match');
                                setSheetJoinDialogOpen(true);
                              }}
                              sx={{ textTransform: 'none', borderRadius: '8px', fontSize: 12, fontWeight: 700, borderColor: 'rgba(96, 165, 250, 0.4)', color: '#60a5fa' }}
                            >
                              + MERGE SHEETS
                            </Button>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
              </Grid>

              {/* Template File Dropzone Column */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 700, fontSize: 14, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  Template File
                  <Chip label={userFile?.name?.toLowerCase().endsWith('.pdf') ? "Optional" : "Required"} size="small" sx={{ height: 20, fontSize: 11, bgcolor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', fontWeight: 700 }} />
                </Typography>

                <Box
                  {...getTemplateRootProps()}
                  onMouseEnter={() => setIsTemplateHovered(true)}
                  onMouseLeave={() => setIsTemplateHovered(false)}
                  className="fw-upload-dropzone"
                  sx={{
                    border: templateFile
                      ? `1.5px solid ${Nn.accent}`
                      : (isTemplateDragActive || isTemplateHovered)
                      ? `1.5px dashed ${Nn.accent}`
                      : `1.5px dashed ${Nn.inputBorder}`,
                    borderRadius: '16px',
                    py: 3.5,
                    px: 2.5,
                    textAlign: 'center',
                    cursor: 'pointer',
                    minHeight: 190,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                    background: (isTemplateDragActive || isTemplateHovered)
                      ? Nn.dropzoneActiveBg
                      : templateFile
                      ? Nn.dropzoneSelectedBg
                      : Nn.dropzoneBg,
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  <input {...getTemplateInputProps()} />
                  <DropzoneFileStackIcon
                    color="#38bdf8"
                    glowColor="#38bdf8"
                    selected={!!templateFile}
                    isHovered={isTemplateDragActive || isTemplateHovered}
                    isDarkMode={isDarkMode}
                  />
                  <Typography variant="body1" sx={{ color: Nn.text, fontWeight: 700, fontSize: '0.95rem', mt: 0.5, mb: 0.25 }}>
                    {templateFile ? templateFile.name : 'Drag and drop or select template'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: Nn.muted, fontSize: '0.8rem', mb: 2 }}>
                    Supported files: .xlsx, .xls, .csv
                  </Typography>
                  <Button
                    variant="contained"
                    size="small"
                    sx={{
                      bgcolor: isDarkMode ? 'rgba(255,255,255,0.12)' : '#ffffff',
                      color: isDarkMode ? '#ffffff' : '#1e293b',
                      fontWeight: 600,
                      borderRadius: '20px',
                      px: 2.5,
                      py: 0.7,
                      fontSize: '0.85rem',
                      textTransform: 'none',
                      border: isDarkMode ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(15,23,42,0.15)',
                      boxShadow: 'none',
                      '&:hover': {
                        bgcolor: isDarkMode ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                        boxShadow: 'none',
                        border: isDarkMode ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.25)'
                      }
                    }}
                  >
                    {templateFile ? 'Change template' : 'Select template'}
                  </Button>
                </Box>

                {/* Template File Sheet & Columns Preview Card */}
                {templateFile && (
                  <Box sx={{ mt: 1.5, p: 2, borderRadius: '14px', border: `1px solid ${Nn.panelBorder}`, bgcolor: Nn.panelBg, boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CheckCircleIcon sx={{ color: '#38bdf8', fontSize: 18 }} />
                        <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 800, fontSize: 14 }}>
                          {templateFile.name}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={() => setTemplateFile(null)} sx={{ color: Nn.muted, '&:hover': { color: Nn.text } }}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    {templateSheetNames.length > 0 && (
                      <Box sx={{ pt: 1, borderTop: `1px solid ${Nn.divider}` }}>
                        <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                          <Grid item xs={7}>
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ color: Nn.muted }}>Sheet Name</InputLabel>
                              <Select
                                value={selectedTemplateSheet}
                                label="Sheet Name"
                                onChange={(e) => handleTemplateSheetChange(e.target.value)}
                                MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                                sx={{ borderRadius: '8px' }}
                              >
                                {templateSheetNames.map(s => (
                                  <MenuItem key={s} value={s}>{s}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={5}>
                            <TextField
                              label="Header Row"
                              type="number"
                              size="small"
                              fullWidth
                              InputProps={{ inputProps: { min: 1 } }}
                              value={templateHeaderRow}
                              onChange={(e) => handleTemplateHeaderRowChange(e.target.value)}
                              sx={{ '& input': { borderRadius: '8px' } }}
                            />
                          </Grid>
                        </Grid>

                        {templateHeaderPreview.length > 0 && (
                          <Box sx={{ mb: 1.5 }}>
                            <Typography variant="caption" sx={{ color: Nn.muted, fontSize: 12, fontWeight: 600, display: 'block', mb: 0.75 }}>
                              {templateHeaderAutoDetected
                                ? `Header row auto-detected at row ${templateHeaderRow} — ${templateHeaderPreview.length} destination columns found.`
                                : `${templateHeaderPreview.length} destination columns found on row ${templateHeaderRow}.`}
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, maxHeight: showAllTemplateColumns ? 220 : 90, overflowY: 'auto', py: 0.5 }}>
                              {(showAllTemplateColumns ? templateHeaderPreview : templateHeaderPreview.slice(0, 12)).map((h, i) => (
                                <Chip
                                  key={`${h}-${i}`}
                                  size="small"
                                  variant="outlined"
                                  label={h.length > 22 ? `${h.slice(0, 22)}…` : h}
                                  sx={{ height: 24, fontSize: 11, bgcolor: a.surface.subtle, borderColor: a.border.default, color: Nn.tableText, fontWeight: 600 }}
                                />
                              ))}
                              {templateHeaderPreview.length > 12 && (
                                <Chip
                                  size="small"
                                  onClick={() => setShowAllTemplateColumns(!showAllTemplateColumns)}
                                  label={showAllTemplateColumns ? 'Show less' : `+${templateHeaderPreview.length - 12} more`}
                                  sx={{ height: 24, fontSize: 11, bgcolor: 'rgba(56, 189, 248, 0.25)', color: '#38bdf8', fontWeight: 800, cursor: 'pointer' }}
                                />
                              )}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
              </Grid>
            </Grid>

            {/* Step 1 Bottom Action Bar */}
            <Box sx={{ mt: 'auto', pt: 3, borderTop: `1px solid ${Nn.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: userFile ? '#60a5fa' : Nn.muted, fontWeight: 600 }}>
                {userFile ? '✓ Required files ready' : 'Select client file & template to proceed'}
              </Typography>
              <Button
                variant="contained"
                onClick={() => userFile ? setWizardStep(1) : setError('Please select a client file')}
                disabled={!userFile}
                sx={{
                  borderRadius: '20px',
                  fontWeight: 600,
                  px: 3.5,
                  py: 0.9,
                  textTransform: 'none',
                  bgcolor: userFile ? '#2563eb' : (isDarkMode ? 'rgba(255,255,255,0.06)' : '#e2e8f0'),
                  color: userFile ? '#ffffff' : (isDarkMode ? '#64748b' : '#94a3b8'),
                  border: userFile ? 'none' : (isDarkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.12)'),
                  boxShadow: userFile ? '0 4px 14px rgba(37, 99, 235, 0.35)' : 'none',
                  '&.Mui-disabled': {
                    bgcolor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#e2e8f0',
                    color: isDarkMode ? '#64748b' : '#94a3b8'
                  },
                  '&:hover': {
                    bgcolor: userFile ? '#1d4ed8' : (isDarkMode ? 'rgba(255,255,255,0.06)' : '#e2e8f0'),
                    boxShadow: userFile ? '0 6px 18px rgba(37, 99, 235, 0.45)' : 'none'
                  }
                }}
              >
                Next →
              </Button>
            </Box>
          </Box>
        )}

        {/* STEP 2: Choose Options (Mapping Template + Tag Template) */}
        {wizardStep === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
            <Grid container spacing={2.5}>
              {/* Mapping Template Panel */}
              <Grid item xs={12} md={6}>
                <Box sx={{ p: 2, borderRadius: '14px', border: `1px solid ${Nn.divider}`, bgcolor: Nn.subtlePanelBg, height: '100%' }}>
                  <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 700, mb: 0.5 }}>
                    Mapping Template <Typography component="span" variant="caption" sx={{ color: Nn.muted, fontWeight: 400 }}>(Optional)</Typography>
                  </Typography>
                  <Typography variant="caption" sx={{ color: Nn.muted, display: 'block', mb: 1.5 }}>
                    Apply saved header column mappings.
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search mapping templates..."
                    value={templateSearchTerm}
                    onChange={(e) => setTemplateSearchTerm(e.target.value)}
                    InputProps={{ startAdornment: <SearchIcon sx={{ color: Nn.muted, mr: 1, fontSize: 16 }} /> }}
                    sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' } }}
                  />
                  {selectedTemplate && (
                    <Alert severity="success" sx={{ mb: 1.5, borderRadius: '10px', py: 0.5 }}
                      action={<Button color="inherit" size="small" onClick={() => setSelectedTemplate(null)}><CloseIcon fontSize="small" /></Button>}>
                      <Typography variant="caption" fontWeight="700">{selectedTemplate.name}</Typography>
                    </Alert>
                  )}
                  {availableTemplates.length > 0 ? (
                    <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {availableTemplates
                        .filter(tmpl => tmpl.name.toLowerCase().includes(templateSearchTerm.toLowerCase()))
                        .map(tmpl => (
                          <Box
                            key={tmpl.id}
                            onClick={() => setSelectedTemplate(tmpl)}
                            sx={{
                              p: 1.25,
                              borderRadius: '9px',
                              border: selectedTemplate?.id === tmpl.id ? `1.5px solid ${Nn.accent}` : `1px solid ${Nn.divider}`,
                              bgcolor: selectedTemplate?.id === tmpl.id ? 'rgba(37, 99, 235, 0.15)' : Nn.inputBg,
                              cursor: 'pointer',
                              transition: 'all 0.18s ease',
                              '&:hover': { borderColor: Nn.accent }
                            }}
                          >
                            <Typography variant="body2" fontWeight="700" sx={{ color: Nn.text, fontSize: '12px' }}>{tmpl.name}</Typography>
                            <Typography variant="caption" sx={{ color: Nn.muted }}>{tmpl.total_mappings || 0} mappings</Typography>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="caption" sx={{ color: Nn.muted }}>No mapping templates available.</Typography>
                  )}
                </Box>
              </Grid>

              {/* Tag Template Panel */}
              <Grid item xs={12} md={6}>
                <Box sx={{ p: 2, borderRadius: '14px', border: `1px solid ${Nn.divider}`, bgcolor: Nn.subtlePanelBg, height: '100%' }}>
                  <Typography variant="subtitle2" sx={{ color: Nn.text, fontWeight: 700, mb: 0.5 }}>
                    Tag Template <Typography component="span" variant="caption" sx={{ color: Nn.muted, fontWeight: 400 }}>(Optional)</Typography>
                  </Typography>
                  <Typography variant="caption" sx={{ color: Nn.muted, display: 'block', mb: 1.5 }}>
                    Auto-apply smart tag formula rules.
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search tag templates..."
                    value={tagTemplateSearchTerm}
                    onChange={(e) => setTagTemplateSearchTerm(e.target.value)}
                    InputProps={{ startAdornment: <SearchIcon sx={{ color: Nn.muted, mr: 1, fontSize: 16 }} /> }}
                    sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '13px' } }}
                  />
                  {selectedTagTemplate && (
                    <Alert severity="success" sx={{ mb: 1.5, borderRadius: '10px', py: 0.5 }}
                      action={<Button color="inherit" size="small" onClick={() => { setSelectedTagTemplate(null); setFormulaRules([]); }}><CloseIcon fontSize="small" /></Button>}>
                      <Typography variant="caption" fontWeight="700">{selectedTagTemplate.name}</Typography>
                    </Alert>
                  )}
                  {availableTagTemplates.length > 0 ? (
                    <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {availableTagTemplates
                        .filter(tmpl => tmpl.name.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase()))
                        .map(tmpl => (
                          <Box
                            key={tmpl.id}
                            onClick={() => { setSelectedTagTemplate(tmpl); setFormulaRules(tmpl.formula_rules || []); }}
                            sx={{
                              p: 1.25,
                              borderRadius: '9px',
                              border: selectedTagTemplate?.id === tmpl.id ? `1.5px solid rgba(168, 85, 247, 0.7)` : `1px solid ${Nn.divider}`,
                              bgcolor: selectedTagTemplate?.id === tmpl.id ? 'rgba(168, 85, 247, 0.12)' : Nn.inputBg,
                              cursor: 'pointer',
                              transition: 'all 0.18s ease',
                              '&:hover': { borderColor: 'rgba(168, 85, 247, 0.5)' }
                            }}
                          >
                            <Typography variant="body2" fontWeight="700" sx={{ color: Nn.text, fontSize: '12px' }}>{tmpl.name}</Typography>
                            <Typography variant="caption" sx={{ color: Nn.muted }}>{tmpl.rules?.length || tmpl.formula_rules?.length || 0} rules</Typography>
                          </Box>
                        ))}
                    </Box>
                  ) : (
                    <Typography variant="caption" sx={{ color: Nn.muted }}>No tag templates available.</Typography>
                  )}
                </Box>
              </Grid>
            </Grid>

            {/* Step 2 Bottom Action Bar */}
            <Box sx={{ mt: 'auto', pt: 2, borderTop: `1px solid ${Nn.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button variant="outlined" onClick={() => setWizardStep(0)} sx={{ borderRadius: '10px', textTransform: 'none', color: Nn.text, borderColor: Nn.divider }}>
                ← Back
              </Button>
              <Button
                className="gradient-btn"
                variant="contained"
                onClick={handleUpload}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ borderRadius: '10px', fontWeight: 700, px: 4, py: 0.9, textTransform: 'none' }}
              >
                {loading ? 'Processing...' : 'Process Upload →'}
              </Button>
            </Box>
          </Box>
        )}
      </Box>



      <Dialog
        open={sheetJoinDialogOpen}
        onClose={handleCloseSheetJoinSetup}
        fullScreen={sheetJoinStage === 'preview'}
        maxWidth={sheetJoinStage === 'preview' ? false : 'md'}
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight="600">
              Merge Sheets
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Merge related sheet data before template mapping
            </Typography>
          </Box>
          <IconButton onClick={handleCloseSheetJoinSetup}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {sheetJoinStage === 'match' && (
            <Grid container spacing={2.5}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Primary sheet</InputLabel>
                  <Select
                    label="Primary sheet"
                    value={sheetJoinConfig.baseSheet}
                    onChange={(event) => {
                      const baseSheet = event.target.value;
                      const baseHeaders = getSheetHeaders(baseSheet, sheetJoinConfig.baseHeaderRow);
                      const baseKey = '';
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        baseSheet,
                        baseKey,
                        uniqueIdBaseColumn: baseKey,
                        copiedBaseColumns: defaultCopiedBaseColumns(baseHeaders)
                      }));
                    }}
                  >
                    {clientSheetNames.map(sheet => (
                      <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Secondary sheet</InputLabel>
                  <Select
                    label="Secondary sheet"
                    value={sheetJoinConfig.detailSheet}
                    onChange={(event) => {
                      const detailSheet = event.target.value;
                      const detailHeaders = getSheetHeaders(detailSheet, sheetJoinConfig.detailHeaderRow);
                      const detailKey = guessKeyColumn(detailHeaders);
                      const detailColumns = defaultDetailColumns(detailHeaders, detailKey);
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        detailSheet,
                        detailKey,
                        detailColumns,
                        uniqueIdDetailColumn: detailColumns[0] || detailKey
                      }));
                    }}
                  >
                    {clientSheetNames.map(sheet => (
                      <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Header row in primary sheet"
                  value={sheetJoinConfig.baseHeaderRow}
                  onChange={(event) => {
                    const baseHeaderRow = Math.max(1, Number(event.target.value || 1));
                    const headers = getSheetHeaders(sheetJoinConfig.baseSheet, baseHeaderRow);
                    const baseKey = '';
                    setSheetJoinConfig(prev => ({
                      ...prev,
                      baseHeaderRow,
                      baseKey,
                      uniqueIdBaseColumn: baseKey,
                      copiedBaseColumns: defaultCopiedBaseColumns(headers)
                    }));
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Header row in secondary sheet"
                  value={sheetJoinConfig.detailHeaderRow}
                  onChange={(event) => {
                    const detailHeaderRow = Math.max(1, Number(event.target.value || 1));
                    const headers = getSheetHeaders(sheetJoinConfig.detailSheet, detailHeaderRow);
                    const detailKey = guessKeyColumn(headers);
                    const detailColumns = defaultDetailColumns(headers, detailKey);
                    setSheetJoinConfig(prev => ({
                      ...prev,
                      detailHeaderRow,
                      detailKey,
                      detailColumns,
                      uniqueIdDetailColumn: detailColumns[0] || detailKey
                    }));
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Common column to match on</InputLabel>
                  <Select
                    label="Common column to match on"
                    value={sheetJoinConfig.baseKey}
                    onChange={(event) => setSheetJoinConfig(prev => ({
                      ...prev,
                      baseKey: event.target.value,
                      uniqueIdBaseColumn: event.target.value
                    }))}
                  >
                    {sheetJoinBaseHeaders.map(header => (
                      <MenuItem key={header} value={header}>{header}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Matching column in secondary sheet</InputLabel>
                  <Select
                    label="Matching column in secondary sheet"
                    value={sheetJoinConfig.detailKey}
                    onChange={(event) => {
                      const detailKey = event.target.value;
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        detailKey,
                        detailColumns: prev.detailColumns.filter(column => column !== detailKey),
                        uniqueIdDetailColumn: prev.uniqueIdDetailColumn || detailKey
                      }));
                    }}
                  >
                    {sheetJoinDetailHeaders.map(header => (
                      <MenuItem key={header} value={header}>{header}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          )}

          {sheetJoinStage === 'options' && (
            <Grid container spacing={2.5}>
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="600" gutterBottom>
                  Output format
                </Typography>
                <RadioGroup
                  row
                  value={sheetJoinConfig.outputMode}
                  onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, outputMode: event.target.value }))}
                >
                  <FormControlLabel value="grouped" control={<Radio size="small" />} label={`Add all related ${sheetJoinDetailLabel} in the same cell`} />
                  <FormControlLabel value="expanded" control={<Radio size="small" />} label={`Create a separate row for each ${sheetJoinDetailSingularLabel}`} />
                </RadioGroup>
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight="600">
                    Columns to bring from secondary sheet
                  </Typography>
                  <Box>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({
                      ...prev,
                      detailColumns: sheetJoinDetailHeaders.filter(header => header !== prev.detailKey)
                    }))}>
                      Select all
                    </Button>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({ ...prev, detailColumns: [] }))}>
                      Clear
                    </Button>
                  </Box>
                </Box>
                {sheetJoinLegacyHeaderWarning && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    This older saved merge book only contains the secondary columns that were saved in its preview. Reopen or re-upload the original workbook to choose every secondary-sheet column.
                  </Alert>
                )}
                <FormGroup row sx={{ gap: 0.5 }}>
                  {sheetJoinDetailHeaders
                    .filter(header => header !== sheetJoinConfig.detailKey)
                    .map(header => (
                      <FormControlLabel
                        key={header}
                        control={
                          <Checkbox
                            size="small"
                            checked={sheetJoinConfig.detailColumns.includes(header)}
                            onChange={(event) => {
                              setSheetJoinConfig(prev => ({
                                ...prev,
                                detailColumns: event.target.checked
                                  ? [...prev.detailColumns, header]
                                  : prev.detailColumns.filter(column => column !== header)
                              }));
                            }}
                          />
                        }
                        label={header}
                      />
                    ))}
                </FormGroup>
              </Grid>

            </Grid>
          )}

          {sheetJoinStage === 'preview' && sheetJoinPreview && (
            <Box>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={6} md={3}>
                  <Chip
                    label={`${sheetJoinPreview.summary.outputRows} output rows`}
                    color={sheetJoinPreviewFilter === 'all' ? 'primary' : 'default'}
                    variant={sheetJoinPreviewFilter === 'all' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('all');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Chip
                    color="success"
                    label={`${sheetJoinPreview.summary.matchedBaseRows} matched`}
                    variant={sheetJoinPreviewFilter === 'matched' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('matched');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Chip
                    color="warning"
                    label={`${sheetJoinPreview.summary.unmatchedBaseRows} unmatched`}
                    variant={sheetJoinPreviewFilter === 'unmatched' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('unmatched');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}><Chip label={`${sheetJoinPreview.summary.orphanDetailKeys} secondary-only keys`} /></Grid>
              </Grid>
              <Alert severity="info" sx={{ mb: 2 }}>
                Preview keeps the full merged data. Showing {visibleSheetJoinPreviewRows.length ? sheetJoinPreviewStart + 1 : 0}-{Math.min(sheetJoinPreviewStart + visibleSheetJoinPreviewRows.length, sheetJoinFilteredPreviewRows.length)} of {sheetJoinFilteredPreviewRows.length} rows to keep the page responsive.
              </Alert>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={sheetJoinPreviewPage === 0}
                  onClick={() => setSheetJoinPreviewPage(page => Math.max(0, page - 1))}
                >
                  Previous
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Page {sheetJoinPreviewPage + 1} of {sheetJoinPreviewTotalPages}
                </Typography>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Visible columns</InputLabel>
                  <Select
                    multiple
                    label="Visible columns"
                    value={sheetJoinVisibleColumns}
                    onChange={(event) => {
                      const value = event.target.value;
                      const selected = (typeof value === 'string' ? value.split(',') : value).filter(column => column !== '__all__');
                      setSheetJoinVisibleColumns(selected);
                    }}
                    renderValue={(selected) => `${selected.length} columns shown`}
                  >
                    <MenuItem
                      value="__all__"
                      onClick={(event) => {
                        event.preventDefault();
                        setSheetJoinVisibleColumns(sheetJoinPreview.headers);
                      }}
                    >
                      <Checkbox checked={sheetJoinVisibleColumns.length === sheetJoinPreview.headers.length} />
                      Show all columns
                    </MenuItem>
                    {sheetJoinPreview.headers.map(header => (
                      <MenuItem key={header} value={header}>
                        <Checkbox checked={sheetJoinVisibleColumns.includes(header)} />
                        {header}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={sheetJoinPreviewPage >= sheetJoinPreviewTotalPages - 1}
                  onClick={() => setSheetJoinPreviewPage(page => Math.min(sheetJoinPreviewTotalPages - 1, page + 1))}
                >
                  Next
                </Button>
              </Box>
              <Box sx={{ height: 'calc(100vh - 260px)', overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                <Box component="table" sx={{ width: 'max-content', minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', '& th, & td': { borderBottom: '1px solid #eee', p: 0.75 }, '& th': { position: 'sticky', top: 0, backgroundColor: '#fafafa', zIndex: 1, textAlign: 'left' } }}>
                  <Box component="thead">
                    <Box component="tr">
                      {visibleSheetJoinPreviewColumns.map(header => (
                        <Box
                          component="th"
                          key={header}
                          sx={{
                            width: sheetJoinColumnWidths[header] || 180,
                            minWidth: sheetJoinColumnWidths[header] || 180,
                            maxWidth: sheetJoinColumnWidths[header] || 180,
                            position: 'relative',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pr: 2
                          }}
                        >
                          {header}
                          <Box
                            onMouseDown={(event) => handleSheetJoinColumnResize(header, event)}
                            sx={{
                              position: 'absolute',
                              top: 0,
                              right: 0,
                              width: 8,
                              height: '100%',
                              cursor: 'col-resize',
                              borderRight: '2px solid transparent',
                              '&:hover': { borderRightColor: 'primary.main' }
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {visibleSheetJoinPreviewRows.map(({ row, index: rowIndex }) => {
                      return (
                      <Box component="tr" key={`preview-row-${rowIndex}`}>
                        {visibleSheetJoinPreviewColumns.map(header => (
                          <Box
                            component="td"
                            key={`${rowIndex}-${header}`}
                            sx={{
                              width: sheetJoinColumnWidths[header] || 180,
                              minWidth: sheetJoinColumnWidths[header] || 180,
                              maxWidth: sheetJoinColumnWidths[header] || 180
                            }}
                          >
                            <Box
                              component="input"
                              value={row[header] ?? ''}
                              onChange={(event) => handleSheetJoinPreviewCellChange(rowIndex, header, event.target.value)}
                              sx={{
                                width: '100%',
                                border: 'none',
                                outline: 'none',
                                backgroundColor: 'transparent',
                                font: 'inherit',
                                p: 0,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            />
                          </Box>
                        ))}
                      </Box>
                    );})}
                  </Box>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleCloseSheetJoinSetup}>
            Cancel
          </Button>
          {sheetJoinStage !== 'match' && (
            <Button onClick={() => setSheetJoinStage(sheetJoinStage === 'preview' ? 'options' : 'match')}>
              Back
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button onClick={handleDownloadSheetJoinPreview}>
              Download Preview
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button variant="outlined" onClick={handleContinueWithBomMapping}>
              Continue with BOM mapping
            </Button>
          )}
          {sheetJoinStage === 'match' && (
            <Button
              variant="contained"
              onClick={handleProceedSheetJoinOptions}
              disabled={!sheetJoinConfig.baseKey || !sheetJoinConfig.detailKey || sheetJoinConfig.baseSheet === sheetJoinConfig.detailSheet}
            >
              Proceed
            </Button>
          )}
          {sheetJoinStage === 'options' && (
            <Button
              variant="contained"
              onClick={handlePreviewSheetJoin}
              disabled={sheetJoinConfig.detailColumns.length === 0}
            >
              Preview
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button
              variant="contained"
              onClick={() => {
                setSheetJoinSaveName(sheetJoinConfig.relationshipName || `Merge ${new Date().toLocaleString()}`);
                setSheetJoinSaveDialogOpen(true);
              }}
            >
              Save Merge Book
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={sheetJoinSaveDialogOpen}
        onClose={() => !sheetJoinSaveLoading && setSheetJoinSaveDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Save Merge Book</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Name this merge book so you can reopen it later and continue BOM mapping from it.
          </DialogContentText>
          <TextField
            fullWidth
            required
            autoFocus
            margin="normal"
            label="Merge Book Name"
            value={sheetJoinSaveName}
            onChange={(event) => setSheetJoinSaveName(event.target.value)}
            error={!sheetJoinSaveName.trim()}
            helperText={!sheetJoinSaveName.trim() ? 'Merge book name is required' : 'This saves the generated merge book.'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSheetJoinSaveDialogOpen(false)} disabled={sheetJoinSaveLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveComparisonWithName}
            disabled={sheetJoinSaveLoading || !sheetJoinSaveName.trim()}
          >
            {sheetJoinSaveLoading ? 'Saving...' : 'Save Merge Book'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={sheetJoinDuplicateDialogOpen}
        onClose={() => !sheetJoinSaveLoading && setSheetJoinDuplicateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Merge Book Name Already Exists</DialogTitle>
        <DialogContent>
          <DialogContentText>
            A merge book named "{pendingSheetJoinDuplicate?.name}" is already saved. Replace the old one or keep both by saving this as a copy.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSheetJoinDuplicateDialogOpen(false);
              setPendingSheetJoinDuplicate(null);
            }}
            disabled={sheetJoinSaveLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSaveComparisonAsCopy} disabled={sheetJoinSaveLoading}>
            Save as Copy
          </Button>
          <Button variant="contained" color="warning" onClick={handleOverrideSavedComparison} disabled={sheetJoinSaveLoading}>
            Override
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={sheetJoinToastOpen}
        autoHideDuration={3500}
        onClose={() => setSheetJoinToastOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSheetJoinToastOpen(false)} sx={{ width: '100%' }}>
          Step 7 completed
        </Alert>
      </Snackbar>

      {/* Template Compatibility Error Modal */}
      <Dialog 
        open={compatibilityErrorOpen} 
        onClose={handleCloseCompatibilityError}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center', 
          gap: 2,
          backgroundColor: '#fff3e0'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <WarningIcon color="warning" fontSize="large" />
            <Typography variant="h6" fontWeight="600" color="warning.main">
              Template Compatibility Issue
            </Typography>
          </Box>
          <IconButton onClick={handleCloseCompatibilityError}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ pt: 3 }}>
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="600" gutterBottom>
              Template "{compatibilityErrorData?.templateName}" is not fully compatible with your uploaded files.
            </Typography>
            <Typography variant="body2">
              {compatibilityErrorData?.message}
            </Typography>
          </Alert>

          {compatibilityErrorData?.compatibilityDetails && (
            <Card variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#fafafa' }}>
              <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                Compatibility Details:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Template expects: <strong>{compatibilityErrorData.compatibilityDetails.total_template_columns}</strong> columns
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Successfully matched: <strong>{compatibilityErrorData.compatibilityDetails.matched_columns}</strong> columns
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Compatibility rate: <strong>{Math.round(compatibilityErrorData.compatibilityDetails.success_rate * 100)}%</strong>
              </Typography>
            </Card>
          )}

          <Typography variant="body1" sx={{ mb: 2 }}>
            What would you like to do?
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#ff9800' }
              }}
              onClick={handleContinueAnyway}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <PlayArrowIcon color="warning" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Continue Anyway
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Proceed to mapping page where you can manually create the missing mappings
                  </Typography>
                </Box>
              </Box>
            </Card>
            
            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#1976d2' }
              }}
              onClick={handleTryDifferentTemplate}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <LibraryBooksIcon color="primary" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Try Different Template
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Go back and select a different template that might be more compatible
                  </Typography>
                </Box>
              </Box>
            </Card>

            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#4caf50' }
              }}
              onClick={handleUploadWithoutTemplate}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CloudUploadIcon color="success" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Upload Without Template
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Start fresh and create custom mappings from scratch
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Box>
        </DialogContent>
        
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={handleCloseCompatibilityError}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* PDF Processing Choice Dialog */}
      <Dialog
        open={pdfChoiceDialogOpen}
        onClose={() => setPdfChoiceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ScienceIcon color="primary" />
            Choose PDF Processing Method
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 3 }}>
            How would you like to process your PDF? Choose the method that best fits your document:
          </Typography>

          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': {
                    border: '2px solid #1976d2',
                    bgcolor: 'primary.50'
                  }
                }}
                onClick={() => handlePdfProcessingChoice('ocr')}
              >
                <CardContent sx={{ textAlign: 'center', p: 3 }}>
                  <PlayArrowIcon sx={{ fontSize: 48, color: 'success.main', mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Simple OCR
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    For standard documents with clear, linear layout. Faster processing with automatic table detection.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': {
                    border: '2px solid #1976d2',
                    bgcolor: 'primary.50'
                  }
                }}
                onClick={() => handlePdfProcessingChoice('compare')}
              >
                <CardContent sx={{ textAlign: 'center', p: 3 }}>
                  <TrendingUpIcon sx={{ fontSize: 48, color: 'info.main', mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Compare
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Runs native extraction and Azure OCR, then chooses the cleaner result for mapping.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': {
                    border: '2px solid #1976d2',
                    bgcolor: 'primary.50'
                  }
                }}
                onClick={() => handlePdfProcessingChoice('zonal')}
              >
                <CardContent sx={{ textAlign: 'center', p: 3 }}>
                  <SearchIcon sx={{ fontSize: 48, color: 'warning.main', mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Zone Mapping
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    For complex BOMs or documents with irregular layouts. Manual zone selection for precise extraction.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPdfChoiceDialogOpen(false)}
            color="secondary"
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Primary Column Cleanup Dialog */}
      <Dialog
        open={primaryColumnDialogOpen}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScienceIcon color="primary" />
          <Typography variant="h6" fontWeight="600">Select Primary Column</Typography>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the column that should always have data. Rows where this column is empty
            will be removed (cleans up merged cells, notes, and junk rows).
          </Typography>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Primary Column</InputLabel>
            <Select
              value={selectedPrimaryColumn}
              label="Primary Column"
              onChange={(e) => setSelectedPrimaryColumn(e.target.value)}
            >
              {primaryColumnHeaders.map(h => (
                <MenuItem key={h} value={h}>{h}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {cleanupResult && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Removed {cleanupResult.rows_deleted} empty rows ({cleanupResult.total_rows_before} → {cleanupResult.total_rows_after} rows)
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleSkipCleanup} color="inherit">
            Skip
          </Button>
          <Button
            onClick={handleCleanup}
            variant="contained"
            disabled={!selectedPrimaryColumn || cleanupLoading}
            startIcon={cleanupLoading ? <CircularProgress size={16} /> : null}
          >
            {cleanupLoading ? 'Cleaning...' : 'Clean & Continue'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Loader Overlay */}
      <LoaderOverlay visible={globalLoading} label="Processing..." />
    </Box>
  );
};

export default UploadFiles;
