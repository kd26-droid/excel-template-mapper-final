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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
  Avatar,
  Stack,
  Switch,
  FormControlLabel
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Save as SaveIcon,
  Settings as SettingsIcon,
  VpnKey as VpnKeyIcon,
  TableChart as TableChartIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon
} from '@mui/icons-material';

const Settings = () => {
  // API Keys State
  const [digikeyClientId, setDigikeyClientId] = useState('');
  const [digikeyClientSecret, setDigikeyClientSecret] = useState('');
  const [digikeyRedirectUri, setDigikeyRedirectUri] = useState('');
  const [mouserApiKey, setMouserApiKey] = useState('');

  // Show/Hide passwords
  const [showDigikeySecret, setShowDigikeySecret] = useState(false);
  const [showMouserKey, setShowMouserKey] = useState(false);

  // Provider selection
  const [selectedProvider, setSelectedProvider] = useState('digikey'); // 'digikey' or 'mouser'

  // Feedback state
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Column mapping state - defines which columns are retrieved from which provider
  const [columnMappings, setColumnMappings] = useState([
    { column: 'MPN valid (DigiKey)', provider: 'digikey', description: 'Part validation status' },
    { column: 'DigiKey Status', provider: 'digikey', description: 'Lifecycle status (Active/NRND/Obsolete)' },
    { column: 'DigiKey EOL Status', provider: 'digikey', description: 'End of life flag' },
    { column: 'DigiKey Discontinued', provider: 'digikey', description: 'Discontinued status' },
    { column: 'DigiKey Part Number', provider: 'digikey', description: 'DigiKey part number' },
    { column: 'DigiKey Canonical MPN', provider: 'digikey', description: 'Standardized manufacturer part number' },
    { column: 'DigiKey Category', provider: 'digikey', description: 'Product category' },
  ]);

  // Handle column provider change
  const handleColumnProviderChange = (columnName, newProvider) => {
    setColumnMappings(prev =>
      prev.map(mapping =>
        mapping.column === columnName
          ? { ...mapping, provider: newProvider }
          : mapping
      )
    );
  };

  // Save settings
  const handleSaveSettings = () => {
    // Validate at least one provider is configured
    const hasDigikey = digikeyClientId && digikeyClientSecret;
    const hasMouser = mouserApiKey;

    if (!hasDigikey && !hasMouser) {
      setSaveError('Please configure at least one API provider (DigiKey or Mouser)');
      return;
    }

    // Validate column mappings - ensure selected provider is configured
    const invalidMappings = columnMappings.filter(mapping => {
      if (mapping.provider === 'digikey' && !hasDigikey) return true;
      if (mapping.provider === 'mouser' && !hasMouser) return true;
      return false;
    });

    if (invalidMappings.length > 0) {
      setSaveError(`Some columns are mapped to unconfigured providers: ${invalidMappings.map(m => m.column).join(', ')}`);
      return;
    }

    // TODO: Call backend API to save settings
    console.log('Saving settings:', {
      digikey: { clientId: digikeyClientId, clientSecret: digikeyClientSecret, redirectUri: digikeyRedirectUri },
      mouser: { apiKey: mouserApiKey },
      defaultProvider: selectedProvider,
      columnMappings
    });

    setSaveSuccess(true);
    setSaveError('');
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Get provider badge color
  const getProviderColor = (provider) => {
    return provider === 'digikey' ? '#3b82f6' : '#10b981';
  };

  // Check if provider is configured
  const isProviderConfigured = (provider) => {
    if (provider === 'digikey') {
      return digikeyClientId && digikeyClientSecret;
    }
    if (provider === 'mouser') {
      return mouserApiKey;
    }
    return false;
  };

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
      {saveSuccess && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSaveSuccess(false)}>
          Settings saved successfully!
        </Alert>
      )}
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
                    Configure one or both providers for MPN validation
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* DigiKey Configuration */}
              <Box sx={{ mb: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Typography variant="h6" fontWeight="600" color="#1e293b">
                    DigiKey API
                  </Typography>
                  {isProviderConfigured('digikey') ? (
                    <Chip
                      icon={<CheckCircleIcon />}
                      label="Configured"
                      color="success"
                      size="small"
                    />
                  ) : (
                    <Chip
                      icon={<ErrorIcon />}
                      label="Not Configured"
                      color="default"
                      size="small"
                    />
                  )}
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
                      placeholder="Enter DigiKey Client Secret"
                      variant="outlined"
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowDigikeySecret(!showDigikeySecret)}
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
                  {isProviderConfigured('mouser') ? (
                    <Chip
                      icon={<CheckCircleIcon />}
                      label="Configured"
                      color="success"
                      size="small"
                    />
                  ) : (
                    <Chip
                      icon={<ErrorIcon />}
                      label="Not Configured"
                      color="default"
                      size="small"
                    />
                  )}
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
                      placeholder="Enter Mouser API Key"
                      variant="outlined"
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowMouserKey(!showMouserKey)}
                              edge="end"
                            >
                              {showMouserKey ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      helperText="Get your API key from Mouser developer portal"
                    />
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Default Provider Selection */}
              <Box>
                <Typography variant="h6" fontWeight="600" color="#1e293b" sx={{ mb: 2 }}>
                  Default Provider
                </Typography>
                <Typography variant="body2" color="#64748b" sx={{ mb: 2 }}>
                  Choose which provider to use by default for MPN validation
                </Typography>
                <FormControl fullWidth sx={{ maxWidth: 300 }}>
                  <InputLabel>Default Provider</InputLabel>
                  <Select
                    value={selectedProvider}
                    label="Default Provider"
                    onChange={(e) => setSelectedProvider(e.target.value)}
                  >
                    <MenuItem value="digikey">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        DigiKey
                        {isProviderConfigured('digikey') && <CheckCircleIcon fontSize="small" color="success" />}
                      </Box>
                    </MenuItem>
                    <MenuItem value="mouser">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        Mouser
                        {isProviderConfigured('mouser') && <CheckCircleIcon fontSize="small" color="success" />}
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>
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
                  <TableChartIcon />
                </Avatar>
                <Box>
                  <Typography variant="h5" fontWeight="600" color="#1e293b">
                    Column Provider Mapping
                  </Typography>
                  <Typography variant="body2" color="#64748b">
                    Choose which provider to use for each MPN validation column
                  </Typography>
                </Box>
              </Box>

              <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 3 }}>
                Each column can be sourced from either DigiKey or Mouser. Configure the providers above first.
              </Alert>

              <TableContainer component={Paper} variant="outlined">
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
                          <FormControl size="small" sx={{ minWidth: 150 }}>
                            <Select
                              value={mapping.provider}
                              onChange={(e) => handleColumnProviderChange(mapping.column, e.target.value)}
                              sx={{
                                bgcolor: mapping.provider === 'digikey' ? '#eff6ff' : '#f0fdf4',
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: getProviderColor(mapping.provider)
                                }
                              }}
                            >
                              <MenuItem value="digikey">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#3b82f6' }} />
                                  DigiKey
                                </Box>
                              </MenuItem>
                              <MenuItem value="mouser">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#10b981' }} />
                                  Mouser
                                </Box>
                              </MenuItem>
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell align="center">
                          {isProviderConfigured(mapping.provider) ? (
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
              sx={{
                bgcolor: '#3b82f6',
                '&:hover': { bgcolor: '#2563eb' },
                px: 4,
                py: 1.5
              }}
            >
              Save Settings
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Settings;
