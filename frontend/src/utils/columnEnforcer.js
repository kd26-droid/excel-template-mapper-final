/**
 * 🛡️ BULLETPROOF COLUMN ENFORCER
 * Secondary validation system that GUARANTEES critical columns are always visible
 * Prevents ANY column disappearing/appearing issues on refresh
 */

/**
 * Critical columns that MUST ALWAYS be present and visible
 */
const CRITICAL_COLUMNS = {
  tags: {
    required: true,
    minCount: 1,
    patterns: ['Tag_', 'Tag'],
    fallbackName: 'Tag_1',
    displayName: 'Tag'
  },
  factwise: {
    required: true,
    minCount: 1,
    patterns: ['Item code', 'Factwise ID', 'ItemCode'],
    fallbackName: 'Item code',
    displayName: 'Item code'
  },
  specifications: {
    required: false,
    minCount: 0,
    patterns: ['Specification_Name_', 'Specification_Value_', 'Specification name', 'Specification value'],
    fallbackName: 'Specification_Name_1',
    displayName: 'Specification name'
  }
};

/**
 * Analyze headers and identify critical column presence
 * @param {Array} headers - Array of header strings
 * @returns {Object} Analysis results
 */
function analyzeHeaders(headers) {
  console.log('🛡️ ANALYZER: Starting header analysis for', headers.length, 'headers');
  
  const analysis = {
    tags: [],
    factwise: [],
    specifications: [],
    regular: [],
    totalCount: headers.length,
    isValid: true,
    issues: []
  };
  
  headers.forEach((header, index) => {
    let classified = false;
    
    // Classify header by type
    if (CRITICAL_COLUMNS.tags.patterns.some(pattern => 
        header.startsWith(pattern) || header === pattern)) {
      analysis.tags.push({ header, index, displayName: CRITICAL_COLUMNS.tags.displayName });
      classified = true;
    }
    
    if (CRITICAL_COLUMNS.factwise.patterns.some(pattern => 
        header.startsWith(pattern) || header === pattern)) {
      analysis.factwise.push({ header, index, displayName: CRITICAL_COLUMNS.factwise.displayName });
      classified = true;
    }
    
    if (CRITICAL_COLUMNS.specifications.patterns.some(pattern => 
        header.startsWith(pattern))) {
      const displayName = header.includes('Name') ? 'Specification name' : 'Specification value';
      analysis.specifications.push({ header, index, displayName });
      classified = true;
    }
    
    if (!classified) {
      analysis.regular.push({ header, index, displayName: header });
    }
  });
  
  // Validate critical columns
  if (analysis.tags.length < CRITICAL_COLUMNS.tags.minCount) {
    analysis.isValid = false;
    analysis.issues.push(`Tags: Required ${CRITICAL_COLUMNS.tags.minCount}, found ${analysis.tags.length}`);
  }
  
  if (analysis.factwise.length < CRITICAL_COLUMNS.factwise.minCount) {
    analysis.isValid = false;
    analysis.issues.push(`FactWise: Required ${CRITICAL_COLUMNS.factwise.minCount}, found ${analysis.factwise.length}`);
  }
  
  console.log(`🛡️ ANALYZER: Results - Tags: ${analysis.tags.length}, FactWise: ${analysis.factwise.length}, Specs: ${analysis.specifications.length}, Regular: ${analysis.regular.length}`);
  
  if (!analysis.isValid) {
    console.error('🛡️ ANALYZER: VALIDATION FAILED:', analysis.issues);
  }
  
  return analysis;
}

/**
 * Enforce critical columns in headers array
 * @param {Array} headers - Current headers
 * @returns {Array} Enforced headers with guaranteed critical columns
 */
