import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
  Badge as BadgeIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import api from '../services/api';
import FormulaBuilder from '../components/FormulaBuilder';


const DataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [firstNonEmptyRowData, setFirstNonEmptyRowData] = useState(null);

  // Unmapped columns state
  const [unmappedColumns, setUnmappedColumns] = useState([]);
  const [mappedColumns, setMappedColumns] = useState([]);
  const [unmappedDialogOpen, setUnmappedDialogOpen] = useState(false);


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
      console.log('API Response in DataEditor:', data);

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
          const displayName = data.display_headers && Array.isArray(data.display_headers) && index < data.display_headers.length && data.display_headers[index] ? data.display_headers[index] : col;
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

  useEffect(() => {
    if (rowData.length > 0 && columnDefs.length > 0) {
      // Find first non-empty row (exclude row number column)
      const firstDataRow = rowData[0];
      const formattedRow = {};
      
      // Only include actual data columns, not the row number column
      columnDefs
        .filter(colDef => colDef.field && colDef.field !== '__row_number__')
        .forEach(colDef => {
          const cellValue = firstDataRow[colDef.field];
          if (cellValue && cellValue.toString().trim() !== '') {
            const displayName = colDef.headerName || colDef.field;
            // Only show first few characters to avoid overwhelming the display
            const truncatedValue = cellValue.toString().length > 20 
              ? cellValue.toString().substring(0, 20) + '...' 
              : cellValue.toString();
            formattedRow[displayName] = truncatedValue;
          }
        });
      
      setFirstNonEmptyRowData(formattedRow);
    }
  }, [rowData, columnDefs]);

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
    if (unmappedColumns.length > 0) {
      const firstUnmappedColumn = unmappedColumns[0];
      showSnackbar(`Found unmapped column: ${firstUnmappedColumn}`, 'info');
    }
  }, [unmappedColumns, showSnackbar]);

  // Auto-scroll to unknown cells
  const scrollToUnknownCell = useCallback(() => {
    if (unknownCellsCount > 0) {
      showSnackbar(`Found ${unknownCellsCount} unknown values`, 'info');
    }
  }, [unknownCellsCount, showSnackbar]);

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

      // Collect default values from unmapped columns (if any)
      const default_values = {};
      if (unmappedColumns && unmappedColumns.length > 0) {
        unmappedColumns.forEach(col => {
          // Set empty default values for unmapped columns
          default_values[col] = '';
        });
      }

      // Pass all template data to the API including default values
      await api.saveMappingTemplate(
        sessionId, 
        templateName.trim(), 
        templateData.description,
        null, // mappings (let backend get from session)
        appliedFormulas.length > 0 ? appliedFormulas : null, // formula_rules
        factwise_rules.length > 0 ? factwise_rules : null, // factwise_rules
        Object.keys(default_values).length > 0 ? default_values : null // default_values
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
  }, [sessionId, templateName, appliedFormulas, factwiseIdRule, unmappedColumns, showSnackbar]);

  // ─── ACTION HANDLERS ────────────────────────────────────────────────────────
  const saveCurrentData = useCallback(async () => {
    try {
      await api.saveEditedData(sessionId, { rows: rowData });
      setHasUnsavedChanges(false);
      return true;
    } catch (err) {
      console.error('Error saving data:', err);
      showSnackbar('Failed to save changes. Please try again.', 'error');
      return false;
    }
  }, [rowData, sessionId, showSnackbar]);

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

      // Get the actual data that's displayed in the frontend
      const allRowData = rowData;
      
      // Get headers from column definitions (exclude row number column)
      const dataColumnDefs = columnDefs.filter(col => col.field && col.field !== '__row_number__');
      const gridHeaders = dataColumnDefs.map(col => col.headerName || col.field);
      const columnKeys = dataColumnDefs.map(col => col.field);
      
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
  }, [hasUnsavedChanges, saveCurrentData, sessionId, showSnackbar, hasFormulas, columnDefs, rowData]);

  const handleBackToMapping = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Going back will lose them. Continue?');
      if (!confirmed) return;
    }
    navigate(`/mapping/${sessionId}`);
  }, [hasUnsavedChanges, navigate, sessionId]);


  // ─── EVENT HANDLERS ─────────────────────────────────────────────────────────
  const handleCellEdit = useCallback((rowIndex, colIndex, newValue) => {
    const newRowData = [...rowData];
    const colKey = columnDefs[colIndex]?.field;
    if (colKey && newRowData[rowIndex]) {
      newRowData[rowIndex][colKey] = newValue;
      setRowData(newRowData);
      setHasUnsavedChanges(true);
      
      // Recalculate unknown count dynamically
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
                <span>
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
                    disabled={loading}
                  >
                    Add Tags
                  </Button>
                </span>
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
          justifyContent: 'space-between',
          alignItems: 'center', 
          pb: 1,
          borderBottom: '1px solid #e0e0e0'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <SaveIcon color="primary" />
            <Typography variant="h6" fontWeight="600">
              Save Your Work
            </Typography>
          </Box>
          <IconButton onClick={() => setSaveAsDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
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
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ErrorIcon color="warning" />
            Unmapped Template Columns Found
          </Box>
          <IconButton onClick={() => setUnmappedDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
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
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <IconButton onClick={() => setTemplateSaveDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
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
        availableColumns={columnDefs.filter(col => col.field && col.field !== '__row_number__').map(col => col.field)}
        onApplyFormulas={handleApplyFormulas}
        onClear={handleClearFormulas}
        initialRules={appliedFormulas}
        // Pass column examples for preview brackets (ONLY FIRST non-empty value like Dashboard)
        columnExamples={
          columnDefs
            .filter(col => col.field && col.field !== '__row_number__')
            .reduce((acc, col) => {
              // Find the FIRST non-empty example for this column (like Dashboard does)
              let firstExample = '';
              for (const row of rowData) {
                const cellValue = row[col.field];
                if (cellValue !== null && cellValue !== undefined && 
                    cellValue !== '' && cellValue.toString().toLowerCase() !== 'unknown') {
                  firstExample = cellValue;
                  break;
                }
              }
              acc[col.field] = firstExample;
              return acc;
            }, {})
        }
        // Pass column fill stats for colored circles (like Dashboard: 'empty', 'partial', 'full')
        columnFillStats={
          columnDefs
            .filter(col => col.field && col.field !== '__row_number__')
            .reduce((acc, col) => {
              // Calculate fill percentage like Dashboard
              let nonEmptyCount = 0;
              for (const row of rowData) {
                const cellValue = row[col.field];
                if (cellValue !== null && cellValue !== undefined && 
                    cellValue !== '' && cellValue.toString().toLowerCase() !== 'unknown') {
                  nonEmptyCount++;
                }
              }
              
              const totalCount = rowData.length;
              const fillPercentage = totalCount > 0 ? nonEmptyCount / totalCount : 0;
              
              // Use Dashboard's logic for colored circles
              if (fillPercentage === 0) {
                acc[col.field] = 'empty';
              } else if (fillPercentage < 0.8) {
                acc[col.field] = 'partial';
              } else {
                acc[col.field] = 'full';
              }
              
              return acc;
            }, {})
        }
      />

      {/* Create Factwise ID Dialog */}
      <Dialog
        open={factwiseIdDialogOpen}
        onClose={handleCloseFactwiseIdDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Create Factwise ID
          <IconButton onClick={handleCloseFactwiseIdDialog}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
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
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <IconButton onClick={() => setTemplateChooseDialogOpen(false)}>
            <CloseIcon />
          </IconButton>
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

      {/* CSS for animations */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </Box>
  );
};

export default DataEditor;