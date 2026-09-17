# The BOM Normaliser agent

Turns a raw PLM/ERP export into a BOM inside FactWise, through a conversation in
the FactWise chat panel. Nobody opens the Normaliser UI.

You attach a spreadsheet, type *"scrub this bom"*, and answer five or six
questions. At the end the items and the BOM exist in FactWise.

---

## What it does

A BOM export is not an import sheet. The table usually starts several rows down,
the columns are named whatever that PLM calls them, the same part appears on
several rows, and nothing in the file says what assembly it all builds. The
Normaliser already fixed every one of those things — but only through its own UI,
so the knowledge of *which call, in what order, carrying what* lived in the
screens.

The agent is that knowledge, made callable.

### The seven checkpoints

| | It asks | Because |
|---|---|---|
| 1 | Is row 6 the header row? *(with sample rows)* | Detection is good, not certain |
| 2 | These columns were read as item code / description / qty — right? | An alias may be wrong |
| 3 | What is this BOM called? | A component list never says what it builds |
| 4 | Here is what filled the empty cells — all right? | The person should know what was written |
| 5 | Two rows disagree about this part. Which is correct? | Only a person knows |
| 6 | *(runs FactWise's validator)* | FactWise decides, not us |
| 7 | Import it — to which project? | |

One question per message. It stops and waits.

**Checkpoint 4 states the rule, not a tally.** Not *"36 cells changed"* but:

> Tag (2) was overwritten by the saved "tag rule 1": it assigns YAsh when Item
> code contains 1, 2, 3, or 4; and KArtik when it contains 6, 7, or 8.

---

## Setup

### 1. The Azure key

The only new secret. It is gitignored, so it will not arrive with the code — ask
whoever set this up for it.

```ini
# excel-template-mapper-final/backend/.env
AZURE_OPENAI_ENDPOINT=https://codexfw-sk-resource.cognitiveservices.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-5.6-terra
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_KEY=<the key>
```

Without it the agent answers: *"The agent is not configured: AZURE_OPENAI_KEY not
set."* — it says so plainly rather than failing oddly.

FactWise 4.0's own `backend/.env` key is for 4.0's agents. This does not need it.

### 2. Three things running

```bash
# FactWise 4.0 backend  -> :8001
cd 4.0/factwise-4.0/backend
docker compose up -d

# the mapper            -> :3002
cd excel-template-mapper-final
docker compose -f docker-compose.yml -f docker-compose.bom4-test.yml \
               -p factwise-bom4-test up -d

# the portal            -> :3000
cd 4.0/PaaS/frontend
npm run dev
```

Branches: mapper `bom-normlaiser`, portal `DashboardPaas`. FactWise 4.0 is
unchanged — use whatever branch you already have.

The mapper's frontend is a baked image, but nothing in it changed (Python only),
so no rebuild is needed.

### 3. The setting that will bite you

In the mapper, **Settings → Item Directory Defaults**, the `Procurement entity
name` must match an entity that actually exists in your FactWise.

If it does not, FactWise rejects **every row**:

```
procurement entity 'factwise' is not found      (x103)
```

Check what you actually have:

```bash
curl -s http://localhost:8001/enterprises/<enterprise_id>/entities \
     -H "Authorization: Bearer dev.<enterprise_id>.<user_id>"
```

Having no saved defaults at all is fine — the agent simply reports that none were
applied.

### 4. Use it

Open `localhost:3000`, attach a BOM, type **"scrub this bom"**.

---

## How it is wired

```
You, in the FactWise chat (:3000)
      |  attach sheet + "scrub this bom"
      v
Next.js server   /api/bom-mapper/agent        <- relay: the mapper sends no CORS
      |                                          headers, and fw_token is httpOnly
      v
Mapper (:3002)   /api/agent/  ->  gpt-5.6-terra
      |
      +-- its own endpoints: upload, roles/infer, field-patterns/apply,
      |   normaliser/continue, editor-defaults/apply, bom/validate, transforms/*
      |
      +-- FactWise 4.0 (:8001) via factwise40.py: validate, commit,
          projects, boms, project_add_bom
```

FactWise 4.0's **backend is not in this path**. The relay is the portal's own
Next.js server.

### Why the agent lives in the mapper

All fourteen of its tools are mapper endpoints, and so is the state — the file,
the normalised rows, the grid. In the mapper they are direct Python calls. In
4.0 every one would be an HTTP hop back to the mapper to do work that was always
going to happen there.

### What the model may and may not do

The model chooses which tool to call and writes the replies. It never writes a
cell. Every change goes through the endpoint the editor's own buttons call, so an
edit made in conversation and an edit made in the grid are the same edit,
validated the same way.

This mirrors 4.0's Item+BOM executor, which settled the shape first: the model
interprets, deterministic code writes, and nothing reaches a record without a
human saying yes.

### Routing

In `UniversalAgent.tsx`, above the spreadsheet branch:

```js
wantsNormalise = /scrub|scrubbing|normalise|normalize|normaliser|normalizer|
                  normalising|normalizing|clean|cleanup|tidy|sanitise|sanitize/i
routeToNormaliser = normaliserRun || (wantsNormalise && sheet)
```

It has to sit **above** the `.xlsx` check, because that branch routes on the file
alone and never reads the message. Without this, a raw export goes to 4.0's
importer and comes back as a wall of errors — the exact thing the Normaliser
exists to prevent.

Once a conversation is open, follow-up messages continue it.

---

## When something goes wrong

**"this conversation has no FactWise session"**
The conversation was started before a session was attached. Send another message —
it adopts credentials from any turn. If it persists, restart the Next dev server
so it picks up the relay route, then start a fresh chat.

**`Finished good <code> was not found` on import, but validation passed**
Validation checks that each line is well-formed; commit additionally requires the
finished good to exist. The combined export now appends a header row for it
(`Item code == BOM code`, `Level 0`), which is what 4.0's `_is_header_only_row`
looks for. A sheet built before that fix will still fail — build a fresh one.

**`procurement entity '<name>' is not found`, once per row**
See setup step 3. The saved default names an entity FactWise does not have.

**The reply looks canned and nothing happened**
In dev + Auto mode the portal catches a failed request and prints
`demoAgentReply()` instead, discarding the error. If a reply reads like a brochure,
the call failed. Check the mapper's logs.

**`403` on `/agent-assist/item-bom/runs`**
That is 4.0's own importer, not this. It needs an active `<module>:master` agent
row for the enterprise.

---

## Not finished

- **Project attach is untested.** Import with *no project* is verified end to
  end. `existing` and `new` are written but unexercised, and new-project creation
  was returning 422 for an unrelated reason (no enterprise-owned published
  PROJECT template).
- **No authentication on the mapper API.** Fine on a laptop. Anywhere shared,
  anyone who can reach `:3002` can read any session by id. Fix before deploying.
- **Conversations live in the cache**, 24h, lost on a redis flush.
- The 4.0 chat still routes plain `.xlsx` uploads to its own Item+BOM importer.
  Only the words above divert to the Normaliser.

---

## What changed

**Mapper** (`bom-normlaiser`)

| | |
|---|---|
| `backend/excel_mapper/agent.py` | new — prompt, 14 tools, model loop, conversation state |
| `backend/excel_mapper/urls.py` | registers `POST /api/agent/` |
| `backend/excel_mapper/views.py` | `_append_combined_finished_good()` — declares the finished good in the combined export |

**Portal** (`DashboardPaas`)

| | |
|---|---|
| `frontend/src/app/api/bom-mapper/agent/route.ts` | new — the relay, attaches the FactWise session |
| `frontend/src/components/agent/UniversalAgent.tsx` | the routing rule |

**FactWise 4.0** — no code changes.

### One fix worth knowing about

`_append_authored_finished_good()` only ran for `export_type == 'item'`, so the
combined (4.0) export never declared its finished good. The sheet said *"every
line belongs to BOM X"* while nothing in it said what X **is**. Validation passed
and commit failed with `Finished good not found`.

**This affected the editor's Export to FactWise button too**, not just the agent —
any BOM whose finished good did not already exist would have failed the same way.

### And one trap to avoid repeating

The enterprise id is **not** the entity id. The launch URL carries the enterprise
id under `entity_id` as well, for 3.0's benefit, so anything that believes that
field picks the wrong saved settings. The agent reads the real entity from
FactWise (`entities`) instead. `factwise40.py` documents this; it is easy to walk
into anyway.
