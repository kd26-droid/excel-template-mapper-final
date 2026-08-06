import React from 'react';
import { Box, Typography, Chip, IconButton, Avatar, Tooltip } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import { useThemeContext } from '../utils/ThemeContext';

const MoonIcon = ({ sx }) => (
  <Box
    component="svg"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    sx={{ width: 20, height: 20, display: 'block', fill: 'currentColor', ...sx }}
  >
    <path d="m12.2,22c4.53,0,8.45-2.91,9.76-7.24.11-.35.01-.74-.25-1s-.64-.36-1-.25c-.78.23-1.58.35-2.38.35-4.52,0-8.2-3.68-8.2-8.2,0-.8.12-1.6.35-2.38.11-.35.01-.74-.25-1-.26-.26-.64-.36-1-.25C4.91,3.35,2,7.28,2,11.8c0,5.62,4.58,10.2,10.2,10.2Z" />
  </Box>
);

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
              gap: 0.8,
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
            {/* "Dark" label */}
            <Typography
              component="span"
              sx={{
                fontSize: '13.5px',
                fontWeight: 600,
                color: isDarkMode ? r.text.primary : r.text.disabled,
                transition: 'color 180ms ease',
              }}
            >
              Dark
            </Typography>

            {/* Toggle track */}
            <Box
              sx={{
                position: 'relative',
                width: 76,
                height: 32,
                borderRadius: '999px',
                p: '3px',
                overflow: 'hidden',
                background: isDarkMode
                  ? 'linear-gradient(180deg, #1f2937 0%, #111827 100%)'
                  : 'linear-gradient(180deg, #f8fafc 0%, #e5e7eb 100%)',
                border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.24)' : '1px solid rgba(148, 163, 184, 0.45)',
                boxShadow: isDarkMode
                  ? 'inset 0 2px 7px rgba(0,0,0,0.52), 0 5px 14px rgba(2,6,23,0.22)'
                  : '0 10px 24px rgba(15,23,42,0.12), inset 0 1px 2px rgba(255,255,255,0.8)',
                transition: 'background 220ms ease, box-shadow 220ms ease',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 3,
                  left: isDarkMode ? 3 : 40,
                  width: 33,
                  height: 26,
                  borderRadius: '999px',
                  bgcolor: r.action.primary,
                  boxShadow: isDarkMode
                    ? '0 5px 14px rgba(37,99,235,0.34)'
                    : '0 5px 14px rgba(37,99,235,0.28)',
                  transition: 'left 240ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease',
                }}
              />

              <Box
                sx={{
                  position: 'absolute',
                  top: 3,
                  left: 3,
                  width: 33,
                  height: 26,
                  borderRadius: '999px',
                  display: 'grid',
                  placeItems: 'center',
                  color: isDarkMode ? '#ffffff' : '#9ca3af',
                  zIndex: 2,
                  transition: 'color 180ms ease',
                }}
              >
                <MoonIcon sx={{ width: 18, height: 18 }} />
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 33,
                  height: 26,
                  borderRadius: '999px',
                  display: 'grid',
                  placeItems: 'center',
                  color: isDarkMode ? '#ffffff' : '#ffffff',
                  zIndex: 2,
                  opacity: isDarkMode ? 0.82 : 1,
                  transition: 'opacity 180ms ease, color 180ms ease',
                }}
              >
                <WbSunnyIcon sx={{ fontSize: 18 }} />
              </Box>
            </Box>

            {/* "Light" label */}
            <Typography
              component="span"
              sx={{
                fontSize: '13.5px',
                fontWeight: 600,
                color: isDarkMode ? r.text.disabled : r.text.primary,
                letterSpacing: 0,
                transition: 'color 180ms ease',
              }}
            >
              Light
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
