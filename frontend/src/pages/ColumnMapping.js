import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Box,
  CircularProgress,
  Alert,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Tooltip,
  IconButton
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import HelpIcon from '@mui/icons-material/Help';
import api from '../services/api';

const ColumnMapping = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templateColumns, setTemplateColumns] = useState([]);
  const [userColumns, setUserColumns] = useState([]);
  const [mappings, setMappings] = useState({});
  const [aiSuggestions, setAiSuggestions] = useState({});
  const [savingMappings, setSavingMappings] = useState(false);

  useEffect(() => {
    const fetchColumnData = async () => {
      try {
        setLoading(true);
        const response = await api.getColumnMappingSuggestions(sessionId);
        
        setTemplateColumns(response.data.template_columns || []);
        setUserColumns(response.data.user_columns || []);
        setAiSuggestions(response.data.ai_suggestions || {});
        
        // Initialize mappings with AI suggestions
        const initialMappings = {};
        Object.keys(response.data.ai_suggestions || {}).forEach(templateCol => {
          initialMappings[templateCol] = response.data.ai_suggestions[templateCol].suggested_column;
        });
        
        setMappings(initialMappings);
        setError(null);
      } catch (err) {
        console.error('Error fetching column data:', err);
        setError('Failed to load column data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchColumnData();
    }
  }, [sessionId]);

  const handleMappingChange = (templateColumn, userColumn) => {
    setMappings(prev => ({
      ...prev,
      [templateColumn]: userColumn
    }));
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'success';
    if (confidence >= 0.5) return 'warning';
    return 'error';
  };

  const getConfidenceIcon = (confidence) => {
    if (confidence >= 0.8) return <CheckCircleIcon fontSize="small" />;
    if (confidence >= 0.5) return <WarningIcon fontSize="small" />;
    return <HelpIcon fontSize="small" />;
  };

  const handleSaveMappings = async () => {
    try {
      setSavingMappings(true);
      await api.saveColumnMappings(sessionId, { mappings });
      navigate(`/editor/${sessionId}`);
    } catch (err) {
      console.error('Error saving mappings:', err);
      setError('Failed to save column mappings. Please try again.');
      setSavingMappings(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Column Mapping
      </Typography>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      <Alert severity="info" sx={{ mb: 3 }}>
        Map columns from your file to the template columns. AI has suggested mappings based on column names and data patterns.
      </Alert>
      
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Mapping Instructions
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body1" paragraph>
          For each template column, select the corresponding column from your file. 
          AI-suggested mappings are pre-selected with confidence indicators.
        </Typography>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Confidence Indicators:
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Chip 
              icon={<CheckCircleIcon />} 
              label="High Confidence" 
              color="success" 
              variant="outlined" 
              size="small" 
              className="confidence-high"
            />
            <Chip 
              icon={<WarningIcon />} 
              label="Medium Confidence" 
              color="warning" 
              variant="outlined" 
              size="small" 
              className="confidence-medium"
            />
            <Chip 
              icon={<HelpIcon />} 
              label="Low Confidence" 
              color="error" 
              variant="outlined" 
              size="small" 
              className="confidence-low"
            />
          </Box>
        </Box>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>Template Column</strong></TableCell>
              <TableCell><strong>Your File Column</strong></TableCell>
              <TableCell><strong>AI Confidence</strong></TableCell>
              <TableCell><strong>Sample Data</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {templateColumns.map((templateCol) => {
              const suggestion = aiSuggestions[templateCol] || {};
              const confidence = suggestion.confidence || 0;
              
              return (
                <TableRow key={templateCol}>
                  <TableCell>
                    {templateCol}
                    {suggestion.required && (
                      <Chip 
                        label="Required" 
                        color="primary" 
                        size="small" 
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={mappings[templateCol] || ''}
                        onChange={(e) => handleMappingChange(templateCol, e.target.value)}
                        displayEmpty
                      >
                        <MenuItem value=""><em>Not mapped</em></MenuItem>
                        {userColumns.map((userCol) => (
                          <MenuItem key={userCol} value={userCol}>
                            {userCol}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>
                    {suggestion.suggested_column && (
                      <Tooltip title={`${(confidence * 100).toFixed(0)}% confidence match`}>
                        <Chip 
                          icon={getConfidenceIcon(confidence)}
                          label={confidence >= 0.8 ? 'High' : confidence >= 0.5 ? 'Medium' : 'Low'}
                          color={getConfidenceColor(confidence)}
                          variant="outlined"
                          size="small"
                          className={`confidence-${getConfidenceColor(confidence)}`}
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {suggestion.sample_data && (
                      <Tooltip title={suggestion.sample_data.join(', ')}>
                        <IconButton size="small">
                          <InfoIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button 
          variant="outlined" 
          onClick={() => navigate('/upload')}
        >
          Back to Upload
        </Button>
        <Button
          variant="contained"
          onClick={handleSaveMappings}
          disabled={savingMappings}
          startIcon={savingMappings ? <CircularProgress size={20} color="inherit" /> : null}
        >
          {savingMappings ? 'Saving...' : 'Save Mappings & Continue'}
        </Button>
      </Box>
    </div>
  );
};

export default ColumnMapping;