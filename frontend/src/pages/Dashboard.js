import React, { useState, useEffect } from 'react';
import { 
  Typography, 
  Grid, 
  Card, 
  CardContent, 
  CardActions,
  Button,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import HistoryIcon from '@mui/icons-material/History';
import api from '../services/api';

const Dashboard = () => {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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

  const handleUploadClick = () => {
    navigate('/upload');
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success.main';
      case 'in_progress':
        return 'info.main';
      default:
        return 'text.secondary';
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <Card className="dashboard-card">
            <CardContent>
              <UploadFileIcon fontSize="large" color="primary" />
              <Typography variant="h5" component="div" sx={{ mt: 2 }}>
                Upload New Files
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Upload your Excel file and map it to a template
              </Typography>
            </CardContent>
            <CardActions>
              <Button 
                size="small" 
                variant="contained" 
                onClick={handleUploadClick}
              >
                Start New Upload
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card className="dashboard-card">
            <CardContent>
              <HistoryIcon fontSize="large" color="secondary" />
              <Typography variant="h5" component="div" sx={{ mt: 2 }}>
                Recent Activity
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {uploads.length} uploads in history
              </Typography>
            </CardContent>
            <CardActions>
              <Button size="small" color="secondary">
                View All History
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Recent Uploads
      </Typography>
      <Divider sx={{ mb: 2 }} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <CircularProgress />
        </div>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : uploads.length === 0 ? (
        <Alert severity="info">
          No upload history found. Start by uploading a new file.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Template Name</TableCell>
                <TableCell>Upload Date</TableCell>
                <TableCell>Rows Processed</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {uploads.map((upload) => (
                <TableRow key={upload.session_id || upload.id}>
                  <TableCell>{upload.template_name}</TableCell>
                  <TableCell>{formatDate(upload.upload_date)}</TableCell>
                  <TableCell>{upload.rows_processed}</TableCell>
                  <TableCell>
                    <Typography color={getStatusColor(upload.status)}>
                      {upload.status}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Button 
                      size="small" 
                      variant="outlined"
                      sx={{ mr: 1 }}
                      onClick={() => navigate(`/editor/${upload.session_id}`)}
                    >
                      View Data
                    </Button>
                    <Button 
                      size="small" 
                      color="secondary"
                      onClick={() => api.downloadProcessedFile(upload.session_id)}
                    >
                      Download
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
};

export default Dashboard;