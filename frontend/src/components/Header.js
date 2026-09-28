import React from 'react';
import { Box, Typography, Chip, IconButton, Avatar, Tooltip } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import { useThemeContext } from '../utils/ThemeContext';

// Shown next to the logo so you can tell at a glance which build is live.
// REACT_APP_BUILD_STAMP is set by the deploy script (deploy-fresh.sh) and baked
// into the bundle at build time; "dev" is what you get running locally.
const BUILD_STAMP = process.env.REACT_APP_BUILD_STAMP || 'dev';

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
              fontWeight="600"
              sx={{
                color: r.text.primary,
                letterSpacing: 0,
                fontSize: '18px',
                lineHeight: 1.05,
              }}
            >
              FactWise
            </Typography>
            {/* Build stamp. Baked in at build time, so it tells you which build
                is actually being served — the point of it is to confirm a deploy
                landed without having to hunt for a behaviour change. */}
            <Tooltip title={`Build ${BUILD_STAMP}`}>
              <Chip
                label={BUILD_STAMP}
                size="small"
                sx={{
                  height: 18,
                  fontSize: '9.5px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: r.text.secondary,
                  bgcolor: r.action.primarySoft,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
            </Tooltip>
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
                  fontSize: '12.5px',
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
                    ? 'linear-gradient(180deg, #0d80ff 0%, #007aff 100%)'
                    : 'transparent',
                  border: isActive
                    ? '1px solid rgba(255, 255, 255, 0.25)'
                    : '1px solid transparent',
                  boxShadow: isActive
                    ? '0 4px 14px 0 rgba(0, 122, 255, 0.34), inset 0 1px 0 0 rgba(255, 255, 255, 0.35)'
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
                      ? 'linear-gradient(180deg, #1687ff 0%, #006ee6 100%)'
                      : isDarkMode
                      ? 'rgba(255, 255, 255, 0.09)'
                      : 'rgba(15, 23, 42, 0.05)',
                    borderColor: isActive
                      ? 'rgba(255, 255, 255, 0.35)'
                      : 'transparent',
                    transform: 'translateY(-1px)',
                    boxShadow: isActive
                      ? '0 6px 18px 0 rgba(0, 122, 255, 0.44), inset 0 1px 0 0 rgba(255, 255, 255, 0.45)'
                      : isDarkMode
                      ? '0 4px 12px rgba(0, 0, 0, 0.25)'
                      : '0 4px 12px rgba(15, 23, 42, 0.04)',
                  },
                  '&:focus, &:focus-visible': {
                    outline: 'none',
                  },
                }}
              >
                <Icon sx={{ fontSize: 15 }} />
                {item.label}
              </Box>
            );
          })}
        </Box>

        {/* ── right: toggle + bell + avatar ──────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.25 }}>

          {/* ── Light / Dark Toggle ───────────────────────────────────── */}
          <Tooltip title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton
              size="small"
              role="switch"
              aria-checked={isDarkMode}
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleThemeMode}
              sx={{
                width: 32,
                height: 32,
                borderRadius: '999px',
                color: isDarkMode ? r.color.primaryLight : r.color.primary,
                bgcolor: isDarkMode ? r.action.primarySofter : '#ffffff',
                border: isDarkMode ? '1px solid rgba(0, 122, 255, 0.24)' : '1px solid rgba(15, 23, 42, 0.08)',
                boxShadow: isDarkMode
                  ? '0 8px 18px -14px rgba(0, 122, 255, 0.78), inset 0 1px 0 rgba(255,255,255,0.05)'
                  : '0 10px 22px -18px rgba(15, 23, 42, 0.32), inset 0 1px 0 rgba(255,255,255,0.9)',
                transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease',
                '&:hover': {
                  bgcolor: isDarkMode ? r.action.primarySoft : 'rgba(0, 122, 255, 0.08)',
                  borderColor: isDarkMode ? 'rgba(0, 122, 255, 0.42)' : 'rgba(0, 122, 255, 0.18)',
                  transform: 'translateY(-1px)',
                },
              }}
            >
              {isDarkMode ? <MoonIcon sx={{ width: 17, height: 17 }} /> : <WbSunnyIcon sx={{ fontSize: 17 }} />}
            </IconButton>
          </Tooltip>

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
                fontSize: '11.5px',
                fontWeight: 600,
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
