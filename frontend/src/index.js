import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { FactWiseThemeProvider } from './utils/ThemeContext';
import { FactwiseProvider } from './contexts/FactwiseContext';
import FactwiseSessionExpiredBanner from './components/FactwiseSessionExpiredBanner';

// Chrome's ResizeObserver fires a benign "loop completed with undelivered
// notifications" warning whenever nested resize-observing components (MUI
// DataGrid, ag-grid, etc.) settle across frames. It's not a real error and
// the framework recovers on the next frame, but CRA's dev-server error
// overlay treats every `window.onerror` as fatal and shows the red screen.
// Swallow only this specific message so the overlay doesn't hijack the UI.
const RESIZE_OBSERVER_ERR = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
window.addEventListener('error', (event) => {
  if (event.message && RESIZE_OBSERVER_ERR.test(event.message)) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || String(event?.reason || '');
  if (RESIZE_OBSERVER_ERR.test(msg)) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <FactwiseProvider>
        <FactWiseThemeProvider>
          <App />
          <FactwiseSessionExpiredBanner />
        </FactWiseThemeProvider>
      </FactwiseProvider>
    </BrowserRouter>
  </React.StrictMode>
);