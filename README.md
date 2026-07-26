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

## AI Schedule Scanner (Phase 3+)

A new AI-powered photo scan feature allows users to upload shift schedule photos for automatic processing.

### How it works

1. **Image Preprocessing** (Browser)
   - Images are downscaled and converted to grayscale with contrast enhancement
   - Canvas API processes images locally before sending to backend

2. **OCR Processing** (Browser, Local)
   - Tesseract.js runs OCR locally in the browser
   - German language recognition
   - No third-party OCR service needed

3. **AI Analysis** (Backend)
   - Preprocessed images are sent to FreeModel API
   - FreeModel extracts shift data with confidence scores
   - Name matching against staff directory with fuzzy matching

4. **Preview & Confirmation** (Browser)
   - All detected shifts shown with:
     - Confidence badge (green/yellow/red)
     - Source indicator (OCR/AI/Manual)
     - Editable fields for correction
   - User selects which shifts to save
   - Manual rows can be added before saving

5. **Background Export** (Worker)
   - Confirmed shifts saved to D1 immediately
   - Google Sheets export triggered asynchronously
   - User is not blocked waiting for export

### Local Setup for Scanner

1. Copy `.dev.vars.example` to `.dev.vars` and fill in FreeModel credentials:

```bash
FREEMODEL_API_KEY=your-api-key
FREEMODEL_MODEL=your-model-name
FREEMODEL_BASE_URL=https://api.your-freemodel-provider.com/v1/messages
```

2. Apply new D1 migration:

```bash
npm run db:migrate:local
```

This creates three new tables:
- `scan_aliases`: Learns employee name corrections for fuzzy matching
- `scan_history`: Audit trail of all scan jobs
- `scan_corrections`: Per-row corrections made during preview

3. Test the scanner:

```bash
npm run dev
```

Navigate to Shifts → Scan Shifts → upload schedule photos.

### Scanner API

**POST /api/scan-shifts**

Request:
```json
{
  "business": "Shiraz",
  "todayIso": "2024-01-15",
  "staffConfig": {
    "Shiraz": {
      "Bar": ["Manager", "Barista1", "Barista2"],
      "Küche": ["Chef", "Sous Chef"]
    }
  },
  "images": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."]
}
```

Response:
```json
{
  "scanId": "uuid",
  "shifts": [
    {
      "employee": "raw name from image",
      "matchedEmployee": "corrected staff name",
      "date": "2024-01-15",
      "startTime": "09:00",
      "endTime": "17:00",
      "confidence": 0.95,
      "source": "freemodel",
      "normalizedStart": "09:00",
      "normalizedEnd": "17:00",
      "matchedBusiness": "Shiraz",
      "matchedDepartment": "Bar"
    }
  ],
  "savedCount": 0,
  "skippedCount": 0
}
```

### Security & Limits

- Maximum 50 images per scan
- Individual images limited to 15MB
- Maximum 1000 shifts per response
- Date/time format validation
- Business value whitelisted
- Error messages sanitized to avoid API key leakage
- All requests logged to audit trail

### FreeModel Fallback

If FreeModel API is unavailable:
- User gets clear error message
- Scan is logged with error status
- No partial data is saved
- User can retry or enter manually

### Learning Aliases

Once a user corrects an employee name during preview, the mapping is learned:
- Raw name + department → staff name
- Fuzzy matching improves on retry
- Corrections tracked in scan_corrections table

### Troubleshooting

**No FreeModel key configured:**
- Add `FREEMODEL_API_KEY` to `.dev.vars`
- Restart `npm run dev`

**OCR is slow:**
- First run downloads Tesseract model (~60MB)
- Subsequent scans use cached model
- Consider running offline OCR during off-hours

**Poor recognition:**
- Preprocess images first (crop, rotate, enhance contrast)
- High-quality/clear photos work better
- Adjust confidence thresholds in UI if needed

**Google Sheets export blocked:**
- Check `GOOGLE_CLIENT_EMAIL` is in spreadsheet editors
- Verify `GOOGLE_SPREADSHEET_ID` is correct
- Check `GOOGLE_PRIVATE_KEY` formatting (include newlines)


