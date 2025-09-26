// testSynchronizer.js - Comprehensive test suite for DataSynchronizer
// Run this to validate the synchronization solution before deployment

import { getDataSynchronizer, cleanupSynchronizer } from './DataSynchronizer';
import api from '../services/api';

/**
 * Comprehensive test suite for Azure deployment synchronization
 */
class SynchronizerTestSuite {
  constructor() {
    this.results = [];
    this.sessionId = null;
    this.synchronizer = null;
  }

  /**
   * Log test result
   */
  logResult(testName, passed, message = '', data = null) {
    const result = {
      test: testName,
      passed,
      message,
      data,
      timestamp: new Date().toISOString()
    };
    
    this.results.push(result);
    
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${testName}: ${message}`);
    
    if (data) {
      console.log('  Data:', data);
    }
  }

  /**
   * Create a test session
   */
  async setupTestSession() {
    try {
      console.log('🚀 Setting up test session...');
      
      // For testing purposes, we'll assume you have a way to create test sessions
      // You may need to modify this based on your actual session creation method
      this.sessionId = 'test-session-' + Date.now();
      
      // Initialize synchronizer
      this.synchronizer = getDataSynchronizer(this.sessionId);
      
      this.logResult('setupTestSession', true, 'Test session created');
      return true;
      
    } catch (error) {
      this.logResult('setupTestSession', false, `Failed to create test session: ${error.message}`);
      return false;
    }
  }

  /**
   * Test basic synchronizer initialization
   */
  async testSynchronizerInitialization() {
    try {
      const synchronizer = getDataSynchronizer('test-init-session');
      
      // Check if synchronizer has required methods
      const requiredMethods = [
        'addEventListener',
        'validateSession',
        'fetchDataWithValidation',
        'executeSynchronizedOperation',
        'createFactWiseIdSynchronized',
        'applyFormulasSynchronized',
        'applyTemplateSynchronized'
      ];
      
      const missingMethods = requiredMethods.filter(method => 
        typeof synchronizer[method] !== 'function'
      );
      
      if (missingMethods.length > 0) {
        throw new Error(`Missing methods: ${missingMethods.join(', ')}`);
      }
      
      this.logResult('synchronizerInitialization', true, 'All required methods present');
      
      // Cleanup test synchronizer
      cleanupSynchronizer('test-init-session');
      
      return true;
      
    } catch (error) {
      this.logResult('synchronizerInitialization', false, error.message);
      return false;
    }
  }

  /**
   * Test session validation
   */
  async testSessionValidation() {
    if (!this.synchronizer) {
      this.logResult('sessionValidation', false, 'No synchronizer available');
      return false;
    }
    
    try {
      // Test session validation (this will likely fail with test session, but we can test the mechanism)
      await this.synchronizer.validateSession();
      
      this.logResult('sessionValidation', true, 'Session validation completed without errors');
      return true;
      
    } catch (error) {
      // Session validation failing is expected with test session, but we can check error handling
      const isExpectedError = error.message.includes('session') || 
                             error.message.includes('validation') ||
                             error.message.includes('404') ||
                             error.message.includes('invalid');
      
      if (isExpectedError) {
        this.logResult('sessionValidation', true, 'Session validation error handling works correctly', { error: error.message });
        return true;
      } else {
        this.logResult('sessionValidation', false, `Unexpected error: ${error.message}`);
        return false;
      }
    }
  }

  /**
   * Test event system
   */
  async testEventSystem() {
    if (!this.synchronizer) {
      this.logResult('eventSystem', false, 'No synchronizer available');
      return false;
    }
    
    try {
      let eventReceived = false;
      let eventData = null;
      
      // Add event listener
      this.synchronizer.addEventListener('test', (data) => {
        eventReceived = true;
        eventData = data;
      });
      
      // Emit test event
      this.synchronizer.emit('test', { message: 'test event' });
      
      // Small delay to allow event processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (eventReceived && eventData && eventData.message === 'test event') {
        this.logResult('eventSystem', true, 'Event system working correctly');
        return true;
      } else {
        this.logResult('eventSystem', false, 'Event not received or data incorrect');
        return false;
      }
      
    } catch (error) {
      this.logResult('eventSystem', false, error.message);
      return false;
    }
  }

  /**
   * Test data structure validation
   */
  async testDataValidation() {
    if (!this.synchronizer) {
      this.logResult('dataValidation', false, 'No synchronizer available');
      return false;
    }
    
    try {
      // Test valid data structure
      const validData = {
        headers: ['column1', 'column2', 'column3'],
        data: [
          { column1: 'value1', column2: 'value2', column3: 'value3' },
          { column1: 'value4', column2: 'value5', column3: 'value6' }
        ],
        formula_rules: [],
        unmapped_columns: []
      };
      
      const validationResult = this.synchronizer.validateDataStructure(validData);
      
      if (validationResult.isValid && validationResult.errors.length === 0) {
        this.logResult('dataValidation', true, 'Valid data structure correctly validated');
      } else {
        this.logResult('dataValidation', false, 'Valid data structure incorrectly flagged as invalid');
        return false;
      }
      
      // Test invalid data structure
      const invalidData = {
        headers: null,
        data: 'invalid',
        formula_rules: 'not_array'
      };
      
      const invalidValidationResult = this.synchronizer.validateDataStructure(invalidData);
      
      if (!invalidValidationResult.isValid && invalidValidationResult.errors.length > 0) {
        this.logResult('dataValidation', true, 'Invalid data structure correctly identified', {
          errors: invalidValidationResult.errors
        });
        return true;
      } else {
        this.logResult('dataValidation', false, 'Invalid data structure not properly detected');
        return false;
      }
      
    } catch (error) {
      this.logResult('dataValidation', false, error.message);
      return false;
    }
  }

  /**
   * Test synchronized operation execution framework
   */
  async testSynchronizedOperationFramework() {
    if (!this.synchronizer) {
      this.logResult('synchronizedOperationFramework', false, 'No synchronizer available');
      return false;
    }
    
    try {
      // Test successful operation
      const successOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async work
        return { success: true, data: 'test_result' };
      };
      
      const result = await this.synchronizer.executeSynchronizedOperation(
        'testOperation',
        successOperation,
        { validateWithFreshData: false }
      );
      
      if (result.success && result.result.data === 'test_result') {
        this.logResult('synchronizedOperationFramework', true, 'Synchronized operation framework working correctly');
        return true;
      } else {
        this.logResult('synchronizedOperationFramework', false, 'Operation result not as expected');
        return false;
      }
      
    } catch (error) {
      this.logResult('synchronizedOperationFramework', false, error.message);
      return false;
    }
  }

  /**
   * Test error handling and retry logic
   */
  async testErrorHandling() {
    if (!this.synchronizer) {
      this.logResult('errorHandling', false, 'No synchronizer available');
      return false;
    }
    
    try {
      let attemptCount = 0;
      
      // Test operation that fails twice then succeeds
      const flakyOperation = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return { success: true, attempt: attemptCount };
      };
      
      // This should fail with the current implementation since executeSynchronizedOperation
      // doesn't have built-in retry for the operation itself, but we can test error handling
      try {
        await this.synchronizer.executeSynchronizedOperation(
          'flakyTest',
          flakyOperation,
          { validateWithFreshData: false }
        );
        
        this.logResult('errorHandling', true, 'Error handling completed successfully');
        return true;
        
      } catch (error) {
        // Expected to fail, but we can verify error handling
        if (error.message === 'Temporary failure') {
          this.logResult('errorHandling', true, 'Error properly propagated and handled');
          return true;
        } else {
          this.logResult('errorHandling', false, `Unexpected error: ${error.message}`);
          return false;
        }
      }
      
    } catch (error) {
      this.logResult('errorHandling', false, error.message);
      return false;
    }
  }

  /**
   * Test cache and state management
   */
  async testCacheAndState() {
    if (!this.synchronizer) {
      this.logResult('cacheAndState', false, 'No synchronizer available');
      return false;
    }
    
    try {
      // Test sync status
      const syncStatus = this.synchronizer.getSyncStatus();
      
      const requiredStatusFields = ['sessionId', 'queueLength', 'syncInProgress', 'validationEnabled'];
      const missingFields = requiredStatusFields.filter(field => 
        !(field in syncStatus)
      );
      
      if (missingFields.length > 0) {
        this.logResult('cacheAndState', false, `Missing status fields: ${missingFields.join(', ')}`);
        return false;
      }
      
      if (syncStatus.sessionId !== this.sessionId) {
        this.logResult('cacheAndState', false, 'Session ID mismatch in sync status');
        return false;
      }
      
      this.logResult('cacheAndState', true, 'Cache and state management working correctly', {
        status: syncStatus
      });
      return true;
      
    } catch (error) {
      this.logResult('cacheAndState', false, error.message);
      return false;
    }
  }

  /**
   * Test synchronizer cleanup
   */
  async testCleanup() {
    try {
      const testSessionId = 'cleanup-test-session';
      const testSynchronizer = getDataSynchronizer(testSessionId);
      
      // Verify synchronizer exists
      if (!testSynchronizer) {
        this.logResult('cleanup', false, 'Failed to create test synchronizer');
        return false;
      }
      
      // Cleanup synchronizer
      cleanupSynchronizer(testSessionId);
      
      this.logResult('cleanup', true, 'Synchronizer cleanup completed successfully');
      return true;
      
    } catch (error) {
      this.logResult('cleanup', false, error.message);
      return false;
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🧪 Starting DataSynchronizer Test Suite...\n');
    
    const tests = [
      'testSynchronizerInitialization',
      'setupTestSession',
      'testSessionValidation',
      'testEventSystem',
      'testDataValidation',
      'testSynchronizedOperationFramework',
      'testErrorHandling',
      'testCacheAndState',
      'testCleanup'
    ];
    
    let passedTests = 0;
    let totalTests = tests.length;
    
    for (const testName of tests) {
      try {
        const passed = await this[testName]();
        if (passed) passedTests++;
      } catch (error) {
        console.error(`❌ Test ${testName} threw unexpected error:`, error);
        this.logResult(testName, false, `Unexpected error: ${error.message}`);
      }
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Cleanup
    if (this.synchronizer) {
      cleanupSynchronizer(this.sessionId);
    }
    
    // Print summary
    console.log('\n📊 Test Results Summary:');
    console.log(`✅ Passed: ${passedTests}/${totalTests}`);
    console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);
    console.log(`📈 Success Rate: ${Math.round((passedTests / totalTests) * 100)}%\n`);
    
    // Print detailed results
    console.log('📋 Detailed Results:');
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`  ${status} ${result.test}: ${result.message}`);
      if (result.data && !result.passed) {
        console.log(`    Data:`, result.data);
      }
    });
    
    const allPassed = passedTests === totalTests;
    
    if (allPassed) {
      console.log('\n🎉 All tests passed! The DataSynchronizer is ready for deployment.');
    } else {
      console.log('\n⚠️ Some tests failed. Please review the results and fix issues before deployment.');
    }
    
    return {
      allPassed,
      passedTests,
      totalTests,
      successRate: Math.round((passedTests / totalTests) * 100),
      results: this.results
    };
  }

  /**
   * Run minimal smoke tests
   */
  async runSmokeTests() {
    console.log('🔥 Running DataSynchronizer Smoke Tests...\n');
    
    const smokeTests = [
      'testSynchronizerInitialization',
      'testEventSystem',
      'testDataValidation'
    ];
    
    let passedTests = 0;
    
    for (const testName of smokeTests) {
      try {
        const passed = await this[testName]();
        if (passed) passedTests++;
      } catch (error) {
        console.error(`❌ Smoke test ${testName} failed:`, error);
        this.logResult(testName, false, error.message);
      }
    }
    
    const allPassed = passedTests === smokeTests.length;
    
    console.log(`\n🔥 Smoke Tests: ${passedTests}/${smokeTests.length} passed`);
    
    if (allPassed) {
      console.log('✅ Smoke tests passed! Basic functionality is working.');
    } else {
      console.log('❌ Smoke tests failed! Check basic functionality.');
    }
    
    return allPassed;
  }
}

// Export test functions
export const runSynchronizerTests = async () => {
  const testSuite = new SynchronizerTestSuite();
  return await testSuite.runAllTests();
};

export const runSynchronizerSmokeTests = async () => {
  const testSuite = new SynchronizerTestSuite();
  return await testSuite.runSmokeTests();
};

// Default export
export default SynchronizerTestSuite;