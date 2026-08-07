# BOM validation — decisions and parked work

Written 2026-08-06. Revised same day after reading the uncommitted hierarchy
work (`bom_generator.py`, `bom_tree.py`, `views.py`, `BomStructureDialog.js`,
`UploadFiles.js`, `BomNormalizer.js` — ~1075 insertions).

Companion to `BOM_GENERATION_PLAN.md` (§7 defines the original ruleset) and
`BOM_STRUCTURE_POPUP_PLAN.md`.

---

## 1. The stale-data bug — **FIXED** in the working tree

*Original diagnosis: a Quantity fill did not clear the validation popup, because
generation read the uploaded file off disk and only `Item code` crossed over
from the edited grid.*

`_merge_item_codes_from_grid` has been replaced by
`_merge_grid_values_into_records`, which carries eight fields through
`_template_label_key` (`BOM_GRID_FIELDS`: Item code, quantity, uom, description,
mpn, cpn, manufacturer, level). Both failure modes now return a 400 with an
actionable message instead of degrading silently — `rows_added` and
`row_count_mismatch` are handled explicitly in `_generate_bom_for_session`.

Two things the implementation got **more right than this plan originally
proposed**:

- **Authority is per column, not per cell.** The plan said "grid wins when
  non-blank." That is wrong: a quantity the user deliberately *cleared* must come
  out cleared and be caught by validation, not silently revert to the uploaded
  value. A column is authoritative for all its rows once it carries at least one
  non-blank value — which correctly excludes template columns mapping never
  populated.
- **Deleted rows are handled, not rejected.** `_align_grid_to_records` matches
  the grid as a *subsequence* of the uploaded sheet on (CPN, MPN), running the
  match from both ends and accepting only when the two agree. Deleting rows in
  the editor is the point of the editor; the earlier plan would merely have
  reported the mismatch loudly.

### Residual

`_normalized_records_from_grid` (`views.py:12975`) still keys records by exact
header text, so the lowercase-contract mismatch (`Quantity` vs `quantity`)
survives on the *non-fallback* path — the branch taken when the grid still
carries `parentKey`/`relation`. Mapping normally drops those, so the branch is
not currently reached. Latent, not active. Worth closing when convenient.

---

## 2. Rule decisions (agreed)

**Backend ruleset implemented** in `bom_validation.py`, covered by
`tests/test_bom_validation.py` (17 tests). The fix *buttons* in the table below
are the dialog's half of the work and are not built yet — see §4 and §5.

| Rule | Decision |
|---|---|
| `quantity_missing` | Keep. Fix button: Fill Column on grid Quantity, quick default `1`, fill-from-above. |
| `quantity_invalid` | Keep. Fix button: Fill Column in **`selected_values` mode**, pre-loaded with the offending values. |
| `item_code_blank` | Keep. Fix button: FactWise ID tool. |
| `item_code_duplicate` | Keep. Existing "highlight duplicates" affordance. |
| `raw_or_sub_missing` | **Suppress conditionally** — see below. Do not delete. |
| `description_missing` | **Delete outright** (`bom_validation.py:188-192`). Description is not required by the import; warning about it is noise. |
| `duplicate_child` | Keep as error. **Locator only, no fix button.** Parked — see §4. |
| `cycle` / self-reference | Keep as error. **Locator only, no fix button.** Parked — see §4. |
| `level_*` | **Revised — see §2a.** No longer inert. |

### 2a. Multi-level changed the picture

Multi-level generation now exists (`_generate_hierarchical_bom` →
`bom_tree.derive_tree` → `generate_multi_level_bom`). Rules previously written
off as unreachable are now live on hierarchical sheets:

- `Level` is real per block, not hardcoded to 1 → `level_missing`,
  `level_invalid` can fire.
- `Sub BOM ID` is populated → `sub_bom_unresolved` can fire, and
  `raw_or_sub_missing` becomes genuinely reachable for reasons *other* than a
  blank item code. **This vindicates keeping the rule and suppressing it
  conditionally rather than deleting it.**
- Multiple blocks exist → `block_inconsistent` can fire.
- Real cycles are now possible (an assembly referencing an ancestor).

**`level_jump` is now double-covered.** `bom_tree._detect_level_jumps` runs at
derive time and its errors block generation before validation is ever reached —
and it is the tree-derived form this plan recommended. The copy in
`bom_validation.py:122-130` is the order-dependent sequential scan. Delete the
validator copy; the tree one is authoritative.

### `raw_or_sub_missing` — suppress, do not delete

BOM `Raw material code` is just the primary row's `Item code`
(`bom_generator.py:267`). So a blank item code **always** produces two errors for
the same row, in two vocabularies:

