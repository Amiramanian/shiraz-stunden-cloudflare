import type { HinweisRecord, ShiftRecord, StaffMemberRecord } from './types';
import { buildEffectiveStaffConfig, HINWEIS_ONLY_STAFF, normalizePersonName } from './staff-config';

export interface SheetPlan {
  title: string;
  values: Array<Array<string | number>>;
  employeeBlocks?: Array<{
    startColumn: number;
    totalRows: number[];
  }>;
  hidden?: boolean;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function sheetNameFor(business: string, department: string) {
  return business === 'Djadoo' ? `${department} Djadoo` : department;
}

export function buildSheetPlans(
  shifts: ShiftRecord[],
  hinweise: HinweisRecord[],
  staffMembers: StaffMemberRecord[]
): SheetPlan[] {
  const config = buildEffectiveStaffConfig(staffMembers, true);
  const hinweiseByEmployee = new Map<string, HinweisRecord[]>();
  const shiftsByGroup = new Map<string, ShiftRecord[]>();
  const totalsByEmployee = new Map<string, Map<string, number>>();

  for (const note of hinweise) {
    const key = note.employeeKey || normalizePersonName(note.employee);
    const list = hinweiseByEmployee.get(key) || [];
    list.push(note);
    hinweiseByEmployee.set(key, list);
  }

  for (const shift of shifts) {
    const employeeKey = shift.employeeKey || normalizePersonName(shift.employee);
    const groupKey = `${shift.business}|${shift.department}|${employeeKey}`;
    const group = shiftsByGroup.get(groupKey) || [];
    group.push(shift);
    shiftsByGroup.set(groupKey, group);

    const employeeTotals = totalsByEmployee.get(employeeKey) || new Map<string, number>();
    const departmentKey = `${shift.business}|${shift.department}`;
    employeeTotals.set(departmentKey, (employeeTotals.get(departmentKey) || 0) + shift.durationHours);
    totalsByEmployee.set(employeeKey, employeeTotals);
  }

  const plans: SheetPlan[] = [];

  for (const business of ['Shiraz', 'Djadoo', 'Catering']) {
    for (const department of Object.keys(config[business] || {})) {
      const employees = config[business][department] || [];
      const blocks = employees.map((employee) => {
        const employeeKey = normalizePersonName(employee);
        const employeeShifts = (shiftsByGroup.get(`${business}|${department}|${employeeKey}`) || [])
          .slice()
          .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
        const employeeNotes = (hinweiseByEmployee.get(employeeKey) || [])
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date));

        const rows: Array<Array<string | number>> = [
          [employee, '', '', '', ''],
          ['Date', 'In', 'Out', 'Sum', '']
        ];

        for (const shift of employeeShifts) {
          rows.push([shift.date, shift.startTime, shift.endTime, round2(shift.durationHours), '']);
        }

        const totalRows: number[] = [];
        const directTotal = employeeShifts.reduce((sum, shift) => sum + shift.durationHours, 0);
        totalRows.push(rows.length);
        rows.push(['', '', 'Gesamt', round2(directTotal), '']);

        const otherTotals = totalsByEmployee.get(employeeKey) || new Map<string, number>();
        let grandTotal = directTotal;
        let hasOtherTotal = false;
        for (const [departmentKey, amount] of otherTotals.entries()) {
          const [otherBusiness, otherDepartment] = departmentKey.split('|');
          if (otherBusiness === business && otherDepartment === department) continue;
          hasOtherTotal = true;
          grandTotal += amount;
          totalRows.push(rows.length);
          rows.push(['', sheetNameFor(otherBusiness, otherDepartment), 'Gesamt', round2(amount), '']);
        }

        if (hasOtherTotal) {
          totalRows.push(rows.length);
          rows.push(['', '', 'Gesamt Gesamt', round2(grandTotal), '']);
        }

        if (employeeNotes.length) {
          rows.push(['', '', 'Hinweise', '', '']);
          for (const note of employeeNotes) rows.push([note.date, '', note.text, '', '']);
        }

        return { rows, totalRows };
      });

      const maxRows = Math.max(1, ...blocks.map((block) => block.rows.length));
      const values: Array<Array<string | number>> = [];
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const row: Array<string | number> = [];
        for (const block of blocks) row.push(...(block.rows[rowIndex] || ['', '', '', '', '']));
        values.push(row);
      }

      plans.push({
        title: sheetNameFor(business, department),
        values: values.length ? values : [['Keine Mitarbeiter']],
        employeeBlocks: blocks.map((block, index) => ({
          startColumn: index * 5,
          totalRows: block.totalRows
        }))
      });
    }
  }

  for (const employee of HINWEIS_ONLY_STAFF) {
    const employeeKey = normalizePersonName(employee);
    const notes = (hinweiseByEmployee.get(employeeKey) || [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const values: Array<Array<string | number>> = [[employee, ''], ['Datum', 'Hinweis']];
    for (const note of notes) values.push([note.date, note.text]);
    plans.push({ title: employee, values });
  }

  plans.push({
    title: 'Bearbeiten_Schichten',
    hidden: true,
    values: [
      ['ID', 'Date', 'Business', 'Department', 'Employee', 'In', 'Out', 'Sum'],
      ...shifts
        .slice()
        .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
        .map((shift) => [
          shift.id,
          shift.date,
          shift.business,
          shift.department,
          shift.employee,
          shift.startTime,
          shift.endTime,
          round2(shift.durationHours)
        ])
    ]
  });

  plans.push({
    title: 'Bearbeiten_Hinweise',
    hidden: true,
    values: [
      ['ID', 'Employee', 'Date', 'Hinweis'],
      ...hinweise
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((note) => [note.id, note.employee, note.date, note.text])
    ]
  });

  plans.push({
    title: 'Bearbeiten_Mitarbeiter',
    hidden: true,
    values: [
      ['ID', 'Business', 'Department', 'Employee', 'Hidden'],
      ...staffMembers.map((member) => [
        member.id,
        member.business,
        member.department,
        member.employee,
        member.hidden ? 'TRUE' : 'FALSE'
      ])
    ]
  });

  return plans;
}
