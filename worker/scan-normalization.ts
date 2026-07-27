const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FULL_WIDTH_DIGITS = '０１２３４５６７８９';

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  sonntag: 0,
  so: 0,
  یکشنبه: 0,
  monday: 1,
  mon: 1,
  montag: 1,
  mo: 1,
  دوشنبه: 1,
  tuesday: 2,
  tue: 2,
  dienstag: 2,
  di: 2,
  سهشنبه: 2,
  wednesday: 3,
  wed: 3,
  mittwoch: 3,
  mi: 3,
  چهارشنبه: 3,
  thursday: 4,
  thu: 4,
  donnerstag: 4,
  do: 4,
  پنجشنبه: 4,
  friday: 5,
  fri: 5,
  freitag: 5,
  fr: 5,
  جمعه: 5,
  saturday: 6,
  sat: 6,
  samstag: 6,
  sa: 6,
  شنبه: 6
};

export interface NormalizedDate {
  date: string;
  warning?: string;
  usedFallback: boolean;
}

export function parseWrittenHours(rawValue: unknown): number | null {
  const value = String(rawValue ?? '')
    .trim()
    .replace(',', '.')
    .replace(/\s+/g, '');
  if (!value) return null;

  if (/^\d{3}$/.test(value) && Number(value) > 24) {
    const shorthand = Number(`${value.slice(0, 2)}.${value.slice(2)}`);
    if (shorthand <= 24) return shorthand;
  }

  const hourMinute = value.match(/^(\d{1,2}):(\d{1,2})/);
  if (hourMinute) {
    const hours = Number(hourMinute[1]);
    const minutes = Number(hourMinute[2]);
    if (hours <= 24 && minutes <= 59) return hours + minutes / 60;
  }

  const decimal = value.match(/(\d{1,2}(?:\.\d+)?)/);
  if (!decimal) return null;
  const parsed = Number(decimal[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? parsed : null;
}

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩０-９]/g, (digit) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);

    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);

    return String(FULL_WIDTH_DIGITS.indexOf(digit));
  });
}

function formatValidDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const normalized = formatValidDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return normalized ? new Date(`${normalized}T00:00:00.000Z`) : null;
}

function addUtcDays(date: Date, days: number): string {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function inferClosestYear(month: number, day: number, contextDate: Date): string | null {
  const contextYear = contextDate.getUTCFullYear();
  const candidates = [contextYear - 1, contextYear, contextYear + 1]
    .map((year) => formatValidDate(year, month, day))
    .filter((value): value is string => Boolean(value));

  candidates.sort((left, right) => {
    const leftDistance = Math.abs(new Date(`${left}T00:00:00.000Z`).getTime() - contextDate.getTime());
    const rightDistance = Math.abs(new Date(`${right}T00:00:00.000Z`).getTime() - contextDate.getTime());
    return leftDistance - rightDistance;
  });

  return candidates[0] || null;
}

function normalizeWeekdayToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[.\-_/(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/سه شنبه/g, 'سهشنبه');
}

export function normalizeScanDate(rawValue: unknown, todayIso: string): NormalizedDate {
  const contextDate = parseIsoDate(todayIso);
  if (!contextDate) {
    throw new Error('Invalid date context');
  }

  const raw = normalizeDigits(String(rawValue ?? ''))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();

  if (!raw) {
    return {
      date: '',
      warning: 'Datum wurde auf dem Blatt nicht sicher erkannt und muss geprüft werden.',
      usedFallback: true
    };
  }

  const relative = raw.toLowerCase();
  if (['today', 'heute', 'امروز'].includes(relative)) {
    return { date: todayIso, usedFallback: false };
  }
  if (['yesterday', 'gestern', 'دیروز'].includes(relative)) {
    return { date: addUtcDays(contextDate, -1), usedFallback: false };
  }
  if (['tomorrow', 'morgen', 'فردا'].includes(relative)) {
    return { date: addUtcDays(contextDate, 1), usedFallback: false };
  }

  const isoMatch = raw.match(/(?:^|\D)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\D|$)/);
  if (isoMatch) {
    const date = formatValidDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (date) return { date, usedFallback: false };
  }

  const fullGermanMatch = raw.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/);
  if (fullGermanMatch) {
    let year = Number(fullGermanMatch[3]);
    if (year < 100) year += year <= 69 ? 2000 : 1900;
    const date = formatValidDate(year, Number(fullGermanMatch[2]), Number(fullGermanMatch[1]));
    if (date) return { date, usedFallback: false };
  }

  const shortGermanMatch = raw.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})(?:[./])?(?:\D|$)/);
  if (shortGermanMatch) {
    const date = inferClosestYear(
      Number(shortGermanMatch[2]),
      Number(shortGermanMatch[1]),
      contextDate
    );
    if (date) {
      return {
        date,
        warning: `Jahr für "${raw}" wurde aus dem Bezugsdatum abgeleitet.`,
        usedFallback: true
      };
    }
  }

  const weekdayText = normalizeWeekdayToken(raw);
  const weekdayEntry = Object.entries(WEEKDAY_NAMES).find(([name]) =>
    weekdayText.split(' ').includes(name)
  );
  if (weekdayEntry) {
    const targetWeekday = weekdayEntry[1];
    let delta = (targetWeekday - contextDate.getUTCDay() + 7) % 7;
    if (delta > 3) delta -= 7;

    return {
      date: addUtcDays(contextDate, delta),
      warning: `Wochentag "${raw}" wurde relativ zum Bezugsdatum aufgelöst.`,
      usedFallback: true
    };
  }

  return {
    date: '',
    warning: `Ungültiges Datum "${raw}" wurde nicht übernommen und muss geprüft werden.`,
    usedFallback: true
  };
}
