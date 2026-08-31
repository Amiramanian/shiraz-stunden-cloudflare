import type { Env } from './types';
import type { SheetPlan } from './report-data';

interface GoogleTokenCache {
  token: string;
  expiresAt: number;
}

type GoogleAuthMode = 'service' | 'user';

export interface SpreadsheetUpdateOptions {
  spreadsheetId?: string;
  authMode?: GoogleAuthMode;
  webViewLink?: string;
  cleanObsoleteManagedSheets?: boolean;
  protectionEditorEmail?: string | null;
}

export interface CreatedMonthlySpreadsheet {
  spreadsheetId: string;
  webViewLink: string;
  updatedSheets: number;
  removedSheets: string[];
}

export function buildMissingSheetRequests(
  plans: SheetPlan[],
  existingTitles: ReadonlySet<string>
): Array<Record<string, unknown>> {
  return plans
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
}

interface GoogleValueRange {
  range?: string;
  values?: Array<Array<string | number | boolean>>;
}

interface GoogleBatchGetResponse {
  valueRanges?: GoogleValueRange[];
}

const OBSOLETE_MANAGED_SHEETS = new Set(['Technik Djadoo']);

// Global token cache (in-memory during Worker execution)
let tokenCache: GoogleTokenCache | null = null;
let userTokenCache: GoogleTokenCache | null = null;

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

