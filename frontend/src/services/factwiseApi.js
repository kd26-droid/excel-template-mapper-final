import axios from 'axios';

const STORAGE_KEYS = {
  token: 'fw_embedded_token',
  apiUrl: 'fw_api_url',
  entityId: 'fw_entity_id',
};

function readCredentials() {
  return {
    token: window.localStorage.getItem(STORAGE_KEYS.token),
    apiUrl: window.localStorage.getItem(STORAGE_KEYS.apiUrl),
    entityId: window.localStorage.getItem(STORAGE_KEYS.entityId),
  };
}

function buildClient() {
  const { token, apiUrl } = readCredentials();
  if (!token || !apiUrl) return null;

  return axios.create({
    baseURL: apiUrl.replace(/\/+$/, ''),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

export function isFactwiseSessionAvailable() {
  const { token, apiUrl } = readCredentials();
  return Boolean(token && apiUrl);
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
    const { bulk_import_id, url } = generateResp.data;
    if (!bulk_import_id || !url) {
      return { success: false, error: 'Factwise did not return an upload URL' };
    }

    // Step 2: PUT raw file bytes to the Azure Blob SAS URL
    // (Same headers Factwise's own uploadFileToGeneratedUrl uses)
    await axios.put(url, file, {
      headers: { 'x-ms-blob-type': 'BlockBlob' },
      timeout: 120000,
    });

    return { success: true, bulk_import_id, file_name: file.name };
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

// Creates a new Factwise project. Requires template_id (a project template UUID)
// and buyer_entity_id. Returns { success, project_id, ... }.
export async function createFactwiseProject(payload) {
  const client = buildClient();
  const { entityId } = readCredentials();
  if (!client || !entityId) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.post(
      `/organization/project/create/`,
      { buyer_entity_id: entityId, ...payload }
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
// Response items look like { enterprise_bom_id, bom_code }.
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
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'BOM submit failed',
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

    // Fallback shape — surface the BOMs at least, revise disabled server-side.
    const boms = existing.map((b) => ({
      bom_module_id: null,
      entry_id: null,
      enterprise_bom_id: b.enterprise_bom_id || null,
      base_bom_id: b.base_bom_id || null,
      bom_code: b.bom_code || '',
      bom_name: b.bom_name || '',
    }));
    return { success: true, boms };
  } catch (error) {
    return {
      success: false,
      boms: [],
      error: error?.response?.data?.error || error?.message || 'Project BOM list failed',
    };
  }
}

// Replaces an existing project BOM module with a new enterprise BOM revision.
export async function reviseProjectBom({ projectId, bomModuleId, enterpriseBomId }) {
  const client = buildClient();
  if (!client) return { success: false, error: 'No Factwise session' };
  try {
    const { data } = await client.put(
      `/organization/project/${projectId}/boms/${bomModuleId}/revise/`,
      { enterprise_bom_id: enterpriseBomId }
    );
    return { success: true, ...data };
  } catch (error) {
    return {
      success: false,
      error: error?.response?.data?.error || error?.message || 'Project BOM revise failed',
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
    // Step 1b: fetch project detail to discover the ACTUAL name of the
    //   project's BOM-terms custom_section. FactWise's create_project_boms
    //   crashes with `KeyError: 'BOM'` at custom_service.add_section_id_via_name
    //   if the name we send doesn't exist in the project template's
    //   `bom_custom_section_name_map`. Different project templates use
    //   different labels (e.g. "BOM", "BOM Details", "BOM Terms"), so we
    //   read the label from the just-created project's own custom_sections
    //   list rather than hardcoding it.
    const [detailResp, projectResp] = await Promise.all([
      client.get(`/organization/bom/${enterpriseBomId}/admin/`),
      client.get(`/organization/project/${projectId}/`),
    ]);
    const bom = detailResp?.data || {};
    const project = projectResp?.data || {};
    const bomItems = Array.isArray(bom.bom_items) ? bom.bom_items : [];
    const projectBomItems = flattenBomItemsForProject(bomItems);

    // Pull the project's BOM-typed custom_section(s) — if none exist, we
    // send an empty list and let FW use its own defaults. If one exists,
    // we mirror it into the payload with the exact name FW is expecting.
    const projectCustomSections = Array.isArray(project.custom_sections)
      ? project.custom_sections
      : [];
    const bomSectionMatches = projectCustomSections.filter(
      (s) => String(s?.section_type || '').toUpperCase() === 'BOM'
    );
    const outgoingCustomSections = bomSectionMatches.length
      ? bomSectionMatches.map((s) => ({
          name: s.name,
          section_type: 'BOM',
          // Leave every field with a null value so FW just stores the
          // section shell without any user-facing content.
          custom_fields: (Array.isArray(s.custom_fields) ? s.custom_fields : []).map(
            (f) => ({
              name: f.name,
              type: f.type,
              value: null,
              is_locked: !!f.is_locked,
              is_visible: f.is_visible !== false,
              description: f.description || null,
              is_required: !!f.is_required,
              is_negotiable: !!f.is_negotiable,
            })
          ),
        }))
      : [];

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
