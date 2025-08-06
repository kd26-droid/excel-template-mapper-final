import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
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
  Container
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
  Badge as BadgeIcon
} from '@mui/icons-material';
import api from '../services/api';
import FormulaBuilder from '../components/FormulaBuilder';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

const DataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const gridRef = useRef();

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [selectedRows, setSelectedRows] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [templateUpdateDialogOpen, setTemplateUpdateDialogOpen] = useState(false);

  // Unmapped columns state
  const [unmappedColumns, setUnmappedColumns] = useState([]);
  const [mappedColumns, setMappedColumns] = useState([]);
  const [unmappedDialogOpen, setUnmappedDialogOpen] = useState(false);

  // Grid state
  const [gridApi, setGridApi] = useState(null);
  const [columnApi, setColumnApi] = useState(null);

  // Simplified template saving state
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

  // Create Factwise ID state
  const [factwiseIdDialogOpen, setFactwiseIdDialogOpen] = useState(false);
  const [firstColumn, setFirstColumn] = useState('');
  const [secondColumn, setSecondColumn] = useState('');
  const [operator, setOperator] = useState('_');
  
  // Store factwise ID rule for template saving
  const [factwiseIdRule, setFactwiseIdRule] = useState(null);

  

  // ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────
  const showSnackbar = useCallback((message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }));
  }, []);

  // Calculate optimal column width based on header text
  const calculateColumnWidth = useMemo(() => {
    return (headerText) => {
      const baseWidth = 180;
      const charWidth = 10;
      const padding = 40;
      const calculatedWidth = Math.max(baseWidth, headerText.length * charWidth + padding);
      return Math.min(calculatedWidth, 400);
    };
  }, []);

  // ─── DATA LOADING ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.getMappedDataWithSpecs(sessionId, 1, 1000, true);
      const { data } = response;

      if (!data || !data.headers || !Array.isArray(data.headers) || data.headers.length === 0) {
        setError('No mapped data found. Please go back to Column Mapping and create mappings first.');
        return;
      }

      if (data.formula_rules && Array.isArray(data.formula_rules) && data.formula_rules.length > 0) {
        setAppliedFormulas(data.formula_rules);
        setHasFormulas(true);
        // Identify formula columns by checking if they match the new naming pattern
        const formulaHeaders = data.headers.filter(h => 
          h.startsWith('Tag_') || h.startsWith('Specification_') || h.startsWith('Tag') || h.startsWith('Specification')
        );
        setFormulaColumns(formulaHeaders);
      } else {
        setAppliedFormulas([]);
        setHasFormulas(false);
        setFormulaColumns([]);
      }

      const columns = [
        {
          headerName: '#',
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
        ...data.headers.map((col, index) => {
          const displayName = data.display_headers ? data.display_headers[index] : col;
          const isUnmapped = data.unmapped_columns && data.unmapped_columns.includes(displayName);
          const isSpecificationColumn = displayName.toLowerCase().includes('specification');
          const isFormulaColumn = formulaColumns.includes(col);
          const columnWidth = calculateColumnWidth(displayName);
          
          return {
            headerName: isUnmapped ? `${displayName} ⚠️` : isFormulaColumn ? `${displayName} 🏷️` : displayName,
            field: col,  // Keep using unique field key for data access
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
            suppressSizeToFit: true
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

      showSnackbar(`Loaded ${data.data?.length || 0} rows with ${data.headers.length} columns`, 'success');

    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err.response?.data?.error || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, calculateColumnWidth, showSnackbar]);

  // ─── FORMULA FUNCTIONS ──────────────────────────────────────────────────────
  const handleOpenFormulaBuilder = useCallback(() => {
    setFormulaBuilderOpen(true);
  }, []);

  const handleCloseFormulaBuilder = useCallback(() => {
    setFormulaBuilderOpen(false);
  }, []);

  // ─── CREATE FACTWISE ID FUNCTIONS ──────────────────────────────────────────
  const handleOpenFactwiseIdDialog = useCallback(() => {
    setFactwiseIdDialogOpen(true);
  }, []);

  const handleCloseFactwiseIdDialog = useCallback(() => {
    setFactwiseIdDialogOpen(false);
    setFirstColumn('');
    setSecondColumn('');
    setOperator('_');
  }, []);

  const handleCreateFactwiseId = useCallback(async () => {
    if (!firstColumn || !secondColumn) {
      showSnackbar('Please select both columns for creating Factwise ID', 'error');
      return;
    }

    try {
      setLoading(true);
      const response = await api.createFactwiseId(sessionId, firstColumn, secondColumn, operator);

      if (response.data.success) {
        // Store the factwise ID rule for template saving
        setFactwiseIdRule({
          firstColumn,
          secondColumn,
          operator
        });
        
        await fetchData(); // Refresh data to show new column
        showSnackbar('Factwise ID column created successfully!', 'success');
        handleCloseFactwiseIdDialog();
      } else {
        showSnackbar(response.data.error || 'Failed to create Factwise ID column', 'error');
      }
    } catch (error) {
      console.error('Error creating Factwise ID:', error);
      showSnackbar('Failed to create Factwise ID column', 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionId, firstColumn, secondColumn, operator, showSnackbar, fetchData, handleCloseFactwiseIdDialog]);

  const handleApplyFormulas = useCallback(async (formulaResult) => {
    try {
      setHasFormulas(true);
      setFormulaColumns(formulaResult.new_columns || []);
      setAppliedFormulas(formulaResult.formula_rules || []);
      await fetchData();
      showSnackbar(
        `Successfully applied formulas! Added ${formulaResult.new_columns?.length || 0} new columns.`,
        'success'
      );
    } catch (error) {
      console.error('Error handling formula results:', error);
      showSnackbar('Error applying formulas', 'error');
    }
  }, [showSnackbar, fetchData]);

  const handleClearFormulas = useCallback(async () => {
    const confirmed = window.confirm(
      'Are you sure you want to remove all formula rules and their generated columns? This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
      setLoading(true);
      await api.clearFormulas(sessionId);
      await fetchData(); // Re-fetch data after clearing formulas
      showSnackbar('All formula rules and generated columns have been removed.', 'success');
      handleCloseFormulaBuilder(); // Close the dialog after clearing
    } catch (error) {
      console.error('Error clearing formulas:', error);
      showSnackbar('Failed to clear formulas', 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionId, showSnackbar, handleCloseFormulaBuilder]);

  // Template Selection Functions
  const loadAvailableTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      const response = await api.getMappingTemplates();
      setAvailableTemplates(response.data.templates || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      showSnackbar('Failed to load templates', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  }, [showSnackbar]);

  const handleChooseTemplate = async () => {
    await loadAvailableTemplates();
    setTemplateChooseDialogOpen(true);
  };

  const handleApplyTemplate = useCallback(async (template) => {
    try {
      setLoading(true);
      
      // Apply the template mappings
      await api.applyMappingTemplate(sessionId, template.id);
      
      // If template has formula rules, apply them automatically
      if (template.formula_rules && template.formula_rules.length > 0) {
        await api.applyFormulas(sessionId, template.formula_rules);
        setHasFormulas(true);
        setAppliedFormulas(template.formula_rules);
      }
      
      // If template has factwise ID rule, apply it automatically
      if (template.factwise_rules && template.factwise_rules.length > 0) {
        const factwiseRule = template.factwise_rules.find(rule => rule.type === "factwise_id");
        if (factwiseRule) {
          const { first_column, second_column, operator } = factwiseRule;
          await api.createFactwiseId(sessionId, first_column, second_column, operator);
          // Convert backend format to frontend format for state
          setFactwiseIdRule({
            firstColumn: first_column,
            secondColumn: second_column,
            operator: operator
          });
        }
      }
      
      // Refresh data to show template results
      await fetchData();
      
      showSnackbar(`Template "${template.name}" applied successfully!`, 'success');
      setTemplateChooseDialogOpen(false);
      setSelectedTemplate(null);
      
    } catch (error) {
      console.error('Error applying template:', error);
      showSnackbar('Failed to apply template', 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionId, showSnackbar, fetchData]);

  // Auto-scroll to unmapped columns
  const scrollToUnmappedColumn = useCallback(() => {
    if (gridApi && unmappedColumns.length > 0) {
      const firstUnmappedColumn = unmappedColumns[0];
      try {
        gridApi.ensureColumnVisible(firstUnmappedColumn);
        showSnackbar(`Scrolled to unmapped column: ${firstUnmappedColumn}`, 'info');
      } catch (err) {
        console.error('Error scrolling to column:', err);
        showSnackbar('Unable to scroll to unmapped column', 'warning');
      }
    }
  }, [gridApi, unmappedColumns, showSnackbar]);

  // Auto-scroll to unknown cells
  const scrollToUnknownCell = useCallback(() => {
    if (gridApi && unknownCellsCount > 0) {
      let found = false;
      gridApi.forEachNode((node, index) => {
        if (found) return;
        const rowData = node.data;
        for (const [columnId, cellValue] of Object.entries(rowData)) {
          if (cellValue && cellValue.toString().toLowerCase() === 'unknown') {
            gridApi.ensureColumnVisible(columnId);
            gridApi.ensureIndexVisible(index);
            showSnackbar(`Scrolled to unknown value in ${columnId} at row ${index + 1}`, 'info');
            found = true;
            break;
          }
        }
      });
      if (!found) {
        showSnackbar('No unknown values found', 'info');
      }
    }
  }, [gridApi, unknownCellsCount, showSnackbar]);

  // Simplified template saving
  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      showSnackbar('Please enter a template name', 'error');
      return;
    }

    try {
      setTemplateSaving(true);
      
      // Create template data with mappings, tag rules, and factwise ID rule
      const templateData = {
        session_id: sessionId,
        template_name: templateName.trim(),
        description: `Template with ${appliedFormulas.length} tag rules${factwiseIdRule ? ' and Factwise ID rule' : ''}`,
      };
      
      // Add formula rules if any exist
      if (appliedFormulas.length > 0) {
        templateData.formula_rules = appliedFormulas;
      }
      
      // Add factwise ID rule if it exists
      if (factwiseIdRule) {
        templateData.factwise_id_rule = factwiseIdRule;
      }
      
      // Convert factwise_id_rule to factwise_rules format expected by backend
      const factwise_rules = factwiseIdRule ? [{
        type: "factwise_id",
        first_column: factwiseIdRule.firstColumn,
        second_column: factwiseIdRule.secondColumn,
        operator: factwiseIdRule.operator
      }] : [];

      // Pass both formula rules and factwise rules to the API
      await api.saveMappingTemplate(
        sessionId, 
        templateName.trim(), 
        templateData.description,
        null, // mappings (let backend get from session)
        appliedFormulas.length > 0 ? appliedFormulas : null, // formula_rules
        factwise_rules.length > 0 ? factwise_rules : null // factwise_rules
      );
      showSnackbar(`Template "${templateName}" saved successfully!`, 'success');
      
      setTemplateSaveDialogOpen(false);
      setTemplateName('');
      
    } catch (err) {
      console.error('Error saving template:', err);
      showSnackbar('Failed to save template. Please try again.', 'error');
    } finally {
      setTemplateSaving(false);
    }
  }, [sessionId, templateName, appliedFormulas, factwiseIdRule, showSnackbar]);

  // ─── ACTION HANDLERS ────────────────────────────────────────────────────────
  const saveCurrentData = useCallback(async () => {
    try {
      const allRowData = [];
      gridApi.forEachNode(node => allRowData.push(node.data));
      await api.saveEditedData(sessionId, { rows: allRowData });
      setHasUnsavedChanges(false);
      return true;
    } catch (err) {
      console.error('Error saving data:', err);
      showSnackbar('Failed to save changes. Please try again.', 'error');
      return false;
    }
  }, [gridApi, sessionId, showSnackbar]);

  const handleSaveAs = useCallback(() => {
    setSaveAsDialogOpen(true);
  }, []);

  const handleContinueEditing = useCallback(async () => {
    const saved = await saveCurrentData();
    if (saved) {
      showSnackbar('Changes saved successfully! Continue editing.', 'success');
      setSaveAsDialogOpen(false);
    }
  }, [saveCurrentData, showSnackbar]);

  const handleSaveToDashboard = useCallback(async () => {
    setSaveAsDialogOpen(false);
    setTemplateSaveDialogOpen(true);
    setTemplateName('');
  }, []);

  const handleDownloadExcel = useCallback(async () => {
    try {
      setDownloadLoading(true);
      
      if (hasUnsavedChanges) {
        const saved = await saveCurrentData();
        if (!saved) {
          return;
        }
      }

      // Get the actual grid data that's displayed in the frontend
      const allRowData = [];
      if (gridApi) {
        gridApi.forEachNode(node => allRowData.push(node.data));
      } else {
        // Fallback to rowData state if gridApi not available
        allRowData.push(...rowData);
      }
      
      // Get headers from column definitions, excluding the row number column
      const gridHeaders = columnDefs
        .filter(col => col.field && col.field !== '#') // Exclude row number column
        .map(col => col.headerName.replace(/[⚠️🏷️]/g, '').trim()); // Clean display names
      
      const columnKeys = columnDefs
        .filter(col => col.field && col.field !== '#')
        .map(col => col.field);
      
      // Convert row data to array format matching headers
      const gridRows = allRowData.map(rowData => {
        return columnKeys.map(key => rowData[key] || '');
      });
      
      const fileName = hasFormulas 
        ? `enhanced_data_${sessionId}.xlsx`
        : `processed_data_${sessionId}.xlsx`;

      const response = await api.downloadGridExcel(
        sessionId,
        gridHeaders,
        columnKeys,
        gridRows,
        fileName
      );
      
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      const message = hasFormulas 
        ? 'Excel file with Smart Tags downloaded successfully!'
        : 'Excel file downloaded successfully!';
      showSnackbar(message, 'success');
      
    } catch (err) {
      console.error('Error downloading file:', err);
      showSnackbar('Failed to download file. Please try again.', 'error');
    } finally {
      setDownloadLoading(false);
    }
  }, [hasUnsavedChanges, saveCurrentData, sessionId, showSnackbar, hasFormulas, gridApi, columnDefs]);

  const handleBackToMapping = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Going back will lose them. Continue?');
      if (!confirmed) return;
    }
    navigate(`/mapping/${sessionId}`);
  }, [hasUnsavedChanges, navigate, sessionId]);

  // ─── AG GRID CONFIGURATION ──────────────────────────────────────────────────
  const defaultColDef = useMemo(() => ({
    editable: true,
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true,
    cellStyle: { 
      borderRight: '1px solid #e0e0e0',
      fontSize: '14px',
      fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
      padding: '12px 16px',
      lineHeight: '1.4'
    },
    headerClass: 'ag-header-cell-excel',
    minWidth: 120,
    maxWidth: 600,
    suppressSizeToFit: true,
    suppressAutoSize: false
  }), []);

  const gridOptions = useMemo(() => ({
    animateRows: true,
    // Removed enterprise features: enableRangeSelection, enableRangeHandle, enableFillHandle, undoRedoCellEditing
    enableClipboard: true,
    enableCellTextSelection: true,
    ensureDomOrder: true,
    suppressRowClickSelection: false,
    rowSelection: 'multiple',
    suppressContextMenu: false,
    allowContextMenuWithControlKey: true,
    stopEditingWhenCellsLoseFocus: true,
    enterMovesDown: true,
    enterMovesDownAfterEdit: true,
    suppressHorizontalScroll: false,
    suppressColumnVirtualisation: false,
    suppressRowVirtualisation: false,
    pagination: false,
    domLayout: 'normal',
    rowHeight: 45,
    headerHeight: 50,
    suppressSizeToFit: true
  }), []);

  // ─── EVENT HANDLERS ─────────────────────────────────────────────────────────
  const onGridReady = useCallback((params) => {
    setGridApi(params.api);
    setColumnApi(params.columnApi);
  }, []);

  const onCellValueChanged = useCallback((event) => {
    setHasUnsavedChanges(true);
    
    // Recalculate unknown count dynamically
    let unknownCount = 0;
    gridApi.forEachNode((node) => {
      unknownCount += Object.values(node.data).filter(cell => 
        cell && cell.toString().toLowerCase() === 'unknown'
      ).length;
    });
    setUnknownCellsCount(unknownCount);
    
    showSnackbar('Cell updated - changes not saved yet', 'info');
  }, [showSnackbar, gridApi]);

  const onSelectionChanged = useCallback(() => {
    if (gridApi) {
      const selectedNodes = gridApi.getSelectedNodes();
      setSelectedRows(selectedNodes.map(node => node.data));
    }
  }, [gridApi]);

  const onFilterChanged = useCallback(() => {
    if (gridApi) {
      const filteredRowCount = gridApi.getDisplayedRowCount();
      showSnackbar(`Showing ${filteredRowCount} of ${totalRows} rows`, 'info');
    }
  }, [gridApi, totalRows, showSnackbar]);

  // ─── DATA LOADING ──────────────────────────────────────────────────────────
  const location = useLocation();

  useEffect(() => {
    const initializeData = async () => {
      if (sessionId) {
        const smartTagRulesFromDashboard = location.state?.smartTagFormulaRules;

        if (smartTagRulesFromDashboard && smartTagRulesFromDashboard.length > 0) {
          try {
            setLoading(true);
            await api.applyFormulas(sessionId, smartTagRulesFromDashboard);
            setAppliedFormulas(smartTagRulesFromDashboard);
            setHasFormulas(true);
            showSnackbar('Smart Tag rules from Dashboard applied!', 'success');
          } catch (err) {
            console.error('Error applying smart tag rules from dashboard:', err);
            showSnackbar('Failed to apply Smart Tag rules from Dashboard.', 'error');
          } finally {
            setLoading(false);
          }
        }
        fetchData();
      }
    };
    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, location.state, fetchData]);

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
          Loading your mapped data with specification parsing...
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Transforming columns and parsing specifications
        </Typography>
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
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Button 
            variant="outlined" 
            onClick={() => window.location.reload()}
          >
            Retry
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
            
            {/* Top Row - Back Arrow and Title */}
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
                  Data Editor
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.9rem' }}>
                  Edit and validate your mapped data (Spec parsing active)
                </Typography>
              </Box>

              {/* Right - Download Icon */}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={downloadLoading ? 'Downloading...' : 'Download Excel'}>
                  <span>
                    <IconButton
                      onClick={handleDownloadExcel}
                      disabled={downloadLoading}
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
                      {downloadLoading ? <CircularProgress size={24} color="inherit" /> : <DownloadIcon />}
                    </IconButton>
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
              <Tooltip title="Add Tags - Automatically tag your components">
                <Button
                  onClick={handleOpenFormulaBuilder}
                  variant="contained"
                  startIcon={<AutoAwesomeIcon />}
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
              </Tooltip>

              <Tooltip title="Create Factwise ID - Combine two columns to create a unique identifier">
                <Button
                  onClick={handleOpenFactwiseIdDialog}
                  variant="contained"
                  startIcon={<BadgeIcon />}
                  sx={{ 
                    backgroundColor: '#2e7d32',
                    color: 'white',
                    '&:hover': { backgroundColor: '#1b5e20' },
                    textTransform: 'none',
                    fontWeight: 600
                  }}
                >
                  Create Factwise ID
                </Button>
              </Tooltip>

              <Tooltip title="Save as Template - Save mappings and tags for reuse">
                <Button
                  onClick={handleSaveAs}
                  variant="outlined"
                  startIcon={<SaveIcon />}
                    sx={{ 
                      color: 'white',
                      borderColor: 'white',
                      '&:hover': { 
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        borderColor: 'white'
                      },
                      textTransform: 'none',
                      fontWeight: 600
                    }}
                  >
                    Save Template
                  </Button>
                </Tooltip>
            </Box>

            {/* Stats Row */}
            <Box sx={{ 
              display: 'flex', 
              flexWrap: 'wrap',
              gap: 1.5,
              justifyContent: 'center',
              '& > *': { flexShrink: 0 }
            }}>
              {/* Total Rows */}
              <Card sx={{ 
                bgcolor: 'rgba(255,255,255,0.15)', 
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)',
                minWidth: { xs: 'auto', sm: 100 }
              }}>
                <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                  <Typography variant="h6" fontWeight="700" color="white">
                    {totalRows}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>
                    rows
                  </Typography>
                </CardContent>
              </Card>

              {/* Total Columns */}
              <Card sx={{ 
                bgcolor: 'rgba(255,255,255,0.15)', 
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)',
                minWidth: { xs: 'auto', sm: 100 }
              }}>
                <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                  <Typography variant="h6" fontWeight="700" color="white">
                    {columnDefs.length - 1}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>
                    columns
                  </Typography>
                </CardContent>
              </Card>
              
              {/* Mapped Columns */}
              {mappedColumns.length > 0 && (
                <Card sx={{ 
                  bgcolor: 'rgba(76, 175, 80, 0.8)', 
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  minWidth: { xs: 'auto', sm: 100 }
                }}>
                  <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="700" color="white">
                      {mappedColumns.length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.75rem' }}>
                      mapped
                    </Typography>
                  </CardContent>
                </Card>
              )}
              
              {/* Unmapped Columns - Clickable */}
              {unmappedColumns.length > 0 && (
                <Card 
                  sx={{ 
                    bgcolor: 'rgba(255, 152, 0, 0.8)', 
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minWidth: { xs: 'auto', sm: 100 },
                    '&:hover': { 
                      bgcolor: 'rgba(255, 152, 0, 0.9)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }
                  }}
                  onClick={scrollToUnmappedColumn}
                >
                  <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="700" color="white">
                      {unmappedColumns.length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.75rem' }}>
                      unmapped
                    </Typography>
                  </CardContent>
                </Card>
              )}
              
              {/* Unsaved Changes */}
              {hasUnsavedChanges && (
                <Card sx={{ 
                  bgcolor: 'rgba(244, 67, 54, 0.8)', 
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  animation: 'pulse 2s infinite',
                  minWidth: { xs: 'auto', sm: 120 }
                }}>
                  <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight="700" color="white" sx={{ fontSize: '0.8rem' }}>
                      Unsaved
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.7rem' }}>
                      changes
                    </Typography>
                  </CardContent>
                </Card>
              )}
              
              {/* Formula Columns */}
              {formulaColumns.length > 0 && (
                <Card sx={{ 
                  bgcolor: 'rgba(76, 175, 80, 0.8)', 
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  minWidth: { xs: 'auto', sm: 100 }
                }}>
                  <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="700" color="white">
                      {formulaColumns.length}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.75rem' }}>
                      smart tags
                    </Typography>
                  </CardContent>
                </Card>
              )}

              {/* Unknown Values - Clickable */}
              {unknownCellsCount > 0 && (
                <Card 
                  sx={{ 
                    bgcolor: 'rgba(244, 67, 54, 0.8)', 
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    minWidth: { xs: 'auto', sm: 100 },
                    '&:hover': { 
                      bgcolor: 'rgba(244, 67, 54, 0.9)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }
                  }}
                  onClick={scrollToUnknownCell}
                >
                  <CardContent sx={{ p: '12px 16px !important', textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight="700" color="white">
                      {unknownCellsCount}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.75rem' }}>
                      unknown
                    </Typography>
                  </CardContent>
                </Card>
              )}

              
            </Box>
          </Box>
        </Container>
      </Paper>

      {/* Main Grid Container */}
      <Box sx={{ flexGrow: 1, p: 2, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center', 
            alignItems: 'center',
            height: '100%',
            flexDirection: 'column',
            gap: 2
          }}>
            <CircularProgress size={60} />
            <Typography variant="h6" color="text.secondary">
              Loading data...
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100%',
            flexDirection: 'column',
            gap: 2,
            p: 4
          }}>
            <Alert 
              severity="error" 
              sx={{ mb: 2, maxWidth: 600 }}
              action={
                <Button 
                  color="inherit" 
                  size="small" 
                  onClick={() => navigate('/dashboard')}
                >
                  Back to Dashboard
                </Button>
              }
            >
              {error}
            </Alert>
          </Box>
        ) : (
          <Paper 
            elevation={2} 
            sx={{ 
              height: '100%', 
              overflow: 'hidden',
              borderRadius: 2,
              border: '1px solid #e0e0e0'
            }}
          >
          <div
            className="ag-theme-alpine"
            style={{
              height: '100%',
              width: '100%',
              '--ag-header-height': '50px',
              '--ag-row-height': '45px',
              '--ag-list-item-height': '45px',
              '--ag-header-background-color': '#f8f9fa',
              '--ag-header-foreground-color': '#2c3e50',
              '--ag-border-color': '#dee2e6',
              '--ag-row-border-color': '#e9ecef',
              '--ag-secondary-border-color': '#f1f3f4',
              '--ag-selected-row-background-color': '#e3f2fd',
              '--ag-range-selection-background-color': '#bbdefb',
              '--ag-font-family': 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
              '--ag-font-size': '14px',
              '--ag-header-font-weight': '600',
              '--ag-header-column-resize-handle-display': 'block',
              '--ag-header-column-resize-handle-height': '100%',
              '--ag-header-column-resize-handle-width': '4px',
              '--ag-header-column-resize-handle-color': '#007bff'
            }}
          >
            <AgGridReact
              ref={gridRef}
              theme="legacy"
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              gridOptions={gridOptions}
              onGridReady={onGridReady}
              onCellValueChanged={onCellValueChanged}
              onSelectionChanged={onSelectionChanged}
              onFilterChanged={onFilterChanged}
            />
          </div>
        </Paper>
        )}
      </Box>

      {/* Save As Dialog */}
      <Dialog 
        open={saveAsDialogOpen} 
        onClose={() => setSaveAsDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 2,
          pb: 1,
          borderBottom: '1px solid #e0e0e0'
        }}>
          <SaveIcon color="primary" />
          <Typography variant="h6" fontWeight="600">
            Save Your Work
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <DialogContentText sx={{ mb: 3, fontSize: '16px' }}>
            Choose how you'd like to save your current progress:
          </DialogContentText>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#1976d2' }
              }}
              onClick={handleContinueEditing}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <EditIcon color="primary" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Continue Editing
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Save changes and keep working on this data
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
              onClick={handleSaveToDashboard}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <TemplateIcon color="primary" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Save as Template
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Save mapping as reusable template and return to dashboard
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 2 }}>
          <Button 
            onClick={() => setSaveAsDialogOpen(false)}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Unmapped Columns Dialog */}
      <Dialog 
        open={unmappedDialogOpen} 
        onClose={() => setUnmappedDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ErrorIcon color="warning" />
          Unmapped Template Columns Found
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The following template columns are not mapped to any source data and will appear empty:
          </DialogContentText>
          <Box sx={{ mb: 2 }}>
            {unmappedColumns.map((col, index) => (
              <Chip 
                key={index}
                label={col}
                color="warning"
                variant="outlined"
                sx={{ mr: 1, mb: 1 }}
                icon={<ErrorIcon />}
              />
            ))}
          </Box>
          <DialogContentText>
            You can either:
            • <strong>Continue editing</strong> and manually fill these columns, or
            • <strong>Go back to Column Mapping</strong> to create proper mappings
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleBackToMapping} 
            color="primary"
          >
            Back to Mapping
          </Button>
          <Button 
            onClick={() => setUnmappedDialogOpen(false)} 
            variant="contained"
            startIcon={<CheckCircleIcon />}
          >
            Continue Editing
          </Button>
        </DialogActions>
      </Dialog>

      {/* Simplified Template Save Dialog */}
      <Dialog 
        open={templateSaveDialogOpen} 
        onClose={() => setTemplateSaveDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <SaveIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight="600">
                Save Template
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Save column mappings, tag rules, and factwise ID rule as reusable template
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Enter a name for your template. This will save the current column mappings{appliedFormulas.length > 0 ? `, ${appliedFormulas.length} tag rules` : ''}{factwiseIdRule ? ', and factwise ID rule' : ''}.
          </DialogContentText>
          
          <TextField
            autoFocus
            margin="dense"
            label="Template Name"
            fullWidth
            variant="outlined"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. BOM Template v1"
            sx={{ mb: 2 }}
          />

          {/* Template Summary */}
          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2" fontWeight="600">
              Template will include:
            </Typography>
            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
              <li>Column mappings</li>
              {appliedFormulas.length > 0 && (
                <li>{appliedFormulas.length} tag rules</li>
              )}
              {factwiseIdRule && (
                <li>Factwise ID rule ({factwiseIdRule.firstColumn} {factwiseIdRule.operator} {factwiseIdRule.secondColumn})</li>
              )}
            </Box>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setTemplateSaveDialogOpen(false)}
            disabled={templateSaving}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSaveTemplate}
            variant="contained"
            disabled={templateSaving || !templateName.trim()}
            startIcon={templateSaving ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {templateSaving ? 'Saving...' : 'Save Template'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Formula Builder Dialog */}
      <FormulaBuilder
        open={formulaBuilderOpen}
        onClose={handleCloseFormulaBuilder}
        sessionId={sessionId}
        availableColumns={columnDefs.filter(col => col.field).map(col => col.field)}
        onApplyFormulas={handleApplyFormulas}
        onClear={handleClearFormulas}
        initialRules={appliedFormulas}
      />

      {/* Create Factwise ID Dialog */}
      <Dialog
        open={factwiseIdDialogOpen}
        onClose={handleCloseFactwiseIdDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Factwise ID</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select two columns and an operator to create a unique Factwise ID. The new column will combine the values from both selected columns.
          </DialogContentText>
          
          <Box sx={{ mt: 2 }}>
            <FormControl fullWidth margin="normal">
              <InputLabel>First Column</InputLabel>
              <Select
                value={firstColumn}
                label="First Column"
                onChange={(e) => setFirstColumn(e.target.value)}
              >
                {columnDefs.filter(col => col.field).map(col => (
                  <MenuItem key={col.field} value={col.field}>
                    {col.headerName || col.field}
                  </MenuItem>
                ))}
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
                {columnDefs.filter(col => col.field).map(col => (
                  <MenuItem key={col.field} value={col.field}>
                    {col.headerName || col.field}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {firstColumn && secondColumn && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Preview: {firstColumn} + "{operator}" + {secondColumn} = "Factwise ID"
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Example: "A123" + "{operator}" + "XYZ" = "A123{operator}XYZ"
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseFactwiseIdDialog}>Cancel</Button>
          <Button 
            onClick={handleCreateFactwiseId}
            variant="contained"
            disabled={!firstColumn || !secondColumn || loading}
          >
            {loading ? <CircularProgress size={20} /> : 'Create Factwise ID'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Choose Template Dialog */}
      <Dialog
        open={templateChooseDialogOpen}
        onClose={() => setTemplateChooseDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TemplateIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight="600">
                Choose Template
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Apply a saved template with mappings and Smart Tags
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          {templatesLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : availableTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <TemplateIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary">
                No Templates Available
              </Typography>
              <Typography variant="body2" color="text.disabled">
                Create templates by saving your column mappings
              </Typography>
            </Box>
          ) : (
            <Box sx={{ mt: 2 }}>
              {availableTemplates.map((template) => (
                <Card
                  key={template.id}
                  variant="outlined"
                  sx={{
                    mb: 2,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    border: selectedTemplate?.id === template.id ? 2 : 1,
                    borderColor: selectedTemplate?.id === template.id ? 'primary.main' : 'divider'
                  }}
                  onClick={() => setSelectedTemplate(template)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="h6" fontWeight="600" gutterBottom>
                          {template.name}
                        </Typography>
                        {template.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {template.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                          <Chip 
                            size="small" 
                            label={`${Object.keys(template.mappings || {}).length} mappings`}
                            color="primary" 
                            variant="outlined"
                          />
                          {template.formula_rules && template.formula_rules.length > 0 && (
                            <Chip 
                              size="small" 
                              label={`${template.formula_rules.length} Smart Tags`}
                              color="secondary" 
                              variant="outlined"
                              icon={<AutoAwesomeIcon />}
                            />
                          )}
                          <Chip 
                            size="small" 
                            label={`Used ${template.usage_count || 0} times`}
                            variant="outlined"
                          />
                        </Box>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateChooseDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => selectedTemplate && handleApplyTemplate(selectedTemplate)}
            variant="contained"
            disabled={!selectedTemplate || loading}
            startIcon={loading ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            {loading ? 'Applying...' : 'Apply Template'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
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

      {/* CSS for animations and formula styling */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        .ag-header-formula {
          background-color: #e8f5e8 !important;
          color: #2e7d32 !important;
          font-weight: 600 !important;
          border-left: 4px solid #4caf50 !important;
        }
        
        .ag-header-formula .ag-header-cell-text {
          color: #2e7d32 !important;
        }
      `}</style>
    </Box>
  );
};

export default DataEditor;