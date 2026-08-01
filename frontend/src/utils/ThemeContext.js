import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { buildTheme } from './theme';

// ─── Context ────────────────────────────────────────────────────────────────
const ThemeContext = createContext({
  mode: 'dark',
  isDarkMode: true,
  tokens: {},
  toggleThemeMode: () => {},
});

// ─── localStorage key ───────────────────────────────────────────────────────
const STORAGE_KEY = 'factwise-theme-mode';

const readStoredMode = () => {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch (_) { /* ignore */ }
  return 'dark';
};

// ─── Design‑token factory (extracted from final-2 compiled build) ───────────
const buildTokens = (isDark) => {
  const a = isDark; // shorthand used everywhere below
  return {
    /* ── colour primitives ─────────────────────────────────────────────── */
    color: {
      primary:        '#2563eb',
      primaryHover:   '#1d4ed8',
      primaryLight:   '#60a5fa',
      primarySoftText: a ? '#bfdbfe' : '#1d4ed8',
      secondary:      '#7c3aed',
      cyan:           '#0284c7',
      cyanStrong:     '#0369a1',
      purple:         '#9333ea',
      gold:           a ? '#fbbf24' : '#b45309',
      bronze:         a ? '#fdba74' : '#c2410c',
      silver:         a ? '#cbd5e1' : '#475569',
      info:           '#0284c7',
      infoText:       a ? '#bae6fd' : '#0369a1',
      success:        a ? '#34d399' : '#059669',
      successText:    a ? '#a7f3d0' : '#047857',
      warning:        '#f59e0b',
      warningText:    a ? '#fbbf24' : '#b45309',
      danger:         '#ef4444',
      white:          '#ffffff',
      dark:           '#0f172a',
    },

    /* ── backgrounds ───────────────────────────────────────────────────── */
    background: {
      app:  a ? '#0b0f19' : '#f8fafc',
      glow: a
        ? 'radial-gradient(circle, rgba(35, 131, 226, 0.25) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(37, 99, 235, 0.08) 0%, transparent 70%)',
    },

    /* ── text ──────────────────────────────────────────────────────────── */
    text: {
      primary:   a ? '#f8fafc' : '#0f172a',
      secondary: a ? '#94a3b8' : '#475569',
      disabled:  a ? '#64748b' : '#94a3b8',
      inverse:   '#ffffff',
      accent:    a ? '#93c5fd' : '#2563eb',
      onAccent:  '#ffffff',
      table:     a ? '#e2e8f0' : '#1e293b',
      heading:   a ? '#f8fafc' : '#0f172a',
    },

    /* ── surfaces ──────────────────────────────────────────────────────── */
    surface: {
      page:       a ? '#0b0f19' : '#f8fafc',
      paper:      a ? '#111827' : '#ffffff',
      card:       a ? 'rgba(19, 24, 35, 0.75)' : '#ffffff',
      cardSolid:  a ? '#131823' : '#ffffff',
      cardGradient: a
        ? 'linear-gradient(135deg, rgba(20, 27, 41, 0.72) 0%, rgba(12, 17, 26, 0.82) 100%)'
        : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
      elevated:   a ? 'rgba(20, 27, 44, 0.98)' : '#ffffff',
      elevatedSoft: a ? 'rgba(11, 16, 26, 0.98)' : '#f8fafc',
      elevatedGradient: a
        ? 'linear-gradient(145deg, rgba(20, 27, 44, 0.98) 0%, rgba(11, 16, 26, 0.99) 100%)'
        : 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
      elevatedSoftGradient: a
        ? 'linear-gradient(145deg, rgba(20, 27, 44, 0.96) 0%, rgba(11, 16, 26, 0.98) 100%)'
        : 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
      muted:      a ? '#1e293b' : '#f1f5f9',
      subtle:     a ? 'rgba(11, 15, 25, 0.45)' : '#f8fafc',
      input:      a ? 'rgba(15, 23, 42, 0.58)' : '#ffffff',
      inputStrong: a ? 'rgba(15, 23, 42, 0.65)' : '#ffffff',
      control:    a ? 'rgba(10, 14, 23, 0.85)' : '#e2e8f0',
      controlSoft: a ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9',
      menu:       a ? '#0d1527' : '#ffffff',
      footer:     a ? 'rgba(11, 16, 26, 0.92)' : '#f8fafc',
      panel:      a ? 'rgba(15, 23, 42, 0.85)' : '#ffffff',
    },

    /* ── borders ───────────────────────────────────────────────────────── */
    border: {
      default:     a ? 'rgba(255,255,255,0.14)' : 'rgba(226, 232, 240, 0.8)',
      subtle:      a ? 'rgba(255,255,255,0.08)' : 'rgba(226, 232, 240, 0.6)',
      strong:      a ? 'rgba(255,255,255,0.2)'  : 'rgba(203, 213, 225, 0.8)',
      hover:       a ? 'rgba(255,255,255,0.28)' : '#2563eb',
      focus:       '#2563eb',
      input:       a ? 'rgba(255, 255, 255, 0.18)' : '#cbd5e1',
      panelAccent: a ? 'rgba(59, 130, 246, 0.35)' : 'rgba(37, 99, 235, 0.25)',
      modal:       a ? 'rgba(255, 255, 255, 0.16)' : '#e2e8f0',
    },

    /* ── actions ────────────────────────────────────────────────────────── */
    action: {
      primary:      '#2563eb',
      primaryHover: '#1d4ed8',
      primarySoft:  a ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.1)',
      primarySofter: a ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.08)',
      hover:        a ? 'rgba(255,255,255,0.06)' : 'rgba(37, 99, 235, 0.08)',
      selected:     a ? 'rgba(37, 99, 235, 0.16)' : 'rgba(37, 99, 235, 0.1)',
      selectedStrong:
        'linear-gradient(180deg, rgba(35, 131, 226, 0.95) 0%, rgba(29, 110, 192, 0.95) 100%)',
      selectedStrongHover:
        'linear-gradient(180deg, rgba(35, 131, 226, 0.95) 0%, rgba(29, 110, 192, 0.95) 100%)',
    },

    /* ── semantic states ───────────────────────────────────────────────── */
    state: {
      successBg:     a ? 'rgba(52, 211, 153, 0.15)' : 'rgba(16, 185, 129, 0.12)',
      successBorder: a ? 'rgba(52, 211, 153, 0.3)'  : 'rgba(16, 185, 129, 0.22)',
      warningBg:     a ? 'rgba(245, 158, 11, 0.14)' : 'rgba(245, 158, 11, 0.16)',
      warningBorder: a ? 'rgba(245, 158, 11, 0.28)' : 'rgba(245, 158, 11, 0.24)',
      infoBg:        a ? 'rgba(14, 165, 233, 0.12)' : '#e5f5fd',
      infoBorder:    a ? 'rgba(56, 189, 248, 0.22)' : 'rgba(14, 165, 233, 0.18)',
      dangerBg:      a ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2',
      dangerBorder:  a ? 'rgba(239, 68, 68, 0.28)' : 'rgba(239, 68, 68, 0.2)',
    },

    /* ── table ─────────────────────────────────────────────────────────── */
    table: {
      background:  a ? 'rgba(6, 12, 24, 0.82)' : '#ffffff',
      header:      a ? '#111827' : '#f8fafc',
      hover:       a ? 'rgba(37, 99, 235, 0.08)' : '#eff6ff',
      selected:    a ? 'rgba(35, 131, 226, 0.12)' : 'rgba(37, 99, 235, 0.08)',
      rowExpanded: a ? 'rgba(15, 20, 30, 0.9)' : '#f8fafc',
      line:        a ? 'rgba(255,255,255,0.08)' : 'rgba(226, 232, 240, 0.8)',
      rowLine:     a ? 'rgba(255,255,255,0.04)' : 'rgba(241, 245, 249, 0.9)',
    },

    /* ── dropzone ──────────────────────────────────────────────────────── */
    dropzone: {
      background: a ? 'rgba(11, 15, 25, 0.65)' : '#ffffff',
      selected:   a
        ? 'linear-gradient(180deg, rgba(37, 99, 235, 0.12), rgba(15, 23, 42, 0.92))'
        : 'linear-gradient(180deg, rgba(37, 99, 235, 0.06), #ffffff)',
      active:     a
        ? 'linear-gradient(180deg, rgba(37, 99, 235, 0.18), rgba(15, 23, 42, 0.95))'
        : 'linear-gradient(180deg, rgba(37, 99, 235, 0.1), #ffffff)',
    },

    /* ── header ────────────────────────────────────────────────────────── */
    header: {
      background: a ? 'rgba(11, 16, 26, 0.65)' : 'rgba(255, 255, 255, 0.75)',
      capsule: a
        ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.03) 100%)'
        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(248, 250, 252, 0.65) 100%)',
      capsuleBorder: a ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.8)',
      capsuleShadow: a
        ? '0 8px 32px 0 rgba(0, 0, 0, 0.37), inset 0 1px 1px 0 rgba(255, 255, 255, 0.15)'
        : '0 4px 20px 0 rgba(15, 23, 42, 0.06), inset 0 1px 1px 0 rgba(255, 255, 255, 0.9)',
      topLine: 'linear-gradient(90deg, transparent 0%, rgba(35, 131, 226, 0.8) 30%, rgba(6, 182, 212, 0.9) 50%, rgba(35, 131, 226, 0.8) 70%, transparent 100%)',
    },

    /* ── light / dark toggle ───────────────────────────────────────────── */
    toggle: {
      lightText:  a ? 'rgba(148, 163, 184, 0.48)' : '#172033',
      darkText:   a ? '#ffffff' : 'rgba(100, 116, 139, 0.46)',
      track:      a
        ? 'linear-gradient(180deg, #101827 0%, #020617 58%, #030712 100%)'
        : 'linear-gradient(180deg, #8bb6ff 0%, #5f8ff1 100%)',
      thumb:      '#ffffff',
      thumbIcon:  '#f59e0b',
      moonCutout: '#050b18',
      star:       '#ffffff',
    },

    /* ── shadows ───────────────────────────────────────────────────────── */
    shadow: {
      card:    a
        ? '0 1px 1px 0 rgba(255,255,255,0.1) inset, 0 12px 32px -4px rgba(0,0,0,0.5)'
        : '0 4px 20px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.04)',
      modal:   a
        ? 'inset 0 1px 0 0 rgba(255,255,255,0.18), 0 32px 90px -12px rgba(0,0,0,0.85), 0 0 45px rgba(37,99,235,0.18)'
        : '0 20px 50px -12px rgba(15, 23, 42, 0.12), 0 0 1px 1px rgba(15, 23, 42, 0.05)',
      control: a
        ? 'inset 0 1px 3px rgba(0,0,0,0.6), 0 2px 10px rgba(0,0,0,0.3)'
        : 'inset 0 1px 2px rgba(0,0,0,0.05)',
    },

    /* ── overlays ──────────────────────────────────────────────────────── */
    overlay: {
      backdrop: a ? 'rgba(2, 6, 23, 0.72)' : 'rgba(15, 23, 42, 0.25)',
    },
  };
};

// ─── Provider ───────────────────────────────────────────────────────────────
export const FactWiseThemeProvider = ({ children }) => {
  const [mode, setMode] = useState(readStoredMode);
  const isDarkMode = mode === 'dark';

  const tokens = useMemo(() => buildTokens(isDarkMode), [isDarkMode]);

  // Persist + set data-theme attribute
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch (_) { /* ignore */ }
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  // Build MUI theme from tokens
  const muiTheme = useMemo(() => buildTheme(mode, tokens), [mode, tokens]);

  const ctx = useMemo(() => ({
    mode,
    isDarkMode,
    tokens,
    toggleThemeMode: () => setMode(prev => prev === 'dark' ? 'light' : 'dark'),
  }), [mode, isDarkMode, tokens]);

  return (
    <ThemeContext.Provider value={ctx}>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

// ─── Hook ───────────────────────────────────────────────────────────────────
export const useThemeContext = () => useContext(ThemeContext);

export default ThemeContext;
