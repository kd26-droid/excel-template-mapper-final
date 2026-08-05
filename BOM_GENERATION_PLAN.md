# BOM Generation — Full Engineering Plan

Master plan for turning messy customer BOM sheets into FactWise-ready import
files. Step 1 detail lives in `BOM_STRUCTURE_POPUP_PLAN.md`.

All counts in this document were measured against the real files, not assumed.

---

## 1. Intent

Today the app maps messy sheets into a **flat item list**. It has no concept of
BOM structure — `level` and `parent` exist as role labels in
`bomNormalizerAlgorithmRegistry.js` but **no algorithm consumes them**. A user
can tag a Level column and nothing happens.

The intent is to produce **two FactWise-ready sheets from one normalized pass**:

1. **Item Directory** — what a part *is* (code, MPN, description, UOM, tags, specs, vendor)
2. **BOM** — how parts *assemble* (finished good, level, sub-BOM vs raw material, quantity)

Item Directory largely works today. BOM does not exist.

---

## 2. The model

```
normalized rows  ->  nodes (deduped)  ->  Item Directory
                 ->  edges            ->  BOM
```

- A **node** is a distinct part. It becomes one Item Directory row.
- An **edge** is a parent-child link. It becomes one BOM row.
- The root is a node but never a child, so `edges = nodes_with_duplicates - 1`.

### The item sheet contains every node

- Single level -> all raw materials **+ 1 finished good**
- Multi level  -> all raw materials **+ the root + every sub-BOM**, each as
  `Item type: Finished good`

### Item codes are generated downstream, not here

BOM generation must **not** invent item codes. The editor already generates
`Item code` from a user-configured Factwise ID rule that joins two chosen
columns with an operator (`views.py`, factwise_id rule). Which columns to use —
`MPN` alone, `manufacturer + MPN`, or something else — is the user's decision in
that dialog, not an architectural one taken here.

What generation needs is a **stable link**, not a name. The normalized contract
already carries `sourceRow` and `parentKey`, which serve that purpose:

```
normalize  ->  link rows by sourceRow / parentKey   (internal, no naming decision)
editor     ->  user's Factwise ID rule fills Item code
export     ->  resolve internal key -> real Item code, write it into the BOM
```

Consequences:

- **BOM export must run after item codes exist.** Ordering is not optional.
- Item-code generation no longer depends on the manufacturer directory.
- Two failures move to export, where they are checkable instead of guessable:
  - an item row with a blank `Item code` — the BOM row has nothing to reference
  - two different parts generating the **same** `Item code` — the link is ambiguous

For reference, measured on GE's live rows: 662 distinct `manufacturer + MPN`
keys versus 656 distinct bare MPNs. The 6 collisions (`1SMA6.0AT3G`,
`DS2482S-100+`, `FPF2496UCX`, ...) are the same physical part reachable through
two of GE's internal vendor codes, so collapsing them is arguably more correct.
Either choice works; it is the user's to make.

### What counts as an item

An item is a **buyable manufacturer part**, keyed `manufacturer + MPN` — not the
customer's internal part code. A customer row usually lists several approved
sources for one internal code:

```
GE part 5395947-3   "CAPACITOR 0.22U, 10%, 10V, X5R, 0201"
   |- SAMSUNG   CL03A224KP3NNNC
   |- MURATA    GRM033R61A224KE90
   '- TDK       C0603X5R1A224K030BB
```

One customer code, three real parts. For GE (live rows only) that is the
difference between **173** items and **663**.

This choice is forced by alternates: `Alternate raw material code` holds an
*item code*, so "use MURATA, or TDK as alternate" is only expressible if each
manufacturer part is its own item. Keying on the customer code makes BOM
alternates impossible.

Rules:

- Item code = `manufacturer + MPN`
- No MPN on the row -> fall back to the customer part code (1 live GE row)
- The customer's own code goes to `CPN Code`, not `Item code`

