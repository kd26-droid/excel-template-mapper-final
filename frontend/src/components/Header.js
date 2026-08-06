import React from 'react';
import { Box, Typography, Chip, IconButton, Avatar, Tooltip } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import { useThemeContext } from '../utils/ThemeContext';

// ─── nav items ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { label: 'Dashboard',      path: '/dashboard',      icon: DashboardIcon },
  { label: 'Upload Files',   path: '/',               icon: CloudUploadIcon, activePaths: ['/', '/upload'] },
  { label: 'Settings',       path: '/settings',       icon: SettingsIcon },
];

// ─── Header ─────────────────────────────────────────────────────────────────
const Header = () => {
  const { isDarkMode, tokens: r, toggleThemeMode } = useThemeContext();
  const location = useLocation();
  const currentPath = location.pathname.replace(/\/+$/, '') || '/';

  // Derived header-specific tokens
  const h = r.header;

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 1200,
        width: '100%',
      }}
    >
      {/* ── gradient top-line ──────────────────────────────────────────── */}
      <Box sx={{ height: '2px', background: h.topLine }} />

      {/* ── main bar ──────────────────────────────────────────────────── */}
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3, md: 4 },
          py: 1.5,
          background: h.background,
          backdropFilter: 'blur(20px) saturate(190%)',
          WebkitBackdropFilter: 'blur(20px) saturate(190%)',
          borderBottom: `1px solid ${r.border.subtle}`,
          boxShadow: isDarkMode
            ? '0 4px 30px rgba(0, 0, 0, 0.35)'
            : '0 4px 30px rgba(0, 0, 0, 0.03)',
        }}
      >
        {/* ── left: logo ────────────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          {/* Logo */}
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              textDecoration: 'none',
            }}
          >
            <Box
              component="img"
              src="/Factwisesvglogo.svg"
              alt="FactWise Logo"
              sx={{
                width: 28,
                height: 28,
                borderRadius: '4px 0 4px 0',
                objectFit: 'contain',
                filter: `drop-shadow(0 0 8px ${r.action.primarySoft})`,
                transition: 'transform 0.2s ease',
                '&:hover': { transform: 'scale(1.05)' },
              }}
            />
            <Typography
              variant="h6"
              fontWeight="700"
              sx={{
                color: r.text.primary,
                letterSpacing: '-0.02em',
                fontSize: '21px',
                lineHeight: 1,
              }}
            >
              FactWise
            </Typography>
          </Box>
        </Box>

        {/* ── center: navigation capsule (glassmorphism & spacious) ────── */}
        <Box
          sx={{
            position: { xs: 'static', lg: 'absolute' },
            left: { lg: '50%' },
            transform: { lg: 'translateX(-50%)' },
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            gap: 1.25,
            p: '6px 8px',
            borderRadius: '999px',
            background: h.capsule,
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: `1px solid ${h.capsuleBorder}`,
            boxShadow: h.capsuleShadow,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.activePaths?.includes(currentPath) ||
              currentPath === item.path ||
              (item.path !== '/' && currentPath.startsWith(item.path));
            const Icon = item.icon;
            return (
              <Box
                key={item.path}
                component={RouterLink}
                to={item.path}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 2.5,
                  py: 0.75,
                  borderRadius: '999px',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  position: 'relative',
                  overflow: 'hidden',
                  outline: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  color: isActive
                    ? '#ffffff'
                    : isDarkMode
                    ? 'rgba(255, 255, 255, 0.75)'
                    : '#475569',
                  background: isActive
                    ? 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)'
                    : 'transparent',
                  border: isActive
                    ? '1px solid rgba(255, 255, 255, 0.25)'
                    : '1px solid transparent',
                  boxShadow: isActive
                    ? '0 4px 14px 0 rgba(37, 99, 235, 0.38), inset 0 1px 0 0 rgba(255, 255, 255, 0.35)'
                    : 'none',
                  backdropFilter: isActive ? 'blur(8px)' : 'none',
                  WebkitBackdropFilter: isActive ? 'blur(8px)' : 'none',
                  transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  '&:hover': {
                    color: isActive
                      ? '#ffffff'
                      : isDarkMode
                      ? '#ffffff'
                      : '#0f172a',
                    background: isActive
                      ? 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)'
                      : isDarkMode
                      ? 'rgba(255, 255, 255, 0.09)'
                      : 'rgba(15, 23, 42, 0.05)',
                    borderColor: isActive
                      ? 'rgba(255, 255, 255, 0.35)'
                      : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: isActive
                      ? '0 6px 18px 0 rgba(37, 99, 235, 0.48), inset 0 1px 0 0 rgba(255, 255, 255, 0.45)'
                      : isDarkMode
                      ? '0 4px 12px rgba(0, 0, 0, 0.25)'
                      : '0 4px 12px rgba(15, 23, 42, 0.04)',
                  },
                  '&:focus, &:focus-visible': {
                    outline: 'none',
                  },
                }}
              >
                <Icon sx={{ fontSize: 16 }} />
                {item.label}
              </Box>
            );
          })}
        </Box>

        {/* ── right: toggle + bell + avatar ──────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.25 }}>

          {/* ── Light / Dark Toggle ───────────────────────────────────── */}
          <Box
            component="button"
            type="button"
            role="switch"
            aria-checked={isDarkMode}
            aria-label="Toggle light and dark theme"
            onClick={toggleThemeMode}
            sx={{
              display: { xs: 'none', md: 'grid' },
              gridTemplateColumns: 'auto auto auto',
              alignItems: 'center',
              gap: 0.85,
              p: 0,
              border: 'none',
              bgcolor: 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: 'inherit',
              '&:focus-visible': {
                outline: `2px solid ${r.color.primaryLight}`,
                outlineOffset: 4,
                borderRadius: '18px',
              },
            }}
          >
            {/* "Light" label */}
            <Typography
              component="span"
              sx={{
                fontSize: 14,
                fontWeight: 500,
                color: isDarkMode ? r.text.disabled : r.text.primary,
                transition: 'color 180ms ease',
              }}
            >
              Light
            </Typography>

            {/* Toggle track */}
            <Box
              sx={{
                position: 'relative',
                width: 78,
                height: 34,
                borderRadius: '999px',
                p: '3px',
                overflow: 'hidden',
                background: isDarkMode
                  ? 'linear-gradient(180deg, #111827 0%, #020617 62%, #030712 100%)'
                  : 'linear-gradient(180deg, #111827 0%, #020617 68%, #030712 100%)',
                border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.24)' : '1px solid rgba(15, 23, 42, 0.18)',
                boxShadow: isDarkMode
                  ? 'inset 0 2px 8px rgba(0,0,0,0.72), 0 5px 14px rgba(2,6,23,0.22)'
                  : '0 10px 24px rgba(15,23,42,0.16), inset 0 2px 8px rgba(0,0,0,0.62)',
                transition: 'background 220ms ease, box-shadow 220ms ease',
              }}
            >
              <WbSunnyIcon
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 10,
                  fontSize: 15,
                  color: isDarkMode ? 'rgba(255,255,255,0.58)' : 'transparent',
                  zIndex: 1,
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 10,
                  width: 15,
                  height: 15,
                  borderRadius: '50%',
                  bgcolor: !isDarkMode ? 'rgba(255,255,255,0.62)' : 'transparent',
                  boxShadow: !isDarkMode ? `-5px 1px 0 0 ${r.toggle.moonCutout} inset` : 'none',
                  zIndex: 1,
                }}
              />

              {/* Thumb */}
              <Box
                sx={{
                  position: 'absolute',
                  top: 3,
                  left: isDarkMode ? 41 : 3,
                  width: 31,
                  height: 28,
                  borderRadius: '50%',
                  bgcolor: isDarkMode ? '#ffffff' : '#6366f1',
                  boxShadow: isDarkMode ? '0 2px 8px rgba(255,255,255,0.16)' : '0 2px 8px rgba(99,102,241,0.38)',
                  zIndex: 2,
                  transition: 'left 240ms cubic-bezier(0.16, 1, 0.3, 1), background 220ms ease, box-shadow 220ms ease',
                }}
              >
                {isDarkMode ? (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      left: 7,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      bgcolor: '#ffffff',
                      boxShadow: `-8px 1px 0 0 ${r.toggle.moonCutout} inset`,
                    }}
                  />
                ) : (
                  <WbSunnyIcon sx={{ position: 'absolute', top: 5, left: 6, fontSize: 18, color: '#ffffff' }} />
                )}
              </Box>
            </Box>

            {/* "Dark" label */}
            <Typography
              component="span"
              sx={{
                fontSize: 14,
                fontWeight: 500,
                color: isDarkMode ? r.text.primary : r.text.disabled,
                letterSpacing: 0,
                transition: 'color 180ms ease',
              }}
            >
              Dark
            </Typography>
          </Box>

          {/* Notification bell */}
          <Tooltip title="Notifications">
            <IconButton
              size="small"
              sx={{
                color: r.text.secondary,
                '&:hover': { color: r.text.primary },
              }}
            >
              <NotificationsNoneIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          {/* User avatar */}
          <Box sx={{ position: 'relative' }}>
            <Avatar
              sx={{
                width: 30,
                height: 30,
                bgcolor: r.action.primarySoft,
                color: r.color.primaryLight,
                fontSize: '12px',
                fontWeight: 700,
                border: `1px solid ${r.border.panelAccent}`,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': { borderColor: r.color.primaryLight },
              }}
            >
              FW
            </Avatar>
            {/* Online indicator */}
            <Box
              sx={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: r.color.success,
                border: `2px solid ${isDarkMode ? '#0b0f19' : '#f4f7fb'}`,
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Header;
