import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Zap,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  Save,
  ArrowRight,
  Brain,
  Target,
  Upload,
  CheckCircle,
  AlertCircle,
  Users,
  FileText,
  Info,
  RefreshCw,
  Library,
  X,
  AlertTriangle,
  Settings,
  CheckSquare,
  HelpCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  CircularProgress,
  Typography
} from '@mui/material';
import api from '../services/api';

// Enhanced Professional Custom Node Component
const CustomNode = ({ data, id }) => {
  const isSource = id.startsWith('c-');
  const isConnected = data.isConnected;
  const confidence = data.confidence;
  const isSelected = data.isSelected;
  const isFromTemplate = data.isFromTemplate;
  const isSpecificationMapping = data.isSpecificationMapping;
  const hasDefaultValue = data.hasDefaultValue;
  
  return (
    <div className={`
      relative group cursor-pointer transition-all duration-300 transform hover:scale-105
      ${isSource ? 'hover:translate-x-2' : 'hover:-translate-x-2'}
    `}>
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
        <div className="px-3 break-words text-center leading-tight" title={data.label}>
          {data.label}
        </div>
        
        {/* Status indicators */}
        {isConnected && (
          <div className={`absolute -top-3 -left-3 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center shadow-lg
            ${isSpecificationMapping ? 'bg-orange-500 animate-pulse' : isFromTemplate ? 'bg-green-500 animate-pulse' : 'bg-blue-500'}
          `}>
            {isSpecificationMapping ? <Settings size={14} /> : isFromTemplate ? <Library size={14} /> : <CheckCircle size={14} />}
          </div>
        )}
        
        {/* Template indicator */}
        {isFromTemplate && (
          <div className="absolute -bottom-2 -right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Template
          </div>
        )}
        
        {/* Specification mapping indicator */}
        {isSpecificationMapping && (
          <div className="absolute -bottom-2 -right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Spec
          </div>
        )}
        
        {/* Default value indicator for unmapped template fields */}
        {!isSource && hasDefaultValue && !isConnected && (
          <div className="absolute -bottom-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-bold shadow-lg">
            Default
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
            {Math.round(confidence * 100)}%
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
  
  // State for real data
  const [clientHeaders, setClientHeaders] = useState([]);
  const [templateHeaders, setTemplateHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [mappingHistory, setMappingHistory] = useState([]);
  const [showConfidence, setShowConfidence] = useState(true);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [selectedSourceNode, setSelectedSourceNode] = useState(null);
  
  // Auto mapping state
  const [isAutoMapping, setIsAutoMapping] = useState(false);
  
  // Review state
  const [isReviewing, setIsReviewing] = useState(false);

  // Default value popup state
  const [showDefaultValueDialog, setShowDefaultValueDialog] = useState(false);
  const [selectedTemplateField, setSelectedTemplateField] = useState(null);
  const [defaultValueText, setDefaultValueText] = useState('');
  const [defaultValueMappings, setDefaultValueMappings] = useState({});
  
  // ENHANCED: Template applied state with comprehensive tracking
  const [templateApplied, setTemplateApplied] = useState(false);
  const [appliedTemplateName, setAppliedTemplateName] = useState('');
  const [templateMappingCount, setTemplateMappingCount] = useState(0);
  const [originalTemplateId, setOriginalTemplateId] = useState(null);
  const [templateSuccess, setTemplateSuccess] = useState(false);

  // Specification handling state
  const [specificationOpportunity, setSpecificationOpportunity] = useState(null);
  // COMMENTED OUT: Specification overflow state
  // const [specificationOverflow, setSpecificationOverflow] = useState(null);
  // const [showSpecOverflowAlert, setShowSpecOverflowAlert] = useState(false);
  const [specificationMappingsApplied, setSpecificationMappingsApplied] = useState(false);

  // Mapping statistics
  const [mappingStats, setMappingStats] = useState({
    total: 0,
    manual: 0,
    ai: 0,
    template: 0,
    specification: 0,
    confidence: { high: 0, medium: 0, low: 0 }
  });

  // Load real data from API and check for existing mappings
  useEffect(() => {
    if (!sessionId) return;
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Get headers from API
        console.log('🔍 Fetching headers for session:', sessionId);
        const response = await api.getHeaders(sessionId);
        console.log('🔍 Raw API response:', response);
        
        const { data } = response;
        console.log('🔍 Response data:', data);
        
        const { client_headers = [], template_headers = [], session_metadata = {} } = data;
        
        console.log('🔍 Extracted headers:', { 
          client_headers: client_headers, 
          template_headers: template_headers, 
          session_metadata: session_metadata 
        });
        
        // Validate headers
        if (!Array.isArray(client_headers)) {
          console.error('❌ client_headers is not an array:', typeof client_headers, client_headers);
        }
        if (!Array.isArray(template_headers)) {
          console.error('❌ template_headers is not an array:', typeof template_headers, template_headers);
        }
        
        setClientHeaders(client_headers);
        setTemplateHeaders(template_headers);
        
        console.log('✅ Headers set successfully:', {
          clientCount: client_headers.length,
          templateCount: template_headers.length,
          clientHeaders: client_headers,
          templateHeaders: template_headers
        });
        
        // DEBUG: Additional validation
        if (client_headers.length === 0) {
          console.error('❌ CLIENT HEADERS ARE EMPTY!');
        }
        if (template_headers.length === 0) {
          console.error('❌ TEMPLATE HEADERS ARE EMPTY!');
        }
        
        // ENHANCED: Extract template information from session metadata
        if (session_metadata.original_template_id) {
          setOriginalTemplateId(session_metadata.original_template_id);
          console.log('🔍 Found original template ID from session metadata:', session_metadata.original_template_id);
        }
        
        if (session_metadata.template_applied) {
          setTemplateApplied(true);
          console.log('🔍 Template was applied during upload');
        }
        
        if (session_metadata.template_name) {
          setAppliedTemplateName(session_metadata.template_name);
          console.log('🔍 Applied template name:', session_metadata.template_name);
        }
        
        // Initialize nodes
        console.log('📝 About to initialize nodes with:', {
          clientHeadersLength: client_headers.length,
          templateHeadersLength: template_headers.length,
          clientHeaders: client_headers,
          templateHeaders: template_headers
        });
        initializeNodes(client_headers, template_headers);
        
        // DEBUG: Check what was actually passed to initializeNodes
        console.log('🔍 Values passed to initializeNodes:', {
          client_headers_passed: client_headers,
          template_headers_passed: template_headers,
          client_count: client_headers.length,
          template_count: template_headers.length
        });
        
        // Check for existing mappings first
        await checkExistingMappings(client_headers, template_headers);
        
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
          initializeNodes(fallbackClient, fallbackTemplate);
        }
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [sessionId]);

  // Check for existing mappings (from template application)
  const checkExistingMappings = async (clientHdrs, templateHdrs) => {
    try {
      const response = await api.getExistingMappings(sessionId);
      const existingMappings = response.data.mappings;
      const existingDefaultValues = response.data.default_values || {};
      const sessionMetadata = response.data.session_metadata || {};
      
      console.log('🔍 Existing mappings response:', response.data);
      console.log('🔍 Existing default values:', existingDefaultValues);
      
      if (existingMappings && Object.keys(existingMappings).length > 0) {
        console.log('Found existing mappings:', existingMappings);
        
        // Apply existing mappings to the flow
        applyExistingMappingsToFlow(existingMappings, clientHdrs, templateHdrs);
        
        // Restore default values if they exist
        if (existingDefaultValues && Object.keys(existingDefaultValues).length > 0) {
          setDefaultValueMappings(existingDefaultValues);
          console.log('🔍 Restored default values from session:', existingDefaultValues);
        }
        
        // ENHANCED: Set template applied state from session metadata
        if (sessionMetadata.template_applied) {
          setTemplateApplied(true);
          setTemplateMappingCount(Object.keys(existingMappings).length);
          
          if (sessionMetadata.template_name) {
            setAppliedTemplateName(sessionMetadata.template_name);
          }
          
          if (sessionMetadata.original_template_id) {
            setOriginalTemplateId(sessionMetadata.original_template_id);
            console.log('🔍 Set original template ID from existing mappings:', sessionMetadata.original_template_id);
          }
          
          if (sessionMetadata.template_success !== undefined) {
            setTemplateSuccess(sessionMetadata.template_success);
          }
          
          console.log('🔍 Template state restored from session metadata');
        } else {
          // Fallback to generic template applied state
          setTemplateApplied(true);
          setTemplateMappingCount(Object.keys(existingMappings).length);
          setAppliedTemplateName('Previously Applied Template');
        }
      }
    } catch (err) {
      console.error('Error checking existing mappings:', err);
      // Don't throw error, just continue without existing mappings
    }
  };

  // Apply existing mappings to the React Flow
  const applyExistingMappingsToFlow = (mappings, clientHdrs, templateHdrs) => {
    const newEdges = [];
    
    console.log('🔍 Applying existing mappings:', mappings);
    console.log('🔍 Client headers:', clientHdrs);
    console.log('🔍 Template headers:', templateHdrs);
    
    // Handle new mapping format with 'mappings' array
    if (mappings && mappings.mappings && Array.isArray(mappings.mappings)) {
      console.log('🔍 Processing new mapping format');
      mappings.mappings.forEach(mapping => {
        const sourceCol = mapping.source;
        const templateCol = mapping.target;
        
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetIdx = templateHdrs.indexOf(templateCol);
        
        console.log(`🔍 Mapping: ${sourceCol} -> ${templateCol} (source idx: ${sourceIdx}, target idx: ${targetIdx})`);
        
        if (sourceIdx >= 0 && targetIdx >= 0) {
          const edge = createEdge(sourceIdx, targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
        }
      });
    } else {
      // Handle old format for backward compatibility
      console.log('🔍 Processing old mapping format');
      Object.entries(mappings || {}).forEach(([templateCol, sourceCol]) => {
        const sourceIdx = clientHdrs.indexOf(sourceCol);
        const targetIdx = templateHdrs.indexOf(templateCol);
        
        if (sourceIdx >= 0 && targetIdx >= 0) {
          const edge = createEdge(sourceIdx, targetIdx, false, null, true); // true = from template
          newEdges.push(edge);
        }
      });
    }
    
    console.log(`🔍 Created ${newEdges.length} edges from existing mappings`);
    
    // Set the edges
    setEdges(newEdges);
    
    // Update node connection states
    setTimeout(() => {
      setNodes(prev => prev.map(node => {
        const isConnected = newEdges.some(edge => 
          edge.source === node.id || edge.target === node.id
        );
        const isFromTemplate = newEdges.some(edge => 
          (edge.source === node.id || edge.target === node.id) && edge.data?.isFromTemplate
        );
        return {
          ...node,
          data: { 
            ...node.data, 
            isConnected,
            isFromTemplate
          }
        };
      }));
    }, 100);
    
    // Save to mapping history
    setTimeout(() => {
      setMappingHistory([{ nodes, edges: newEdges }]);
      console.log('Applied existing mappings to flow');
    }, 200);
  };

  // Initialize nodes aligned with fixed headers and save initial state
  const initializeNodes = (clientHdrs, templateHdrs, aiMappings = null) => {
    console.log('🔧 Initializing nodes with:', { 
      clientHdrs: clientHdrs, 
      clientCount: clientHdrs?.length || 0,
      templateHdrs: templateHdrs, 
      templateCount: templateHdrs?.length || 0,
      aiMappings: aiMappings 
    });
    
    const nodeHeight = 90;
    const nodeSpacing = 30;
    const startY = 40; // Space for frozen headers
    
    // Create source nodes (adjusted for sidebar)
    const clientNodes = clientHdrs.map((header, idx) => ({
      id: `c-${idx}`,
      type: 'custom',
      position: { x: 20, y: startY + idx * (nodeHeight + nodeSpacing) },
      data: { 
        label: header, 
        isConnected: false,
        isSelected: false,
        isFromTemplate: false,
        isSpecificationMapping: false,
        hasDefaultValue: false
      },
      draggable: false
    }));

    // Smart positioning for target nodes if AI mappings exist
    let targetNodes;
    
    if (aiMappings && Object.keys(aiMappings).length > 0) {
      const matchedTargets = new Set();
      const alignedTargets = [];
      
      // Position matched targets aligned with their sources
      Object.entries(aiMappings).forEach(([templateCol, info]) => {
        if (info.suggested_column) {
          const sourceIdx = clientHdrs.indexOf(info.suggested_column);
          const targetIdx = templateHdrs.indexOf(templateCol);
          
          if (sourceIdx >= 0 && targetIdx >= 0) {
            matchedTargets.add(targetIdx);
            alignedTargets.push({
              id: `t-${targetIdx}`,
              type: 'custom',
              position: { 
                x: 600, 
                y: 40 + sourceIdx * (nodeHeight + nodeSpacing)
              },
              data: { 
                label: templateCol, 
                isConnected: false,
                isSelected: false,
                isFromTemplate: false,
                isSpecificationMapping: info.is_specification_mapping || false
              },
              draggable: false
            });
          }
        }
      });
      
      // Position unmatched targets
      let unmatchedY = 40;
      templateHdrs.forEach((header, idx) => {
        if (!matchedTargets.has(idx)) {
          while (alignedTargets.some(node => node.position.y === unmatchedY)) {
            unmatchedY += (nodeHeight + nodeSpacing);
          }
          
          alignedTargets.push({
            id: `t-${idx}`,
            type: 'custom',
            position: { x: 600, y: unmatchedY },
            data: { 
              label: header, 
              isConnected: false,
              isSelected: false,
              isFromTemplate: false,
              isSpecificationMapping: false
            },
            draggable: false
          });
          
          unmatchedY += (nodeHeight + nodeSpacing);
        }
      });
      
      targetNodes = alignedTargets;
    } else {
      // Regular positioning
      targetNodes = templateHdrs.map((header, idx) => ({
        id: `t-${idx}`,
        type: 'custom',
        position: { x: 600, y: 40 + idx * (nodeHeight + nodeSpacing) },
        data: { 
          label: header, 
          isConnected: false,
          isSelected: false,
          isFromTemplate: false,
          isSpecificationMapping: false
        },
        draggable: false
      }));
    }

    const allNodes = [...clientNodes, ...targetNodes];
    console.log('🔧 Created nodes summary:', {
      totalNodes: allNodes.length,
      clientNodesCount: clientNodes.length,
      targetNodesCount: targetNodes.length,
      clientNodeIds: clientNodes.map(n => n.id),
      targetNodeIds: targetNodes.map(n => n.id),
      clientLabels: clientNodes.map(n => n.data.label),
      targetLabels: targetNodes.map(n => n.data.label)
    });
    setNodes(allNodes);
    
    // Save initial state to mapping history if it's empty and no existing mappings
    setTimeout(() => {
      if (mappingHistory.length === 0) {
        setMappingHistory([{ nodes: allNodes, edges: [] }]);
        console.log('Saved initial state to mapping history');
      }
    }, 100);
  };

  // SUPER SIMPLE direct arrows - straight lines to what's in front
  const createEdge = (sourceIdx, targetIdx, isAI = false, confidence = null, isFromTemplate = false, isSpecificationMapping = false) => {
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
  };

  // Handle default value dialog
  const handleSaveDefaultValue = () => {
    if (!selectedTemplateField || !defaultValueText.trim()) return;
    
    // Save the default value mapping
    setDefaultValueMappings(prev => ({
      ...prev,
      [selectedTemplateField.name]: defaultValueText.trim()
    }));
    
    // Close dialog and reset state
    setShowDefaultValueDialog(false);
    setSelectedTemplateField(null);
    setDefaultValueText('');
    
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
        isConnected: false, 
        isFromTemplate: false,
        isSpecificationMapping: false,
        confidence: undefined, 
        isSelected: false 
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
    
    console.log('Cleared template mappings');
  };

  // Check if all template fields are mapped
  const isCompleteMapping = () => {
    const targetNodeIds = templateHeaders.map((_, idx) => `t-${idx}`);
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
      setNodes(prev => prev.map(n => {
        if (n.id === selectedSourceNode || n.id === node.id) {
          return { 
            ...n, 
            data: { 
              ...n.data, 
              isConnected: true, 
              isSelected: false,
              isFromTemplate: false, // Manual mapping overrides template
              isSpecificationMapping: false // Manual mapping overrides specification
            } 
          };
        }
        return { ...n, data: { ...n.data, isSelected: false } };
      }));
      
      setSelectedSourceNode(null);
    } else if (node.id.startsWith('t-') && !selectedSourceNode) {
      // Template node clicked without source selected - check if unmapped
      const targetIdx = parseInt(node.id.replace('t-', ''));
      const isNodeMapped = edges.some(edge => edge.target === node.id);
      
      if (!isNodeMapped) {
        // Unmapped template field clicked - open default value dialog
        const templateFieldName = templateHeaders[targetIdx];
        setSelectedTemplateField({ id: node.id, name: templateFieldName, index: targetIdx });
        setDefaultValueText(defaultValueMappings[templateFieldName] || '');
        setShowDefaultValueDialog(true);
      }
    }
  }, [selectedSourceNode, nodes, edges, setNodes, setEdges, templateHeaders, defaultValueMappings]);

  // Auto-mapping using real API with enhanced specification handling
  const handleAutoMap = async () => {
    setIsAutoMapping(true);
    setMappingHistory(prev => [...prev, { nodes, edges }]);
    
    try {
      // Clear existing edges
      setEdges([]);
      
      // Get AI suggestions from API
      const { data } = await api.getColumnMappingSuggestions(sessionId);
      const { user_columns, template_columns, ai_suggestions, specification_opportunity, session_metadata } = data;
      
      console.log('AI Mapping Response:', data);
      
      // ENHANCED: Extract template information from session metadata if available
      if (session_metadata && session_metadata.original_template_id) {
        setOriginalTemplateId(session_metadata.original_template_id);
        console.log('🔍 Updated original template ID from mapping suggestions:', session_metadata.original_template_id);
      }
      
      // Handle specification opportunity
      if (specification_opportunity && specification_opportunity.detected) {
        setSpecificationOpportunity(specification_opportunity);
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
        setNodes(prev => prev.map(node => {
          if (node.id === `c-${mapping.sourceIdx}` || node.id === `t-${mapping.targetIdx}`) {
            return {
              ...node,
              data: { 
                ...node.data, 
                isConnected: true,
                isFromTemplate: false, // AI mapping, not template
                isSpecificationMapping: mapping.isSpecificationMapping,
                confidence: node.id === `t-${mapping.targetIdx}` ? mapping.confidence : undefined
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

  // DYNAMICALLY RE-ORDER TARGET NODES TO PREVENT LINE OVERLAPPING
  useEffect(() => {
    // Using a timeout to batch updates and prevent re-ordering during rapid edge changes (e.g., auto-mapping)
    const timer = setTimeout(() => {
      setNodes(currentNodes => {
        if (!currentNodes || currentNodes.length === 0) return currentNodes;

        const nodeHeight = 90;
        const nodeSpacing = 30;
        const yStep = nodeHeight + nodeSpacing;
        const startY = 40;

        const clientNodes = currentNodes.filter(n => n.id.startsWith('c-'));
        const templateNodes = currentNodes.filter(n => n.id.startsWith('t-'));

        // If there are no edges, reset to default order based on templateHeaders
        if (edges.length === 0) {
          let hasChanged = false;
          const newNodes = currentNodes.map(node => {
            if (node.id.startsWith('t-')) {
              const idx = templateHeaders.findIndex(h => h === node.data.label);
              if (idx !== -1) {
                const newY = startY + idx * yStep;
                if (node.position.y !== newY) {
                  hasChanged = true;
                  return { ...node, position: { ...node.position, y: newY } };
                }
              }
            }
            return node;
          });
          return hasChanged ? newNodes : currentNodes;
        }

        const sourceToTargets = new Map();
        edges.forEach(edge => {
          if (!sourceToTargets.has(edge.source)) {
            sourceToTargets.set(edge.source, []);
          }
          sourceToTargets.get(edge.source).push(edge.target);
        });

        const newTargetOrder = [];
        const positionedTargets = new Set();

        clientNodes.sort((a, b) => a.position.y - b.position.y).forEach(sourceNode => {
          const targets = (sourceToTargets.get(sourceNode.id) || [])
            .map(targetId => templateNodes.find(n => n.id === targetId))
            .filter(Boolean);
          
          targets.forEach(targetNode => {
            if (!positionedTargets.has(targetNode.id)) {
              newTargetOrder.push(targetNode);
              positionedTargets.add(targetNode.id);
            }
          });
        });

        templateNodes.forEach(targetNode => {
          if (!positionedTargets.has(targetNode.id)) {
            newTargetOrder.push(targetNode);
          }
        });

        let hasChanged = false;
        const newNodes = currentNodes.map(node => {
          if (node.id.startsWith('t-')) {
            const newIndex = newTargetOrder.findIndex(n => n.id === node.id);
            if (newIndex !== -1) {
              const newY = startY + newIndex * yStep;
              if (node.position.y !== newY) {
                hasChanged = true;
                return { ...node, position: { ...node.position, y: newY } };
              }
            }
          }
          return node;
        });
        
        return hasChanged ? newNodes : currentNodes;
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [edges, setNodes, templateHeaders]);

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
    
    // Update node connection states
    setNodes(prev => prev.map(node => {
      if (node.id === connection.source || node.id === connection.target) {
        return { 
          ...node, 
          data: { 
            ...node.data, 
            isConnected: true,
            isFromTemplate: false, // Manual connection overrides template
            isSpecificationMapping: false // Manual connection overrides specification
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
            return {
              ...node,
              data: { 
                ...node.data, 
                isConnected: stillConnected,
                isFromTemplate: stillConnected ? node.data.isFromTemplate : false,
                isSpecificationMapping: stillConnected ? node.data.isSpecificationMapping : false,
                confidence: node.id === edgeToDelete.target ? undefined : node.data.confidence
              }
            };
          }
          return node;
        }));
      }, 100);
      
      setSelectedEdge(null);
    }
  };

  // Clear all mappings
  const clearMappings = () => {
    setMappingHistory(prev => [...prev, { nodes, edges }]);
    setEdges([]);
    setNodes(prev => prev.map(node => ({
      ...node,
      data: { 
        ...node.data, 
        isConnected: false, 
        isFromTemplate: false,
        isSpecificationMapping: false,
        confidence: undefined, 
        isSelected: false 
      }
    })));
    setSelectedSourceNode(null);
    setSelectedEdge(null);
    setTemplateApplied(false);
    setSpecificationMappingsApplied(false);
    setOriginalTemplateId(null);
    setTemplateSuccess(false);
    setDefaultValueMappings({}); // Clear default values
    
    // Clear saved mappings from sessionStorage
    sessionStorage.removeItem('currentMapping');
    console.log('Cleared all mappings and sessionStorage');
  };

  // Undo last action with better error handling
  const undoLastAction = () => {
    if (mappingHistory.length > 0) {
      const lastState = mappingHistory[mappingHistory.length - 1];
      
      // Ensure we have valid state to restore
      if (lastState && lastState.nodes && Array.isArray(lastState.nodes)) {
        console.log('Restoring state:', lastState);
        setNodes(lastState.nodes);
        setEdges(lastState.edges || []);
        setMappingHistory(prev => prev.slice(0, -1));
        setSelectedSourceNode(null);
        setSelectedEdge(null);
      } else {
        console.warn('Invalid state in mapping history, reinitializing nodes');
        // Fallback: reinitialize nodes if state is corrupted
        initializeNodes(clientHeaders, templateHeaders);
        setEdges([]);
        setMappingHistory([]);
      }
    } else {
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

  // Update nodes when default value mappings change
  useEffect(() => {
    setNodes(prev => prev.map(node => {
      if (!node.id.startsWith('t-')) return node; // Only update template nodes
      
      const targetIdx = parseInt(node.id.replace('t-', ''));
      const templateFieldName = templateHeaders[targetIdx];
      const hasDefaultValue = templateFieldName && defaultValueMappings[templateFieldName];
      
      return {
        ...node,
        data: {
          ...node.data,
          hasDefaultValue: !!hasDefaultValue
        }
      };
    }));
  }, [defaultValueMappings, templateHeaders, setNodes]);

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
      const mappingForRestore = {
        mappings: edges.map(edge => ({
          sourceColumn: clientHeaders[parseInt(edge.source.replace('c-', ''))],
          targetColumn: templateHeaders[parseInt(edge.target.replace('t-', ''))],
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
      console.log('🔄 Auto-saved mappings to sessionStorage with template info:', {
        sessionId,
        originalTemplateId,
        templateApplied,
        appliedTemplateName
      });
    }
  }, [edges, clientHeaders, templateHeaders, sessionId, originalTemplateId, templateApplied, appliedTemplateName, templateSuccess]);

  // ENHANCED: Navigate to review page - UPDATED TO SEND TO BACKEND with template preservation
  const handleReview = async () => {
    if (edges.length === 0) {
      setError('Please create at least one mapping before reviewing.');
      return;
    }

    setIsReviewing(true);
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
      const mappingData = {
        mappings: sortedEdges.map(edge => {
          const sourceIdx = parseInt(edge.source.replace('c-', ''));
          const targetIdx = parseInt(edge.target.replace('t-', ''));
          const sourceColumn = clientHeaders[sourceIdx];
          const targetColumn = templateHeaders[targetIdx];
          
          console.log(`Processing edge: ${sourceColumn} -> ${targetColumn}`);
          return {
            source: sourceColumn,
            target: targetColumn
          };
        }),
        // Include default value mappings for unmapped fields
        default_values: defaultValueMappings
      };

      console.log('🔄 Sending mapping data to backend:', mappingData);

      // Send mapping to backend
      await api.saveColumnMappings(sessionId, mappingData);

      // ENHANCED: Save comprehensive mapping info to sessionStorage for restoration
      const mappingForRestore = {
        mappings: edges.map(edge => ({
          sourceColumn: clientHeaders[parseInt(edge.source.replace('c-', ''))],
          targetColumn: templateHeaders[parseInt(edge.target.replace('t-', ''))],
          isAiGenerated: edge.data?.isAiGenerated || false,
          isFromTemplate: edge.data?.isFromTemplate || false,
          isSpecificationMapping: edge.data?.isSpecificationMapping || false,
          confidence: edge.data?.confidence
        })),
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
              disabled={isAutoMapping}
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
              disabled={edges.length === 0 || isReviewing}
              className={`
                px-8 py-3 rounded-lg font-semibold flex items-center gap-2 shadow-sm transition-all
                ${edges.length > 0 && !isReviewing
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-200 text-gray-500'
                }
              `}
            >
              {isReviewing ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  Saving...
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
        
        {/* Left Stats Panel - updated with specification stats */}
        <div className="w-64 bg-white shadow-lg border-r border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6">Mapping Statistics</h3>
          
          <div className="space-y-6">
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <div className="text-3xl font-bold text-blue-600">{mappingStats.total}</div>
              <div className="text-sm text-blue-700 font-medium">Total Mapped</div>
            </div>
            
            {mappingStats.template > 0 && (
              <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Library size={20} className="text-green-600" />
                  <div className="text-2xl font-bold text-green-600">{mappingStats.template}</div>
                </div>
                <div className="text-sm text-green-700 font-medium">From Template</div>
              </div>
            )}
            
            {mappingStats.specification > 0 && (
              <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <Settings size={20} className="text-orange-600" />
                  <div className="text-2xl font-bold text-orange-600">{mappingStats.specification}</div>
                </div>
                <div className="text-sm text-orange-700 font-medium">Specification</div>
              </div>
            )}
            
            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={20} className="text-emerald-600" />
                <div className="text-2xl font-bold text-emerald-600">{mappingStats.ai}</div>
              </div>
              <div className="text-sm text-emerald-700 font-medium">AI Suggested</div>
            </div>
            
            <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Users size={20} className="text-purple-600" />
                <div className="text-2xl font-bold text-purple-600">{mappingStats.manual}</div>
              </div>
              <div className="text-sm text-purple-700 font-medium">Manual</div>
            </div>
            
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
              <div className="text-2xl font-bold text-amber-600">{mappingStats.confidence.high}</div>
              <div className="text-sm text-amber-700 font-medium">High Confidence</div>
            </div>
          </div>
          
          {/* Progress indicator */}
          <div className="mt-8 p-4 bg-gray-50 rounded-xl">
            <div className="text-sm text-gray-600 mb-2">Mapping Progress</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${templateHeaders.length > 0 ? (mappingStats.total / templateHeaders.length) * 100 : 0}%` }}
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
              <div className="bg-blue-600 text-white px-6 py-3 rounded-xl shadow-lg font-bold">
                Client Data ({clientHeaders.length})
              </div>
            </div>
            
            <div className="absolute" style={{ left: '535px', top: '80px' }}>
              <div className="bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-lg font-bold">
                Template ({templateHeaders.length})
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
    </div>
  );
}