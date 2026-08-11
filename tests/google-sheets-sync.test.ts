import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingSheetRequests,
  buildSheetClearRanges
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

test('sheet clearing covers the complete allocated grid including stale tail rows', () => {
  assert.deepEqual(
    buildSheetClearRanges(
      [{ title: 'Bearbeiten_Schichten' }, { title: "Chef's view" }],
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
    ["'Bearbeiten_Schichten'!A1:H1000", "'Chef''s view'!A1:AB120"]
  );
});
