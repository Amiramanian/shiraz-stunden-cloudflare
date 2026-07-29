import type { Env } from './types';

const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 24 * 1024 * 1024;
const PAGE_SIZE = 1_000;

const BACKUP_TABLES = [
  { name: 'staff_members', orderBy: 'id', identity: 'id' },
  { name: 'shifts', orderBy: 'id', identity: 'id' },
  { name: 'hinweise', orderBy: 'id', identity: 'id' },
  { name: 'app_settings', orderBy: 'key', identity: 'key' },
  { name: 'scan_aliases', orderBy: 'id', identity: 'id' },
  { name: 'scan_corrections', orderBy: 'id', identity: 'id' },
  { name: 'audit_log', orderBy: 'id', identity: 'id' }
] as const;

type BackupTableName = (typeof BACKUP_TABLES)[number]['name'];
type BackupRow = Record<string, unknown>;
type BackupTables = Record<BackupTableName, BackupRow[]>;

interface BackupSnapshot {
  version: number;
  createdAt: string;
  source: {
    type: 'cloudflare-d1';
    database: 'shiraz-stunden-db';
  };
  tables: BackupTables;
}

interface BackupLatest {
  version: number;
  createdAt: string;
  trigger: 'manual' | 'scheduled';
  snapshotKey: string;
  changesKey: string;
  contentHash: string;
  sizeBytes: number;
  previousSnapshotKey: string | null;
  tableCounts: Record<BackupTableName, number>;
  changeCounts: Record<BackupTableName, TableChangeSummary>;
}

export interface TableChangeSummary {
  added: number;
  updated: number;
  removed: number;
}

interface TableChanges extends TableChangeSummary {
  addedIds: string[];
  updatedIds: string[];
  removedIds: string[];
}

function rowIdentity(row: BackupRow, identity: string): string {
  return String(row[identity] ?? '');
}

function rowFingerprint(row: BackupRow): string {
  return JSON.stringify(row);
}

export function compareBackupTables(
  current: Record<string, BackupRow[]>,
  previous: Record<string, BackupRow[]>
): Record<string, TableChanges> {
  const changes: Record<string, TableChanges> = {};

  for (const table of BACKUP_TABLES) {
    const currentRows = current[table.name] || [];
    const previousRows = previous[table.name] || [];
    const currentById = new Map(
      currentRows.map((row) => [rowIdentity(row, table.identity), row])
    );
    const previousById = new Map(
      previousRows.map((row) => [rowIdentity(row, table.identity), row])
    );

    const addedIds: string[] = [];
    const updatedIds: string[] = [];
    const removedIds: string[] = [];

    for (const [id, row] of currentById) {
      const previousRow = previousById.get(id);
      if (!previousRow) addedIds.push(id);
      else if (rowFingerprint(row) !== rowFingerprint(previousRow)) updatedIds.push(id);
    }
    for (const id of previousById.keys()) {
      if (!currentById.has(id)) removedIds.push(id);
    }

    changes[table.name] = {
      added: addedIds.length,
      updated: updatedIds.length,
      removed: removedIds.length,
      addedIds,
      updatedIds,
      removedIds
    };
  }

  return changes;
}

async function readAllRows(env: Env, table: (typeof BACKUP_TABLES)[number]) {
  const rows: BackupRow[] = [];
  let offset = 0;

  while (true) {
    const result = await env.DB.prepare(`
      SELECT *
      FROM ${table.name}
      ORDER BY ${table.orderBy}
      LIMIT ? OFFSET ?
    `).bind(PAGE_SIZE, offset).all();
    const page = (result.results || []) as BackupRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

async function createSnapshot(env: Env, createdAt: string): Promise<BackupSnapshot> {
  const entries = await Promise.all(
    BACKUP_TABLES.map(async (table) => [table.name, await readAllRows(env, table)] as const)
  );
  return {
    version: BACKUP_VERSION,
    createdAt,
    source: {
      type: 'cloudflare-d1',
      database: 'shiraz-stunden-db'
    },
    tables: Object.fromEntries(entries) as BackupTables
  };
}

export async function getBackupStatus(env: Env): Promise<BackupLatest | null> {
  return env.BACKUPS.get<BackupLatest>('backup:latest', 'json');
}

export async function runNightlyBackup(
  env: Env,
  trigger: 'manual' | 'scheduled'
): Promise<BackupLatest> {
  const createdAt = new Date().toISOString();
  const safeTimestamp = createdAt.replace(/[:.]/g, '-');
  const date = createdAt.slice(0, 10);
  const snapshotKey = `backup:snapshots:${date}:${safeTimestamp}.json`;
  const changesKey = `backup:changes:${date}:${safeTimestamp}.json`;

  const previousLatest = await getBackupStatus(env);
  const previousSnapshot = previousLatest
    ? await env.BACKUPS.get<BackupSnapshot>(previousLatest.snapshotKey, 'json')
    : null;
  const snapshot = await createSnapshot(env, createdAt);
  const serializedSnapshot = JSON.stringify(snapshot);
  const sizeBytes = new TextEncoder().encode(serializedSnapshot).byteLength;
  if (sizeBytes > MAX_BACKUP_BYTES) {
    throw new Error('Nightly backup exceeds the safe Cloudflare KV value limit.');
  }

  const contentHash = await sha256Hex(JSON.stringify(snapshot.tables));
  const changes = compareBackupTables(snapshot.tables, previousSnapshot?.tables || {});
  const tableCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table.name, snapshot.tables[table.name].length])
  ) as Record<BackupTableName, number>;
  const changeCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => {
      const change = changes[table.name];
      return [table.name, {
        added: change.added,
        updated: change.updated,
        removed: change.removed
      }];
    })
  ) as Record<BackupTableName, TableChangeSummary>;

  const latest: BackupLatest = {
    version: BACKUP_VERSION,
    createdAt,
    trigger,
    snapshotKey,
    changesKey,
    contentHash,
    sizeBytes,
    previousSnapshotKey: previousLatest?.snapshotKey || null,
    tableCounts,
    changeCounts
  };

  await env.BACKUPS.put(snapshotKey, serializedSnapshot, {
    metadata: { kind: 'snapshot', createdAt, contentHash }
  });
  await env.BACKUPS.put(changesKey, JSON.stringify({
    version: BACKUP_VERSION,
    createdAt,
    previousSnapshotKey: previousLatest?.snapshotKey || null,
    snapshotKey,
    changes
  }), {
    metadata: { kind: 'changes', createdAt }
  });
  await env.BACKUPS.put('backup:latest', JSON.stringify(latest), {
    metadata: { kind: 'latest', createdAt, contentHash }
  });

  console.log(JSON.stringify({
    event: 'nightly_backup_complete',
    ...latest
  }));
  return latest;
}