**Dependency:** only 22 manufacturer codes are learnable from GE's single-MPN
rows, so **537 of its 668 MPNs cannot resolve a manufacturer name from the sheet
alone**. Item-code generation therefore depends on the manufacturer directory
(`import_manufacturers`), not on bootstrapping.

### Alternates expand in opposite directions

The multiple MPNs packed into one customer cell are **alternates for that single
line item**. Both sheets consume them, but they expand differently:

```
GE row 2348958-34  --  one cell, 11 MPNs
    |
    |--> ITEM sheet:  11 rows    (expands DOWN   -- each is a buyable part)
    '--> BOM  sheet:   1 row     (expands SIDEWAYS -- 1 primary + 10 alternate sets)
```

The BOM must carry the alternate relationship too, or the link is lost at import.

**Alternate column sets repeat**, exactly like `Specification name/value/UOM` and
`Tag` in the item template — `build_sfo_clustered_headers` already implements
this clustering pattern and is the model to follow.

Sizing is driven by the worst row in the sheet:

| GE | |
|---|---|
| BOM rows | 174 |
| Max MPNs on one row | 11 -> 1 primary + **10 alternates** |
| Alternate column sets | **10** |
| BOM sheet width | 13 base + 10 x 4 = **53 columns** |
| Rows with at least one alternate | 120 of 174 |

MPNs per row are genuinely spread — 53 rows have one source, 29 have five,
18 have seven, 3 have eleven.

**Open assumption:** the *first* MPN in the cell is treated as primary
(`Raw material code`) and the rest as alternates. GE carries no preference
marker and the order looks arbitrary, so if a rule exists for choosing the
primary it changes which item lands in `Raw material code`.

Note the reference file `BOM 7 level w alt.xlsx` only ever demonstrates **one**
alternate (7 of 68 rows) and never repeats a raw material within a BOM ID, so it
does not by itself show the multi-alternate layout.

### One canonical key

`Item code` is the only real identifier. The BOM sheet contains **no item data
at all** — every code column in it is a foreign key back onto `Item code`:

| Item sheet | -> BOM sheet column | When |
|---|---|---|
| `Item code` | `Finished good code` | node has children |
| `Item code` | `Raw material code` | child is a leaf |
| `Item code` | `Sub BOM ID` | child itself has children |
| `Item code` | `Alternate raw material code` | it is an alternate of a child |

Because `BOM ID` is keyed off the parent's item code, a child that is itself a
sub-assembly has `Sub BOM ID` = that child's item code = that child's own
`BOM ID`. **Same string in both places**, so sub-BOM links resolve with no
lookup table. Synthetic IDs would need a resolution step and could drift
between the two exported files.

### Three sources of truth

This is why BOM columns are absent from the destination template — they are
never *mapped*:

| Source | Fields |
|---|---|
| **Derived** from the tree | `BOM ID`, `BOM name`, `Finished good code`, `Sub BOM ID`, `Raw material code`, `Level`, `Item type` |
| **Mapped** from the sheet | `Item code`, `Description`, `Quantity`, `Measurement unit` |
| **Authored** by the user | the finished good, when it is not in the data |

Adding derived/authored fields to the destination template would create dead
mapping targets. They belong in the generator's output schema instead.

---

## 3. Reference cases

### GE.xlsx — flat

Single sheet `9926006_BOM_r1`, 8 columns, header row 1. 212 rows in total, of
which **174 are live** and 38 are a trailing Do Not Populate block (below).
The live rows hold **173 distinct customer part codes**.

No hierarchy. The work is alternate expansion: `Manufacturer Equivalent Part`
holds space-separated MPNs and `Manufacturer` holds space-separated names — but
manufacturer names contain spaces, so positional splitting fails.

