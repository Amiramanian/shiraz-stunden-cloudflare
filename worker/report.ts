import type { Env } from './types';
import {
  createMonthlyReportRecord,
  getMonthlyReportByMonth,
  listHinweise,
  listShifts,
  listStaff
} from './db';
import { buildSheetPlans } from './report-data';
import {
  createMonthlyGoogleSpreadsheet,
  isMonthlyGoogleDriveConfigured,
  removeMonthlyGoogleSpreadsheet,
  updateGoogleSpreadsheet
} from './google-sheets';
import {
  isDateInReportMonth,
  validateMonthlyReportInput
} from './monthly-report';

const EXPORT_LOCK_NAME = 'google-report';
const EXPORT_LOCK_SECONDS = 180;
const EXPORT_LOCK_ATTEMPTS = 30;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireExportLock(env: Env, owner: string): Promise<void> {
  for (let attempt = 0; attempt < EXPORT_LOCK_ATTEMPTS; attempt += 1) {
    const acquired = await env.DB.prepare(`
      INSERT INTO export_locks (name, owner, expires_at)
      VALUES (?, ?, unixepoch() + ?)
      ON CONFLICT(name) DO UPDATE SET
        owner = excluded.owner,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
      WHERE export_locks.expires_at < unixepoch()
         OR export_locks.owner = excluded.owner
      RETURNING owner
    `).bind(EXPORT_LOCK_NAME, owner, EXPORT_LOCK_SECONDS).first<{ owner: string }>();

    if (acquired?.owner === owner) return;
    await wait(1_000);
  }
  throw new Error('Google Sheets export is already running. Please retry shortly.');
}

async function releaseExportLock(env: Env, owner: string): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM export_locks
    WHERE name = ? AND owner = ?
  `).bind(EXPORT_LOCK_NAME, owner).run();
}

export async function exportReport(env: Env, triggerType: 'manual' | 'scheduled') {
  const runId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO export_runs (id, status, trigger_type, spreadsheet_id)
    VALUES (?, 'running', ?, ?)
  `).bind(runId, triggerType, env.GOOGLE_SPREADSHEET_ID || null).run();

  try {
    await acquireExportLock(env, runId);
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
  } finally {
    await releaseExportLock(env, runId).catch((error) => {
      console.error(JSON.stringify({
        event: 'export_lock_release_failed',
        runId,
        message: error instanceof Error ? error.message : String(error)
      }));
    });
  }
}

export async function createMonthlyReport(
  env: Env,
  monthValue: unknown,
  nameValue: unknown
) {
  const { month, fileName } = validateMonthlyReportInput(monthValue, nameValue);
  if (!isMonthlyGoogleDriveConfigured(env)) {
    throw new Error('Google Drive Monatsdateien sind noch nicht über OAuth verbunden.');
  }
  const existing = await getMonthlyReportByMonth(env, month);
  if (existing) {
    throw new Error(`Für ${month} existiert bereits die Datei „${existing.fileName}“.`);
  }

  const owner = `monthly-${crypto.randomUUID()}`;
  await acquireExportLock(env, owner);
  let createdSpreadsheetId = '';
  try {
    const [allShifts, allHinweise, staff] = await Promise.all([
      listShifts(env),
      listHinweise(env),
      listStaff(env)
    ]);
    const shifts = allShifts.filter((shift) => isDateInReportMonth(shift.date, month));
    const hinweise = allHinweise.filter((note) => isDateInReportMonth(note.date, month));
    const plans = buildSheetPlans(shifts, hinweise, staff);
    const spreadsheet = await createMonthlyGoogleSpreadsheet(env, fileName, plans);
    createdSpreadsheetId = spreadsheet.spreadsheetId;
    const record = await createMonthlyReportRecord(env, {
      reportMonth: month,
      fileName,
      spreadsheetId: spreadsheet.spreadsheetId,
      webViewLink: spreadsheet.webViewLink
    });
    return {
      ...record,
      shiftCount: shifts.length,
      hinweisCount: hinweise.length,
      updatedSheets: spreadsheet.updatedSheets
    };
  } catch (error) {
    if (createdSpreadsheetId) {
      await removeMonthlyGoogleSpreadsheet(env, createdSpreadsheetId).catch(() => {});
    }
    throw error;
  } finally {
    await releaseExportLock(env, owner).catch(() => {});
  }
}
