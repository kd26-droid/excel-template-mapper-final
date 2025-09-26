# Mapping Persistence Fixes - Review Navigation Issues

## 🚨 Issues Fixed

### 1. **Mapping Deletion When Returning from Review**
**Problem**: When users map a client field to 2 template fields (e.g., tags + specs), after going to review and coming back, the mappings get deleted.

**Root Cause**: The app saves mappings to sessionStorage when going to review but **never restores them** when returning to the column mapping page.

**Fix Applied**: Added sessionStorage restoration logic in `loadData()` function.

### 2. **No Loader During Review Preparation**
**Problem**: Users can navigate too fast during review preparation, causing mapping loss.

**Root Cause**: No visual feedback during the review saving process.

**Fix Applied**: Added global loader and processing state management.

### 3. **Fast Navigation Causing Mapping Loss**
**Problem**: Users clicking "Review" too quickly can cause incomplete saves.

**Root Cause**: Insufficient debouncing and no navigation blocking during processing.

**Fix Applied**: Increased autosave delay and added navigation blocking.

## 🔧 Technical Fixes Applied

### **Fix 1: SessionStorage Restoration Logic**

**Location**: `ColumnMapping.js` - `loadData()` function (around line 1490)

```javascript
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
```

**Location**: `ColumnMapping.js` - Backend mapping fetch logic (around line 1618)

```javascript
// 🔥 CRITICAL FIX: Use saved mappings from review session if available
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
} else {
  // Fallback to backend mappings if no saved session data
  const result = await checkExistingMappings(client_headers, template_headers, setIsInitializingMappings);
  normalizedMappings = result.mappings;
}
```

### **Fix 2: Global Loader During Review**

**Location**: `ColumnMapping.js` - `handleReview()` function (around line 3002)

```javascript
const handleReview = async () => {
  // ... validation code ...
  
  setIsReviewing(true);
  setIsProcessingMappings(true); // 🔥 FAST NAVIGATION FIX: Block navigation during processing
  setGlobalLoading(true); // 🔥 LOADER FIX: Show global loader during review preparation
  setError(null);
  
  try {
    // ... review logic ...
  } finally {
    setIsReviewing(false);
    setIsProcessingMappings(false); // 🔥 FAST NAVIGATION FIX: Re-enable navigation
    setGlobalLoading(false); // 🔥 LOADER FIX: Clear global loader when done
  }
};
```

**Location**: `ColumnMapping.js` - Review button (around line 3256)

```javascript
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
```

### **Fix 3: Fast Navigation Protection**

**Location**: `ColumnMapping.js` - State declarations (around line 335)

```javascript
// Review state
const [isReviewing, setIsReviewing] = useState(false);
const [isProcessingMappings, setIsProcessingMappings] = useState(false); // 🔥 FAST NAVIGATION FIX
```

**Location**: `ColumnMapping.js` - Autosave debounce (around line 2996)

```javascript
}, 1500); // 🔥 FAST NAVIGATION FIX: Increased delay to prevent too-fast navigation
```

## 🧪 How the Fixes Work

### **Flow Before Fixes**:
1. User creates mappings (1→2 mappings like client → tags + specs) ✅
2. User clicks "Review" - mappings saved to sessionStorage ✅
3. User returns from review - **sessionStorage never checked** ❌
4. App loads mappings from backend only ❌
5. **Complex 1→2 mappings lost** ❌

### **Flow After Fixes**:
1. User creates mappings (1→2 mappings like client → tags + specs) ✅
2. User clicks "Review" - global loader shows, navigation blocked ✅
3. Mappings saved to sessionStorage with `reviewCompleted: true` flag ✅
4. User returns from review - **sessionStorage checked first** ✅
5. **Exact mappings restored from sessionStorage** ✅
6. Backend used as fallback only ✅

## 🎯 Benefits

1. **Preserves Complex Mappings**: 1→2 mappings (client field → tags + specs) are now preserved
2. **Visual Feedback**: Users see loading states and can't navigate too fast
3. **Reliable Restoration**: SessionStorage data is prioritized over backend data
4. **Backward Compatible**: Existing functionality still works if no sessionStorage data exists
5. **Fast Navigation Prevention**: Debounced autosave and navigation blocking prevent data loss

## 🚀 Testing

### **Test Scenario 1: 1→2 Mapping Preservation**
1. Map a client field to both a Tag field and a Specification field
2. Click "Review" (should show loader)
3. Return to column mapping page
4. **Expected**: Both mappings should still exist ✅

### **Test Scenario 2: Fast Navigation Protection**  
1. Create some mappings
2. Click "Review" multiple times quickly
3. **Expected**: Button should be disabled after first click, loader should show ✅

### **Test Scenario 3: Fallback to Backend**
1. Clear sessionStorage manually
2. Create mappings and navigate to review  
3. Return to column mapping page
4. **Expected**: Should fall back to backend mappings ✅

## 📝 Files Modified

- `/frontend/src/pages/ColumnMapping.js` - Main mapping component with all fixes
- `/MAPPING_PERSISTENCE_FIXES.md` - This documentation file

## ⚠️ Important Notes

- The `reviewCompleted` flag in sessionStorage is automatically cleared after restoration to prevent conflicts
- Global loader uses existing `useGlobalBlock` hook infrastructure  
- Autosave delay increased from 1000ms to 1500ms to prevent fast navigation issues
- Processing state prevents navigation during critical mapping operations
- All fixes are backward compatible with existing saved data