**Verified rule:** each MPN carries a 5-digit prefix that is a manufacturer
code. Learning the code -> name map from single-MPN rows gives **22 codes with
zero ambiguity**, and every multi-MPN row whose codes were all known
reconstructed the manufacturer string **exactly (7/7, 0 mismatches)**.

Limit: **113 rows** contain at least one code never seen alone, so single-row
bootstrapping is insufficient. Needs iterative learning (rows where all but one
code is known) plus the manufacturer directory already backed by the
`import_manufacturers` management command.

**GE has no finished good.** No parent row exists, so it must be authored via
the popup.

#### The sheet has two sections — the second is DNP

```
rows 2-175    live BOM rows
row  176      blank separator
row  177      "DNP" written in the Name column
rows 178-214  Do Not Populate block
```

DNP rows are footprints on the board with **no part fitted**. They carry no mark
number, no MPN, and machine descriptions shaped `<TYPE>_2PIN-<partcode>`. They
are **excluded entirely** — not merged, not imported.

Excluding them removes almost every edge case in this file:

| | Whole sheet | Live rows only |
|---|---|---|
| Rows | 212 | **174** |
| Duplicate codes | 24 | **1** |
| Rows with no MPN | 39 | **1** |
| Rows with blank quantity | 1 | **0** |

All 668 MPNs sit in the live section; the DNP block contributes no parts at all.

The normalizer already ships an **"Ignore Do Not Populate rows"** cleanup rule,
so this needs configuration rather than new code.

**Final GE output: 663 item rows, 174 BOM rows in 1 block.**

#### The two remaining edge cases

- **`M1086232` (rows 20 and 168)** — same designators `MH1-MH4`, same quantity,
  but different mark numbers (172/173) and revisions (A/2). A data-quality issue
  in the source, not a pattern. Surface it to the user; do not silently pick one.
- **`9926007` (row 123)** — *"SSM PWB (Printed Circuit Board)"*, qty 1, no MPN
  and no manufacturer. This is the bare board, built to GE's own design, so it
  legitimately has no manufacturer part. The customer-code fallback is correct.

#### Finished good code is discoverable

The bare board is `9926007` and the sheet is named `9926006_BOM_r1`, so the
assembly is **`9926006`**. The popup's finished-good form should prefill from the
sheet name rather than making the user type it.

#### Column mapping

| GE column | -> Destination |
|---|---|
| `Manufacturer Equivalent Part` | `MPN Code` + **item code** (`manufacturer + MPN`) |
| `Manufacturer` | **`Specification name` = "Manufacturer"**, value = the name |
| `Name` | `CPN Code`; item-code fallback when the row has no MPN |
| `Description` | `Item name` + `Description` |
| `Quantity` | `Quantity` (BOM only) |
| `Reference Designator` | spec pair or `Tag` |
| `Mark Number`, `Revision` | spec pairs, or dropped |
| -- | `Item type` derived from leaf/non-leaf |

**Manufacturer is not a vendor.** `Preferred vendor code` requires a code that
already exists for the enterprise (*"e.g. 'V001'"*), so manufacturer names
written there would fail import. Vendors are populated later, when items reach
events and vendors bid. Manufacturer belongs in a specification pair.

### SAFRAN S116488..xlsx — hierarchical

Sheet `S116488`, header row 1, **63 data rows**, 53 columns, levels 0-4.

Level column only — **no parent column**, so parent must be derived. This is the
general mechanism; Rafael is the outlier in supplying an explicit `Parent Nbr.`

**Verified derivation:** 1 root, **0 orphans**, 10 non-leaf, 49 leaf,
**59 distinct item codes**, 4 codes appearing more than once, **62 edges in
10 blocks**.

Attribute completeness:

- `UM` (col 44): 25 `UN`, 6 `m`, 3 `bob`, **29 blank**
- `Type Article` (col 16): **33 blank**, rest French codes (`E04 = Acheté`, `E01 = Fabriqué`)

The blanks correlate with the document rows below. `Type Article` is too messy
to drive `Item type` — derive it from leaf/non-leaf instead and treat this
column as a cross-check only.

