/**
 * Snapshot Helper - Apply backend snapshots to frontend editor state
 * Ensures consistent state updates after mutations without refresh
 */

/**
 * Apply returned snapshot to editor state immediately
 * @param {Object} snapshot - Snapshot from backend
 * @param {Object} stateFunctions - State setter functions from editor
 */
function applySnapshotToEditor(snapshot, stateFunctions) {
  if (!snapshot || !stateFunctions) {
    console.warn('❌ applySnapshotToEditor: Invalid snapshot or state functions');
    return;
  }

  const { 
    setColumnDefs, 
    setRowData, 
    setDynamicColumnCounts, 
    setHasFormulas,
    setAppliedFormulas,
    setFormulaColumns,
    setFactwiseIdRule
  } = stateFunctions;

  try {
    console.log('🔄 Applying snapshot to editor:', snapshot);

    // Update column counts
    const counts = snapshot.counts || {};
    if (setDynamicColumnCounts) {
      setDynamicColumnCounts({
        tags_count: counts.tags_count || 1,
        spec_pairs_count: counts.spec_pairs_count || 1,
        customer_id_pairs_count: counts.customer_id_pairs_count || 1
      });
      console.log('✅ Updated dynamic column counts:', counts);
    }

    // Create column definitions from headers
    const headers = snapshot.headers || [];
    console.log(`🔧 SNAPSHOT: Processing ${headers.length} headers:`, headers.slice(0, 5));
    
    if (setColumnDefs && headers.length > 0) {
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
      
      // Track column creation for debugging
      let tagColumns = 0;
      let specColumns = 0;
      let customerColumns = 0;
      let factwiseColumns = 0;
      
      headers.forEach((h, index) => {
        let displayName = h;
        let columnType = 'regular';
        
        // Apply display name mappings and track column types
        if (h.startsWith('Tag_') || h === 'Tag') {
          displayName = 'Tag';
          columnType = 'tag';
          tagColumns++;
        } else if (h.startsWith('Specification_Name_') || h === 'Specification name') {
          displayName = 'Specification name';
          columnType = 'spec';
          specColumns++;
        } else if (h.startsWith('Specification_Value_') || h === 'Specification value') {
          displayName = 'Specification value';
          columnType = 'spec';
          specColumns++;
        } else if (h.startsWith('Customer_Identification_Name_') || h === 'Customer identification name' || h === 'Custom identification name') {
          displayName = 'Customer identification name';
          columnType = 'customer';
          customerColumns++;
        } else if (h.startsWith('Customer_Identification_Value_') || h === 'Customer identification value' || h === 'Custom identification value') {
          displayName = 'Customer identification value';
          columnType = 'customer';
          customerColumns++;
        } else if (h === 'Factwise ID' || h === 'Item code') {
          columnType = 'factwise';
          factwiseColumns++;
        }

        const isFormulaColumn = h.startsWith('Tag_') || 
                              h.startsWith('Specification_') || 
                              h.startsWith('Customer_Identification_') || 
                              h === 'Tag' || 
                              h.includes('Specification') || 
                              h.includes('Customer identification') || 
                              h === 'Factwise ID';

        // Create column with enhanced debugging
        const colDef = {
          headerName: displayName,
          field: h,
          width: Math.max(180, Math.min(400, displayName.length * 10 + 40)),
          minWidth: 120,
          resizable: true,
          cellStyle: isFormulaColumn ? {
            backgroundColor: '#e8f5e8',
            borderLeft: '4px solid #4caf50',
            fontWeight: '500'
          } : {},
          headerClass: isFormulaColumn ? 'ag-header-formula' : 'ag-header-cell-excel',
          isFormulaColumn,
          // Add metadata for debugging
          __debug: {
            originalField: h,
            columnType: columnType,
            index: index
          }
        };
        
        cols.push(colDef);
        
        // Log important columns for debugging
        if (columnType === 'tag' || columnType === 'factwise') {
          console.log(`🔧 SNAPSHOT: Created ${columnType} column: "${displayName}" (field: ${h})`);
        }
      });
      
      // Log column type summary
      console.log(`🔧 SNAPSHOT: Column summary - Tags: ${tagColumns}, Specs: ${specColumns}, Customers: ${customerColumns}, FactWise: ${factwiseColumns}, Total: ${cols.length - 1}`);
      
      // Verify all headers have corresponding columns
      const expectedFields = new Set(headers);
      const actualFields = new Set(cols.slice(1).map(col => col.field));
      const missingFields = [...expectedFields].filter(field => !actualFields.has(field));
      const extraFields = [...actualFields].filter(field => !expectedFields.has(field));
      
      if (missingFields.length > 0 || extraFields.length > 0) {
        console.error(`🔧 SNAPSHOT: FIELD MISMATCH!`);
        console.error(`🔧 SNAPSHOT: Missing fields:`, missingFields);
        console.error(`🔧 SNAPSHOT: Extra fields:`, extraFields);
      } else {
        console.log(`🔧 SNAPSHOT: Perfect field alignment - all ${headers.length} headers have columns`);
      }
      
      setColumnDefs(cols);
      console.log(`✅ Updated column definitions: ${cols.length - 1} columns`);
    }

    // Update formula-related state
    const formulaRules = snapshot.formula_rules || [];
    if (setHasFormulas) {
      setHasFormulas(formulaRules.length > 0);
    }
    
    if (setAppliedFormulas) {
      setAppliedFormulas(formulaRules);
    }

    // Update formula columns list
    if (setFormulaColumns && headers.length > 0) {
      const detectedFormulaColumns = headers.filter(h => 
        h.startsWith('Tag_') || 
        h.startsWith('Specification_Name_') || 
        h.startsWith('Specification_Value_') || 
        h.startsWith('Customer_Identification_') ||
        h === 'Tag' || 
        h === 'Factwise ID' ||
        h.includes('Specification') ||
        h.includes('Customer identification')
      );
      setFormulaColumns(detectedFormulaColumns);
      console.log(`✅ Updated formula columns: ${detectedFormulaColumns.length} columns`);
    }

    // Update factwise ID rule if present
    const factwiseRules = snapshot.factwise_rules || [];
    if (setFactwiseIdRule && factwiseRules.length > 0) {
      const factwiseRule = factwiseRules.find(rule => rule.type === "factwise_id");
      if (factwiseRule) {
        setFactwiseIdRule({
          firstColumn: factwiseRule.first_column,
          secondColumn: factwiseRule.second_column,
          operator: factwiseRule.operator || '_',
          strategy: factwiseRule.strategy || 'fill_only_null'
        });
        console.log('✅ Updated factwise ID rule:', factwiseRule);
      }
    }

    console.log('🎉 Snapshot applied successfully to editor');

  } catch (error) {
    console.error('❌ Error applying snapshot to editor:', error);
  }
}

