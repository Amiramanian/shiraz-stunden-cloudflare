import type {
  Env,
  HinweisRecord,
  ScanCorrectionInput,
  ShiftRecord,
  StaffMemberRecord
} from './types';
import {
  changesScanIdentity,
  getChangedCorrectionFields,
  isActualScanCorrection
} from './scan-corrections.ts';

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

export async function getShift(env: Env, id: string): Promise<ShiftRecord | null> {
  const row = await env.DB.prepare(`
    SELECT id, business, department, employee, employee_key, date, start_time, end_time, duration_hours
    FROM shifts
    WHERE id = ? AND deleted_at IS NULL
  `).bind(id).first();
  return row ? mapShift(row as Record<string, unknown>) : null;
}

export async function updateShift(
  env: Env,
  id: string,
  input: Omit<ShiftRecord, 'id'>
): Promise<ShiftRecord | null> {
  const existing = await getShift(env, id);
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE shifts
    SET business = ?, department = ?, employee = ?, employee_key = ?,
        date = ?, start_time = ?, end_time = ?, duration_hours = ?,
        updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).bind(
    input.business,
    input.department,
    input.employee,
    input.employeeKey,
    input.date,
    input.startTime,
    input.endTime,
    input.durationHours,
    id
  ).run();

  return { id, ...input };
}

export async function softDeleteShift(env: Env, id: string): Promise<ShiftRecord | null> {
  const existing = await getShift(env, id);
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE shifts
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).bind(id).run();
  return existing;
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
  if (!statements.length) return { created: 0, skipped: 0 };

  const results = await env.DB.batch(statements);
  const created = results.reduce(
    (total, result) => total + Number(result.meta.changes || 0),
    0
  );
  return {
    created,
    skipped: inputs.length - created
  };
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

export async function getHinweis(env: Env, id: string): Promise<HinweisRecord | null> {
  const row = await env.DB.prepare(`
    SELECT id, employee, employee_key, date, text
    FROM hinweise
    WHERE id = ? AND deleted_at IS NULL
  `).bind(id).first();
  return row ? mapHinweis(row as Record<string, unknown>) : null;
}

export async function updateHinweis(
  env: Env,
  id: string,
  input: Omit<HinweisRecord, 'id'>
): Promise<HinweisRecord | null> {
  const existing = await getHinweis(env, id);
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE hinweise
    SET employee = ?, employee_key = ?, date = ?, text = ?, updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).bind(input.employee, input.employeeKey, input.date, input.text, id).run();

  return { id, ...input };
}