async function getGoogleUserAccessToken(env: Env): Promise<string> {
  if (userTokenCache && userTokenCache.expiresAt > Date.now() + 60_000) {
    return userTokenCache.token;
  }

  if (
    !env.GOOGLE_OAUTH_CLIENT_ID ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REFRESH_TOKEN
  ) {
    throw new Error(
      'Google Drive Monatsdateien sind noch nicht verbunden. OAuth-Zugang fehlt.'
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN
    }).toString()
  });

  if (!response.ok) {
    throw new Error(
      `Google OAuth Verbindung wurde abgelehnt (${response.status}). ` +
      'Bitte OAuth-Zugang und Refresh-Token prüfen.'
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  userTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
  return userTokenCache.token;
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
  init: RequestInit = {},
  authMode: GoogleAuthMode = 'service'
): Promise<T> {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = authMode === 'user'
      ? await getGoogleUserAccessToken(env)
      : await getGoogleAccessToken(env);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const responseText = await response.text();
      return (responseText ? JSON.parse(responseText) : undefined) as T;
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

function rowsForRange(
  response: GoogleBatchGetResponse,
  title: string
): Array<Array<string | number | boolean>> {
  const titleKey = title.toLocaleLowerCase('de-DE');
  return response.valueRanges?.find((valueRange) =>
    (valueRange.range || '').toLocaleLowerCase('de-DE').includes(titleKey)
  )?.values || [];
}

async function assertObsoleteSheetHasNoSourceData(
  env: Env,
  spreadsheetId: string,
  authMode: GoogleAuthMode
): Promise<void> {
  const query = new URLSearchParams({ majorDimension: 'ROWS' });
  query.append('ranges', `${escapeSheetTitle('Bearbeiten_Schichten')}!A:H`);
  query.append('ranges', `${escapeSheetTitle('Bearbeiten_Mitarbeiter')}!A:E`);
  const sourceData = await googleFetch<GoogleBatchGetResponse>(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`,
    {},
    authMode
  );

  const shiftRows = rowsForRange(sourceData, 'Bearbeiten_Schichten').slice(1);
  const staffRows = rowsForRange(sourceData, 'Bearbeiten_Mitarbeiter').slice(1);
  const djadooTechnikShifts = shiftRows.filter((row) =>
    String(row[2] || '').trim() === 'Djadoo' &&
    String(row[3] || '').trim() === 'Technik'
  );
  const djadooTechnikStaff = staffRows.filter((row) =>
    String(row[1] || '').trim() === 'Djadoo' &&
    String(row[2] || '').trim() === 'Technik'
  );

  if (djadooTechnikShifts.length || djadooTechnikStaff.length) {
    throw new Error(
      `Technik Djadoo was not removed because it still contains source data ` +
      `(${djadooTechnikShifts.length} shifts, ${djadooTechnikStaff.length} staff records).`
    );
  }
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

type SheetGridMetadata = Pick<SheetMetadata['sheets'][number], 'properties'>;

function a1ColumnName(columnCount: number): string {
  let value = Math.max(1, Math.floor(columnCount));
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function planColumnCount(plan: Pick<SheetPlan, 'values'>): number {
  return Math.max(...plan.values.map((row) => row.length), 0);
}

function rectangularValues(plan: Pick<SheetPlan, 'values'>) {
  const columnCount = planColumnCount(plan);
  return plan.values.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  );
}

export function buildSheetCapacityRequests(
  plans: Array<Pick<SheetPlan, 'title' | 'values'>>,
  sheets: SheetGridMetadata[]
): Array<Record<string, unknown>> {
  const sheetByTitle = new Map(
    sheets.map((sheet) => [sheet.properties.title, sheet.properties])
  );

  const requests: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    const properties = sheetByTitle.get(plan.title);
    if (!properties) {
      throw new Error(`Google Sheet tab was not created: ${plan.title}`);
    }
    const currentRows = Math.max(properties.gridProperties?.rowCount || 1, 1);
    const currentColumns = Math.max(properties.gridProperties?.columnCount || 1, 1);
    const requiredRows = Math.max(plan.values.length, 1);
    const requiredColumns = Math.max(planColumnCount(plan), 1);
    const rowCount = Math.max(currentRows, requiredRows);
    const columnCount = Math.max(currentColumns, requiredColumns);
    if (rowCount === currentRows && columnCount === currentColumns) continue;

    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: properties.sheetId,
          gridProperties: { rowCount, columnCount }
        },
        fields: 'gridProperties(rowCount,columnCount)'
      }
    });
  }
  return requests;
}

export function buildStaleSheetClearRanges(
  plans: Array<Pick<SheetPlan, 'title' | 'values'>>,
  sheets: SheetGridMetadata[]
): string[] {
  const sheetByTitle = new Map(
    sheets.map((sheet) => [sheet.properties.title, sheet.properties])
  );
  const ranges: string[] = [];

  for (const plan of plans) {
    const properties = sheetByTitle.get(plan.title);
    if (!properties) {
      throw new Error(`Google Sheet tab was not created: ${plan.title}`);
    }
    const rowCount = Math.max(properties.gridProperties?.rowCount || 1, 1);
    const columnCount = Math.max(properties.gridProperties?.columnCount || 1, 1);
    const writtenRows = plan.values.length;
    const writtenColumns = planColumnCount(plan);
    const title = escapeSheetTitle(plan.title);

    if (writtenRows === 0 || writtenColumns === 0) {
      ranges.push(`${title}!A1:${a1ColumnName(columnCount)}${rowCount}`);
      continue;
    }
    if (writtenRows < rowCount) {
      ranges.push(
        `${title}!A${writtenRows + 1}:${a1ColumnName(columnCount)}${rowCount}`
      );
    }
    if (writtenColumns < columnCount) {
      ranges.push(
        `${title}!${a1ColumnName(writtenColumns + 1)}1:` +
        `${a1ColumnName(columnCount)}${Math.min(writtenRows, rowCount)}`
      );
    }
  }
  return ranges;
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

function contentAwareColumnWidth(
  plan: SheetPlan,
  columnIndex: number,
  offset: number
): number {
  const longestValue = plan.values.reduce((longest, row) => {
    const value = String(row[columnIndex] ?? '').trim();
    const longestLine = value
      .split(/\r?\n/)
      .reduce((length, line) => Math.max(length, line.length), 0);
    return Math.max(longest, longestLine);
  }, 0);
  const minimumWidths = [105, 72, 82, 72];
  const maximumWidths = [135, 110, 220, 110];
  return Math.min(
    maximumWidths[offset],
    Math.max(minimumWidths[offset], longestValue * 7 + 24)
  );
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
    // Fit rows and non-employee columns to their actual content. Employee
    // columns are capped below so long notes remain readable without making
    // the report excessively wide.
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: dataRows
        }
      }
    },
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: columnCount
        }
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
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: Math.min(2, dataRows)
        },
        properties: { pixelSize: 28 },
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

      // Keep compact employee blocks while expanding columns that contain
      // longer values such as notes.
      const widths = [
        contentAwareColumnWidth(plan, block.startColumn, 0),
        contentAwareColumnWidth(plan, block.startColumn + 1, 1),
        contentAwareColumnWidth(plan, block.startColumn + 2, 2),
        contentAwareColumnWidth(plan, block.startColumn + 3, 3),
        12
      ];
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
  plans: SheetPlan[],
  metadata: SheetMetadata,
  editorEmail: string | null
): Record<string, unknown>[] {
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
    const protectedRange: Record<string, unknown> = {
      range: { sheetId: sheet.properties.sheetId },
      description,
      warningOnly: false
    };
    if (editorEmail) protectedRange.editors = { users: [editorEmail] };

    if (existing) {
      requests.push({
        updateProtectedRange: {
          protectedRange: {
            protectedRangeId: existing.protectedRangeId,
            ...protectedRange
          },
          fields: editorEmail
            ? 'range,description,warningOnly,editors'
            : 'range,description,warningOnly'
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
 * Creates missing sheets, writes new data, clears only stale tails, and applies formatting.
 * Writing first prevents an interrupted request from leaving the workbook blank.
 */
export async function updateGoogleSpreadsheet(
  env: Env,
  plans: SheetPlan[],
  options: SpreadsheetUpdateOptions = {}
): Promise<Record<string, unknown>> {
  const spreadsheetId = options.spreadsheetId || env.GOOGLE_SPREADSHEET_ID;
  const authMode = options.authMode || 'service';
  const cleanObsoleteManagedSheets = options.cleanObsoleteManagedSheets ?? authMode === 'service';
  const protectionEditorEmail = options.protectionEditorEmail === undefined
    ? env.GOOGLE_CLIENT_EMAIL || null
    : options.protectionEditorEmail;
  if (!spreadsheetId || spreadsheetId.startsWith('REPLACE_')) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not configured.');
  }

  // Fetch existing sheets metadata
  let metadata = await googleFetch<SheetMetadata>(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties,protectedRanges(protectedRangeId,description))`,
    {},
    authMode
  );

  const plannedTitles = new Set(plans.map((plan) => plan.title));
  const obsoleteSheets = metadata.sheets.filter((sheet) =>
    cleanObsoleteManagedSheets &&
    OBSOLETE_MANAGED_SHEETS.has(sheet.properties.title) &&
    !plannedTitles.has(sheet.properties.title)
  );

  if (obsoleteSheets.length) {
    await assertObsoleteSheetHasNoSourceData(env, spreadsheetId, authMode);
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: obsoleteSheets.map((sheet) => ({
            deleteSheet: { sheetId: sheet.properties.sheetId }
          }))
        })
      },
      authMode
    );
    metadata = await googleFetch<SheetMetadata>(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties,protectedRanges(protectedRangeId,description))`,
      {},
      authMode
    );
  }

  const existingTitles = new Set(
    metadata.sheets.map((sheet) => sheet.properties.title)
  );

  // Create requests for missing sheets
  const addRequests = buildMissingSheetRequests(plans, existingTitles);

  // Create missing sheets
  if (addRequests.length) {
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ requests: addRequests })
      },
      authMode
    );

    // Refresh metadata to get new sheet IDs
    metadata = await googleFetch<SheetMetadata>(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties,protectedRanges(protectedRangeId,description))`,
      {},
      authMode
    );
  }

  // Build mapping of sheet titles to IDs
  const sheetIdByTitle = new Map(
    metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties.sheetId])
  );

  // Expand only when the incoming data is larger. Never shrink before the new
  // values have been written because that could discard the last good export.
  const capacityRequests = buildSheetCapacityRequests(plans, metadata.sheets);
  if (capacityRequests.length) {
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ requests: capacityRequests })
      },
      authMode
    );
  }

  // Write the complete replacement dataset first. Rows are padded to a
  // rectangle so stale cells inside the written area are overwritten too.
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
          values: rectangularValues(plan)
        }))
      })
    },
    authMode
  );

  // After the replacement data is safely present, clear only cells outside its
  // rectangle. If execution stops here, the new data remains visible and only
  // harmless stale tail cells may survive until the next export.
  const staleRanges = buildStaleSheetClearRanges(plans, metadata.sheets);
  if (staleRanges.length) {
    await googleFetch(
      env,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
      {
        method: 'POST',
        body: JSON.stringify({ ranges: staleRanges })
      },
      authMode
    );
  }

  // Build formatting requests for all sheets
  const formattingRequests: Record<string, unknown>[] = [];
  for (const plan of plans) {
    const sheetId = sheetIdByTitle.get(plan.title);
    if (sheetId == null) {
      throw new Error(`Google Sheet tab was not created: ${plan.title}`);
    }
    formattingRequests.push(...buildFormattingRequests(plan, sheetId));
  }
  formattingRequests.push(...buildProtectionRequests(plans, metadata, protectionEditorEmail));

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
      },
      authMode
    );
  }

  return {
    spreadsheetId,
    webViewLink:
      options.webViewLink ||
      (options.spreadsheetId ? null : env.GOOGLE_SHEET_URL) ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    updatedSheets: plans.length,
    removedSheets: obsoleteSheets.map((sheet) => sheet.properties.title)
  };
}

