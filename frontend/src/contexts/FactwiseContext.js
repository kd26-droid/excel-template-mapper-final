import React, { createContext, useContext, useMemo } from 'react';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  apiEnv: 'fw_api_env',
  apiUrl: 'fw_api_url',
  sessionId: 'fw_session_id',
  entityId: 'fw_entity_id',
  fwOrigin: 'fw_origin',
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
    fwOrigin: params.get('fw_origin'),
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
    fwOrigin:
      captured.fwOrigin || window.localStorage.getItem(STORAGE_KEYS.fwOrigin),
  };
}

const FactwiseContext = createContext({
  isEmbedded: false,
  token: null,
  apiEnv: null,
  apiUrl: null,
  sessionId: null,
  entityId: null,
  fwOrigin: null,
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

// Open a Factwise route from the mapper. Works in both worlds:
//   - Iframe:  postMessage a NAVIGATE to the parent so FW navigates in-place.
//   - New tab: use the fw_origin captured at launch time to open a fresh FW
//              browser tab (mapper stays on screen).
// Falls back to same-tab navigation if fw_origin is missing.
export function openInFactwise(path) {
  const inIframe = window.parent && window.parent !== window;
  if (inIframe) {
    postToFactwiseParent('NAVIGATE', { url: path });
    return;
  }
  const origin = window.localStorage.getItem('fw_origin');
  if (origin) {
    window.open(origin + path, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.href = path;
}
