# The Normaliser without a browser — eight calls, run for real

`48V_V2_BOM.xlsx` → the editor, by curl alone. Every response below is from an actual run, not
an example. Nothing was parsed client-side; **no request carries rows**.

The file is a good test because it fights back: its table starts on row 6, it has three sections
separated by repeated header rows, the MPN and Manufacturer columns **swap over** after each one,
and it carries banners, subtotals and a grand total that are not parts.

```
1 upload  →  2 roles  →  3 questions  →  4 answers  →  5 apply  →  6 continue
                                          →  7 save mappings  →  8 apply defaults  →  editor
```

Steps 7 and 8 are easy to miss and both are required. Continue creates a session; it does not
make it openable. Without mappings the editor answers **400 — "No mappings found"**.

Set these once:

```bash
API=http://localhost:3002/api
SHEET="C:/Users/yashn/Downloads/48V_V2_BOM.xlsx"
```

---

## 1 — Upload

No `headerRow`. The server works it out.

```bash
curl -s -X POST "$API/upload/" -F "clientFile=@$SHEET"
```

```json
{ "session_id": "df70722a-2276-46be-aea9-f8aef5ba13bf",
  "sheets": ["48V_V2 "], "sheet_name": "48V_V2 ",
  "header_row": 6, "detected_header_row": 6, "total_rows": 126,
  "headers": ["Sr.no.","Description","MPN","Manufacturer","QTY","Ref Designator","Remarks"] }
```

**What happened.** It found the table on row 6 and read the seven real column names. Sending
`headerRow=1` instead would have given `Column 2 … Column 8` and nothing would map. `header_row`
is what was used; `detected_header_row` is what the file suggests — when they differ, the caller
overrode the suggestion.

```bash
SID=df70722a-2276-46be-aea9-f8aef5ba13bf
```

---

## 2 — Roles

```bash
curl -s -X POST "$API/bom/roles/infer/" -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SID\"}"
```

```json
{ "roles": { "mpn": "MPN", "manufacturer": "Manufacturer",
             "description": "Description", "quantity": "QTY" },
  "blockStructure": {
    "blockCount": 3,
    "repeatedHeaderRows": [19, 45],
    "sectionTitleRows": [18, 44, 126],
    "roleMaps": [
      { "sourceRow": 1,  "roles": { "mpn": "MPN",          "manufacturer": "Manufacturer" } },
      { "sourceRow": 19, "roles": { "mpn": "Manufacturer", "manufacturer": "MPN" } },
      { "sourceRow": 45, "roles": { "mpn": "Manufacturer", "manufacturer": "MPN" } }
    ] } }
```

**What happened.** The body held only a session id — the server opened the file itself.

It split the sheet into **three blocks** at the repeated headers and gave each its own role map.
Blocks two and three are **inverted**: from row 19 down, the column labelled `MPN` actually holds
manufacturer names. `roles` is only the whole-sheet summary — **read `roleMaps` whenever
`blockCount > 1`**, or half the sheet is read backwards.

---

## 3 — What still needs answering

```bash
curl -s "$API/normaliser/$SID/state/"
```

```
role.cpn            answer=None          Ref Designator(0.57), Manufacturer(0.56)
role.description    answer=Description   Ref Designator(0.64), Sr.no.(0.45)
role.level          answer=None          QTY(0.48)
role.parent         answer=None          Manufacturer(0.54)
role.uom            answer=None
gate.bomStructure   answer=None
```

**What happened.** Each question carries its options with scores, confidence and the reasons the
inference gave. A role with **no answer but real candidates** — `cpn` here — is exactly the case a
human has to settle. `description` has an answer *and* alternatives, so it is worth confirming but
not blocking.

`gate.bomStructure` is the one thing no inference can supply: which sheet holds the BOM, whether it
has levels, and what the finished good is.

---

## 4 — Answer them

```bash
curl -s -X POST "$API/normaliser/$SID/answers/" -H 'Content-Type: application/json' -d '{
  "config": { "identityLayout": "mpn_mfr_separate", "rowPlacement": "same_row",
              "alternateLayout": "separate_columns",
              "skipTitleRows": true, "skipRepeatedHeaders": true },
  "bomStructure": { "mode": "create", "sheets": { "48V_V2 ": {
      "hasBom": true, "hasLevels": false, "levelColumn": null,
      "treeConfirmed": true, "bomGenerationAvailable": true, "dropDocuments": true,
      "bomHeader": { "finishedGoodCode": "48V-V2", "bomCode": "48V-V2",
                     "itemName": "48V V2 assembly", "bomName": "48V-V2",
                     "measurementUnit": "EA", "baseQuantity": 1 },
      "subBoms": {} } } }
}'
```

