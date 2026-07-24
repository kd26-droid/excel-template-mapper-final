# Item Master Scrubber Route

## Product Goal

Build a procurement item-directory / item-master scrubber.

Users will upload messy customer item sheets or PDFs. The app should understand those source files, clean and normalize the item data, and map it into the procurement app's accepted import template.

## Destination Template

File: `SFO_Technologies/Default Item.xlsx`

This is the final import format accepted by the procurement management app.

- Sheet: `Sheet1`
- Header row: `4`
- Columns: `30`
- Rows `1-2` contain import guidance, required/optional rules, max lengths, and allowed values.
- Row `4` contains the actual import headers.

## Core Rule

Every customer sheet/PDF is a source format. `Default Item.xlsx` is the destination format. The app's job is to transform each source into this destination template without changing the destination schema.

## Destination Context Strategy

The app should understand the destination/import sheet, but it must not hardcode one universal FactWise schema.

FactWise enterprises can add their own custom item fields. When an enterprise generates an import sheet, the sheet can include both default FactWise fields and enterprise-specific custom fields. The scrubber must therefore treat the uploaded destination sheet as the source of truth for that import run.

Recommended model:

- Build an import profile from the uploaded destination sheet.
- The import profile should combine:
  - known FactWise default fields,
  - repeated FactWise structures,
  - required/optional rules found in the template guidance rows,
  - enterprise-specific custom columns that the app may not semantically understand.
- Known fields can receive smart behavior.
- Unknown/custom fields should remain mappable, defaultable, or reviewable without forcing interpretation.

Known FactWise behavior the app can understand:

- `Measurement unit` is required.
- `Item type` has allowed values such as `Raw material` and `Finished good`.
- `Tag` can repeat as multiple tag columns if the import template supports it.
- `Specification name/value/UOM` appears as repeated groups.
- `Preferred vendor code` and alternate vendor item names can repeat.
- `Alternate UoM` can repeat if the import template supports additional alternate UOM columns.

Unknown/custom enterprise fields:

- If a destination column is not recognized as a known FactWise field or repeated structure, treat it as a custom field.
- The app should not guess its meaning unless the user maps it, sets a default value, or provides saved enterprise-specific rules.
- Custom fields should appear clearly in the mapping/review UI as `custom/unknown destination fields`.

Upload-time destination question:

When a user uploads a source file and destination template, the app should ask whether the output is intended for FactWise import.

If yes:

- load the FactWise import profile behavior,
- inspect the uploaded destination sheet,
- detect required missing fields,
- detect repeated structures,
- provide focused prompts such as:

```text
Your source does not contain Measurement unit.
Do you want to add Measurement unit?
Options:
- Use fixed value for all rows
- Suggest from MPN validation
- Use source packaging as alternate UOM
- Leave blank for review
```

If no:

- use generic spreadsheet mapping behavior without FactWise-specific assumptions.

Long-term goal:

- Save import profiles per enterprise/template.
- Reuse previous mappings, default choices, custom field handling, and repeated-field behavior for future uploads from the same customer or enterprise.

## Important Destination Fields

- `Item code`: unique item identifier; required by the import template.
- `SAP Item ID`: customer's ERP/SAP item id.
- `CPN Code`: customer's internal part number.
- `MPN Code`: official manufacturer part number.
- `Item name`: required item name visible to vendors.
- `Description`: vendor-visible item description.
- `Item type`: required; allowed values include `Raw material` and `Finished good`.
- `Measurement unit`: required unit used in events and purchase orders.
- `Specification name/value/UOM`: repeated columns for item specs.
- `Procurement entity name`: required entity that procures the item.
- `Preferred vendor code`: optional preferred vendor code.

## Current Understanding

The system should not just "map columns"; it should act like a scrubber:

- detect what each customer column actually means,
- clean messy values,
- validate or enrich important fields where possible,
- preserve the destination template rules,
- produce an Excel file that can be imported directly into the procurement app.

## Source Case 1: BOM 4.pdf

File: `SFO_Technologies/BOM 4.pdf`

Source shape:

- One-page PDF BOM.
- Extracts as a structured table.
- Source headers: `Description`, `Designator`, `Quantity`, `Manufacturer`, `Manufacturer PartNo`, `Manufacturer PartNo S S`, `Manufacturer S S`.
- Expected data rows: `43`.

Product expectation:

- Treat each BOM line as one item-master row.
- Use `Manufacturer PartNo` as the manufacturer part number / MPN.
- Use `Manufacturer` as the manufacturer name.
- Use `Description` as the item description and likely default item name.
- Use `Designator` as reference designator metadata, not as the main item identifier.
- Use `Quantity` as BOM quantity metadata, not as procurement price or measurement unit.
- Leave source-only empty columns such as `Manufacturer PartNo S S` and `Manufacturer S S` unmapped unless later business meaning is defined.

Transformation rule 1: same-row alternate manufacturer parts

Problem:

- BOM 4 is mostly a clean row-by-row table, but some source rows contain both a primary manufacturer/MPN pair and an alternate manufacturer/MPN pair on the same row.
- The alternate pair should not be lost and should not be squeezed into the same destination row.
- Each usable manufacturer/MPN pair should become its own destination item row.

Source fields for this rule:

