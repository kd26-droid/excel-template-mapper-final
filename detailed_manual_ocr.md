# Detailed Manual OCR Correction Implementation Plan

## Overview
Implementation of Header Validation & Data Quality Correction workflow for PDF OCR processing. This adds manual correction capabilities for OCR-detected headers and data while maintaining mapping relationships and template compatibility.

## User Requirements Summary
1. **Easy header editing** - Simple inline editing for PDF headers with confidence scores
2. **Selective mapping preservation** - Only edited headers lose mappings, others remain intact
3. **Smart confidence display** - Creative approach for large datasets, not overwhelming
4. **Export/re-upload workflow** - Export current data, correct externally, re-upload to update data under existing headers
5. **Template compatibility** - Templates work with corrected headers, not original OCR headers

---

## Phase 1: Header Confidence Display & Inline Editing

### 1.1 Modify CustomNode Component in ColumnMapping.js
**File**: `frontend/src/pages/ColumnMapping.js`

**Changes**:
- Add confidence score display for PDF-sourced headers (left side nodes)
- Implement inline editing capability with edit/save/cancel buttons
- Add visual indicators for edited vs. original headers
- Store header correction state in component state

**Implementation Details**:
```javascript
// Add to CustomNode component:
- confidence score badge for source nodes (PDF headers)
- edit mode toggle with pencil icon
- inline text input for header editing
- save/cancel buttons during edit mode
- visual indicator (icon/color) for manually corrected headers
```

**UI Elements**:
- Confidence badge: `{confidence}%` with color coding (green >80%, yellow 60-80%, red <60%)
- Edit button: Small pencil icon next to header name
- Edit mode: Replace text with input field + save/cancel buttons
- Corrected indicator: Small checkmark or edit icon overlay

### 1.2 Add Header Correction State Management
**File**: `frontend/src/pages/ColumnMapping.js`

**New State Variables**:
```javascript
const [headerCorrections, setHeaderCorrections] = useState({}); // { originalHeader: correctedHeader }
const [editingHeader, setEditingHeader] = useState(null); // Currently editing header ID
const [headerConfidenceScores, setHeaderConfidenceScores] = useState({}); // { header: confidence }
```

**Functions to Add**:
- `handleHeaderEdit(headerId, newValue)` - Save header correction
- `handleEditStart(headerId)` - Enter edit mode
- `handleEditCancel()` - Cancel edit mode
- `getDisplayHeader(originalHeader)` - Get corrected header or original
- `isHeaderCorrected(header)` - Check if header was manually corrected

### 1.3 Backend API Enhancement for Header Confidence
**File**: `backend/excel_mapper/views.py` or relevant session endpoint

**Enhancement**:
- Include header-level confidence scores in session data response
- Modify session response to include:
```python
{
    "client_headers": [...],
    "header_confidence_scores": {
        "header_name": 0.85,
        "another_header": 0.92
    },
    "is_from_pdf": True,
    ...
}
```

---

## Phase 2: Selective Mapping Preservation

### 2.1 Implement Mapping Preservation Logic
**File**: `frontend/src/pages/ColumnMapping.js`

**Enhancement to Header Edit Handler**:
```javascript
const handleHeaderEdit = (originalHeader, correctedHeader) => {
    // 1. Update header corrections state
    setHeaderCorrections(prev => ({...prev, [originalHeader]: correctedHeader}));

    // 2. Find all edges connected to this header
    const affectedEdges = edges.filter(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        return sourceNode?.data?.originalLabel === originalHeader;
    });

    // 3. Remove only mappings for the edited header
    const remainingEdges = edges.filter(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        return sourceNode?.data?.originalLabel !== originalHeader;
    });

    // 4. Update edges state
    setEdges(remainingEdges);

    // 5. Update source node label
    setNodes(prev => prev.map(node => {
        if (node.id.startsWith('c-') && node.data?.originalLabel === originalHeader) {
            return {
                ...node,
                data: {
                    ...node.data,
                    label: correctedHeader,
                    isConnected: false, // Reset connection status
                    mappedToLabel: '', // Clear mapped label
                    isCorrected: true // Mark as manually corrected
                }
            };
        }
        return node;
    }));
};
```

