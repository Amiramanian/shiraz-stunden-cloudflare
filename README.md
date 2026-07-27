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

Photo schedule scanning uses Google Gemini multimodal vision with optional local
OCR hints. Voice entry uses Groq Whisper for transcription and Gemini for
structured extraction, with automatic Gemini audio fallback. Both flows share
the same correction learning and Google Sheets synchronization.

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

### Voice entry

- The browser records with `MediaRecorder` and sends a bounded audio data URL to the Worker.
- Groq `whisper-large-v3-turbo` transcribes German, Persian, English, or mixed speech.
- Gemini extracts one date and 24-hour time range against the server-side staff directory.
- If Groq is unavailable, Gemini processes the audio directly.
- Known and learned aliases are applied without merging numeric names such as `Amir2` with `Amir`.
- The editable preview shows the transcript, review reasons, and calculated hours.
- Confirming a corrected voice entry stores the correction and synchronizes Google Sheets immediately.

### Local Setup for Scanner

1. Copy `.dev.vars.example` to `.dev.vars`.

Create free API keys for Gemini and Groq, then store them only in `.dev.vars`
locally and as encrypted Worker secrets in production:

```bash
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key
```

Get keys from [Google AI Studio](https://aistudio.google.com/app/apikey) and
[Groq Console](https://console.groq.com/keys).

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
      "source": "gemini",
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

### Provider behavior

- Gemini is the photo scanner and structured extraction provider.
- Groq Whisper is the preferred voice transcription provider.
- Gemini processes voice directly when Groq is temporarily unavailable.
- A manual preview row is shown when no evidenced photo row is found.
- Retryable provider failures are retried once. Malformed or uncertain rows are
  not silently accepted and remain editable in the preview.

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
- `GROQ_API_KEY` = Groq API key

**Cloudflare Secrets** (Encrypt & store in Cloudflare):
- `GOOGLE_CLIENT_EMAIL` – Google service account email
- `GOOGLE_PRIVATE_KEY` – Google service account private key (full PEM format)
- `GEMINI_API_KEY` – Gemini authentication token
- `GROQ_API_KEY` – Groq authentication token

**Cloudflare Variables** (Non-secret, in wrangler.jsonc):
- `GEMINI_BASE_URL` = `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL` = `gemini-flash-latest`
- `GROQ_BASE_URL` = `https://api.groq.com/openai/v1`
- `GROQ_SPEECH_MODEL` = `whisper-large-v3-turbo`
- `GOOGLE_SPREADSHEET_ID` = Spreadsheet ID
- `GOOGLE_SHEET_URL` = Spreadsheet URL
- `APP_TIMEZONE` = `Europe/Berlin` (optional)

### Troubleshooting

**Provider status:**
- Open `/api/scan-shifts/status`
- `gemini` and `groq` should both be `true`

**All providers unavailable:**
- The app opens a manual preview row instead of losing the scan
- Check the Gemini and Groq secret status

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


