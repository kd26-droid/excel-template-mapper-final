# Tag Formula Assignment Issue - Complete Context

## Problem Statement

When applying a saved template that contains:
1. **Mappings**: UOM→Tag_1, MFR→Tag_2, MPN→Tag_3
2. **Formula rules**: e.g., "if UOM contains 'pcs' then output 'AAAA'"

### Expected Behavior
The formula should create data in **Tag_4** (the next available unmapped Tag column):
- Tag_1 = UOM data (from mapping) ✓
- Tag_2 = MFR data (from mapping) ✓
- Tag_3 = MPN data (from mapping) ✓
- Tag_4 = "AAAA" (from formula) ✓

### Actual Behavior
The formula **overwrites Tag_1** instead of using Tag_4:
- Tag_1 = "AAAA" (formula overwrites UOM data) ✗
- Tag_2 = MFR data ✓
- Tag_3 = MPN data ✓
- Tag_4 = empty ✗

## Root Cause Analysis

### The Timing Issue

When a template is applied, the frontend calls APIs in this sequence:

```
1. Apply template → creates mappings (UOM→Tag_1, MFR→Tag_2, MPN→Tag_3)
2. Apply formulas → backend endpoint `/api/formulas/apply/`
3. Autosave mappings → saves mappings to session
```

**The problem**: The backend's `apply_formulas` endpoint is called at step 2, but mappings aren't saved to the session until step 3. So when the backend checks which Tag columns are "used", it finds NONE, and assigns the formula to Tag_1 (the first available).

### Why This Happens

In `backend/excel_mapper/views.py`, the `apply_formulas` function:

```python
# Gets mappings from session
info = SESSION_STORE[session_id]
mappings = info.get("mappings")  # ← This is empty at step 2!

# Builds set of mapped Tag columns
mapped_tag_columns = set()
for m in mappings:
    if m['target'].startswith('Tag_'):
        mapped_tag_columns.add(m['target'])
# Result: mapped_tag_columns = set() (empty!)

# Assigns formula to first available Tag
# Since mapped_tag_columns is empty, Tag_1 is considered "available"
next_tag = "Tag_1"  # ← WRONG! Should be Tag_4
```

## Solution Implemented

### Part 1: Backend Changes

Modified `apply_formulas` endpoint to accept mappings directly from the request:

**File**: `/Users/kartikd/Downloads/final 2000/excel-template-mapper-final/backend/excel_mapper/views.py`
**Lines**: 6399-6414

```python
# CRITICAL: Get mappings from request first (frontend might not have saved yet)
mappings_from_request = request.data.get('mappings')

logger.info(f"🎯 TRACE-BE-1: apply_formulas called for session {session_id}")
logger.info(f"🎯 TRACE-BE-2: mappings_from_request = {mappings_from_request}")

if mappings_from_request:
    logger.info(f"🎯 TRACE-BE-3: Using mappings from request (SUCCESS!)")
    mappings = mappings_from_request
else:
    # Get fresh session data to ensure we have the latest mappings
    info = SESSION_STORE[session_id]
    mappings = info.get("mappings")
    logger.info(f"🎯 TRACE-BE-4: No mappings in request, using session mappings: {mappings}")
```

**Trace logs added**: `🎯 TRACE-BE-1` through `🎯 TRACE-BE-7`

### Part 2: Frontend Changes

Modified `FormulaBuilder.js` to fetch and send current mappings when applying formulas:

**File**: `/Users/kartikd/Downloads/final 2000/excel-template-mapper-final/frontend/src/components/FormulaBuilder.js`
**Lines**: 359-375

```javascript
// CRITICAL FIX: Get current mappings BEFORE applying formulas
let currentMappings = null;
try {
    console.log('🎯 TRACE-FB-1: FormulaBuilder fetching current mappings for session:', sessionId);
    const mappingsResponse = await api.getExistingMappings(sessionId);
    console.log('🎯 TRACE-FB-2: Mappings response received:', mappingsResponse.data);
    if (mappingsResponse.data && mappingsResponse.data.mappings) {
        currentMappings = mappingsResponse.data.mappings;
        console.log('🎯 TRACE-FB-3: Will send mappings with formula apply:', JSON.stringify(currentMappings));
    } else {
        console.log('🎯 TRACE-FB-4: No mappings found in response');
    }
} catch (error) {
    console.warn('🎯 TRACE-FB-ERROR: Could not retrieve current mappings:', error);
}
```

