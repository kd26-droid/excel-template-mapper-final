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
            border: `1px solid ${tokens.border.default}`,
            color: tokens.text.primary,
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
            borderRadius: 10,
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
            backgroundColor: tokens.action.primary,
            '&:hover': { backgroundColor: tokens.action.primaryHover },
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
        styleOverrides: {
          tooltip: {
            backgroundColor: tokens.color.dark,
            color: tokens.color.white,
            fontWeight: 600,
          },
        },
      },
    },
  });

export default buildTheme;