### What the agent actually has to ask

Everything else on this page can be inferred or defaulted. These cannot.

**1. Is this a simple flat sheet?** One yes/no.

> *"Does this sheet have BOM levels — parts inside sub-assemblies — or is every row a
> component of one thing?"*

`hasLevels: false` for a flat sheet, which is most of them. If yes, also ask which column holds
the level, and pass it as `levelColumn`.

**2. The BOM itself.** Five fields, and only the first is really required:

| ask | what it is | if not given |
|---|---|---|
| **BOM code** | the identifier for this BOM | *required* |
| **BOM name** | what to call it | the BOM code |
| **Finished good code** | the item this BOM builds | the BOM code |
| **Item name** | that item's name | the BOM code |
| **Measurement unit** | how it is counted | `EA` |
| **Base quantity** | how many the BOM makes | `1` |

So the shortest possible answer is one field:

```json
{ "bomStructure": { "sheets": { "48V_V2 ": {
      "hasLevels": false,
      "bomHeader": { "bomCode": "48V-V2" } } } } }
```

and the server fills the rest:

```json
{ "mode": "create",
  "sheets": { "48V_V2 ": {
      "hasBom": true, "hasLevels": false, "treeConfirmed": true,
      "bomGenerationAvailable": true, "dropDocuments": true, "subBoms": {},
      "bomHeader": { "bomCode": "48V-V2", "bomName": "48V-V2",
                     "finishedGoodCode": "48V-V2", "itemName": "48V-V2",
                     "measurementUnit": "EA", "baseQuantity": 1 } } } }
```

A BOM's name and the code of the item it builds are the same string far more often than not, so
asking for all three is asking the same question three times. Anything supplied explicitly is left
exactly as given — this only fills blanks.

**Do not ask whether to create or revise.** This flow always creates: `mode` is set to `create`
and never needs to appear in the request. Revising an existing BOM is a different flow with
different inputs.

**Ask once per BOM.** A flat sheet has one, so these six fields are the whole conversation. A
sheet with sub-assemblies has one per sub-BOM, under `subBoms`.

**The sheet key must match exactly** — `"48V_V2 "` here, trailing space included. Take it from
`sheets[0]` in the upload response rather than retyping it.

### What the agent does *not* ask

- **The roles.** Call 2 decided them. Only put a role in `answers` when a human overrides one.
- **The layout options.** `mpn_mfr_separate`, `same_row` and the rest have sensible values that
  follow from the roles. Send them if you know better; otherwise leave `config` out.
- **Which rows to skip.** `skipTitleRows` and `skipRepeatedHeaders` default to true, and call 2
  already found them — rows 16-19, 42-45, 124-126 on this sheet.

---

**What happened.** Saved on the session, not held in memory. `GET .../state/` returns them
afterwards, which is what makes the flow resumable — and what lets a second caller pick it up.


---

## 5 — Apply: normalise the rows

```bash
curl -s -X POST "$API/bom/field-patterns/apply/" -H 'Content-Type: application/json' -d "{
  \"session_id\": \"$SID\",
  \"roles\": {\"cpn\":\"\",\"mpn\":\"MPN\",\"manufacturer\":\"Manufacturer\",
             \"description\":\"Description\",\"quantity\":\"QTY\",\"uom\":\"\",
             \"notes\":\"\",\"internalNotes\":\"\",\"level\":\"\",\"parent\":\"\"},
  \"config\": {\"structure\":\"separate_cells\",\"rowPlacement\":\"same_row\",
              \"bomLayout\":\"none\",\"alternateLayout\":\"separate_columns\",
              \"delimiterMode\":\"auto\",\"groupHeaderMode\":\"auto\",
              \"manufacturerMode\":\"inherit_blank\",\"quantityMode\":\"inherit_primary\",
              \"skipTitleRows\":true,\"skipRepeatedHeaders\":true,\"skipDeletedRows\":true,
              \"parentPathLevels\":true,\"inheritLevels\":true,
              \"alternateColumnGroups\":[],\"patternParserOverrides\":[],
              \"fieldPatternRules\":{}},
  \"headerRowIndex\": 5, \"groups\": [], \"persist\": false
}"
```