**Lines**: 416-418

```javascript
// Apply formulas with current mappings
console.log('🎯 TRACE-FB-5: Calling applyFormulas with mappings:', currentMappings ? 'YES' : 'NO', currentMappings);
const { data: res } = await api.applyFormulas(sessionId, formulaRules, currentMappings);
console.log('🎯 TRACE-FB-6: Formula apply response received:', res);
```

**Trace logs added**: `🎯 TRACE-FB-1` through `🎯 TRACE-FB-6`

### Part 3: API Changes

Modified `api.js` to accept optional mappings parameter:

**File**: `/Users/kartikd/Downloads/final 2000/excel-template-mapper-final/frontend/src/services/api.js`
**Lines**: 1413-1432

```javascript
applyFormulas: async (sessionId, formulaRules, mappings = null) => {
    const effectiveSessionId = sessionId || await ensureSession();

    const payload = {
        session_id: effectiveSessionId,
        formula_rules: formulaRules
    };

    // Include mappings if provided - helps backend assign Tag columns correctly
    if (mappings !== null) {
        payload.mappings = mappings;
        console.log('🔧 DEBUG: Sending mappings with formula apply request:', mappings);
    }

    const response = await axios.post(`${API_URL}/formulas/apply/`, payload);
    console.log('✅ Formula rules applied successfully');
    return response;
},
```

## Current Status

### ✅ Completed
1. Backend modified to accept mappings from request
2. Frontend modified to fetch and send mappings
3. API modified to include mappings in payload
4. Trace logs added to both frontend and backend
5. Code changes saved to disk

### ⏳ Pending
1. **Rebuild containers** with new code
2. **Hard refresh browser** to load new frontend code
3. **Test the fix** and collect trace logs

## Testing Instructions

### Prerequisites
1. Rebuild Docker containers:
   ```bash
   cd "/Users/kartikd/Downloads/final 2000/excel-template-mapper-final"
   docker-compose restart backend frontend
   ```

2. Hard refresh browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### Test Steps
1. **Upload a new file** to create a fresh session
2. **Apply template "ASD"** (or any template with mappings + formula rules)
3. **Check browser console** (F12 → Console tab)
4. **Look for these trace logs**:
   ```
   🎯 TRACE-FB-1: FormulaBuilder fetching current mappings for session: ...
   🎯 TRACE-FB-2: Mappings response received: ...
   🎯 TRACE-FB-3: Will send mappings with formula apply: [{"source":"UOM","target":"Tag_1"}...]
   🎯 TRACE-FB-5: Calling applyFormulas with mappings: YES ...
   🎯 TRACE-FB-6: Formula apply response received: ...
   ```

5. **Check backend logs**:
   ```bash
   docker logs excel-template-mapper-final-backend-1 --tail 200 | grep "🎯 TRACE-BE"
   ```

   Should see:
   ```
   🎯 TRACE-BE-1: apply_formulas called for session ...
   🎯 TRACE-BE-2: mappings_from_request = [{'source': 'UOM', 'target': 'Tag_1'}, ...]
   🎯 TRACE-BE-3: Using mappings from request (SUCCESS!)
   🎯 TRACE-BE-5: Extracted 3 actual mappings
   🎯 TRACE-BE-6: Mapped Tag columns found: {'Tag_1', 'Tag_2', 'Tag_3'}
   🎯 TRACE-BE-7: Will assign formula to next available Tag after: ['Tag_1', 'Tag_2', 'Tag_3']
   ```

6. **Verify result**: In Data Editor, Tag_4 should have formula data (not Tag_1)

### What to Collect

If the issue persists, collect:

**From Browser Console** (search for `🎯 TRACE-FB`):
- All 6 trace logs (TRACE-FB-1 through TRACE-FB-6)
- Copy entire console output to a file

