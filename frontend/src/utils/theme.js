import { createTheme } from '@mui/material/styles';

/**
 * Build an MUI theme from the FactWise design-token object.
 * Called by ThemeContext whenever mode or tokens change.
 *
 * @param {'light'|'dark'} mode
 * @param {object} tokens  – the full token tree from ThemeContext
 * @returns {import('@mui/material').Theme}
 */
export const buildTheme = (mode, tokens) =>
  createTheme({
    palette: {
      mode,
      primary:    { main: tokens.color.primary },
      secondary:  { main: tokens.color.secondary },
      background: { default: tokens.background.app, paper: tokens.surface.paper },
      text:       { primary: tokens.text.primary, secondary: tokens.text.secondary },
      divider:    tokens.border.default,
      // expose the full token tree so any MUI-consuming component can read
      // theme.palette.fw.surface.card, etc.
      fw: tokens,
    },

    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    },

    shape: { borderRadius: 10 },

    components: {
      /* ── Global baseline ─────────────────────────────────────────────── */
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: tokens.background.app,
            color: tokens.text.primary,
          },
          '*::selection': {
            backgroundColor: tokens.action.primarySoft,
          },
        },
      },

      /* ── Paper ───────────────────────────────────────────────────────── */
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: tokens.surface.paper,
            color: tokens.text.primary,
          },
        },
      },

      /* ── Dialog ──────────────────────────────────────────────────────── */
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${tokens.border.modal}`,
            borderRadius: 18,
            backgroundColor: mode === 'dark'
              ? 'rgba(17, 24, 39, 0.84)'
              : 'rgba(255, 255, 255, 0.84)',
            backgroundImage: tokens.surface.elevatedGradient,
            backdropFilter: 'blur(22px) saturate(180%)',
            WebkitBackdropFilter: 'blur(22px) saturate(180%)',
            color: tokens.text.primary,
            boxShadow: tokens.shadow.modal,
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: tokens.text.heading,
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            borderTop: `1px solid ${tokens.border.subtle}`,
            backgroundColor: mode === 'dark'
              ? 'rgba(11, 16, 26, 0.48)'
              : 'rgba(248, 250, 252, 0.58)',
            padding: '16px 24px',
          },
        },
      },

      /* ── Input label ─────────────────────────────────────────────────── */
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: tokens.text.secondary,
            '&.Mui-focused': { color: tokens.color.info },
          },
        },
      },

      /* ── Outlined input ──────────────────────────────────────────────── */
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            color: tokens.text.primary,
            backgroundColor: tokens.surface.input,
            '& fieldset':              { borderColor: tokens.border.default },
            '&:hover fieldset':        { borderColor: tokens.border.hover },
            '&.Mui-focused fieldset':  { borderColor: tokens.border.focus },
          },
          input: {
            color: tokens.text.primary,
            '&::placeholder': { color: tokens.text.secondary, opacity: 1 },
          },
        },
      },

      /* ── Select ──────────────────────────────────────────────────────── */
      MuiSelect: {
        styleOverrides: {
          icon:   { color: tokens.text.secondary },
          select: { color: tokens.text.primary },
        },
      },

      /* ── Menu ────────────────────────────────────────────────────────── */
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: tokens.surface.menu,
            border: `1px solid ${tokens.border.default}`,
            color: tokens.text.primary,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            color: tokens.text.primary,
            '&:hover': {
              backgroundColor: tokens.action.primarySoft,
              color: tokens.color.primarySoftText,
            },
            '&.Mui-selected': {
              backgroundColor: tokens.action.primarySoft,
            },
          },
        },
      },

      /* ── Button ──────────────────────────────────────────────────────── */
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            textTransform: 'none',
            fontWeight: 700,
          },
          outlined: {
            borderColor: tokens.border.default,
            color: tokens.color.primarySoftText,
            '&:hover': {
              borderColor: tokens.color.primaryLight,
              backgroundColor: tokens.action.primarySoft,
            },
          },
          containedPrimary: {
            background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
            color: '#ffffff',
            boxShadow: '0 12px 26px -14px rgba(37, 99, 235, 0.9)',
            '&:hover': {
              background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
              boxShadow: '0 16px 32px -16px rgba(37, 99, 235, 0.95)',
            },
          },
        },
      },

      /* ── Checkbox ────────────────────────────────────────────────────── */
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: tokens.text.secondary,
            '&.Mui-checked': { color: tokens.border.focus },
          },
        },
      },

      /* ── Chip ────────────────────────────────────────────────────────── */
      MuiChip: {
        styleOverrides: {
          root:     { fontWeight: 700 },
          outlined: { borderColor: tokens.border.default, color: tokens.text.primary },
        },
      },

      /* ── Alert ───────────────────────────────────────────────────────── */
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },

      /* ── Tooltip ─────────────────────────────────────────────────────── */
      MuiTooltip: {
        defaultProps: {
          arrow: true,
        },
        styleOverrides: {
          tooltip: {
            backgroundColor: mode === 'dark' ? '#1e293b' : '#0f172a',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: 10,
            padding: '7px 14px',
            border: mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.14)' : '1px solid rgba(15, 23, 42, 0.2)',
            boxShadow: mode === 'dark'
              ? '0 12px 28px -4px rgba(0, 0, 0, 0.65), 0 0 15px rgba(37, 99, 235, 0.15)'
              : '0 12px 28px -4px rgba(15, 23, 42, 0.3)',
          },
          arrow: {
            color: mode === 'dark' ? '#1e293b' : '#0f172a',
          },
        },
      },
    },
  });

export default buildTheme;
