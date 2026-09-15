#!/usr/bin/env bash
# 48V_V2_BOM.xlsx -> editor, with no browser at any point.
set -euo pipefail

API=http://localhost:3002/api
SHEET="C:/Users/yashn/Downloads/48V_V2_BOM.xlsx"
SP="C:/Users/yashn/AppData/Local/Temp/claude/c--In-Progress-Factwise-Extras-excel-template-mapper-final/9aa88d6e-5cee-44f1-9cb9-ea24b228d05f/scratchpad"

say() { printf '\n────── %s\n' "$1"; }

say "1/6  UPLOAD"
MSYS_NO_PATHCONV=1 curl -s -X POST "$API/upload/" -F "clientFile=@$SHEET" --max-time 180 -o "$SP/s1.json"
SID=$(python -c "import json;print(json.load(open(r'$SP/s1.json'))['session_id'])")
python -c "
import json; d=json.load(open(r'$SP/s1.json'))
print('  session          ', d['session_id'])
print('  sheets           ', d.get('sheets'))
print('  header row       ', d.get('header_row'), '(detected', str(d.get('detected_header_row')) + ')')
print('  rows in sheet    ', d.get('total_rows'))
print('  headers          ', d.get('headers'))
"

say "2/6  ROLES"
curl -s -X POST "$API/bom/roles/infer/" -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SID\"}" --max-time 200 -o "$SP/s2.json"
python -c "
import json; d=json.load(open(r'$SP/s2.json'))
print('  roles            ', {k:v for k,v in (d.get('roles') or {}).items() if v})
bs = d.get('blockStructure') or {}
print('  blocks           ', bs.get('blockCount'), '| repeated headers', bs.get('repeatedHeaderRows'),
      '| title rows', bs.get('sectionTitleRows'))
for m in bs.get('roleMaps') or []:
    r = m.get('roles') or {}
    print('    row %-4s mpn=%-14r manufacturer=%r' % (m.get('sourceRow'), r.get('mpn'), r.get('manufacturer')))
"

say "3/6  QUESTIONS"
curl -s "$API/normaliser/$SID/state/" --max-time 60 -o "$SP/s3.json"
python -c "
import json; d=json.load(open(r'$SP/s3.json'))
for q in d.get('questions') or []:
    opts=', '.join('%s(%.2f)'%(o['value'],o['score'] or 0) for o in (q.get('options') or [])[:2])
    print('  %-22s answer=%-14s %s' % (q['id'], q.get('answer'), opts))
"

say "4/6  ANSWERS + the BOM gate"
curl -s -X POST "$API/normaliser/$SID/answers/" -H 'Content-Type: application/json' -d '{
  "config": {"identityLayout":"mpn_mfr_separate","rowPlacement":"same_row",
             "alternateLayout":"separate_columns","skipTitleRows":true,"skipRepeatedHeaders":true},
  "bomStructure": {"mode":"create","sheets":{"48V_V2 ":{
      "hasBom":true,"hasLevels":false,"levelColumn":null,"treeConfirmed":true,
      "bomGenerationAvailable":true,"dropDocuments":true,
      "bomHeader":{"finishedGoodCode":"48V-V2","bomCode":"48V-V2","itemName":"48V V2 assembly",
                   "bomName":"48V-V2","measurementUnit":"EA","baseQuantity":1},
      "subBoms":{}}}}
}' --max-time 60 -o "$SP/s4.json"
python -c "
import json; d=json.load(open(r'$SP/s4.json'))
print('  saved config     ', d.get('config'))
print('  finished good    ', ((list((d.get('bom_structure') or {}).get('sheets',{}).values()) or [{}])[0].get('bomHeader') or {}).get('finishedGoodCode'))
"

say "5/6  APPLY  (normalise)"
curl -s -X POST "$API/bom/field-patterns/apply/" -H 'Content-Type: application/json' -d "{
  \"session_id\": \"$SID\",
  \"roles\": {\"cpn\":\"\",\"mpn\":\"MPN\",\"manufacturer\":\"Manufacturer\",\"description\":\"Description\",
             \"quantity\":\"QTY\",\"uom\":\"\",\"notes\":\"\",\"internalNotes\":\"\",\"level\":\"\",\"parent\":\"\"},
  \"config\": {\"structure\":\"separate_cells\",\"rowPlacement\":\"same_row\",\"bomLayout\":\"none\",
              \"alternateLayout\":\"separate_columns\",\"delimiterMode\":\"auto\",\"groupHeaderMode\":\"auto\",
              \"manufacturerMode\":\"inherit_blank\",\"quantityMode\":\"inherit_primary\",
              \"skipTitleRows\":true,\"skipRepeatedHeaders\":true,\"skipDeletedRows\":true,
              \"parentPathLevels\":true,\"inheritLevels\":true,\"alternateColumnGroups\":[],
              \"patternParserOverrides\":[],\"fieldPatternRules\":{}},
  \"headerRowIndex\": 5, \"groups\": [], \"persist\": false
}" --max-time 300 -o "$SP/s5.json"
python -c "
import json; d=json.load(open(r'$SP/s5.json'))
if not d.get('success'): print('  FAILED:', str(d)[:300]); raise SystemExit(1)
p=d.get('progress') or {}
print('  processed        ', p.get('processed'), 'of', p.get('total'), '| output', p.get('outputRows'), '| skipped', p.get('skippedRows'))
rows=d.get('normalizedRows') or []
print('  first 3 rows:')
for r in rows[:3]:
    print('    row %-4s %-34s mpn=%-22s mfr=%s' % (r.get('sourceRow'), str(r.get('description'))[:33], str(r.get('mpn'))[:21], r.get('manufacturer')))
"

say "6/6  CONTINUE  (build the mapping sheet, make the session)"
curl -s -X POST "$API/normaliser/$SID/continue/" -H 'Content-Type: application/json' -d '{}' \
  --max-time 300 -o "$SP/s6.json"
python -c "
import json; d=json.load(open(r'$SP/s6.json'))
if not d.get('success'): print('  FAILED:', str(d)[:400]); raise SystemExit(1)
print('  rows carried     ', d.get('row_count'))
print('  new session      ', d.get('session_id'))
print()
print('  EDITOR:  http://localhost:3002' + d.get('editor_url',''))
print('  MAPPING: http://localhost:3002' + d.get('mapping_url',''))
"
