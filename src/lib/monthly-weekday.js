const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Montag' },
  { value: 2, label: 'Dienstag' },
  { value: 3, label: 'Mittwoch' },
  { value: 4, label: 'Donnerstag' },
  { value: 5, label: 'Freitag' },
  { value: 6, label: 'Samstag' },
  { value: 0, label: 'Sonntag' }
];

function normalizedWeekday(value) {
  const weekday = Number(value);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error('Ungültiger Wochentag.');
  }
  return weekday;
}

export function datesForWeekdayInMonth(monthValue, weekdayValue) {
  const match = MONTH_PATTERN.exec(String(monthValue || '').trim());
  if (!match) throw new Error('Ungültiger Monat.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const weekday = normalizedWeekday(weekdayValue);
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const dates = [];

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (date.getUTCDay() === weekday) dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}

export function buildMonthlyWeekdayRows(byDateDepartment, monthValue, weekdayValue) {
  const dates = datesForWeekdayInMonth(monthValue, weekdayValue);
  const dateSet = new Set(dates);
  const totals = new Map(dates.map((date) => [date, { hours: 0, shiftCount: 0 }]));

  for (const item of Array.isArray(byDateDepartment) ? byDateDepartment : []) {
    const date = String(item?.date || '');
    if (!dateSet.has(date)) continue;
    const total = totals.get(date);
    total.hours += Number(item?.hours || 0);
    total.shiftCount += Number(item?.shiftCount || 0);
  }

  return dates.map((date, index) => {
    const total = totals.get(date);
    return {
      occurrence: index + 1,
      date,
      hours: Math.round(total.hours * 100) / 100,
      shiftCount: total.shiftCount
    };
  });
}
