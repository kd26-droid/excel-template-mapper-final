# BOM Normaliser — driving it without a UI

Everything needed to run a customer BOM from raw file to a BOM sitting in a FactWise 4.0
project, over HTTP only. No browser, no React.

Two backends are involved and they are **not** the same thing:

| | base | what it is |
|---|---|---|
| **Mapper** | `http://localhost:3002/api` (nginx → Django `:8002`) | the normaliser itself — upload, map, clean, export |
| **FactWise 4.0** | `http://localhost:8001` | the system of record — validate, commit, projects |

The mapper never lets the browser talk to 4.0 directly (4.0 registers no CORS middleware),
so every 4.0 call is relayed through two mapper endpoints: `factwise40/validate/` and
`factwise40/call/`. An agent can use those, or call 4.0 directly — server-side there is no
CORS to worry about.

**Verification key** — ✅ exercised end to end in this pass · 📄 contract read from the view,
not run.

---

## 1. What the agent must have before it starts

| | required | where it comes from |
|---|---|---|
| the customer's BOM file | yes | the user |
| **finished good**: code, name, UoM, base qty | yes, for any BOM | the user — it is usually *not* in the sheet |
| does the sheet have levels, and in which column | yes | the user, or inferred then confirmed |
| `enterprise_id`, `token`, `api_url` | only for FactWise calls | the launch URL when embedded (`enterprise_id`, `token`, `api_url`), or a dev token `dev.<enterprise_id>.<user_id>` |
| `entity_id` | only to create a project | `GET /enterprises/{eid}/entities` — **not** the `entity_id` on the launch URL, which is the enterprise id |

Everything else the agent can decide for itself or read back from the API.

---

## 2. The flow

```
upload (+ BOM gate)  →  headers  →  normalise  →  mapping  →  clean the grid  →  export
                                      └─ structures/match → roles/infer
                                         → field-patterns/infer → field-patterns/apply
                                                                                   ↓
                                                  attach ← find BOM ← commit ← validate
```

Stages 1–5 are the mapper. 6–8 are FactWise. Validation is the gate between them: the mapper
has its own rules, but on the 4.0 path they are deliberately not used — FactWise's `validate`
is the only authority on whether a sheet can be imported.

---

## 3. Stage by stage

### Stage 1 — Upload, and answer the BOM structure gate ✅

```
POST /api/upload/          multipart/form-data
```

| field | required | notes |
|---|---|---|
| `clientFile` | yes | the customer's .xlsx / .csv |
| `bomStructure` | for a BOM | JSON string, see below. **This is the whole gate** — no separate endpoint |
| `sheetName` | no | defaults to the first sheet |
| `headerRow` | no | **omit it and the header row is detected**; send it to override exactly |
| `templateFile` / `useTemplateId` | no | a saved mapping template to apply on arrival |
| `clientHeaders`, `formulaRules`, `templateSheetName`, `templateHeaderRow` | no | |

`bomStructure` — one entry per sheet, keyed by sheet name:

```json
{"mode":"create","sheets":{"Sheet1":{
  "hasBom":true, "hasLevels":true, "levelColumn":"Level",
  "treeConfirmed":true, "bomGenerationAvailable":true, "dropDocuments":true,
  "bomHeader":{"finishedGoodCode":"HL-FG","bomCode":"HL-FG","itemName":"Headless assembly",
               "bomName":"HL-FG","measurementUnit":"EA","baseQuantity":1},
  "subBoms":{}}}}
```

Response:

```json
{"success":true,"session_id":"b5a2c649-…","message":"Files uploaded successfully",
 "template_applied":false,"template_success":false,"applied_mappings":{},"applied_formulas":false}
```

The `session_id` is the handle for everything that follows.

> **Gotcha.** Malformed `bomStructure` JSON is **ignored silently** (logged as
> `Invalid bomStructure JSON on upload; ignoring`) and the upload still succeeds. The failure
> only shows up later as *"No sheet in this upload was marked as containing a BOM."* Always
> read the structure back from `GET /api/session/{sid}/snapshot/` before continuing.

