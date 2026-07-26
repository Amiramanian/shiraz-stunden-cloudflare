import type { Env, HinweisRecord, ShiftRecord, StaffMemberRecord } from './types';
import {
  bulkCreateShifts,
  createHinweis,
  createShift,
  createStaff,
  findDuplicateShifts,
  listHinweise,
  listShifts,
  listStaff,
  logAudit,
  updateStaff
} from './db';
import { exportReport } from './report';
import { normalizePersonName } from './staff-config';

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, status);
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('JSON body required.');
  return request.json() as Promise<T>;
}

function actorEmail(request: Request): string | null {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || null;
}

function isApiAuthorized(request: Request, env: Env) {
  if ((env.REQUIRE_ACCESS || 'false').toLowerCase() !== 'true') return true;
  return Boolean(request.headers.get('Cf-Access-Authenticated-User-Email'));
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
  return date;
}

function validateTime(value: unknown, field: string) {
  const time = requireString(value, field);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`${field} muss HH:MM sein.`);
  return time;
}

function validateDuration(value: unknown) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0 || duration > 24) {
    throw new Error('Ungültige Stundenzahl.');
  }
  return Math.round(duration * 100) / 100;
}

function parseShift(input: Partial<ShiftRecord>): Omit<ShiftRecord, 'id'> {
  const employee = requireString(input.employee, 'Mitarbeiter');
  return {
    business: validateBusiness(input.business),
    department: requireString(input.department, 'Abteilung'),
    employee,
    employeeKey: input.employeeKey ? requireString(input.employeeKey, 'employeeKey') : normalizePersonName(employee),
    date: validateDate(input.date),
    startTime: validateTime(input.startTime, 'Startzeit'),
    endTime: validateTime(input.endTime, 'Endzeit'),
    durationHours: validateDuration(input.durationHours)
  };
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
        authenticatedEmail: actorEmail(request)
      },
      lastExport: lastExport || null,
      time: new Date().toISOString()
    });
  }

  if (!isApiAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
  const email = actorEmail(request);

  try {
    if (url.pathname === '/api/me' && method === 'GET') {
      return json({ email, role: 'admin' });
    }

    if (url.pathname === '/api/staff-members' && method === 'GET') {
      return json(await listStaff(env));
    }

    if (url.pathname === '/api/staff-members' && method === 'POST') {
      const input = parseStaff(await readJson(request));
      const created = await createStaff(env, input);
      await logAudit(env, 'create', 'staff_member', created.id, created, email);
      return json(created, 201);
    }

    const staffMatch = url.pathname.match(/^\/api\/staff-members\/([^/]+)$/);
    if (staffMatch && method === 'PATCH') {
      const id = decodeURIComponent(staffMatch[1]);
      const patch = await readJson<Partial<StaffMemberRecord>>(request);
      const updated = await updateStaff(env, id, patch);
      if (!updated) return json({ error: 'Mitarbeiter nicht gefunden.' }, 404);
      await logAudit(env, 'update', 'staff_member', id, patch, email);
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
      return json(created, 201);
    }

    if (url.pathname === '/api/shifts/bulk' && method === 'POST') {
      const body = await readJson<{ shifts?: Array<Partial<ShiftRecord>> }>(request);
      const shifts = (body.shifts || []).map(parseShift);
      const result = await bulkCreateShifts(env, shifts);
      await logAudit(env, 'bulk_create', 'shift', null, { count: shifts.length }, email);
      return json(result, 201);
    }

    if (url.pathname === '/api/hinweise' && method === 'GET') {
      return json(await listHinweise(env));
    }

    if (url.pathname === '/api/hinweise' && method === 'POST') {
      const body = await readJson<Partial<HinweisRecord>>(request);
      const employee = requireString(body.employee, 'Mitarbeiter');
      const created = await createHinweis(env, {
        employee,
        employeeKey: body.employeeKey ? requireString(body.employeeKey, 'employeeKey') : normalizePersonName(employee),
        date: validateDate(body.date),
        text: requireString(body.text, 'Hinweis')
      });
      await logAudit(env, 'create', 'hinweis', created.id, created, email);
      return json(created, 201);
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

    if (url.pathname === '/api/scan-shifts' && method === 'POST') {
      return json({
        error: 'Foto-Scan wird in Phase 2 an Cloudflare Workers AI oder ein anderes Modell angeschlossen.'
      }, 501);
    }

    if (url.pathname.startsWith('/api/voice/')) {
      return json({
        error: 'Spracheingabe wird in Phase 2 eingerichtet.'
      }, 501);
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
    ctx.waitUntil(exportReport(env, 'scheduled'));
  }
} satisfies ExportedHandler<Env>;
