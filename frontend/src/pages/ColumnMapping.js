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
  Users,
  FileText,
  Info,
  RefreshCw,
  Library,
  X,
  Settings,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions,
  Button,
  Typography,
  Tooltip,
  Snackbar,
  Alert
} from '@mui/material';
import api, { setGlobalLoaderCallback } from '../services/api';
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
      relative group cursor-pointer transition-all duration-300 transform hover:scale-105
      ${isSource ? 'hover:translate-x-2' : 'hover:-translate-x-2'}
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
        relative px-5 py-4 rounded-xl border-2 transition-all duration-300 shadow-lg
        w-60 text-center font-medium text-sm min-h-[70px] flex items-center justify-center
        ${isSource 
          ? `bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300 text-blue-900 
             hover:from-blue-100 hover:to-blue-200 hover:border-blue-400 hover:shadow-xl
             group-hover:shadow-blue-200` 
          : `bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-300 text-emerald-900 
             hover:from-emerald-100 hover:to-emerald-200 hover:border-emerald-400 hover:shadow-xl
             group-hover:shadow-emerald-200`
        }
        ${isConnected ? 'ring-3 ring-yellow-400 ring-opacity-60 shadow-2xl scale-105' : ''}
        ${isSelected ? 'ring-4 ring-purple-500 ring-opacity-80 scale-110 shadow-2xl' : ''}
        ${isFromTemplate ? 'ring-2 ring-green-400 ring-opacity-50' : ''}
        ${isSpecificationMapping ? 'ring-2 ring-orange-400 ring-opacity-50' : ''}
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
        <div className="px-3 break-words text-center leading-tight" title={data.originalLabel}>
          {data.originalLabel}
          {/* AT / FW badges */}
          {!isSource && data.atBadge && (
            <div className="mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-200 text-amber-800 border border-amber-400">
              {data.atBadge}
            </div>
          )}
          {!isSource && data.fwBadge && (
            <div className="mt-1 ml-1 inline-block text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-200 text-purple-800 border border-purple-400">
              {data.fwBadge}
            </div>
          )}
          {/* Pair indicator */}
          {!isSource && pairType !== 'single' && (
            <div className={`text-xs mt-1 font-semibold ${colorClasses.text}`}>
              {pairType === 'specification' ? `Spec ${pairIndex}` : 
               pairType === 'customer' ? `ID ${pairIndex}` : 
               pairType === 'tag' ? `Tag ${pairIndex}` : `${pairIndex}`}
            </div>
          )}
        </div>
        
        {/* Status indicators */}
        {isConnected && (
          <div className={`absolute -top-3 -left-3 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center shadow-lg
            ${isSpecificationMapping ? 'bg-orange-500 animate-pulse' : isFromTemplate ? 'bg-green-500 animate-pulse' : 'bg-blue-500'}
          `}>
            {isSpecificationMapping ? <Settings size={14} /> : isFromTemplate ? <Library size={14} /> : <CheckCircle size={14} />}
          </div>
        )}
        
        {/* Source node mapping indicator */}
        {isSource && isConnected && mappedFromLabel && mappedFromLabel.trim() !== '' && (
          <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Map-{mappedFromLabel}
          </div>
        )}
        
        {/* Template indicator - Show Map-{Column Name} for manual/template mappings. A.Map reserved for AI */}
        {!isSource && !isSpecificationMapping && mappedToLabel && mappedToLabel.trim() !== '' && !data.isAiGenerated && (
          <div className="absolute -bottom-2 -right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Map-{mappedToLabel}
          </div>
        )}
        
        {/* AI mapping indicator - Show A.Map-{Column Name} when auto-mapped */}
        {(isSpecificationMapping || data.isAiGenerated) && mappedToLabel && mappedToLabel.trim() !== '' && (
          <div className="absolute -bottom-2 -right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            A.Map-{mappedToLabel}
          </div>
        )}
        
        {/* Default value indicator for template fields */}
        {!isSource && hasDefaultValue && (
          <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Default: {data.defaultValue}
          </div>
        )}
        
        {/* FactWise ID formula indicator */}
        {!isSource && data.factwiseFormula && (
          <div className="absolute -bottom-2 -right-2 bg-purple-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
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
        {/* Optional field delete button (template side only) */}
        {!isSource && isOptional && (
          <button
            type="button"
            title="Delete optional field"
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

export default function ColumnMapping() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Global loading state
  const [globalLoading, setGlobalLoading] = useState(false);
  useGlobalBlock(globalLoading);
  
  // Setup global loader callback
  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);
  
  // State for real data
  const [clientHeaders, setClientHeaders] = useState([]);
  const [templateHeaders, setTemplateHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionMetadata, setSessionMetadata] = useState({});
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
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
  
  // Rebuild guard ref
  const isRebuildingRef = useRef(false);
  // Persistent cache of mappings (internal names) for reliable restore/guards
  const mappingsCacheRef = useRef([]);
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
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

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
  const [templateFileName, setTemplateFileName] = useState('');
  const [templateOptionals, setTemplateOptionals] = useState([]);
  const [isInitializingMappings, setIsInitializingMappings] = useState(true);
  const isInitializingRef = useRef(true);
  
  // Template version tracking for UI readiness
  const [templateVersion, setTemplateVersion] = useState(0);
  const [expectedTemplateVersion, setExpectedTemplateVersion] = useState(0);
  const [isReady, setIsReady] = useState(false);
  
  // Existing mappings and default values state
  const [existingMappings, setExistingMappings] = useState([]);
  const [existingDefaultValues, setExistingDefaultValues] = useState({});

  // Debug helpers
  function debugLog(...args) {
    try {
      // eslint-disable-next-line no-console
      console.log('🟦 CM', new Date().toISOString(), ...args);
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
  
  // Global debug state for comprehensive debugging
  const [debugMode, setDebugMode] = useState(true);
  const [debugHistory, setDebugHistory] = useState([]);

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

  const handleApplyTemplate = useCallback(async (template) => {
    try {
      setApplyingTemplate(true);
      enhancedDebugLog('TEMPLATE_APPLY', 'Starting template application', {
        templateId: template.id,
        templateName: template.name,
        sessionId
      });

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

        // Load default values if available
        if (response.data.default_values) {
          setExistingDefaultValues(response.data.default_values);
          // CRITICAL: Also store in defaultValueMappings for UI integration
          setDefaultValueMappings(response.data.default_values);
          enhancedDebugLog('TEMPLATE_APPLY', 'Loaded default values from template', {
            defaultValues: response.data.default_values
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
            console.log('🔄 Loading mappings from backend as fallback for template application...');
            try {
              const mappingsResult = await checkExistingMappings(clientHeaders, headersToUse, null);
              mappingsToApply = mappingsResult?.mappings || [];
            } catch (error) {
              console.warn('Error loading mappings fallback:', error);
            }
          }
          
          console.log('🔄 Template mappings prepared for application after rebuild:', mappingsToApply);
          
          // Store data to apply after rebuild completes
          const dataToApplyAfterRebuild = {
            mappings: mappingsToApply,
            headers: headersToUse,
            defaultValues: defaultValuesToUse
          };
          
          // Use updateColumnCounts to trigger full regeneration with new counts
          await updateColumnCounts(response.data.column_counts);
          
          // CRITICAL FIX: Apply mappings and ensure default values after rebuild is complete
          setTimeout(() => {
            try {
              // First, ensure default values are applied to nodes
              if (Object.keys(dataToApplyAfterRebuild.defaultValues).length > 0) {
                console.log('🔄 Ensuring default values are applied to nodes:', dataToApplyAfterRebuild.defaultValues);
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
              
              // Then apply mappings
              if (dataToApplyAfterRebuild.mappings.length > 0) {
                console.log('🔄 Applying template mappings after rebuild completion:', dataToApplyAfterRebuild.mappings);
                console.log('🔄 Using headers for mapping:', dataToApplyAfterRebuild.headers);
                applyExistingMappingsToFlow(dataToApplyAfterRebuild.mappings, clientHeaders, dataToApplyAfterRebuild.headers, null);
                console.log('✅ Template mappings applied successfully to create visual edges');
              } else {
                console.log('⚠️ No mappings found to create visual edges');
              }
            } catch (error) {
              console.error('Error applying template data:', error);
            }
          }, 300); // Wait for rebuild timeouts (100 + 100 + buffer)
        }

        showSnackbar(`Template "${template.name}" applied successfully!`, 'success');

        // Update template version to mark template application completion
        setTemplateVersion(prev => prev + 1);
        setExpectedTemplateVersion(prev => prev + 1);
        console.log('✅ UI: Template version synchronized after template application');

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
      setShowTemplateDialog(false);
    }
  }, [sessionId, showSnackbar]);
  
  // Enhanced debug logging with history
  function enhancedDebugLog(category, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, category, message, data };
    
    if (debugMode) {
      debugLog(`[${category}]`, message, data);
      setDebugHistory(prev => [...prev.slice(-99), logEntry]); // Keep last 100 entries
    }
  }
  
  // Attach state dumpers for ad-hoc debugging in console
  try {
    // eslint-disable-next-line no-undef
    window.__dumpMappingState = () => {
      enhancedDebugLog('STATE_DUMP', 'Full application state dump');
      debugLog('STATE DUMP', {
        sessionId,
        clientHeaders,
        templateHeaders,
        columnCounts,
        edgesCount: edges.length,
        nodesCount: nodes.length,
        cacheMappingsCount: (mappingsCacheRef.current || []).length,
        templateApplied,
        appliedTemplateName,
        sessionMetadata,
        debugMode,
        debugHistoryCount: debugHistory.length
      });
      const sampleEdges = edges.slice(0, 10).map(e => ({ source: e.source, target: e.target, data: e.data }));
      debugLog('SAMPLE EDGES (first 10):', sampleEdges);
      debugLog('CACHE MAPPINGS (first 10):', (mappingsCacheRef.current || []).slice(0, 10));
      debugLog('DEBUG HISTORY (last 10):', debugHistory.slice(-10));
    };
    
    // eslint-disable-next-line no-undef
    window.__toggleDebugMode = () => {
      setDebugMode(prev => !prev);
      // eslint-disable-next-line no-console
      console.log(`🔧 Debug mode ${!debugMode ? 'ENABLED' : 'DISABLED'}`);
    };
    
    // eslint-disable-next-line no-undef
    window.__clearDebugHistory = () => {
      setDebugHistory([]);
      // eslint-disable-next-line no-console
      console.log('🧹 Debug history cleared');
    };
    
    // eslint-disable-next-line no-undef
    window.__getDebugHistory = () => {
      return debugHistory;
    };
  } catch (_) {}

  // C) Reconcile edges with current nodes (universal safety net)
  function reconcileEdgesWithNodes() {
    // eslint-disable-next-line no-console
    console.log('🔧 DEBUG: Starting edge reconciliation');
    
    // Build set of current node IDs
    const currentNodeIds = new Set(nodes.map(n => n.id));
    
    // Drop orphan edges
    const validEdges = edges.filter(edge => {
      const isValid = currentNodeIds.has(edge.source) && currentNodeIds.has(edge.target);
      if (!isValid) {
        // eslint-disable-next-line no-console
        console.log(`🗑️ Dropping orphan edge: ${edge.source} -> ${edge.target}`);
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
        const { mappings, default_values, session_metadata } = response.data;
        
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
    
    let strokeColor = '#10b981'; // Always green for perfect mappings
    let strokeWidth = 3;
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
        strokeOpacity: 0.8
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 20,
        height: 20
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
    
    return (
      (fieldName.includes('Specification_Name_') && nextFieldName.includes('Specification_Value_') && fieldNum === nextFieldNum) ||
      (fieldName.includes('Customer_Identification_Name_') && nextFieldName.includes('Customer_Identification_Value_') && fieldNum === nextFieldNum)
    );
  }

  function isPairEndUpdated(fieldName, prevFieldName) {
    if (!prevFieldName) return false;
    
    const fieldNum = getFieldNumber(fieldName);
    const prevFieldNum = getFieldNumber(prevFieldName);
    
    return (
      (fieldName.includes('Specification_Value_') && prevFieldName.includes('Specification_Name_') && fieldNum === prevFieldNum) ||
      (fieldName.includes('Customer_Identification_Value_') && prevFieldName.includes('Customer_Identification_Name_') && fieldNum === prevFieldNum)
    );
  }

  function getPairTypeUpdated(fieldName) {
    if (fieldName.includes('Specification')) return 'specification';
    if (fieldName.includes('Customer_Identification') || fieldName.includes('Customer Identification')) return 'customer';
    if (fieldName.includes('Tag_')) return 'tag';
    return 'single';
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

  function isOptionalFieldUpdated(fieldName, templateOptionals, idx) {
    if (templateOptionals && templateOptionals.length > idx) {
      return !!templateOptionals[idx];
    }
    // Default logic for numbered dynamic fields
    return (fieldName.includes('Tag_') || fieldName.includes('Specification') || fieldName.includes('Customer_Identification'));
  }

  function handleDeleteOptionalFieldUpdated(nodeId, nodes, edges, columnCounts, updateColumnCounts) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !node.id.startsWith('t-')) return;

    const nodeData = node.data || {};
    const fieldName = nodeData.originalLabel;
    
    // Check if any of the target nodes are mapped
    const hasMapping = edges.some(e => e.target === nodeId);
    if (hasMapping) {
      window.alert('Please remove the mapping from this field before deleting it.');
      return;
    }

    // Compute new counts based on field type
    const newCounts = { ...columnCounts };
    
    if (fieldName.includes('Tag_')) {
      newCounts.tags_count = Math.max(0, (newCounts.tags_count || 0) - 1);
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
        newCounts.spec_pairs_count = Math.max(0, (newCounts.spec_pairs_count || 0) - 1);
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
        newCounts.customer_id_pairs_count = Math.max(0, (newCounts.customer_id_pairs_count || 0) - 1);
      }
    }

    // Update counts which will trigger backend update and node regeneration
    updateColumnCounts(newCounts);
  }

  // Function declaration for initializeNodes - hoisted to avoid TDZ  
  function initializeNodes(clientHdrs, templateHdrs, aiMappings = null, factwiseRules = [], defaultValues = {}, setIsInitializingMappings = null) {
    // eslint-disable-next-line no-console
    console.log('🔧 DEBUG: initializeNodes called with setIsInitializingMappings:', !!setIsInitializingMappings);
    // eslint-disable-next-line no-console
    console.log('🔧 Initializing nodes with:', { 
      clientHdrs: clientHdrs, 
      clientCount: clientHdrs?.length || 0,
      templateHdrs: templateHdrs, 
      templateCount: templateHdrs?.length || 0,
      aiMappings: aiMappings,
      factwiseRules: factwiseRules
    });
    
    const nodeHeight = 90;
    const nodeWidth = 200; // Add missing nodeWidth
    const nodeSpacing = 30;
    const startY = 40; // Space for frozen headers
    
    // Create stable delete handler using imported function
    const stableDeleteHandler = (nodeId) => {
      // Use the proper imported function
      handleDeleteOptionalFieldUpdated(nodeId, nodes, edges, columnCounts, updateColumnCounts);
    };

    // Create source nodes (adjusted for sidebar)
    const clientNodes = clientHdrs.map((header, idx) => ({
      id: `c-${idx}`,
      type: 'custom',
      position: { x: 20, y: startY + idx * (nodeHeight + nodeSpacing) },
      data: {
        label: header,
        originalLabel: header,
        type: 'source',
        headerType: 'client',
        index: idx
      },
      draggable: false,
      style: { width: nodeWidth, height: nodeHeight }
    }));

    // Calculate template node positions
    const templateStartX = 900;
    const templateNodeStartY = startY;
    
    let specPairIndex = 1;
    let customerPairIndex = 1;
    
    // Use the color from the existing pairColors array
    const pairColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    
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

    // Process template headers in their original order
    const templateNodes = templateHdrs.map((header, idx) => {
      // Use updated pair detection logic for numbered fields
      const nextHeader = templateHdrs[idx + 1];
      const prevHeader = templateHdrs[idx - 1];
      
      const isPairStart = isPairStartUpdated(header, nextHeader);
      const isPairEnd = isPairEndUpdated(header, prevHeader);
      const pairType = getPairTypeUpdated(header);
      const pairIndex = getPairIndexUpdated(header);
      const pairColor = getPairColorUpdated(header, pairColors);

      // Check for custom formula rule from factwise
      const factwiseFormula = factwiseRules?.find(rule => rule.target_column === header)?.formula_expression || null;
      
      // Check for default value
      const hasDefaultValue = defaultValues && Object.prototype.hasOwnProperty.call(defaultValues, header);
      const defaultValue = hasDefaultValue ? defaultValues[header] : '';
      
      const src = 'delete';
      
      return {
        id: `t-${idx}`,
        type: 'custom',
        position: { x: templateStartX, y: templateNodeStartY + idx * (nodeHeight + nodeSpacing) },
        data: {
          label: header,
          originalLabel: header,
          type: 'target',
          headerType: 'template',
          index: idx,
          isPairStart: isPairStart,
          isPairEnd: isPairEnd,
          pairType: pairType,
          pairColor: pairColor,
          pairIndex: pairIndex,
          isOptional: isOptionalFieldUpdated(header, templateOptionals, idx),
          onDelete: stableDeleteHandler,
          factwiseFormula: factwiseFormula,
          hasDefaultValue: hasDefaultValue,
          defaultValue: defaultValue,
          atBadge: tagBadges.get(header) || null,
        },
        draggable: false,
        style: { 
          width: nodeWidth, 
          height: nodeHeight, 
          backgroundColor: isPairStart || isPairEnd ? `${pairColor}20` : '#f3f4f6' 
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
    try {
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
      console.log('🔧 DEBUG: Starting column count update sequence');
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
      
      enhancedDebugLog('COLUMN_COUNT_UPDATE', 'Snapshot existing mappings from live edges', { 
        totalEdges: edges.length, 
        validMappings: existingMappings.length,
        mappings: existingMappings 
      });
      
      // Fallback to cache if live snapshot is empty
      if (existingMappings.length === 0 && Array.isArray(mappingsCacheRef.current) && mappingsCacheRef.current.length > 0) {
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
        console.log('🔧 DEBUG: Preserved mappings from cache (fallback):', existingMappings);
      }

      // Fallback to backend if both snapshot and cache are empty
      if (existingMappings.length === 0) {
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
        setColumnCounts(newCounts);
        
        // Update template version to indicate a change occurred
        setExpectedTemplateVersion(prev => prev + 1);
        console.log('🔄 UI: Expected template version incremented after column count update');
        
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
              console.log('✅ UI: Template version incremented after successful column count rebuild');
              
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
                
                // Get current edges from state for saving
                const currentEdges = edges;
                const mappingsToSave = currentEdges.map(edge => {
                  const sourceIdx = parseInt(edge.source.replace('c-', ''));
                  const targetIdx = parseInt(edge.target.replace('t-', ''));
                  const sourceColumn = clientHeaders[sourceIdx];
                  const targetColumn = targetHeaders[targetIdx];
                  return sourceColumn && targetColumn ? { source: sourceColumn, target: targetColumn } : null;
                }).filter(Boolean);
                
                // CRITICAL FIX: Only save if we have mappings to save
                if (mappingsToSave.length === 0) {
                  debugLog('No mappings to save in forced save, skipping to prevent data loss');
                  isRebuildingRef.current = false;
                  return;
                }
                
                // Update cache before saving
                mappingsCacheRef.current = mappingsToSave;
                const payload = { mappings: mappingsToSave, default_values: defaultValueMappings };
                debugLog('Forced save payload:', payload);
                debugLog('defaultValueMappings in forced save:', defaultValueMappings);
                
                await api.saveColumnMappings(sessionId, payload);
                console.log('💾 Forced save of mappings after column count update');
                
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
    }
  };

  // Load real data from API and check for existing mappings
  useEffect(() => {
    if (!sessionId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setIsInitializingMappings(true);
      isInitializingRef.current = true;
      autoApplyTriggeredRef.current = false; // Reset for new session
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: loadData started - isInitializingMappings set to true');
      
      // 🔥 CRITICAL FIX: Check for saved mappings from review session FIRST
      let savedMappingData = null;
      try {
        const savedMapping = sessionStorage.getItem('currentMapping');
        if (savedMapping) {
          const parsedMapping = JSON.parse(savedMapping);
          if (parsedMapping.reviewCompleted && parsedMapping.sessionId === sessionId) {
            console.log('🔄 Restoring mappings from review session:', parsedMapping.mappings.length, 'mappings');
            savedMappingData = parsedMapping;
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
        console.log('🔧 DEBUG: Template was applied in DataEditor, clearing flags and refreshing');
        sessionStorage.removeItem('templateAppliedInDataEditor');
        sessionStorage.removeItem('lastTemplateApplied');

        // Show notification about the template that was applied
        showSnackbar(`Template "${lastTemplateApplied}" was applied in Data Editor. Refreshing mapping view...`, 'info');
      }
      
      // CRITICAL FIX: Always reload session state when coming from DataEditor
      const comingFromDataEditor = sessionStorage.getItem('navigatedFromDataEditor');
      if (comingFromDataEditor === 'true') {
        console.log('🔧 DEBUG: Returning from DataEditor, ensuring fresh session state');
        sessionStorage.removeItem('navigatedFromDataEditor');
        // Force a complete state refresh by clearing any cached mappings
        mappingsCacheRef.current = [];
      }
      
      try {
        // Get headers from API
        // eslint-disable-next-line no-console
        console.log('🔍 Fetching headers for session:', sessionId);
        const response = await api.getHeaders(sessionId);
        // eslint-disable-next-line no-console
        console.log('🔍 Raw API response:', response);
        
        const { data } = response;
        // eslint-disable-next-line no-console
        console.log('🔍 Response data:', data);
        
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
        
        // eslint-disable-next-line no-console
        console.log('🔍 Extracted headers:', { 
          client_headers: client_headers, 
          template_headers: template_headers, 
          template_columns: template_columns,
          column_counts: column_counts,
          session_metadata: session_metadata 
        });
        
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
        
        // eslint-disable-next-line no-console
        console.log('✅ Headers set successfully:', {
          clientCount: validClientHeaders.length,
          templateCount: validTemplateHeaders.length,
          clientHeaders: validClientHeaders,
          templateHeaders: validTemplateHeaders,
          columnCounts: column_counts,
          templateColumns: template_columns
        });
        
        // DEBUG: Additional validation
        if (client_headers.length === 0) {
          // eslint-disable-next-line no-console
          console.error('❌ CLIENT HEADERS ARE EMPTY!');
        }
        if (template_headers.length === 0) {
          // eslint-disable-next-line no-console
          console.error('❌ TEMPLATE HEADERS ARE EMPTY!');
        }
        
        // ENHANCED: Extract template information from session metadata
        if (session_metadata.original_template_id) {
          setOriginalTemplateId(session_metadata.original_template_id);
          // eslint-disable-next-line no-console
          console.log('🔍 Found original template ID from session metadata:', session_metadata.original_template_id);
        }
        
        if (session_metadata.template_applied) {
          setTemplateApplied(true);
          // eslint-disable-next-line no-console
          console.log('🔍 Template was applied during upload');
        }
        
        if (session_metadata.template_name) {
          setAppliedTemplateName(session_metadata.template_name);
          // eslint-disable-next-line no-console
          console.log('🔍 Applied template name:', session_metadata.template_name);
        }
        
        // 🔥 CRITICAL FIX: Use saved mappings from review session if available, otherwise fetch from backend
        let normalizedMappings = [];
        if (savedMappingData && savedMappingData.mappings) {
          // Use saved mappings from review session - preserve exact mapping relationships
          console.log('🔄 Using saved mappings from review session instead of backend');
          normalizedMappings = savedMappingData.mappings.map(mapping => ({
            sourceLabel: mapping.source,
            targetLabel: mapping.target,
            confidence: mapping.confidence || 'saved',
            isFromTemplate: mapping.isFromTemplate || false
          }));
          console.log('🔄 Restored mappings:', normalizedMappings);
        } else {
          // Fallback to backend mappings if no saved session data
          console.log('🔄 No saved mappings from review, fetching from backend');
          const result = await checkExistingMappings(client_headers, template_headers, setIsInitializingMappings);
          normalizedMappings = result.mappings;
        }

        // Initialize nodes AFTER we have session metadata for badges
        const headersToUse = template_headers;
        console.log('📝 About to initialize nodes with:', {
          clientHeadersLength: client_headers.length,
          templateHeadersLength: template_headers.length,
          templateColumnsLength: template_columns.length,
          headersToUseLength: headersToUse.length,
          clientHeaders: client_headers,
          templateHeaders: template_headers,
          templateColumns: template_columns,
          headersToUse: headersToUse,
          normalizedMappingsCount: normalizedMappings?.length || 0
        });
        const factwiseRules = session_metadata?.factwise_rules || [];
        initializeNodes(client_headers, headersToUse, session_metadata?.formula_rules || [], factwiseRules, defaultValueMappings, setIsInitializingMappings);
        
        // CRITICAL FIX: Apply existing mappings AFTER nodes are initialized
        if (normalizedMappings && normalizedMappings.length > 0) {
          console.log('🔄 Applying existing mappings after node initialization:', normalizedMappings);
          applyExistingMappingsToFlow(normalizedMappings, client_headers, headersToUse, setIsInitializingMappings);
        } else {
          // No existing mappings, just end initialization
          console.log('🔄 No existing mappings to apply, ending initialization');
          setIsInitializingMappings(false);
          isInitializingRef.current = false;
          
          // Initial load complete - synchronize template version
          setTemplateVersion(prev => prev + 1);
          setExpectedTemplateVersion(prev => prev + 1);
          console.log('✅ UI: Template version synchronized after initial load');
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
    
    loadData();
  }, [sessionId]);

  // Auto-apply template from Dashboard/Upload using the existing handleApplyTemplate logic
  useEffect(() => {
    const autoApplyTemplate = location.state?.autoApplyTemplate;
    
    if (autoApplyTemplate && !loading && clientHeaders.length > 0 && templateHeaders.length > 0 && !autoApplyTriggeredRef.current) {
      console.log('🔧 AUTO_APPLY: Detected template from Dashboard/Upload:', autoApplyTemplate.name);
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

  

  // Apply existing mappings to the React Flow
  const applyExistingMappingsToFlow = (mappings, clientHdrs, templateHdrs, setIsInitializingMappings = null) => {
    // eslint-disable-next-line no-console
    console.log('🔧 DEBUG: applyExistingMappingsToFlow called with mappings:', mappings);
    const newEdges = [];
    const mappingPairs = [];
    
    // eslint-disable-next-line no-console
    console.log('🔍 Applying existing mappings:', mappings);
    // eslint-disable-next-line no-console
    console.log('🔍 Client headers:', clientHdrs);
    // eslint-disable-next-line no-console
    console.log('🔍 Template headers:', templateHdrs);
    
    // CRITICAL FIX: Validate inputs to prevent crashes
    if (!mappings || !clientHdrs || !templateHdrs) {
      // eslint-disable-next-line no-console
      console.warn('🔍 WARNING: Invalid inputs to applyExistingMappingsToFlow:', { mappings, clientHdrs, templateHdrs });
      return;
    }
    
    if (!Array.isArray(clientHdrs) || !Array.isArray(templateHdrs)) {
      // eslint-disable-next-line no-console
      console.warn('🔍 WARNING: Headers must be arrays:', { clientHdrs, templateHdrs });
      return;
    }
    
    // Helper function to find the best matching target column
    const findBestTargetColumn = (sourceCol, targetCol, templateHdrs, usedTargets = new Set()) => {
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
      
      // Try fuzzy matching for other columns
      for (let i = 0; i < templateHdrs.length; i++) {
        const templateCol = templateHdrs[i];
        if (templateCol.toLowerCase().includes(targetCol.toLowerCase()) || 
            targetCol.toLowerCase().includes(templateCol.toLowerCase())) {
          return { targetIdx: i, targetCol: templateCol, confidence: 'fuzzy' };
        }
      }
      
      return null;
    };
    
    // Track used targets to prevent conflicts
    const usedTargets = new Set();
    
    // Handle direct array format (from template application)
    if (Array.isArray(mappings)) {
      console.log('🔍 Processing direct array mapping format');
      mappings.forEach(mapping => {
        const sourceCol = mapping.source;
        const templateCol = mapping.target;
        
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);
        
        if (sourceIdx >= 0 && targetMatch) {
          console.log(`🔍 Mapping: ${sourceCol} -> ${targetMatch.targetCol} (source idx: ${sourceIdx}, target idx: ${targetMatch.targetIdx}, confidence: ${targetMatch.confidence})`);
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
      console.log('🔍 Processing nested mapping format');
      mappings.mappings.forEach(mapping => {
        const sourceCol = mapping.source;
        const templateCol = mapping.target;
        
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);
        
        if (sourceIdx >= 0 && targetMatch) {
          console.log(`🔍 Mapping: ${sourceCol} -> ${targetMatch.targetCol} (source idx: ${sourceIdx}, target idx: ${targetMatch.targetIdx}, confidence: ${targetMatch.confidence})`);
          const edge = createEdge(sourceIdx, targetMatch.targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
          mappingPairs.push({ sourceIdx, targetIdx: targetMatch.targetIdx, sourceCol, templateCol: targetMatch.targetCol });
          // Mark this target as used
          usedTargets.add(targetMatch.targetCol);
        } else {
          console.warn(`🔍 WARNING: Could not map ${sourceCol} -> ${templateCol} (source idx: ${sourceIdx}, target match: ${targetMatch ? 'found' : 'not found'})`);
        }
      });
    } else {
      // Handle old format for backward compatibility
      console.log('🔍 Processing old mapping format');
      Object.entries(mappings || {}).forEach(([templateCol, sourceCol]) => {
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetMatch = findBestTargetColumn(sourceCol, templateCol, templateHdrs, usedTargets);
        
        if (sourceIdx >= 0 && targetMatch) {
          console.log(`🔍 Mapping: ${sourceCol} -> ${targetMatch.targetCol} (source idx: ${sourceIdx}, target idx: ${targetMatch.targetIdx}, confidence: ${targetMatch.confidence})`);
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
    
    console.log(`🔍 Created ${newEdges.length} edges from existing mappings`);
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
    
    // Save to mapping history
    setTimeout(() => {
      setMappingHistory([{ nodes, edges: newEdges }]);
      console.log('Applied existing mappings to flow');
      
      // Set flag to false after mappings are applied
      if (setIsInitializingMappings) {
        console.log('🔧 DEBUG: Setting isInitializingMappings to false after applying mappings');
        setIsInitializingMappings(false);
        isInitializingRef.current = false;
        console.log('🔧 DEBUG: Initialization complete (applyExistingMappingsToFlow), autosave enabled');
        
        // Mappings applied successfully - synchronize template version
        setTemplateVersion(prev => prev + 1);
        setExpectedTemplateVersion(prev => prev + 1);
        console.log('✅ UI: Template version synchronized after applying existing mappings');
      }
    }, 500); // Increased from 200ms to 500ms to ensure edges are fully set

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

          // Add virtual edges for Tag formula rules
          if (Array.isArray(rules)) {
            rules.forEach(rule => {
              const colType = rule?.column_type || 'Tag';
              if (colType === 'Tag') {
                const sourceCol = rule?.source_column;
                const targetCol = rule?.target_column; // expected internal e.g., Tag_4
                if (sourceCol && targetCol && templateIndexByLabel.has(targetCol)) {
                  const srcIdx = clientHdrs.indexOf(sourceCol);
                  const tgtIdx = templateIndexByLabel.get(targetCol);
                  if (srcIdx >= 0 && typeof tgtIdx === 'number' && !hasEdge(srcIdx, tgtIdx)) {
                    const edge = createEdge(srcIdx, tgtIdx, false, null, true, false);
                    edge.data = { ...(edge.data || {}), isVirtual: true, isFormulaEdge: true };
                    withVirtual.push(edge);
                  }
                }
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
    return edgesToConvert.map(edge => {
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

  // Save mappings to backend
  const saveMappings = async (mappingData) => {
    try {
      enhancedDebugLog('SAVE_MAPPINGS', 'Starting mapping save operation', { 
        sessionId, 
        mappingDataKeys: Object.keys(mappingData),
        mappingsCount: mappingData.mappings?.length || 0,
        defaultValuesCount: Object.keys(mappingData.default_values || {}).length,
        formulaRulesCount: mappingData.formula_rules?.length || 0,
        factwiseRulesCount: mappingData.factwise_rules?.length || 0
      });
      
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: saveMappings called with:', mappingData);
      
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
      console.log('✅ Mappings saved successfully:', response.data);
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

  // Handle default value dialog
  const handleSaveDefaultValue = () => {
    if (!selectedTemplateField || !defaultValueText.trim()) return;
    
    // Save the default value mapping
    setDefaultValueMappings(prev => ({
      ...prev,
      [selectedTemplateField.name]: defaultValueText.trim()
    }));
    
    // Update the specific template node to show the default value tag
    setNodes(currentNodes => currentNodes.map(node => {
      if (node.id === selectedTemplateField.id) {
        return {
          ...node,
          data: {
            ...node.data,
            hasDefaultValue: true,
            defaultValue: defaultValueText.trim()
          }
        };
      }
      return node;
    }));
    
    // Close dialog and reset state
    setShowDefaultValueDialog(false);
    setSelectedTemplateField(null);
    setDefaultValueText('');
    
    // eslint-disable-next-line no-console
    console.log(`Set default value "${defaultValueText.trim()}" for field "${selectedTemplateField.name}"`);
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
    console.log('Cleared template mappings');
  };

  const isCompleteMapping = () => {
    const targetHeaders = (useDynamicTemplate && templateColumns.length > 0) ? templateColumns : templateHeaders;
    const targetNodeIds = targetHeaders.map((_, idx) => `t-${idx}`);
    const mappedTargets = edges.map(edge => edge.target);
    return targetNodeIds.every(targetId => mappedTargets.includes(targetId));
  };

  // Enhanced node click handling for selection and mapping
  const onNodeClick = useCallback((event, node) => {
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
      // Target node clicked with source selected
      const sourceIdx = parseInt(selectedSourceNode.replace('c-', ''));
      const targetIdx = parseInt(node.id.replace('t-', ''));
      
      // Save state for undo
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
      
      setSelectedSourceNode(null);
    } else if (node.id.startsWith('t-') && !selectedSourceNode) {
      // Template node clicked without source selected - check if unmapped
      const targetIdx = parseInt(node.id.replace('t-', ''));
      const isNodeMapped = edges.some(edge => edge.target === node.id);
      
      if (!isNodeMapped) {
        // Unmapped template field clicked - open default value dialog
        const targetHeaders = (useDynamicTemplate && templateColumns.length > 0) ? templateColumns : templateHeaders;
        const templateFieldName = targetHeaders[targetIdx];
        
        // eslint-disable-next-line no-console
        console.log('🔧 DEBUG Default Value Dialog:', {
          targetIdx,
          useDynamicTemplate,
          templateColumnsLength: templateColumns.length,
          templateHeadersLength: templateHeaders.length,
          targetHeaders: targetHeaders,
          templateFieldName
        });
        
        if (templateFieldName) {
          setSelectedTemplateField({ id: node.id, name: templateFieldName, index: targetIdx });
          setDefaultValueText(defaultValueMappings[templateFieldName] || '');
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
      console.log('AI Mapping Response:', data);
      
      // ENHANCED: Extract template information from session metadata if available
      if (session_metadata && session_metadata.original_template_id) {
        setOriginalTemplateId(session_metadata.original_template_id);
        // eslint-disable-next-line no-console
        console.log('🔍 Updated original template ID from mapping suggestions:', session_metadata.original_template_id);
      }
      
      // Handle specification opportunity
      if (specification_opportunity && specification_opportunity.detected) {
        // setSpecificationOpportunity(specification_opportunity);
        // eslint-disable-next-line no-console
        console.log('Specification opportunity detected:', specification_opportunity);
      }
      
      // COMMENTED OUT: Handle specification overflow - show alert
      // if (specification_overflow && specification_overflow.detected) {
      //   setSpecificationOverflow(specification_overflow);
      //   setShowSpecOverflowAlert(true);
      //   console.log('Specification overflow detected:', specification_overflow);
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
  const onConnect = useCallback((connection) => {
    // Save state for undo
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
  }, [nodes, edges, setEdges, setNodes]);

  // Handle edge click for deletion
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation();
    setSelectedEdge(edge.id);
  }, []);

  // Delete selected edge with confidence removal
  const deleteSelectedEdge = () => {
    if (selectedEdge) {
      setMappingHistory(prev => [...prev, { nodes, edges }]);
      
      const edgeToDelete = edges.find(e => e.id === selectedEdge);
      setEdges(prev => prev.filter(edge => edge.id !== selectedEdge));
      
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
    }
  };

  // Clear all mappings (preserve default values so they are not lost)
  const clearMappings = () => {
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
    setSpecificationMappingsApplied(false);
    setOriginalTemplateId(null);
    setTemplateSuccess(false);
    
    // Clear saved mappings from sessionStorage
    sessionStorage.removeItem('currentMapping');
    // eslint-disable-next-line no-console
    console.log('Cleared all mappings and sessionStorage');
  };

  // Undo last action with better error handling
  const undoLastAction = () => {
    if (mappingHistory.length > 0) {
      const lastState = mappingHistory[mappingHistory.length - 1];
      
      // Ensure we have valid state to restore
      if (lastState && lastState.nodes && Array.isArray(lastState.nodes)) {
        // eslint-disable-next-line no-console
        console.log('Restoring state:', lastState);
        setNodes(lastState.nodes);
        setEdges(lastState.edges || []);
        setMappingHistory(prev => prev.slice(0, -1));
        setSelectedSourceNode(null);
        setSelectedEdge(null);
      } else {
        // eslint-disable-next-line no-console
        console.warn('Invalid state in mapping history, reinitializing nodes');
        // Fallback: reinitialize nodes if state is corrupted
        initializeNodes(clientHeaders, templateHeaders, null, [], defaultValueMappings, setIsInitializingMappings);
        setEdges([]);
        setMappingHistory([]);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('No mapping history to undo');
    }
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
    console.log('\ud83d\udee1\ufe0f UI Readiness check:', { ready, templateVersion, expectedTemplateVersion, edgesCount: edges.length });
  }, [edges.length, templateVersion, expectedTemplateVersion]);

  // Ensure default value tags are applied to nodes when defaultValueMappings changes
  useEffect(() => {
    if (Object.keys(defaultValueMappings).length > 0) {
      console.log('🔄 Applying default values to existing nodes:', defaultValueMappings);
      setNodes(currentNodes => currentNodes.map(node => {
        if (!node.id.startsWith('t-')) return node; // Only update template nodes
        
        const fieldName = node.data?.originalLabel;
        if (fieldName && defaultValueMappings[fieldName]) {
          return {
            ...node,
            data: {
              ...node.data,
              hasDefaultValue: true,
              defaultValue: defaultValueMappings[fieldName]
            }
          };
        }
        return node;
      }));
    }
  }, [defaultValueMappings, setNodes]);

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
      // eslint-disable-next-line no-console
      console.log('🔄 Auto-saved mappings to sessionStorage with template info:', {
        sessionId,
        originalTemplateId,
        templateApplied,
        appliedTemplateName
      });
    }
  }, [edges, clientHeaders, templateHeaders, sessionId, originalTemplateId, templateApplied, appliedTemplateName, templateSuccess]);

  // Debug logging for isInitializingMappings flag
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('🔧 DEBUG: isInitializingMappings changed to:', isInitializingMappings);
    isInitializingRef.current = isInitializingMappings;
  }, [isInitializingMappings]);

  // E) Debounced autosave with rebuild guard and label-based targeting
  useEffect(() => {
    // E) Early return if rebuilding or still initializing (check both state and ref)
    if (isRebuildingRef.current || isInitializingMappings || isInitializingRef.current) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - rebuilding or initializing', {
        isRebuilding: isRebuildingRef.current,
        isInitializingMappings,
        isInitializingRef: isInitializingRef.current
      });
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: Autosave blocked - rebuilding:', isRebuildingRef.current, 'initializing state:', isInitializingMappings, 'initializing ref:', isInitializingRef.current);
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
      console.log('🔧 DEBUG: No edges yet, skipping autosave - might still be loading');
      return;
    }

    // ADDITIONAL SAFETY CHECK: If we're still loading, skip autosave
    if (loading) {
      enhancedDebugLog('AUTOSAVE', 'Autosave blocked - still loading', {
        loading,
        edgesLength: edges.length
      });
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: Still loading, skipping autosave');
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
    console.log('🔧 DEBUG: Autosave triggered - isInitializingMappings:', isInitializingMappings, 'isInitializingRef:', isInitializingRef.current, 'edges count:', edges.length);

    const timer = setTimeout(async () => {
      try {
        enhancedDebugLog('AUTOSAVE', 'Starting autosave execution', {
          edgesCount: edges.length,
          nodesCount: nodes.length,
          defaultValueMappingsCount: Object.keys(defaultValueMappings).length
        });

        // F) Get target column name from node data (not index)
        const mappings = edges.map(edge => {
          const sourceIdx = parseInt(edge.source.replace('c-', ''));
          const targetNode = nodes.find(n => n.id === edge.target);
          const sourceColumn = clientHeaders[sourceIdx];
          const targetColumn = targetNode?.data?.originalLabel;
          
          if (!sourceColumn || !targetColumn) return null;
          return { source: sourceColumn, target: targetColumn };
        }).filter(Boolean);

        enhancedDebugLog('AUTOSAVE', 'Computed mappings from edges', {
          totalEdges: edges.length,
          validMappings: mappings.length,
          mappings: mappings,
          edgeDetails: edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            sourceColumn: clientHeaders[parseInt(edge.source.replace('c-', ''))],
            targetColumn: nodes.find(n => n.id === edge.target)?.data?.originalLabel
          }))
        });

        console.log('🔧 DEBUG: Autosave - computed mappings:', mappings, 'edges:', edges);

        // CRITICAL FIX: Only send mappings if we actually have mappings
        // Don't send empty arrays that could overwrite existing mappings
        if (mappings.length === 0) {
          enhancedDebugLog('AUTOSAVE', 'No mappings to save - skipping to prevent data loss', {
            mappingsLength: mappings.length,
            edgesLength: edges.length
          });
          console.log('🔧 DEBUG: No mappings to save, skipping autosave to prevent data loss');
          return;
        }

        // ADDITIONAL PROTECTION: Check if this is a destructive operation (deleting columns)
        // If we had mappings before and now we have none, this might be a column deletion
        const previousMappingsCount = sessionStorage.getItem('previousMappingsCount');
        const currentMappingsCount = mappings.length;
        
        if (previousMappingsCount && parseInt(previousMappingsCount) > 0 && currentMappingsCount === 0) {
          enhancedDebugLog('AUTOSAVE', 'Potential destructive operation detected - skipping autosave', {
            previousMappingsCount,
            currentMappingsCount,
            operation: 'column_deletion_suspected'
          });
          console.log('🔧 DEBUG: Potential destructive operation detected - had mappings before, now none. Skipping autosave to prevent data loss.');
          console.log('🔧 DEBUG: Previous mappings count:', previousMappingsCount, 'Current:', currentMappingsCount);
          return;
        }
        
        // Store current mappings count for next comparison
        sessionStorage.setItem('previousMappingsCount', currentMappingsCount.toString());

        // SAFETY CHECK: Only skip autosave if we have zero mappings
        // This prevents accidental data loss while allowing small/partial mappings to be saved
        if (mappings.length === 0) {
          enhancedDebugLog('AUTOSAVE', 'No mappings to save - skipping autosave', {
            mappingsLength: mappings.length,
            clientHeadersLength: clientHeaders.length,
            templateHeadersLength: templateHeaders.length
          });
          console.log('🔧 DEBUG: No mappings to save, skipping autosave');
          return;
        }

        // Update cache for reliable restoration/guards (allow empty mappings too)
        mappingsCacheRef.current = mappings;
        enhancedDebugLog('AUTOSAVE', 'Updated mappings cache', {
          cacheCount: mappingsCacheRef.current.length,
          mappings: mappingsCacheRef.current
        });

        const payload = {
          mappings,
          default_values: defaultValueMappings
        };

        enhancedDebugLog('AUTOSAVE', 'Preparing autosave payload', {
          payloadKeys: Object.keys(payload),
          mappingsCount: mappings.length,
          defaultValuesCount: Object.keys(defaultValueMappings).length,
          payload: payload
        });

        console.log('🔧 DEBUG: Sending payload to backend:', payload);
        console.log('🔧 DEBUG: defaultValueMappings state:', defaultValueMappings);
        console.log('🔧 DEBUG: Object.keys(defaultValueMappings):', Object.keys(defaultValueMappings));

        await api.saveColumnMappings(sessionId, payload);
        
        enhancedDebugLog('AUTOSAVE', 'Autosave completed successfully', {
          mappingsSaved: mappings.length,
          defaultValuesSaved: Object.keys(defaultValueMappings).length,
          sessionId
        });
        
        // eslint-disable-next-line no-console
        console.log('🔧 DEBUG: Autosaved mappings by label');
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
    }, 1500); // 🔥 FAST NAVIGATION FIX: Increased delay to prevent too-fast navigation

    return () => clearTimeout(timer);
  }, [edges, defaultValueMappings, clientHeaders, nodes, sessionId, isInitializingMappings, templateHeaders, loading]);

  // ENHANCED: Navigate to review page - UPDATED TO SEND TO BACKEND with template preservation
  const handleReview = async () => {
    if (edges.length === 0) {
      setError('Please create at least one mapping before reviewing.');
      return;
    }

    setIsReviewing(true);
    setIsProcessingMappings(true); // 🔥 FAST NAVIGATION FIX: Block navigation during processing
    setGlobalLoading(true); // 🔥 LOADER FIX: Show global loader during review preparation
    setError(null);

    try {
      // Create mapping data structure for backend - send as ordered list to preserve relationships
      // Sort edges by source index to ensure consistent ordering
      const sortedEdges = [...edges].sort((a, b) => {
        const sourceA = parseInt(a.source.replace('c-', ''));
        const sourceB = parseInt(b.source.replace('c-', ''));
        return sourceA - sourceB;
      });
      
      // Send as ordered array of individual mappings to preserve source-target relationships
      const targetHeaders = templateHeaders; // Always internal names from backend
      
      // eslint-disable-next-line no-console
      console.log(`🔧 DEBUG: Mapping context:`);
      // eslint-disable-next-line no-console
      console.log(`  - useDynamicTemplate: ${useDynamicTemplate}`);
      // eslint-disable-next-line no-console
      console.log(`  - templateColumns.length: ${templateColumns.length}`);
      // eslint-disable-next-line no-console
      console.log(`  - targetHeaders selected: templateHeaders (internal)`);
      // eslint-disable-next-line no-console
      console.log(`  - targetHeaders: ${JSON.stringify(targetHeaders)}`);
      // eslint-disable-next-line no-console
      console.log(`  - edges count: ${sortedEdges.length}`);
      
      const mappingData = {
        mappings: sortedEdges.map(edge => {
          const sourceIdx = parseInt(edge.source.replace('c-', ''));
          const targetIdx = parseInt(edge.target.replace('t-', ''));
          const sourceColumn = clientHeaders[sourceIdx];
          
          // Get target column name from the actual node data instead of relying on index
          // This fixes the issue where numbered fields like Tag_2 weren't mapping correctly
          const targetNode = nodes.find(n => n.id === edge.target);
          const targetColumnFromIndex = targetHeaders[targetIdx];
          const targetColumn = targetNode ? targetNode.data.originalLabel : targetColumnFromIndex;
          
          // Always show debugging information
          // eslint-disable-next-line no-console
          console.log(`🔧 Processing edge: ${sourceColumn} -> ${targetColumn}`);
          // eslint-disable-next-line no-console
          console.log(`  - Edge target ID: ${edge.target}`);
          // eslint-disable-next-line no-console
          console.log(`  - Target index: ${targetIdx}`);
          // eslint-disable-next-line no-console
          console.log(`  - Target node found: ${!!targetNode}`);
          // eslint-disable-next-line no-console
          console.log(`  - Target node original label: ${targetNode?.data?.originalLabel}`);
          // eslint-disable-next-line no-console
          console.log(`  - Target from index [${targetIdx}]: ${targetColumnFromIndex}`);
          // eslint-disable-next-line no-console
          console.log(`  - Final target column: ${targetColumn}`);
          // eslint-disable-next-line no-console
          console.log(`  - targetHeaders length: ${targetHeaders.length}`);
          
          if (!targetColumn) {
            // eslint-disable-next-line no-console
            console.log(`  - Available target nodes: ${nodes.filter(n => n.id.startsWith('t-')).map(n => `${n.id}:${n.data?.originalLabel}`).join(', ')}`);
          }
          
          return {
            source: sourceColumn,
            target: targetColumn,
            targetNodeId: edge.target // Include for debugging
          };
        }),
        // Include default value mappings for unmapped fields
        default_values: defaultValueMappings
      };

      // eslint-disable-next-line no-console
      console.log('🔄 Sending mapping data to backend. Full context:', {
        sessionId,
        mappingData,
        clientHeaders,
        templateHeaders,
        edges
      });
      
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: mappingData.default_values:', mappingData.default_values);
      // eslint-disable-next-line no-console
      console.log('🔧 DEBUG: Object.keys(mappingData.default_values):', Object.keys(mappingData.default_values));

      const response = await api.saveColumnMappings(sessionId, mappingData);

      // ENHANCED: Save comprehensive mapping info to sessionStorage for restoration
      const mappingForRestore = {
        mappings: edges.map(edge => {
          const sourceIdx = parseInt(edge.source.replace('c-', ''));
          const targetNode = nodes.find(n => n.id === edge.target);
          const targetColumn = targetNode ? targetNode.data.originalLabel : targetHeaders[parseInt(edge.target.replace('t-', ''))];
          
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
      
      console.log('✅ Enhanced mapping preservation completed:', mappingForRestore);

      // Navigate to editor on success
      navigate(`/editor/${sessionId}`);
      
    } catch (err) {
      console.error('Error saving mappings:', err);
      setError('Failed to save mappings. Please try again.');
    } finally {
      setIsReviewing(false);
      setIsProcessingMappings(false); // 🔥 FAST NAVIGATION FIX: Re-enable navigation
      setGlobalLoading(false); // 🔥 LOADER FIX: Clear global loader when done
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="w-full h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center bg-white rounded-2xl shadow-2xl p-10">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Loading Mapping Data</h2>
          <p className="text-gray-600">Analyzing your columns for intelligent mapping...</p>
        </div>
      </div>
    );
  }

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

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col">

      {/* Clean Top Header - Just essentials */}
      <div className="bg-white shadow-xl border-b border-gray-200 px-8 py-4">
        <div className="flex justify-between items-center">
          {/* Left side - Logo and Template Status */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-lg">
              <div className="w-6 h-6 bg-white rounded-md opacity-90"></div>
            </div>
            <div className="text-lg font-semibold text-gray-700">Column Mapping</div>
          </div>
          
          {/* Right side - Action buttons with proper spacing */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleAutoMap}
              disabled={isAutoMapping || isRebuildingRef.current}
              className={`
                px-8 py-3 rounded-lg font-semibold flex items-center gap-2 shadow-sm transition-all
                ${isAutoMapping
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                }
              `}
            >
              {isAutoMapping ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  Mapping...
                </>
              ) : (
                <>
                  <Brain size={16} />
                  Auto Map
                </>
              )}
            </button>

            <button
              onClick={() => {
                setShowTemplateDialog(true);
                loadAvailableTemplates();
              }}
              disabled={applyingTemplate || templatesLoading}
              className={`
                px-8 py-3 rounded-lg font-semibold flex items-center gap-2 shadow-sm transition-all
                ${applyingTemplate || templatesLoading
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                }
              `}
            >
              {applyingTemplate || templatesLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  Loading...
                </>
              ) : (
                <>
                  <Library size={16} />
                  Apply Template
                </>
              )}
            </button>

            <button
              onClick={undoLastAction}
              disabled={mappingHistory.length === 0}
              className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 disabled:bg-gray-200 text-white rounded-lg shadow-sm transition-all flex items-center gap-2"
            >
              <RotateCcw size={16} />
              Undo
            </button>
            
            <button
              onClick={clearMappings}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2 shadow-sm transition-all"
            >
              <Trash2 size={16} />
              Clear All
            </button>

            <button
              onClick={handleReview}
              disabled={edges.length === 0 || isReviewing || isRebuildingRef.current || !isReady || isProcessingMappings}
              className={`
                px-8 py-3 rounded-lg font-semibold flex items-center gap-2 shadow-sm transition-all
                ${edges.length > 0 && !isReviewing && !isProcessingMappings
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-200 text-gray-500'
                }
              `}
            >
              {isReviewing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Preparing review...</span>
                </>
              ) : (
                <>
                  <ArrowRight size={16} />
                  Review
                </>
              )}
            </button>
          </div>
        </div>
      </div>

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

      {/* Main Flow Area with side stats */}
      <div className="flex-1 relative bg-gradient-to-br from-slate-50 to-blue-50 overflow-hidden flex">
        
        {/* Left Stats Panel - with Template Column Counts at top */}
        <div className="w-64 bg-white shadow-lg border-r border-gray-200 p-4">
          {/* Column Count Controls (moved to top) */}
          <div className="p-3 bg-gray-50 rounded-xl">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Template Column Counts</h4>

            <div className="space-y-3">
              {/* Tags Count */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600">Tags:</label>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: Math.max(1, columnCounts.tags_count - 1),
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className="w-6 h-6 bg-red-200 hover:bg-red-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-red-700"
                    disabled={columnCounts.tags_count <= 1}
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{columnCounts.tags_count}</span>
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count + 1,
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className="w-6 h-6 bg-green-200 hover:bg-green-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-green-700"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Specification Pairs Count */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600">Spec Pairs:</label>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 0,
                      spec_pairs_count: Math.max(1, columnCounts.spec_pairs_count - 1),
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className="w-6 h-6 bg-red-200 hover:bg-red-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-red-700"
                    disabled={columnCounts.spec_pairs_count <= 1}
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{columnCounts.spec_pairs_count}</span>
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 0,
                      spec_pairs_count: columnCounts.spec_pairs_count + 1,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count || 0
                    })}
                    className="w-6 h-6 bg-green-200 hover:bg-green-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-green-700"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Customer ID Pairs Count */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600">Customer ID Pairs:</label>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 0,
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: Math.max(1, columnCounts.customer_id_pairs_count - 1)
                    })}
                    className="w-6 h-6 bg-red-200 hover:bg-red-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-red-700"
                    disabled={columnCounts.customer_id_pairs_count <= 1}
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{columnCounts.customer_id_pairs_count}</span>
                  <button 
                    onClick={() => updateColumnCounts({
                      tags_count: columnCounts.tags_count || 0,
                      spec_pairs_count: columnCounts.spec_pairs_count || 0,
                      customer_id_pairs_count: columnCounts.customer_id_pairs_count + 1
                    })}
                    className="w-6 h-6 bg-green-200 hover:bg-green-300 rounded flex items-center justify-center text-[10px] font-bold transition-colors text-green-700"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-gray-500">
              Total template columns: {templateHeaders.length}
            </div>
          </div>

          <h3 className="text-sm font-bold text-gray-800 mt-4 mb-3">Mapping Statistics</h3>
          
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
              <div className="text-xl font-bold text-blue-600">{mappingStats.total}</div>
              <div className="text-xs text-blue-700 font-medium">Total Mapped</div>
            </div>
            
            {mappingStats.template > 0 && (
              <div className="bg-green-50 rounded-xl p-3 border border-green-200">
                <div className="flex items-center gap-2 mb-1.5">
                  <Library size={18} className="text-green-600" />
                  <div className="text-lg font-bold text-green-600">{mappingStats.template}</div>
                </div>
                <div className="text-xs text-green-700 font-medium">From Template</div>
              </div>
            )}
            
            {mappingStats.specification > 0 && (
              <div className="bg-orange-50 rounded-xl p-3 border border-orange-200">
                <div className="flex items-center gap-2 mb-1.5">
                  <Settings size={18} className="text-orange-600" />
                  <div className="text-lg font-bold text-orange-600">{mappingStats.specification}</div>
                </div>
                <div className="text-xs text-orange-700 font-medium">Specification</div>
              </div>
            )}
            
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
              <div className="flex items-center gap-2 mb-1.5">
                <Brain size={18} className="text-emerald-600" />
                <div className="text-lg font-bold text-emerald-600">{mappingStats.ai}</div>
              </div>
              <div className="text-xs text-emerald-700 font-medium">AI Suggested</div>
            </div>
            
            <div className="bg-purple-50 rounded-xl p-3 border border-purple-200">
              <div className="flex items-center gap-2 mb-1.5">
                <Users size={18} className="text-purple-600" />
                <div className="text-lg font-bold text-purple-600">{mappingStats.manual}</div>
              </div>
              <div className="text-xs text-purple-700 font-medium">Manual</div>
            </div>
            
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
              <div className="text-lg font-bold text-amber-600">{mappingStats.confidence.high}</div>
              <div className="text-xs text-amber-700 font-medium">High Confidence</div>
            </div>
          </div>
          
          {/* Progress indicator */}
          <div className="mt-4 p-3 bg-gray-50 rounded-xl">
            <div className="text-sm text-gray-600 mb-2">Mapping Progress</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ 
                  width: `${
                    templateHeaders.length > 0 
                      ? (mappingStats.total / templateHeaders.length) * 100 
                      : 0
                  }%` 
                }}
              ></div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {mappingStats.total} of {templateHeaders.length} columns mapped
            </div>
          </div>

          {/* COMMENTED OUT: Specification overflow stats */}
          {/* {specificationOverflow && (
            <div className="mt-6 p-4 bg-red-50 rounded-xl border border-red-200">
              <div className="text-sm text-red-600 mb-2">Specification Overflow</div>
              <div className="text-lg font-bold text-red-600">{specificationOverflow.missingColumns}</div>
              <div className="text-xs text-red-500">specifications lost</div>
            </div>
          )} */}
        </div>

        {/* Main mapping area with visual section separation */}
        <div className="flex-1 relative">
          {/* Background color sections to visually separate left and right */}
          <div className="absolute left-0 top-0 w-1/2 h-full bg-blue-50 opacity-30 pointer-events-none"></div>
          <div className="absolute right-0 top-0 w-1/2 h-full bg-emerald-50 opacity-30 pointer-events-none"></div>
          
          {/* Vertical divider line */}
          <div className="absolute left-1/2 top-0 w-px h-full bg-gray-300 opacity-50 pointer-events-none transform -translate-x-1/2"></div>

          {/* Fixed section headers - properly aligned with columns */}
      <div className="sticky top-0 z-30 bg-white bg-opacity-95 backdrop-blur-sm border-b border-gray-200" style={{ height: '140px' }}>
            <div className="absolute" style={{ left: '35px', top: '80px' }}>
              <div className="bg-blue-600 text-white px-6 py-3 rounded-xl shadow-lg font-bold flex items-center gap-2">
                <span>Client File ({clientHeaders.length} fields)</span>
                <Tooltip title={clientFileName ? `File: ${clientFileName}` : 'Client file'} placement="bottom">
                  <span><Info size={16} className="opacity-90 cursor-default" /></span>
                </Tooltip>
              </div>
            </div>
            
            <div className="absolute" style={{ left: '535px', top: '80px' }}>
              <div className="bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-lg font-bold flex items-center gap-2">
                <span>FW Item Template ({templateHeaders.length} fields)</span>
                <Tooltip title={templateFileName ? `File: ${templateFileName}` : 'Template file'} placement="bottom">
                  <span><Info size={16} className="opacity-90 cursor-default" /></span>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Instructions */}
          {selectedSourceNode && (
            <div className="fixed left-1/2 transform -translate-x-1/2 z-30 bg-purple-100 border-2 border-purple-300 rounded-xl shadow-lg px-6 py-3" style={{ top: '220px' }}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse"></div>
                <span className="text-purple-800 font-semibold">
                  Click on a Template column to create mapping
                </span>
              </div>
            </div>
          )}

          {selectedEdge && (
            <div className="fixed left-1/2 transform -translate-x-1/2 z-30 bg-red-100 border-2 border-red-300 rounded-xl shadow-lg px-6 py-3" style={{ top: '220px' }}>
              <div className="flex items-center gap-3">
                <span className="text-red-800 font-semibold">Connection selected (Press ESC to cancel)</span>
                <button
                  onClick={deleteSelectedEdge}
                  className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {/* React Flow Container with padding for headers */}
          <div className="w-full h-full overflow-auto" style={{ paddingTop: '50px' }}>
            <div style={{ 
              width: '100%', 
              height: Math.max(700, Math.max(clientHeaders.length, templateHeaders.length) * 120 + 200) 
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
                        strokeWidth: isSelected ? 6 : edge.style.strokeWidth,
                        stroke: isSelected 
                          ? '#dc2626'
                          : edge.style.stroke,
                        opacity: isOtherSelected ? 0.3 : 1,
                        filter: isSelected 
                          ? 'drop-shadow(0 6px 12px rgba(220, 38, 38, 0.4))' 
                          : edge.style.filter
                      },
                      markerEnd: {
                        ...edge.markerEnd,
                        color: isSelected ? '#dc2626' : edge.markerEnd.color,
                        width: isSelected ? 30 : edge.markerEnd.width,
                        height: isSelected ? 30 : edge.markerEnd.height
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
                  connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 4 }}
                  connectionLineType="bezier"
                  defaultViewport={{ x: 0, y: 0, zoom: 0.9 }}
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
                  className="bg-gradient-to-br from-slate-50 to-blue-50"
                >
                  <Background 
                    gap={25} 
                    size={1.5} 
                    color="#e2e8f0" 
                    style={{ opacity: 0.6 }}
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
      >
        <DialogContent className="p-6">
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">
                Set Default Value
              </h2>
              <p className="text-gray-600">
                Enter a default text that will fill the entire column for:{' '}
                <span className="font-semibold text-blue-600">
                  {selectedTemplateField?.name}
                </span>
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Default Text
                </label>
                <input
                  type="text"
                  value={defaultValueText}
                  onChange={(e) => setDefaultValueText(e.target.value)}
                  placeholder="Enter text to fill all cells in this column..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">How this works:</p>
                    <p>
                      This text will be used to fill all cells in the "{selectedTemplateField?.name}" column
                      when the data is processed. This is useful for fields like "Component" where all items
                      have the same value.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={handleCancelDefaultValue}
                className="px-6 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDefaultValue}
                disabled={!defaultValueText.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors"
              >
                Set Default Value
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
      >
        <DialogTitle>Confirm Auto-Mapping</DialogTitle>
        <DialogContent>
          <Typography>
            This will remove all existing mappings. Are you sure you want to proceed?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAutoMapConfirm(false)}>Cancel</Button>
          <Button onClick={proceedWithAutoMap} color="primary">
            Proceed
          </Button>
        </DialogActions>
      </Dialog>
      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} severity={snackbar.severity || 'info'} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Debug Panel - Collapsible */}
      {debugMode && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white rounded-lg shadow-2xl max-w-md max-h-96 overflow-hidden">
          <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
            <h3 className="text-sm font-semibold">🔧 Debug Panel</h3>
            <div className="flex gap-2">
              <button
                onClick={() => window.__clearDebugHistory()}
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded"
                title="Clear debug history"
              >
                🧹
              </button>
              <button
                onClick={() => setDebugMode(false)}
                className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded"
                title="Close debug panel"
              >
                ✕
              </button>
            </div>
          </div>
          
          <div className="p-3 space-y-2 text-xs overflow-y-auto max-h-80">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-800 p-2 rounded">
                <div className="font-semibold text-blue-400">Session</div>
                <div className="text-gray-300">{sessionId?.slice(0, 8)}...</div>
              </div>
              <div className="bg-gray-800 p-2 rounded">
                <div className="font-semibold text-green-400">Edges</div>
                <div className="text-gray-300">{edges.length}</div>
              </div>
              <div className="bg-gray-800 p-2 rounded">
                <div className="font-semibold text-purple-400">Cache</div>
                <div className="text-gray-300">{mappingsCacheRef.current?.length || 0}</div>
              </div>
              <div className="bg-gray-800 p-2 rounded">
                <div className="font-semibold text-yellow-400">History</div>
                <div className="text-gray-300">{debugHistory.length}</div>
              </div>
            </div>
            
            <div className="bg-gray-800 p-2 rounded">
              <div className="font-semibold text-orange-400 mb-1">Recent Debug Logs</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {debugHistory.slice(-5).map((entry, idx) => (
                  <div key={idx} className="text-gray-300 text-xs border-l-2 border-gray-600 pl-2">
                    <div className="font-mono text-blue-400">[{entry.category}]</div>
                    <div className="text-gray-400">{entry.message}</div>
                    {entry.data && (
                      <div className="text-gray-500 text-xs mt-1">
                        {JSON.stringify(entry.data).slice(0, 100)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => window.__dumpMappingState()}
                className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs"
              >
                Dump State
              </button>
              <button
                onClick={() => {
                  console.log('🔧 Debug History:', debugHistory);
                  console.log('🔧 Cache Mappings:', mappingsCacheRef.current);
                }}
                className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs"
              >
                Log to Console
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Toggle Button */}
      <button
        onClick={() => setDebugMode(!debugMode)}
        className="fixed bottom-4 left-4 z-50 p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg transition-colors"
        title={debugMode ? 'Hide Debug Panel' : 'Show Debug Panel'}
      >
        {debugMode ? '🔧' : '🐛'}
      </button>

      {/* Template Application Dialog */}
      <Dialog
        open={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <div className="flex items-center gap-3">
            <Library className="w-6 h-6 text-green-600" />
            <div>
              <div className="text-xl font-semibold">Apply Mapping Template</div>
              <div className="text-sm text-gray-600">Choose a template to apply to your current data</div>
            </div>
          </div>
        </DialogTitle>
        <DialogContent>
          <div className="py-4">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="ml-3 text-gray-600">Loading templates...</span>
              </div>
            ) : availableTemplates.length === 0 ? (
              <div className="text-center py-8">
                <Library className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">No templates available</p>
                <p className="text-sm text-gray-500">
                  Create templates in the Data Editor to use them here
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {availableTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-green-400 cursor-pointer transition-colors"
                    onClick={() => handleApplyTemplate(template)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 mb-1">
                          {template.name}
                        </div>
                        {template.description && (
                          <div className="text-sm text-gray-600 mb-2">
                            {template.description}
                          </div>
                        )}
                        <div className="text-xs text-gray-500">
                          Created: {new Date(template.created_at).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-500">
                          Column counts: Tags={template.tags_count}, Spec={template.spec_pairs_count}, Customer={template.customer_id_pairs_count}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApplyTemplate(template);
                        }}
                        disabled={applyingTemplate}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {applyingTemplate ? 'Applying...' : 'Apply'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowTemplateDialog(false)}
            color="secondary"
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Loader Overlay */}
      <LoaderOverlay visible={globalLoading} label="Processing..." />
    </div>
  );
}
