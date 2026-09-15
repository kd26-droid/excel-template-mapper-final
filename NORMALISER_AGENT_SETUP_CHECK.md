# Prompt: check my BOM Normaliser agent setup

Paste everything below the line into Claude Code, running from anywhere on the
machine you want to check.

---

I want to run the **BOM Normaliser agent**. Please verify my setup is correct and
fix whatever is wrong. Check things by running commands — do not assume.

There are three repos involved. Find them on this machine first (they may not be
in these exact paths):

| Repo | What it is | Expected branch |
|---|---|---|
| `excel-template-mapper-final` | the mapper — the agent lives here | `bom-normlaiser` |
| `PaaS` | the FactWise portal (Next.js) | `DashboardPaas` |
| `factwise-4.0` | the FactWise 4.0 backend | any — unchanged by this work |

Please check all of the following and report what you find as a table of
**check / expected / actual / verdict**, then fix anything broken.

## 1. Repos and branches

- Locate all three. If any is missing, say so and stop.
- Report the current branch of each.
- The mapper must be on a branch containing `backend/excel_mapper/agent.py`, and
  the portal on one containing
  `frontend/src/app/api/bom-mapper/agent/route.ts`. If either file is absent,
  the branch is wrong or the work was never pulled — tell me which, and do not
  try to write the files yourself.
- Report uncommitted changes in each, but do not commit, stash or revert
  anything.

## 2. The Azure key

`excel-template-mapper-final/backend/.env` must contain all four:

```
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_DEPLOYMENT      (should be a gpt-5.6 deployment)
AZURE_OPENAI_API_VERSION
AZURE_OPENAI_KEY
```

- Confirm the file exists and is gitignored (`git check-ignore -v backend/.env`).
- Report which variables are **present or missing — never print the key value.**
- If `AZURE_OPENAI_KEY` is missing, tell me; it is a secret I have to supply, and
  nothing else can substitute for it.
- Confirm the running mapper container actually has them loaded, not just the
  file on disk:
  `docker exec <mapper-backend-container> printenv AZURE_OPENAI_DEPLOYMENT`
  and separately report only the **length** of `AZURE_OPENAI_KEY`.

FactWise 4.0's own `backend/.env` key is for 4.0's agents and is **not** needed
here. Do not flag its absence as a problem.

## 3. The three services

Expected on this project's defaults:

| Service | Port | Check |
|---|---|---|
| FactWise 4.0 backend | `8001` | `GET /docs` returns 200 |
| mapper (via its frontend/nginx) | `3002` | `GET /api/health/` returns 200 |
| portal (Next dev server) | `3000` | `GET /` returns 200 |

The mapper also publishes its Django backend on `8002` and redis on `6380`, but
the agent is reached through **`3002/api/`**, so `3002` is the one that matters.

For each: report whether it is running, on which port, and whether it answers.
If something is not running, give me the command to start it:

```bash
# 4.0 backend
cd <factwise-4.0>/backend && docker compose up -d

# mapper
cd <excel-template-mapper-final> && \
  docker compose -f docker-compose.yml -f docker-compose.bom4-test.yml \
                 -p factwise-bom4-test up -d

# portal
cd <PaaS>/frontend && npm run dev
```

## 4. If my ports are different

Some of these ports are commonly already taken. **Prefer changing configuration
over changing our code.** In order of preference:

**(a) Point the portal at wherever things actually are.** This is the correct fix
and needs no code change. In `PaaS/frontend/.env.local`:

```ini
BOM_MAPPER_URL=http://localhost:<mapper port>      # default 3002
BACKEND_API_URL=http://localhost:<4.0 port>        # default 8001
NEXT_PUBLIC_APP_ORIGIN=http://localhost:<portal port>
```

Both are read at request time by
`PaaS/frontend/src/app/api/bom-mapper/agent/route.ts` and `../session/route.ts`.
Restart `npm run dev` after editing — Next does not reload `.env.local` on its
own.

**(b) Move the published port instead**, if I would rather keep the URLs. The
mapper's ports live in `docker-compose.bom4-test.yml` (`3002:80`, `8002:8000`,
`6380:6379`); 4.0's live in its own compose. Only change the **left** number.

**(c) Do not** edit hardcoded ports in application code. If you find one that
blocks this, tell me where it is instead of changing it.

Also check: if the portal runs on something other than `3000`, does the mapper's
`CORS_ALLOWED_ORIGINS` need it? (Probably not — the portal talks to the mapper
**server-side** through its own relay, so the browser never makes a cross-origin
request. Confirm rather than assume.)

## 5. End-to-end proof

Do not tell me it is fine because the services are up. Actually exercise it.

```bash
curl -s -X POST http://localhost:<mapper port>/api/agent/ \
  -F "file=@<some .xlsx BOM on this machine>" \
  -F "message=scrub this bom"
```

A correct setup returns JSON with `success: true`, a `conversation_id`, and a
`reply` that names a header row and shows sample rows from my file.

Common failures and what they mean:

- `"The agent is not configured: AZURE_OPENAI_KEY not set."` — step 2
- `"Could not reach the model."` — no network to Azure, or a bad endpoint
- `"The model returned an error (401)"` — the key is wrong or expired
- `404` on `/api/agent/` — the mapper is on the wrong branch, or its container
  needs restarting to pick up new Python
- connection refused — the mapper is not running, or not on that port

If you have no BOM file handy, say so rather than inventing one — but check
whether the endpoint exists at all:
a `POST` with no file should return a **400 asking for a spreadsheet**, not a 404.

Then, if step 3 showed the portal running, check the relay too:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:<portal port>/api/bom-mapper/agent \
  -H "Content-Type: application/json" -d '{"message":"hi"}'
```

`401` is the **correct** answer here — it means the route exists and its
sign-in check works. `404` means the portal is on the wrong branch or has not
reloaded.

## 6. One setting that silently breaks the import

In the mapper's **Settings → Item Directory Defaults**, `Procurement entity name`
must match an entity that actually exists in my FactWise. If it does not, the
normalising works, FactWise validation then fails on **every row** with
`procurement entity '<name>' is not found`, and it is not obvious why.

List the real entities:

```bash
curl -s http://localhost:<4.0 port>/enterprises/<enterprise_id>/entities \
     -H "Authorization: Bearer dev.<enterprise_id>.<user_id>"
```

and compare to the saved defaults:

```bash
docker exec <mapper-backend-container> python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','excel_mapping.settings'); django.setup()
from excel_mapper.models import EditorDefaultSettings
for r in EditorDefaultSettings.objects.all():
    print(r.entity_name, r.entity_id, (r.ui_defaults or {}).get('procurementEntityName'))
"
```

Report any mismatch. Having **no** saved defaults is fine — the agent just says
none were applied. Note that the **enterprise id is not the entity id**; they are
different things and are easy to confuse.

---

### Rules for you

- Run commands and report real output. Do not infer from file contents that
  something is running.
- Never print the Azure key. Presence and length only.
- Do not commit, push, stash or revert anything in any of the three repos.
- Do not edit application code to work around a port; change configuration and
  tell me.
- If something is broken and the fix touches a repo other than the mapper, tell
  me what you would change and wait — those are other people's repos.
- Finish with a short verdict: **ready**, or a numbered list of what I must do.
