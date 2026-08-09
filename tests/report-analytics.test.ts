import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnalyticsRange } from '../worker/report-analytics.ts';
import {
  buildMonthlyWeekdayRows,
  datesForWeekdayInMonth
} from '../src/lib/monthly-weekday.js';

test('weekly analytics range always runs from Monday through Sunday', () => {
  assert.deepEqual(resolveAnalyticsRange('week', '2026-08-03'), {
    period: 'week',
    anchor: '2026-08-03',
    startDate: '2026-08-03',
    endDate: '2026-08-09',
    label: '03.08.2026 – 09.08.2026'
  });

  const sunday = resolveAnalyticsRange('week', '2026-08-09');
  assert.equal(sunday.startDate, '2026-08-03');
  assert.equal(sunday.endDate, '2026-08-09');
});

test('weekly analytics range crosses year boundaries correctly', () => {
  const result = resolveAnalyticsRange('week', '2027-01-01');
  assert.equal(result.startDate, '2026-12-28');
  assert.equal(result.endDate, '2027-01-03');
});

test('daily analytics range covers only the selected date', () => {
  assert.deepEqual(resolveAnalyticsRange('day', '2026-08-03'), {
    period: 'day',
    anchor: '2026-08-03',
    startDate: '2026-08-03',
    endDate: '2026-08-03',
    label: '03.08.2026'
  });
});

test('monthly analytics range supports leap years', () => {
  const result = resolveAnalyticsRange('month', '2028-02');
  assert.equal(result.startDate, '2028-02-01');
  assert.equal(result.endDate, '2028-02-29');
  assert.equal(result.label, 'Februar 2028');
});

test('analytics range rejects invalid input', () => {
  assert.throws(() => resolveAnalyticsRange('quarter', '2026-08-03'));
  assert.throws(() => resolveAnalyticsRange('day', '2026-02-30'));
  assert.throws(() => resolveAnalyticsRange('week', '2026-02-30'));
  assert.throws(() => resolveAnalyticsRange('month', '2026-13'));
});

test('monthly weekday comparison includes every matching calendar date', () => {
  assert.deepEqual(datesForWeekdayInMonth('2026-08', 1), [
    '2026-08-03',
    '2026-08-10',
    '2026-08-17',
    '2026-08-24',
    '2026-08-31'
  ]);
  assert.deepEqual(datesForWeekdayInMonth('2026-02', 1), [
    '2026-02-02',
    '2026-02-09',
    '2026-02-16',
    '2026-02-23'
  ]);
});

test('monthly weekday comparison sums departments and preserves zero-hour days', () => {
  const rows = buildMonthlyWeekdayRows([
    { date: '2026-02-02', hours: 5.5, shiftCount: 1 },
    { date: '2026-02-02', hours: 3, shiftCount: 2 },
    { date: '2026-02-16', hours: 7.25, shiftCount: 1 },
    { date: '2026-02-17', hours: 99, shiftCount: 9 }
  ], '2026-02', 1);

  assert.deepEqual(rows, [
    { occurrence: 1, date: '2026-02-02', hours: 8.5, shiftCount: 3 },
    { occurrence: 2, date: '2026-02-09', hours: 0, shiftCount: 0 },
    { occurrence: 3, date: '2026-02-16', hours: 7.25, shiftCount: 1 },
    { occurrence: 4, date: '2026-02-23', hours: 0, shiftCount: 0 }
  ]);
});
