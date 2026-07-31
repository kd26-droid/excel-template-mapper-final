// src/services/api.js - ENHANCED VERSION with Original File Download

import axios from 'axios';

// Use environment variable for API URL, fallback to relative path for production  
const API_URL = process.env.REACT_APP_API_BASE_URL || '/api';

// Auto-create demo session when needed
let demoSessionId = null;

// Global loader state management
let globalLoaderCallback = null;

export const showGlobalLoader = (show) => {
  if (globalLoaderCallback) {
    globalLoaderCallback(show);
  }
};

export const setGlobalLoaderCallback = (callback) => {
  globalLoaderCallback = callback;
};

// Generic GET method for specific use cases
const get = async (url, config = {}) => {
  try {
    const response = await axios.get(`${API_URL}${url}`, config);
    return response;
  } catch (error) {
    console.error(`Failed to GET ${url}:`, error);
    throw error;
  }
};

const ensureSession = async () => {
  if (demoSessionId) return demoSessionId;
  
  try {
    const response = await axios.post(`${API_URL}/demo-session/`);
    if (response.data.success) {
      demoSessionId = response.data.session_id;
      return demoSessionId;
    }
  } catch (error) {
    console.error('Failed to create demo session:', error);
  }
  return null;
};

const api = {
  // ==========================================
  // GENERIC HTTP METHODS
  // ==========================================

  get,

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
        const response = await axios.post(`${API_URL}/upload/`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000 // 2 minute timeout
        });
        
        // Validate that upload was successful and has session_id
        if (response.data && response.data.session_id) {
          
          // Upload succeeded and the session exists. Do not re-upload the same
          // files if a follow-up header check is delayed or blocked by CORS.
          // The mapping page/cleanup dialog will fetch headers from this session.
          return response;
        } else {
          throw new Error('Upload response missing session_id');
        }
        
      } catch (error) {
        console.error(`❌ Upload attempt ${attempt} failed:`, error.message);
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Upload failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
  },

  /**
   * Clean up rows where the primary column is empty
   */
  cleanupRows: (sessionId, primaryColumn) => {
    return axios.post(`${API_URL}/cleanup-rows/`, {
      session_id: sessionId,
      primary_column: primaryColumn
    }, { timeout: 60000 });
  },

  applySheetJoin: (payload) => {
    return axios.post(`${API_URL}/sheet-join/apply/`, payload, { timeout: 120000 });
  },

  getManufacturerDirectory: () => {
    return axios.get(`${API_URL}/manufacturers/`, { timeout: 120000 });
  },

  searchManufacturers: (query, limit = 25) => {
    return axios.get(`${API_URL}/manufacturers/search/`, {
      params: { q: query, limit },
      timeout: 60000
    });
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
  // 📄 PDF UPLOAD AND OCR ENDPOINTS
  // ==========================================

  /**
   * Upload PDF file for OCR processing
   * @param {FormData} formData - PDF file data
   */
  uploadPDF: async (formData) => {
    try {
      showGlobalLoader(true);
      const response = await axios.post(`${API_URL}/pdf/upload/`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000 // 5 min — multi-page PDFs render page images server-side; don't abort early
      });
      return response;
    } catch (error) {
      console.error('PDF upload failed:', error);
      throw error;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Process uploaded PDF with Azure OCR
   * @param {Object} data - Request data containing session_id
   */
  processPDFOCR: async (data) => {
    try {
      showGlobalLoader(true);
      const response = await axios.post(`${API_URL}/pdf/process/`, data, {
        timeout: 120000 // 2 minute timeout for OCR processing
      });
      return response;
    } catch (error) {
      console.error('PDF OCR processing failed:', error);
      throw error;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Process uploaded PDF with native extraction + Azure OCR, then choose the better result
   * @param {Object} data - Request data containing session_id
   */
  processPDFCompare: async (data) => {
    try {
      showGlobalLoader(true);
      const response = await axios.post(`${API_URL}/pdf/process-compare/`, data, {
        timeout: 300000 // Compare mode can run both native parsing and Azure OCR
      });
      return response;
    } catch (error) {
      console.error('PDF compare processing failed:', error);
      throw error;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Get PDF session status
   * @param {string} sessionId - PDF session ID
   */
  getPDFSessionStatus: async (sessionId) => {
    try {
      const response = await axios.get(`${API_URL}/pdf/status/${sessionId}/`);
      return response;
    } catch (error) {
      console.error('Failed to get PDF session status:', error);
      throw error;
    }
  },

  /**
   * Clean up PDF session files
   * @param {Object} data - Request data containing session_id
   */
  cleanupPDFSession: async (data) => {
    try {
      const response = await axios.post(`${API_URL}/pdf/cleanup/`, data);
      return response;
    } catch (error) {
      console.error('PDF cleanup failed:', error);
      throw error;
    }
  },

  /**
   * Get PDF page image
   * @param {string} sessionId - PDF session ID
   * @param {number} pageNumber - Page number
   */
  getPDFPageImage: async (sessionId, pageNumber) => {
    try {
      const response = await axios.get(`${API_URL}/pdf/page/${sessionId}/${pageNumber}/`, {
        responseType: 'blob'
      });
      return response;
    } catch (error) {
      console.error('Failed to get PDF page image:', error);
      throw error;
    }
  },

  // ==========================================
  // 📋 PDF ZONE MANAGEMENT ENDPOINTS
  // ==========================================

  /**
   * Get zones for a PDF session
   * @param {string} sessionId - PDF session ID
   */
  getPDFZones: async (sessionId) => {
    try {
      const response = await axios.get(`${API_URL}/pdf/zones/${sessionId}/`);
      return response;
    } catch (error) {
      console.error('Failed to get PDF zones:', error);
      throw error;
    }
  },

  /**
   * Create or update zones for a PDF session
   * @param {string} sessionId - PDF session ID
   * @param {Array} zones - Array of zone objects
   */
  createOrUpdatePDFZones: async (sessionId, zones) => {
    try {
      const response = await axios.post(`${API_URL}/pdf/zones/${sessionId}/`, {
        zones: zones
      });
      return response;
    } catch (error) {
      console.error('Failed to create/update PDF zones:', error);
      throw error;
    }
  },

  /**
   * Process PDF zones with enhancement and OCR
   * @param {string} sessionId - PDF session ID
   * @param {Array} zoneIds - Array of zone IDs to process
   * @param {string} enhancePreset - Enhancement preset to use
   */
  processPDFZones: async (sessionId, zoneIds, enhancePreset = 'adaptive') => {
    try {
      showGlobalLoader(true);
      const response = await axios.post(`${API_URL}/pdf/zones/${sessionId}/process/`, {
        zone_ids: zoneIds
        // enhance_preset intentionally omitted; backend picks best automatically
      }, {
        timeout: 120000 // 2 minutes for processing
      });
      return response;
    } catch (error) {
      console.error('❌ PDF zones processing failed:', error?.response?.data || error?.message || error);
      throw error;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Extract a table by treating the drawn zones as COLUMNS, using word
   * coordinates (blanks preserved, rows aligned, header/footer excluded).
   */
  processPDFColumnZones: async (sessionId, { mergeWrapped = false, columnLabels = [], skipTopRows = 0 } = {}) => {
    try {
      showGlobalLoader(true);
      const response = await axios.post(`${API_URL}/pdf/zones/${sessionId}/process-columns/`, {
        merge_wrapped: mergeWrapped,
        column_labels: columnLabels,
        skip_top_rows: skipTopRows
      }, {
        timeout: 120000
      });
      return response;
    } catch (error) {
      console.error('❌ PDF column-zone extraction failed:', error?.response?.data || error?.message || error);
      throw error;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Get processing status for PDF zones
   * @param {string} sessionId - PDF session ID
   */
  getPDFZoneStatus: async (sessionId) => {
    try {
      const response = await axios.get(`${API_URL}/pdf/zones/${sessionId}/status/`);
      return response;
    } catch (error) {
      console.error('Failed to get PDF zone status:', error);
      throw error;
    }
  },

  /**
   * Link zones as continuation chain
   * @param {string} sessionId - PDF session ID
   * @param {Array} zoneIds - Array of zone IDs to link
   */
  linkPDFZones: async (sessionId, zoneIds) => {
    try {
      const response = await axios.post(`${API_URL}/pdf/continuations/${sessionId}/link/`, {
        action: 'link',
        zone_chain: zoneIds
      });
      return response;
    } catch (error) {
      console.error('Failed to link PDF zones:', error);
      throw error;
    }
  },

  /**
   * Unlink zones continuation chain
   * @param {string} sessionId - PDF session ID
   * @param {Array} zoneIds - Array of zone IDs to unlink
   */
  unlinkPDFZones: async (sessionId, zoneIds) => {
    try {
      const response = await axios.post(`${API_URL}/pdf/continuations/${sessionId}/link/`, {
        action: 'unlink',
        zone_chain: zoneIds
      });
      return response;
    } catch (error) {
      console.error('Failed to unlink PDF zones:', error);
      throw error;
    }
  },

  /**
   * Get PDF session details
   * @param {string} sessionId - PDF session ID
   */
  getPDFSession: async (sessionId) => {
    try {
      const response = await axios.get(`${API_URL}/pdf/sessions/${sessionId}/`);
      return response;
    } catch (error) {
      console.error('Failed to get PDF session:', error);
      throw error;
    }
  },

  // ==========================================
  // 2️⃣ HEADER AND MAPPING ENDPOINTS
  // ==========================================

  /**
   * Fetch raw headers for side-by-side display
   * @param {string} sessionId - Session ID
   */
  getHeaders: (sessionId) => {
    const _ts = Date.now();
    const _rand = Math.random().toString(36).substr(2, 9);
    const _mpn = 'mpn_validation_' + _ts;
    return axios.get(`${API_URL}/headers/${sessionId}/`, {
      params: { _ts, _rand, _mpn, force_fresh: true, _bust: _ts }
    });
  },

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
  saveColumnMappings: (sessionId, mappingData) =>
    axios.post(`${API_URL}/mapping/save/`, {
      session_id: sessionId,
      mappings: mappingData.mappings,
      default_values: mappingData.default_values || {},
      formula_rules: mappingData.formula_rules || null,
      factwise_rules: mappingData.factwise_rules || null,
      force_persist: mappingData.force_persist === true,
    }),

  /**
   * Get existing mappings for a session
   * @param {string} sessionId - Session ID
   */
  getExistingMappings: (sessionId) => {
    const _ts = Date.now();
    return axios.get(`${API_URL}/mapping/existing/${sessionId}/`, {
      params: { _ts }
    });
  },

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
  getMappedData: (sessionId, page = 1, pageSize = 10) => {
    const _ts = Date.now();
    return axios.get(`${API_URL}/data/`, { 
      params: { 
        session_id: sessionId,
        page,
        page_size: pageSize,
        _ts
      }
    });
  },

  /**
   * Get mapped data with optional specification parsing
   * @param {string} sessionId - Session ID
   * @param {number} page - Page number
   * @param {number} pageSize - Page size
   * @param {boolean} enableSpecParsing - Enable specification parsing
   */
  getMappedDataWithSpecs: (sessionId, page = 1, pageSize = 10, enableSpecParsing = false, options = {}) => {
    const _ts = options._ts || Date.now();
    const _rand = Math.random().toString(36).substr(2, 9);
    const _mpn = 'mpn_data_' + _ts;
    const params = {
      session_id: sessionId,
      page,
      page_size: pageSize,
      enable_spec_parsing: enableSpecParsing,
      stable: options.stable !== undefined ? options.stable : true,
      _ts,
      _rand,
      _mpn,
      _bust: _ts,
    };
    if (options.force_fresh) params.force_fresh = 'true';
    if (options._fresh) params._fresh = options._fresh;
    return axios.get(`${API_URL}/data/`, {
      params,
      signal: options.signal,
      timeout: (options.timeoutMs != null)
        ? options.timeoutMs
        : (pageSize > 2000 ? 120000 : (pageSize > 1000 ? 60000 : (pageSize > 500 ? 30000 : 15000)))
    });
  },
    
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
  downloadProcessedFile: (sessionId, format = 'excel', columnOrder = null) =>
    axios.post(`${API_URL}/download/`, {
      session_id: sessionId,
      format: format,
      column_order: columnOrder
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
   * Download original uploaded template file
   * @param {string} sessionId - Session ID
   */
  downloadTemplateFile: (sessionId) =>
    axios.get(`${API_URL}/download/${sessionId}/template/`, {
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

  /**
   * Hard-delete one upload/session (removes the session file, memory, cache and
   * any PDF records — not a soft delete).
   */
  deleteUpload: (sessionId) =>
    axios.delete(`${API_URL}/dashboard/uploads/${sessionId}/`),

  /**
   * Hard-delete every upload/session (bulk clear).
   */
  deleteAllUploads: () =>
    axios.delete(`${API_URL}/dashboard/uploads/`),

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
  saveMappingTemplate: async (sessionId, templateName, description = '', mappings = null, formulaRules = null, factwiseRules = null, defaultValues = null, columnCounts = null, mpnValidationMetadata = null) => {
    const effectiveSessionId = sessionId || await ensureSession();
    const payload = {
      session_id: effectiveSessionId,
      template_name: templateName,
      description,
      ...(mappings !== null ? { mappings } : {}),
      ...(formulaRules !== null ? { formula_rules: formulaRules } : {}),
      ...(factwiseRules !== null ? { factwise_rules: factwiseRules } : {}),
      ...(defaultValues !== null ? { default_values: defaultValues } : {}),
      ...(columnCounts !== null ? {
        tags_count: columnCounts.tags_count,
        spec_pairs_count: columnCounts.spec_pairs_count,
        customer_id_pairs_count: columnCounts.customer_id_pairs_count,
      } : {}),
      ...(mpnValidationMetadata !== null ? { mpn_validation_metadata: mpnValidationMetadata } : {}),
    };
    return axios.post(`${API_URL}/templates/save/`, payload);
  },

  /**
   * Get all saved mapping templates
   */
  getMappingTemplates: () => {
    const _ts = Date.now();
    return axios.get(`${API_URL}/templates/`, {
      params: { _ts }
    });
  },

  /**
   * Apply a saved mapping template to a session
   * @param {string} sessionId - Target session ID
   * @param {number} templateId - Template ID to apply
   */
  applyMappingTemplate: async (sessionId, templateId) => {
    showGlobalLoader(true);
    try {
      const resp = await axios.post(`${API_URL}/templates/apply/`, {
        session_id: sessionId,
        template_id: templateId
      });
      
      return resp;
    } finally {
      showGlobalLoader(false);
    }
  },

  /**
   * Delete a mapping template
   * @param {number} templateId - Template ID to delete
   */
  deleteMappingTemplate: (templateId) =>
    axios.delete(`${API_URL}/templates/${templateId}/`),

  /**
   * Download a saved mapping template as a portable .fwtemplate.json file,
   * so it can be moved to another environment and imported there.
   */
  exportMappingTemplate: async (templateId, templateName = 'template') => {
    const resp = await axios.get(`${API_URL}/templates/${templateId}/export/`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/json' }));
    const safe = String(templateName).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.fwtemplate.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return true;
  },

  /**
   * Import a mapping template from a .fwtemplate.json File object.
   * Creates a new template (name made unique) — never overwrites.
   */
  importMappingTemplate: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API_URL}/templates/import/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

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
   * Update column counts for dynamic template generation (fast, no sync wait)
   * @param {string} sessionId - Session ID
   * @param {object} counts - Column counts {tags_count, spec_pairs_count, customer_id_pairs_count}
   */
  updateColumnCounts: async (sessionId, counts) => {
    showGlobalLoader(true);
    try {
      const response = await axios.post(`${API_URL}/column-counts/update/`, {
        session_id: sessionId,
        tags_count: counts.tags_count,
        spec_pairs_count: counts.spec_pairs_count,
        customer_id_pairs_count: counts.customer_id_pairs_count,
      });
      
      // Return immediately - no sync waiting
      return response;
    } finally {
      showGlobalLoader(false);
    }
  },

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

  /**
   * Get canonical session snapshot
   * @param {string} sessionId - Session ID
   */
  getSessionSnapshot: (sessionId) => {
    const _ts = Date.now();
    return axios.get(`${API_URL}/session/${sessionId}/snapshot/`, {
      params: { _ts }
    });
  },

  /**
   * Get session status including template version for change tracking
   * @param {string} sessionId - Session ID
   * @param {Object} options - Additional options like timestamp
   */
  getSessionStatus: (sessionId, options = {}) => {
    const _ts = options._ts || Date.now();
    return axios.get(`${API_URL}/session/${sessionId}/status/`, {
      params: { _ts }
    });
  },

  /**
   * Rebuild template and update column counts
   * @param {string} sessionId - Session ID
   */
  rebuildTemplate: (sessionId) =>
    axios.post(`${API_URL}/rebuild-template/`, {
      session_id: sessionId
    }),

  /**
   * Wait until session template version advances (for synchronization)
   * @param {string} sessionId - Session ID
   * @param {number} currentVersion - Current template version
   * @param {number} timeout - Timeout in milliseconds (default: 15000)
   */
  waitUntilFresh: async (sessionId, currentVersion = 0, timeout = 15000) => {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const response = await api.getSessionStatus(sessionId);
        const newVersion = response.data?.template_version ?? 0;
        
        if (newVersion > currentVersion) {
          return response.data;
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (error) {
        console.warn('Error polling session status:', error.message);
        // Continue polling even if individual requests fail
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    
    console.warn(`⏰ Timeout waiting for template version to advance from ${currentVersion}`);
    // Don't throw error, just return null to indicate timeout
    throw new Error(`Template version sync timeout after ${timeout}ms`);
  },

  /**
   * Wait for fresh headers with flexible validation and fast timeout
   * @param {string} sessionId - Session ID
   * @param {number} prevVersion - Previous template version
   * @param {number} minHeaders - Minimum expected header count (optional)
   * @param {number} timeout - Timeout in milliseconds (default: 8000)
   */
  waitForFreshHeaders: async (sessionId, prevVersion, minHeaders, timeout = 8000) => {
    const started = Date.now();
    let attempts = 0;
    const maxAttempts = 20; // Max 20 attempts
    
    while (Date.now() - started < timeout && attempts < maxAttempts) {
      attempts++;
      try {
        const { data } = await api.getSessionStatus(sessionId);
        if (!data?.success) {
          console.warn(`Attempt ${attempts}: Session status not ready`);
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        
        const vOk = data.template_version > prevVersion;
        // Make header count check optional and more flexible
        const hOk = !minHeaders || data.headers_count >= minHeaders || data.template_version > prevVersion + 1;
        
        if (vOk && hOk) {
          return data;
        }
        
        // If version advanced but headers not ready, still consider it success after a few attempts
        if (vOk && attempts > 5) {
          return data;
        }
        
        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        console.warn(`Attempt ${attempts}: Error polling headers:`, error.message);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    // Don't throw error, just log warning and return - the operation likely succeeded
    console.warn(`⚠️ Header sync timeout after ${attempts} attempts, but operation may have succeeded`);
    try {
      const { data } = await api.getSessionStatus(sessionId);
      if (data?.template_version > prevVersion) {
        return data;
      }
    } catch (e) {
      console.warn('Final status check failed:', e.message);
    }
    
    // Return a reasonable fallback instead of throwing
    return { template_version: prevVersion + 1, headers_count: minHeaders || 0 };
  },

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
   * @param {Array} columnOrder - Optional column order array
   */
  downloadFileEnhanced: async (sessionId, fileType = 'converted', customFilename = null, columnOrder = null) => {
    try {
      let response;
      let defaultFilename;

      if (fileType === 'original') {
        response = await api.downloadOriginalFile(sessionId);
        defaultFilename = `original_file_${sessionId}.xlsx`;
      } else if (fileType === 'template') {
        response = await api.downloadTemplateFile(sessionId);
        defaultFilename = `template_file_${sessionId}.xlsx`;
      } else {
        response = await api.downloadProcessedFile(sessionId, 'excel', columnOrder);
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
      }
      
      try {
        // Check if converted file can be generated (has mappings)
        const mappingResponse = await api.getExistingMappings(sessionId);
        convertedAvailable = mappingResponse.data.mappings && Object.keys(mappingResponse.data.mappings).length > 0;
      } catch (e) {
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

  // ==========================================
  // 1️⃣3️⃣ MPN VALIDATION + OAUTH
  // ==========================================

  /**
   * Check Digi‑Key OAuth status
   */
  getMPNOAuthStatus: () => axios.get(`${API_URL}/mpn/auth/status/`),

  /**
   * Start Digi‑Key OAuth (opens redirect URL)
   */
  getMPNOAuthStartUrl: (state = 'excel-mapper') => `${API_URL}/mpn/auth/start/?state=${encodeURIComponent(state)}`,

  /**
   * Validate MPNs for current session
   * @param {string} sessionId
   * @param {string} mpnHeader optional detected column name
   * @param {string} manufacturerHeader optional manufacturer column name
   */
  validateMPNs: (sessionId, mpnHeader = null, manufacturerHeader = null, cacheOnly = false) => {
    const payload = { session_id: sessionId };
    if (mpnHeader) payload.mpn_header = mpnHeader;
    if (manufacturerHeader) payload.manufacturer_header = manufacturerHeader;
    if (cacheOnly) payload.cache_only = true;
    return axios.post(`${API_URL}/mpn/validate/`, payload, { timeout: 600000 });
  },

  /**
   * Cache-warm one chunk of a session's unique MPNs. The caller loops
   * offset=0, limit, 2*limit… until the response's `done` is true, then calls
   * validateMPNs once (fast, fully cached). Keeps each request small so it never
   * hits Azure's 230s request limit, and lets the UI show progress.
   */
  warmMPNs: (sessionId, mpnHeader = null, offset = 0, limit = 8, manufacturerHeader = null) => {
    const payload = { session_id: sessionId, offset, limit };
    if (mpnHeader) payload.mpn_header = mpnHeader;
    if (manufacturerHeader) payload.manufacturer_header = manufacturerHeader;
    return axios.post(`${API_URL}/mpn/validate-warm/`, payload, { timeout: 120000 });
  },

  /**
   * Split multi-MPN cells into one row per MPN before validation
   * @param {string} sessionId
   * @param {string} mpnHeader optional selected MPN column name
   */
  splitMPNCells: (sessionId, mpnHeader = null, splitOptions = null, manufacturerHeader = null, pairManufacturers = true, manufacturerOverrides = null) => {
    const payload = { session_id: sessionId };
    if (mpnHeader) payload.mpn_header = mpnHeader;
    if (manufacturerHeader) payload.manufacturer_header = manufacturerHeader;
    payload.pair_manufacturers = pairManufacturers;
    if (splitOptions) payload.split_options = splitOptions;
    if (manufacturerOverrides && Object.keys(manufacturerOverrides).length) payload.manufacturer_overrides = manufacturerOverrides;
    return axios.post(`${API_URL}/mpn/split-cells/`, payload, { timeout: 120000 });
  },

  /** Find rows where the manufacturer split won't match the MPN count (for the review screen). */
  analyzeMpnPairing: (sessionId, mpnHeader, manufacturerHeader, splitOptions = null) => {
    const payload = { session_id: sessionId, mpn_header: mpnHeader, manufacturer_header: manufacturerHeader };
    if (splitOptions) payload.split_options = splitOptions;
    return axios.post(`${API_URL}/mpn/analyze-pairing/`, payload, { timeout: 120000 });
  },

  parseProducerColumn: (sessionId, producerHeader, mpnHeader = null, manufacturerHeader = null, splitOptions = null, mpnHeaders = null, manufacturerHeaders = null) => {
    const payload = { session_id: sessionId };
    if (producerHeader) payload.producer_header = producerHeader;
    if (mpnHeader) payload.mpn_header = mpnHeader;
    if (manufacturerHeader) payload.manufacturer_header = manufacturerHeader;
    if (Array.isArray(mpnHeaders) && mpnHeaders.length) payload.mpn_headers = mpnHeaders;
    if (Array.isArray(manufacturerHeaders) && manufacturerHeaders.length) payload.manufacturer_headers = manufacturerHeaders;
    if (splitOptions) payload.split_options = splitOptions;
    return axios.post(`${API_URL}/mpn/parse-producer/`, payload, { timeout: 120000 });
  },

  /**
   * List the session's source columns (pre-mapping), for Excel/CSV and PDF sessions alike.
   */
  getSourceColumns: (sessionId) => {
    return axios.get(`${API_URL}/parser/columns/${sessionId}/`);
  },

  /**
   * Per-column mapped source + default value, to disambiguate duplicate-named
   * columns in dropdowns (e.g. "Tag_1 (← Manufacturer)").
   */
  getColumnSourceMap: (sessionId) => {
    return axios.get(`${API_URL}/transforms/column-source-map/${sessionId}/`);
  },

  /** Source columns with a sample value each, for source-column dropdowns. */
  getSourceColumnsPreview: (sessionId) => {
    return axios.get(`${API_URL}/transforms/source-columns-preview/${sessionId}/`);
  },

  /** Remove rows from the mapped grid where the chosen key column is empty. */
  cleanupGridRows: (sessionId, column) => {
    return axios.post(`${API_URL}/transforms/cleanup-grid-rows/`, {
      session_id: sessionId,
      column,
    }, { timeout: 120000 });
  },

  /**
   * Fold repeated column groups into rows.
   * groups: [["Manufacturer","Manufacturer PartNo"], ["Manufacturer S S","Manufacturer PartNo S S"]]
   * targetFields: ["Manufacturer","MPN"]
   */
  expandColumnGroups: (sessionId, { targetFields, groups, onPartial = 'review', keepRowsWithoutGroups = false, preview = false } = {}) => {
    return axios.post(`${API_URL}/transforms/expand-column-groups/`, {
      session_id: sessionId,
      target_fields: targetFields,
      groups,
      on_partial: onPartial,
      keep_rows_without_groups: keepRowsWithoutGroups,
      preview
    }, { timeout: 120000 });
  },

  /**
   * Expand side-by-side alternate columns into rows ON THE CURRENT GRID (composes).
   * Reads the (usually unmapped) alternate source columns and adds one extra row
   * per alternate set, copying the row and overwriting the given destination
   * columns with the alternate's values.
   *   alternateSets: [ [ { target: 'MPN Code', source: 'Manufacturer PartNo S S' },
   *                       { target: 'Preferred vendor code', source: 'Manufacturer S S' } ] ]
   */
  expandAlternateColumns: (sessionId, alternateSets) => {
    return axios.post(`${API_URL}/transforms/expand-alternate-columns/`, {
      session_id: sessionId,
      alternate_sets: alternateSets,
    }, { timeout: 120000 });
  },

  /**
   * Split one delimited column into a numbered run of columns.
   * "C3, C4, C5" with prefix "Tag" becomes Tag_1=C3, Tag_2=C4, Tag_3=C5.
   */
  splitColumnIntoColumns: (sessionId, {
    sourceColumn,
    sourceColumnIndex = null,
    destinationPrefix,
    splitMode = 'delimiter',
    delimiter = 'comma',
    chunkSize = 0,
    trim = true,
    dropEmpty = true,
    maxColumns = 0,
    onOverflow = 'review',
    keepSourceColumn = false,
    overwriteExisting = false,
    preview = false
  } = {}) => {
    return axios.post(`${API_URL}/transforms/split-into-columns/`, {
      session_id: sessionId,
      source_column: sourceColumn,
      source_column_index: sourceColumnIndex,
      destination_prefix: destinationPrefix,
      split_mode: splitMode,
      delimiter,
      chunk_size: chunkSize,
      trim,
      drop_empty: dropEmpty,
      max_columns: maxColumns,
      on_overflow: onOverflow,
      keep_source_column: keepSourceColumn,
      overwrite_existing: overwriteExisting,
      preview
    }, { timeout: 120000 });
  },

  /** Copy one column's values into another column (both must exist). */
  copyColumn: (sessionId, sourceColumn, targetColumn, onlyEmpty = false) =>
    axios.post(`${API_URL}/transforms/copy-column/`, {
      session_id: sessionId,
      source_column: sourceColumn,
      target_column: targetColumn,
      only_empty: onlyEmpty,
    }, { timeout: 120000 }),

  /** Set a fixed value for a column — all cells, or only the empty ones. */
  setColumnDefault: (sessionId, column, value, onlyEmpty = true, condition = null) =>
    axios.post(`${API_URL}/transforms/set-column-default/`, {
      session_id: sessionId,
      column,
      value,
      only_empty: onlyEmpty,
      ...(condition ? { condition } : {}),
    }, { timeout: 120000 }),

  /**
   * Group rows under parent/header rows and reshape into item rows.
   * parentCondition: { column, test, value } where test is one of
   * blank | not_blank | equals | not_equals | is_number | matches.
   */
  carryForwardGroup: (sessionId, { parentCondition, carryColumns = [], fillOnlyBlank = true, emit = 'children', preview = false } = {}) => {
    return axios.post(`${API_URL}/transforms/carry-forward-group/`, {
      session_id: sessionId,
      parent_condition: parentCondition,
      carry_columns: carryColumns,
      fill_only_blank: fillOnlyBlank,
      emit,
      preview
    }, { timeout: 120000 });
  },

  /**
   * Fill blank cells in the named columns with a default value, preserving all
   * existing columns (unlike update-session-data which rebuilds to template cols).
   */
  fillRequiredDefaults: (sessionId, defaults) => {
    return axios.post(`${API_URL}/transforms/fill-required-defaults/`, {
      session_id: sessionId,
      defaults
    }, { timeout: 120000 });
  },

  /**
   * Count blank cells across the FULL grid (all pages) for the given columns.
   * Used by the export required-field guard so the count reflects the whole
   * dataset, not just the current page.
   */
  requiredFieldReport: (sessionId, columns, dupeColumns = []) => {
    return axios.post(`${API_URL}/transforms/required-field-report/`, {
      session_id: sessionId,
      columns,
      dupe_columns: dupeColumns,
    }, { timeout: 60000 });
  },

  /**
   * Resolve blank and/or duplicate Item codes at export time.
   * blankStrategy: 'prefix_sequence' | 'leave'
   * duplicateStrategy: 'suffix' | 'prefix_sequence' | 'leave'
   */
  resolveItemCode: (sessionId, { column = 'Item code', blankStrategy = 'leave', duplicateStrategy = 'leave', prefix = '', separator = '-', start = 1, padding = 0 } = {}) => {
    return axios.post(`${API_URL}/transforms/resolve-item-code/`, {
      session_id: sessionId,
      column,
      blank_strategy: blankStrategy,
      duplicate_strategy: duplicateStrategy,
      prefix, separator, start, padding,
    }, { timeout: 120000 });
  },

  /**
   * Stack alternates into rows from the current mappings: when two source
   * columns are mapped to the same destination, each becomes its own row.
   */
  stackAlternates: (sessionId, mappings, { preview = false } = {}) => {
    return axios.post(`${API_URL}/transforms/stack-alternates/`, {
      session_id: sessionId,
      mappings,
      preview
    }, { timeout: 120000 });
  },

  /**
   * Validate MPNs from parser Specification columns
   */
  validateParserSpecMPNs: (sessionId) => {
    return axios.post(`${API_URL}/mpn/validate-parser-specs/`, { session_id: sessionId }, { timeout: 300000 });
  },

  /**
   * Restore MPN validation columns from cache when applying templates
   * @param {string} sessionId
   * @param {string} mpnHeader optional MPN column name
   * @param {string} manufacturerHeader optional manufacturer column name
   */
  restoreMpnFromCache: (sessionId, mpnHeader = null, manufacturerHeader = null) => {
    const payload = { session_id: sessionId };
    if (mpnHeader) payload.mpn_header = mpnHeader;
    if (manufacturerHeader) payload.manufacturer_header = manufacturerHeader;
    return axios.post(`${API_URL}/mpn/restore-from-cache/`, payload, { timeout: 30000 });
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
   * Create Factwise ID column by combining two existing columns (no sync wait)
   * @param {string} sessionId - Session ID
   * @param {string} firstColumn - First column name
   * @param {string} secondColumn - Second column name
   * @param {string} operator - Operator to combine columns
   */
  createFactwiseId: async (sessionId, firstColumn, secondColumn, operator = '_', strategy = 'fill_only_null', options = {}) => {
    const effectiveSessionId = sessionId || await ensureSession();
    
    showGlobalLoader(true);
    try {
      const resp = await axios.post(`${API_URL}/create-factwise-id/`, {
        session_id: effectiveSessionId,
        first_column: firstColumn,
        second_column: secondColumn,
        operator: operator,
        strategy: strategy,
        generation_mode: options.generationMode || 'columns',
        serial_prefix: options.serialPrefix || '',
        serial_start: options.serialStart ?? 1,
        serial_padding: options.serialPadding ?? 0,
        serial_increment: options.serialIncrement !== false
      });
      
      // Just return immediately - no waiting for sync
      return resp;
    } finally {
      showGlobalLoader(false);
    }
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
   * Apply formula rules to session data and create new tag columns (with proper sync)
   * @param {string} sessionId - Session ID
   * @param {Array} formulaRules - Array of formula rule objects
   * @param {Array} mappings - Optional current mappings to help backend determine Tag column assignment
   */
  applyFormulas: async (sessionId, formulaRules, mappings = null) => {
    const effectiveSessionId = sessionId || await ensureSession();

    const payload = {
      session_id: effectiveSessionId,
      formula_rules: formulaRules
    };

    // Include mappings if provided - helps backend assign Tag columns correctly
    if (mappings !== null) {
      payload.mappings = mappings;
    }

    // Apply the formulas
    const response = await axios.post(`${API_URL}/formulas/apply/`, payload);

    return response;
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
  },

  // ==========================================
  // DASHBOARD AND DOWNLOAD ENDPOINTS
  // ==========================================

  /**
   * Get dashboard data including uploads and templates
   */
  getUploadDashboard: () =>
    axios.get(`${API_URL}/dashboard/`),

  /**
   * Enhanced file download with proper file type handling
   * @param {string} sessionId - Session ID
   * @param {string} fileType - File type ('original', 'converted', or 'template')
   */
  downloadFileEnhanced: async (sessionId, fileType = 'converted', customFilename = null, columnOrder = null, workbookId = null) => {
    try {
      let response;
      if (fileType === 'original') {
        response = await api.downloadOriginalFile(sessionId);
      } else if (fileType === 'template') {
        response = await api.downloadTemplateFile(sessionId);
      } else {
        response = await api.downloadProcessedFile(sessionId, 'excel', columnOrder);
      }

      // Get filename from response headers
      const contentDisposition = response.headers['content-disposition'];
      let filename = customFilename || `download_${sessionId}.xlsx`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }

      // Create download link
      const blob = new Blob([response.data], {
        type: response.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      return {
        success: true,
        filename: filename
      };
    } catch (error) {
      console.error(`Error downloading ${fileType} file:`, error);
      throw new Error(`Failed to download ${fileType} file: ${error.response?.data?.error || error.message}`);
    }
  },

  /**
   * Update session data with corrected values while preserving structure
   * @param {string} sessionId - Session ID
   * @param {Object} correctionData - Object containing headers and data arrays
   */
  updateSessionData: (sessionId, correctionData) =>
    axios.post(`${API_URL}/update-session-data/`, {
      session_id: sessionId,
      ...correctionData
    }),

  // Project Management
  getProjects: (search = '') =>
    axios.get(`${API_URL}/projects/`, { params: { search } }),

  createProject: (projectName, projectCode, description = '') =>
    axios.post(`${API_URL}/projects/`, {
      project_name: projectName,
      project_code: projectCode,
      description: description
    })
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

// Add complexity analysis to the api object
api.analyzePDFComplexity = async (sessionId) => {
  try {
    const response = await axios.post(`${API_URL}/pdf/analyze-complexity/`, {
      session_id: sessionId
    });
    return response;
  } catch (error) {
    console.error('Failed to analyze PDF complexity:', error);
    throw error;
  }
};

export default api;