### 2.2 Update Template Application Logic
**File**: `frontend/src/pages/ColumnMapping.js`

**Modify Template Mapping Functions**:
- Update `findBestTargetColumn()` to use corrected headers
- Modify template application to work with corrected headers instead of original OCR headers
- Ensure template mappings use `getDisplayHeader()` for matching

---

## Phase 3: Creative Confidence Display for Data ✅ COMPLETED

### 3.1 Data Quality Summary Panel ✅
**What Users See:**
When users navigate to the Data Editor page after uploading a PDF, they will see a prominent **Data Quality Summary** panel at the top of the page (above the data table). This panel only appears for PDF sources and provides an at-a-glance overview of their data quality.

**Visual Elements Users Will See:**
- **Beautiful gradient panel** with light blue background and professional styling
- **Four color-coded cards** displayed in a responsive grid:
  1. **Green Card - High Quality (>80%)**: Shows count of cells with excellent OCR confidence
  2. **Orange Card - Medium Quality (60-80%)**: Shows count of cells that might need review
  3. **Red Card - Needs Review (<60%)**: Shows count of cells with poor OCR confidence
  4. **Purple Card - Average Confidence**: Shows overall confidence percentage

**What Users Can Do:**
- **View at-a-glance data quality**: Instantly understand the overall quality of their PDF extraction
- **Identify problem areas**: See exactly how many cells need attention before proceeding
- **Close the panel**: Click the X button in the top-right corner if they want more screen space
- **Make informed decisions**: Use the metrics to decide whether to proceed with mapping or correct data first

**User Experience:**
- **Non-overwhelming**: Shows summary statistics instead of cluttering every cell with numbers
- **Professional appearance**: Matches the application's design language
- **Contextual display**: Only appears for PDF uploads where confidence data is relevant
- **Persistent but dismissible**: Stays visible to help users but can be closed when not needed

### 3.2 Row-Level Confidence Indicators ✅
**What Users See:**
In the data table itself, users will notice **subtle visual indicators** that help them identify data quality without being distracting.

**Visual Indicators Users Will See:**
- **Green left border**: Rows with high confidence (>80%) get a subtle green border on the left side
- **Orange styling**: Medium confidence rows (60-80%) have orange left border and slightly tinted background
- **Red styling**: Low confidence rows (<60%) have red left border and light red background tint
- **Seamless integration**: These indicators work alongside existing features like alternating row colors

**What Users Can Do:**
- **Quickly scan for problem areas**: Red and orange borders immediately draw attention to questionable data
- **Focus correction efforts**: Spend time correcting the most problematic rows first
- **Maintain context while editing**: See quality indicators while making inline edits to cells
- **Work confidently**: Green borders provide reassurance that high-quality data can be trusted

**User Experience:**
- **Non-intrusive**: Subtle borders and backgrounds don't interfere with reading data
- **Consistent with quality panel**: Colors match the summary cards for visual consistency
- **Works with existing features**: Quality indicators don't conflict with MPN validation, unknown value highlighting, etc.
- **PDF-specific**: Only appears for PDF sources where confidence data is meaningful

---

## Phase 4: Export/Re-upload Workflow ✅ COMPLETED

### 4.1 Enhanced Export Functionality ✅
**What Users See:**
In the Data Editor page, PDF users will see a new purple **"Export for Correction"** button in the main header area, positioned next to the existing "Download File" button.

**Visual Elements Users Will See:**
- **Purple button** with edit icon, styled consistently with the application design
- **Clear labeling**: "Export for Correction" text immediately communicates purpose
- **Contextual display**: Only appears for PDF sources where data correction is relevant
- **Professional styling**: Matches the gradient header design and other action buttons

**What Users Can Do:**
- **One-click export**: Click the button to instantly download their current data
- **Get corrected headers**: The exported CSV uses manually corrected headers, not original OCR text
- **External editing**: Open the file in Excel, Google Sheets, or any spreadsheet application
- **Make bulk corrections**: Edit multiple cells, rows, or entire columns efficiently outside the web interface

