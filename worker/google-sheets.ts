import type { Env } from './types';
import type { SheetPlan } from './report-data';

interface GoogleTokenCache {
  token: string;
  expiresAt: number;
}

// Global token cache (in-memory during Worker execution)
let tokenCache: GoogleTokenCache | null = null;

/**
 * Encodes bytes to base64url format (RFC 4648 Table 2)
 */
function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  // Replace URL-unsafe characters and remove padding
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Decodes a base64 string to Uint8Array
 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Obtains or refreshes Google OAuth2 access token using Service Account JWT
 */
async function getGoogleAccessToken(env: Env): Promise<string> {
  // Return cached token if still valid (with 1 minute buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  // Validate secrets are configured
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets are not configured.');
  }

  // Create JWT header and claims
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: env.GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const unsignedToken = `${header}.${claims}`;

  // Extract and decode private key
  const normalizedPem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const keyBody = normalizedPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const keyBytes = decodeBase64(keyBody);

  // Import private key for signing
  // Copy into a plain ArrayBuffer — Uint8Array.buffer is typed as ArrayBufferLike
  // which may be SharedArrayBuffer; Web Crypto requires a plain ArrayBuffer.
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign JWT with private key
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );
  const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;

  // Exchange JWT for access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Google OAuth failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };

  return tokenCache.token;
}

/**
 * Sleep helper for retry delays
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Authenticated fetch wrapper with retry logic for Google Sheets API
 */
async function googleFetch<T>(
  env: Env,
  url: string,
  init: RequestInit = {}
): Promise<T> {
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

    if (response.ok) {
      return (await response.json()) as T;
    }

    const responseText = await response.text();
    if (!retryableStatuses.has(response.status) || attempt === maxAttempts - 1) {
      throw new Error(`Google Sheets API ${response.status}: ${responseText}`);
    }

    // Calculate retry delay
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

/**
 * Escapes sheet title for A1 notation (wrap in quotes and escape internal quotes)
 */
function escapeSheetTitle(title: string): string {
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
    protectedRanges?: Array<{
      protectedRangeId: number;
      description?: string;
    }>;
  }>;
}

// Color definitions for formatting
const COLORS = {
  black: { red: 0, green: 0, blue: 0 },
  white: { red: 1, green: 1, blue: 1 },
  lightBlue: { red: 0.88, green: 0.93, blue: 0.98 },
  headerBlue: { red: 0.75, green: 0.84, blue: 0.94 },
  separatorBlue: { red: 0.12, green: 0.29, blue: 0.52 },
  yellow: { red: 1, green: 0.9, blue: 0.6 },
  border: { red: 0.35, green: 0.35, blue: 0.35 }
};

const PROTECTION_PREFIX = 'Von der Website verwaltet: ';

/**
 * Builds full grid range for a sheet
 */
function fullGridRange(
  sheetId: number,
  rows: number,
  columns: number
): Record<string, number> {
  return {
    sheetId,
    startRowIndex: 0,
    endRowIndex: Math.max(rows, 1),
    startColumnIndex: 0,
    endColumnIndex: Math.max(columns, 1)
  };
}

/**
 * Creates border style specification
 */
function borderStyle(): Record<string, string | Record<string, number>> {
  return { style: 'SOLID', color: COLORS.border };
}

/**
 * Builds batchUpdate formatting requests for a sheet
 */
function buildFormattingRequests(
  plan: SheetPlan,
  sheetId: number
): Record<string, unknown>[] {
  const rowCount = Math.max(plan.values.length + 20, 100);
  const columnCount = Math.max(
    ...plan.values.map((row) => row.length),
    2
  );
  const dataRows = Math.max(plan.values.length, 1);

  const requests: Record<string, unknown>[] = [
    // Remove any existing merged cells
    {
      unmergeCells: {
        range: fullGridRange(sheetId, rowCount, columnCount)
      }
    },
    // Update sheet properties (dimensions and visibility)
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          hidden: Boolean(plan.hidden),
          gridProperties: {
            rowCount,
            columnCount,
            frozenRowCount: plan.title.startsWith('Bearbeiten_') ? 1 : 2
          }
        },
        fields: 'hidden,gridProperties(rowCount,columnCount,frozenRowCount)'
      }
    },
    // Format data rows with light blue background and borders
    {
      repeatCell: {
        range: fullGridRange(sheetId, dataRows, columnCount),
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.lightBlue,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            textFormat: {
              foregroundColor: COLORS.black,
              fontFamily: 'Arial',
              fontSize: 10
            },
            borders: {
              top: borderStyle(),
              bottom: borderStyle(),
              left: borderStyle(),
              right: borderStyle()
            }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat.foregroundColor,textFormat.fontFamily,textFormat.fontSize,borders)'
      }
    },
    // Use consistent row heights throughout every generated sheet
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: rowCount
        },
        properties: { pixelSize: 26 },
        fields: 'pixelSize'
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: 1
        },
        properties: { pixelSize: 34 },
        fields: 'pixelSize'
      }
    },
    // Format first row (title row) with black background and white bold text
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount
        },
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
    // Format second row (header row) with blue background and bold text
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: Math.min(2, dataRows),
          startColumnIndex: 0,
          endColumnIndex: columnCount
        },
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

  // Handle employee blocks (summary sections with merged cells)
  if (plan.employeeBlocks?.length) {
    for (const block of plan.employeeBlocks) {
      // Merge cells for employee name header
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

      // Format total rows with yellow background
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

      // Set column widths for employee block
      const widths = [110, 80, 80, 80, 12];
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

      // The fifth column is intentionally empty and acts as a colored separator
      // between employees. This keeps the data grid intact while making blocks
      // easier to scan visually.
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: dataRows,
            startColumnIndex: block.startColumn + 4,
            endColumnIndex: block.startColumn + 5
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: COLORS.separatorBlue,
              borders: {
                left: { style: 'SOLID', color: COLORS.separatorBlue },
                right: { style: 'SOLID', color: COLORS.separatorBlue }
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,borders.left,borders.right)'
        }
      });
    }
  } else if (!plan.title.startsWith('Bearbeiten_')) {
    // Merge cells for title row if no employee blocks
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: Math.min(2, columnCount)
        },
        mergeType: 'MERGE_ALL'
      }
    });
  }

  // Special handling for "Bearbeiten_" (edit) sheets
  if (plan.title.startsWith('Bearbeiten_')) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount
        },
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

