// This file contains the fixes for unique numbering of dynamic fields
// Key changes:
// 1. All dynamic fields now use consistent numbering: Tag_1, Tag_2, Specification_Name_1, Specification_Value_1, etc.
// 2. Added global field counter to ensure uniqueness
// 3. Updated pair detection logic to work with numbered fields
// 4. Enhanced data reflection to DataEditor.js

// UPDATED PAIR DETECTION LOGIC FOR NUMBERED FIELDS
const getFieldNumber = (fieldName) => {
  const match = fieldName.match(/_(\d+)$/);
  return match ? parseInt(match[1]) : 1;
};

const isPairStartUpdated = (fieldName, nextFieldName) => {
  if (!nextFieldName) return false;
  
  const fieldNum = getFieldNumber(fieldName);
  const nextFieldNum = getFieldNumber(nextFieldName);
  
  return (
    (fieldName.includes('Specification_Name_') && nextFieldName.includes('Specification_Value_') && fieldNum === nextFieldNum) ||
    (fieldName.includes('Customer_Identification_Name_') && nextFieldName.includes('Customer_Identification_Value_') && fieldNum === nextFieldNum)
  );
};

const isPairEndUpdated = (fieldName, prevFieldName) => {
  if (!prevFieldName) return false;
  
  const fieldNum = getFieldNumber(fieldName);
  const prevFieldNum = getFieldNumber(prevFieldName);
  
  return (
    (fieldName.includes('Specification_Value_') && prevFieldName.includes('Specification_Name_') && fieldNum === prevFieldNum) ||
    (fieldName.includes('Customer_Identification_Value_') && prevFieldName.includes('Customer_Identification_Name_') && fieldNum === prevFieldNum)
  );
};

// UPDATED PAIR TYPE DETECTION
const getPairTypeUpdated = (fieldName) => {
  if (fieldName.includes('Specification')) return 'specification';
  if (fieldName.includes('Customer_Identification') || fieldName.includes('Customer Identification')) return 'customer';
  if (fieldName.includes('Tag_')) return 'tag';
  return 'single';
};

// UPDATED PAIR INDEX DETECTION
const getPairIndexUpdated = (fieldName) => {
  return getFieldNumber(fieldName);
};

// UPDATED COLOR ASSIGNMENT
const getPairColorUpdated = (fieldName, pairColors) => {
  const fieldNum = getFieldNumber(fieldName);
  return pairColors[(fieldNum - 1) % pairColors.length];
};

// UPDATED OPTIONAL FIELD DETECTION
const isOptionalFieldUpdated = (fieldName, templateOptionals, headerIndex) => {
  if (templateOptionals && templateOptionals.length > headerIndex) {
    return !!templateOptionals[headerIndex];
  }
  
  // All dynamic fields are optional by default
  return fieldName.includes('Tag_') || 
         fieldName.includes('Specification') || 
         fieldName.includes('Customer_Identification') ||
         fieldName.includes('Customer Identification');
};

// UPDATED DELETE HANDLER FOR NUMBERED FIELDS
const handleDeleteOptionalFieldUpdated = (nodeId, nodes, edges, columnCounts, updateColumnCounts) => {
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
};

export {
  getFieldNumber,
  isPairStartUpdated,
  isPairEndUpdated,
  getPairTypeUpdated,
  getPairIndexUpdated,
  getPairColorUpdated,
  isOptionalFieldUpdated,
  handleDeleteOptionalFieldUpdated
};