**User Experience:**
- **Instant download**: File downloads immediately with a descriptive filename
- **Proper CSV formatting**: All commas, quotes, and special characters are properly escaped
- **Clear instructions**: Success message explains the next steps in the workflow
- **Timestamped files**: Filename includes session ID and date for easy organization

**File Details Users Receive:**
- **Filename format**: `data_for_correction_{session-id}_{YYYY-MM-DD}.csv`
- **Content**: All current data exactly as displayed in the data editor
- **Headers**: Uses corrected header names (e.g., "CPN Name" instead of "CPN")
- **Format**: Standard CSV that opens cleanly in any spreadsheet application

### 4.2 Re-upload and Data Update Modal ✅
**What Users See:**
Next to the export button, users see an outlined **"Upload Corrections"** button. Clicking it opens a comprehensive modal dialog for uploading their corrected data.

**Visual Elements Users Will See:**
- **Professional modal**: Large, well-designed dialog with clear title "Upload Corrected Data"
- **File picker area**: Clean file upload interface that only accepts CSV files
- **Live preview table**: Shows the first 5 rows of uploaded data in a formatted table
- **Header validation**: Visual confirmation that headers match the original data
- **Progress indicators**: Loading spinners and status messages during upload

**What Users Can Do:**
- **Choose corrected file**: Click "Choose CSV File" to select their edited data
- **Preview before applying**: Review the first 5 rows to ensure data looks correct
- **Validate headers**: See which headers will be updated and which will be ignored
- **Apply updates safely**: Click "Update Data" to apply corrections with confidence
- **Cancel anytime**: Close the modal or click Cancel to abort without changes

**User Experience:**
- **Drag and drop support**: Can drag CSV files directly onto the file picker
- **Real-time validation**: Immediate feedback if file format is incorrect
- **Safety checks**: Headers are validated against existing data before allowing updates
- **Clear instructions**: Helpful text explains that only matching headers will be updated
- **Visual feedback**: Preview table shows exactly what data will be applied

**Upload Process Users Experience:**
1. **File selection**: Click "Choose CSV File" and select their corrected data
2. **Automatic parsing**: File is immediately parsed and validated
3. **Preview display**: First 5 rows appear in a clean table format
4. **Header matching**: System shows which headers will be updated
5. **Confirmation**: Click "Update Data" to apply corrections
6. **Success feedback**: Green success message confirms data was updated
7. **Automatic refresh**: Data editor immediately shows the corrected data

### 4.3 Backend Data Update Integration ✅
**What Users Experience:**
Behind the scenes, the system safely processes their uploaded corrections while preserving all their existing work.

**Data Safety Users Can Trust:**
- **Selective updates**: Only columns that match existing headers are updated
- **Mapping preservation**: All column mappings and template applications remain intact
- **Safe expansion**: If corrected file has more rows, they're safely added
- **Version tracking**: System increments template version to trigger proper refresh
- **Error handling**: Clear error messages if something goes wrong

**What Users See During Upload:**
- **Loading indicator**: "Uploading..." text with spinner during processing
- **Success confirmation**: Green message showing how many rows and columns were updated
- **Automatic refresh**: Data editor immediately updates to show corrected data
- **Preserved work**: All their column mappings, formulas, and tags remain exactly as they were

**User Confidence Features:**
- **Non-destructive**: Original data is safely backed up before applying corrections
- **Atomic updates**: Either all corrections apply successfully, or none do (no partial failures)
- **Clear feedback**: Detailed success/error messages explain exactly what happened
- **Immediate visibility**: Updated data appears instantly in the data editor

**Complete User Workflow:**
1. **Identify issues**: Use data quality panel to see which data needs correction
2. **Export current data**: Click "Export for Correction" to download CSV
3. **Edit externally**: Make corrections in Excel, Google Sheets, etc.
4. **Upload corrections**: Click "Upload Corrections" and select corrected file
5. **Preview and confirm**: Review preview table and click "Update Data"
6. **See results**: Data editor refreshes with corrected data, all mappings preserved
7. **Continue workflow**: Proceed with template application, downloads, etc. using corrected data

