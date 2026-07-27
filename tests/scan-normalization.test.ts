import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeScanDate,
  parseWrittenHours
} from '../worker/scan-normalization.ts';

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
