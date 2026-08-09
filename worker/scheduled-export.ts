const SCHEDULED_EXPORT_PREFIX = 'scheduled-report-export:';
const RUNNING_PREFIX = 'running:';
const SUCCESS_PREFIX = 'success:';
const STALE_RUNNING_MINUTES = 15;
const RESERVATION_RETENTION_DAYS = 45;

export function scheduledExportKey(scheduledTime: number): string {
  if (!Number.isFinite(scheduledTime)) {
    throw new Error('Scheduled export time is invalid.');
  }

  const date = new Date(scheduledTime);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Scheduled export time is invalid.');
  }

  return `${SCHEDULED_EXPORT_PREFIX}${date.toISOString().slice(0, 10)}`;
}

function runningValue(owner: string): string {
  return `${RUNNING_PREFIX}${owner}`;
}

export async function reserveScheduledExport(
  db: D1Database,
  key: string,
  owner: string
): Promise<boolean> {
  const reserved = await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
    WHERE app_settings.value LIKE 'running:%'
      AND app_settings.updated_at < datetime('now', ?)
    RETURNING key
  `).bind(key, runningValue(owner), `-${STALE_RUNNING_MINUTES} minutes`).first<{ key: string }>();

  return reserved?.key === key;
}

export async function completeScheduledExport(
  db: D1Database,
  key: string,
  owner: string
): Promise<void> {
  await db.prepare(`
    UPDATE app_settings
    SET value = ?, updated_at = datetime('now')
    WHERE key = ? AND value = ?
  `).bind(`${SUCCESS_PREFIX}${owner}`, key, runningValue(owner)).run();

  await db.prepare(`
    DELETE FROM app_settings
    WHERE key LIKE ?
      AND key <> ?
      AND updated_at < datetime('now', ?)
  `).bind(
    `${SCHEDULED_EXPORT_PREFIX}%`,
    key,
    `-${RESERVATION_RETENTION_DAYS} days`
  ).run();
}

export async function releaseScheduledExport(
  db: D1Database,
  key: string,
  owner: string
): Promise<void> {
  await db.prepare(`
    DELETE FROM app_settings
    WHERE key = ? AND value = ?
  `).bind(key, runningValue(owner)).run();
}