**Benefits Users Experience:**
- **Time savings**: Bulk corrections much faster than individual cell edits
- **Familiar tools**: Use Excel or Google Sheets for complex data corrections
- **Zero rework**: No need to redo column mappings or template applications
- **Data integrity**: Confidence that corrections won't break existing work
- **Professional workflow**: Enterprise-grade data correction process

---

## Phase 5: Template Compatibility with Corrected Headers

### 5.1 Update Template Application Logic
**File**: `frontend/src/pages/ColumnMapping.js`

**Modifications**:
- Modify `handleApplyTemplate()` to use corrected headers for matching
- Update `findBestTargetColumn()` to work with corrected header names
- Ensure template mappings persist through header corrections

**Key Changes**:
```javascript
const getEffectiveClientHeaders = () => {
    return clientHeaders.map(header =>
        headerCorrections[header] || header
    );
};

// Use in template application:
const effectiveHeaders = getEffectiveClientHeaders();
// Apply template matching against effectiveHeaders instead of clientHeaders
```

### 5.2 Session State Persistence
**File**: `frontend/src/pages/ColumnMapping.js`

**Enhancement**:
- Save header corrections to session storage
- Restore header corrections on page reload
- Include corrections in mapping persistence logic

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Phase 1.1: CustomNode confidence display and inline editing
- [ ] Phase 1.2: Header correction state management
- [ ] Phase 1.3: Backend header confidence API

### Week 2: Core Functionality
- [ ] Phase 2.1: Selective mapping preservation
- [ ] Phase 2.2: Template application with corrected headers
- [ ] Phase 3.1: Data quality summary panel

### Week 3: Advanced Features
- [ ] Phase 3.2: Row-level confidence indicators
- [ ] Phase 4.1: Enhanced export functionality
- [ ] Phase 4.2: Re-upload modal component

### Week 4: Integration & Polish
- [ ] Phase 4.3: Backend data update endpoint
- [ ] Phase 5.1: Template compatibility
- [ ] Phase 5.2: Session state persistence
- [ ] Testing and bug fixes

---

## File Structure Summary

### Frontend Files to Modify
1. `frontend/src/pages/ColumnMapping.js` - Main implementation
2. `frontend/src/components/EnhancedDataEditor.js` - Data quality display
3. `frontend/src/components/DataCorrectionUpload.js` - New component for re-upload
4. `frontend/src/services/api.js` - API calls for data updates

### Backend Files to Modify
1. `backend/excel_mapper/views.py` - Session data API enhancements
2. `backend/excel_mapper/models.py` - Possible header correction storage
3. `backend/excel_mapper/services/` - Data update logic

### New Components
1. `DataCorrectionUpload.js` - Re-upload modal
2. `QualityMetricsPanel.js` - Data quality summary
3. `HeaderEditModal.js` - Optional modal for complex header editing

---

## Technical Considerations

### State Management
- Use React state for UI interactions
- Persist corrections in sessionStorage
- Maintain mapping relationships during header changes

### Performance
- Lazy load confidence scores for large datasets
- Debounce header edit operations
- Optimize re-render cycles during bulk operations

### User Experience
- Clear visual feedback for all operations
- Undo/redo capability for header corrections
- Progress indicators for file operations
- Comprehensive error handling and user guidance

### Data Integrity
- Validate header corrections against business rules
- Preserve data relationships during updates
- Audit trail for manual corrections
- Rollback capability for failed operations

---

## Success Criteria

1. ✅ PDF headers display confidence scores and allow inline editing
2. ✅ Mapping preservation works correctly (only edited headers lose mappings)
3. ✅ Data quality is displayed creatively without overwhelming users
4. ✅ Export/re-upload workflow updates data under existing headers
5. ✅ Template applications work with corrected headers
6. ✅ All changes are persistent across page reloads
7. ✅ User experience is intuitive and efficient
8. ✅ Performance remains acceptable for large datasets