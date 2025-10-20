import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Container, Box } from '@mui/material';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import UploadFiles from './pages/UploadFiles';
import ColumnMapping from './pages/ColumnMapping';
import PDFZoneSelection from './pages/PDFZoneSelection';
import Settings from './pages/Settings';
// Prefer the enhanced, Azure-friendly data editor with robust synchronization
import EnhancedDataEditor from './components/EnhancedDataEditor';

function App() {
  return (
    <div className="App" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <Container maxWidth="xl" sx={{ flexGrow: 1 }}>
        <Box sx={{ mt: 4, mb: 4 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<UploadFiles />} />
            <Route path="/mapping/:sessionId" element={<ColumnMapping />} />
            <Route path="/editor/:sessionId" element={<EnhancedDataEditor />} />
            <Route path="/pdf-zones/:sessionId" element={<PDFZoneSelection />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Box>
      </Container>
    </div>
  );
}

export default App;
