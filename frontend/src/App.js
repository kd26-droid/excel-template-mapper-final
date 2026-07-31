import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import UploadFiles from './pages/UploadFiles';
import ColumnMapping from './pages/ColumnMapping';
import PDFZoneSelection from './pages/PDFZoneSelection';
import Settings from './pages/Settings';
import BomPreview from './pages/BomPreview';
import BomNormalizer from './pages/BomNormalizer';
import EnhancedDataEditor from './components/EnhancedDataEditor';
import { useThemeContext } from './utils/ThemeContext';

function App() {
  const location = useLocation();
  const { tokens } = useThemeContext();
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const isStandaloneRoute = ['/preview', '/bom-normalizer', '/bom-normaliser'].includes(normalizedPath);

  if (isStandaloneRoute) {
    return (
      <Routes>
        <Route path="/preview" element={<BomPreview />} />
        <Route path="/bom-normalizer" element={<BomNormalizer />} />
        <Route path="/bom-normaliser" element={<BomNormalizer />} />
      </Routes>
    );
  }

  return (
    <div
      className="App"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: tokens.background.app,
        color: tokens.text.primary,
        transition: 'background-color 0.3s ease, color 0.3s ease',
      }}
    >
      <Header />
      <Box sx={{ flexGrow: 1, bgcolor: tokens.background.app, width: '100%' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<UploadFiles />} />
          <Route path="/mapping/:sessionId" element={<ColumnMapping />} />
          <Route path="/editor/:sessionId" element={<EnhancedDataEditor />} />
          <Route path="/pdf-zones/:sessionId" element={<PDFZoneSelection />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/preview" element={<BomPreview />} />
          <Route path="/bom-normalizer" element={<BomNormalizer />} />
          <Route path="/bom-normaliser" element={<BomNormalizer />} />
        </Routes>
      </Box>
    </div>
  );
}

export default App;
