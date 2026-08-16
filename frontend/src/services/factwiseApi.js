import axios from 'axios';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  refreshToken: 'fw_embedded_refresh_token',
  apiUrl: 'fw_api_url',
  entityId: 'fw_entity_id',
};

// Custom DOM event fired the first time a FactWise request fails with an
// expired-token symptom (401/403 from FW's API Management, or JWT `exp`
// already in the past). Consumers (FactwiseContext, the session-expired
// banner) listen for it and show the reconnect UX. Fired at most once per
// session — see markSessionExpired below.
export const FW_SESSION_EXPIRED_EVENT = 'fw:session-expired';
let sessionExpiredEmitted = false;
export function markSessionExpired(reason = 'unknown') {
  if (sessionExpiredEmitted) return;
  sessionExpiredEmitted = true;
  try {
    window.dispatchEvent(
      new CustomEvent(FW_SESSION_EXPIRED_EVENT, { detail: { reason } })
    );
  } catch { /* best-effort */ }
}
// Reset the guard so a fresh token (after reconnect) can flag expiry again.
export function clearSessionExpired() {
  sessionExpiredEmitted = false;
}

// Decode a JWT payload safely — returns null on any parse error.
function decodeJwtPayload(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

// True when the token's `exp` claim is already past (or missing).
// A 30-second skew guard prevents a token that expires mid-request from
// slipping through — treat it as expired ~30s early so we don't fire off
// a doomed call that comes back CORS'd.
export function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSec + 30;
}

function readCredentials() {
  return {
    token: window.localStorage.getItem(STORAGE_KEYS.token),
    refreshToken: window.localStorage.getItem(STORAGE_KEYS.refreshToken),
    apiUrl: window.localStorage.getItem(STORAGE_KEYS.apiUrl),
    entityId: window.localStorage.getItem(STORAGE_KEYS.entityId),
  };
}

// Custom event fired whenever we successfully rotate the id_token silently.
// FactwiseContext listens for this to update its state (and mirror the new
// token into React), and to reset its expiry-tracker interval.
export const FW_TOKEN_REFRESHED_EVENT = 'fw:token-refreshed';

