import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Typography, 
  Paper, 
  Button, 
  Grid, 
  Alert, 
  CircularProgress,
  Box,
  Divider,
  Card,
  CardContent
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DescriptionIcon from '@mui/icons-material/Description';
import api from '../services/api';

const UploadFiles = () => {
  const [userFile, setUserFile] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const navigate = useNavigate();

  const onDropUserFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      setUserFile(acceptedFiles[0]);
      setError(null);
    }
  }, []);

  const onDropTemplateFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      setTemplateFile(acceptedFiles[0]);
      setError(null);
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

  const handleUpload = async () => {
    if (!userFile || !templateFile) {
      setError('Please select both a user file and a template file');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const formData = new FormData();
      formData.append('user_file', userFile);
      formData.append('template_file', templateFile);
      
      const response = await api.uploadFiles(formData);
      
      setSuccess('Files uploaded successfully!');
      
      // Navigate to mapping page with session ID
      setTimeout(() => {
        navigate(`/mapping/${response.data.session_id}`);
      }, 1000);
      
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Error uploading files. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Upload Files
      </Typography>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Your Excel File
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <div 
                {...getUserRootProps()} 
                className={`dropzone ${isUserDragActive ? 'dropzone-active' : ''}`}
              >
                <input {...getUserInputProps()} />
                <CloudUploadIcon fontSize="large" color="primary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {userFile ? userFile.name : 'Drag & drop your Excel file here, or click to select'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported formats: .xlsx, .xls
                </Typography>
              </div>
              
              {userFile && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    <strong>Selected file:</strong> {userFile.name} ({(userFile.size / 1024).toFixed(2)} KB)
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Template File
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <div 
                {...getTemplateRootProps()} 
                className={`dropzone ${isTemplateDragActive ? 'dropzone-active' : ''}`}
              >
                <input {...getTemplateInputProps()} />
                <DescriptionIcon fontSize="large" color="secondary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {templateFile ? templateFile.name : 'Drag & drop your template file here, or click to select'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported formats: .xlsx, .xls
                </Typography>
              </div>
              
              {templateFile && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    <strong>Selected file:</strong> {templateFile.name} ({(templateFile.size / 1024).toFixed(2)} KB)
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleUpload}
          disabled={loading || !userFile || !templateFile}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
        >
          {loading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </Box>
    </div>
  );
};

export default UploadFiles;