- `item_code_blank` → "3 item row(s) have no Item code"
- `raw_or_sub_missing` → "Row 1 / 4 / 28 has neither a Raw material code nor a Sub BOM ID"

Same three rows, counted twice — four of the nine errors in the reported case.
Suppress the emission when the row's item code is blank. Keep the rule: it still
fires legitimately in multi-level, where a row should have carried a Sub BOM ID
and didn't. On the flat path it then never fires, which is correct.

### Effect on the reported screenshot

Errors: nine collapse to two cards — *3 rows have no item code* (Generate) and
*4 rows have no quantity* (Fill). Warnings: seven drop to one.

The survivor — "6 rows shared an item code and were collapsed into one item" —
**stays a warning, but must show which codes.** `generate_item_rows` drops any
row whose `Item code` was already seen (`bom_generator.py:187-191`). That is
either correct dedup (the same real part listed twice) or silent destruction
(two *different* parts given the same generated code, merging them into one and
leaving every BOM line pointing at whichever survived). A bare count does not
let the user tell which case they are in.

Near-free fix: the warning already carries `'codes': duplicate_codes[:10]`
(`bom_generator.py:311`). The dialog renders only `.message` and discards them.

It is also a **generation** event, not a validation rule, currently folded into
the same warnings list at `views.py:13305`. Separate the two streams.

---

## 2b. Found while reviewing the hierarchy work

Three things worth deciding on, none of them in the original plan.

### Document exclusion silently competes with quantity validation

`is_document_row` (`bom_tree.py`) classifies any row whose quantity is blank,
`---`, or `<= 0` as a document and drops it from **both** the BOM and the item
sheet. It is reported — a `document_rows` warning with a count and up to ten
codes — but it is a warning, and the row is gone from the output.

The interaction with validation is the problem: on a hierarchical sheet, a part
row whose Quantity the user simply has not filled yet is now **reclassified as a
document and dropped**, rather than reported by `quantity_missing`. On a flat
sheet the same row is reported. The two paths disagree about the same data.

For THALES (`---` drawings, `0` Gerber data) the classification is right. For a
genuine part awaiting a quantity it is data loss wearing a warning label. Worth
deciding whether "no quantity" should mean "document" when the row *has* a part
code — a drawing has no part number by design, which is a usable discriminator.

### ~~`baseQuantity` coerces silently~~ — **fixed**

`validateStep` now rejects a base quantity that was typed and does not parse to a
positive number, for the root **and** every sub-assembly, via `isPositiveQuantity`.
The coercion in `handleConfirm` stays as a backstop but can no longer swallow a
typo, because validation blocks first. Blank still passes — the field is
prefilled, so blank means the prefill, not a mistake.

### ~~Toggling "Multi level" discards the auto-detected root~~ — **fixed**

The radio's onChange now preserves `bomHeader` instead of nulling it
(`bomHeader: answer.bomHeader || blankBomHeader(name)`).

Residual, deliberately not chased: a sheet seeded as *flat* carries a
sheet-name guess in `bomHeader`, and toggling it to multi-level keeps that guess
rather than re-running preamble detection. That is the pre-existing prefill
behaviour and the field is on screen and editable, so it is visible rather than
silent — unlike the bug below, which swapped a detected root for a guess with no
indication.

#### Original report

Seeding populates `bomHeader` for a hierarchical sheet from the preamble
(`detectRootFromPreamble`), setting `autoDetected: true`. But the radio's
onChange does `bomHeader: hasLevels ? null : (...)`. So toggling to Single level
and back to Multi level **nulls the detected header**, and both
`renderFinishedGood` and `handleConfirm` then fall back to
`blankBomHeader(name)` — which prefills `finishedGoodCode` from
`guessFinishedGoodCode(sheetName)`.

The result is that a preamble-detected code is silently replaced by a
sheet-name guess, the "auto-detected" chip disappears, and `handleConfirm` ships
the guess. That directly contradicts the stated intent one function above:
*"Nothing detected means nothing prefilled — a wrong guess the user does not
notice is worse than an empty required field."*

Fix: preserve `bomHeader` across the toggle rather than nulling it.

---

## 3. Gaps

### Agreed

- **`baseQuantity` coerces silently** in the popup (`BomStructureDialog.js:404`)
  — type "abc", get 1, no warning. Surface it. **YES.**

### Rejected

- ~~Quantity must be a whole number when the unit is discrete~~ — **NO.**
- ~~Run validation live rather than only at export~~ — **NO.** Stays a
  gate at export time.

### Implemented

