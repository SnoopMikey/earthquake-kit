#!/usr/bin/env bash
# Schema update (2026-07): adds the "Kitchen" category choice and creates the
# "Evacuation" checklist table on the existing base.
# Usage:
#   AIRTABLE_SETUP_TOKEN=pat... AIRTABLE_RECORDS_TOKEN=pat... ./setup/update_schema.sh
#
#   AIRTABLE_SETUP_TOKEN    needs schema.bases:read + schema.bases:write
#   AIRTABLE_RECORDS_TOKEN  needs data.records:read + data.records:write
#                           (the app's runtime token works)
#
# Note: Airtable's field-update API cannot modify select options — new
# choices are instead created by writing a temporary record with
# `typecast: true`, then deleting it.
set -euo pipefail

: "${AIRTABLE_SETUP_TOKEN:?Set AIRTABLE_SETUP_TOKEN (pat...)}"
: "${AIRTABLE_RECORDS_TOKEN:?Set AIRTABLE_RECORDS_TOKEN (pat...)}"

BASE="appd8hZ3F0sOhoxo7"

echo "== Adding Kitchen choice to Category (via typecast seed record) =="
REC_ID=$(curl -sS -X POST "https://api.airtable.com/v0/${BASE}/Items" \
  -H "Authorization: Bearer ${AIRTABLE_RECORDS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Name":"__kitchen_option_seed__","Category":"Kitchen"},"typecast":true}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -sS -X DELETE "https://api.airtable.com/v0/${BASE}/Items/${REC_ID}" \
  -H "Authorization: Bearer ${AIRTABLE_RECORDS_TOKEN}"
echo

echo "== Creating Evacuation table =="
curl -sS -X POST "https://api.airtable.com/v0/meta/bases/${BASE}/tables" \
  -H "Authorization: Bearer ${AIRTABLE_SETUP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "name": "Evacuation",
  "description": "Grab-and-go checklist for evacuation — things not stored in the kit",
  "fields": [
    { "name": "Item", "type": "singleLineText" },
    { "name": "Notes", "type": "multilineText" },
    { "name": "Packed", "type": "checkbox", "options": { "icon": "check", "color": "greenBright" } }
  ]
}
JSON
echo