/**
 * Enhanced snapshot application with data fetching
 * @param {Object} snapshot - Snapshot from backend
 * @param {Object} stateFunctions - State setter functions
 * @param {function} fetchDataCallback - Function to fetch fresh data
 */
async function applySnapshotAndFetchData(snapshot, stateFunctions, fetchDataCallback) {
  try {
    // Apply snapshot immediately for UI consistency
    applySnapshotToEditor(snapshot, stateFunctions);
    
    // Fetch fresh data if callback provided
    if (fetchDataCallback && typeof fetchDataCallback === 'function') {
      console.log('🔄 Fetching fresh data after snapshot application...');
      await fetchDataCallback();
      console.log('✅ Fresh data fetched successfully');
    }
  } catch (error) {
    console.error('❌ Error in applySnapshotAndFetchData:', error);
  }
}

/**
 * Create column definitions from headers with proper styling
 * @param {Array} headers - Header array from snapshot
 * @returns {Array} Column definitions for AG Grid
 */
function createColumnDefsFromHeaders(headers) {
  const cols = [
    {
      headerName: '#',
      field: '__row_number__',
      valueGetter: 'node.rowIndex + 1',
      cellStyle: { 
        backgroundColor: '#f8f9fa', 
        fontWeight: 'bold',
        textAlign: 'center',
        borderRight: '2px solid #dee2e6',
        color: '#6c757d'
      },
      width: 80,
      pinned: 'left',
      editable: false,
      filter: false,
      sortable: false,
      resizable: false
    }
  ];
  
  headers.forEach(header => {
    let displayName = header;
    let isFormulaColumn = false;
    let isSpecificationColumn = false;
    
    // Determine display name and column type
    if (header.startsWith('Tag_') || header === 'Tag') {
      displayName = 'Tag';
      isFormulaColumn = true;
    } else if (header.startsWith('Specification_Name_') || header === 'Specification name') {
      displayName = 'Specification name';
      isFormulaColumn = true;
      isSpecificationColumn = true;
    } else if (header.startsWith('Specification_Value_') || header === 'Specification value') {
      displayName = 'Specification value';
      isFormulaColumn = true;
      isSpecificationColumn = true;
    } else if (header.startsWith('Customer_Identification_Name_') || header.includes('Customer identification name')) {
      displayName = 'Customer identification name';
      isFormulaColumn = true;
    } else if (header.startsWith('Customer_Identification_Value_') || header.includes('Customer identification value')) {
      displayName = 'Customer identification value';
      isFormulaColumn = true;
    } else if (header === 'Factwise ID' || header === 'Item code') {
      isFormulaColumn = true;
    }
    
    cols.push({
      headerName: displayName,
      field: header,
      width: Math.max(180, Math.min(400, displayName.length * 10 + 40)),
      minWidth: 120,
      maxWidth: 600,
      resizable: true,
      cellEditor: 'agTextCellEditor',
      cellStyle: {
        borderRight: '1px solid #e9ecef',
        borderBottom: '1px solid #e9ecef',
        fontSize: '14px',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        padding: '12px 16px',
        ...(isFormulaColumn ? {
          backgroundColor: '#e8f5e8',
          borderLeft: '4px solid #4caf50',
          fontWeight: '500'
        } : {}),
        ...(isSpecificationColumn ? {
          backgroundColor: '#f0f8ff',
          borderLeft: '4px solid #2196f3'
        } : {})
      },
      headerClass: isFormulaColumn ? 'ag-header-formula' : 
                   isSpecificationColumn ? 'ag-header-specification' : 
                   'ag-header-cell-excel',
      headerTooltip: isFormulaColumn ? `${header} - Formula-generated column` : header,
      isFormulaColumn,
      isSpecificationColumn
    });
  });
  
  return cols;
}

export { 
  applySnapshotToEditor, 
  applySnapshotAndFetchData,
  createColumnDefsFromHeaders 
};