### Stage 2 — See what came in ✅

```
GET /api/headers/{session_id}/
→ {"success":true,"client_headers":[…],"template_headers":[…]}
```

`template_headers` is the FactWise item template — the destination vocabulary, including the
BOM structure columns `Level`, `Quantity`, `BOM Qty`.

### Stage 2b — The Normaliser: roles and setup ⚠️

Only needed when the source is a raw customer BOM rather than a sheet already shaped like the
template. It decides which source column plays which role, and how the sheet is laid out.

```
POST /api/bom/roles/infer/
```

| field | required | notes |
|---|---|---|
| `headers` | yes | the source column names |
| `rows` | yes | data rows, each an object keyed by header, plus `__sourceRow` (the 1-based sheet row) |
| `sampleSize` | no | how many rows to weigh; the browser sends 120 |
| `config` | no | `{skipTitleRows, skipRepeatedHeaders}` |
| `source_signature` | no | `{fileName, sheetName, headers, headerRowIndex}` — used to match a previously learned structure |

> ⚠️ **It takes rows, not a `session_id`.** The browser opens the workbook and posts the parsed
> rows in. Until session support is added, an agent has to parse the file itself to call this —
> see Known gaps. The inference itself is entirely server-side and works fine over plain HTTP.

**What comes back** (the parts that matter):

| field | what it is |
|---|---|
| `roles` | one source column per role, for the sheet as a whole — this is the auto-selection |
| `candidates` | per role, ranked alternatives: `header`, `score`, `confidence`, `reasons`, `signals` |
| `blockStructure` | the sheet split into blocks, **with a role map per block** |
| `warnings` | `low_confidence_role` entries — the roles worth asking about |
| `roleSources` | how each role was decided: `inferred`, or from a learned structure |
| `roleMetadata` | extra detail, e.g. `description → {"subtype": "item_name"}` |

**`blockStructure` is the important one.** A sheet whose columns change meaning partway down is
handled by splitting it, not by averaging it:

```json
{ "detected": true, "blockCount": 2,
  "repeatedHeaderRows": [19], "sectionTitleRows": [18, 126],
  "summaryRows": [16], "blankRows": [17],
  "roleMaps": [
    { "sourceRow": 1,  "roles": { "mpn": "MPN",          "manufacturer": "Manufacturer" } },
    { "sourceRow": 19, "roles": { "mpn": "Manufacturer", "manufacturer": "MPN" } }
  ] }
```

That is a real result: in `48V_V2_BOM.xlsx` the MPN and Manufacturer columns swap over after the
repeated header on row 19, and each block gets its own map. The flat `roles` is only the
whole-sheet summary — **read `roleMaps` when `blockCount > 1`, or half the sheet is wrong.**

The row lists also drive the two cleanup counts the UI shows: `sectionTitleRows` + `summaryRows`
→ "Ignore category/title rows · N detected", `repeatedHeaderRows` → "Ignore repeated header rows".

**What to ask the user.** For each role: accept the auto-selection, or change it. A change needs
only the header name. Where `candidates[role]` is non-empty, offer those — each carries why:

```
cpn → not selected
  Manufacturer    0.61  low   identifier-like values; separate strong MPN column present
  Ref Designator  0.55  low   identifier-like values; separate strong MPN column present
  Sr.no.          0.40  low
```

A role with no auto-selection **but** non-empty candidates is precisely the "ask me" case.

---

### Stage 2c — The setup options 📄 **frontend-only**

After roles come the layout answers — the "Detected setup" panel. **An agent cannot discover
these from any endpoint.** The vocabulary lives in
`frontend/src/lib/bomNormalizerAlgorithmRegistry.js`, and the one derivation that picks a default
(`identityLayout`) is computed in `frontend/src/pages/BomNormalizer.js`. They are reproduced here
because that is the only way an agent gets them.

**Roles** (`ROLE_FIELDS`): `cpn` · `mpn` · `manufacturer` · `description` · `quantity` · `uom` ·
`notes` · `internalNotes` · `level` · `parent`

