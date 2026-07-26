PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL CHECK (business IN ('Shiraz', 'Djadoo', 'Catering')),
  department TEXT NOT NULL,
  employee TEXT NOT NULL,
  employee_key TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_unique_active
ON staff_members (business, department, employee_key)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_visible
ON staff_members (business, department, hidden, deleted_at);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL CHECK (business IN ('Shiraz', 'Djadoo', 'Catering')),
  department TEXT NOT NULL,
  employee TEXT NOT NULL,
  employee_key TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_hours REAL NOT NULL CHECK (duration_hours >= 0 AND duration_hours <= 24),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_duplicate_active
ON shifts (business, department, employee_key, date, start_time, end_time)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts (date);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts (employee_key, date);
CREATE INDEX IF NOT EXISTS idx_shifts_department ON shifts (business, department, date);

CREATE TABLE IF NOT EXISTS hinweise (
  id TEXT PRIMARY KEY,
  employee TEXT NOT NULL,
  employee_key TEXT NOT NULL,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hinweise_employee ON hinweise (employee_key, date);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS export_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  spreadsheet_id TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT,
  actor_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
