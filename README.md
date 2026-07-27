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

Photo schedule scanning is implemented with local OCR, Cloudflare Workers AI, and optional Groq/FreeModel fallbacks. Voice input still returns a clear Phase 2 message.

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
   - A color-preserving copy is downscaled for cloud handwriting recognition
   - A second grayscale, contrast-enhanced copy is created for local OCR hints
   - Canvas API processes both copies locally before sending to the backend

2. **OCR Processing**
   - Tesseract.js runs optional German OCR locally in the browser
   - Cloudflare Workers AI `toMarkdown` reads the original photographed handwriting
   - Local OCR errors no longer block the cloud extraction path

3. **AI Analysis** (Backend)
   - Cloud image transcription and optional local OCR are structured by Llama 3.3 70B
   - The staff directory is never included in the extraction prompt, preventing roster hallucinations
   - Only rows with a handwritten name, start time, end time, and row evidence are accepted
   - The handwritten S./Summe value cross-checks the calculated duration
   - Every uploaded image is independent; filenames are audit labels only and never influence extraction or dates
   - Groq Qwen 3.6 is used when configured and the primary provider is unavailable
   - FreeModel remains an optional final fallback
   - Missing or invalid dates stay empty for review; they are never replaced with today's date
   - Staff names are matched only after extraction, using aliases, exact matches, or strict fuzzy limits

4. **Preview & Confirmation** (Browser)
   - All detected shifts shown with:
     - Confidence badge (green/yellow/red)
     - Source indicator (OCR/AI/Manual)
     - Source image, row evidence, and written total
     - Review reason for uncertain names, dates, handwriting, or hour mismatches
     - Editable fields for correction
     - Responsive cards, explicit 24-hour time fields, and the selected-hour total
   - Only high-confidence rows are preselected
   - Manual rows can be added before saving

5. **Save, Learning, and Spreadsheet Sync** (Worker)
   - Confirmed shifts saved to D1 immediately
   - Duplicate shifts are ignored safely
   - User corrections are stored idempotently; name and department aliases are applied to later scans
   - Google Sheets is updated before the save response returns, so no manual refresh/export is required

### Local Setup for Scanner

1. Copy `.dev.vars.example` to `.dev.vars`.

Cloudflare Workers AI uses the `AI` binding and requires no API key. Groq and
FreeModel are optional fallbacks:

```bash
GROQ_API_KEY=your-groq-api-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=qwen/qwen3.6-27b

FREEMODEL_API_KEY=your-freemodel-api-key
FREEMODEL_BASE_URL=https://api.freemodel.dev/v1
FREEMODEL_MODEL=gpt-5.6-sol
```

Get a Groq key from [console.groq.com/keys](https://console.groq.com/keys).
FreeModel can be configured from [freemodel.dev](https://freemodel.dev).

2. Apply new D1 migration:

```bash
npm run db:migrate:local
```

The migrations create three scanner tables and extend them with structured,
idempotent correction memory:
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
  "images": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."],
  "imageNames": ["optional-display-label.jpeg"],
  "ocrTexts": ["local OCR text for image 1", "local OCR text for image 2"]
}
```

Response:
```json
{
  "scanId": "uuid",
  "provider": "workers-ai",
  "warnings": [],
  "shifts": [
    {
      "employee": "raw name from image",
      "matchedEmployee": "corrected staff name",
      "date": "2024-01-15",
      "startTime": "09:00",
      "endTime": "17:00",
      "confidence": 0.95,
      "source": "workers-ai",
      "normalizedStart": "09:00",
      "normalizedEnd": "17:00",
      "matchedBusiness": "Shiraz",
      "matchedDepartment": "Bar",
      "imageName": "1.jpeg",
      "evidence": "Manager | 09:00 | 17:00 | 8",
      "writtenHours": "8",
      "needsReview": false,
      "reviewReasons": []
    }
  ],
  "savedCount": 0,
  "skippedCount": 0
}
```

### Security & Limits

- Maximum 10 images per scan
- Individual images limited to 8MB
- Maximum 30 extracted rows per image
- OCR text is limited per image and in total
- Date normalization and per-row validation
- Business value whitelisted
- Error messages sanitized to avoid API key leakage
- All requests logged to audit trail

### Provider Fallback

Provider order:

1. Cloudflare image-to-Markdown plus Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
2. Groq (`qwen/qwen3.6-27b`) when `GROQ_API_KEY` is configured
3. FreeModel when `FREEMODEL_API_KEY` is configured
4. Manual preview row when all automatic providers are unavailable or no evidenced row is found

Retryable provider failures are retried once before moving to the next
provider. A valid zero-row result is trusted instead of asking later providers
to invent data. Malformed rows are skipped, uncertain rows are left unselected,
and warnings are shown in the preview.

### Learning Aliases

Once a user corrects an employee name during preview, the mapping is learned:
- Raw name + raw department → corrected staff name + corrected department
- Strict matching applies only after extraction
- Date and time edits are retained in the structured correction history
- Duplicate correction submissions do not increase the learning count twice

### Environment Configuration

**Local Development** (`.dev.vars`):
- `GOOGLE_CLIENT_EMAIL` = service account email
- `GOOGLE_PRIVATE_KEY` = full private key with newlines
- `GOOGLE_SPREADSHEET_ID` = spreadsheet ID (optional if in wrangler.jsonc)
- `GROQ_API_KEY` = optional Groq fallback key
- `FREEMODEL_API_KEY` = optional final fallback key

**Cloudflare Secrets** (Encrypt & store in Cloudflare):
- `GOOGLE_CLIENT_EMAIL` – Google service account email
- `GOOGLE_PRIVATE_KEY` – Google service account private key (full PEM format)
- `GROQ_API_KEY` – optional Groq authentication token
- `FREEMODEL_API_KEY` – optional FreeModel authentication token

**Cloudflare Variables** (Non-secret, in wrangler.jsonc):
- `WORKERS_AI_MODEL` = `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (conservative structured extraction)
- `WORKERS_AI_VISION_MODEL` = `@cf/meta/llama-4-scout-17b-16e-instruct` (reserved vision model)
- `GROQ_BASE_URL` = `https://api.groq.com/openai/v1`
- `GROQ_MODEL` = `qwen/qwen3.6-27b`
- `FREEMODEL_BASE_URL` = `https://api.freemodel.dev/v1`
- `FREEMODEL_MODEL` = `gpt-5.6-sol`
- `GOOGLE_SPREADSHEET_ID` = Spreadsheet ID
- `GOOGLE_SHEET_URL` = Spreadsheet URL
- `APP_TIMEZONE` = `Europe/Berlin` (optional)

### Troubleshooting

**Provider status:**
- Open `/api/scan-shifts/status`
- `workersAi` should be `true`
- Groq and FreeModel show whether their optional secrets are configured

**All providers unavailable:**
- The app opens a manual preview row instead of losing the scan
- Check Workers AI usage and provider status
- Add `GROQ_API_KEY` for an independent fallback

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