- Shared item context fields: `Description`, `Designator`, `Quantity`
- Primary manufacturer pair: `Manufacturer`, `Manufacturer PartNo`
- Alternate manufacturer pair: `Manufacturer S S`, `Manufacturer PartNo S S`

Primary row detection:

- A source row is a primary item row when:
  - `Description` is present,
  - `Manufacturer` is present,
  - `Manufacturer PartNo` is present.
- The primary row should emit one destination row using the primary manufacturer pair.

Alternate pair detection:

- An alternate pair exists when both of these fields are present on the same source row:
  - `Manufacturer S S`
  - `Manufacturer PartNo S S`
- If both fields are present, emit one additional destination row for that alternate pair.
- If only one field in the alternate pair is present, mark the row for review instead of silently emitting a bad alternate.

Carry/copy behavior:

- Copy shared item context from the original source row into both the primary destination row and alternate destination rows.
- Shared copied fields include `Description`, `Designator`, and `Quantity`.
- For the primary destination row, use `Manufacturer` and `Manufacturer PartNo`.
- For the alternate destination row, use `Manufacturer S S` and `Manufacturer PartNo S S`.

Destination emit/skip behavior:

- Emit the primary row when the primary manufacturer pair is usable.
- Emit one additional row for each usable alternate manufacturer pair.
- If the alternate pair is empty, emit only the primary row.
- If the primary pair is missing but the alternate pair exists, mark for review because the row shape is unusual.
- Do not map empty alternate columns into the destination.

Destination mapping for emitted rows:

- Destination `MPN Code` should come from the active row's MPN source:
  - primary row: `Manufacturer PartNo`
  - alternate row: `Manufacturer PartNo S S`
- Destination `Preferred vendor code` should come from the active row's manufacturer source:
  - primary row: `Manufacturer`
  - alternate row: `Manufacturer S S`
- Destination `Description` should come from `Description`.
- `Designator` and `Quantity` remain metadata for now unless later mapped into notes/specs.

Worked example:

Source row:

```text
Description=100 OHM 0.063W 1% 0402 (1005 Metric) SMD
Designator=R3
Quantity=1
Manufacturer=Yageo
Manufacturer PartNo=RC0402FR-07100RL
Manufacturer PartNo S S=CRCW0402100RFKED
Manufacturer S S=VISHAY
```

Expected destination rows:

```text
Description=100 OHM 0.063W 1% 0402 (1005 Metric) SMD | MPN Code=RC0402FR-07100RL | Preferred vendor code=Yageo
Description=100 OHM 0.063W 1% 0402 (1005 Metric) SMD | MPN Code=CRCW0402100RFKED | Preferred vendor code=VISHAY
```

Generalization requirement:

- This should be implemented as a configurable "same-row alternate pairs" transform.
- The configuration should define:
  - shared context fields,
  - primary manufacturer/MPN pair,
  - one or more alternate manufacturer/MPN pairs,
  - emit criteria,
  - review/error criteria.
- It must not be hardcoded to BOM 4, these exact manufacturers, or this exact customer.

Transformation rule 1B: split designators into repeated tag columns

Problem:

- BOM 4 stores multiple reference designators in one comma-separated source cell.
- Example: `C3, C4, C5, C12, C13, C15, C17, C18, C20, C21, C22, C24, C25`.
- In the destination item-master output, each reference designator should be stored as a separate tag value, not as one long comma-separated tag.

Source field for this rule:

- `Designator`

Parse behavior:

- Split `Designator` by comma.
- Trim whitespace around each value.
- Drop empty values.
- Preserve the original order from the source cell.
- Do not split inside any future escaped/quoted value if the app later supports quoted delimiters.

Destination mapping expectation:

- Map each parsed designator value into repeated destination `Tag` columns.
- Example:

```text
Designator=R2, R13, R20
```

Expected destination tag columns:

```text
Tag=R2 | Tag 2=R13 | Tag 3=R20
```

Interaction with alternate manufacturer row expansion:

- Apply this split after shared row context is copied.
- If a BOM 4 source row emits both a primary MPN row and an alternate MPN row, both emitted rows should receive the same parsed designator tags.
- The manufacturer/MPN values change between emitted rows, but the reference designator tags remain the same because they describe the same source BOM positions.

Destination schema behavior:

- The uploaded `Default Item.xlsx` currently exposes one visible `Tag` column.
- If the FactWise import profile/template allows repeated tags, the scrubber should add/use additional repeated tag columns such as `Tag 2`, `Tag 3`, etc. as needed.
- If the destination template does not support repeated tag columns, keep the values for review rather than silently joining them back into one comma-separated field.

Generalization requirement:

- This should be implemented as a configurable "split cell into repeated destination fields" transform.
- The configuration should define:
  - source column,
  - delimiter,
  - destination repeated field group,
  - trim/drop-empty behavior,
  - maximum output columns or template-driven repeat limit,
  - overflow/review behavior.
- It must not be hardcoded to BOM 4 or to the `Designator` column name.

Important UI/product note:

- This use case is not well served by the current manual `Column Parser` flow.
- The current parser asks the user to click/highlight individual characters in an example cell.
- For comma-separated values like `C3, C4, C5, C12`, the user should not have to highlight every comma.
- The app should provide a simple delimiter-based mode.

Recommended feature:

```text
Split Values Into Repeated Columns
```

For BOM 4 designators, the user should configure:

```text
Source column: Designator
Delimiter: comma
Trim spaces: yes
Drop empty values: yes
Destination repeated field: Tag
Output shape: Tag, Tag 2, Tag 3, ...
```

Expected behavior:

- The app automatically splits every comma in every row.
- The user chooses the delimiter once.
- The app previews the resulting repeated columns.
- The user can apply the split before or during mapping.
- No manual comma-by-comma highlighting should be required.

Relationship to current parser:

- Current `Column Parser` is closer to `Split Cell Into Columns` for complex extraction patterns.
- This new mode is a simpler, more common operation: `split delimited values into repeated destination columns`.
- It should eventually live in a broader source-prep step before final mapping/review.

Open product decisions for BOM 4:

- Decide how to generate required `Item code` when the source does not provide one.
- Decide whether `Manufacturer PartNo` should map to only `MPN Code`, or also populate `SAP Item ID`/`Item code` when those are absent.
- Decide default `Item type`, likely `Raw material` for BOM components.
- Decide where to store `Designator` and `Quantity`: tags/specifications/notes, or omit from item master if they are BOM-instance fields rather than item-master fields.

Resolved/leaning product decisions for BOM 4:

- `Manufacturer` should be mapped into a specification value, not treated as the final item identifier.
- `Designator` should map into repeated `Tag` columns after comma splitting.
- `Measurement unit` should be handled as a user choice:
  - suggest from DigiKey/Mouser MPN enrichment, or
  - use a fixed default UOM for all rows.
- The app already has a `Create FactWise ID` concept, but it needs stronger rules for duplicate/generated IDs.

FactWise ID / item code generation rules needed:

Problem:

- BOM 4 does not provide a clean `Item code`.
- The app may generate item codes or FactWise IDs from MPN/description.
- Duplicate MPNs or repeated generated bases can create collisions.

Required behavior:

- Let the user choose an ID generation strategy when required destination IDs are missing.
- Supported strategies should include:
  - use `MPN Code` as base ID,
  - use a fixed prefix plus sequence,
  - use source file/customer prefix plus sequence,
  - use existing `Create FactWise ID` logic.
- If the chosen base ID repeats, append or increment a sequence deterministically.
- The sequence should be stable across preview and final export.
- The generated ID preview should show collisions and the final resolved value before export.

Example:

```text
MPN Code=RC0402FR-07100RL -> Item code=RC0402FR-07100RL
MPN Code=RC0402FR-07100RL -> Item code=RC0402FR-07100RL-2
```

Alternative prefix strategy:

```text
Prefix=SFO-BOM4
Row 1 -> Item code=SFO-BOM4-0001
Row 2 -> Item code=SFO-BOM4-0002
```

Review/error behavior:

- If generated IDs exceed destination max length, show review/error before export.
- If the user chooses MPN-based IDs and an MPN is blank, fall back to configured prefix sequence or mark the row for review.
- Do not silently overwrite or merge rows with the same generated ID.

Measurement unit suggestion for BOM 4:

- BOM 4 does not provide a source `Measurement unit`.
- `Measurement unit` is required in `Default Item.xlsx`.
- Most BOM 4 MPNs validate against DigiKey/Mouser, so the app should offer a "suggest measurement unit from MPN enrichment" option.
- This should be a suggestion/enrichment feature, not a silent forced value.

Recommended behavior:

- If the source has no UOM column and rows are component/item BOM lines, suggest `Each` or the procurement app's accepted equivalent, such as `Nos` or `Units`.
- Use DigiKey/Mouser validation as confidence that the row is a discrete purchasable component.
- If distributor data exposes packaging type such as `Cut Tape`, `Reel`, `Tray`, `Bulk`, keep that as packaging/procurement metadata, not as the item-master measurement unit.
- Do not map `Cut Tape`, `Reel`, or `Tray` directly into `Measurement unit`, because those are packaging formats, not necessarily the procurement UOM.
- Let the user review/apply the suggested UOM for all rows or selected rows.

Possible UI/config option:

```text
Fill missing Measurement unit:
- Use source column
- Suggest from MPN enrichment
- Use fixed default: Each / Nos / Units
- Leave blank and review
```

Suggested default for BOM 4:

```text
Measurement unit = Each
Confidence = high when MPN validates in DigiKey or Mouser
Reason = electronic component/BOM item with valid distributor match
```

## Source Case 2: BOM 3.pdf

File: `SFO_Technologies/BOM 3.pdf`

Source shape:

- Multi-page PDF BOM.
- Extracts as a text stream rather than a clean PDF table.
- Repeated page header includes: `PartNo.`, `Count`, `Description`, `MFR`, `MFR Part`, `RoHS`.
- Expected logical source fields: `PartNo`, `Count`, `Description`, `MFR`, `MFR Part`, `RoHS`.

Baseline mapping expectation:

- `PartNo` -> `Item code`
- `MFR Part` -> `MPN Code`
- `Description` -> `Description`
- `MFR` -> `Preferred vendor code` / preferred manufacturer-vendor concept
- `RoHS` -> `Tag`
- `Count` -> ignore for now

Transformation rule 2: grouped alternates with carry-forward context

Problem:

