import { useEffect } from 'react';
import { useFactwise } from '../contexts/FactwiseContext';
import { fetchDistributorCredentials } from '../services/factwiseApi';
import api from '../services/api';

const CREDENTIAL_SCOPE_KEY = 'mpn_provider_credential_scope_id';
const SYNC_SENTINEL_KEY = 'fw_creds_synced_at';
const SYNC_TTL_MS = 5 * 60 * 1000;

function getScopeId() {
  if (typeof window === 'undefined') return 'default';
  const existing = window.localStorage.getItem(CREDENTIAL_SCOPE_KEY);
  if (existing) return existing;
  const generated =
    window.crypto?.randomUUID?.() ||
    `scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(CREDENTIAL_SCOPE_KEY, generated);
  return generated;
}

function shouldSync() {
  const raw = window.sessionStorage.getItem(SYNC_SENTINEL_KEY);
  if (!raw) return true;
  const ts = Number.parseInt(raw, 10);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > SYNC_TTL_MS;
}

function markSynced() {
  window.sessionStorage.setItem(SYNC_SENTINEL_KEY, String(Date.now()));
}

// Maps Factwise's decrypted-credentials response shape into BOM Mapper's
// bulk-save payload. Returns null when there's nothing worth POSTing.
function toBomMapperPayload(fwCredentials) {
  const providers = {};
  const digikey = fwCredentials?.DIGIKEY;
  if (digikey?.client_id && digikey?.client_secret) {
    providers.digikey = {
      client_id: digikey.client_id,
      client_secret: digikey.client_secret,
    };
  }
  const mouser = fwCredentials?.MOUSER;
  if (mouser?.api_key) {
    providers.mouser = { api_key: mouser.api_key };
  }
  const element14 = fwCredentials?.ELEMENT14;
  if (element14?.api_key) {
    providers.element14 = { api_key: element14.api_key };
  }
  return Object.keys(providers).length ? providers : null;
}

export function useSyncFactwiseCredentials() {
  const { isEmbedded, entityId, token } = useFactwise();

  useEffect(() => {
    if (!isEmbedded || !entityId || !token) return;
    if (!shouldSync()) return;

    let cancelled = false;
    (async () => {
      const response = await fetchDistributorCredentials();
      if (cancelled) return;
      if (!response?.success) return;
      const providers = toBomMapperPayload(response.credentials);
      if (!providers) return;
      try {
        await api.saveProviderCredentials(getScopeId(), providers);
        markSynced();
      } catch (error) {
        // Silent — worst case user still sees the tool's own state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEmbedded, entityId, token]);
}