**The `D*` problem:** 25 of 63 rows are `D`-prefixed drawings/specs/requirements
sitting inside the tree as if they were parts; 24 of them carry Qty 0. All 10
BOM-block parents are `S*` codes. Left alone these become **25 of the 59 item
rows**, importing documents into FactWise as raw materials.

---

## 4. Schemas

### Item Directory (destination template)

`Default Item.xlsx`, sheet `Sheet1`, header row 4 — **30 columns**.
Required today: `Item code`, `Item name`, `Item type`, `Measurement unit`,
`Procurement entity name`.

Already injected by `add_bom_destination_headers()` (`views.py:402`, called from
`build_sfo_clustered_headers` at `views.py:479`), inserted before
`Procurement entity name`:

- `Level`
- `Quantity`
- `Base BOM Qty`

These three are **the only BOM fields that come from the source sheet**, so they
correctly belong in the mapping surface. They are `bom`-only and must be
**excluded from the Item Directory export**.

### BOM export

From the reference file `BOM 7 level w alt.xlsx` — **17 columns**, header row 4,
same layout as the item template (instructions row 1, validation row 2, blank
row 3).

| # | Column | Required | Rule |
|---|---|---|---|
| 0 | `Finished good code` | **Yes** | constant within block |
| 1 | `BOM ID` | **Yes** | constant within block, unique across blocks |
| 2 | `BOM name` | **Yes** | constant within block |
| 3 | `Base quantity` | No | defaults to 1 |
| 4 | `BOM measurement unit` | No | defaults to finished good UOM |
| 5 | `BOM currency` | No | |
| 6 | `Level` | **Yes** | integer; constant within block |
| 7 | `Raw material code` | XOR | |
| 8 | `Sub BOM ID` | XOR | |
| 9 | `Description` | No | |
| 10 | `Cost per unit` | No | defaults to 0.001 |
| 11 | `Quantity` | **Yes** | numeric |
| 12 | `Measurement unit` | No | |
| 13 | `Alternate raw material code` | No | |
| 14 | `Alternate cost per unit` | No | |
| 15 | `Alternate quantity` | No | defaults to `Quantity` |
| 16 | `Alternate measurement unit` | No | defaults to `Measurement unit` |

**XOR confirmed empirically** in the reference file: 62 rows have
`Raw material code`, 6 have `Sub BOM ID`, **0 have both**.

**Alternates are columns on the child row, not separate rows.** The normalizer
expands alternates into rows; BOM export must collapse them back into these
columns.

---

## 5. Derivation rules

### Tree

```
Level          integer, >= 0, never jumps by more than +1
Parent         nearest row above with level - 1
Is sub-BOM     a deeper level follows before level returns to its own
One block      one parent node that has children
```

### Level semantics — important

In the FactWise format `Level` is a property of the **BOM block**, not the row.
Each `BOM ID` has exactly one level, constant across its rows, counting from
the top. The reference file:

```
SJWS191 L1 -> SJWS161 L2 -> SJWS151 L3 -> SJWS141 L4
        -> SJWS131 L5 -> SJWS121 L6 -> SJWS112 L7 (50 RMs)
```

So **a row's `Level` is its parent's depth, not its own**. For SAFRAN (root at
level 0) this passes straight through, but the rule is what matters.

Note also that `BOM ID` and `Finished good code` are *different* values in the
reference file (`SJWS191` vs `YASG27`). Nothing forces that, so keying both off
the item code remains valid.

### Derived per block

```
BOM ID              = parent node's item code
BOM name            = same (editable)
Finished good code  = parent node's item code
Level               = parent node's depth
```

Every row in the block carries that set unchanged.

### Derived per node

```
Item type = Finished good   if non-leaf
          = Raw material    if leaf
```

