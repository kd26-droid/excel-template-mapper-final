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
  LinearProgress
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
  Sync as SyncIcon
} from '@mui/icons-material';
import api from '../services/api';
import FormulaBuilder from './FormulaBuilder';
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

  // Create Factwise ID state
  const [factwiseIdDialogOpen, setFactwiseIdDialogOpen] = useState(false);
  const [firstColumn, setFirstColumn] = useState('');
  const [secondColumn, setSecondColumn] = useState('');
  const [operator, setOperator] = useState('_');
  
  // Store factwise ID rule for template saving
  const [factwiseIdRule, setFactwiseIdRule] = useState(null);
  
  // Column counts for template integration
  const [dynamicColumnCounts, setDynamicColumnCounts] = useState({
    tags_count: 1,
    spec_pairs_count: 1,
    customer_id_pairs_count: 1
  });

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
        console.log('🔄 Sync operation completed:', data.operation);
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
      // Add timeout for large datasets - give more time for larger page sizes
      const timeoutMs = size >= 5000 ? 120000 : (size > 1000 ? 60000 : (size > 500 ? 30000 : 15000));
      showSnackbar(size > 1000 ? `Loading ${size} rows, this may take a moment...` : '', 'info');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const resp = await api.getMappedDataWithSpecs(sessionId, targetPage, size, true, { 
        force_fresh: true, 
        _fresh: Date.now(),
        signal: controller.signal,
        timeoutMs
      });
      clearTimeout(timeoutId);
      
      const payload = resp?.data || {};
      const headers = payload.headers || [];
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const pg = payload.pagination || { page: targetPage, total_pages: 1, total_rows: rows.length };

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
            headerName: (col.startsWith('Tag_') || col === 'Tag') ? 'Tag'
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
      if (e.name === 'AbortError') {
        showSnackbar(`Loading timed out for ${size} rows. Try a smaller page size.`, 'error');
      } else {
        showSnackbar(`Failed to load page ${targetPage}: ${e.message}`, 'error');
      }
    } finally {
      setPageLoading(false);
    }
  }, [sessionId, page, pageSize, columnDefs, showSnackbar]);

  // ─── ENHANCED DATA LOADING WITH SYNCHRONIZATION ─────────────────────────────
  const initializeData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🚀 Initializing Enhanced Data Editor for session:', sessionId);
      
      // Check for smart tag rules from dashboard
      const smartTagRulesFromDashboard = location.state?.smartTagFormulaRules;
      
      if (smartTagRulesFromDashboard && smartTagRulesFromDashboard.length > 0) {
        console.log('📋 Applying smart tag rules from dashboard...');
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
      console.log('🔄 Fetching data with synchronization...');
      
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

      // Prune completely blank Specification pairs ONLY when we have full dataset
      const hasAllRows = !data.pagination || (data.pagination.total_pages || 1) <= 1 || (Array.isArray(data.data) && data.pagination?.total_rows === data.data.length);
      const { headers: viewHeaders, rows: viewRows } = hasAllRows
        ? pruneEmptySpecificationPairs(data.headers || [], data.data || [])
        : { headers: (data.headers || []), rows: (data.data || []) };

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
          if (col.startsWith('Tag_') || col === 'Tag') {
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
            headerClass: isFormulaColumn ? 'ag-header-formula' : isUnmapped ? 'ag-header-unmapped' : isSpecificationColumn ? 'ag-header-specification' : 'ag-header-cell-excel',
            headerTooltip: isFormulaColumn 
              ? `${col} - Formula-generated column` 
              : isUnmapped 
                ? `${col} - Unmapped Column (No data source)` 
                : isSpecificationColumn 
                  ? `${col} - Specification Column` 
                  : col,
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
      if (needTags && !hasTag) return false;
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
                headerName: (col.startsWith('Tag_') || col === 'Tag') ? 'Tag'
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
  const handleCreateFactwiseIdSynchronized = useCallback(async () => {
    if (!firstColumn || !secondColumn) {
      showSnackbar('Please select both columns for creating Factwise ID', 'error');
      return;
    }

    try {
      // Determine strategy
      const itemCodeCol = columnDefs.find(c => (c.headerName || c.field).toLowerCase() === 'item code' || (c.headerName || c.field).toLowerCase() === 'item_code');
      let strategy = 'fill_only_null';
      if (itemCodeCol) {
        const hasExisting = rowData.some(r => {
          const v = r[itemCodeCol.field];
          return v !== null && v !== undefined && String(v).trim() !== '';
        });
        if (hasExisting) {
          const choice = window.prompt('Current values exist in "Item Code". Type:\n1 to Fill only null\n2 to Override all\n3 to Cancel');
          if (choice === '3' || choice === null) return;
          if (choice === '2') strategy = 'override_all';
        }
      }

      setLoading(true);
      
      const syncResult = await synchronizer.current.createFactWiseIdSynchronized(
        firstColumn, 
        secondColumn, 
        operator, 
        strategy
      );

      if (syncResult.success) {
        setFactwiseIdRule({ firstColumn, secondColumn, operator, strategy });
        
        // Update local data with validation data
        if (syncResult.validationData && syncResult.validationData.success) {
          const validatedData = syncResult.validationData.data;
          updateDataIntegrity(true, []);
          
          // Refresh column definitions and data
          await fetchDataSynchronized();
        }
        
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
  }, [firstColumn, secondColumn, operator, showSnackbar, fetchDataSynchronized, columnDefs, rowData, updateDataIntegrity]);

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
        }
        
        // Handle factwise ID rule if present
        if (template.factwise_rules && template.factwise_rules.length > 0) {
          const factwiseRule = template.factwise_rules.find(rule => rule.type === "factwise_id");
          if (factwiseRule) {
            const { first_column, second_column, operator } = factwiseRule;
            await synchronizer.current.createFactWiseIdSynchronized(first_column, second_column, operator);
            
            setFactwiseIdRule({
              firstColumn: first_column,
              secondColumn: second_column,
              operator: operator
            });
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
    setFirstColumn('');
    setSecondColumn('');
    setOperator('_');
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
      const resp = await api.saveMappingTemplate(
        sessionId,
        templateName.trim(),
        `Saved from Data Editor (${rules.length} tag rules)`,
        null,
        rules,
        null,
        Object.keys(defaults).length > 0 ? defaults : null,
        counts
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
  }, [sessionId, templateName, dynamicColumnCounts, defaultValues, appliedFormulas, showSnackbar, handleCloseSaveTemplateDialog]);

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
      showSnackbar('Cell updated - changes not saved yet', 'info');
    }
  }, [rowData, columnDefs, showSnackbar]);

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
    
    console.log('🔄 Persisting column counts before navigation:', columnCounts);
    try {
      await api.updateColumnCounts(sessionId, columnCounts);
      console.log('✅ Column counts persisted successfully');
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

            {/* Second Row - Action Buttons */}
            <Box sx={{ 
              display: 'flex', 
              gap: 2, 
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <Tooltip title="Add Tags - Automatically tag your components with synchronization">
                <span>
                  <Button
                    onClick={handleOpenFormulaBuilder}
                    variant="contained"
                    startIcon={<AutoAwesomeIcon />}
                    disabled={syncStatus.inProgress}
                    sx={{ 
                      backgroundColor: '#9c27b0',
                      color: 'white',
                      '&:hover': { backgroundColor: '#7b1fa2' },
                      textTransform: 'none',
                      fontWeight: 600
                    }}
                  >
                    Add Tags
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title="Save current state as a reusable template">
                <span>
                  <Button
                    onClick={handleOpenSaveTemplateDialog}
                    variant="contained"
                    startIcon={<TemplateIcon />}
                    disabled={syncStatus.inProgress}
                    sx={{
                      backgroundColor: '#6a1b9a',
                      color: 'white',
                      '&:hover': { backgroundColor: '#4a148c' },
                      textTransform: 'none',
                      fontWeight: 600
                    }}
                  >
                    Save Template
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title="Download processed file">
                <span>
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
                      fontWeight: 600
                    }}
                  >
                    Download File
                  </Button>
                </span>
              </Tooltip>

              {/* Download original removed per request */}

              <Tooltip title="Create FactWise ID - Synchronized column combination">
                <span>
                  <Button
                    onClick={handleOpenFactwiseIdDialog}
                    variant="contained"
                    startIcon={<BadgeIcon />}
                    disabled={syncStatus.inProgress}
                    sx={{ 
                      backgroundColor: '#2e7d32',
                      color: 'white',
                      '&:hover': { backgroundColor: '#1b5e20' },
                      textTransform: 'none',
                      fontWeight: 600
                    }}
                  >
                    Create FactWise ID
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title="View visual column mapping representation">
                <Button
                  onClick={() => {
                    sessionStorage.setItem('navigatedFromDataEditor', 'true');
                    navigate(`/mapping/${sessionId}`);
                  }}
                  variant="outlined"
                  startIcon={<MapIcon />}
                  sx={{
                    color: '#2196f3',
                    borderColor: '#2196f3',
                    '&:hover': {
                      backgroundColor: 'rgba(33,150,243,0.1)',
                      borderColor: '#2196f3'
                    },
                    textTransform: 'none',
                    fontWeight: 600
                  }}
                >
                  View Column Mapping
                </Button>
              </Tooltip>
            </Box>

          </Box>
        </Container>
      </Paper>

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
                  {columnDefs.map(col => {
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
                    {columnDefs.map((col, index) => (
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
                        {col.headerName}
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
                  {rowData.map((row, realIndex) => {
                    return (
                      <tr key={realIndex} style={{
                        backgroundColor: realIndex % 2 === 0 ? '#f8f9fa' : 'white',
                        height: `${rowHeight}px`
                      }}>
                        {columnDefs.map((col, colIndex) => {
                          const raw = row[col.field];
                          const cellValue = raw == null ? '' : String(raw);
                          const isUnknown = cellValue.toLowerCase() === 'unknown';
                          return (
                            <td key={`${col.field}-${realIndex}`} style={{
                              padding: '12px 16px',
                              border: '1px solid #e9ecef',
                              backgroundColor: isUnknown ? '#ffebee' : (realIndex % 2 === 0 ? '#f8f9fa' : 'white'),
                              color: isUnknown ? '#c62828' : 'inherit',
                              fontWeight: isUnknown ? '500' : 'normal',
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
        availableColumns={columnDefs.filter(col => col.field && col.field !== '__row_number__').map(col => col.field || col.headerName).filter(Boolean)}
        onApplyFormulas={handleApplyFormulasSynchronized}
        initialRules={appliedFormulas}
        columnExamples={columnExamples}
        columnFillStats={columnFillStats}
      />

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
            Create a synchronized FactWise ID by combining two columns. The system will ensure data consistency across all operations.
          </DialogContentText>
          
          <Box sx={{ mt: 2 }}>
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
          </Box>

          {firstColumn && secondColumn && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Preview: {firstColumn} + "{operator}" + {secondColumn} = "FactWise ID"
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Example: "A123" + "{operator}" + "XYZ" = "A123{operator}XYZ"
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
            disabled={!firstColumn || !secondColumn || syncStatus.inProgress}
            startIcon={syncStatus.inProgress ? <CircularProgress size={20} /> : <BadgeIcon />}
          >
            {syncStatus.inProgress ? 'Creating...' : 'Create Synchronized ID'}
          </Button>
        </DialogActions>
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