- BOM 3 is not a simple independent-row table.
- It contains logical item groups.
- A group usually starts with a parent/base row that defines the common item context.
- The parent/base row often has `PartNo`, `Count`, `Description`, and `RoHS`, but has blank `MFR` and blank `MFR Part`.
- The rows after that parent/base row are alternate purchasable manufacturer options for the same item group.
- Alternate rows often use `---` in `Count`, and they may repeat or slightly vary `Description`.
- The parent/base row should not become a purchasable item row when it has no manufacturer and no manufacturer part number.

Source fields for this rule:

- Group identity/context fields: `PartNo`, `Count`, `Description`, `RoHS`
- Alternate/vendor fields: `MFR`, `MFR Part`
- Placeholder count value: `---`

Parent/base row detection:

- A row is a parent/base row when:
  - `PartNo` is present,
  - `Count` is present and is not `---`,
  - `Description` is present,
  - `MFR` is empty,
  - `MFR Part` is empty.
- When a parent/base row is found, it starts a new logical item group.
- The parent/base row's context becomes the current carry-forward context.

Alternate row detection:

- A row is an alternate row when:
  - `MFR` is present,
  - `MFR Part` is present.
- Alternate rows belong to the most recent parent/base row above them until the next parent/base row starts a new group.
- Alternate rows may have their own `PartNo`, `Description`, and `RoHS`; however, missing or placeholder context should be filled from the current parent/base row.

Carry-forward behavior:

- Carry `PartNo` from the parent/base row into alternate output rows when the alternate row does not provide the desired item identity.
- Carry `Count` from the parent/base row into alternate output rows for metadata if needed, because alternate rows commonly use `---`.
- Carry `Description` from the parent/base row when the alternate row description is missing or should be normalized to the group description.
- Carry `RoHS` from the parent/base row when the alternate row RoHS is missing.
- Do not carry `MFR` or `MFR Part` from the parent row, because the parent row normally does not have them.
- For each alternate output row, use the alternate row's own `MFR` and `MFR Part`.

Destination emit/skip behavior:

- Skip parent/base rows when both `MFR` and `MFR Part` are empty.
- Emit one destination row for every alternate row with usable `MFR` and `MFR Part`.
- If a row has no `MFR` and no `MFR Part`, and it is not a valid parent/base row, mark it for review instead of silently mapping it.
- If an alternate row appears before any parent/base row exists, mark it for review because there is no carry-forward context.

Destination mapping for emitted alternate rows:

- Destination `Item code` should come from the configured item identity source, likely carried parent `PartNo`.
- Destination `MPN Code` should come from alternate row `MFR Part`.
- Destination `Description` should come from carried/normalized group `Description`.
- Destination `Preferred vendor code` should come from alternate row `MFR`.
- Destination `Tag` should include `RoHS`.
- `Count` remains ignored for now unless later mapped into notes/spec metadata.

Worked example:

Source group:

```text
01810000272 | 44  | CAP-MLC 100N/10V/X7R R#0402 10% |                  |                    | YES
01810000273 | --- | CAP-MLC 100N/10V/X7R R#0402 10% | KEMET CORP       | C0402C104K8RAC      | YES
01810000274 | --- | CAP-MLC 100N/16V/X7R R#0402 10% | TDK CORPORATION  | C1005X7R1C104KT      | YES
```

Expected destination rows:

```text
Item code=01810000272 | Description=CAP-MLC 100N/10V/X7R R#0402 10% | MPN Code=C0402C104K8RAC | Preferred vendor code=KEMET CORP | Tag=YES
Item code=01810000272 | Description=CAP-MLC 100N/10V/X7R R#0402 10% | MPN Code=C1005X7R1C104KT | Preferred vendor code=TDK CORPORATION | Tag=YES
```

No destination row should be emitted for the parent/base row above, because it has no `MFR` and no `MFR Part`.

Generalization requirement:

- This should be implemented as a configurable "group rows + carry down + emit alternates" transform.
- The configuration should define:
  - parent/base row criteria,
  - alternate row criteria,
  - fields to carry down,
  - fields to override from alternate rows,
  - skip criteria,
  - review/error criteria.
- It must not be hardcoded to BOM 3, these exact part numbers, or this exact customer.

Important note:

- `MFR` and `MFR Part` are not native destination headers in `Default Item.xlsx`, except `MPN Code` can hold the manufacturer part number.
- The product needs a clear rule for where manufacturer name should live in the destination output.
- The harder BOM 3 logic still needs to be defined separately.

## Source Case 3: BOM_1.xls

File: `SFO_Technologies/BOM_1.xls`

Source shape:

- Legacy Excel `.xls` workbook.
- Contains three sheets: `BOM`, `ASL`, and `MFG`.
- `BOM` is the base item/BOM line sheet.
- `MFG` is the manufacturer option sheet.
- `ASL` exists but is effectively empty in this sample.

Observed sheet structure:

`BOM` sheet:

- Rows: `174` data rows.
- Unique `Part Number`: `170`.
- Important columns: `Original`, `Parent Part`, `Part Number`, `Indented Part Number`, `Revision`, `Description`, `Quantity`, `UOM`, `Level`, `Find No`, `Release Status`, `Critical Part`, `Procurement Type`, `Bulk Material`.

`MFG` sheet:

- Rows with usable manufacturer + MPN: `220`.
- Unique `Part Number`: `150`.
- Important columns: `Original`, `Part Number`, `Description`, `Manufacturer Part Number`, `Manufacturer Name`, `Replacement Information`.

Relationship:

- `BOM.Part Number` is the base item key.
- `MFG.Part Number` is a foreign-key-like reference back to the BOM item.
- One BOM part can have zero, one, or many MFG rows.
- In this sample, `150` BOM part numbers have MFG matches.
- In this sample, `27` BOM part numbers have multiple MFG rows.

Transformation rule 3: multi-sheet join with one-to-many manufacturer expansion

Problem:

- The source item definition is split across sheets.
- The base item context lives in `BOM`.
- Manufacturer and manufacturer part number options live in `MFG`.
- The destination import format is row-based, so each manufacturer option must become its own destination row.

Join rule:

- Join `BOM` to `MFG` using:
  - left key: `BOM.Part Number`
  - right key: `MFG.Part Number`
- Treat `BOM` as the parent/base table.
- Treat `MFG` as a child/option table.

Expansion behavior:

- For each BOM row:
  - find all matching MFG rows by part number,
  - if one MFG row exists, emit one destination row,
  - if multiple MFG rows exist, duplicate the BOM context once per MFG row,
  - each emitted row should keep the same BOM item context but use a different manufacturer/MPN from the matched MFG row.
- This is the same product idea as alternates, but the alternates live in a separate sheet instead of the same source row.

Destination mapping expectation:

- `BOM.Part Number` -> `Item code`
- `BOM.Description` -> `Description`
- `BOM.UOM` -> `Measurement unit`
- `MFG.Manufacturer Part Number` -> `MPN Code`
- `MFG.Manufacturer Name` -> `Preferred vendor code` / preferred manufacturer-vendor concept
- `BOM.Quantity` -> ignore for now or keep as metadata, because item master is not a BOM quantity import.
- `BOM.Procurement Type` may help infer `Item type`, but this needs a product rule.

Duplicate/copy behavior:

- Columns from `BOM` are shared context and should be copied into every expanded destination row for that part.
- Columns from `MFG` are option-specific and should change per expanded row.
- Example: if one `BOM.Part Number` has six matching `MFG` rows, output six rows with the same item description/UOM/etc. and six different manufacturer/MPN pairs.

Unmatched handling:

- If a BOM row has no matching MFG row:
  - either emit a base destination row with blank MPN/vendor and mark it for review,
  - or skip it if the business rule says only manufacturer-backed rows should be imported.
- This needs a product decision.
- If an MFG row has no matching BOM row:
  - mark it for review as an orphan manufacturer record,
  - do not silently emit it without base item context.

Worked example:

```text
BOM row:
Part Number=0720-10200 | Description=<base item description> | UOM=EA

MFG rows:
Part Number=0720-10200 | Manufacturer Name=W+P PRODUCTS     | Manufacturer Part Number=106-37-2-3-CL/B
Part Number=0720-10200 | Manufacturer Name=NORCOMP          | Manufacturer Part Number=171-037-213R911
Part Number=0720-10200 | Manufacturer Name=ADAM TECHNOLOGY  | Manufacturer Part Number=DC37-ST-1-BL-JS-HT
```

Expected destination rows:

```text
Item code=0720-10200 | Description=<base item description> | Measurement unit=EA | MPN Code=106-37-2-3-CL/B     | Preferred vendor code=W+P PRODUCTS
Item code=0720-10200 | Description=<base item description> | Measurement unit=EA | MPN Code=171-037-213R911    | Preferred vendor code=NORCOMP
Item code=0720-10200 | Description=<base item description> | Measurement unit=EA | MPN Code=DC37-ST-1-BL-JS-HT | Preferred vendor code=ADAM TECHNOLOGY
```

Generalization requirement:

- This should be implemented as a configurable "multi-sheet join + one-to-many expansion" transform.
- The configuration should define:
  - parent/base sheet,
  - child/option sheet,
  - join keys,
  - parent fields to copy,
  - child fields to map/override,
  - unmatched-parent behavior,
  - orphan-child behavior,
  - whether to expand one output row per child row.
- It must not be hardcoded to BOM_1, these sheet names, or this exact customer.

## Source Case 4: BOM 2.xlsx

File: `SFO_Technologies/BOM 2.xlsx`

Source shape:

- Multi-sheet Excel workbook.
- Contains a `note` sheet plus multiple BOM sheets.
- BOM sheets use the same basic table format.
- Header row is row `2` on the BOM sheets.
- Important source columns: `No.`, `Process`, `Item no.`, `Specification`, `Quantity`, `Reference`, `Packaging`, `Specification 2`, `Specification 3`, `Catalogue no.`, `Producer`.

Observed BOM sheets:

- `051-52GENER100`
- `056-52DGENER104`
- `057-52GENER105`
- `057-52AMPLIFIERUSN101`
- `058-52SHCPU4.3105`
- `058-52SHCPU7.0105`

Problem column:

- `Producer` contains one or more manufacturer/part-number options packed into a single cell.
- The common pattern is:

```text
MANUFACTURER: manufacturer-part-info MANUFACTURER: manufacturer-part-info MANUFACTURER: manufacturer-part-info
```

