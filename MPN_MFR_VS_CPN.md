# Keying alternates: `mpn|manufacturer` vs `cpn`

One line decides whether a BOM has alternates at all.

`alternatesKey` in `frontend/src/pages/BomNormalizer.js` builds the key that
groups rows into a single BOM line:

```
parentKey = <parent> ␟ <identity>
```

Rows sharing a `parentKey` become **one BOM line**: the first is the primary,
the rest go sideways into the alternate columns. Rows with different keys become
**separate lines**.

`identity` is the whole argument. Changed to `cpn` on 2026-08-17, having been
`mpn|manufacturer` earlier the same day.

---

## What each choice does

### `mpn|manufacturer`

The manufacturer part number **is what an alternate varies**. Keying on it means
two rows are only ever grouped when they name the same manufacturer part — which
is to say, alternates can never group at all.

An AML position with three approved suppliers:

```
cpn 0700-01010   BOURNS            8250-100K-RC
cpn 0700-01010   INDUCTOR SUPPLY   LS4-100K
cpn 0700-01010   TE CONNECTIVITY   SC10100KT
```

becomes three keys, three rows marked `Primary`, three sibling BOM lines under
one assembly.

**FactWise rejects that.** One assembly may not list the same child twice, and
those three lines are one position. The validator reports `duplicate_child`, and
there is nothing the user can do in the editor to fix it — deleting two of them
throws away two approved suppliers, and keeping them is not importable.

### `cpn`

The customer's part number is the same on all three, so they land in one group:
one BOM line, two alternates. That is the shape the import accepts, and the
shape the alternate columns exist for.

---

## Measured, on real uploads

Every normalized sheet in `uploaded_files` at the time of the change:

| rows | lines with `mpn\|mfr` | lines with `cpn` | alternates formed | merge risk |
|---|---|---|---|---|
| 109 (AMAT `BoM_1535181`) | 109 | 76 | 33 | 0 |
| 111 | 109 | 76 | 35 | 0 |
| 171 | 171 | 140 | 31 | 0 |
| 368 | 368 | 112 | 256 | 0 |
| 368 | 368 | 112 | 256 | 0 |
| 368 | 368 | 112 | 256 | 0 |

`mpn|manufacturer` produced **zero alternates on every sheet** — the alternate
columns were dead code. On AMAT the 33 alternates it fails to form are exactly
the 33 `duplicate_child` errors that blocked the export.

"Merge risk" counts CPN groups whose rows carry **different descriptions** — the
signature of a sheet reusing one part number for parts that are not
interchangeable. Zero on all six.

---

## The caveat

**`cpn` merges rows that share a customer part number, whether or not they are
interchangeable.**

It is right when the CPN means "this position, these approved suppliers", which
is what a CPN normally means and what all six sheets above do.

It is wrong on a sheet that reuses one CPN across parts that are genuinely
different. Those rows would collapse into one line with the others demoted to
alternates — the failure `mpn|manufacturer` was introduced to prevent, and the
one that produced *"36 distinct parts read as one part with 35 substitute
brands"*.

The measurable warning sign is in the table above: **CPN groups whose rows
describe different things.** Zero means every group is one part. Non-zero means
this sheet is the exception, and the row descriptions will say which.

### Where the fallbacks still apply

`cpn` leads, but is not the only source:

```
cpn  →  mpn|manufacturer  →  description  →  "Source row N"
```

A row with no CPN — an assembly parent, a sub-BOM row, a notes row — still keys
on MPN+manufacturer, then description. Level-only sheets that never had a CPN
behave exactly as before.

### What does NOT change

Two placements of one part in **different** assemblies stay two BOM lines. The
key includes the parent, so `0100-02726␟X` and `0100-02983␟X` are different
groups. Grouping is always within one assembly — a screw used in 159
sub-assemblies is 159 lines, not one line with 159 "alternates".

---

## If this is ever changed back

Do not change it on the strength of one sheet. Run the comparison above across
the uploads in `uploaded_files` and look at two numbers:

- **alternates formed** — with `mpn|manufacturer` this is 0 by construction, so
  every AML sheet will fail the import on `duplicate_child`
- **merge risk** — non-zero means `cpn` is over-merging on that sheet, and the
  fix is probably neither key but a per-sheet answer

The two failures are not symmetric. `mpn|manufacturer` fails on **every** sheet
with approved alternates, unrecoverably, at import. `cpn` fails only on sheets
that reuse a part number for different parts, and shows itself as rows with
mismatched descriptions collapsed onto one line — visible in the editor before
export.
