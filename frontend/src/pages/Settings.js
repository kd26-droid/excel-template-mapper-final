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
  TextField,
  Typography
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Save as SaveIcon,
  TableChart as TableChartIcon,
  Visibility,
  VisibilityOff,
  VpnKey as VpnKeyIcon
} from '@mui/icons-material';
import { useThemeContext } from '../utils/ThemeContext';

const initialColumnMappings = [
  { column: 'MPN valid', provider: 'digikey', description: 'Part validation status' },
  { column: 'MPN Status', provider: 'digikey', description: 'Lifecycle status' },
  { column: 'EOL Status', provider: 'digikey', description: 'End of life flag' },
  { column: 'Discontinued', provider: 'digikey', description: 'Discontinued status' },
  { column: 'DKPN', provider: 'digikey', description: 'DigiKey part number' },
  { column: 'Canonical MPN', provider: 'digikey', description: 'Standardized manufacturer part number' },
  { column: 'Category', provider: 'digikey', description: 'Product category' },
];

const providerMeta = {
  digikey: { label: 'DigiKey', color: '#3b82f6', soft: 'rgba(59, 130, 246, 0.14)' },
  mouser: { label: 'Mouser', color: '#10b981', soft: 'rgba(16, 185, 129, 0.14)' },
};

const Settings = () => {
  const { tokens: t, isDarkMode } = useThemeContext();
  const [digikeyClientId, setDigikeyClientId] = useState('');
  const [digikeyClientSecret, setDigikeyClientSecret] = useState('');
  const [digikeyRedirectUri, setDigikeyRedirectUri] = useState('');
  const [mouserApiKey, setMouserApiKey] = useState('');
  const [showDigikeySecret, setShowDigikeySecret] = useState(false);
  const [showMouserKey, setShowMouserKey] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('digikey');
  const [columnMappings, setColumnMappings] = useState(initialColumnMappings);
  const [toast, setToast] = useState({ open: false, severity: 'success', message: '' });
  const [mousePos, setMousePos] = useState({ x: 50, y: 36 });

  const hasDigikey = Boolean(digikeyClientId && digikeyClientSecret);
  const hasMouser = Boolean(mouserApiKey);

  const readyCount = useMemo(
    () => columnMappings.filter(mapping => (
      mapping.provider === 'digikey' ? hasDigikey : hasMouser
    )).length,
    [columnMappings, hasDigikey, hasMouser]
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

  const handleColumnProviderChange = (columnName, newProvider) => {
    setColumnMappings(prev =>
      prev.map(mapping => mapping.column === columnName ? { ...mapping, provider: newProvider } : mapping)
    );
  };

  const handleSaveSettings = () => {
    if (!hasDigikey && !hasMouser) {
      setToast({ open: true, severity: 'error', message: 'Configure at least one API provider before saving.' });
      return;
    }

    const invalidMappings = columnMappings.filter(mapping => (
      mapping.provider === 'digikey' ? !hasDigikey : !hasMouser
    ));

    if (invalidMappings.length > 0) {
      setToast({
        open: true,
        severity: 'error',
        message: `Some columns use unconfigured providers: ${invalidMappings.map(m => m.column).join(', ')}`
      });
      return;
    }

    setToast({ open: true, severity: 'success', message: 'Settings saved successfully.' });
  };

  const renderProviderCard = ({
    provider,
    title,
    description,
    configured,
    children
  }) => {
    const meta = providerMeta[provider];
    return (
      <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: `1px solid ${t.border.subtle}`, bgcolor: t.surface.panel }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: meta.soft, color: meta.color }}>
              <VpnKeyIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: t.text.heading, lineHeight: 1.2 }}>{title}</Typography>
              {description && (
                <Typography sx={{ fontSize: 12.5, color: t.text.secondary, mt: 0.25 }}>{description}</Typography>
              )}
            </Box>
          </Box>
          {providerChip(configured)}
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
            <Chip label={hasDigikey || hasMouser ? 'Provider available' : 'Setup required'} size="small" sx={{ height: 24, fontWeight: 650, fontSize: 11.5, bgcolor: hasDigikey || hasMouser ? t.state.successBg : t.state.warningBg, color: hasDigikey || hasMouser ? t.color.successText : t.color.warningText }} />
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
                <FormControl size="small" sx={{ minWidth: 190 }}>
                  <InputLabel>Default Provider</InputLabel>
                  <Select value={selectedProvider} label="Default Provider" onChange={(e) => setSelectedProvider(e.target.value)}>
                    {Object.entries(providerMeta).map(([key, meta]) => (
                      <MenuItem key={key} value={key}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: meta.color }} />
                          {meta.label}
                          {(key === 'digikey' ? hasDigikey : hasMouser) && <CheckCircleIcon sx={{ fontSize: 16, color: t.color.success }} />}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
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
                              placeholder="Enter client secret"
                              sx={fieldSx}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton onClick={() => setShowDigikeySecret(v => !v)} edge="end" size="small">
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
                            placeholder="Enter Mouser API key"
                            helperText="Available from the Mouser developer portal."
                            sx={fieldSx}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton onClick={() => setShowMouserKey(v => !v)} edge="end" size="small">
                                    {showMouserKey ? <VisibilityOff /> : <Visibility />}
                                  </IconButton>
                                </InputAdornment>
                              )
                            }}
                          />
                        )
                      })}
                      <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: `1px solid ${t.border.subtle}`, bgcolor: isDarkMode ? 'rgba(14, 165, 233, 0.08)' : '#eff6ff' }}>
                        <Box sx={{ display: 'flex', gap: 1.25 }}>
                          <InfoIcon sx={{ color: t.color.info, fontSize: 20, mt: 0.1 }} />
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 650, color: t.text.heading }}>Provider fallback</Typography>
                          </Box>
                        </Box>
                      </Paper>
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
                        const meta = providerMeta[mapping.provider];
                        const ready = mapping.provider === 'digikey' ? hasDigikey : hasMouser;
                        return (
                          <TableRow key={mapping.column} hover sx={{ '&:hover td': { bgcolor: t.table.hover }, '& td': { borderBottom: `1px solid ${t.table.line}` } }}>
                            <TableCell sx={{ color: t.text.primary, fontWeight: 650, fontSize: 13 }}>{mapping.column}</TableCell>
                            <TableCell sx={{ color: t.text.secondary, fontSize: 13 }}>{mapping.description}</TableCell>
                            <TableCell sx={{ width: 190 }}>
                              <FormControl size="small" fullWidth>
                                <Select
                                  value={mapping.provider}
                                  onChange={(e) => handleColumnProviderChange(mapping.column, e.target.value)}
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
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: provider.color }} />
                                        {provider.label}
                                      </Box>
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
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveSettings} sx={{ px: 3.25, height: 42, fontWeight: 700 }}>
                Save Settings
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Box>

      <Snackbar
        open={toast.open}
        autoHideDuration={3600}
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
