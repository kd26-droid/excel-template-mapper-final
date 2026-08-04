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

function App() {
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const isStandaloneRoute = ['/bom-normalizer', '/bom-normaliser'].includes(normalizedPath);

  if (isStandaloneRoute) {
    return (
      <Routes>
        <Route path="/bom-normalizer" element={<BomNormalizer />} />
        <Route path="/bom-normaliser" element={<BomNormalizer />} />
      </Routes>
    );
  }

  return (
    <div className="App" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <Container maxWidth="xl" sx={{ flexGrow: 1 }}>
        <Box sx={{ mt: 4, mb: 4 }}>
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
        </Box>
      </Container>
    </div>
  );
}

export default App;
