import type { Env } from './types';
// @ts-ignore - shared frontend/backend libs without type declarations
import { normalizeForMatch, buildFlatStaffList } from '../src/lib/shiftMatching';
// @ts-ignore - shared frontend/backend libs without type declarations
import { calculateDurationHours, normalizeTimeString } from '../src/lib/timeUtils';
import {
  callScanProvider,
  getAvailableScanProviders,
  type ScanProviderOutput,
  type ScannedShiftRaw,
  type ScanProviderName
} from './scan-providers';
import { extractImageTexts } from './scan-image-ocr';
import {
  normalizeScanDate,
  parseWrittenHours,
  type NormalizedDate
} from './scan-normalization';
import { createScanHistory, updateScanHistory, getScanAlias, listStaff } from './db';
import {
  buildEffectiveStaffConfig,
  canonicalScanDepartment,
  hasScanTechnicalMarker,
  isScanSectionHeading,
  matchScannedStaff
} from './staff-config';

export type { ScannedShiftRaw } from './scan-providers';

export interface ScanRequest {
  business: 'Shiraz' | 'Djadoo';
  todayIso: string;
  staffConfig?: Record<string, Record<string, string[]>>;
  images: string[];
  imageNames?: string[];
  ocrTexts?: string[];
}

interface EnrichedShift extends ScannedShiftRaw {
  matchedBusiness: string;
  matchedDepartment: string;
  matchedEmployee: string;
  rawEmployee: string;
  normalizedStart: string;
  normalizedEnd: string;
  nameMatched: boolean;
  needsReview: boolean;
  reviewReasons: string[];
}

export interface ScanResponse {
  scanId: string;
  shifts: EnrichedShift[];
  savedCount: number;
  skippedCount: number;
  provider: ScanProviderName | 'manual';
  warnings: string[];
  providerFailures: ProviderFailure[];
  manualFallback?: boolean;
}

export interface ProviderFailure {
  provider: ScanProviderName;
  displayName: string;
  message: string;
}

interface NormalizedProviderResult {
  shifts: ScannedShiftRaw[];
  warnings: string[];
  skippedCount: number;
}

interface ProviderCandidate extends NormalizedProviderResult {
  provider: ScanProviderName;
  rawOutput: ScanProviderOutput;
}

const MAX_IMAGE_COUNT = 10;
function providerDisplayName(provider: ScanProviderName): string {
  const names: Record<ScanProviderName, string> = {
    'cloudflare-mistral': 'Cloudflare Mistral Vision',
    'cloudflare-moondream': 'Cloudflare Moondream OCR',
    'cloudflare-gemma': 'Cloudflare Gemma Vision',
    gemini: 'Google Gemini'
  };
  return names[provider];
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))].slice(0, 30);
}

function isHeaderOrNote(employee: string, evidence: string): boolean {
  if (!employee || !/\p{L}/u.test(employee)) return true;
  if (isScanSectionHeading(employee)) return true;
  if (
    /(?:vorschuss|überzahlung|uberzahlung|überweisung|uberweisung|zahlung|euro|€)/iu.test(
      `${employee} ${evidence}`
    )
  ) {
    return true;
  }
  return false;
}

function hasTwoTimeValues(evidence: string): boolean {
  const values = evidence.match(
    /(?:^|\D)(?:[01]?\d|2[0-4])(?:[:.,h]\d{1,2})?(?=\D|$)/gi
  );
  return (values?.length || 0) >= 2;
}

function normalizeScanTime(rawValue: unknown, isEndTime: boolean): string {
  const compact = String(rawValue ?? '').trim().replace(/\s+/g, '');
  if (isEndTime && /^24(?:(?:[:.,h])?00)?$/i.test(compact)) {
    return '00:00';
  }
  return normalizeTimeString(rawValue);
}

function prepareImageNames(request: ScanRequest): string[] {
  const supplied = Array.isArray(request.imageNames) ? request.imageNames : [];
  return request.images.map((_, index) => {
    const raw = supplied[index];
    if (raw == null || raw === '') return `image-${index + 1}.jpg`;
    if (typeof raw !== 'string') {
      throw new Error(`Image name ${index} is not a string`);
    }
    return raw
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 180) || `image-${index + 1}.jpg`;
  });
}