| option | values |
|---|---|
| **Identity layout** — where MPN, MFR and CPN live | `mpn_only` · `mpn_mfr_same` · `mpn_mfr_separate` · `mpn_cpn_same` · `mpn_cpn_separate` · `mpn_mfr_cpn_same` · `mpn_mfr_same_cpn_separate` · `mpn_cpn_same_mfr_separate` · `mfr_cpn_same_mpn_separate` · `mpn_mfr_cpn_separate` |
| **Row placement** | `same_row` · `cpn_row_mpn_mfr_below` · `mpn_row_cpn_mfr_below` · `mfr_row_cpn_mpn_below` · `cpn_mpn_row_mfr_below` · `cpn_mfr_row_mpn_below` · `mpn_mfr_row_cpn_below` · `separate_linked_rows` |
| **Structure** | `mpn_only_same_cell` · `mpn_only_rows` · `mfr_only_same_cell` · `mfr_only_rows` · `separate_cells` · `same_cell` · `one_per_row` · `grouped_rows` |
| **BOM layout** | `none` · `assembly_quantity_matrix` · `multi_block_assembly` |
| **Alternate layout** | `inside_selected_mpn_columns` · `separate_columns` · `already_separate_rows` · `same_group_rows` · `following_rows` · `following_item_rows` |
| **Quantity / UOM** | `every_row` · `inherit_primary` · `alternate_columns` |
| **Manufacturer inherit** | `inherit_blank` · `never` |
| **Group header** | `auto` · `context_only` · `header_primary` |
| **Delimiter** | `auto` · `;` · `,` · `\|` · `\n` · `custom` |
| **Cleanup toggles** | ignore category/title rows · ignore repeated header rows · ignore Do-Not-Populate rows · ignore deleted/red rows · read levels and part numbers from the parent path |

**How the default identity layout is picked** — from the inferred roles:

| roles present | layout |
|---|---|
| MPN, MFR, no CPN, different columns | `mpn_mfr_separate` |
| MPN, MFR, no CPN, same column | `mpn_mfr_same` |

**Autofill from primary** is a list of roles an alternate inherits when its own cell is blank —
the panel's default is `cpn,description,quantity,uom,parent,notes,internalNotes,level`.

**Alternate groups** start empty. One group per alternate set, each naming that alternate's CPN,
MPN, MFR, Qty and UOM columns. `detect_alternate_column_groups` exists in
`backend/excel_mapper/services/bom_structure_patterns.py`, so this may be answerable server-side —
unverified.

---

### Stage 2d — Review patterns ✅

What the **Review patterns** button calls. A second inference, *after* roles: given which column
plays which role, what shape do the values inside them take. It is what catches a cell holding
`MPN (MFR)`, or three part numbers separated by semicolons, before any of it is parsed.

```
POST /api/bom/field-patterns/infer/
```

| field | required | notes |
|---|---|---|
| `headers` | yes | source column names |
| `rows` | yes | compacted data rows, keyed by header, with `__sourceRow` |
| `roles` | yes | the role map from `bom/roles/infer/` |
| `config` | yes | the **whole** normaliser config — identity layout, row placement, alternate layout, cleanup toggles |
| `selectedColumns` | no | narrow the inference to these columns; `[]` means all mapped ones |
| `options` | no | `{headerRowIndex}` |

> Note `config` is sent in full, so the patterns depend on the Stage 2c setup answers, not only on
> the roles. Change the identity layout and the patterns change.

**A real response** — the 48V sheet, roles `mpn→MPN, manufacturer→Manufacturer,
description→Description, quantity→QTY`:

