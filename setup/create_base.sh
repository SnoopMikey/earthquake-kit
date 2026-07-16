#!/usr/bin/env bash
# Creates the "Earthquake Kit" Airtable base with the Items table.
# Usage:
#   AIRTABLE_SETUP_TOKEN=pat... WORKSPACE_ID=wsp... ./setup/create_base.sh
#
# Requires a personal access token with scopes:
#   data.records:read, data.records:write, schema.bases:read, schema.bases:write
# The token can be revoked after setup; the app itself uses a separate,
# records-only token.
set -euo pipefail

: "${AIRTABLE_SETUP_TOKEN:?Set AIRTABLE_SETUP_TOKEN (pat...)}"
: "${WORKSPACE_ID:?Set WORKSPACE_ID (wsp...)}"

curl -sS -X POST "https://api.airtable.com/v0/meta/bases" \
  -H "Authorization: Bearer ${AIRTABLE_SETUP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "name": "Earthquake Kit",
  "workspaceId": "${WORKSPACE_ID}",
  "tables": [
    {
      "name": "Items",
      "description": "Everything in the earthquake emergency kit",
      "fields": [
        { "name": "Name", "type": "singleLineText" },
        { "name": "Category", "type": "singleSelect", "options": { "choices": [
          { "name": "Water", "color": "blueBright" },
          { "name": "Food", "color": "orangeBright" },
          { "name": "First Aid", "color": "redBright" },
          { "name": "Medication", "color": "pinkBright" },
          { "name": "Light & Power", "color": "yellowBright" },
          { "name": "Tools", "color": "grayBright" },
          { "name": "Communication", "color": "purpleBright" },
          { "name": "Hygiene", "color": "tealBright" },
          { "name": "Documents & Cash", "color": "greenBright" },
          { "name": "Clothing & Warmth", "color": "cyanBright" },
          { "name": "Other", "color": "grayLight2" }
        ] } },
        { "name": "Quantity", "type": "number", "options": { "precision": 0 } },
        { "name": "Expiration Date", "type": "date", "options": { "dateFormat": { "name": "iso" } } },
        { "name": "Barcode", "type": "singleLineText" },
        { "name": "Photo", "type": "multipleAttachments" },
        { "name": "Notes", "type": "multilineText" },
        { "name": "Last Replaced", "type": "date", "options": { "dateFormat": { "name": "iso" } } }
      ]
    }
  ]
}
JSON
echo
