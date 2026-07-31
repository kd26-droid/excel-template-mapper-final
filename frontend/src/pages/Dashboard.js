import React, { useState, useEffect, useMemo } from 'react';
import styled from '@emotion/styled';
import { useGlobalBlock } from '../components/LoaderOverlay';
import {
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Box,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  FormControl,
  Select,
  MenuItem,
  Avatar,
  Stack,
  TablePagination
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import StandaloneFormulaBuilder from '../components/StandaloneFormulaBuilder';
import {
  UploadFile as UploadFileIcon,
  History as HistoryIcon,
  LibraryBooks as LibraryBooksIcon,
  PlayArrow as PlayArrowIcon,
  Delete as DeleteIcon,
  Star as StarIcon,
  Search as SearchIcon,
  Description as DescriptionIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  Science as ScienceIcon,
  Code as CodeIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  GetApp as GetAppIcon
} from '@mui/icons-material';
import api, { setGlobalLoaderCallback } from '../services/api';
import { useThemeContext } from '../utils/ThemeContext';

// ─── Styled animated buttons (matching final-2 UI) ──────────────────────────

const DownloadButtonWrapper = styled.div`
  width: 100%;
  .download-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    border-radius: 8px;
    background: ${props => props.color || 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)'};
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .icon-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
  }
  .dl-svg-icon {
    color: rgba(255, 255, 255, 0.9);
    transition: all 0.2s ease;
  }
  .tray-bar {
    width: 14px;
    height: 2px;
    background-color: rgba(255, 255, 255, 0.7);
    border-radius: 1px;
    transition: all 0.2s ease;
  }
  .download-btn:hover:not(:disabled) .dl-svg-icon {
    color: #ffffff;
    animation: slide-in-top 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  .download-btn:hover:not(:disabled) .tray-bar {
    background-color: #ffffff;
    box-shadow: 0 0 6px #ffffff;
  }
  .download-btn:hover:not(:disabled) {
    background: ${props => props.hoverColor || 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)'};
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transform: translateY(-1.5px);
  }
  .download-btn:active:not(:disabled) { transform: scale(0.97); }
  @keyframes slide-in-top {
    0% { transform: translateY(-8px); opacity: 0; }
    100% { transform: translateY(0px); opacity: 1; }
  }
`;

const DownloadButton = ({ onClick, label = 'Download',
  color = 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
  hoverColor = 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)' }) => (
  <DownloadButtonWrapper color={color} hoverColor={hoverColor}>
    <button className="download-btn" onClick={onClick} type="button">
      <div className="icon-container">
        <svg className="dl-svg-icon" viewBox="0 0 384 512" height="13" width="13" xmlns="http://www.w3.org/2000/svg">
          <path fill="currentColor" d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8 224 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 306.7L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z" />
        </svg>
        <span className="tray-bar" />
      </div>
      <span>{label}</span>
    </button>
  </DownloadButtonWrapper>
);

const ToggleButtonWrapper = styled.div`
  display: inline-flex;
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    height: 28px;
    width: 28px;
    padding: 0 6px;
    border-radius: 14px;
    background: ${props => props.isExpanded ? 'rgba(35, 131, 226, 0.25)' : 'rgba(255, 255, 255, 0.05)'};
    border: 1px solid ${props => props.isExpanded ? 'rgba(35, 131, 226, 0.5)' : 'rgba(255, 255, 255, 0.1)'};
    color: ${props => props.isExpanded ? '#60a5fa' : '#8992a5'};
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    white-space: nowrap;
  }
  .chevron-icon {
    min-width: 14px;
    width: 14px;
    height: 14px;
    transform: ${props => props.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};
    transition: transform 0.3s ease;
  }
  .btn-label {
    opacity: 0;
    max-width: 0;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-left: 0;
  }
  .toggle-btn:hover {
    width: 78px;
    padding: 0 10px;
    background: rgba(35, 131, 226, 0.3);
    border-color: #2383e2;
    color: #ffffff;
    box-shadow: 0 0 14px rgba(35, 131, 226, 0.4);
    transform: translateY(-1px);
  }
  .toggle-btn:hover .btn-label {
    opacity: 1;
    max-width: 50px;
    margin-left: 5px;
  }
  .toggle-btn:active { transform: scale(0.94); }
`;

const ToggleButton = ({ isExpanded, onClick }) => (
  <ToggleButtonWrapper isExpanded={isExpanded}>
    <button className="toggle-btn" onClick={onClick} type="button">
      <svg className="chevron-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
      </svg>
      <span className="btn-label">{isExpanded ? 'Collapse' : 'Expand'}</span>
    </button>
  </ToggleButtonWrapper>
);

const UseButtonWrapper = styled.div`
  display: inline-flex;
  .use-btn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    height: 32px;
    width: 32px;
    padding: 0;
    border-radius: 16px;
    background: ${props => props.color};
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 3px 10px ${props => props.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.3);
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    white-space: nowrap;
  }
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    min-width: 30px;
    height: 30px;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .play-icon {
    width: 16px;
    height: 16px;
    margin-left: 1px;
    transition: transform 0.25s ease;
  }
  .btn-label {
    opacity: 0;
    max-width: 0;
    color: #ffffff;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-left: 0;
  }
  .use-btn:hover {
    width: 125px;
    padding: 0 10px;
    background: ${props => props.hoverColor};
    border-color: rgba(255, 255, 255, 0.4);
    box-shadow: 0 5px 16px ${props => props.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transform: translateY(-1px);
  }
  .use-btn:hover .icon-box { width: 18px; min-width: 18px; }
  .use-btn:hover .play-icon { transform: translateX(1px) scale(1.1); }
  .use-btn:hover .btn-label { opacity: 1; max-width: 95px; margin-left: 6px; }
  .use-btn:active { transform: scale(0.95); }
`;

const UseButton = ({
  onClick,
  label = 'Use Template',
  color = 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
  hoverColor = 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
  glowColor = 'rgba(37, 99, 235, 0.45)'
}) => (
  <UseButtonWrapper color={color} hoverColor={hoverColor} glowColor={glowColor}>
    <button className="use-btn" onClick={onClick} type="button">
      <div className="icon-box">
        <svg className="play-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <span className="btn-label">{label}</span>
    </button>
  </UseButtonWrapper>
);

const parseHistoryDate = (value) => {
  if (!value) return null;
  const raw = String(value);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const date = new Date(hasTimezone ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDisplayDate = (value) => {
  const dt = parseHistoryDate(value);
  return dt
    ? dt.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : 'Unknown time';
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { isDarkMode, tokens: t } = useThemeContext();

  const [uploads, setUploads] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  useGlobalBlock(globalLoading);

  const [mappingTemplates, setMappingTemplates] = useState([]);
  const [tagTemplates, setTagTemplates] = useState([]);
  const [templateStats, setTemplateStats] = useState({
    totalTemplates: 0,
    totalUsage: 0,
    mostUsed: null,
    top3Templates: []
  });

  const [loadingUploads, setLoadingUploads] = useState(true);
  const [, setLoadingTemplates] = useState(true);
  const [, setLoadingTags] = useState(true);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState(0); // 0: Sessions, 1: Templates, 2: Tag Rules
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSortBy, setSessionSortBy] = useState('upload_date');
  const [sessionSortOrder, setSessionSortOrder] = useState('desc');
  const [expandedSessionId, setExpandedSessionId] = useState(null);

  // Mapping Templates tab pagination + sort
  const [tmplSearch, setTmplSearch] = useState('');
  const [tmplSortBy, setTmplSortBy] = useState('usage_count');
  const [tmplSortOrder, setTmplSortOrder] = useState('desc');
  const [tmplPage, setTmplPage] = useState(0);
  const [tmplRowsPerPage, setTmplRowsPerPage] = useState(10);

  // Tag Rules tab pagination + sort
  const [tagSearch, setTagSearch] = useState('');
  const [tagSortBy, setTagSortBy] = useState('usage_count');
  const [tagSortOrder, setTagSortOrder] = useState('desc');
  const [tagPage, setTagPage] = useState(0);
  const [tagRowsPerPage, setTagRowsPerPage] = useState(10);

  // Sessions tab pagination
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionRowsPerPage, setSessionRowsPerPage] = useState(10);

  // Mouse background glow position
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  // Dialog states
  const [showFormulaModal, setShowFormulaModal] = useState(false);

  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Fetch Dashboard Data
  const fetchData = async () => {
    try {
      setLoadingUploads(true);
      const res = await api.getUploadDashboard();
      setUploads(res.data?.uploads || []);
    } catch (err) {
      console.error('Error fetching dashboard uploads:', err);
    } finally {
      setLoadingUploads(false);
    }

    try {
      setLoadingTemplates(true);
      const res = await api.getMappingTemplates();
      const tmpls = res.data?.templates || [];
      setMappingTemplates(tmpls);

      const sorted = [...tmpls].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
      setTemplateStats({
        totalTemplates: tmpls.length,
        totalUsage: tmpls.reduce((acc, curr) => acc + (curr.usage_count || 0), 0),
        mostUsed: sorted[0] || null,
        top3Templates: sorted.slice(0, 3)
      });
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoadingTemplates(false);
    }

    try {
      setLoadingTags(true);
      const res = await api.getTagTemplates();
      setTagTemplates(res.data?.templates || []);
    } catch (err) {
      console.error('Error fetching tag templates:', err);
    } finally {
      setLoadingTags(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered Sessions
  const filteredSessions = useMemo(() => {
    let list = uploads.filter(u =>
      (u.client_file || '').toLowerCase().includes(sessionSearch.toLowerCase()) ||
      (u.template_file || '').toLowerCase().includes(sessionSearch.toLowerCase()) ||
      (u.session_id || '').toLowerCase().includes(sessionSearch.toLowerCase())
    );
    list.sort((a, b) => {
      let va, vb;
      if (sessionSortBy === 'upload_date') {
        va = parseHistoryDate(a.created) || new Date(0);
        vb = parseHistoryDate(b.created) || new Date(0);
      } else if (sessionSortBy === 'rows_processed') {
        va = a.rows_processed || 0;
        vb = b.rows_processed || 0;
      } else {
        va = (a.client_file || '').toLowerCase();
        vb = (b.client_file || '').toLowerCase();
      }
      return sessionSortOrder === 'desc'
        ? (vb > va ? 1 : vb < va ? -1 : 0)
        : (va > vb ? 1 : va < vb ? -1 : 0);
    });
    return list;
  }, [uploads, sessionSearch, sessionSortBy, sessionSortOrder]);

  const pagedSessions = useMemo(() => {
    const start = sessionPage * sessionRowsPerPage;
    return filteredSessions.slice(start, start + sessionRowsPerPage);
  }, [filteredSessions, sessionPage, sessionRowsPerPage]);

  // Filtered + paginated Mapping Templates
  const filteredTemplates = useMemo(() => {
    let list = mappingTemplates.filter(tmpl =>
      (tmpl.name || '').toLowerCase().includes(tmplSearch.toLowerCase()) ||
      (tmpl.description || '').toLowerCase().includes(tmplSearch.toLowerCase())
    );
    list.sort((a, b) => {
      let va, vb;
      if (tmplSortBy === 'created_at') {
        va = parseHistoryDate(a.created_at) || new Date(0);
        vb = parseHistoryDate(b.created_at) || new Date(0);
      } else if (tmplSortBy === 'usage_count') {
        va = a.usage_count || 0;
        vb = b.usage_count || 0;
      } else {
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
      }
      return tmplSortOrder === 'desc'
        ? (vb > va ? 1 : vb < va ? -1 : 0)
        : (va > vb ? 1 : va < vb ? -1 : 0);
    });
    return list;
  }, [mappingTemplates, tmplSearch, tmplSortBy, tmplSortOrder]);

  const pagedTemplates = useMemo(() => {
    const start = tmplPage * tmplRowsPerPage;
    return filteredTemplates.slice(start, start + tmplRowsPerPage);
  }, [filteredTemplates, tmplPage, tmplRowsPerPage]);

  // Filtered + paginated Tag Rules
  const filteredTags = useMemo(() => {
    let list = tagTemplates.filter(tmpl =>
      (tmpl.name || '').toLowerCase().includes(tagSearch.toLowerCase()) ||
      (tmpl.description || '').toLowerCase().includes(tagSearch.toLowerCase())
    );
    list.sort((a, b) => {
      let va, vb;
      if (tagSortBy === 'created_at') {
        va = parseHistoryDate(a.created_at) || new Date(0);
        vb = parseHistoryDate(b.created_at) || new Date(0);
      } else if (tagSortBy === 'usage_count') {
        va = a.usage_count || 0;
        vb = b.usage_count || 0;
      } else {
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
      }
      return tagSortOrder === 'desc'
        ? (vb > va ? 1 : vb < va ? -1 : 0)
        : (va > vb ? 1 : va < vb ? -1 : 0);
    });
    return list;
  }, [tagTemplates, tagSearch, tagSortBy, tagSortOrder]);

  const pagedTags = useMemo(() => {
    const start = tagPage * tagRowsPerPage;
    return filteredTags.slice(start, start + tagRowsPerPage);
  }, [filteredTags, tagPage, tagRowsPerPage]);

  // Derived tokens for panel styling
  const Ze = {
    bg: t.background.app,
    text: t.text.primary,
    muted: t.text.secondary,
    surface: t.surface.card,
    surfaceSolid: t.surface.cardSolid || t.surface.card,
    surfaceSoft: t.surface.elevatedSoft || t.surface.card,
    border: t.border.default,
    subtleBorder: t.border.subtle,
    tableLine: t.table.line,
    rowLine: t.table.rowLine,
    rowHover: t.table.hover,
    activeRow: t.table.selected,
    cardShadow: t.shadow.card,
    panelShadow: t.shadow.card,
    inputBg: t.surface.input,
    searchBg: t.surface.input,
    controlBg: t.surface.control
  };

  const cardStyle = {
    borderRadius: '18px',
    border: `1px solid ${Ze.border}`,
    bgcolor: Ze.surface,
    color: Ze.text,
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    boxShadow: Ze.cardShadow
  };

  const handleApplyTemplate = (tmpl) => {
    navigate('/upload', { state: { selectedTemplate: tmpl, autoApplyTemplate: true } });
  };

  const handleDeleteSession = async (sessionId) => {
    try {
      await api.deleteUpload(sessionId);
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  return (
    <Box
      sx={{
        position: 'relative',
        p: { xs: 2, md: 3 },
        bgcolor: Ze.bg,
        color: Ze.text,
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden'
      }}
    >
      {/* Background glow circle following mouse */}
      <Box
        sx={{
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '50%',
          opacity: 0.36,
          width: '62vw',
          height: '62vw',
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(90px)',
          background: 'radial-gradient(circle, var(--color-brand, #2383e2) 0%, transparent 70%)',
          zIndex: 0
        }}
      />

      {/* Grid Pattern Overlay */}
      <Box
        className="auth-grid-pattern"
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.45, zIndex: 0 }}
      />

      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {/* Title Bar */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" fontWeight="700" sx={{ color: Ze.text, letterSpacing: '-0.025em' }}>
              BOM Mapper Workbench
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CodeIcon sx={{ fontSize: 16 }} />}
              onClick={() => setShowFormulaModal(true)}
              sx={{
                height: 38,
                px: 2.2,
                borderRadius: '9px',
                borderColor: Ze.border,
                color: Ze.text,
                bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.04)' : '#ffffff',
                backdropFilter: 'blur(10px)',
                fontWeight: 600,
                fontSize: '13px',
                textTransform: 'none',
                boxShadow: isDarkMode ? 'inset 0 1px 0 rgba(255, 255, 255, 0.08)' : '0 8px 20px rgba(15,23,42,0.08)',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                '&:hover': {
                  borderColor: '#06b6d4',
                  bgcolor: 'rgba(6, 182, 212, 0.12)',
                  color: '#38bdf8',
                  transform: 'translateY(-1.5px)'
                }
              }}
            >
              New Formula Template
            </Button>
          </Box>
        </Box>

        {/* Quick Metrics & Top 3 Leaderboard */}
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          {/* Quick Metrics */}
          <Grid item xs={12} md={4}>
            <Card sx={{ ...cardStyle, height: '100%', minHeight: 145 }}>
              <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 }, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight="700" sx={{ color: Ze.text, fontSize: '14px' }}>
                    Quick Metrics
                  </Typography>
                  <Chip
                    label="Realtime"
                    size="small"
                    sx={{ height: 18, fontSize: '10px', bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : '#eef2f7', color: Ze.muted, borderRadius: '4px' }}
                  />
                </Box>
                <Grid container spacing={1}>
                  <Grid item xs={4}>
                    <Box sx={{ p: 1.25, bgcolor: 'rgba(59, 130, 246, 0.08)', borderRadius: '10px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: '#93c5fd', fontSize: '10px', display: 'block', mb: 0.25 }}>
                        Mapping
                      </Typography>
                      <Typography variant="h6" fontWeight="700" sx={{ color: Ze.text, fontFamily: '"JetBrains Mono", monospace' }}>
                        {templateStats.totalTemplates}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ p: 1.25, bgcolor: 'rgba(168, 85, 247, 0.08)', borderRadius: '10px', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: '#e9d5ff', fontSize: '10px', display: 'block', mb: 0.25 }}>
                        Tag Rules
                      </Typography>
                      <Typography variant="h6" fontWeight="700" sx={{ color: Ze.text, fontFamily: '"JetBrains Mono", monospace' }}>
                        {tagTemplates.length}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ p: 1.25, bgcolor: 'rgba(16, 185, 129, 0.08)', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: '#a7f3d0', fontSize: '10px', display: 'block', mb: 0.25 }}>
                        Uploads
                      </Typography>
                      <Typography variant="h6" fontWeight="700" sx={{ color: Ze.text, fontFamily: '"JetBrains Mono", monospace' }}>
                        {uploads.length}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Leaderboard Top 3 */}
          <Grid item xs={12} md={5}>
            <Card sx={{ ...cardStyle, height: '100%', minHeight: 145, display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StarIcon sx={{ fontSize: 16, color: '#fbbf24' }} />
                    <Typography variant="subtitle2" fontWeight="700" sx={{ color: Ze.text, fontSize: '14px' }}>
                      Top 3 BOM Templates
                    </Typography>
                  </Box>
                  <Chip
                    label="Leaderboard"
                    size="small"
                    sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(245, 158, 11, 0.12)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '4px' }}
                  />
                </Box>
                {templateStats.top3Templates && templateStats.top3Templates.length > 0 ? (
                  <Stack spacing={0.6} sx={{ flexGrow: 1, justifyContent: 'center' }}>
                    {templateStats.top3Templates.slice(0, 3).map((tmpl, idx) => {
                      const ranks = [
                        { bg: 'rgba(245, 158, 11, 0.2)', text: '#fbbf24', label: '#1' },
                        { bg: 'rgba(148, 163, 184, 0.2)', text: '#cbd5e1', label: '#2' },
                        { bg: 'rgba(217, 119, 6, 0.2)', text: '#fdba74', label: '#3' }
                      ];
                      const rank = ranks[idx] || ranks[1];
                      return (
                        <Box
                          key={tmpl.id || idx}
                          onClick={() => handleApplyTemplate(tmpl)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            py: 0.5,
                            px: 1.25,
                            borderRadius: '8px',
                            bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
                            border: `1px solid ${Ze.subtleBorder}`,
                            cursor: 'pointer',
                            height: 28,
                            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                            '&:hover': {
                              bgcolor: isDarkMode ? 'rgba(35, 131, 226, 0.12)' : '#eff6ff',
                              borderColor: '#2383e2',
                              transform: 'translateX(2px)'
                            }
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 20,
                                height: 18,
                                borderRadius: '4px',
                                bgcolor: rank.bg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: `1px solid ${rank.text}40`
                              }}
                            >
                              <Typography variant="caption" fontWeight="800" sx={{ fontSize: '10px', color: rank.text }}>
                                {rank.label}
                              </Typography>
                            </Box>
                            <Typography variant="body2" fontWeight="600" noWrap sx={{ color: Ze.text, fontSize: '12px' }}>
                              {tmpl.name}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Chip
                              label={`${tmpl.total_mappings || 0} cols`}
                              size="small"
                              sx={{ height: 16, fontSize: '9px', bgcolor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#eef2f7', color: Ze.muted }}
                            />
                            {/* Animated expand-on-hover Use button (final-2 style) */}
                            <UseButton
                              onClick={(e) => { e.stopPropagation(); handleApplyTemplate(tmpl); }}
                              label="Use"
                              color="linear-gradient(135deg, #2563eb 0%, #0284c7 100%)"
                              hoverColor="linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)"
                              glowColor="rgba(37, 99, 235, 0.45)"
                            />
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                ) : (
                  <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" sx={{ color: Ze.muted }}>
                      No templates yet.
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Upload New File quick-action card */}
          <Grid item xs={12} md={3}>
            <Card
              onClick={() => navigate('/upload')}
              sx={{
                borderRadius: '18px',
                border: '1px dashed rgba(35, 131, 226, 0.4)',
                bgcolor: 'rgba(35, 131, 226, 0.06)',
                backdropFilter: 'blur(16px)',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: 'rgba(35, 131, 226, 0.12)',
                  borderColor: '#2383e2',
                  transform: 'scale(1.01)'
                }
              }}
            >
              <CardContent sx={{ p: 2, textAlign: 'center' }}>
                <Avatar sx={{ bgcolor: 'rgba(35, 131, 226, 0.2)', color: '#60a5fa', width: 36, height: 36, mx: 'auto', mb: 1 }}>
                  <UploadFileIcon sx={{ fontSize: 20 }} />
                </Avatar>
                <Typography variant="subtitle2" fontWeight="700" sx={{ color: Ze.text, fontSize: '13px' }}>
                  Upload New File
                </Typography>
                <Typography variant="caption" sx={{ color: Ze.muted, fontSize: '11px', display: 'block' }}>
                  Drag & drop Excel or PDF BOM
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Tabbed Content Panel */}
        <Card sx={{ ...cardStyle, mb: 3 }}>
          <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
            {/* Header with Capsule Tabs & Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
              {/* Capsule Tabs */}
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  p: '4px',
                  bgcolor: Ze.controlBg,
                  borderRadius: '999px',
                  border: `1px solid ${Ze.subtleBorder}`,
                  boxShadow: isDarkMode ? 'inset 0 1px 3px rgba(0, 0, 0, 0.6)' : 'inset 0 1px 0 rgba(255,255,255,0.8)'
                }}
              >
                {[
                  { id: 0, label: 'Recent Sessions', count: uploads.length, icon: HistoryIcon },
                  { id: 1, label: 'Mapping Templates', count: templateStats.totalTemplates, icon: LibraryBooksIcon },
                  { id: 2, label: 'Tag Rules', count: tagTemplates.length, icon: ScienceIcon }
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <Button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      size="small"
                      startIcon={
                        isActive ? (
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#34d399', boxShadow: '0 0 8px #34d399', mr: 0.2 }} />
                        ) : (
                          <Icon sx={{ fontSize: 14, color: isActive ? '#ffffff' : Ze.muted }} />
                        )
                      }
                      sx={{
                        height: 32,
                        px: 2,
                        fontSize: '12px',
                        fontWeight: 600,
                        textTransform: 'none',
                        borderRadius: '999px',
                        color: isActive ? '#ffffff' : Ze.muted,
                        background: isActive
                          ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.9) 0%, rgba(2, 132, 199, 0.9) 100%)'
                          : 'transparent',
                        boxShadow: isActive ? '0 4px 14px rgba(37, 99, 235, 0.45)' : 'none',
                        border: isActive ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid transparent',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        '&:hover': {
                          color: isActive ? '#ffffff' : Ze.text,
                          bgcolor: isActive ? 'none' : isDarkMode ? 'rgba(255, 255, 255, 0.06)' : '#ffffff'
                        }
                      }}
                    >
                      <span style={{ whiteSpace: 'nowrap' }}>{tab.label}</span>
                      <Box
                        sx={{
                          ml: 1,
                          px: 0.8,
                          py: 0.1,
                          borderRadius: '999px',
                          fontSize: '10px',
                          fontWeight: 700,
                          fontFamily: '"JetBrains Mono", monospace',
                          bgcolor: isActive ? 'rgba(255, 255, 255, 0.22)' : isDarkMode ? 'rgba(255, 255, 255, 0.06)' : '#eef2f7',
                          color: isActive ? '#ffffff' : Ze.muted
                        }}
                      >
                        {tab.count}
                      </Box>
                    </Button>
                  );
                })}
              </Box>

              <IconButton onClick={() => fetchData()} size="small" sx={{ color: Ze.muted }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>

            {/* TAB 0: Recent Sessions */}
            {activeTab === 0 && (
              <Box>
                {/* Search & Sort */}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                  <TextField
                    size="small"
                    placeholder="Search recent upload sessions..."
                    value={sessionSearch}
                    onChange={(e) => { setSessionSearch(e.target.value); setSessionPage(0); }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={{ fontSize: 16, color: '#8992a5' }} />
                        </InputAdornment>
                      ),
                      endAdornment: sessionSearch && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setSessionSearch('')} sx={{ color: '#8992a5' }}>
                            <ClearIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </InputAdornment>
                      )
                    }}
                    sx={{
                      flex: 1,
                      '& .MuiOutlinedInput-root': { height: 38, fontSize: '13px', borderRadius: '8px', bgcolor: Ze.searchBg }
                    }}
                  />
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <Select
                      value={sessionSortBy}
                      onChange={(e) => { setSessionSortBy(e.target.value); setSessionPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}
                    >
                      <MenuItem value="upload_date">Sort by Date</MenuItem>
                      <MenuItem value="client_name">Sort by Client</MenuItem>
                      <MenuItem value="rows_processed">Sort by Rows</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select
                      value={sessionSortOrder}
                      onChange={(e) => { setSessionSortOrder(e.target.value); setSessionPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}
                    >
                      <MenuItem value="desc">Newest</MenuItem>
                      <MenuItem value="asc">Oldest</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>

                {/* Table */}
                {loadingUploads ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress size={28} sx={{ color: '#2383e2' }} />
                  </Box>
                ) : filteredSessions.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5, color: Ze.muted }}>
                    <HistoryIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
                    <Typography variant="body2">No processing sessions yet.</Typography>
                  </Box>
                ) : (
                  <>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ '& th': { borderBottom: `1px solid ${Ze.tableLine}`, color: Ze.muted, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' } }}>
                            <TableCell style={{ width: 40 }} />
                            <TableCell>File / Session Name</TableCell>
                            <TableCell>Processed Date</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {pagedSessions.map((session) => {
                            const isExpanded = expandedSessionId === session.session_id;
                            return (
                              <React.Fragment key={session.session_id}>
                                <TableRow
                                  sx={{
                                    cursor: 'pointer',
                                    bgcolor: isExpanded ? Ze.activeRow : 'transparent',
                                    '&:hover': { bgcolor: Ze.rowHover },
                                    '& td': { borderBottom: isExpanded ? 'none' : `1px solid ${Ze.rowLine}`, color: Ze.text, fontSize: '13px' }
                                  }}
                                >
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)}>
                                    <ToggleButton
                                      isExpanded={isExpanded}
                                      onClick={(e) => { e.stopPropagation(); setExpandedSessionId(isExpanded ? null : session.session_id); }}
                                    />
                                  </TableCell>
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <DescriptionIcon sx={{ fontSize: 16, color: '#60a5fa' }} />
                                      <Typography variant="body2" fontWeight="600" sx={{ fontSize: '13px' }}>
                                        {session.client_file || session.session_id}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)} sx={{ color: Ze.muted, fontSize: '12px' }}>
                                    {formatDisplayDate(session.created)}
                                  </TableCell>
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)}>
                                    <Chip
                                      label={session.has_mappings ? 'Mapped' : 'Uploaded'}
                                      size="small"
                                      sx={{
                                        height: 20,
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        bgcolor: session.has_mappings ? 'rgba(52, 211, 153, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                        color: session.has_mappings ? '#34d399' : '#60a5fa'
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                    <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
                                        onClick={() => navigate(`/mapping/${session.session_id}`)}
                                        sx={{ height: 26, fontSize: '11px', textTransform: 'none', borderRadius: '6px', color: Ze.text, borderColor: Ze.subtleBorder }}
                                      >
                                        Mapping
                                      </Button>
                                      <Box sx={{ width: 90 }}>
                                        <DownloadButton
                                          label="Download"
                                          onClick={() => navigate(`/editor/${session.session_id}`)}
                                        />
                                      </Box>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleDeleteSession(session.session_id)}
                                        sx={{ color: '#ef4444', opacity: 0.8, '&:hover': { opacity: 1 } }}
                                      >
                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                                {isExpanded && (
                                  <TableRow sx={{ bgcolor: Ze.activeRow }}>
                                    <TableCell colSpan={5} sx={{ p: 2, borderBottom: `1px solid ${Ze.rowLine}` }}>
                                      <Box sx={{ p: 2, borderRadius: '12px', bgcolor: Ze.controlBg, border: `1px solid ${Ze.subtleBorder}` }}>
                                        <Grid container spacing={2}>
                                          <Grid item xs={12} sm={4}>
                                            <Typography variant="caption" sx={{ color: Ze.muted, display: 'block' }}>Client File</Typography>
                                            <Typography variant="body2" fontWeight="600" sx={{ color: Ze.text }}>{session.client_file || 'N/A'}</Typography>
                                          </Grid>
                                          <Grid item xs={12} sm={4}>
                                            <Typography variant="caption" sx={{ color: Ze.muted, display: 'block' }}>Template File</Typography>
                                            <Typography variant="body2" fontWeight="600" sx={{ color: Ze.text }}>{session.template_file || 'Default Item.xlsx'}</Typography>
                                          </Grid>
                                          <Grid item xs={12} sm={4}>
                                            <Typography variant="caption" sx={{ color: Ze.muted, display: 'block' }}>Rows Processed</Typography>
                                            <Typography variant="body2" fontWeight="600" sx={{ color: Ze.text }}>{session.rows_processed || 'N/A'}</Typography>
                                          </Grid>
                                        </Grid>
                                        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} justifyContent="flex-end">
                                          <Button
                                            size="small"
                                            className="gradient-btn"
                                            startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
                                            onClick={() => navigate(`/mapping/${session.session_id}`)}
                                            sx={{ height: 28, px: 2, fontSize: '11px', textTransform: 'none' }}
                                          >
                                            Continue to Mapping
                                          </Button>
                                          {session.has_mappings && (
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              onClick={() => navigate(`/editor/${session.session_id}`)}
                                              sx={{ height: 28, px: 2, fontSize: '11px', textTransform: 'none', color: Ze.text, borderColor: Ze.subtleBorder }}
                                            >
                                              Open Data Editor
                                            </Button>
                                          )}
                                        </Stack>
                                      </Box>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <TablePagination
                      component="div"
                      count={filteredSessions.length}
                      page={sessionPage}
                      onPageChange={(_, p) => setSessionPage(p)}
                      rowsPerPage={sessionRowsPerPage}
                      onRowsPerPageChange={(e) => { setSessionRowsPerPage(parseInt(e.target.value, 10)); setSessionPage(0); }}
                      rowsPerPageOptions={[5, 10, 25]}
                      sx={{ color: Ze.muted, fontSize: '12px' }}
                    />
                  </>
                )}
              </Box>
            )}

            {/* TAB 1: Mapping Templates */}
            {activeTab === 1 && (
              <Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                  <TextField
                    size="small"
                    placeholder="Search mapping templates..."
                    value={tmplSearch}
                    onChange={(e) => { setTmplSearch(e.target.value); setTmplPage(0); }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: '#8992a5' }} /></InputAdornment>,
                      endAdornment: tmplSearch && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setTmplSearch('')} sx={{ color: '#8992a5' }}>
                            <ClearIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </InputAdornment>
                      )
                    }}
                    sx={{ flex: 1, '& .MuiOutlinedInput-root': { height: 38, fontSize: '13px', borderRadius: '8px', bgcolor: Ze.searchBg } }}
                  />
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <Select value={tmplSortBy} onChange={(e) => { setTmplSortBy(e.target.value); setTmplPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}>
                      <MenuItem value="usage_count">Sort by Usage</MenuItem>
                      <MenuItem value="name">Sort by Name</MenuItem>
                      <MenuItem value="created_at">Sort by Date</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select value={tmplSortOrder} onChange={(e) => { setTmplSortOrder(e.target.value); setTmplPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}>
                      <MenuItem value="desc">High → Low</MenuItem>
                      <MenuItem value="asc">Low → High</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
                {filteredTemplates.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5, color: Ze.muted }}>
                    <LibraryBooksIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
                    <Typography variant="body2">No mapping templates saved yet.</Typography>
                  </Box>
                ) : (
                  <>
                    <Grid container spacing={2}>
                      {pagedTemplates.map((tmpl) => (
                        <Grid item xs={12} sm={6} md={4} key={tmpl.id}>
                          <Card sx={{ bgcolor: Ze.inputBg, border: `1px solid ${Ze.subtleBorder}`, borderRadius: '12px', transition: 'all 0.2s ease', '&:hover': { borderColor: '#2383e2', transform: 'translateY(-1px)' } }}>
                            <CardContent sx={{ p: 2 }}>
                              <Typography variant="subtitle2" fontWeight="700" sx={{ color: Ze.text, mb: 0.5 }}>{tmpl.name}</Typography>
                              <Typography variant="caption" sx={{ color: Ze.muted, display: 'block', mb: 1.5 }}>
                                {tmpl.total_mappings || 0} mapped columns • Used {tmpl.usage_count || 0} times
                              </Typography>
                              <UseButton
                                onClick={() => handleApplyTemplate(tmpl)}
                                label="Apply Template"
                                color="linear-gradient(135deg, #2563eb 0%, #0284c7 100%)"
                                hoverColor="linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)"
                                glowColor="rgba(37, 99, 235, 0.45)"
                              />
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                    <TablePagination
                      component="div"
                      count={filteredTemplates.length}
                      page={tmplPage}
                      onPageChange={(_, p) => setTmplPage(p)}
                      rowsPerPage={tmplRowsPerPage}
                      onRowsPerPageChange={(e) => { setTmplRowsPerPage(parseInt(e.target.value, 10)); setTmplPage(0); }}
                      rowsPerPageOptions={[6, 12, 24]}
                      sx={{ color: Ze.muted, fontSize: '12px' }}
                    />
                  </>
                )}
              </Box>
            )}

            {/* TAB 2: Tag Rules */}
            {activeTab === 2 && (
              <Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                  <TextField
                    size="small"
                    placeholder="Search tag rule templates..."
                    value={tagSearch}
                    onChange={(e) => { setTagSearch(e.target.value); setTagPage(0); }}
                    InputProps={{
                      startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: '#8992a5' }} /></InputAdornment>,
                      endAdornment: tagSearch && (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setTagSearch('')} sx={{ color: '#8992a5' }}>
                            <ClearIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </InputAdornment>
                      )
                    }}
                    sx={{ flex: 1, '& .MuiOutlinedInput-root': { height: 38, fontSize: '13px', borderRadius: '8px', bgcolor: Ze.searchBg } }}
                  />
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <Select value={tagSortBy} onChange={(e) => { setTagSortBy(e.target.value); setTagPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}>
                      <MenuItem value="usage_count">Sort by Usage</MenuItem>
                      <MenuItem value="name">Sort by Name</MenuItem>
                      <MenuItem value="created_at">Sort by Date</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select value={tagSortOrder} onChange={(e) => { setTagSortOrder(e.target.value); setTagPage(0); }}
                      MenuProps={{ PaperProps: { className: 'fw-select-dropdown' } }}
                      sx={{ height: 38, fontSize: '12px', borderRadius: '8px', bgcolor: Ze.searchBg }}>
                      <MenuItem value="desc">High → Low</MenuItem>
                      <MenuItem value="asc">Low → High</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
                {filteredTags.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5, color: Ze.muted }}>
                    <ScienceIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
                    <Typography variant="body2">No tag rule templates found.</Typography>
                  </Box>
                ) : (
                  <>
                    <Grid container spacing={2}>
                      {pagedTags.map((tmpl) => (
                        <Grid item xs={12} sm={6} md={4} key={tmpl.id}>
                          <Card sx={{ bgcolor: Ze.inputBg, border: `1px solid ${Ze.subtleBorder}`, borderRadius: '12px', transition: 'all 0.2s ease', '&:hover': { borderColor: '#a78bfa', transform: 'translateY(-1px)' } }}>
                            <CardContent sx={{ p: 2 }}>
                              <Typography variant="subtitle2" fontWeight="700" sx={{ color: Ze.text, mb: 0.5 }}>{tmpl.name}</Typography>
                              <Typography variant="caption" sx={{ color: Ze.muted, display: 'block', mb: 1 }}>
                                {tmpl.rules?.length || 0} tag rules{tmpl.usage_count ? ` • Used ${tmpl.usage_count} times` : ''}
                              </Typography>
                              <Chip
                                label="Tag Template"
                                size="small"
                                sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(168, 85, 247, 0.12)', color: '#a78bfa', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: '4px' }}
                              />
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                    <TablePagination
                      component="div"
                      count={filteredTags.length}
                      page={tagPage}
                      onPageChange={(_, p) => setTagPage(p)}
                      rowsPerPage={tagRowsPerPage}
                      onRowsPerPageChange={(e) => { setTagRowsPerPage(parseInt(e.target.value, 10)); setTagPage(0); }}
                      rowsPerPageOptions={[6, 12, 24]}
                      sx={{ color: Ze.muted, fontSize: '12px' }}
                    />
                  </>
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Standalone Formula Builder Modal */}
      {showFormulaModal && (
        <StandaloneFormulaBuilder
          open={showFormulaModal}
          onClose={() => setShowFormulaModal(false)}
        />
      )}
    </Box>
  );
};

export default Dashboard;
