import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingSheetRequests,
  buildSheetCapacityRequests,
  buildStaleSheetClearRanges
} from '../worker/google-sheets.ts';
import { reportMonthsForDates } from '../worker/monthly-report.ts';

test('missing sheet requests contain only valid Google Sheets API fields', () => {
  const requests = buildMissingSheetRequests([
    { title: 'IT', values: [['Name'], ['Amir2']] },
    { title: 'Bar', values: [['Name']] }
  ], new Set(['Bar']));

  assert.deepEqual(requests, [{
    addSheet: {
      properties: {
        title: 'IT',
        hidden: false,
        gridProperties: {
          rowCount: 100,
          columnCount: 2
        }
      }
    }
  }]);
  assert.equal('authMode' in requests[0], false);
});

test('affected monthly files are deduplicated from shift and note dates', () => {
  assert.deepEqual(
    reportMonthsForDates('2026-08-01', '2026-08-10', '2026-09-02', 'invalid'),
    ['2026-08', '2026-09']
  );
});

test('sheet clearing touches only stale rows and columns after replacement data', () => {
  assert.deepEqual(
    buildStaleSheetClearRanges(
      [
        { title: 'Bearbeiten_Schichten', values: Array.from({ length: 10 }, () => Array(8).fill('x')) },
        { title: "Chef's view", values: Array.from({ length: 20 }, () => ['x', 'y']) }
      ],
      [
        {
          properties: {
            sheetId: 1,
            title: 'Bearbeiten_Schichten',
            gridProperties: { rowCount: 1000, columnCount: 8 }
          }
        },
        {
          properties: {
            sheetId: 2,
            title: "Chef's view",
            gridProperties: { rowCount: 120, columnCount: 28 }
          }
        }
      ]
    ),
    [
      "'Bearbeiten_Schichten'!A11:H1000",
      "'Chef''s view'!A21:AB120",
      "'Chef''s view'!C1:AB20"
    ]
  );
});

test('sheet capacity expands without shrinking the last good export', () => {
  assert.deepEqual(
    buildSheetCapacityRequests(
      [{ title: 'Schichten', values: Array.from({ length: 120 }, () => Array(10).fill('x')) }],
      [{
        properties: {
          sheetId: 42,
          title: 'Schichten',
          gridProperties: { rowCount: 100, columnCount: 8 }
        }
      }]
    ),
    [{
      updateSheetProperties: {
        properties: {
          sheetId: 42,
          gridProperties: { rowCount: 120, columnCount: 10 }
        },
        fields: 'gridProperties(rowCount,columnCount)'
      }
    }]
  );

  assert.deepEqual(
    buildSheetCapacityRequests(
      [{ title: 'Schichten', values: [['new']] }],
      [{
        properties: {
          sheetId: 42,
          title: 'Schichten',
          gridProperties: { rowCount: 100, columnCount: 8 }
        }
      }]
    ),
    []
  );
});
