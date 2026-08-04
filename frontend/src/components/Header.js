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
  { label: 'Dashboard',      path: '/',               icon: DashboardIcon },
  { label: 'Upload Files',   path: '/upload',         icon: CloudUploadIcon },
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
              gap: 1,
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
                fontSize: 12,
                fontWeight: 800,
                color: r.toggle.lightText,
                transition: 'color 180ms ease',
              }}
            >
              Light
            </Typography>

            {/* Toggle track */}
            <Box
              sx={{
                position: 'relative',
                width: 58,
                height: 31,
                borderRadius: '999px',
                p: '3px',
                overflow: 'hidden',
                background: r.toggle.track,
                boxShadow: r.shadow.control,
                transition: 'background 220ms ease, box-shadow 220ms ease',
              }}
            >
              {/* Stars (visible in dark mode) */}
              {[
                { top: 8, left: 12, size: 7 },
                { top: 19, left: 23, size: 6 },
              ].map((s, i) => (
                <Box
                  key={i}
                  sx={{
                    position: 'absolute',
                    top: s.top,
                    left: s.left,
                    width: s.size,
                    height: s.size,
                    opacity: isDarkMode ? 1 : 0,
                    transform: `scale(${isDarkMode ? 1 : 0.45})`,
                    transition: 'opacity 180ms ease, transform 220ms ease',
                    '&::before, &::after': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      m: 'auto',
                      bgcolor: r.toggle.star,
                      borderRadius: '999px',
                      boxShadow: r.shadow.control,
                    },
                    '&::before': { width: s.size, height: Math.max(2, s.size / 3) },
                    '&::after':  { width: Math.max(2, s.size / 3), height: s.size },
                  }}
                />
              ))}

              {/* Small decorative dots */}
              <Box
                sx={{
                  position: 'absolute',
                  width: 3.5,
                  height: 3.5,
                  borderRadius: '50%',
                  bgcolor: r.toggle.star,
                  top: isDarkMode ? 11 : 8,
                  left: isDarkMode ? 31 : 38,
                  opacity: isDarkMode ? 0.9 : 0.75,
                  transition: 'all 220ms ease',
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  width: 2.75,
                  height: 2.75,
                  borderRadius: '50%',
                  bgcolor: r.toggle.star,
                  top: 18,
                  left: isDarkMode ? 8 : 34,
                  opacity: isDarkMode ? 0.92 : 0.8,
                  transition: 'all 220ms ease',
                }}
              />

              {/* Thumb */}
              <Box
                sx={{
                  position: 'absolute',
                  top: isDarkMode ? 5 : 3.5,
                  left: isDarkMode ? 31 : 3.5,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: r.toggle.thumb,
                  color: r.toggle.thumbIcon,
                  boxShadow: isDarkMode
                    ? `-9px 1px 0 0 ${r.toggle.moonCutout} inset`
                    : r.shadow.control,
                  transform: 'translateZ(0)',
                  transition:
                    'left 240ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease, color 220ms ease',
                }}
              >
                {!isDarkMode && <WbSunnyIcon sx={{ fontSize: 15 }} />}
              </Box>
            </Box>

            {/* "Dark" label */}
            <Typography
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 800,
                color: r.toggle.darkText,
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
