import type { Env } from './types';

export type AnalyticsPeriod = 'day' | 'week' | 'month';

export interface AnalyticsRange {
  period: AnalyticsPeriod;
  anchor: string;
  startDate: string;
  endDate: string;
  label: string;
}

interface AnalyticsFilters {
  period?: unknown;
  anchor?: unknown;
  business?: unknown;
  department?: unknown;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function germanDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Ungültiges Datum für die Auswertung.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Ungültiges Datum für die Auswertung.');
  }
  return parsed;
}

export function resolveAnalyticsRange(periodValue: unknown, anchorValue: unknown): AnalyticsRange {
  const period = String(periodValue || '').trim() as AnalyticsPeriod;
  if (period !== 'day' && period !== 'week' && period !== 'month') {
    throw new Error('Zeitraum muss Tag, Woche oder Monat sein.');
  }

  const anchor = String(anchorValue || '').trim();
  if (period === 'day') {
    parseIsoDate(anchor);
    return {
      period,
      anchor,
      startDate: anchor,
      endDate: anchor,
      label: germanDate(anchor)
    };
  }

  if (period === 'week') {
    const selectedDate = parseIsoDate(anchor);
    const mondayOffset = (selectedDate.getUTCDay() + 6) % 7;
    const start = new Date(selectedDate);
    start.setUTCDate(start.getUTCDate() - mondayOffset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    const startDate = isoDate(start);
    const endDate = isoDate(end);
    return {
      period,
      anchor,
      startDate,
      endDate,
      label: `${germanDate(startDate)} – ${germanDate(endDate)}`
    };
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(anchor);
  if (!monthMatch) throw new Error('Ungültiger Monat für die Auswertung.');
  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  if (month < 1 || month > 12) throw new Error('Ungültiger Monat für die Auswertung.');

  const startDate = `${monthMatch[1]}-${monthMatch[2]}-01`;
  const endDate = isoDate(new Date(Date.UTC(year, month, 0, 12)));
  return {
    period,
    anchor,
    startDate,
    endDate,
    label: new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)))
  };
}

function numberValue(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function getReportAnalytics(env: Env, input: AnalyticsFilters) {
  const range = resolveAnalyticsRange(input.period, input.anchor);
  const business = String(input.business || 'all').trim();
  if (!['all', 'Shiraz', 'Djadoo'].includes(business)) {
    throw new Error('Ungültiger Betrieb für die Auswertung.');
  }

  const department = String(input.department || '').trim();
  if (department.length > 100) throw new Error('Abteilungsname ist zu lang.');

  const clauses = ['deleted_at IS NULL', 'date BETWEEN ? AND ?'];
  const values: Array<string> = [range.startDate, range.endDate];
  if (business !== 'all') {
    clauses.push('business = ?');
    values.push(business);
  }
  if (department) {
    clauses.push('department = ?');
    values.push(department);
  }
  const whereClause = clauses.join(' AND ');

  const [summaryResult, departmentResult, employeeResult, dateDepartmentResult, filterResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT
        ROUND(COALESCE(SUM(duration_hours), 0), 2) AS total_hours,
        COUNT(*) AS shift_count,
        COUNT(DISTINCT business || '|' || employee_key) AS employee_count
      FROM shifts
      WHERE ${whereClause}
    `).bind(...values),
    env.DB.prepare(`
      SELECT
        business,
        department,
        ROUND(COALESCE(SUM(duration_hours), 0), 2) AS hours,
        COUNT(*) AS shift_count,
        COUNT(DISTINCT employee_key) AS employee_count
      FROM shifts
      WHERE ${whereClause}
      GROUP BY business, department
      ORDER BY hours DESC, business ASC, department ASC
    `).bind(...values),
    env.DB.prepare(`
      SELECT
        business,
        MAX(employee) AS employee,
        employee_key,
        GROUP_CONCAT(DISTINCT department) AS departments,
        ROUND(COALESCE(SUM(duration_hours), 0), 2) AS hours,
        COUNT(*) AS shift_count
      FROM shifts
      WHERE ${whereClause}
      GROUP BY business, employee_key
      ORDER BY hours DESC, employee ASC
    `).bind(...values),
    env.DB.prepare(`
      SELECT
        date,
        business,
        department,
        ROUND(COALESCE(SUM(duration_hours), 0), 2) AS hours,
        COUNT(*) AS shift_count,
        COUNT(DISTINCT employee_key) AS employee_count
      FROM shifts
      WHERE ${whereClause}
      GROUP BY date, business, department
      ORDER BY date ASC, business ASC, department ASC
    `).bind(...values),
    env.DB.prepare(`
      SELECT business, department
      FROM shifts
      WHERE deleted_at IS NULL
      GROUP BY business, department
      ORDER BY business ASC, department ASC
    `)
  ]);

  const summaryRow = (summaryResult.results?.[0] || {}) as Record<string, unknown>;
  return {
    range,
    filters: {
      business,
      department,
      availableDepartments: (filterResult.results || []).map((row) => {
        const value = row as Record<string, unknown>;
        return {
          business: String(value.business),
          department: String(value.department)
        };
      })
    },
    summary: {
      totalHours: numberValue(summaryRow.total_hours),
      shiftCount: numberValue(summaryRow.shift_count),
      employeeCount: numberValue(summaryRow.employee_count)
    },
    byDepartment: (departmentResult.results || []).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        business: String(value.business),
        department: String(value.department),
        hours: numberValue(value.hours),
        shiftCount: numberValue(value.shift_count),
        employeeCount: numberValue(value.employee_count)
      };
    }),
    byEmployee: (employeeResult.results || []).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        business: String(value.business),
        employee: String(value.employee),
        employeeKey: String(value.employee_key),
        departments: String(value.departments || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        hours: numberValue(value.hours),
        shiftCount: numberValue(value.shift_count)
      };
    }),
    byDateDepartment: (dateDepartmentResult.results || []).map((row) => {
      const value = row as Record<string, unknown>;
      return {
        date: String(value.date),
        business: String(value.business),
        department: String(value.department),
        hours: numberValue(value.hours),
        shiftCount: numberValue(value.shift_count),
        employeeCount: numberValue(value.employee_count)
      };
    })
  };
}
