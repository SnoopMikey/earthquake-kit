# Earthquake Kit Tracker

A mobile-first PWA that tracks the contents of an earthquake emergency kit —
what's in it, when each item expires, and a monthly email digest of anything
expired or expiring within 90 days.

- **Frontend:** static HTML/CSS/JS, hosted on GitHub Pages
- **Database:** Airtable (one base, one `Items` table), accessed straight from
  the browser with a records-only personal access token
- **Barcode scanning:** camera via [html5-qrcode], product info auto-filled
  from Open Food Facts, falling back to UPCitemdb
- **Alerts:** Airtable scheduled automation → monthly email digest

> Note: the runtime Airtable token ships in the public page source by design.
> It is scoped to read/write records on this single base only.

## Setup

### 1. Create the Airtable base

Create a temporary setup token at <https://airtable.com/create/tokens> with
scopes `data.records:read`, `data.records:write`, `schema.bases:read`,
`schema.bases:write`, granted to your workspace. Then:

```sh
AIRTABLE_SETUP_TOKEN=pat... WORKSPACE_ID=wsp... ./setup/create_base.sh
```

The response contains the new base id (`app...`).

### 2. Create the runtime token

Make a second token with only `data.records:read` + `data.records:write`,
granted access to **only** the Earthquake Kit base. Put it and the base id
into `js/config.js`. Revoke the setup token.

### 3. Email automation (manual, in Airtable's UI)

Automations can't be created via API. In the base: **Automations → New
automation**:

1. Trigger **At scheduled time** — monthly, day 1, 9:00 AM.
2. Action **Find records** — table `Items`, where **any** of:
   - `Expiration Date` is before today
   - `Expiration Date` is within the next 90 days
3. **Conditional logic** — continue only if *length of records found* > 0.
4. Action **Send email** — to yourself, subject like
   `⛑️ Earthquake Kit: items need replacing`, and insert the found records
   (Name, Category, Quantity, Expiration Date) into the body as a grid.

### 4. Deploy

Push to a GitHub repo and enable GitHub Pages (deploy from branch, root).
The app must be served over HTTPS for camera access — GitHub Pages is.

## Local development

```sh
python3 -m http.server 4173
```

Until `js/config.js` has real credentials the app runs in **demo mode** with
sample in-memory data.

## Notes

- Barcodes identify the *product*, not its expiry — scanning fills in name,
  category, and photo; the expiration date is typed from the package (quick
  presets: 6 mo / 1 yr / 2 yr / 5 yr).
- "Expiring soon" = within 90 days (`soonDays` in `js/config.js`; keep the
  automation filter in sync if you change it).
- Airtable free plan limits: 1,000 records/base, 100 automation runs/month —
  a monthly digest uses 12/year.

[html5-qrcode]: https://github.com/mebjas/html5-qrcode
