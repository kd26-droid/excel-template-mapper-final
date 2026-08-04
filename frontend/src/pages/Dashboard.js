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
  TablePagination,
  Collapse
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
    background: ${props => props.disabled ? 'rgba(255, 255, 255, 0.05)' : props.color || 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)'};
    color: ${props => props.disabled ? 'rgba(255, 255, 255, 0.3)' : '#ffffff'};
    font-size: 11px;
    font-weight: 600;
    border: 1px solid ${props => props.disabled ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.2)'};
    box-shadow: ${props => props.disabled ? 'none' : '0 3px 10px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.25)'};
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
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
    color: ${props => props.disabled ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.9)'};
    transition: all 0.2s ease;
  }
  .tray-bar {
    width: 14px;
    height: 2px;
    background-color: ${props => props.disabled ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.7)'};
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
  hoverColor = 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
  disabled = false }) => (
  <DownloadButtonWrapper color={color} hoverColor={hoverColor} disabled={disabled}>
    <button className="download-btn" onClick={onClick} disabled={disabled} type="button">
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

const OpenEditorButtonWrapper = styled.div`
  display: inline-flex;

  .folder-button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    height: ${props => props.size || 30}px;
    width: ${props => props.size || 30}px;
    padding: 0 6px;
    border-radius: ${props => (props.size || 30) / 2}px;
    background: ${props => props.isDarkMode === false 
      ? 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' 
      : 'linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(37, 99, 235, 0.28) 100%)'};
    border: 1px solid ${props => props.isDarkMode === false ? '#3b82f6' : 'rgba(59, 130, 246, 0.4)'};
    box-shadow: ${props => props.isDarkMode === false ? '0 2px 8px rgba(37, 99, 235, 0.25)' : '0 2px 8px rgba(59, 130, 246, 0.2)'};
    cursor: pointer;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    white-space: nowrap;
  }

  .folder-icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: ${props => (props.size || 30) - 14}px;
  }

  .folder {
    position: relative;
    width: 14px;
    height: 11px;
  }

  .folder-back {
    position: absolute;
    width: 100%;
    height: 100%;
    background: ${props => props.isDarkMode === false ? '#2563eb' : '#3b82f6'};
    border-radius: 1px 3px 2px 2px;
  }

  .paper {
    position: absolute;
    bottom: 1px;
    left: 15%;
    width: 70%;
    height: 60%;
    background: #ffffff;
    border-radius: 1px;
    transition: transform 0.3s ease;
  }

  .folder-front {
    position: absolute;
    bottom: 0;
    width: 100%;
    height: 75%;
    background: ${props => props.isDarkMode === false ? '#1d4ed8' : '#60a5fa'};
    border-radius: 0 0 2px 2px;
    transform-origin: bottom;
    transition: transform 0.3s ease;
  }

  .btn-label {
    opacity: 0;
    max-width: 0;
    font-size: 11px;
    font-weight: 600;
    color: ${props => props.isDarkMode === false ? '#1e3a8a' : '#ffffff'};
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-left: 0;
  }

  .folder-button:hover .paper {
    transform: translateY(-3px);
  }

  .folder-button:hover .folder-front {
    transform: skewX(-10deg) scaleY(0.85);
  }

  .folder-button:hover {
    width: 105px;
    padding: 0 10px;
    background: ${props => props.isDarkMode === false ? '#2563eb' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'};
    border-color: ${props => props.isDarkMode === false ? '#1d4ed8' : '#93c5fd'};
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.5);
    transform: translateY(-1px);
  }

  .folder-button:hover .btn-label {
    opacity: 1;
    max-width: 70px;
    margin-left: 5px;
    color: #ffffff;
  }

  .folder-button:active {
    transform: scale(0.95);
  }
`;

const OpenEditorButton = ({ onClick, size = 30, title = 'Open Session in Editor' }) => {
  const { isDarkMode } = useThemeContext();
  return (
    <OpenEditorButtonWrapper size={size} isDarkMode={isDarkMode}>
      <button className="folder-button" onClick={onClick} type="button" title={title}>
        <div className="folder-icon-box">
          <div className="folder">
            <div className="folder-back">
              <div className="paper" />
            </div>
            <div className="folder-front" />
          </div>
        </div>
        <span className="btn-label">Open Editor</span>
      </button>
    </OpenEditorButtonWrapper>
  );
};

const DeleteButtonWrapper = styled.div`
  display: inline-flex;

  .bin-button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    height: ${props => props.size || 30}px;
    width: ${props => props.size || 30}px;
    padding: 0 7px;
    border-radius: ${props => (props.size || 30) / 2}px;
    background: ${props => props.isDarkMode === false 
      ? 'linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%)' 
      : 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.3) 100%)'};
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    border: 1px solid ${props => props.isDarkMode === false ? '#ef4444' : 'rgba(239, 68, 68, 0.4)'};
    box-shadow: ${props => props.isDarkMode === false ? '0 2px 8px rgba(239, 68, 68, 0.25)' : '0 2px 8px rgba(239, 68, 68, 0.25)'};
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    opacity: ${props => props.disabled ? 0.5 : 1};
    overflow: hidden;
    white-space: nowrap;
    color: ${props => props.isDarkMode === false ? '#dc2626' : '#ffffff'};
  }

  .icon-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: ${props => (props.size || 30) - 14}px;
  }

  .bin-top {
    width: 13px;
    transform-origin: right;
    transition: transform 0.3s ease, stroke 0.2s ease;
    margin-bottom: 1px;
    color: ${props => props.isDarkMode === false ? '#dc2626' : '#ffffff'};
  }

  .bin-bottom {
    width: 11px;
    transition: color 0.2s ease, fill 0.2s ease;
    color: ${props => props.isDarkMode === false ? '#dc2626' : '#ffffff'};
  }

  .btn-label {
    opacity: 0;
    max-width: 0;
    font-size: 11px;
    font-weight: 600;
    color: ${props => props.isDarkMode === false ? '#991b1b' : '#ffffff'};
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-left: 0;
  }

  .bin-button:hover:not(:disabled) .bin-top {
    transform: rotate(45deg);
    color: #ffffff;
  }

  .bin-button:hover:not(:disabled) .bin-bottom {
    color: #ffffff;
  }

  .bin-button:hover:not(:disabled) {
    width: 82px;
    padding: 0 10px;
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    border-color: #fca5a5;
    box-shadow: 0 4px 14px rgba(239, 68, 68, 0.5);
    transform: translateY(-1px);
    color: #ffffff;
  }

  .bin-button:hover:not(:disabled) .btn-label {
    opacity: 1;
    max-width: 50px;
    margin-left: 5px;
    color: #ffffff;
  }

  .bin-button:active:not(:disabled) {
    transform: scale(0.95);
  }
`;

const DeleteActionButton = ({ onClick, disabled = false, loading = false, size = 30, title = 'Delete Session' }) => {
  const { isDarkMode } = useThemeContext();
  return (
    <DeleteButtonWrapper size={size} disabled={disabled} isDarkMode={isDarkMode}>
      <button
        className="bin-button"
        onClick={disabled || loading ? undefined : onClick}
        type="button"
        disabled={disabled || loading}
        title={title}
      >
        {loading ? (
          <CircularProgress size={0.45 * size} color="inherit" />
        ) : (
          <>
            <div className="icon-box">
              <svg className="bin-top" viewBox="0 0 39 7" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line y1="5" x2="39" y2="5" stroke="currentColor" strokeWidth="4" />
                <line x1="12" y1="1.5" x2="26.0357" y2="1.5" stroke="currentColor" strokeWidth="3" />
              </svg>
              <svg className="bin-bottom" viewBox="0 0 33 39" fill="none" xmlns="http://www.w3.org/2000/svg">
                <mask id="bin-mask-path" fill="white">
                  <path d="M0 0H33V35C33 37.2091 31.2091 39 29 39H4C1.79086 39 0 37.2091 0 35V0Z" />
                </mask>
                <path d="M0 0H33H0ZM37 35C37 39.4183 33.4183 43 29 43H4C-0.418278 43 -4 39.4183 -4 35H4H29H37ZM4 43C-0.418278 43 -4 39.4183 -4 35V0H4V35V43ZM37 0V35C37 39.4183 33.4183 43 29 43V35V0H37Z" fill="currentColor" mask="url(#bin-mask-path)" />
                <path d="M12 6L12 29" stroke="currentColor" strokeWidth="4" />
                <path d="M21 6V29" stroke="currentColor" strokeWidth="4" />
              </svg>
            </div>
            <span className="btn-label">Delete</span>
          </>
        )}
      </button>
    </DeleteButtonWrapper>
  );
};

const ToggleButtonWrapper = styled.div`
  display: inline-flex;
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    width: 24px;
    padding: 0;
    border-radius: 12px;
    background: ${props => props.isExpanded 
      ? (props.isDarkMode ? 'rgba(35, 131, 226, 0.25)' : '#dbeafe') 
      : (props.isDarkMode ? 'rgba(255, 255, 255, 0.05)' : '#f1f5f9')};
    border: 1px solid ${props => props.isExpanded 
      ? (props.isDarkMode ? 'rgba(35, 131, 226, 0.5)' : '#3b82f6') 
      : (props.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : '#cbd5e1')};
    color: ${props => props.isExpanded 
      ? (props.isDarkMode ? '#60a5fa' : '#2563eb') 
      : (props.isDarkMode ? '#8992a5' : '#64748b')};
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .chevron-icon {
    width: 14px;
    height: 14px;
    transform: ${props => props.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};
    transition: transform 0.3s ease;
  }
  .toggle-btn:hover {
    background: ${props => props.isExpanded 
      ? (props.isDarkMode ? 'rgba(35, 131, 226, 0.35)' : '#bfdbfe') 
      : (props.isDarkMode ? 'rgba(255, 255, 255, 0.12)' : '#e2e8f0')};
    border-color: #2383e2;
    color: #2383e2;
  }
  .toggle-btn:active { transform: scale(0.92); }
`;

const ToggleButton = ({ isExpanded, onClick }) => {
  const { isDarkMode } = useThemeContext();
  return (
    <ToggleButtonWrapper isExpanded={isExpanded} isDarkMode={isDarkMode}>
      <button className="toggle-btn" onClick={onClick} type="button" title={isExpanded ? 'Collapse Session' : 'Expand Session'}>
        <svg className="chevron-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
      </button>
    </ToggleButtonWrapper>
  );
};

const UseButtonWrapper = styled.div`
  display: inline-flex;
  .use-btn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    height: ${props => props.size || 24}px;
    width: ${props => props.size || 24}px;
    padding: 0;
    border-radius: ${props => (props.size || 24) / 2}px;
    background: ${props => props.color};
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 8px ${props => props.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.3);
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
    white-space: nowrap;
  }
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${props => props.size || 24}px;
    min-width: ${props => props.size || 24}px;
    height: ${props => props.size || 24}px;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .play-icon {
    width: ${props => Math.round((props.size || 24) * 0.5)}px;
    height: ${props => Math.round((props.size || 24) * 0.5)}px;
    margin-left: 1px;
    transition: transform 0.25s ease;
  }
  .btn-label {
    opacity: 0;
    max-width: 0;
    color: #ffffff;
    font-size: 11px;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    margin-left: 0;
  }
  .use-btn:hover {
    width: 80px;
    padding: 0 8px;
    background: ${props => props.hoverColor};
    border-color: rgba(255, 255, 255, 0.4);
    box-shadow: 0 4px 14px ${props => props.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transform: translateY(-1px);
  }
  .use-btn:hover .icon-box { width: 14px; min-width: 14px; }
  .use-btn:hover .play-icon { transform: translateX(1px) scale(1.1); }
  .use-btn:hover .btn-label { opacity: 1; max-width: 55px; margin-left: 4px; }
  .use-btn:active { transform: scale(0.95); }
`;

const UseButton = ({
  onClick,
  label = 'Use',
  size = 24,
  color = 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
  hoverColor = 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
  glowColor = 'rgba(37, 99, 235, 0.45)'
}) => (
  <UseButtonWrapper size={size} color={color} hoverColor={hoverColor} glowColor={glowColor}>
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

const cleanFileName = (filename) => {
  if (!filename) return 'Unknown File';
  const parts = String(filename).split('_');
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const extMatch = last.match(/\.(xlsx|xls|csv|pdf)$/i);
    const ext = extMatch ? extMatch[0] : '.xlsx';
    const nameWithoutExt = last.replace(/\.(xlsx|xls|csv|pdf)$/i, '');
    return `${nameWithoutExt}${ext}`;
  }
  return String(filename).length > 30 ? `${String(filename).substring(0, 30)}...` : filename;
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

  const handleDeleteMappingTemplate = async (templateId) => {
    if (!window.confirm('Are you sure you want to delete this mapping template?')) return;
    try {
      await api.deleteMappingTemplate(templateId);
      fetchData();
    } catch (err) {
      console.error('Error deleting mapping template:', err);
      alert(err.message || 'Failed to delete template');
    }
  };

  const handleDeleteTagTemplate = async (templateId) => {
    if (!window.confirm('Are you sure you want to delete this tag template?')) return;
    try {
      await api.deleteTagTemplate(templateId);
      fetchData();
    } catch (err) {
      console.error('Error deleting tag template:', err);
      alert(err.message || 'Failed to delete tag template');
    }
  };

  const handleDownloadFile = async (sessionId, fileType) => {
    try {
      await api.downloadFileEnhanced(sessionId, fileType);
    } catch (err) {
      console.error(`Download error (${fileType}):`, err);
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
          <Box />
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
                    <Box sx={{ p: 1.25, bgcolor: isDarkMode ? 'rgba(59, 130, 246, 0.08)' : 'rgba(37, 99, 235, 0.06)', borderRadius: '10px', border: isDarkMode ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(37, 99, 235, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: isDarkMode ? '#93c5fd' : '#1d4ed8', fontSize: '10px', display: 'block', mb: 0.25 }}>
                        Mapping
                      </Typography>
                      <Typography variant="h6" fontWeight="700" sx={{ color: Ze.text, fontFamily: '"JetBrains Mono", monospace' }}>
                        {templateStats.totalTemplates}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ p: 1.25, bgcolor: isDarkMode ? 'rgba(168, 85, 247, 0.08)' : 'rgba(124, 58, 237, 0.06)', borderRadius: '10px', border: isDarkMode ? '1px solid rgba(168, 85, 247, 0.2)' : '1px solid rgba(124, 58, 237, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: isDarkMode ? '#e9d5ff' : '#6d28d9', fontSize: '10px', display: 'block', mb: 0.25 }}>
                        Tag Rules
                      </Typography>
                      <Typography variant="h6" fontWeight="700" sx={{ color: Ze.text, fontFamily: '"JetBrains Mono", monospace' }}>
                        {tagTemplates.length}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={4}>
                    <Box sx={{ p: 1.25, bgcolor: isDarkMode ? 'rgba(16, 185, 129, 0.08)' : 'rgba(5, 150, 105, 0.06)', borderRadius: '10px', border: isDarkMode ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(5, 150, 105, 0.2)' }}>
                      <Typography variant="caption" fontWeight="600" sx={{ color: isDarkMode ? '#a7f3d0' : '#047857', fontSize: '10px', display: 'block', mb: 0.25 }}>
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
                    sx={{ height: 18, fontSize: '10px', bgcolor: isDarkMode ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.15)', color: isDarkMode ? '#fbbf24' : '#b45309', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '4px' }}
                  />
                </Box>
                {templateStats.top3Templates && templateStats.top3Templates.length > 0 ? (
                  <Stack spacing={0.6} sx={{ flexGrow: 1, justifyContent: 'center' }}>
                    {templateStats.top3Templates.slice(0, 3).map((tmpl, idx) => {
                      const ranks = [
                        { bg: isDarkMode ? 'rgba(245, 158, 11, 0.2)' : 'rgba(245, 158, 11, 0.15)', text: isDarkMode ? '#fbbf24' : '#b45309', label: '#1' },
                        { bg: isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.15)', text: isDarkMode ? '#cbd5e1' : '#334155', label: '#2' },
                        { bg: isDarkMode ? 'rgba(217, 119, 6, 0.2)' : 'rgba(217, 119, 6, 0.15)', text: isDarkMode ? '#fdba74' : '#c2410c', label: '#3' }
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
                            height: 32,
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
                            {/* Animated expand-on-hover Use button (fits cleanly inside row surface) */}
                            <UseButton
                              onClick={(e) => { e.stopPropagation(); handleApplyTemplate(tmpl); }}
                              label="Use"
                              size={22}
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
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                      <Box
                                        sx={{
                                          width: 22,
                                          height: 22,
                                          borderRadius: '5px',
                                          bgcolor: '#2383e2',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          color: '#ffffff',
                                          boxShadow: '0 2px 6px rgba(35, 131, 226, 0.4)'
                                        }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                        </svg>
                                      </Box>
                                      <Typography variant="body2" fontWeight="700" sx={{ fontSize: '13px', color: Ze.text }}>
                                        {cleanFileName(session.client_file || session.original_client_name || session.file_name || session.session_id)}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)} sx={{ color: Ze.text, fontSize: '12px', fontWeight: 500 }}>
                                    {formatDisplayDate(session.created || session.upload_date || session.created_at)}
                                  </TableCell>
                                  <TableCell onClick={() => setExpandedSessionId(isExpanded ? null : session.session_id)}>
                                    <Chip
                                      label="Completed"
                                      size="small"
                                      sx={{
                                        height: 22,
                                        px: 1,
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        borderRadius: '999px',
                                        bgcolor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.12)',
                                        color: isDarkMode ? '#34d399' : '#047857',
                                        border: isDarkMode ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(16, 185, 129, 0.25)'
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                    <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                                      <OpenEditorButton onClick={() => navigate(`/editor/${session.session_id}`)} />
                                      <DeleteActionButton onClick={() => handleDeleteSession(session.session_id)} />
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                                {isExpanded && (
                                  <TableRow sx={{ bgcolor: Ze.activeRow }}>
                                    <TableCell colSpan={5} sx={{ p: 2, borderBottom: `1px solid ${Ze.rowLine}` }}>
                                      <Box
                                        sx={{
                                          p: 2.5,
                                          borderRadius: '14px',
                                          bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.75)' : '#ffffff',
                                          border: `1px solid ${Ze.subtleBorder}`,
                                          boxShadow: isDarkMode ? 'inset 0 1px 3px rgba(0, 0, 0, 0.5)' : '0 4px 12px rgba(0, 0, 0, 0.05)'
                                        }}
                                      >
                                        <Typography
                                          variant="caption"
                                          fontWeight="700"
                                          sx={{
                                            color: Ze.muted,
                                            letterSpacing: '0.06em',
                                            fontSize: '11px',
                                            textTransform: 'uppercase',
                                            display: 'block',
                                            mb: 2
                                          }}
                                        >
                                          SESSION FILES & DOWNLOAD ACTIONS
                                        </Typography>

                                        <Grid container spacing={2}>
                                          {/* Client Original File Card */}
                                          <Grid item xs={12} sm={4}>
                                            <Box
                                              sx={{
                                                p: 2,
                                                borderRadius: '12px',
                                                bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : 'rgba(37, 99, 235, 0.04)',
                                                border: isDarkMode ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid rgba(37, 99, 235, 0.2)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'space-between',
                                                height: '100%',
                                                minHeight: 125,
                                                transition: 'all 0.2s ease',
                                                '&:hover': { borderColor: 'rgba(59, 130, 246, 0.5)', bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(37, 99, 235, 0.08)' }
                                              }}
                                            >
                                              <Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                  <Avatar sx={{ width: 22, height: 22, bgcolor: isDarkMode ? 'rgba(59, 130, 246, 0.25)' : 'rgba(37, 99, 235, 0.15)', color: isDarkMode ? '#60a5fa' : '#2563eb' }}>
                                                    <DescriptionIcon sx={{ fontSize: 13 }} />
                                                  </Avatar>
                                                  <Typography variant="subtitle2" fontWeight="700" sx={{ color: isDarkMode ? '#60a5fa' : '#1d4ed8', fontSize: '13px' }}>
                                                    Client Original File
                                                  </Typography>
                                                </Box>
                                                <Typography variant="body2" fontWeight="700" sx={{ color: Ze.text, fontSize: '13px', mb: 2, wordBreak: 'break-all' }}>
                                                  {cleanFileName(session.client_file || session.original_client_name || session.file_name || session.session_id)}
                                                </Typography>
                                              </Box>
                                              <DownloadButton
                                                label="Download Original"
                                                color="linear-gradient(135deg, #2563eb 0%, #0284c7 100%)"
                                                hoverColor="linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)"
                                                onClick={() => handleDownloadFile(session.session_id, 'original')}
                                              />
                                            </Box>
                                          </Grid>

                                          {/* FW Mapped Sheet Card */}
                                          <Grid item xs={12} sm={4}>
                                            <Box
                                              sx={{
                                                p: 2,
                                                borderRadius: '12px',
                                                bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : 'rgba(16, 185, 129, 0.04)',
                                                border: session.has_mappings ? (isDarkMode ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)') : `1px solid ${Ze.subtleBorder}`,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'space-between',
                                                height: '100%',
                                                minHeight: 125,
                                                transition: 'all 0.2s ease',
                                                '&:hover': { borderColor: session.has_mappings ? 'rgba(16, 185, 129, 0.5)' : Ze.border, bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(16, 185, 129, 0.08)' }
                                              }}
                                            >
                                              <Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                  <Avatar sx={{ width: 22, height: 22, bgcolor: isDarkMode ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)', color: isDarkMode ? '#34d399' : '#059669' }}>
                                                    <DescriptionIcon sx={{ fontSize: 13 }} />
                                                  </Avatar>
                                                  <Typography variant="subtitle2" fontWeight="700" sx={{ color: isDarkMode ? '#34d399' : '#047857', fontSize: '13px' }}>
                                                    FW Mapped Sheet
                                                  </Typography>
                                                </Box>
                                                <Typography
                                                  variant="body2"
                                                  fontWeight="700"
                                                  sx={{
                                                    color: session.has_mappings ? Ze.text : Ze.muted,
                                                    fontSize: '13px',
                                                    mb: 2,
                                                    wordBreak: 'break-all'
                                                  }}
                                                >
                                                  {session.filled_sheet_name || (session.has_mappings !== false ? 'Mapped Sheet Ready' : 'Not Mapped')}
                                                </Typography>
                                              </Box>
                                              <DownloadButton
                                                label="Download Mapped Sheet"
                                                color="linear-gradient(135deg, #059669 0%, #10b981 100%)"
                                                hoverColor="linear-gradient(135deg, #047857 0%, #059669 100%)"
                                                disabled={!session.has_mappings}
                                                onClick={() => handleDownloadFile(session.session_id, 'converted')}
                                              />
                                            </Box>
                                          </Grid>

                                          {/* FW Template File Card */}
                                          <Grid item xs={12} sm={4}>
                                            <Box
                                              sx={{
                                                p: 2,
                                                borderRadius: '12px',
                                                bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.6)' : 'rgba(168, 85, 247, 0.04)',
                                                border: isDarkMode ? '1px solid rgba(168, 85, 247, 0.25)' : '1px solid rgba(124, 58, 237, 0.2)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'space-between',
                                                height: '100%',
                                                minHeight: 125,
                                                transition: 'all 0.2s ease',
                                                '&:hover': { borderColor: 'rgba(168, 85, 247, 0.5)', bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(168, 85, 247, 0.08)' }
                                              }}
                                            >
                                              <Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                  <Avatar sx={{ width: 22, height: 22, bgcolor: isDarkMode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(124, 58, 237, 0.15)', color: isDarkMode ? '#c084fc' : '#6d28d9' }}>
                                                    <DescriptionIcon sx={{ fontSize: 13 }} />
                                                  </Avatar>
                                                  <Typography variant="subtitle2" fontWeight="700" sx={{ color: isDarkMode ? '#c084fc' : '#6d28d9', fontSize: '13px' }}>
                                                    FW Template File
                                                  </Typography>
                                                </Box>
                                                <Typography variant="body2" fontWeight="700" sx={{ color: Ze.text, fontSize: '13px', mb: 2, wordBreak: 'break-all' }}>
                                                  {cleanFileName(session.template_file || session.template_name || 'Standard Template')}
                                                </Typography>
                                              </Box>
                                              <DownloadButton
                                                label="Download Template"
                                                color="linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
                                                hoverColor="linear-gradient(135deg, #6d28d9 0%, #9333ea 100%)"
                                                onClick={() => handleDownloadFile(session.session_id, 'template')}
                                              />
                                            </Box>
                                          </Grid>
                                        </Grid>

                                        {/* Footer details row */}
                                        <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'center', gap: 3, fontSize: '12px', color: Ze.muted }}>
                                          <Typography variant="caption" sx={{ color: Ze.muted, fontSize: '12px' }}>
                                            Rows Processed: <span style={{ color: isDarkMode ? '#ffffff' : '#0f172a', fontWeight: 700 }}>{session.rows_processed || 0}</span>
                                          </Typography>
                                          <Typography variant="caption" sx={{ color: Ze.muted, fontSize: '12px' }}>
                                            Date: <span style={{ color: isDarkMode ? '#ffffff' : '#0f172a', fontWeight: 700 }}>{formatDisplayDate(session.created || session.upload_date || session.created_at)}</span>
                                          </Typography>
                                        </Box>
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
                    <Stack spacing={1.25}>
                      {pagedTemplates.map((tmpl) => (
                        <Box
                          key={tmpl.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            px: 2,
                            borderRadius: '12px',
                            bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
                            border: `1px solid ${Ze.subtleBorder}`,
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              bgcolor: isDarkMode ? 'rgba(35, 131, 226, 0.12)' : '#eff6ff',
                              borderColor: '#2383e2',
                              transform: 'translateY(-1px)'
                            }
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                            <Avatar
                              sx={{
                                bgcolor: 'rgba(35, 131, 226, 0.15)',
                                color: '#60a5fa',
                                width: 34,
                                height: 34,
                                border: '1px solid rgba(35, 131, 226, 0.3)'
                              }}
                            >
                              <LibraryBooksIcon sx={{ fontSize: 18 }} />
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="subtitle2" fontWeight="600" noWrap sx={{ color: Ze.text, fontSize: '13px' }}>
                                  {tmpl.name}
                                </Typography>
                                {(tmpl.usage_count || 0) >= 5 && <StarIcon sx={{ fontSize: 14, color: '#fbbf24' }} />}
                              </Box>
                              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Chip
                                  label={`${tmpl.total_mappings || 0} mappings`}
                                  size="small"
                                  sx={{ height: 18, fontSize: '10px', bgcolor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#eef2f7', color: Ze.muted }}
                                />
                                <Chip
                                  label={`Used ${tmpl.usage_count || 0}×`}
                                  size="small"
                                  sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}
                                />
                                <Typography variant="caption" sx={{ color: Ze.muted, fontSize: '10px' }}>
                                  {formatDisplayDate(tmpl.created_at || tmpl.created)}
                                </Typography>
                              </Box>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <UseButton
                              onClick={() => handleApplyTemplate(tmpl)}
                              label="Use"
                              size={30}
                              color="linear-gradient(135deg, #2563eb 0%, #0284c7 100%)"
                              hoverColor="linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)"
                              glowColor="rgba(37, 99, 235, 0.45)"
                              title="Use Mapping Template"
                            />
                            <DeleteActionButton
                              onClick={() => handleDeleteMappingTemplate(tmpl.id)}
                              size={30}
                              title="Delete Mapping Template"
                            />
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                    <TablePagination
                      component="div"
                      count={filteredTemplates.length}
                      page={tmplPage}
                      onPageChange={(_, p) => setTmplPage(p)}
                      rowsPerPage={tmplRowsPerPage}
                      onRowsPerPageChange={(e) => { setTmplRowsPerPage(parseInt(e.target.value, 10)); setTmplPage(0); }}
                      rowsPerPageOptions={[5, 10, 25]}
                      sx={{ color: Ze.muted, fontSize: '12px', mt: 1, borderTop: `1px solid ${Ze.subtleBorder}` }}
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
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ScienceIcon sx={{ fontSize: 14 }} />}
                    onClick={() => setShowFormulaModal(true)}
                    sx={{
                      height: 38,
                      fontSize: '12px',
                      textTransform: 'none',
                      borderColor: '#10b981',
                      color: '#34d399',
                      '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.15)' }
                    }}
                  >
                    New Template
                  </Button>
                </Stack>
                {filteredTags.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5, color: Ze.muted }}>
                    <ScienceIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
                    <Typography variant="body2">No tag rule templates found.</Typography>
                  </Box>
                ) : (
                  <>
                    <Stack spacing={1.25}>
                      {pagedTags.map((tmpl) => (
                        <Box
                          key={tmpl.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                            px: 2,
                            borderRadius: '12px',
                            bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : '#ffffff',
                            border: `1px solid ${Ze.subtleBorder}`,
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              bgcolor: isDarkMode ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5',
                              borderColor: '#10b981',
                              transform: 'translateY(-1px)'
                            }
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                            <Avatar
                              sx={{
                                bgcolor: 'rgba(16, 185, 129, 0.15)',
                                color: '#34d399',
                                width: 34,
                                height: 34,
                                border: '1px solid rgba(16, 185, 129, 0.3)'
                              }}
                            >
                              <ScienceIcon sx={{ fontSize: 18 }} />
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="subtitle2" fontWeight="600" noWrap sx={{ color: Ze.text, fontSize: '13px' }}>
                                {tmpl.name}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Chip
                                  label={`${(tmpl.formula_rules || tmpl.rules || []).length} rules`}
                                  size="small"
                                  sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}
                                />
                                <Chip
                                  label={`Used ${tmpl.usage_count || 0}×`}
                                  size="small"
                                  sx={{ height: 18, fontSize: '10px', bgcolor: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}
                                />
                                <Typography variant="caption" sx={{ color: Ze.muted, fontSize: '10px' }}>
                                  {formatDisplayDate(tmpl.created_at || tmpl.created)}
                                </Typography>
                              </Box>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <UseButton
                              onClick={() => navigate('/upload', { state: { selectedTagTemplate: tmpl, smartTagFormulaRules: tmpl.formula_rules || tmpl.rules || [] } })}
                              label="Use"
                              size={30}
                              color="linear-gradient(135deg, #10b981 0%, #059669 100%)"
                              hoverColor="linear-gradient(135deg, #059669 0%, #047857 100%)"
                              glowColor="rgba(16, 185, 129, 0.45)"
                              title="Use Tag Template"
                            />
                            <DeleteActionButton
                              onClick={() => handleDeleteTagTemplate(tmpl.id)}
                              size={30}
                              title="Delete Tag Template"
                            />
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                    <TablePagination
                      component="div"
                      count={filteredTags.length}
                      page={tagPage}
                      onPageChange={(_, p) => setTagPage(p)}
                      rowsPerPage={tagRowsPerPage}
                      onRowsPerPageChange={(e) => { setTagRowsPerPage(parseInt(e.target.value, 10)); setTagPage(0); }}
                      rowsPerPageOptions={[5, 10, 25]}
                      sx={{ color: Ze.muted, fontSize: '12px', mt: 1, borderTop: `1px solid ${Ze.subtleBorder}` }}
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
