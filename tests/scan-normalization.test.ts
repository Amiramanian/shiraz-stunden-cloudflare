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
import {
  changesScanIdentity,
  getChangedCorrectionFields,
  isActualScanCorrection
} from '../worker/scan-corrections.ts';
import { compareBackupTables } from '../worker/backup.ts';
import {
  isDateInReportMonth,
  validateMonthlyReportInput
} from '../worker/monthly-report.ts';

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
  assert.ok(config.Shiraz.Catering.includes('Pascha'));
  assert.ok(config.Shiraz.Service.includes('Kianoush'));
  assert.ok(config.Shiraz.Fahrer.includes('Amir'));
  assert.ok(config.Shiraz.Bar.includes('Pascha'));
  assert.equal(config.Djadoo.Technik, undefined);
  assert.equal(config.Shiraz.Betriebsleiter, undefined);
  assert.equal(config.Catering, undefined);
});

test('monthly reports validate names and include only the selected month', () => {
  assert.deepEqual(
    validateMonthlyReportInput('2026-08', '  Arbeitszeiten   August 2026  '),
    { month: '2026-08', fileName: 'Arbeitszeiten August 2026' }
  );
  assert.equal(isDateInReportMonth('2026-08-01', '2026-08'), true);
  assert.equal(isDateInReportMonth('2026-07-31', '2026-08'), false);
  assert.throws(
    () => validateMonthlyReportInput('2026-13', 'Arbeitszeiten'),
    /YYYY-MM/
  );
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
    'Fahrer',
    staff,
    { employee: 'Amir2', department: 'Bar' }
  );
  assert.equal(unnumbered.employee, 'Amir');
  assert.equal(unnumbered.department, 'Fahrer');

  const numbered = matchScannedStaff(
    'Amir2',
    'Bar',
    staff,
    { employee: 'Amir', department: 'Fahrer' }
  );
  assert.equal(numbered.employee, 'Amir2');
  assert.equal(numbered.department, 'Bar');

  assert.equal(hasCompatibleNameNumber('Amir', 'Amir2'), false);
  assert.equal(hasCompatibleNameNumber('Amir2', 'Amir'), false);
  assert.equal(hasCompatibleNameNumber('Amir2', 'Amir2'), true);
  assert.equal(hasCompatibleNameNumber('Mirhadar', 'Mirheiydar'), true);
});

test('scan corrections share one normalized alias key', () => {
  assert.equal(normalizeScanAliasName(' Malik.T '), 'malikt');
  assert.equal(normalizeScanAliasName('Malik   T'), 'malikt');
  assert.equal(normalizeScanAliasName('Mir-hei_dar'), 'mirheidar');
});

test('AI learning is recorded only for an actual user correction', () => {
  const unchanged = {
    rawEmployee: 'Mirhadar',
    original: {
      employee: 'Mirheiydar',
      department: 'Personal',
      date: '2026-07-27',
      startTime: '17:00',
      endTime: '23:00'
    },
    final: {
      employee: ' Mirheiydar ',
      department: 'personal',
      date: '2026-07-27',
      startTime: '17:00',
      endTime: '23:00'
    }
  };
  assert.equal(isActualScanCorrection(unchanged), false);
  assert.deepEqual(getChangedCorrectionFields(unchanged.original, unchanged.final), []);
  assert.equal(changesScanIdentity(unchanged), false);

  const timeCorrection = {
    ...unchanged,
    final: { ...unchanged.final, endTime: '22:30' }
  };
  assert.equal(isActualScanCorrection(timeCorrection), true);
  assert.deepEqual(
    getChangedCorrectionFields(timeCorrection.original, timeCorrection.final),
    ['endTime']
  );
  assert.equal(changesScanIdentity(timeCorrection), false);

  const nameCorrection = {
    ...unchanged,
    final: { ...unchanged.final, employee: 'Nabi' }
  };
  assert.equal(isActualScanCorrection(nameCorrection), true);
  assert.equal(changesScanIdentity(nameCorrection), true);
});

test('nightly backup comparison detects added, updated, and removed rows', () => {
  const changes = compareBackupTables(
    {
      shifts: [
        { id: 'kept', employee: 'Amir2', start_time: '12:30' },
        { id: 'added', employee: 'Nima', start_time: '17:00' }
      ]
    },
    {
      shifts: [
        { id: 'kept', employee: 'Amir2', start_time: '12:00' },
        { id: 'removed', employee: 'Malik', start_time: '18:00' }
      ]
    }
  );

  assert.deepEqual(changes.shifts, {
    added: 1,
    updated: 1,
    removed: 1,
    addedIds: ['added'],
    updatedIds: ['kept'],
    removedIds: ['removed']
  });
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
