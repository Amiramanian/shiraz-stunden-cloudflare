import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledExportKey } from '../worker/scheduled-export.ts';

test('scheduled export uses one UTC reservation key per day', () => {
  const first = Date.parse('2026-08-09T02:15:00.000Z');
  const duplicate = Date.parse('2026-08-09T02:15:30.000Z');

  assert.equal(
    scheduledExportKey(first),
    'scheduled-report-export:2026-08-09'
  );
  assert.equal(scheduledExportKey(first), scheduledExportKey(duplicate));
});

test('scheduled export creates a new reservation on the next UTC day', () => {
  const first = Date.parse('2026-08-09T23:59:59.000Z');
  const next = Date.parse('2026-08-10T00:00:00.000Z');

  assert.notEqual(scheduledExportKey(first), scheduledExportKey(next));
});

test('scheduled export rejects an invalid scheduled time', () => {
  assert.throws(
    () => scheduledExportKey(Number.NaN),
    /Scheduled export time is invalid/
  );
});
