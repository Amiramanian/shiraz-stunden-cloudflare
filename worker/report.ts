import type { Env } from './types';
import {
  createMonthlyReportRecord,
  getMonthlyReportByMonth,
  listHinweise,
  listMonthlyReports,
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
import {
  completeScheduledExport,
  releaseScheduledExport,
  reserveScheduledExport,
  scheduledExportKey
} from './scheduled-export';

const EXPORT_LOCK_NAME = 'google-report';
const EXPORT_LOCK_SECONDS = 180;
const EXPORT_LOCK_ATTEMPTS = 30;

async function updateExistingMonthlyReports(
  env: Env,
  shifts: Awaited<ReturnType<typeof listShifts>>,
  hinweise: Awaited<ReturnType<typeof listHinweise>>,
  staff: Awaited<ReturnType<typeof listStaff>>,
  requestedMonths?: string[]
) {
  const reports = await listMonthlyReports(env);
  const requested = requestedMonths ? new Set(requestedMonths) : null;
  const selectedReports = requested
    ? reports.filter((report) => requested.has(report.reportMonth))
    : reports;

  if (selectedReports.length === 0) return [];
  if (!isMonthlyGoogleDriveConfigured(env)) {
    throw new Error('Existing monthly files cannot be updated because Google Drive OAuth is not connected.');
  }

  const updated = [];
  for (const report of selectedReports) {
    const monthlyShifts = shifts.filter((shift) =>
      isDateInReportMonth(shift.date, report.reportMonth)
    );
    const monthlyHinweise = hinweise.filter((note) =>
      isDateInReportMonth(note.date, report.reportMonth)
    );
    const plans = buildSheetPlans(monthlyShifts, monthlyHinweise, staff);
    const result = await updateGoogleSpreadsheet(env, plans, {
      spreadsheetId: report.spreadsheetId,
      authMode: 'user',
      webViewLink: report.webViewLink,
      cleanObsoleteManagedSheets: false,
      protectionEditorEmail: null
    });
    updated.push({
      reportMonth: report.reportMonth,
      spreadsheetId: report.spreadsheetId,
      updatedSheets: Number(result.updatedSheets || plans.length),
      shiftCount: monthlyShifts.length,
      hinweisCount: monthlyHinweise.length
    });
  }
  return updated;
}

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

export async function exportReport(
  env: Env,
  triggerType: 'manual' | 'scheduled',
  scheduledTime?: number,
  monthlyReportMonths?: string[]
) {
  const runId = crypto.randomUUID();
  if (triggerType === 'scheduled' && scheduledTime === undefined) {
    throw new Error('Scheduled export time is required.');
  }
  const reservationKey = triggerType === 'scheduled' && scheduledTime !== undefined
    ? scheduledExportKey(scheduledTime)
    : null;

  if (
    reservationKey &&
    !await reserveScheduledExport(env.DB, reservationKey, runId)
  ) {
    return {
      runId: null,
      skipped: true,
      reason: 'scheduled-export-already-reserved',
      scheduledKey: reservationKey
    };
  }

  let runRecorded = false;
  let lockAcquired = false;

  try {
    await env.DB.prepare(`
      INSERT INTO export_runs (id, status, trigger_type, spreadsheet_id)
      VALUES (?, 'running', ?, ?)
    `).bind(runId, triggerType, env.GOOGLE_SPREADSHEET_ID || null).run();
    runRecorded = true;

    await acquireExportLock(env, runId);
    lockAcquired = true;
    const [shifts, hinweise, staff] = await Promise.all([
      listShifts(env),
      listHinweise(env),
      listStaff(env)
    ]);
    const plans = buildSheetPlans(shifts, hinweise, staff);
    const result = await updateGoogleSpreadsheet(env, plans);
    const updatedMonthlyReports = await updateExistingMonthlyReports(
      env,
      shifts,
      hinweise,
      staff,
      monthlyReportMonths
    );

    await env.DB.prepare(`
      UPDATE export_runs
      SET status = 'success', finished_at = datetime('now'), spreadsheet_id = ?
      WHERE id = ?
    `).bind(result.spreadsheetId, runId).run();

    if (reservationKey) {
      await completeScheduledExport(env.DB, reservationKey, runId);
    }

    return { runId, ...result, updatedMonthlyReports };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cleanupTasks: Promise<unknown>[] = [];

    if (runRecorded) {
      cleanupTasks.push(env.DB.prepare(`
        UPDATE export_runs
        SET status = 'error', finished_at = datetime('now'), error_message = ?
        WHERE id = ?
      `).bind(message.slice(0, 2000), runId).run());
    }

    if (reservationKey) {
      cleanupTasks.push(releaseScheduledExport(env.DB, reservationKey, runId));
    }

    await Promise.allSettled(cleanupTasks);
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseExportLock(env, runId).catch((error) => {
        console.error(JSON.stringify({
          event: 'export_lock_release_failed',
          runId,
          message: error instanceof Error ? error.message : String(error)
        }));
      });
    }
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
