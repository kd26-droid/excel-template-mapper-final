import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  CircularProgress,
  ListItemText,
  TextField,
  Typography
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Save as SaveIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  TableChart as TableChartIcon,
  Visibility,
  VisibilityOff,
  VpnKey as VpnKeyIcon,
  Storefront as StorefrontIcon,
  Public as PublicIcon,
  Hub as HubIcon
} from '@mui/icons-material';
import { useThemeContext } from '../utils/ThemeContext';
import api from '../services/api';
import { useLocation } from 'react-router-dom';
import ColumnRuleBuilder, { createEmptyColumnRule } from '../components/ColumnRuleBuilder';
import { useFactwise } from '../contexts/FactwiseContext';
import {
  ITEM_DIRECTORY_DEFAULTS,
  readItemDirectoryColumnOptions,
  readItemDirectoryDefaults,
  writeItemDirectoryDefaults,
} from '../utils/itemDirectoryDefaults';

// All three providers are on by default. A part confirmed by any one of them is
// valid, so querying all three gives the best coverage; a provider without
// credentials simply returns nothing rather than failing the run.
const ALL_PROVIDERS = ['digikey', 'mouser', 'element14'];

const initialColumnMappings = [
  { column: 'MPN valid', providers: [...ALL_PROVIDERS], description: 'Part validation status' },
  { column: 'MPN Status', providers: [...ALL_PROVIDERS], description: 'Lifecycle status' },
  { column: 'EOL Status', providers: [...ALL_PROVIDERS], description: 'End of life flag' },
  { column: 'Discontinued', providers: [...ALL_PROVIDERS], description: 'Discontinued status' },
  { column: 'DKPN', providers: [...ALL_PROVIDERS], description: 'Distributor part number' },
  { column: 'Canonical MPN', providers: [...ALL_PROVIDERS], description: 'Standardized manufacturer part number' },
  { column: 'Category', providers: [...ALL_PROVIDERS], description: 'Product category' },
];

const providerMeta = {
  digikey: { label: 'DigiKey', color: '#3b82f6', soft: 'rgba(59, 130, 246, 0.14)', Icon: VpnKeyIcon },
  mouser: { label: 'Mouser', color: '#10b981', soft: 'rgba(16, 185, 129, 0.14)', Icon: StorefrontIcon },
  element14: { label: 'Element14', color: '#f59e0b', soft: 'rgba(245, 158, 11, 0.16)', Icon: PublicIcon },
};

const CREDENTIAL_SCOPE_KEY = 'mpn_provider_credential_scope_id';
const VALIDATION_PROVIDERS_KEY = 'mpn_validation_providers';
const COLUMN_PROVIDER_MAPPINGS_KEY = 'mpn_column_provider_mappings';
const MASK_VALUE = '************';
const ITEM_CODE_CONTENT_TYPE_OPTIONS = [
  { value: 'fixed', label: 'Use a default value' },
  { value: 'copy', label: 'Copy from one column' },
  { value: 'concat', label: 'Join two columns' },
  { value: 'conditional', label: 'Use an if / else condition' },
  { value: 'serial', label: 'Generate a serial sequence' },
];
const ITEM_CODE_ROWS_TO_UPDATE_OPTIONS = [
  { value: 'fill_empty', label: 'Only rows where this column is empty' },
  { value: 'overwrite', label: 'All rows' },
  { value: 'duplicates', label: 'Only rows with a duplicate value' },
];
const ITEM_CODE_SEPARATOR_OPTIONS = [
  { value: 'none', label: 'No separator', text: '' },
  { value: 'space', label: 'Space', text: ' ' },
  { value: 'hyphen', label: 'Hyphen -', text: '-' },
  { value: 'spaced_hyphen', label: 'Spaced hyphen -', text: ' - ' },
  { value: 'underscore', label: 'Underscore _', text: '_' },
  { value: 'slash', label: 'Slash /', text: '/' },
  { value: 'pipe', label: 'Pipe |', text: '|' },
  { value: 'comma', label: 'Comma ,', text: ',' },
  { value: 'custom', label: 'Custom...', text: '' },
];
const ITEM_CODE_CONDITION_OPTIONS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' },
];
const ITEM_CODE_VALUE_SOURCE_OPTIONS = [
  { value: 'default', label: 'Default value' },
  { value: 'column', label: 'Value from a column' },
  { value: 'empty', label: 'Leave empty' },
];
const ITEM_TYPE_OPTIONS = ['Raw material', 'Finished good'];

const cleanText = (value) => String(value ?? '').trim();

const serverSettingsToItemDirectoryDefaults = (settings, currentDefaults = {}) => {
  const rule = settings?.item_code_rule || {};
  return {
    ...currentDefaults,
    procurementEntityName: cleanText(settings?.entity_name) || currentDefaults.procurementEntityName || '',
    itemType: cleanText(settings?.item_type),
    procurementItem: settings?.procurement_item === null || settings?.procurement_item === undefined
      ? ''
      : (settings.procurement_item ? 'TRUE' : 'FALSE'),
    salesItem: settings?.sales_item === null || settings?.sales_item === undefined
      ? ''
      : (settings.sales_item ? 'TRUE' : 'FALSE'),
    measurementUnit: cleanText(settings?.measurement_unit),
    itemCodePrefix: cleanText(rule.prefix),
    itemCodeContentType: rule.mode === 'fixed' ? 'fixed' : (currentDefaults.itemCodeContentType || 'serial'),
    itemCodeRowsToUpdate: currentDefaults.itemCodeRowsToUpdate || 'fill_empty',
    itemCodeDefaultValue: cleanText(rule.value) || currentDefaults.itemCodeDefaultValue || '',
    itemCodeBlankStrategy: rule.prefix || rule.value ? 'prefix_sequence' : (currentDefaults.itemCodeBlankStrategy || 'prefix_sequence'),
    itemCodeDuplicateStrategy: currentDefaults.itemCodeDuplicateStrategy || 'leave',
    itemCodeSeparator: currentDefaults.itemCodeSeparator ?? '-',
    itemCodeStart: String(rule.start ?? currentDefaults.itemCodeStart ?? '1'),
    itemCodePadding: String(rule.padding ?? currentDefaults.itemCodePadding ?? '3'),
    itemCodeIncrement: rule.increment === undefined ? (currentDefaults.itemCodeIncrement ?? true) : rule.increment !== false,
  };
};

const itemDirectoryDefaultsToServerSettings = (defaults) => {
  const prefix = cleanText(defaults.itemCodePrefix);
  const contentType = cleanText(defaults.itemCodeContentType);
  const fixedValue = cleanText(defaults.itemCodeDefaultValue);
  return {
    item_type: cleanText(defaults.itemType),
    procurement_item: cleanText(defaults.procurementItem) || null,
    sales_item: cleanText(defaults.salesItem) || null,
    measurement_unit: cleanText(defaults.measurementUnit),
    item_code_rule: contentType === 'fixed' && fixedValue
      ? {
        mode: 'fixed',
        value: fixedValue,
      }
      : (contentType === 'serial' && prefix
      ? {
        mode: 'prefix_sequence',
        prefix,
        start: Math.max(1, Number.parseInt(defaults.itemCodeStart || '1', 10) || 1),
        padding: Math.max(0, Number.parseInt(defaults.itemCodePadding || '3', 10) || 0),
        // Not configurable: a non-advancing serial writes one code to every row,
        // and Item code must be unique. Forced rather than read back so a `false`
        // saved before the control was locked cannot still take effect.
        increment: true,
      }
      : {}),
  };
};

const normalizeItemDirectoryDefaultsForSave = (defaults) => ({
  ...defaults,
  // Saved as chosen. Defaulting to 'serial' here is what made an untouched
  // install generate item codes.
  itemCodeContentType: defaults.itemCodeContentType || '',
  itemCodeRowsToUpdate: defaults.itemCodeRowsToUpdate || 'fill_empty',
  itemCodeBlankStrategy: defaults.itemCodeContentType === 'serial' ? 'prefix_sequence' : 'leave',
  itemCodeDuplicateStrategy: defaults.itemCodeRowsToUpdate === 'duplicates' ? 'prefix_sequence' : 'leave',
  itemCodeSeparator: defaults.itemCodeJoinSeparatorMode === 'custom'
    ? (defaults.itemCodeJoinCustomSeparator ?? '')
    : (ITEM_CODE_SEPARATOR_OPTIONS.find(option => option.value === defaults.itemCodeJoinSeparatorMode)?.text ?? ' '),
  itemCodeIncrement: true,
});

