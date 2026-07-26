import type { Env } from './types';
// @ts-ignore - shared frontend/backend libs without type declarations
import { buildStaffDirectoryText, normalizeForMatch, levenshtein, buildFlatStaffList, resolveShiftMatch } from '../src/lib/shiftMatching';
// @ts-ignore - shared frontend/backend libs without type declarations
import { normalizePersonName } from '../src/lib/staffConfig';
// @ts-ignore - shared frontend/backend libs without type declarations
import { calculateDurationHours, normalizeTimeString } from '../src/lib/timeUtils';
import { createScanHistory, updateScanHistory, getScanAlias, createOrUpdateScanAlias, createScanCorrection } from './db';

export interface ScannedShiftRaw {
  employee: string;
  department?: string;
  date: string;
  startTime: string;
  endTime: string;
  confidence?: number;
  source?: string;
}

export interface ScanRequest {
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  todayIso: string;
  staffConfig: Record<string, Record<string, string[]>>;
  images: string[]; // base64 JPEG data URLs
}

export interface ScanResponse {
  scanId: string;
  shifts: Array<ScannedShiftRaw & { matchedBusiness: string; matchedDepartment: string; matchedEmployee: string; normalizedStart: string; normalizedEnd: string }>;
  savedCount: number;
  skippedCount: number;
}

async function callFreeModel(
  images: string[],
  business: string,
  date: string,
  staffDirectory: string,
  schema: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<ScannedShiftRaw[]> {
  const imageObjects = images.map((dataUrl) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.replace(/^data:image\/jpeg;base64,/, '') }
  }));

  const systemPrompt = `You are an expert schedule scanner. Extract shift information from schedule images.
Return ONLY a valid JSON object with this structure:
{
  "shifts": [
    {
      "employee": "Name",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "confidence": 0.95
    }
  ]
}

${schema}`;

  const userPrompt = `Business: ${business}
Date context: ${date}

Staff directory (for reference):
${staffDirectory}

Extract all shifts visible in the provided schedule image(s). Use the staff directory to match employee names when possible. Return only the JSON structure, no other text.`;

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            ...imageObjects,
            {
              type: 'text',
              text: userPrompt
            }
          ]
        }
      ],
      system: systemPrompt,
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FreeModel API error (${response.status}): ${error}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const choicesArray = data.choices as Array<Record<string, unknown>>;
  const content = choicesArray?.[0]?.message as Record<string, unknown> | undefined;
  const contentText = content?.content as string | undefined;

  if (!contentText) {
    throw new Error('No response from FreeModel');
  }

  const jsonMatch = contentText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in FreeModel response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  const shifts = (parsed.shifts as Array<Record<string, unknown>>) || [];

  return shifts.map((shift) => ({
    employee: String(shift.employee || ''),
    date: String(shift.date || ''),
    startTime: String(shift.startTime || ''),
    endTime: String(shift.endTime || ''),
    confidence: Number(shift.confidence) || 0.5,
    source: 'freemodel'
  }));
}

