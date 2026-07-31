import React, { useEffect, useState } from 'react';
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
  const { tokens, isDarkMode } = useThemeContext();
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  const isStandaloneRoute = ['/preview', '/bom-normalizer', '/bom-normaliser'].includes(normalizedPath);

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
        position: 'relative',
        isolation: 'isolate',
        backgroundColor: tokens.background.app,
        color: tokens.text.primary,
        transition: 'background-color 0.3s ease, color 0.3s ease',
      }}
    >
      <Box
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '50%',
          opacity: 0.22,
          width: '62vw',
          height: '62vw',
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(90px)',
          background: 'radial-gradient(circle, var(--color-brand, #2383e2) 0%, transparent 70%)',
          zIndex: -2
        }}
      />
      <Box
        className="auth-grid-pattern"
        sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: isDarkMode ? 0.34 : 0.18, zIndex: -1 }}
      />
      <Header />
      <Box sx={{ flexGrow: 1, bgcolor: 'transparent', width: '100%' }}>
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