**From Backend Logs**:
```bash
docker logs excel-template-mapper-final-backend-1 --tail 300 | grep -E "🎯 TRACE-BE|<session-id>"
```

Replace `<session-id>` with your actual session ID (from URL).

## Key Files Modified

1. **Backend**: `/backend/excel_mapper/views.py`
   - Function: `apply_formulas` (around line 6380)
   - Changes: Accept mappings from request, added trace logs

2. **Frontend**: `/frontend/src/components/FormulaBuilder.js`
   - Function: `handleApplyFormulas` (around line 350)
   - Changes: Fetch and send mappings, added trace logs

3. **API**: `/frontend/src/services/api.js`
   - Function: `applyFormulas` (around line 1413)
   - Changes: Accept optional mappings parameter

## Success Criteria

The fix is working when:

1. **Browser console** shows: `🎯 TRACE-FB-3: Will send mappings with formula apply: [...]`
   - This proves frontend is fetching mappings

2. **Backend logs** show: `🎯 TRACE-BE-3: Using mappings from request (SUCCESS!)`
   - This proves backend received mappings from request

3. **Backend logs** show: `🎯 TRACE-BE-6: Mapped Tag columns found: {'Tag_1', 'Tag_2', 'Tag_3'}`
   - This proves backend knows which Tags are mapped

4. **Formula response** shows: `"target_column": "Tag_4"` (not "Tag_1")
   - This proves formula was assigned to correct column

5. **Data Editor** shows Tag_4 with formula data, Tag_1 with UOM data
   - This proves the end-to-end flow works

## Troubleshooting

### If browser console shows NO trace logs:
- Frontend code didn't reload
- Solution: Hard refresh (Cmd+Shift+R or clear cache)

### If browser shows TRACE-FB-4 (No mappings found):
- Mappings API returned empty
- Check template was applied correctly
- Check session has mappings saved

### If backend shows TRACE-BE-4 (No mappings in request):
- Frontend didn't send mappings
- Check browser console for TRACE-FB-5
- Verify frontend container restarted

### If backend shows empty set in TRACE-BE-6:
- Mappings were sent but format is wrong
- Check TRACE-BE-2 to see actual format
- Verify dict/list format handling

## Additional Context

### Template Structure
Template "ASD" (ID: 2) contains:
```json
{
  "mappings": [
    {"source": "UOM", "target": "Tag_1"},
    {"source": "MFR", "target": "Tag_2"},
    {"source": "MPN", "target": "Tag_3"}
  ],
  "formula_rules": [
    {
      "source_column": "Tag",
      "column_type": "Tag",
      "sub_rules": [
        {
          "search_text": "pcs",
          "output_value": "AAAA",
          "case_sensitive": false
        }
      ],
      "target_column": "Tag"  // Generic, should become Tag_4
    }
  ]
}
```

### Session Flow
```
1. User uploads file
2. User applies template "ASD"
3. Frontend: POST /api/templates/apply/ → creates mappings
4. Frontend: Rebuilds nodes with 3 mappings (UOM→Tag_1, MFR→Tag_2, MPN→Tag_3)
5. Frontend: POST /api/formulas/apply/ → should send mappings + formula rules
6. Backend: Receives mappings, finds Tag_1/2/3 are used, assigns formula to Tag_4
7. Backend: Returns updated headers with Tag_4
8. Frontend: Shows Tag_4 in Data Editor with formula data
```

### Previous Attempts

Multiple fixes were tried before this solution:
1. ❌ Update rule target_column in session after assignment → didn't persist
2. ❌ Preserve target_column in template loading → template still had "Tag" (generic)
3. ❌ Fix dict/list format handling in session → timing issue remained
4. ✅ Send mappings from frontend WITH formula request → CURRENT FIX

## Notes for Fresh Chat

When starting a new chat, provide:
1. This markdown file
2. Browser console output with `🎯 TRACE-FB` logs
3. Backend logs with `🎯 TRACE-BE` logs
4. Session ID being tested
5. Template name being used

The trace logs will immediately show which part of the flow is failing.
