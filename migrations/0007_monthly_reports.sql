CREATE TABLE IF NOT EXISTS monthly_reports (
  id TEXT PRIMARY KEY,
  report_month TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  spreadsheet_id TEXT NOT NULL UNIQUE,
  web_view_link TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monthly_reports_month
  ON monthly_reports(report_month DESC);