> `headerRowIndex` is **0-based** here (`5` = sheet row 6), while `headerRow` on upload is
> **1-based**. An easy off-by-one.

```
processed 120 of 120 | output 109 | skipped 11
```

| row | description | mpn | manufacturer |
|---|---|---|---|
| 7 | CAP-4.7uF,100V,1210,10%,X7R | `12101C475K4T2A` | KYOCERA AVX |
| 20 | CAP-47nF,0402, 50V, X7R, 10% | `CGA2B3X7R1H473K050BB` | TDK |
| 46 | CAP-1000p,100V,0603,10%,X7R | `CGA3E2X7R2A102K080AA` | TDK |
| 48 | CAP-0.068u,16V,0402,10%,X7R | `GCM155R71C683KA55#` | Murata |

**What happened — and this is the part worth checking.** Rows 20 and 46 sit in the inverted
blocks: in the raw sheet their `MPN` cell says `TDK` and the part number is in `Manufacturer`.
They came out **the right way round**, because apply follows the per-block role maps rather than
the flat `roles`.

The 11 skipped rows are the ones that are not parts:

```
16,17  subtotals and a blank     42,43  the same again
18,44  "Added Componants" / "Existing Componants" banners
19,45  repeated header rows      124,125,126  blank, blank, "Total Count = 238"
```

`persist: false` keeps this run from writing a learned rule. Use `true` once the result is right.

---

## 6 — Continue: build the mapping sheet

```bash
curl -s -X POST "$API/normaliser/$SID/continue/" -H 'Content-Type: application/json' -d '{}'
```

```json
{ "success": true, "row_count": 109,
  "session_id": "bfd53d33-4d8a-4fac-b29c-d5337f533b98",
  "mapping_url": "/mapping/bfd53d33-4d8a-4fac-b29c-d5337f533b98",
  "editor_url":  "/editor/bfd53d33-4d8a-4fac-b29c-d5337f533b98" }
```

**What happened.** The server built the merged sheet from the rows it already had and created the
mapping session, carrying the BOM structure answers across.

This is the step the page does by **generating an xlsx in JavaScript and re-uploading it** — which
is why nothing the normaliser decided ever reached the server until the very end. Now it never
leaves.

Note there are two sessions: the raw upload (`df70722a…`) and the normalised one (`bfd53d33…`).
The editor works on the second.

---

## 7 — Save the mappings

Continue made a session, but the editor cannot show anything until the columns are connected. In
the UI this is the mapping page; by API it is one call.

```bash
curl -s -X POST "$API/mapping/save/" -H 'Content-Type: application/json' -d '{
  "session_id": "<the NEW session from step 6>",
  "mappings": {
    "Item name":        "description",
    "MPN Code":         "mpn",
    "CPN Code":         "cpn",
    "Quantity":         "quantity",
    "Level":            "level",
    "Measurement unit": "uom",
    "Item code":        "Item code",
    "Notes":            "Notes",
    "Internal notes":   "Internal notes",
    "Tag (1)":          "manufacturer"
  }}'
```

Read it as **template column ← our column**. The left side must be a real template header — get
them from `GET /api/headers/{session_id}/`.

> **Mappings apply once.** They are materialised the first time the session's data is read.
> Saving different mappings afterwards returns `success: true` but changes nothing — the response's
> `applied: false` is not the signal, it says that either way. If you get the mapping wrong, run
> Continue again for a fresh session and map that one.

Manufacturer goes to `Tag (1)`: the template has no manufacturer column, so it rides as a tag —
the same slot the saved item-code rule joins from.

---

## 8 — Apply the saved defaults

The Settings panel holds three separate things: typed defaults, how the item code is built, and
which saved column rules are pinned. One call runs all of them, in the order the panel does.

```bash
curl -s -X POST "$API/editor-defaults/apply/" -H 'Content-Type: application/json' \
  -d '{"session_id":"<new session>","entity_name":"fat"}'
```