function initialSheetProperties(plan: SheetPlan) {
  return {
    title: plan.title,
    hidden: Boolean(plan.hidden),
    gridProperties: {
      rowCount: Math.max(plan.values.length + 20, 100),
      columnCount: Math.max(...plan.values.map((row) => row.length), 2)
    }
  };
}

async function moveUserSpreadsheetToConfiguredFolder(
  env: Env,
  spreadsheetId: string
): Promise<void> {
  if (!env.GOOGLE_DRIVE_FOLDER_ID) return;

  const file = await googleFetch<{ parents?: string[] }>(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=parents&supportsAllDrives=true`,
    {},
    'user'
  );
  const query = new URLSearchParams({
    addParents: env.GOOGLE_DRIVE_FOLDER_ID,
    supportsAllDrives: 'true',
    fields: 'id,parents'
  });
  if (file.parents?.length) query.set('removeParents', file.parents.join(','));
  await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?${query}`,
    { method: 'PATCH', body: '{}' },
    'user'
  );
}

async function deleteUserDriveFile(env: Env, fileId: string): Promise<void> {
  await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    { method: 'DELETE' },
    'user'
  );
}

export async function createMonthlyGoogleSpreadsheet(
  env: Env,
  title: string,
  plans: SheetPlan[]
): Promise<CreatedMonthlySpreadsheet> {
  const created = await googleFetch<{
    spreadsheetId?: string;
    spreadsheetUrl?: string;
  }>(
    env,
    'https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl',
    {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          title,
          locale: 'de_DE',
          timeZone: env.APP_TIMEZONE || 'Europe/Berlin'
        },
        sheets: plans.map((plan) => ({ properties: initialSheetProperties(plan) }))
      })
    },
    'user'
  );
  if (!created.spreadsheetId) {
    throw new Error('Google hat keine ID für die Monatsdatei zurückgegeben.');
  }

  const spreadsheetId = created.spreadsheetId;
  const webViewLink = created.spreadsheetUrl ||
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  try {
    await moveUserSpreadsheetToConfiguredFolder(env, spreadsheetId);
    const result = await updateGoogleSpreadsheet(env, plans, {
      spreadsheetId,
      authMode: 'user',
      webViewLink,
      cleanObsoleteManagedSheets: false,
      protectionEditorEmail: null
    });
    return {
      spreadsheetId,
      webViewLink: String(result.webViewLink || webViewLink),
      updatedSheets: Number(result.updatedSheets || plans.length),
      removedSheets: Array.isArray(result.removedSheets)
        ? result.removedSheets.map(String)
        : []
    };
  } catch (error) {
    await deleteUserDriveFile(env, spreadsheetId).catch(() => {});
    throw error;
  }
}

export function isMonthlyGoogleDriveConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

export async function removeMonthlyGoogleSpreadsheet(
  env: Env,
  spreadsheetId: string
): Promise<void> {
  await deleteUserDriveFile(env, spreadsheetId);
}
