# Frontend Zone Drawing - Testing Guide

## 🎯 Test Objective
Verify that the frontend zone drawing interface works and only extracts the zones drawn by the user.

---

## 📋 Prerequisites

✅ Frontend rebuilt and running at: http://localhost:3000
✅ Backend running at: http://localhost:8000
✅ Test PDF available: `test_upload.pdf`

---

## 🧪 Manual Testing Steps

### **STEP 1: Upload PDF**

1. Open browser to: **http://localhost:3000**
2. Click **"Upload Files"** or navigate to `/upload`
3. Select or drag `test_upload.pdf` (3-page PDF with multiple tables)
4. Wait for upload to complete
5. **System should detect it needs zone selection** and redirect to zone selection page

**Expected Redirect:** `/pdf-zones/{session_id}`

---

### **STEP 2: Verify Zone Drawing Interface**

You should see:

**Left Sidebar:**
- ✅ Zone Type Selector (Header / Table Data buttons)
- ✅ Page Navigation (if multi-page PDF)
- ✅ Zone List (empty initially)
- ✅ "Process Zones" button

**Main Canvas:**
- ✅ PDF page rendered as image
- ✅ Gray background canvas
- ✅ Instructions at bottom

---

### **STEP 3: Draw Zones**

#### Test Case 1: Draw Zone Around First Table Only

**Action:**
1. Keep "Table Data" selected (or select "Header" first)
2. Click and drag on the canvas to draw a rectangle around **Table 1 only** (top section of page 1)
3. Release mouse

**Expected:**
- ✅ Green (header) or Blue (table) rectangle appears
- ✅ Rectangle has resize handles
- ✅ Label shows zone type
- ✅ Zone appears in "Zones" list in sidebar
- ✅ Zone count increases

**Verify:**
- Rectangle should only cover the area you drew
- Coordinates should be saved

---

#### Test Case 2: Draw Multiple Zones

**Action:**
1. Draw zone around **Table 1** on page 1
2. Click "Page 2" button
3. Draw zone around **Table 2** on page 2
4. Click "Page 3" button
5. Draw zone around **Table 3** on page 3

**Expected:**
- ✅ Each zone saved independently
- ✅ Zone list shows all 3 zones with page numbers
- ✅ Switching pages shows existing zones on that page
- ✅ Can delete individual zones

---

#### Test Case 3: Delete Zone

**Action:**
1. Click on a zone in the canvas
2. Click "Delete Zone" button

**Expected:**
- ✅ Zone removed from canvas
- ✅ Zone removed from list
- ✅ Zone count decreases

---

### **STEP 4: Process Zones**

**Action:**
1. Draw at least one zone
2. Click **"Process Zones"** button

**Expected:**
- ✅ Button shows "Processing..."
- ✅ Processing takes 5-30 seconds (depending on zones)
- ✅ **Automatically redirects to Column Mapping** (`/mapping/{session_id}`)
- ✅ No errors shown

**What's Happening Behind the Scenes:**
1. Zones sent to backend: `POST /api/pdf/zones/{session_id}/`
2. OCR processing triggered: `POST /api/pdf/zones/{session_id}/process/`
3. Each zone processed separately
4. Headers combined from all zones
5. Session created for mapping

---

### **STEP 5: Verify Column Mapping Page**

After processing, you should see:

**Headers (Left Side):**
- ✅ All headers from zones you drew
- ✅ If you drew 1 zone with 6 columns → 6 headers
- ✅ If you drew 3 zones (different tables) → Combined headers (e.g., 13 headers)

**Template Headers (Right Side):**
- ✅ Standard FACTWISE template headers

**Data Preview:**
- ✅ Rows from zones you drew
- ✅ Empty strings in columns not present in that zone
- ✅ Each row aligned to combined header structure

---

## 🔍 Detailed Test Scenarios

### **Scenario A: Single Zone (Simple Case)**

**Steps:**
1. Upload PDF
2. Draw ONE zone around first table on page 1
3. Process

**Expected Output:**
```
Headers: [from Table 1 only]
- Serial No.
- CPN
- Internal PN
- Description
- UOM
- Category

Rows: ~8 rows (from Table 1 only)
```

**Verification:** Only data from the zone you drew should be extracted!

---

### **Scenario B: Multiple Zones (Multi-Table)**

**Steps:**
1. Upload PDF
2. Draw zone around Table 1 (page 1)
3. Draw zone around Table 2 (page 2)
4. Draw zone around Table 3 (page 3)
5. Process