function validateAndPrepareOcrTexts(request: ScanRequest): string[] {
  const supplied = Array.isArray(request.ocrTexts) ? request.ocrTexts : [];
  const prepared = request.images.map((_, index) => {
    const value = supplied[index];
    if (value == null) return '';
    if (typeof value !== 'string') {
      throw new Error(`OCR text ${index} is not a string`);
    }
    return value.trim().slice(0, 30_000);
  });

  const totalLength = prepared.reduce((sum, value) => sum + value.length, 0);
  if (totalLength > 150_000) {
    throw new Error('OCR text exceeds the total size limit');
  }
  return prepared;
}

function validateRequest(request: ScanRequest): void {
  if (!request.images || request.images.length === 0) {
    throw new Error('No images provided');
  }
  if (request.images.length > MAX_IMAGE_COUNT) {
    throw new Error(`Maximum ${MAX_IMAGE_COUNT} images per scan`);
  }

  for (let index = 0; index < request.images.length; index += 1) {
    const image = request.images[index];
    if (typeof image !== 'string') {
      throw new Error(`Image ${index} is not a string`);
    }
    if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(image)) {
      throw new Error(`Image ${index} has invalid MIME type`);
    }
    if (image.length > 8 * 1024 * 1024) {
      throw new Error(`Image ${index} exceeds 8MB size limit`);
    }
  }

  if (!['Shiraz', 'Djadoo'].includes(request.business)) {
    throw new Error('Invalid business value');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.todayIso)) {
    throw new Error('Invalid date format');
  }

  const contextDate = normalizeScanDate(request.todayIso, request.todayIso);
  if (!contextDate.date) throw new Error('Invalid date context');
}

function normalizedDocumentDates(
  output: ScanProviderOutput,
  imageNames: string[],
  todayIso: string,
  warnings: string[]
): Map<number, string> {
  const dates = new Map<number, string>();

  Object.entries(output.documentDates).forEach(([rawIndex, rawDate]) => {
    const imageIndex = Number(rawIndex);
    if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= imageNames.length) {
      return;
    }

    const normalized = normalizeScanDate(rawDate, todayIso);
    if (normalized.date) dates.set(imageIndex, normalized.date);
    if (rawDate && normalized.warning) {
      warnings.push(`${imageNames[imageIndex]}: ${normalized.warning}`);
    }
  });

  return dates;
}

