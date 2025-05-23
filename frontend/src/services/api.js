import axios from 'axios';

const API_URL = '/api';

const api = {
  // File upload endpoints
  uploadFiles: (formData) => {
    return axios.post(`${API_URL}/upload/`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  },
  
  // Column mapping endpoints
  getColumnMapping: (sessionId) => {
    return axios.post(`${API_URL}/mapping/`, { session_id: sessionId });
  },
  
  saveColumnMapping: (sessionId, mappings) => {
    return axios.post(`${API_URL}/mapping/save/`, {
      session_id: sessionId,
      mappings: mappings
    });
  },
  
  // Data processing endpoints
  getMappedData: (sessionId) => {
    return axios.get(`${API_URL}/data/`, { params: { session_id: sessionId } });
  },
  
  saveEditedData: (sessionId, data) => {
    return axios.post(`${API_URL}/data/save/`, {
      session_id: sessionId,
      data: data
    });
  },
  
  // Dashboard endpoints
  getUploadDashboard: () => {
    return axios.get(`${API_URL}/dashboard/`);
  },
  
  downloadProcessedFile: (sessionId) => {
    return axios.get(`${API_URL}/download/`, { 
      params: { session_id: sessionId },
      responseType: 'blob'
    });
  },
  
  // Health check
  healthCheck: () => {
    return axios.get(`${API_URL}/health/`);
  }
};

export default api;