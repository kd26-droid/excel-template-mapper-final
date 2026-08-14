# BOM revision handoff — what the scrubber gives you, and what FactWise does with it

For the FactWise dev picking this up.

The BOM scrubber (`factwise-bom-mapper`) does the **first half** of a BOM
revision and then stops. This document is the contract at that seam: one GET
that returns everything needed, and the calls FactWise makes afterwards.

---

## 1. Why it stops

A revision is four steps. The scrubber does the first two and deliberately not
the last two:

| # | step | who |
|---|---|---|
| 1 | `POST bom/admin/{picked}/revise/` — create the draft (R4 → R5) | **scrubber** |
| 2 | generate the BOM sheet, retarget its BOM IDs to the draft's code, upload it | **scrubber** |
| 3 | `POST bulk_import/process/` — import the sheet into the draft | **FactWise** |
| 4 | `PUT project/.../revise/` — move the project's slots onto the draft | **FactWise** |

The split is where the user's decision belongs. After step 2 nothing is
committed — the draft exists but is empty, and no project has moved. That is
exactly the point at which you can show a **diff of R4 against R5** and let the
user confirm. Steps 3 and 4 are the irreversible half.

Steps 3 and 4 are also strictly ordered: until the import lands the draft has no
items, so a slot moved onto it points at an empty BOM.

---

## 2. The call

```
GET /api/bom/revision-handoff/{session_id}/
```

`{session_id}` is the uuid in the scrubber's editor URL —
`/editor/b847bf44-9e9f-441b-abcd-e611a79e055c`. No auth, no body, no query params.

- local: `http://localhost:8002/api/bom/revision-handoff/{session_id}/`
- Azure: `https://factwise-bom-mapper.azurewebsites.net/api/bom/revision-handoff/{session_id}/`

### Responses

| status | meaning |
|---|---|
| `200` | the bundle below |
| `404 "Invalid session"` | no such session |
| `404 "This session has not uploaded a BOM revision."` | session exists but was a create flow, or has not reached the upload yet |

### 200 body

```json
{
  "success": true,
  "session_id": "b847bf44-9e9f-441b-abcd-e611a79e055c",

  "bulk_import_id": "964d7d7a-d5c9-40c1-90be-5057faaf7976",

  "enterprise_bom_id": "<R5 — the draft being revised INTO>",
  "superseded_enterprise_bom_id": "<R4 — the revision it was created FROM>",

  "process_arguments": {
    "bulk_import_id": "964d7d7a-d5c9-40c1-90be-5057faaf7976",
    "import_type": "BOM_UPDATE",
    "enterprise_bom_id": "<R5>",
    "template_id": "…",
    "finished_good_id": "…",
    "entity_ids": ["…"]
  },

  "sheet_download_url": "/api/bom/download/b847bf44-…/",

  "project_id": "<or null>",
  "bom_module_ids": ["<slot linkage id>", "…"],

  "details": {
    "bom_code": "BOM_A_R5",
    "superseded_bom_code": "BOM_A_R4",
    "base_bom_id": "…",
    "project_code": "P001059",
    "project_name": "Chassis programme",
    "file_name": "BOM 7 level w alt.xlsx",
    "blob_key": "83e8366d-…/bulk_import/964d7d7a-…/BOM 7 level w alt.xlsx",
    "uploaded_at": "2026-08-14T01:03:31"
  }
}
```

---

## 3. What to do with it

### Step A — show the diff

`superseded_enterprise_bom_id` (R4) and `enterprise_bom_id` (R5) are both there
for this. R5 is a real BOM row in the directory but has **no items yet**, so
diff R4's contents against the uploaded sheet, not against R5's contents.
`sheet_download_url` serves that sheet.

Then ask the user.

### Step B — user says YES

**1. Import the sheet into the draft.** `process_arguments` is the body,
assembled and ready:

```
POST /organization/bulk_import/process/
{ "bulk_import_id": "…", "import_type": "BOM_UPDATE",
  "enterprise_bom_id": "<R5>", "template_id": "…",
  "finished_good_id": "…", "entity_ids": ["…"] }
```

`template_id`, `finished_good_id` and `entity_ids` are **mandatory** — the
import is rejected without them. They come off the draft's BOM detail, which
only the scrubber fetched, which is why they are handed over rather than left
for you to look up.

**2. Move the project's slots** — only if `project_id` is non-null. One call per
id in `bom_module_ids`:

```
PUT /organization/project/{project_id}/boms/{bom_module_id}/revise/
{ "enterprise_bom_id": "<R5>", "process_id": "<fresh uuid4>" }
```

Rules, all of which bite:

- **Sequentially, never in parallel.** Three gunicorn workers serve the whole
  API; three concurrent revises starve every other request, and two on the same
  project contend on the same rows.
- **A fresh `process_id` per attempt.** Reusing one is the replay guard and
  returns `409`. A retry that inherits its predecessor's id can never succeed.
- **`bom_module_id` is a LINKAGE id, not an `enterprise_bom_id`.** Sibling
  routes take the same value under the name `enterprise_bom_id`; only the revise
  route names it honestly.
- **One call per slot, not per quantity.** A slot can hold several rows; they
  all move together in that one call.
- **On `409` or a timeout, do not assume failure.** Poll
  `GET /organization/process/{process_id}/status/`. A timeout rolls back cleanly
  — the whole revise is one transaction — but the process record is written
  `RUNNING` before the work starts and the `FAILED` write never runs on a
  SIGKILL, so `RUNNING` past ~90s means *rolled back*, not *still going*. Retry
  with a **new** `process_id`.
- Report **per-slot** outcomes. Each call is its own transaction, so a failure
  partway leaves earlier slots moved and later ones untouched.

### Step C — user says NO

Nothing has been committed, so there is nothing to undo. Offer
`sheet_download_url` so the work is not lost.

One caveat worth surfacing in the UI: **the R5 draft already exists** in the BOM
directory, empty. It was created at step 1 so the sheet could be retargeted to
its code before upload. Declining leaves it there.

---

## 4. Two ids that are easy to confuse

| field | meaning | changes on revise? |
|---|---|---|
| `enterprise_bom_id` | one specific revision (R4, R5 …) | **yes** — new id each time |
| `base_bom_id` | the BOM itself, across all revisions | no |

A project stays linked to whichever revision it was added with. So looking a
project up by a fresh `enterprise_bom_id` returns **zero rows** — none of them
are on R5 yet, which is precisely what you are about to fix. Any project lookup
uses `base_bom_id` (in `details`).

Relatedly: never read a revision number off the `_Rn` suffix in `bom_code`.
Seven BOMs in `mainV2` disagree with their own name — `QAB1_R24` is v1,
`AMAAN-BUG-6-2` is v2 with no suffix at all. Use the `version` field.

---

## 5. Reference

Endpoint behaviour, slot semantics, timeout and idempotency rules:
`BOM_MAPPER_PROJECT_REVISE_API.md` in the backend repo.
