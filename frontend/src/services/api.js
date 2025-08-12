// src/services/api.js - ENHANCED VERSION with Original File Download

import axios from 'axios';

// Use environment variable for API URL, fallback to relative path for production  
const API_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Auto-create demo session when needed
let demoSessionId = null;

const ensureSession = async () => {
  if (demoSessionId) return demoSessionId;
  
  try {
    const response = await axios.post(`${API_URL}/demo-session/`);
    if (response.data.success) {
      demoSessionId = response.data.session_id;
      console.log('🎯 Created demo session:', demoSessionId);
      return demoSessionId;
    }
  } catch (error) {
    console.error('Failed to create demo session:', error);
  }
  return null;
};

const api = {
  // ==========================================
  // 1️⃣ FILE UPLOAD ENDPOINTS
  // ==========================================

  /**
   * Upload files without template with retry logic and validation
   * @param {FormData} formData - File upload data
   */
  uploadFiles: async (formData) => {
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Upload attempt ${attempt}/${maxRetries}`);
        const response = await axios.post(`${API_URL}/upload/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000 // 2 minute timeout
        });
        
        // Validate that upload was successful and has session_id
        if (response.data && response.data.session_id) {
          console.log(`✅ Upload successful on attempt ${attempt}:`, response.data.session_id);
          
          // Wait a moment for file processing, then validate headers
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          try {
            const headersCheck = await api.getHeaders(response.data.session_id);
            const hasHeaders = headersCheck.data.client_headers.length > 0 || headersCheck.data.template_headers.length > 0;
            
            if (hasHeaders) {
              console.log(`✅ Headers validation passed for session ${response.data.session_id}`);
              return response;
            } else {
              console.log(`⚠️ Headers empty for session ${response.data.session_id}, retrying...`);
              if (attempt === maxRetries) {
                throw new Error('Upload completed but file processing failed - headers are empty');
              }
              continue;
            }
          } catch (headerError) {
            console.log(`⚠️ Header validation failed:`, headerError.message);
            if (attempt === maxRetries) {
              // Return the upload response even if header validation fails
              // The session exists, maybe headers will be populated later
              return response;
            }
            continue;
          }
        } else {
          throw new Error('Upload response missing session_id');
        }
        
      } catch (error) {
        console.error(`❌ Upload attempt ${attempt} failed:`, error.message);
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`⏰ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Upload failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
  },

  /**
   * Upload files with optional template application
   * @param {FormData} formData - File upload data
   * @param {number} templateId - Optional template ID to apply immediately
   */
  uploadFilesWithTemplate: (formData, templateId = null) => {
    if (templateId) {
      formData.append('useTemplateId', templateId);
    }
    return axios.post(`${API_URL}/upload/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // ==========================================
  // 2️⃣ HEADER AND MAPPING ENDPOINTS
  // ==========================================

  /**
   * Fetch raw headers for side-by-side display
   * @param {string} sessionId - Session ID
   */
  getHeaders: (sessionId) =>
    axios.get(`${API_URL}/headers/${sessionId}/`),

  /**
   * Get AI suggestions + column lists + specification opportunities
   * @param {string} sessionId - Session ID
   */
  getColumnMappingSuggestions: (sessionId) =>
    axios.post(`${API_URL}/mapping/`, { session_id: sessionId }),

  /**
   * Save the user's final mappings to backend
   * @param {string} sessionId - Session ID
   * @param {Object} mappings - Column mappings object
   */
  saveColumnMappings: (sessionId, mappings) =>
    axios.post(`${API_URL}/mapping/save/`, {
      session_id: sessionId,
      ...mappings
    }),

  /**
   * Get existing mappings for a session
   * @param {string} sessionId - Session ID
   */
  getExistingMappings: (sessionId) =>
    axios.get(`${API_URL}/mapping/existing/${sessionId}/`),

  /**
   * Run BOM parser (legacy endpoint)
   * @param {string} sessionId - Session ID
   */
  runBOMParser: (sessionId) =>
    axios.post(`${API_URL}/map-headers/`, { session_id: sessionId }),

  // ==========================================
  // 3️⃣ DATA MANAGEMENT ENDPOINTS
  // ==========================================

  /**
   * Get data with template headers applied
   * @param {string} sessionId - Session ID
   * @param {number} page - Page number
   * @param {number} pageSize - Page size
   */
  getMappedData: (sessionId, page = 1, pageSize = 10) =>
    axios.get(`${API_URL}/data/`, { 
      params: { 
        session_id: sessionId,
        page,
        page_size: pageSize 
      } 
    }),

  /**
   * Get mapped data with optional specification parsing
   * @param {string} sessionId - Session ID
   * @param {number} page - Page number
   * @param {number} pageSize - Page size
   * @param {boolean} enableSpecParsing - Enable specification parsing
   */
  getMappedDataWithSpecs: (sessionId, page = 1, pageSize = 10, enableSpecParsing = false) =>
    axios.get(`${API_URL}/data/`, { 
      params: { 
        session_id: sessionId,
        page,
        page_size: pageSize,
        enable_spec_parsing: enableSpecParsing
      } 
    }),
    
  /**
   * Save edited data
   * @param {string} sessionId - Session ID
   * @param {Object} data - Data to save
   */
  saveEditedData: (sessionId, data) =>
    axios.post(`${API_URL}/data/save/`, { session_id: sessionId, data }),

  /**
   * Fetch raw, unmapped rows as JSON
   * @param {string} sessionId - Session ID
   */
  getRawData: (sessionId) =>
    axios.get(`${API_URL}/sessions/${sessionId}/raw-data/`),

  // ==========================================
  // 4️⃣ ENHANCED DOWNLOAD ENDPOINTS
  // ==========================================

  /**
   * FIXED: Download processed/converted file with transformed data
   * @param {string} sessionId - Session ID
   * @param {string} format - File format ('excel' or 'csv')
   */
  downloadProcessedFile: (sessionId, format = 'excel') =>
    axios.post(`${API_URL}/download/`, {
      session_id: sessionId, 
      format: format
    }, {
      responseType: 'blob'
    }),

  /**
   * FIXED: Download original uploaded client file
   * @param {string} sessionId - Session ID
   */
  downloadOriginalFile: (sessionId) =>
    axios.get(`${API_URL}/download/original/`, {
      params: { session_id: sessionId },
      responseType: 'blob'
    }),

  /**
   * Download grid data as Excel with custom formatting
   * @param {string} sessionId - Session ID
   * @param {Array} headers - Column headers
   * @param {Array} columnKeys - Column keys
   * @param {Array} rows - Row data
   * @param {string} fileName - Custom file name
   */
  downloadGridExcel: (sessionId, headers, columnKeys, rows, fileName = `export_${sessionId}.xlsx`) =>
    axios.post(`${API_URL}/download/grid-excel/`, {
      session_id: sessionId,
      headers,
      column_keys: columnKeys,
      rows,
      file_name: fileName
    }, {
      responseType: 'blob'
    }),

  // ==========================================
  // 5️⃣ DASHBOARD ENDPOINTS
  // ==========================================

  /**
   * Get enhanced dashboard data with better file names
   */
  getUploadDashboard: () =>
    axios.get(`${API_URL}/dashboard/`),

  // ==========================================
  // 6️⃣ MAPPING TEMPLATE ENDPOINTS
  // ==========================================

  /**
   * Save current session mapping as a reusable template
   * @param {string} sessionId - Current session ID
   * @param {string} templateName - Name for the template
   * @param {string} description - Optional description
   * @param {object} mappings - Optional mappings override
   * @param {array} formulaRules - Optional formula rules
   * @param {array} factwiseRules - Optional factwise ID rules
   */
  saveMappingTemplate: async (sessionId, templateName, description = '', mappings = null, formulaRules = null, factwiseRules = null, defaultValues = null, columnCounts = null) => {
    const effectiveSessionId = sessionId || await ensureSession();
    return axios.post(`${API_URL}/templates/save/`, {
      session_id: effectiveSessionId,
      template_name: templateName,
      description: description,
      ...(mappings !== null && { mappings }),
      ...(formulaRules !== null && { formula_rules: formulaRules }),
      ...(factwiseRules !== null && { factwise_rules: factwiseRules }),
      ...(defaultValues !== null && { default_values: defaultValues }),
      ...(columnCounts !== null && { 
        tags_count: columnCounts.tags_count, 
        spec_pairs_count: columnCounts.spec_pairs_count, 
        customer_id_pairs_count: columnCounts.customer_id_pairs_count 
      })
    });
  },

  /**
   * Get all saved mapping templates
   */
  getMappingTemplates: () =>
    axios.get(`${API_URL}/templates/`),

  /**
   * Apply a saved mapping template to a session
   * @param {string} sessionId - Target session ID
   * @param {number} templateId - Template ID to apply
   */
  applyMappingTemplate: (sessionId, templateId) =>
    axios.post(`${API_URL}/templates/apply/`, {
      session_id: sessionId,
      template_id: templateId
    }),

  /**
   * Delete a mapping template
   * @param {number} templateId - Template ID to delete
   */
  deleteMappingTemplate: (templateId) =>
    axios.delete(`${API_URL}/templates/${templateId}/`),

  /**
   * Update an existing mapping template
   * @param {string} sessionId - Current session ID
   * @param {number} templateId - Template ID to update
   * @param {string} action - "overwrite" or "save_as_new"
   * @param {string} templateName - New template name (required for save_as_new)
   * @param {string} description - Optional description
   */
  updateMappingTemplate: (sessionId, templateId, action, templateName = null, description = '') =>
    axios.post(`${API_URL}/templates/update/`, {
      session_id: sessionId,
      template_id: templateId,
      action: action,
      template_name: templateName,
      description: description
    }),

  /**
   * Mark template as modified
   * @param {string} sessionId - Session ID
   */
  markTemplateModified: (sessionId) =>
    axios.post(`${API_URL}/templates/mark-modified/`, {
      session_id: sessionId
    }),

  /**
   * Update column counts for dynamic template generation
   * @param {string} sessionId - Session ID
   * @param {object} counts - Column counts {tags_count, spec_pairs_count, customer_id_pairs_count}
   */
  updateColumnCounts: (sessionId, counts) =>
    axios.post(`${API_URL}/column-counts/update/`, {
      session_id: sessionId,
      ...counts
    }),

  /**
   * Validate if a template name is available
   * @param {string} templateName - Name to check
   */
  validateTemplateName: async (templateName) => {
    try {
      const response = await api.getMappingTemplates();
      const existingNames = response.data.templates.map(t => t.name.toLowerCase());
      return !existingNames.includes(templateName.toLowerCase());
    } catch (error) {
      console.error('Error validating template name:', error);
      return true; // Assume it's available if we can't check
    }
  },

  // ==========================================
  // 7️⃣ TAG TEMPLATE ENDPOINTS
  // ==========================================

  /**
   * Get all saved tag templates
   */
  getTagTemplates: () =>
    axios.get(`${API_URL}/tag-templates/`),

  /**
   * Save tag template from formula rules
   * @param {string} templateName - Name for the template
   * @param {string} description - Optional description
   * @param {array} formulaRules - Formula rules to save
   */
  saveTagTemplate: (templateName, description = '', formulaRules = []) =>
    axios.post(`${API_URL}/tag-templates/save/`, {
      template_name: templateName,
      description: description,
      formula_rules: formulaRules
    }),

  /**
   * Delete a tag template
   * @param {number} templateId - Template ID to delete
   */
  deleteTagTemplate: (templateId) =>
    axios.delete(`${API_URL}/tag-templates/${templateId}/`),

  /**
   * Apply a saved tag template (returns formula rules)
   * @param {number} templateId - Template ID to apply
   */
  applyTagTemplate: (templateId) =>
    axios.get(`${API_URL}/tag-templates/${templateId}/apply/`),

  // ==========================================
  // 8️⃣ SPECIFICATION PARSING ENDPOINTS
  // ==========================================

  /**
   * Detect specification parsing opportunities in current session
   * @param {string} sessionId - Session ID
   */
  detectSpecificationOpportunity: (sessionId) =>
    axios.post(`${API_URL}/specifications/detect/`, {
      session_id: sessionId
    }),

  /**
   * Get specification parsing preview for sample descriptions
   * @param {string} sessionId - Session ID
   * @param {Array} sampleDescriptions - Array of sample description strings
   */
  getSpecificationPreview: (sessionId, sampleDescriptions) =>
    axios.post(`${API_URL}/specifications/preview/`, {
      session_id: sessionId,
      sample_descriptions: sampleDescriptions
    }),

  /**
   * Apply specification parsing to current session
   * @param {string} sessionId - Session ID
   * @param {boolean} enableParsing - Whether to enable specification parsing
   */
  applySpecificationParsing: (sessionId, enableParsing) =>
    axios.post(`${API_URL}/specifications/apply/`, {
      session_id: sessionId,
      enable_parsing: enableParsing
    }),

  /**
   * Analyze specification parsing potential for a session
   * @param {string} sessionId - Session ID
   * @param {Array} descriptionColumns - Description column names to analyze
   */
  analyzeSpecificationPotential: (sessionId, descriptionColumns = []) =>
    axios.post(`${API_URL}/specifications/analyze/`, {
      session_id: sessionId,
      description_columns: descriptionColumns
    }),

  /**
   * Get detailed specification breakdown for overflow scenarios
   * @param {string} sessionId - Session ID
   * @param {number} maxPairs - Maximum specification pairs available in template
   */
  getSpecificationBreakdown: (sessionId, maxPairs) =>
    axios.post(`${API_URL}/specifications/breakdown/`, {
      session_id: sessionId,
      max_pairs: maxPairs
    }),

  /**
   * Generate specification mapping recommendations
   * @param {string} sessionId - Session ID
   * @param {Object} mappings - Current column mappings
   */
  getSpecificationRecommendations: (sessionId, mappings) =>
    axios.post(`${API_URL}/specifications/recommend/`, {
      session_id: sessionId,
      mappings: mappings
    }),

  // ==========================================
  // 8️⃣ SESSION MANAGEMENT ENDPOINTS
  // ==========================================


  // ==========================================
  // 9️⃣ UTILITY ENDPOINTS
  // ==========================================

  /**
   * Health check endpoint
   */
  healthCheck: () =>
    axios.get(`${API_URL}/health/`),

  // ==========================================
  // 🔟 ENHANCED FILE OPERATIONS
  // ==========================================

  /**
   * FIXED: Download file with automatic blob handling and filename extraction
   * @param {string} sessionId - Session ID
   * @param {string} fileType - 'original' or 'converted'
   * @param {string} customFilename - Optional custom filename
   */
  downloadFileEnhanced: async (sessionId, fileType = 'converted', customFilename = null) => {
    try {
      let response;
      let defaultFilename;
      
      if (fileType === 'original') {
        response = await api.downloadOriginalFile(sessionId);
        defaultFilename = `original_file_${sessionId}.xlsx`;
      } else {
        response = await api.downloadProcessedFile(sessionId);
        defaultFilename = `converted_file_${sessionId}.xlsx`;
      }
      
      // Extract filename from Content-Disposition header if available
      const contentDisposition = response.headers['content-disposition'];
      let filename = customFilename || defaultFilename;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      
      // Create blob and download
      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log(`Successfully downloaded ${fileType} file: ${filename}`);
      return { success: true, filename };
      
    } catch (error) {
      console.error(`Error downloading ${fileType} file:`, error);
      
      // Enhanced error handling for different scenarios
      if (error.response?.status === 404) {
        throw new Error(`${fileType === 'original' ? 'Original' : 'Converted'} file not found. The file may have been cleaned up from the server.`);
      } else if (error.response?.status === 400) {
        throw new Error(`Invalid session or missing mappings. Please check your session and try again.`);
      } else {
        throw new Error(`Failed to download ${fileType} file: ${error.response?.data?.error || error.message}`);
      }
    }
  },

  /**
   * FIXED: Get file metadata for a session and check download availability
   * @param {string} sessionId - Session ID
   */
  getFileMetadata: async (sessionId) => {
    try {
      const response = await api.getHeaders(sessionId);
      
      // Check if files are available for download
      let originalAvailable = false;
      let convertedAvailable = false;
      
      try {
        // Quick check if original file exists by making a HEAD request equivalent
        await api.downloadOriginalFile(sessionId);
        originalAvailable = true;
      } catch (e) {
        console.log('Original file not available:', e.message);
      }
      
      try {
        // Check if converted file can be generated (has mappings)
        const mappingResponse = await api.getExistingMappings(sessionId);
        convertedAvailable = mappingResponse.data.mappings && Object.keys(mappingResponse.data.mappings).length > 0;
      } catch (e) {
        console.log('Converted file not available:', e.message);
      }
      
      return {
        success: true,
        clientHeaders: response.data.client_headers,
        templateHeaders: response.data.template_headers,
        sessionId: sessionId,
        downloads: {
          originalAvailable,
          convertedAvailable
        }
      };
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || error.message,
        downloads: {
          originalAvailable: false,
          convertedAvailable: false
        }
      };
    }
  },

  // ==========================================
  // 1️⃣1️⃣ ERROR HANDLING UTILITIES
  // ==========================================

  /**
   * Handle API errors consistently
   * @param {Error} error - Axios error object
   * @returns {Object} Formatted error response
   */
  handleError: (error) => {
    if (error.response) {
      // Server responded with error status
      return {
        status: error.response.status,
        message: error.response.data?.error || error.response.data?.message || 'Server error occurred',
        data: error.response.data
      };
    } else if (error.request) {
      // Request was made but no response received
      return {
        status: 0,
        message: 'No response from server. Please check your connection.',
        data: null
      };
    } else {
      // Something else happened
      return {
        status: 0,
        message: error.message || 'An unexpected error occurred',
        data: null
      };
    }
  },

  /**
   * Check if session is valid
   * @param {string} sessionId - Session ID to validate
   */
  validateSession: async (sessionId) => {
    try {
      await api.getHeaders(sessionId);
      return true;
    } catch (error) {
      return false;
    }
  },

  // ==========================================
  // 1️⃣2️⃣ BATCH OPERATIONS
  // ==========================================

  /**
   * Batch upload multiple files
   * @param {Array} fileDataArray - Array of FormData objects
   */
  batchUploadFiles: async (fileDataArray) => {
    const uploadPromises = fileDataArray.map(formData => api.uploadFiles(formData));
    try {
      const results = await Promise.allSettled(uploadPromises);
      return results.map((result, index) => ({
        index,
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value.data : null,
        error: result.status === 'rejected' ? result.reason : null
      }));
    } catch (error) {
      console.error('Batch upload failed:', error);
      throw error;
    }
  },

  /**
   * Batch delete templates
   * @param {Array} templateIds - Array of template IDs to delete
   */
  batchDeleteTemplates: async (templateIds) => {
    const deletePromises = templateIds.map(id => api.deleteMappingTemplate(id));
    try {
      const results = await Promise.allSettled(deletePromises);
      return results.map((result, index) => ({
        templateId: templateIds[index],
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value.data : null,
        error: result.status === 'rejected' ? result.reason : null
      }));
    } catch (error) {
      console.error('Batch delete failed:', error);
      throw error;
    }
  },

  /**
   * FIXED: Batch download multiple files with improved error handling
   * @param {Array} sessionIds - Array of session IDs
   * @param {string} fileType - 'original' or 'converted'
   */
  batchDownloadFiles: async (sessionIds, fileType = 'converted') => {
    const downloadPromises = sessionIds.map(async (sessionId) => {
      try {
        const result = await api.downloadFileEnhanced(sessionId, fileType);
        return {
          sessionId,
          success: true,
          filename: result.filename,
          error: null
        };
      } catch (error) {
        return {
          sessionId,
          success: false,
          filename: null,
          error: error.message
        };
      }
    });
    
    try {
      const results = await Promise.allSettled(downloadPromises);
      return results.map((result) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            sessionId: 'unknown',
            success: false,
            filename: null,
            error: result.reason?.message || 'Unknown error'
          };
        }
      });
    } catch (error) {
      console.error('Batch download failed:', error);
      throw error;
    }
  },

  // ==========================================
  // 1️⃣3️⃣ TEMPLATE OPERATIONS
  // ==========================================

  /**
   * Search templates by name or description
   * @param {string} searchTerm - Search term
   * @param {Object} filters - Additional filters
   */
  searchTemplates: async (searchTerm = '', filters = {}) => {
    try {
      const response = await api.getMappingTemplates();
      let templates = response.data.templates || [];
      
      // Apply search filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        templates = templates.filter(template =>
          template.name.toLowerCase().includes(term) ||
          (template.description && template.description.toLowerCase().includes(term))
        );
      }
      
      // Apply additional filters
      if (filters.minUsage !== undefined) {
        templates = templates.filter(t => (t.usage_count || 0) >= filters.minUsage);
      }
      
      if (filters.maxUsage !== undefined) {
        templates = templates.filter(t => (t.usage_count || 0) <= filters.maxUsage);
      }
      
      if (filters.dateRange) {
        const { start, end } = filters.dateRange;
        templates = templates.filter(t => {
          const createdDate = new Date(t.created_at);
          return createdDate >= start && createdDate <= end;
        });
      }
      
      return { success: true, templates, total: templates.length };
      
    } catch (error) {
      console.error('Error searching templates:', error);
      return { success: false, error: error.message, templates: [], total: 0 };
    }
  },

  /**
   * Get template usage statistics
   */
  getTemplateStats: async () => {
    try {
      const response = await api.getMappingTemplates();
      const templates = response.data.templates || [];
      
      const stats = {
        totalTemplates: templates.length,
        totalUsage: templates.reduce((sum, t) => sum + (t.usage_count || 0), 0),
        averageUsage: templates.length > 0 ? 
          templates.reduce((sum, t) => sum + (t.usage_count || 0), 0) / templates.length : 0,
        mostUsed: templates.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))[0],
        leastUsed: templates.sort((a, b) => (a.usage_count || 0) - (b.usage_count || 0))[0],
        recentTemplates: templates
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 5),
        usageDistribution: {
          unused: templates.filter(t => (t.usage_count || 0) === 0).length,
          lowUsage: templates.filter(t => (t.usage_count || 0) >= 1 && (t.usage_count || 0) < 5).length,
          mediumUsage: templates.filter(t => (t.usage_count || 0) >= 5 && (t.usage_count || 0) < 10).length,
          highUsage: templates.filter(t => (t.usage_count || 0) >= 10).length
        }
      };
      
      return { success: true, stats };
      
    } catch (error) {
      console.error('Error getting template stats:', error);
      return { success: false, error: error.message };
    }
  },

  // ==========================================
  // 1️⃣4️⃣ FACTWISE ID CREATION ENDPOINT
  // ==========================================

  /**
   * Create Factwise ID column by combining two existing columns
   * @param {string} sessionId - Session ID
   * @param {string} firstColumn - First column name
   * @param {string} secondColumn - Second column name
   * @param {string} operator - Operator to combine columns
   */
  createFactwiseId: async (sessionId, firstColumn, secondColumn, operator = '_') => {
    const effectiveSessionId = sessionId || await ensureSession();
    return axios.post(`${API_URL}/create-factwise-id/`, {
      session_id: effectiveSessionId,
      first_column: firstColumn,
      second_column: secondColumn,
      operator: operator
    });
  },

  // ==========================================
  // 1️⃣5️⃣ FORMULA MANAGEMENT ENDPOINTS
  // ==========================================

  /**
   * Get mapping templates that include formula rules (unified system)
   * This replaces the separate formula templates system
   */
  getFormulaTemplates: () =>
    api.getMappingTemplates(), // Use unified template system

  /**
   * Preview formula results without applying them permanently
   * @param {string} sessionId - Session ID
   * @param {Array} formulaRules - Array of formula rule objects
   * @param {number} sampleSize - Number of sample rows to return (default: 5)
   */
  previewFormulas: (sessionId, formulaRules, sampleSize = 5) =>
    axios.post(`${API_URL}/formulas/preview/`, {
      session_id: sessionId,
      formula_rules: formulaRules,
      sample_size: sampleSize
    }),

  /**
   * Apply formula rules to session data and create new tag columns
   * @param {string} sessionId - Session ID
   * @param {Array} formulaRules - Array of formula rule objects
   */
  applyFormulas: async (sessionId, formulaRules) => {
    const effectiveSessionId = sessionId || await ensureSession();
    return axios.post(`${API_URL}/formulas/apply/`, {
      session_id: effectiveSessionId,
      formula_rules: formulaRules
    });
  },

  /**
   * Save custom formulas as part of mapping template (unified system)
   * This replaces the separate formula save system
   * @param {string} sessionId - Session ID
   * @param {Array} formulaRules - Array of formula rule objects
   * @param {string} templateName - Name for the template
   * @param {string} description - Template description
   */
  saveCustomFormulas: (sessionId, formulaRules, templateName, description = '') =>
    api.saveMappingTemplate(sessionId, templateName, description),

  /**
   * Get data enhanced with formula-generated columns
   * This now uses the regular data endpoint which includes formula results
   * @param {string} sessionId - Session ID
   * @param {number} page - Page number
   * @param {number} pageSize - Page size
   */
  getEnhancedData: (sessionId, page = 1, pageSize = 20) =>
    api.getMappedData(sessionId, page, pageSize), // Use unified data endpoint

  /**
   * Helper function to create a formula rule object
   * @param {string} sourceColumn - Column to search in
   * @param {string} searchText - Text to search for
   * @param {string} tagValue - Value to add when text is found
   * @param {string} targetColumn - Column to add the tag to (optional)
   * @param {boolean} caseSensitive - Whether search is case sensitive
   */
  createFormulaRule: (sourceColumn, searchText, tagValue, targetColumn = null, caseSensitive = false) => ({
    source_column: sourceColumn,
    search_text: searchText,
    tag_value: tagValue,
    target_column: targetColumn,
    case_sensitive: caseSensitive
  }),

  /**
   * Check for column name conflicts before applying formulas
   * @param {string} sessionId - Session ID
   * @param {Array} formulaRules - Array of formula rule objects
   */
  checkColumnConflicts: async (sessionId, formulaRules) => {
    const effectiveSessionId = sessionId || await ensureSession();
    return axios.post(`${API_URL}/formulas/conflicts/`, {
      session_id: effectiveSessionId,
      formula_rules: formulaRules
    });
  },

  /**
   * Clear all formulas and remove generated columns from session
   * @param {string} sessionId - Session ID
   */
  clearFormulas: (sessionId) =>
    axios.post(`${API_URL}/formulas/clear/`, {
      session_id: sessionId
    }),

  /**
   * Validate formula rules before applying
   * @param {Array} formulaRules - Array of formula rule objects
   * @param {Array} availableColumns - Available column names
   */
  validateFormulaRules: (formulaRules, availableColumns) => {
    const errors = [];
    const warnings = [];
    const safeRules = Array.isArray(formulaRules) ? formulaRules : [];

    safeRules.forEach((rule, index) => {
      if (!rule || typeof rule !== 'object') {
        errors.push(`Rule ${index + 1}: Invalid rule shape`);
        return;
      }

      // Check required fields
      if (!rule.source_column) {
        errors.push(`Rule ${index + 1}: Source column is required`);
      }

      // Check if column type is valid
      if (!rule.column_type || !['Tag', 'Specification Value'].includes(rule.column_type)) {
        errors.push(`Rule ${index + 1}: Column type must be either 'Tag' or 'Specification Value'`);
      }

      // Check if specification name is provided when column type is 'Specification Value'
      if (rule.column_type === 'Specification Value' && (!rule.specification_name || rule.specification_name.trim() === '')) {
        errors.push(`Rule ${index + 1}: Specification name is required when column type is 'Specification Value'`);
      }

      // Check if source column exists
      if (rule.source_column && !availableColumns.includes(rule.source_column)) {
        errors.push(`Rule ${index + 1}: Source column "${rule.source_column}" does not exist`);
      }

      // Validate sub-rules
      if (!Array.isArray(rule.sub_rules) || rule.sub_rules.length === 0) {
        errors.push(`Rule ${index + 1}: At least one condition (sub-rule) is required`);
      } else {
        rule.sub_rules.forEach((subRule, subIndex) => {
          if (!subRule || typeof subRule !== 'object') {
            errors.push(`Rule ${index + 1}, Condition ${subIndex + 1}: Invalid sub-rule shape`);
            return;
          }
          if (!subRule.search_text || subRule.search_text.trim() === '') {
            errors.push(`Rule ${index + 1}, Condition ${subIndex + 1}: Search text cannot be empty`);
          }
          if (!subRule.output_value || subRule.output_value.trim() === '') {
            errors.push(`Rule ${index + 1}, Condition ${subIndex + 1}: Output value cannot be empty`);
          }
          // Warning for very short search text
          if (subRule.search_text && subRule.search_text.trim().length < 2) {
            warnings.push(`Rule ${index + 1}, Condition ${subIndex + 1}: Very short search text "${subRule.search_text}" may match too many rows`);
          }
        });
      }

      // Info about multiple rules targeting same column type
      const sameColumnTypeRules = safeRules.filter((r, i) => i !== index && r && r.column_type === rule.column_type);
      if (sameColumnTypeRules.length > 0 && rule.column_type === 'Tag') {
        warnings.push(`Rule ${index + 1}: Multiple Tag rules detected - each will create separate columns if different source columns are used`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      ruleCount: safeRules.length
    };
  }
};

// ==========================================
// AXIOS INTERCEPTORS FOR GLOBAL ERROR HANDLING
// ==========================================

// Request interceptor
axios.interceptors.request.use(
  (config) => {
    // Add timestamp to prevent caching issues
    if (config.method === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now()
      };
    }
    
    // Add common headers
    config.headers = {
      ...config.headers,
      'X-Requested-With': 'XMLHttpRequest'
    };
    
    return config;
  },
  (error) => {
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor
axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Log all API errors
    console.error('API Error:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      message: error.response?.data?.error || error.message
    });
    
    // Handle specific error codes
    if (error.response?.status === 401) {
      // Handle unauthorized access
      console.warn('Unauthorized access detected');
    } else if (error.response?.status === 403) {
      // Handle forbidden access
      console.warn('Forbidden access detected');
    } else if (error.response?.status >= 500) {
      // Handle server errors
      console.error('Server error detected:', error.response?.data);
    }
    
    return Promise.reject(error);
  }
);

export default api;