- **BOM line Measurement unit** — now reported as **one aggregated warning**
  (`measurement_unit_missing`) carrying `count` and `rows`, not one per row.
  Deliberately a warning, not an error: see the unconfirmed note below. Promoting
  it is a one-line change once the import spec is checked.
- **Alternates** — three rules added: `alternate_is_primary`,
  `alternate_duplicate`, `alternate_quantity_invalid`. A blank alternate quantity
  is intentionally *not* flagged; the generator inherits the primary's, which is
  correct. `_alternate_groups` replaces `_alternate_code_indexes` so a group's
  quantity column is located positionally — the headers repeat, so they cannot be
  looked up by name.

### Still open

- **BOM line Measurement unit — error or warning?** It is in the schema and
  populated from `uom` (`bom_generator.py:270`) but has no rule — although
  `bom_validation.py:59-63` already resolves its column index and then never
  uses it (same for `Base quantity`). It is *not* the same field as the item's
  Measurement unit: the item sheet says how a part is stocked, the BOM line says
  how it is consumed, and metres-vs-centimetres is legitimate, so the item sheet
  passing tells you nothing.

  **Unconfirmed:** whether the FactWise import actually rejects a blank line UOM.
  Inferred from the column being in the base template, so it ships as a warning —
  a wrong blocker stops exports that would have been fine. Check the import spec,
  then promote if it really is mandatory.

- **Popup `measurementUnit` is free text with no rule**, while the item sheet's
  Measurement unit gets an `alpha` validator (`EnhancedDataEditor.js:2822`).
  Same field, two standards.

---

## 4. Parked: the two locator-only rules

Both rules are cheap. Both are blocked on infrastructure that does not exist.

### `duplicate_child`

Same part listed twice as a child of one BOM block (`bom_validation.py:204-216`).
Fires only *within* a block — the same part in two different sub-assemblies is
normal and correctly ignored.

**No fix button, deliberately.** Two incompatible user intents and no way to
tell them apart:

- pasted twice by mistake → delete one
- genuinely used in two places, qty 12 and qty 3 → merge to qty 15

Guessing silently changes the customer's bill of materials.

**Cost:** ~1 hour backend. The rule already computes both row numbers; it needs
a structured `rows: [12, 47]` field alongside the message string.

### `cycle` / self-reference

A BOM containing itself. On a flat BOM there is exactly one possible shape: a
component row generates an item code identical to the finished good code. The
BOM then says "to build ASSY-100 you need one ASSY-100" — the import rejects or
recurses.

**No fix button.** Either the authored finished good code is wrong or that row's
item code is wrong; only the user knows.

`_detect_cycles` (`bom_validation.py:292`) catches it incidentally, but emits
"Cycle detected: ASSY-100 -> ASSY-100", which does not communicate anything. Add
an explicit flat-path rule with a message that names the collision.

**Cost:** ~1 hour backend.

### The shared blocker — backend half **done**, frontend half pending

**Done.** A record is stamped with its 1-based editor row (`GRID_ROW_KEY`) in
`_merge_grid_values_into_records`, at the one point where the two row spaces are
known to line up. `GenerationResult.bom_row_grid_rows` carries it parallel to
`bom_rows` through both generators, and `validate_bom(..., bom_row_grid_rows=)`
adds `grid_row` / `grid_rows` to every issue via `_attach_grid_rows`. Issues the
generator invented (an authored finished good) get no locator rather than a wrong
one. The key is underscored and never reaches a generated sheet — asserted in
the end-to-end check.

Worked example: three editor rows (5, 6, 9) where 6 is an alternate of 5 produce
**two** BOM lines mapping to `[5, 9]`, and `quantity_missing` on generated row 2
resolves to editor row 9. Without this the message said "Row 2", which appears
nowhere on a screen showing rows 5, 6 and 9.

**Pending — frontend.** `jumpToGridRow(n)`: the page math is
`Math.floor((n - 1) / pageSize) + 1` then `setPage` + `fetchPageData`
(`EnhancedDataEditor.js:459-460, 6570`). A row-level *highlight* needs more: the
grid has no `getRowStyle` / `rowClassRules` today, and `dupHighlight`
(`EnhancedDataEditor.js:788`) highlights by cell value, not by row. So the
locator lands in two parts — page jump first, row highlight when the grid gains
a row-styling hook.

### Original analysis — there was no row locator at all

Both rules, and every other "show me the rows" affordance, need something that
does not exist.

`highlightItemCodeDuplicates` (`EnhancedDataEditor.js:3172-3180`) highlights by
**value** — it sets `{field, values: Set}` and the grid styles matching cells.
There is no jump-to-row-index anywhere in the editor. The grid is server-
paginated at 100 rows, so "show me row 147" requires computing the page,
switching to it, scrolling, and highlighting a row rather than a value.