- There is usually no clean delimiter between options except the next manufacturer name followed by `:`.
- Manufacturer names can contain spaces or mixed case, for example `BC Components`, `King Core`, `Samsung`.
- Some manufacturer markers have no space after the colon, for example `Samsung:CL21F104ZBCNNNC` or `KEC:BAV99`.
- Some cells include extra specifications after the manufacturer part number, so the exact MPN boundary may be ambiguous.

Transformation rule 4: parse packed manufacturer options from one column

Problem:

- The row itself is straightforward, but `Producer` can contain multiple producer alternatives.
- Each parsed producer alternative should become its own destination row.
- This is similar to BOM 4 alternates, but all alternates are packed inside one text column instead of separate columns.

Producer parse behavior:

- Parse `Producer` into ordered segments.
- Each segment starts with a manufacturer marker:

```text
<manufacturer name>:
```

- The segment value continues until the next manufacturer marker or the end of the cell.
- For each segment:
  - manufacturer name = text before `:`,
  - manufacturer part info = text after `:` until the next manufacturer marker.

Example producer cell:

```text
NIPPON: EMV-350ADA100ME55G SAMWHA: SC1V106M05005VR259/SC 10uF 35V 20% 5x5 JAMICON: CSM 100 M 1V D05 BC Components: 2222 153 60109 PANASONIC: ECEV1VA100SR
```

Expected parsed options:

```text
NIPPON        -> EMV-350ADA100ME55G
SAMWHA        -> SC1V106M05005VR259/SC 10uF 35V 20% 5x5
JAMICON       -> CSM 100 M 1V D05
BC Components -> 2222 153 60109
PANASONIC     -> ECEV1VA100SR
```

Destination emit behavior:

- For each source row:
  - if `Producer` has one parsed option, emit one destination row,
  - if `Producer` has multiple parsed options, emit one destination row per parsed option,
  - copy all normal row context into each emitted row.
- If `Producer` is empty, either emit a base row without manufacturer/MPN and mark for review, or skip; this needs a product decision.
- If a producer segment cannot be confidently parsed, mark the row/segment for review instead of silently dropping it.

Destination mapping expectation:

- `Item no.` -> `Item code`
- `Specification` -> `Description`
- `Quantity` -> ignore for now or metadata only
- `Reference` -> metadata/spec/notes decision needed
- `Packaging` -> metadata/spec/notes decision needed
- `Specification 2` and `Specification 3` -> possible specification fields
- `Catalogue no.` -> possible internal/catalog metadata, needs product decision
- parsed producer manufacturer -> `Preferred vendor code` / preferred manufacturer-vendor concept
- parsed producer manufacturer part info -> `MPN Code`, subject to MPN cleanup rules

Important MPN ambiguity:

- The first token after `Manufacturer:` is often the clean MPN, but not always.
- Some values include extra descriptive/spec text after the part number.
- Some manufacturer part numbers themselves contain spaces.
- Engineering should not assume a simple "take first word" rule is always correct.
- The scrubber may need a configurable cleanup mode:
  - keep full manufacturer part info as MPN,
  - take first token as MPN,
  - use validation/enrichment to canonicalize MPN,
  - or flag uncertain segments for review.

Preferred parsing strategy for BOM 2:

- Do not try to understand whether the text after `Manufacturer:` is a spec or part of the MPN.
- First split the `Producer` cell into producer segments using manufacturer markers.
- A manufacturer marker is a known or likely vendor/manufacturer name followed by `:`.
- The value for a producer segment continues until the next manufacturer marker.
- Example:

```text
YAGEO: CC0805 Z R Y5V 9 xx 104 AVX: 0805 5G 104 ZAT2A Samsung:CL21F104ZBCNNNC
```

- Parsed as:

```text
YAGEO   -> CC0805 Z R Y5V 9 xx 104
AVX     -> 0805 5G 104 ZAT2A
Samsung -> CL21F104ZBCNNNC
```

- This avoids incorrectly cutting at the first space after `:`.
- After segmenting, optionally clean/canonicalize the MPN value.

Vendor directory failsafe:

- Maintain or import a vendor/manufacturer directory.
- Use the vendor directory as a second signal to identify manufacturer markers inside packed cells.
- If a word/phrase before `:` exists in the vendor directory, treat it as a strong producer boundary.
- If a `Something:` marker is not in the vendor directory, treat it as a weak boundary and either:
  - accept it with lower confidence,
  - ask for user confirmation,
  - or send the row/segment to review.
- This helps avoid false splits when colon text is not actually a manufacturer.

Configurable MPN cleanup:

- For BOM 2, there may be a customer-specific option to trim the parsed producer value to the first token after `:`.
- This should be optional, not a global rule, because some real manufacturer part numbers or customer-provided part identifiers can contain spaces or suffixes.
- Safer flow:
  - parse producer segments using vendor markers,
  - keep full segment value initially,
  - validate against vendor/manufacturer directory or external MPN validation,
  - if validation returns a canonical MPN, use the canonical value,
  - if not, keep the parsed value and mark confidence/review status.

Recommended implementation approach for BOM 2:

- Use a two-stage configuration rather than one hard parsing rule.
- Stage 1: producer segmentation
  - split `Producer` using known vendor/manufacturer markers from a vendor directory,
  - allow unknown `Something:` markers as weak boundaries,
  - emit one candidate producer option per segment.
