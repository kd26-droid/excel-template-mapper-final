#!/usr/bin/env bash
# The whole BOM Normaliser flow with no browser: upload -> map -> export -> validate -> commit -> attach.
set -euo pipefail

MAPPER=http://localhost:3002/api
FW=http://localhost:8001
EID=2827d119-7b0b-46fb-b461-657471b2f148
TOK="dev.$EID.e5c8116b-5016-491c-84e4-d5f8af3868b8"
SP="C:/Users/yashn/AppData/Local/Temp/claude/c--In-Progress-Factwise-Extras-excel-template-mapper-final/f2de3dee-fffc-4782-9e53-67c12fd6772c/scratchpad"
SHEET="$SP/headless.xlsx"

say() { printf '\n=== %s ===\n' "$1"; }

# 1. Upload, answering the BOM structure gate in the same call.
say "1. UPLOAD (+ BOM structure gate)"
BOMSTRUCT='{"mode":"create","sheets":{"Sheet1":{"hasBom":true,"hasLevels":true,"levelColumn":"Level","treeConfirmed":true,"bomGenerationAvailable":true,"dropDocuments":true,"bomHeader":{"finishedGoodCode":"HL-FG","bomCode":"HL-FG","itemName":"Headless assembly","bomName":"HL-FG","measurementUnit":"EA","baseQuantity":1},"subBoms":{}}}}'
SID=$(MSYS_NO_PATHCONV=1 curl -s -X POST "$MAPPER/upload/" \
  -F "clientFile=@$SHEET" \
  -F "bomStructure=$BOMSTRUCT" \
  --max-time 120 | python -c "import sys,json; print(json.load(sys.stdin)['session_id'])")
echo "session_id: $SID"

# 2. Map the source columns onto the FactWise template.
say "2. SAVE MAPPINGS"
curl -s -X POST "$MAPPER/mapping/save/" -H 'Content-Type: application/json' -d "{
  \"session_id\": \"$SID\",
  \"mappings\": {
    \"Item code\": \"Item code\",
    \"Item name\": \"Item name\",
    \"Item type\": \"Item type\",
    \"Measurement unit\": \"Measurement unit\",
    \"Procurement entity name\": \"Procurement entity name\",
    \"Level\": \"Level\",
    \"Quantity\": \"Quantity\"
  }}" --max-time 120 | head -c 120; echo

# 3. The combined 4.0 sheet, with BOM code / Finished good code derived from the tree.
say "3. EXPORT (export_type: raw)"
MSYS_NO_PATHCONV=1 curl -s -o "$SP/hl_raw.xlsx" -X POST "$MAPPER/download/" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SID\",\"format\":\"excel\",\"export_type\":\"raw\"}" --max-time 120
python -c "
import openpyxl
ws = openpyxl.load_workbook(r'$SP/hl_raw.xlsx').active
h = [c.value for c in ws[1]]
keep = [n for n in ('Item code','Level','Quantity','BOM code','Finished good code') if n in h]
i = {n: h.index(n) for n in keep}
print('derived columns present:', keep)
for r in ws.iter_rows(min_row=2, values_only=True):
    print('   ', [str(r[i[n]]) for n in keep])
"

# 4. FactWise decides whether it is importable. Nothing local.
say "4. VALIDATE (FactWise 4.0)"
MSYS_NO_PATHCONV=1 curl -s -X POST "$MAPPER/factwise40/validate/" \
  -F "file=@$SP/hl_raw.xlsx" -F "api_url=$FW" -F "enterprise_id=$EID" -F "token=$TOK" \
  --max-time 200 | python -c "
import sys, json
r = json.load(sys.stdin).get('result') or {}
print('ok:', r.get('ok'), ' rows:', r.get('row_count'), ' errors:', r.get('error_count'))
for e in (r.get('errors') or [])[:5]:
    print('   row %s / %s: %s' % (e['row'], e['column'], e['message']))
"

# 5. Create the items and the BOM.
say "5. COMMIT"
MSYS_NO_PATHCONV=1 curl -s -o "$SP/hl_commit.json" -X POST "$MAPPER/factwise40/validate/" \
  -F "file=@$SP/hl_raw.xlsx" -F "action=commit" -F "api_url=$FW" -F "enterprise_id=$EID" -F "token=$TOK" \
  --max-time 200
python -c "
import json
d = json.load(open(r'$SP/hl_commit.json'))
r = d.get('result') or {}
print('committed:', r.get('committed'), '| created:', r.get('created'),
      '| updated:', r.get('updated'), '| already there:', r.get('skipped_existing'))
print('bom codes in the sheet:', d.get('bom_codes'))
"

# 6. Commit reports counts, not ids - so find the BOM by the code the sheet carried.
say "6. FIND THE BOM"
curl -s -X POST "$MAPPER/factwise40/call/" -H 'Content-Type: application/json' \
  -d "{\"op\":\"boms_list\",\"api_url\":\"$FW\",\"enterprise_id\":\"$EID\",\"token\":\"$TOK\"}" \
  --max-time 60 | python -c "
import sys, json
for b in json.load(sys.stdin).get('result') or []:
    if b.get('bom_code','').startswith('HL-'):
        print('   %-10s v%-3s %s' % (b['bom_code'], b['version'], b['enterprise_bom_id']))
        open(r'$SP/hl_bom.txt','w').write(b['enterprise_bom_id'])
"

# 7. Pull it into a project.
say "7. ATTACH TO A PROJECT"
PID=$(curl -s -X POST "$MAPPER/factwise40/call/" -H 'Content-Type: application/json' \
  -d "{\"op\":\"projects_list\",\"api_url\":\"$FW\",\"enterprise_id\":\"$EID\",\"token\":\"$TOK\"}" \
  --max-time 60 | python -c "
import sys, json
items = (json.load(sys.stdin).get('result') or {}).get('items') or []
print(items[0]['id'] if items else '')
")
BOMID=$(cat "$SP/hl_bom.txt")
if [ -n "$PID" ]; then
  curl -s -X POST "$MAPPER/factwise40/call/" -H 'Content-Type: application/json' \
    -d "{\"op\":\"project_add_bom\",\"api_url\":\"$FW\",\"enterprise_id\":\"$EID\",\"token\":\"$TOK\",\"project_id\":\"$PID\",\"body\":{\"enterprise_bom_id\":\"$BOMID\"}}" \
    --max-time 60 | python -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result') or {}
print('attached:', d.get('success'), '| bom:', r.get('bom_code'), '| project_bom_id:', r.get('project_bom_id'))
" || echo "attach failed"
else
  echo "no existing project to attach to"
fi

printf '\n=== DONE - no browser involved ===\n'
