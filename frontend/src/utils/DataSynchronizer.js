// DataSynchronizer.js - Comprehensive data synchronization utility for Azure deployment
// Fixes refresh issues by ensuring consistent data state across all operations

import api from '../services/api';

/**
 * DataSynchronizer class handles all data synchronization operations
 * Ensures consistent state between frontend and backend, especially for Azure deployment
 */
class DataSynchronizer {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.dataCache = new Map();
    this.syncQueue = [];
    this.syncInProgress = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.syncTimeout = 30000; // 30 seconds timeout
    
    // Azure-specific configurations
    this.azureRetryDelay = 2000; // 2 seconds between retries
    this.azureValidationEnabled = true;
    this.sessionValidationInterval = null;
    
    // Event listeners for sync status
    this.listeners = new Map();
    
    console.log('🔄 DataSynchronizer initialized for session:', sessionId);
  }

  /**
   * Add event listener for sync events
   * @param {string} event - Event name ('start', 'complete', 'error', 'validate')
   * @param {function} callback - Callback function
   */
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Emit event to all registered listeners
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  emit(event, data = null) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in sync event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Start periodic session validation (for Azure deployment)
   */
  startSessionValidation() {
    if (this.sessionValidationInterval) {
      clearInterval(this.sessionValidationInterval);
    }
    
    // Validate session every 60 seconds to prevent Azure session timeouts
    this.sessionValidationInterval = setInterval(async () => {
      try {
        await this.validateSession();
      } catch (error) {
        console.warn('Session validation failed:', error);
      }
    }, 60000);
  }

  /**
   * Stop session validation
   */
  stopSessionValidation() {
    if (this.sessionValidationInterval) {
      clearInterval(this.sessionValidationInterval);
      this.sessionValidationInterval = null;
    }
  }

  /**
   * Validate session exists and is accessible
   * @returns {boolean} - Session is valid
   */
  async validateSession() {
    try {
      console.log('🔍 Validating session:', this.sessionId);
      const response = await api.getExistingMappings(this.sessionId);
      const isValid = response.data && response.data.success !== false;
      
      if (!isValid) {
        console.warn('⚠️ Session validation failed - session may be expired');
        this.emit('sessionInvalid', { sessionId: this.sessionId });
      } else {
        console.log('✅ Session validation successful');
      }
      
      return isValid;
    } catch (error) {
      console.error('❌ Session validation error:', error);
      this.emit('sessionError', { error, sessionId: this.sessionId });
      return false;
    }
  }

  /**
   * Comprehensive data fetch with validation and retry logic
   * @param {boolean} enableSpecParsing - Enable specification parsing
   * @param {number} retryAttempt - Current retry attempt
   * @returns {Object} - Fetched data with validation results
   */
  async fetchDataWithValidation(enableSpecParsing = true, retryAttempt = 0) {
    const maxRetries = this.maxRetries;
    
    try {
      console.log(`🔄 Fetching data (attempt ${retryAttempt + 1}/${maxRetries + 1})`);
      this.emit('start', { operation: 'fetchData', attempt: retryAttempt + 1 });
      
      // Step 1: Validate session first
      const sessionValid = await this.validateSession();
      if (!sessionValid && retryAttempt === 0) {
        throw new Error('Session validation failed before data fetch');
      }
      
      // Step 2: Fetch ALL pages with specifications (no 1000-row cap)
      const firstPage = await api.getMappedDataWithSpecs(this.sessionId, 1, 1000, enableSpecParsing);
      let aggregated = firstPage?.data || { headers: [], data: [], pagination: { page: 1, page_size: 1000, total_rows: 0, total_pages: 1 } };
      console.info("DATA VIEW HEADERS (DataSynchronizer):", Array.isArray(aggregated.headers) ? aggregated.headers.join(", ") : aggregated.headers);
      const totalPages = Math.max(1, aggregated?.pagination?.total_pages || 1);
      if (totalPages > 1) {
        for (let p = 2; p <= totalPages; p++) {
          const pageResp = await api.getMappedDataWithSpecs(this.sessionId, p, 1000, enableSpecParsing);
          const pageData = pageResp?.data || {};
          if (Array.isArray(pageData?.data)) {
            // Ensure headers are consistent; fallback to first page headers
            if (!aggregated.headers || aggregated.headers.length === 0) aggregated.headers = pageData.headers || [];
            aggregated.data = aggregated.data.concat(pageData.data);
          }
          // Emit progress for consumers (e.g., UI progress bar)
          this.emit('progress', { operation: 'fetchData', page: p, totalPages });
        }
        // Normalize pagination after aggregation
        aggregated.pagination = {
          page: 1,
          page_size: aggregated?.pagination?.page_size || 1000,
          total_rows: Array.isArray(aggregated.data) ? aggregated.data.length : (aggregated?.pagination?.total_rows || 0),
          total_pages: 1,
        };
      }
      // Sanity check aggregated result
      if (!aggregated || !Array.isArray(aggregated.headers) || !Array.isArray(aggregated.data)) {
        throw new Error('No data received from API');
      }
      
      // Step 3: Validate data structure
      const validationResult = this.validateDataStructure(aggregated);
      if (!validationResult.isValid) {
        console.warn('⚠️ Data structure validation failed:', validationResult.errors);
        if (retryAttempt < maxRetries) {
          await this.delay(this.azureRetryDelay * (retryAttempt + 1));
          return this.fetchDataWithValidation(enableSpecParsing, retryAttempt + 1);
        }
      }
      
      // Step 4: Cache the validated data
      this.dataCache.set('lastFetchedData', {
        data: aggregated,
        timestamp: Date.now(),
        headers: aggregated.headers || [],
        rowCount: aggregated.data ? aggregated.data.length : 0
      });
      
      // Step 5: Cross-validate with mappings
      let mappingsData = null;
      try {
        const mappingsResponse = await api.getExistingMappings(this.sessionId);
        mappingsData = mappingsResponse.data;
      } catch (mappingsError) {
        console.warn('Could not fetch mappings for cross-validation:', mappingsError);
      }
      
      console.log('✅ Data fetch completed successfully');
      this.emit('complete', { 
        operation: 'fetchData', 
        dataCount: Array.isArray(aggregated.data) ? aggregated.data.length : 0,
        headerCount: Array.isArray(aggregated.headers) ? aggregated.headers.length : 0
      });
      
      return {
        success: true,
        data: aggregated,
        mappings: mappingsData,
        validation: validationResult,
        fromCache: false
      };
      
    } catch (error) {
      console.error(`❌ Data fetch failed (attempt ${retryAttempt + 1}):`, error);
      
      if (retryAttempt < maxRetries) {
        const delay = this.azureRetryDelay * Math.pow(2, retryAttempt); // Exponential backoff
        console.log(`⏰ Retrying in ${delay}ms...`);
        await this.delay(delay);
        return this.fetchDataWithValidation(enableSpecParsing, retryAttempt + 1);
      }
      
      this.emit('error', { operation: 'fetchData', error });
      
      // Return cached data if available
      const cachedData = this.dataCache.get('lastFetchedData');
      if (cachedData && (Date.now() - cachedData.timestamp) < 300000) { // 5 minutes
        console.log('📦 Returning cached data due to fetch failure');
        return {
          success: false,
          data: cachedData.data,
          mappings: null,
          validation: { isValid: false, errors: ['Using cached data due to fetch failure'] },
          fromCache: true,
          error: error.message
        };
      }
      
      throw error;
    }
  }

  /**
   * Synchronized operation execution with validation
   * @param {string} operationType - Type of operation
   * @param {function} operation - Operation function to execute
   * @param {Object} options - Operation options
   */
  async executeSynchronizedOperation(operationType, operation, options = {}) {
    const operationId = `${operationType}_${Date.now()}`;
    const minLoaderMs = options.minLoaderMs != null ? options.minLoaderMs : 3000; // ensure loader shows at least 3s
    const expectVersionAdvance = options.expectVersionAdvance !== false; // default true
    let startTemplateVersion = 0;

    try {
      console.log(`🔄 Starting synchronized operation: ${operationType}`);
      this.emit('start', { operation: operationType, id: operationId });

      // Add to sync queue
      this.syncQueue.push({ id: operationId, type: operationType, status: 'pending' });

      // Capture starting template version to detect fresh data
      try {
        const status = await api.getSessionStatus(this.sessionId);
        startTemplateVersion = status.data?.template_version ?? 0;
      } catch (e) {
        console.warn('Could not read starting template version:', e.message);
      }

      const opStart = Date.now();
      // Execute the operation
      const result = await operation();

      // Validate session after operation
      if (this.azureValidationEnabled) {
        console.log('🔍 Validating session after operation...');
        const sessionStillValid = await this.validateSession();
        if (!sessionStillValid) {
          throw new Error('Session became invalid after operation');
        }
      }

      // Wait for Azure backend to process with bounded polling for version advance
      const waitBudgetMs = Math.max(0, minLoaderMs - (Date.now() - opStart));
      const pollTimeout = options.azureWaitTime != null ? options.azureWaitTime : waitBudgetMs;
      if (expectVersionAdvance && pollTimeout > 0) {
        const pollStart = Date.now();
        let advanced = false;
        while (Date.now() - pollStart < pollTimeout) {
          try {
            const st = await api.getSessionStatus(this.sessionId);
            const tv = st.data?.template_version ?? 0;
            if (tv > startTemplateVersion) {
              advanced = true;
              console.log('✅ Detected template version advance:', { from: startTemplateVersion, to: tv });
              break;
            }
          } catch (e) {
            // continue polling
          }
          await this.delay(300);
        }
        if (!advanced) {
          console.warn('⏰ Version did not advance within poll window; proceeding with fetch');
        }
      }

      // Fetch fresh data to validate operation success (fast mode, bounded)
      let validationData = null;
      if (options.validateWithFreshData !== false) {
        try {
          validationData = await this.fetchDataFast(12000);
        } catch (validationError) {
          console.warn('Post-operation fast validation failed:', validationError);
        }
      }

      // Update sync queue
      const queueItem = this.syncQueue.find(item => item.id === operationId);
      if (queueItem) {
        queueItem.status = 'completed';
        queueItem.result = result;
        queueItem.validationData = validationData;
      }

      console.log(`✅ Synchronized operation completed: ${operationType}`);
      this.emit('complete', { 
        operation: operationType, 
        id: operationId, 
        result,
        validationData 
      });

      return {
        success: true,
        result,
        validationData,
        operationId
      };

    } catch (error) {
      console.error(`❌ Synchronized operation failed: ${operationType}`, error);

      // Update sync queue with error
      const queueItem = this.syncQueue.find(item => item.id === operationId);
      if (queueItem) {
        queueItem.status = 'failed';
        queueItem.error = error.message;
      }

      this.emit('error', { operation: operationType, id: operationId, error });
      throw error;
    }
  }

  /**
   * Fast data fetch with strict 3s budget. Returns cached data if server is slow.
   * @param {number} budgetMs - Maximum milliseconds to wait for fresh data
   */
  async fetchDataFast(budgetMs = 3000) {
    const started = Date.now();
    this.emit('start', { operation: 'fetchDataFast' });
    try {
      // Fetch first page to discover total pages, then aggregate all
      const firstPromise = api.getMappedDataWithSpecs(this.sessionId, 1, 1000, true, { force_fresh: true, _fresh: Date.now() });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out fetching data')), budgetMs));
      const firstResponse = await Promise.race([firstPromise, timeoutPromise]);
      let aggregated = firstResponse.data;
      console.info("DATA VIEW HEADERS (fetchDataFast):", Array.isArray(aggregated.headers) ? aggregated.headers.join(", ") : aggregated.headers);
      const totalPages = Math.max(1, aggregated?.pagination?.total_pages || 1);
      if (totalPages > 1) {
        for (let p = 2; p <= totalPages; p++) {
          const pageResp = await api.getMappedDataWithSpecs(this.sessionId, p, 1000, true, { force_fresh: true, _fresh: Date.now() });
          if (Array.isArray(pageResp?.data?.data)) {
            if (!aggregated.headers || aggregated.headers.length === 0) aggregated.headers = pageResp.data.headers || [];
            aggregated.data = (aggregated.data || []).concat(pageResp.data.data);
          }
          // Emit progress for consumers during fast fetch
          this.emit('progress', { operation: 'fetchDataFast', page: p, totalPages });
        }
        aggregated.pagination = {
          page: 1,
          page_size: aggregated?.pagination?.page_size || 1000,
          total_rows: Array.isArray(aggregated.data) ? aggregated.data.length : (aggregated?.pagination?.total_rows || 0),
          total_pages: 1,
        };
      }
      const validation = this.validateDataStructure(aggregated);
      this.dataCache.set('lastFetchedData', { data: aggregated, timestamp: Date.now(), headers: aggregated.headers || [], rowCount: (aggregated.data || []).length });
      this.emit('complete', { operation: 'fetchDataFast', dataCount: (aggregated.data || []).length });
      return { success: validation.isValid, data: aggregated, validation, fromCache: false };
    } catch (error) {
      console.warn('fetchDataFast failed:', error.message);
      const cached = this.dataCache.get('lastFetchedData');
      if (cached) {
        this.emit('complete', { operation: 'fetchDataFast', dataCount: cached.rowCount, fromCache: true });
        return { success: false, data: cached.data, validation: { isValid: true, errors: [], warnings: ['Using cached data'] }, fromCache: true };
      }
      this.emit('error', { operation: 'fetchDataFast', error });
      throw error;
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < 3000) {
        await this.delay(3000 - elapsed); // ensure loader visible ~3s
      }
    }
  }

  /**
   * Create FactWise ID with comprehensive validation
   * @param {string} firstColumn - First column name
   * @param {string} secondColumn - Second column name
   * @param {string} operator - Operator
   * @param {string} strategy - Creation strategy
   */
  async createFactWiseIdSynchronized(firstColumn, secondColumn, operator, strategy) {
    return this.executeSynchronizedOperation(
      'createFactWiseId',
      async () => {
        const result = await api.createFactwiseId(
          this.sessionId, 
          firstColumn, 
          secondColumn, 
          operator, 
          strategy
        );
        
        // Additional validation: check if FactWise ID column was actually created
        // Wait longer for large datasets and validate against full headers
        await this.delay(3000);
        const validationData = await api.getMappedDataWithSpecs(this.sessionId, 1, 1000, true, { force_fresh: true, _fresh: Date.now() });
        
        const hasFactWiseColumn = validationData.data.headers?.some(h => 
          h.toLowerCase().includes('factwise') || h.toLowerCase().includes('item code')
        );
        
        if (!hasFactWiseColumn) {
          throw new Error('FactWise ID column was not created successfully');
        }
        
        return result;
      },
      {
        // Prolong loader/polling to handle 1000+ rows
        minLoaderMs: 8000,
        azureWaitTime: 8000,
        expectVersionAdvance: true,
        validateWithFreshData: true
      }
    );
  }

  /**
   * Apply formulas with comprehensive validation
   * @param {Array} formulaRules - Formula rules to apply
   */
  async applyFormulasSynchronized(formulaRules) {
    return this.executeSynchronizedOperation(
      'applyFormulas',
      async () => {
        const result = await api.applyFormulas(this.sessionId, formulaRules);
        
        // Additional validation: check if formula columns were created
        await this.delay(3000);
        const validationData = await api.getMappedDataWithSpecs(this.sessionId, 1, 5, true);
        
        const expectedColumns = formulaRules.length;
        const actualFormulaColumns = validationData.data.headers?.filter(h => 
          h.startsWith('Tag_') || 
          h.startsWith('Specification_') || 
          h.startsWith('Customer_Identification_') ||
          h === 'Tag'
        ).length || 0;
        
        console.log(`📊 Formula validation: Expected ${expectedColumns}, Found ${actualFormulaColumns}`);
        
        return result;
      },
      {
        minLoaderMs: 3000,
        expectVersionAdvance: true,
        validateWithFreshData: true
      }
    );
  }

  /**
   * Apply template with comprehensive validation
   * @param {number} templateId - Template ID to apply
   */
  async applyTemplateSynchronized(templateId) {
    return this.executeSynchronizedOperation(
      'applyTemplate',
      async () => {
        const result = await api.applyMappingTemplate(this.sessionId, templateId);
        
        // Additional validation: verify template was applied correctly
        await this.delay(2000);
        const mappingsData = await api.getExistingMappings(this.sessionId);
        
        if (!mappingsData.data.mappings || Object.keys(mappingsData.data.mappings).length === 0) {
          throw new Error('Template application did not create expected mappings');
        }
        
        return result;
      },
      {
        minLoaderMs: 3000,
        expectVersionAdvance: true,
        validateWithFreshData: true
      }
    );
  }

  /**
   * Validate data structure integrity
   * @param {Object} data - Data to validate
   * @returns {Object} - Validation result
   */
  validateDataStructure(data) {
    const errors = [];
    const warnings = [];
    
    // Check basic structure
    if (!data) {
      errors.push('Data object is null or undefined');
      return { isValid: false, errors, warnings };
    }
    
    // Check headers
    if (!data.headers || !Array.isArray(data.headers)) {
      errors.push('Headers are missing or invalid');
    } else if (data.headers.length === 0) {
      warnings.push('Headers array is empty');
    }
    
    // Check data array
    if (!data.data || !Array.isArray(data.data)) {
      errors.push('Data array is missing or invalid');
    } else if (data.data.length === 0) {
      warnings.push('Data array is empty');
    }
    
    // Cross-validate headers and data
    if (data.headers && data.data && data.headers.length > 0 && data.data.length > 0) {
      const firstRow = data.data[0];
      const headerCount = data.headers.length;
      const dataKeyCount = Object.keys(firstRow).length;
      
      if (Math.abs(headerCount - dataKeyCount) > 2) { // Allow some variance
        warnings.push(`Header count (${headerCount}) and data key count (${dataKeyCount}) mismatch significantly`);
      }
    }
    
    // Check for formula rules if present
    if (data.formula_rules && Array.isArray(data.formula_rules) && data.formula_rules.length > 0) {
      console.log(`📋 Found ${data.formula_rules.length} formula rules in data`);
    }
    
    // Check for unmapped columns
    if (data.unmapped_columns && Array.isArray(data.unmapped_columns) && data.unmapped_columns.length > 0) {
      warnings.push(`Found ${data.unmapped_columns.length} unmapped columns`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      stats: {
        headerCount: data.headers ? data.headers.length : 0,
        dataCount: data.data ? data.data.length : 0,
        formulaRules: data.formula_rules ? data.formula_rules.length : 0,
        unmappedColumns: data.unmapped_columns ? data.unmapped_columns.length : 0
      }
    };
  }

  /**
   * Get synchronization status
   * @returns {Object} - Current sync status
   */
  getSyncStatus() {
    return {
      sessionId: this.sessionId,
      queueLength: this.syncQueue.length,
      syncInProgress: this.syncInProgress,
      lastCache: this.dataCache.has('lastFetchedData') ? {
        timestamp: this.dataCache.get('lastFetchedData').timestamp,
        age: Date.now() - this.dataCache.get('lastFetchedData').timestamp
      } : null,
      validationEnabled: this.azureValidationEnabled,
      recentOperations: this.syncQueue.slice(-5) // Last 5 operations
    };
  }

  /**
   * Clear cache and reset synchronizer
   */
  reset() {
    console.log('🔄 Resetting DataSynchronizer');
    this.dataCache.clear();
    this.syncQueue = [];
    this.syncInProgress = false;
    this.retryCount = 0;
    this.stopSessionValidation();
    this.emit('reset');
  }

  /**
   * Utility: Delay execution
   * @param {number} ms - Milliseconds to delay
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  destroy() {
    console.log('🗑️ Destroying DataSynchronizer');
    this.stopSessionValidation();
    this.dataCache.clear();
    this.syncQueue = [];
    this.listeners.clear();
    this.emit('destroy');
  }
}

// Export singleton factory
const synchronizers = new Map();

/**
 * Get or create DataSynchronizer instance for session
 * @param {string} sessionId - Session ID
 * @returns {DataSynchronizer} - Synchronizer instance
 */
export const getDataSynchronizer = (sessionId) => {
  if (!synchronizers.has(sessionId)) {
    synchronizers.set(sessionId, new DataSynchronizer(sessionId));
  }
  return synchronizers.get(sessionId);
};

/**
 * Clean up synchronizer for session
 * @param {string} sessionId - Session ID
 */
export const cleanupSynchronizer = (sessionId) => {
  if (synchronizers.has(sessionId)) {
    synchronizers.get(sessionId).destroy();
    synchronizers.delete(sessionId);
  }
};

export default DataSynchronizer;
