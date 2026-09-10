import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  FW_SESSION_EXPIRED_EVENT,
  fetchFactwiseEntities,
  FW_TOKEN_REFRESHED_EVENT,
  clearSessionExpired,
  isTokenExpired,
  silentRefreshToken,
} from '../services/factwiseApi';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  refreshToken: 'fw_embedded_refresh_token',
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

// The token deliberately has no say in which entity this is: its `name` claim
// is the signed-in USER (that is how "amaan_test" ended up as the procurement
// entity on exports). Entities come from /organization/entity/ only.
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
  const hasFactwiseLaunchParams = Boolean(
    embeddedParam !== null ||
    params.get('token') ||
    params.get('refresh_token') ||
    params.get('api_url') ||
    params.get('session_id') ||
    params.get('entity_id') ||
    params.get('fw_origin')
  );
  const localStandaloneWithoutLaunch = (
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    !hasFactwiseLaunchParams
  );
  const isEmbedded =
    !localStandaloneWithoutLaunch && (
      embeddedParam === '1' ||
      embeddedParam === 'true' ||
      window.localStorage.getItem(STORAGE_KEYS.embedded) === '1'
    );

  const captured = {
    token: params.get('token'),
    refreshToken: params.get('refresh_token'),
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

  // A launch naming a DIFFERENT entity is a different account (or at least a
  // different filing entity), so nothing derived from the previous launch
  // survives it. Only params the URL actually carries get written below — FW
  // sends entity_id but not always entity_name — so without this the previous
  // account's name outlives its own token and goes on every exported row.
  const previousEntityId = cleanString(window.localStorage.getItem(STORAGE_KEYS.entityId));
  const entityChangedAtLaunch = Boolean(
    cleanString(captured.entityId) && previousEntityId && cleanString(captured.entityId) !== previousEntityId
  );
  if (entityChangedAtLaunch) {
    window.localStorage.removeItem(STORAGE_KEYS.entityName);
  }

  Object.entries(captured).forEach(([key, value]) => {
    if (value !== null && value !== '') {
      window.localStorage.setItem(STORAGE_KEYS[key], value);
    }
  });

  if (isEmbedded) {
    window.localStorage.setItem(STORAGE_KEYS.embedded, '1');
  }

  if (localStandaloneWithoutLaunch) {
    return {
      isEmbedded: false,
      entities: [],
      entityChangedAtLaunch: false,
      token: null,
      refreshToken: null,
      apiEnv: null,
      apiUrl: null,
      sessionId: null,
      entityId: null,
      entityName: null,
      fwOrigin: null,
    };
  }

  return {
    isEmbedded,
    entities: [],
    entityChangedAtLaunch,
    token: captured.token || window.localStorage.getItem(STORAGE_KEYS.token),
    refreshToken:
      captured.refreshToken || window.localStorage.getItem(STORAGE_KEYS.refreshToken),
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
  entities: [],
  entityChangedAtLaunch: false,
  chooseEntity: () => {},
  loadEntities: () => {},
  isEmbedded: false,
  token: null,
  apiEnv: null,
  apiUrl: null,
  sessionId: null,
  entityId: null,
  entityName: null,
  fwOrigin: null,
  sessionExpired: false,
  reconnect: () => {},
});

