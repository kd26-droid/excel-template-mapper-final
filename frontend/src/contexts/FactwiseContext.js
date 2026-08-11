import React, { createContext, useContext, useMemo } from 'react';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  apiEnv: 'fw_api_env',
  apiUrl: 'fw_api_url',
  sessionId: 'fw_session_id',
  entityId: 'fw_entity_id',
  embedded: 'fw_embedded',
};

function readInitialContext() {
  const params = new URLSearchParams(window.location.search);

  const embeddedParam = params.get('embedded');
  const isEmbedded =
    embeddedParam === '1' ||
    embeddedParam === 'true' ||
    window.localStorage.getItem(STORAGE_KEYS.embedded) === '1';

  const captured = {
    token: params.get('token'),
    apiEnv: params.get('api_env'),
    apiUrl: params.get('api_url'),
    sessionId: params.get('session_id'),
    entityId: params.get('entity_id'),
  };

  Object.entries(captured).forEach(([key, value]) => {
    if (value !== null && value !== '') {
      window.localStorage.setItem(STORAGE_KEYS[key], value);
    }
  });

  if (isEmbedded) {
    window.localStorage.setItem(STORAGE_KEYS.embedded, '1');
  }

  return {
    isEmbedded,
    token: captured.token || window.localStorage.getItem(STORAGE_KEYS.token),
    apiEnv: captured.apiEnv || window.localStorage.getItem(STORAGE_KEYS.apiEnv),
    apiUrl: captured.apiUrl || window.localStorage.getItem(STORAGE_KEYS.apiUrl),
    sessionId:
      captured.sessionId || window.localStorage.getItem(STORAGE_KEYS.sessionId),
    entityId:
      captured.entityId || window.localStorage.getItem(STORAGE_KEYS.entityId),
  };
}

const FactwiseContext = createContext({
  isEmbedded: false,
  token: null,
  apiEnv: null,
  apiUrl: null,
  sessionId: null,
  entityId: null,
});

export function FactwiseProvider({ children }) {
  const value = useMemo(() => readInitialContext(), []);
  return (
    <FactwiseContext.Provider value={value}>
      {children}
    </FactwiseContext.Provider>
  );
}

export function useFactwise() {
  return useContext(FactwiseContext);
}

export function postToFactwiseParent(type, payload) {
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage({ type, ...payload }, '*');
}