export async function processScanRequest(
  env: Env,
  request: ScanRequest,
  actorEmail: string | null
): Promise<ScanResponse> {
  const scanId = crypto.randomUUID();

  try {
    // Create scan history entry
    await createScanHistory(env, scanId, request.business, actorEmail, request.images.length);

    // Validate inputs with security limits
    if (!request.images || request.images.length === 0) {
      throw new Error('No images provided');
    }
    if (request.images.length > 50) {
      throw new Error('Maximum 50 images per scan');
    }

    // Validate image MIME types and size
    for (let i = 0; i < request.images.length; i++) {
      const image = request.images[i];
      if (typeof image !== 'string') {
        throw new Error(`Image ${i} is not a string`);
      }
      if (!image.startsWith('data:image/')) {
        throw new Error(`Image ${i} has invalid MIME type`);
      }
      if (image.length > 15 * 1024 * 1024) {
        throw new Error(`Image ${i} exceeds 15MB size limit`);
      }
    }

    if (!request.staffConfig || !request.staffConfig[request.business]) {
      throw new Error('Invalid business or staff config');
    }

    // Validate business value
    const validBusinesses = ['Shiraz', 'Djadoo', 'Catering'];
    if (!validBusinesses.includes(request.business)) {
      throw new Error('Invalid business value');
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.todayIso)) {
      throw new Error('Invalid date format');
    }

    // Validate API keys
    if (!env.FREEMODEL_API_KEY) {
      throw new Error('FreeModel API key not configured');
    }
    if (!env.FREEMODEL_BASE_URL || !env.FREEMODEL_MODEL) {
      throw new Error('FreeModel model not configured');
    }

    // Build schema description
    const schemaDesc = `
Each shift must have:
- employee: Full name matching staff directory where possible
- date: YYYY-MM-DD format
- startTime: HH:MM format (24-hour)
- endTime: HH:MM format (24-hour)
- confidence: 0.0-1.0 (how confident you are in the extraction)

Staff department assignments:
${buildStaffDirectoryText({ [request.business]: request.staffConfig[request.business] })}
`;

    // Call FreeModel
    const aiShifts = await callFreeModel(
      request.images,
      request.business,
      request.todayIso,
      buildStaffDirectoryText({ [request.business]: request.staffConfig[request.business] }),
      schemaDesc,
      env.FREEMODEL_API_KEY,
      env.FREEMODEL_BASE_URL,
      env.FREEMODEL_MODEL
    );

    // Validate AI response limits
    if (!Array.isArray(aiShifts)) {
      throw new Error('Invalid FreeModel response');
    }
    if (aiShifts.length > 1000) {
      throw new Error('Too many shifts detected (maximum 1000)');
    }

    // Update scan history with AI response
    await updateScanHistory(env, scanId, {
      aiResponseJson: JSON.stringify(aiShifts)
    });

    // Merge and match with staff config
    const scopedConfig = { [request.business]: request.staffConfig[request.business] };
    const flatStaff = buildFlatStaffList(scopedConfig);

    const enrichedShifts = await Promise.all(
      aiShifts.map(async (shift) => {
        // Validate shift data
        if (typeof shift.employee !== 'string' || shift.employee.length === 0) {
          throw new Error('Invalid employee name in AI response');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(shift.date)) {
          throw new Error('Invalid date in AI response');
        }
        if (!/^\d{2}:\d{2}$/.test(shift.startTime) || !/^\d{2}:\d{2}$/.test(shift.endTime)) {
          throw new Error('Invalid time format in AI response');
        }

        let normalizedStart: string;
        let normalizedEnd: string;
        try {
          normalizedStart = normalizeTimeString(shift.startTime);
          normalizedEnd = normalizeTimeString(shift.endTime);
        } catch {
          normalizedStart = shift.startTime;
          normalizedEnd = shift.endTime;
        }

        // Try to find alias for this raw employee name
        const normalizedRawName = normalizeForMatch(shift.employee);
        const alias = await getScanAlias(env, request.business, shift.department || '', normalizedRawName);

        let matchedEmployee: string;
        let matchedDepartment = shift.department || '';

        if (alias) {
          matchedEmployee = alias.employee;
          // Find department from staff config
          const staffEntry = flatStaff.find((s: Record<string, unknown>) => s.employee === alias.employee);
          if (staffEntry) matchedDepartment = String(staffEntry.department);
        } else {
          // Use fuzzy matching to find best match
          let bestMatch = shift.employee;
          let bestScore = 0;

          for (const staffEntry of flatStaff) {
            const nameScore = 1 - levenshtein(normalizedRawName, normalizeForMatch(String(staffEntry.employee))) / Math.max(normalizedRawName.length, normalizeForMatch(String(staffEntry.employee)).length);
            if (nameScore > bestScore) {
              bestScore = nameScore;
              bestMatch = String(staffEntry.employee);
              matchedDepartment = String(staffEntry.department);
            }
          }

          matchedEmployee = bestMatch;
        }

        return {
          ...shift,
          normalizedStart,
          normalizedEnd,
          matchedEmployee,
          matchedDepartment,
          matchedBusiness: request.business
        };
      })
    );

    // Update scan history with merged result
    await updateScanHistory(env, scanId, {
      mergedResultJson: JSON.stringify(enrichedShifts),
      finalResultJson: JSON.stringify(enrichedShifts)
    });

    // Update scan history with success
    await updateScanHistory(env, scanId, {
      status: 'success',
      savedCount: enrichedShifts.length,
      skippedCount: 0
    });

    return {
      scanId,
      shifts: enrichedShifts,
      savedCount: 0, // User must confirm
      skippedCount: 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Sanitize error message to avoid leaking secrets
    const sanitizedMessage = message
      .replace(/Bearer\s+[^\s]+/g, '[REDACTED]')
      .replace(/sk_[^\s]+/g, '[REDACTED]')
      .slice(0, 2000);

    await updateScanHistory(env, scanId, {
      status: 'error',
      errorMessage: sanitizedMessage
    });
    throw error;
  }
}
