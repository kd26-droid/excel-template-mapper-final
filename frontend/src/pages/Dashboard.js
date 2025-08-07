import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Grid, 
  Card, 
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Box,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TablePagination,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  Fade,
  Grow,
  Stack
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import StandaloneFormulaBuilder from '../components/StandaloneFormulaBuilder';
import {
  UploadFile as UploadFileIcon,
  History as HistoryIcon,
  LibraryBooks as LibraryBooksIcon,
  PlayArrow as PlayArrowIcon,
  Delete as DeleteIcon,
  Star as StarIcon,
  Folder as FolderIcon,
  Search as SearchIcon,
  GetApp as GetAppIcon,
  Description as DescriptionIcon,
  Transform as TransformIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  Science as ScienceIcon
} from '@mui/icons-material';
import api from '../services/api';
import FormulaBuilder from '../components/FormulaBuilder';

const Dashboard = () => {
  const [uploads, setUploads] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templatesError, setTemplatesError] = useState(null);
  
  // Template management state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  
  // Template search and filtering
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [templateSortBy, setTemplateSortBy] = useState('usage_count');
  const [templateSortOrder, setTemplateSortOrder] = useState('desc');
  const [templatePage, setTemplatePage] = useState(0);
  const [templatesPerPage, setTemplatesPerPage] = useState(10);
  
  // Tag Templates state
  const [tagTemplates, setTagTemplates] = useState([]);
  const [tagTemplatesLoading, setTagTemplatesLoading] = useState(true);
  const [tagTemplatesError, setTagTemplatesError] = useState(null);
  const [tagTemplateSearchTerm, setTagTemplateSearchTerm] = useState('');
  const [tagTemplateSortBy, setTagTemplateSortBy] = useState('usage_count');
  const [tagTemplateSortOrder, setTagTemplateSortOrder] = useState('desc');
  const [tagTemplatePage, setTagTemplatePage] = useState(0);
  const [tagTemplatesPerPage, setTagTemplatesPerPage] = useState(10);
  const [tagTemplateDeleteDialogOpen, setTagTemplateDeleteDialogOpen] = useState(false);
  const [tagTemplateToDelete, setTagTemplateToDelete] = useState(null);
  const [deletingTagTemplate, setDeletingTagTemplate] = useState(false);
  
  // Formula builder state
  const [formulaBuilderOpen, setFormulaBuilderOpen] = useState(false);
  
  // Upload search and filtering
  const [uploadSearchTerm, setUploadSearchTerm] = useState('');
  const [uploadSortBy, setUploadSortBy] = useState('upload_date');
  const [uploadSortOrder, setUploadSortOrder] = useState('desc');
  const [uploadPage, setUploadPage] = useState(0);
  const [uploadsPerPage, setUploadsPerPage] = useState(10);
  const [uploadStatusFilter, setUploadStatusFilter] = useState('all');
  
  // Download state
  const [downloadingOriginal, setDownloadingOriginal] = useState({});
  const [downloadingConverted, setDownloadingConverted] = useState({});
  
  // Template stats
  const [templateStats, setTemplateStats] = useState({
    totalTemplates: 0,
    totalUsage: 0,
    mostUsed: null,
    top3Templates: []
  });

  
  const [selectedTemplateForFormulas, setSelectedTemplateForFormulas] = useState(null);

  const navigate = useNavigate();

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await api.getUploadDashboard();
        setUploads(response.data.uploads || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  // Fetch mapping templates
  const loadTemplates = async () => {
    try {
      setTemplatesLoading(true);
      const response = await api.getMappingTemplates();
      const templateData = response.data.templates || [];
      setTemplates(templateData);
      
      // Calculate stats
      const sortedByUsage = [...templateData].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
      const stats = {
        totalTemplates: templateData.length,
        totalUsage: templateData.reduce((sum, t) => sum + (t.usage_count || 0), 0),
        mostUsed: sortedByUsage[0],
        top3Templates: sortedByUsage.slice(0, 3)
      };
      setTemplateStats(stats);
      setTemplatesError(null);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setTemplatesError('Failed to load mapping templates.');
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadTagTemplates();
  }, []);

  // Fetch tag templates
  const loadTagTemplates = async () => {
    try {
      setTagTemplatesLoading(true);
      const response = await api.getTagTemplates();
      const tagTemplateData = response.data.templates || [];
      setTagTemplates(tagTemplateData);
      setTagTemplatesError(null);
    } catch (err) {
      console.error('Error fetching tag templates:', err);
      setTagTemplatesError('Failed to load tag templates.');
    } finally {
      setTagTemplatesLoading(false);
    }
  };

  // Enhanced template filtering and sorting
  const filteredAndSortedTemplates = React.useMemo(() => {
    let filtered = templates.filter(template =>
      (template.name && template.name.toLowerCase().includes(templateSearchTerm.toLowerCase())) ||
      (template.description && template.description.toLowerCase().includes(templateSearchTerm.toLowerCase()))
    );

    // Sort templates
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (templateSortBy) {
        case 'created_at':
          aValue = new Date(a.created_at);
          bValue = new Date(b.created_at);
          break;
        case 'usage_count':
          aValue = a.usage_count || 0;
          bValue = b.usage_count || 0;
          break;
        case 'name':
        default:
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
          break;
      }
      
      if (templateSortOrder === 'desc') {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    return filtered;
  }, [templates, templateSearchTerm, templateSortBy, templateSortOrder]);

  // Enhanced tag template filtering and sorting
  const filteredAndSortedTagTemplates = React.useMemo(() => {
    let filtered = tagTemplates.filter(template =>
      (template.name && template.name.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase())) ||
      (template.description && template.description.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase()))
    );

    // Sort tag templates
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (tagTemplateSortBy) {
        case 'created_at':
          aValue = new Date(a.created_at);
          bValue = new Date(b.created_at);
          break;
        case 'usage_count':
          aValue = a.usage_count || 0;
          bValue = b.usage_count || 0;
          break;
        case 'name':
        default:
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
          break;
      }
      
      if (tagTemplateSortOrder === 'desc') {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    return filtered;
  }, [tagTemplates, tagTemplateSearchTerm, tagTemplateSortBy, tagTemplateSortOrder]);

  // Enhanced upload filtering and sorting
  const filteredAndSortedUploads = React.useMemo(() => {
    let filtered = uploads.filter(upload => {
      const matchesSearch = (upload.template_name || '').toLowerCase().includes(uploadSearchTerm.toLowerCase());
      const matchesStatus = uploadStatusFilter === 'all' || upload.status === uploadStatusFilter;
      return matchesSearch && matchesStatus;
    });

    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (uploadSortBy) {
        case 'upload_date':
          aValue = new Date(a.upload_date);
          bValue = new Date(b.upload_date);
          break;
        case 'template_name':
          aValue = (a.template_name || '').toLowerCase();
          bValue = (b.template_name || '').toLowerCase();
          break;
        case 'rows_processed':
          aValue = a.rows_processed || 0;
          bValue = b.rows_processed || 0;
          break;
        default:
          aValue = (a.template_name || '').toLowerCase();
          bValue = (b.template_name || '').toLowerCase();
          break;
      }
      
      if (uploadSortOrder === 'desc') {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    return filtered;
  }, [uploads, uploadSearchTerm, uploadSortBy, uploadSortOrder, uploadStatusFilter]);

  // Paginated data
  const paginatedTemplates = React.useMemo(() => {
    const start = templatePage * templatesPerPage;
    return filteredAndSortedTemplates.slice(start, start + templatesPerPage);
  }, [filteredAndSortedTemplates, templatePage, templatesPerPage]);

  const paginatedTagTemplates = React.useMemo(() => {
    const start = tagTemplatePage * tagTemplatesPerPage;
    return filteredAndSortedTagTemplates.slice(start, start + tagTemplatesPerPage);
  }, [filteredAndSortedTagTemplates, tagTemplatePage, tagTemplatesPerPage]);

  const paginatedUploads = React.useMemo(() => {
    const start = uploadPage * uploadsPerPage;
    return filteredAndSortedUploads.slice(start, start + uploadsPerPage);
  }, [filteredAndSortedUploads, uploadPage, uploadsPerPage]);

  // Extract readable filename
  const extractReadableFilename = (longFilename) => {
    if (!longFilename) return 'Unknown File';
    
    const parts = longFilename.split('_');
    if (parts.length > 1) {
      const originalName = parts[parts.length - 1];
      const nameWithoutExt = originalName.replace(/\.(xlsx|xls)$/i, '');
      const extension = originalName.match(/\.(xlsx|xls)$/i)?.[0] || '.xlsx';
      return `${nameWithoutExt}${extension}`;
    }
    
    return longFilename.length > 30 ? `${longFilename.substring(0, 30)}...` : longFilename;
  };

  const handleUploadClick = () => {
    navigate('/upload');
  };

  const handleOpenFormulaBuilder = () => {
    setFormulaBuilderOpen(true);
  };

  const handleCloseFormulaBuilder = () => {
    setFormulaBuilderOpen(false);
  };

  const handleSaveFormulaTemplate = async (templateData) => {
    try {
      const response = await api.saveTagTemplate(
        templateData.name,
        templateData.description,
        templateData.formula_rules
      );
      
      if (response.data.success) {
        console.log('Tag template saved successfully:', response.data.template);
        
        // Refresh tag templates list
        loadTagTemplates();
        
        // Close the formula builder
        setFormulaBuilderOpen(false);
        
        // Optionally navigate to upload with the template
        navigate('/upload', {
          state: {
            selectedTagTemplate: response.data.template,
            smartTagFormulaRules: templateData.formula_rules,
          },
        });
      } else {
        console.error('Failed to save tag template:', response.data.error);
        alert(`Failed to save tag template: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error saving tag template:', error);
      alert(`Error saving tag template: ${error.message}`);
    }
  };

  const handleUseTemplate = async (template) => {
    // Check if there are any existing sessions we can apply the template to
    const sessionsWithData = uploads.filter(upload => 
      upload.status === 'completed' || upload.status === 'mapped'
    );
    
    if (sessionsWithData.length > 0) {
      // Apply template to the most recent session
      const targetSession = sessionsWithData[0];
      try {
        const response = await api.applyMappingTemplate(targetSession.session_id, template.id);
        if (response.data.success) {
          // Navigate to DataEditor to show results
          navigate(`/data-editor/${targetSession.session_id}`);
        } else {
          console.error('Failed to apply template:', response.data.error);
          // Fall back to upload flow
          navigate('/upload', { 
            state: { 
              selectedTemplate: template,
              autoApplyTemplate: true 
            } 
          });
        }
      } catch (error) {
        console.error('Error applying template:', error);
        // Fall back to upload flow
        navigate('/upload', { 
          state: { 
            selectedTemplate: template,
            autoApplyTemplate: true 
          } 
        });
      }
    } else {
      // No existing sessions, go to upload
      navigate('/upload', { 
        state: { 
          selectedTemplate: template,
          autoApplyTemplate: true 
        } 
      });
    }
  };


  const handleFormulaBuilderClose = () => {
    setFormulaBuilderOpen(false);
    setSelectedTemplateForFormulas(null);
  };

  const handleFormulasApplied = async (formulaResult) => {
    // Update the template with new formula rules
    // This would integrate with the template saving system
    console.log('Applied formulas to template:', selectedTemplateForFormulas?.name, formulaResult);
    handleFormulaBuilderClose();
  };

  const handleDeleteTemplate = async () => {
    if (!templateToDelete) return;

    setDeleting(true);
    try {
      await api.deleteMappingTemplate(templateToDelete.id);
      
      setTemplates(prev => prev.filter(t => t.id !== templateToDelete.id));
      setTemplateStats(prev => ({
        ...prev,
        totalTemplates: prev.totalTemplates - 1,
        totalUsage: prev.totalUsage - (templateToDelete.usage_count || 0)
      }));

      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Error deleting template:', err);
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = (template) => {
    setTemplateToDelete(template);
    setDeleteDialogOpen(true);
  };

  // Tag Template handlers
  const handleUseTagTemplate = (template) => {
    navigate('/upload', { 
      state: { 
        selectedTagTemplate: template,
        smartTagFormulaRules: template.formula_rules || []
      } 
    });
  };

  const handleDeleteTagTemplate = async () => {
    if (!tagTemplateToDelete) return;

    setDeletingTagTemplate(true);
    try {
      await api.deleteTagTemplate(tagTemplateToDelete.id);
      
      setTagTemplates(prev => prev.filter(t => t.id !== tagTemplateToDelete.id));
      setTagTemplateDeleteDialogOpen(false);
      setTagTemplateToDelete(null);
    } catch (err) {
      console.error('Error deleting tag template:', err);
    } finally {
      setDeletingTagTemplate(false);
    }
  };

  const openTagTemplateDeleteDialog = (template) => {
    setTagTemplateToDelete(template);
    setTagTemplateDeleteDialogOpen(true);
  };

  const clearTagTemplateFilters = () => {
    setTagTemplateSearchTerm('');
    setTagTemplateSortBy('usage_count');
    setTagTemplateSortOrder('desc');
    setTagTemplatePage(0);
  };

  // Download handlers
  const handleDownloadOriginal = async (upload) => {
    const uploadId = upload.session_id;
    setDownloadingOriginal(prev => ({ ...prev, [uploadId]: true }));
    
    try {
      await api.downloadFileEnhanced(uploadId, 'original');
    } catch (err) {
      console.error('Error downloading original file:', err);
    } finally {
      setDownloadingOriginal(prev => ({ ...prev, [uploadId]: false }));
    }
  };

  const handleDownloadConverted = async (upload) => {
    const uploadId = upload.session_id;
    setDownloadingConverted(prev => ({ ...prev, [uploadId]: true }));
    
    try {
      await api.downloadFileEnhanced(uploadId, 'converted');
    } catch (err) {
      console.error('Error downloading converted file:', err);
    } finally {
      setDownloadingConverted(prev => ({ ...prev, [uploadId]: false }));
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };

  const getPopularityColor = (usageCount) => {
    if (usageCount >= 10) return 'success';
    if (usageCount >= 5) return 'warning';
    if (usageCount >= 1) return 'info';
    return 'default';
  };

  const clearTemplateFilters = () => {
    setTemplateSearchTerm('');
    setTemplateSortBy('usage_count');
    setTemplateSortOrder('desc');
    setTemplatePage(0);
  };

  const clearUploadFilters = () => {
    setUploadSearchTerm('');
    setUploadSortBy('upload_date');
    setUploadSortOrder('desc');
    setUploadStatusFilter('all');
    setUploadPage(0);
  };

  return (
    <Box sx={{ p: 3, backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Modern Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" fontWeight="700" color="#1e293b" gutterBottom>
          Dashboard
        </Typography>
        <Typography variant="h6" color="#64748b" sx={{ mb: 3 }}>
          Manage your Excel mapping workflows with intelligent automation
        </Typography>
      </Box>

      {/* Quick Stats */}
      <Fade in timeout={1200}>
        <Stack spacing={2} sx={{ mb: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight="600" color="#1e293b" gutterBottom>
                Quick Stats
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f0f9ff', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="700" color="#0369a1">
                      {templateStats.totalTemplates}
                    </Typography>
                    <Typography variant="body2" color="#64748b">Mapping Templates</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f5f3ff', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="700" color="#6d28d9">
                      {tagTemplates.length}
                    </Typography>
                    <Typography variant="body2" color="#64748b">Tag Templates</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Box sx={{ textAlign: 'center', p: 2, bgcolor: '#f0fdf4', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="700" color="#166534">
                      {uploads.length}
                    </Typography>
                    <Typography variant="body2" color="#64748b">Uploads</Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {templateStats.top3Templates && templateStats.top3Templates.length > 0 && (
            <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="600" color="#1e293b" gutterBottom>
                  Top 3 Mapping Templates
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ mt: 2, flexWrap: 'wrap' }}>
                  {templateStats.top3Templates.map((template) => (
                    <Chip
                      key={template.id}
                      avatar={
                        <Avatar sx={{ bgcolor: '#fef3c7', color: '#f59e0b' }}>
                          <StarIcon sx={{ fontSize: 16 }} />
                        </Avatar>
                      }
                      label={`${template.name} (Used ${template.usage_count || 0} times)`}
                      onClick={() => handleUseTemplate(template)}
                      clickable
                      sx={{
                        fontWeight: 500,
                        p: 2,
                        '&:hover': {
                          backgroundColor: '#f0f9ff',
                          borderColor: '#3b82f6'
                        }
                      }}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Fade>

      {/* Enhanced Recent Uploads */}
      <Fade in timeout={1400}>
        <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <CardContent sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: '#8b5cf6', width: 40, height: 40 }}>
                  <HistoryIcon />
                </Avatar>
                <Box>
                  <Typography variant="h5" fontWeight="600" color="#1e293b">
                    Recent Uploads
                  </Typography>
                  <Typography variant="body2" color="#64748b">
                    {uploads.length} uploads total
                  </Typography>
                </Box>
              </Box>
              <Button
                variant="contained"
                startIcon={<UploadFileIcon />}
                onClick={handleUploadClick}
              >
                Start Upload
              </Button>
            </Box>

            {/* Enhanced Search & Filter */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
              <TextField
                size="small"
                placeholder="Search uploads..."
                value={uploadSearchTerm}
                onChange={(e) => setUploadSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchIcon size="small" /></InputAdornment>,
                  endAdornment: uploadSearchTerm && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setUploadSearchTerm('')}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  )
                }}
                sx={{ flex: 1 }}
              />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Status</InputLabel>
                <Select value={uploadStatusFilter} label="Status" onChange={(e) => setUploadStatusFilter(e.target.value)}>
                  <MenuItem value="all">All Status</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                  <MenuItem value="in_progress">In Progress</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Sort by</InputLabel>
                <Select value={uploadSortBy} label="Sort by" onChange={(e) => setUploadSortBy(e.target.value)}>
                  <MenuItem value="upload_date">Date</MenuItem>
                  <MenuItem value="template_name">Name</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>Order</InputLabel>
                <Select value={uploadSortOrder} label="Order" onChange={(e) => setUploadSortOrder(e.target.value)}>
                  {uploadSortBy === 'upload_date' ? (
                    [
                      <MenuItem key="desc" value="desc">Latest</MenuItem>,
                      <MenuItem key="asc" value="asc">Earliest</MenuItem>
                    ]
                  ) : (
                    [
                      <MenuItem key="asc" value="asc">A → Z</MenuItem>,
                      <MenuItem key="desc" value="desc">Z → A</MenuItem>
                    ]
                  )}
                </Select>
              </FormControl>
              {(uploadSearchTerm || uploadStatusFilter !== 'all' || uploadSortBy !== 'upload_date' || uploadSortOrder !== 'desc') && (
                <Button size="small" onClick={clearUploadFilters} startIcon={<ClearIcon />}>
                  Clear
                </Button>
              )}
            </Stack>

            {/* Upload List */}
            {loading ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : error ? (
              <Alert severity="error">{error}</Alert>
            ) : uploads.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6, color: '#64748b' }}>
                <HistoryIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                <Typography variant="h6" fontWeight="500" gutterBottom>
                  No Upload History
                </Typography>
                <Typography variant="body2">
                  Start by uploading your first file
                </Typography>
              </Box>
            ) : (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>File Name</strong></TableCell>
                        <TableCell><strong>Upload Date</strong></TableCell>
                        <TableCell align="center"><strong>Rows</strong></TableCell>
                        <TableCell align="center"><strong>Status</strong></TableCell>
                        <TableCell align="center"><strong>Actions</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedUploads.map((upload, index) => (
                        <Grow in timeout={400 + index * 50} key={upload.session_id}>
                          <TableRow 
                            sx={{ 
                              '&:hover': { backgroundColor: '#f8fafc' },
                              borderLeft: '3px solid transparent',
                              '&:hover': { borderLeftColor: '#3b82f6' }
                            }}
                          >
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar sx={{ bgcolor: '#e0e7ff', color: '#3b82f6', width: 32, height: 32 }}>
                                  <DescriptionIcon fontSize="small" />
                                </Avatar>
                                <Box>
                                  <Typography variant="body2" fontWeight="600" color="#1e293b">
                                    {extractReadableFilename(upload.template_name)}
                                  </Typography>
                                  <Typography variant="caption" color="#64748b">
                                    Session: {upload.session_id.slice(0, 8)}...
                                  </Typography>
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" color="#64748b">
                                {formatDate(upload.upload_date)}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip 
                                label={upload.rows_processed || 0}
                                size="small"
                                color="info"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Chip 
                                label={upload.status}
                                size="small"
                                color={upload.status === 'completed' ? 'success' : 'default'}
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                                <Button 
                                  size="small" 
                                  variant="outlined"
                                  startIcon={<FolderIcon />}
                                  sx={{ textTransform: 'none', minWidth: 'auto' }}
                                  onClick={() => navigate(`/editor/${upload.session_id}`)}
                                >
                                  View
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  startIcon={downloadingOriginal[upload.session_id] ? <CircularProgress size={14} /> : <GetAppIcon />}
                                  onClick={() => handleDownloadOriginal(upload)}
                                  disabled={downloadingOriginal[upload.session_id]}
                                  sx={{ textTransform: 'none', minWidth: 'auto' }}
                                >
                                  Original
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="secondary"
                                  startIcon={downloadingConverted[upload.session_id] ? <CircularProgress size={14} /> : <TransformIcon />}
                                  onClick={() => handleDownloadConverted(upload)}
                                  disabled={downloadingConverted[upload.session_id]}
                                  sx={{ textTransform: 'none', minWidth: 'auto' }}
                                >
                                  Converted
                                </Button>
                              </Box>
                            </TableCell>
                          </TableRow>
                        </Grow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Upload Pagination */}
                {filteredAndSortedUploads.length > uploadsPerPage && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                    <TablePagination
                      component="div"
                      count={filteredAndSortedUploads.length}
                      page={uploadPage}
                      onPageChange={(event, newPage) => setUploadPage(newPage)}
                      rowsPerPage={uploadsPerPage}
                      onRowsPerPageChange={(event) => {
                        setUploadsPerPage(parseInt(event.target.value, 10));
                        setUploadPage(0);
                      }}
                      rowsPerPageOptions={[5, 10, 25, 50]}
                      labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
                      size="small"
                    />
                  </Box>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Fade>

      <Grid container spacing={3} sx={{ mt: 4 }}>
        {/* Compact Templates Section */}
        <Grid item xs={12} lg={6}>
          <Fade in timeout={1000}>
            <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', height: '100%' }}>
              <CardContent sx={{ p: 3 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ bgcolor: '#3b82f6', width: 40, height: 40 }}>
                      <LibraryBooksIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="h5" fontWeight="600" color="#1e293b">
                        Mapping Templates
                      </Typography>
                      <Typography variant="body2" color="#64748b">
                        {templateStats.totalTemplates} templates • {templateStats.totalUsage} total uses
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Refresh">
                      <IconButton onClick={() => window.location.reload()} size="small">
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Compact Search & Filter */}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
                  <TextField
                    size="small"
                    placeholder="Search templates..."
                    value={templateSearchTerm}
                    onChange={(e) => setTemplateSearchTerm(e.target.value)}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><SearchIcon size="small" /></InputAdornment>,
                      endAdornment: templateSearchTerm && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setTemplateSearchTerm('')}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      )
                    }}
                    sx={{ flex: 1 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Sort by</InputLabel>
                    <Select value={templateSortBy} label="Sort by" onChange={(e) => setTemplateSortBy(e.target.value)}>
                      <MenuItem value="name">Name</MenuItem>
                      <MenuItem value="created_at">Date</MenuItem>
                      <MenuItem value="usage_count">Usage</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Order</InputLabel>
                    <Select value={templateSortOrder} label="Order" onChange={(e) => setTemplateSortOrder(e.target.value)}>
                      <MenuItem value="asc">{templateSortBy === 'name' ? 'A-Z' : templateSortBy === 'created_at' ? 'Earliest' : 'Least'}</MenuItem>
                      <MenuItem value="desc">{templateSortBy === 'name' ? 'Z-A' : templateSortBy === 'created_at' ? 'Latest' : 'Most'}</MenuItem>
                    </Select>
                  </FormControl>
                  {(templateSearchTerm || templateSortBy !== 'usage_count' || templateSortOrder !== 'desc') && (
                    <Button size="small" onClick={clearTemplateFilters} startIcon={<ClearIcon />}>
                      Clear
                    </Button>
                  )}
                </Stack>

                {/* Compact Template List */}
                {templatesLoading ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress size={32} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Loading templates...
                    </Typography>
                  </Box>
                ) : templatesError ? (
                  <Alert severity="error" sx={{ mb: 2 }}>{templatesError}</Alert>
                ) : templateStats.totalTemplates === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 6, color: '#64748b' }}>
                    <LibraryBooksIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                    <Typography variant="h6" fontWeight="500" gutterBottom>
                      No Templates Yet
                    </Typography>
                    <Typography variant="body2">
                      Create your first template by saving a column mapping
                    </Typography>
                  </Box>
                ) : (
                  <>
                    <List sx={{ p: 0 }}>
                      {paginatedTemplates.map((template, index) => (
                        <Grow in timeout={600 + index * 100} key={template.id}>
                          <ListItem 
                            sx={{ 
                              border: '1px solid #e2e8f0',
                              borderRadius: 2,
                              mb: 1,
                              '&:hover': { 
                                backgroundColor: '#f8fafc',
                                borderColor: '#3b82f6',
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)'
                              },
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <ListItemAvatar>
                              <Avatar sx={{ bgcolor: '#f1f5f9', color: '#3b82f6', width: 36, height: 36 }}>
                                <LibraryBooksIcon fontSize="small" />
                              </Avatar>
                            </ListItemAvatar>
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography variant="subtitle2" fontWeight="600" noWrap sx={{ color: '#1e293b' }}>
                                  {template.name}
                                </Typography>
                                {templateStats.mostUsed && templateStats.mostUsed.id === template.id && template.usage_count > 0 && (
                                  <StarIcon sx={{ color: '#f59e0b', fontSize: 16 }} />
                                )}
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <Chip 
                                  label={`${template.total_mappings} mappings`}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                                <Chip 
                                  label={`Used ${template.usage_count || 0}×`}
                                  size="small"
                                  color={getPopularityColor(template.usage_count || 0)}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                  {formatDate(template.created_at)}
                                </Typography>
                              </Box>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<PlayArrowIcon />}
                                onClick={() => handleUseTemplate(template)}
                                sx={{ 
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  borderRadius: 1.5,
                                  minWidth: 'auto'
                                }}
                              >
                                Use
                              </Button>
                              <IconButton 
                                size="small" 
                                onClick={() => openDeleteDialog(template)}
                                sx={{ color: '#ef4444' }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </ListItem>
                        </Grow>
                      ))}
                    </List>

                    {/* Compact Pagination */}
                    {filteredAndSortedTemplates.length > templatesPerPage && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                        <TablePagination
                          component="div"
                          count={filteredAndSortedTemplates.length}
                          page={templatePage}
                          onPageChange={(event, newPage) => setTemplatePage(newPage)}
                          rowsPerPage={templatesPerPage}
                          onRowsPerPageChange={(event) => {
                            setTemplatesPerPage(parseInt(event.target.value, 10));
                            setTemplatePage(0);
                          }}
                          rowsPerPageOptions={[5, 10, 15, 20]}
                          labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
                          size="small"
                        />
                      </Box>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </Fade>
        </Grid>

        {/* Tag Templates Section */}
        <Grid item xs={12} lg={6}>
          <Fade in timeout={1100}>
            <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', height: '100%' }}>
              <CardContent sx={{ p: 3 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ bgcolor: '#10b981', width: 40, height: 40 }}>
                      <ScienceIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="h5" fontWeight="600" color="#1e293b">
                        Tag Templates
                      </Typography>
                      <Typography variant="body2" color="#64748b">
                        {tagTemplates.length} templates • Smart tag rules
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Create Smart Tag Template">
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={handleOpenFormulaBuilder}
                        startIcon={<ScienceIcon />}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        New Template
                      </Button>
                    </Tooltip>
                    <Tooltip title="Refresh">
                      <IconButton onClick={() => loadTagTemplates()} size="small">
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Compact Search & Filter */}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
                  <TextField
                    size="small"
                    placeholder="Search tag templates..."
                    value={tagTemplateSearchTerm}
                    onChange={(e) => setTagTemplateSearchTerm(e.target.value)}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><SearchIcon size="small" /></InputAdornment>,
                      endAdornment: tagTemplateSearchTerm && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setTagTemplateSearchTerm('')}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      )
                    }}
                    sx={{ flex: 1 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Sort by</InputLabel>
                    <Select value={tagTemplateSortBy} label="Sort by" onChange={(e) => setTagTemplateSortBy(e.target.value)}>
                      <MenuItem value="name">Name</MenuItem>
                      <MenuItem value="created_at">Date</MenuItem>
                      <MenuItem value="usage_count">Usage</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Order</InputLabel>
                    <Select value={tagTemplateSortOrder} label="Order" onChange={(e) => setTagTemplateSortOrder(e.target.value)}>
                      <MenuItem value="asc">{tagTemplateSortBy === 'name' ? 'A-Z' : tagTemplateSortBy === 'created_at' ? 'Earliest' : 'Least'}</MenuItem>
                      <MenuItem value="desc">{tagTemplateSortBy === 'name' ? 'Z-A' : tagTemplateSortBy === 'created_at' ? 'Latest' : 'Most'}</MenuItem>
                    </Select>
                  </FormControl>
                  {(tagTemplateSearchTerm || tagTemplateSortBy !== 'usage_count' || tagTemplateSortOrder !== 'desc') && (
                    <Button size="small" onClick={clearTagTemplateFilters} startIcon={<ClearIcon />}>
                      Clear
                    </Button>
                  )}
                </Stack>

                {/* Compact Tag Template List */}
                {tagTemplatesLoading ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress size={32} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Loading tag templates...
                    </Typography>
                  </Box>
                ) : tagTemplatesError ? (
                  <Alert severity="error" sx={{ mb: 2 }}>{tagTemplatesError}</Alert>
                ) : tagTemplates.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 6, color: '#64748b' }}>
                    <ScienceIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                    <Typography variant="h6" fontWeight="500" gutterBottom>
                      No Tag Templates Yet
                    </Typography>
                    <Typography variant="body2">
                      Create your first template by saving smart tag rules
                    </Typography>
                  </Box>
                ) : (
                  <>
                    <List sx={{ p: 0 }}>
                      {paginatedTagTemplates.map((template, index) => (
                        <Grow in timeout={600 + index * 100} key={template.id}>
                          <ListItem 
                            sx={{ 
                              border: '1px solid #e2e8f0',
                              borderRadius: 2,
                              mb: 1,
                              '&:hover': { 
                                backgroundColor: '#f0fdf4',
                                borderColor: '#10b981',
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)'
                              },
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <ListItemAvatar>
                              <Avatar sx={{ bgcolor: '#ecfdf5', color: '#10b981', width: 36, height: 36 }}>
                                <ScienceIcon fontSize="small" />
                              </Avatar>
                            </ListItemAvatar>
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography variant="subtitle2" fontWeight="600" noWrap sx={{ color: '#1e293b' }}>
                                  {template.name}
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <Chip 
                                  label={`${(template.formula_rules || []).length} rules`}
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                                <Chip 
                                  label={`Used ${template.usage_count || 0}×`}
                                  size="small"
                                  color={getPopularityColor(template.usage_count || 0)}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                  {formatDate(template.created_at)}
                                </Typography>
                              </Box>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<PlayArrowIcon />}
                                onClick={() => handleUseTagTemplate(template)}
                                sx={{ 
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  borderRadius: 1.5,
                                  minWidth: 'auto',
                                  bgcolor: '#10b981',
                                  '&:hover': { bgcolor: '#059669' }
                                }}
                              >
                                Use
                              </Button>
                              <IconButton 
                                size="small" 
                                onClick={() => openTagTemplateDeleteDialog(template)}
                                sx={{ color: '#ef4444' }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          </ListItem>
                        </Grow>
                      ))}
                    </List>

                    {/* Compact Pagination */}
                    {filteredAndSortedTagTemplates.length > tagTemplatesPerPage && (
                      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                        <TablePagination
                          component="div"
                          count={filteredAndSortedTagTemplates.length}
                          page={tagTemplatePage}
                          onPageChange={(event, newPage) => setTagTemplatePage(newPage)}
                          rowsPerPage={tagTemplatesPerPage}
                          onRowsPerPageChange={(event) => {
                            setTagTemplatesPerPage(parseInt(event.target.value, 10));
                            setTagTemplatePage(0);
                          }}
                          rowsPerPageOptions={[5, 10, 15, 20]}
                          labelDisplayedRows={({ from, to, count }) => `${from}–${to} of ${count}`}
                          size="small"
                        />
                      </Box>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </Fade>
        </Grid>
      </Grid>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: '#fee2e2', color: '#dc2626' }}>
              <DeleteIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="600">
                Delete Template
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This action cannot be undone
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            <ClearIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the template <strong>"{templateToDelete?.name}"</strong>?
            <br /><br />
            This template has been used <strong>{templateToDelete?.usage_count || 0} times</strong>.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteTemplate}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete Template'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tag Template Delete Confirmation Dialog */}
      <Dialog
        open={tagTemplateDeleteDialogOpen}
        onClose={() => !deletingTagTemplate && setTagTemplateDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: '#fee2e2', color: '#dc2626' }}>
              <DeleteIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="600">
                Delete Tag Template
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This action cannot be undone
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setTagTemplateDeleteDialogOpen(false)} disabled={deletingTagTemplate}>
            <ClearIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the tag template <strong>"{tagTemplateToDelete?.name}"</strong>?
            <br /><br />
            This template has <strong>{(tagTemplateToDelete?.formula_rules || []).length} formula rules</strong> and has been used <strong>{tagTemplateToDelete?.usage_count || 0} times</strong>.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setTagTemplateDeleteDialogOpen(false)} disabled={deletingTagTemplate}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteTagTemplate}
            color="error"
            variant="contained"
            disabled={deletingTagTemplate}
            startIcon={deletingTagTemplate ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {deletingTagTemplate ? 'Deleting...' : 'Delete Template'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Formula Builder for Dashboard Template Configuration */}
      {selectedTemplateForFormulas && (
        <FormulaBuilder
          open={formulaBuilderOpen}
          onClose={handleFormulaBuilderClose}
          sessionId="dashboard" // Special session for template configuration
          availableColumns={[]} // Will be populated when we have a session
          onApplyFormulas={handleFormulasApplied}
          initialRules={selectedTemplateForFormulas.formula_rules || []}
          templateMode={true}
          templateName={selectedTemplateForFormulas.name}
        />
      )}

      {/* Standalone Formula Builder Dialog */}
      <StandaloneFormulaBuilder
        open={formulaBuilderOpen}
        onClose={handleCloseFormulaBuilder}
        onSave={handleSaveFormulaTemplate}
      />
    </Box>
  );
};

export default Dashboard;
