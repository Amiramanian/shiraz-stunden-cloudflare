-- Scan history and aliases for AI schedule scanner

CREATE TABLE IF NOT EXISTS scan_aliases (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL CHECK (business IN ('Shiraz', 'Djadoo', 'Catering')),
  department TEXT NOT NULL,
  raw_name TEXT NOT NULL,
  normalized_raw_name TEXT NOT NULL,
  employee TEXT NOT NULL,
  employee_key TEXT NOT NULL,
  correction_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business, department, normalized_raw_name)
);

CREATE INDEX IF NOT EXISTS idx_scan_aliases_lookup
ON scan_aliases (business, department, normalized_raw_name);

CREATE TABLE IF NOT EXISTS scan_history (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL CHECK (business IN ('Shiraz', 'Djadoo', 'Catering')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_email TEXT,
  provider TEXT NOT NULL DEFAULT 'tesseract+freemodel',
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'success', 'error')) DEFAULT 'processing',
  image_count INTEGER,
  ocr_text TEXT,
  ai_response_json TEXT,
  merged_result_json TEXT,
  final_result_json TEXT,
  saved_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_history_created
ON scan_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_history_business
ON scan_history (business, created_at DESC);

CREATE TABLE IF NOT EXISTS scan_corrections (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  raw_employee TEXT NOT NULL,
  suggested_employee TEXT,
  final_employee TEXT NOT NULL,
  business TEXT NOT NULL,
  department TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (scan_id) REFERENCES scan_history(id)
);

CREATE INDEX IF NOT EXISTS idx_scan_corrections_scan
ON scan_corrections (scan_id);

CREATE INDEX IF NOT EXISTS idx_scan_corrections_business_dept
ON scan_corrections (business, department);
