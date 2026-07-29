import type {
  Env,
  HinweisRecord,
  ScanCorrectionInput,
  ShiftRecord,
  StaffMemberRecord
} from './types';
import {
  bulkCreateShifts,
  createHinweis,
  createShift,
  createStaff,
  findDuplicateShifts,
  getHinweis,
  getShift,
  listHinweise,
  listShifts,
  listStaff,
  logAudit,
  recordScanCorrection,
  softDeleteHinweis,
  softDeleteShift,
  updateHinweis,
  updateScanHistory,
  updateShift,
  updateStaff
} from './db';
import { exportReport } from './report';
import { processScanRequest } from './scan-shifts';
import { normalizePersonName } from './staff-config';
import { processVoiceShift } from './voice-shifts';
import { getBackupStatus, runNightlyBackup } from './backup';
import {
  clearExpiredAuthSessions,
  clearSessionCookie,
  createAuthSession,
  createSessionCookie,
  deleteAuthSession,
  hasValidAuthSession,
  securelyMatchesPin
} from './auth';

const DEFAULT_JSON_LIMIT = 1_000_000;
const SCAN_JSON_LIMIT = 25_000_000;
const VOICE_JSON_LIMIT = 9_000_000;

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, {
    status,
    headers
  });
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, status);
}

async function readJson<T>(request: Request, maxBytes = DEFAULT_JSON_LIMIT): Promise<T> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('JSON body required.');
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('Request body is too large.');
  if (!request.body) throw new Error('JSON body required.');

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('Request body is too large.');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function actorEmail(request: Request): string | null {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || null;
}

async function authorizeRequest(request: Request, env: Env) {
  const accessEmail = actorEmail(request);
  if ((env.REQUIRE_ACCESS || 'false').toLowerCase() === 'true') {
    return {
      authorized: Boolean(accessEmail),
      actor: accessEmail
    };
  }

  const authorized = await hasValidAuthSession(request, env);
  return {
    authorized,
    actor: authorized ? 'pin-admin' : null
  };
}

function validateBusiness(value: unknown): ShiftRecord['business'] {
  if (value === 'Shiraz' || value === 'Djadoo' || value === 'Catering') return value;
  throw new Error('Ungültiger Betrieb.');
}

