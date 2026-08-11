import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Container, Box } from '@mui/material';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import UploadFiles from './pages/UploadFiles';
import ColumnMapping from './pages/ColumnMapping';
import PDFZoneSelection from './pages/PDFZoneSelection';
import Settings from './pages/Settings';
import BomNormalizer from './pages/BomNormalizer';
// Prefer the enhanced, Azure-friendly data editor with robust synchronization
import EnhancedDataEditor from './components/EnhancedDataEditor';
import { useFactwise } from './contexts/FactwiseContext';
import { useSyncFactwiseCredentials } from './hooks/useSyncFactwiseCredentials';

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<UploadFiles />} />
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/upload" element={<UploadFiles />} />
    <Route path="/mapping/:sessionId" element={<ColumnMapping />} />
    <Route path="/editor/:sessionId" element={<EnhancedDataEditor />} />
    <Route path="/pdf-zones/:sessionId" element={<PDFZoneSelection />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/bom-normalizer" element={<BomNormalizer />} />
    <Route path="/bom-normaliser" element={<BomNormalizer />} />
  </Routes>
);

function App() {
  const location = useLocation();
  // FactwiseContext is still mounted (captures ?embedded=1 params silently for
  // future BE integration), but the UI is intentionally IDENTICAL to standalone
  // whether or not the app is inside the Factwise iframe.
  useFactwise();
  // Silent one-shot sync: when embedded, pull decrypted distributor credentials
  // from Factwise and push them into this app's own credential store. No UI.
  useSyncFactwiseCredentials();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const isBomNormalizerRoute = ['/bom-normalizer', '/bom-normaliser'].includes(
    normalizedPath
  );

  if (isBomNormalizerRoute) {
    return (
      <div className="App" style={{ minHeight: '100vh' }}>
        <AppRoutes />
      </div>
    );
  }

  return (
    <div className="App" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <Container maxWidth="xl" sx={{ flexGrow: 1 }}>
        <Box sx={{ mt: 4, mb: 4 }}>
          <AppRoutes />
        </Box>
      </Container>
    </div>
  );
}

export default App;