export function FactwiseProvider({ children }) {
  const [contextValue, setContextValue] = useState(() => readInitialContext());
  const [sessionExpired, setSessionExpired] = useState(() =>
    Boolean(contextValue.token) && isTokenExpired(contextValue.token)
  );

  // Listen for the api layer's expiry signal (fired on 401/403 or on a
  // preflight token check). Once true, the reconnect banner unmounts the
  // rest of the UX until the user re-launches from Factwise.
  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    window.addEventListener(FW_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(FW_SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Poll the JWT `exp` claim so we notice expiry EVEN when the user is
  // idle (no requests fire, so the interceptor never sees a 401). Runs
  // every 30s. When the token is within 5 minutes of expiry AND we have
  // a refresh_token, silently rotate — the user never sees the banner.
  // Only flip the expired flag if the silent refresh fails (or we don't
  // have a refresh_token at all, i.e. an old FW build that didn't pass it).
  const expiredRef = useRef(sessionExpired);
  useEffect(() => { expiredRef.current = sessionExpired; }, [sessionExpired]);
  useEffect(() => {
    if (!contextValue.token) return undefined;
    const tick = async () => {
      if (expiredRef.current) return;
      const token = window.localStorage.getItem(STORAGE_KEYS.token);
      const refreshToken = window.localStorage.getItem(STORAGE_KEYS.refreshToken);
      if (!token) return;
      // Refresh window: token expires within 5 min → rotate now.
      const payload = (() => {
        try {
          const body = String(token).split('.')[1];
          const padded = body.replace(/-/g, '+').replace(/_/g, '/')
            .padEnd(body.length + ((4 - (body.length % 4)) % 4), '=');
          return JSON.parse(window.atob(padded));
        } catch { return null; }
      })();
      const secondsToExpiry = payload?.exp
        ? payload.exp - Math.floor(Date.now() / 1000)
        : Infinity;
      if (secondsToExpiry < 300 && refreshToken) {
        const res = await silentRefreshToken();
        if (!res?.success) setSessionExpired(true);
        return;
      }
      if (isTokenExpired(token)) {
        if (refreshToken) {
          const res = await silentRefreshToken();
          if (!res?.success) setSessionExpired(true);
        } else {
          setSessionExpired(true);
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [contextValue.token]);

  // Whenever silentRefreshToken succeeds, sync the fresh id_token back
  // into React state so consumers observing `token` see the new value on
  // the next render.
  useEffect(() => {
    const onRefreshed = (e) => {
      const newToken = e?.detail?.token;
      if (!newToken) return;
      setContextValue((prev) => ({ ...prev, token: newToken }));
      setSessionExpired(false);
    };
    window.addEventListener(FW_TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(FW_TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  // Open FW in a new tab so the user can re-launch the mapper with a
  // fresh token. We use the fw_origin captured at initial launch — the
  // BOM Directory page is the canonical relaunch point since that's where
  // FW opens the mapper from.
  const reconnect = useCallback(() => {
    const origin = contextValue.fwOrigin
      || window.localStorage.getItem(STORAGE_KEYS.fwOrigin);
    if (origin) {
      window.open(`${origin}/admin/BOM/`, '_blank', 'noopener,noreferrer');
    }
  }, [contextValue.fwOrigin]);

  // The entity list is NOT fetched on load. Only the Settings page needs it —
  // it is the only screen that lets you see or change which entity you are
  // filing under — so it asks for it once when it opens, via loadEntities().
  const entityListLoadedRef = useRef(false);
  const loadEntities = useCallback(async () => {
    if (entityListLoadedRef.current) return;
    entityListLoadedRef.current = true;
    const { entities: list } = await fetchFactwiseEntities();
    if (list.length === 0) {
      // Let a later visit retry: an expired token here is not a permanent no.
      entityListLoadedRef.current = false;
      return;
    }
    setContextValue((prev) => {
      const next = { ...prev, entities: list };
      // The list is the ONLY authority on entity names. A name already in hand
      // is kept only when the list confirms it — otherwise a leftover from an
      // earlier launch or another account (that is how "FactWise" outlived a
      // Syrma-only account) sticks forever and lands on every exported row.
      const storedName = cleanString(prev.entityName);
      const byName = storedName
        ? list.find(entity => entity.name.toLowerCase() === storedName.toLowerCase())
        : null;
      // An entity_id from the launch URL names one of them; a single entity
      // needs no choice. Anything else is left for the user to pick.
      const byId = cleanString(prev.entityId)
        ? list.find(entity => entity.id === cleanString(prev.entityId))
        : null;
      const chosen = byName || byId || (list.length === 1 ? list[0] : null);
      if (!chosen) return next;
      if (chosen.name === prev.entityName && (!chosen.id || chosen.id === prev.entityId)) return next;
      window.localStorage.setItem(STORAGE_KEYS.entityName, chosen.name);
      if (chosen.id) window.localStorage.setItem(STORAGE_KEYS.entityId, chosen.id);
      return { ...next, entityName: chosen.name, entityId: chosen.id || prev.entityId };
    });
  }, []);

  // On load, resolve the name from the entity the launch actually named — no
  // list call. The token is deliberately not consulted: its `name` claim is the
  // signed-in user ("amaan_test"), which silently became the "Procurement
  // entity name" on every export.
  //
  // This runs even when a name is already stored, once per entity_id: a stale
  // browser copy from an earlier launch would otherwise win over the entity in
  // force and be exported on every row. It cannot fight a user's own pick —
  // chooseEntity() writes the id alongside the name, so the lookup returns the
  // very entity they picked.
  const entityIdCheckedRef = useRef('');
  useEffect(() => {
    const entityId = cleanString(contextValue.entityId);
    if (!contextValue.token || !entityId) return undefined;
    if (entityIdCheckedRef.current === entityId) return undefined;
    entityIdCheckedRef.current = entityId;

    let cancelled = false;
    (async () => {
      const fromApi = await fetchEntityNameFromFactwise(contextValue);
      if (cancelled) return;
      if (!fromApi) {
        entityIdCheckedRef.current = '';
        return;
      }
      window.localStorage.setItem(STORAGE_KEYS.entityName, fromApi);
      setContextValue(prev => (prev.entityName === fromApi ? prev : { ...prev, entityName: fromApi }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextValue.token, contextValue.entityId]);

  // Cross-tab reconnect: if the user re-launches the mapper in another
  // tab, that tab writes a fresh token to localStorage → this tab picks
  // it up via the storage event and clears the expired flag.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEYS.token || !e.newValue) return;
      if (isTokenExpired(e.newValue)) return;
      clearSessionExpired();
      setContextValue((prev) => ({ ...prev, token: e.newValue }));
      setSessionExpired(false);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const chooseEntity = useCallback((entity) => {
    const name = cleanString(entity?.name || entity);
    if (!name) return;
    const id = cleanString(entity?.id);
    window.localStorage.setItem(STORAGE_KEYS.entityName, name);
    // An id-less pick has to drop the old id too, or the id lookup above would
    // resolve the entity they just moved away from and undo the choice.
    if (id) window.localStorage.setItem(STORAGE_KEYS.entityId, id);
    else window.localStorage.removeItem(STORAGE_KEYS.entityId);
    setContextValue(prev => ({ ...prev, entityName: name, entityId: id }));
  }, []);

  const value = useMemo(
    () => ({ ...contextValue, sessionExpired, reconnect, chooseEntity, loadEntities }),
    [contextValue, sessionExpired, reconnect, chooseEntity, loadEntities]
  );
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