function enforceHeaders(headers) {
  console.log('🛡️ ENFORCER: Starting header enforcement');
  
  const analysis = analyzeHeaders(headers);
  let enforcedHeaders = [...headers];
  let modified = false;
  
  // RULE 1: Ensure at least 1 Tag column exists
  if (analysis.tags.length === 0) {
    console.warn('🛡️ ENFORCER: CRITICAL - No Tag columns found! Adding fallback');
    enforcedHeaders.push(CRITICAL_COLUMNS.tags.fallbackName);
    modified = true;
  }
  
  // RULE 2: Ensure at least 1 FactWise column exists
  if (analysis.factwise.length === 0) {
    console.warn('🛡️ ENFORCER: CRITICAL - No FactWise columns found! Adding fallback');
    enforcedHeaders.push(CRITICAL_COLUMNS.factwise.fallbackName);
    modified = true;
  }
  
  if (modified) {
    console.log(`🛡️ ENFORCER: Headers modified from ${headers.length} to ${enforcedHeaders.length}`);
    console.log('🛡️ ENFORCER: New headers:', enforcedHeaders.slice(-2));
  }
  
  return enforcedHeaders;
}

/**
 * Create bulletproof AG Grid column definitions
 * @param {Array} headers - Headers to create columns for
 * @returns {Array} AG Grid column definitions with guaranteed critical columns
 */
function createEnforcedColumnDefs(headers) {
  console.log('🛡️ COLUMN-CREATOR: Creating bulletproof column definitions');
  
  const enforcedHeaders = enforceHeaders(headers);
  const analysis = analyzeHeaders(enforcedHeaders);
  
  // Start with row number column
  const cols = [
    {
      headerName: '#',
      field: '__row_number__',
      valueGetter: 'node.rowIndex + 1',
      width: 80,
      pinned: 'left',
      cellStyle: { 
        backgroundColor: '#f8f9fa', 
        fontWeight: 'bold',
        textAlign: 'center'
      }
    }
  ];
  
  // Create columns for all headers with special handling for critical columns
  enforcedHeaders.forEach((header, index) => {
    const isTag = analysis.tags.some(t => t.header === header);
    const isFactwise = analysis.factwise.some(f => f.header === header);
    const isSpec = analysis.specifications.some(s => s.header === header);
    
    let displayName = header;
    let cellStyle = {};
    let headerClass = 'ag-header-cell-excel';
    
    // Apply special styling for critical columns
    if (isTag) {
      displayName = 'Tag';
      cellStyle = {
        backgroundColor: '#e8f5e8',
        borderLeft: '4px solid #4caf50',
        fontWeight: '600',
        border: '2px solid #4caf50' // Extra visibility
      };
      headerClass = 'ag-header-formula';
    } else if (isFactwise) {
      cellStyle = {
        backgroundColor: '#fff3e0',
        borderLeft: '4px solid #ff9800',
        fontWeight: '600',
        border: '2px solid #ff9800' // Extra visibility
      };
      headerClass = 'ag-header-factwise';
    } else if (isSpec) {
      displayName = header.includes('Name') ? 'Specification name' : 'Specification value';
      cellStyle = {
        backgroundColor: '#f0f8ff',
        borderLeft: '4px solid #2196f3',
        fontWeight: '500'
      };
      headerClass = 'ag-header-specification';
    }
    
    const colDef = {
      headerName: displayName,
      field: header,
      width: Math.max(180, Math.min(400, displayName.length * 10 + 40)),
      minWidth: 120,
      resizable: true,
      cellStyle: {
        borderRight: '1px solid #e9ecef',
        borderBottom: '1px solid #e9ecef',
        fontSize: '14px',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        padding: '12px 16px',
        ...cellStyle
      },
      headerClass: headerClass,
      // Mark critical columns for special handling
      isCritical: isTag || isFactwise,
      columnType: isTag ? 'tag' : isFactwise ? 'factwise' : isSpec ? 'specification' : 'regular',
      __enforcer: {
        originalHeader: header,
        index: index,
        guaranteed: true
      }
    };
    
    cols.push(colDef);
  });
  
  // Final validation
  const tagCols = cols.filter(c => c.columnType === 'tag').length;
  const factwiseCols = cols.filter(c => c.columnType === 'factwise').length;
  
  console.log(`🛡️ COLUMN-CREATOR: Created ${cols.length - 1} columns (Tags: ${tagCols}, FactWise: ${factwiseCols})`);
  
  if (tagCols === 0 || factwiseCols === 0) {
    console.error('🛡️ COLUMN-CREATOR: CRITICAL FAILURE - Missing required columns!');
    throw new Error(`Column enforcement failed: Tags=${tagCols}, FactWise=${factwiseCols}`);
  }
  
  return cols;
}

