import { useCallback, useEffect, useState } from 'react';
import { useFactwise } from '../contexts/FactwiseContext';
import {
  fetchDistributorStatus,
  isFactwiseSessionAvailable,
} from '../services/factwiseApi';

const EMPTY_STATE = {
  loading: false,
  error: null,
  distributors: [],
};

function normalize(distributors = []) {
  return distributors.reduce((acc, entry) => {
    if (entry?.distributor) {
      acc[entry.distributor.toUpperCase()] = entry;
    }
    return acc;
  }, {});
}

export function useFactwiseDistributors() {
  const { isEmbedded, entityId } = useFactwise();
  const [state, setState] = useState(EMPTY_STATE);

  const load = useCallback(async () => {
    if (!isEmbedded || !isFactwiseSessionAvailable() || !entityId) {
      setState(EMPTY_STATE);
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchDistributorStatus();
    if (result?.success) {
      setState({
        loading: false,
        error: null,
        distributors: result.distributors || [],
      });
    } else {
      setState({
        loading: false,
        error: result?.error || 'Failed to load Factwise distributor status',
        distributors: [],
      });
    }
  }, [isEmbedded, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    ...state,
    reload: load,
    byDistributor: normalize(state.distributors),
    isEmbedded,
  };
}