- Stage 2: MPN normalization
  - preserve the full parsed producer value as raw MPN text,
  - run validation/enrichment where available,
  - replace with canonical MPN only when validation is confident,
  - keep raw text and mark review when confidence is low.
- This balances scale and safety: most rows can be expanded automatically, while uncertain rows get reviewed instead of being silently damaged.

Relationship to existing Parse Column feature:

- The existing parse-column idea is relevant but likely insufficient if it only splits a column into multiple columns.
- This case needs "parse one packed column into multiple rows" because every producer option should become a separate destination row.
- A useful generalized feature would be: parse packed alternates from a column, then expand rows from parsed segments.

Worked example:

Source row:

```text
Item no.=ECK+100N50VXXZ
Specification=Ceramic capacitor
Quantity=42
Reference=CK1, 2, 5...
Producer=YAGEO: CC0805 Z R Y5V 9 xx 104 AVX: 0805 5G 104 ZAT2A Samsung:CL21F104ZBCNNNC
```

Expected destination rows:

```text
Item code=ECK+100N50VXXZ | Description=Ceramic capacitor | Preferred vendor code=YAGEO   | MPN Code=CC0805 Z R Y5V 9 xx 104
Item code=ECK+100N50VXXZ | Description=Ceramic capacitor | Preferred vendor code=AVX     | MPN Code=0805 5G 104 ZAT2A
Item code=ECK+100N50VXXZ | Description=Ceramic capacitor | Preferred vendor code=Samsung | MPN Code=CL21F104ZBCNNNC
```

Generalization requirement:

- This should be implemented as a configurable "packed alternates column parser + row expansion" transform.
- The configuration should define:
  - source column to parse,
  - manufacturer marker pattern,
  - segment boundary logic,
  - whether to emit one row per segment,
  - fields copied from the original row,
  - manufacturer destination field,
  - MPN destination field,
  - uncertain parse review behavior.
- It must not be hardcoded to BOM 2, the `Producer` column name, or this exact customer.

## Source Case 5: BOM 5.xlsx

File: `SFO_Technologies/BOM 5.xlsx`

Source shape:

- Single-sheet Excel workbook.
- Sheet: `Multi-level Bill Of Source`
- Header row: `2`
- Rows: `104` data rows after header.
- Important source columns: `Row Number`, `Level`, `Reference Designator`, `Type`, `Name`, `Revision`, `State`, `Phase`, `UOM`, `Quantity`, `Description`, `Manufacturer Equivalent part`, `Manufacturer`, `RDO`, `Essential To`, `Spare Part`, `OrgCode`, `Make/Buy`.

Problem columns:

- `Manufacturer Equivalent part` contains multiple manufacturer part numbers packed into one cell.
- `Manufacturer` contains multiple manufacturer names packed into one cell.
- These two columns are parallel lists: the first MPN should correspond to the first manufacturer, the second MPN to the second manufacturer, and so on.
- The lists are not safely split by spaces because:
  - manufacturer names can contain spaces, e.g. `NIC COMPONENTS`, `INFINEON TECHNOLOGIES AG`, `ON SEMICONDUCTOR`, `BROADCOM CORPORATION`, `SAMSUNG ELECTRO-MECHANICS CO`,
  - MPN-like values can also contain spaces in this source, e.g. `18889-SMBT 2222A E6327`, `02254 MNR14E0ABJ102`, `02862 GRM188R71H102KA01`,
  - some rows include catalog/vendor prefixes joined to MPNs.

Transformation rule 5: parallel packed manufacturer and MPN lists

Problem:

- Unlike BOM 2, manufacturer markers are not embedded as `Manufacturer: value`.
- Instead, the manufacturers and MPNs are stored in two separate packed columns.
- The scrubber must pair manufacturers to MPNs by position, then emit one destination row per pair.

Destination mapping expectation:

- `Name` -> `Item code`
- `Description` -> `Description`
- `UOM` -> `Measurement unit`
- `Manufacturer Equivalent part` parsed option -> `MPN Code`
- `Manufacturer` parsed option -> `Preferred vendor code` / preferred manufacturer-vendor concept
- `Reference Designator`, `Quantity`, `OrgCode`, and `Make/Buy` are metadata/spec/notes decisions, not core MPN/vendor identity.

Recommended parsing strategy:

- Use a vendor/manufacturer directory to parse the `Manufacturer` column into known manufacturer names.
- Use the count of parsed manufacturers to guide parsing of `Manufacturer Equivalent part`.
- Use MPN validation/enrichment where available to split or canonicalize MPN candidates.
- Pair parsed MPN candidates with parsed manufacturers by order.
- Emit one destination row per paired manufacturer/MPN option.
- If counts do not match or confidence is low, mark the row for review.

Prefix cleanup for BOM 5:

- Values in `Manufacturer Equivalent part` often include leading customer/catalog prefixes before the actual MPN.
- Examples:
  - `18889-SMBT2222AE6327HTSA1`
  - `18846-MMBT2222ALT1G`
  - `AGILE-CC0805KKX7R8BB225`
  - `02862-GRM21BR71H105KA12`