/**
 * Validate that row data matches column structure
 * @param {Array} rowData - AG Grid row data
 * @param {Array} columnDefs - AG Grid column definitions
 * @returns {Boolean} True if data structure is valid
 */
function validateDataStructure(rowData, columnDefs) {
  if (!rowData || rowData.length === 0) return true;
  
  const expectedFields = new Set(columnDefs.slice(1).map(col => col.field));
  const actualFields = new Set(Object.keys(rowData[0] || {}));
  
  const missingFields = [...expectedFields].filter(field => !actualFields.has(field));
  const extraFields = [...actualFields].filter(field => !expectedFields.has(field));
  
  if (missingFields.length > 0) {
    console.warn('🛡️ VALIDATOR: Missing fields in data:', missingFields);
    return false;
  }
  
  if (extraFields.length > 0) {
    console.warn('🛡️ VALIDATOR: Extra fields in data:', extraFields);
  }
  
  return true;
}

/**
 * Fix row data structure to match column definitions
 * @param {Array} rowData - Current row data
 * @param {Array} columnDefs - Target column definitions
 * @returns {Array} Fixed row data
 */
function fixDataStructure(rowData, columnDefs) {
  console.log('🛡️ DATA-FIXER: Fixing data structure alignment');
  
  const requiredFields = columnDefs.slice(1).map(col => col.field);
  
  const fixedData = rowData.map(row => {
    const fixedRow = {};
    
    requiredFields.forEach(field => {
      fixedRow[field] = row[field] || '';
    });
    
    return fixedRow;
  });
  
  console.log(`🛡️ DATA-FIXER: Fixed ${fixedData.length} rows with ${requiredFields.length} fields each`);
  return fixedData;
}

/**
 * Main enforcement function - ensures bulletproof column consistency
 * @param {Array} headers - Headers from backend
 * @param {Array} rowData - Row data from backend
 * @returns {Object} Enforced column definitions and fixed data
 */
function enforceColumnConsistency(headers, rowData) {
  console.log('🛡️ MAIN-ENFORCER: Starting bulletproof column enforcement');
  console.log('🛡️ MAIN-ENFORCER: Input - Headers:', headers?.length || 0, 'Rows:', rowData?.length || 0);
  
  try {
    // Step 1: Create bulletproof column definitions
    const columnDefs = createEnforcedColumnDefs(headers || []);
    
    // Step 2: Validate and fix data structure
    let fixedRowData = rowData || [];
    if (!validateDataStructure(fixedRowData, columnDefs)) {
      fixedRowData = fixDataStructure(fixedRowData, columnDefs);
    }
    
    // Step 3: Final validation
    const tagColumns = columnDefs.filter(c => c.columnType === 'tag');
    const factwiseColumns = columnDefs.filter(c => c.columnType === 'factwise');
    
    console.log('🛡️ MAIN-ENFORCER: SUCCESS - Guaranteed columns created');
    console.log(`🛡️ MAIN-ENFORCER: Tags: ${tagColumns.length}, FactWise: ${factwiseColumns.length}, Total: ${columnDefs.length - 1}`);
    
    return {
      columnDefs,
      rowData: fixedRowData,
      analysis: {
        tagColumns: tagColumns.length,
        factwiseColumns: factwiseColumns.length,
        totalColumns: columnDefs.length - 1,
        guaranteed: true
      }
    };
    
  } catch (error) {
    console.error('🛡️ MAIN-ENFORCER: ENFORCEMENT FAILED:', error);
    throw error;
  }
}

export {
  analyzeHeaders,
  enforceHeaders,
  createEnforcedColumnDefs,
  validateDataStructure,
  fixDataStructure,
  enforceColumnConsistency,
  CRITICAL_COLUMNS
};