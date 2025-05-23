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
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Pagination,
  Chip,
  IconButton,
  Tooltip
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import ErrorIcon from '@mui/icons-material/Error';
import api from '../services/api';

const DataEditor = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const rowsPerPage = 10;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await api.getMappedData(sessionId, page, rowsPerPage);
        
        setData(response.data.rows || []);
        setColumns(response.data.columns || []);
        setTotalPages(Math.ceil((response.data.total_rows || 0) / rowsPerPage));
        setValidationErrors(response.data.validation_errors || {});
        setError(null);
      } catch (err) {
        console.error('Error fetching mapped data:', err);
        setError('Failed to load data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchData();
    }
  }, [sessionId, page]);

  const handlePageChange = (event, value) => {
    setPage(value);
  };

  const handleCellEdit = (rowIndex, column, value) => {
    setEditingCell({ rowIndex, column });
    setEditValue(value);
  };

  const handleSaveCell = () => {
    if (!editingCell) return;

    const { rowIndex, column } = editingCell;
    const newData = [...data];
    newData[rowIndex][column] = editValue;
    setData(newData);
    setEditingCell(null);
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
  };

  const handleSaveAllData = async () => {
    try {
      setSaving(true);
      await api.saveEditedData(sessionId, { rows: data });
      setSaveDialogOpen(true);
    } catch (err) {
      console.error('Error saving data:', err);
      setError('Failed to save data. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      await api.downloadProcessedFile(sessionId);
    } catch (err) {
      console.error('Error downloading file:', err);
      setError('Failed to download file. Please try again.');
    }
  };

  const handleDialogClose = () => {
    setSaveDialogOpen(false);
    navigate('/');
  };

  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const totalErrorCount = Object.values(validationErrors).reduce(
    (sum, errors) => sum + errors.length, 0
  );

  if (loading && page === 1) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Data Editor
      </Typography>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {hasValidationErrors && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="subtitle2">
            {totalErrorCount} validation {totalErrorCount === 1 ? 'issue' : 'issues'} found. Please review and correct the highlighted cells.
          </Typography>
        </Alert>
      )}
      
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Mapped Data Preview
          </Typography>
          <Box>
            <Button
              variant="contained"
              color="primary"
              startIcon={<SaveIcon />}
              onClick={handleSaveAllData}
              disabled={saving}
              sx={{ mr: 1 }}
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleDownload}
            >
              Download
            </Button>
          </Box>
        </Box>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Review and edit the mapped data before finalizing. Click on a cell to edit its value.
        </Typography>
        
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                {columns.map((column) => (
                  <TableCell key={column}>{column}</TableCell>
                ))}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  <TableCell>{(page - 1) * rowsPerPage + rowIndex + 1}</TableCell>
                  {columns.map((column) => {
                    const cellValue = row[column] || '';
                    const hasError = validationErrors[`${rowIndex}-${column}`];
                    
                    return (
                      <TableCell key={column}>
                        {editingCell && 
                         editingCell.rowIndex === rowIndex && 
                         editingCell.column === column ? (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <TextField
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              size="small"
                              autoFocus
                              fullWidth
                              error={!!hasError}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveCell();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                            />
                            <IconButton size="small" onClick={handleSaveCell}>
                              <SaveIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        ) : (
                          <Box 
                            onClick={() => handleCellEdit(rowIndex, column, cellValue)}
                            sx={{ 
                              cursor: 'pointer', 
                              p: 1,
                              '&:hover': { bgcolor: 'action.hover' },
                              ...(hasError ? { 
                                bgcolor: 'error.light', 
                                color: 'error.contrastText',
                                borderRadius: 1
                              } : {})
                            }}
                          >
                            {hasError ? (
                              <Tooltip title={validationErrors[`${rowIndex}-${column}`].join(', ')}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <ErrorIcon fontSize="small" sx={{ mr: 1 }} />
                                  {cellValue}
                                </Box>
                              </Tooltip>
                            ) : cellValue}
                          </Box>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <IconButton 
                      size="small" 
                      onClick={() => {
                        // Find first column to edit
                        if (columns.length > 0) {
                          handleCellEdit(rowIndex, columns[0], row[columns[0]] || '');
                        }
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination 
            count={totalPages} 
            page={page} 
            onChange={handlePageChange} 
            color="primary" 
          />
        </Box>
      </Paper>
      
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button 
          variant="outlined" 
          onClick={() => navigate(`/mapping/${sessionId}`)}
        >
          Back to Mapping
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handleSaveAllData}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
        >
          {saving ? 'Saving...' : 'Save and Finish'}
        </Button>
      </Box>
      
      <Dialog
        open={saveDialogOpen}
        onClose={handleDialogClose}
      >
        <DialogTitle>Data Saved Successfully</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your data has been processed and saved successfully. You can now download the processed file or return to the dashboard.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDownload} startIcon={<DownloadIcon />}>
            Download File
          </Button>
          <Button onClick={handleDialogClose} variant="contained">
            Return to Dashboard
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default DataEditor;