`Item type` is a **required** item column with allowed values
`Raw material, Finished good`. Deriving it from the tree fills all 59 SAFRAN
rows with no user input.

### Dedup asymmetry

The same code may legitimately appear as several edges (a part used in two
sub-assemblies — SAFRAN has 4 such codes). It must appear **once** in the Item
Directory and **many times** in the BOM. Same data, opposite rule. Getting this
backwards breaks one sheet or the other.

---

## 6. Authoring rules

When the finished good is absent from the data (all flat sheets), the user
authors it. One input drives the rest:

```
Finished good code   FG-001   <- user enters (required)
  |- Item code       FG-001      same, locked
  |- Item name       FG-001      prefilled, editable
  |- BOM ID          FG-001      derived
  |- BOM name        FG-001      prefilled, editable
  '- Item type       Finished good   derived, locked

Measurement unit     EA       <- required, defaults to fallback UOM
Base quantity        1        <- default, editable
```

For hierarchical sheets the nodes exist, so code comes from the sheet and name
prefills from the description (falling back to the code). **All 10 SAFRAN
non-leaf nodes** need a name and UOM, not just the root.

### No fallback measurement unit

There is deliberately **no** workbook-level UOM fallback. `Measurement unit` is
a required FactWise item column, and guessing it silently mislabels real data —
SAFRAN alone uses `UN`, **`m` (metres)** and **`bob` (reels)**, so a blanket
`EA` would mislabel wire and tape.

Anything still blank is caught by **validation at item-sheet export**, where the
user supplies the unit explicitly. The finished-good form in the popup likewise
starts blank and requires an entry rather than pre-filling `EA`.

---

## 7. Validation

### BOM export — hard fail (block download)

1. `Level` missing, non-integer, or negative
2. Level jumps by more than +1 from the row above
3. `BOM ID` / `BOM name` / `Finished good code` missing
4. **Same `BOM ID` carrying a different `BOM name` or `Finished good code`**
5. Row has neither `Raw material code` nor `Sub BOM ID`, or has **both**
6. `Quantity` missing, non-numeric, or <= 0
7. `Sub BOM ID` pointing at a `BOM ID` that does not exist in the sheet
8. Duplicate child **within the same** `BOM ID` (across blocks is legal)
9. Cycle in the tree
10. **Referential integrity** — a code in the BOM sheet with no matching
    `Item code` in the Item Directory

Rule 4 is the invariant that silently corrupts an import. Rule 10 catches the
most damaging class of bug: the two files drift and FactWise fails on the second
with no useful error.

### Warn only (allow download)

- `Base BOM Qty` defaulted to 1
- Missing `Description`
- Alternate code present with no alternate quantity
- Item Directory row not referenced by any BOM

### Item Directory

Existing validation is working and stays **untouched**. BOM validation is a
separate path; today Export BOM incorrectly reuses the item rules.

One addition follows from dropping the UOM fallback: **a blank
`Measurement unit` is a hard fail at item-sheet export**, and the user supplies
it there. Nothing guesses a unit on their behalf.

---

## 8. Build steps

**Status:** steps 1-8 are built and deployed to the `factwise-bom4-test` stack
(frontend :3002, backend :8002).

Endpoints added:

```
GET /api/bom/generate/<session_id>/    generated BOM + item rows as JSON
GET /api/bom/tree/<session_id>/        tree preview, source: "generated"
GET /api/bom/download/<session_id>/    generated BOM as .xlsx
GET /api/bom/validate/<session_id>/    BOM rules only
```

`api.downloadDemoBomSheet` and `api.getBomTree` now point at the generated
routes; the golden-file path is no longer reachable from the UI.

### The authored finished good must reach the item export

A flat sheet has no finished good of its own, so the user authors it in the gate
and it lives only on the session — never in the mapped grid. The item export
reads that grid, so without special handling the BOM would reference a finished
good the exported item directory does not contain, and the FactWise import would
fail on the second file.

Two fixes, both required:

