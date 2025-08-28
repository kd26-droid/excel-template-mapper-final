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
      
      // Step 2: Fetch data with specifications
      const dataResponse = await api.getMappedDataWithSpecs(
        this.sessionId, 
        1, 
        1000, 
        enableSpecParsing
      );
      
      if (!dataResponse.data) {
        throw new Error('No data received from API');
      }
      
      // Step 3: Validate data structure
      const validationResult = this.validateDataStructure(dataResponse.data);
      if (!validationResult.isValid) {
        console.warn('⚠️ Data structure validation failed:', validationResult.errors);
        if (retryAttempt < maxRetries) {
          await this.delay(this.azureRetryDelay * (retryAttempt + 1));
          return this.fetchDataWithValidation(enableSpecParsing, retryAttempt + 1);
        }
      }
      
      // Step 4: Cache the validated data
      this.dataCache.set('lastFetchedData', {
        data: dataResponse.data,
        timestamp: Date.now(),
        headers: dataResponse.data.headers || [],
        rowCount: dataResponse.data.data ? dataResponse.data.data.length : 0
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
        dataCount: dataResponse.data.data ? dataResponse.data.data.length : 0,
        headerCount: dataResponse.data.headers ? dataResponse.data.headers.length : 0
      });
      
      return {
        success: true,
        data: dataResponse.data,
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
    
    try {
      console.log(`🔄 Starting synchronized operation: ${operationType}`);
      this.emit('start', { operation: operationType, id: operationId });
      
      // Add to sync queue
      this.syncQueue.push({ id: operationId, type: operationType, status: 'pending' });
      
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
      
      // Wait for Azure backend to process
      if (options.azureWaitTime) {
        console.log(`⏰ Waiting ${options.azureWaitTime}ms for Azure processing...`);
        await this.delay(options.azureWaitTime);
      }
      
      // Fetch fresh data to validate operation success
      let validationData = null;
      if (options.validateWithFreshData !== false) {
        try {
          validationData = await this.fetchDataWithValidation(true);
        } catch (validationError) {
          console.warn('Post-operation validation failed:', validationError);
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
        await this.delay(3000); // Wait for backend processing
        const validationData = await api.getMappedDataWithSpecs(this.sessionId, 1, 5, true);
        
        const hasFactWiseColumn = validationData.data.headers?.some(h => 
          h.toLowerCase().includes('factwise') || h.toLowerCase().includes('item code')
        );
        
        if (!hasFactWiseColumn) {
          throw new Error('FactWise ID column was not created successfully');
        }
        
        return result;
      },
      {
        azureWaitTime: 4000, // Wait 4 seconds for Azure processing
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
        azureWaitTime: 5000, // Wait 5 seconds for formula processing
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
        azureWaitTime: 3000, // Wait 3 seconds for template processing
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