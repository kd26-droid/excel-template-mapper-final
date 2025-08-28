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
  DialogActions,
  Chip,
  Container,
  IconButton,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import {
  CloudUpload as CloudUploadIcon,
  Description as DescriptionIcon,
  LibraryBooks as LibraryBooksIcon,
  CheckCircle as CheckCircleIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  PlayArrow as PlayArrowIcon,
  Warning as WarningIcon,
  UploadFile as UploadFileIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Science as ScienceIcon
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import api, { setGlobalLoaderCallback } from '../services/api';
// Removed unused UploadFormulaBuilder import

const UploadFiles = () => {
  const [globalLoading, setGlobalLoading] = useState(false);
  useGlobalBlock(globalLoading);
  
  // Setup global loader callback
  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);
  
  const [userFile, setUserFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Client file sheet/header state
  const [clientSheetNames, setClientSheetNames] = useState([]);
  const [selectedClientSheet, setSelectedClientSheet] = useState('');
  const [clientHeaderRow, setClientHeaderRow] = useState(1);
  
  // Template file sheet/header state
  const [templateSheetNames, setTemplateSheetNames] = useState([]);
  const [selectedTemplateSheet, setSelectedTemplateSheet] = useState('');
  const [templateHeaderRow, setTemplateHeaderRow] = useState(1);
  
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

  const onDropUserFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      let file = acceptedFiles[0];
      setError(null);
      setUserFile(file);
      
      // Read the file to extract sheet names and column headers for Excel files
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheets = workbook.SheetNames;
          setClientSheetNames(sheets);
          setSelectedClientSheet(sheets[0]); // Auto-select first sheet
          
          // Extract column headers from the first sheet
          if (sheets.length > 0) {
            const firstSheet = workbook.Sheets[sheets[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            // Parse headers for potential future use
            if (jsonData.length > 0 && jsonData[0]) {
              const headers = jsonData[0].filter(header => header && header.toString().trim() !== '');
              console.log('Available columns:', headers);
            }
          }
        } catch (err) {
          console.error('Error reading Excel file:', err);
          setError('Error reading Excel file. Please make sure it\'s a valid Excel file.');
        }
      };
      reader.readAsBinaryString(file);
    }
  }, []);

  const onDropTemplateFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setTemplateFile(file);
      setError(null);
      
      // Read the template file to extract sheet names
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheets = workbook.SheetNames;
          setTemplateSheetNames(sheets);
          setSelectedTemplateSheet(sheets[0]); // Auto-select first sheet
        } catch (err) {
          console.error('Error reading template Excel file:', err);
          setError('Error reading template Excel file. Please make sure it\'s a valid Excel file.');
        }
      };
      reader.readAsBinaryString(file);
    }
  }, []);

  const { getRootProps: getUserRootProps, getInputProps: getUserInputProps, isDragActive: isUserDragActive } = 
    useDropzone({ 
      onDrop: onDropUserFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls']
      },
      maxFiles: 1
    });

  const { getRootProps: getTemplateRootProps, getInputProps: getTemplateInputProps, isDragActive: isTemplateDragActive } = 
    useDropzone({ 
      onDrop: onDropTemplateFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls']
      },
      maxFiles: 1
    });

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
        navigate(`/mapping/${pendingSessionId}`);
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


  const handleUpload = async () => {
    if (!userFile || !templateFile) {
      setError('Please select both a user file and a template file');
      return;
    }

    if (clientSheetNames.length > 0 && !selectedClientSheet) {
      setError('Please select a sheet from your client Excel file');
      return;
    }

    if (templateSheetNames.length > 0 && !selectedTemplateSheet) {
      setError('Please select a sheet from your template Excel file');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const formData = new FormData();
      formData.append('clientFile', userFile);
      formData.append('templateFile', templateFile);
      formData.append('sheetName', selectedClientSheet);
      formData.append('headerRow', clientHeaderRow.toString());
      formData.append('templateSheetName', selectedTemplateSheet);
      formData.append('templateHeaderRow', templateHeaderRow.toString());
      
      // Add formula rules if they exist and NO mapping template is selected
      // When a template is selected, it already contains the rules, so don't send them again
      if (!selectedTemplate && formulaRules && formulaRules.length > 0) {
        formData.append('formulaRules', JSON.stringify(formulaRules));
      }
      
      let response;
      
      // Use template-aware upload if template is selected
      if (selectedTemplate) {
        response = await api.uploadFilesWithTemplate(formData, selectedTemplate.id);
        
        // Check template application results
        if (response.data.template_applied && response.data.template_success) {
          let successMessage = `Files uploaded successfully! Template "${selectedTemplate.name}" applied automatically.`;
          if (response.data.applied_formulas) {
            successMessage += ' Smart Tag formulas were also applied and new columns created.';
          }
          setSuccess(successMessage);
          
          setTimeout(() => {
            // Navigate to ColumnMapping and let it handle template application using its working logic
            navigate(`/mapping/${response.data.session_id}`, {
              state: { 
                autoApplyTemplate: selectedTemplate,
                fromUpload: true,
                smartTagFormulaRules: formulaRules
              }
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
        // No template selected - normal upload
        response = await api.uploadFiles(formData);
        setSuccess('Files uploaded successfully!');
        
        setTimeout(() => {
          navigate(`/mapping/${response.data.session_id}`);
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

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 4 }}>
        Upload Files
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}
      
      {/* STEP 1: File Upload Section */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <UploadFileIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 1: Upload Your Files
            </Typography>
          </Box>
          
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Client File
              </Typography>
              
              <Box 
                {...getUserRootProps()} 
                sx={{
                  border: '2px dashed #ccc',
                  borderRadius: 2,
                  p: 4,
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: isUserDragActive ? '#f0f8ff' : '#fafafa',
                  transition: 'all 0.2s ease',
                  '&:hover': { backgroundColor: '#f0f8ff' }
                }}
              >
                <input {...getUserInputProps()} />
                <CloudUploadIcon fontSize="large" color="primary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {userFile ? userFile.name : 'Drop your Excel file here or click to browse'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported: .xlsx, .xls
                </Typography>
              </Box>
              
              {userFile && (
                <Typography variant="body2" sx={{ mt: 2, color: 'success.main' }}>
                  ✓ Selected: {userFile.name}
                </Typography>
              )}
              
              {clientSheetNames.length > 0 && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Sheet Name</InputLabel>
                      <Select
                        value={selectedClientSheet}
                        label="Sheet Name"
                        onChange={(e) => setSelectedClientSheet(e.target.value)}
                      >
                        {clientSheetNames.map(sheet => (
                          <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Header Row"
                      type="number"
                      size="small"
                      fullWidth
                      InputProps={{ inputProps: { min: 1 } }}
                      value={clientHeaderRow}
                      onChange={(e) => setClientHeaderRow(Number(e.target.value))}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                FW Item Template
              </Typography>
              
              <Box 
                {...getTemplateRootProps()} 
                sx={{
                  border: '2px dashed #ccc',
                  borderRadius: 2,
                  p: 4,
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: isTemplateDragActive ? '#f0f8ff' : '#fafafa',
                  transition: 'all 0.2s ease',
                  '&:hover': { backgroundColor: '#f0f8ff' }
                }}
              >
                <input {...getTemplateInputProps()} />
                <DescriptionIcon fontSize="large" color="secondary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {templateFile ? templateFile.name : 'Drop your FW Item Template here or click to browse'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported: .xlsx, .xls
                </Typography>
              </Box>
              
              {templateFile && (
                <Typography variant="body2" sx={{ mt: 2, color: 'success.main' }}>
                  ✓ Selected: {templateFile.name}
                </Typography>
              )}

              {templateSheetNames.length > 0 && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Sheet Name</InputLabel>
                      <Select
                        value={selectedTemplateSheet}
                        label="Sheet Name"
                        onChange={(e) => setSelectedTemplateSheet(e.target.value)}
                      >
                        {templateSheetNames.map(sheet => (
                          <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Header Row"
                      type="number"
                      size="small"
                      fullWidth
                      InputProps={{ inputProps: { min: 1 } }}
                      value={templateHeaderRow}
                      onChange={(e) => setTemplateHeaderRow(Number(e.target.value))}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* STEP 2: Template Selection - Always Visible */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <LibraryBooksIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 2: Choose a Mapping Template (Optional)
            </Typography>
          </Box>
          
          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Search templates..."
            value={templateSearchTerm}
            onChange={(e) => setTemplateSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            }}
            sx={{ mb: 3 }}
            size="small"
          />

          {/* Selected Template Display */}
          {selectedTemplate && (
            <Alert 
              severity="success" 
              sx={{ mb: 3 }}
              action={
                <Button color="inherit" size="small" onClick={handleRemoveTemplate}>
                  <CloseIcon />
                </Button>
              }
            >
              <Typography variant="subtitle2" fontWeight="600">
                Selected: {selectedTemplate.name}
              </Typography>
              <Typography variant="body2">
                {selectedTemplate.description || `${selectedTemplate.total_mappings} mappings • Used ${selectedTemplate.usage_count || 0} times`}
              </Typography>
            </Alert>
          )}

          {/* Templates List */}
          {templatesLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading templates...
              </Typography>
            </Box>
          ) : filteredTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              <LibraryBooksIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="h6">
                {templateSearchTerm ? 'No templates match your search' : 'No templates available'}
              </Typography>
              <Typography variant="body2">
                {templateSearchTerm ? 'Try a different search term' : 'Upload without a template to create custom mappings'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
              {filteredTemplates.map((template) => (
                <Box
                  key={template.id}
                  sx={{
                    p: 2,
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    backgroundColor: selectedTemplate?.id === template.id ? '#e3f2fd' : 'transparent',
                    '&:hover': { backgroundColor: selectedTemplate?.id === template.id ? '#e3f2fd' : '#f8f9fa' },
                    '&:last-child': { borderBottom: 'none' }
                  }}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="600">
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {template.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip 
                          icon={<CheckCircleIcon />}
                          label={`${template.total_mappings} mappings`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip 
                          icon={<TrendingUpIcon />}
                          label={`Used ${template.usage_count || 0}×`}
                          size="small"
                          variant="outlined"
                          color={template.usage_count > 0 ? 'success' : 'default'}
                        />
                        <Chip 
                          icon={<ScheduleIcon />}
                          label={new Date(template.created_at).toLocaleDateString()}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                    {selectedTemplate?.id === template.id && (
                      <CheckCircleIcon color="primary" />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {!selectedTemplate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              No template selected - you can proceed without one
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Tag Templates (Optional) */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <ScienceIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 3: Choose a Tag Template (Optional)
            </Typography>
          </Box>
          
          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Search tag templates..."
            value={tagTemplateSearchTerm}
            onChange={(e) => setTagTemplateSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            }}
            sx={{ mb: 3 }}
            size="small"
          />

          {/* Selected Tag Template Display */}
          {selectedTagTemplate && (
            <Alert 
              severity="success" 
              sx={{ mb: 3 }}
              action={
                <Button color="inherit" size="small" onClick={handleRemoveTagTemplate}>
                  <CloseIcon />
                </Button>
              }
            >
              <Typography variant="subtitle2" fontWeight="600">
                Selected: {selectedTagTemplate.name}
              </Typography>
              <Typography variant="body2">
                {selectedTagTemplate.description || `${(selectedTagTemplate.formula_rules || []).length} rules • Used ${selectedTagTemplate.usage_count || 0} times`}
              </Typography>
            </Alert>
          )}

          {/* Tag Templates List */}
          {tagTemplatesLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading tag templates...
              </Typography>
            </Box>
          ) : filteredTagTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              <ScienceIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="h6">
                {tagTemplateSearchTerm ? 'No tag templates match your search' : 'No tag templates available'}
              </Typography>
              <Typography variant="body2">
                {tagTemplateSearchTerm ? 'Try a different search term' : 'Create tag templates from the dashboard'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
              {filteredTagTemplates.map((template) => (
                <Box
                  key={template.id}
                  sx={{
                    p: 2,
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    backgroundColor: selectedTagTemplate?.id === template.id ? '#e8f5e8' : 'transparent',
                    '&:hover': { backgroundColor: selectedTagTemplate?.id === template.id ? '#e8f5e8' : '#f8f9fa' },
                    '&:last-child': { borderBottom: 'none' }
                  }}
                  onClick={() => handleSelectTagTemplate(template)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="600">
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {template.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip 
                          icon={<ScienceIcon />}
                          label={`${(template.formula_rules || []).length} rules`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip 
                          icon={<TrendingUpIcon />}
                          label={`Used ${template.usage_count || 0}×`}
                          size="small"
                          variant="outlined"
                          color={template.usage_count > 0 ? 'success' : 'default'}
                        />
                        <Chip 
                          icon={<ScheduleIcon />}
                          label={new Date(template.created_at).toLocaleDateString()}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                    {selectedTagTemplate?.id === template.id && (
                      <CheckCircleIcon color="success" />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {!selectedTagTemplate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              No tag template selected - template will provide smart tagging rules
            </Typography>
          )}
        </CardContent>
      </Card>

      
      {/* Upload Button */}
      <Box sx={{ textAlign: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleUpload}
          disabled={loading || !userFile || !templateFile}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : (selectedTemplate ? <PlayArrowIcon /> : <CloudUploadIcon />)}
          sx={{ 
            minWidth: 200,
            py: 1.5,
            fontSize: '1.1rem',
            fontWeight: 600
          }}
        >
          {loading 
            ? 'Uploading...' 
            : selectedTemplate 
              ? `Upload with ${selectedTemplate.name}` 
              : 'Upload Files'
          }
        </Button>
        
        {selectedTemplate && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Template will be applied automatically
          </Typography>
        )}
      </Box>

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

      {/* Global Loader Overlay */}
      <LoaderOverlay visible={globalLoading} label="Processing..." />
    </Container>
  );
};

export default UploadFiles;