export async function softDeleteHinweis(env: Env, id: string): Promise<HinweisRecord | null> {
  const existing = await getHinweis(env, id);
  if (!existing) return null;

  await env.DB.prepare(`
    UPDATE hinweise
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).bind(id).run();
  return existing;
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

// Scan history and aliases

export async function createScanHistory(
  env: Env,
  scanId: string,
  business: string,
  actorEmail: string | null,
  imageCount: number
) {
  await env.DB.prepare(`
    INSERT INTO scan_history (
      id, business, actor_email, provider, model, image_count, status
    )
    VALUES (?, ?, ?, 'gemini', ?, ?, 'processing')
  `).bind(
    scanId,
    business,
    actorEmail,
    env.GEMINI_MODEL,
    imageCount
  ).run();
}

export async function updateScanHistory(
  env: Env,
  scanId: string,
  patch: {
    status?: 'success' | 'error';
    ocrText?: string;
    aiResponseJson?: string;
    mergedResultJson?: string;
    finalResultJson?: string;
    savedCount?: number;
    skippedCount?: number;
    errorMessage?: string;
  }
) {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.ocrText !== undefined) {
    fields.push('ocr_text = ?');
    values.push(patch.ocrText);
  }
  if (patch.aiResponseJson !== undefined) {
    fields.push('ai_response_json = ?');
    values.push(patch.aiResponseJson);
  }
  if (patch.mergedResultJson !== undefined) {
    fields.push('merged_result_json = ?');
    values.push(patch.mergedResultJson);
  }
  if (patch.finalResultJson !== undefined) {
    fields.push('final_result_json = ?');
    values.push(patch.finalResultJson);
  }
  if (patch.savedCount !== undefined) {
    fields.push('saved_count = ?');
    values.push(patch.savedCount);
  }
  if (patch.skippedCount !== undefined) {
    fields.push('skipped_count = ?');
    values.push(patch.skippedCount);
  }
  if (patch.errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(patch.errorMessage);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = datetime(\'now\')');
  values.push(scanId);

  await env.DB.prepare(`
    UPDATE scan_history
    SET ${fields.join(', ')}
    WHERE id = ?
  `).bind(...values).run();
}

export function normalizeScanAliasName(value: string): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/\./g, '')
    .replace(/[-_]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export async function getScanAlias(
  env: Env,
  business: string,
  department: string,
  normalizedRawName: string
): Promise<{ employee: string; employeeKey: string; department: string } | null> {
  const aliasKey = normalizeScanAliasName(normalizedRawName);
  const exact = await env.DB.prepare(`
    SELECT employee, employee_key, COALESCE(final_department, department) AS final_department
    FROM scan_aliases
    WHERE business = ? AND department = ?
      AND REPLACE(normalized_raw_name, ' ', '') = ?
    ORDER BY correction_count DESC, updated_at DESC
    LIMIT 1
  `).bind(business, department, aliasKey).first();

  let row = exact;
  if (!row) {
    const candidates = await env.DB.prepare(`
      SELECT employee, employee_key, COALESCE(final_department, department) AS final_department
      FROM scan_aliases
      WHERE business = ? AND REPLACE(normalized_raw_name, ' ', '') = ?
      ORDER BY correction_count DESC, updated_at DESC
      LIMIT 2
    `).bind(business, aliasKey).all();
    const results = candidates.results || [];
    if (results.length === 1) row = results[0];
  }

  if (!row) return null;
  return {
    employee: String(row.employee),
    employeeKey: String(row.employee_key),
    department: String(row.final_department)
  };
}

export async function createOrUpdateScanAlias(
  env: Env,
  business: string,
  department: string,
  rawName: string,
  normalizedRawName: string,
  employee: string,
  employeeKey: string,
  finalDepartment = department,
  correctionIncrement = 1
) {
  await env.DB.prepare(`
    INSERT INTO scan_aliases (
      id, business, department, raw_name, normalized_raw_name,
      employee, employee_key, final_department, correction_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(business, department, normalized_raw_name) DO UPDATE SET
      raw_name = excluded.raw_name,
      employee = excluded.employee,
      employee_key = excluded.employee_key,
      final_department = excluded.final_department,
      correction_count = scan_aliases.correction_count + excluded.correction_count,
      updated_at = datetime('now')
  `).bind(
    crypto.randomUUID(),
    business,
    department,
    rawName,
    normalizedRawName,
    employee,
    employeeKey,
    finalDepartment,
    Math.max(0, correctionIncrement)
  ).run();
}

function correctionKey(
  scanId: string,
  business: string,
  correction: ScanCorrectionInput
): string {
  return JSON.stringify({
    scanId,
    business,
    rawEmployee: correction.rawEmployee,
    rawDepartment: correction.rawDepartment || correction.original?.department || '',
    original: correction.original || {},
    final: correction.final
  });
}

export async function recordScanCorrection(
  env: Env,
  scanId: string,
  business: string,
  correction: ScanCorrectionInput
) {
  if (!isActualScanCorrection(correction)) {
    return { inserted: false, aliasLearned: false, changedFields: [] };
  }

  const rawName = correction.rawEmployee.trim();
  const rawDepartment = (
    correction.rawDepartment ||
    correction.original?.department ||
    correction.final.department
  ).trim();
  const finalEmployee = correction.final.employee.trim();
  const finalDepartment = correction.final.department.trim();
  const normalizedRawName = normalizeScanAliasName(rawName);
  const employeeKey = normalizeScanAliasName(finalEmployee);

  if (!rawName || !rawDepartment || !finalEmployee || !finalDepartment) {
    throw new Error('Unvollständige Scan-Korrektur.');
  }

  const insertResult = await env.DB.prepare(`
    INSERT OR IGNORE INTO scan_corrections (
      id, scan_id, raw_employee, suggested_employee, final_employee,
      business, department, raw_department, final_department,
      original_json, final_json, correction_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    scanId,
    rawName,
    correction.suggestedEmployee?.trim() || null,
    finalEmployee,
    business,
    finalDepartment,
    rawDepartment,
    finalDepartment,
    JSON.stringify(correction.original || {}),
    JSON.stringify(correction.final),
    correctionKey(scanId, business, correction)
  ).run();

  const inserted = Number(insertResult.meta.changes || 0) > 0;
  const aliasLearned = inserted && changesScanIdentity(correction);
  if (aliasLearned) {
    await createOrUpdateScanAlias(
      env,
      business,
      rawDepartment,
      rawName,
      normalizedRawName,
      finalEmployee,
      employeeKey,
      finalDepartment,
      1
    );
  }
  return {
    inserted,
    aliasLearned,
    changedFields: getChangedCorrectionFields(correction.original, correction.final)
  };
}

