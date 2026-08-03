import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnalyticsRange } from '../worker/report-analytics.ts';

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

test('monthly analytics range supports leap years', () => {
  const result = resolveAnalyticsRange('month', '2028-02');
  assert.equal(result.startDate, '2028-02-01');
  assert.equal(result.endDate, '2028-02-29');
  assert.equal(result.label, 'Februar 2028');
});

test('analytics range rejects invalid input', () => {
  assert.throws(() => resolveAnalyticsRange('day', '2026-08-03'));
  assert.throws(() => resolveAnalyticsRange('week', '2026-02-30'));
  assert.throws(() => resolveAnalyticsRange('month', '2026-13'));
});
