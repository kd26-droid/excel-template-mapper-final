import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { FactWiseThemeProvider } from './utils/ThemeContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <FactWiseThemeProvider>
        <App />
      </FactWiseThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);