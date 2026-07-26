import type { Env } from './types';
import type { SheetPlan } from './report-data';

interface GoogleTokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: GoogleTokenCache | null = null;

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function getGoogleAccessToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets are not configured.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;

  const normalizedPem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const keyBody = normalizedPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(keyBody).buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );
  const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`Google OAuth failed: ${await response.text()}`);
  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
  return tokenCache.token;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function googleFetch<T>(env: Env, url: string, init: RequestInit = {}): Promise<T> {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = await getGoogleAccessToken(env);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });

    if (response.ok) return response.json() as Promise<T>;

    const responseText = await response.text();
    if (!retryableStatuses.has(response.status) || attempt === maxAttempts - 1) {
      throw new Error(`Google Sheets API ${response.status}: ${responseText}`);
    }

    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
    const exponentialDelay = Math.min(64_000, 1_000 * (2 ** attempt));
    const jitter = Math.floor(Math.random() * 1_000);
    const delay = Number.isFinite(retryAfterSeconds)
      ? Math.max(exponentialDelay, retryAfterSeconds * 1_000)
      : exponentialDelay + jitter;
    await wait(delay);
  }

  throw new Error('Google Sheets API request failed after retries.');
}

function escapeSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

interface SheetMetadata {
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      hidden?: boolean;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }>;
}

const COLORS = {
  black: { red: 0, green: 0, blue: 0 },
  white: { red: 1, green: 1, blue: 1 },
  lightBlue: { red: 0.88, green: 0.93, blue: 0.98 },
  headerBlue: { red: 0.75, green: 0.84, blue: 0.94 },
  yellow: { red: 1, green: 0.9, blue: 0.6 },
  border: { red: 0.35, green: 0.35, blue: 0.35 }
};

function fullGridRange(sheetId: number, rows: number, columns: number) {
  return {
    sheetId,
    startRowIndex: 0,
    endRowIndex: Math.max(rows, 1),
    startColumnIndex: 0,
    endColumnIndex: Math.max(columns, 1)
  };
}

function borderStyle() {
  return { style: 'SOLID', color: COLORS.border };
}

function buildFormattingRequests(
  plan: SheetPlan,
  sheetId: number
): Record<string, unknown>[] {
  const rowCount = Math.max(plan.values.length + 20, 100);
  const columnCount = Math.max(...plan.values.map((row) => row.length), 2);
  const dataRows = Math.max(plan.values.length, 1);
  const requests: Record<string, unknown>[] = [
    {
      unmergeCells: {
        range: fullGridRange(sheetId, rowCount, columnCount)
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          hidden: Boolean(plan.hidden),
          gridProperties: { rowCount, columnCount }
        },
        fields: 'hidden,gridProperties(rowCount,columnCount)'
      }
    },
    {
      repeatCell: {
        range: fullGridRange(sheetId, dataRows, columnCount),
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.lightBlue,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            textFormat: { foregroundColor: COLORS.black },
            borders: {
              top: borderStyle(),
              bottom: borderStyle(),
              left: borderStyle(),
              right: borderStyle()
            }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat.foregroundColor,borders)'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.black,
            textFormat: { foregroundColor: COLORS.white, bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: Math.min(2, dataRows), startColumnIndex: 0, endColumnIndex: columnCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.headerBlue,
            textFormat: { bold: true },
            horizontalAlignment: 'CENTER'
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold,horizontalAlignment)'
      }
    }
  ];

  if (plan.employeeBlocks?.length) {
    for (const block of plan.employeeBlocks) {
      requests.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: block.startColumn,
            endColumnIndex: block.startColumn + 4
          },
          mergeType: 'MERGE_ALL'
        }
      });
      for (const totalRow of block.totalRows) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: totalRow,
              endRowIndex: totalRow + 1,
              startColumnIndex: block.startColumn,
              endColumnIndex: block.startColumn + 4
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: COLORS.yellow,
                textFormat: { bold: true }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat.bold)'
          }
        });
      }

      const widths = [110, 80, 80, 80, 28];
      widths.forEach((pixelSize, offset) => {
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: block.startColumn + offset,
              endIndex: block.startColumn + offset + 1
            },
            properties: { pixelSize },
            fields: 'pixelSize'
          }
        });
      });
    }
  } else if (!plan.title.startsWith('Bearbeiten_')) {
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: Math.min(2, columnCount) },
        mergeType: 'MERGE_ALL'
      }
    });
  }

  if (plan.title.startsWith('Bearbeiten_')) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.black,
            textFormat: { foregroundColor: COLORS.white, bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    });
  }

  return requests;
}

export async function updateGoogleSpreadsheet(env: Env, plans: SheetPlan[]) {
  const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId || spreadsheetId.startsWith('REPLACE_')) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not configured.');
  }

  let metadata = await googleFetch<SheetMetadata>(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`
  );
  const existingTitles = new Set(metadata.sheets.map((sheet) => sheet.properties.title));
  const addRequests = plans
    .filter((plan) => !existingTitles.has(plan.title))
    .map((plan) => ({
      addSheet: {
        properties: {
          title: plan.title,
          hidden: Boolean(plan.hidden),
          gridProperties: {
            rowCount: Math.max(plan.values.length + 20, 100),
            columnCount: Math.max(...plan.values.map((row) => row.length), 2)
          }
        }
      }
    }));

  if (addRequests.length) {
    await googleFetch(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: addRequests })
    });
    metadata = await googleFetch<SheetMetadata>(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`
    );
  }

  const sheetIdByTitle = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));

  const clearRanges = plans.map((plan) => escapeSheetTitle(plan.title));
  await googleFetch(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: clearRanges })
  });

  await googleFetch(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: plans.map((plan) => ({
        range: `${escapeSheetTitle(plan.title)}!A1`,
        majorDimension: 'ROWS',
        values: plan.values
      }))
    })
  });

  const formattingRequests: Record<string, unknown>[] = [];
  for (const plan of plans) {
    const sheetId = sheetIdByTitle.get(plan.title);
    if (sheetId == null) throw new Error(`Google Sheet tab was not created: ${plan.title}`);
    formattingRequests.push(...buildFormattingRequests(plan, sheetId));
  }

  const chunkSize = 300;
  for (let start = 0; start < formattingRequests.length; start += chunkSize) {
    await googleFetch(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: formattingRequests.slice(start, start + chunkSize) })
    });
  }

  return {
    spreadsheetId,
    webViewLink: env.GOOGLE_SHEET_URL || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    updatedSheets: plans.length
  };
}
