# Where every editor column comes from

Traced end-to-end on `Default Item.xlsx` (Sheet1, header row 4) with a session
whose counts are `tags=3, spec_pairs=3, customer_id_pairs=1`.

    template file  30  ->  strip .1  30  ->  cluster/expand  35  ->  inject BOM  38

---

## Stage 0 — the template workbook: 30 columns

`SFO_TEMPLATE_NAME = "Default Item.xlsx"`, `SHEET = Sheet1`, `HEADER_ROW = 4`
(`default_template.py`). Rows 1-3 are the reference/help text.

| # | Header in the file | Note |
|---|---|---|
| 0 | Item code | |
| 1 | SAP Item ID | exported as `ERP Code` (see Stage 6) |
| 2 | CPN Code | |
| 3 | MPN Code | |
| 4 | HSN Code | |
| 5 | Item name | |
| 6 | Description | |
| 7 | Item type | Raw material / Finished good |
| 8 | Measurement unit | |
| 9 | Alternate UoM 1 | |
| 10 | Notes | |
| 11 | SAP Description | |
| 12-14 | Specification name / value / UOM | repeating group, occurrence 1 |
| 15-17 | `Specification name.1` / `value.1` / `UOM.1` | occurrence 2, pandas-renamed |
| 18-19 | Item identifications name / value | repeating group, occurrence 1 |
| 20 | Procurement item | |
| 21 | Procurement item price currency code | |
| 22 | Procurement item price | |
| 23 | Sales item | |
| 24 | Tag | repeating group, occurrence 1 |
| 25 | Procurement entity name | |
| 26-27 | Preferred vendor code / Alternate Item Name for Preferred Vendor | occurrence 1 |
| 28-29 | `Preferred vendor code.1` / `Alternate Item Name…1` | occurrence 2 |

The `.1` suffixes are pandas disambiguating duplicate headers on read. They are
not real column names.

## Stage 1 — `_strip_pandas_duplicate_suffix`

Undoes the `.1`, restoring genuinely repeated labels. Still 30.

## Stage 2 — `build_sfo_clustered_headers` (views.py:577)

Every Tag / Specification / Item-identification column is **removed** from the
file's list, then **re-inserted N times** at the position the first one held.

N comes from the *session's* `column_counts`, never from the file. So the file
having two Specification groups and one Tag is irrelevant — those occurrences
only mark *where* the group goes.

    spec_pairs_count=3       -> 9 columns  (name/value/UOM x3)
    customer_id_pairs_count=1 -> 2 columns
    tags_count=3             -> 3 columns

`Preferred vendor code` is **not** in this mechanism — its two occurrences come
straight from the file and are fixed at two.

## Stage 3 — `add_bom_destination_headers` (views.py:558) — THE INJECTED ONES

    BOM_DESTINATION_HEADERS = ["Level", "Quantity", "Base BOM Qty"]

Inserted before whichever of `Procurement entity name` / `Preferred vendor code`
comes first. **These three exist in no template file.** They are the only
columns the editor shows that the workbook has never heard of, and that gap is
what let auto-mapping silently skip `quantity` (see "Known damage" below).

## Result — the 38 columns the editor renders

     0 Item code                     19 Specification value
     1 SAP Item ID                   20 Specification UOM
     2 CPN Code                      21 Item identifications name
     3 MPN Code                      22 Item identifications value
     4 HSN Code                      23 Procurement item
     5 Item name                     24 Procurement item price currency code
     6 Description                   25 Procurement item price
     7 Item type                     26 Sales item
     8 Measurement unit              27 Tag
     9 Alternate UoM 1               28 Tag
    10 Notes                         29 Tag
    11 SAP Description               30 Level          <- injected
    12 Specification name            31 Quantity       <- injected
    13 Specification value           32 Base BOM Qty   <- injected
    14 Specification UOM             33 Procurement entity name
    15 Specification name            34 Preferred vendor code
    16 Specification value           35 Alternate Item Name for Preferred Vendor
    17 Specification UOM             36 Preferred vendor code
    18 Specification name            37 Alternate Item Name for Preferred Vendor

---

## Stage 4 — the same column under four different names