```json
{ "success": true, "source": "backend",
  "groupCount": 1, "patternCount": 0, "combinationCount": 0, "sampleRowCount": 8,
  "selectedColumns": ["MPN", "Manufacturer", "Description", "QTY"],
  "groups": [{
    "id": "pattern-1",
    "shape": "identity=mpn_mfr_separate | row=same_row | alternates=separate_columns | pattern=no_structural_delimiters",
    "rowCount": 17,
    "patternRows": [
      { "label": "MPN", "source": "MPN",          "roles": ["mpn"],
        "pattern": "<MPN>", "example": { "sourceRow": 12, "rawValue": "B1100Q-13-F" },
        "occurrences": [ { "sourceRow": 12, "rawValue": "B1100Q-13-F" }, … ] },
      { "label": "MFR", "source": "Manufacturer", "roles": ["manufacturer"],
        "pattern": "<MFR>", "example": { "sourceRow": 12, "rawValue": "DIODES INCORPORATED" } }
    ] }]
}
```

| field | what it is |
|---|---|
| `groups[].shape` | the layout this group was read under — the Stage 2c answers, echoed back |
| `groups[].patternRows[]` | one per role-in-a-column: its `pattern`, an `example`, and every `occurrence` with its sheet row |
| `pattern` | the value's shape. `<MPN>` = the cell is just the part number. Compound cells show their separators |
| `fields` | the ten role slots and which are required — only `mpn` is |
| `rowShapeGroups` | the same groups, trimmed for display |
| `reviewWorkflow` | `branch` / `cases` and `mappingUnits` — per source column, which fields it feeds, its scope (`primary` / alternate) and `relationship` (`one_to_one`, …) |
| `reviewSummary` | counts of recognised vs unrecognised patterns — what the review UI tallies |
| `blockStructure` | same as `roles/infer`, carried through |

**It resolves values per block.** In the response above, `sourceRow 12`'s MPN reads from the `MPN`
column, but `sourceRow 20`'s reads `CGA2B3X7R1H473K050BB` — which lives in the **`Manufacturer`**
column, because that block's role map is inverted. So this call already honours the mid-sheet
swap; it does not naively read the column named in the flat `roles`.

`patternCount: 0` here means nothing unusual was found — every value was a plain part number or
manufacturer name. A sheet with `MPN (MFR)` cells or delimited lists produces entries in
`reviewSummary.unrecognizedPatterns` for a human to confirm.

**Caching.** The frontend keys a cache on the payload, so reopening the panel does not re-infer;
the button passes `forceRefresh` to bypass it. An agent calling directly has no cache.

**Then:** `bom/field-patterns/teach/` and `learn/` save a corrected pattern so the same shape is
recognised next time, and `apply/` applies them. 📄 contracts not exercised.

---

### Stage 2e — Apply the patterns ✅

Confirming the review calls this — **not** `bom/normalize/`. It applies the confirmed patterns and
returns the normalised rows in one step, so for a sheet that needs pattern review this *is* the
normalisation call.

```
POST /api/bom/field-patterns/apply/
```

| field | required | notes |
|---|---|---|
| `headers`, `rows` | yes | the source again, browser-parsed |
| `roles` | yes | all ten role slots, `""` for unset |
| `config` | yes | the entire normaliser config — every Stage 2c answer, plus `fieldPatternRules` keyed by pattern |
| `headerRowIndex` | yes | **0-based** here (`5` = sheet row 6), unlike `headerRow` on upload which is 1-based |
| `fieldPatternOverrides` | yes | `{source, confirmedAt, rules, groups, rows}` — what the human confirmed |
| `groups` | yes | each `{id, shape, confirmed, rule, rows[]}`; `rows[].entries[]` hold the corrected field values per `sourceRow` |
| `persist` | no | `true` saves the rule for next time; `false` applies it this once |

A rule carries a `structureScope` (normalised headers + role column indexes), a
`structureSignature` and a `structureFingerprint` — the hashes that let the same shape be
recognised on a later upload.

**The response:**

