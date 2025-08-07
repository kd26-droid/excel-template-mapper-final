import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Chip,
  Alert,
  AlertTitle,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
  Paper,
  Grid,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Snackbar
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Preview as PreviewIcon,
  Label as LabelIcon,
  Science as ScienceIcon,
  AutoAwesome as AutoAwesomeIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Close as CloseIcon,
  CheckCircle,
  DonutLarge,
  RadioButtonUnchecked,
} from '@mui/icons-material';
import api from '../services/api';

const FormulaBuilder = ({ 
  open, 
  onClose, 
  sessionId, 
  availableColumns = [], 
  columnExamples = {},
  columnFillStats = {},
  onApplyFormulas,
  onClear,
  initialRules = []
}) => {
  console.log('FormulaBuilder received props:', { availableColumns, columnExamples, columnFillStats });
  // ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
  const [currentTab, setCurrentTab] = useState(0);
  const [formulaRules, setFormulaRules] = useState(initialRules.length > 0 ? initialRules : [createEmptyRule()]);
  const [templates, setTemplates] = useState({});
  const [allTemplates, setAllTemplates] = useState({}); // For overwrite dropdown
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────
  function createEmptyRule() {
    return {
      source_column: '',
      column_type: 'Tag', // 'Tag' or 'Specification Value'
      specification_name: '', // Only used when column_type is 'Specification Value'
      sub_rules: [createEmptySubRule()] // Array of sub-rules
    };
  }

  function createEmptySubRule() {
    return {
      search_text: '',
      output_value: '',
      case_sensitive: false
    };
  }

  const showSnackbar = useCallback((message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }));
  }, []);

  const validateRules = useCallback(() => {
    const results = api.validateFormulaRules(formulaRules, availableColumns);
    setValidationResults(results);
  }, [formulaRules, availableColumns]);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getMappingTemplates(); // Use unified templates
      
      // Filter templates that have formula rules
      const templatesWithFormulas = (response.data.templates || [])
        .filter(template => template.formula_rules && template.formula_rules.length > 0)
        .reduce((acc, template) => {
          acc[template.id] = {
            id: template.id,
            name: template.name,
            description: template.description || 'Saved template with Smart Tags',
            rules: template.formula_rules || []
          };
          return acc;
        }, {});

      // Also store all templates for overwrite dropdown (not just ones with formulas)
      const allTemplates = (response.data.templates || [])
        .reduce((acc, template) => {
          acc[template.id] = {
            id: template.id,
            name: template.name,
            description: template.description || 'Mapping template',
            rules: template.formula_rules || []
          };
          return acc;
        }, {});
      
      setTemplates(templatesWithFormulas);
    } catch (error) {
      console.error('Error loading formula templates:', error);
      showSnackbar('Failed to load formula templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  // ─── DATA LOADING ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open, loadTemplates]);

  useEffect(() => {
    validateRules();
  }, [validateRules]);

  useEffect(() => {
    if (initialRules.length > 0) {
      // Map template column names to available columns using fuzzy matching
      const mappedRules = initialRules.map(rule => {
        if (!rule.source_column || availableColumns.includes(rule.source_column)) {
          return rule; // Exact match or empty, keep as is
        }
        
        // Try to find a fuzzy match
        const fuzzyMatch = findBestColumnMatch(rule.source_column, availableColumns);
        return {
          ...rule,
          source_column: fuzzyMatch || rule.source_column // Use fuzzy match or keep original
        };
      });
      setFormulaRules(mappedRules);
    } else {
      setFormulaRules([createEmptyRule()]);
    }
  }, [initialRules, availableColumns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper function to find best column match using fuzzy matching
  const findBestColumnMatch = (targetColumn, availableColumns) => {
    if (!targetColumn || availableColumns.length === 0) return null;
    
    const targetLower = targetColumn.toLowerCase().trim();
    
    // 1. Try exact match (case insensitive)
    const exactMatch = availableColumns.find(col => 
      col.toLowerCase().trim() === targetLower
    );
    if (exactMatch) return exactMatch;
    
    // 2. Try partial match (contains)
    const partialMatch = availableColumns.find(col => {
      const colLower = col.toLowerCase().trim();
      return colLower.includes(targetLower) || targetLower.includes(colLower);
    });
    if (partialMatch) return partialMatch;
    
    // 3. Try keyword matching for common mappings
    const keywordMappings = {
      'description': ['description', 'desc', 'component', 'part_description', 'item_description'],
      'part number': ['part_number', 'partno', 'part_no', 'mpn', 'manufacturer_part_number', 'part'],
      'component': ['component', 'description', 'part_type', 'item'],
      'category': ['category', 'type', 'class', 'family'],
      'manufacturer': ['manufacturer', 'mfr', 'brand', 'supplier'],
      'value': ['value', 'rating', 'specification', 'spec'],
      'package': ['package', 'footprint', 'case', 'housing'],
      'voltage': ['voltage', 'volt', 'v_rating'],
      'current': ['current', 'amp', 'i_rating']
    };
    
    const targetKeywords = targetLower.split(/[\s_-]+/);
    
    for (const col of availableColumns) {
      const colLower = col.toLowerCase().trim();
      const colKeywords = colLower.split(/[\s_-]+/);
      
      // Check if any keywords match
      for (const targetKeyword of targetKeywords) {
        if (keywordMappings[targetKeyword]) {
          for (const mappedKeyword of keywordMappings[targetKeyword]) {
            if (colKeywords.some(ck => ck.includes(mappedKeyword) || mappedKeyword.includes(ck))) {
              return col;
            }
          }
        }
        
        // Direct keyword match
        if (colKeywords.some(ck => ck.includes(targetKeyword) || targetKeyword.includes(ck))) {
          return col;
        }
      }
    }
    
    return null; // No match found
  };

  // ─── RULE MANAGEMENT ────────────────────────────────────────────────────────
  const addRule = () => {
    setFormulaRules(prev => [...prev, createEmptyRule()]);
  };

  const removeRule = (index) => {
    setFormulaRules(prev => prev.filter((_, i) => i !== index));
  };

  const updateRule = (index, field, value) => {
    setFormulaRules(prev => prev.map((rule, i) => 
      i === index ? { ...rule, [field]: value } : rule
    ));
  };

  const addSubRule = (ruleIndex) => {
    setFormulaRules(prev => prev.map((rule, i) => 
      i === ruleIndex ? { 
        ...rule, 
        sub_rules: [...rule.sub_rules, createEmptySubRule()] 
      } : rule
    ));
  };

  const removeSubRule = (ruleIndex, subRuleIndex) => {
    setFormulaRules(prev => prev.map((rule, i) => 
      i === ruleIndex ? { 
        ...rule, 
        sub_rules: rule.sub_rules.filter((_, j) => j !== subRuleIndex) 
      } : rule
    ));
  };

  const updateSubRule = (ruleIndex, subRuleIndex, field, value) => {
    setFormulaRules(prev => prev.map((rule, i) => 
      i === ruleIndex ? { 
        ...rule, 
        sub_rules: rule.sub_rules.map((subRule, j) => 
          j === subRuleIndex ? { ...subRule, [field]: value } : subRule
        ) 
      } : rule
    ));
  };

  // ─── PREVIEW FUNCTIONALITY ──────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!validationResults?.isValid) {
      showSnackbar('Please fix validation errors before previewing', 'error');
      return;
    }

    try {
      setPreviewLoading(true);
      const response = await api.previewFormulas(sessionId, formulaRules, 5);
      setPreviewData(response.data);
      setShowPreview(true);
      showSnackbar('Preview generated successfully', 'success');
    } catch (error) {
      console.error('Error generating preview:', error);
      showSnackbar('Failed to generate preview', 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ─── APPLY FORMULAS ─────────────────────────────────────────────────────────
  const handleApplyFormulas = async () => {
    if (!validationResults?.isValid) {
      showSnackbar('Please fix validation errors before applying', 'error');
      return;
    }

    try {
      setLoading(true);
      
      // Check for column conflicts first (e.g., existing Tag columns)
      const conflictResponse = await api.checkColumnConflicts(sessionId, formulaRules);
      
      if (conflictResponse.data.conflicts && conflictResponse.data.conflicts.length > 0) {
        const conflictMessage = conflictResponse.data.conflicts.map(c => 
          `Column "${c.column}" already exists. Formula will use "${c.suggested_name}" instead.`
        ).join('\n');
        
        const proceed = window.confirm(
          `⚠️ Column Conflicts Detected:\n\n${conflictMessage}\n\nDo you want to proceed with the suggested column names?`
        );
        
        if (!proceed) {
          setLoading(false);
          return;
        }
      }
      
      const response = await api.applyFormulas(sessionId, formulaRules);
      
      if (response.data.success) {
        showSnackbar(`Applied ${response.data.rules_applied} formula rules successfully!`, 'success');
        onApplyFormulas(response.data);
        onClose();
      } else {
        throw new Error(response.data.error || 'Failed to apply formulas');
      }
    } catch (error) {
      console.error('Error applying formulas:', error);
      showSnackbar(error.response?.data?.error || 'Failed to apply formulas', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── CLEAR FORMULAS ─────────────────────────────────────────────────────────
  const handleClearFormulas = async () => {
    const confirmClear = window.confirm(
      '⚠️ Clear All Formulas?\n\n' +
      'This will:\n' +
      '• Remove all formula rules from this session\n' +
      '• Delete any generated Tag and Specification columns\n' +
      '• Revert data to original mapped columns only\n\n' +
      'Note: Saved templates will NOT be affected.\n\n' +
      'Are you sure you want to continue?'
    );

    if (!confirmClear) {
      return;
    }

    try {
      setLoading(true);
      
      const response = await api.clearFormulas(sessionId);
      
      if (response.data.success) {
        showSnackbar(response.data.message, 'success');
        
        // Reset local state
        setFormulaRules([createEmptyRule()]);
        setPreviewData(null);
        setShowPreview(false);
        setSelectedTemplate('');
        
        // Notify parent component about the clearing
        if (onClear) {
          onClear(response.data);
        }
        
        onClose();
      } else {
        throw new Error(response.data.error || 'Failed to clear formulas');
      }
    } catch (error) {
      console.error('Error clearing formulas:', error);
      showSnackbar(error.response?.data?.error || 'Failed to clear formulas', 'error');
    } finally {
      setLoading(false);
    }
  };

  

  const statusIcons = {
    full: <CheckCircle sx={{ color: 'success.main', fontSize: '1rem', mr: 1 }} />,
    partial: <DonutLarge sx={{ color: 'warning.main', fontSize: '1rem', mr: 1 }} />,
    empty: <RadioButtonUnchecked sx={{ color: 'text.disabled', fontSize: '1rem', mr: 1 }} />
  };

  // ─── RENDER COMPONENTS ──────────────────────────────────────────────────────
  const renderRuleEditor = (rule, index) => (
    <Card key={index} variant="outlined" sx={{ mb: 3, position: 'relative' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" color="primary">
            Rule {index + 1}
          </Typography>
          {formulaRules.length > 1 && (
            <IconButton 
              onClick={() => removeRule(index)} 
              color="error" 
              size="small"
            >
              <DeleteIcon />
            </IconButton>
          )}
        </Box>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          {/* Source Column */}
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Source Column</InputLabel>
              <Select
                value={rule.source_column}
                onChange={(e) => updateRule(index, 'source_column', e.target.value)}
                label="Source Column"
                sx={{
                  '& .MuiSelect-select': {
                    color: rule.source_column && !availableColumns.includes(rule.source_column) ? '#d32f2f' : 'inherit',
                    display: 'flex',
                    alignItems: 'center'
                  }
                }}
              >
                {availableColumns.map((col) => {
                  const example = columnExamples[col] || '';
                  const status = columnFillStats[col] || 'empty';
                  const icon = statusIcons[status];

                  let displayExample = '';
                  if (status === 'empty') {
                    displayExample = '(Empty)';
                  } else if (example) {
                    const truncatedExample = example.toString().length > 30 ? `${example.toString().substring(0, 30)}...` : example;
                    displayExample = `(${truncatedExample})`;
                  } else if (status === 'partial') {
                    displayExample = '(Partially Filled)';
                  }
                  
                  return (
                    <MenuItem key={col} value={col}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <Typography variant="inherit" noWrap sx={{ flexGrow: 1 }}>
                          {col} {displayExample}
                        </Typography>
                        {icon}
                      </Box>
                    </MenuItem>
                  );
                })}
                {/* Show invalid column from template if it doesn't exist in available columns */}
                {rule.source_column && !availableColumns.includes(rule.source_column) && (
                  <MenuItem value={rule.source_column} disabled sx={{ color: '#d32f2f', fontStyle: 'italic' }}>
                    {rule.source_column} (not found)
                  </MenuItem>
                )}
              </Select>
            </FormControl>
            {/* Helper text for auto-mapped or invalid columns */}
            {rule.source_column && !availableColumns.includes(rule.source_column) && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                ⚠️ Column from template not found in current data
              </Typography>
            )}
          </Grid>

          {/* Column Type */}
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Destination Column Type</InputLabel>
              <Select
                value={rule.column_type}
                onChange={(e) => updateRule(index, 'column_type', e.target.value)}
                label="Destination Column Type"
              >
                <MenuItem value="Tag">Tag</MenuItem>
                <MenuItem value="Specification Value">Specification Value</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Specification Name (only show when column_type is 'Specification Value') */}
          {rule.column_type === 'Specification Value' && (
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                size="small"
                label="Specification Name"
                value={rule.specification_name}
                onChange={(e) => updateRule(index, 'specification_name', e.target.value)}
                placeholder="e.g., Component Type"
              />
            </Grid>
          )}
        </Grid>

        {/* Sub-Rules Section */}
        <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, p: 2, bgcolor: '#fafafa' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight="600">
              Conditions (Sub-Rules)
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => addSubRule(index)}
            >
              Add Condition
            </Button>
          </Box>

          {rule.sub_rules && rule.sub_rules.map((subRule, subIndex) => (
            <Box key={subIndex} sx={{ 
              display: 'flex', 
              gap: 2, 
              alignItems: 'center', 
              mb: 2,
              p: 2,
              bgcolor: 'white',
              borderRadius: 1,
              border: '1px solid #e0e0e0'
            }}>
              <Typography variant="body2" sx={{ minWidth: 60, color: 'text.secondary' }}>
                If contains:
              </Typography>
              
              <TextField
                size="small"
                label="Search Text"
                value={subRule.search_text}
                onChange={(e) => updateSubRule(index, subIndex, 'search_text', e.target.value)}
                placeholder="e.g., CAP, DIODE"
                sx={{ flex: 1 }}
              />
              
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                then:
              </Typography>
              
              <TextField
                size="small"
                label={rule.column_type === 'Tag' ? 'Tag Value' : 'Specification Value'}
                value={subRule.output_value}
                onChange={(e) => updateSubRule(index, subIndex, 'output_value', e.target.value)}
                placeholder={rule.column_type === 'Tag' ? 'e.g., Capacitor' : 'e.g., Passive'}
                sx={{ flex: 1 }}
              />

              {showAdvanced && (
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={subRule.case_sensitive}
                      onChange={(e) => updateSubRule(index, subIndex, 'case_sensitive', e.target.checked)}
                    />
                  }
                  label="Case"
                />
              )}

              {rule.sub_rules.length > 1 && (
                <IconButton 
                  size="small"
                  color="error"
                  onClick={() => removeSubRule(index, subIndex)}
                >
                  <DeleteIcon />
                </IconButton>
              )}
            </Box>
          ))}
          
          {rule.sub_rules && rule.sub_rules.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              No conditions defined. Click "Add Condition" to create your first sub-rule.
            </Typography>
          )}
        </Box>

        {/* Rule preview */}
        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            <strong>Rule Preview:</strong> Check "{rule.source_column}" column and apply first matching condition to{' '}
            {rule.column_type === 'Tag' ? (
              'Tag column'
            ) : (
              `"${rule.specification_name}" specification`
            )}
            {rule.sub_rules && rule.sub_rules.length > 0 && (
              <Box component="span" sx={{ display: 'block', mt: 1 }}>
                Conditions: {rule.sub_rules.map((sub, i) => 
                  sub.search_text && sub.output_value ? `"${sub.search_text}" → "${sub.output_value}"` : null
                ).filter(Boolean).join(', ')}
              </Box>
            )}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );

  const renderPreview = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        Formula Preview
      </Typography>
      
      {previewData && (
        <>
          {/* Statistics */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {previewData.rule_statistics?.map((stat, index) => (
              <Grid item xs={6} md={3} key={index}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="primary">
                    {stat.matches}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    matches ({stat.match_percentage}%)
                  </Typography>
                  <Typography variant="caption">
                    Rule {stat.rule_index + 1}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {/* New columns */}
          {previewData.new_columns?.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>New Columns Created</AlertTitle>
              {previewData.new_columns.map((col, idx) => (
                <Chip key={idx} label={col} size="small" sx={{ mr: 1 }} />
              ))}
            </Alert>
          )}

          {/* Sample data */}
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Sample Results ({previewData.sample_size} of {previewData.total_rows} rows)
          </Typography>
          
          <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  {previewData.headers?.map((header, idx) => (
                    <th key={idx} style={{ 
                      padding: '8px', 
                      border: '1px solid #ddd',
                      fontWeight: 'bold',
                      backgroundColor: previewData.new_columns?.includes(header) ? '#e3f2fd' : '#f5f5f5'
                    }}>
                      {header}
                      {previewData.new_columns?.includes(header) && (
                        <Chip label="NEW" size="small" color="primary" sx={{ ml: 1 }} />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.preview_data?.map((row, idx) => (
                  <tr key={idx}>
                    {previewData.headers?.map((header, colIdx) => (
                      <td key={colIdx} style={{ 
                        padding: '8px', 
                        border: '1px solid #ddd',
                        backgroundColor: previewData.new_columns?.includes(header) ? '#f3e5f5' : 'white'
                      }}>
                        {row[header] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </>
      )}
    </Box>
  );

  // ─── MAIN RENDER ────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '90vh' } }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center', 
          gap: 2,
          pb: 1,
          borderBottom: '1px solid #e0e0e0'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ScienceIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight="600">
                Add Tags to Your Data
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create simple rules to automatically tag your components (e.g., if Description contains "Cap" then tag as "Capacitor")
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={currentTab} 
              onChange={(e, newValue) => setCurrentTab(newValue)}
              sx={{ px: 3 }}
            >
              <Tab 
                label="Create Rules" 
                icon={<AutoAwesomeIcon />} 
                iconPosition="start"
              />
              {showPreview && (
                <Tab 
                  label="Preview" 
                  icon={<PreviewIcon />} 
                  iconPosition="start"
                />
              )}
            </Tabs>
          </Box>

          <Box sx={{ p: 3, height: 'calc(90vh - 180px)', overflow: 'auto' }}>
            {currentTab === 0 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">
                    Create Tagging Rules
                  </Typography>
                  <Tooltip title="Show advanced options">
                    <IconButton 
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      color={showAdvanced ? 'primary' : 'default'}
                    >
                      {showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Tooltip>
                </Box>


                {/* Validation Results */}
                {validationResults && (
                  <Box sx={{ mb: 3 }}>
                    {validationResults.errors.length > 0 && (
                      <Alert severity="error" sx={{ mb: 1 }}>
                        <AlertTitle>Validation Errors</AlertTitle>
                        <List dense>
                          {validationResults.errors.map((error, idx) => (
                            <ListItem key={idx}>
                              <ListItemText primary={error} />
                            </ListItem>
                          ))}
                        </List>
                      </Alert>
                    )}
                    
                    {validationResults.warnings.length > 0 && (
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        <AlertTitle>Warnings</AlertTitle>
                        <List dense>
                          {validationResults.warnings.map((warning, idx) => (
                            <ListItem key={idx}>
                              <ListItemText primary={warning} />
                            </ListItem>
                          ))}
                        </List>
                      </Alert>
                    )}

                    {validationResults.isValid && validationResults.warnings.length === 0 && (
                      <Alert severity="success">
                        <AlertTitle>All Rules Valid</AlertTitle>
                        {validationResults.ruleCount} rules ready to apply.
                      </Alert>
                    )}
                  </Box>
                )}

                {/* Rules */}
                {formulaRules.length > 0 ? (
                  formulaRules.map((rule, index) => renderRuleEditor(rule, index))
                ) : (
                  <Alert severity="info" sx={{ mb: 3 }}>
                    <AlertTitle>No Rules Defined</AlertTitle>
                    Click the "Add Rule" button to create your first formula.
                  </Alert>
                )}

                {/* Add Rule Button - positioned after rules */}
                <Box sx={{ textAlign: 'center', mt: 2 }}>
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={addRule}
                    size="medium"
                    sx={{ minWidth: 150 }}
                  >
                    Add Rule
                  </Button>
                </Box>

              </Box>
            )}

            {currentTab === 1 && showPreview && renderPreview()}
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 3, borderTop: '1px solid #e0e0e0' }}>
          

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              onClick={handleClearFormulas}
              color="error"
              disabled={loading}
            >
              Clear All & Remove Columns
            </Button>
            <Button onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            
            <Button
              onClick={handlePreview}
              disabled={!validationResults?.isValid || previewLoading}
              startIcon={previewLoading ? <CircularProgress size={16} /> : <PreviewIcon />}
            >
              {previewLoading ? 'Generating...' : 'Preview'}
            </Button>
            
            <Button
              onClick={handleApplyFormulas}
              variant="contained"
              disabled={!validationResults?.isValid || loading}
              startIcon={loading ? <CircularProgress size={16} /> : <LabelIcon />}
            >
              {loading ? 'Applying...' : 'Apply Tags'}
            </Button>
          </Box>
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
    </>
  );
};

export default FormulaBuilder;