const emptyProviderStatus = {
  digikey: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' },
  mouser: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' },
  element14: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' }
};

const getCredentialScopeId = () => {
  if (typeof window === 'undefined') return 'default';
  const existing = window.localStorage.getItem(CREDENTIAL_SCOPE_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(CREDENTIAL_SCOPE_KEY, generated);
  return generated;
};

const normalizeProviders = (value, fallback = ALL_PROVIDERS) => {
  const allowed = new Set(Object.keys(providerMeta));
  const raw = Array.isArray(value) ? value : (value ? [value] : fallback);
  const selected = raw.filter(provider => allowed.has(provider));
  return selected.length ? Array.from(new Set(selected)) : fallback;
};

const providersFromColumnMappings = (mappings) => {
  const selected = Array.from(new Set((mappings || []).flatMap(mapping => normalizeProviders(mapping.providers || mapping.provider))));
  return selected.length ? selected : ['digikey', 'mouser', 'element14'];
};

const getInitialColumnMappings = () => {
  if (typeof window === 'undefined') return initialColumnMappings;
  try {
    const saved = JSON.parse(window.localStorage.getItem(COLUMN_PROVIDER_MAPPINGS_KEY) || '[]');
    if (!Array.isArray(saved) || !saved.length) return initialColumnMappings;
    const savedByColumn = new Map(saved.map(mapping => [mapping.column, mapping]));
    return initialColumnMappings.map(mapping => {
      const savedMapping = savedByColumn.get(mapping.column);
      return {
        ...mapping,
        providers: normalizeProviders(savedMapping?.providers || savedMapping?.provider, mapping.providers)
      };
    });
  } catch {
    return initialColumnMappings;
  }
};

const createItemCodeConditionalBranch = () => ({
  column: '',
  operator: 'contains',
  compare: '',
  outputType: 'default',
  outputValue: '',
  outputColumn: '',
});

const normalizeItemCodeConditionalBranches = (defaults = {}) => {
  const rawBranches = Array.isArray(defaults.itemCodeConditionalBranches)
    ? defaults.itemCodeConditionalBranches
    : [];
  if (rawBranches.length > 0) {
    return rawBranches.map(branch => ({
      ...createItemCodeConditionalBranch(),
      ...(branch && typeof branch === 'object' ? branch : {}),
    }));
  }

  return [{
    ...createItemCodeConditionalBranch(),
    column: defaults.itemCodeConditionSourceColumn || '',
    operator: defaults.itemCodeConditionOperator || 'contains',
    compare: defaults.itemCodeConditionText || '',
    outputType: defaults.itemCodeConditionValueSource || 'default',
    outputValue: defaults.itemCodeConditionDefaultValue || '',
    outputColumn: defaults.itemCodeConditionValueColumn || '',
  }];
};

const Settings = () => {
  const { tokens: t, isDarkMode } = useThemeContext();
  const [digikeyClientId, setDigikeyClientId] = useState('');
  const [digikeyClientSecret, setDigikeyClientSecret] = useState('');
  const [digikeyRedirectUri, setDigikeyRedirectUri] = useState('');
  const [mouserApiKey, setMouserApiKey] = useState('');
  const [element14ApiKey, setElement14ApiKey] = useState('');
  const [showDigikeySecret, setShowDigikeySecret] = useState(false);
  const [showMouserKey, setShowMouserKey] = useState(false);
  const [showElement14Key, setShowElement14Key] = useState(false);
  const [columnMappings, setColumnMappings] = useState(getInitialColumnMappings);
  const [itemDirectoryDefaults, setItemDirectoryDefaults] = useState(readItemDirectoryDefaults);
  const [itemDirectoryColumnOptions, setItemDirectoryColumnOptions] = useState(readItemDirectoryColumnOptions);
  const [credentialScopeId] = useState(getCredentialScopeId);
  const [providerStatus, setProviderStatus] = useState(emptyProviderStatus);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [deletingProvider, setDeletingProvider] = useState('');
  const [providerMessages, setProviderMessages] = useState({ digikey: null, mouser: null, element14: null });
  const [toast, setToast] = useState({ open: false, severity: 'success', message: '' });
  const [mousePos, setMousePos] = useState({ x: 50, y: 36 });
  const itemCodeContentType = itemDirectoryDefaults.itemCodeContentType || 'serial';
  const itemCodeRowsToUpdate = itemDirectoryDefaults.itemCodeRowsToUpdate || 'fill_empty';
  const itemCodeConditionalBranches = useMemo(
    () => normalizeItemCodeConditionalBranches(itemDirectoryDefaults),
    [itemDirectoryDefaults]
  );
  const itemCodeSourceColumnOptions = useMemo(() => {
    const savedColumns = [
      itemDirectoryDefaults.itemCodeCopyFromColumn,
      itemDirectoryDefaults.itemCodeJoinFirstColumn,
      itemDirectoryDefaults.itemCodeJoinSecondColumn,
      itemDirectoryDefaults.itemCodeConditionSourceColumn,
      itemDirectoryDefaults.itemCodeConditionValueColumn,
      itemDirectoryDefaults.itemCodeElseValueColumn,
      ...itemCodeConditionalBranches.flatMap(branch => [branch.column, branch.outputColumn]),
    ];
    const seen = new Set();
    return [...itemDirectoryColumnOptions, ...savedColumns]
      .map(value => String(value || '').trim())
      .filter(value => {
        if (!value || seen.has(value.toLowerCase())) return false;
        seen.add(value.toLowerCase());
        return true;
      });
  }, [itemDirectoryColumnOptions, itemDirectoryDefaults, itemCodeConditionalBranches]);

  // ─── SAVED COLUMN RULES ───────────────────────────────────────────────────
  // Same builder the editor's Fill / Create Column dialog uses; saving one
  // stores the rule payload so any session can replay it by name.
  const [columnRules, setColumnRules] = useState([]);
  const [columnRuleName, setColumnRuleName] = useState('');
  const [columnRuleDraft, setColumnRuleDraft] = useState(() => createEmptyColumnRule());
  const [columnRuleSaving, setColumnRuleSaving] = useState(false);

  const loadColumnRules = useCallback(async () => {
    try {
      const response = await api.getColumnRules();
      setColumnRules(response?.data?.rules || []);
    } catch (error) {
      console.error('Failed to load column rules:', error);
    }
  }, []);

  useEffect(() => { loadColumnRules(); }, [loadColumnRules]);

  // Arriving from the dashboard's Edit button — load that rule into the
  // builder and scroll to it, so Edit lands somewhere useful.
  const settingsLocation = useLocation();
  const requestedRuleId = settingsLocation.state?.editColumnRuleId;
  useEffect(() => {
    if (!requestedRuleId || columnRules.length === 0) return;
    const match = columnRules.find(r => String(r.id) === String(requestedRuleId));
    if (!match) return;
    setColumnRuleName(match.name);
    setColumnRuleDraft({ ...createEmptyColumnRule(), ...(match.rule || {}) });
    document.getElementById('column-rules-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [requestedRuleId, columnRules]);

  const handleSaveColumnRule = useCallback(async () => {
    const name = columnRuleName.trim();
    if (!name) return;
    setColumnRuleSaving(true);
    try {
      await api.saveColumnRule(name, '', columnRuleDraft);
      setColumnRuleName('');
      setColumnRuleDraft(createEmptyColumnRule());
      await loadColumnRules();
    } catch (error) {
      console.error('Failed to save column rule:', error);
      window.alert(error?.response?.data?.error || 'Could not save the rule.');
    } finally {
      setColumnRuleSaving(false);
    }
  }, [columnRuleName, columnRuleDraft, loadColumnRules]);

  const handleDeleteColumnRule = useCallback(async (ruleId) => {
    try {
      await api.deleteColumnRule(ruleId);
      await loadColumnRules();
    } catch (error) {
      console.error('Failed to delete column rule:', error);
    }
  }, [loadColumnRules]);

  const hasDigikey = Boolean(providerStatus.digikey?.configured);
  const hasMouser = Boolean(providerStatus.mouser?.configured);
  const hasElement14 = Boolean(providerStatus.element14?.configured);
  const hasAnyProvider = hasDigikey || hasMouser || hasElement14;

  // When embedded inside Factwise, distributor credentials are managed in
  // Factwise Admin and silently synced into this app's own store. Hide the
  // "API Providers" panel — the rest of Settings still works as normal.
  const {
    isEmbedded: isFactwiseEmbedded,
    entityName: factwiseEntityName,
    entities: factwiseEntities = [],
    chooseEntity,
    loadEntities,
  } = useFactwise();

  // The only screen that needs the entity list, so it is the only one that
  // asks for it — once, when it opens.
  useEffect(() => { loadEntities?.(); }, [loadEntities]);

  const readyCount = useMemo(
    () => columnMappings.filter(mapping => normalizeProviders(mapping.providers || mapping.provider).every(provider => Boolean(providerStatus[provider]?.configured))).length,
    [columnMappings, providerStatus]
  );

  const hasItemDirectoryDefaults = useMemo(() => (
    [
      'procurementEntityName',
      'itemType',
      'procurementItem',
      'salesItem',
      'itemCodePrefix',
      'itemCodeDefaultValue',
      'itemCodeCopyFromColumn',
      'itemCodeJoinFirstColumn',
      'itemCodeJoinSecondColumn',
      'itemCodeConditionSourceColumn',
      'itemCodeConditionDefaultValue',
      'itemCodeConditionValueColumn',
      'itemCodeElseDefaultValue',
      'itemCodeElseValueColumn',
      'measurementUnit',
    ]
      .some(key => String(itemDirectoryDefaults[key] || '').trim())
  ), [itemDirectoryDefaults]);

  useEffect(() => {
    const cleanEntityName = String(factwiseEntityName || '').trim();
    if (!cleanEntityName) return;
    let cancelled = false;
    setItemDirectoryDefaults(prev => {
      if (prev.procurementEntityName === cleanEntityName) return prev;
      const next = { ...prev, procurementEntityName: cleanEntityName };
      writeItemDirectoryDefaults(next);
      return next;
    });
    const loadEditorDefaults = async () => {
      try {
        const response = await api.getEditorDefaultSettings(cleanEntityName);
        if (cancelled || !response.data?.success) return;
        const existingDefaults = readItemDirectoryDefaults();
        const hasServerSettings = Boolean(response.data.settings?.updated_at);
        const next = hasServerSettings
          ? serverSettingsToItemDirectoryDefaults(response.data.settings, existingDefaults)
          : { ...existingDefaults, procurementEntityName: cleanEntityName };
        setItemDirectoryDefaults(next);
        writeItemDirectoryDefaults(next);

        // Defaults are stored per entity name. When the resolved entity changes
        // — which it does the moment a wrong name is corrected — the old row is
        // stranded under the old key and the settings look lost. Re-save what
        // is still in the browser under the entity now in force.
        const carriedOver = !hasServerSettings && [
          'itemType', 'procurementItem', 'salesItem', 'measurementUnit', 'itemCodeContentType',
        ].some(key => String(existingDefaults[key] || '').trim());
        if (carriedOver) {
          try {
            await api.saveEditorDefaultSettings(
              cleanEntityName,
              itemDirectoryDefaultsToServerSettings(normalizeItemDirectoryDefaultsForSave(next)),
            );
          } catch (_) {
            // Non-fatal: the browser copy still drives the editor.
          }
        }
      } catch (error) {
        if (!cancelled) {
          setToast({
            open: true,
            severity: 'warning',
            message: error.response?.data?.error || 'Could not load saved Item Directory defaults for this entity.',
          });
        }
      }
    };
    loadEditorDefaults();
    return () => {
      cancelled = true;
    };
  }, [factwiseEntityName]);

  useEffect(() => {
    const refreshColumnOptions = () => setItemDirectoryColumnOptions(readItemDirectoryColumnOptions());
    window.addEventListener('focus', refreshColumnOptions);
    return () => window.removeEventListener('focus', refreshColumnOptions);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event) => {
      setMousePos({
        x: (event.clientX / window.innerWidth) * 100,
        y: (event.clientY / window.innerHeight) * 100
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCredentials = async () => {
      setLoadingCredentials(true);
      try {
        const response = await api.getProviderCredentials(credentialScopeId);
        if (cancelled) return;
        const nextStatus = { ...emptyProviderStatus };
        (response.data.providers || []).forEach(provider => {
          nextStatus[provider.provider] = provider;
        });
        setProviderStatus(nextStatus);
        setDigikeyClientId(nextStatus.digikey?.public?.client_id || '');
        setDigikeyRedirectUri(nextStatus.digikey?.public?.redirect_uri || '');
        setDigikeyClientSecret(nextStatus.digikey?.masked?.client_secret ? MASK_VALUE : '');
        setMouserApiKey(nextStatus.mouser?.masked?.api_key ? MASK_VALUE : '');
        setElement14ApiKey(nextStatus.element14?.masked?.api_key ? MASK_VALUE : '');
      } catch (error) {
        if (!cancelled) {
          setToast({ open: true, severity: 'error', message: error.response?.data?.error || 'Failed to load provider settings.' });
        }
      } finally {
        if (!cancelled) setLoadingCredentials(false);
      }
    };
    loadCredentials();
    return () => {
      cancelled = true;
    };
  }, [credentialScopeId]);

  const pageSx = {
    minHeight: '100vh',
    px: { xs: 2, md: 3 },
    py: { xs: 2, md: 2.5 },
    bgcolor: t.background.app,
    color: t.text.primary,
    position: 'relative',
    overflow: 'hidden',
    '& > *': { position: 'relative', zIndex: 1 }
  };

  const panelSx = {
    borderRadius: '16px',
    border: `1px solid ${t.border.default}`,
    background: t.surface.elevatedGradient,
    boxShadow: t.shadow.card,
    overflow: 'hidden'
  };

  const sectionHeaderSx = {
    px: 2.5,
    py: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    borderBottom: `1px solid ${t.border.subtle}`,
    bgcolor: isDarkMode ? 'rgba(2, 6, 23, 0.28)' : 'rgba(248, 250, 252, 0.78)'
  };

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '12px',
      bgcolor: t.surface.input,
      fontSize: 14
    },
    '& .MuiFormHelperText-root': {
      color: t.text.secondary
    }
  };

  const secretInputSx = {
    ...fieldSx
  };

  const providerLabel = (provider) => providerMeta[provider]?.label || provider;

  const setProviderMessage = (provider, type, message) => {
    setProviderMessages(prev => ({ ...prev, [provider]: message ? { type, message } : null }));
  };

  const isSavedMaskedValue = (value, provider, field) => (
    value === MASK_VALUE || Boolean(providerStatus[provider]?.masked?.[field] && value === providerStatus[provider].masked[field])
  );

  const setMaskedFieldsFromStatus = (nextStatus) => {
    if (nextStatus.digikey?.masked?.client_secret) setDigikeyClientSecret(MASK_VALUE);
    if (nextStatus.mouser?.masked?.api_key) setMouserApiKey(MASK_VALUE);
    if (nextStatus.element14?.masked?.api_key) setElement14ApiKey(MASK_VALUE);
  };

  const toggleSavedSecretVisibility = (provider) => {
    if (provider === 'digikey') {
      const saved = providerStatus.digikey?.masked?.client_secret || '';
      if (isSavedMaskedValue(digikeyClientSecret, 'digikey', 'client_secret') && saved) {
        setDigikeyClientSecret(showDigikeySecret ? MASK_VALUE : saved);
      }
      setShowDigikeySecret(prev => !prev);
    } else if (provider === 'mouser') {
      const saved = providerStatus.mouser?.masked?.api_key || '';
      if (isSavedMaskedValue(mouserApiKey, 'mouser', 'api_key') && saved) {
        setMouserApiKey(showMouserKey ? MASK_VALUE : saved);
      }
      setShowMouserKey(prev => !prev);
    } else if (provider === 'element14') {
      const saved = providerStatus.element14?.masked?.api_key || '';
      if (isSavedMaskedValue(element14ApiKey, 'element14', 'api_key') && saved) {
        setElement14ApiKey(showElement14Key ? MASK_VALUE : saved);
      }
      setShowElement14Key(prev => !prev);
    }
  };

  const buildProviderPayload = () => {
    const shouldSendSecret = (value, provider, field) => String(value || '').trim() && !isSavedMaskedValue(value, provider, field);
    return {
      digikey: {
        client_id: digikeyClientId,
        redirect_uri: digikeyRedirectUri,
        ...(shouldSendSecret(digikeyClientSecret, 'digikey', 'client_secret') ? { client_secret: digikeyClientSecret } : {})
      },
      mouser: {
        ...(shouldSendSecret(mouserApiKey, 'mouser', 'api_key') ? { api_key: mouserApiKey } : {})
      },
      element14: {
        ...(shouldSendSecret(element14ApiKey, 'element14', 'api_key') ? { api_key: element14ApiKey } : {})
      }
    };
  };

  const hasProviderRequiredDetails = (provider) => {
    if (provider === 'digikey') return Boolean(digikeyClientId && (digikeyClientSecret || providerStatus.digikey?.has_credentials));
    if (provider === 'mouser') return Boolean(mouserApiKey || providerStatus.mouser?.has_credentials);
    if (provider === 'element14') return Boolean(element14ApiKey || providerStatus.element14?.has_credentials);
    return false;
  };

  const providerChip = (configured) => (
    <Chip
      size="small"
      icon={configured ? <CheckCircleIcon /> : <ErrorIcon />}
      label={configured ? 'Configured' : 'Not configured'}
      sx={{
        height: 22,
        fontWeight: 650,
        fontSize: 11.5,
        color: configured ? t.color.successText : t.text.secondary,
        bgcolor: configured ? t.state.successBg : t.surface.controlSoft,
        border: `1px solid ${configured ? t.state.successBorder : t.border.default}`,
        '& .MuiChip-icon': { color: configured ? t.color.success : t.text.secondary }
      }}
    />
  );

  const handleColumnProviderChange = (columnName, providers) => {
    const selected = normalizeProviders(typeof providers === 'string' ? providers.split(',') : providers);
    setColumnMappings(prev => {
      const next = prev.map(mapping => mapping.column === columnName ? { ...mapping, providers: selected } : mapping);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLUMN_PROVIDER_MAPPINGS_KEY, JSON.stringify(next));
        window.localStorage.setItem(VALIDATION_PROVIDERS_KEY, JSON.stringify(providersFromColumnMappings(next)));
      }
      return next;
    });
  };

  const handleItemDirectoryDefaultChange = (key, value) => {
    setItemDirectoryDefaults(prev => ({ ...prev, [key]: value }));
  };

  const syncFirstConditionalBranchFields = (branches, extra = {}) => {
    const first = branches[0] || createItemCodeConditionalBranch();
    return {
      itemCodeConditionalBranches: branches,
      itemCodeConditionSourceColumn: first.column || '',
      itemCodeConditionOperator: first.operator || 'contains',
      itemCodeConditionText: first.compare || '',
      itemCodeConditionValueSource: first.outputType || 'default',
      itemCodeConditionDefaultValue: first.outputValue || '',
      itemCodeConditionValueColumn: first.outputColumn || '',
      ...extra,
    };
  };

  const updateItemCodeConditionalBranch = (branchIndex, patch) => {
    const nextBranches = itemCodeConditionalBranches.map((branch, index) => (
      index === branchIndex ? { ...branch, ...patch } : branch
    ));
    setItemDirectoryDefaults(prev => ({
      ...prev,
      ...syncFirstConditionalBranchFields(nextBranches),
    }));
  };

  const addItemCodeConditionalBranch = () => {
    const nextBranches = [...itemCodeConditionalBranches, createItemCodeConditionalBranch()];
    setItemDirectoryDefaults(prev => ({
      ...prev,
      ...syncFirstConditionalBranchFields(nextBranches),
    }));
  };

  const removeItemCodeConditionalBranch = (branchIndex) => {
    const nextBranches = itemCodeConditionalBranches.filter((_, index) => index !== branchIndex);
    setItemDirectoryDefaults(prev => ({
      ...prev,
      ...syncFirstConditionalBranchFields(nextBranches.length ? nextBranches : [createItemCodeConditionalBranch()]),
    }));
  };

  const handleClearItemDirectoryDefaults = () => {
    const cleared = Object.fromEntries(ITEM_DIRECTORY_DEFAULTS.map(item => [item.key, '']));
    const cleanEntityName = String(factwiseEntityName || '').trim();
    if (cleanEntityName) {
      cleared.procurementEntityName = cleanEntityName;
    }
    setItemDirectoryDefaults(cleared);
    writeItemDirectoryDefaults(cleared);
    setToast({ open: true, severity: 'success', message: 'Item Directory defaults cleared.' });
  };

  const handleSaveSettings = async () => {
    const hasAnyEntered = hasProviderRequiredDetails('digikey') || hasProviderRequiredDetails('mouser') || hasProviderRequiredDetails('element14');
    if (!hasAnyEntered && !hasItemDirectoryDefaults) {
      setToast({ open: true, severity: 'error', message: 'Enter at least one provider credential before saving.' });
      return;
    }

    const selectedProviders = providersFromColumnMappings(columnMappings);
    const invalidProviders = selectedProviders.filter(provider => !hasProviderRequiredDetails(provider));

    if (hasAnyEntered && invalidProviders.length > 0) {
      setToast({
        open: true,
        severity: 'error',
        message: `Column mappings use providers without credentials: ${invalidProviders.map(providerLabel).join(', ')}`
      });
      return;
    }

    setSavingSettings(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLUMN_PROVIDER_MAPPINGS_KEY, JSON.stringify(columnMappings));
        window.localStorage.setItem(VALIDATION_PROVIDERS_KEY, JSON.stringify(selectedProviders));
      }
      const cleanEntityName = String(factwiseEntityName || itemDirectoryDefaults.procurementEntityName || '').trim();
      const defaultsToSave = normalizeItemDirectoryDefaultsForSave(itemDirectoryDefaults);
      if (cleanEntityName) {
        const response = await api.saveEditorDefaultSettings(
          cleanEntityName,
          itemDirectoryDefaultsToServerSettings(defaultsToSave)
        );
        if (response.data?.settings) {
          const next = serverSettingsToItemDirectoryDefaults(response.data.settings, {
            ...defaultsToSave,
            procurementEntityName: cleanEntityName,
          });
          setItemDirectoryDefaults(next);
          writeItemDirectoryDefaults(next);
        } else {
          writeItemDirectoryDefaults({ ...defaultsToSave, procurementEntityName: cleanEntityName });
        }
      } else {
        writeItemDirectoryDefaults(defaultsToSave);
      }
      if (!hasAnyEntered) {
        setToast({ open: true, severity: 'success', message: 'Item Directory defaults saved successfully' });
        return;
      }
      const response = await api.saveProviderCredentials(credentialScopeId, buildProviderPayload());
      const nextStatus = { ...providerStatus };
      (response.data.providers || []).forEach(provider => {
        nextStatus[provider.provider] = provider;
      });
      setProviderStatus(nextStatus);
      setMaskedFieldsFromStatus(nextStatus);
      setToast({ open: true, severity: 'success', message: 'Settings saved successfully' });
    } catch (error) {
      setToast({ open: true, severity: 'error', message: error.response?.data?.error || 'Failed to save provider settings.' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestProvider = async (provider) => {
    if (!hasProviderRequiredDetails(provider)) {
      setProviderMessage(provider, 'error', 'Enter the required details before testing.');
      return;
    }

    const providerPayload = buildProviderPayload()[provider] || {};
    const hasInputToSave = Object.values(providerPayload).some(value => String(value || '').trim());
    setTestingProvider(provider);
    setProviderMessage(provider, null, '');
    try {
      if (hasInputToSave) {
        const saveResponse = await api.saveProviderCredentials(credentialScopeId, { [provider]: providerPayload });
        const nextStatus = { ...providerStatus };
        (saveResponse.data.providers || []).forEach(item => {
          nextStatus[item.provider] = item;
        });
        setProviderStatus(nextStatus);
        setMaskedFieldsFromStatus(nextStatus);
      }

      const response = await api.testProviderCredential(provider, credentialScopeId);
      if (response.data.provider_status) {
        setProviderStatus(prev => ({ ...prev, [provider]: response.data.provider_status }));
      }
      setToast({ open: true, severity: 'success', message: `${providerLabel(provider)} configured successfully` });
    } catch (error) {
      const providerStatusUpdate = error.response?.data?.provider_status;
      if (providerStatusUpdate) {
        setProviderStatus(prev => ({ ...prev, [provider]: providerStatusUpdate }));
      }
      setProviderMessage(provider, 'error', error.response?.data?.error || error.response?.data?.message || 'Details unverified. Please check the entered details.');
    } finally {
      setTestingProvider('');
    }
  };

  const handleDeleteProvider = async (provider) => {
    setDeletingProvider(provider);
    try {
      await api.deleteProviderCredential(provider, credentialScopeId);
      setProviderStatus(prev => ({ ...prev, [provider]: { ...emptyProviderStatus[provider] } }));
      setProviderMessage(provider, null, '');
      if (provider === 'digikey') {
        setDigikeyClientId('');
        setDigikeyClientSecret('');
        setDigikeyRedirectUri('');
      } else if (provider === 'mouser') {
        setMouserApiKey('');
      } else if (provider === 'element14') {
        setElement14ApiKey('');
      }
      setToast({ open: true, severity: 'success', message: `${providerLabel(provider)} removed successfully` });
    } catch (error) {
      setToast({ open: true, severity: 'error', message: error.response?.data?.error || `Failed to remove ${providerLabel(provider)}.` });
    } finally {
      setDeletingProvider('');
    }
  };

  const renderProviderCard = ({
    provider,
    title,
    description,
    configured,
    children
  }) => {
    const meta = providerMeta[provider];
    const ProviderIcon = meta.Icon || VpnKeyIcon;
    const message = providerMessages[provider];
    const minCardHeight = provider === 'digikey' ? 334 : 168;
    return (
      <Paper elevation={0} sx={{ p: 2.25, minHeight: minCardHeight, height: provider === 'digikey' ? '100%' : 'auto', borderRadius: '14px', border: `1px solid ${t.border.subtle}`, bgcolor: t.surface.panel, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 1.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: meta.soft, color: meta.color }}>
              <ProviderIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 650, color: t.text.heading, lineHeight: 1.25 }}>{title}</Typography>
              {description && (
                <Typography sx={{ fontSize: 12.5, color: t.text.secondary, mt: 0.25, lineHeight: 1.35 }}>{description}</Typography>
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {providerChip(configured)}
            {message?.type === 'error' && (
              <Chip
                size="small"
                icon={<ErrorIcon />}
                label={message.message}
                color="error"
                variant="outlined"
                sx={{ maxWidth: 340, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
            )}
          </Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          {children}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, justifyContent: 'flex-end', mt: provider === 'digikey' ? 'auto' : 1.75, pt: provider === 'digikey' ? 2 : 0 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => handleTestProvider(provider)}
              disabled={Boolean(testingProvider || deletingProvider) || !hasProviderRequiredDetails(provider)}
              startIcon={testingProvider === provider ? <CircularProgress size={14} /> : <CheckCircleIcon />}
            >
              Test
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={() => handleDeleteProvider(provider)}
              disabled={Boolean(deletingProvider) || !providerStatus[provider]?.has_credentials}
              startIcon={deletingProvider === provider ? <CircularProgress size={14} /> : <DeleteIcon />}
            >
              Remove
            </Button>
          </Stack>
      </Paper>
    );
  };

  return (
    <Box sx={pageSx}>
      <Box
        sx={{
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '50%',
          opacity: 0.36,
          width: '62vw',
          height: '62vw',
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(90px)',
          background: 'radial-gradient(circle, var(--color-brand, #2383e2) 0%, transparent 70%)',
          zIndex: 0
        }}
      />
      <Box
        className="auth-grid-pattern"
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.45, zIndex: 0 }}
      />
      <Box sx={{ maxWidth: 1320, mx: 'auto' }}>
        <Box sx={{ mb: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
          <Box>
            <Typography sx={{ fontSize: { xs: 26, md: 30 }, fontWeight: 700, letterSpacing: 0, color: t.text.heading, lineHeight: 1.1 }}>
              Settings
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip label={`${readyCount}/${columnMappings.length} columns ready`} size="small" sx={{ height: 24, fontWeight: 650, fontSize: 11.5, bgcolor: t.action.primarySoft, color: t.color.primarySoftText }} />
            <Chip label={hasAnyProvider ? 'Provider available' : 'Setup required'} size="small" sx={{ height: 24, fontWeight: 650, fontSize: 11.5, bgcolor: hasAnyProvider ? t.state.successBg : t.state.warningBg, color: hasAnyProvider ? t.color.successText : t.color.warningText }} />
          </Stack>
        </Box>

        <Grid container spacing={2.5}>
          {isFactwiseEmbedded && (
            <Grid item xs={12}>
              <Paper
                elevation={0}
                sx={{
                  px: 2.25,
                  py: 1.5,
                  borderRadius: '12px',
                  border: `1px solid ${t.border.subtle}`,
                  bgcolor: t.surface.panel,
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1.25,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    color: t.text.secondary,
                    mr: 0.5,
                  }}
                >
                  API keys managed in Factwise
                </Typography>
                {ALL_PROVIDERS.map((provider) => {
                  const connected = Boolean(providerStatus[provider]?.configured);
                  const label = providerMeta[provider]?.label || provider;
                  return (
                    <Chip
                      key={provider}
                      size="small"
                      icon={connected ? <CheckCircleIcon /> : <ErrorIcon />}
                      label={`${label}: ${connected ? 'Connected' : 'Not connected'}`}
                      sx={{
                        height: 22,
                        fontWeight: 650,
                        fontSize: 11.5,
                        color: connected ? t.color.successText : t.text.secondary,
                        bgcolor: connected ? t.state.successBg : t.surface.controlSoft,
                        border: `1px solid ${connected ? t.state.successBorder : t.border.default}`,
                        '& .MuiChip-icon': {
                          color: connected ? t.color.success : t.text.secondary,
                        },
                      }}
                    />
                  );
                })}
              </Paper>
            </Grid>
          )}
          {!isFactwiseEmbedded && (
          <Grid item xs={12}>
            <Paper elevation={0} sx={panelSx}>
              <Box sx={sectionHeaderSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: t.action.primarySoft, color: t.color.primaryLight }}>
                    <HubIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: t.text.heading }}>API Providers</Typography>
                  </Box>
                </Box>
                {loadingCredentials && <CircularProgress size={20} />}
              </Box>

              <Box sx={{ p: 2.5 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} lg={7} sx={{ display: 'flex' }}>
                    {renderProviderCard({
                      provider: 'digikey',
                      title: 'DigiKey API',
                      description: '',
                      configured: hasDigikey,
                      children: (
                        <Grid container columnSpacing={1.75} rowSpacing={2.25} sx={{ alignContent: 'flex-start' }}>
                          <Grid item xs={12} md={6}>
                            <TextField fullWidth size="small" label="Client ID" value={digikeyClientId} onChange={(e) => setDigikeyClientId(e.target.value)} placeholder="Enter client ID" sx={fieldSx} />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              size="small"
                              label="Client Secret"
                              type={showDigikeySecret ? 'text' : 'password'}
                              value={digikeyClientSecret}
                              onChange={(e) => setDigikeyClientSecret(e.target.value)}
                              onFocus={() => {
                                if (isSavedMaskedValue(digikeyClientSecret, 'digikey', 'client_secret')) setDigikeyClientSecret('');
                              }}
                              placeholder="Enter client secret"
                              helperText={providerStatus.digikey?.has_credentials ? 'Saved secret is hidden. Type a new value to replace it.' : ''}
                              sx={secretInputSx}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton onClick={() => toggleSavedSecretVisibility('digikey')} edge="end" size="small">
                                      {showDigikeySecret ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                  </InputAdornment>
                                )
                              }}
                            />
                          </Grid>
                          <Grid item xs={12} sx={{ mt: 0.25 }}>
                            <TextField fullWidth size="small" label="Redirect URI" value={digikeyRedirectUri} onChange={(e) => setDigikeyRedirectUri(e.target.value)} placeholder="https://your-app.com/api/mpn/oauth/callback" helperText="Must match the callback URL in DigiKey app settings." sx={fieldSx} />
                          </Grid>
                        </Grid>
                      )
                    })}
                  </Grid>

                  <Grid item xs={12} lg={5}>
                    <Stack spacing={2}>
                      {renderProviderCard({
                        provider: 'mouser',
                        title: 'Mouser API',
                        description: '',
                        configured: hasMouser,
                        children: (
                          <TextField
                            fullWidth
                            size="small"
                            label="API Key"
                            type={showMouserKey ? 'text' : 'password'}
                            value={mouserApiKey}
                            onChange={(e) => setMouserApiKey(e.target.value)}
                            onFocus={() => {
                              if (isSavedMaskedValue(mouserApiKey, 'mouser', 'api_key')) setMouserApiKey('');
                            }}
                            placeholder="Enter Mouser API key"
                            helperText={providerStatus.mouser?.has_credentials ? 'Saved key is hidden. Type a new value to replace it.' : 'Available from the Mouser developer portal.'}
                            sx={secretInputSx}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton onClick={() => toggleSavedSecretVisibility('mouser')} edge="end" size="small">
                                    {showMouserKey ? <VisibilityOff /> : <Visibility />}
                                  </IconButton>
                                </InputAdornment>
                              )
                            }}
                          />
                        )
                      })}
                      {renderProviderCard({
                        provider: 'element14',
                        title: 'Element14 API',
                        description: '',
                        configured: hasElement14,
                        children: (
                          <TextField
                            fullWidth
                            size="small"
                            label="API Key"
                            type={showElement14Key ? 'text' : 'password'}
                            value={element14ApiKey}
                            onChange={(e) => setElement14ApiKey(e.target.value)}
                            onFocus={() => {
                              if (isSavedMaskedValue(element14ApiKey, 'element14', 'api_key')) setElement14ApiKey('');
                            }}
                            placeholder="Enter Element14 API key"
                            helperText={providerStatus.element14?.has_credentials ? 'Saved key is hidden. Type a new value to replace it.' : 'Available from the Element14 developer portal.'}
                            sx={secretInputSx}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton onClick={() => toggleSavedSecretVisibility('element14')} edge="end" size="small">
                                    {showElement14Key ? <VisibilityOff /> : <Visibility />}
                                  </IconButton>
                                </InputAdornment>
                              )
                            }}
                          />
                        )
                      })}
                    </Stack>
                  </Grid>
                </Grid>
              </Box>
            </Paper>
          </Grid>
          )}

          <Grid item xs={12}>
            <Paper elevation={0} sx={panelSx}>
              <Box sx={sectionHeaderSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: t.action.primarySoft, color: t.color.primaryLight }}>
                    <TableChartIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: t.text.heading }}>Item Directory Defaults</Typography>
                    <Typography sx={{ mt: 0.25, fontSize: 12.5, color: t.text.secondary }}>
                      Used to fill recurring required fields before exporting to FactWise.
                    </Typography>
                  </Box>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={handleClearItemDirectoryDefaults}
                  disabled={!hasItemDirectoryDefaults}
                  sx={{ borderRadius: '999px', fontWeight: 700, textTransform: 'none' }}
                >
                  Clear
                </Button>
              </Box>

              <Box sx={{ p: 2.5 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6} md={2.4}>
                    {/* One entity needs no choice and stays read-only. Two or
                        more has to be asked: the name goes on every exported
                        row, and FactWise rejects one it does not own. */}
                    {factwiseEntities.length > 1 ? (
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Procurement entity"
                        value={factwiseEntities.some(e => e.name === itemDirectoryDefaults.procurementEntityName)
                          ? itemDirectoryDefaults.procurementEntityName
                          : ''}
                        onChange={(event) => {
                          const picked = factwiseEntities.find(e => e.name === event.target.value);
                          if (picked) chooseEntity(picked);
                          handleItemDirectoryDefaultChange('procurementEntityName', event.target.value);
                        }}
                        helperText={`${factwiseEntities.length} entities on this account`}
                        sx={fieldSx}
                      >
                        {factwiseEntities.map(entity => (
                          <MenuItem key={entity.id || entity.name} value={entity.name}>{entity.name}</MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <TextField
                        fullWidth
                        size="small"
                        label="Procurement entity name"
                        value={itemDirectoryDefaults.procurementEntityName || ''}
                        onChange={(event) => {
                          if (!factwiseEntityName) {
                            handleItemDirectoryDefaultChange('procurementEntityName', event.target.value);
                          }
                        }}
                        placeholder={factwiseEntityName ? '' : 'Waiting for FactWise entity name'}
                        InputProps={{ readOnly: Boolean(factwiseEntityName) }}
                        sx={fieldSx}
                      />
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6} md={2.4}>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Item type"
                      value={itemDirectoryDefaults.itemType || ''}
                      onChange={(event) => handleItemDirectoryDefaultChange('itemType', event.target.value)}
                      sx={fieldSx}
                    >
                      {ITEM_TYPE_OPTIONS.map(option => (
                        <MenuItem key={option} value={option}>{option}</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  {[
                    { key: 'procurementItem', label: 'Procurement item' },
                    { key: 'salesItem', label: 'Sales item' },
                  ].map((item) => (
                    <Grid item xs={12} sm={6} md={2.4} key={item.key}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label={item.label}
                        value={itemDirectoryDefaults[item.key] || ''}
                        onChange={(event) => handleItemDirectoryDefaultChange(item.key, event.target.value)}
                        sx={fieldSx}
                      >
                        <MenuItem value="TRUE">TRUE</MenuItem>
                        <MenuItem value="FALSE">FALSE</MenuItem>
                      </TextField>
                    </Grid>
                  ))}

                  <Grid item xs={12} sm={6} md={2.4}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Measurement unit"
                      value={itemDirectoryDefaults.measurementUnit || ''}
                      onChange={(event) => handleItemDirectoryDefaultChange('measurementUnit', event.target.value)}
                      placeholder="Example: EA"
                      sx={fieldSx}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Paper elevation={0} sx={{ p: 2.25, borderRadius: '14px', border: `1px solid ${t.border.subtle}`, bgcolor: t.surface.panel }}>
                      <Typography sx={{ fontSize: 16, fontWeight: 400, color: t.text.heading, mb: 3 }}>
                        Item code behavior
                      </Typography>
                      <Grid container spacing={1.5}>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="How to set the value"
                            value={itemCodeContentType}
                            onChange={(event) => handleItemDirectoryDefaultChange('itemCodeContentType', event.target.value)}
                            sx={fieldSx}
                          >
                            {ITEM_CODE_CONTENT_TYPE_OPTIONS.map(option => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="Rows to update"
                            value={itemCodeRowsToUpdate}
                            onChange={(event) => handleItemDirectoryDefaultChange('itemCodeRowsToUpdate', event.target.value)}
                            sx={fieldSx}
                          >
                            {ITEM_CODE_ROWS_TO_UPDATE_OPTIONS.map(option => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                        </Grid>
                        {itemCodeContentType === 'fixed' && (
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              size="small"
                              label="Value"
                              value={itemDirectoryDefaults.itemCodeDefaultValue || ''}
                              onChange={(event) => handleItemDirectoryDefaultChange('itemCodeDefaultValue', event.target.value)}
                              sx={fieldSx}
                            />
                          </Grid>
                        )}
                        {itemCodeContentType === 'copy' && (
                          <Grid item xs={12}>
                            <TextField
                              select
                              fullWidth
                              size="small"
                              label="Copy from"
                              value={itemDirectoryDefaults.itemCodeCopyFromColumn || ''}
                              onChange={(event) => handleItemDirectoryDefaultChange('itemCodeCopyFromColumn', event.target.value)}
                              sx={fieldSx}
                            >
                              <MenuItem value="">Select source column</MenuItem>
                              {itemCodeSourceColumnOptions.map(option => (
                                <MenuItem key={option} value={option}>{option}</MenuItem>
                              ))}
                            </TextField>
                          </Grid>
                        )}
                        {itemCodeContentType === 'concat' && (
                          <>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                select
                                fullWidth
                                size="small"
                                label="First column"
                                value={itemDirectoryDefaults.itemCodeJoinFirstColumn || ''}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodeJoinFirstColumn', event.target.value)}
                                sx={fieldSx}
                              >
                                <MenuItem value="">Select first column</MenuItem>
                                {itemCodeSourceColumnOptions.map(option => (
                                  <MenuItem key={option} value={option}>{option}</MenuItem>
                                ))}
                              </TextField>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                select
                                fullWidth
                                size="small"
                                label="Second column"
                                value={itemDirectoryDefaults.itemCodeJoinSecondColumn || ''}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodeJoinSecondColumn', event.target.value)}
                                sx={fieldSx}
                              >
                                <MenuItem value="">Select second column</MenuItem>
                                {itemCodeSourceColumnOptions.map(option => (
                                  <MenuItem key={option} value={option}>{option}</MenuItem>
                                ))}
                              </TextField>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                select
                                fullWidth
                                size="small"
                                label="Separator"
                                value={itemDirectoryDefaults.itemCodeJoinSeparatorMode || 'space'}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodeJoinSeparatorMode', event.target.value)}
                                sx={fieldSx}
                              >
                                {ITEM_CODE_SEPARATOR_OPTIONS.map(option => (
                                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                                ))}
                              </TextField>
                            </Grid>
                            {(itemDirectoryDefaults.itemCodeJoinSeparatorMode || 'space') === 'custom' && (
                              <Grid item xs={12}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Custom separator"
                                  value={itemDirectoryDefaults.itemCodeJoinCustomSeparator || ''}
                                  onChange={(event) => handleItemDirectoryDefaultChange('itemCodeJoinCustomSeparator', event.target.value)}
                                  sx={fieldSx}
                                />
                              </Grid>
                            )}
                          </>
                        )}
                        {itemCodeContentType === 'conditional' && (
                          <Grid item xs={12}>
                            <Box sx={{ p: 2, borderRadius: '12px', border: `1px solid ${t.border.subtle}`, bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.26)' : '#ffffff' }}>
                              {itemCodeConditionalBranches.map((branch, branchIndex) => (
                                <Box
                                  key={branchIndex}
                                  sx={{
                                    pb: 1.75,
                                    mb: 1.75,
                                    borderBottom: `1px solid ${t.border.subtle}`,
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: t.text.heading }}>
                                      {branchIndex === 0 ? 'If' : 'Else if'} condition {branchIndex + 1}
                                    </Typography>
                                    {itemCodeConditionalBranches.length > 1 && (
                                      <IconButton size="small" onClick={() => removeItemCodeConditionalBranch(branchIndex)}>
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    )}
                                  </Box>
                                  <Grid container spacing={1.5}>
                                    <Grid item xs={12} sm={5}>
                                      <TextField
                                        select
                                        fullWidth
                                        size="small"
                                        label="Source column"
                                        value={branch.column || ''}
                                        onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { column: event.target.value })}
                                        sx={fieldSx}
                                      >
                                        <MenuItem value="">Source column</MenuItem>
                                        {itemCodeSourceColumnOptions.map(option => (
                                          <MenuItem key={option} value={option}>{option}</MenuItem>
                                        ))}
                                      </TextField>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                      <TextField
                                        select
                                        fullWidth
                                        size="small"
                                        label="Condition"
                                        value={branch.operator || 'contains'}
                                        onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { operator: event.target.value })}
                                        sx={fieldSx}
                                      >
                                        {ITEM_CODE_CONDITION_OPTIONS.map(option => (
                                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                                        ))}
                                      </TextField>
                                    </Grid>
                                    {['equals', 'not_equals', 'contains'].includes(branch.operator || 'contains') && (
                                      <Grid item xs={12} sm={4}>
                                        <TextField
                                          fullWidth
                                          size="small"
                                          label="Text"
                                          value={branch.compare || ''}
                                          onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { compare: event.target.value })}
                                          sx={fieldSx}
                                        />
                                      </Grid>
                                    )}
                                    <Grid item xs={12} sm={2}>
                                      <Typography sx={{ pt: 1.25, fontSize: 14, fontWeight: 700, color: t.text.heading }}>
                                        Then use
                                      </Typography>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                      <TextField
                                        select
                                        fullWidth
                                        size="small"
                                        label="Value source"
                                        value={branch.outputType || 'default'}
                                        onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { outputType: event.target.value })}
                                        sx={fieldSx}
                                      >
                                        {ITEM_CODE_VALUE_SOURCE_OPTIONS.map(option => (
                                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                                        ))}
                                      </TextField>
                                    </Grid>
                                    {(branch.outputType || 'default') === 'column' ? (
                                      <Grid item xs={12} sm={7}>
                                        <TextField
                                          select
                                          fullWidth
                                          size="small"
                                          label="Column to copy from"
                                          value={branch.outputColumn || ''}
                                          onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { outputColumn: event.target.value })}
                                          sx={fieldSx}
                                        >
                                          <MenuItem value="">Column to copy from</MenuItem>
                                          {itemCodeSourceColumnOptions.map(option => (
                                            <MenuItem key={option} value={option}>{option}</MenuItem>
                                          ))}
                                        </TextField>
                                      </Grid>
                                    ) : (branch.outputType || 'default') === 'default' ? (
                                      <Grid item xs={12} sm={7}>
                                        <TextField
                                          fullWidth
                                          size="small"
                                          label="Default value"
                                          value={branch.outputValue || ''}
                                          onChange={(event) => updateItemCodeConditionalBranch(branchIndex, { outputValue: event.target.value })}
                                          sx={fieldSx}
                                        />
                                      </Grid>
                                    ) : null}
                                  </Grid>
                                </Box>
                              ))}
                              <Button
                                size="small"
                                startIcon={<AddIcon />}
                                onClick={addItemCodeConditionalBranch}
                                sx={{ mb: 1.75, fontWeight: 700, textTransform: 'none' }}
                              >
                                Add another condition
                              </Button>
                              <Grid container spacing={1.5} alignItems="center">
                                <Grid item xs={12} sm={2}>
                                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: t.text.heading }}>
                                    Otherwise
                                  </Typography>
                                </Grid>
                                <Grid item xs={12} sm={3}>
                                  <TextField
                                    select
                                    fullWidth
                                    size="small"
                                    label="Value source"
                                    value={itemDirectoryDefaults.itemCodeElseValueSource || 'default'}
                                    onChange={(event) => handleItemDirectoryDefaultChange('itemCodeElseValueSource', event.target.value)}
                                    sx={fieldSx}
                                  >
                                    {ITEM_CODE_VALUE_SOURCE_OPTIONS.map(option => (
                                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                                    ))}
                                  </TextField>
                                </Grid>
                                {(itemDirectoryDefaults.itemCodeElseValueSource || 'default') === 'column' ? (
                                  <Grid item xs={12} sm={7}>
                                    <TextField
                                      select
                                      fullWidth
                                      size="small"
                                      label="Column to copy from"
                                      value={itemDirectoryDefaults.itemCodeElseValueColumn || ''}
                                      onChange={(event) => handleItemDirectoryDefaultChange('itemCodeElseValueColumn', event.target.value)}
                                      sx={fieldSx}
                                    >
                                      <MenuItem value="">Column to copy from</MenuItem>
                                      {itemCodeSourceColumnOptions.map(option => (
                                        <MenuItem key={option} value={option}>{option}</MenuItem>
                                      ))}
                                    </TextField>
                                  </Grid>
                                ) : (itemDirectoryDefaults.itemCodeElseValueSource || 'default') === 'default' ? (
                                  <Grid item xs={12} sm={7}>
                                    <TextField
                                      fullWidth
                                      size="small"
                                      label="Default value"
                                      placeholder="Leave blank to keep the current value"
                                      value={itemDirectoryDefaults.itemCodeElseDefaultValue || ''}
                                      onChange={(event) => handleItemDirectoryDefaultChange('itemCodeElseDefaultValue', event.target.value)}
                                      sx={fieldSx}
                                    />
                                  </Grid>
                                ) : null}
                              </Grid>
                            </Box>
                          </Grid>
                        )}
                        {itemCodeContentType === 'serial' && (
                          <>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Prefix"
                                value={itemDirectoryDefaults.itemCodePrefix || ''}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodePrefix', event.target.value)}
                                helperText="Creates values like ITEM01."
                                sx={fieldSx}
                              />
                            </Grid>
                            <Grid item xs={6} sm={4}>
                              <TextField
                                fullWidth
                                size="small"
                                type="number"
                                label="Start at"
                                value={itemDirectoryDefaults.itemCodeStart || '1'}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodeStart', event.target.value)}
                                sx={fieldSx}
                              />
                            </Grid>
                            <Grid item xs={6} sm={4}>
                              <TextField
                                fullWidth
                                size="small"
                                type="number"
                                label="Number padding"
                                value={itemDirectoryDefaults.itemCodePadding || '3'}
                                onChange={(event) => handleItemDirectoryDefaultChange('itemCodePadding', event.target.value)}
                                sx={fieldSx}
                              />
                            </Grid>
                            <Grid item xs={12}>
                              <FormControlLabel
                                control={(
                                  <Checkbox
                                    size="small"
                                    checked
                                    disabled
                                    onChange={(event) => handleItemDirectoryDefaultChange('itemCodeIncrement', event.target.checked)}
                                  />
                                )}
                                label="Increment for each row"
                                sx={{
                                  color: t.text.primary,
                                  '& .MuiFormControlLabel-label': {
                                    fontSize: 14,
                                  },
                                }}
                              />
                              <Typography variant="caption" sx={{ display: 'block', color: t.text.secondary, mt: -0.5, ml: 3.75 }}>
                                Always on — Item code must be unique, so every row needs its own number.
                              </Typography>
                            </Grid>
                          </>
                        )}
                      </Grid>
                    </Paper>
                  </Grid>

                </Grid>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper elevation={0} sx={panelSx}>
              <Box sx={sectionHeaderSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: t.state.infoBg, color: t.color.info }}>
                    <TableChartIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography id="column-rules-panel" sx={{ fontSize: 16, fontWeight: 700, color: t.text.heading }}>Column Rules</Typography>
                    <Typography sx={{ fontSize: 12.5, color: t.text.secondary }}>
                      Save a fill rule once, then apply it to any sheet from the editor's Fill / Create Column dialog.
                    </Typography>
                  </Box>
                </Box>
                <Chip label={`${columnRules.length} saved`} size="small" sx={{ height: 23, fontWeight: 650, fontSize: 11.5, bgcolor: t.state.infoBg, color: t.color.infoText }} />
              </Box>

              <Box sx={{ p: 2.5 }}>
                <Grid container spacing={1.5}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      size="small"
                      label="Rule name"
                      value={columnRuleName}
                      onChange={(event) => setColumnRuleName(event.target.value)}
                      sx={fieldSx}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <ColumnRuleBuilder
                      value={columnRuleDraft}
                      onChange={setColumnRuleDraft}
                      columnOptions={itemCodeSourceColumnOptions}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Button
                      variant="contained"
                      onClick={handleSaveColumnRule}
                      disabled={!columnRuleName.trim() || columnRuleSaving}
                      sx={{ textTransform: 'none', borderRadius: '8px' }}
                    >
                      {columnRuleSaving ? 'Saving...' : 'Save rule'}
                    </Button>
                  </Grid>
                </Grid>

                {columnRules.length > 0 && (
                  <Box sx={{ mt: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {columnRules.map(saved => (
                      <Box
                        key={saved.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1,
                          p: 1.25,
                          borderRadius: '10px',
                          border: `1px solid ${t.border.subtle}`,
                          bgcolor: t.surface.panel,
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 650, color: t.text.primary }} noWrap>
                            {saved.name}
                          </Typography>
                          <Typography sx={{ fontSize: 11.5, color: t.text.secondary }} noWrap>
                            {saved.target_column ? `${saved.target_column} · ` : ''}{saved.value_mode} · used {saved.usage_count}x
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Button
                            size="small"
                            onClick={() => {
                              setColumnRuleName(saved.name);
                              setColumnRuleDraft({ ...createEmptyColumnRule(), ...(saved.rule || {}) });
                            }}
                            sx={{ textTransform: 'none' }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleDeleteColumnRule(saved.id)}
                            sx={{ textTransform: 'none' }}
                          >
                            Delete
                          </Button>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Paper elevation={0} sx={panelSx}>
              <Box sx={sectionHeaderSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: t.state.successBg, color: t.color.success }}>
                    <TableChartIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: t.text.heading }}>Column Provider Mapping</Typography>
                  </Box>
                </Box>
                <Chip label={`${readyCount} ready`} size="small" sx={{ height: 23, fontWeight: 650, fontSize: 11.5, bgcolor: t.state.successBg, color: t.color.successText }} />
              </Box>

              <Box sx={{ p: 2.5 }}>
                <Alert
                  severity="info"
                  icon={<InfoIcon />}
                  sx={{
                    mb: 2,
                    bgcolor: t.state.infoBg,
                    border: `1px solid ${t.state.infoBorder}`,
                    color: t.color.infoText,
                    '& .MuiAlert-icon': { color: t.color.info }
                  }}
                >
                  Configure providers above, then map each validation column to the source you want to trust.
                </Alert>

                <TableContainer component={Paper} elevation={0} sx={{ borderRadius: '14px', border: `1px solid ${t.border.default}`, bgcolor: t.table.background, maxHeight: 460 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        {['Column', 'Purpose', 'Provider', 'Status'].map(label => (
                          <TableCell key={label} sx={{ bgcolor: t.table.header, color: t.text.heading, fontWeight: 650, fontSize: 12, borderBottom: `1px solid ${t.border.default}` }}>
                            {label}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {columnMappings.map((mapping) => {
                        const selectedProviders = normalizeProviders(mapping.providers || mapping.provider);
                        const meta = providerMeta[selectedProviders[0]];
                        const ready = selectedProviders.every(provider => Boolean(providerStatus[provider]?.configured));
                        return (
                          <TableRow key={mapping.column} hover sx={{ '&:hover td': { bgcolor: t.table.hover }, '& td': { borderBottom: `1px solid ${t.table.line}` } }}>
                            <TableCell sx={{ color: t.text.primary, fontWeight: 650, fontSize: 13 }}>{mapping.column}</TableCell>
                            <TableCell sx={{ color: t.text.secondary, fontSize: 13 }}>{mapping.description}</TableCell>
                            <TableCell sx={{ width: 330, minWidth: 330 }}>
                              <FormControl size="small" sx={{ width: 300 }}>
                                <Select
                                  multiple
                                  value={selectedProviders}
                                  onChange={(e) => {
                                    const nextProviders = normalizeProviders(e.target.value)
                                      .filter(provider => Boolean(providerStatus[provider]?.configured));
                                    handleColumnProviderChange(mapping.column, nextProviders);
                                  }}
                                  renderValue={(selected) => normalizeProviders(selected).map(providerLabel).join(', ') || 'Select provider'}
                                  sx={{
                                    borderRadius: '12px',
                                    bgcolor: meta?.soft || t.surface.controlSoft,
                                    color: t.text.primary,
                                    fontWeight: 650,
                                    fontSize: 12.5,
                                    height: 34,
                                    width: 300,
                                    '& .MuiSelect-select': {
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      pr: 4
                                    },
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: meta?.color || t.border.default }
                                  }}
                                >
                                  {Object.entries(providerMeta).map(([key, provider]) => {
                                    const configured = Boolean(providerStatus[key]?.configured);
                                    return (
                                    <MenuItem key={key} value={key} disabled={!configured} sx={{ color: configured ? t.text.primary : t.text.disabled }}>
                                      <Checkbox checked={selectedProviders.includes(key)} disabled={!configured} />
                                      <ListItemText
                                        primary={provider.label}
                                        secondary={configured ? '' : 'Not configured'}
                                        primaryTypographyProps={{ sx: { color: configured ? t.text.primary : t.text.disabled } }}
                                        secondaryTypographyProps={{ sx: { color: t.text.disabled, fontSize: 11 } }}
                                      />
                                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: configured ? provider.color : t.text.disabled, ml: 1, opacity: configured ? 1 : 0.45 }} />
                                    </MenuItem>
                                  );})}
                                </Select>
                              </FormControl>
                            </TableCell>
                            <TableCell sx={{ width: 170 }}>
                              <Chip
                                size="small"
                                icon={ready ? <CheckCircleIcon /> : <ErrorIcon />}
                                label={ready ? 'Ready' : 'Needs setup'}
                                sx={{
                                  height: 22,
                                  fontWeight: 650,
                                  fontSize: 11.5,
                                  bgcolor: ready ? t.state.successBg : t.state.warningBg,
                                  color: ready ? t.color.successText : t.color.warningText,
                                  border: `1px solid ${ready ? t.state.successBorder : t.state.warningBorder}`,
                                  '& .MuiChip-icon': { color: ready ? t.color.success : t.color.warning }
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', pb: 1 }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveSettings} disabled={savingSettings || loadingCredentials} sx={{ px: 3.25, height: 42, fontWeight: 700 }}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Box>

      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 7 }}
      >
        <Alert
          variant="filled"
          severity={toast.severity}
          onClose={() => setToast(prev => ({ ...prev, open: false }))}
          sx={{ borderRadius: '14px', boxShadow: t.shadow.card }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings;
