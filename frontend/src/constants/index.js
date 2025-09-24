/**
 * Application constants and configuration
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: '/api',
  TIMEOUT: 30000, // 30 seconds
  MAX_RETRIES: 3
};

// File Upload Configuration
export const FILE_CONFIG = {
  MAX_SIZE_MB: 25,
  ALLOWED_TYPES: {
    EXCEL: ['.xlsx', '.xls'],
    CSV: ['.csv']
  },
  MIME_TYPES: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv'
  ]
};

// UI Constants
export const UI_CONFIG = {
  DEBOUNCE_DELAY: 300,
  ANIMATION_DURATION: 200,
  TOAST_DURATION: 5000,
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    SIZE_OPTIONS: [10, 20, 50, 100]
  }
};

// Mapping Constants
export const MAPPING_CONFIG = {
  MIN_CONFIDENCE_THRESHOLD: 40,
  HIGH_CONFIDENCE_THRESHOLD: 80,
  BATCH_SIZE: 100
};

// Session Constants
export const SESSION_CONFIG = {
  TIMEOUT_MINUTES: 60,
  WARNING_MINUTES: 55,
  PING_INTERVAL: 300000 // 5 minutes
};

// Export file naming
export const EXPORT_CONFIG = {
  DEFAULT_FILENAME: 'export_data',
  DATE_FORMAT: 'YYYY-MM-DD_HH-mm-ss'
};

// Error messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection and try again.',
  FILE_TOO_LARGE: `File size exceeds ${FILE_CONFIG.MAX_SIZE_MB}MB limit.`,
  INVALID_FILE_TYPE: 'Invalid file type. Please upload Excel (.xlsx, .xls) or CSV files only.',
  UPLOAD_FAILED: 'File upload failed. Please try again.',
  SESSION_EXPIRED: 'Your session has expired. Please refresh the page.',
  MAPPING_FAILED: 'Column mapping failed. Please try again.',
  SAVE_FAILED: 'Failed to save data. Please try again.',
  GENERIC_ERROR: 'An unexpected error occurred. Please try again.'
};

// Success messages
export const SUCCESS_MESSAGES = {
  UPLOAD_SUCCESS: 'Files uploaded successfully!',
  MAPPING_SAVED: 'Column mappings saved successfully!',
  DATA_SAVED: 'Data saved successfully!',
  EXPORT_SUCCESS: 'Data exported successfully!',
  TEMPLATE_SAVED: 'Template saved successfully!',
  TEMPLATE_APPLIED: 'Template applied successfully!'
};

// Status constants
export const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
};

// Theme colors
export const COLORS = {
  PRIMARY: '#1976d2',
  SECONDARY: '#dc004e',
  SUCCESS: '#4caf50',
  WARNING: '#ff9800',
  ERROR: '#f44336',
  INFO: '#2196f3'
};

// Responsive breakpoints
export const BREAKPOINTS = {
  XS: 0,
  SM: 600,
  MD: 960,
  LG: 1280,
  XL: 1920
};