import type { Env } from './types';
import { listHinweise, listShifts, listStaff } from './db';
import { buildSheetPlans } from './report-data';
import { updateGoogleSpreadsheet } from './google-sheets';

export async function exportReport(env: Env, triggerType: 'manual' | 'scheduled') {
  const runId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO export_runs (id, status, trigger_type, spreadsheet_id)
    VALUES (?, 'running', ?, ?)
  `).bind(runId, triggerType, env.GOOGLE_SPREADSHEET_ID || null).run();

  try {
    const [shifts, hinweise, staff] = await Promise.all([
      listShifts(env),
      listHinweise(env),
      listStaff(env)
    ]);
    const plans = buildSheetPlans(shifts, hinweise, staff);
    const result = await updateGoogleSpreadsheet(env, plans);

    await env.DB.prepare(`
      UPDATE export_runs
      SET status = 'success', finished_at = datetime('now'), spreadsheet_id = ?
      WHERE id = ?
    `).bind(result.spreadsheetId, runId).run();

    return { runId, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE export_runs
      SET status = 'error', finished_at = datetime('now'), error_message = ?
      WHERE id = ?
    `).bind(message.slice(0, 2000), runId).run();
    throw error;
  }
}