```json
{ "entity": "fat",
  "applied": {
    "defaults": { "Item type": "Raw material", "Measurement unit": "EA",
                  "Procurement item": "TRUE", "Sales item": "FALSE",
                  "Procurement entity name": "fat" },
    "item_code": { "first": "MPN Code", "second": "Tag (1)", "separator": "_" },
    "column_rules": [ { "rule": "tag rule 1", "column": "Tag (2)", "changed": 109 },
                      { "rule": "push",       "column": "Tag (4)", "changed": 0 } ],
    "skipped": [] } }
```

Giving, in the grid:

```
Item code                    Item type      UoM
12101C475K4T2A_KYOCERA AVX   Raw material   EA
C0603C104K1RACAUTO_KEMET     Raw material   EA
```

**Order matters.** Defaults first, then the item code — which reads `Tag (1)`, a column the
mapping in step 7 filled — then the pinned rules. Run it before the defaults are in place and the
item code comes out half-empty.

`entity_name` (or `entity_id`) says whose defaults to use; without it the session's own entity is
used. Typed defaults are written **into blank cells only** — a default is what a row gets when it
says nothing, never a correction of what it already says.

A rule reporting `changed: 0` is not a failure. `push` fires on `Item code contains "pu…"`, and
nothing in this sheet matches.

### Three things this needed fixing to work

- **`Tag_1` vs `Tag (1)`.** Settings stores the internal name, the grid uses the label, and
  everything was skipped with *"no Tag_2 column"*. Both spellings are now indexed, via the
  existing `internal_name_for_slot_label`.
- **The rule payload is nested.** `fill-or-create-column` wants `{session_id, rule: {…}}`, not the
  rule's fields spread at the top level, or it answers `rule required`.
- **Only the `concat` item-code rule is applied.** Serial, copy and conditional each carry their
  own inputs; guessing at them would write item codes nobody asked for. Anything else is reported
  in `skipped`.

---

## Checking the result

```bash
curl -s "$API/bom/validate/{session_id}/"
```

The mapper's own checks — this is what the duplicate banner and the *"One item code, two different
parts"* dialog read. On this sheet:

```
3 item code(s) are shared by rows that describe different parts…
  12101C475K4T2A_KYOCERA AVX — 3 rows
     differs on Item name: ['CAP-4.7uF,100V,1210,10%,X7R', 'CAP-4.7u,100V,1210,10%,X7R']
```

Shape is `errors[].conflicts[]`, each `{code, rows, fields: [{column, values}]}`.

Alongside those, six more errors of a different kind — the same part on more than one BOM line
(*"lists X twice (rows 1 and 2)"*). That is a duplicate-**policy** question, answered at
`bom/duplicate-policy/{sid}/`, not a conflicting-data one.

> This is **not** FactWise's validation. `factwise40/validate` is the only authority on whether an
> import will be accepted; this one powers the in-editor banners.

---

## Then the second half

From here the flow already ran headlessly (see `BOM_NORMALISER_AGENT_API.md`, stages 3–8):

```
mapping/save  →  download (export_type: raw)  →  factwise40/validate
              →  factwise40/validate?action=commit  →  boms_list  →  project_add_bom
```

---

## The endpoints this added

| | |
|---|---|
| `POST /api/bom/roles/infer/` | now accepts `session_id` instead of `headers`+`rows` |
| `POST /api/bom/field-patterns/infer/` | same |
| `POST /api/bom/field-patterns/apply/` | same, and stores its `normalizedRows` on the session |
| `GET  /api/normaliser/{id}/state/` | what is decided, and what still needs answering |
| `POST /api/normaliser/{id}/answers/` | save roles / config / the BOM gate |
| `POST /api/normaliser/{id}/continue/` | build the mapping sheet server-side, return the new session |
| `POST /api/editor-defaults/apply/` | the Settings panel, applied in one call |

## What is still browser-only

- **The setup options.** `identityLayout`, row placement, alternates — the vocabulary lives in
  `frontend/src/lib/bomNormalizerAlgorithmRegistry.js` and no endpoint reports it. The values are
  transcribed in `BOM_NORMALISER_AGENT_API.md` §2c, which will drift from the registry.
- **`bom/normalize/` and `bom/directory/confirm/`** accept `session_id` for their rows but do not
  store what they produce, so only the `apply` route feeds Continue.
- **`structures/match`** — not exercised headlessly.

## Two conventions that bite

| | |
|---|---|
| `headerRow` (upload) | **1-based** |
| `headerRowIndex` (apply) | **0-based** |

And `roles` vs `blockStructure.roleMaps`: the first is a summary, the second is the truth.
