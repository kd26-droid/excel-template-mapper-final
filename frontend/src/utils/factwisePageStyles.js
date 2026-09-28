const alpha = (hex, opacity) => {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const value = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${value}`;
};

export const buildFactWisePageTokens = (isDarkMode, themeTokens = {}) => {
  const isDark = Boolean(isDarkMode);
  const pageCanvas = isDark ? '#0f131a' : '#f4f7ff';
  return {
    bg: pageCanvas,
    pageBackground: isDark
      ? '#0f131a'
      : 'radial-gradient(circle at 15% 8%, rgba(255, 255, 255, 0.95), transparent 28%), linear-gradient(135deg, #eef3f8 0%, #f5f7f9 46%, #eef4fb 100%)',
    text: themeTokens.text?.primary || (isDark ? '#f8fafc' : '#20242c'),
    muted: isDark ? '#a3a3a8' : '#566070',
    disabled: isDark ? '#6b7280' : '#8a94a3',
    surface: isDark ? '#171b23' : '#ffffff',
    surfaceSolid: isDark ? '#171b23' : '#ffffff',
    surfaceSoft: isDark ? '#1a202b' : '#f7faff',
    rail: isDark ? '#171d27' : '#f7faff',
    border: isDark ? 'rgba(148, 163, 184, 0.24)' : 'rgba(30, 64, 175, 0.12)',
    subtleBorder: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(59, 130, 246, 0.08)',
    strongBorder: isDark ? 'rgba(148, 163, 184, 0.32)' : 'rgba(37, 99, 235, 0.20)',
    table: isDark ? '#171b23' : '#ffffff',
    tableHeader: isDark ? '#202938' : '#eaf2fb',
    tableLine: isDark ? 'rgba(148, 163, 184, 0.26)' : '#cbd9e8',
    rowLine: isDark ? 'rgba(148, 163, 184, 0.16)' : '#e1eaf4',
    rowHover: isDark ? 'rgba(0, 122, 255, 0.16)' : '#edf7ff',
    activeRow: isDark ? 'rgba(0, 122, 255, 0.24)' : '#dff0ff',
    inputBg: isDark ? '#171d27' : '#ffffff',
    searchBg: isDark ? '#171d27' : '#ffffff',
    controlBg: isDark ? '#171d27' : '#f7faff',
    primary: '#007aff',
    primaryHover: '#0d80ff',
    primarySoft: isDark ? 'rgba(0, 122, 255, 0.24)' : '#e6f2ff',
    primaryText: isDark ? '#66b3ff' : '#005ecb',
    success: isDark ? '#34d399' : '#059669',
    successBg: isDark ? '#123d31' : '#e8fff4',
    warning: isDark ? '#fde047' : '#a35a00',
    warningBg: isDark ? '#443605' : '#fff2bd',
    cardShadow: isDark
      ? '0 16px 36px -24px rgba(0, 0, 0, 0.60), inset 0 1px 0 rgba(255,255,255,0.045)'
      : '0 14px 34px -24px rgba(15, 23, 42, 0.42), inset 0 1px 0 rgba(255,255,255,0.86)',
    panelGradient: isDark
      ? 'linear-gradient(145deg, #171b23 0%, #151922 100%)'
      : 'linear-gradient(145deg, #ffffff 0%, #fbfcfe 100%)',
    panelSoftGradient: isDark
      ? 'linear-gradient(145deg, #1b1d23 0%, #17181d 100%)'
      : 'linear-gradient(145deg, #ffffff 0%, #f7faff 100%)',
    glow: isDark ? '#2563eb2e' : '#007aff42',
    glowMid: isDark ? '#2563eb21' : '#60a5fa2e',
  };
};

export const factWisePageShellSx = (tokens) => ({
  position: 'relative',
  minHeight: '100vh',
  width: '100%',
  overflow: 'hidden',
  isolation: 'isolate',
  bgcolor: tokens.bg,
  background: tokens.pageBackground || tokens.bg,
  color: tokens.text,
});

export const factWiseGridOverlaySx = (tokens) => ({
  pointerEvents: 'none',
  position: 'absolute',
  inset: 0,
  opacity: tokens.bg === '#0f131a' ? 0.18 : 0.3,
  zIndex: 0,
  backgroundImage:
    `linear-gradient(to right, ${alpha(tokens.border, 0.82)} 1px, transparent 1px), linear-gradient(to bottom, ${alpha(tokens.border, 0.82)} 1px, transparent 1px)`,
  backgroundSize: '68px 68px',
  maskImage: 'radial-gradient(82% 62% at 50% 32%, #000 0%, transparent 82%)',
  WebkitMaskImage: 'radial-gradient(82% 62% at 50% 32%, #000 0%, transparent 82%)',
});

export const factWiseGlowSx = (tokens) => ({
  pointerEvents: 'none',
  position: 'fixed',
  right: -120,
  bottom: -180,
  width: 520,
  height: 520,
  borderRadius: '50%',
  filter: 'blur(92px)',
  opacity: 0.9,
  background: `radial-gradient(circle, ${tokens.glow}, ${tokens.glowMid} 38%, transparent 70%)`,
  zIndex: 0,
});

export const factWiseTopShadeSx = (isDarkMode) => ({
  pointerEvents: 'none',
  position: 'fixed',
  inset: 0,
  display: isDarkMode ? 'block' : 'none',
  zIndex: 0,
  background:
    'linear-gradient(180deg, rgba(0,0,0,0.48) 0%, rgba(0,0,0,0.28) 20%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0) 74%)',
});

export const factWiseCardSx = (tokens) => ({
  borderRadius: '14px',
  border: `1px solid ${tokens.border}`,
  bgcolor: tokens.surface,
  color: tokens.text,
  boxShadow: tokens.cardShadow,
});

export const factWisePrimaryButtonSx = {
  height: 36,
  minHeight: 36,
  px: 2,
  borderRadius: '999px',
  border: '1px solid #007aff',
  background: 'linear-gradient(180deg, #0d80ff 0%, #007aff 100%)',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 500,
  lineHeight: 1,
  letterSpacing: 0,
  textTransform: 'none',
  boxShadow: '0 12px 20px -10px rgba(0, 122, 255, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.28)',
  transition: 'filter 150ms ease, transform 150ms ease, box-shadow 150ms ease',
  '&:hover': {
    background: 'linear-gradient(180deg, #1687ff 0%, #006ee6 100%)',
    filter: 'brightness(1.05)',
    boxShadow: '0 12px 20px -10px rgba(0, 122, 255, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.28)',
  },
  '&:active': {
    filter: 'brightness(0.95)',
    transform: 'scale(0.98)',
  },
  '&.Mui-disabled': {
    borderColor: 'rgba(148, 163, 184, 0.28)',
    background: 'rgba(148, 163, 184, 0.22)',
    color: 'rgba(226, 232, 240, 0.58)',
    boxShadow: 'none',
    filter: 'none',
    transform: 'none',
  },
};

export const factWiseCancelButtonSx = (tokens, options = {}) => {
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  return {
    minWidth: options.minWidth || 88,
    height: options.height || 36,
    px: options.px || 2.25,
    borderRadius: '999px',
    border: isDark ? '1px solid rgba(248, 113, 113, 0.20)' : '1px solid #fecaca',
    bgcolor: isDark ? 'rgba(127, 29, 29, 0.14)' : '#fff1f2',
    color: isDark ? '#fca5a5' : '#dc2626',
    fontSize: options.fontSize || '13px',
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: 0,
    textTransform: 'none',
    boxShadow: 'none',
    transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease',
    '&:hover': {
      bgcolor: isDark ? 'rgba(239, 68, 68, 0.18)' : '#ffe4e6',
      borderColor: isDark ? 'rgba(248, 113, 113, 0.34)' : '#fca5a5',
      color: isDark ? '#fecaca' : '#dc2626',
      boxShadow: 'none',
    },
    '&.Mui-disabled': {
      borderColor: isDark ? 'rgba(148, 163, 184, 0.16)' : '#e5e7eb',
      bgcolor: isDark ? 'rgba(148, 163, 184, 0.08)' : '#f8fafc',
      color: isDark ? 'rgba(226, 232, 240, 0.42)' : '#94a3b8',
    },
    ...options.sx,
  };
};

export const factWiseFieldSx = (tokens, options = {}) => {
  const height = options.height || 40;
  const radius = options.radius || 8;
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  const controlFontSize = Number(height) <= 36 ? '12.5px' : '13px';
  const idleShadow = isDark
    ? 'none'
    : '0 1px 1px rgba(15, 23, 42, 0.03)';
  const focusShadow = isDark
    ? `0 0 0 1px ${alpha(tokens.primary, 0.18)}`
    : `0 0 0 2px ${alpha(tokens.primary, 0.12)}, 0 8px 22px -18px rgba(15, 23, 42, 0.38)`;
  const sizedRoot = height === 'auto'
    ? { minHeight: '40px', borderRadius: `${radius}px` }
    : { minHeight: `${height}px !important`, height: `${height}px !important`, borderRadius: `${radius}px` };
  const inputHeight = height === 'auto' ? {} : { height: `${height}px !important` };
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    '& .MuiInputLabel-root': {
      color: tokens.muted,
      position: 'static',
      transform: 'none',
      fontSize: '12px',
      fontWeight: 500,
      letterSpacing: 0,
      lineHeight: 1,
      maxWidth: 'calc(100% - 24px)',
      marginBottom: '5px',
      '&.MuiInputLabel-shrink': {
        transform: 'none',
      },
      '&.Mui-focused': {
        color: tokens.muted,
      },
    },
    '& .MuiInputBase-root': {
      ...sizedRoot,
      bgcolor: tokens.inputBg,
      color: tokens.text,
      fontSize: controlFontSize,
      fontWeight: 400,
      letterSpacing: 0,
      boxShadow: idleShadow,
      transition: 'border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease',
    },
    '& .MuiInputBase-input': {
      py: 0,
      px: 1.5,
      ...inputHeight,
      boxSizing: 'border-box',
      fontSize: controlFontSize,
      fontWeight: 400,
      color: tokens.text,
      '&::placeholder': {
        color: tokens.muted,
        opacity: 1,
      },
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: tokens.strongBorder,
      top: 0,
      '& legend': {
        display: 'block',
        width: 0,
        maxWidth: 0,
        height: 0,
        padding: 0,
        visibility: 'hidden',
        '& span': {
          display: 'none',
        },
      },
    },
    '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: isDark ? 'rgba(255, 255, 255, 0.28)' : tokens.primaryHover,
    },
    '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: `${tokens.primary} !important`,
      borderWidth: '1px',
    },
    '& .MuiInputBase-root.Mui-focused': {
      boxShadow: focusShadow,
    },
    '& .MuiFormHelperText-root': {
      color: tokens.muted,
      fontSize: '11px',
      fontWeight: 400,
      lineHeight: 1.35,
      ml: 0,
    },
    '& .MuiSelect-icon': {
      color: tokens.muted,
    },
  };
};

export const factWiseInputLabelSx = (tokens) => ({
  color: tokens.muted,
  position: 'static',
  transform: 'none',
  fontSize: '12px',
  fontWeight: 500,
  letterSpacing: 0,
  lineHeight: 1,
  maxWidth: 'calc(100% - 24px)',
  mb: '5px',
  '&.MuiInputLabel-shrink': {
    transform: 'none',
  },
  '&.Mui-focused': {
    color: tokens.muted,
  },
});

export const factWiseSelectFieldSx = (tokens, options = {}) => {
  const height = options.height || 40;
  const radius = options.radius || 8;
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  const controlFontSize = Number(height) <= 36 ? '12.5px' : '13px';
  const idleShadow = isDark
    ? 'none'
    : '0 1px 1px rgba(15, 23, 42, 0.03)';
  const focusShadow = isDark
    ? `0 0 0 1px ${alpha(tokens.primary, 0.18)}`
    : `0 0 0 2px ${alpha(tokens.primary, 0.12)}, 0 8px 22px -18px rgba(15, 23, 42, 0.38)`;
  const rootSize = height === 'auto'
    ? { minHeight: '40px', borderRadius: `${radius}px` }
    : { minHeight: `${height}px !important`, height: `${height}px !important`, borderRadius: `${radius}px` };
  const selectHeight = height === 'auto' ? 'auto' : `${height}px !important`;
  return {
    ...rootSize,
    bgcolor: tokens.inputBg,
    color: tokens.text,
    fontSize: controlFontSize,
    fontWeight: 400,
    letterSpacing: 0,
    boxShadow: idleShadow,
    transition: 'border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease',
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: tokens.strongBorder,
      top: 0,
      '& legend': {
        display: 'block',
        width: 0,
        maxWidth: 0,
        height: 0,
        padding: 0,
        visibility: 'hidden',
        '& span': {
          display: 'none',
        },
      },
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: isDark ? 'rgba(255, 255, 255, 0.28)' : tokens.primaryHover,
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: `${tokens.primary} !important`,
      borderWidth: '1px',
    },
    '&.Mui-focused': {
      boxShadow: focusShadow,
    },
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      minHeight: 0,
      height: selectHeight,
      boxSizing: 'border-box',
      padding: '0 34px 0 12px !important',
      fontSize: controlFontSize,
      fontWeight: 400,
      lineHeight: 1.25,
    },
    '& .MuiSelect-icon': {
      color: tokens.muted,
      right: 8,
    },
  };
};

export const factWiseSelectMenuProps = (tokens, options = {}) => ({
  PaperProps: {
    className: 'fw-select-dropdown',
    sx: {
      width: options.width || { xs: 'calc(100vw - 48px)', sm: 340 },
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: options.maxHeight || 220,
      bgcolor: tokens.surface,
      color: tokens.text,
      border: `1px solid ${tokens.strongBorder}`,
      borderRadius: '8px',
      boxShadow: tokens.cardShadow,
      '& .MuiList-root': {
        py: '3px',
      },
      '& .MuiMenuItem-root': {
        minHeight: 30,
        alignItems: 'center',
        whiteSpace: 'normal',
        lineHeight: 1.3,
        fontSize: '12.5px',
        fontWeight: 400,
        py: '4px',
        px: '10px',
        color: tokens.text,
        margin: '1px 5px',
        borderRadius: '7px',
        '&:hover': {
          bgcolor: tokens.rowHover,
        },
        '&.Mui-selected': {
          bgcolor: tokens.primarySoft,
          color: tokens.primaryText,
          fontWeight: 500,
        },
      },
      '& .MuiMenuItem-root .MuiTypography-root, & .MuiMenuItem-root .MuiListItemText-primary': {
        fontSize: '12.5px',
        fontWeight: 400,
        lineHeight: 1.3,
      },
      '& .MuiMenuItem-root .MuiListItemText-root': {
        margin: 0,
        minWidth: 0,
      },
      '& .MuiMenuItem-root.Mui-selected .MuiTypography-root, & .MuiMenuItem-root.Mui-selected .MuiListItemText-primary': {
        fontWeight: 500,
      },
      '& .MuiListItemText-secondary': {
        fontSize: '11.5px',
        fontWeight: 400,
        lineHeight: 1.3,
      },
      '& .MuiCheckbox-root': {
        color: tokens.muted,
        width: 24,
        height: 24,
        p: '2px',
        mr: '8px',
        '&.Mui-checked': {
          color: tokens.primary,
        },
      },
      '& .MuiCheckbox-root .MuiSvgIcon-root': {
        width: 18,
        height: 18,
      },
      ...options.sx,
    },
  },
});

export const buildFactWiseTableTone = (tokens = {}) => {
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  return {
    bg: isDark ? '#171b23' : '#ffffff',
    header: isDark ? '#202938' : '#eaf2fb',
    row: isDark ? '#171b23' : '#ffffff',
    rowHover: isDark ? '#162941' : '#edf7ff',
    activeRow: isDark ? '#12365e' : '#dff0ff',
    warningBg: isDark ? '#2e2a14' : '#fff6d6',
    text: tokens.text || (isDark ? '#f8fafc' : '#20242c'),
    muted: tokens.muted || (isDark ? '#a3a3a8' : '#566070'),
    border: isDark ? 'rgba(148, 163, 184, 0.20)' : '#d8e4f0',
    headerBorder: isDark ? 'rgba(148, 163, 184, 0.28)' : '#c3d3e4',
    verticalDivider: isDark ? 'rgba(148, 163, 184, 0.20)' : '#d2dfec',
    controlBg: tokens.controlBg || (isDark ? '#1b1d23' : '#ffffff'),
    focusBg: tokens.surfaceSoft || (isDark ? '#1b2028' : '#f8fbff'),
    shadow: isDark
      ? '0 18px 42px -30px rgba(0, 0, 0, 0.86), inset 0 1px 0 rgba(255, 255, 255, 0.035)'
      : '0 18px 42px -30px rgba(15, 23, 42, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  };
};

export const factWiseTableContainerSx = (tableTone, sx = {}) => ({
  border: `1px solid ${tableTone.headerBorder}`,
  borderRadius: '16px',
  bgcolor: tableTone.bg,
  boxShadow: tableTone.shadow,
  overflow: 'auto',
  '&::-webkit-scrollbar': { height: 10, width: 10 },
  '&::-webkit-scrollbar-thumb': {
    borderRadius: 999,
    bgcolor: tableTone.muted === '#566070'
      ? 'rgba(86, 96, 112, 0.34)'
      : 'rgba(148, 163, 184, 0.36)',
    border: `2px solid ${tableTone.bg}`,
  },
  '&::-webkit-scrollbar-track': {
    bgcolor: tableTone.bg,
  },
  ...sx,
});

export const factWiseTableSx = (tableTone, sx = {}) => ({
  borderCollapse: 'separate',
  borderSpacing: 0,
  bgcolor: tableTone.bg,
  '& .MuiTableCell-root': {
    borderBottom: `1px dashed ${tableTone.border}`,
    color: tableTone.text,
    fontFamily: 'var(--fw-font-stack)',
    letterSpacing: 0,
  },
  '& .MuiTableHead-root .MuiTableCell-root': {
    bgcolor: tableTone.header,
    color: tableTone.text,
    borderBottom: `1px solid ${tableTone.headerBorder}`,
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1.25,
    py: 1.45,
  },
  '& .MuiTableBody-root .MuiTableRow-root': {
    bgcolor: tableTone.row,
    transition: 'background-color 150ms ease',
  },
  '& .MuiTableBody-root .MuiTableRow-root:hover': {
    bgcolor: tableTone.rowHover,
  },
  '& .MuiTableBody-root .MuiTableCell-root': {
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: 1.45,
    py: 1.35,
  },
  ...sx,
});

export const factWiseTableHeaderCellSx = (tableTone, sx = {}) => ({
  bgcolor: tableTone.header,
  color: tableTone.text,
  borderColor: tableTone.headerBorder,
  borderRight: `1px solid ${tableTone.verticalDivider}`,
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.25,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  '&:last-of-type': {
    borderRight: 0,
  },
  ...sx,
});

export const factWiseTableBodyCellSx = (tableTone, sx = {}) => ({
  color: tableTone.text,
  borderColor: tableTone.border,
  fontSize: '13px',
  fontWeight: 400,
  lineHeight: 1.45,
  ...sx,
});

export const factWiseTableRowSx = (tableTone, options = {}) => ({
  bgcolor: options.warning ? tableTone.warningBg : tableTone.row,
  transition: 'background-color 150ms ease',
  '&:hover': {
    bgcolor: options.warning ? tableTone.warningBg : tableTone.rowHover,
  },
  ...options.sx,
});

export const factWiseAlertSx = (tokens, severity = 'info', options = {}) => {
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  const palette = {
    success: {
      color: isDark ? '#bbf7d0' : '#047857',
      icon: isDark ? '#4ade80' : '#059669',
      bg: isDark ? 'rgba(22, 101, 52, 0.22)' : '#ecfdf5',
      border: isDark ? 'rgba(74, 222, 128, 0.18)' : 'rgba(16, 185, 129, 0.20)',
    },
    error: {
      color: isDark ? '#fecaca' : '#b91c1c',
      icon: isDark ? '#f87171' : '#dc2626',
      bg: isDark ? 'rgba(127, 29, 29, 0.24)' : '#fef2f2',
      border: isDark ? 'rgba(248, 113, 113, 0.20)' : 'rgba(239, 68, 68, 0.18)',
    },
    warning: {
      color: isDark ? '#fde68a' : '#92400e',
      icon: isDark ? '#fbbf24' : '#d97706',
      bg: isDark ? 'rgba(245, 158, 11, 0.14)' : '#fffbeb',
      border: isDark ? 'rgba(245, 158, 11, 0.24)' : '#fde68a',
    },
    info: {
      color: isDark ? '#bfdbfe' : '#075985',
      icon: isDark ? '#60a5fa' : tokens.primary,
      bg: isDark ? 'rgba(0, 122, 255, 0.12)' : '#eaf4ff',
      border: isDark ? 'rgba(96, 165, 250, 0.24)' : 'rgba(0, 122, 255, 0.18)',
    },
  };
  const softTone = palette[severity] || palette.info;
  const solidPalette = {
    success: { bg: '#16a34a', border: '#16a34a', color: '#ffffff', icon: '#ffffff' },
    info: { bg: tokens.primary || '#007aff', border: tokens.primary || '#007aff', color: '#ffffff', icon: '#ffffff' },
    warning: { bg: '#d97706', border: '#d97706', color: '#ffffff', icon: '#ffffff' },
    error: { bg: '#dc2626', border: '#dc2626', color: '#ffffff', icon: '#ffffff' },
  };
  const tone = options.solid ? (solidPalette[severity] || solidPalette.info) : softTone;

  return {
    mt: options.mt,
    mr: options.mr,
    mb: options.mb,
    ml: options.ml,
    mx: options.mx,
    my: options.my,
    width: options.width,
    maxWidth: options.maxWidth,
    display: options.display,
    minHeight: options.minHeight || 32,
    py: options.py ?? 0.28,
    px: options.px ?? 1.25,
    borderRadius: options.borderRadius || '999px',
    alignItems: 'center',
    bgcolor: tone.bg,
    backgroundColor: `${tone.bg} !important`,
    backgroundImage: 'none',
    opacity: 1,
    color: `${tone.color} !important`,
    border: `1px solid ${tone.border}`,
    boxShadow: options.boxShadow || 'none',
    fontSize: options.fontSize || '12px',
    fontWeight: options.fontWeight || 400,
    lineHeight: 1.25,
    '& .MuiAlert-icon': {
      py: 0,
      mr: 0.85,
      fontSize: options.iconSize || 17,
      color: `${tone.icon} !important`,
    },
    '& .MuiAlert-message': {
      py: 0,
      minWidth: 0,
      color: `${tone.color} !important`,
    },
    '& .MuiAlert-action': {
      py: 0,
      pl: 0.75,
      mr: -0.5,
    },
    '& .MuiIconButton-root': {
      width: 22,
      height: 22,
      p: 0.25,
      color: `${tone.color} !important`,
    },
    '& .MuiSvgIcon-root': {
      fontSize: options.svgSize || 18,
    },
    ...options.sx,
  };
};

export const factWiseToastAlertSx = (tokens, severity = 'info', options = {}) => {
  const { sx, ...rest } = options;
  return factWiseAlertSx(tokens, severity, {
    solid: true,
    width: 'fit-content',
    maxWidth: 'min(360px, calc(100vw - 40px))',
    minHeight: 38,
    px: 1.3,
    py: 0.55,
    borderRadius: '999px',
    fontSize: '12.5px',
    fontWeight: 500,
    iconSize: 18,
    boxShadow: '0 18px 42px -26px rgba(0, 0, 0, 0.72)',
    ...rest,
    sx: {
      '& .MuiAlert-message': {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      ...sx,
    },
  });
};

export const factWiseDialogPaperSx = (tokens, options = {}) => {
  const isDark = tokens.bg === '#09090b' || tokens.bg === '#090b10' || tokens.bg === '#0f131a';
  const alertTone = {
    info: factWiseAlertSx(tokens, 'info', { mt: 0, borderRadius: '8px', minHeight: 34, py: 0.45, px: 1.05, fontSize: '12px', iconSize: 16 }),
    success: factWiseAlertSx(tokens, 'success', { mt: 0, borderRadius: '8px', minHeight: 34, py: 0.45, px: 1.05, fontSize: '12px', iconSize: 16 }),
    warning: factWiseAlertSx(tokens, 'warning', { mt: 0, borderRadius: '8px', minHeight: 34, py: 0.45, px: 1.05, fontSize: '12px', iconSize: 16 }),
    error: factWiseAlertSx(tokens, 'error', { mt: 0, borderRadius: '8px', minHeight: 34, py: 0.45, px: 1.05, fontSize: '12px', iconSize: 16 }),
  };

  return {
    width: options.width,
    maxWidth: options.maxWidth || 720,
    borderRadius: options.borderRadius || '16px',
    overflow: 'hidden',
    bgcolor: tokens.surfaceSolid,
    color: tokens.text,
    border: `1px solid ${tokens.strongBorder}`,
    boxShadow: isDark
      ? '0 28px 82px -36px rgba(0, 0, 0, 0.92)'
      : '0 26px 72px -42px rgba(15, 23, 42, 0.26)',
    backgroundImage: isDark
      ? 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0))'
      : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,1) 34%)',
    '& .MuiDialogTitle-root': {
      px: 2.5,
      py: 2,
      color: tokens.text,
      fontSize: '18px',
      fontWeight: 600,
      lineHeight: 1.22,
      letterSpacing: 0,
    },
    '& .MuiDialogContent-root': {
      px: 2.5,
      py: 2.25,
      color: tokens.text,
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.45,
      borderColor: `${tokens.subtleBorder} !important`,
    },
    '& .MuiDialogActions-root': {
      px: 2.5,
      py: 1.5,
      gap: 1,
      borderTop: `1px solid ${tokens.subtleBorder}`,
      bgcolor: isDark ? 'rgba(15, 19, 26, 0.86)' : '#f8fafc',
    },
    '& .MuiDialogActions-root .MuiButton-root': {
      minHeight: 34,
      borderRadius: '999px',
      px: 2.1,
      fontSize: '13px',
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: 0,
      textTransform: 'none',
    },
    '& .MuiDialogActions-root .MuiButton-contained': {
      bgcolor: `${tokens.primary} !important`,
      color: '#ffffff !important',
      boxShadow: `0 12px 22px -16px ${alpha(tokens.primary, 0.92)}`,
    },
    '& .MuiTypography-root': {
      letterSpacing: 0,
    },
    '& .MuiTypography-body2': {
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.45,
    },
    '& .MuiTypography-caption': {
      fontSize: '11.5px',
      fontWeight: 400,
      lineHeight: 1.4,
    },
    '& .MuiTypography-overline': {
      fontSize: '11.5px',
      fontWeight: 600,
      lineHeight: 1.25,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
    },
    '& .MuiFormLabel-root': {
      fontSize: '12.5px',
      fontWeight: 500,
      color: `${tokens.muted} !important`,
      letterSpacing: 0,
    },
    '& .MuiInputLabel-root': factWiseInputLabelSx(tokens),
    '& .MuiInputBase-root': {
      minHeight: '36px',
      height: '36px',
      borderRadius: '8px',
      bgcolor: tokens.inputBg,
      color: tokens.text,
      fontSize: '13px',
      fontWeight: 400,
      boxShadow: isDark ? 'none' : '0 1px 1px rgba(15, 23, 42, 0.03)',
    },
    '& .MuiInputBase-input': {
      height: '36px',
      boxSizing: 'border-box',
      py: 0,
      px: 1.35,
      fontSize: '13px',
      fontWeight: 400,
      color: tokens.text,
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: tokens.strongBorder,
      top: 0,
      '& legend': {
        display: 'block',
        width: 0,
        maxWidth: 0,
        height: 0,
        padding: 0,
        visibility: 'hidden',
        '& span': {
          display: 'none',
        },
      },
    },
    '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: isDark ? 'rgba(255, 255, 255, 0.28)' : tokens.primaryHover,
    },
    '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: `${tokens.primary} !important`,
      borderWidth: '1px',
    },
    '& .MuiInputBase-root.Mui-focused': {
      boxShadow: isDark
        ? `0 0 0 1px ${alpha(tokens.primary, 0.18)}`
        : `0 0 0 2px ${alpha(tokens.primary, 0.12)}, 0 8px 22px -18px rgba(15, 23, 42, 0.38)`,
    },
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      minHeight: '0 !important',
      height: '36px !important',
      boxSizing: 'border-box',
      padding: '0 34px 0 12px !important',
      fontSize: '13px',
      fontWeight: 400,
      lineHeight: 1.25,
    },
    '& .MuiSelect-icon': {
      right: 8,
      color: tokens.muted,
      fontSize: 18,
    },
    '& .MuiFormHelperText-root': {
      ml: 0,
      mt: 0.55,
      color: tokens.muted,
      fontSize: '11px',
      fontWeight: 400,
      lineHeight: 1.35,
    },
    '& .MuiFormControlLabel-label': {
      fontSize: '13px',
      fontWeight: 400,
      color: tokens.text,
      lineHeight: 1.35,
    },
    '& .MuiRadio-root, & .MuiCheckbox-root': {
      py: 0.5,
      color: tokens.muted,
      '&.Mui-checked': {
        color: tokens.primary,
      },
    },
    '& .MuiTabs-root': {
      minHeight: 40,
    },
    '& .MuiTab-root': {
      minHeight: 40,
      px: 1.6,
      fontSize: '12.5px',
      fontWeight: 500,
      letterSpacing: 0,
      textTransform: 'none',
      color: tokens.muted,
      '&.Mui-selected': {
        color: tokens.primary,
        fontWeight: 600,
      },
    },
    '& .MuiAlert-root': {
      '&.MuiAlert-standardInfo, &.MuiAlert-filledInfo, &.MuiAlert-outlinedInfo': alertTone.info,
      '&.MuiAlert-standardSuccess, &.MuiAlert-filledSuccess, &.MuiAlert-outlinedSuccess': alertTone.success,
      '&.MuiAlert-standardWarning, &.MuiAlert-filledWarning, &.MuiAlert-outlinedWarning': alertTone.warning,
      '&.MuiAlert-standardError, &.MuiAlert-filledError, &.MuiAlert-outlinedError': alertTone.error,
    },
    ...options.sx,
  };
};
