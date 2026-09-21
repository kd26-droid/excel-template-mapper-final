export const shouldRunBomRoleInference = ({
  currentStep = 0,
  restoreInFlight = false,
  parserTouched = false,
  headerCount = 0,
  rowCount = 0,
} = {}) => (
  Number(currentStep) <= 2 &&
  !restoreInFlight &&
  !parserTouched &&
  Number(headerCount) > 0 &&
  Number(rowCount) > 0
);

export const bomRoleInferenceKey = ({
  sheetScope = 'single',
  sheetName = '',
  headerRowIndex = 0,
  sourceEndRow = '',
  headers = [],
  rowCount = 0,
  config = {},
  restoreInferenceNonce = 0,
} = {}) => [
  sheetScope,
  sheetName,
  Number(headerRowIndex) || 0,
  sourceEndRow || '',
  (headers || []).join('\u001f'),
  Number(rowCount) || 0,
  config.skipTitleRows ? 'skip-titles' : 'keep-titles',
  config.skipRepeatedHeaders ? 'skip-headers' : 'keep-headers',
  config.skipDoNotPopulate ? 'skip-dnp' : 'keep-dnp',
  config.skipDeletedRows ? 'skip-deleted' : 'keep-deleted',
  config.skipSummaryRows ? 'skip-summaries' : 'keep-summaries',
  config.parentPathLevels ? 'use-parent-path' : 'ignore-parent-path',
  Number(restoreInferenceNonce) || 0,
].join('\u001e');

export const restoreUserRoleSelections = (
  savedRoles = {},
  currentHeaders = [],
  roleKeys = Object.keys(savedRoles || {})
) => {
  const availableHeaders = new Set(Array.isArray(currentHeaders) ? currentHeaders : []);
  return roleKeys.reduce((restored, role) => {
    const selectedHeader = savedRoles?.[role] || '';
    restored[role] = selectedHeader && availableHeaders.has(selectedHeader)
      ? selectedHeader
      : '';
    return restored;
  }, {});
};

export const bomNormalizerSourceKey = ({
  fileName = '',
  sheetName = '',
  sheetScope = 'single',
  selectedSheetNames = [],
  headerRowIndex = 0,
  preparedHeaders = [],
} = {}) => JSON.stringify([
  fileName,
  sheetName,
  sheetScope,
  selectedSheetNames,
  Number(headerRowIndex) || 0,
  preparedHeaders,
]);

export const restoredConfigureState = (workspace = {}, draft = {}) => {
  const matchingDraft = draft?.kind === 'configure-draft' &&
    draft.sourceKey === bomNormalizerSourceKey(workspace);
  return matchingDraft ? draft : workspace;
};

const WORKSPACE_DATABASE_NAME = 'excel-template-mapper';
const WORKSPACE_DATABASE_VERSION = 1;
const WORKSPACE_STORE_NAME = 'bom-normalizer-workspaces';
const ACTIVE_WORKSPACE_KEY = 'active';

let workspaceWriteQueue = Promise.resolve();

const openWorkspaceDatabase = (indexedDb) => new Promise((resolve, reject) => {
  if (!indexedDb?.open) {
    reject(new Error('IndexedDB is unavailable.'));
    return;
  }

  const request = indexedDb.open(WORKSPACE_DATABASE_NAME, WORKSPACE_DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
      database.createObjectStore(WORKSPACE_STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open workspace storage.'));
});

const withWorkspaceStore = async (mode, operation, indexedDb) => {
  const database = await openWorkspaceDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(WORKSPACE_STORE_NAME, mode);
      const request = operation(transaction.objectStore(WORKSPACE_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Workspace storage operation failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Workspace storage transaction was aborted.'));
    });
  } finally {
    database.close();
  }
};

export const workspaceSnapshotHasSourceRows = (snapshot = {}) => {
  if (Array.isArray(snapshot.preparedDataRows) && snapshot.preparedDataRows.length) return true;
  if (Array.isArray(snapshot.sheetRows) && snapshot.sheetRows.length) return true;
  return Object.values(snapshot.workbook?.Sheets || {}).some((sheet) => (
    Boolean(sheet && Object.keys(sheet).some((key) => key !== '!ref'))
  ));
};

export const selectBomNormalizerWorkspaceSnapshot = (sessionSnapshot, durableSnapshot) => {
  if (!sessionSnapshot) return durableSnapshot || null;
  if (!durableSnapshot) return sessionSnapshot;

  const sessionSourceKey = bomNormalizerSourceKey(sessionSnapshot);
  const durableSourceKey = bomNormalizerSourceKey(durableSnapshot);
  const sameSource = sessionSourceKey === durableSourceKey;
  const sessionHasRows = workspaceSnapshotHasSourceRows(sessionSnapshot);
  const durableHasRows = workspaceSnapshotHasSourceRows(durableSnapshot);

  if (sameSource && durableHasRows && !sessionHasRows) {
    return {
      ...durableSnapshot,
      ...sessionSnapshot,
      workbook: durableSnapshot.workbook,
      sheetRows: durableSnapshot.sheetRows || [],
      preparedDataRows: durableSnapshot.preparedDataRows || [],
      combineItems: durableSnapshot.combineItems || sessionSnapshot.combineItems || [],
    };
  }

  return Number(durableSnapshot.savedAt || 0) > Number(sessionSnapshot.savedAt || 0)
    ? durableSnapshot
    : sessionSnapshot;
};

const browserIndexedDb = () => (typeof window === 'undefined' ? undefined : window.indexedDB);

export const persistDurableBomNormalizerWorkspace = (snapshot, indexedDb = browserIndexedDb()) => {
  if (!snapshot) return Promise.resolve();
  workspaceWriteQueue = workspaceWriteQueue
    .catch(() => undefined)
    .then(() => withWorkspaceStore(
      'readwrite',
      (store) => store.put(snapshot, ACTIVE_WORKSPACE_KEY),
      indexedDb
    ));
  return workspaceWriteQueue;
};

export const restoreDurableBomNormalizerWorkspace = (
  indexedDb = browserIndexedDb()
) => withWorkspaceStore(
  'readonly',
  (store) => store.get(ACTIVE_WORKSPACE_KEY),
  indexedDb
).catch(() => null);

export const clearDurableBomNormalizerWorkspace = (
  indexedDb = browserIndexedDb()
) => withWorkspaceStore(
  'readwrite',
  (store) => store.delete(ACTIVE_WORKSPACE_KEY),
  indexedDb
).catch(() => undefined);