This is the part that actually causes the trouble. One physical column carries
up to four identities, minted by four different functions:

| Vocabulary | Example | Made by | Used for |
|---|---|---|---|
| Display label | `Specification name` | the template file | what the sheet and editor show; repeats freely |
| Internal slot key | `Specification_Name_2` | `get_sfo_slot_key` (views.py:673) | mapping targets, formula rules, tag rules |
| Positional row key | `Specification name @@dup1` | `_positional_row_keys` (views.py:5570) | dict keys inside row payloads |
| Unique field key | `Preferred vendor code__2` | `make_unique_field_headers` (views.py:710) | JSON-safe AG-Grid field ids |

Full internal-slot vocabulary:

    Tag                            -> Tag_N
    Specification name             -> Specification_Name_N
    Specification value            -> Specification_Value_N
    Specification UOM              -> Specification_UOM_N
    Item identifications name      -> Customer_Identification_Name_N
    Item identifications value     -> Customer_Identification_Value_N

Note the rename: the template says **Item identifications**, the internal key
says **Customer_Identification**. Both spellings are accepted on the way in.

**These vocabularies leak into each other.** A session can end up storing the
display set *and* the internal set for the same three specifications — 54
headers where 38 are real. That is exactly what produced the malformed spec
block in the item export (fixed in `_cluster_factwise_columns`, commit 7fb7dc7).

## Stage 5 — columns added after mapping

Not from the template at all; appended to the grid later.

- **MPN enrichment** — `MPN valid`, `MPN valid (DigiKey)`, `MPN valid (Mouser)`,
  `MPN valid (Element14)`, `DKPN`, `MPNR`
- **Column Parser output** — `info['parser_columns']`, merged in `data_view` and
  again in `download_file`
- **Formula / Tag rule targets** — written into `Tag_N`, `Specification_*_N`

## Stage 6 — what happens at export

- `_drop_bom_columns` (views.py:5264) strips `Level`, `Quantity`,
  `Base BOM Qty` from the **item** file — they belong to the BOM file
- `_cluster_factwise_columns` regroups each repeated FactWise group so no
  unrelated column sits between two like columns
- Header cleanup strips digits/underscores and applies `capitalize()`, which
  collapses internal names back to display labels — and would destroy acronyms,
  so `EXPORT_HEADER_CANONICAL_LABELS` restores `CPN Code`, `MPN Code`,
  `HSN Code`, `ERP Code`
- `SAP Item ID` is exported as **`ERP Code`** (alias kept for old sessions)

---

## Known damage from the file/injected split

1. **`quantity` never auto-mapped.** The mapping page offered `Quantity`, but
   the matcher scored against the template *file*, which lacks it. Normalizer
   uploads arrived with an empty Quantity column that looked like the normalizer
   had dropped it. Fixed by passing `extra_template_headers=BOM_DESTINATION_HEADERS`
   into `map_headers_to_template`. `Level` had the identical problem.

2. **BOM export used quantities nobody could see.** `_merge_grid_values_into_records`
   (views.py:13981) ignores a grid column that is entirely blank, so export fell
   back to the uploaded sheet's quantities. Validation then flagged rows against
   values absent from the grid.

3. **`BOM_GRID_FIELDS` maps `manufacturer -> 'Manufacturer'`** (views.py:13921),
   but no destination column named `Manufacturer` exists — manufacturer maps to
   `Tag`. That bridge cannot ever fire. Not yet investigated.

## What should move into the template file

**Should move — removes a whole bug class:**
`Level`, `Quantity`, `Base BOM Qty`. Add them to `Default Item.xlsx` before
`Procurement entity name` and delete `add_bom_destination_headers`. Then the
mapping page, the auto-matcher and the grid all read one list, and the class of
bug in (1) cannot recur.

**Cannot move — must stay dynamic:**
Tag / Specification / Item-identification counts are per-session user choices. A
file can only carry one fixed count. Keep exactly **one** occurrence of each in
the file as a position anchor, and treat it as an anchor only. The file
currently carries two Specification groups, which reads like it means something
and does not.

**The deeper fix:** collapse the four naming vocabularies to one. Every bug in
this area so far has been two of them meeting in the same list.
