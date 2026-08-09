# Shiraz Stunden – Cloudflare

Independent migration of the previous Base44 work-time app to Cloudflare.

## Current architecture

- React/Vite frontend (same work-time flow as the previous app)
- Cloudflare Worker API
- Cloudflare D1 database
- One Google Sheet named `Arbeitszeiten – Shiraz & Djadoo`
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

Photo schedule scanning uses local OCR hints plus a four-provider fallback
chain: Cloudflare Mistral Vision, Cloudflare Gemma Vision, Cloudflare Moondream
OCR, and Google Gemini. Confirmed corrections are learned and Google Sheets
is synchronized immediately.

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
- Technik
- Personal Djadoo
- Catering (under Shiraz)
- Fr Bobrik
- hidden raw-data tabs

## Monthly Drive files

The Reports page can create one private Google Spreadsheet per selected month.
The month picker defaults to the next month, the file name is editable, and the
new file contains the same tabs and formatting but only shifts and notes from
the selected month. Existing monthly files stay listed on the Reports page.

Monthly files must be owned by the signed-in Google user, so they use a separate
OAuth grant with these scopes:

```text
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive.file
```

Store the OAuth values as Worker secrets:

```bash
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
```

`GOOGLE_DRIVE_FOLDER_ID` is set to the private Drive folder
`shiraz stunde data`, so all newly created monthly files are stored there.

## Cloudflare setup order

1. Create D1 database: `shiraz-stunden-db`
2. Database ID is configured: `4d83d2e4-f227-4e77-b081-20600267ac00`
3. Migration applied successfully in the Cloudflare D1 Console (6 tables)
4. Create a Google Cloud service account and enable Google Sheets API
5. Share the Google Sheet `Arbeitszeiten – Shiraz & Djadoo` with the service-account email as Editor
6. Add Worker secrets:
   - `APP_PIN`
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
   - Gemini reads the original photographed handwriting directly
   - Tesseract.js runs only for the optional detailed scan and supplies fallible OCR hints
   - The normal fast path uses one multimodal AI call and does not wait for local OCR

3. **AI Analysis** (Backend)
   - Gemini Flash returns one structured result for all uploaded images
   - The staff directory is never included in the extraction prompt, preventing roster hallucinations
   - Only rows with a handwritten name, start time, end time, and row evidence are accepted
   - The handwritten S./Summe value cross-checks the calculated duration
   - Every uploaded image is independent; filenames are audit labels only and never influence extraction or dates
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
   - Full-sheet rebuilds are serialized with a D1 lease so concurrent saves cannot clear each other

### Local Setup for Scanner

1. Copy `.dev.vars.example` to `.dev.vars`.

Create a free Gemini API key, then store it only in `.dev.vars` locally and as
an encrypted Worker secret in production. The three Cloudflare providers use
the configured Workers AI binding and need no additional key:

```bash
GEMINI_API_KEY=your-gemini-api-key
```

Get the key from [Google AI Studio](https://aistudio.google.com/app/apikey).

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
  "provider": "gemini",
  "warnings": [],
  "shifts": [
    {
      "employee": "raw name from image",
      "matchedEmployee": "corrected staff name",
      "date": "2024-01-15",
      "startTime": "09:00",
      "endTime": "17:00",
      "confidence": 0.95,
      "source": "cloudflare-mistral",
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
- All data APIs require a valid server-side PIN session (or Cloudflare Access)
- PIN sessions are random, stored as hashes in D1, expire after seven days, and use an HttpOnly/Secure/SameSite cookie
- PIN login attempts are rate-limited to five per minute per client address
- AI scans are rate-limited to twelve per minute per client address

### Provider behavior

- Cloudflare Mistral Vision is tried first.
- Cloudflare Gemma Vision and Cloudflare Moondream OCR are independent fallbacks.
- Gemini is the final fallback and is not retried after a quota-limit response.
- Each provider failure is returned separately and shown in the preview.
- A provider that returns no evidenced shift is treated as unsuccessful so the
  next provider is tried.
- A manual preview row is shown when no provider finds an evidenced row.
- Malformed or uncertain rows are not silently accepted and remain editable.

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
- `GEMINI_API_KEY` = Gemini API key

**Cloudflare Secrets** (Encrypt & store in Cloudflare):
- `APP_PIN` – four-digit application login PIN
- `GOOGLE_CLIENT_EMAIL` – Google service account email
- `GOOGLE_PRIVATE_KEY` – Google service account private key (full PEM format)
- `GEMINI_API_KEY` – Gemini authentication token

**Cloudflare Variables** (Non-secret, in wrangler.jsonc):
- `GEMINI_BASE_URL` = `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL` = `gemini-flash-latest`
- `GOOGLE_SPREADSHEET_ID` = Spreadsheet ID
- `GOOGLE_SHEET_URL` = Spreadsheet URL
- `APP_TIMEZONE` = `Europe/Berlin` (optional)

### Troubleshooting

**Provider status:**
- Open `/api/scan-shifts/status`
- The three Cloudflare providers and Gemini are reported independently.

**All providers unavailable:**
- The app opens a manual preview row instead of losing the scan
- Check the Workers AI binding and Gemini secret status

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


