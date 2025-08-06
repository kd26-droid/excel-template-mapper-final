/**
 * Custom hook for API operations with error handling and loading states
 */

import { useState, useCallback } from 'react';
import { ERROR_MESSAGES, STATUS } from '../constants';

export const useApi = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const execute = useCallback(async (apiCall, options = {}) => {
    const { 
      onSuccess, 
      onError, 
      showLoading = true,
      resetData = true 
    } = options;

    try {
      if (showLoading) setLoading(true);
      if (resetData) setData(null);
      setError(null);

      const result = await apiCall();
      
      setData(result.data);
      
      if (onSuccess) {
        onSuccess(result.data);
      }
      
      return result.data;
    } catch (err) {
      console.error('API Error:', err);
      
      let errorMessage = ERROR_MESSAGES.GENERIC_ERROR;
      
      if (err.response) {
        // Server responded with error
        errorMessage = err.response.data?.message || 
                      err.response.data?.error || 
                      `Server error: ${err.response.status}`;
      } else if (err.request) {
        // Network error
        errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
      } else {
        // Other error
        errorMessage = err.message || ERROR_MESSAGES.GENERIC_ERROR;
      }
      
      setError(errorMessage);
      
      if (onError) {
        onError(errorMessage, err);
      }
      
      throw err;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  return {
    loading,
    error,
    data,
    execute,
    reset,
    status: loading ? STATUS.LOADING : error ? STATUS.ERROR : data ? STATUS.SUCCESS : STATUS.IDLE
  };
};

export default useApi;