This is the real cost and it is shared across every rule. Build it once:

1. Carry `sourceRow` through generation so a BOM row number resolves to a grid
   row number. The normalizer already emits it (`bom_generator.py:33`) and the
   generator has it on `primary`.
2. Add a page-aware `scrollToGridRow(n)` + row-level highlight to the editor.

Until this exists, BOM validation messages point at rows the user cannot find —
dialog row numbers index the *generated* BOM (one row per `parentKey` group),
not the 162 rows on screen.

### Correction: the popup pre-check is weaker than first proposed

Catching the finished-good code collision at typing time was suggested earlier.
`BomStructureDialog` runs from `UploadFiles.js:5725` and `BomNormalizer.js:6932`
— both **before** the editor, and item codes are generated later by the FactWise
ID rule. At typing time most codes do not exist yet.

A popup check can only compare against codes already carried from the source; a
collision created later in the editor slips straight past it. Best-effort
warning at most. The authoritative check stays in validation.

---

## 5. Dialog rework

The BOM dialog (`EnhancedDataEditor.js:9589-9628`) is ~40 lines of raw `<Alert>`
in a `maxWidth="sm"` box: one alert per row, truncated at 25 errors and 10
warnings (the warnings branch has no "…and N more" — they are silently dropped),
no theming, no actions.

The item dialog (`EnhancedDataEditor.js:7356-7657`) works because every issue
arrives with three things: what the rule is, what to do, and a button that does
it. `REQUIRED_FIELD_GUIDANCE` (`EnhancedDataEditor.js:2785`) supplies the first
two as plain strings; `quickValues` + "Use Fill Column" supply the third. Worst
case, a field with no quick values still gets a pre-targeted Fill Column button.
**There is a floor.** The user is never told about a problem and left holding
nothing.

Port the anatomy:

1. **Group by rule, not by row.** The backend already tags every issue with
   `rule`. One card per rule with a count and affected rows as chips. Kills the
   truncation problem.
2. **Add `BOM_RULE_GUIDANCE`** mirroring `REQUIRED_FIELD_GUIDANCE` — a `rule:`
   and `fix:` string per rule id.
3. **Inline fix actions** per the table in §2.
4. **The floor for BOM is "show me the rows."** Some BOM problems have no
   automatic fix and that is fine — but the message still ships with a locator.
   No issue is ever a bare sentence.
5. **Re-validate in place** after any inline fix; close and proceed when errors
   hit zero, as `applyRequiredQuickFill` does
   (`EnhancedDataEditor.js:3046-3054`).
6. **Chrome:** `maxWidth="md"`, the item dialog's `PaperProps`, red left-border
   on error cards / amber on warnings, warnings in a collapsed accordion, footer
   of "Back to grid" + "Re-check". No "Export anyway" — these genuinely block.

Longer term, normalise both validators onto one issue shape so a single dialog
component renders both:

    { rule, severity, scope: 'row'|'column'|'sheet',
      rows: [], field, message, guidance: {rule, fix}, fix: {kind, ...} }

Two validators with two result shapes and two dialogs is why they drifted.

Live validation (a persistent badge, re-running after every mutation) was
considered and **rejected**. Validation stays a gate at export time. Point 5
above — re-validating inside the dialog after an inline fix — still applies.

---

## 6. Suggested order

~~1. §1 generator projection~~ — **done**, committed.

~~2. Rule changes in §2 + §2a + the §3 additions~~ — **done.**
`description_missing` deleted, `raw_or_sub_missing` folded into
`item_code_blank`, the validator's duplicate `level_jump` removed, line
Measurement unit added as an aggregated warning, three alternate rules added.
17 tests in `tests/test_bom_validation.py`.

~~3. Grid-row plumbing (backend half of §4)~~ — **done.** 22 tests.

Remaining, in order:

1. **Dialog rework §5** — group by rule, `BOM_RULE_GUIDANCE`, themed cards, Fill
   Column buttons, row chips reading the new `grid_row` / `grid_rows`, plus
   `jumpToGridRow`. The largest remaining piece and the one the user actually
   asked for.
2. **Row highlight** — needs a `getRowStyle` / `rowClassRules` hook on the grid,
   which does not exist yet.
3. §2b decisions — the `baseQuantity` coercion and the "Multi level" toggle bug
   are small and self-contained; the document-exclusion question needs a call
   first.
4. Show the codes the collapsed-rows warning already carries.
5. Confirm the FactWise import spec on line Measurement unit; promote the
   warning to an error if it is genuinely mandatory.
