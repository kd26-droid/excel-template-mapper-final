import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  apiEnv: 'fw_api_env',
  apiUrl: 'fw_api_url',
  sessionId: 'fw_session_id',
  entityId: 'fw_entity_id',
  entityName: 'fw_entity_name',
  fwOrigin: 'fw_origin',
  embedded: 'fw_embedded',
};

const firstParam = (params, names) => {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value !== '') return value;
  }
  return null;
};

const cleanString = (value) => String(value || '').trim();

const decodeJwtPayload = (token) => {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(window.atob(padded));
  } catch (_) {
    return null;
  }
};

const nameFromObject = (obj) => (
  cleanString(obj?.entity_name)
  || cleanString(obj?.entityName)
  || cleanString(obj?.buyer_entity_name)
  || cleanString(obj?.buyerEntityName)
  || cleanString(obj?.company_name)
  || cleanString(obj?.companyName)
  || cleanString(obj?.organization_name)
  || cleanString(obj?.organizationName)
  || cleanString(obj?.legal_name)
  || cleanString(obj?.display_name)
  || cleanString(obj?.name)
);

const findEntityNameInToken = (token, entityId) => {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== 'object') return '';

  const direct = nameFromObject(payload);
  if (direct && !cleanString(payload?.user_id || payload?.email)) return direct;

  const targetId = cleanString(entityId);
  const visited = new Set();
  const stack = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    const currentId = cleanString(
      current.entity_id
      || current.entityId
      || current.buyer_entity_id
      || current.buyerEntityId
      || current.id
    );
    const candidateName = nameFromObject(current);
    if (candidateName && (!targetId || currentId === targetId)) {
      return candidateName;
    }

    Object.values(current).forEach((value) => {
      if (value && typeof value === 'object') stack.push(value);
    });
  }
  return '';
};

const fetchEntityNameFromFactwise = async ({ apiUrl, token, entityId }) => {
  const base = cleanString(apiUrl).replace(/\/+$/, '');
  const id = cleanString(entityId);
  if (!base || !token || !id) return '';

  const endpoints = [
    `/organization/entity/${encodeURIComponent(id)}/`,
    `/organization/entities/${encodeURIComponent(id)}/`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const candidate = nameFromObject(data?.data || data?.entity || data);
      if (candidate) return candidate;
    } catch (_) {
      // Try the next known entity endpoint shape.
    }
  }
  return '';
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
    entityName: firstParam(params, [
      'entity_name',
      'entityName',
      'procurement_entity_name',
      'procurementEntityName',
      'buyer_entity_name',
      'buyerEntityName',
      'company_name',
      'organization_name',
    ]),
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
    entityName:
      captured.entityName || window.localStorage.getItem(STORAGE_KEYS.entityName),
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
  entityName: null,
  fwOrigin: null,
});

export function FactwiseProvider({ children }) {
  const [contextValue, setContextValue] = useState(() => readInitialContext());

  useEffect(() => {
    if (cleanString(contextValue.entityName)) return undefined;

    let cancelled = false;
    const resolveEntityName = async () => {
      const fromToken = findEntityNameInToken(contextValue.token, contextValue.entityId);
      if (fromToken) {
        window.localStorage.setItem(STORAGE_KEYS.entityName, fromToken);
        if (!cancelled) setContextValue(prev => ({ ...prev, entityName: fromToken }));
        return;
      }

      const fromApi = await fetchEntityNameFromFactwise(contextValue);
      if (fromApi) {
        window.localStorage.setItem(STORAGE_KEYS.entityName, fromApi);
        if (!cancelled) setContextValue(prev => ({ ...prev, entityName: fromApi }));
      }
    };

    resolveEntityName();
    return () => {
      cancelled = true;
    };
  }, [contextValue]);

  const value = useMemo(() => contextValue, [contextValue]);
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