function buildProtectionRequests(
  env: Env,
  plans: SheetPlan[],
  metadata: SheetMetadata
): Record<string, unknown>[] {
  if (!env.GOOGLE_CLIENT_EMAIL) {
    throw new Error('GOOGLE_CLIENT_EMAIL is not configured.');
  }

  const metadataByTitle = new Map(
    metadata.sheets.map((sheet) => [sheet.properties.title, sheet])
  );
  const requests: Record<string, unknown>[] = [];

  for (const plan of plans) {
    const sheet = metadataByTitle.get(plan.title);
    if (!sheet) continue;

    const description = `${PROTECTION_PREFIX}${plan.title}`;
    const existing = sheet.protectedRanges?.find(
      (protectedRange) => protectedRange.description === description
    );
    const protectedRange = {
      range: { sheetId: sheet.properties.sheetId },
      description,
      warningOnly: false,
      editors: {
        users: [env.GOOGLE_CLIENT_EMAIL]
      }
    };

    if (existing) {
      requests.push({
        updateProtectedRange: {
          protectedRange: {
            protectedRangeId: existing.protectedRangeId,
            ...protectedRange
          },
          fields: 'range,description,warningOnly,editors'
        }
      });
    } else {
      requests.push({
        addProtectedRange: {
          protectedRange
        }
      });
    }
  }

  return requests;
}

/**
 * Main export function: Updates Google Spreadsheet with plans
 * Creates missing sheets, clears existing data, writes new data, and applies formatting
 */
export async function updateGoogleSpreadsheet(
  env: Env,
  plans: SheetPlan[]
): Promise<Record<string, unknown>> {
  const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId || spreadsheetId.startsWith('REPLACE_')) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not configured.');
  }

  // Fetch existing sheets metadata
  let metadata = await googleFetch<SheetMetadata>(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties,protectedRanges(protectedRangeId,description))`
  );

  const existingTitles = new Set(
    metadata.sheets.map((sheet) => sheet.properties.title)
  );

  // Create requests for missing sheets
  const addRequests = plans
    .filter((plan) => !existingTitles.has(plan.title))
    .map((plan) => ({
      addSheet: {
        properties: {
          title: plan.title,
          hidden: Boolean(plan.hidden),
          gridProperties: {
            rowCount: Math.max(plan.values.length + 20, 100),
            columnCount: Math.max(
              ...plan.values.map((row) => row.length),
              2
            )
          }
        }
      }
    }));

  // Create missing sheets
  if (addRequests.length) {
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ requests: addRequests })
      }
    );

    // Refresh metadata to get new sheet IDs
    metadata = await googleFetch<SheetMetadata>(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties,protectedRanges(protectedRangeId,description))`
    );
  }

  // Build mapping of sheet titles to IDs
  const sheetIdByTitle = new Map(
    metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId])
  );

  // Clear all data in target sheets
  const clearRanges = plans.map((plan) => escapeSheetTitle(plan.title));
  await googleFetch(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    {
      method: 'POST',
      body: JSON.stringify({ ranges: clearRanges })
    }
  );

  // Write new data to sheets
  await googleFetch(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: plans.map((plan) => ({
          range: `${escapeSheetTitle(plan.title)}!A1`,
          majorDimension: 'ROWS',
          values: plan.values
        }))
      })
    }
  );

  // Build formatting requests for all sheets
  const formattingRequests: Record<string, unknown>[] = [];
  for (const plan of plans) {
    const sheetId = sheetIdByTitle.get(plan.title);
    if (sheetId == null) {
      throw new Error(`Google Sheet tab was not created: ${plan.title}`);
    }
    formattingRequests.push(...buildFormattingRequests(plan, sheetId));
  }
  formattingRequests.push(...buildProtectionRequests(env, plans, metadata));

  // Apply formatting requests in batches (Google API limits request size)
  const chunkSize = 300;
  for (let start = 0; start < formattingRequests.length; start += chunkSize) {
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: formattingRequests.slice(start, start + chunkSize)
        })
      }
    );
  }

  return {
    spreadsheetId,
    webViewLink:
      env.GOOGLE_SHEET_URL ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    updatedSheets: plans.length
  };
}
