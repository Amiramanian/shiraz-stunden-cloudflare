import type { Env } from './types';
// @ts-ignore - shared frontend/backend libs without type declarations
import { normalizeForMatch, buildFlatStaffList, levenshtein } from '../src/lib/shiftMatching';
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
  parseWrittenHours
} from './scan-normalization';
import { createScanHistory, updateScanHistory, getScanAlias } from './db';

export type { ScannedShiftRaw } from './scan-providers';

export interface ScanRequest {
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  todayIso: string;
  staffConfig: Record<string, Record<string, string[]>>;
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
  manualFallback?: boolean;
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
const HEADER_WORDS = new Set([
  'name',
  'datum',
  'tag',
  'nr',
  'von',
  'bis',
  'summe',
  'stunden',
  'service',
  'kuche',
  'kueche',
  'kitchen',
  'bar',
  'fahrer',
  'liefer',
  'vorschuss',
  'uberzahlung',
  'uberweisung',
  'technik',
  'personal'
]);

function providerDisplayName(provider: ScanProviderName): string {
  if (provider === 'workers-ai') return 'Cloudflare Workers AI';
  if (provider === 'groq') return 'Groq';
  return 'FreeModel';
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))].slice(0, 30);
}

function asciiKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function isHeaderOrNote(employee: string, evidence: string): boolean {
  const employeeKey = asciiKey(employee);
  if (!employeeKey || !/\p{L}/u.test(employee)) return true;
  if (HEADER_WORDS.has(employeeKey)) return true;
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

  if (!request.staffConfig || !request.staffConfig[request.business]) {
    throw new Error('Invalid business or staff config');
  }
  if (!['Shiraz', 'Djadoo', 'Catering'].includes(request.business)) {
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

function normalizeProviderShifts(
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
    let normalizedDate = normalizeScanDate(rawDate, todayIso);
    if (!normalizedDate.date) {
      const documentDate = documentDates.get(imageIndex) || '';
      normalizedDate = normalizeScanDate(documentDate, todayIso);
    }
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

function canonicalDepartment(
  business: ScanRequest['business'],
  rawDepartment: string,
  configuredDepartments: string[]
): string {
  if (business === 'Djadoo') {
    return configuredDepartments.includes('Personal')
      ? 'Personal'
      : configuredDepartments[0] || '';
  }

  const key = asciiKey(rawDepartment);
  const aliases: Record<string, string[]> = {
    bar: ['bar'],
    kuche: ['kuche', 'kueche', 'kitchen'],
    service: ['service'],
    fahrer: ['fahrer', 'liefer', 'lieferer', 'driver'],
    betriebsleiter: ['betriebsleiter', 'leitung'],
    technik: ['technik', 'tech']
  };

  for (const department of configuredDepartments) {
    const canonicalKey = asciiKey(department);
    const accepted = aliases[canonicalKey] || [canonicalKey];
    if (accepted.includes(key)) return department;
  }
  return '';
}

interface StrictStaffMatch {
  employee: string;
  department: string;
  matched: boolean;
}

function findStrictStaffMatch(
  rawEmployee: string,
  extractedDepartment: string,
  flatStaff: Array<{ business: string; department: string; employee: string }>
): StrictStaffMatch {
  const target = asciiKey(rawEmployee);
  if (!target) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const nonTechnical = flatStaff.filter((entry) => entry.department !== 'Technik');
  const pool = nonTechnical.length > 0 ? nonTechnical : flatStaff;
  const exact = pool.filter((entry) => asciiKey(entry.employee) === target);
  if (exact.length > 0) {
    const departmentMatch = exact.find((entry) => entry.department === extractedDepartment);
    const selected = departmentMatch || exact[0];
    return {
      employee: selected.employee,
      department: selected.department,
      matched: true
    };
  }

  if (target.length < 4) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const scored = pool.map((entry) => ({
    entry,
    distance: levenshtein(asciiKey(entry.employee), target)
  }));
  const bestDistance = Math.min(...scored.map((candidate) => candidate.distance));
  const bestEmployees = new Set(
    scored
      .filter((candidate) => candidate.distance === bestDistance)
      .map((candidate) => asciiKey(candidate.entry.employee))
  );
  const maxDistance = target.length >= 8 ? 2 : 1;
  const ratio = bestDistance / Math.max(target.length, 1);

  if (bestDistance > maxDistance || ratio > 0.2 || bestEmployees.size !== 1) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const candidates = scored.filter((candidate) => candidate.distance === bestDistance);
  const departmentMatch = candidates.find(
    (candidate) => candidate.entry.department === extractedDepartment
  );
  const selected = (departmentMatch || candidates[0]).entry;
  return {
    employee: selected.employee,
    department: selected.department,
    matched: true
  };
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

    const imageExtraction = await extractImageTexts(
      env,
      request.images,
      localOcrTexts
    );
    await updateScanHistory(env, scanId, {
      ocrText: imageExtraction.texts
        .map((text, index) => `--- image ${index + 1}: ${imageNames[index]} ---\n${text}`)
        .join('\n\n')
        .slice(0, 300_000)
    });

    const providers = getAvailableScanProviders(env);
    const providerWarnings: string[] = [...imageExtraction.warnings];
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
        break;
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'scan_provider_failed',
          provider,
          message: error instanceof Error ? error.message.slice(0, 180) : 'unknown'
        }));
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
        errorMessage: warnings.join(' ')
      });
      return {
        scanId,
        shifts: [],
        savedCount: 0,
        skippedCount: 0,
        provider: 'manual',
        warnings,
        manualFallback: true
      };
    }

    await updateScanHistory(env, scanId, {
      aiResponseJson: JSON.stringify({
        provider: candidate.provider,
        output: candidate.rawOutput
      })
    });

    const scopedConfig = { [request.business]: request.staffConfig[request.business] };
    const flatStaff = buildFlatStaffList(scopedConfig) as Array<{
      business: string;
      department: string;
      employee: string;
    }>;
    const configuredDepartments = Object.keys(request.staffConfig[request.business] || {});

    const enrichedShifts = await Promise.all(
      candidate.shifts.map(async (shift): Promise<EnrichedShift> => {
        const rawEmployee = shift.employee;
        const normalizedRawName = normalizeForMatch(rawEmployee);
        const extractedDepartment = canonicalDepartment(
          request.business,
          shift.department || '',
          configuredDepartments
        );
        const alias = await getScanAlias(
          env,
          request.business,
          shift.department || '',
          normalizedRawName
        );

        let match: StrictStaffMatch;
        if (alias) {
          const aliasEntries = flatStaff.filter(
            (entry) => normalizeForMatch(entry.employee) === normalizeForMatch(alias.employee)
          );
          const selected = aliasEntries.find(
            (entry) => entry.department === alias.department
          ) || aliasEntries.find(
            (entry) => entry.department === extractedDepartment
          ) || aliasEntries.find((entry) => entry.department !== 'Technik') || aliasEntries[0];
          match = selected
            ? {
              employee: selected.employee,
              department: selected.department,
              matched: true
            }
            : {
              employee: alias.employee,
              department: alias.department || extractedDepartment,
              matched: true
            };
        } else {
          match = findStrictStaffMatch(rawEmployee, extractedDepartment, flatStaff);
        }

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
