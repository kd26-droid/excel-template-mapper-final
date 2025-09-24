# MPN Validation Columns Guide

When you perform MPN validation using the **Validate MPNs** button, the system adds 6 new columns to your data with valuable information about each manufacturer part number:

## Column Meanings

### 1. **MPN valid**
- **Values**: `Yes` / `No`
- **Meaning**: Whether the MPN exists in Digi-Key's database
- **Context**:
  - `Yes` = Valid, searchable part number
  - `No` = Invalid, typo, or not found in Digi-Key catalog

### 2. **MPN Status**
- **Values**: `Active`, `NRND`, `Obsolete`, `Unknown`, etc.
- **Meaning**: Current production/availability status from manufacturer
- **Context**:
  - `Active` = Currently manufactured and available
  - `NRND` = Not Recommended for New Designs (being phased out)
  - `Obsolete` = No longer manufactured
  - `Unknown` = Status information unavailable

### 3. **EOL Status** (End of Life)
- **Values**: `Yes` / `No`
- **Meaning**: Whether the part has been marked End-of-Life by manufacturer
- **Context**:
  - `Yes` = Part is officially discontinued/EOL
  - `No` = Part is not EOL (still in production lifecycle)

### 4. **Discontinued**
- **Values**: `Yes` / `No`
- **Meaning**: Whether Digi-Key has discontinued stocking this part
- **Context**:
  - `Yes` = Digi-Key no longer stocks this part
  - `No` = Digi-Key continues to stock this part

### 5. **DKPN** (Digi-Key Part Number)
- **Values**: Part numbers ending in `-ND` (e.g., `296-25260-1-ND`)
- **Meaning**: Digi-Key's internal catalog number for this component
- **Context**: Use this number to order directly from Digi-Key or check detailed specs

### 6. **Canonical MPN**
- **Values**: Normalized manufacturer part number (e.g., `PIC16F877A-I/P`)
- **Meaning**: The "official" manufacturer part number format
- **Context**: Standardized version removing inconsistent spacing/formatting

## How to Use This Information

### ✅ **Green Flags** (Good to use):
- MPN valid = `Yes`
- MPN Status = `Active`
- EOL Status = `No`
- Discontinued = `No`

### ⚠️ **Yellow Flags** (Use with caution):
- MPN Status = `NRND` (plan for replacement)
- Unknown statuses (verify with manufacturer)

### 🚫 **Red Flags** (Avoid/Replace):
- MPN valid = `No` (fix the part number)
- EOL Status = `Yes` (find replacement)
- MPN Status = `Obsolete` (find replacement)

## Example Interpretation

**PIC16F877A-I/P Results:**
- ✅ MPN valid: `Yes` (legitimate part)
- ❓ MPN Status: `Unknown` (check manufacturer directly)
- ✅ EOL Status: `No` (not end-of-life)
- ✅ Discontinued: `No` (still available)
- 🔍 DKPN: `PIC16F877A-I/P-ND` (order from Digi-Key)
- 📋 Canonical MPN: `PIC16F877A-I/P` (official format)

This part is **usable** but verify current availability since lifecycle status is unknown.