| field | what it is |
|---|---|
| `normalizedRows` | **the output** — one record per resolved row |
| `progress` | `{processed, total, outputRows, skippedRows}` |
| `patterns` | what was recognised: `grammar`, `interpretationPattern`, `sourceColumn`, `mappedFields` |
| `patternGroups` | the groups those patterns came from, with their `shape` |
| `pairingCheck` | `{checkedRows, matchedRows, issueRows}` — rows where MPN/MFR could not be paired confidently |
| `learning` | `{success, saved_pattern_rules}` — what `persist: true` wrote |
| `savedStructure` | the learned structure, or `null` |
| `blockStructure`, `reviewWorkflow`, `warnings` | as before |

**A normalised record** — this is the contract everything downstream consumes:

```json
{ "sourceRow": 48, "parentKey": "48", "parent": "", "relation": "Primary", "level": "1",
  "cpn": "", "description": "CAP-0.068u,16V,0402,10%,X7R",
  "mpn": "…", "manufacturer": "…", "quantity": "3", "uom": "",
  "Notes": "", "Internal notes": "",
  "rule": "backend_field_pattern_normalization", "confidence": 63.5, "discardedText": "",
  "Sr.no.": "3", "Ref Designator": "C18,C63,C66", "Remarks": "" }
```

Note it keeps **both**: the resolved roles *and* every original source column, so nothing is lost.
`rule` says which path produced it and `confidence` how sure it was — both worth surfacing to a
human when low.

> **`fieldPatternOverrides.rows` is where the corrections live**, keyed by `sourceRow`, each with
> the confirmed `entries[].fields`. In a probe with that map left empty, the output followed the
> raw role mapping instead — so an agent that skips it gets the uncorrected reading.

---

### Stage 3 — Map source columns to destination ✅

```
POST /api/mapping/        {"session_id": "…"}
→ {"success":true,"ai_suggestions":{
     "Item name":{"suggested_column":"Item name","confidence":90,"is_specification_mapping":false}, …}}
```

Confidence is 0–100. Anything below ~70 is a guess worth showing a human.

```
POST /api/mapping/save/
{"session_id":"…","mappings":{"<source column>":"<destination column>", …},
 "default_values":{}, "default_value_rules":{}, "apply_now":false,
 "header_corrections":{}, "force_persist":false}
→ {"success":true,"message":"Mappings saved successfully","applied":false}
```

`"applied": false` is normal — the grid is materialised on read, not on save.

Read back with `GET /api/mapping/existing/{session_id}/`.

### Stage 4 — Clean the grid

Read it: `GET /api/data/?session_id=…&page=1&page_size=100` ✅ (also takes `entity_name`,
`force_fresh`, `stable`).

Then apply whichever tools the data needs — see §5. Every one takes `session_id` and mutates
the session grid in place.

Ask the grid what is still wrong:

```
POST /api/transforms/required-field-report/
{"session_id":"…","columns":["Item code","Item name"],"dupe_columns":["Item code"],
 "boolean_columns":[],"validators":{}}
```

### Stage 5 — Export the combined sheet ✅

```
POST /api/download/
{"session_id":"…","format":"excel","export_type":"raw",
 "column_order":[…optional…],"highlight_duplicate_columns":["Item code"]}
→ binary .xlsx
```

| `export_type` | what you get |
|---|---|
| `raw` | **the 4.0 combined sheet** — the grid whole: item columns + `Level` / `Quantity` / `BOM Qty`, plus derived `BOM code` and `Finished good code` |
| `item` | the 3.0 item directory — BOM columns stripped, items deduped, authored finished good appended |

`raw` additionally, on the way out:

- derives **`BOM code`** and **`Finished good code`** per row from the BOM tree
- sets the finished good's row to **`Level 0`**, which is what makes FactWise read it as the
  BOM's header rather than a line inside its own BOM
- renames a legacy `Base BOM Qty` column to **`BOM Qty`** (the name 4.0 matches)
- folds `SAP Description` into `Description` and drops it (4.0 has no SAP field, and the name
  fuzzy-matches `description`, colliding with the real column)

