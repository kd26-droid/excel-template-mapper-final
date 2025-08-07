import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Container, Box } from '@mui/material';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import UploadFiles from './pages/UploadFiles';
import ColumnMapping from './pages/ColumnMapping';
import DataEditor from './pages/DataEditor';

function App() {
  return (
    <div className="App">
      <Header />
      <Container maxWidth="xl">
        <Box sx={{ mt: 4, mb: 4 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<UploadFiles />} />
            <Route path="/mapping/:sessionId" element={<ColumnMapping />} />
            <Route path="/editor/:sessionId" element={<DataEditor />} />
          </Routes>
        </Box>
      </Container>
    </div>
  );
}

export default App;