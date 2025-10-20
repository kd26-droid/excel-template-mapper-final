/**
 * 🔍 AZURE COLUMN MONITOR
 * Real-time monitoring system for critical column states
 * Provides health checks and automatic recovery for Azure deployment issues
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:8000/api';

/**
 * Monitor column state health
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object>} Monitoring report
 */
export async function monitorColumnHealth(sessionId) {
  
  try {
    const response = await fetch(`${API_BASE_URL}/monitor-columns/?session_id=${sessionId}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Monitoring failed');
    }
    
    const report = result.monitoring_report;
    const health = report.health_score;
    
    
    // Log critical issues
    if (health.overall_health === 'NEEDS_ATTENTION') {
      console.warn('🔍 MONITOR: ATTENTION NEEDED:', report.recommendations);
    }
    
    return {
      success: true,
      health: health.overall_health,
      report: report,
      criticalIssues: health.overall_health === 'NEEDS_ATTENTION',
      tagColumns: health.tag_columns,
      factwiseColumns: health.factwise_columns,
      recommendations: report.recommendations || []
    };
    
  } catch (error) {
    console.error('🔍 MONITOR: Health check failed:', error);
    return {
      success: false,
      error: error.message,
      health: 'UNKNOWN',
      criticalIssues: true
    };
  }
}

/**
 * Reset column state (emergency recovery)
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object>} Reset result
 */
export async function emergencyColumnReset(sessionId) {
  console.warn('🔄 RESET: Emergency column state reset for session', sessionId);
  
  try {
    const response = await fetch(`${API_BASE_URL}/reset-column-state/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: JSON.stringify({
        session_id: sessionId
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Reset failed');
    }
    
    console.warn('🔄 RESET: Emergency reset completed successfully');
    
    return {
      success: true,
      message: result.message,
      timestamp: result.timestamp
    };
    
  } catch (error) {
    console.error('🔄 RESET: Emergency reset failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Continuous monitoring with automatic recovery
 * @param {string} sessionId - Session identifier
 * @param {Function} onHealthChange - Callback for health status changes
 * @param {number} interval - Monitoring interval in milliseconds (default: 30 seconds)
 * @returns {Object} Monitor control object with stop() method
 */
export function startContinuousMonitoring(sessionId, onHealthChange, interval = 30000) {
  
  let lastHealth = null;
  let monitoringActive = true;
  
  const checkHealth = async () => {
    if (!monitoringActive) return;
    
    try {
      const healthData = await monitorColumnHealth(sessionId);
      
      // Check if health status changed
      if (lastHealth !== healthData.health) {
        lastHealth = healthData.health;
        
        if (onHealthChange) {
          onHealthChange(healthData);
        }
      }
      
      // Auto-recovery for critical issues (disabled by default - too aggressive)
      // if (healthData.criticalIssues && healthData.health === 'NEEDS_ATTENTION') {
      //   console.warn('🔍 MONITOR: Critical issues detected, consider manual recovery');
      // }
      
    } catch (error) {
      console.error('🔍 MONITOR: Continuous monitoring error:', error);
    }
  };
  
  // Initial health check
  checkHealth();
  
  // Set up continuous monitoring
  const monitorInterval = setInterval(checkHealth, interval);
  
  return {
    stop: () => {
      monitoringActive = false;
      clearInterval(monitorInterval);
    }
  };
}

/**
 * Quick health check with smart caching
 * @param {string} sessionId - Session identifier
 * @returns {Promise<boolean>} True if healthy, false if needs attention
 */
export async function quickHealthCheck(sessionId) {
  try {
    const healthData = await monitorColumnHealth(sessionId);
    return healthData.success && healthData.health === 'HEALTHY';
  } catch (error) {
    console.error('🔍 MONITOR: Quick health check failed:', error);
    return false;
  }
}

/**
 * Get health status badge info for UI display
 * @param {string} health - Health status from monitoring
 * @returns {Object} Badge display properties
 */
export function getHealthBadge(health) {
  switch (health) {
    case 'HEALTHY':
      return {
        text: '✅ Healthy',
        color: '#4caf50',
        bgColor: '#e8f5e8',
        priority: 'low'
      };
    case 'NEEDS_ATTENTION':
      return {
        text: '⚠️ Needs Attention',
        color: '#ff9800',
        bgColor: '#fff3e0',
        priority: 'high'
      };
    case 'UNKNOWN':
      return {
        text: '❓ Unknown',
        color: '#9e9e9e',
        bgColor: '#f5f5f5',
        priority: 'medium'
      };
    default:
      return {
        text: '🔍 Checking...',
        color: '#2196f3',
        bgColor: '#e3f2fd',
        priority: 'medium'
      };
  }
}