**Expected Output:**
```
Headers: [ALL headers combined from all 3 zones]
- Serial No. (from Table 1)
- CPN (from Table 1)
- Internal PN (from Table 1)
- Description (from Table 1)
- UOM (from Table 1)
- Category (from Table 1)
- MFR (from Table 2)
- MPN (from Table 2)
- Status (from Table 2)
- Sub- Category (from Table 2)
- Suggested/Corrected MFR (from Table 3)
- Suggested/Corrected MPN (from Table 3)
- Validation details (from Table 3)

Rows: ~24 rows total (from all 3 zones)
```

**Verification:** Data from ALL zones you drew should be extracted!

---

### **Scenario C: Partial Selection**

**Steps:**
1. Upload PDF
2. Draw zone around ONLY Table 2 (page 2) - skip Table 1 and 3
3. Process

**Expected Output:**
```
Headers: [from Table 2 only]
- MFR
- MPN
- Status
- Sub- Category

Rows: ~8 rows (from Table 2 only)
```

**Verification:** Only Table 2 data extracted - Tables 1 and 3 ignored!

---

## ✅ Success Criteria

### Frontend Zone Drawing:
- [ ] Canvas renders PDF page correctly
- [ ] Can draw rectangles on canvas
- [ ] Zones show with correct colors (green for header, blue for table)
- [ ] Can switch between pages
- [ ] Zones persist when switching pages
- [ ] Can delete zones
- [ ] Zone list updates correctly
- [ ] Process button works

### Backend Processing:
- [ ] Zones saved to database
- [ ] Only drawn zones processed by OCR
- [ ] Headers extracted from zones
- [ ] All zone headers combined correctly
- [ ] Data rows aligned to combined headers
- [ ] Empty strings fill missing columns
- [ ] Session created for mapping

### Column Mapping Integration:
- [ ] Redirects to mapping page after processing
- [ ] Headers from zones appear in mapping interface
- [ ] Data rows from zones visible
- [ ] Can proceed with normal mapping workflow
- [ ] Can export final result

---

## 🐛 Common Issues to Check

### Issue 1: Zone Not Drawing
**Symptoms:** Click and drag but no rectangle appears
**Check:**
- Fabric.js loaded correctly?
- Canvas dimensions set?
- Console errors?

### Issue 2: Process Button Does Nothing
**Symptoms:** Click process but nothing happens
**Check:**
- At least one zone drawn?
- Check browser console for errors
- Check network tab for API calls

### Issue 3: Wrong Data Extracted
**Symptoms:** Data doesn't match zones
**Check:**
- Zone coordinates correct?
- Image dimensions match PDF dimensions?
- Scale factor calculated correctly?

### Issue 4: Missing Headers
**Symptoms:** Some headers missing in mapping
**Check:**
- All zones processed successfully?
- Check zone processing status endpoint
- Review backend logs

---

## 📊 Quick Validation Commands

### Check Zone Data Saved:
```bash
curl http://localhost:8000/api/pdf/zones/{session_id}/
```

### Check Processing Status:
```bash
curl http://localhost:8000/api/pdf/zones/{session_id}/status/
```

### Check Extracted Data:
```bash
curl http://localhost:8000/api/pdf/status/{session_id}/
```

---

## 🎯 Key Test: Verify ONLY User Zones Extracted

**Critical Test:**
1. Upload 3-page PDF with 3 tables
2. Draw zone around **ONLY Table 2** (middle page)
3. Process
4. **Verify:** Only Table 2 headers and data extracted

**If this works, the zone selection is working correctly!**

---

## 📝 Test Report Template

After testing, note:

```
✅ Zone Drawing Interface:
- Canvas rendering: [PASS/FAIL]
- Zone creation: [PASS/FAIL]
- Zone deletion: [PASS/FAIL]
- Multi-page support: [PASS/FAIL]

✅ Zone Processing:
- Zones saved correctly: [PASS/FAIL]
- Only drawn zones processed: [PASS/FAIL]
- Headers combined correctly: [PASS/FAIL]
- Data aligned correctly: [PASS/FAIL]

✅ Integration:
- Redirects to mapping: [PASS/FAIL]
- Headers appear in mapping: [PASS/FAIL]
- Data visible in mapping: [PASS/FAIL]
- Can complete workflow: [PASS/FAIL]

Issues Found:
1. ...
2. ...
```

---

## 🚀 Ready to Test!

Open your browser to **http://localhost:3000** and start testing!

The key question to answer: **Does the system extract ONLY the zones I drew, not the entire PDF?**

If yes, then the zonal mapping is working perfectly! ✅