-- Move Catering under Shiraz and reassign the three requested managers.
-- Historical scan/audit payloads are intentionally left unchanged.

UPDATE shifts
SET business = 'Shiraz', department = 'Catering', updated_at = datetime('now')
WHERE business = 'Catering' AND department = 'Catering';

UPDATE staff_members
SET business = 'Shiraz', department = 'Catering', updated_at = datetime('now')
WHERE business = 'Catering' AND department = 'Catering';

UPDATE scan_aliases
SET business = 'Shiraz', department = 'Catering', final_department = 'Catering',
    updated_at = datetime('now')
WHERE business = 'Catering' AND department = 'Catering';

UPDATE shifts
SET department = 'Service', updated_at = datetime('now')
WHERE business = 'Shiraz' AND department = 'Betriebsleiter' AND employee_key = 'kianoush';

UPDATE shifts
SET department = 'Fahrer', updated_at = datetime('now')
WHERE business = 'Shiraz' AND department = 'Betriebsleiter' AND employee_key = 'amir';

UPDATE shifts
SET department = 'Bar', updated_at = datetime('now')
WHERE business = 'Shiraz' AND department = 'Betriebsleiter' AND employee_key = 'pascha';

UPDATE staff_members
SET department = CASE employee_key
  WHEN 'kianoush' THEN 'Service'
  WHEN 'amir' THEN 'Fahrer'
  WHEN 'pascha' THEN 'Bar'
  ELSE department
END,
updated_at = datetime('now')
WHERE business = 'Shiraz'
  AND department = 'Betriebsleiter'
  AND employee_key IN ('kianoush', 'amir', 'pascha');

UPDATE scan_aliases
SET final_department = CASE employee_key
  WHEN 'kianoush' THEN 'Service'
  WHEN 'amir' THEN 'Fahrer'
  WHEN 'pascha' THEN 'Bar'
  ELSE final_department
END,
updated_at = datetime('now')
WHERE business = 'Shiraz'
  AND employee_key IN ('kianoush', 'amir', 'pascha');
