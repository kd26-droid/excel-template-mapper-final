# Prompt: bootstrap a FactWise 4.0 dev enterprise

Paste everything below the line into Claude Code on the machine that needs it.

It creates the Vendor and Project templates an enterprise needs before the vendor
designer will save and before any project can be created — and fixes the other
gaps that usually sit behind those two.

---

I'm running FactWise 4.0 locally and I need my enterprise bootstrapped. The
vendor template designer won't save, and/or creating a project fails. Please
diagnose and fix it.

Work it out by running commands — don't assume, and tell me what you find before
you change anything.

## First, find my details

The 4.0 backend is usually on `http://localhost:8001`. Confirm it answers
(`GET /docs` → 200) and tell me if it isn't running.

My dev token is the `fw_token` cookie on the portal, shaped
`dev.<enterprise_id>.<user_id>`. Get it from my browser devtools, or ask me. From
it, the middle segment is my enterprise id and the last is my user id. Everything
below uses:

```bash
API=http://localhost:8001
TOK="dev.<enterprise_id>.<user_id>"
EID=<enterprise_id>
UID=<user_id>
```

On Windows/Git Bash, prefix every curl with `MSYS_NO_PATHCONV=1` or the paths get
mangled.

## What to check

Report these as a table — **check / expected / actual** — before fixing anything.

**1. Does my enterprise actually exist as a row?**

```sql
SELECT count(*) FROM enterprises WHERE enterprise_id='<EID>';
SELECT count(*) FROM users       WHERE user_id='<UID>';
SELECT count(*) FROM entities    WHERE enterprise_id='<EID>';
```

The dev token is trusted without a database lookup, so an enterprise can be in
daily use while having no row at all. If any of these is 0, say so — it's the
root cause of most of the rest, and several tables have real foreign keys to
`enterprises`, so nothing else will insert until it exists.

**2. Which templates does my enterprise own?**

```sql
SELECT template_code, module_code, lifecycle_status
FROM templates WHERE created_by_enterprise_id='<EID>' AND is_deleted=false;
```

I need a `VENDOR_MASTER` and a `PROJECT` one. Both lookups require a template the
enterprise **owns** — `created_by_enterprise_id = my id`. The `SYSTEM_*`
templates have that column NULL and never satisfy it; they are blueprints to be
cloned.

**3. Do I have permissions?**

```bash
curl -s "$API/me/permissions" -H "Authorization: Bearer $TOK"
```

`{"codes":[]}` means none. Permissions come from a workspace membership carrying
a role, so also check:

```sql
SELECT count(*) FROM workspace_memberships WHERE user_id='<UID>';
SELECT count(*) FROM roles;
```

## What to fix

### The enterprise, user and entity rows (only if missing)

Direct inserts, because there is no signup flow to run:

```sql
INSERT INTO users (user_id, auth_provider, is_email_verified, global_status)
VALUES ('<UID>', 'internal', true, 'active') ON CONFLICT DO NOTHING;

INSERT INTO enterprises (enterprise_id, legal_name, display_name, status)
VALUES ('<EID>', '<a name>', '<a name>', 'active') ON CONFLICT DO NOTHING;

INSERT INTO entities (entity_id, enterprise_id, legal_name, display_name, status)
VALUES (gen_random_uuid(), '<EID>', '<entity name>', '<entity name>', 'verified_active')
ON CONFLICT DO NOTHING;
```

`entities.status` is an enum — valid values are `draft`, `setup_pending`,
`submitted_for_verification`, `verified_active`, `verification_rejected`,
`suspended`, `archived`. **`active` is not one of them** and will make
`GET /entities` return 500.

An enterprise id is **not** an entity id. They are different things; a project
belongs to an entity.

### The Vendor template

One call. There is no system blueprint for vendor, so create it outright:

```bash
curl -X POST "$API/enterprises/$EID/templates" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"template_code":"VENDOR_MASTER","template_name":"Vendor Master",
       "module_code":"VENDOR_MASTER","enables_vendor":true}'
```

DRAFT is fine — the vendor field-schema endpoint does not require a published
version.

### The Project template

Clone the system blueprint, then **publish** it:

```bash
SYS=<template_id of SYSTEM_PROJECT>      # from the templates table

TPL=$(curl -s -X POST "$API/enterprises/$EID/templates/$SYS/clone" \
      -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
      -d '{"template_code":"PROJECT_DEFAULT","template_name":"Default Project"}' \
      | python -c "import sys,json;print(json.load(sys.stdin)['template_id'])")

curl -X POST "$API/enterprises/$EID/templates/$TPL/publish" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{}'
```

**Do not skip the publish.** A clone lands as DRAFT with no usable version, and
project creation then fails with *"a project must be created from a published
template version"* — which does not obviously point at a missing publish.

### Permissions (only if `/me/permissions` was empty)

Some permission codes the import path requires are not in the seed at all
(`tags.*`, `projects.*`, `boms.edit_all`). Check before inserting, and tell me
which ones you had to invent — if the 4.0 team seeds them later, mine may not
match their spelling.

```sql
-- add only the codes that are genuinely absent
INSERT INTO permissions (permission_id, code, module, action, description,
                         is_external, is_template, is_active)
SELECT gen_random_uuid(), c.code, split_part(c.code,'.',1), split_part(c.code,'.',2),
       replace(split_part(c.code,'.',2),'_',' ')||' on '||split_part(c.code,'.',1),
       false, false, true
FROM (VALUES ('tags.create'),('tags.edit_all'),('tags.view_all'),
             ('projects.create'),('projects.edit_all'),('projects.view_all'),
             ('boms.edit_all')) AS c(code)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code=c.code AND p.is_deleted=false);

-- grant every internal permission to me
INSERT INTO direct_grants (direct_grant_id, enterprise_id, user_id, permission_code,
                           granted_by_user_id, reason, status)
SELECT gen_random_uuid(), '<EID>', '<UID>', p.code, '<UID>',
       'Dev bootstrap: enterprise created outside the normal signup path.', 'active'
FROM permissions p
WHERE p.is_deleted=false AND p.is_external=false
  AND NOT EXISTS (SELECT 1 FROM direct_grants d
                  WHERE d.user_id='<UID>' AND d.enterprise_id='<EID>'
                    AND d.permission_code=p.code AND d.is_deleted=false);
```

This is a dev shortcut, not how the product works — real access comes from a
workspace membership with a role. Say so in your summary so I know what I'm
carrying.

## Prove it worked

Don't tell me it's fixed because the inserts succeeded. Actually exercise it:

```bash
# entities must return 200 with at least one row
curl -s "$API/enterprises/$EID/entities" -H "Authorization: Bearer $TOK"

# creating a project must return 201
curl -s -X POST "$API/enterprises/$EID/projects" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"entity_id":"<entity_id>","project_name":"Bootstrap smoke test"}'

# permissions must be non-empty
curl -s "$API/me/permissions" -H "Authorization: Bearer $TOK"
```

Then tell me to reload `/templates/vendor` and check it saves.

Delete the smoke-test project afterwards, or tell me it's there.

## One warning before you restart anything

Check whether `backend/start-server.sh` still runs this line:

```bash
python -m app.db.dev_schema_guard
```

If it does, **tell me before restarting the 4.0 container.** That guard runs
`DROP SCHEMA public CASCADE` whenever `enterprises` has an `enterprise_id`
primary key and no `id` column — which is exactly what migration
`0104_pk_table_specific_names` produces on every migration to head. It therefore
fires on **every** boot, silently, with no backup, and wipes the entire database.

Verify before deciding:

```sql
SELECT bool_or(column_name='id') AS has_id
FROM information_schema.columns WHERE table_name='enterprises';
```

`has_id = false` means the next restart will wipe everything. If so, recommend
commenting that line out locally (leave it uncommitted — it's the 4.0 team's
file) and tell me, rather than restarting and finding out.

---

### Rules for you

- Run commands and report real output; don't infer state from source code.
- Show me what's wrong before you change anything.
- Never print my token in full.
- Don't commit, push or revert anything in the 4.0 repo.
- Flag every direct SQL insert you make, so I know what's hand-built rather than
  created by the product.
- Finish with a short verdict: **ready**, or a numbered list of what's still
  broken.
