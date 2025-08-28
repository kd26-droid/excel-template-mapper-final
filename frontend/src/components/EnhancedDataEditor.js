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

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ inProgress: false, operation: null });
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [firstNonEmptyRowData, setFirstNonEmptyRowData] = useState(null);

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

  // Unknown values state
  const [unknownCellsCount, setUnknownCellsCount] = useState(0);

  // Formula Builder state
  const [formulaBuilderOpen, setFormulaBuilderOpen] = useState(false);
  const [hasFormulas, setHasFormulas] = useState(false);
  const [formulaColumns, setFormulaColumns] = useState([]);
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
      });
      
      synchronizer.current.addEventListener('complete', (data) => {
        setSyncStatus({ inProgress: false, operation: null });
        console.log('🔄 Sync operation completed:', data.operation);
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
      
      const syncResult = await synchronizer.current.fetchDataWithValidation(true);
      
      if (!syncResult.success && !syncResult.fromCache) {
        throw new Error(syncResult.error || 'Failed to fetch data');
      }
      
      const data = syncResult.data;
      
      // Validate data structure
      updateDataIntegrity(syncResult.validation.isValid, syncResult.validation.errors);
      
      if (!data || !data.headers || !Array.isArray(data.headers) || data.headers.length === 0) {
        throw new Error('No mapped data found. Please go back to Column Mapping and create mappings first.');
      }

      // Process headers and create columns
      const detectedFormulaColumns = data.headers.filter(h => 
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
      const tagColumns = data.headers.filter(h => h.startsWith('Tag_') || h === 'Tag');
      const specNameColumns = data.headers.filter(h => h.startsWith('Specification_Name_'));
      const customerNameColumns = data.headers.filter(h => h.startsWith('Customer_Identification_Name_'));
      
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

      // Create column definitions
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
        ...data.headers.filter(col => col && col.trim() !== '').map((col, index) => {
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
            suppressMovable: false,
            suppressSizeToFit: true,
            isFormulaColumn,
            isUnmapped,
            isSpecificationColumn
          };
        })
      ];

      setColumnDefs(columns);
      setRowData(data.data || []);
      setTotalRows(data.pagination?.total_rows || data.data?.length || 0);
      
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
        ? `Loaded cached data: ${data.data?.length || 0} rows with ${data.headers.length} columns`
        : `Loaded ${data.data?.length || 0} rows with ${data.headers.length} columns`;
      
      showSnackbar(message, syncResult.fromCache ? 'warning' : 'success');

    } catch (err) {
      console.error('❌ Data fetch failed:', err);
      throw err;
    }
  }, [showSnackbar, updateDataIntegrity]);

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
        setAppliedFormulas(formulaResult.formula_rules || []);
        
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
        
        // Refresh data to show all changes
        if (syncResult.validationData && syncResult.validationData.success) {
          await fetchDataSynchronized();
        }
        
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

  // ─── CELL EDIT HANDLER ──────────────────────────────────────────────────────
  const handleCellEdit = useCallback((rowIndex, colIndex, newValue) => {
    const newRowData = [...rowData];
    const colKey = columnDefs[colIndex]?.field;
    if (colKey && newRowData[rowIndex]) {
      newRowData[rowIndex][colKey] = newValue;
      setRowData(newRowData);
      setHasUnsavedChanges(true);
      
      // Recalculate unknown count
      let unknownCount = 0;
      newRowData.forEach(row => {
        unknownCount += Object.values(row).filter(cell => 
          cell && cell.toString().toLowerCase() === 'unknown'
        ).length;
      });
      setUnknownCellsCount(unknownCount);
      
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
      
      {/* Sync Status Indicator */}
      {syncStatus.inProgress && (
        <LinearProgress 
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
        >
          <Box sx={{ p: 2 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ 
                width: '100%', 
                borderCollapse: 'collapse',
                fontSize: '14px',
                fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif'
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                    {columnDefs.map((col, index) => (
                      <th key={col.field} style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: '#2c3e50',
                        border: '1px solid #e9ecef',
                        backgroundColor: col.isFormulaColumn ? '#e8f5e8' : 
                                       col.isUnmapped ? '#fff8e1' : 
                                       col.isSpecificationColumn ? '#f0f8ff' : '#f8f9fa',
                        borderLeft: col.isFormulaColumn ? '4px solid #4caf50' :
                                  col.isUnmapped ? '4px solid #ff9800' :
                                  col.isSpecificationColumn ? '4px solid #2196f3' : '1px solid #e9ecef'
                      }}>
                        {col.headerName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowData.map((row, rowIndex) => (
                    <tr key={rowIndex} style={{
                      backgroundColor: rowIndex % 2 === 0 ? '#f8f9fa' : 'white'
                    }}>
                      {columnDefs.map((col, colIndex) => {
                        const cellValue = row[col.field] || '';
                        const isUnknown = cellValue.toString().toLowerCase() === 'unknown';
                        
                        return (
                          <td key={col.field} style={{
                            padding: '12px 16px',
                            border: '1px solid #e9ecef',
                            backgroundColor: isUnknown ? '#ffebee' :
                                           col.isFormulaColumn ? '#e8f5e8' :
                                           col.isUnmapped ? '#fff8e1' :
                                           col.isSpecificationColumn ? '#f0f8ff' :
                                           rowIndex % 2 === 0 ? '#f8f9fa' : 'white',
                            color: isUnknown ? '#c62828' : 'inherit',
                            fontWeight: isUnknown || col.isFormulaColumn ? '500' : 'normal',
                            borderLeft: col.isFormulaColumn ? '4px solid #4caf50' :
                                      col.isUnmapped ? '4px solid #ff9800' :
                                      col.isSpecificationColumn ? '4px solid #2196f3' : '1px solid #e9ecef'
                          }}>
                            {col.field === 'datasheet' && cellValue.startsWith('http') ? (
                              <a href={cellValue} target="_blank" rel="noopener noreferrer">
                                {cellValue}
                              </a>
                            ) : (
                              <input
                                type="text"
                                value={cellValue}
                                onChange={(e) => handleCellEdit(rowIndex, colIndex, e.target.value)}
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
                  ))}
                </tbody>
              </table>
            </div>
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
        columnExamples={{}}
        columnFillStats={{}}
      />

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