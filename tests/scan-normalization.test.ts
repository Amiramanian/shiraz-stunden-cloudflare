import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeScanDate,
  parseWrittenHours
} from '../worker/scan-normalization.ts';
import {
  buildEffectiveStaffConfig,
  canonicalizeKnownScanName,
  canonicalScanDepartment,
  hasCompatibleNameNumber,
  hasScanTechnicalMarker,
  isScanSectionHeading,
  matchScannedStaff
} from '../worker/staff-config.ts';
import { normalizeScanAliasName } from '../worker/db.ts';

function flattenBusiness(
  config: Record<string, Record<string, string[]>>,
  business: string
) {
  return Object.entries(config[business] || {}).flatMap(([department, employees]) =>
    employees.map((employee) => ({ business, department, employee }))
  );
}

test('keeps valid ISO dates', () => {
  assert.deepEqual(normalizeScanDate('2026-07-27', '2026-07-27'), {
    date: '2026-07-27',
    usedFallback: false
  });
});

test('normalizes German dates', () => {
  assert.equal(
    normalizeScanDate('27.07.2026', '2026-07-20').date,
    '2026-07-27'
  );
});

test('infers the closest year for short dates', () => {
  assert.equal(
    normalizeScanDate('02.01.', '2026-12-29').date,
    '2027-01-02'
  );
});

test('normalizes Persian digits', () => {
  assert.equal(
    normalizeScanDate('۲۷.۰۷.۲۰۲۶', '2026-07-20').date,
    '2026-07-27'
  );
});

test('resolves relative dates', () => {
  assert.equal(
    normalizeScanDate('morgen', '2026-07-27').date,
    '2026-07-28'
  );
});

test('never replaces impossible dates with today', () => {
  const result = normalizeScanDate('31.02.2026', '2026-07-27');
  assert.equal(result.date, '');
  assert.equal(result.usedFallback, true);
  assert.match(result.warning || '', /muss geprüft/);
});

test('never replaces a missing date with today', () => {
  const result = normalizeScanDate('', '2026-07-27');
  assert.equal(result.date, '');
  assert.equal(result.usedFallback, true);
});


test('normalizes handwritten sum shorthand', () => {
  assert.equal(parseWrittenHours('10,5'), 10.5);
  assert.equal(parseWrittenHours('105'), 10.5);
  assert.equal(parseWrittenHours('6:30 Std'), 6.5);
});

test('server staff config combines the built-in roster with visible D1 staff', () => {
  const config = buildEffectiveStaffConfig([{
    business: 'Djadoo',
    department: 'Personal',
    employee: 'Server Only Employee',
    employeeKey: 'server only employee',
    hidden: false
  }]);

  assert.ok(config.Djadoo.Personal.includes('Mirheiydar'));
  assert.ok(config.Djadoo.Personal.includes('Server Only Employee'));
});

test('canonical scan aliases resolve known handwriting variants', () => {
  for (const variant of ['Mirheidar', 'Mirhadar', 'Mirheydar']) {
    assert.equal(canonicalizeKnownScanName(variant), 'Mirheiydar');
  }
  assert.equal(canonicalizeKnownScanName('Malik.t'), 'Malik Tanwir');
  assert.equal(canonicalizeKnownScanName('Malikt'), 'Malik Tanwir');
});

test('strict staff matching applies canonical aliases without merging Amir2 and Amir', () => {
  const config = buildEffectiveStaffConfig();
  const djadooStaff = flattenBusiness(config, 'Djadoo');
  const shirazStaff = flattenBusiness(config, 'Shiraz');

  for (const variant of ['Mirheidar', 'Mirhadar', 'Mirheydar']) {
    assert.equal(
      matchScannedStaff(variant, 'Personal', djadooStaff, null).employee,
      'Mirheiydar'
    );
  }
  for (const variant of ['Malik.t', 'Malikt']) {
    assert.equal(
      matchScannedStaff(variant, 'Fahrer', shirazStaff, null).employee,
      'Malik Tanwir'
    );
  }

  assert.equal(
    matchScannedStaff(
      'Amir2',
      'Betriebsleiter',
      [{ business: 'Shiraz', department: 'Betriebsleiter', employee: 'Amir' }],
      null
    ).matched,
    false
  );
  assert.equal(
    matchScannedStaff(
      'Amir',
      'Bar',
      [{ business: 'Shiraz', department: 'Bar', employee: 'Amir2' }],
      null
    ).matched,
    false
  );
});

test('learned D1 alias has priority over built-in and fuzzy name matching', () => {
  const config = buildEffectiveStaffConfig();
  const staff = flattenBusiness(config, 'Djadoo');
  const match = matchScannedStaff(
    'Mirhadar',
    'Personal',
    staff,
    { employee: 'Nabi', department: 'Personal' }
  );

  assert.equal(match.employee, 'Nabi');
  assert.equal(match.department, 'Personal');
  assert.equal(match.matched, true);
});

test('learned aliases cannot merge numbered and unnumbered employees', () => {
  const config = buildEffectiveStaffConfig();
  const staff = flattenBusiness(config, 'Shiraz');

  const unnumbered = matchScannedStaff(
    'Amir',
    'Betriebsleiter',
    staff,
    { employee: 'Amir2', department: 'Bar' }
  );
  assert.equal(unnumbered.employee, 'Amir');
  assert.equal(unnumbered.department, 'Betriebsleiter');

  const numbered = matchScannedStaff(
    'Amir2',
    'Bar',
    staff,
    { employee: 'Amir', department: 'Betriebsleiter' }
  );
  assert.equal(numbered.employee, 'Amir2');
  assert.equal(numbered.department, 'Bar');

  assert.equal(hasCompatibleNameNumber('Amir', 'Amir2'), false);
  assert.equal(hasCompatibleNameNumber('Amir2', 'Amir'), false);
  assert.equal(hasCompatibleNameNumber('Amir2', 'Amir2'), true);
  assert.equal(hasCompatibleNameNumber('Mirhadar', 'Mirheiydar'), true);
});

test('photo and voice corrections share one normalized alias key', () => {
  assert.equal(normalizeScanAliasName(' Malik.T '), 'malikt');
  assert.equal(normalizeScanAliasName('Malik   T'), 'malikt');
  assert.equal(normalizeScanAliasName('Mir-hei_dar'), 'mirheidar');
});

test('Tech or Technik beside a name overrides the printed section', () => {
  const config = buildEffectiveStaffConfig();
  const departments = Object.keys(config.Shiraz);
  const technical = hasScanTechnicalMarker(
    'Küche',
    'Masoud',
    'Masoud (Technik) | 23:00 | 01:30'
  );
  const department = canonicalScanDepartment(
    'Shiraz',
    technical ? 'Technik' : 'Küche',
    departments
  );
  const match = matchScannedStaff(
    'Masoud',
    department,
    flattenBusiness(config, 'Shiraz'),
    null
  );

  assert.equal(department, 'Technik');
  assert.equal(match.department, 'Technik');
});

test('row-relative dates resolve against that image document date and stay higher priority', () => {
  const documentDate = '2026-07-08';
  assert.equal(normalizeScanDate('gestern', documentDate).date, '2026-07-07');
  assert.equal(normalizeScanDate('دیروز', documentDate).date, '2026-07-07');
  assert.equal(normalizeScanDate('2026-07-03', documentDate).date, '2026-07-03');
});

test('large department headings are never accepted as employees', () => {
  assert.equal(isScanSectionHeading('BETRIEBSLEITER'), true);
  assert.equal(isScanSectionHeading('KÜCHE'), true);
  assert.equal(isScanSectionHeading('Mirheiydar'), false);
});
