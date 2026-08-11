export function validateMonthlyReportInput(monthValue: unknown, nameValue: unknown) {
  const month = String(monthValue ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Monat muss im Format YYYY-MM angegeben werden.');
  }
  const year = Number(month.slice(0, 4));
  if (year < 2020 || year > 2100) throw new Error('Ungültiges Jahr.');

  const fileName = String(nameValue ?? '').trim().replace(/\s+/g, ' ');
  if (!fileName) throw new Error('Dateiname ist erforderlich.');
  if (fileName.length > 120) throw new Error('Dateiname darf höchstens 120 Zeichen haben.');
  if (/[\u0000-\u001f\u007f]/u.test(fileName)) {
    throw new Error('Dateiname enthält ungültige Zeichen.');
  }
  return { month, fileName };
}

export function isDateInReportMonth(date: string, month: string): boolean {
  return date.startsWith(`${month}-`);
}

export function reportMonthsForDates(...dates: string[]): string[] {
  return [...new Set(
    dates
      .map((date) => date.slice(0, 7))
      .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
  )];
}
