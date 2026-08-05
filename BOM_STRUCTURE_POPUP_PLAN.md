# BOM Structure Popup — Implementation Plan (Step 1)

Scope: the gate popup only. No derivation, no generation, no validation, no backend.

Source: PM instruction —
> When the user uploads files, and doesn't mention levels in normalizer/mapping:
> 0. Ask the user which sheets have a BOM
> 1. Ask the user if the BOM has levels for each sheet
> 2. If the user says no, assume it's a single level and create the sheet
> 3. If the user says yes, confirm with the user if the BOMs can be created based on the tree hierarchy and show an example
> 4. If the BOM is not as per the tree structure, don't create

---

## 1. New component

`frontend/src/components/BomStructureDialog.js`

Follows the `CarryForwardDialog.js` pattern: MUI `Dialog`, props in, one answer object out.

### Props

| Prop | Type | Purpose |
|---|---|---|
| `open` | bool | visibility |
| `onClose` | fn | cancel — caller stays put |
| `sheetNames` | string[] | candidate sheets |
| `getSheetHeaders` | fn(sheetName) => string[] | for Level auto-detect |
| `onConfirm` | fn(answers) | proceed with answers |

### Answer shape

```js
{
  fallbackUom: 'EA',
  sheets: {
    'S116488': {                     // hierarchical
      hasBom: true,
      hasLevels: true,
      levelColumn: 'Level',
      treeConfirmed: true,
      bomHeader: null                // root comes from the data
    },
    '9926006_BOM_r1': {              // flat
      hasBom: true,
      hasLevels: false,
      levelColumn: null,
      treeConfirmed: null,
      bomHeader: {                   // authored by the user
        finishedGoodCode: 'FG-001',
        itemName:         'FG-001',
        bomName:          'FG-001',
        measurementUnit:  'EA',
        baseQuantity:     1
      }
    }
  }
}
```

---

## 2. Wizard steps

### Step 0 — Which sheets contain a BOM?
Checkbox list of `sheetNames`. Single-sheet workbooks default to checked.
Selecting none is allowed — proceed with no BOM at all.

### Step 1 — Does each sheet have levels?
Yes / No per selected sheet.

**Auto-detect:** scan headers for
```
/^\s*(level|lvl|niveau|indent(ure)?|depth|bom\s*level)\s*$/i
```
On a hit, prefill **Yes** and preselect that column. This is the PM's
"doesn't mention levels" condition — if a level column is visible we confirm
rather than ask blind.

- SAFRAN → `Level` matches → prefilled Yes
- GE → no match → prefilled No

### Step 2 — Flat sheet: author the finished good
Shown only for sheets answered **No**. A form, not a question, because a flat
sheet has no finished good in its data (GE = 213 components, no parent).

One input drives the rest:

```
Finished good code   FG-001   <- user enters (required)
  |- Item code       FG-001      same, locked
  |- Item name       FG-001      prefilled, editable
  |- BOM ID          FG-001      derived
  |- BOM name        FG-001      prefilled, editable
  '- Item type       Finished good   derived, locked

Measurement unit     EA       <- required, defaults to fallbackUom
Base quantity        1        <- default, editable
```

Validation: `finishedGoodCode` and `measurementUnit` must be non-empty.

### Step 3 — Hierarchical sheet: confirm the structure
Shown for sheets answered **Yes**. Renders a **static illustrative tree** — not
the user's data, no API call:

```
Finished good
├── Sub-assembly A          <- has its own BOM
│   ├── Raw material 1
│   └── Raw material 2
├── Sub-assembly B
│   └── Raw material 3
└── Raw material 4          <- direct child of the finished good
```

> "Is your BOM structured like this?"  Yes / No

On **Yes**: confirm the level column (dropdown, prefilled from auto-detect).

### Step 4 — Not a tree
On **No**: mark the sheet BOM-generation-unavailable and explain plainly —
the item directory still works, only BOM generation is skipped. The user
continues; nothing is blocked.

This is what keeps THALES-shaped sheets (6 roots, no level 0) out honestly
instead of silently producing broken trees.

---

## 3. Integration

`frontend/src/pages/UploadFiles.js` — the popup gates **both** exits:

| Exit | Handler | Button |
|---|---|---|
| Straight to mapping | `handleUpload` (~2704) | ~3979 |
| Via BOM Normalizer | `handleOpenBomNormalizer` (~2668) | ~3963 |

### Mechanism

Each handler gains an early guard:

```
if (!bomStructureAnswers) {
    setPendingUploadAction(<which handler>);
    setBomStructureOpen(true);
    return;                       // abort; resumes on confirm
}
... existing body unchanged ...
```

`onConfirm` stores the answers and re-invokes the stashed action, which now
passes the guard and runs its original body untouched.

Placed **after** the existing sheet-selection validation in `handleUpload`
(~2715-2725), so the user has already chosen sheets when we ask about them.

### State added

- `bomStructureOpen`
- `bomStructureAnswers`
- `pendingUploadAction`

Sheet names come from `clientSheetNames` (or `selectedClientSheets` in combine
mode), already in state. Headers come from the existing `getSheetHeaders`.

### Where answers go

Into the existing `navigate(...)` state object, alongside
`normalizerSuggestedMappings`.

**Frontend-only.** Not persisted to the session yet — that lands in step 2,
when generation actually needs to read it. Known limitation until then: a
page reload mid-flow loses the answers and re-asks.

---

## 4. Out of scope

Deliberately excluded from this step:

- tree derivation (parent, leaf/non-leaf, blocks)
- item directory / BOM sheet generation
- cutting `demo/bom-tree/`
- BOM validation
- export split
- backend persistence

---

## 5. Done when

- Both Upload page exits open the popup before uploading
- SAFRAN prefills **Yes** with `Level` preselected
- GE prefills **No** and shows the finished-good form
- Answering **No** at step 3 marks the sheet unavailable without blocking
- Cancel returns to the upload page with nothing sent
- Answers arrive in `/mapping` (or the normalizer) route state