export function normalizeProviderShifts(
  output: ScanProviderOutput,
  provider: ScanProviderName,
  todayIso: string,
  imageNames: string[]
): NormalizedProviderResult {
  const warnings: string[] = [];
  const normalized: ScannedShiftRaw[] = [];
  const dedupe = new Set<string>();
  const documentDates = normalizedDocumentDates(output, imageNames, todayIso, warnings);
  let skippedCount = 0;

  for (let index = 0; index < output.shifts.length; index += 1) {
    const shift = output.shifts[index];
    const employee = String(shift.employee || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    const evidence = String(shift.evidence || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const imageIndex = Number(shift.imageIndex);

    if (
      !Number.isInteger(imageIndex) ||
      imageIndex < 0 ||
      imageIndex >= imageNames.length
    ) {
      skippedCount += 1;
      warnings.push(`Zeile ${index + 1}: Bildzuordnung fehlte und wurde übersprungen.`);
      continue;
    }

    if (!employee || isHeaderOrNote(employee, evidence)) {
      skippedCount += 1;
      warnings.push(`Bild ${imageIndex + 1}, Zeile ${index + 1}: Kein gültiger Mitarbeitername.`);
      continue;
    }

    if (!evidence || !hasTwoTimeValues(evidence)) {
      skippedCount += 1;
      warnings.push(
        `${employee}: Zeile hatte keinen ausreichenden Bildbeleg für Start und Ende.`
      );
      continue;
    }

    let normalizedStart: string;
    let normalizedEnd: string;
    let durationHours: number;
    try {
      normalizedStart = normalizeScanTime(shift.startTime, false);
      normalizedEnd = normalizeScanTime(shift.endTime, true);
      durationHours = calculateDurationHours(normalizedStart, normalizedEnd);
    } catch {
      skippedCount += 1;
      warnings.push(`${employee}: Ungültige oder unvollständige Uhrzeit wurde übersprungen.`);
      continue;
    }

    const rawDate = String(shift.date || '').trim();
    const documentDate = documentDates.get(imageIndex) || '';
    const normalizedDate: NormalizedDate = rawDate
      ? normalizeScanDate(rawDate, documentDate || todayIso)
      : documentDate
        ? { date: documentDate, usedFallback: false }
        : normalizeScanDate('', todayIso);
    if (normalizedDate.warning) {
      warnings.push(`${employee}: ${normalizedDate.warning}`);
    }

    const numericConfidence = Number(shift.confidence);
    let confidence = Number.isFinite(numericConfidence)
      ? Math.min(1, Math.max(0, numericConfidence))
      : 0.5;
    if (!normalizedDate.date) confidence = Math.min(confidence, 0.55);

    const writtenHours = String(shift.writtenHours || '').trim().slice(0, 20);
    const parsedWrittenHours = parseWrittenHours(writtenHours);
    const hoursMismatch = parsedWrittenHours != null &&
      Math.abs(durationHours - parsedWrittenHours) > 0.35;
    if (hoursMismatch) {
      confidence = Math.min(confidence, 0.6);
      warnings.push(
        `${employee}: Berechnete Stunden (${durationHours}) passen nicht zur handschriftlichen Summe (${writtenHours}).`
      );
    }

    const department = String(shift.department || '').trim().slice(0, 50);
    const imageName = imageNames[imageIndex];
    const key = [
      imageIndex,
      normalizeForMatch(employee),
      normalizedDate.date,
      normalizedStart,
      normalizedEnd
    ].join('|');

    if (dedupe.has(key)) {
      skippedCount += 1;
      warnings.push(`${employee}: Doppelter Eintrag auf demselben Bild wurde entfernt.`);
      continue;
    }
    dedupe.add(key);

    normalized.push({
      employee,
      department,
      date: normalizedDate.date,
      startTime: normalizedStart,
      endTime: normalizedEnd,
      confidence,
      source: provider,
      imageIndex,
      imageName,
      evidence,
      writtenHours,
      hoursMismatch
    });
  }

  return {
    shifts: normalized,
    warnings: uniqueWarnings(warnings),
    skippedCount
  };
}

function resolveExtractedDepartment(
  business: ScanRequest['business'],
  shift: Pick<ScannedShiftRaw, 'department' | 'employee' | 'evidence'>,
  configuredDepartments: string[]
): string {
  const rawDepartment = hasScanTechnicalMarker(
    shift.department || '',
    shift.employee || '',
    shift.evidence || ''
  )
    ? 'Technik'
    : shift.department || '';
  return canonicalScanDepartment(business, rawDepartment, configuredDepartments);
}

export async function processScanRequest(
  env: Env,
  request: ScanRequest,
  actorEmail: string | null
): Promise<ScanResponse> {
  const scanId = crypto.randomUUID();
  let historyCreated = false;

  try {
    validateRequest(request);
    const imageNames = prepareImageNames(request);
    const localOcrTexts = validateAndPrepareOcrTexts(request);

    await createScanHistory(env, scanId, request.business, actorEmail, request.images.length);
    historyCreated = true;

    const imageExtraction = await extractImageTexts(request.images, localOcrTexts);
    await updateScanHistory(env, scanId, {
      ocrText: imageExtraction.texts
        .map((text, index) => `--- image ${index + 1}: ${imageNames[index]} ---\n${text}`)
        .join('\n\n')
        .slice(0, 300_000)
    });

    const providers = getAvailableScanProviders(env);
    const providerWarnings: string[] = [...imageExtraction.warnings];
    const providerFailures: ProviderFailure[] = [];
    let candidate: ProviderCandidate | null = null;

    for (const provider of providers) {
      try {
        const rawOutput = await callScanProvider(env, provider, {
          images: request.images,
          imageTexts: imageExtraction.texts,
          business: request.business,
          todayIso: request.todayIso
        });
        const normalized = normalizeProviderShifts(
          rawOutput,
          provider,
          request.todayIso,
          imageNames
        );
        candidate = {
          ...normalized,
          provider,
          rawOutput
        };
        if (normalized.shifts.length === 0) {
          const message = 'Keine ausreichend belegte Schicht erkannt.';
          providerFailures.push({
            provider,
            displayName: providerDisplayName(provider),
            message
          });
          providerWarnings.push(
            `${providerDisplayName(provider)} erkannte keine sichere Schicht; der nächste Dienst wurde versucht.`
          );
          candidate = null;
          continue;
        }
        break;
      } catch (error) {
        const failureMessage = error instanceof Error
          ? error.message
              .replace(/Bearer\s+[^\s]+/gi, '[REDACTED]')
              .replace(/\b(?:gsk_|fe_oa_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
              .slice(0, 500)
          : 'unknown';
        console.warn(JSON.stringify({
          event: 'scan_provider_failed',
          provider,
          message: failureMessage.slice(0, 180)
        }));
        providerFailures.push({
          provider,
          displayName: providerDisplayName(provider),
          message: failureMessage
        });
        providerWarnings.push(
          `${providerDisplayName(provider)} war nicht verfügbar; der nächste Dienst wurde versucht.`
        );
      }
    }

    if (!candidate) {
      const warnings = uniqueWarnings([
        ...providerWarnings,
        'Die automatische Erkennung ist derzeit nicht verfügbar. Eine manuelle Zeile wurde geöffnet.'
      ]);
      await updateScanHistory(env, scanId, {
        status: 'error',
        skippedCount: 0,
        savedCount: 0,
        aiResponseJson: JSON.stringify({ failures: providerFailures }),
        errorMessage: warnings.join(' ')
      });
      return {
        scanId,
        shifts: [],
        savedCount: 0,
        skippedCount: 0,
        provider: 'manual',
        warnings,
        providerFailures,
        manualFallback: true
      };
    }

    await updateScanHistory(env, scanId, {
      aiResponseJson: JSON.stringify({
        provider: candidate.provider,
        output: candidate.rawOutput
      })
    });

    const serverStaff = await listStaff(env);
    const serverStaffConfig = buildEffectiveStaffConfig(serverStaff);
    const scopedConfig = { [request.business]: serverStaffConfig[request.business] };
    const flatStaff = buildFlatStaffList(scopedConfig) as Array<{
      business: string;
      department: string;
      employee: string;
    }>;
    const configuredDepartments = Object.keys(serverStaffConfig[request.business] || {});

    const enrichedShifts = await Promise.all(
      candidate.shifts.map(async (shift): Promise<EnrichedShift> => {
        const rawEmployee = shift.employee;
        const normalizedRawName = normalizeForMatch(rawEmployee);
        const extractedDepartment = resolveExtractedDepartment(
          request.business,
          shift,
          configuredDepartments
        );
        const alias = await getScanAlias(
          env,
          request.business,
          shift.department || '',
          normalizedRawName
        );

        const match = matchScannedStaff(
          rawEmployee,
          extractedDepartment,
          flatStaff,
          alias
        );

        const reviewReasons: string[] = [];
        if (!match.matched) reviewReasons.push('Name konnte nicht sicher zugeordnet werden');
        if (!shift.date) reviewReasons.push('Datum fehlt');
        if ((shift.confidence ?? 0) < 0.75) reviewReasons.push('Handschrift unsicher');
        if (!match.department) reviewReasons.push('Abteilung unklar');
        if (shift.hoursMismatch) reviewReasons.push('Stundensumme passt nicht zu den Uhrzeiten');

        return {
          ...shift,
          rawEmployee,
          normalizedStart: shift.startTime,
          normalizedEnd: shift.endTime,
          matchedEmployee: match.employee,
          matchedDepartment: match.department,
          matchedBusiness: request.business,
          nameMatched: match.matched,
          needsReview: reviewReasons.length > 0,
          reviewReasons
        };
      })
    );

    const warnings = uniqueWarnings([
      ...providerWarnings,
      ...candidate.warnings,
      ...(enrichedShifts.length === 0
        ? ['Keine sicher belegte Schicht erkannt. Eine manuelle Zeile wurde geöffnet.']
        : [])
    ]);

    await updateScanHistory(env, scanId, {
      mergedResultJson: JSON.stringify(enrichedShifts),
      finalResultJson: JSON.stringify({
        provider: candidate.provider,
        providerFailures,
        warnings,
        shifts: enrichedShifts
      }),
      status: enrichedShifts.length > 0 ? 'success' : 'error',
      savedCount: 0,
      skippedCount: candidate.skippedCount
    });

    return {
      scanId,
      shifts: enrichedShifts,
      savedCount: 0,
      skippedCount: candidate.skippedCount,
      provider: candidate.provider,
      warnings,
      providerFailures,
      manualFallback: enrichedShifts.length === 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sanitizedMessage = message
      .replace(/Bearer\s+[^\s]+/gi, '[REDACTED]')
      .replace(/\b(?:gsk_|fe_oa_|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
      .slice(0, 2000);

    if (historyCreated) {
      try {
        await updateScanHistory(env, scanId, {
          status: 'error',
          errorMessage: sanitizedMessage
        });
      } catch (historyError) {
        console.error(JSON.stringify({
          event: 'scan_history_update_failed',
          scanId,
          message: historyError instanceof Error
            ? historyError.message.slice(0, 160)
            : 'unknown'
        }));
      }
    }

    throw new Error(sanitizedMessage);
  }
}
