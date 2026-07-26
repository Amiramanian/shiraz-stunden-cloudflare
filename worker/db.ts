import type { Env, HinweisRecord, ShiftRecord, StaffMemberRecord } from './types';

function mapShift(row: Record<string, unknown>): ShiftRecord {
  return {
    id: String(row.id),
    business: row.business as ShiftRecord['business'],
    department: String(row.department),
    employee: String(row.employee),
    employeeKey: String(row.employee_key),
    date: String(row.date),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    durationHours: Number(row.duration_hours)
  };
}

function mapHinweis(row: Record<string, unknown>): HinweisRecord {
  return {
    id: String(row.id),
    employee: String(row.employee),
    employeeKey: String(row.employee_key),
    date: String(row.date),
    text: String(row.text)
  };
}

function mapStaff(row: Record<string, unknown>): StaffMemberRecord {
  return {
    id: String(row.id),
    business: row.business as StaffMemberRecord['business'],
    department: String(row.department),
    employee: String(row.employee),
    employeeKey: String(row.employee_key),
    hidden: Number(row.hidden) === 1
  };
}

export async function listStaff(env: Env): Promise<StaffMemberRecord[]> {
  const result = await env.DB.prepare(`
    SELECT id, business, department, employee, employee_key, hidden
    FROM staff_members
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `).all();
  return (result.results || []).map((row) => mapStaff(row as Record<string, unknown>));
}

export async function createStaff(env: Env, input: Omit<StaffMemberRecord, 'id' | 'hidden'> & { hidden?: boolean }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO staff_members (id, business, department, employee, employee_key, hidden)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, input.business, input.department, input.employee, input.employeeKey, input.hidden ? 1 : 0).run();
  return { id, ...input, hidden: Boolean(input.hidden) };
}

export async function updateStaff(env: Env, id: string, patch: Partial<StaffMemberRecord>) {
  const existing = await env.DB.prepare(`
    SELECT id, business, department, employee, employee_key, hidden
    FROM staff_members WHERE id = ? AND deleted_at IS NULL
  `).bind(id).first();
  if (!existing) return null;

  const next = {
    business: patch.business ?? String(existing.business),
    department: patch.department ?? String(existing.department),
    employee: patch.employee ?? String(existing.employee),
    employeeKey: patch.employeeKey ?? String(existing.employee_key),
    hidden: patch.hidden ?? (Number(existing.hidden) === 1)
  };

  await env.DB.prepare(`
    UPDATE staff_members
    SET business = ?, department = ?, employee = ?, employee_key = ?, hidden = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(next.business, next.department, next.employee, next.employeeKey, next.hidden ? 1 : 0, id).run();

  return { id, ...next };
}

export async function listShifts(env: Env): Promise<ShiftRecord[]> {
  const result = await env.DB.prepare(`
    SELECT id, business, department, employee, employee_key, date, start_time, end_time, duration_hours
    FROM shifts
    WHERE deleted_at IS NULL
    ORDER BY date ASC, start_time ASC
  `).all();
  return (result.results || []).map((row) => mapShift(row as Record<string, unknown>));
}

export async function findDuplicateShifts(env: Env, filters: Partial<ShiftRecord>): Promise<ShiftRecord[]> {
  const clauses = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    id: 'id',
    business: 'business',
    department: 'department',
    employee: 'employee',
    employeeKey: 'employee_key',
    date: 'date',
    startTime: 'start_time',
    endTime: 'end_time'
  };

  for (const [key, column] of Object.entries(mapping)) {
    const value = filters[key as keyof ShiftRecord];
    if (value !== undefined && value !== null && value !== '') {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }

  const result = await env.DB.prepare(`
    SELECT id, business, department, employee, employee_key, date, start_time, end_time, duration_hours
    FROM shifts
    WHERE ${clauses.join(' AND ')}
    ORDER BY date ASC, start_time ASC
  `).bind(...values).all();

  return (result.results || []).map((row) => mapShift(row as Record<string, unknown>));
}

export async function createShift(env: Env, input: Omit<ShiftRecord, 'id'>) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO shifts (
      id, business, department, employee, employee_key, date, start_time, end_time, duration_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.business,
    input.department,
    input.employee,
    input.employeeKey,
    input.date,
    input.startTime,
    input.endTime,
    input.durationHours
  ).run();
  return { id, ...input };
}

export async function bulkCreateShifts(env: Env, inputs: Array<Omit<ShiftRecord, 'id'>>) {
  const statements = inputs.map((input) => env.DB.prepare(`
    INSERT OR IGNORE INTO shifts (
      id, business, department, employee, employee_key, date, start_time, end_time, duration_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.business,
    input.department,
    input.employee,
    input.employeeKey,
    input.date,
    input.startTime,
    input.endTime,
    input.durationHours
  ));
  if (statements.length) await env.DB.batch(statements);
  return { created: statements.length };
}

export async function listHinweise(env: Env): Promise<HinweisRecord[]> {
  const result = await env.DB.prepare(`
    SELECT id, employee, employee_key, date, text
    FROM hinweise
    WHERE deleted_at IS NULL
    ORDER BY date ASC
  `).all();
  return (result.results || []).map((row) => mapHinweis(row as Record<string, unknown>));
}

export async function createHinweis(env: Env, input: Omit<HinweisRecord, 'id'>) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO hinweise (id, employee, employee_key, date, text)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, input.employee, input.employeeKey, input.date, input.text).run();
  return { id, ...input };
}

export async function logAudit(
  env: Env,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: unknown,
  actorEmail: string | null
) {
  await env.DB.prepare(`
    INSERT INTO audit_log (id, action, entity_type, entity_id, payload_json, actor_email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    action,
    entityType,
    entityId,
    payload == null ? null : JSON.stringify(payload),
    actorEmail
  ).run();
}
