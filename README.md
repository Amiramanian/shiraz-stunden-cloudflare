# Shiraz Stunden – Cloudflare

Independent migration of the previous Base44 work-time app to Cloudflare.

## Current architecture

- React/Vite frontend (same work-time flow as the previous app)
- Cloudflare Worker API
- Cloudflare D1 database
- One Google Sheet named `کارکنان`
- Nightly Cloudflare Cron export to the same Google Sheet
- Cloudflare Access will protect the production domain

## Implemented in Phase 1

- StaffMember, Shift and Hinweis API routes
- Duplicate-shift protection
- D1 schema and indexes
- Soft-delete-ready columns and audit log
- Manual report refresh endpoint
- Nightly scheduled report refresh
- Google service-account authentication
- Google Sheets tab creation, data writing and formatting
- Existing frontend flow migrated away from the Base44 SDK

Photo scan and voice input intentionally return a clear “Phase 2” message until an AI provider is configured.

## Google Sheet

Spreadsheet ID:

```text
1XmfVLnebQ7NdLV2qh2nJ_qgPQPIQdqkgw178ZfCyyuY
```

The spreadsheet already contains these tabs:

- Bar
- Küche
- Service
- Fahrer
- Betriebsleiter
- Technik
- Personal Djadoo
- Technik Djadoo
- Catering
- Fr Bobrik
- hidden raw-data tabs

## Cloudflare setup order

1. Create D1 database: `shiraz-stunden-db`
2. Database ID is configured: `4d83d2e4-f227-4e77-b081-20600267ac00`
3. Migration applied successfully in the Cloudflare D1 Console (6 tables)
4. Create a Google Cloud service account and enable Google Sheets API
5. Share the Google Sheet `کارکنان` with the service-account email as Editor
6. Add Worker secrets:
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
7. Deploy: `npm run deploy`
8. Add custom domain, e.g. `stunden.shirazbar.store`
9. Protect the domain with Cloudflare Access
10. Set `REQUIRE_ACCESS=true` after Access is active

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Frontend: `http://localhost:5173`
Worker API: `http://127.0.0.1:8787`

## Scheduled time

The current cron is:

```text
15 2 * * *
```

Cloudflare cron uses UTC, so this runs at 04:15 in German summer time and 03:15 in German winter time.
