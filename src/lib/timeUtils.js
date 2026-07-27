// Time normalization utilities - ported from the original Google Apps Script

export function normalizeTimeString(value) {
  let input = String(value || '').trim();

  // Persian / Arabic / full-width digits -> normal English digits
  input = input.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  input = input.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  input = input.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48));

  // Remove invisible RTL/LTR marks and spaces
  input = input
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  // Accept common separators: 11.30 / 11,30 / 11:30 / 11h30
  input = input
    .replace(/uhr/g, '')
    .replace(/[h]/g, ':')
    .replace(/[.،,٫٬؛;]/g, ':')
    .replace(/：/g, ':');

  if (!input) {
    throw new Error('Bitte Uhrzeit z.B. 11 oder 1130 eingeben.');
  }

  if (/^\d{1,2}$/.test(input)) {
    const hours = Number(input);
    if (hours < 0 || hours > 23) {
      throw new Error('Ungültige Uhrzeit.');
    }
    return String(hours).padStart(2, '0') + ':00';
  }

  if (/^\d{3,4}$/.test(input)) {
    const minutes = input.slice(-2);
    const hours = input.slice(0, -2);
    input = hours + ':' + minutes;
  }

  const match = input.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    throw new Error('Bitte Uhrzeit z.B. 11 oder 1130 eingeben.');
  }

  const hours = Number(match[1]);
  const minutesText = match[2].length === 1 ? match[2] + '0' : match[2];
  const minutes = Number(minutesText);

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Ungültige Uhrzeit.');
  }

  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

export function timeToMinutes(value) {
  const parts = value.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

export function calculateDurationHours(startRaw, endRaw) {
  const start = normalizeTimeString(startRaw);
  const end = normalizeTimeString(endRaw);
  let endMinutes = timeToMinutes(end);
  const startMinutes = timeToMinutes(start);

  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  const hours = Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
  if (hours <= 0) {
    throw new Error('Bitte Uhrzeiten prüfen.');
  }
  return hours;
}
