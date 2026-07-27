import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDurationHours, normalizeTimeString } from '../src/lib/timeUtils.js';

test('keeps handwritten quarter-hour times', () => {
  assert.equal(normalizeTimeString('22:45'), '22:45');
  assert.equal(normalizeTimeString('17.15'), '17:15');
});

test('calculates overnight shifts with arbitrary minutes', () => {
  assert.equal(calculateDurationHours('17:15', '00:45'), 7.5);
});
