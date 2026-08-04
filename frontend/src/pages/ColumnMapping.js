import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import LoaderOverlay, { useGlobalBlock } from '../components/LoaderOverlay';
import ReactFlow, {
  ReactFlowProvider,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Trash2,
  RotateCcw,
  ArrowRight,
  Brain,
  CheckCircle,
  AlertCircle,
  FileText,
  Info,
  RefreshCw,
  Library,
  X,
  Settings,
  ArrowLeft,
  Edit3,
  Save,
  X as Cancel,
} from 'lucide-react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Button,
  Typography,
  Tooltip,
  Snackbar,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import api, { setGlobalLoaderCallback } from '../services/api';
import ExpandColumnGroupsDialog from '../components/ExpandColumnGroupsDialog';
import CarryForwardDialog from '../components/CarryForwardDialog';
import { useThemeContext } from '../utils/ThemeContext';
// Optional: lightweight import of synchronizer helpers later if needed
// import { getDataSynchronizer } from '../utils/DataSynchronizer';
// Inline helper functions to avoid module initialization issues
// const getFieldNumber - hoisted above as function declaration

// const isPairStartUpdated - hoisted above as function declaration

// const isPairEndUpdated - hoisted above as function declaration

// const getPairTypeUpdated - hoisted above as function declaration

// const getPairIndexUpdated - hoisted above as function declaration

// const getPairColorUpdated - hoisted above as function declaration

// const isOptionalFieldUpdated - hoisted above as function declaration

// const handleDeleteOptionalFieldUpdated - hoisted above as function declaration

// Helper function to generate template columns based on counts (matches backend logic)
const generateTemplateColumns = (tagsCount, specPairsCount, customerIdPairsCount, baseTemplateHeaders = null) => {
  // Always return internal header names; UI will handle display labels separately
  const columns = [];

  // Preserve non-dynamic base headers if provided
  if (baseTemplateHeaders && baseTemplateHeaders.length > 0) {
    const dynamicColumnPattern = /^(Tag_|Specification_Name_|Specification_Value_|Customer_Identification_Name_|Customer_Identification_Value_)\d+$/;
    columns.push(...baseTemplateHeaders.filter(h => !dynamicColumnPattern.test(h)));
  }

  // Tags: Tag_1..Tag_N
  for (let i = 1; i <= (tagsCount || 0); i++) {
    columns.push(`Tag_${i}`);
  }
  // Specification pairs
  for (let i = 1; i <= (specPairsCount || 0); i++) {
    columns.push(`Specification_Name_${i}`);
    columns.push(`Specification_Value_${i}`);
  }
  // Customer ID pairs
  for (let i = 1; i <= (customerIdPairsCount || 0); i++) {
    columns.push(`Customer_Identification_Name_${i}`);
    columns.push(`Customer_Identification_Value_${i}`);
  }
  
  return columns;
};