function requireString(value: unknown, field: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} ist erforderlich.`);
  return normalized;
}

function validateDate(value: unknown) {
  const date = requireString(value, 'Datum');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum muss YYYY-MM-DD sein.');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Ungültiges Datum.');
  }
  return date;
}

function validateTime(value: unknown, field: string) {
  const time = requireString(value, field);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`${field} muss HH:MM sein.`);
  return time;
}

function calculateDuration(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  const duration = Math.round(((end - start) / 60) * 100) / 100;
  if (duration <= 0 || duration > 24) throw new Error('Ungültige Stundenzahl.');
  return duration;
}

function parseShift(input: Partial<ShiftRecord>): Omit<ShiftRecord, 'id'> {
  const employee = requireString(input.employee, 'Mitarbeiter');
  const startTime = validateTime(input.startTime, 'Startzeit');
  const endTime = validateTime(input.endTime, 'Endzeit');
  return {
    business: validateBusiness(input.business),
    department: requireString(input.department, 'Abteilung'),
    employee,
    employeeKey: normalizePersonName(employee),
    date: validateDate(input.date),
    startTime,
    endTime,
    durationHours: calculateDuration(startTime, endTime)
  };
}

function parseHinweis(input: Partial<HinweisRecord>): Omit<HinweisRecord, 'id'> {
  const employee = requireString(input.employee, 'Mitarbeiter');
  return {
    employee,
    employeeKey: normalizePersonName(employee),
    date: validateDate(input.date),
    text: requireString(input.text, 'Hinweis')
  };
}

function parseScanCorrection(value: ScanCorrectionInput): ScanCorrectionInput {
  const finalEmployee = requireString(value?.final?.employee, 'final.employee');
  const finalDepartment = requireString(value?.final?.department, 'final.department');
  const final = {
    ...value.final,
    employee: finalEmployee,
    department: finalDepartment
  };

  if (final.date) final.date = validateDate(final.date);
  if (final.startTime) final.startTime = validateTime(final.startTime, 'final.startTime');
  if (final.endTime) final.endTime = validateTime(final.endTime, 'final.endTime');

  return {
    rawEmployee: requireString(value.rawEmployee, 'rawEmployee'),
    suggestedEmployee: String(value.suggestedEmployee || '').trim() || undefined,
    rawDepartment: String(value.rawDepartment || '').trim() || undefined,
    original: value.original,
    final
  };
}

function sanitizeSyncError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+[^\s]+/gi, '[REDACTED]')
    .replace(/\b(?:gsk_|fe_oa_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .slice(0, 500);
}

function parseStaff(input: Partial<StaffMemberRecord>): Omit<StaffMemberRecord, 'id' | 'hidden'> & { hidden?: boolean } {
  const employee = requireString(input.employee, 'Mitarbeiter');
  return {
    business: validateBusiness(input.business),
    department: requireString(input.department, 'Abteilung'),
    employee,
    employeeKey: input.employeeKey ? requireString(input.employeeKey, 'employeeKey') : normalizePersonName(employee),
    hidden: Boolean(input.hidden)
  };
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === '/api/health') {
    return json({ status: 'ok', app: 'shiraz-stunden', time: new Date().toISOString() });
  }

  if (url.pathname === '/api/auth/status' && method === 'GET') {
    const authorization = await authorizeRequest(request, env);
    return json({
      authenticated: authorization.authorized,
      configured: Boolean(env.APP_PIN) ||
        (env.REQUIRE_ACCESS || 'false').toLowerCase() === 'true'
    });
  }

  if (url.pathname === '/api/auth/login' && method === 'POST') {
    if (!env.APP_PIN) return json({ error: 'PIN-Zugang ist nicht eingerichtet.' }, 503);

    const clientKey = request.headers.get('CF-Connecting-IP') || 'local-client';
    const rateLimit = await env.LOGIN_RATE_LIMITER.limit({ key: `pin-login:${clientKey}` });
    if (!rateLimit.success) {
      return json({ error: 'Zu viele Versuche. Bitte eine Minute warten.' }, 429);
    }

    try {
      const body = await readJson<{ pin?: unknown }>(request);
      const submittedPin = String(body.pin ?? '');
      if (
        !/^\d{4}$/.test(submittedPin) ||
        !await securelyMatchesPin(submittedPin, env.APP_PIN)
      ) {
        return json({ error: 'PIN ist nicht korrekt.' }, 401);
      }

      const token = await createAuthSession(env);
      await logAudit(env, 'login', 'auth_session', null, { method: 'pin' }, 'pin-admin');
      return json(
        { authenticated: true },
        200,
        { 'Set-Cookie': createSessionCookie(token) }
      );
    } catch (error) {
      return errorResponse(error, 400);
    }
  }

  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    await deleteAuthSession(request, env);
    return json(
      { authenticated: false },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    );
  }

  const authorization = await authorizeRequest(request, env);
  if (!authorization.authorized) return json({ error: 'Unauthorized' }, 401);
  const email = authorization.actor;

  if (url.pathname === '/api/setup-status' && method === 'GET') {
    const tableRows = await env.DB.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
    const lastExport = await env.DB.prepare(`
      SELECT id, started_at, finished_at, status, trigger_type, spreadsheet_id, error_message
      FROM export_runs
      ORDER BY started_at DESC
      LIMIT 1
    `).first();

    return json({
      database: {
        connected: true,
        tables: (tableRows.results || []).map((row) => String((row as Record<string, unknown>).name))
      },
      googleSheet: {
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID || null,
        webViewLink: env.GOOGLE_SHEET_URL || null,
        serviceAccountConfigured: Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY)
      },
      accessProtection: {
        required: (env.REQUIRE_ACCESS || 'false').toLowerCase() === 'true',
        authenticatedEmail: actorEmail(request),
        pinProtected: Boolean(env.APP_PIN)
      },
      lastExport: lastExport || null,
      time: new Date().toISOString()
    });
  }

  try {
    if (url.pathname === '/api/me' && method === 'GET') {
      return json({ email, role: 'admin' });
    }

    if (url.pathname === '/api/backups/status' && method === 'GET') {
      return json({ latest: await getBackupStatus(env) });
    }

    if (url.pathname === '/api/backups/run' && method === 'POST') {
      const backup = await runNightlyBackup(env, 'manual');
      return json(backup, 201);
    }

    if (url.pathname === '/api/staff-members' && method === 'GET') {
      return json(await listStaff(env));
    }

    if (url.pathname === '/api/staff-members' && method === 'POST') {
      const input = parseStaff(await readJson(request));
      const created = await createStaff(env, input);
      await logAudit(env, 'create', 'staff_member', created.id, created, email);
      ctx.waitUntil(exportReport(env, 'manual').catch(() => {}));
      return json(created, 201);
    }

    const staffMatch = url.pathname.match(/^\/api\/staff-members\/([^/]+)$/);
    if (staffMatch && method === 'PATCH') {
      const id = decodeURIComponent(staffMatch[1]);
      const patch = await readJson<Partial<StaffMemberRecord>>(request);
      const updated = await updateStaff(env, id, patch);
      if (!updated) return json({ error: 'Mitarbeiter nicht gefunden.' }, 404);
      await logAudit(env, 'update', 'staff_member', id, patch, email);
      ctx.waitUntil(exportReport(env, 'manual').catch(() => {}));
      return json(updated);
    }

    if (url.pathname === '/api/shifts' && method === 'GET') {
      const filters: Partial<ShiftRecord> = {};
      for (const key of ['business', 'department', 'employee', 'employeeKey', 'date', 'startTime', 'endTime'] as const) {
        const value = url.searchParams.get(key);
        if (value) (filters as Record<string, string>)[key] = value;
      }
      return json(Object.keys(filters).length ? await findDuplicateShifts(env, filters) : await listShifts(env));
    }

    if (url.pathname === '/api/shifts' && method === 'POST') {
      const input = parseShift(await readJson(request));
      const duplicate = await findDuplicateShifts(env, input);
      if (duplicate.length) return json({ error: 'Diese Schicht wurde bereits erfasst.' }, 409);
      const created = await createShift(env, input);
      await logAudit(env, 'create', 'shift', created.id, created, email);
      ctx.waitUntil(exportReport(env, 'manual').catch(() => {}));
      return json(created, 201);
    }

    const shiftMatch = url.pathname.match(/^\/api\/shifts\/([^/]+)$/);
    if (shiftMatch && method === 'PATCH') {
      const id = decodeURIComponent(shiftMatch[1]);
      const existing = await getShift(env, id);
      if (!existing) return json({ error: 'Schicht nicht gefunden.' }, 404);

      const patch = await readJson<Partial<ShiftRecord>>(request);
      const input = parseShift({ ...existing, ...patch });
      const duplicate = await findDuplicateShifts(env, input);
      if (duplicate.some((shift) => shift.id !== id)) {
        return json({ error: 'Diese Schicht wurde bereits erfasst.' }, 409);
      }

      const updated = await updateShift(env, id, input);
      if (!updated) return json({ error: 'Schicht nicht gefunden.' }, 404);
      await logAudit(env, 'update', 'shift', id, { before: existing, after: updated }, email);

      try {
        await exportReport(env, 'manual');
        return json({ ...updated, excelSynced: true });
      } catch (error) {
        return json({ ...updated, excelSynced: false, syncError: sanitizeSyncError(error) });
      }
    }

    if (shiftMatch && method === 'DELETE') {
      const id = decodeURIComponent(shiftMatch[1]);
      const deleted = await softDeleteShift(env, id);
      if (!deleted) return json({ error: 'Schicht nicht gefunden.' }, 404);
      await logAudit(env, 'delete', 'shift', id, { before: deleted }, email);

      try {
        await exportReport(env, 'manual');
        return json({ deleted: true, record: deleted, excelSynced: true });
      } catch (error) {
        return json({
          deleted: true,
          record: deleted,
          excelSynced: false,
          syncError: sanitizeSyncError(error)
        });
      }
    }

    if (url.pathname === '/api/shifts/bulk' && method === 'POST') {
      const body = await readJson<{
        shifts?: Array<Partial<ShiftRecord>>;
        scanId?: string;
        corrections?: ScanCorrectionInput[];
      }>(request);
      if (!Array.isArray(body.shifts) || body.shifts.length === 0) {
        return json({ error: 'Mindestens eine Schicht ist erforderlich.' }, 400);
      }
      if (body.shifts.length > 100) {
        return json({ error: 'Maximum 100 Schichten pro Anfrage.' }, 400);
      }
      if ((body.corrections || []).length > 100) {
        return json({ error: 'Maximum 100 Korrekturen pro Anfrage.' }, 400);
      }
      const shifts = (body.shifts || []).map(parseShift);
      const scanId = String(body.scanId || '').trim();
      const corrections = (body.corrections || []).map(parseScanCorrection);
      if (new Set(shifts.map((shift) => shift.business)).size !== 1) {
        return json({ error: 'Alle Schichten einer Scan-Anfrage müssen zum selben Betrieb gehören.' }, 400);
      }

      if (scanId) {
        const scan = await env.DB.prepare(`
          SELECT id FROM scan_history WHERE id = ? AND business = ?
        `).bind(scanId, shifts[0]?.business || '').first();
        if (!scan) return json({ error: 'Scan-Verlauf nicht gefunden.' }, 404);
      } else if (corrections.length) {
        return json({ error: 'scanId ist für Korrekturen erforderlich.' }, 400);
      }

      const result = await bulkCreateShifts(env, shifts);
      let learnedCorrections = 0;
      let learnedAliases = 0;
      for (const correction of corrections) {
        const learned = await recordScanCorrection(
          env,
          scanId,
          validateBusiness(shifts[0]?.business),
          correction
        );
        if (learned.inserted) learnedCorrections += 1;
        if (learned.aliasLearned) learnedAliases += 1;
      }

      if (scanId) {
        await updateScanHistory(env, scanId, {
          savedCount: result.created,
          skippedCount: result.skipped,
          finalResultJson: JSON.stringify({
            savedShifts: shifts,
            corrections
          })
        });
      }

      await logAudit(env, 'bulk_create', 'shift', null, {
        requested: shifts.length,
        created: result.created,
        skipped: result.skipped,
        scanId: scanId || null,
        learnedCorrections,
        learnedAliases
      }, email);

      try {
        await exportReport(env, 'manual');
        return json({
          ...result,
          learnedCorrections,
          learnedAliases,
          excelSynced: true,
          spreadsheetId: env.GOOGLE_SPREADSHEET_ID || null,
          webViewLink: env.GOOGLE_SHEET_URL || null
        }, 201);
      } catch (error) {
        const syncError = sanitizeSyncError(error);
        console.error(JSON.stringify({
          event: 'bulk_shift_excel_sync_failed',
          scanId: scanId || null,
          message: syncError
        }));
        return json({
          ...result,
          learnedCorrections,
          learnedAliases,
          excelSynced: false,
          syncError
        }, 201);
      }
    }

    if (url.pathname === '/api/hinweise' && method === 'GET') {
      return json(await listHinweise(env));
    }

    if (url.pathname === '/api/hinweise' && method === 'POST') {
      const created = await createHinweis(env, parseHinweis(await readJson(request)));
      await logAudit(env, 'create', 'hinweis', created.id, created, email);
      ctx.waitUntil(exportReport(env, 'manual').catch(() => {}));
      return json(created, 201);
    }

    const hinweisMatch = url.pathname.match(/^\/api\/hinweise\/([^/]+)$/);
    if (hinweisMatch && method === 'PATCH') {
      const id = decodeURIComponent(hinweisMatch[1]);
      const existing = await getHinweis(env, id);
      if (!existing) return json({ error: 'Hinweis nicht gefunden.' }, 404);

      const patch = await readJson<Partial<HinweisRecord>>(request);
      const input = parseHinweis({ ...existing, ...patch });
      const updated = await updateHinweis(env, id, input);
      if (!updated) return json({ error: 'Hinweis nicht gefunden.' }, 404);
      await logAudit(env, 'update', 'hinweis', id, { before: existing, after: updated }, email);

      try {
        await exportReport(env, 'manual');
        return json({ ...updated, excelSynced: true });
      } catch (error) {
        return json({ ...updated, excelSynced: false, syncError: sanitizeSyncError(error) });
      }
    }

    if (hinweisMatch && method === 'DELETE') {
      const id = decodeURIComponent(hinweisMatch[1]);
      const deleted = await softDeleteHinweis(env, id);
      if (!deleted) return json({ error: 'Hinweis nicht gefunden.' }, 404);
      await logAudit(env, 'delete', 'hinweis', id, { before: deleted }, email);

      try {
        await exportReport(env, 'manual');
        return json({ deleted: true, record: deleted, excelSynced: true });
      } catch (error) {
        return json({
          deleted: true,
          record: deleted,
          excelSynced: false,
          syncError: sanitizeSyncError(error)
        });
      }
    }

    if (url.pathname === '/api/report/link' && method === 'GET') {
      const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
      const webViewLink = env.GOOGLE_SHEET_URL || (
        spreadsheetId && !spreadsheetId.startsWith('REPLACE_')
          ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
          : null
      );
      return json({ spreadsheetId, webViewLink });
    }

    if (url.pathname === '/api/report/export' && method === 'POST') {
      return json(await exportReport(env, 'manual'));
    }

    if (url.pathname === '/api/scan-shifts/status' && method === 'GET') {
      return json({
        primaryProvider: 'gemini',
        providers: {
          gemini: Boolean(env.GEMINI_API_KEY),
          groq: Boolean(env.GROQ_API_KEY)
        },
        models: {
          gemini: env.GEMINI_MODEL,
          groqSpeech: env.GROQ_SPEECH_MODEL
        }
      });
    }

    if (url.pathname === '/api/scan-shifts' && method === 'POST') {
      const body = await readJson<{
        business?: string;
        todayIso?: string;
        staffConfig?: Record<string, Record<string, string[]>>;
        images?: string[];
        imageNames?: string[];
        ocrTexts?: string[];
      }>(request, SCAN_JSON_LIMIT);
      
      const business = requireString(body.business, 'business') as 'Shiraz' | 'Djadoo' | 'Catering';
      const todayIso = requireString(body.todayIso, 'todayIso');
      const staffConfig = body.staffConfig || {};
      const images = Array.isArray(body.images) ? body.images : [];
      const imageNames = Array.isArray(body.imageNames) ? body.imageNames : [];
      const ocrTexts = Array.isArray(body.ocrTexts) ? body.ocrTexts : [];

      if (images.length === 0) {
        return json({ error: 'Keine Bilder bereitgestellt.' }, 400);
      }
      if (images.length > 10) {
        return json({ error: 'Maximum 10 Bilder pro Scan.' }, 400);
      }

      const result = await processScanRequest(env, {
        business,
        todayIso,
        staffConfig,
        images,
        imageNames,
        ocrTexts
      }, email);

      await logAudit(env, 'scan_shifts', 'scan_history', result.scanId, {
        imageCount: images.length,
        shiftCount: result.shifts.length,
        provider: result.provider,
        warningCount: result.warnings.length,
        manualFallback: Boolean(result.manualFallback)
      }, email);

      return json(result, 201);
    }

    if (url.pathname === '/api/voice/shift' && method === 'POST') {
      const body = await readJson<{ audio?: unknown }>(request, VOICE_JSON_LIMIT);
      const result = await processVoiceShift(env, body, email);
      await logAudit(env, 'voice_shift', 'scan_history', result.scanId, {
        audioBytes: result.audioBytes,
        confidence: result.suggestion.confidence,
        needsReview: result.suggestion.needsReview
      }, email);
      return json(result, 201);
    }

    return json({ error: 'API route not found.' }, 404);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      return json({ error: 'Dieser Eintrag existiert bereits.' }, 409);
    }
    return errorResponse(error, 400);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const tasks = [
        ['backup', runNightlyBackup(env, 'scheduled')],
        ['report_export', exportReport(env, 'scheduled')],
        ['auth_cleanup', clearExpiredAuthSessions(env)]
      ] as const;
      const results = await Promise.allSettled(tasks.map(([, task]) => task));
      const failures: string[] = [];

      results.forEach((result, index) => {
        const taskName = tasks[index][0];
        if (result.status === 'rejected') {
          const message = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          failures.push(`${taskName}: ${message}`);
          console.error(JSON.stringify({
            event: 'scheduled_task_failed',
            task: taskName,
            message
          }));
        }
      });

      if (failures.length) {
        throw new Error(`Scheduled tasks failed: ${failures.join('; ')}`);
      }
    })());
  }
} satisfies ExportedHandler<Env>;
