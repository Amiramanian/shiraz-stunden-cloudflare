-- Serialize full Google Sheets rebuilds so concurrent saves cannot clear each other's data.

CREATE TABLE IF NOT EXISTS export_locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
