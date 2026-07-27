-- Persist structured user corrections and the corrected department for future scans.

ALTER TABLE scan_aliases ADD COLUMN final_department TEXT;

UPDATE scan_aliases
SET final_department = department
WHERE final_department IS NULL OR trim(final_department) = '';

ALTER TABLE scan_corrections ADD COLUMN raw_department TEXT;
ALTER TABLE scan_corrections ADD COLUMN final_department TEXT;
ALTER TABLE scan_corrections ADD COLUMN original_json TEXT;
ALTER TABLE scan_corrections ADD COLUMN final_json TEXT;
ALTER TABLE scan_corrections ADD COLUMN correction_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_corrections_unique
ON scan_corrections (correction_key)
WHERE correction_key IS NOT NULL;
