import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Grid,
  Alert,
  Divider,
  IconButton,
  InputAdornment,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Avatar,
  CircularProgress,
  Checkbox,
  ListItemText,
  Snackbar
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Save as SaveIcon,
  VpnKey as VpnKeyIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import api from '../services/api';

const CREDENTIAL_SCOPE_KEY = 'mpn_provider_credential_scope_id';
const VALIDATION_PROVIDERS_KEY = 'mpn_validation_providers';
const PROVIDER_OPTIONS = [
  { id: 'digikey', label: 'DigiKey' },
  { id: 'mouser', label: 'Mouser' },
  { id: 'element14', label: 'Element14' }
];

const getCredentialScopeId = () => {
  if (typeof window === 'undefined') return 'default';
  const existing = window.localStorage.getItem(CREDENTIAL_SCOPE_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(CREDENTIAL_SCOPE_KEY, generated);
  return generated;
};

const emptyProviderStatus = {
  digikey: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' },
  mouser: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' },
  element14: { configured: false, has_credentials: false, masked: {}, public: {}, last_test_message: '' }
};

const DEFAULT_COLUMN_MAPPINGS = [
  { column: 'MPN valid', description: 'Part validation status', providers: ['digikey'] },
  { column: 'MPN Status', description: 'Lifecycle status (Active/NRND/Obsolete)', providers: ['digikey'] },
  { column: 'EOL Status', description: 'End of life flag', providers: ['digikey'] },
  { column: 'Discontinued', description: 'Discontinued status', providers: ['digikey'] },
  { column: 'DKPN', description: 'DigiKey part number', providers: ['digikey'] },
  { column: 'Canonical MPN', description: 'Standardized manufacturer part number', providers: ['digikey'] },
  { column: 'Category', description: 'Product category', providers: ['digikey'] }
];

const COLUMN_PROVIDER_MAPPINGS_KEY = 'mpn_column_provider_mappings';
const MASK_VALUE = '************';

const normalizeProviders = (value, fallback = ['digikey']) => {
  const allowed = new Set(PROVIDER_OPTIONS.map((provider) => provider.id));
  const raw = Array.isArray(value) ? value : (value ? [value] : fallback);
  const next = raw.filter((provider) => allowed.has(provider));
  return next.length ? Array.from(new Set(next)) : fallback;
};

const providersFromColumnMappings = (mappings) => {
  const selected = Array.from(new Set((mappings || []).flatMap((mapping) => normalizeProviders(mapping.providers || mapping.provider))));
  return selected.length ? selected : ['digikey'];
};

const getInitialColumnMappings = () => {
  if (typeof window === 'undefined') return DEFAULT_COLUMN_MAPPINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(COLUMN_PROVIDER_MAPPINGS_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_COLUMN_MAPPINGS;
    const allowed = new Set(PROVIDER_OPTIONS.map((provider) => provider.id));
    const savedByColumn = new Map(saved.map((mapping) => [mapping.column, mapping.provider]));
    const savedProvidersByColumn = new Map(saved.map((mapping) => [mapping.column, mapping.providers]));
    return DEFAULT_COLUMN_MAPPINGS.map((mapping) => {
      const provider = savedByColumn.get(mapping.column);
      const providers = savedProvidersByColumn.get(mapping.column);
      return {
        ...mapping,
        providers: normalizeProviders(providers || provider, mapping.providers)
      };
    });
  } catch {
    return DEFAULT_COLUMN_MAPPINGS;
  }
};

const getInitialValidationProviders = (mappings = null) => {
  if (mappings) return providersFromColumnMappings(mappings);
  if (typeof window === 'undefined') return ['digikey'];
  try {
    const saved = JSON.parse(window.localStorage.getItem(VALIDATION_PROVIDERS_KEY) || '[]');
    const allowed = new Set(PROVIDER_OPTIONS.map((provider) => provider.id));
    const selected = Array.isArray(saved) ? saved.filter((provider) => allowed.has(provider)) : [];
    return selected.length ? selected : ['digikey'];
  } catch {
    return ['digikey'];
  }
};

const Settings = () => {
  const [columnMappings, setColumnMappings] = useState(getInitialColumnMappings);
  // API Keys State
  const [digikeyClientId, setDigikeyClientId] = useState('');
  const [digikeyClientSecret, setDigikeyClientSecret] = useState('');
  const [digikeyRedirectUri, setDigikeyRedirectUri] = useState('');
  const [mouserApiKey, setMouserApiKey] = useState('');
  const [element14ApiKey, setElement14ApiKey] = useState('');

  // Show/Hide passwords
  const [showDigikeySecret, setShowDigikeySecret] = useState(false);
  const [showMouserKey, setShowMouserKey] = useState(false);
  const [showElement14Key, setShowElement14Key] = useState(false);

  // Provider selection
  const [, setSelectedValidationProviders] = useState(() => getInitialValidationProviders(columnMappings));
  const [credentialScopeId] = useState(getCredentialScopeId);
  const [providerStatus, setProviderStatus] = useState(emptyProviderStatus);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState('');
  const [testingProvider, setTestingProvider] = useState('');
  const [providerMessages, setProviderMessages] = useState({
    digikey: null,
    mouser: null,
    element14: null
  });

  // Feedback state
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('Settings saved successfully');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadCredentials = async () => {
      setLoadingCredentials(true);
      try {
        const response = await api.getProviderCredentials(credentialScopeId);
        if (cancelled) return;

        const nextStatus = { ...emptyProviderStatus };
        (response.data.providers || []).forEach((provider) => {
          nextStatus[provider.provider] = provider;
        });
        setProviderStatus(nextStatus);

        const digikey = nextStatus.digikey || {};
        setDigikeyClientId(digikey.public?.client_id || '');
        setDigikeyRedirectUri(digikey.public?.redirect_uri || '');
        setDigikeyClientSecret(digikey.masked?.client_secret ? MASK_VALUE : '');
        setMouserApiKey(nextStatus.mouser?.masked?.api_key ? MASK_VALUE : '');
        setElement14ApiKey(nextStatus.element14?.masked?.api_key ? MASK_VALUE : '');
      } catch (error) {
        if (!cancelled) {
          setSaveError(error.response?.data?.error || error.message || 'Failed to load provider settings');
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

  const persistColumnMappings = (nextMappings) => {
    const nextProviders = providersFromColumnMappings(nextMappings);
    setSelectedValidationProviders(nextProviders);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLUMN_PROVIDER_MAPPINGS_KEY, JSON.stringify(nextMappings));
      window.localStorage.setItem(VALIDATION_PROVIDERS_KEY, JSON.stringify(nextProviders));
    }
  };

  const handleColumnProviderChange = (column, value) => {
    const providers = normalizeProviders(typeof value === 'string' ? value.split(',') : value);
    const nextMappings = columnMappings.map((mapping) => (
      mapping.column === column ? { ...mapping, providers } : mapping
    ));
    setColumnMappings(nextMappings);
    persistColumnMappings(nextMappings);
  };

  const applySavedProviderStatus = (providers = []) => {
    setProviderStatus((prev) => {
      const next = { ...prev };
      providers.forEach((provider) => {
        next[provider.provider] = provider;
      });
      return next;
    });
  };

  const buildProviderPayload = () => {
    const isMaskedValue = (value, provider, field) => {
      const text = String(value || '');
      return text === MASK_VALUE || Boolean(providerStatus[provider]?.masked?.[field] && text === providerStatus[provider].masked[field]);
    };

    const digikey = {
      client_id: digikeyClientId,
      redirect_uri: digikeyRedirectUri
    };
    if (digikeyClientSecret.trim() && !isMaskedValue(digikeyClientSecret, 'digikey', 'client_secret')) {
      digikey.client_secret = digikeyClientSecret;
    }

    const mouser = {};
    if (mouserApiKey.trim() && !isMaskedValue(mouserApiKey, 'mouser', 'api_key')) {
      mouser.api_key = mouserApiKey;
    }

    const element14 = {};
    if (element14ApiKey.trim() && !isMaskedValue(element14ApiKey, 'element14', 'api_key')) {
      element14.api_key = element14ApiKey;
    }

    return { digikey, mouser, element14 };
  };

  const hasProviderRequiredDetails = (provider) => {
    if (provider === 'digikey') {
      return Boolean(digikeyClientId && (digikeyClientSecret || providerStatus.digikey?.has_credentials));
    }
    if (provider === 'mouser') {
      return Boolean(mouserApiKey || providerStatus.mouser?.has_credentials);
    }
    if (provider === 'element14') {
      return Boolean(element14ApiKey || providerStatus.element14?.has_credentials);
    }
    return false;
  };

  const setProviderMessage = (provider, type, message) => {
    setProviderMessages((prev) => ({
      ...prev,
      [provider]: message ? { type, message } : null
    }));
  };

  const setMaskedFieldsFromStatus = (nextStatus) => {
    if (nextStatus.digikey?.masked?.client_secret) setDigikeyClientSecret(MASK_VALUE);
    if (nextStatus.mouser?.masked?.api_key) setMouserApiKey(MASK_VALUE);
    if (nextStatus.element14?.masked?.api_key) setElement14ApiKey(MASK_VALUE);
  };

  const isSavedMaskedValue = (value, provider, field) => (
    value === MASK_VALUE || Boolean(providerStatus[provider]?.masked?.[field] && value === providerStatus[provider].masked[field])
  );

  const toggleSavedSecretVisibility = (provider) => {
    if (provider === 'digikey') {
      const saved = providerStatus.digikey?.masked?.client_secret || '';
      if (isSavedMaskedValue(digikeyClientSecret, 'digikey', 'client_secret') && saved) {
        setDigikeyClientSecret(showDigikeySecret ? MASK_VALUE : saved);
      }
      setShowDigikeySecret((prev) => !prev);
      return;
    }
    if (provider === 'mouser') {
      const saved = providerStatus.mouser?.masked?.api_key || '';
      if (isSavedMaskedValue(mouserApiKey, 'mouser', 'api_key') && saved) {
        setMouserApiKey(showMouserKey ? MASK_VALUE : saved);
      }
      setShowMouserKey((prev) => !prev);
      return;
    }
    if (provider === 'element14') {
      const saved = providerStatus.element14?.masked?.api_key || '';
      if (isSavedMaskedValue(element14ApiKey, 'element14', 'api_key') && saved) {
        setElement14ApiKey(showElement14Key ? MASK_VALUE : saved);
      }
      setShowElement14Key((prev) => !prev);
    }
  };

  // Save settings
  const handleSaveSettings = async () => {
    const hasDigikey = hasProviderRequiredDetails('digikey');
    const hasMouser = hasProviderRequiredDetails('mouser');
    const hasElement14 = hasProviderRequiredDetails('element14');

    if (!hasDigikey && !hasMouser && !hasElement14) {
      setSaveError('Please configure at least one API provider (DigiKey, Mouser, or Element14)');
      return;
    }

    const nextValidationProviders = providersFromColumnMappings(columnMappings);
    const providerConfigured = { digikey: hasDigikey, mouser: hasMouser, element14: hasElement14 };
    const invalidProviders = nextValidationProviders.filter((provider) => !providerConfigured[provider]);

    if (invalidProviders.length > 0) {
      const names = invalidProviders.map((provider) => PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider);
      setSaveError(`Column mappings use providers that are not configured: ${names.join(', ')}`);
      return;
    }

    setSavingSettings(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLUMN_PROVIDER_MAPPINGS_KEY, JSON.stringify(columnMappings));
        window.localStorage.setItem(VALIDATION_PROVIDERS_KEY, JSON.stringify(nextValidationProviders));
      }
      setSelectedValidationProviders(nextValidationProviders);
      const response = await api.saveProviderCredentials(credentialScopeId, buildProviderPayload());
      applySavedProviderStatus(response.data.providers || []);
      const nextStatus = { ...providerStatus };
      (response.data.providers || []).forEach((provider) => {
        nextStatus[provider.provider] = provider;
      });
      setMaskedFieldsFromStatus(nextStatus);
      setSnackbarMessage('Settings saved successfully');
      setSaveSuccess(true);
      setSaveError('');
    } catch (error) {
      setSaveError(error.response?.data?.error || error.message || 'Failed to save provider settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteProvider = async (provider) => {
    setDeletingProvider(provider);
    setSaveError('');
    try {
      await api.deleteProviderCredential(provider, credentialScopeId);
      setProviderStatus((prev) => ({
        ...prev,
        [provider]: { ...emptyProviderStatus[provider] }
      }));
      if (provider === 'digikey') {
        setDigikeyClientId('');
        setDigikeyClientSecret('');
        setDigikeyRedirectUri('');
      } else if (provider === 'mouser') {
        setMouserApiKey('');
      } else if (provider === 'element14') {
        setElement14ApiKey('');
      }
      setProviderMessage(provider, null, '');
      setSnackbarMessage(`${providerLabel(provider)} removed successfully`);
      setSaveSuccess(true);
    } catch (error) {
      setSaveError(error.response?.data?.error || error.message || `Failed to remove ${provider} settings`);
    } finally {
      setDeletingProvider('');
    }
  };

  const handleTestProvider = async (provider) => {
    const providerPayload = buildProviderPayload()[provider] || {};
    const hasAnyInput = Object.values(providerPayload).some((value) => String(value || '').trim());
    if (!hasProviderRequiredDetails(provider)) {
      setProviderMessage(provider, 'error', 'Enter the required details before testing.');
      return;
    }

    setTestingProvider(provider);
    setProviderMessage(provider, null, '');
    try {
      if (hasAnyInput) {
        const saveResponse = await api.saveProviderCredentials(credentialScopeId, { [provider]: providerPayload });
        applySavedProviderStatus(saveResponse.data.providers || []);
        const nextStatus = { ...providerStatus };
        (saveResponse.data.providers || []).forEach((item) => {
          nextStatus[item.provider] = item;
        });
        setMaskedFieldsFromStatus(nextStatus);
      }

      const response = await api.testProviderCredential(provider, credentialScopeId);
      applySavedProviderStatus(response.data.provider_status ? [response.data.provider_status] : []);
      setProviderMessage(provider, null, '');
      setSnackbarMessage(`${providerLabel(provider)} configured successfully`);
      setSaveSuccess(true);
    } catch (error) {
      const providerStatusUpdate = error.response?.data?.provider_status;
      if (providerStatusUpdate) {
        applySavedProviderStatus([providerStatusUpdate]);
      }
      setProviderMessage(provider, 'error', error.response?.data?.error || error.response?.data?.message || 'Details unverified. Please check the entered details.');
    } finally {
      setTestingProvider('');
    }
  };

  // Check if provider is configured
  const isProviderConfigured = (provider) => {
    return Boolean(providerStatus[provider]?.configured);
  };

  const getProviderColor = (provider) => {
    if (provider === 'mouser') return '#10b981';
    if (provider === 'element14') return '#f59e0b';
    return '#3b82f6';
  };

  const providerLabel = (provider) => PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider;

  const secretInputSx = {
    '& input': {
      fontFamily: '"Roboto Mono", Consolas, "Courier New", monospace',
      letterSpacing: 0
    }
  };

  const providerLabels = (providers) => normalizeProviders(providers)
    .map((provider) => providerLabel(provider))
    .join(', ');

  const mappingProvidersReady = (providers) => normalizeProviders(providers).every((provider) => isProviderConfigured(provider));

  const renderProviderStatus = (provider) => (
    <>
      {isProviderConfigured(provider) ? (
        <Chip icon={<CheckCircleIcon />} label="Configured" color="success" size="small" />
      ) : (
        <Chip icon={<ErrorIcon />} label="Not Configured" color="default" size="small" />
      )}
      {providerMessages[provider]?.type === 'error' && (
        <Chip
          icon={<ErrorIcon />}
          label={providerMessages[provider].message}
          color="error"
          size="small"
          variant="outlined"
          sx={{ maxWidth: 360, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
      )}
    </>
  );

  return (
    <Box sx={{ p: 3, backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" fontWeight="700" color="#1e293b" gutterBottom>
          Settings
        </Typography>
        <Typography variant="h6" color="#64748b">
          Configure API providers and column mappings for MPN validation
        </Typography>
      </Box>

      {/* Success/Error Messages */}
      <Snackbar
        open={saveSuccess}
        autoHideDuration={5000}
        onClose={() => setSaveSuccess(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ mt: 2 }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSaveSuccess(false)}
          sx={{
            minWidth: 360,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.22)',
            fontWeight: 700,
            alignItems: 'center'
          }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
      {saveError && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setSaveError('')}>
          {saveError}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* API Keys Section */}
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Avatar sx={{ bgcolor: '#3b82f6', width: 48, height: 48 }}>
                  <VpnKeyIcon />
                </Avatar>
                <Box>
                  <Typography variant="h5" fontWeight="600" color="#1e293b">
                    API Provider Configuration
                  </Typography>
                  <Typography variant="body2" color="#64748b">
                    Configure one or more providers for MPN validation
                  </Typography>
                </Box>
                {loadingCredentials && <CircularProgress size={22} sx={{ ml: 'auto' }} />}
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* DigiKey Configuration */}
              <Box sx={{ mb: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" fontWeight="600" color="#1e293b">
                    DigiKey API
                  </Typography>
                  {renderProviderStatus('digikey')}
                  <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleTestProvider('digikey')}
                      disabled={Boolean(testingProvider || deletingProvider) || !hasProviderRequiredDetails('digikey')}
                      startIcon={testingProvider === 'digikey' ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                    >
                      Test
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      startIcon={deletingProvider === 'digikey' ? <CircularProgress size={14} /> : <DeleteIcon />}
                      onClick={() => handleDeleteProvider('digikey')}
                      disabled={Boolean(deletingProvider) || !providerStatus.digikey?.has_credentials}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
                <Typography variant="body2" color="#64748b" sx={{ mb: 2 }}>
                  OAuth-based authentication for DigiKey product database
                </Typography>

                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Client ID"
                      value={digikeyClientId}
                      onChange={(e) => setDigikeyClientId(e.target.value)}
                      placeholder="Enter DigiKey Client ID"
                      variant="outlined"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Client Secret"
                      type={showDigikeySecret ? 'text' : 'password'}
                      value={digikeyClientSecret}
                      onChange={(e) => setDigikeyClientSecret(e.target.value)}
                      onFocus={() => {
                        if (isSavedMaskedValue(digikeyClientSecret, 'digikey', 'client_secret')) setDigikeyClientSecret('');
                      }}
                      placeholder={providerStatus.digikey?.masked?.client_secret || 'Enter DigiKey Client Secret'}
                      variant="outlined"
                      sx={secretInputSx}
                      helperText={providerStatus.digikey?.has_credentials ? 'Saved secret is hidden. Type a new value to replace it.' : ''}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => toggleSavedSecretVisibility('digikey')}
                              edge="end"
                            >
                              {showDigikeySecret ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Redirect URI"
                      value={digikeyRedirectUri}
                      onChange={(e) => setDigikeyRedirectUri(e.target.value)}
                      placeholder="https://your-app.com/api/mpn/oauth/callback"
                      variant="outlined"
                      helperText="OAuth callback URL (must match DigiKey app settings)"
                    />
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Mouser Configuration */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" fontWeight="600" color="#1e293b">
                    Mouser API
                  </Typography>
                  {renderProviderStatus('mouser')}
                  <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleTestProvider('mouser')}
                      disabled={Boolean(testingProvider || deletingProvider) || !hasProviderRequiredDetails('mouser')}
                      startIcon={testingProvider === 'mouser' ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                    >
                      Test
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      startIcon={deletingProvider === 'mouser' ? <CircularProgress size={14} /> : <DeleteIcon />}
                      onClick={() => handleDeleteProvider('mouser')}
                      disabled={Boolean(deletingProvider) || !providerStatus.mouser?.has_credentials}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
                <Typography variant="body2" color="#64748b" sx={{ mb: 2 }}>
                  API key-based authentication for Mouser Electronics
                </Typography>

                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="API Key"
                      type={showMouserKey ? 'text' : 'password'}
                      value={mouserApiKey}
                      onChange={(e) => setMouserApiKey(e.target.value)}
                      onFocus={() => {
                        if (isSavedMaskedValue(mouserApiKey, 'mouser', 'api_key')) setMouserApiKey('');
                      }}
                      placeholder={providerStatus.mouser?.masked?.api_key || 'Enter Mouser API Key'}
                      variant="outlined"
                      sx={secretInputSx}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => toggleSavedSecretVisibility('mouser')}
                              edge="end"
                            >
                              {showMouserKey ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      helperText={providerStatus.mouser?.has_credentials ? 'Saved key is hidden. Type a new value to replace it.' : 'Get your API key from Mouser developer portal'}
                    />
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Element14 Configuration */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" fontWeight="600" color="#1e293b">
                    Element14 API
                  </Typography>
                  {renderProviderStatus('element14')}
                  <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleTestProvider('element14')}
                      disabled={Boolean(testingProvider || deletingProvider) || !hasProviderRequiredDetails('element14')}
                      startIcon={testingProvider === 'element14' ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                    >
                      Test
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      startIcon={deletingProvider === 'element14' ? <CircularProgress size={14} /> : <DeleteIcon />}
                      onClick={() => handleDeleteProvider('element14')}
                      disabled={Boolean(deletingProvider) || !providerStatus.element14?.has_credentials}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>
                <Typography variant="body2" color="#64748b" sx={{ mb: 2 }}>
                  API key-based authentication for Element14 product validation
                </Typography>

                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="API Key"
                      type={showElement14Key ? 'text' : 'password'}
                      value={element14ApiKey}
                      onChange={(e) => setElement14ApiKey(e.target.value)}
                      onFocus={() => {
                        if (isSavedMaskedValue(element14ApiKey, 'element14', 'api_key')) setElement14ApiKey('');
                      }}
                      placeholder={providerStatus.element14?.masked?.api_key || 'Enter Element14 API Key'}
                      variant="outlined"
                      sx={secretInputSx}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => toggleSavedSecretVisibility('element14')}
                              edge="end"
                            >
                              {showElement14Key ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      helperText={providerStatus.element14?.has_credentials ? 'Saved key is hidden. Type a new value to replace it.' : 'Get your API key from Element14 developer portal'}
                    />
                  </Grid>
                </Grid>
              </Box>

            </CardContent>
          </Card>
        </Grid>

        {/* Column Mapping Section */}
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 3, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Avatar sx={{ bgcolor: '#10b981', width: 48, height: 48 }}>
                  <CheckCircleIcon />
                </Avatar>
                <Box>
                  <Typography variant="h5" fontWeight="600" color="#1e293b">
                    Column Provider Mapping
                  </Typography>
                  <Typography variant="body2" color="#64748b">
                    Choose which provider should source each MPN validation column.
                  </Typography>
                </Box>
              </Box>

              <Alert severity="info" sx={{ mb: 3 }}>
                Each column can be sourced from DigiKey, Mouser, or Element14. Configure the providers above first.
              </Alert>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f8fafc' }}>
                      <TableCell><strong>Column Name</strong></TableCell>
                      <TableCell><strong>Description</strong></TableCell>
                      <TableCell><strong>Data Provider</strong></TableCell>
                      <TableCell align="center"><strong>Status</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {columnMappings.map((mapping) => (
                      <TableRow key={mapping.column} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight="600">
                            {mapping.column}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="#64748b">
                            {mapping.description}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 160 }}>
                            <Select
                              multiple
                              value={normalizeProviders(mapping.providers || mapping.provider)}
                              onChange={(event) => handleColumnProviderChange(mapping.column, event.target.value)}
                              renderValue={(selected) => providerLabels(selected)}
                              sx={{
                                bgcolor: `${getProviderColor(normalizeProviders(mapping.providers || mapping.provider)[0])}14`,
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: getProviderColor(normalizeProviders(mapping.providers || mapping.provider)[0])
                                }
                              }}
                            >
                              {PROVIDER_OPTIONS.map((provider) => (
                                <MenuItem key={provider.id} value={provider.id}>
                                  <Checkbox checked={normalizeProviders(mapping.providers || mapping.provider).includes(provider.id)} />
                                  <ListItemText primary={provider.label} />
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: getProviderColor(provider.id), ml: 1 }} />
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="center">
                          {mappingProvidersReady(mapping.providers || mapping.provider) ? (
                            <Chip
                              icon={<CheckCircleIcon />}
                              label="Ready"
                              color="success"
                              size="small"
                            />
                          ) : (
                            <Chip
                              icon={<ErrorIcon />}
                              label="Provider Not Configured"
                              color="error"
                              size="small"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<SaveIcon />}
              onClick={handleSaveSettings}
              disabled={savingSettings || loadingCredentials}
              sx={{
                bgcolor: '#3b82f6',
                '&:hover': { bgcolor: '#2563eb' },
                px: 4,
                py: 1.5
              }}
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Settings;