// Silent refresh via FactWise's own /authentication/refresh/ endpoint — the
// SAME endpoint FW's SPA uses (see Contexts/helperFunctions.ts::refreshAccessToken).
// FW's launch URL now passes both id_token AND refresh_token so the mapper
// can rotate the id_token every ~55min without any user interaction.
//
// Only ONE refresh flight in flight at a time — callers await the shared
// promise so concurrent requests don't burn through refresh_tokens or race
// with each other's writes.
let refreshInFlight = null;
export async function silentRefreshToken() {
  if (refreshInFlight) return refreshInFlight;
  const { token, refreshToken, apiUrl } = readCredentials();
  if (!token || !refreshToken || !apiUrl) {
    return { success: false, error: 'missing token/refresh_token/api_url' };
  }
  refreshInFlight = (async () => {
    try {
      // Use a plain axios call — NOT buildClient — because buildClient's
      // pre-flight isTokenExpired check would loop back into a refresh.
      const url = `${apiUrl.replace(/\/+$/, '')}/authentication/refresh/`;
      const { data } = await axios.post(
        url,
        { id_token: token, refresh_token: refreshToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      const newIdToken = data?.id_token;
      const newRefreshToken = data?.refresh_token || refreshToken;
      if (!newIdToken) {
        return { success: false, error: 'no id_token in refresh response' };
      }
      window.localStorage.setItem(STORAGE_KEYS.token, newIdToken);
      if (newRefreshToken !== refreshToken) {
        window.localStorage.setItem(STORAGE_KEYS.refreshToken, newRefreshToken);
      }
      // Clear any prior expiry flag so the banner tears down.
      clearSessionExpired();
      try {
        window.dispatchEvent(
          new CustomEvent(FW_TOKEN_REFRESHED_EVENT, {
            detail: { token: newIdToken, refreshToken: newRefreshToken },
          })
        );
      } catch { /* best-effort */ }
      return { success: true, token: newIdToken };
    } catch (error) {
      const status = error?.response?.status;
      // 401 on the refresh endpoint means the refresh_token itself has
      // expired (~14 days idle) — user must actually re-launch from FW.
      // Flag the session as expired so the reconnect banner shows.
      if (status === 401 || status === 403) {
        markSessionExpired('refresh-token-expired');
      }
      return {
        success: false,
        error: error?.response?.data?.error || error?.message || 'refresh failed',
      };
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function buildClient() {
  const { token, refreshToken, apiUrl } = readCredentials();
  if (!token || !apiUrl) return null;
  // Proactive: don't even try FW when the token has clearly expired — the
  // request would return a 401 wrapped in a CORS failure (FactWise's
  // Azure API Management strips CORS headers off error responses) which
  // shows up in the console as a confusing "No Access-Control-Allow-Origin"
  // instead of a clean "session expired". When we HAVE a refresh_token
  // we can fire off a silent refresh in the background (callers get null
  // for this attempt but the next call sees the fresh token); without one
  // the only option is the Reconnect banner.
  if (isTokenExpired(token)) {
    if (refreshToken) {
      // Kick off silent refresh — we don't await here so this call still
      // fails fast, but the very next call (or the caller's retry) will
      // use the new token. Also arms the FactwiseContext scheduler for the
      // next refresh cycle via the FW_TOKEN_REFRESHED_EVENT.
      silentRefreshToken();
    } else {
      markSessionExpired('token-expired-no-refresh');
    }
    return null;
  }

  const client = axios.create({
    baseURL: apiUrl.replace(/\/+$/, ''),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  // Reactive: any 401/403 or CORS-flavoured network error is treated as an
  // expired session. FW's APIM returns 401 for expired JWTs; browsers see
  // the missing CORS headers and surface it as ERR_FAILED / message
  // "Network Error" rather than a status. We can't distinguish reliably
  // from the error object, so treat anything that isn't a normal HTTP
  // response as expired when the token would have been ~1h old.
  client.interceptors.response.use(
    (r) => r,
    async (error) => {
      const status = error?.response?.status;
      const looksLikeExpiry =
        status === 401
        || status === 403
        || (!error?.response && error?.message === 'Network Error');

      // Silent-recovery: if we have a refresh_token and this looks like
      // expiry AND we haven't already retried this specific config, rotate
      // the id_token and REPLAY the original request under the new token.
      // The user sees a brief spinner, not a broken UI.
      const cfg = error?.config;
      if (looksLikeExpiry && cfg && !cfg.__fwRetryDone) {
        const { refreshToken: rt } = readCredentials();
        if (rt) {
          const refreshed = await silentRefreshToken();
          if (refreshed?.success) {
            cfg.__fwRetryDone = true;
            cfg.headers = {
              ...(cfg.headers || {}),
              Authorization: `Bearer ${refreshed.token}`,
            };
            return axios.request(cfg);
          }
        }
      }

      if (status === 401 || status === 403) {
        markSessionExpired(`http-${status}`);
      } else if (!error?.response && error?.message === 'Network Error') {
        const { token: tok } = readCredentials();
        const payload = decodeJwtPayload(tok);
        if (payload?.exp && (payload.exp - Math.floor(Date.now() / 1000)) < 60) {
          markSessionExpired('cors-likely-expired');
        }
      }
      return Promise.reject(error);
    }
  );
  return client;
}

export function isFactwiseSessionAvailable() {
  const { token, apiUrl } = readCredentials();
  return Boolean(token && apiUrl && !isTokenExpired(token));
}

// Look up existing Factwise tags that are similar (by name) to the ones the
// mapper is about to introduce. Powers the "mark as synonym vs create new"
// dropdown per tag in the NewTagsConfirmationPopup.
// Response shape (from FactWise): { [tagName]: [{ tag_id, name, synonyms, ... }] }
export async function fetchSimilarTags(tags = []) {
  const client = buildClient();
  if (!client || !Array.isArray(tags) || !tags.length) {
    return { success: false, similar: {} };
  }
  try {
    const { data } = await client.post(`/organization/tags/similar/`, {
      tag_type: 'ITEM',
      similar_to: tags,
    });
    return { success: true, similar: data || {} };
  } catch (error) {
    return {
      success: false,
      similar: {},
      error: error?.response?.data?.error || error?.message || 'Similar-tags lookup failed',
    };
  }
}

// Search FactWise's full tag list (paginated). Used by the "Mark as
// synonym" autocomplete in the New Tags popup so users can pick ANY
// existing tag as the synonym target — not just tags returned by the
// suggestion API (which only returns tags with a name similarity match).
// Ports FactWise admin's `useListTagsViaDashboardMutation` — POST /dashboard/
// with dashboard_view='tags', query_data.tag_type='ITEM'.
export async function listAllItemTags({ searchText = '', pageNumber = 1, itemsPerPage = 10 } = {}) {
  const client = buildClient();
  if (!client) return { success: false, tags: [], hasNext: false };
  try {
    const { data } = await client.post(`/dashboard/`, {
      dashboard_view: 'tags',
      tab: 'all',
      search_text: searchText,
      sort_fields: [],
      page_number: pageNumber,
      items_per_page: itemsPerPage,
      query_data: { tag_type: 'ITEM' },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    return {
      success: true,
      tags: rows,
      hasNext: Boolean(data?.metadata?.has_next),
      totalPages: data?.metadata?.total_pages || 1,
    };
  } catch (error) {
    return {
      success: false,
      tags: [],
      hasNext: false,
      error: error?.response?.data?.error || error?.message || 'Tag search failed',
    };
  }
}

// Every entity the signed-in account can act for. One entity is the normal
// case and needs no choice; more than one has to be asked about, because
// "Procurement entity name" ends up on every exported row and FactWise rejects
// a name that is not one of these.
//
// Note the token cannot answer this: its `name` claim is the signed-in USER.
export async function fetchFactwiseEntities() {
  const client = buildClient();
  if (!client) return { success: false, entities: [] };
  try {
    const { data } = await client.get('/organization/entity/');
    const rows = Array.isArray(data) ? data : (data?.results || data?.data || []);
    const entities = rows
      .map(row => ({
        id: String(row?.entity_id || row?.entityId || row?.id || '').trim(),
        name: String(row?.entity_name || row?.entityName || row?.name || '').trim(),
      }))
      .filter(entity => entity.name);
    return { success: true, entities };
  } catch (error) {
    return { success: false, entities: [], error: error?.response?.data?.error || error.message };
  }
}

export async function fetchDistributorStatus() {
  const client = buildClient();
  const { entityId } = readCredentials();
  if (!client || !entityId) {
    return { success: false, distributors: [] };
  }
  try {
    const { data } = await client.get(
      `/organization/entity/${entityId}/integrations/distributors/`
    );
    return data;
  } catch (error) {
    return {
      success: false,
      distributors: [],
      error: error?.response?.data?.error || error.message,
    };
  }
}

// Uploads a File to Factwise's bulk-import pipeline (steps 1 & 2 of the 3-step
// flow: get a pre-signed Azure Blob URL, then PUT the file to it). We STOP
// before the process/validate step — Factwise itself runs that when the parent
// route mounts BulkImportPage with the returned bulk_import_id.
//
// resourceType examples: 'ITEM', 'BOM', 'VENDOR' (see IFileResourceType in FW).
// Returns { success, bulk_import_id, file_name } on success.
export async function uploadFileToFactwiseBulkImport(file, resourceType) {
  const { token, apiUrl } = readCredentials();
  if (!token || !apiUrl) {
    return { success: false, error: 'No Factwise session' };
  }
  const base = apiUrl.replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${token}` };
  try {
    // Step 1: get pre-signed Azure Blob URL + bulk_import_id
    const generateResp = await axios.post(
      `${base}/organization/bulk_import/url/generate/`,
      { file_name: file.name, resource_type: resourceType },
      { headers: { ...authHeaders, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const { bulk_import_id, url, fields } = generateResp.data;
    if (!bulk_import_id || !url) {
      return { success: false, error: 'Factwise did not return an upload URL' };
    }
    // The stable blob path the file landed on. The SAS `url` is deliberately
    // not returned: it is write-only (sp=w) and expires within the hour, so it
    // cannot read the sheet back and is worthless to anyone downstream.
    // bulk_import_id is the handle that matters — it is what process/ takes.
    const blobKey = fields?.key || '';

    // Step 2: PUT raw file bytes to the Azure Blob SAS URL
    // (Same headers Factwise's own uploadFileToGeneratedUrl uses)
    await axios.put(url, file, {
      headers: { 'x-ms-blob-type': 'BlockBlob' },
      timeout: 120000,
    });

    return { success: true, bulk_import_id, file_name: file.name, blob_key: blobKey };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Upload failed',
    };
  }
}

// Step 3 of Factwise's bulk-import: process/validate/save a file that's already
// been uploaded to Azure Blob (steps 1+2 already ran via uploadFileToFactwiseBulkImport).
// Returns the raw Factwise response: { response: { response_type, error, created_identifiers,
// updated_identifiers, bom_ids, export_id, is_async, ... } }.
// response_type = 'Success' | 'DataError' | 'DynamicError' | others.
export async function processFactwiseBulkImport(bulkImportId, additionalInformation) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.post(
      `/organization/bulk_import/process/`,
      {
        bulk_import_id: bulkImportId,
        additional_information: additionalInformation || {},
      },
      { timeout: 300000 }
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Process failed',
    };
  }
}

// Fetches the status of a running/completed bulk import (used for async imports).
export async function getBulkImportStatus(bulkImportId) {
  const client = buildClient();
  if (!client) return { success: false };
  try {
    const { data } = await client.get(
      `/organization/bulk_import/${bulkImportId}/status/`
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Status check failed',
    };
  }
}

// Returns a pre-signed download URL for the error file Factwise generates when
// a bulk import fails validation. Caller then GETs the URL to fetch the Excel.
export async function getBulkImportErrorFileUrl(bulkImportId) {
  const client = buildClient();
  if (!client) return { success: false };
  try {
    const { data } = await client.post(
      `/organization/bulk_import/url/generate/download/`,
      { bulk_import_id: bulkImportId }
    );
    return { success: true, url: data?.url || data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Error-file URL failed',
    };
  }
}

// Build the custom_sections array FW's create_project endpoint expects.
// FW's server iterates the caller's `custom_sections` and creates one
// project_custom_section row per entry — if we send [], the project ends
// up with NO custom_sections at all, breaking downstream Submit calls
// which need a valid custom_section_id.
//
// The template response's raw shape is `section_list: [{name, alternate_name,
// section_type, parent_sub_section, ...}]`. Each entry becomes a project
// custom_section. FW's own createProjectApi flow eventually walks this same
// list to build the payload; we do it directly.
//
// section_type in the template uses backend enum names (BOM_TERMS,
// ITEM_TERMS, ...). FW's project schema uses BOM/ITEM/OTHER for
// custom_sections.section_type — map accordingly.
function buildProjectCustomSectionsFromTemplate(template) {
  const list = Array.isArray(template?.section_list) ? template.section_list : [];
  if (!list.length) return [];
  const out = [];
  const nowIso = new Date().toISOString();
  const mapSectionType = (raw) => {
    const s = String(raw || '').toUpperCase();
    if (s.includes('BOM')) return 'BOM';
    if (s.includes('ITEM')) return 'ITEM';
    return 'OTHER';
  };
  const seenNames = new Set();
  for (const section of list) {
    if (!section || typeof section !== 'object') continue;
    // Prefer alternate_name (the user-facing label) over name (the backend
    // key). FW's project custom_sections are keyed on this exact string —
    // it's what shows in the UI and what BOM Submit looks up.
    const label = String(section.alternate_name || section.name || '').trim();
    if (!label) continue;
    if (seenNames.has(label)) continue;
    seenNames.add(label);
    out.push({
      name: label,
      status: 'DRAFT',
      section_type: mapSectionType(section.section_type),
      created_datetime: null,
      custom_section_id: null,
      custom_fields: [],
      assigned_users: [],
      last_modified_time: nowIso,
      start_time: null,
      submission_time: null,
      target_duration: null,
      target_duration_period: null,
      rejectable_custom_sections: [],
    });
  }
  return out;
}

// Creates a new Factwise project. Requires template_id (a project template UUID)
// and buyer_entity_id. Returns { success, project_id, ... }.
//
// Critical: we MUST post `custom_sections` derived from the project template.
// FW's create_project loop at services/project_service.py:360 only creates
// project_custom_section rows for entries in OUR payload — sending an empty
// list means the project has no BOM/ITEM/OTHER sections, and FW's UI later
// can't find the BOM_TERMS section to Submit against ("custom_section_id:
// Must be a valid UUID" from the state PUT endpoint).
export async function createFactwiseProject(payload) {
  const client = buildClient();
  const { entityId } = readCredentials();
  if (!client || !entityId) return { success: false, error: 'No Factwise session' };
  try {
    // Fetch the project template first so we can populate custom_sections
    // exactly like FW UI does (matches buildCustomSectionsForCreate in
    // ProjectGlCostCenter/hooks/useProjectCreationHook.ts).
    let customSections = Array.isArray(payload?.custom_sections)
      ? payload.custom_sections
      : [];
    if (!customSections.length && payload?.template_id) {
      try {
        const tplUrl = `/module_templates/${entityId}/${payload.template_id}/`;
        // eslint-disable-next-line no-console
        console.warn('[FW] fetching template for custom_sections:', tplUrl);
        const tplResp = await client.get(tplUrl);
        // eslint-disable-next-line no-console
        console.warn('[FW] template response keys:', Object.keys(tplResp?.data || {}));
        // eslint-disable-next-line no-console
        console.warn('[FW] template section_list:', tplResp?.data?.section_list);
        // eslint-disable-next-line no-console
        console.warn('[FW] template items sample:', (tplResp?.data?.items || []).slice(0, 3));
        // eslint-disable-next-line no-console
        console.warn('[FW] template items count:', (tplResp?.data?.items || []).length);
        customSections = buildProjectCustomSectionsFromTemplate(tplResp?.data);
        // eslint-disable-next-line no-console
        console.warn('[FW] built custom_sections:', customSections);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[FW] template fetch failed:', err?.response?.status, err?.message);
      }
    } else if (customSections.length) {
      // eslint-disable-next-line no-console
      console.warn('[FW] using caller-supplied custom_sections:', customSections.length);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[FW] no template_id in payload, skipping custom_sections build');
    }
    const { data } = await client.post(
      `/organization/project/create/`,
      {
        buyer_entity_id: entityId,
        ...payload,
        custom_sections: customSections,
      }
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Project create failed',
    };
  }
}

// Fetches project templates for this enterprise, using the same endpoint
// FactWise's own Project Dashboard uses when the user clicks "Create Project".
// Response shape: [{ type, count, templates: [ {template_id, name, is_default, status, ...} ] }]
export async function fetchModuleTemplates(templateType = 'PROJECT') {
  const client = buildClient();
  if (!client) return { success: false, templates: [] };
  try {
    const { data } = await client.get(
      `/module_templates/full/?template_type=${encodeURIComponent(templateType)}`
    );
    const groups = Array.isArray(data) ? data : [];
    const templates = groups.flatMap((g) => (Array.isArray(g?.templates) ? g.templates : []));
    // Match FactWise's own filter — only offer templates that are still active.
    const active = templates.filter(
      (t) => !t.status || t.status === 'ONGOING'
    );
    return { success: true, templates: active };
  } catch (error) {
    return {
      success: false,
      templates: [],
      error: error?.response?.data?.error || error?.message || 'Template list failed',
    };
  }
}

// Server-side paginated project search — the same POST /dashboard/ endpoint
// FactWise's own FWAutocompleteForProject uses. Cheap under a big project
// count because we page + search on the server. Response shape matches FW's:
// { data: [{ project_id, project_code, project_name, ... }], metadata, counts }.
export async function fetchProjects({
  searchText = '',
  pageNumber = 1,
  itemsPerPage = 15,
  tab = 'all',
} = {}) {
  const client = buildClient();
  if (!client) return { success: false, projects: [], metadata: null };
  try {
    const { data } = await client.post(`/dashboard/`, {
      dashboard_view: 'project',
      tab,
      search_text: searchText,
      sort_fields: [],
      page_number: pageNumber,
      items_per_page: itemsPerPage,
      query_data: {},
      filters: null,
    });
    return {
      success: true,
      projects: data?.data || [],
      metadata: data?.metadata || null,
    };
  } catch (error) {
    return {
      success: false,
      projects: [],
      metadata: null,
      error: error?.response?.data?.error || error?.message || 'Project search failed',
    };
  }
}

// Fetches enterprise BOM codes so we can detect whether the mapper's BOM
// already exists (→ trigger a revision instead of creating a duplicate).
//
// Response items are { enterprise_bom_id, bom_code, base_bom_id, version } —
// ONE ROW PER REVISION, so this is a list of revisions, not of BOMs. Collapse
// by base_bom_id (see collapseBomRevisions) when the caller wants BOMs.
export async function fetchEnterpriseBomCodes() {
  const client = buildClient();
  if (!client) return { success: false, boms: [] };
  try {
    const { data } = await client.get(`/organization/bom/admin/codes/`);
    const boms = Array.isArray(data) ? data : (data?.results || []);
    return { success: true, boms };
  } catch (error) {
    return {
      success: false,
      boms: [],
      error: error?.response?.data?.error || error?.message || 'BOM code list failed',
    };
  }
}

// Publishes a DRAFT enterprise BOM by transitioning bom_status to ONGOING.
// Required after a fresh bulk-import create (BOM_DASHBOARD) or revision
// upload — DRAFT BOMs don't populate the project's Add Item tab correctly
// and can't be revised again until submitted. Uses the exact same endpoint
// FactWise's admin BOM edit page uses when you click "Submit".
export async function submitEnterpriseBom(enterpriseBomId) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    await client.patch(
      `/organization/bom/admin/${enterpriseBomId}/status/`,
      { bom_status: 'ONGOING' }
    );
    return { success: true };
  } catch (error) {
    // FW answers a transition its state machine disallows with
    // { ErrorCode: 'INVALID BOM STATUS', Cause: [...] } and no `error` key, so
    // without ErrorCode the caller only ever sees axios' "status code 400".
    const errorCode = error?.response?.data?.ErrorCode || null;
    return {
      success: false,
      errorCode,
      error: error?.response?.data?.error || errorCode || error?.message || 'BOM submit failed',
    };
  }
}

// Creates a revision of an enterprise BOM. Returns { success, enterprise_bom_id }
// where the new id is the freshly-created revision that we can now write to.
export async function reviseEnterpriseBom(enterpriseBomId) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.post(
      `/organization/bom/admin/${enterpriseBomId}/revise/`,
      {}
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'BOM revise failed',
    };
  }
}

// Fetches the BOMs currently attached to a project. Merges TWO FactWise sources
// because neither returns both identifiers we need on its own:
//   1. Dashboard picker rows carry `.boms = [{ entry_id, bom_code, bom_name, quantity }]`
//      via ProjectDashboardSerializer. entry_id IS bom_module_id.
//      (Passed in as `projectBomsFromPicker` so we don't need a separate detail call —
//      DetailProjectAPI's serializer omits bom_code + bom_name entirely.)
//   2. GET /organization/project/<id>/existing-boms/ → `[{ enterprise_bom_id, base_bom_id, bom_code }]`
// The revise-in-project flow needs BOTH — bom_module_id for the URL and
// enterprise_bom_id so we can upload the new bulk-import as a revision.
export async function fetchProjectBomVersions(projectId, projectBomsFromPicker = []) {
  const client = buildClient();
  if (!client) return { success: false, boms: [] };
  try {
    const { data } = await client.get(
      `/organization/project/${projectId}/existing-boms/`
    );
    const existing = Array.isArray(data) ? data : [];
    const existingByCode = new Map();
    existing.forEach((b) => {
      const code = String(b.bom_code || '').trim().toLowerCase();
      if (code) existingByCode.set(code, b);
    });

    // Prefer the picker's boms (has entry_id). Fall back to existing-boms alone
    // (no entry_id, so revise won't be available for those rows).
    const pickerBoms = Array.isArray(projectBomsFromPicker) ? projectBomsFromPicker : [];

    if (pickerBoms.length) {
      const boms = pickerBoms.map((b) => {
        const code = String(b.bom_code || '').trim().toLowerCase();
        const match = existingByCode.get(code) || {};
        return {
          bom_module_id: b.entry_id,
          entry_id: b.entry_id,
          enterprise_bom_id: match.enterprise_bom_id || null,
          base_bom_id: match.base_bom_id || null,
          bom_code: b.bom_code || '',
          bom_name: b.bom_name || '',
          quantity: b.quantity,
        };
      });
      return { success: true, boms };
    }

    // Fallback: dashboard picker gave us nothing (empty `.boms[]` — happens
    // when the project row we picked wasn't the flavour that embeds boms, or
    // FactWise stripped it for this user). Enrich the existing-boms rows with
    // bom_module_id by hitting /bom-groups/ per unique base_bom_id — the same
    // endpoint BomStructureDialog uses to enumerate revisable slots. One call
    // per distinct base, so a project with N different BOMs takes N+1 total.
    // Without this, every "Revise: X" checkbox in the export dialog is
    // disabled because the FormControlLabel requires both ids.
    const uniqueBaseIds = Array.from(new Set(
      existing.map((b) => b.base_bom_id).filter(Boolean)
    ));
    const slotLookups = await Promise.all(
      uniqueBaseIds.map(async (baseId) => {
        try {
          const slotsResp = await client.get(
            `/organization/project/${projectId}/bom-groups/`,
            { params: { base_bom_id: baseId } }
          );
          const slots = Array.isArray(slotsResp?.data) ? slotsResp.data : [];
          return { baseId, slots };
        } catch (_) {
          return { baseId, slots: [] };
        }
      })
    );
    // Index the slots by (base_bom_id, enterprise_bom_id) so a project with
    // multiple slots on different revisions of the same base still lines up.
    const slotByKey = new Map();
    slotLookups.forEach(({ baseId, slots }) => {
      slots.forEach((slot) => {
        // bom-groups can return either the module linkage row directly or a
        // grouped shape with nested `versions[]`. Handle both — the shape
        // Yash's BomStructureDialog reads is a flat list of slot rows.
        const list = Array.isArray(slot?.versions) ? slot.versions : [slot];
        list.forEach((entry) => {
          const moduleId = entry?.bom_module_id || entry?.entry_id || null;
          const enterpriseBomId = entry?.enterprise_bom_id || null;
          if (!moduleId || !enterpriseBomId) return;
          slotByKey.set(`${baseId}::${enterpriseBomId}`, moduleId);
        });
      });
    });

    const boms = existing.map((b) => {
      const key = `${b.base_bom_id}::${b.enterprise_bom_id}`;
      const moduleId = slotByKey.get(key) || null;
      return {
        bom_module_id: moduleId,
        entry_id: moduleId,
        enterprise_bom_id: b.enterprise_bom_id || null,
        base_bom_id: b.base_bom_id || null,
        bom_code: b.bom_code || '',
        bom_name: b.bom_name || '',
      };
    });
    return { success: true, boms };
  } catch (error) {
    return {
      success: false,
      boms: [],
      error: error?.response?.data?.error || error?.message || 'Project BOM list failed',
    };
  }
}

// A fresh id per revise attempt. Reusing one is the server's replay guard and
// returns 409, so a retry must never send the id its predecessor used.
export function newProcessId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Non-secure contexts have no randomUUID. Shape matters more than entropy
  // here — the id only has to be unique across this tab's attempts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const rand = (Math.random() * 16) | 0;
    return (ch === 'x' ? rand : ((rand & 0x3) | 0x8)).toString(16);
  });
}

// Replaces an existing project BOM module with a new enterprise BOM revision.
//
// `bomModuleId` is a LINKAGE id (bom_module_id from the bom-groups endpoint),
// not an enterprise_bom_id — sibling routes name the same parameter after the
// wrong thing, but this one is honest. `enterpriseBomId` in the body is the
// target revision being moved to, and must share a base BOM with what the slot
// currently holds or the server rejects it with 400.
//
// Synchronous and slow: cost scales as (rows in the slot) × (items in the
// revision), against a 60s worker timeout. A timeout rolls back cleanly — the
// whole thing is one transaction — but leaves the process record stuck on
// RUNNING, so treat RUNNING past ~90s as a failure and retry with a NEW
// processId rather than polling forever.
export async function reviseProjectBom({ projectId, bomModuleId, enterpriseBomId, processId }) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.put(
      `/organization/project/${projectId}/boms/${bomModuleId}/revise/`,
      { enterprise_bom_id: enterpriseBomId, process_id: processId || newProcessId() },
      // buildClient's 15s default is shorter than the work takes. Giving up at
      // 15s does not stop the server — it commits anyway — so the client would
      // report a failure on a revise that actually landed. This sits past the
      // server's own 60s worker limit so the server is always the one to give
      // up first, and a client-side abort means something else went wrong.
      { timeout: 120000 }
    );
    return { success: true, ...data };
  } catch (error) {
    const status = error?.response?.status;
    return {
      success: false,
      // 409 is the replay guard: that process_id was already consumed, so the
      // work may well have succeeded. It is a signal to go and look, not a
      // failure to retry through.
      conflict: status === 409,
      // No response at all — the outcome is genuinely unknown from here and
      // has to be resolved against the process record.
      timedOut: error?.code === 'ECONNABORTED' || (!error?.response && Boolean(error?.request)),
      status: status || null,
      error: error?.response?.data?.error
        || error?.response?.data?.ErrorCode
        || error?.message
        || 'Project BOM revise failed',
    };
  }
}

// The truth about an attempt whose HTTP response never arrived or came back
// 409. See §7 of BOM_MAPPER_PROJECT_REVISE_API.md: the record is written
// RUNNING before the work starts, and the FAILED write lives in an exception
// handler that a SIGKILL'd worker never reaches — so RUNNING is not proof of
// progress, only of having started.
export async function fetchProcessStatus(processId) {
  const client = buildClient();
  if (!client || !processId) return { success: false, status: null };
  try {
    const { data } = await client.get(`/organization/process/${processId}/status/`);
    return { success: true, status: data?.status || null, error: data?.error || null };
  } catch (error) {
    return {
      success: false,
      status: null,
      error: error?.response?.data?.error || error?.message || 'Process status lookup failed',
    };
  }
}

// --- Revising a BOM on its projects ------------------------------------------
//
// Everything below keys off `base_bom_id`, never `enterprise_bom_id`. The two
// are easy to mix up and the failure is silent: `enterprise_bom_id` names ONE
// revision and changes every time a BOM is revised, while `base_bom_id` names
// the BOM across all of them and never changes. A project stays linked to
// whichever revision it was added with, so asking "which projects have this
// BOM" with a fresh revision's id returns zero projects — precisely the
// projects you were about to update. See BOM_MAPPER_PROJECT_REVISE_API.md in
// the backend repo.

// One entry per BOM from a list of revisions, each carrying the highest-version
// row as the current one and its full revision history.
//
// Keyed on base_bom_id and ranked on `version`. Never on the `_Rn` suffix in
// bom_code: seven BOMs in mainV2 disagree with their own name — QAB1_R24 is
// actually v1, AMAAN-BUG-6-2 is v2 with no suffix at all — so a name-derived
// ordering picks the wrong current revision for those.
//
// Rows with no base_bom_id cannot be grouped and are passed through as
// standalone entries rather than dropped or lumped together under null.
export function collapseBomRevisions(rows = []) {
  const byBase = new Map();
  const ungrouped = [];
  rows.forEach((row) => {
    if (!row?.base_bom_id) {
      if (row) ungrouped.push({ ...row, revisions: [row] });
      return;
    }
    const key = String(row.base_bom_id);
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push(row);
  });

  const collapsed = [...byBase.values()].map((revisions) => {
    const ordered = [...revisions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
    return { ...ordered[0], revisions: ordered };
  });
  return [...collapsed, ...ungrouped];
}

// The bom_code FactWise will give the next revision of this BOM.
//
// A mirror of bom_service.admin_revise_bom, deliberately kept identical:
//   v1  BOM_A     -> BOM_A_R2      (unsuffixed IS v1, so the first revision is 2)
//   v4  BOM_A_R4  -> BOM_A_R5      (drops the digits of the old version, appends the new)
//
// Derived from `version`, never by parsing the _Rn suffix — seven BOMs in
// mainV2 disagree with their own name (QAB1_R24 is v1, AMAAN-BUG-6-2 is v2
// with no suffix), and reading the name would produce a code FactWise never
// creates.
//
// This is a PREVIEW, not the decision. The server names the revision when
// admin_revise_bom runs, and the export path re-reads that name and retargets
// the sheet to it. Showing it early only matters so the user sees the same code
// that will ship.
export function nextRevisionCode(bomCode, version) {
  const code = String(bomCode || '');
  const current = Number(version);
  if (!code || !Number.isFinite(current) || current < 1) return code;
  const next = current + 1;
  if (current === 1) return `${code}_R${next}`;
  // Only strip when the code really does end in the current version, so a
  // mislabelled code loses nothing.
  if (code.endsWith(String(current))) {
    return `${code.slice(0, -String(current).length)}${next}`;
  }
  return `${code}_R${next}`;
}

// Projects carrying a BOM, at any revision. Replaces the org-wide project
// search for the revision flow — a revision can only land somewhere the BOM
// already is.
//
// No status filtering server-side: closed projects come back too, with
// `project_status` so the caller decides what is eligible.
export async function fetchProjectsWithBom({ baseBomId } = {}) {
  const client = buildClient();
  if (!client || !baseBomId) return { success: false, projects: [] };
  try {
    const { data } = await client.get(`/organization/project/bom/${baseBomId}/`);
    return { success: true, projects: Array.isArray(data) ? data : [] };
  } catch (error) {
    return {
      success: false,
      projects: [],
      error: error?.response?.data?.error || error?.message || 'Project lookup failed',
    };
  }
}

// The slots a BOM occupies in one project.
//
// A slot is one "add BOM to project" action, identified by
// base_bom_module_linkage_id, and may hold several rows (one per quantity added
// in that action) — all of which move together in a single revise call. Because
// each add is independent, the same BOM can sit in several slots at DIFFERENT
// revisions at once, which is why this returns a list to choose from rather
// than one answer.
//
// `bom_module_id` is the slot's representative linkage row and is what the
// revise URL takes — not an enterprise_bom_id, despite what sibling endpoints
// name their parameters.
export async function fetchProjectBomSlots({ projectId, baseBomId } = {}) {
  const client = buildClient();
  if (!client || !projectId || !baseBomId) return { success: false, slots: [] };
  try {
    const { data } = await client.get(
      `/organization/project/${projectId}/bom-groups/`,
      { params: { base_bom_id: baseBomId } }
    );
    return { success: true, slots: Array.isArray(data) ? data : [] };
  } catch (error) {
    return {
      success: false,
      slots: [],
      error: error?.response?.data?.error || error?.message || 'Project BOM slot lookup failed',
    };
  }
}

// Fetches available currencies. Used to pick a currency_id for BOM attach.
export async function fetchCurrencies() {
  const client = buildClient();
  if (!client) return { success: false, currencies: [] };
  try {
    const { data } = await client.get(`/backbone/currency_code/`);
    const currencies = Array.isArray(data) ? data : (data?.results || []);
    return { success: true, currencies };
  } catch (error) {
    return {
      success: false,
      currencies: [],
      error: error?.response?.data?.error || error?.message || 'Currency list failed',
    };
  }
}

// Fetches enterprise BOM detail (needed to know quantity/currency before attach).
export async function fetchEnterpriseBomDetail(enterpriseBomId) {
  const client = buildClient();
  if (!client) return { success: false };
  try {
    const { data } = await client.get(
      `/organization/bom/${enterpriseBomId}/admin/`
    );
    return { success: true, bom: data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'BOM detail fetch failed',
    };
  }
}

// Aditya's revision-preview API. Parses an already-uploaded revision sheet
// (referenced by bulk_import_id) into a comparison-shaped version tree, so we
// can render the "what the uploaded sheet would become" side of a diff without
// implementing our own recursive Excel-to-tree walker.
//
// enterpriseBomId is expected to be the R5 draft; the current-side items it
// returns will be empty (R5 has no items yet) — WE DISCARD IT. Only the
// preview_version half of the response is used here. R4's real contents come
// from fetchEnterpriseBomDetail(supersededId) called separately, and the two
// are diffed on the FE.
//
// Response shape (see BE bom_revision_preview_service.py):
//   { success, data: [{ bom_name, bom_code, versions: [current, preview] }],
//     bulk_import: {...}, hydrated_sheet_export: {...}, match_summary: {...} }
export async function fetchBomRevisionPreview({ enterpriseBomId, bulkImportId }) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.post(
      '/organization/bom/admin/revision-preview/',
      { enterprise_bom_id: enterpriseBomId, bulk_import_id: bulkImportId }
    );
    // Extract the preview version — it is always the second entry per BE
    // contract (index 0 is current/R5, index 1 is preview built from sheet).
    const group = Array.isArray(data?.data) ? data.data[0] : null;
    const versions = Array.isArray(group?.versions) ? group.versions : [];
    const previewVersion = versions.find(
      (v) => String(v?.entry_id || '').startsWith('preview:') || v?.bom_status === 'PREVIEW'
    ) || versions[1] || null;
    return {
      success: true,
      previewVersion,
      hydratedSheetExport: data?.hydrated_sheet_export || null,
      matchSummary: data?.match_summary || null,
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error?.response?.data?.error
        || (typeof error?.response?.data === 'string' ? error.response.data : null)
        || error?.message
        || 'Revision preview failed',
    };
  }
}

// Attach an enterprise BOM into a project. Minimal payload — the FW service
// pulls the actual item list from the enterprise BOM, so project_bom_items can
// be empty (no overrides).
// Recursively flatten an enterprise BOM's bom_items tree into the flat
// project_bom_items list FactWise's POST /project/{id}/boms/{bomId}/create/
// expects. Sub-BOMs contribute both their own entry AND all their descendants.
// Alternates ride alongside their parent. This mirrors what FW UI's
// convertToProjectBOMCreatePayload does internally when a user clicks "Add"
// on the BOM configuration popup — see ProjectGlCostCenter/helpers/projectBOMHelpers.ts
function flattenBomItemsForProject(bomItems, prevBomItems) {
  const out = [];
  const list = Array.isArray(bomItems) ? bomItems : [];
  // Skip any entry that doesn't carry both bom_item_id AND measurement_unit —
  // mapper-created BOMs occasionally include placeholder rows (finished-good
  // stubs, unresolved sub-BOM refs) whose IDs are null. Sending those makes
  // FactWise reject the whole attach with
  //   {'bom_item_id': [ErrorDetail(string='This field is required.')]}
  //   {'measurement_unit_id': [ErrorDetail(string='This field is required.')]}
  // per bad row. Silently drop them so the good rows still land.
  const validEntry = (o) => Boolean(o?.bom_item_id) && Boolean(o?.measurement_unit);
  for (const item of list) {
    const subItems = Array.isArray(item?.sub_bom_items) ? item.sub_bom_items : [];
    const alternates = Array.isArray(item?.alternates) ? item.alternates : [];
    // Leaf (raw material) — no sub-BOM. Push the item + each alternate.
    if (subItems.length === 0) {
      if (validEntry(item)) {
        out.push({
          bom_item_id: item.bom_item_id,
          quantity: Number(item.quantity ?? 0),
          cost_per_unit: Number(item.cost_per_unit ?? 0),
          measurement_unit_id: item.measurement_unit,
          delivery_schedule: [
            {
              delivery_schedule_item_id: null,
              quantity: Number(item.quantity ?? 0),
              delivery_date: null,
            },
          ],
          selected: item.selected !== false,
          bom_item_valid: null,
        });
      }
      for (const altWrap of alternates) {
        // `alternates` from /bom/{id}/admin/ wraps the real bom_item inside
        //   { alternate_bom_item_linkage_id, bom_item: <parent_id>,
        //     alternate_bom_item: { bom_item_id, quantity, cost_per_unit,
        //                           measurement_unit, ... } }
        // — the flat fields at the top of the wrapper are NULL for the
        // alternate itself; we have to reach into alternate_bom_item.
        const alt = altWrap?.alternate_bom_item || altWrap;
        if (!validEntry(alt)) continue;
        out.push({
          bom_item_id: alt.bom_item_id,
          quantity: Number(alt.quantity ?? 0),
          cost_per_unit: Number(alt.cost_per_unit ?? 0),
          measurement_unit_id: alt.measurement_unit,
          delivery_schedule: [
            {
              delivery_schedule_item_id: null,
              quantity: Number(alt.quantity ?? 0),
              delivery_date: null,
            },
          ],
          selected: alt.selected !== false,
          bom_item_valid: null,
        });
      }
      continue;
    }
    // Sub-BOM branch — flatten children first, then push the parent (matches
    // FW helper order so IDs referenced in delivery_schedules etc. are known).
    const prevSubs = prevBomItems?.find((p) => p.bom_item_id === item.bom_item_id)?.sub_bom_items;
    out.push(...flattenBomItemsForProject(subItems, prevSubs));
    if (validEntry(item)) {
      out.push({
        bom_item_id: item.bom_item_id,
        quantity: Number(item.quantity ?? 0),
        cost_per_unit: Number(item.cost_per_unit ?? 0),
        measurement_unit_id: item.measurement_unit,
        selected: item.selected !== false,
        custom_sections: item.custom_sections || [],
        bom_item_valid: null,
      });
    }
    for (const alt of alternates) {
      if (!validEntry(alt)) continue;
      out.push({
        bom_item_id: alt.bom_item_id,
        quantity: Number(alt.quantity ?? 0),
        cost_per_unit: Number(alt.cost_per_unit ?? 0),
        measurement_unit_id: alt.measurement_unit,
        delivery_schedule: [
          {
            delivery_schedule_item_id: null,
            quantity: Number(alt.quantity ?? 0),
            delivery_date: null,
          },
        ],
        selected: alt.selected !== false,
        bom_item_valid: null,
      });
    }
  }
  return out;
}

// Attach an enterprise BOM to a project via the SAME flow FactWise UI uses
// when a user clicks the "Add BOM" icon and picks a BOM. Verified against
// FW's own network trace on 2026-08-12:
//   1. GET  /organization/bom/{bomId}/admin/        → BOM detail (items, currency, total)
//   2. POST /organization/project/{pid}/boms/{bomId}/create/
//        body: { boms: [{quantity, total}], currency_id,
//                project_bom_items: [...flattened items...],
//                custom_sections: [{name:'BOM', section_type:'BOM', custom_fields:[]}],
//                bom_valid: true }
//
// Historical bug: we were POSTing to the SINGULAR endpoint
// (`/project/{pid}/bom/{bomId}/create/`) with empty project_bom_items and
// empty custom_sections. That created a project-BOM linkage with NO child
// items and NO project-side custom_section rows, so:
//   - the project's "Add Items" tab was empty (no items linked),
//   - and Submit BOM later failed with
//     `{'custom_section_id': [ErrorDetail(string='Must be a valid UUID.')]}`
//     because there was no custom_section UUID to update.
// The FW UI uses the PLURAL endpoint (`/boms/{bomId}/create/`) that expects
// `boms: [{quantity, total}]` for multi-slab support; we always send one slab.
export async function attachBomToProject({
  projectId,
  enterpriseBomId,
  currencyId,
  quantity,
  total,
}) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    // Step 1a: fetch BOM detail (items + currency + defaults).
    // Step 1b: fetch project detail to discover its template_id and existing
    //   custom_sections.
    const [detailResp, projectResp] = await Promise.all([
      client.get(`/organization/bom/${enterpriseBomId}/admin/`),
      client.get(`/organization/project/${projectId}/`),
    ]);
    const bom = detailResp?.data || {};
    const project = projectResp?.data || {};
    const bomItems = Array.isArray(bom.bom_items) ? bom.bom_items : [];
    let projectBomItems = flattenBomItemsForProject(bomItems);

    // Step 1c: fetch the project template so we can look up the ACTUAL name
    // FW's UI expects for the BOM_TERMS custom_section. FW UI's Submit
    // button reads `templateDetails.sections[X].subSections.BOM_TERMS.label`
    // and finds the matching project.custom_sections[].name. If we send an
    // attach with a section named something else (or matching by name
    // pattern that doesn't hit the template's actual label), the FW UI's
    // find returns null → Submit passes empty custom_section_id → 400
    // "custom_section_id: Must be a valid UUID."
    //
    // Same template, same UI: manual attach via FW works because FW UI
    // uses this same label lookup. Our attach must use it too.
    const { entityId } = readCredentials();
    const templateId =
      project?.template_id
      || project?.project_template?.template_id
      || project?.additional_details?.template_id
      || null;

    let bomTermsLabel = null;
    if (templateId && entityId) {
      try {
        const tplResp = await client.get(
          `/module_templates/${entityId}/${templateId}/`
        );
        const template = tplResp?.data || {};
        const sectionsRoot = template?.sections || {};
        // sectionsRoot is a dict keyed by section type. Each value has
        // .subSections which may contain a BOM_TERMS entry with .label.
        // Fallback: if BOM_TERMS isn't nested, some templates put the label
        // at section.label directly when section is BOM-typed.
        for (const section of Object.values(sectionsRoot)) {
          if (!section || typeof section !== 'object') continue;
          const bomTerms = section?.subSections?.BOM_TERMS;
          if (bomTerms?.label) { bomTermsLabel = bomTerms.label; break; }
          if (section?.type === 'BOM_TERMS' && section?.label) {
            bomTermsLabel = section.label; break;
          }
        }
      } catch {
        // Template fetch failed — fall back to pattern matching below.
      }
    }

    // Pull the project's BOM custom_section from the project detail. If we
    // found the exact template label, use it verbatim (matches FW UI's
    // Submit-time lookup byte-for-byte). Otherwise fall back to a name
    // pattern (`^bom(\s|$)`) for older templates or fetch failures.
    const projectCustomSections = Array.isArray(project.custom_sections)
      ? project.custom_sections
      : [];
    let bomSectionMatches;
    if (bomTermsLabel) {
      const exact = projectCustomSections.filter(
        (s) => String(s?.name || '').trim() === String(bomTermsLabel).trim()
      );
      bomSectionMatches = exact.length ? exact : [];
      // If the project template says the label is X but no project section
      // named X exists yet (rare), we still send it with that exact name so
      // FW's add_section_id_via_name maps to whatever it can. If the map
      // doesn't have that key FW crashes — but if the template says so, the
      // map SHOULD have it because project creation initializes sections
      // from the template.
      if (!bomSectionMatches.length) {
        bomSectionMatches = [{ name: bomTermsLabel }];
      }
    } else {
      bomSectionMatches = projectCustomSections
        .filter((s) => /^bom(\s|$)/i.test(String(s?.name || '').trim()))
        .sort((a, b) => String(b?.name || '').length - String(a?.name || '').length);
    }
    const outgoingCustomSections = bomSectionMatches.length
      ? bomSectionMatches.map((s) => ({
          name: s.name,
          section_type: 'BOM',
          // Empty fields — matches what FW's own UI sends when the BOM
          // template has no custom fields. FW's server iterates our list
          // and creates the linkage row keyed by name; per-field values
          // are set to their defaults from the template.
          custom_fields: [],
        }))
      : [];

    // Filter each sub-BOM parent's custom_sections down to names the project's
    // BOM-scope map actually contains. FW's create_project_boms crashes with
    //   KeyError: 'BOM Details'
    // in add_section_id_via_name → custom_section_name_map[section.name]
    // when a sub-BOM item carries a section name (e.g. default "BOM Details"
    // baked into the BOM by admin_import) that isn't registered in the
    // project's own template. Stripping unknowns is safe: FW's per-item BOM
    // section attach is optional metadata, and the top-level custom_sections
    // above still populate the project's BOM linkage.
    const projectBomSectionNames = new Set(
      projectCustomSections
        .filter((s) => String(s?.section_type || '').toUpperCase() === 'BOM'
          || /bom/i.test(String(s?.name || '')))
        .map((s) => String(s?.name || '').trim())
        .filter(Boolean)
    );
    projectBomItems = projectBomItems.map((pbi) => {
      if (!Array.isArray(pbi?.custom_sections) || !pbi.custom_sections.length) {
        return pbi;
      }
      const kept = pbi.custom_sections.filter(
        (cs) => projectBomSectionNames.has(String(cs?.name || '').trim())
      );
      return { ...pbi, custom_sections: kept };
    });

    // Prefer the BOM's own currency/quantity/total when caller didn't pass
    // one — the "Add BOM" popup does the same.
    const effectiveCurrencyId = currencyId
      || bom.currency?.currency_id
      || bom.currency
      || null;
    const effectiveQuantity = Number(quantity ?? bom.quantity ?? 1);
    const effectiveTotal = Number(total ?? bom.total ?? 0);

    if (!effectiveCurrencyId) {
      return {
        success: false,
        error: 'No currency available to attach the BOM.',
      };
    }

    // Step 2: POST to the plural /boms/ endpoint with the fully-populated
    // payload. Matches the byte-for-byte shape captured from FW UI, with
    // custom_sections named after the project's actual template sections.
    const { data } = await client.post(
      `/organization/project/${projectId}/boms/${enterpriseBomId}/create/`,
      {
        boms: [{ quantity: effectiveQuantity, total: effectiveTotal }],
        currency_id: effectiveCurrencyId,
        project_bom_items: projectBomItems,
        custom_sections: outgoingCustomSections,
        bom_valid: true,
      }
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error
        || JSON.stringify(error?.response?.data || {})
        || error?.message
        || 'BOM attach failed',
    };
  }
}

// Returns decrypted distributor credentials from Factwise.
// Shape: { success: bool, credentials: { DIGIKEY: {...}|null, MOUSER: {...}|null, ELEMENT14: {...}|null } }
export async function fetchDistributorCredentials() {
  const client = buildClient();
  const { entityId } = readCredentials();
  if (!client || !entityId) {
    return { success: false, credentials: {} };
  }
  try {
    const { data } = await client.get(
      `/organization/entity/${entityId}/integrations/distributors/reveal/`
    );
    return data;
  } catch (error) {
    return {
      success: false,
      credentials: {},
      error: error?.response?.data?.error || error.message,
    };
  }
}
