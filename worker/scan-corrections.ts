import type { ScanCorrectionInput, ScanCorrectionShift } from './types';

const CORRECTION_FIELDS = [
  'employee',
  'department',
  'date',
  'startTime',
  'endTime'
] as const;

export type ScanCorrectionField = (typeof CORRECTION_FIELDS)[number];

function normalizedCorrectionValue(
  field: ScanCorrectionField,
  value: unknown
): string {
  const text = String(value ?? '').trim();
  if (field === 'employee' || field === 'department') {
    return text.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  }
  return text;
}

export function getChangedCorrectionFields(
  original: ScanCorrectionShift | undefined,
  final: ScanCorrectionShift
): ScanCorrectionField[] {
  if (!original) return [];
  return CORRECTION_FIELDS.filter((field) =>
    normalizedCorrectionValue(field, original[field]) !==
    normalizedCorrectionValue(field, final[field])
  );
}

export function isActualScanCorrection(correction: ScanCorrectionInput): boolean {
  return getChangedCorrectionFields(correction.original, correction.final).length > 0;
}

export function changesScanIdentity(correction: ScanCorrectionInput): boolean {
  const changed = getChangedCorrectionFields(correction.original, correction.final);
  return changed.includes('employee') || changed.includes('department');
}
