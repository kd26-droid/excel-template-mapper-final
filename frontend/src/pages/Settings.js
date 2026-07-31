import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
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
  Delete as DeleteIcon,
  TableChart as TableChartIcon,
  Visibility,
  VisibilityOff,
  VpnKey as VpnKeyIcon
} from '@mui/icons-material';
import { useThemeContext } from '../utils/ThemeContext';
import api from '../services/api';

const initialColumnMappings = [
  { column: 'MPN valid', providers: ['digikey'], description: 'Part validation status' },
  { column: 'MPN Status', providers: ['digikey'], description: 'Lifecycle status' },
  { column: 'EOL Status', providers: ['digikey'], description: 'End of life flag' },
  { column: 'Discontinued', providers: ['digikey'], description: 'Discontinued status' },
  { column: 'DKPN', providers: ['digikey'], description: 'DigiKey part number' },
  { column: 'Canonical MPN', providers: ['digikey'], description: 'Standardized manufacturer part number' },
  { column: 'Category', providers: ['digikey'], description: 'Product category' },
];

const providerMeta = {
  digikey: { label: 'DigiKey', color: '#3b82f6', soft: 'rgba(59, 130, 246, 0.14)' },
  mouser: { label: 'Mouser', color: '#10b981', soft: 'rgba(16, 185, 129, 0.14)' },
  element14: { label: 'Element14', color: '#f59e0b', soft: 'rgba(245, 158, 11, 0.16)' },
};

const CREDENTIAL_SCOPE_KEY = 'mpn_provider_credential_scope_id';
const VALIDATION_PROVIDERS_KEY = 'mpn_validation_providers';
const COLUMN_PROVIDER_MAPPINGS_KEY = 'mpn_column_provider_mappings';
const MASK_VALUE = '************';

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

const normalizeProviders = (value, fallback = ['digikey']) => {
  const allowed = new Set(Object.keys(providerMeta));
  const raw = Array.isArray(value) ? value : (value ? [value] : fallback);
  const selected = raw.filter(provider => allowed.has(provider));
  return selected.length ? Array.from(new Set(selected)) : fallback;
};

const providersFromColumnMappings = (mappings) => {
  const selected = Array.from(new Set((mappings || []).flatMap(mapping => normalizeProviders(mapping.providers || mapping.provider))));
  return selected.length ? selected : ['digikey'];
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
  const [credentialScopeId] = useState(getCredentialScopeId);
  const [providerStatus, setProviderStatus] = useState(emptyProviderStatus);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [deletingProvider, setDeletingProvider] = useState('');
  const [providerMessages, setProviderMessages] = useState({ digikey: null, mouser: null, element14: null });
  const [toast, setToast] = useState({ open: false, severity: 'success', message: '' });
  const [mousePos, setMousePos] = useState({ x: 50, y: 36 });

  const hasDigikey = Boolean(providerStatus.digikey?.configured);
  const hasMouser = Boolean(providerStatus.mouser?.configured);
  const hasElement14 = Boolean(providerStatus.element14?.configured);
  const hasAnyProvider = hasDigikey || hasMouser || hasElement14;

  const readyCount = useMemo(
    () => columnMappings.filter(mapping => normalizeProviders(mapping.providers || mapping.provider).every(provider => Boolean(providerStatus[provider]?.configured))).length,
    [columnMappings, providerStatus]
  );

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
    ...fieldSx,
    '& input': {
      fontFamily: '"Roboto Mono", Consolas, "Courier New", monospace',
      letterSpacing: 0
    }
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

  const handleSaveSettings = async () => {
    const hasAnyEntered = hasProviderRequiredDetails('digikey') || hasProviderRequiredDetails('mouser') || hasProviderRequiredDetails('element14');
    if (!hasAnyEntered) {
      setToast({ open: true, severity: 'error', message: 'Enter at least one provider credential before saving.' });
      return;
    }

    const selectedProviders = providersFromColumnMappings(columnMappings);
    const invalidProviders = selectedProviders.filter(provider => !hasProviderRequiredDetails(provider));

    if (invalidProviders.length > 0) {
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
    const message = providerMessages[provider];
    return (
      <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: `1px solid ${t.border.subtle}`, bgcolor: t.surface.panel }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexWrap: 'wrap' }}>
            <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: meta.soft, color: meta.color }}>
              <VpnKeyIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: t.text.heading, lineHeight: 1.2 }}>{title}</Typography>
              {description && (
                <Typography sx={{ fontSize: 12.5, color: t.text.secondary, mt: 0.25 }}>{description}</Typography>
              )}
            </Box>
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
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
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
        </Box>
        {children}
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
          <Grid item xs={12}>
            <Paper elevation={0} sx={panelSx}>
              <Box sx={sectionHeaderSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: t.action.primarySoft, color: t.color.primaryLight }}>
                    <VpnKeyIcon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, color: t.text.heading }}>API Providers</Typography>
                  </Box>
                </Box>
                {loadingCredentials && <CircularProgress size={20} />}
              </Box>

              <Box sx={{ p: 2.5 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} lg={7}>
                    {renderProviderCard({
                      provider: 'digikey',
                      title: 'DigiKey API',
                      description: '',
                      configured: hasDigikey,
                      children: (
                        <Grid container spacing={1.5}>
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
                          <Grid item xs={12}>
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
                            <TableCell sx={{ width: 190 }}>
                              <FormControl size="small" fullWidth>
                                <Select
                                  multiple
                                  value={selectedProviders}
                                  onChange={(e) => handleColumnProviderChange(mapping.column, e.target.value)}
                                  renderValue={(selected) => normalizeProviders(selected).map(providerLabel).join(', ')}
                                  sx={{
                                    borderRadius: '12px',
                                    bgcolor: meta.soft,
                                    color: t.text.primary,
                                    fontWeight: 650,
                                    fontSize: 12.5,
                                    height: 34,
                                    '& .MuiOutlinedInput-notchedOutline': { borderColor: meta.color }
                                  }}
                                >
                                  {Object.entries(providerMeta).map(([key, provider]) => (
                                    <MenuItem key={key} value={key}>
                                      <Checkbox checked={selectedProviders.includes(key)} />
                                      <ListItemText primary={provider.label} />
                                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: provider.color, ml: 1 }} />
                                    </MenuItem>
                                  ))}
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