1. `download_file` appends authored finished goods to item exports, keyed by
   header name and idempotent, so a repeat download cannot duplicate the row.
2. BOM validation reads the **exported** item rows, not the generator's own copy
   of them. Validating the copy is precisely how a BOM can report clean and
   still fail at import.

**Known gap — multi-level generation is not wired.** `bom_tree.py` is written
and tested (SAFRAN -> 10 blocks, 1 root, 0 orphans) but no endpoint calls it.
`generate_flat_bom` is the only generator, so a hierarchical sheet currently
produces a single flat block instead of nested BOMs. This is the next task.


| # | Step | Where | Done when |
|---|---|---|---|
| **1** | **Popup** — steps 0-4, static example tree, `Level` auto-detect, finished-good form | new `BomStructureDialog.js`; `UploadFiles.js` both exits | Answers captured, both paths gated |
| **2** | **Persist answers** to the session | `models.py`, upload view | Survives reload; generation can read them |
| **3** | **Tree derivation** — parent, leaf/non-leaf, blocks | new `backend/excel_mapper/bom_tree.py` | SAFRAN -> 1 root, 0 orphans, 10 blocks |
| **4** | **Item Directory generation** — nodes deduped, `Item type` derived | new `bom_generator.py` | SAFRAN -> 59 rows; GE -> 663 rows |
| **5** | **BOM generation** — edges, 17-col schema, block-level `Level` | `bom_generator.py` | SAFRAN -> 62 rows / 10 blocks; GE -> 174 rows / 1 block |
| **6** | **Cut the demo route** — preview reads the generated BOM | `BomTreePreview.js`, `urls.py` | `demo/bom-tree/` gone |
| **7** | **BOM validation** — rules in §7 | new `bom_validation.py` | Bad tree blocks download with a reason |
| **8** | **Export split** — item sheet drops `Level`/`Quantity`/`Base BOM Qty` | export views | Two clean FactWise files |

**Order logic:** step 3 is the spine — 4, 5, 6, 7 all read from it. 6 cannot
precede 5 (nothing to preview). 7 cannot precede 4 and 5 (referential integrity
needs both sheets).

**Reference cases run continuously.** GE proves the flat path from step 4,
SAFRAN proves hierarchy from step 3 onward. Both are checked at every step
rather than once at the end.

### Preview

`BomTreePreview.js` already models `root / fg / sfg / ssfg / component /
alternate / more` with RM/SB child counts and `+N` capping — this matches what
derivation produces. It is currently fed by `api.getBomTree` ->
`demo/bom-tree/<session_id>/`, which step 6 removes.

The **same component** serves two places: the gate popup (step 3 of the wizard,
using a *static illustrative* tree) and the export dialog (using the *generated*
tree). Only the export one is real data.

---

## 9. Open decisions

**The 25 `D*` rows in SAFRAN.** Options:

1. **User-facing exclude rule** in the normalizer, with a live count and preview,
   alongside the existing "ignore category rows" cleanup — *recommended*.
   Generalizes to other customers' document conventions.
2. **Qty = 0 rule.** Automatic, but 34 rows have Qty 0 including the root
   finished good, so it over-deletes unless special-cased.
3. **Keep them.** Honest to the source, but ships junk items and fails
   validation rule 6 on 24 rows.

---

## 10. Out of scope

| Sheet | Why |
|---|---|
| **THALES** | 187 rows, **6 roots, no level 0** — not one tree. Hits PM step 4 by design. |
| **Rafael** | Fits the contract later as a new *reader* (CSV, `=CONCATENATE()` wrapping, explicit parent column). |
| **Honeywell** | Levels hidden in Excel row-group metadata; needs level recovery before the contract applies. |

Each is a new **reader**, not a new pipeline — they all land in the same
normalized contract (`Level`, `Parent Item Code`, `Item Code`, `Quantity`,
`UOM`, alternates).