The BOM-only sheet, if wanted separately: `GET /api/bom/download/{sid}/` — tab `BOM Data`,
headers on **row 4** (FactWise's revision importer parses `HEADER_ROW=4`).

### Stage 6 — Let FactWise judge it ✅

```
POST /api/factwise40/validate/     multipart
  file=<the .xlsx from stage 5>
  api_url=http://localhost:8001
  enterprise_id=…
  token=…
  import_type=item          # item | bom | bom_revision
  action=validate           # validate | commit
```

```json
{"success":true,"result":{"ok":true,"row_count":3,"error_count":0,"errors":[]}}
```

Each error: `{"row":10,"column":"Item Code","field_code":"item_code","code":"REQUIRED",
"message":"'Item Code' is required"}`. `row` is 1-based over data rows.

**`import_type=item` is correct for the combined sheet** — that importer reads the BOM columns
too, which is where BOM errors surface.

### Stage 7 — Commit ✅

Same endpoint with `action=commit`. 4.0 re-validates internally and refuses a dirty sheet.

```json
{"success":true,
 "result":{"committed":true,"created":57,"updated":2,"skipped_existing":0,
           "skipped_duplicate":0,"errors":[],"profile":{…}},
 "bom_codes":["HL-FG"]}
```

> **Commit returns counts, never ids.** `bom_codes` is added by the mapper — it re-reads the
> `BOM code` column out of the sheet you just sent, because that is the only way to find the
> BOM afterwards.

### Stage 8 — Project and attach ✅

```
POST /api/factwise40/call/
{"op":"…","api_url":"…","enterprise_id":"…","token":"…",
 "project_id":"…",        # only for project_add_bom
 "body":{…},              # POST ops
 "params":{…}}            # GET ops
```

| `op` | 4.0 route | use |
|---|---|---|
| `entities` | `GET /enterprises/{eid}/entities` | the real entity a project is filed under |
| `projects_list` | `GET /enterprises/{eid}/projects` | `{items,total,limit,offset,summaries}` |
| `project_create` | `POST /enterprises/{eid}/projects` | body `{entity_id, project_name}` |
| `boms_list` | `GET /enterprises/{eid}/boms` | find the committed BOM by `bom_code` |
| `project_add_bom` | `POST /enterprises/{eid}/projects/{pid}/boms` | body `{enterprise_bom_id}` |

Ops are named, never URLs — the relay refuses anything off this list.

Finding the BOM: match `bom_code` against the `bom_codes` commit returned, taking the highest
`version` per code (a re-import of an existing code makes a new version).

---

## 4. Where a human has to decide

An agent can do everything else alone. These it cannot invent:

| decision | when | what breaks if guessed |
|---|---|---|
| **Which sheet holds the BOM, and is it tree-shaped** | before upload | generation refuses: `needs: bom_sheet` / `needs: tree_confirmation` |
| **The finished good** — code, name, UoM, base qty | before upload | `needs: bom_header`; nothing to hang the tree on |
| **Levels: which column, or a parent path** | before upload | rows nest wrongly or flatten |
| **Role assignments the inference is unsure of** | stage 2b | `warnings: low_confidence_role`; MPN and CPN swap, or a Ref Designator becomes a part number |
| **The setup options** (identity layout, row placement, alternates) | stage 2c | the parser pairs the wrong values, or splits one part into several |
| **The detected header row, if it looks wrong** | stage 1 | every column is named `Column N` and nothing maps |
| **Ambiguous column mappings** (confidence < ~70) | stage 3 | data lands in the wrong field |
| **Duplicate policy** | when the same part appears more than once | quantities silently merge or split — `bom/duplicate-policy/{sid}/` |
| **Blank / duplicate item codes** | stage 4 | FactWise rejects the rows |
| **Conflicting rows sharing one item code** | stage 4 | `DUPLICATE_ITEM_CONFLICT` — only a human knows which description is right |
| **New project vs existing vs none** | stage 8 | — |

---

## 5. Editor tools — what each one is for

All `POST /api/transforms/…`, all take `session_id`. 📄 contracts read from the views.

| endpoint | what it does | reach for it when |
|---|---|---|
| `fill-or-create-column/` | fill a destination column, or create a reusable one, from a rule | the general-purpose filler; conditional rules live here |
| `set-column-default/` | fixed value into a column | `only_empty: true` to fill gaps without touching real data |
| `copy-column/` | copy one column into another | `only_empty` respected |
| `fill-missing-values/` | analyse a column, or fill chosen empty/specific cells | you want to see the gaps before filling them |
| `fill-required-defaults/` | blanket-fill blanks across named columns | clearing a required-field report in one call |
| `required-field-report/` | count blanks / dupes / invalids over the whole grid | before export, to know what's missing |
| `resolve-item-code/` | fix blank and duplicate item codes (prefix/serial/padding) | `Item code` is required and unique in FactWise |
| `create-factwise-id/` | build an item code by joining two columns | no usable code in the source — e.g. `MPN_Manufacturer` |
| `split-into-columns/` | one column → a numbered run of columns | packed cells like `a/b/c` |
| `split-into-rows/` | one column → several rows | one row carrying several parts |
| `expand-column-groups/` | repeated column groups → rows | spec/tag groups side by side |
| `expand-alternate-columns/` | side-by-side alternates → rows | alternate parts in extra columns |
| `stack-alternates/` | two sources mapped to one destination → stacked rows | the mapping itself implies alternates |
| `carry-forward-group/` | header row + its children → item rows | sub-assembly headers with rows beneath |
| `delete-rows/` | delete by condition on a column | junk rows, leaked header rows |
| `cleanup-grid-rows/` | drop rows whose key column is empty | quick tidy before export |
| `column-source-map/{sid}/` (GET) | which source fed each destination | explaining a value's provenance |
| `source-columns-preview/{sid}/` (GET) | raw source columns + a sample value | choosing a source for a rule |

Most take `preview: true` and `preview_rows` — **use it before mutating**.

BOM-specific: `bom/roles/infer/`, `bom/normalize/`, `bom/field-patterns/{infer,teach,learn,apply}/`,
`bom/structures/{,match,profile}`, `bom/tree/{sid}/`, `bom/generate/{sid}/`,
`bom/validate/{sid}/`, `bom/duplicate-policy/{sid}/`.

---

## 6. Errors, and what they actually mean

**Mapper — BOM generation** (`bom/generate`, `bom/validate`, or the derivation inside a `raw` export):

| message | `needs` | cause |
|---|---|---|
| `No sheet in this upload was marked as containing a BOM.` | `bom_sheet` | `bomStructure` absent or malformed |
| `No finished good has been defined for this upload…` | `bom_header` | `bomHeader` missing |
| `This sheet was marked as not matching the BOM tree structure…` | `tree_confirmation` | `bomGenerationAvailable: false` |
| `The editor has N rows but the uploaded sheet has M…` | `rows_added` | rows added in the editor have no place in the structure |
| `…could not be matched to the sheet unambiguously.` | `row_count_mismatch` | a key column was edited on a row that was also deleted |

Generation failing does **not** fail the export — the sheet still downloads, just without BOM
identity, and FactWise then rejects every row carrying a BOM field. The backend logs
`combined export has no BOM identity` when this happens.

**FactWise validate / commit:**

| code | meaning | fix |
|---|---|---|
| `REQUIRED` | a required field is blank | `fill-required-defaults/`, `resolve-item-code/` |
| `BOM code is required when BOM fields are populated` | the row has `Level`/`Quantity` but no BOM code | the BOM gate was not answered, so identity was never derived |
| `INVALID_ITEM` | a reference does not resolve — e.g. `procurement entity 'X' is not found` | use a name from `GET /entities` |
| `DUPLICATE_ITEM_CONFLICT` | same item code, disagreeing fields | a human picks the right values |
| `NOT_A_NUMBER` / `BAD_QUANTITY` | quantity non-numeric, or ≤ 0 | `delete-rows/` or fill |
| `BAD_LEVEL` | level missing or not a positive integer | the finished good's row must be `Level 0` |
| `DUPLICATE_COLUMN_MAPPING` | two columns claim one field | handled for `SAP Description`; others need renaming |
| `MISSING_COLUMN`, `EMPTY_FILE` | header unrecognised / no data rows | |

**Relay-level:** `400` with 4.0's own message passed through, `502` `Could not reach FactWise`.

**Project creation, `422`:**

```
a project must be created from a published template version
```

The enterprise has no PROJECT template it *owns*. The SYSTEM template doesn't satisfy the
fallback, and no API route exposes a `template_version_id` to name one explicitly. Until the
enterprise is provisioned, use an existing project or skip the project entirely.

---

## 7. A complete run, as it actually went

Source: 3 rows, no BOM identity columns — `HL-FG` (the assembly) and two parts.

```
1. POST /api/upload/                 → session b5a2c649-3ca4-4129-9675-1cdc2d613c5b
   (bomStructure named HL-FG as the finished good, Level as the level column)

2. POST /api/mapping/save/           → success, applied:false
   Item code · Item name · Item type · Measurement unit ·
   Procurement entity name · Level · Quantity

3. POST /api/download/ raw           → 41 columns, 3 rows
   Item code  Level  Quantity  BOM code  Finished good code
   HL-FG      0      —         HL-FG     HL-FG      ← header row, Level 0
   HL-R1      1      4.0       HL-FG     HL-FG
   HL-R2      1      5.0       HL-FG     HL-FG

4. POST /api/factwise40/validate/    → ok: true, 3 rows, 0 errors

5. …/validate/ action=commit         → committed: true, bom_codes: ["HL-FG"]

6. op=boms_list                      → HL-FG v1  69190e63-7dfb-42d9-babe-f84e13d2d307

7. op=project_add_bom                → project_bom_id 9b6b716a-a4de-44a7-b235-b171144c95f3
```

Runnable as `headless_flow.sh`. Nothing in this sequence touches the frontend.

---

## 8. Known gaps

- **`bom/roles/infer/` takes rows, not a session.** The browser parses the workbook and posts
  the rows in; an agent has to do the same. The inference is server-side and works over plain
  HTTP — only its input is missing. Fix: accept `session_id` and build the rows from the
  stored file, keeping the body form for the frontend.
- **`bom/field-patterns/infer/` takes rows too.** Same shape of gap as `roles/infer`, and it
  additionally needs the roles and the full config passed back in, so an agent must carry that
  state itself.
- **The setup options exist only in the frontend.** The vocabulary is in
  `bomNormalizerAlgorithmRegistry.js` and the `identityLayout` default is derived in
  `BomNormalizer.js`, so no endpoint reports them. Stage 2c reproduces them, but a doc and a
  registry will drift — infer should return the resolved setup.
- **Header detection now exists on both sides.** `services/sheet_reader.py` is a port of the
  browser's scorer and upload returns `detected_header_row`. Verified to agree on
  `48V_V2_BOM.xlsx` (row 6). Two implementations of one answer will drift unless the frontend
  is switched to call the endpoint.
- **New-project creation is blocked** on an unprovisioned enterprise (§6). Existing projects
  and "no project" work.
- **Commit is not transactional with the project step.** Items and the BOM are created first;
  if the project step then fails, they already exist. Re-running is safe (`created: 0,
  skipped_existing: N`) but the sheet has landed.
- **Flat sheets**: the authored finished good is appended only to the `item` export, not to
  `raw`. A flat sheet's combined export therefore has no row for the finished good, so
  FactWise never creates that item.
- **`_merge_grid_values_into_records`** numbers rows against the post-filter grid. Exercised
  only where the finished good is the last row; a mid-sheet finished good on that path has not
  been tested.
- **3.0-era calls are dead against 4.0** and are not part of this flow: distributor
  credentials (`/organization/entity/{id}/integrations/distributors/reveal/`) and the old
  bulk-import hand-off (`/organization/bulk_import/url/generate/`).
- **The Item+BOM agent in 4.0** (`/agent-assist/item-bom/runs`) is mounted in code but 404s on
  the running server — the process predates the mount and runs without `--reload`.