- For now, these prefixes are considered useless for destination `MPN Code`.
- The scrubber should support stripping configured prefixes before mapping to `MPN Code`.
- Keep the original raw value only as trace/debug/review metadata if needed.
- This pattern was checked across BOM 5:
  - `Manufacturer Equivalent part` is populated on all `104` data rows.
  - Most MPN candidates use a five-digit prefix pattern such as `18981-`, `11962-`, `06725-`, `10302-`, `05498-`, `02254-`.
  - Some prefixes are separated by a space instead of a hyphen, e.g. `02254 MCR03EZPFX2552`.
  - Some alpha prefixes exist, e.g. `AGILE-`.
  - No `Manufacturer:` / colon-style producer markers were found in BOM 5's `Manufacturer Equivalent part` column.
- Prefix stripping should therefore support:
  - attached five-digit prefixes: `12345-MPNVALUE -> MPNVALUE`,
  - separated five-digit prefixes: `12345 MPNVALUE -> MPNVALUE`,
  - configured alpha prefixes: `AGILE-MPNVALUE -> MPNVALUE`.
- Example cleanup:

```text
18889-SMBT2222AE6327HTSA1 -> SMBT2222AE6327HTSA1
18846-MMBT2222ALT1G       -> MMBT2222ALT1G
AGILE-CC0805KKX7R8BB225   -> CC0805KKX7R8BB225
02862-GRM21BR71H105KA12   -> GRM21BR71H105KA12
02254 MCR03EZPFX2552      -> MCR03EZPFX2552
```

Important distinction from BOM 2:

- BOM 2 has `Producer` values like `YAGEO: <value> AVX: <value>`.
- BOM 5 does not use that colon marker pattern in the checked MPN column.
- If a colon pattern appears in another source file, treat it as the BOM 2-style packed producer case, not the BOM 5 parallel-list case.

Why simple whitespace splitting is unsafe:

```text
Manufacturer Equivalent part:
18889-SMBT2222AE6327HTSA1 18846-MMBT2222ALT1G 18889-SMBT 2222A E6327 02254-SST2222AT116 28604-PMBT2222A

Manufacturer:
INFINEON TECHNOLOGIES AG ON SEMICONDUCTOR INFINEON TECHNOLOGIES AG ROHM NEXPERIA
```

- The manufacturer list represents five manufacturers:

```text
INFINEON TECHNOLOGIES AG
ON SEMICONDUCTOR
INFINEON TECHNOLOGIES AG
ROHM
NEXPERIA
```

- The MPN list likely represents five MPN options:

```text
18889-SMBT2222AE6327HTSA1
18846-MMBT2222ALT1G
18889-SMBT 2222A E6327
02254-SST2222AT116
28604-PMBT2222A
```

- Splitting either column by every space would produce the wrong counts and wrong pairings.

Worked example:

Source row:

```text
Name=2088829-001
Description=MLCC - SMD/SMT 0805 2.2UF 25VOLTS X7R 10%
UOM=Each
Manufacturer Equivalent part=AGILE-CC0805KKX7R8BB225 AGILE-C0805C225K3RAC AGILE-NMC0805X7R225K25TRPF AGILE-08053C225KAT
Manufacturer=YAGEO KEMET NIC COMPONENTS AVX
```

Expected parsed pairs:

```text
YAGEO          -> AGILE-CC0805KKX7R8BB225
KEMET          -> AGILE-C0805C225K3RAC
NIC COMPONENTS -> AGILE-NMC0805X7R225K25TRPF
AVX            -> AGILE-08053C225KAT
```

Expected destination rows:

```text
Item code=2088829-001 | Description=MLCC - SMD/SMT 0805 2.2UF 25VOLTS X7R 10% | Measurement unit=Each | MPN Code=AGILE-CC0805KKX7R8BB225       | Preferred vendor code=YAGEO
Item code=2088829-001 | Description=MLCC - SMD/SMT 0805 2.2UF 25VOLTS X7R 10% | Measurement unit=Each | MPN Code=AGILE-C0805C225K3RAC          | Preferred vendor code=KEMET
Item code=2088829-001 | Description=MLCC - SMD/SMT 0805 2.2UF 25VOLTS X7R 10% | Measurement unit=Each | MPN Code=AGILE-NMC0805X7R225K25TRPF    | Preferred vendor code=NIC COMPONENTS
Item code=2088829-001 | Description=MLCC - SMD/SMT 0805 2.2UF 25VOLTS X7R 10% | Measurement unit=Each | MPN Code=AGILE-08053C225KAT            | Preferred vendor code=AVX
```

Open risks / review cases:

- Manufacturer names not found in vendor directory.
- MPN list count does not match manufacturer list count.
- MPN candidate contains spaces and cannot be confidently grouped.
- A manufacturer appears more than once in the same row.
- `OrgCode` and `Make/Buy` contain newline-separated values that may represent separate org-specific metadata, not manufacturer options.

Generalization requirement:

- This should be implemented as a configurable "parallel packed lists + row expansion" transform.
- The configuration should define:
  - source column containing packed MPN/list A,
  - source column containing packed manufacturer/list B,
  - vendor directory matching rules,
  - MPN segmentation/validation rules,
  - pair-by-order behavior,
  - count mismatch behavior,
  - review/error behavior,
  - copied context fields.
- It must not be hardcoded to BOM 5 or this exact customer.