// Enhanced Professional Custom Node Component
const CustomNode = ({ data, id }) => {
  const isSource = id.startsWith('c-');
  const isConnected = data.isConnected;
  const confidence = data.confidence;
  const isSelected = data.isSelected;
  const isFromTemplate = data.isFromTemplate;
  const isSpecificationMapping = data.isSpecificationMapping;
  const hasDefaultValue = data.hasDefaultValue;
  const mappedToLabel = data.mappedToLabel || '';
  const mappedFromLabel = data.mappedFromLabel || '';
  const isOptional = data.isOptional || false;
  const onDelete = data.onDelete;
  const isDynamic = data.isDynamic || false;  // true for dynamically added columns (Tag_1, etc.)
  const isDark = data.isDarkMode || false;

  // Header editing state (for source nodes)
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(data.originalLabel || '');
  const isFromPDF = data.isFromPDF || false;
  const isCorrected = data.isCorrected || false;
  const onHeaderEdit = data.onHeaderEdit;

  // Header editing functions
  const handleEditStart = () => {
    setIsEditing(true);
    setEditValue(data.originalLabel || '');
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditValue(data.originalLabel || '');
  };

  const handleEditSave = () => {
    if (editValue.trim() && editValue.trim() !== data.originalLabel && onHeaderEdit) {
      onHeaderEdit(id, data.originalLabel, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleEditSave();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  // Pair grouping properties
  const isPairStart = data.isPairStart || false;
  const isPairEnd = data.isPairEnd || false;
  const pairType = data.pairType || 'single';
  const pairColor = data.pairColor || 'gray';
  const pairIndex = data.pairIndex || 0;
  
  // Get Tailwind color classes based on pair color
  const getColorClasses = (color) => {
    const colorMap = {
      blue: { bg: 'bg-blue-400', border: 'border-blue-400', text: 'text-blue-700', light: 'bg-blue-100' },
      green: { bg: 'bg-green-400', border: 'border-green-400', text: 'text-green-700', light: 'bg-green-100' },
      purple: { bg: 'bg-purple-400', border: 'border-purple-400', text: 'text-purple-700', light: 'bg-purple-100' },
      pink: { bg: 'bg-pink-400', border: 'border-pink-400', text: 'text-pink-700', light: 'bg-pink-100' },
      yellow: { bg: 'bg-yellow-400', border: 'border-yellow-400', text: 'text-yellow-700', light: 'bg-yellow-100' },
      indigo: { bg: 'bg-indigo-400', border: 'border-indigo-400', text: 'text-indigo-700', light: 'bg-indigo-100' },
      red: { bg: 'bg-red-400', border: 'border-red-400', text: 'text-red-700', light: 'bg-red-100' },
      teal: { bg: 'bg-teal-400', border: 'border-teal-400', text: 'text-teal-700', light: 'bg-teal-100' },
      orange: { bg: 'bg-orange-400', border: 'border-orange-400', text: 'text-orange-700', light: 'bg-orange-100' },
      cyan: { bg: 'bg-cyan-400', border: 'border-cyan-400', text: 'text-cyan-700', light: 'bg-cyan-100' },
      gray: { bg: 'bg-gray-400', border: 'border-gray-400', text: 'text-gray-700', light: 'bg-gray-100' }
    };
    return colorMap[color] || colorMap.gray;
  };
  
  const colorClasses = getColorClasses(pairColor);
  
  return (
    <div className={`
      relative group cursor-pointer transition-all duration-300 transform hover:scale-[1.02]
      ${isSource ? 'hover:translate-x-1' : 'hover:-translate-x-1'}
    `}>
      {/* Pair grouping visual indicators */}
      {!isSource && pairType !== 'single' && (
        <div className={`absolute -left-2 w-1 h-full rounded-l-lg ${colorClasses.bg} ${isPairStart ? 'rounded-tl-lg' : ''} ${isPairEnd ? 'rounded-bl-lg' : ''}`}></div>
      )}
      
      {/* Pair number indicator */}
      {!isSource && pairType !== 'single' && (
        <div className={`absolute -top-2 -left-2 w-6 h-6 rounded-full ${colorClasses.bg} text-white text-xs font-bold flex items-center justify-center shadow-lg`}>
          {pairIndex}
        </div>
      )}
      
      {/* Main node container */}
      <div className={`
        relative px-5 py-4 rounded-2xl border transition-all duration-300 shadow-[0_14px_35px_-24px_rgba(15,23,42,0.55)]
        w-[280px] text-center font-semibold text-sm min-h-[76px] flex items-center justify-center
        ${isSource 
            ? isDark
              ? `bg-gradient-to-br from-blue-950/85 via-slate-900 to-sky-950/75 border-blue-700/50 text-blue-50 
               hover:border-blue-500/70 hover:shadow-[0_20px_42px_-28px_rgba(59,130,246,0.55)]`
            : `bg-gradient-to-br from-blue-100 via-sky-50 to-cyan-50 border-blue-300 text-blue-950 
               hover:border-blue-400 hover:shadow-[0_20px_42px_-26px_rgba(37,99,235,0.65)]`
          : isDark
            ? `bg-gradient-to-br from-emerald-950/85 via-slate-900 to-teal-950/75 border-emerald-700/50 text-emerald-50 
               hover:border-emerald-500/70 hover:shadow-[0_20px_42px_-28px_rgba(16,185,129,0.55)]`
            : `bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-50 border-emerald-300 text-emerald-950 
               hover:border-emerald-400 hover:shadow-[0_20px_42px_-26px_rgba(16,185,129,0.65)]`
        }
        ${isConnected
          ? isSource
            ? isDark
              ? 'ring-1 ring-blue-400/50 shadow-[0_22px_48px_-32px_rgba(59,130,246,0.55)]'
              : 'ring-1 ring-blue-300/80 shadow-[0_22px_48px_-30px_rgba(37,99,235,0.42)]'
            : isDark
              ? 'ring-1 ring-emerald-400/50 shadow-[0_22px_48px_-32px_rgba(16,185,129,0.55)]'
              : 'ring-1 ring-emerald-300/80 shadow-[0_22px_48px_-30px_rgba(16,185,129,0.45)]'
          : ''}
        ${isSelected ? 'ring-2 ring-purple-500/70 scale-[1.02] shadow-xl' : ''}
        ${isFromTemplate ? 'ring-1 ring-emerald-400/55' : ''}
        ${isSpecificationMapping ? 'ring-1 ring-orange-400/55' : ''}
        ${!isSource && pairType !== 'single' ? 'ml-2' : ''}
      `}>
        
        {/* Connection handles - more visible */}
        {isSource && (
          <Handle
            type="source"
            position={Position.Right}
            className="w-4 h-4 bg-blue-600 border-3 border-white shadow-lg opacity-70 group-hover:opacity-100 transition-all duration-200 hover:scale-125"
          />
        )}
        {!isSource && (
          <Handle
            type="target"
            position={Position.Left}
            className="w-4 h-4 bg-emerald-600 border-3 border-white shadow-lg opacity-70 group-hover:opacity-100 transition-all duration-200 hover:scale-125"
          />
        )}
        
        {/* Node content */}
        <div className="px-3 break-words text-center leading-tight" title={data.displayLabel && data.displayLabel !== data.originalLabel ? `Stored as: ${data.originalLabel}` : data.originalLabel}>
          {/* Source node content with editing for PDF headers */}
          {isSource ? (
            <div className="relative">
              {isEditing ? (
                // Edit mode for source nodes
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  <div className="flex gap-1 justify-center">
                    <button
                      onClick={handleEditSave}
                      className="p-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                      title="Save changes"
                    >
                      <Save size={12} />
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="p-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                      title="Cancel editing"
                    >
                      <Cancel size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                // Display mode for source nodes
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2">
                    <span className={isCorrected ? 'font-semibold text-blue-700' : ''}>
                      {data.originalLabel}
                    </span>
                    {isFromPDF && (
                      <button
                        onClick={handleEditStart}
                        className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded transition-colors"
                        title="Edit header"
                      >
                        <Edit3 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Confidence score for PDF headers */}
                  {isFromPDF && confidence && (
                    <div className={`
                      px-2 py-0.5 rounded-full text-xs font-bold
                      ${confidence >= 0.8
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : confidence >= 0.6
                        ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                        : 'bg-red-100 text-red-700 border border-red-300'
                      }
                    `}>
                      {Math.round(confidence * 100)}%
                    </div>
                  )}

                  {/* Corrected indicator */}
                  {isCorrected && (
                    <div className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full border border-blue-300 font-semibold">
                      Corrected
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Target node content
            <>
              {data.displayLabel || data.originalLabel}
              {/* Source indicator badge - Template (from Excel) vs Dynamic (added via UI) */}
              <div className="mt-1 flex flex-wrap justify-center gap-1">
                {isDynamic ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-cyan-100 text-cyan-700 border border-cyan-300">
                    Dynamic
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                    Template
                  </span>
                )}
                {/* AT / FW badges */}
                {data.atBadge && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-amber-200 text-amber-800 border border-amber-400">
                    {data.atBadge}
                  </span>
                )}
                {data.fwBadge && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-purple-200 text-purple-800 border border-purple-400">
                    {data.fwBadge}
                  </span>
                )}
              </div>
              {/* Pair indicator for dynamic columns */}
              {pairType !== 'single' && (
                <div className={`text-xs mt-1 font-semibold ${colorClasses.text}`}>
                  {pairType === 'specification' ? `Spec ${pairIndex}` :
                   pairType === 'customer' ? `ID ${pairIndex}` :
                   pairType === 'tag' ? `Tag ${pairIndex}` : `${pairIndex}`}
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Status indicators */}
        {isConnected && (
          <div className={`absolute -top-3 -left-3 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center shadow-lg
            ${isSpecificationMapping ? 'bg-orange-500 animate-pulse' : isSource ? 'bg-blue-500' : 'bg-emerald-500'}
          `}>
            {isSpecificationMapping ? <Settings size={14} /> : isFromTemplate ? <Library size={14} /> : <CheckCircle size={14} />}
          </div>
        )}
        
        {/* Source node mapping indicator */}
        {isSource && isConnected && mappedFromLabel && mappedFromLabel.trim() !== '' && (
          <div className="absolute -bottom-3 right-3 max-w-[240px] truncate bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full font-extrabold shadow-lg shadow-blue-500/25">
            Map-{mappedFromLabel}
          </div>
        )}
        
        {/* Template indicator - Show Map-{Column Name} for manual/template mappings. A.Map reserved for AI */}
        {!isSource && !isSpecificationMapping && mappedToLabel && mappedToLabel.trim() !== '' && !data.isAiGenerated && (
          <div className="absolute -bottom-3 right-3 max-w-[240px] truncate bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-full font-extrabold shadow-lg shadow-emerald-500/25">
            Map-{mappedToLabel}
          </div>
        )}
        
        {/* AI mapping indicator - Show A.Map-{Column Name} when auto-mapped */}
        {(isSpecificationMapping || data.isAiGenerated) && mappedToLabel && mappedToLabel.trim() !== '' && (
          <div className="absolute -bottom-3 right-3 max-w-[240px] truncate bg-orange-500 text-white text-xs px-3 py-1.5 rounded-full font-extrabold shadow-lg shadow-orange-500/25">
            A.Map-{mappedToLabel}
          </div>
        )}
        
        {/* Default value indicator for template fields */}
        {!isSource && hasDefaultValue && (
          <div className="absolute -bottom-3 right-3 max-w-[240px] truncate bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full font-extrabold shadow-lg shadow-blue-500/25">
            Default: {data.defaultValue}
          </div>
        )}
        
        {/* FactWise ID formula indicator */}
        {!isSource && data.factwiseFormula && (
          <div className="absolute -bottom-3 right-3 max-w-[240px] truncate bg-purple-600 text-white text-xs px-3 py-1.5 rounded-full font-extrabold shadow-lg shadow-purple-500/25">
            {data.factwiseFormula}
          </div>
        )}
        
        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute inset-0 rounded-xl border-3 border-purple-500 bg-purple-100 bg-opacity-30 pointer-events-none animate-pulse">
            <div className="absolute -top-2 -right-2 bg-purple-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
              Selected
            </div>
          </div>
        )}
        
        {/* Hover effect overlay */}
        <div className="absolute inset-0 rounded-xl bg-white bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 pointer-events-none"></div>
        {/* Dynamic field delete button (template side only) */}
        {!isSource && isOptional && isDynamic && (
          <button
            type="button"
            title="Delete added field"
            className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md opacity-80 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              if (typeof onDelete === 'function') onDelete(id);
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      
      {/* Confidence indicator - positioned outside the node on the right */}
      {confidence && !isSource && (
        <div className="absolute -right-20 top-1/2 transform -translate-y-1/2 z-20">
          <div className={`
            px-3 py-1 rounded-full text-xs font-bold shadow-lg border-2 border-white
            ${confidence >= 0.8 
              ? 'bg-gradient-to-r from-green-400 to-green-600 text-white' 
              : confidence >= 0.6 
              ? 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-white'
              : 'bg-gradient-to-r from-red-400 to-red-600 text-white'
            }
          `}>
            {Math.round(confidence)}%
          </div>
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode
};

const AnimatedMenuGlyph = ({ open = false, stroke = 'currentColor' }) => (
  <svg
    viewBox="0 0 32 32"
    aria-hidden="true"
    className={`h-5 w-5 transition-transform duration-500 ease-out ${open ? '-rotate-45' : ''}`}
  >
    <path
      d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
      fill="none"
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
      style={{
        strokeDasharray: open ? '20 300' : '12 63',
        strokeDashoffset: open ? -32.42 : 0,
        transition: 'stroke-dasharray 500ms cubic-bezier(0.4, 0, 0.2, 1), stroke-dashoffset 500ms cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    />
    <path
      d="M7 16 27 16"
      fill="none"
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
    />
  </svg>
);

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const getFlowLayout = () => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1366;
  const hasLeftStatsRail = viewportWidth >= 1280;
  const leftStatsRailWidth = hasLeftStatsRail ? 340 : 0;
  const availableWidth = Math.max(720, viewportWidth - leftStatsRailWidth);
  const defaultZoom = 0.9;
  const nodeWidth = 280;
  const nodeHeight = 86;
  const nodeSpacing = 34;
  const startY = 52;
  const laneGap = clampNumber(Math.round(availableWidth * 0.24), 360, 560);
  const workflowWidth = nodeWidth * 2 + laneGap;
  const sourceX = Math.max(32, Math.round(((availableWidth / defaultZoom) - workflowWidth) / 2));

  return {
    defaultZoom,
    nodeWidth,
    nodeHeight,
    nodeSpacing,
    startY,
    laneGap,
    workflowWidth,
    sourceX,
    targetX: sourceX + nodeWidth + laneGap
  };
};

export default function ColumnMapping() {
  const { isDarkMode } = useThemeContext();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Global loading state
  const [globalLoading, setGlobalLoading] = useState(false);
  
  // Action-specific loading states
  const [mappingActionLoading, setMappingActionLoading] = useState(false);
  const [defaultValueLoading, setDefaultValueLoading] = useState(false);
  const [columnCountLoading, setColumnCountLoading] = useState(false);
  
  // Mapping counter for loader frequency control
  const mappingCounterRef = useRef(0);
  
  // Helper function to determine if we should show loader (every 3rd mapping)
  const shouldShowMappingLoader = () => {
    mappingCounterRef.current += 1;
    return mappingCounterRef.current % 3 === 0;
  };
  
  // Helper function to reset mapping counter
  const resetMappingCounter = () => {
    mappingCounterRef.current = 0;
  };
  
  // Setup global loader callback
  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);
  
  // State for real data
  const [clientHeaders, setClientHeaders] = useState([]);
  const [templateHeaders, setTemplateHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  useGlobalBlock(globalLoading || loading || mappingActionLoading);
  const [error, setError] = useState(null);
  const [sessionMetadata, setSessionMetadata] = useState({});

  // Header correction state management
  const [headerCorrections, setHeaderCorrections] = useState({}); // { originalHeader: correctedHeader }
  const [headerConfidenceScores, setHeaderConfidenceScores] = useState({}); // { header: confidence }
  const [isFromPDF, setIsFromPDF] = useState(false);
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const [mappingHistory, setMappingHistory] = useState([]);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [selectedSourceNode, setSelectedSourceNode] = useState(null);
  
  // Auto mapping state
  const [isAutoMapping, setIsAutoMapping] = useState(false);
  const [showAutoMapConfirm, setShowAutoMapConfirm] = useState(false);
  
  // Review state
  const [isReviewing, setIsReviewing] = useState(false);
  const [isProcessingMappings, setIsProcessingMappings] = useState(false); // 🔥 FAST NAVIGATION FIX

  // Default value popup state
  const [showDefaultValueDialog, setShowDefaultValueDialog] = useState(false);
  const [selectedTemplateField, setSelectedTemplateField] = useState(null);
  const [defaultValueText, setDefaultValueText] = useState('');
  const [defaultValueMappings, setDefaultValueMappings] = useState({});
  // Conditional default-value rules ({ fieldName: {column, operator, compare, then, else} })
  const [defaultValueRules, setDefaultValueRules] = useState({});
  const [dvMode, setDvMode] = useState('always'); // 'always' | 'conditional'
  const [dvCondCol, setDvCondCol] = useState('');
  const [dvCondOp, setDvCondOp] = useState('is_empty');
  const [dvCondCompare, setDvCondCompare] = useState('');
  const [dvThen, setDvThen] = useState('');
  const [dvElse, setDvElse] = useState('');
  const suppressRestoreRef = useRef(false);
  
  // Navigation protection states
  const [showNavigationConfirm, setShowNavigationConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  
  // Rebuild guard ref
  const isRebuildingRef = useRef(false);
  // Persistent cache of mappings (internal names) for reliable restore/guards
  const mappingsCacheRef = useRef([]);
  const loadDataRef = useRef(null);
  const suppressedVirtualsRef = useRef(new Set());
  // Track if auto-apply has been triggered to prevent loops
  const autoApplyTriggeredRef = useRef(false);
  
  // Rebuild state
  const [isRebuilding, setIsRebuilding] = useState(false);
  
  // ENHANCED: Template applied state with comprehensive tracking
  const [templateApplied, setTemplateApplied] = useState(false);
  const [appliedTemplateName, setAppliedTemplateName] = useState('');
  const [templateMappingCount, setTemplateMappingCount] = useState(0);
  const [originalTemplateId, setOriginalTemplateId] = useState(null);
  const [templateSuccess, setTemplateSuccess] = useState(false);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Snackbar state for user feedback
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'info'
  });

  function showSnackbar(message, severity = 'info') {
    setSnackbar({ open: true, message, severity });
  }

  function closeSnackbar() {
    setSnackbar({ open: false, message: '', severity: 'info' });
  }

  // Specification handling state
  // COMMENTED OUT: Specification overflow state
  // const [specificationOverflow, setSpecificationOverflow] = useState(null);
  // const [showSpecOverflowAlert, setShowSpecOverflowAlert] = useState(false);
  const [specificationMappingsApplied, setSpecificationMappingsApplied] = useState(false);

  // Template application state
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  // Primary-key cleanup at the Review step: pick a mapped column and drop rows
  // where it's empty. Runs for every source type (Excel, OCR, PDF zonal).
  const [primaryDialogOpen, setPrimaryDialogOpen] = useState(false);
  const [primaryKeyColumn, setPrimaryKeyColumn] = useState('');
  const [primaryKeyOptions, setPrimaryKeyOptions] = useState([]);
  const [primaryKeySources, setPrimaryKeySources] = useState({});
  const [primaryCleaning, setPrimaryCleaning] = useState(false);
  // How many rows the chosen key column is empty on, out of the total — shown
  // in the cleanup dialog so the user sees the impact before removing anything.
  const [primaryEmptyInfo, setPrimaryEmptyInfo] = useState(null); // { empty, total } | null
  const [primaryEmptyLoading, setPrimaryEmptyLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState(null);
  const [syncNotice, setSyncNotice] = useState({ visible: false, message: 'Applying template... syncing latest changes...' });

  // When the cleanup dialog is open and a key column is chosen, count how many
  // rows are empty on it (out of the total) so the dialog can show the impact.
  useEffect(() => {
    if (!primaryDialogOpen || !primaryKeyColumn || !sessionId) {
      setPrimaryEmptyInfo(null);
      return;
    }
    let cancelled = false;
    setPrimaryEmptyLoading(true);
    api.requiredFieldReport(sessionId, [primaryKeyColumn])
      .then((res) => {
        if (cancelled) return;
        const d = (res && res.data) || {};
        const gap = (d.gaps || []).find((g) => g.field === primaryKeyColumn);
        setPrimaryEmptyInfo({ empty: gap ? gap.emptyCount : 0, total: d.total_rows || 0 });
      })
      .catch(() => { if (!cancelled) setPrimaryEmptyInfo(null); })
      .finally(() => { if (!cancelled) setPrimaryEmptyLoading(false); });
    return () => { cancelled = true; };
  }, [primaryDialogOpen, primaryKeyColumn, sessionId]);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [statusPolling, setStatusPolling] = useState(false);
  const [rebuildingColumns, setRebuildingColumns] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [flowLayoutTick, setFlowLayoutTick] = useState(0);

  // Persisted session metadata for formula/factwise re-application during fast review
  const formulaRulesRef = useRef([]);
  const factwiseRulesRef = useRef([]);

  // Mapping statistics
  const [mappingStats, setMappingStats] = useState({
    total: 0,
    manual: 0,
    ai: 0,
    template: 0,
    specification: 0,
    confidence: { high: 0, medium: 0, low: 0 }
  });

  // Column count state
  const [columnCounts, setColumnCounts] = useState({
    tags_count: 1,
    spec_pairs_count: 1,
    customer_id_pairs_count: 1
  });
  const [templateColumns, setTemplateColumns] = useState([]);
  const [useDynamicTemplate, setUseDynamicTemplate] = useState(false);
  const [clientFileName, setClientFileName] = useState('');
  const [expandDialogOpen, setExpandDialogOpen] = useState(false);
  const [carryForwardOpen, setCarryForwardOpen] = useState(false);
  // Set true right before a transform-triggered reload, so the "unsaved changes"
  // guard doesn't prompt on a refresh we intended.
  const bypassUnloadGuardRef = useRef(false);
  const [templateFileName, setTemplateFileName] = useState('');
  const [templateOptionals, setTemplateOptionals] = useState([]);
  const [isInitializingMappings, setIsInitializingMappings] = useState(true);
  const isInitializingRef = useRef(true);
  
  // Template version tracking for UI readiness
  const [templateVersion, setTemplateVersion] = useState(0);
  const [expectedTemplateVersion, setExpectedTemplateVersion] = useState(0);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let resizeTimer = null;
    const recenterFlow = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const layout = getFlowLayout();
        setFlowLayoutTick(v => v + 1);
        setNodes(currentNodes => currentNodes.map(node => {
          const index = Number.isFinite(node.data?.index) ? node.data.index : 0;
          const isSourceNode = node.id.startsWith('c-');
          return {
            ...node,
            position: {
              x: isSourceNode ? layout.sourceX : layout.targetX,
              y: layout.startY + index * (layout.nodeHeight + layout.nodeSpacing)
            },
            style: {
              ...node.style,
              width: layout.nodeWidth,
              height: layout.nodeHeight
            }
          };
        }));
      }, 120);
    };

    window.addEventListener('resize', recenterFlow);
    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', recenterFlow);
    };
  }, [setNodes]);

  useEffect(() => {
    setNodes(currentNodes => currentNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        isDarkMode
      }
    })));
  }, [isDarkMode, setNodes]);
  
  // Existing mappings and default values state
  const [existingMappings, setExistingMappings] = useState([]);
  const [existingDefaultValues, setExistingDefaultValues] = useState({});

  // Debug helpers
  function debugLog(...args) {
    try {
      // eslint-disable-next-line no-console
    } catch (_) {}
  }
  function warnLog(...args) {
    try {
      // eslint-disable-next-line no-console
      console.warn('🟨 CM', new Date().toISOString(), ...args);
    } catch (_) {}
  }
  function errorLog(...args) {
    try {
      // eslint-disable-next-line no-console
      console.error('🔴 CM', new Date().toISOString(), ...args);
    } catch (_) {}
  }
  
  const hasMeaningfulHistory = useCallback(() => {
    if (!mappingHistory || mappingHistory.length === 0) return false;
    const last = mappingHistory[mappingHistory.length - 1];
    if (!last || !Array.isArray(last.edges) || !Array.isArray(edges)) return false;
    if (last.edges.length !== edges.length) return true;

    try {
      const curPairs = new Set(edges.map(e => `${e.source}->${e.target}`));
      for (const e of last.edges) {
        if (!curPairs.has(`${e.source}->${e.target}`)) return true;
      }
    } catch (_) {}

    return false;
  }, [mappingHistory, edges]);

  // Header correction functions
  const handleHeaderEdit = useCallback((nodeId, originalHeader, correctedHeader) => {

    // Update header corrections state
    setHeaderCorrections(prev => ({
      ...prev,
      [originalHeader]: correctedHeader
    }));

    // Find all edges connected to this header (source node)
    const affectedEdges = edges.filter(edge => edge.source === nodeId);

    // Remove mappings for the edited header
    const remainingEdges = edges.filter(edge => edge.source !== nodeId);

    // Update edges state
    setEdges(remainingEdges);

    // Update source node label and mark as corrected
    setNodes(prev => prev.map(node => {
      if (node.id === nodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            label: correctedHeader,
            originalLabel: correctedHeader, // Update the displayed label
            isConnected: false, // Reset connection status
            mappedToLabel: '', // Clear mapped label
            isCorrected: true // Mark as manually corrected
          }
        };
      }
      return node;
    }));

    // Update client headers array
    setClientHeaders(prev => prev.map(header =>
      header === originalHeader ? correctedHeader : header
    ));

  }, [edges, setEdges, setNodes]);

  // Get effective headers (with corrections applied)
  const getEffectiveClientHeaders = useCallback(() => {
    return clientHeaders.map(header => headerCorrections[header] || header);
  }, [clientHeaders, headerCorrections]);

  // Debug panel removed; keep lightweight console logging only

  // Template functions
  const loadAvailableTemplates = useCallback(async () => {
    try {
      setTemplatesLoading(true);
      const response = await api.getMappingTemplates();
      if (response.data.success) {
        setAvailableTemplates(response.data.templates || []);
      } else {
        showSnackbar('Failed to load templates', 'error');
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      showSnackbar('Failed to load templates', 'error');
    } finally {
      setTemplatesLoading(false);
    }
  }, [showSnackbar]);

  // Export a saved template to a portable .fwtemplate.json file (to move it to
  // another environment), and import one back in.
  const templateImportInputRef = useRef(null);

  const handleExportTemplate = useCallback(async (template) => {
    try {
      await api.exportMappingTemplate(template.id, template.name);
      showSnackbar(`Exported "${template.name}"`, 'success');
    } catch (e) {
      showSnackbar('Could not export template', 'error');
    }
  }, [showSnackbar]);

  const handleImportTemplateFile = useCallback(async (event) => {
    const file = event.target.files && event.target.files[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    try {
      const resp = await api.importMappingTemplate(file);
      if (resp.data?.success) {
        showSnackbar(resp.data.message || 'Template imported', 'success');
        await loadAvailableTemplates();
      } else {
        showSnackbar(resp.data?.error || 'Import failed', 'error');
      }
    } catch (e) {
      showSnackbar(e.response?.data?.error || 'Could not import template', 'error');
    }
  }, [showSnackbar, loadAvailableTemplates]);

  const handleApplyTemplate = useCallback(async (template) => {
    try {
      setApplyingTemplate(true);
      setApplyingTemplateId(template.id);
      setSyncNotice({ visible: true, message: 'Applying template… syncing latest changes…' });
      // [TAGFLOW] Frontend apply start
      enhancedDebugLog('TEMPLATE_APPLY', 'Starting template application', {
        templateId: template.id,
        templateName: template.name,
        sessionId
      });

      // Capture current template version for bounded freshness wait
      let prevVersion = 0;
      try {
        const status = await api.getSessionStatus(sessionId);
        prevVersion = status.data?.template_version ?? 0;
      } catch (_) {}

      const opStart = Date.now();
      // Apply the template
      const response = await api.applyMappingTemplate(sessionId, template.id);

      if (response.data.success) {
        enhancedDebugLog('TEMPLATE_APPLY', 'Template applied successfully on backend', {
          response: response.data,
          sessionId
        });

        // Update local state with template information
        setTemplateApplied(true);
        setAppliedTemplateName(template.name);
        setOriginalTemplateId(template.id);
        setTemplateMappingCount(
          Array.isArray(response.data.mappings_new_format)
            ? response.data.mappings_new_format.length
            : (response.data.total_mapped || 0)
        );

        // Persist formula rules and counts to session metadata for Tag arrows and drawer
        try {
          setSessionMetadata(prev => ({
            ...(prev || {}),
            formula_rules: Array.isArray(response.data.formula_rules) ? response.data.formula_rules : [],
            column_counts: response.data.column_counts || (prev?.column_counts || {}),
            template_applied: true,
            original_template_id: template.id,
            template_name: template.name
          }));
        } catch (_) {}

        // CRITICAL FIX: Update template headers immediately if provided to prevent mapping restoration issues
        if (response.data.enhanced_headers && Array.isArray(response.data.enhanced_headers)) {
          enhancedDebugLog('TEMPLATE_APPLY', 'Updating template headers from template response', {
            newHeaders: response.data.enhanced_headers,
            previousCount: templateHeaders.length,
            newCount: response.data.enhanced_headers.length
          });
          setTemplateHeaders(response.data.enhanced_headers);
          setTemplateColumns(response.data.enhanced_headers);
          setUseDynamicTemplate(true);
        }

        // If formula rules exist, immediately materialize them so Tag_N values appear without manual apply
        try {
          const rules = Array.isArray(response?.data?.formula_rules) ? response.data.formula_rules : (template.formula_rules || []);
          if (rules && rules.length > 0) {
            // Let DataEditor materialize after navigation; but also try to materialize here if in session
            // Best-effort apply; ignore failures and continue
            try {
              // CRITICAL FIX: Get current mappings to send with formula apply
              let currentMappings = null;
              try {
                const mappingsResponse = await api.getExistingMappings(sessionId);
                if (mappingsResponse.data && mappingsResponse.data.mappings) {
                  const mappingsData = mappingsResponse.data.mappings;
                  if (mappingsData.mappings && Array.isArray(mappingsData.mappings)) {
                    currentMappings = mappingsData.mappings;
                  } else if (Array.isArray(mappingsData)) {
                    currentMappings = mappingsData;
                  }
                }
              } catch (err) {
                console.warn('[TAGFLOW][FE] Could not fetch mappings:', err);
              }
              await api.applyFormulas(sessionId, rules, currentMappings);
            } catch (e) {
            }
          }
        } catch (_) {}

        // Load default values if available
        if (response.data.default_value_rules) {
          setDefaultValueRules(response.data.default_value_rules || {});
        }
        if (response.data.default_values) {
          setExistingDefaultValues(response.data.default_values);
          // CRITICAL: Also store in defaultValueMappings for UI integration
          setDefaultValueMappings(response.data.default_values);
          enhancedDebugLog('TEMPLATE_APPLY', 'Loaded default values from template', {
            defaultValues: response.data.default_values
          });
        }

        // CRITICAL FIX: Get client headers from response early for both paths
        let clientHeadersFromResponse = clientHeaders;
        if (response.data.client_headers && Array.isArray(response.data.client_headers) && response.data.client_headers.length > 0) {
          clientHeadersFromResponse = response.data.client_headers;
          setClientHeaders(clientHeadersFromResponse);
          enhancedDebugLog('TEMPLATE_APPLY', 'Updated client headers from response', {
            clientHeaders: clientHeadersFromResponse
          });
        }

        // CRITICAL FIX: Update column counts FIRST, then apply mappings after rebuild completes
        if (response.data.column_counts) {
          enhancedDebugLog('TEMPLATE_APPLY', 'Updating column counts from template', {
            columnCounts: response.data.column_counts
          });

          // Prepare data for after rebuild
          const headersToUse = response.data.enhanced_headers || templateHeaders;
          const defaultValuesToUse = response.data.default_values || {};
          let mappingsToApply = response.data.mappings_new_format || [];

          // If no new format mappings, convert old format
          if (mappingsToApply.length === 0 && response.data.mappings) {
            if (typeof response.data.mappings === 'object') {
              mappingsToApply = Object.entries(response.data.mappings).map(([target, source]) => ({
                source,
                target
              }));
            }
          }

          // If still no mappings, try loading from backend as fallback
          if (mappingsToApply.length === 0) {
            try {
              const mappingsResult = await checkExistingMappings(clientHeadersFromResponse, headersToUse, null);
              mappingsToApply = mappingsResult?.mappings || [];
            } catch (error) {
              console.warn('Error loading mappings fallback:', error);
            }
          }

          // Store data to apply after rebuild completes
          const dataToApplyAfterRebuild = {
            mappings: mappingsToApply,
            headers: headersToUse,
            clientHeaders: clientHeadersFromResponse,
            defaultValues: defaultValuesToUse
          };
          
          // Use the backend-returned headers directly. The generic column-count
          // rebuild has its own restore pass and can overwrite freshly applied
          // template mappings with stale/fuzzy matches.
          setColumnCounts(response.data.column_counts);
          if (headersToUse && headersToUse.length > 0) {
            setTemplateHeaders(headersToUse);
            setTemplateColumns(headersToUse);
            setUseDynamicTemplate(true);
            const factwiseRules = sessionMetadata?.factwise_rules || [];
            initializeNodes(clientHeadersFromResponse, headersToUse, null, factwiseRules, defaultValuesToUse, setIsInitializingMappings);
          }
          
          // CRITICAL FIX: Apply mappings and ensure default values after rebuild is complete
          setTimeout(() => {
            try {
              // First, ensure default values are applied to nodes
              if (Object.keys(dataToApplyAfterRebuild.defaultValues).length > 0) {
                setNodes(currentNodes => currentNodes.map(node => {
                  if (!node.id.startsWith('t-')) return node; // Only update template nodes

                  const fieldName = node.data.originalLabel;
                  if (dataToApplyAfterRebuild.defaultValues[fieldName]) {
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        hasDefaultValue: true,
                        defaultValue: dataToApplyAfterRebuild.defaultValues[fieldName]
                      }
                    };
                  }
                  return node;
                }));
              }

              // Then apply mappings - CRITICAL: Use clientHeaders from dataToApplyAfterRebuild
              if (dataToApplyAfterRebuild.mappings.length > 0) {
                console.log('🔧 PDF Template Fix: Applying mappings with client headers', {
                  mappings: dataToApplyAfterRebuild.mappings,
                  clientHeaders: dataToApplyAfterRebuild.clientHeaders,
                  templateHeaders: dataToApplyAfterRebuild.headers
                });
                applyExistingMappingsToFlow(
                  dataToApplyAfterRebuild.mappings,
                  dataToApplyAfterRebuild.clientHeaders,
                  dataToApplyAfterRebuild.headers,
                  null
                );
              } else {
                // If no mappings to restore and this is a column count update, clear the flag
                sessionStorage.removeItem('recentColumnCountUpdate');
              }
            } catch (error) {
              console.error('Error applying template data:', error);
            }
          }, 300); // Wait for rebuild timeouts (100 + 100 + buffer)
        } else {
          // No column counts change - apply mappings immediately
          enhancedDebugLog('TEMPLATE_APPLY', 'No column counts, applying mappings directly', {});

          const headersToUse = response.data.enhanced_headers || templateHeaders;
          let mappingsToApply = response.data.mappings_new_format || [];

          // If no new format mappings, convert old format
          if (mappingsToApply.length === 0 && response.data.mappings) {
            if (typeof response.data.mappings === 'object') {
              mappingsToApply = Object.entries(response.data.mappings).map(([target, source]) => ({
                source,
                target
              }));
            }
          }

          // Apply mappings directly
          if (mappingsToApply.length > 0) {
            console.log('🔧 PDF Template Fix: Applying mappings directly (no column count change)', {
              mappings: mappingsToApply,
              clientHeaders: clientHeadersFromResponse,
              templateHeaders: headersToUse
            });
            applyExistingMappingsToFlow(mappingsToApply, clientHeadersFromResponse, headersToUse, null);
          }
        }

        // Wait briefly for backend version to advance (bounded to ~3s total)
        try {
          await api.waitUntilFresh(sessionId, prevVersion, 3000);
        } catch (_) { /* proceed */ }

        // Ensure a minimum loader time of ~3s for consistent UX
        const elapsed = Date.now() - opStart;
        if (elapsed < 3000) {
          await new Promise(r => setTimeout(r, 3000 - elapsed));
        }

        showSnackbar(`Template "${template.name}" applied successfully!`, 'success');

        // After applying template, validate Tag/Factwise readiness on Azure
        try {
          const rules = Array.isArray(response?.data?.formula_rules) ? response.data.formula_rules : (sessionMetadata?.formula_rules || []);
          const hasTagRules = Array.isArray(rules) && rules.some(r => (r?.column_type || 'Tag') === 'Tag');
          const hasFactwise = Array.isArray(sessionMetadata?.factwise_rules) && sessionMetadata.factwise_rules.some(r => r?.type === 'factwise_id');

          // Proactively apply formula rules once if present
          if (hasTagRules) {
            try {
              // CRITICAL FIX: Get current mappings to send with formula apply
              let currentMappings = null;
              try {
                const mappingsResponse = await api.getExistingMappings(sessionId);
                if (mappingsResponse.data && mappingsResponse.data.mappings) {
                  const mappingsData = mappingsResponse.data.mappings;
                  if (mappingsData.mappings && Array.isArray(mappingsData.mappings)) {
                    currentMappings = mappingsData.mappings;
                  } else if (Array.isArray(mappingsData)) {
                    currentMappings = mappingsData;
                  }
                }
              } catch (err) { /* ignore */ }
              await api.applyFormulas(sessionId, rules, currentMappings);
            } catch (_) { /* non-fatal */ }
          }

          const hdrs = response?.data?.enhanced_headers || templateHeaders;
          await waitForReviewReadiness({
            sessionId,
            templateHeaders: hdrs,
            expectFormulas: hasTagRules,
            formulaRules: hasTagRules ? rules : [],
            enforceFactwiseFilled: hasFactwise
          });
        } catch (e) {
          console.warn('Post-template readiness check skipped/failed:', e?.message || e);
        }

        // Update template version to mark template application completion
        setTemplateVersion(prev => prev + 1);
        setExpectedTemplateVersion(prev => prev + 1);

        enhancedDebugLog('TEMPLATE_APPLY', 'Template application completed successfully', {
          templateName: template.name,
          totalMapped: response.data.total_mapped || 0
        });
      } else {
        showSnackbar(response.data.error || 'Failed to apply template', 'error');
      }
    } catch (error) {
      enhancedDebugLog('TEMPLATE_APPLY', 'Template application failed', {
        error: error.message,
        templateName: template.name,
        sessionId
      });
      console.error('Error applying template:', error);
      showSnackbar('Failed to apply template', 'error');
    } finally {
      setApplyingTemplate(false);
      setApplyingTemplateId(null);
      setSyncNotice(prev => ({ ...prev, visible: false }));
      setShowTemplateDialog(false);
    }
  }, [sessionId, showSnackbar]);

  // STATUS HUD: Poll session status every 5s to show live template version
  useEffect(() => {
    let timer = null;
    let mounted = true;
    const poll = async () => {
      if (!sessionId) return;
      try {
        setStatusPolling(true);
        const status = await api.getSessionStatus(sessionId);
        if (mounted && status?.data?.success) {
          setSessionVersion(status.data.template_version ?? 0);
        }
      } catch (_) {
        // ignore
      } finally {
        if (mounted) setStatusPolling(false);
      }
    };
    poll();
    timer = setInterval(poll, 5000);
    return () => { mounted = false; if (timer) clearInterval(timer); };
  }, [sessionId]);
  // Save Template removed from Column Mapping


  // Rebuild Columns (bulk action) — regenerates canonical headers based on current counts
  const handleRebuildColumns = useCallback(async () => {
    try {
      setRebuildingColumns(true);
      const opStart = Date.now();
      const resp = await api.rebuildTemplate(sessionId);
      // Wait to ensure consistent loader time
      const elapsed = Date.now() - opStart;
      if (elapsed < 3000) await new Promise(r => setTimeout(r, 3000 - elapsed));
      if (resp?.data?.success) {
        showSnackbar('Template columns rebuilt successfully', 'success');
        // Reload full state
        try { if (loadDataRef.current) await loadDataRef.current(); } catch (_) {}
      } else {
        showSnackbar(resp?.data?.error || 'Failed to rebuild columns', 'error');
      }
    } catch (e) {
      showSnackbar('Failed to rebuild columns', 'error');
    } finally {
      setRebuildingColumns(false);
    }
  }, [sessionId]);
  
  function enhancedDebugLog(category, message, data = null) {
    // Lightweight debug: console only (panel removed)
    debugLog(`[${category}]`, message, data);
  }

  // C) Reconcile edges with current nodes (universal safety net)
  function reconcileEdgesWithNodes() {
    // eslint-disable-next-line no-console
    
    // Build set of current node IDs
    const currentNodeIds = new Set(nodes.map(n => n.id));
    
    // Drop orphan edges
    const validEdges = edges.filter(edge => {
      const isValid = currentNodeIds.has(edge.source) && currentNodeIds.has(edge.target);
      if (!isValid) {
        // eslint-disable-next-line no-console
      }
      return isValid;
    });
    
    if (validEdges.length !== edges.length) {
      setEdges(validEdges);
    }
    
    // Recompute node states
    setTimeout(() => {
      setNodes(currentNodes => currentNodes.map(node => {
        const isConnected = validEdges.some(edge => 
          edge.source === node.id || edge.target === node.id
        );
        
        if (isConnected) {
          // Aggregate mapping labels across all edges for this node
          let mappedToLabel = '';
          let mappedFromLabel = '';

          if (node.id.startsWith('c-')) {
            const connectedEdges = validEdges.filter(e => e.source === node.id);
            const targetLabels = connectedEdges.map(e => {
              const t = currentNodes.find(n => n.id === e.target);
              return t?.data?.originalLabel;
            }).filter(Boolean);
            mappedFromLabel = targetLabels.join(', ');
          } else if (node.id.startsWith('t-')) {
            const connectedEdges = validEdges.filter(e => e.target === node.id);
            const sourceLabels = connectedEdges.map(e => {
              const s = currentNodes.find(n => n.id === e.source);
              return s?.data?.originalLabel;
            }).filter(Boolean);
            mappedToLabel = sourceLabels.join(', ');
          }

          return {
            ...node,
            data: {
              ...node.data,
              isConnected,
              mappedToLabel,
              mappedFromLabel
            }
          };
        }

        return {
          ...node,
          data: {
            ...node.data,
            isConnected: false,
            mappedToLabel: '',
            mappedFromLabel: ''
          }
        };
      }));
    }, 50);
  }

  // HOISTED FUNCTIONS TO AVOID TDZ ERRORS

  // Check for existing mappings and session metadata
  async function checkExistingMappings(clientHdrs, templateHdrs, setIsInitializingMappings = null) {
    try {
      enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Starting existing mappings check', { 
        sessionId, 
        currentCacheCount: mappingsCacheRef.current?.length || 0 
      });
      
      debugLog('Checking existing mappings...');
      const response = await api.getExistingMappings(sessionId);
      
      enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Backend response received', {
        success: response.data?.success,
        hasMappings: !!response.data?.mappings,
        hasDefaultValues: !!response.data?.default_values,
        hasSessionMetadata: !!response.data?.session_metadata,
        responseKeys: Object.keys(response.data || {})
      });
      
      if (response.data.success) {
        const { mappings, default_values, default_value_rules, session_metadata } = response.data;
        if (default_value_rules && typeof default_value_rules === 'object') {
          setDefaultValueRules(default_value_rules);
        }
        
        enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Processing successful response', {
          mappingsType: typeof mappings,
          mappingsKeys: mappings ? Object.keys(mappings) : null,
          mappingsIsArray: Array.isArray(mappings),
          defaultValuesType: typeof default_values,
          defaultValuesKeys: default_values ? Object.keys(default_values) : null,
          sessionMetadataKeys: session_metadata ? Object.keys(session_metadata) : null
        });
        
        // Store session metadata for badge display and other features
        setSessionMetadata(session_metadata);

        // Check if this session is from PDF and set confidence scores
        if (session_metadata.is_from_pdf) {
          setIsFromPDF(true);

          // Set header confidence scores if available in session metadata
          if (session_metadata.header_confidence_scores) {
            setHeaderConfidenceScores(session_metadata.header_confidence_scores);
          } else {
          }
        } else {
        }


        // Restore header corrections if they exist
        if (session_metadata.header_corrections && Object.keys(session_metadata.header_corrections).length > 0) {
          setHeaderCorrections(session_metadata.header_corrections);

          // Update client headers to show corrected headers
          setClientHeaders(prev => prev.map(header =>
            session_metadata.header_corrections[header] || header
          ));

          // Update nodes to reflect corrected headers
          setNodes(prev => prev.map(node => {
            if (node.id.startsWith('c-')) {
              const originalHeader = node.data.originalLabel;
              const correctedHeader = session_metadata.header_corrections[originalHeader];
              if (correctedHeader) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    label: correctedHeader,
                    originalLabel: correctedHeader,
                    isCorrected: true
                  }
                };
              }
            }
            return node;
          }));
        }

        try {
          // Persist formula + factwise rules for robust re-application during fast Review
          const fRules = Array.isArray(session_metadata?.formula_rules) ? session_metadata.formula_rules : [];
          const fwRules = Array.isArray(session_metadata?.factwise_rules) ? session_metadata.factwise_rules : [];
          formulaRulesRef.current = fRules;
          factwiseRulesRef.current = fwRules;
        } catch (_) {}
        
        // CRITICAL: Populate mappings cache for restoration during rebuilds
        if (mappings && mappings.mappings && Array.isArray(mappings.mappings)) {
          const normalizedMappings = mappings.mappings.map(m => ({
            source: m.source,
            target: m.target
          }));
          mappingsCacheRef.current = normalizedMappings;
          
          enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Populated cache from nested mappings', {
            originalCount: mappings.mappings.length,
            normalizedCount: normalizedMappings.length,
            sampleMappings: normalizedMappings.slice(0, 5)
          });
          
          debugLog('Populated mappingsCacheRef from backend:', normalizedMappings);
        } else if (mappings && Array.isArray(mappings)) {
          // Direct array format
          mappingsCacheRef.current = mappings.map(m => ({
            source: m.source,
            target: m.target
          }));
          
          enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Populated cache from direct array mappings', {
            originalCount: mappings.length,
            normalizedCount: mappingsCacheRef.current.length,
            sampleMappings: mappingsCacheRef.current.slice(0, 5)
          });
          
          debugLog('Populated mappingsCacheRef from backend (direct array):', mappingsCacheRef.current);
        } else if (mappings && typeof mappings === 'object' && !Array.isArray(mappings)) {
          // CRITICAL FIX: Handle old format (object with key-value pairs)
          let normalizedMappings = [];
          
          // Check if it's a direct object mapping (target -> source)
          const mappingKeys = Object.keys(mappings);
          if (mappingKeys.length > 0) {
            // Convert object format {target: source} to array format
            normalizedMappings = mappingKeys.map(target => ({
              source: mappings[target],
              target: target
            })).filter(m => m.source && m.target); // Filter out invalid mappings
            
            mappingsCacheRef.current = normalizedMappings;
            
            enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Populated cache from object format mappings', {
              originalKeys: mappingKeys.length,
              normalizedCount: normalizedMappings.length,
              sampleMappings: normalizedMappings.slice(0, 5),
              originalMappings: mappings
            });
            
            debugLog('Populated mappingsCacheRef from backend (object format):', normalizedMappings);
          } else {
            mappingsCacheRef.current = [];
            enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Empty object mappings', { mappings });
          }
        } else {
          mappingsCacheRef.current = [];
          enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'No mappings found in backend response', {
            mappings,
            mappingsType: typeof mappings,
            mappingsKeys: mappings ? Object.keys(mappings) : null
          });
          debugLog('No mappings found in backend response');
        }
        
        // Store existing mappings for restoration
        setExistingMappings(mappings);
        
        // Store default values
        if (default_values && typeof default_values === 'object') {
          setExistingDefaultValues(default_values);
          // CRITICAL: Also store in defaultValueMappings for UI integration
          setDefaultValueMappings(default_values);

          enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Loaded default values from backend', {
            defaultValuesCount: Object.keys(default_values).length,
            defaultValues: default_values,
            keys: Object.keys(default_values)
          });

          debugLog('Loaded default values from backend:', default_values);
        }
        
        // Update column counts from session metadata if available
        if (session_metadata && session_metadata.column_counts) {
          const { tags_count, spec_pairs_count, customer_id_pairs_count } = session_metadata.column_counts;
          const newCounts = {
            tags_count: tags_count || 1,
            spec_pairs_count: spec_pairs_count || 1,
            customer_id_pairs_count: customer_id_pairs_count || 1
          };
          
          setColumnCounts(newCounts);
          
          enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Updated column counts from session metadata', {
            originalCounts: session_metadata.column_counts,
            newCounts,
            sessionMetadata: session_metadata
          });
          
          debugLog('Updated column counts from session metadata:', session_metadata.column_counts);
        }
        
        enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Existing mappings check complete', {
          mappingsCount: mappingsCacheRef.current.length,
          defaultValuesCount: Object.keys(default_values || {}).length,
          sessionMetadata: session_metadata,
          cachePopulated: !!mappingsCacheRef.current.length
        });
        
        debugLog('Existing mappings check complete', {
          mappingsCount: mappingsCacheRef.current.length,
          defaultValuesCount: Object.keys(default_values || {}).length,
          sessionMetadata: session_metadata
        });
        
        // Return normalized mappings for immediate restoration
        return { 
          mappings: mappingsCacheRef.current, 
          defaults: default_values || {}, 
          meta: session_metadata || {} 
        };
      } else {
        enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Backend response not successful', {
          success: response.data?.success,
          error: response.data?.error,
          responseData: response.data
        });
        return { mappings: [], defaults: {}, meta: {} };
      }
    } catch (error) {
      enhancedDebugLog('CHECK_EXISTING_MAPPINGS', 'Error during existing mappings check', {
        error: error.message,
        stack: error.stack,
        sessionId
      });
      
      console.error('❌ Error checking existing mappings:', error);
      mappingsCacheRef.current = [];
      return { mappings: [], defaults: {}, meta: {} };
    }
  }

  // Function declaration for createEdge - hoisted to avoid TDZ
  function createEdge(sourceIdx, targetIdx, isAI = false, confidence = null, isFromTemplate = false, isSpecificationMapping = false) {
    // Generate unique edge ID by including timestamp to allow multiple edges to same target
    const edgeId = `e-c-${sourceIdx}-t-${targetIdx}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let strokeColor = '#10b981';
    let strokeWidth = 2.5;
    let animated = true;
    
    return {
      id: edgeId,
      source: `c-${sourceIdx}`,
      target: `t-${targetIdx}`,
      type: 'straight', // STRAIGHT lines - no curves, no collision
      animated,
      style: { 
        stroke: strokeColor, 
        strokeWidth,
        strokeOpacity: 0.74
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 14,
        height: 14
      },
      data: { 
        confidence, 
        isAiGenerated: isAI,
        isFromTemplate,
        isSpecificationMapping,
        sourceIdx,
        targetIdx
      }
    };
  }

  // Helper functions hoisted to avoid TDZ errors
  function getFieldNumber(fieldName) {
    const match = fieldName.match(/_(\d+)$/);
    return match ? parseInt(match[1]) : 1;
  }

  function isPairStartUpdated(fieldName, nextFieldName) {
    if (!nextFieldName) return false;

    const fieldNum = getFieldNumber(fieldName);
    const nextFieldNum = getFieldNumber(nextFieldName);

    // Only match numbered dynamic columns (Specification_Name_1, etc.)
    return (
      (/^Specification_Name_\d+$/i.test(fieldName) && /^Specification_Value_\d+$/i.test(nextFieldName) && fieldNum === nextFieldNum) ||
      (/^Customer_Identification_Name_\d+$/i.test(fieldName) && /^Customer_Identification_Value_\d+$/i.test(nextFieldName) && fieldNum === nextFieldNum)
    );
  }

  function isPairEndUpdated(fieldName, prevFieldName) {
    if (!prevFieldName) return false;

    const fieldNum = getFieldNumber(fieldName);
    const prevFieldNum = getFieldNumber(prevFieldName);
    
    // Only match numbered dynamic columns (Specification_Value_1, etc.)
    return (
      (/^Specification_Value_\d+$/i.test(fieldName) && /^Specification_Name_\d+$/i.test(prevFieldName) && fieldNum === prevFieldNum) ||
      (/^Customer_Identification_Value_\d+$/i.test(fieldName) && /^Customer_Identification_Name_\d+$/i.test(prevFieldName) && fieldNum === prevFieldNum)
    );
  }

  // FIXED: Only match NUMBERED dynamic columns (Tag_1, Specification_Name_1, etc.)
  // NOT user's original template columns like "Tag", "Specification Name", etc.
  function getPairTypeUpdated(fieldName) {
    // Use regex to match only numbered patterns
    if (/^Specification_(Name|Value)_\d+$/i.test(fieldName)) return 'specification';
    if (/^Customer_Identification_(Name|Value)_\d+$/i.test(fieldName)) return 'customer';
    if (/^Tag_\d+$/i.test(fieldName)) return 'tag';
    return 'single';
  }

  // Helper to check if a column is a dynamic (numbered) column
  function isDynamicColumn(fieldName) {
    return /^(Tag_\d+|Specification_(Name|Value)_\d+|Customer_Identification_(Name|Value)_\d+)$/i.test(fieldName);
  }

  function getPairIndexUpdated(fieldName) {
    return getFieldNumber(fieldName);
  }

  function getPairColorUpdated(fieldName, pairColors) {
    const pairType = getPairTypeUpdated(fieldName);
    const pairIndex = getPairIndexUpdated(fieldName);
    
    if (pairType === 'specification' || pairType === 'customer') {
      return pairColors[pairIndex % pairColors.length];
    }
    return 'gray';
  }

  function normalizeTemplateHeaderLabel(fieldName) {
    return String(fieldName || '').replace(/\.\d+$/, '').trim().toLowerCase();
  }

  function getSfoRepeatedFieldType(fieldName) {
    const normalized = normalizeTemplateHeaderLabel(fieldName);
    if (normalized === 'tag') return 'tag';
    if (['specification name', 'specification value', 'specification uom'].includes(normalized)) return 'specification';
    if (['item identifications name', 'item identifications value', 'customer identification name', 'customer identification value', 'custom identification name', 'custom identification value'].includes(normalized)) return 'customer';
    return null;
  }

  function getSfoRepeatedDisplayLabel(fieldName, occurrence, total) {
    if (!fieldName || total <= 1) return fieldName;
    return `${occurrence}. ${fieldName}`;
  }

  function isOptionalFieldUpdated(fieldName, templateOptionals, idx) {
    if (templateOptionals && templateOptionals.length > idx) {
      return !!templateOptionals[idx];
    }
    // Default logic: only NUMBERED dynamic fields are optional by default
    return isDynamicColumn(fieldName);
  }

  function handleDeleteOptionalFieldUpdated(nodeId, nodes, edges, columnCounts, updateColumnCounts) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !node.id.startsWith('t-')) return;

    const nodeData = node.data || {};
    const fieldName = nodeData.originalLabel;
    const sfoGroupType = nodeData.sfoGroupType;
    const sfoGroupIndex = nodeData.sfoGroupIndex || 1;
    const isAddedSfoRepeat = !!sfoGroupType && sfoGroupIndex > 1;

    if (!isDynamicColumn(fieldName) && !isAddedSfoRepeat) {
      window.alert('Only added dynamic fields can be deleted. FactWise template fields are locked.');
      return;
    }
    
    // Check if any of the target nodes are mapped
    const targetIdsToCheck = isAddedSfoRepeat
      ? nodes
          .filter(n => n.id.startsWith('t-') && n.data?.sfoGroupType === sfoGroupType && n.data?.sfoGroupIndex === sfoGroupIndex)
          .map(n => n.id)
      : [nodeId];
    const hasMapping = edges.some(e => targetIdsToCheck.includes(e.target));
    if (hasMapping) {
      window.alert('Please remove the mapping from this added field/group before deleting it.');
      return;
    }

    // Compute new counts based on field type
    const newCounts = { ...columnCounts };

    if (isAddedSfoRepeat) {
      if (sfoGroupType === 'tag') {
        newCounts.tags_count = Math.max(1, (newCounts.tags_count || 1) - 1);
      } else if (sfoGroupType === 'specification') {
        newCounts.spec_pairs_count = Math.max(1, (newCounts.spec_pairs_count || 1) - 1);
      } else if (sfoGroupType === 'customer') {
        newCounts.customer_id_pairs_count = Math.max(1, (newCounts.customer_id_pairs_count || 1) - 1);
      }
    } else if (fieldName.includes('Tag_')) {
      newCounts.tags_count = Math.max(1, (newCounts.tags_count || 1) - 1);
    } else if (fieldName.includes('Specification')) {
      // For specifications, we delete pairs
      const fieldNum = getFieldNumber(fieldName);
      const pairNodes = nodes.filter(n => 
        n.id.startsWith('t-') && 
        n.data?.originalLabel && 
        (n.data.originalLabel.includes(`Specification_Name_${fieldNum}`) || 
         n.data.originalLabel.includes(`Specification_Value_${fieldNum}`))
      );
      
      // Only decrease if we're deleting a complete pair
      if (pairNodes.length >= 2) {
        newCounts.spec_pairs_count = Math.max(1, (newCounts.spec_pairs_count || 1) - 1);
      }
    } else if (fieldName.includes('Customer_Identification')) {
      // For customer IDs, we delete pairs
      const fieldNum = getFieldNumber(fieldName);
      const pairNodes = nodes.filter(n => 
        n.id.startsWith('t-') && 
        n.data?.originalLabel && 
        (n.data.originalLabel.includes(`Customer_Identification_Name_${fieldNum}`) || 
         n.data.originalLabel.includes(`Customer_Identification_Value_${fieldNum}`))
      );
      
      // Only decrease if we're deleting a complete pair
      if (pairNodes.length >= 2) {
        newCounts.customer_id_pairs_count = Math.max(1, (newCounts.customer_id_pairs_count || 1) - 1);
      }
    }

    // Update counts which will trigger backend update and node regeneration
    updateColumnCounts(newCounts);
  }

  // Function declaration for initializeNodes - hoisted to avoid TDZ
  function initializeNodes(clientHdrs, templateHdrs, aiMappings = null, factwiseRules = [], defaultValues = {}, setIsInitializingMappings = null) {
    
    const {
      nodeHeight,
      nodeWidth,
      nodeSpacing,
      startY,
      sourceX,
      targetX
    } = getFlowLayout();
    
    // Create stable delete handler using imported function
    const stableDeleteHandler = (nodeId) => {
      // Use the proper imported function
      handleDeleteOptionalFieldUpdated(nodeId, nodesRef.current, edgesRef.current, columnCounts, updateColumnCounts);
    };

    // Create source nodes
    const clientNodes = clientHdrs.map((header, idx) => ({
      id: `c-${idx}`,
      type: 'custom',
      position: { x: sourceX, y: startY + idx * (nodeHeight + nodeSpacing) },
      data: {
        label: header,
        originalLabel: header,
        type: 'source',
        headerType: 'client',
        index: idx,
        isFromPDF: isFromPDF,
        confidence: headerConfidenceScores[header] || null,
        isCorrected: !!headerCorrections[header],
        isDarkMode,
        onHeaderEdit: handleHeaderEdit
      },
      draggable: false,
      style: { width: nodeWidth, height: nodeHeight }
    }));

    let specPairIndex = 1;
    let customerPairIndex = 1;
    
    // Use the color from the existing pairColors array
    const pairColors = ['blue', 'red', 'green', 'yellow', 'purple', 'pink'];
    
    // Build quick-look maps from session rules for FW-/AT- badges
    const tagBadges = new Map();
    const factwiseBadge = new Map();
    try {
      if (Array.isArray(factwiseRules)) {
        factwiseRules.forEach(rule => {
          if (rule && rule.type === 'factwise_id') {
            const src = [rule.first_column, rule.operator || '_', rule.second_column].filter(Boolean).join('');
            factwiseBadge.set('Item code', `FW-${rule.first_column}${rule.operator || '_'}${rule.second_column}`);
          }
        });
      }
      // formula rules can also come via aiMappings but we prefer session metadata path the caller passes in
      if (Array.isArray(aiMappings)) {
        aiMappings.forEach(r => {
          const colType = r?.column_type || 'Tag';
          const target = r?.target_column;
          const src = r?.source_column;
          if (colType === 'Tag' && target && src) {
            tagBadges.set(target, `AT-${src}`);
          }
        });
      }
    } catch (e) {
      // non-fatal; badges are best-effort
    }

    const duplicateTotals = templateHdrs.reduce((acc, header) => {
      acc[header] = (acc[header] || 0) + 1;
      return acc;
    }, {});
    const duplicateSeen = {};

    // Process template headers in their original order
    const templateNodes = templateHdrs.map((header, idx) => {
      duplicateSeen[header] = (duplicateSeen[header] || 0) + 1;
      const headerOccurrence = duplicateSeen[header];
      const headerTotal = duplicateTotals[header] || 1;
      const sfoGroupType = getSfoRepeatedFieldType(header);
      const sfoGroupIndex = sfoGroupType ? headerOccurrence : null;
      const displayLabel = getSfoRepeatedDisplayLabel(header, headerOccurrence, headerTotal);

      // Use updated pair detection logic for numbered fields
      const nextHeader = templateHdrs[idx + 1];
      const prevHeader = templateHdrs[idx - 1];
      
      const normalizedHeader = normalizeTemplateHeaderLabel(header);
      const isSfoPairStart = normalizedHeader === 'specification name' || normalizedHeader === 'item identifications name' || normalizedHeader === 'customer identification name' || normalizedHeader === 'custom identification name';
      const isSfoPairEnd = normalizedHeader === 'specification uom' || normalizedHeader === 'item identifications value' || normalizedHeader === 'customer identification value' || normalizedHeader === 'custom identification value';
      const isPairStart = sfoGroupType === 'specification' || sfoGroupType === 'customer' ? isSfoPairStart : isPairStartUpdated(header, nextHeader);
      const isPairEnd = sfoGroupType === 'specification' || sfoGroupType === 'customer' ? isSfoPairEnd : isPairEndUpdated(header, prevHeader);
      const pairType = sfoGroupType || getPairTypeUpdated(header);
      const pairIndex = sfoGroupType ? sfoGroupIndex : getPairIndexUpdated(header);
      const pairColor = sfoGroupType ? pairColors[(Math.max(pairIndex, 1) - 1) % pairColors.length] : getPairColorUpdated(header, pairColors);
      const isDynamicTemplateField = isDynamicColumn(header) || (!!sfoGroupType && sfoGroupIndex > 1);
      const isOptionalTemplateField = isDynamicTemplateField || (sfoGroupType && isOptionalFieldUpdated(header, templateOptionals, idx));

      // Check for custom formula rule from factwise
      const factwiseFormula = factwiseRules?.find(rule => rule.target_column === header)?.formula_expression || null;
      
      // Check for default value
      const hasDefaultValue = defaultValues && Object.prototype.hasOwnProperty.call(defaultValues, header);
      const defaultValue = hasDefaultValue ? defaultValues[header] : '';
      
      const src = 'delete';
      
      return {
        id: `t-${idx}`,
        type: 'custom',
        position: { x: targetX, y: startY + idx * (nodeHeight + nodeSpacing) },
        data: {
          label: header,
          originalLabel: header,
          displayLabel,
          type: 'target',
          headerType: 'template',
          index: idx,
          isPairStart: isPairStart,
          isPairEnd: isPairEnd,
          pairType: pairType,
          pairColor: pairColor,
          pairIndex: pairIndex,
          isOptional: !!isOptionalTemplateField,
          onDelete: stableDeleteHandler,
          factwiseFormula: factwiseFormula,
          hasDefaultValue: hasDefaultValue,
          defaultValue: defaultValue,
          atBadge: tagBadges.get(header) || null,
          isDarkMode,
          isDynamic: isDynamicTemplateField,  // true for Tag_1, Specification_Name_1, etc.
          sfoGroupType,
          sfoGroupIndex,
        },
        draggable: false,
        style: { 
          width: nodeWidth, 
          height: nodeHeight
        }
      };
    });

    const allNodes = [...clientNodes, ...templateNodes];
    
    enhancedDebugLog('INIT_NODES', 'Generated node structure', {
      totalNodes: allNodes.length,
      clientNodesCount: clientNodes.length,
      targetNodesCount: templateNodes.length,
      clientNodeIds: clientNodes.map(n => n.id),
      targetNodeIds: templateNodes.map(n => n.id),
      clientLabels: clientNodes.map(n => n.data.label),
      targetLabels: templateNodes.map(n => n.data.label)
    });
    setNodes(allNodes);
  }

  // reconcileEdgesWithNodes - moved above to avoid TDZ

  // Keep node mapping labels in sync with current edges
  useEffect(() => {
    reconcileEdgesWithNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);

  // A) Rebuild sequence for column count updates
  const updateColumnCounts = async (newCounts) => {
    setColumnCountLoading(true);
    try {
      // Allow any just-applied state changes to settle before snapshot
      await new Promise(r => setTimeout(r, 50));
      // Ensure immutable counts object with all required keys
      const safeNewCounts = {
        tags_count: Math.max(0, newCounts.tags_count || 0),
        spec_pairs_count: Math.max(0, newCounts.spec_pairs_count || 0), 
        customer_id_pairs_count: Math.max(0, newCounts.customer_id_pairs_count || 0)
      };
      
      enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Starting column count update sequence', { 
        newCounts: safeNewCounts, 
        edgesCount: edges.length, 
        cacheCount: (mappingsCacheRef.current||[]).length 
      });
      // eslint-disable-next-line no-console
      debugLog('REBUILD/DELETE start', { newCounts: safeNewCounts, edgesCount: edges.length, cacheCount: (mappingsCacheRef.current||[]).length });
      
      // A1) Set rebuild guard
      isRebuildingRef.current = true;
      enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Set rebuild guard', { isRebuilding: true });
      
      // A2) Snapshot existing mappings by internal labels BEFORE clearing edges
      let existingMappings = edges.map(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        return {
          sourceLabel: sourceNode?.data?.originalLabel,
          targetLabel: targetNode?.data?.originalLabel,
          edgeData: edge.data
        };
      }).filter(m => m.sourceLabel && m.targetLabel);

      // Update cache with current mappings to preserve them during rebuild
      if (existingMappings.length > 0) {
        mappingsCacheRef.current = existingMappings.map(m => ({
          source: m.sourceLabel,
          target: m.targetLabel
        }));
      }
      
      enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Snapshot existing mappings from live edges', { 
        totalEdges: edges.length, 
        validMappings: existingMappings.length,
        mappings: existingMappings 
      });
      
      // Fallback to cache if live snapshot is empty (unless user explicitly deleted edges)
      if (!suppressRestoreRef.current && existingMappings.length === 0 && Array.isArray(mappingsCacheRef.current) && mappingsCacheRef.current.length > 0) {
        existingMappings = mappingsCacheRef.current.map(m => ({
          sourceLabel: m.source,
          targetLabel: m.target,
          edgeData: {}
        }));
        enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Fallback to cache mappings', { 
          cacheCount: mappingsCacheRef.current.length, 
          restoredMappings: existingMappings 
        });
        // eslint-disable-next-line no-console
      }

      // Fallback to backend if both snapshot and cache are empty (unless suppressed)
      if (!suppressRestoreRef.current && existingMappings.length === 0) {
        try {
          enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Fallback to backend mappings - both live and cache empty');
          debugLog('Fetching mappings from backend as fallback');
          const resp = await api.getExistingMappings(sessionId);
          const backendMappings = resp.data?.mappings;
          let normalized = [];
          
          enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Backend response received', { 
            responseData: resp.data, 
            mappingsKey: !!resp.data?.mappings,
            mappingsType: typeof backendMappings,
            isArray: Array.isArray(backendMappings)
          });
          
          if (Array.isArray(backendMappings)) {
            normalized = backendMappings
              .filter(m => m && m.source && m.target)
              .map(m => ({ sourceLabel: m.source, targetLabel: m.target, edgeData: {} }));
            enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Processed backend array mappings', { 
              originalCount: backendMappings.length, 
              filteredCount: normalized.length,
              normalized: normalized 
            });
          } else if (backendMappings && Array.isArray(backendMappings.mappings)) {
            normalized = backendMappings.mappings
              .filter(m => m && m.source && m.target)
              .map(m => ({ sourceLabel: m.source, targetLabel: m.target, edgeData: {} }));
            enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Processed backend nested mappings', { 
              originalCount: backendMappings.mappings.length, 
              filteredCount: normalized.length,
              normalized: normalized 
            });
          } else if (backendMappings && typeof backendMappings === 'object') {
            normalized = Object.entries(backendMappings)
              .filter(([t, s]) => s && t)
              .map(([t, s]) => ({ sourceLabel: s, targetLabel: t, edgeData: {} }));
            enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Processed backend object mappings', { 
              originalKeys: Object.keys(backendMappings), 
              filteredCount: normalized.length,
              normalized: normalized 
            });
          }
          
          if (normalized.length > 0) {
            existingMappings = normalized;
            // Seed cache for next time
            mappingsCacheRef.current = normalized.map(m => ({ source: m.sourceLabel, target: m.targetLabel }));
            enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Successfully restored mappings from backend', { 
              restoredCount: existingMappings.length, 
              seededCache: mappingsCacheRef.current.length 
            });
            debugLog('Preserved mappings from backend (fallback):', existingMappings);
          } else {
            enhancedDebugLog('COLUMN_COUNT_UPDATE', 'No valid mappings found in backend response', { 
              backendMappings, 
              normalized 
            });
          }
        } catch (e) {
          enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Failed to fetch backend mappings', { error: e.message, stack: e.stack });
          warnLog('⚠️ Failed to fetch backend mappings for preservation:', e);
        }
      } else {
        enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Using existing mappings from snapshot/cache', { 
          source: 'snapshot', 
          count: existingMappings.length 
        });
        debugLog('Preserved mappings by label:', existingMappings);
      }
      
      // A3) Get backend response and new headers BEFORE making any changes
      const response = await api.updateColumnCounts(sessionId, newCounts);
      
      if (response.data.success) {
        // CRITICAL FIX: Set flag to indicate column count changes for DataEditor synchronization
        sessionStorage.setItem('recentColumnCountUpdate', 'true');
        
        // Force a higher version to ensure refresh detection
        const forceVersion = Math.max(response.data.template_version || 0, Date.now() / 1000);
        sessionStorage.setItem(`templateVersion_${sessionId}`, Math.floor(forceVersion).toString());
        sessionStorage.setItem(`lastColumnUpdate_${sessionId}`, Date.now().toString());

        setColumnCounts(newCounts);
        
        // Update template version to indicate a change occurred
        setExpectedTemplateVersion(prev => prev + 1);
        
        if (response.data.enhanced_headers) {
          // A3) Apply new headers from backend (canonical)
          const newTemplateHeaders = response.data.enhanced_headers;
          const newTemplateOptionals = response.data.template_optionals || [];
          
          // A4) Apply all state updates atomically
          setTemplateHeaders(newTemplateHeaders);
          setTemplateOptionals(newTemplateOptionals);
          setTemplateColumns(newTemplateHeaders); // Update templateColumns for default value dialog
          setUseDynamicTemplate(true);
          
          // A5) Rebuild template nodes with new headers
          const factwiseRules = sessionMetadata?.factwise_rules || [];
          initializeNodes(clientHeaders, newTemplateHeaders, null, factwiseRules, defaultValueMappings, setIsInitializingMappings);
          
          // A6) After nodes are in state, reconcile and restore mappings atomically
          let restoredEdgesCount = 0;
          setTimeout(() => {
            setNodes(currentNodes => {
              const newEdges = [];
              
              // D) Remap by labels (not indices)
              existingMappings.forEach(mapping => {
                const sourceIdx = clientHeaders.indexOf(mapping.sourceLabel);
                const newTargetNode = currentNodes.find(n => 
                  n.id.startsWith('t-') && n.data?.originalLabel === mapping.targetLabel
                );
                
                if (sourceIdx >= 0 && newTargetNode) {
                  const newTargetIdx = parseInt(newTargetNode.id.replace('t-', ''));
                  const newEdge = createEdge(
                    sourceIdx, 
                    newTargetIdx, 
                    false, 
                    mapping.edgeData?.confidence, 
                    mapping.edgeData?.isFromTemplate, 
                    mapping.edgeData?.isSpecificationMapping
                  );
                  newEdges.push(newEdge);
                  debugLog('Restored mapping:', { source: mapping.sourceLabel, target: mapping.targetLabel });
                } else {
                  warnLog('❌ Could not restore mapping:', { source: mapping.sourceLabel, target: mapping.targetLabel });
                }
              });
              
              // Apply edges atomically with the same render cycle as nodes
              setEdges(newEdges);
              restoredEdgesCount = newEdges.length;
              
              return currentNodes;
            });
            
            // A7) Run reconciliation and force-save in a single async operation
            setTimeout(async () => {
              reconcileEdgesWithNodes();
              debugLog('REBUILD/DELETE complete', { restoredEdges: restoredEdgesCount });
              
              // Update template version to mark rebuild completion (before save attempt)
              setTemplateVersion(prev => prev + 1);
              
              // A8) Force-save mappings after dynamic rebuild to avoid autosave gap
              try {
                // Skip forced save if still initializing to prevent partial saves
                if (isInitializingMappings || isInitializingRef.current) {
                  debugLog('Skipping forced save - still initializing mappings. State:', isInitializingMappings, 'Ref:', isInitializingRef.current);
                  isRebuildingRef.current = false;
                  return;
                }
                
                debugLog('Forced save proceeding - not initializing');
                const targetHeaders = newTemplateHeaders;

                // Filter default values to only include currently existing target headers
                const filteredDefaultValues = Object.fromEntries(
                  Object.entries(defaultValueMappings || {}).filter(([k]) => targetHeaders.includes(k))
                );

                // Get current edges from state for saving with header corrections
                const currentEdges = edges;
                const payload = buildMappingData(currentEdges, filteredDefaultValues);

                // CRITICAL FIX: During column count updates, allow saving even empty mappings to clear old state
                // But prevent saving empty mappings in other scenarios
                if (payload.mappings.length === 0) {
                  // Check if this is a column count update scenario
                  const isColumnCountUpdate = sessionStorage.getItem('recentColumnCountUpdate') === 'true';
                  if (!isColumnCountUpdate) {
                    debugLog('No mappings to save in forced save, skipping to prevent data loss');
                    isRebuildingRef.current = false;
                    return;
                  } else {
                    debugLog('Column count update: allowing save of empty mappings to clear old state');
                  }
                }

                // Update cache before saving - use the processed mappings from buildMappingData
                mappingsCacheRef.current = payload.mappings;
                debugLog('Forced save payload:', payload);
                debugLog('defaultValueMappings in forced save (filtered):', filteredDefaultValues);
                debugLog('header corrections in forced save:', payload.header_corrections);

                await api.saveColumnMappings(sessionId, payload);
                
              } catch (saveError) {
                console.error('❌ Forced save failed:', saveError);
              } finally {
                isRebuildingRef.current = false;
              }
            }, 100);
          }, 100);
        }
      }
    } catch (error) {
      console.error('❌ Error updating column counts:', error);
      isRebuildingRef.current = false;
    } finally {
      // Wait for 1 second to show loading state
      await new Promise(resolve => setTimeout(resolve, 1000));
      // reset suppression flag after handling one update cycle
      suppressRestoreRef.current = false;
      setColumnCountLoading(false);
    }
  };

  // Load real data from API and check for existing mappings
  useEffect(() => {
    // Load suppressed virtual edges for this session
    try {
      const key = `virtualSuppressions_${sessionId}`;
      const raw = sessionStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      suppressedVirtualsRef.current = new Set(arr);
    } catch (_) {
      suppressedVirtualsRef.current = new Set();
    }

    if (!sessionId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setIsInitializingMappings(true);
      isInitializingRef.current = true;
      autoApplyTriggeredRef.current = false; // Reset for new session
      resetMappingCounter(); // Reset counter when loading new data
      // eslint-disable-next-line no-console
      
      // 🔥 CRITICAL FIX: Check navigation state first
      const comingFromDataEditor = sessionStorage.getItem('navigatedFromDataEditor');
      
      // 🔥 CRITICAL FIX: Check for saved mappings from review session FIRST
      let savedMappingData = null;
      try {
        const savedMapping = sessionStorage.getItem('currentMapping');
        if (savedMapping) {
          const parsedMapping = JSON.parse(savedMapping);
          if (parsedMapping.reviewCompleted && parsedMapping.sessionId === sessionId) {
            // CRITICAL FIX: Validate that mappings array is not empty/corrupted
            const hasValidMappings = parsedMapping.mappings && 
                                   Array.isArray(parsedMapping.mappings) && 
                                   parsedMapping.mappings.length > 0;
            
            if (hasValidMappings) {
              savedMappingData = parsedMapping;
            } else {
              console.warn('🚫 SessionStorage mappings corrupted/empty, will fall back to backend data');
              // Force complete state rebuild when sessionStorage is corrupted
              if (comingFromDataEditor === 'true') {
                sessionStorage.setItem('forceAggressiveRestore', 'true');
              }
              // Don't use corrupted sessionStorage data - let it fall through to backend fetch
            }
            
            // Clear the flag so it doesn't interfere with future loads
            const updatedMapping = { ...parsedMapping };
            delete updatedMapping.reviewCompleted;
            sessionStorage.setItem('currentMapping', JSON.stringify(updatedMapping));
          }
        }
      } catch (e) {
        console.warn('🚫 Failed to parse saved mappings from review session:', e);
      }

      // CRITICAL FIX: Check if template was applied in DataEditor
      const templateAppliedInDataEditor = sessionStorage.getItem('templateAppliedInDataEditor');
      const lastTemplateApplied = sessionStorage.getItem('lastTemplateApplied');
      if (templateAppliedInDataEditor === 'true' && lastTemplateApplied) {
        // eslint-disable-next-line no-console
        sessionStorage.removeItem('templateAppliedInDataEditor');
        sessionStorage.removeItem('lastTemplateApplied');

        // Show notification about the template that was applied
        showSnackbar(`Template "${lastTemplateApplied}" was applied in Data Editor. Refreshing mapping view...`, 'info');
      }
      
      // CRITICAL FIX: Always reload session state when coming from DataEditor
      if (comingFromDataEditor === 'true') {
        sessionStorage.removeItem('navigatedFromDataEditor');
        // DON'T clear mappings cache - let backend restore them properly
      }
      
      try {
        // Get headers from API
        // eslint-disable-next-line no-console
        const response = await api.getHeaders(sessionId);
        // eslint-disable-next-line no-console
        
        const { data } = response;
        // eslint-disable-next-line no-console
        
        const { 
          client_headers = [], 
          template_headers = [], 
          template_columns = [], 
          column_counts = {}, 
          session_metadata = {},
          client_file = '',
          template_file = '',
          template_optionals = []
        } = data;

        // Validate headers
        if (!Array.isArray(client_headers)) {
          // eslint-disable-next-line no-console
          console.error('❌ client_headers is not an array:', typeof client_headers, client_headers);
        }
        if (!Array.isArray(template_headers)) {
          // eslint-disable-next-line no-console
          console.error('❌ template_headers is not an array:', typeof template_headers, template_headers);
        }
        
        // Validate headers before setting
        const validClientHeaders = Array.isArray(client_headers) ? client_headers : [];
        const validTemplateHeaders = Array.isArray(template_headers) ? template_headers : [];
        
        setClientHeaders(validClientHeaders);
        // Use original template headers first, will update later if regenerated
        setTemplateHeaders(validTemplateHeaders);
        setClientFileName(client_file || '');
        setTemplateFileName(template_file || '');
        if (Array.isArray(template_optionals)) {
          setTemplateOptionals(template_optionals);
        } else {
          setTemplateOptionals([]);
        }
        
        // Set column counts and template columns
        if (column_counts && Object.keys(column_counts).length > 0) {
          setColumnCounts(column_counts);
        }
        if (template_columns && Array.isArray(template_columns)) {
          setTemplateColumns(template_columns);
        }

        // DEBUG: Additional validation
        if (client_headers.length === 0) {
          // eslint-disable-next-line no-console
          console.error('❌ CLIENT HEADERS ARE EMPTY!');
        }
        if (template_headers.length === 0) {
          // eslint-disable-next-line no-console
          console.error('❌ TEMPLATE HEADERS ARE EMPTY!');
        }
        
        // Set PDF flags and header confidence from headers endpoint if available
        if (session_metadata && session_metadata.is_from_pdf) {
          setIsFromPDF(true);
          if (session_metadata.header_confidence_scores && Object.keys(session_metadata.header_confidence_scores).length > 0) {
            setHeaderConfidenceScores(session_metadata.header_confidence_scores);
          }
        }

        // ENHANCED: Extract template information from session metadata
        if (session_metadata.original_template_id) {
          setOriginalTemplateId(session_metadata.original_template_id);
          // eslint-disable-next-line no-console
        }
        
        if (session_metadata.template_applied) {
          setTemplateApplied(true);
          // eslint-disable-next-line no-console
        }
        
        if (session_metadata.template_name) {
          setAppliedTemplateName(session_metadata.template_name);
          // eslint-disable-next-line no-console
        } else if (location.state?.appliedTemplate?.name) {
          setAppliedTemplateName(location.state.appliedTemplate.name);
        }
        
        // Use template headers from uploaded template file (no regeneration needed)
        let finalTemplateHeaders = [...template_headers];
        
        // 🔥 CRITICAL FIX: Use saved mappings from review session if available, otherwise fetch from backend
        let normalizedMappings = [];
        if (savedMappingData && savedMappingData.mappings) {
          try {
            // Use saved mappings from review session - preserve exact mapping relationships
            normalizedMappings = savedMappingData.mappings
              .filter(mapping => mapping && mapping.source && mapping.target) // Filter out invalid mappings
              .map(mapping => ({
                sourceLabel: String(mapping.source || ''),
                targetLabel: String(mapping.target || ''),
                confidence: mapping.confidence || 'saved',
                isFromTemplate: mapping.isFromTemplate || false
              }));
            
            // 🔥 AUTO-REFRESH FIX: If coming from DataEditor and sessionStorage mappings are corrupted (empty), auto-refresh
            if (comingFromDataEditor === 'true' && normalizedMappings.length === 0) {
              console.warn('🔄 CRITICAL: Coming from DataEditor but restored 0 mappings from sessionStorage!');
              // Clear the navigation flag to prevent infinite refresh loop
              sessionStorage.removeItem('navigatedFromDataEditor');
              // Force page refresh to bypass corrupted sessionStorage
              window.location.reload();
              return; // Exit early since page is reloading
            }
          } catch (mappingError) {
            console.warn('🚫 Error processing saved mappings, falling back to backend:', mappingError);
            // Fallback to backend if sessionStorage mappings are corrupted
            const result = await checkExistingMappings(client_headers, finalTemplateHeaders, setIsInitializingMappings);
            normalizedMappings = result.mappings;
          }
        } else {
          // Fallback to backend mappings if no saved session data
          const result = await checkExistingMappings(client_headers, finalTemplateHeaders, setIsInitializingMappings);
          normalizedMappings = result.mappings;
          
          // CRITICAL FIX: When coming from DataEditor, ensure we have the most recent mappings
          if (comingFromDataEditor === 'true') {
            // DON'T clear nodes/edges here - let the normal flow handle it properly
            // The issue was clearing nodes before they were properly recreated
          }
        }

        // Initialize nodes AFTER we have session metadata for badges
        const headersToUse = finalTemplateHeaders;
        const factwiseRules = session_metadata?.factwise_rules || [];
        initializeNodes(client_headers, headersToUse, session_metadata?.formula_rules || [], factwiseRules, defaultValueMappings, setIsInitializingMappings);
        if ((session_metadata?.template_applied || location.state?.templateAlreadyApplied) && !location.state?.autoApplyTemplate) {
          setTemplateApplied(true);
          setTemplateMappingCount(normalizedMappings?.length || 0);
        }
        
        // CRITICAL FIX: Apply existing mappings AFTER nodes are initialized
        if (normalizedMappings && normalizedMappings.length > 0) {
          try {
            applyExistingMappingsToFlow(normalizedMappings, client_headers, headersToUse, setIsInitializingMappings);
            
            // AGGRESSIVE FIX: Force state restoration when coming from DataEditor with corrupted sessionStorage
            const forceAggressiveRestore = sessionStorage.getItem('forceAggressiveRestore');
            if (forceAggressiveRestore === 'true') {
              sessionStorage.removeItem('forceAggressiveRestore');
              
              // Force template version update with delay to ensure UI catches the change
              setTimeout(() => {
                setTemplateVersion(prev => prev + 2);  // +2 to ensure change is noticed
                setExpectedTemplateVersion(prev => prev + 2);
                
                // Phase 2: Force state synchronization
                setTimeout(() => {
                  // Force re-render of mappings by updating the flow state
                  setNodes(currentNodes => [...currentNodes]);
                  setEdges(currentEdges => [...currentEdges]);
                  
                  // Force default values refresh if they exist
                  if (defaultValueMappings && Object.keys(defaultValueMappings).length > 0) {
                    const refreshedDefaults = { ...defaultValueMappings };
                    setDefaultValueMappings(refreshedDefaults);
                  }
                }, 300);
              }, 400);
            }
          } catch (mappingApplicationError) {
            console.warn('🚫 Error applying existing mappings, continuing with empty state:', mappingApplicationError);
            // Continue without mappings if there's an error
            setIsInitializingMappings(false);
            isInitializingRef.current = false;
            
            // Initial load complete - synchronize template version
            setTemplateVersion(prev => prev + 1);
            setExpectedTemplateVersion(prev => prev + 1);
          }
        } else {
          // No existing mappings, just end initialization
          setIsInitializingMappings(false);
          isInitializingRef.current = false;
          
          // Initial load complete - synchronize template version
          setTemplateVersion(prev => prev + 1);
          setExpectedTemplateVersion(prev => prev + 1);
        }
        
        // CRITICAL FIX: When coming from DataEditor, force a complete UI state refresh
        if (comingFromDataEditor === 'true') {
          
          // Increased delay to ensure nodes and mappings are fully created before forcing refresh
          setTimeout(() => {
            setTemplateVersion(prev => prev + 1);
            setExpectedTemplateVersion(prev => prev + 1);
            
            // Additional delay to ensure template version update is processed
            setTimeout(() => {
              
              // Force re-application of default values if they exist
              if (defaultValueMappings && Object.keys(defaultValueMappings).length > 0) {
                
                // Force trigger the useEffect that applies default values to nodes
                // by creating a new object reference
                const refreshedDefaults = { ...defaultValueMappings };
                setDefaultValueMappings(refreshedDefaults);
                
              }
              
            }, 200);
          }, 300);
        }
        
      } catch (err) {
        console.error('Error loading data:', err);
        
        // Check if session not found (404)
        if (err.response && err.response.status === 404) {
          setError('Session not found. Please upload files again to start a new mapping session.');
          // Redirect to dashboard after a short delay
          setTimeout(() => {
            navigate('/dashboard');
          }, 3000);
        } else {
          setError('Failed to load mapping data. Please try again.');
          
          // Fallback data for testing only if not a session issue
          const fallbackClient = ['Item', 'Qty', 'Description'];
          const fallbackTemplate = ['Item Code', 'Quantity', 'Item Name'];
          setClientHeaders(fallbackClient);
          setTemplateHeaders(fallbackTemplate);
          initializeNodes(fallbackClient, fallbackTemplate, null, [], defaultValueMappings, setIsInitializingMappings);
        }
      } finally {
        setLoading(false);
      }
    };
    loadDataRef.current = loadData;
    
    loadData();
  }, [sessionId]);

  // Handle PDF OCR data from upload
  useEffect(() => {
    const fromPDF = location.state?.fromPDF;
    const ocrData = location.state?.ocrData;

    if (fromPDF && ocrData && !loading && clientHeaders.length === 0) {

      // Set PDF flag
      setIsFromPDF(true);

      // Extract headers from OCR data
      if (ocrData.headers && ocrData.headers.length > 0) {

        // Set header confidence scores if available
        if (ocrData.header_confidence_scores) {
          setHeaderConfidenceScores(ocrData.header_confidence_scores);
        }

        // The headers should already be set by the backend session, but we can verify
        // This will trigger a refresh of the headers if needed
        try { if (loadDataRef.current) loadDataRef.current(); } catch (_) {}
      }

      // Show success message
      if (ocrData.quality_metrics) {
        const metrics = ocrData.quality_metrics;
        const confidence = Math.round(metrics.overall_confidence * 100);
      }
    }
  }, [location.state, loading, clientHeaders.length]);

  // Auto-apply template from Dashboard/Upload using the existing handleApplyTemplate logic
  useEffect(() => {
    const autoApplyTemplate = location.state?.autoApplyTemplate;
    const templateAlreadyApplied = location.state?.templateAlreadyApplied;
    
    if (autoApplyTemplate && !templateAlreadyApplied && !loading && clientHeaders.length > 0 && templateHeaders.length > 0 && !autoApplyTriggeredRef.current) {
      autoApplyTriggeredRef.current = true;
      
      // Small delay to ensure page is fully loaded
      const timer = setTimeout(() => {
        handleApplyTemplate(autoApplyTemplate);
        
        // Clear the state so it doesn't re-apply on refresh
        window.history.replaceState({}, '', window.location.pathname);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [location.state, loading, clientHeaders.length, templateHeaders.length]);

  // Navigation protection: Block browser back navigation when unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      // Check if there are unsaved mappings
      if (edges.length > 0 && !isReviewing && !isProcessingMappings) {
        event.preventDefault();
        event.returnValue = 'You have unsaved mappings. Are you sure you want to leave?';
        return 'You have unsaved mappings. Are you sure you want to leave?';
      }
    };

    const handlePopState = (event) => {
      // Check if there are unsaved mappings (skip when we triggered the reload)
      if (edges.length > 0 && !isReviewing && !isProcessingMappings && !bypassUnloadGuardRef.current) {
        event.preventDefault();
        setShowNavigationConfirm(true);
        setPendingNavigation(() => () => {
          // Force refresh the current page to restore mappings
          window.location.reload();
        });
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [edges.length, isReviewing, isProcessingMappings]);

  // Handle navigation confirmation
  const handleNavigationConfirm = () => {
    setShowNavigationConfirm(false);
    if (pendingNavigation) {
      pendingNavigation();
      setPendingNavigation(null);
    }
  };

  const handleNavigationCancel = () => {
    setShowNavigationConfirm(false);
    setPendingNavigation(null);
    // Push current state back to prevent actual navigation
    window.history.pushState(null, '', window.location.pathname);
  };

  

  // Apply existing mappings to the React Flow
  const applyExistingMappingsToFlow = (mappings, clientHdrs, templateHdrs, setIsInitializingMappings = null) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 [EDGE_CREATE] Starting applyExistingMappingsToFlow');
    console.log('🔍 [EDGE_CREATE] Inputs:', {
      mappingsCount: Array.isArray(mappings) ? mappings.length : (mappings?.mappings ? mappings.mappings.length : 'unknown'),
      clientHdrsCount: clientHdrs?.length,
      templateHdrsCount: templateHdrs?.length
    });
    console.log('🔍 [EDGE_CREATE] Client headers:', clientHdrs);
    console.log('🔍 [EDGE_CREATE] Template headers:', templateHdrs);
    console.log('🔍 [EDGE_CREATE] Mappings:', mappings);

    const newEdges = [];
    const mappingPairs = [];

    // CRITICAL FIX: Validate inputs to prevent crashes
    if (!mappings || !clientHdrs || !templateHdrs) {
      console.error('🔍 [EDGE_CREATE] ❌ INVALID INPUTS:', { mappings, clientHdrs, templateHdrs });
      return;
    }

    if (!Array.isArray(clientHdrs) || !Array.isArray(templateHdrs)) {
      console.error('🔍 [EDGE_CREATE] ❌ Headers must be arrays:', { clientHdrs, templateHdrs });
      return;
    }
    
    // Helper function to find the best matching target column
    const findBestTargetColumn = (sourceCol, targetCol, templateHdrs, usedTargets = new Set()) => {
      // 🔥 ENHANCED NULL SAFETY: Validate all inputs to prevent errors
      if (!targetCol || typeof targetCol !== 'string') {
        console.warn('🚫 findBestTargetColumn: Invalid targetCol:', targetCol);
        return null;
      }
      if (!Array.isArray(templateHdrs)) {
        console.warn('🚫 findBestTargetColumn: Invalid templateHdrs:', templateHdrs);
        return null;
      }
      
      // First try exact match
      let targetIdx = templateHdrs.indexOf(targetCol);
      if (targetIdx >= 0) {
        return { targetIdx, targetCol, confidence: 'exact' };
      }
      
      // Try to find dynamic column matches (e.g., "Tag" -> "Tag_1", "Tag_2")
      if (targetCol === 'Tag') {
        // Look for Tag_1, Tag_2, etc. but prefer unused ones
        const availableTags = [];
        for (let i = 0; i < templateHdrs.length; i++) {
          if (templateHdrs[i].startsWith('Tag_')) {
            availableTags.push({ targetIdx: i, targetCol: templateHdrs[i] });
          }
        }
        
        // First try to find an unused tag
        for (const tag of availableTags) {
          if (!usedTargets.has(tag.targetCol)) {
            return { targetIdx: tag.targetIdx, targetCol: tag.targetCol, confidence: 'dynamic_tag_unused' };
          }
        }
        
        // If all tags are used, return the first available one
        if (availableTags.length > 0) {
          return { targetIdx: availableTags[0].targetIdx, targetCol: availableTags[0].targetCol, confidence: 'dynamic_tag_used' };
        }
      }
      
      if (targetCol === 'Specification name') {
        // Look for Specification_Name_1, etc.
        for (let i = 0; i < templateHdrs.length; i++) {
          if (templateHdrs[i].startsWith('Specification_Name_')) {
            return { targetIdx: i, targetCol: templateHdrs[i], confidence: 'dynamic_spec_name' };
          }
        }
      }
      
      if (targetCol === 'Specification value') {
        // Look for Specification_Value_1, etc.
        for (let i = 0; i < templateHdrs.length; i++) {
          if (templateHdrs[i].startsWith('Specification_Value_')) {
            return { targetIdx: i, targetCol: templateHdrs[i], confidence: 'dynamic_spec_value' };
          }
        }
      }
      
      if (targetCol === 'Customer identification name') {
        // Look for Customer_Identification_Name_1, etc.
        for (let i = 0; i < templateHdrs.length; i++) {
          if (templateHdrs[i].startsWith('Customer_Identification_Name_')) {
            return { targetIdx: i, targetCol: templateHdrs[i], confidence: 'dynamic_customer_name' };
          }
        }
      }
      
      if (targetCol === 'Customer identification value') {
        // Look for Customer_Identification_Value_1, etc.
        for (let i = 0; i < templateHdrs.length; i++) {
          if (templateHdrs[i].startsWith('Customer_Identification_Value_')) {
            return { targetIdx: i, targetCol: templateHdrs[i], confidence: 'dynamic_customer_value' };
          }
        }
      }

      // Saved template mappings are user intent. If the exact/dynamic target is
      // absent, skip it instead of guessing a different field by substring.
      return null;
      
      // Try fuzzy matching for other columns
      for (let i = 0; i < templateHdrs.length; i++) {
        const templateCol = templateHdrs[i];
        // 🔥 NULL SAFETY FIX: Check for undefined/null values before toLowerCase()
        if (templateCol && targetCol && 
            (templateCol.toLowerCase().includes(targetCol.toLowerCase()) || 
             targetCol.toLowerCase().includes(templateCol.toLowerCase()))) {
          return { targetIdx: i, targetCol: templateCol, confidence: 'fuzzy' };
        }
      }
      
      return null;
    };
    
    // Track used targets to prevent conflicts
    const usedTargets = new Set();
    
    // Handle direct array format (from template application)
    if (Array.isArray(mappings)) {
      mappings.forEach(mapping => {
        const sourceCol = mapping.source;
        const templateCol = mapping.target;

        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);
        
        if (sourceIdx >= 0 && targetMatch) {
          const edge = createEdge(sourceIdx, targetMatch.targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
          mappingPairs.push({ sourceIdx, targetIdx: targetMatch.targetIdx, sourceCol, templateCol: targetMatch.targetCol });
          // Mark this target as used
          usedTargets.add(targetMatch.targetCol);
        } else {
          console.warn(`🔍 WARNING: Could not map ${sourceCol} -> ${templateCol} (source idx: ${sourceIdx}, target match: ${targetMatch ? 'found' : 'not found'})`);
        }
      });
    } else if (mappings && mappings.mappings && Array.isArray(mappings.mappings)) {
      console.log(`🔍 [EDGE_CREATE] Processing ${mappings.mappings.length} mappings (new format)`);
      mappings.mappings.forEach((mapping, index) => {
        const sourceCol = mapping.source;
        const templateCol = mapping.target;

        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);

        console.log(`🔍 [EDGE_CREATE] Mapping ${index + 1}/${mappings.mappings.length}: '${sourceCol}' → '${templateCol}'`);
        console.log(`🔍 [EDGE_CREATE]   - Source '${sourceCol}' index: ${sourceIdx} (in ${clientHdrs.length} client headers)`);
        console.log(`🔍 [EDGE_CREATE]   - Target '${templateCol}' match:`, targetMatch);

        if (sourceIdx >= 0 && targetMatch) {
          const edge = createEdge(sourceIdx, targetMatch.targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
          mappingPairs.push({ sourceIdx, targetIdx: targetMatch.targetIdx, sourceCol, templateCol: targetMatch.targetCol });
          // Mark this target as used
          usedTargets.add(targetMatch.targetCol);
          console.log(`🔍 [EDGE_CREATE]   ✅ SUCCESS: Created edge c-${sourceIdx} → t-${targetMatch.targetIdx}`);
        } else {
          console.error(`🔍 [EDGE_CREATE]   ❌ FAILED to create edge`);
          console.error(`🔍 [EDGE_CREATE]      - sourceIdx: ${sourceIdx} ${sourceIdx < 0 ? '(NOT FOUND IN CLIENT HEADERS!)' : ''}`);
          console.error(`🔍 [EDGE_CREATE]      - targetMatch: ${targetMatch ? JSON.stringify(targetMatch) : 'NULL (NOT FOUND IN TEMPLATE HEADERS!)'}`);
          if (sourceIdx < 0) {
            console.error(`🔍 [EDGE_CREATE]      - Available client headers:`, clientHdrs);
          }
        }
      });
    } else {
      // Handle old format for backward compatibility
      Object.entries(mappings || {}).forEach(([templateCol, sourceCol]) => {
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);
        
        if (sourceIdx >= 0 && targetMatch) {
          const edge = createEdge(sourceIdx, targetMatch.targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
          mappingPairs.push({ sourceIdx, targetIdx: targetMatch.targetIdx, sourceCol, templateCol: targetMatch.targetCol });
          // Mark this target as used
          usedTargets.add(targetMatch.targetCol);
        } else {
          console.warn(`🔍 WARNING: Could not map ${sourceCol} -> ${templateCol} (source idx: ${sourceIdx}, target match: ${targetMatch ? 'found' : 'not found'})`);
        }
      });
    }
    
    // Update cache with normalized pairs for future restoration/guards
    try {
      const normalized = mappingPairs
        .filter(p => p && p.sourceCol && p.templateCol)
        .map(p => ({ source: p.sourceCol, target: p.templateCol }));
      if (normalized.length > 0) {
        mappingsCacheRef.current = normalized;
      }
    } catch (e) {
      console.warn('Failed to update mappings cache from applied mappings:', e);
    }
    
    console.log('🔍 [EDGE_CREATE] ━━━ Summary ━━━');
    console.log(`🔍 [EDGE_CREATE] Total edges created: ${newEdges.length}`);
    console.log(`🔍 [EDGE_CREATE] Total mapping pairs: ${mappingPairs.length}`);
    console.log(`🔍 [EDGE_CREATE] Edges:`, newEdges.map(e => `${e.source} → ${e.target}`));
    console.log('🔍 [EDGE_CREATE] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Set the edges
    setEdges(newEdges);

    // Update node connection states
    setTimeout(() => {
      setNodes(prev => {
        const updatedNodes = [...prev];
        
        // First, update all nodes with basic connection state
        updatedNodes.forEach(node => {
          const isConnected = newEdges.some(edge =>
            edge.source === node.id || edge.target === node.id
          );
          const isFromTemplate = newEdges.some(edge =>
            (edge.source === node.id || edge.target === node.id) && edge.data?.isFromTemplate
          );
          
          node.data = {
            ...node.data,
            isConnected,
            isFromTemplate
          };
        });
        
        // Then, update target nodes with the correct mapping labels
        mappingPairs.forEach(({ sourceIdx, targetIdx, sourceCol, templateCol }) => {
          const targetNode = updatedNodes.find(n => n.id === `t-${targetIdx}`);
          const sourceNode = updatedNodes.find(n => n.id === `c-${sourceIdx}`);
          
          if (targetNode) {
            targetNode.data = {
              ...targetNode.data,
              mappedToLabel: sourceCol
            };
          }
          
          if (sourceNode) {
            sourceNode.data = {
              ...sourceNode.data,
              mappedFromLabel: templateCol
            };
          }
        });
        
        return updatedNodes;
      });
    }, 100);
    
    setTimeout(() => {
      // Set flag to false after mappings are applied
      if (setIsInitializingMappings) {
        setIsInitializingMappings(false);
        isInitializingRef.current = false;
        
        // Mappings applied successfully - synchronize template version
        setTemplateVersion(prev => prev + 1);
        setExpectedTemplateVersion(prev => prev + 1);
      }
    }, 750); // Increased from 500ms to 750ms to ensure proper UI synchronization when coming from DataEditor

    // After applying existing mappings, add virtual edges for formulas and FactWise ID
    setTimeout(() => {
      try {
        const rules = sessionMetadata?.formula_rules || [];
        const fwRules = sessionMetadata?.factwise_rules || [];
        const targetNodes = nodes.filter(n => n.id.startsWith('t-'));

        setEdges(current => {
          const withVirtual = [...current];
          const hasEdge = (sourceIdx, targetIdx) => withVirtual.some(e => e.source === `c-${sourceIdx}` && e.target === `t-${targetIdx}`);

          // Build a quick lookup for template headers to node index
          const templateIndexByLabel = new Map();
          templateHdrs.forEach((h, idx) => templateIndexByLabel.set(h, idx));

          // Suppress virtual edges for Tag rules to avoid showing Tag_N as mapped.
          // We keep virtual hints for non-Tag formula types only.
          if (Array.isArray(rules)) {
            rules.forEach(rule => {
              const colType = rule?.column_type || 'Tag';
              if (colType !== 'Tag') {
                // Existing logic for non-Tag rules (e.g., Specification) can remain or be added here if needed.
                // For now, we do not add virtual edges for specs either to keep UI clean.
              }
            });
          }

          // Add virtual edge for FactWise ID (draw from mapped source of first_column, if available)
          if (Array.isArray(fwRules)) {
            const fw = fwRules.find(r => r && r.type === 'factwise_id');
            if (fw) {
              const firstTemplateCol = fw.first_column; // internal template field
              const itemCodeIdx = templateHdrs.indexOf('Item code');
              if (firstTemplateCol && itemCodeIdx >= 0) {
                // Find which client source maps to firstTemplateCol in current edges/cache
                let sourceCol = null;
                // Prefer cache
                const cached = mappingsCacheRef.current || [];
                const found = cached.find(m => m.target === firstTemplateCol);
                if (found && found.source) sourceCol = found.source;
                if (!sourceCol) {
                  // Inspect current edges
                  const targetNodeId = `t-${templateIndexByLabel.get(firstTemplateCol)}`;
                  const edgeToFirst = withVirtual.find(e => e.target === targetNodeId);
                  if (edgeToFirst) {
                    const srcIdx = parseInt(edgeToFirst.source.replace('c-', ''));
                    sourceCol = clientHdrs[srcIdx];
                  }
                }
                if (sourceCol) {
                  const srcIdx = clientHdrs.indexOf(sourceCol);
                  if (srcIdx >= 0 && !hasEdge(srcIdx, itemCodeIdx)) {
                    const edge = createEdge(srcIdx, itemCodeIdx, false, null, true, false);
                    edge.data = { ...(edge.data || {}), isVirtual: true, isFactwiseEdge: true };
                    withVirtual.push(edge);
                  }
                }
              }
            }
          }

          return withVirtual;
        });

        // Update node labels for virtual edges
        setTimeout(() => {
          setNodes(prev => {
            const updated = [...prev];
            // For each virtual edge, set mapped labels
            const edgesNow = [...(edges || [])];
            edgesNow.forEach(e => {
              if (e?.data?.isVirtual) {
                const srcIdx = parseInt(e.source.replace('c-', ''));
                const tgtIdx = parseInt(e.target.replace('t-', ''));
                const srcNode = updated.find(n => n.id === `c-${srcIdx}`);
                const tgtNode = updated.find(n => n.id === `t-${tgtIdx}`);
                if (tgtNode && srcNode) {
                  tgtNode.data = { ...tgtNode.data, mappedToLabel: clientHdrs[srcIdx], isConnected: true };
                  srcNode.data = { ...srcNode.data, mappedFromLabel: templateHdrs[tgtIdx], isConnected: true };
                }
              }
            });
            return updated;
          });
        }, 100);

      } catch (e) {
        console.warn('Failed to add virtual edges from rules:', e);
      }
    }, 700);
  };

  // initializeNodes function is hoisted above as function declaration to avoid TDZ

  // DUPLICATE FUNCTION REMOVED - using const declaration at line 1503 instead

  // Generate template headers based on column counts
  const generateTemplateHeaders = (counts) => {
    const headers = [
      'Item code',
      'Item name', 
      'Description',
      'Item type',
      'Measurement unit',
      'Procurement entity name'
    ];
    
    // Add tags
    for (let i = 1; i <= (counts.tags_count || 0); i++) {
      headers.push(`Tag_${i}`);
    }
    
    // Add specification pairs
    for (let i = 1; i <= (counts.spec_pairs_count || 0); i++) {
      headers.push(`Specification_Name_${i}`);
      headers.push(`Specification_Value_${i}`);
    }
    
    // Add customer identification pairs
    for (let i = 1; i <= (counts.customer_id_pairs_count || 0); i++) {
      headers.push(`Customer_Identification_Name_${i}`);
      headers.push(`Customer_Identification_Value_${i}`);
    }
    
    return headers;
  };

        

  // Convert edges to mappings format for backend
  const edgesToMappings = (edgesToConvert) => {
    // Exclude virtual edges (formula/factwise) from being persisted as mappings
    return edgesToConvert.filter(e => !(e?.data && e.data.isVirtual)).map(edge => {
      const sourceIdx = parseInt(edge.source.split('-')[1]);
      const targetIdx = parseInt(edge.target.split('-')[1]);
      const sourceColumn = clientHeaders[sourceIdx];
      
      // Get target column name from the actual node data
      const targetNode = nodes.find(n => n.id === edge.target);
      const targetColumn = targetNode ? targetNode.data.originalLabel : templateHeaders[targetIdx];
      
      return {
        source: sourceColumn,
        target: targetColumn
      };
    });
  };

  // Build mapping data with header corrections for consistent backend saves
  const buildMappingData = (edges, defaultValues = {}, additionalData = {}) => {
    const sortedEdges = [...edges]
      .filter(e => !(e?.data && e.data.isVirtual))
      .sort((a, b) => {
        const sourceA = parseInt(a.source.replace('c-', ''));
        const sourceB = parseInt(b.source.replace('c-', ''));
        return sourceA - sourceB;
      });

    const mappings = sortedEdges.map(edge => {
      const sourceIdx = parseInt(edge.source.replace('c-', ''));
      const targetIdx = parseInt(edge.target.replace('t-', ''));
      const originalSourceColumn = clientHeaders[sourceIdx];
      // Use corrected header if available, otherwise use original
      const sourceColumn = headerCorrections[originalSourceColumn] || originalSourceColumn;

      // Get target column name from the actual node data
      const targetNode = nodes.find(n => n.id === edge.target);
      const targetColumnFromIndex = templateHeaders[targetIdx];
      const targetColumn = targetNode ? targetNode.data.originalLabel : targetColumnFromIndex;

      // DEBUG LOGGING
      console.log(`📊 BUILD_MAPPING: edge ${edge.source} -> ${edge.target}`);
      console.log(`📊 BUILD_MAPPING: sourceIdx=${sourceIdx}, targetIdx=${targetIdx}`);
      console.log(`📊 BUILD_MAPPING: sourceColumn='${sourceColumn}'`);
      console.log(`📊 BUILD_MAPPING: targetNode found=${!!targetNode}, originalLabel='${targetNode?.data?.originalLabel}'`);
      console.log(`📊 BUILD_MAPPING: targetColumnFromIndex='${targetColumnFromIndex}'`);
      console.log(`📊 BUILD_MAPPING: FINAL targetColumn='${targetColumn}'`);

      return {
        source: sourceColumn,
        target: targetColumn
      };
    }).filter(mapping => mapping.source && mapping.target);

    return {
      mappings,
      default_values: defaultValues,
      default_value_rules: defaultValueRules,
      header_corrections: headerCorrections,
      ...additionalData
    };
  };

  // Save mappings to backend
  const saveMappings = async (mappingData) => {
    try {
      enhancedDebugLog('SAVE_MAPPINGS', 'Starting mapping save operation', {
        sessionId,
        mappingDataKeys: Object.keys(mappingData),
        mappingsCount: mappingData.mappings?.length || 0,
        defaultValuesCount: Object.keys(mappingData.default_values || {}).length,
        formulaRulesCount: mappingData.formula_rules?.length || 0,
        factwiseRulesCount: mappingData.factwise_rules?.length || 0,
        headerCorrectionsCount: Object.keys(mappingData.header_corrections || {}).length
      });

      // eslint-disable-next-line no-console
      
      // Log detailed mapping information
      if (mappingData.mappings && Array.isArray(mappingData.mappings)) {
        enhancedDebugLog('SAVE_MAPPINGS', 'Detailed mappings analysis', {
          totalMappings: mappingData.mappings.length,
          sourceColumns: mappingData.mappings.map(m => m.source).filter(Boolean),
          targetColumns: mappingData.mappings.map(m => m.target).filter(Boolean),
          mappingTypes: mappingData.mappings.map(m => ({
            source: m.source,
            target: m.target,
            isTag: m.target?.startsWith('Tag_'),
            isSpec: m.target?.startsWith('Specification_'),
            isCustomer: m.target?.startsWith('Customer_Identification_')
          }))
        });
      }
      
      // Log default values
      if (mappingData.default_values && Object.keys(mappingData.default_values).length > 0) {
        enhancedDebugLog('SAVE_MAPPINGS', 'Default values to save', {
          defaultValues: mappingData.default_values,
          keys: Object.keys(mappingData.default_values),
          values: Object.values(mappingData.default_values)
        });
      }
      
      // Log formula rules
      if (mappingData.formula_rules && Array.isArray(mappingData.formula_rules)) {
        enhancedDebugLog('SAVE_MAPPINGS', 'Formula rules to save', {
          formulaRules: mappingData.formula_rules,
          ruleTypes: mappingData.formula_rules.map(r => r.column_type || 'unknown'),
          targetColumns: mappingData.formula_rules.map(r => r.target_column).filter(Boolean)
        });
      }
      
      const response = await api.saveColumnMappings(sessionId, mappingData);
      
      enhancedDebugLog('SAVE_MAPPINGS', 'Backend save response received', {
        success: response.data?.success,
        message: response.data?.message,
        responseData: response.data
      });
      
      // eslint-disable-next-line no-console
      return response;
    } catch (error) {
      enhancedDebugLog('SAVE_MAPPINGS', 'Save operation failed', {
        error: error.message,
        stack: error.stack,
        sessionId,
        mappingDataKeys: Object.keys(mappingData || {})
      });
      
      // eslint-disable-next-line no-console
      console.error('❌ Error saving mappings:', error);
      throw error;
    }
  };

  // createEdge function is hoisted above as function declaration to avoid TDZ

  // Human-readable summary of a conditional rule, shown as the node's default tag.
  const describeRule = (rule) => {
    if (!rule || !rule.column) return '';
    const opText = {
      is_empty: 'is empty', not_empty: 'is not empty',
      equals: `= "${rule.compare || ''}"`, not_equals: `≠ "${rule.compare || ''}"`,
      contains: `contains "${rule.compare || ''}"`,
    }[rule.operator] || rule.operator;
    const elsePart = (rule.else !== undefined && rule.else !== '') ? `, else "${rule.else}"` : '';
    return `if ${rule.column} ${opText} → "${rule.then || ''}"${elsePart}`;
  };

  // Handle default value dialog — supports a fixed value or a conditional if/else rule.
  const handleSaveDefaultValue = async () => {
    if (!selectedTemplateField) return;
    const field = selectedTemplateField.name;
    const conditional = dvMode === 'conditional';
    if (conditional && !dvCondCol) return;
    if (!conditional && !defaultValueText.trim()) return;

    setDefaultValueLoading(true);
    try {
      let nextDefaults = {};
      let nextRules = {};
      let nodeTag = '';

      if (conditional) {
        const rule = {
          column: dvCondCol,
          operator: dvCondOp,
          compare: dvCondCompare,
          then: dvThen,
          ...(String(dvElse).trim() !== '' ? { else: dvElse } : {}),
        };
        setDefaultValueRules(prev => { nextRules = { ...(prev || {}), [field]: rule }; return nextRules; });
        // A rule replaces any fixed default for the same field.
        setDefaultValueMappings(prev => { const n = { ...(prev || {}) }; delete n[field]; nextDefaults = n; return n; });
        nodeTag = describeRule(rule);
      } else {
        const val = defaultValueText.trim();
        setDefaultValueMappings(prev => { nextDefaults = { ...(prev || {}), [field]: val }; return nextDefaults; });
        setDefaultValueRules(prev => { const n = { ...(prev || {}) }; delete n[field]; nextRules = n; return n; });
        nodeTag = val;
      }

      // Update the template node to show the default/rule tag.
      setNodes(currentNodes => currentNodes.map(node => (
        node.id === selectedTemplateField.id
          ? { ...node, data: { ...node.data, hasDefaultValue: true, defaultValue: nodeTag } }
          : node
      )));

      // Persist immediately so the rule survives before the next autosave.
      try {
        api.saveColumnMappings(sessionId, buildMappingData(edges, nextDefaults, { default_value_rules: nextRules, force_persist: true }));
      } catch (_) {}

      await new Promise(resolve => setTimeout(resolve, 400));
      setShowDefaultValueDialog(false);
      setSelectedTemplateField(null);
      setDefaultValueText('');
    } finally {
      setDefaultValueLoading(false);
    }
  };

  const handleClearDefaultValue = async () => {
    if (!selectedTemplateField) return;
    
    setDefaultValueLoading(true);
    
    try {
      const field = selectedTemplateField.name;
      let nextDefaults = {};
      let nextRules = {};
      setDefaultValueMappings(prev => {
        const next = { ...(prev || {}) };
        delete next[field];
        nextDefaults = next;
        return next;
      });
      setDefaultValueRules(prev => {
        const next = { ...(prev || {}) };
        delete next[field];
        nextRules = next;
        return next;
      });

      // Persist cleared defaults + rules with current mappings
      try {
        const payload = buildMappingData(edges, nextDefaults, { default_value_rules: nextRules });
        api.saveColumnMappings(sessionId, payload);
      } catch (_) {}
      
      // Wait for 1 second to show loading state
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setShowDefaultValueDialog(false);
      setDefaultValueText('');
    } finally {
      setDefaultValueLoading(false);
    }
  };

  const handleCancelDefaultValue = () => {
    setShowDefaultValueDialog(false);
    setSelectedTemplateField(null);
    setDefaultValueText('');
  };

  // Clear template mappings and start over
  const clearTemplateMappings = () => {
    setMappingHistory(prev => [...prev, { nodes, edges }]);
    setEdges([]);
    setNodes(prev => prev.map(node => ({
      ...node,
      data: {
        ...node.data,
        label: node.data.originalLabel,
        isConnected: false,
        isFromTemplate: false,
        isSpecificationMapping: false,
        confidence: undefined,
        isSelected: false,
        mappedToLabel: '',
        mappedFromLabel: ''
      }
    })));
    setSelectedSourceNode(null);
    setSelectedEdge(null);
    setTemplateApplied(false);
    setAppliedTemplateName('');
    setTemplateMappingCount(0);
    setSpecificationMappingsApplied(false);
    setOriginalTemplateId(null);
    setTemplateSuccess(false);
    
    // eslint-disable-next-line no-console
  };

  const isCompleteMapping = () => {
    const targetHeaders = (useDynamicTemplate && templateColumns.length > 0) ? templateColumns : templateHeaders;
    const targetNodeIds = targetHeaders.map((_, idx) => `t-${idx}`);
    const mappedTargets = edges.map(edge => edge.target);
    return targetNodeIds.every(targetId => mappedTargets.includes(targetId));
  };

  // Enhanced node click handling for selection and mapping
  const onNodeClick = useCallback(async (event, node) => {
    event.stopPropagation();
    
    if (node.id.startsWith('c-')) {
      // Source node clicked
      if (selectedSourceNode === node.id) {
        // Deselect if already selected
        setSelectedSourceNode(null);
        setNodes(prev => prev.map(n => ({ ...n, data: { ...n.data, isSelected: false } })));
      } else {
        // Select new source node
        setSelectedSourceNode(node.id);
        setNodes(prev => prev.map(n => ({ ...n, data: { ...n.data, isSelected: n.id === node.id } })));
      }
    } else if (node.id.startsWith('t-') && selectedSourceNode) {
      // Target node clicked with source selected - check if we should show loader
      const showLoader = shouldShowMappingLoader();
      if (showLoader) {
        setMappingActionLoading(true);
      }
      
      try {
        const sourceIdx = parseInt(selectedSourceNode.replace('c-', ''));
        const targetIdx = parseInt(node.id.replace('t-', ''));
        
        setMappingHistory(prev => [...prev, { nodes, edges }]);

        // Allow multiple connections from one source and multiple connections to same target
        const newEdge = createEdge(sourceIdx, targetIdx, false);
        setEdges(prev => addEdge(newEdge, prev));
        
        // Update node connection states
        const sourceNode = nodes.find(n => n.id === selectedSourceNode);
        
        setNodes(prev => prev.map(n => {
          if (n.id === selectedSourceNode) {
            // Update source node with target node's label
            const targetNode = prev.find(t => t.id === node.id);
            return {
              ...n,
              data: {
                ...n.data,
                isSelected: false,
                isConnected: true,
                mappedFromLabel: targetNode ? targetNode.data.originalLabel : ''
              }
            };
          }
          if (n.id === node.id) {
            // Update target node with source node's label
            return {
              ...n,
              data: {
                ...n.data,
                label: node.data.originalLabel,
                mappedToLabel: sourceNode.data.originalLabel,
                isConnected: true,
                isSelected: false,
                isFromTemplate: false, // Manual mapping overrides template
                isSpecificationMapping: false // Manual mapping overrides specification
              }
            };
          }
          return n;
        }));
        
        // Only wait and show loader on every 3rd mapping
        if (showLoader) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        setSelectedSourceNode(null);
      } finally {
        if (showLoader) {
          setMappingActionLoading(false);
        }
      }
    } else if (node.id.startsWith('t-') && !selectedSourceNode) {
      // Template node clicked without source selected - check if unmapped
      const targetIdx = parseInt(node.id.replace('t-', ''));
      const isNodeMapped = edges.some(edge => edge.target === node.id);
      
      if (!isNodeMapped) {
        // Unmapped template field clicked - open default value dialog
        const targetHeaders = (useDynamicTemplate && templateColumns.length > 0) ? templateColumns : templateHeaders;
        const templateFieldName = targetHeaders[targetIdx];

        if (templateFieldName) {
          setSelectedTemplateField({ id: node.id, name: templateFieldName, index: targetIdx });
          setDefaultValueText(defaultValueMappings[templateFieldName] || '');
          // Prefill the conditional-rule fields from any saved rule for this field.
          const rule = (defaultValueRules || {})[templateFieldName];
          if (rule && rule.column) {
            setDvMode('conditional');
            setDvCondCol(rule.column || '');
            setDvCondOp(rule.operator || 'is_empty');
            setDvCondCompare(rule.compare || '');
            setDvThen(rule.then || '');
            setDvElse(rule.else || '');
          } else {
            setDvMode('always');
            setDvCondCol(''); setDvCondOp('is_empty'); setDvCondCompare(''); setDvThen(''); setDvElse('');
          }
          setShowDefaultValueDialog(true);
        } else {
          // eslint-disable-next-line no-console
          console.warn('🔧 DEBUG: Template field name not found for index', targetIdx);
        }
      }
    }
  }, [selectedSourceNode, nodes, edges, setNodes, setEdges, templateHeaders, templateColumns, useDynamicTemplate, defaultValueMappings]);

  // L) Auto-mapping with rebuild guard
  const handleAutoMap = async () => {
    // L) Early return if rebuilding
    if (isRebuildingRef.current) return;
    
    if (edges.length > 0) {
      setShowAutoMapConfirm(true);
    } else {
      proceedWithAutoMap();
    }
  };

  const proceedWithAutoMap = async () => {
    // L) Early return if rebuilding
    if (isRebuildingRef.current) return;
    
    setShowAutoMapConfirm(false);
    setIsAutoMapping(true);
    setMappingHistory(prev => [...prev, { nodes, edges }]);
    
    try {
      // Clear existing edges
      setEdges([]);
      
      // Get AI suggestions from API
      const { data } = await api.getColumnMappingSuggestions(sessionId);
      const { user_columns, template_columns, ai_suggestions, specification_opportunity, session_metadata } = data;
      
      // eslint-disable-next-line no-console
      
      // ENHANCED: Extract template information from session metadata if available
      if (session_metadata && session_metadata.original_template_id) {
        setOriginalTemplateId(session_metadata.original_template_id);
        // eslint-disable-next-line no-console
      }
      
      // Handle specification opportunity
      if (specification_opportunity && specification_opportunity.detected) {
        // setSpecificationOpportunity(specification_opportunity);
        // eslint-disable-next-line no-console
      }
      
      // COMMENTED OUT: Handle specification overflow - show alert
      // if (specification_overflow && specification_overflow.detected) {
      //   setSpecificationOverflow(specification_overflow);
      //   setShowSpecOverflowAlert(true);
      // }
      
      // SIMPLE edge creation - direct straight arrows
      const newEdges = [];
      const mappings = [];
      
      Object.entries(ai_suggestions).forEach(([templateCol, info]) => {
        if (!info.suggested_column) return;
        
        const sourceIdx = user_columns.indexOf(info.suggested_column);
        const targetIdx = template_columns.indexOf(templateCol);
        
        if (sourceIdx >= 0 && targetIdx >= 0) {
          const isSpecMapping = info.is_specification_mapping || false;
          const edge = createEdge(
            sourceIdx, 
            targetIdx, 
            true, 
            info.confidence, 
            false, 
            isSpecMapping
          );
          newEdges.push(edge);
          mappings.push({
            sourceIdx,
            targetIdx,
            confidence: info.confidence,
            isSpecificationMapping: isSpecMapping
          });
        }
      });
      
      // Add edges progressively with FAST animation
      for (let i = 0; i < newEdges.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Much faster!
        setEdges(prev => [...prev, newEdges[i]]);
        
        // Update node connection states
        const mapping = mappings[i];
        const sourceNode = nodes.find(n => n.id === `c-${mapping.sourceIdx}`);
        setNodes(prev => prev.map(node => {
          if (node.id === `c-${mapping.sourceIdx}`) {
            const targetNode = prev.find(n => n.id === `t-${mapping.targetIdx}`);
            return {
              ...node,
              data: {
                ...node.data,
                isConnected: true,
                mappedFromLabel: targetNode ? targetNode.data.originalLabel : ''
              }
            };
          }
          if (node.id === `t-${mapping.targetIdx}`) {
            return {
              ...node,
              data: {
                ...node.data,
                label: node.data.originalLabel,
                mappedToLabel: sourceNode.data.originalLabel,
                isConnected: true,
                isFromTemplate: false, // AI mapping, not template
                isSpecificationMapping: mapping.isSpecificationMapping,
                confidence: mapping.confidence
              }
            };
          }
          return node;
        }));
      }
      
      // Clear template applied state since we're now using AI
      setTemplateApplied(false);
      
      // Set specification mappings applied if any spec mappings were created
      const hasSpecMappings = mappings.some(m => m.isSpecificationMapping);
      setSpecificationMappingsApplied(hasSpecMappings);
      
    } catch (err) {
      console.error('Auto-mapping failed:', err);
      setError('Auto-mapping failed. Please try again.');
    } finally {
      setIsAutoMapping(false);
    }
  };

  // REMOVED: Dynamic reordering of target nodes to preserve original column order
  // The previous logic was reordering nodes based on mapping status, which violated
  // the requirement to maintain the exact order from the uploaded Excel file.

  // Handle new connections
  const onConnect = useCallback(async (connection) => {
    // A destination column takes exactly one source. One source may still feed
    // several destinations (1 → many). Alternates that need row-expansion are
    // handled later by the editor's "Expand Alternates into Rows" tool, so the
    // old "stack two sources onto one column" path no longer exists here.
    const targetAlreadyMapped = edges.some(e => e.target === connection.target);
    if (targetAlreadyMapped) {
      setError('Each destination column takes one source. To reuse a source, connect it to several destinations instead — a destination can’t take two sources.');
      return;
    }

    // Check if we should show loader (every 3rd mapping)
    const showLoader = shouldShowMappingLoader();
    if (showLoader) {
      setMappingActionLoading(true);
    }

    try {
      setMappingHistory(prev => [...prev, { nodes, edges }]);

      // Allow multiple connections from one source and multiple connections to same target
      const newEdge = createEdge(
        parseInt(connection.source.replace('c-', '')),
        parseInt(connection.target.replace('t-', '')),
        false
      );
      setEdges(prevEdges => addEdge(newEdge, prevEdges));
      
      // Get source and target nodes
      const sourceNode = nodes.find(n => n.id === connection.source);
      const targetNode = nodes.find(n => n.id === connection.target);
      
      // Update node connection states
      setNodes(prev => prev.map(node => {
        if (node.id === connection.source) {
          // Update source node with target node's label
          return {
            ...node,
            data: {
              ...node.data,
              isConnected: true,
              isFromTemplate: false, // Manual connection overrides template
              isSpecificationMapping: false, // Manual connection overrides specification
              mappedFromLabel: targetNode ? targetNode.data.originalLabel : ''
            }
          };
        }
        if (node.id === connection.target) {
          // Update target node with source node's label
          return {
            ...node,
            data: {
              ...node.data,
              isConnected: true,
              isFromTemplate: false, // Manual connection overrides template
              isSpecificationMapping: false, // Manual connection overrides specification
              mappedToLabel: sourceNode ? sourceNode.data.originalLabel : ''
            }
          };
        }
        return node;
      }));
      
      // Only wait and show loader on every 3rd mapping
      if (showLoader) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      if (showLoader) {
        setMappingActionLoading(false);
      }
    }
  }, [nodes, edges, setEdges, setNodes, shouldShowMappingLoader]);

  // Handle edge click for deletion
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation();
    setSelectedEdge(edge.id);
  }, []);

  // Delete selected edge with confidence removal
  const deleteSelectedEdge = () => {
    if (selectedEdge) {
      // Prevent automatic mapping restore after dynamic +/- right after a deletion
      suppressRestoreRef.current = true;
      setMappingHistory(prev => [...prev, { nodes, edges }]);

      const edgeToDelete = edges.find(e => e.id === selectedEdge);
      const newEdges = edges.filter(edge => edge.id !== selectedEdge);
      // If this is a virtual edge (green arrow), suppress it so it won't reappear on refresh
      if (edgeToDelete?.data?.isVirtual) {
        try {
          const srcIdx = parseInt(edgeToDelete.source.replace('c-', ''));
          const tgtIdx = parseInt(edgeToDelete.target.replace('t-', ''));
          const sourceCol = clientHeaders[srcIdx];
          const targetNode = nodes.find(n => n.id === edgeToDelete.target);
          const targetCol = targetNode?.data?.originalLabel || templateHeaders[tgtIdx];
          if (sourceCol && targetCol) {
            const key = `${sourceCol}||${targetCol}`;
            suppressedVirtualsRef.current.add(key);
            persistSuppressedVirtuals();
          }
        } catch (_) {}
      }
      // Persist deletion for real edges immediately
      try {
        const payload = buildMappingData(newEdges, defaultValueMappings, { force_persist: true });
        api.saveColumnMappings(sessionId, payload);
      } catch (_) {}
      setEdges(newEdges);
      
      // Update node connection states and remove confidence
      setTimeout(() => {
        setNodes(prev => prev.map(node => {
          if (edgeToDelete && (node.id === edgeToDelete.source || node.id === edgeToDelete.target)) {
            const stillConnected = edges.some(edge =>
              edge.id !== selectedEdge && (edge.source === node.id || edge.target === node.id)
            );
            
            if (stillConnected) {
              // Node is still connected to other edges
              return {
                ...node,
                data: {
                  ...node.data,
                  isConnected: true,
                  isFromTemplate: node.data.isFromTemplate,
                  isSpecificationMapping: node.data.isSpecificationMapping
                }
              };
            } else {
              // Node is no longer connected to any edges - reset all mapping properties
              return {
                ...node,
                data: {
                  ...node.data,
                  label: node.data.originalLabel,
                  isConnected: false,
                  isFromTemplate: false,
                  isSpecificationMapping: false,
                  confidence: undefined,
                  mappedToLabel: '',
                  mappedFromLabel: ''
                }
              };
            }
          }
          return node;
        }));
      }, 100);
      
      setSelectedEdge(null);
      // Also clear cache for restoration so deleted mapping doesn't reappear
      try { mappingsCacheRef.current = newEdges.map(e => {
        const srcIdx = parseInt(e.source.replace('c-',''));
        const tgtNode = nodes.find(n => n.id === e.target);
        const tgtIdx = parseInt(e.target.replace('t-',''));
        const src = clientHeaders[srcIdx];
        const tgt = tgtNode ? tgtNode.data?.originalLabel : templateHeaders[tgtIdx];
        return (src && tgt) ? { source: src, target: tgt } : null;
      }).filter(Boolean); } catch (_) {}
    }
  };

  // Helper: persist suppressed virtuals to sessionStorage
  const persistSuppressedVirtuals = () => {
    try {
      const key = `virtualSuppressions_${sessionId}`;
      sessionStorage.setItem(key, JSON.stringify(Array.from(suppressedVirtualsRef.current)));
    } catch (_) {}
  };

  const clearMappings = () => {
    setMappingHistory(prev => [...prev, { nodes, edges }]);
    suppressRestoreRef.current = true;
    setEdges([]);
    setDefaultValueMappings({});
    mappingsCacheRef.current = [];
    resetMappingCounter();
    setNodes(prev => prev.map(node => ({
      ...node,
      data: {
        ...node.data,
        label: node.data.originalLabel,
        isConnected: false,
        isFromTemplate: false,
        isSpecificationMapping: false,
        confidence: undefined,
        isSelected: false,
        mappedToLabel: '',
        mappedFromLabel: '',
        hasDefaultValue: false,
        defaultValue: ''
      }
    })));
    setSelectedSourceNode(null);
    setSelectedEdge(null);
    setTemplateApplied(false);
    setSpecificationMappingsApplied(false);
    setOriginalTemplateId(null);
    setTemplateSuccess(false);

    sessionStorage.removeItem('currentMapping');
    try {
      api.saveColumnMappings(sessionId, { mappings: [], default_values: {}, header_corrections: {}, force_persist: true });
    } catch (_) {}
  };

  const undoLastAction = () => {
    if (mappingHistory.length === 0) return;

    const lastState = mappingHistory[mappingHistory.length - 1];
    if (lastState && lastState.nodes && Array.isArray(lastState.nodes)) {
      setNodes(lastState.nodes);
      setEdges(lastState.edges || []);
      setMappingHistory(prev => prev.slice(0, -1));
      setSelectedSourceNode(null);
      setSelectedEdge(null);
      resetMappingCounter();
      return;
    }

    console.warn('Invalid state in mapping history, reinitializing nodes');
    initializeNodes(clientHeaders, templateHeaders, null, [], defaultValueMappings, setIsInitializingMappings);
    setEdges([]);
    setMappingHistory([]);
    resetMappingCounter();
  };

  // Clear selection when clicking elsewhere or pressing escape
  const onPaneClick = useCallback(() => {
    setSelectedEdge(null);
    setSelectedSourceNode(null);
    setNodes(prev => prev.map(n => ({
      ...n,
      data: { ...n.data, isSelected: false }
    })));
  }, [setNodes]);

  // NOTE: Removed unnecessary reinitialisation on default value changes
  // Default values are now handled in autosave without dropping edges
  // This prevents the reinit loops that were causing mapping instability
  
  // Track template readiness to prevent review with stale data
  useEffect(() => {
    const ready = edges.length > 0 && templateVersion >= expectedTemplateVersion;
    setIsReady(ready);
  }, [edges.length, templateVersion, expectedTemplateVersion]);

  // Ensure default value / rule tags are applied to nodes when either changes.
  useEffect(() => {
    setNodes(currentNodes => currentNodes.map(node => {
      if (!node.id.startsWith('t-')) return node; // Only update template nodes
      const fieldName = node.data?.originalLabel;
      const hasVal = fieldName && Object.prototype.hasOwnProperty.call(defaultValueMappings || {}, fieldName);
      const rule = fieldName ? (defaultValueRules || {})[fieldName] : null;
      const hasRule = !!(rule && rule.column);
      const tag = hasRule ? describeRule(rule) : (hasVal ? defaultValueMappings[fieldName] : '');
      return {
        ...node,
        data: {
          ...node.data,
          hasDefaultValue: hasVal || hasRule,
          defaultValue: tag
        }
      };
    }));
  }, [defaultValueMappings, defaultValueRules, setNodes]);

  // Update nodes with confidence scores when they are loaded for PDF sessions
  useEffect(() => {
    if (isFromPDF && headerConfidenceScores && Object.keys(headerConfidenceScores).length > 0) {
      setNodes(prev => prev.map(node => {
        if (node.id.startsWith('c-')) {
          const header = node.data.originalLabel;
          const confidence = headerConfidenceScores[header];
          if (confidence !== undefined) {
            return {
              ...node,
              data: {
                ...node.data,
                confidence: confidence,
                isFromPDF: true
              }
            };
          }
        }
        return node;
      }));
    }
  }, [headerConfidenceScores, isFromPDF, setNodes]);

  // Ensure edit affordance is enabled for PDF sessions even before confidences arrive
  useEffect(() => {
    if (isFromPDF) {
      setNodes(prev => prev.map(node => {
        if (node.id.startsWith('c-') && !node.data?.isFromPDF) {
          return { ...node, data: { ...node.data, isFromPDF: true } };
        }
        return node;
      }));
    }
  }, [isFromPDF, setNodes]);

  // Add escape key handling
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedEdge(null);
        setSelectedSourceNode(null);
        setNodes(prev => prev.map(n => ({
          ...n,
          data: { ...n.data, isSelected: false }
        })));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [setNodes]);



  // Update mapping statistics and auto-save mappings
  useEffect(() => {
    const aiMappings = edges.filter(e => e.data?.isAiGenerated);
    const templateMappings = edges.filter(e => e.data?.isFromTemplate);
    const specificationMappings = edges.filter(e => e.data?.isSpecificationMapping);
    const manualMappings = edges.filter(e => !e.data?.isAiGenerated && !e.data?.isFromTemplate && !e.data?.isSpecificationMapping);
    
    const confidenceStats = {
      high: aiMappings.filter(e => e.data?.confidence >= 0.8).length,
      medium: aiMappings.filter(e => e.data?.confidence >= 0.6 && e.data?.confidence < 0.8).length,
      low: aiMappings.filter(e => e.data?.confidence < 0.6).length
    };
    
    setMappingStats({
      total: edges.length,
      manual: manualMappings.length,
      ai: aiMappings.length,
      template: templateMappings.length,
      specification: specificationMappings.length,
      confidence: confidenceStats
    });

    // ENHANCED: Auto-save mappings to sessionStorage with template information
    if (edges.length > 0 && clientHeaders.length > 0 && templateHeaders.length > 0) {
      // Always use internal headers for mapping
      const targetHeaders = templateHeaders;
      const mappingForRestore = {
        mappings: edges.map(edge => ({
          sourceColumn: clientHeaders[parseInt(edge.source.replace('c-', ''))],
          targetColumn: targetHeaders[parseInt(edge.target.replace('t-', ''))],
          isAiGenerated: edge.data?.isAiGenerated || false,
          isFromTemplate: edge.data?.isFromTemplate || false,
          isSpecificationMapping: edge.data?.isSpecificationMapping || false,
          confidence: edge.data?.confidence
        })),
        sessionId: sessionId,
        originalTemplateId: originalTemplateId, // 🔥 ENHANCED: Include template ID
        templateApplied: templateApplied,        // 🔥 ENHANCED: Include template state
        appliedTemplateName: appliedTemplateName, // 🔥 ENHANCED: Include template name
        templateSuccess: templateSuccess,        // 🔥 ENHANCED: Include success state
        lastSaved: Date.now()                   // 🔥 ENHANCED: Include timestamp
      };
      
      sessionStorage.setItem('currentMapping', JSON.stringify(mappingForRestore));
    }
  }, [edges, clientHeaders, templateHeaders, sessionId, originalTemplateId, templateApplied, appliedTemplateName, templateSuccess]);

  // Debug logging for isInitializingMappings flag
  useEffect(() => {
    // eslint-disable-next-line no-console
    isInitializingRef.current = isInitializingMappings;
  }, [isInitializingMappings]);

  // E) Debounced autosave with rebuild guard and label-based targeting
  useEffect(() => {
    // E) Early return if rebuilding or still initializing (check both state and ref)
    if (isRebuildingRef.current || isInitializingMappings || isInitializingRef.current || applyingTemplate) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - rebuilding or initializing', {
        isRebuilding: isRebuildingRef.current,
        isInitializingMappings,
        isInitializingRef: isInitializingRef.current,
        applyingTemplate
      });
      // eslint-disable-next-line no-console
      return;
    }
    if (!sessionId || clientHeaders.length === 0) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - missing session or headers', {
        hasSessionId: !!sessionId,
        clientHeadersLength: clientHeaders.length
      });
      return;
    }

    // ADDITIONAL SAFETY CHECK: If we're navigating back and have very few edges,
    // it might mean we're still loading existing mappings. Skip autosave.
    if (edges.length === 0) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - no edges yet', {
        edgesLength: edges.length,
        mightBeLoading: true
      });
      // eslint-disable-next-line no-console
      return;
    }

    // ADDITIONAL SAFETY CHECK: If we're still loading, skip autosave
    if (loading) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - still loading', {
        loading,
        edgesLength: edges.length
      });
      // eslint-disable-next-line no-console
      return;
    }

    enhancedDebugLog('AUTOSAVE', 'Autosave triggered', {
      isInitializingMappings,
      isInitializingRef: isInitializingRef.current,
      edgesCount: edges.length,
      sessionId,
      clientHeadersLength: clientHeaders.length
    });

    // eslint-disable-next-line no-console

    const timer = setTimeout(async () => {
      try {
        enhancedDebugLog('AUTOSAVE', 'Starting autosave execution', {
          edgesCount: edges.length,
          nodesCount: nodes.length,
          defaultValueMappingsCount: Object.keys(defaultValueMappings).length
        });

        // Build mapping data with header corrections for consistent backend saves
        // CRITICAL FIX: Preserve formula_rules and factwise_rules from session to prevent autosave from clearing them
        const payload = buildMappingData(edges, defaultValueMappings, {
          formula_rules: sessionMetadata?.formula_rules || null,
          factwise_rules: sessionMetadata?.factwise_rules || null
        });

        enhancedDebugLog('AUTOSAVE', 'Computed mappings from edges with header corrections', {
          totalEdges: edges.length,
          validMappings: payload.mappings.length,
          mappings: payload.mappings,
          headerCorrections: payload.header_corrections,
          edgeDetails: edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            sourceColumn: clientHeaders[parseInt(edge.source.replace('c-', ''))],
            targetColumn: nodes.find(n => n.id === edge.target)?.data?.originalLabel
          }))
        });


        // CRITICAL FIX: Be more careful about when to skip autosave
        // Only skip if we have no mappings AND we're not in a rebuild scenario
        if (payload.mappings.length === 0 && !isRebuildingRef.current) {
          // Check if this is during a column count update (rebuilding scenario)
          const isColumnCountUpdate = sessionStorage.getItem('recentColumnCountUpdate') === 'true';

          if (!isColumnCountUpdate) {
            enhancedDebugLog('AUTOSAVE', 'No mappings to save - skipping to prevent data loss', {
              mappingsLength: payload.mappings.length,
              edgesLength: edges.length,
              isRebuilding: isRebuildingRef.current,
              isColumnCountUpdate
            });
            return;
          } else {
            // Clear the flag after handling
            sessionStorage.removeItem('recentColumnCountUpdate');
          }
        }

        // Store current mappings count for tracking
        sessionStorage.setItem('previousMappingsCount', payload.mappings.length.toString());

        // Update cache for reliable restoration/guards (allow empty mappings too)
        mappingsCacheRef.current = payload.mappings;
        enhancedDebugLog('AUTOSAVE', 'Updated mappings cache', {
          cacheCount: mappingsCacheRef.current.length,
          mappings: mappingsCacheRef.current
        });

        enhancedDebugLog('AUTOSAVE', 'Preparing autosave payload', {
          payloadKeys: Object.keys(payload),
          mappingsCount: payload.mappings.length,
          defaultValuesCount: Object.keys(defaultValueMappings).length,
          headerCorrectionsCount: Object.keys(payload.header_corrections).length,
          payload: payload
        });


        await api.saveColumnMappings(sessionId, payload);
        
        enhancedDebugLog('AUTOSAVE', 'Autosave completed successfully', {
          mappingsSaved: payload.mappings.length,
          defaultValuesSaved: Object.keys(defaultValueMappings).length,
          headerCorrectionsSaved: Object.keys(payload.header_corrections).length,
          sessionId
        });
        
        // eslint-disable-next-line no-console
      } catch (e) {
        enhancedDebugLog('AUTOSAVE', 'Autosave failed with error', {
          error: e.message,
          stack: e.stack,
          sessionId,
          edgesCount: edges.length
        });
        
        // eslint-disable-next-line no-console
        console.error('❌ Debounced autosave failed:', e);
      }
    }, 800); // 🔥 OPTIMIZED: Reduced delay for faster mapping while ensuring save completion

    return () => clearTimeout(timer);
  }, [edges, defaultValueMappings, clientHeaders, nodes, sessionId, isInitializingMappings, templateHeaders, loading, applyingTemplate]);

  // ENHANCED: Navigate to review page - UPDATED TO SEND TO BACKEND with template preservation
  // Ensure pending text edits/defaults are committed before proceeding
  const commitPendingEdits = async () => {
    try {
      if (document && document.activeElement) {
        document.activeElement.blur();
      }
    } catch (_) {}
    // Two rafs then a short timeout to let React state settle
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 120));
  };

  

  // Stacking alternates from the mapping screen was removed — alternate
  // row-expansion is now an editor step ("Expand Alternates into Rows").

  const handleReview = async () => {
    if (edges.length === 0) {
      setError('Please create at least one mapping before reviewing.');
      return;
    }

    setIsReviewing(true);
    setIsProcessingMappings(true);
    setGlobalLoading(true);
    const reviewStartTs = Date.now();
    try { showSnackbar('Finalizing mappings… syncing latest data', 'info'); } catch (_) {}
    // Commit any pending inline edits/default value changes made just before clicking Review
    await commitPendingEdits();
    setError(null);

    try {
      // Create mapping data structure for backend using centralized function
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console
      // eslint-disable-next-line no-console

      const mappingData = buildMappingData(edges, defaultValueMappings);

      const response = await api.saveColumnMappings(sessionId, mappingData);

      // Proactively re-apply any existing formula rules to avoid missing Tag/Factwise columns on Azure
      try {
        const rules = Array.isArray(formulaRulesRef.current) ? formulaRulesRef.current : [];
        if (rules.length > 0) {
          // CRITICAL FIX: Pass mappings that were just saved
          await api.applyFormulas(sessionId, rules, mappingData.mappings);
        }
      } catch (e) {
        console.warn('Formula re-apply skipped/failed:', e?.message || e);
      }

      // ENHANCED: Save comprehensive mapping info to sessionStorage for restoration
      const mappingForRestore = {
        mappings: edges.map(edge => {
          const sourceIdx = parseInt(edge.source.replace('c-', ''));
          const targetNode = nodes.find(n => n.id === edge.target);
          const targetColumn = targetNode ? targetNode.data.originalLabel : templateHeaders[parseInt(edge.target.replace('t-', ''))];
          
          return {
            sourceColumn: clientHeaders[sourceIdx],
            targetColumn: targetColumn,
            isAiGenerated: edge.data?.isAiGenerated || false,
            isFromTemplate: edge.data?.isFromTemplate || false,
            isSpecificationMapping: edge.data?.isSpecificationMapping || false,
            confidence: edge.data?.confidence
          };
        }),
        sessionId: sessionId,
        originalTemplateId: originalTemplateId,     // 🔥 PRESERVE TEMPLATE ID
        templateApplied: templateApplied,            // 🔥 PRESERVE TEMPLATE STATE
        appliedTemplateName: appliedTemplateName,    // 🔥 PRESERVE TEMPLATE NAME
        templateSuccess: templateSuccess,            // 🔥 PRESERVE SUCCESS STATE
        specParsingEnabled: specificationMappingsApplied, // 🔥 PRESERVE SPEC STATE
        savedAt: Date.now(),                        // 🔥 ADD TIMESTAMP
        reviewCompleted: true                       // 🔥 MARK AS REVIEWED
      };
      
      sessionStorage.setItem('currentMapping', JSON.stringify(mappingForRestore));
      

      // CRITICAL FIX: Actively wait for fresh mapped data and expected columns on Azure
      const waitOk = await waitForReviewReadiness({
        sessionId,
        templateHeaders,
        expectFormulas: (Array.isArray(formulaRulesRef.current) && formulaRulesRef.current.length > 0) ||
                        (Array.isArray(factwiseRulesRef.current) && factwiseRulesRef.current.length > 0),
        formulaRules: Array.isArray(formulaRulesRef.current) ? formulaRulesRef.current : [],
        enforceFactwiseFilled: Array.isArray(factwiseRulesRef.current) && factwiseRulesRef.current.length > 0,
      });

      // Detect MPN column from first page (Tag_*/Specification_Value_* only) and hint the editor
      try {
        const resp = await api.getMappedDataWithSpecs(sessionId, 1, 250, true, { stable: true, force_fresh: true, _ts: Date.now() });
        const d = resp?.data || {};
        const headers = Array.isArray(d.headers) ? d.headers : [];
        const rows = Array.isArray(d.data) ? d.data : [];
        const clean = (v) => String(v ?? '').trim();
        const isLikely = (v) => {
          const s0 = clean(v);
          if (!s0) return false;
          const s = s0.replace(/\s+/g, '');
          if (s.length < 3 || s.length > 64) return false;
          if (/^(unknown|n\/a|null|none)$/i.test(s0)) return false;
          if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return false;
          if (!/^[A-Za-z0-9\-_.\/]+$/.test(s)) return false;
          if (/(.)\1{5,}/.test(s)) return false;
          return true;
        };
        const candidates = headers.filter(h => h === 'Tag' || String(h || '').startsWith('Tag_') || h === 'Specification value' || String(h || '').startsWith('Specification_Value_'));
        const scoreHeader = (h) => {
          const idx = headers.indexOf(h);
          if (idx < 0) return 0;
          const sample = rows.slice(0, Math.min(rows.length, 300));
          let total = 0, good = 0;
          for (const r of sample) {
            const v = Array.isArray(r) ? r[idx] : r[h];
            if (!clean(v)) continue;
            total += 1;
            if (isLikely(v)) good += 1;
          }
          if (total === 0) return 0;
          let ratio = good / total;
          const name = (h || '').toLowerCase();
          if (/\bmpn\b/.test(name)) ratio += 0.25;
          if (/\bcpn\b/.test(name) || /customer\s*part/.test(name)) ratio -= 0.4;
          if (/specification\s*value/.test(name)) ratio += 0.05;
          if (/\btag\b/.test(name)) ratio += 0.02;
          return ratio;
        };
        let best = null, bestScore = 0;
        for (const h of candidates) {
          const s = scoreHeader(h);
          if (s > bestScore) { bestScore = s; best = h; }
        }
        if (best && bestScore >= 0.3) {
          // Store hint for the editor
          sessionStorage.setItem(`mpnAutoColumn_${sessionId}`, best);
        }
      } catch (e) {
        console.warn('MPN auto-detect (review) skipped:', e?.message || e);
      }

      // Enforce a minimum 3s hold to absorb rapid user transitions and ensure backend settle
      const elapsed = Date.now() - reviewStartTs;
      if (elapsed < 3000) {
        await new Promise(resolve => setTimeout(resolve, 3000 - elapsed));
      }
      
      // CRITICAL FIX: Set synchronization flags for DataEditor to ensure fresh data fetch
      sessionStorage.setItem('recentColumnCountUpdate', 'true');
      // Set both flags for compatibility across pages
      sessionStorage.setItem('navigationFromDataEditor', 'true');
      sessionStorage.setItem('navigatedFromDataEditor', 'true');
      
      // Force a higher version to trigger refresh
      const finalVersion = response?.data?.template_version || Date.now();
      sessionStorage.setItem(`templateVersion_${sessionId}`, finalVersion.toString());
      sessionStorage.setItem(`lastMappingUpdate_${sessionId}`, Date.now().toString());

      // Before the editor, ask which mapped column is the item key and drop rows
      // where it's empty. This is the primary-key cleanup, now at Review so it
      // runs the same for Excel, OCR, and PDF-zonal sources.
      const gridCols = (response?.data?.enhanced_headers || templateHeaders || [])
        .filter((h, i, a) => h && a.indexOf(h) === i);
      setPrimaryKeyOptions(gridCols);
      setPrimaryKeyColumn(gridCols.find(c => String(c).toLowerCase() === 'item code') || '');
      try {
        const smap = await api.getColumnSourceMap(sessionId);
        setPrimaryKeySources(smap?.data?.sources || {});
      } catch (_) { setPrimaryKeySources({}); }
      setPrimaryDialogOpen(true);

    } catch (err) {
      console.error('Error saving mappings:', err);
      setError('Failed to save mappings. Please try again.');
    } finally {
      setIsReviewing(false);
      setIsProcessingMappings(false); // 🔥 FAST NAVIGATION FIX: Re-enable navigation
      setGlobalLoading(false); // 🔥 LOADER FIX: Clear global loader when done
      try { closeSnackbar(); } catch (_) {}
    }
  };

  const goToEditor = useCallback(() => {
    setPrimaryDialogOpen(false);
    const sid = sessionId;
    setTimeout(() => navigate(`/editor/${sid}`), 0);
  }, [sessionId, navigate]);

  const handleCleanupAndReview = useCallback(async () => {
    if (!primaryKeyColumn) { goToEditor(); return; }
    try {
      setPrimaryCleaning(true);
      const res = await api.cleanupGridRows(sessionId, primaryKeyColumn);
      if (res.data?.success) {
        const v = res.data.template_version || Date.now();
        sessionStorage.setItem(`templateVersion_${sessionId}`, v.toString());
        if (res.data.removed > 0) {
          setSnackbar({ open: true, message: `Removed ${res.data.removed} row(s) with an empty "${primaryKeyColumn}".`, severity: 'success' });
        }
      }
    } catch (e) {
      // Non-fatal — proceed to the editor anyway.
      console.warn('Primary-key cleanup failed:', e);
    } finally {
      setPrimaryCleaning(false);
      goToEditor();
    }
  }, [primaryKeyColumn, sessionId, goToEditor]);

  // Robust Azure-ready readiness check before navigating to review/editor
  // Waits for mapped data to materialize and for expected Tag/Factwise columns
  const waitForReviewReadiness = useCallback(async ({ sessionId, templateHeaders, expectFormulas, formulaRules, enforceFactwiseFilled = false }) => {
    // Subtle UX: inform user we are preparing fresh data
    try { showSnackbar('Preparing data… syncing latest changes…', 'info'); } catch (_) {}
    const timeoutMs = 12000; // 12s max wait on Azure
    const start = Date.now();
    let appliedOnce = false;

    const minHeaders = Array.isArray(templateHeaders) && templateHeaders.length > 0
      ? templateHeaders.length
      : 1;

    const hasRequiredFormulaColumns = (headers) => {
      if (!expectFormulas) return true; // Nothing to enforce
      if (!Array.isArray(headers) || headers.length === 0) return false;
      const h = headers.map(x => String(x || '').toLowerCase());
      const anyTag = headers.some(x => typeof x === 'string' && (x.startsWith('Tag_') || x === 'Tag'));
      const anySpec = headers.some(x => typeof x === 'string' && (x.startsWith('Specification_Name_') || x.startsWith('Specification_Value_')));
      const anyCust = headers.some(x => typeof x === 'string' && (x.startsWith('Customer_Identification_Name_') || x.startsWith('Customer_Identification_Value_')));
      const hasFactwise = h.some(v => v.includes('factwise') || v === 'item code' || v === 'item_code');
      return anyTag || anySpec || anyCust || hasFactwise;
    };

    while (Date.now() - start < timeoutMs) {
      try {
        // Force fresh fetch to bypass any caching layers
        const resp = await api.getMappedDataWithSpecs(sessionId, 1, 50, true, { force_fresh: true, _fresh: Date.now() });
        const data = resp?.data || {};
        const headers = data.headers || [];

        const headerOk = headers.length >= minHeaders;
        const formulasOk = hasRequiredFormulaColumns(headers);

        // Optional: enforce that Item code has data when factwise rules are present
        let factwiseOk = true;
        if (enforceFactwiseFilled) {
          // Find the header name for item code in a case-insensitive way
          let itemHeader = null;
          for (const h of headers) {
            const hl = String(h || '').trim().toLowerCase().replace(/\s+/g, '');
            if (hl === 'itemcode' || hl === 'item_code') { itemHeader = h; break; }
          }
          if (itemHeader) {
            const rows = Array.isArray(data.data) ? data.data : [];
            let nonEmpty = 0;
            for (const row of rows) {
              if (row && typeof row === 'object') {
                const v = row[itemHeader];
                if (v !== undefined && v !== null && String(v).trim() !== '') { nonEmpty++; if (nonEmpty >= 1) break; }
              }
            }
            factwiseOk = nonEmpty >= 1 || rows.length === 0; // At least one filled value when rows exist
          } else {
            factwiseOk = false;
          }
        }

        if (headerOk && formulasOk && factwiseOk) {
          try { closeSnackbar(); } catch (_) {}
          return true;
        }

        // If formulas expected but not visible yet, try to re-apply once
        if (expectFormulas && !formulasOk && !appliedOnce && Array.isArray(formulaRules) && formulaRules.length > 0) {
          try {
            // CRITICAL FIX: Get current mappings to send with formula apply
            let currentMappings = null;
            try {
              const mappingsResponse = await api.getExistingMappings(sessionId);
              if (mappingsResponse.data && mappingsResponse.data.mappings) {
                const mappingsData = mappingsResponse.data.mappings;
                if (mappingsData.mappings && Array.isArray(mappingsData.mappings)) {
                  currentMappings = mappingsData.mappings;
                } else if (Array.isArray(mappingsData)) {
                  currentMappings = mappingsData;
                }
              }
            } catch (err) { /* ignore */ }
            await api.applyFormulas(sessionId, formulaRules, currentMappings);
            appliedOnce = true;
          } catch (e) {
            console.warn('Formula re-apply during readiness failed:', e?.message || e);
          }
        }
      } catch (e) {
        // Non-fatal; keep polling
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.warn('⏰ Review readiness timed out; proceeding to editor with auto-refresh');
    try { closeSnackbar(); } catch (_) {}
    return false;
  }, []);

  // Error state
  if (error) {
    return (
      <div className="w-full h-screen bg-gradient-to-br from-slate-50 to-red-50 flex items-center justify-center">
        <div className="text-center bg-white rounded-2xl shadow-2xl p-10">
          <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h2 className="text-xl font-bold text-red-600 mb-4">{error}</h2>
          <button 
            onClick={() => window.location.reload()} 
            className="px-8 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-semibold"
          >
            Retry Loading
          </button>
        </div>
      </div>
    );
  }

  const flowLayout = getFlowLayout();
  const flowRowHeight = flowLayout.nodeHeight + flowLayout.nodeSpacing;
  const appHeaderOffset = '54px';
  const topActionBase = 'h-10 rounded-full border text-sm font-bold shadow-sm transition-colors disabled:pointer-events-none';
  const sidebarButtonBase = 'w-full h-11 px-4 rounded-full flex items-center gap-3 text-sm font-medium transition-all disabled:opacity-50';
  const sidePanelClass = `rounded-2xl border p-4 ${
    isDarkMode ? 'bg-slate-900/70 border-slate-800' : 'bg-slate-50 border-slate-200'
  }`;
  const sideSectionLabelClass = `text-[11px] font-medium uppercase tracking-[0.06em] mb-2.5 ${
    isDarkMode ? 'text-slate-400' : 'text-slate-500'
  }`;
  const primaryBluePillClass = `rounded-full bg-blue-600 text-white shadow-[0_14px_28px_-16px_rgba(37,99,235,0.9)] hover:bg-blue-700 hover:shadow-[0_18px_34px_-18px_rgba(37,99,235,0.95)] hover:-translate-y-0.5 ${
    isDarkMode ? 'disabled:bg-slate-800 disabled:text-slate-500' : 'disabled:bg-slate-200 disabled:text-slate-400'
  }`;
  const muiPillButtonSx = {
    borderRadius: '999px',
    px: 2.5,
    py: 0.85,
    fontWeight: 700,
    textTransform: 'none',
    boxShadow: 'none'
  };
  const muiPrimaryPillSx = {
    ...muiPillButtonSx,
    bgcolor: '#2563eb',
    color: '#ffffff',
    boxShadow: '0 14px 28px -16px rgba(37, 99, 235, 0.9)',
    '&:hover': {
      bgcolor: '#1d4ed8',
      boxShadow: '0 18px 34px -18px rgba(37, 99, 235, 0.95)'
    }
  };
  const mappingDialogPaperSx = {
    borderRadius: '18px',
    overflow: 'hidden',
    bgcolor: isDarkMode ? '#111827' : '#ffffff',
    color: isDarkMode ? '#f8fafc' : '#0f172a',
    border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
    boxShadow: isDarkMode
      ? '0 28px 80px rgba(0, 0, 0, 0.72)'
      : '0 24px 70px rgba(15, 23, 42, 0.18)'
  };
  const mappingDialogHeaderSx = {
    px: 3,
    pt: 2.5,
    pb: 1.25,
    bgcolor: isDarkMode ? '#111827' : '#ffffff'
  };
  const mappingDialogBodySx = {
    px: 3,
    py: 1.5,
    bgcolor: isDarkMode ? '#111827' : '#ffffff'
  };
  const mappingDialogFooterSx = {
    px: 3,
    py: 2,
    gap: 1,
    bgcolor: isDarkMode ? '#111827' : '#f8fafc',
    borderTop: isDarkMode ? '1px solid rgba(148, 163, 184, 0.12)' : '1px solid #e2e8f0'
  };
  const dialogInputClass = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
    isDarkMode
      ? 'bg-slate-950/60 border-slate-700 text-slate-100 placeholder:text-slate-500'
      : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
  }`;
  const dialogSelectClass = `rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
    isDarkMode
      ? 'bg-slate-950/60 border-slate-700 text-slate-100'
      : 'bg-slate-50 border-slate-200 text-slate-900'
  }`;
  const dialogLabelClass = `block text-sm font-medium mb-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`;

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">


      {/* Clean Top Header - Theme Adaptive & Premium */}
      <div className={`px-6 py-3.5 border-b shadow-md transition-colors ${
        isDarkMode ? 'bg-[#0b101b] border-slate-800 text-white' : 'bg-white/95 backdrop-blur-md border-slate-200 text-slate-800'
      }`}>
        <div className="flex flex-wrap justify-between items-center gap-3">
          {/* Left side - Back button, Logo and Template Status */}
          <div className="flex items-center gap-3">
            <Tooltip title="Back to Upload Files" arrow placement="bottom">
              <button
                onClick={() => navigate('/upload')}
                aria-label="Back to Upload Files"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-sm transition-all ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                <ArrowLeft size={18} />
              </button>
            </Tooltip>

            <div className={`text-base font-extrabold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Column Mapping
            </div>

            <div className="ml-2 flex items-center gap-2">
              <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full transition-all ${
                syncNotice.visible
                  ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
              }`}>
                {syncNotice.visible ? 'Cache' : 'Fresh'}
              </span>
            </div>
          </div>
          
          {/* Right side - Action buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Tooltip title="Refresh headers and mappings" arrow placement="bottom">
              <button
                onClick={() => { try { if (loadDataRef.current) loadDataRef.current(); } catch(_) {} }}
                className={`${topActionBase} px-4 flex items-center gap-2 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-slate-200'
                    : 'bg-white border-blue-100 text-slate-700'
                } ${statusPolling ? 'opacity-70' : ''}`}
              >
                <span>{statusPolling ? 'Syncing...' : 'Refresh'}</span>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  isDarkMode ? 'bg-blue-500/20 text-blue-200' : 'bg-blue-600 text-white'
                }`}>
                  <RefreshCw size={15} className={statusPolling ? 'animate-spin' : ''} />
                </span>
              </button>
            </Tooltip>

            <Tooltip title="Automatically match the strongest column pairs" arrow placement="bottom">
              <button
                type="button"
                onClick={handleAutoMap}
                disabled={isAutoMapping || isRebuildingRef.current}
                className={`h-10 px-4 rounded-full border text-sm font-medium flex items-center gap-2 transition-all disabled:pointer-events-none disabled:opacity-60 ${
                  isAutoMapping
                    ? isDarkMode
                      ? 'bg-slate-900 border-slate-700 text-slate-400'
                      : 'bg-slate-100 border-slate-200 text-slate-500'
                    : isDarkMode
                      ? 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-sm shadow-blue-950/30'
                      : 'bg-blue-600 hover:bg-blue-700 border-blue-600 text-white shadow-sm shadow-blue-500/25'
                }`}
              >
                {isAutoMapping ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Brain size={15} />
                )}
                <span>{isAutoMapping ? 'Mapping...' : 'Auto Map'}</span>
              </button>
            </Tooltip>

            <Tooltip title="Apply a saved mapping template" arrow placement="bottom">
              <button
                type="button"
                onClick={() => {
                  setShowTemplateDialog(true);
                  loadAvailableTemplates();
                }}
                disabled={applyingTemplate || templatesLoading}
                className={`h-10 px-4 rounded-full border text-sm font-medium flex items-center gap-2 transition-all disabled:pointer-events-none disabled:opacity-60 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
                    : 'bg-white border-blue-100 text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                <Library size={15} />
                <span>{applyingTemplate || templatesLoading ? 'Loading...' : 'Apply Template'}</span>
              </button>
            </Tooltip>

            <Tooltip title="Review mapped data" arrow placement="bottom">
              <button
                onClick={handleReview}
                disabled={edges.length === 0 || isReviewing || isRebuildingRef.current || !isReady || isProcessingMappings || applyingTemplate}
                className={`
                  h-10 px-5 text-sm font-bold flex items-center gap-2 transition-all disabled:pointer-events-none
                  ${edges.length > 0 && !isReviewing && !isProcessingMappings
                    ? primaryBluePillClass
                    : `${primaryBluePillClass} opacity-60`
                  }
                `}
              >
                {isReviewing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Preparing…</span>
                  </>
                ) : (
                  <>
                    <ArrowRight size={15} />
                    <span>Review</span>
                  </>
                )}
              </button>
            </Tooltip>

            <Tooltip title="Open mapping menu" arrow placement="bottom">
              <button
                type="button"
                onClick={() => {
                  setRulesOpen(false);
                  setSideMenuOpen(true);
                }}
                className={`h-10 w-10 rounded-full border shadow-sm transition-all flex items-center justify-center ${
                  isDarkMode
                    ? 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-blue-950/25'
                    : 'bg-blue-600 hover:bg-blue-700 border-blue-600 text-white shadow-blue-500/25'
                }`}
                aria-label="Open mapping menu"
              >
                <AnimatedMenuGlyph open={sideMenuOpen} stroke="currentColor" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Right Action Sidebar */}
      {sideMenuOpen && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 flex justify-end"
          style={{ top: appHeaderOffset, height: `calc(100vh - ${appHeaderOffset})` }}
        >
          <button
            type="button"
            aria-label="Close mapping menu"
            onClick={() => setSideMenuOpen(false)}
            className={`absolute inset-0 ${
              isDarkMode ? 'bg-slate-950/70' : 'bg-slate-900/25'
            }`}
          />
          <aside className={`relative h-full w-full max-w-[400px] border-l shadow-2xl flex flex-col font-sans transition-colors ${
            isDarkMode
              ? 'bg-[#0b101b] border-slate-800 text-white'
              : 'bg-white border-slate-200 text-slate-900'
          }`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between ${
              isDarkMode ? 'border-slate-800' : 'border-slate-200'
            }`}>
              <div className="min-w-0 pr-3">
                <div className={`text-[11px] font-medium uppercase tracking-[0.06em] ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  Tools
                </div>
                <div className="text-base font-semibold mt-1 truncate">Column Mapping</div>
              </div>
              <button
                type="button"
                onClick={() => setSideMenuOpen(false)}
                className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                  isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
                }`}
                aria-label="Close mapping menu"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <section>
                <h3 className={sideSectionLabelClass}>
                  Data
                </h3>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => { try { if (loadDataRef.current) loadDataRef.current(); } catch(_) {} }}
                    className={`${sidebarButtonBase} ${
                      isDarkMode ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
                    } ${statusPolling ? 'opacity-70' : ''}`}
                  >
                    <RefreshCw size={18} />
                    <span>{statusPolling ? 'Syncing...' : 'Refresh'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRebuildColumns}
                    disabled={rebuildingColumns || isRebuildingRef.current}
                    className={`${sidebarButtonBase} ${
                      isDarkMode ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <Settings size={18} />
                    <span>{rebuildingColumns ? 'Rebuilding...' : 'Rebuild Columns'}</span>
                  </button>
                </div>
              </section>

              <section>
                <h3 className={sideSectionLabelClass}>
                  Mapping
                </h3>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSideMenuOpen(false);
                      setRulesOpen(true);
                    }}
                    className={`${sidebarButtonBase} ${
                      isDarkMode ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <FileText size={18} />
                    <span>Tag Rules</span>
                  </button>
                </div>
              </section>

              <section>
                <h3 className={sideSectionLabelClass}>
                  History
                </h3>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={undoLastAction}
                    disabled={
                      !hasMeaningfulHistory() || applyingTemplate || templateApplied ||
                      isReviewing || isRebuildingRef.current || isProcessingMappings
                    }
                    className={`${sidebarButtonBase} disabled:opacity-45 ${
                      isDarkMode ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <RotateCcw size={17} />
                    <span>Undo</span>
                  </button>

                  <button
                    type="button"
                    onClick={clearMappings}
                    className={`${sidebarButtonBase} ${
                      isDarkMode ? 'hover:bg-red-500/10 text-red-300' : 'hover:bg-red-50 text-red-600'
                    }`}
                  >
                    <Trash2 size={17} />
                    <span>Clear All</span>
                  </button>
                </div>
              </section>

            </div>

            <div className={`p-5 border-t ${
              isDarkMode ? 'border-slate-800' : 'border-slate-200'
            }`}>
              <button
                type="button"
                onClick={handleReview}
                disabled={edges.length === 0 || isReviewing || isRebuildingRef.current || !isReady || isProcessingMappings || applyingTemplate}
                className={`w-full h-12 text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:pointer-events-none ${
                  edges.length > 0 && !isReviewing && !isProcessingMappings
                    ? primaryBluePillClass
                    : `${primaryBluePillClass} opacity-60`
                }`}
              >
                {isReviewing ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ArrowRight size={17} />
                )}
                <span>{isReviewing ? 'Preparing...' : 'Review'}</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Tag Rules Drawer */}
      {rulesOpen && (
        <div
          className="fixed left-0 right-0 bottom-0 z-50 flex justify-end"
          style={{ top: appHeaderOffset, height: `calc(100vh - ${appHeaderOffset})` }}
        >
          <button
            type="button"
            aria-label="Close tag rules"
            onClick={() => setRulesOpen(false)}
            className={`absolute inset-0 ${
              isDarkMode ? 'bg-slate-950/70' : 'bg-slate-900/25'
            }`}
          />
          <div className={`relative h-full w-full max-w-[420px] shadow-2xl border-l flex flex-col font-sans transition-colors ${
            isDarkMode ? 'bg-[#0b101b] border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
          <div className={`px-5 py-4 border-b flex items-center justify-between ${
            isDarkMode ? 'border-slate-800' : 'border-slate-200'
          }`}>
            <div className="min-w-0 pr-3">
              <div className={`text-[11px] font-medium uppercase tracking-[0.06em] ${
                isDarkMode ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Rules
              </div>
              <div className="text-base font-semibold mt-1 truncate">Active Tag Rules</div>
            </div>
            <button
              type="button"
              onClick={() => setRulesOpen(false)}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                isDarkMode ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
              }`}
              aria-label="Close tag rules"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-5 overflow-auto">
            {Array.isArray(sessionMetadata?.formula_rules) && sessionMetadata.formula_rules.length > 0 ? (
              sessionMetadata.formula_rules.map((rule, idx) => (
                <div key={idx} className={`mb-4 p-4 rounded-xl border ${
                  isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold">Rule {idx + 1}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isDarkMode ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    }`}>{rule.column_type || 'Tag'}</span>
                  </div>
                  <div className={`text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Source: <span className="font-mono">{rule.source_column || '-'}</span></div>
                  <div className={`text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Target: <span className="font-mono">{rule.target_column || 'Tag'}</span></div>
                  {rule.column_type === 'Specification Value' && (
                    <div className={`text-xs mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Spec Name: <span className="font-mono">{rule.specification_name || '-'}</span></div>
                  )}
                  <div className="mt-2">
                    <div className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>Conditions:</div>
                    {(rule.sub_rules || []).map((sr, j) => (
                      <div key={j} className={`text-xs flex justify-between border-b py-1 gap-3 ${
                        isDarkMode ? 'text-slate-300 border-slate-800' : 'text-slate-700 border-slate-200'
                      }`}>
                        <div className="truncate mr-2">if contains <span className="font-mono">{sr.search_text}</span></div>
                        <div className="truncate">then <span className="font-mono">{sr.output_value}</span></div>
                      </div>
                    ))}
                    {(!rule.sub_rules || rule.sub_rules.length === 0) && (
                      <div className={`text-xs italic ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>No conditions defined</div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>No Tag rules active for this session.</div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* COMMENTED OUT: Specification Overflow Alert */}
      {/* {showSpecOverflowAlert && specificationOverflow && (
        <div className="bg-gradient-to-r from-orange-500 to-red-600 text-white px-8 py-4 shadow-lg">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6" />
              <div>
                <div className="font-bold text-lg">Specification Overflow Detected!</div>
                <div className="text-orange-100">
                  {specificationOverflow.message}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowSpecOverflowAlert(false);
                  // Maybe navigate to upload a new template with more spec columns
                }}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg flex items-center gap-2 transition-all font-semibold"
              >
                <Upload size={16} />
                Upload New Template
              </button>
              <button
                onClick={() => setShowSpecOverflowAlert(false)}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      )} */}

      {/* Template Applied Banner */}
      {templateApplied && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-8 py-4 shadow-lg">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Library className="w-6 h-6" />
              <div>
                <div className="font-bold text-lg">Template Applied Successfully!</div>
                <div className="text-green-100">
                  {templateMappingCount} column mappings from "{appliedTemplateName}" have been applied. You can modify them or add more mappings below.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={clearTemplateMappings}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg flex items-center gap-2 transition-all font-semibold"
              >
                <RefreshCw size={16} />
                Start Over
              </button>
              <button
                onClick={() => setTemplateApplied(false)}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Specification Mappings Applied Banner */}
      {specificationMappingsApplied && (
        <div className="bg-gradient-to-r from-orange-500 to-amber-600 text-white px-8 py-4 shadow-lg">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Settings className="w-6 h-6" />
              <div>
                <div className="font-bold text-lg">Specification Parsing Applied!</div>
                <div className="text-orange-100">
                  Description columns have been automatically mapped to specification fields. When you review the data, descriptions will be parsed into structured specifications.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSpecificationMappingsApplied(false)}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && !loading && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-8 mt-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <div className="ml-auto pl-3">
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Flow Area */}
      <div className={`flex-1 relative overflow-hidden flex transition-colors ${
        isDarkMode ? 'bg-[#070d18]' : 'bg-slate-50'
      }`} data-layout-tick={flowLayoutTick}>
        <aside className={`hidden xl:flex w-[340px] shrink-0 border-r flex-col overflow-y-auto px-5 py-5 space-y-5 ${
          isDarkMode
            ? 'bg-[#0b101b]/92 border-slate-800 text-white'
            : 'bg-white/88 border-slate-200 text-slate-900'
        }`}>
          <section className={sidePanelClass}>
            <h3 className={`${sideSectionLabelClass} mb-4`}>
              Template Column Counts
            </h3>
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Tags</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: Math.max(1, columnCounts.tags_count - 1),
                      spec_pairs_count: columnCounts.spec_pairs_count || 3,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 1
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCounts.tags_count <= 1 || columnCountLoading}
                  >
                    -
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{columnCounts.tags_count}</span>
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count + 1,
                      spec_pairs_count: columnCounts.spec_pairs_count || 3,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 1
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCountLoading}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Spec Pairs</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 3,
                      spec_pairs_count: Math.max(1, columnCounts.spec_pairs_count - 1),
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCounts.spec_pairs_count <= 1 || columnCountLoading}
                  >
                    -
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{columnCounts.spec_pairs_count}</span>
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 3,
                      spec_pairs_count: columnCounts.spec_pairs_count + 1,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCountLoading}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Customer ID Pairs</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 3,
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: Math.max(1, columnCounts.customer_id_pairs_count - 1)
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCounts.customer_id_pairs_count <= 1 || columnCountLoading}
                  >
                    -
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{columnCounts.customer_id_pairs_count}</span>
                  <button
                    type="button"
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 3,
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count + 1
                    })}
                    className={`h-7 w-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
                      isDarkMode ? 'bg-slate-950/60 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                    disabled={columnCountLoading}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className={`mt-4 pt-3 border-t flex items-center justify-between text-sm ${
              isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
            }`}>
              <span>Total columns</span>
              <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{templateHeaders.length}</span>
            </div>
          </section>

          <section className={sidePanelClass}>
            <h3 className={`${sideSectionLabelClass} mb-4`}>
              Mapping Statistics
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-lg border p-3 ${
                isDarkMode ? 'bg-blue-950/30 border-blue-800/40 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}>
                <div className="text-xl font-semibold">{mappingStats.total}</div>
                <div className="text-xs font-medium mt-1">Total Mapped</div>
              </div>
              <div className={`rounded-lg border p-3 ${
                isDarkMode ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}>
                <div className="text-xl font-semibold">{mappingStats.template}</div>
                <div className="text-xs font-medium mt-1">From Template</div>
              </div>
              <div className={`rounded-lg border p-3 ${
                isDarkMode ? 'bg-teal-950/30 border-teal-800/40 text-teal-200' : 'bg-teal-50 border-teal-200 text-teal-800'
              }`}>
                <div className="text-xl font-semibold">{mappingStats.ai}</div>
                <div className="text-xs font-medium mt-1">AI Suggested</div>
              </div>
              <div className={`rounded-lg border p-3 ${
                isDarkMode ? 'bg-purple-950/30 border-purple-800/40 text-purple-200' : 'bg-purple-50 border-purple-200 text-purple-800'
              }`}>
                <div className="text-xl font-semibold">{mappingStats.manual}</div>
                <div className="text-xs font-medium mt-1">Manual</div>
              </div>
            </div>
            <div className={`mt-4 rounded-full h-2 overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div
                className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                style={{
                  width: `${templateHeaders.length > 0 ? Math.min(100, (mappingStats.total / templateHeaders.length) * 100) : 0}%`
                }}
              />
            </div>
            <div className={`mt-2 text-xs font-semibold ${
              isDarkMode ? 'text-slate-400' : 'text-slate-500'
            }`}>
              {mappingStats.total} of {templateHeaders.length} columns mapped
            </div>
          </section>
        </aside>
        
        {/* Main mapping area */}
        <div className="flex-1 relative">
          {/* Fixed section headers aligned to the centered node lanes. */}
          <div className={`sticky top-0 z-30 h-[78px] backdrop-blur-xl ${
            isDarkMode
              ? 'bg-[#070d18]/94'
              : 'bg-white/88'
          }`}>
            <div className="h-full w-full grid grid-cols-2 items-center gap-8 px-10">
              <div className="flex justify-center min-w-0">
                <div className={`max-w-full rounded-xl border px-4 py-2.5 font-extrabold flex items-center gap-2.5 whitespace-nowrap transition-colors ${
                  isDarkMode
                    ? 'bg-blue-500/10 border-blue-400/25 text-blue-100 shadow-[0_14px_30px_-24px_rgba(59,130,246,0.8)]'
                    : 'bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-300 text-blue-800 shadow-[0_14px_30px_-24px_rgba(37,99,235,0.7)]'
                }`}>
                  <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                    isDarkMode ? 'bg-blue-400/15 text-blue-200' : 'bg-blue-50 text-blue-600'
                  }`}>
                    <FileText size={16} />
                  </span>
                  <span>Client File ({clientHeaders.length} fields)</span>
                  <Tooltip title={clientFileName ? `File: ${clientFileName}` : 'Client file'} placement="bottom">
                    <span><Info size={15} className="opacity-70 cursor-default" /></span>
                  </Tooltip>
                </div>
              </div>

              <div className="flex justify-center min-w-0">
                <div className={`max-w-full rounded-xl border px-4 py-2.5 font-extrabold flex items-center gap-2.5 whitespace-nowrap transition-colors ${
                  isDarkMode
                    ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-100 shadow-[0_14px_30px_-24px_rgba(16,185,129,0.8)]'
                    : 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-300 text-emerald-800 shadow-[0_14px_30px_-24px_rgba(5,150,105,0.65)]'
                }`}>
                  <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                    isDarkMode ? 'bg-emerald-400/15 text-emerald-200' : 'bg-emerald-50 text-emerald-600'
                  }`}>
                    <Library size={16} />
                  </span>
                  <span>FW Item Template ({templateHeaders.length} fields)</span>
                  <Tooltip title={templateFileName ? `File: ${templateFileName}` : 'Template file'} placement="bottom">
                    <span><Info size={15} className="opacity-70 cursor-default" /></span>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>

          {/* Instructions */}
          {selectedSourceNode && (
            <div className={`fixed left-1/2 transform -translate-x-1/2 z-30 rounded-xl border shadow-lg px-4 py-2 ${
              isDarkMode
                ? 'bg-purple-950/82 border-purple-500/35 text-purple-100'
                : 'bg-purple-50/96 border-purple-200 text-purple-800'
            }`} style={{ top: '218px' }}>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-purple-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-semibold">
                  Click on a Template column to create mapping
                </span>
              </div>
            </div>
          )}

          {selectedEdge && (
            <div className={`fixed left-1/2 transform -translate-x-1/2 z-30 rounded-xl border shadow-lg px-4 py-2.5 ${
              isDarkMode
                ? 'bg-red-950/90 border-red-700/70 text-red-100'
                : 'bg-red-50/95 border-red-200 text-red-800'
            }`} style={{ top: '214px' }}>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold">Connection selected</span>
                <span className={`text-xs font-semibold ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>ESC to cancel</span>
                <button
                  onClick={deleteSelectedEdge}
                  className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-extrabold transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* React Flow Container with padding for headers */}
          <div className="w-full h-full overflow-auto" style={{ paddingTop: 28 }}>
            <div style={{ 
              width: '100%', 
              height: Math.max(760, Math.max(clientHeaders.length, templateHeaders.length) * flowRowHeight + 220) 
            }}>
              <ReactFlowProvider>
                <ReactFlow
                  nodes={nodes}
                  edges={edges.map((edge, index) => {
                    const isSelected = selectedEdge === edge.id;
                    const isOtherSelected = selectedEdge && selectedEdge !== edge.id;
                    
                    return {
                      ...edge,
                      style: {
                        ...edge.style,
                        strokeWidth: isSelected ? 3.5 : edge.style.strokeWidth,
                        stroke: isSelected 
                          ? '#ef4444'
                          : edge.style.stroke,
                        strokeOpacity: isSelected ? 0.96 : edge.style.strokeOpacity,
                        opacity: isOtherSelected ? 0.2 : 1,
                        filter: isSelected 
                          ? 'drop-shadow(0 5px 8px rgba(239, 68, 68, 0.22))' 
                          : edge.style.filter
                      },
                      markerEnd: {
                        ...edge.markerEnd,
                        color: isSelected ? '#ef4444' : edge.markerEnd.color,
                        width: isSelected ? 17 : edge.markerEnd.width,
                        height: isSelected ? 17 : edge.markerEnd.height
                      }
                    };
                  })}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onEdgeClick={onEdgeClick}
                  onNodeClick={onNodeClick}
                  onPaneClick={onPaneClick}
                  nodeTypes={nodeTypes}
                  connectionLineStyle={{ stroke: isDarkMode ? '#60a5fa' : '#2563eb', strokeWidth: 2.5, strokeOpacity: 0.85 }}
                  connectionLineType="bezier"
                  defaultViewport={{ x: 0, y: 0, zoom: flowLayout.defaultZoom }}
                  minZoom={0.4}
                  maxZoom={1.2}
                  zoomOnScroll={true}
                  zoomOnPinch={true}
                  zoomOnDoubleClick={false}
                  preventScrolling={false}
                  panOnDrag={true}
                  panOnScroll={false}
                  nodesDraggable={false}
                  nodesConnectable={true}
                  elementsSelectable={true}
                  fitView={false}
                  className={isDarkMode ? 'bg-[#070d18]' : 'bg-slate-50'}
                >
                  <Background 
                    gap={24} 
                    size={1.2} 
                    color={isDarkMode ? '#1e293b' : '#dbeafe'} 
                    style={{ opacity: isDarkMode ? 0.35 : 0.55 }}
                  />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </div>
        </div>
      </div>

      {/* Default Value Dialog */}
      <Dialog
        open={showDefaultValueDialog}
        onClose={handleCancelDefaultValue}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
            bgcolor: isDarkMode ? '#111827' : '#ffffff',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
            boxShadow: isDarkMode
              ? '0 28px 80px rgba(0, 0, 0, 0.72)'
              : '0 24px 70px rgba(15, 23, 42, 0.18)'
          }
        }}
      >
        <DialogContent sx={{ p: 3, bgcolor: isDarkMode ? '#111827' : '#ffffff' }}>
          <div className="space-y-6">
            <div className="text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${
                isDarkMode ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'
              }`}>
                <FileText className="w-7 h-7" />
              </div>
              <h2 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-slate-50' : 'text-slate-900'}`}>
                Set Default Value
              </h2>
              <p className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>
                Set the value for:{' '}
                <span className={isDarkMode ? 'font-semibold text-blue-300' : 'font-semibold text-blue-600'}>
                  {selectedTemplateField?.name}
                </span>
              </p>
            </div>

            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDvMode('always')}
                  className={`flex-1 px-3 py-2 rounded-full text-sm font-medium border transition-colors ${dvMode === 'always' ? 'bg-blue-600 text-white border-blue-600 shadow-[0_12px_24px_-16px_rgba(37,99,235,0.9)]' : isDarkMode ? 'bg-slate-950/60 text-slate-300 border-slate-700 hover:bg-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  Same value for every row
                </button>
                <button
                  type="button"
                  onClick={() => setDvMode('conditional')}
                  className={`flex-1 px-3 py-2 rounded-full text-sm font-medium border transition-colors ${dvMode === 'conditional' ? 'bg-blue-600 text-white border-blue-600 shadow-[0_12px_24px_-16px_rgba(37,99,235,0.9)]' : isDarkMode ? 'bg-slate-950/60 text-slate-300 border-slate-700 hover:bg-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >
                  If / else rule
                </button>
              </div>

              {dvMode === 'always' ? (
                <div>
                  <label className={dialogLabelClass}>Default Text</label>
                  <input
                    type="text"
                    value={defaultValueText}
                    onChange={(e) => setDefaultValueText(e.target.value)}
                    placeholder="Enter text to fill all cells in this column..."
                    className={dialogInputClass}
                    autoFocus
                  />
                </div>
              ) : (
                <div className={`space-y-3 border rounded-2xl p-3 ${
                  isDarkMode ? 'border-slate-700 bg-slate-950/25' : 'border-slate-200 bg-slate-50/70'
                }`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>If</span>
                    <select
                      value={dvCondCol}
                      onChange={(e) => setDvCondCol(e.target.value)}
                      className={`flex-1 min-w-[140px] ${dialogSelectClass}`}
                    >
                      <option value="">Choose column…</option>
                      {((useDynamicTemplate && templateColumns.length > 0) ? templateColumns : templateHeaders)
                        .filter(Boolean)
                        .map((h) => (<option key={h} value={h}>{h}</option>))}
                    </select>
                    <select
                      value={dvCondOp}
                      onChange={(e) => setDvCondOp(e.target.value)}
                      className={dialogSelectClass}
                    >
                      <option value="is_empty">is empty</option>
                      <option value="not_empty">is not empty</option>
                      <option value="equals">equals</option>
                      <option value="not_equals">does not equal</option>
                      <option value="contains">contains</option>
                    </select>
                    {(dvCondOp === 'equals' || dvCondOp === 'not_equals' || dvCondOp === 'contains') && (
                      <input
                        type="text"
                        value={dvCondCompare}
                        onChange={(e) => setDvCondCompare(e.target.value)}
                        placeholder="text"
                        className={`flex-1 min-w-[100px] ${dialogSelectClass}`}
                      />
                    )}
                  </div>
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>then set the value to</label>
                    <input type="text" value={dvThen} onChange={(e) => setDvThen(e.target.value)}
                      placeholder='e.g. "Finished good"'
                      className={dialogInputClass} />
                  </div>
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>otherwise set the value to</label>
                    <input type="text" value={dvElse} onChange={(e) => setDvElse(e.target.value)}
                      placeholder="leave empty to keep existing value"
                      className={dialogInputClass} />
                  </div>
                </div>
              )}

              <div className={`border rounded-2xl p-4 ${
                isDarkMode ? 'bg-blue-500/10 border-blue-500/25' : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex items-start gap-3">
                  <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDarkMode ? 'text-blue-300' : 'text-blue-600'}`} />
                  <div className={`text-sm ${isDarkMode ? 'text-blue-100' : 'text-blue-800'}`}>
                    <p className="font-medium mb-1">How this works:</p>
                    <p>
                      Fills the "{selectedTemplateField?.name}" column when the data is processed —
                      either the same value everywhere, or a value that depends on another column
                      (e.g. <em>if MPN Code is empty → "Finished good", otherwise → "RM"</em>).
                    </p>
                  </div>
                </div>
              </div>
            </div>

              <div className={`flex justify-end gap-3 pt-4 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                <button
                  onClick={handleCancelDefaultValue}
                  className={`px-5 py-2 rounded-full font-medium transition-colors ${
                    isDarkMode ? 'text-slate-300 hover:bg-slate-800 hover:text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  Cancel
                </button>
                {selectedTemplateField?.name && (
                  (defaultValueMappings && Object.prototype.hasOwnProperty.call(defaultValueMappings, selectedTemplateField.name)) ||
                  (defaultValueRules && Object.prototype.hasOwnProperty.call(defaultValueRules, selectedTemplateField.name))
                ) && (
                  <button
                    onClick={handleClearDefaultValue}
                    disabled={defaultValueLoading}
                    className={`px-5 py-2 rounded-full font-medium transition-colors flex items-center gap-2 disabled:opacity-50 ${
                      isDarkMode ? 'bg-red-500/10 text-red-300 hover:bg-red-500/15' : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    {defaultValueLoading && (
                      <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                    )}
                    {defaultValueLoading ? 'Clearing...' : 'Clear Default'}
                  </button>
                )}
                <button
                  onClick={handleSaveDefaultValue}
                  disabled={defaultValueLoading || (dvMode === 'always' ? !defaultValueText.trim() : !dvCondCol)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:bg-slate-400 text-white rounded-full font-medium transition-colors flex items-center gap-2 shadow-[0_14px_28px_-16px_rgba(37,99,235,0.9)]"
                >
                  {defaultValueLoading && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  )}
                  {defaultValueLoading ? 'Setting...' : (dvMode === 'conditional' ? 'Set Rule' : 'Set Default Value')}
                </button>
              </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Auto-map Confirmation Dialog */}
      <Dialog
        open={showAutoMapConfirm}
        onClose={() => setShowAutoMapConfirm(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
            bgcolor: isDarkMode ? '#111827' : '#ffffff',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
            boxShadow: isDarkMode
              ? '0 28px 80px rgba(0, 0, 0, 0.72)'
              : '0 24px 70px rgba(15, 23, 42, 0.18)'
          }
        }}
      >
        <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.25, fontWeight: 700, color: isDarkMode ? '#f8fafc' : '#0f172a' }}>
          Confirm Auto-Mapping
        </DialogTitle>
        <DialogContent sx={{ px: 3, py: 1.5, bgcolor: isDarkMode ? '#111827' : '#ffffff' }}>
          <Typography sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
            This will remove all existing mappings. Are you sure you want to proceed?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1, bgcolor: isDarkMode ? '#111827' : '#ffffff', borderTop: isDarkMode ? '1px solid rgba(148, 163, 184, 0.12)' : '1px solid #e2e8f0' }}>
          <Button onClick={() => setShowAutoMapConfirm(false)} sx={{ ...muiPillButtonSx, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Cancel</Button>
          <Button onClick={proceedWithAutoMap} variant="contained" sx={muiPrimaryPillSx}>
            Proceed
          </Button>
        </DialogActions>
      </Dialog>

      {/* Source prep: fold repeated column groups into rows before mapping */}
      <ExpandColumnGroupsDialog
        open={expandDialogOpen}
        onClose={() => setExpandDialogOpen(false)}
        sessionId={sessionId}
        onApplied={(result) => {
          setSnackbar({
            open: true,
            message: `${result.source_rows} source rows expanded into ${result.output_rows} rows. Reloading columns...`,
            severity: 'success'
          });
          // The source columns changed, so reload rather than leave stale nodes/edges.
          bypassUnloadGuardRef.current = true;
          setTimeout(() => window.location.reload(), 1200);
        }}
      />

      {/* Source prep: group rows under a parent header (drop parents / carry context down) */}
      <CarryForwardDialog
        open={carryForwardOpen}
        onClose={() => setCarryForwardOpen(false)}
        sessionId={sessionId}
        onApplied={(result) => {
          setSnackbar({
            open: true,
            message: `${result.source_rows} rows → ${result.output_rows} item rows (${result.parents} parents removed). Reloading...`,
            severity: 'success'
          });
          setTimeout(() => window.location.reload(), 1200);
        }}
      />

      {/* Primary-key cleanup before the editor (all source types) */}
      <Dialog
        open={primaryDialogOpen}
        disableEscapeKeyDown
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
            bgcolor: isDarkMode ? 'rgba(17, 24, 39, 0.88)' : 'rgba(255, 255, 255, 0.86)',
            backdropFilter: 'blur(18px)',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid #e2e8f0',
            boxShadow: isDarkMode
              ? '0 28px 80px rgba(0, 0, 0, 0.72)'
              : '0 24px 70px rgba(15, 23, 42, 0.18)',
            width: 'min(440px, calc(100vw - 40px))'
          }
        }}
      >
        <DialogTitle sx={{ px: 2.5, pt: 2.25, pb: 1, fontWeight: 800, fontSize: '1.05rem', color: isDarkMode ? '#f8fafc' : '#0f172a' }}>
          Which column identifies each item?
        </DialogTitle>
        <DialogContent sx={{ px: 2.5, py: 1.25, bgcolor: 'transparent' }}>
          <Typography variant="body2" sx={{ mb: 1.75, color: isDarkMode ? '#94a3b8' : '#64748b', lineHeight: 1.45 }}>
            Rows where this column is empty will be removed (e.g. blank part numbers or leftover header lines).
            Pick the key column, or skip to keep every row.
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ color: isDarkMode ? '#94a3b8' : '#475569' }}>Key column</InputLabel>
            <Select
              label="Key column"
              value={primaryKeyColumn}
              onChange={(e) => setPrimaryKeyColumn(e.target.value)}
              sx={{
                borderRadius: '10px',
                bgcolor: isDarkMode ? '#0f172a' : '#f8fafc',
                color: isDarkMode ? '#f8fafc' : '#0f172a',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.28)' : '#cbd5e1'
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: isDarkMode ? '#60a5fa' : '#2563eb'
                },
                '& .MuiSelect-icon': {
                  color: isDarkMode ? '#94a3b8' : '#64748b'
                }
              }}
            >
              {primaryKeyOptions.map(col => (
                <MenuItem key={col} value={col}>
                  {primaryKeySources[col] ? `${col}  (from ${primaryKeySources[col]})` : col}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {primaryKeyColumn && (
            <Box sx={{ mt: 2 }}>
              {primaryEmptyLoading ? (
                <Typography variant="body2" sx={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                  Checking how many rows are empty...
                </Typography>
              ) : primaryEmptyInfo ? (
                primaryEmptyInfo.empty > 0 ? (
                  <Alert
                    severity="warning"
                    sx={{
                      py: 0.75,
                      borderRadius: '10px',
                      bgcolor: isDarkMode ? 'rgba(245, 158, 11, 0.12)' : '#fffbeb',
                      color: isDarkMode ? '#fbbf24' : '#92400e',
                      border: isDarkMode ? '1px solid rgba(245, 158, 11, 0.24)' : '1px solid #fde68a'
                    }}
                  >
                    <strong>{primaryEmptyInfo.empty}</strong> of <strong>{primaryEmptyInfo.total}</strong> rows are empty
                    in this column and will be removed. <strong>{primaryEmptyInfo.total - primaryEmptyInfo.empty}</strong> will remain.
                  </Alert>
                ) : (
                  <Alert
                    severity="success"
                    sx={{
                      py: 0.75,
                      borderRadius: '10px',
                      bgcolor: isDarkMode ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5',
                      color: isDarkMode ? '#a7f3d0' : '#166534',
                      border: isDarkMode ? '1px solid rgba(16, 185, 129, 0.24)' : '1px solid #bbf7d0'
                    }}
                  >
                    No empty rows in this column ({primaryEmptyInfo.total} rows). Nothing will be removed.
                  </Alert>
                )
              ) : null}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.75, gap: 1, bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.42)' : 'rgba(248, 250, 252, 0.68)', borderTop: isDarkMode ? '1px solid rgba(148, 163, 184, 0.12)' : '1px solid #e2e8f0' }}>
          <Button onClick={() => setPrimaryDialogOpen(false)} disabled={primaryCleaning} sx={{ ...muiPillButtonSx, color: isDarkMode ? '#cbd5e1' : '#475569' }}>
            Cancel
          </Button>
          <Button onClick={goToEditor} disabled={primaryCleaning} sx={{ ...muiPillButtonSx, color: isDarkMode ? '#93c5fd' : '#2563eb' }}>
            Skip and keep all rows
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 7, maxWidth: 420, zIndex: 1600 }}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity || 'info'}
          variant="filled"
          sx={{
            width: 'auto',
            maxWidth: 420,
            borderRadius: '14px',
            boxShadow: '0 18px 50px rgba(15,23,42,0.22)',
            alignItems: 'center'
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Debug panel removed */}

      {/* Navigation Confirmation Dialog */}
      <Dialog
        open={showNavigationConfirm}
        onClose={handleNavigationCancel}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: mappingDialogPaperSx }}
      >
        <DialogTitle sx={mappingDialogHeaderSx}>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600" />
            <div>
              <div className={`text-xl font-semibold ${isDarkMode ? 'text-slate-50' : 'text-slate-900'}`}>Unsaved Changes</div>
              <div className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Your mappings may be lost</div>
            </div>
          </div>
        </DialogTitle>
        <DialogContent sx={mappingDialogBodySx}>
          <div className="py-4">
            <p className={`mb-4 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              You have unsaved column mappings. Going back will refresh the page and restore your mappings from the server.
            </p>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-amber-300' : 'text-amber-600'}`}>
              This will refresh the Column Mapping page to ensure your mappings are properly loaded.
            </p>
          </div>
        </DialogContent>
        <DialogActions sx={mappingDialogFooterSx}>
          <Button
            onClick={handleNavigationCancel}
            sx={{ ...muiPillButtonSx, color: isDarkMode ? '#cbd5e1' : '#475569' }}
          >
            Stay Here
          </Button>
          <Button
            onClick={handleNavigationConfirm}
            variant="contained"
            sx={muiPrimaryPillSx}
          >
            Refresh Mapping Page
          </Button>
        </DialogActions>
      </Dialog>

      {/* Template Application Dialog */}
      <Dialog
        open={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: mappingDialogPaperSx }}
      >
        <DialogTitle sx={mappingDialogHeaderSx}>
          <div className="flex items-center gap-3">
            <Library className={`w-6 h-6 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'}`} />
            <div>
              <div className={`text-xl font-semibold ${isDarkMode ? 'text-slate-50' : 'text-slate-900'}`}>Apply Mapping Template</div>
              <div className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Choose a template to apply to your current data</div>
            </div>
          </div>
        </DialogTitle>
        <DialogContent sx={mappingDialogBodySx}>
          <div className="py-4">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className={`ml-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Loading templates...</span>
              </div>
            ) : availableTemplates.length === 0 ? (
              <div className="text-center py-8">
                <Library className={`w-16 h-16 mx-auto mb-4 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`} />
                <p className={`mb-4 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>No templates available</p>
                <p className={`text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                  Create templates in the Data Editor to use them here
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {availableTemplates.map((template) => (
                  <div
                    key={template.id}
                    className={`border rounded-2xl p-4 transition-all ${
                      applyingTemplate 
                        ? 'cursor-not-allowed opacity-50' 
                        : 'cursor-pointer hover:-translate-y-0.5'
                    } ${
                      isDarkMode
                        ? 'bg-slate-950/40 border-slate-700 hover:border-blue-500/70 hover:bg-blue-500/10'
                        : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/60'
                    }`}
                    onClick={() => {
                      if (!applyingTemplate) {
                        handleApplyTemplate(template);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className={`font-semibold mb-1 ${isDarkMode ? 'text-slate-50' : 'text-slate-900'}`}>
                          {template.name}
                        </div>
                        {template.description && (
                          <div className={`text-sm mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {template.description}
                          </div>
                        )}
                        <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Created: {new Date(template.created_at).toLocaleDateString()}
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Column counts: Tags={template.tags_count}, Spec={template.spec_pairs_count}, Customer={template.customer_id_pairs_count}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportTemplate(template); }}
                          title="Download this template as a file to move to another environment"
                          className={`px-4 py-2 border rounded-full text-sm font-medium transition-colors ${
                            isDarkMode ? 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-200' : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          Export
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApplyTemplate(template);
                          }}
                          disabled={applyingTemplate && applyingTemplateId === template.id}
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-50 shadow-[0_14px_28px_-16px_rgba(37,99,235,0.9)]"
                        >
                          {applyingTemplate && applyingTemplateId === template.id ? 'Applying...' : 'Apply'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
        <DialogActions sx={mappingDialogFooterSx}>
          <input
            ref={templateImportInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={handleImportTemplateFile}
          />
          <Button
            onClick={() => templateImportInputRef.current && templateImportInputRef.current.click()}
            sx={{ ...muiPillButtonSx, mr: 'auto', color: '#2563eb' }}
          >
            Import template…
          </Button>
          <Button
            onClick={() => setShowTemplateDialog(false)}
            sx={{ ...muiPillButtonSx, color: isDarkMode ? '#cbd5e1' : '#475569' }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Loader Overlay */}
      <LoaderOverlay
        visible={loading || globalLoading || mappingActionLoading}
        title={
          loading
            ? "Loading Mapping Data"
            : mappingActionLoading
              ? "Creating mapping..."
              : "Finalizing mappings..."
        }
        message={
          loading
            ? "Analyzing your columns for intelligent mapping..."
            : mappingActionLoading
              ? "Connecting selected columns."
              : "Syncing the latest data before review."
        }
      />
    </div>
  );
}
