export const SHIRAZ_BASE_STAFF: Record<string, string[]> = {
  Bar: ['Amir2', 'Behrouz', 'Mostafa', 'Pascha'],
  Küche: [
    'Hossein', 'Nima', 'Kashef', 'Ahmed', 'Shakur', 'Aref', 'Mohsen',
    'Filimon', 'Porya', 'Sadegh', 'M.Asef', 'Ghader', 'Zakaria',
    'Jafar', 'Ali zia', 'Iman', 'Ali ghorbani'
  ],
  Service: [
    'Reyhan', 'Alireza', 'Masoud', 'Narin', 'Shima', 'Yeganeh',
    'Nian', 'Niloufar', 'Dilman', 'Araz', 'Kianoush'
  ],
  Fahrer: [
    'Yusef', 'Erfan', 'Malik Lugman', 'Malik Tanwir', 'Vahid',
    'Kazem', 'Amir2', 'Masoud', 'Amir'
  ]
};

export const DJADOO_PERSONAL_STAFF = [
  'Reyhan', 'Jafar', 'Kashef', 'Mirheiydar', 'Nabi', 'Martin',
  'Niloufar', 'Yeganeh', 'Behrouz', 'Mostafa', 'Mohammad Bar',
  'Mr. Mohammadi', 'Dilman', 'Nian', 'Kianoush', 'Aref', 'Nami', 'Mohsen'
];

export const HINWEIS_ONLY_STAFF = ['Fr Bobrik'];

const SHIRAZ_DEPARTMENT_ORDER = ['Bar', 'Küche', 'Service', 'Fahrer', 'Catering', 'Technik'];
const DJADOO_DEPARTMENT_ORDER = ['Personal', 'Technik'];

const KNOWN_SCAN_NAME_ALIASES: Record<string, string> = {
  mirheidar: 'Mirheiydar',
  mirhadar: 'Mirheiydar',
  mirheydar: 'Mirheiydar',
  malikt: 'Malik Tanwir'
};

const SCAN_SECTION_HEADINGS = new Set([
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
  'lieferer',
  'betriebsleiter',
  'leitung',
  'technik',
  'personal',
  'catering',
  'vorschuss',
  'uberzahlung',
  'uberweisung'
]);

export function normalizePersonName(name: string): string {
  const normalized = String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ');
  if (normalized === 'ghader') return 'ghadir';
  return normalized;
}

export function canonicalizeKnownScanName(name: string): string {
  return KNOWN_SCAN_NAME_ALIASES[normalizePersonName(name)] || String(name || '').trim();
}

function scanKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]
        : 1 + Math.min(
          previous[rightIndex - 1],
          previous[rightIndex],
          current[rightIndex - 1]
        );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function numericSuffix(value: string): string {
  return value.match(/(\d+)$/)?.[1] || '';
}

export function hasCompatibleNameNumber(
  rawEmployee: string,
  canonicalEmployee: string
): boolean {
  return numericSuffix(scanKey(rawEmployee)) === numericSuffix(scanKey(canonicalEmployee));
}

export function isScanSectionHeading(value: string): boolean {
  return SCAN_SECTION_HEADINGS.has(scanKey(value));
}

export function hasScanTechnicalMarker(
  department: string,
  employee: string,
  evidence: string
): boolean {
  return /\b(?:tech|technik)\b/iu.test(`${department} ${employee} ${evidence}`);
}

export function canonicalScanDepartment(
  business: string,
  rawDepartment: string,
  configuredDepartments: string[]
): string {
  const key = scanKey(rawDepartment);
  if (
    (key === 'technik' || key === 'tech') &&
    configuredDepartments.includes('Technik')
  ) {
    return 'Technik';
  }

  if (business === 'Djadoo') {
    return configuredDepartments.includes('Personal')
      ? 'Personal'
      : configuredDepartments[0] || '';
  }

  const aliases: Record<string, string[]> = {
    bar: ['bar'],
    kuche: ['kuche', 'kueche', 'kitchen'],
    service: ['service'],
    fahrer: ['fahrer', 'liefer', 'lieferer', 'driver'],
    betriebsleiter: ['betriebsleiter', 'leitung'],
    technik: ['technik', 'tech']
  };

  for (const department of configuredDepartments) {
    const canonicalKey = scanKey(department);
    const accepted = aliases[canonicalKey] || [canonicalKey];
    if (accepted.includes(key)) return department;
  }
  return '';
}

export interface ScanStaffEntry {
  business: string;
  department: string;
  employee: string;
}

export interface ScanLearnedAlias {
  employee: string;
  department: string;
}

export interface ScanStaffMatch {
  employee: string;
  department: string;
  matched: boolean;
}

function strictScanStaffMatch(
  rawEmployee: string,
  extractedDepartment: string,
  flatStaff: ScanStaffEntry[]
): ScanStaffMatch {
  const rawTarget = scanKey(rawEmployee);
  if (!rawTarget) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const target = scanKey(canonicalizeKnownScanName(rawEmployee));
  const departmentPool = extractedDepartment === 'Technik'
    ? flatStaff.filter((entry) => entry.department === 'Technik')
    : flatStaff.filter((entry) => entry.department !== 'Technik');
  const pool = departmentPool.length > 0 ? departmentPool : flatStaff;
  const exact = pool.filter((entry) => scanKey(entry.employee) === target);
  if (exact.length > 0) {
    const selected = exact.find((entry) => entry.department === extractedDepartment) || exact[0];
    return {
      employee: selected.employee,
      department: selected.department,
      matched: true
    };
  }

  if (target.length < 4) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const targetSuffix = numericSuffix(target);
  const scored = pool
    .map((entry) => {
      const entryKey = scanKey(entry.employee);
      return {
        entry,
        entryKey,
        distance: editDistance(entryKey, target)
      };
    })
    .filter((candidate) => numericSuffix(candidate.entryKey) === targetSuffix);
  if (scored.length === 0) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const bestDistance = Math.min(...scored.map((candidate) => candidate.distance));
  const bestEmployees = new Set(
    scored
      .filter((candidate) => candidate.distance === bestDistance)
      .map((candidate) => candidate.entryKey)
  );
  const maxDistance = target.length >= 8 ? 2 : 1;
  const ratio = bestDistance / Math.max(target.length, 1);
  if (bestDistance > maxDistance || ratio > 0.2 || bestEmployees.size !== 1) {
    return { employee: rawEmployee, department: extractedDepartment, matched: false };
  }

  const candidates = scored.filter((candidate) => candidate.distance === bestDistance);
  const selected = (
    candidates.find((candidate) => candidate.entry.department === extractedDepartment) ||
    candidates[0]
  ).entry;
  return {
    employee: selected.employee,
    department: selected.department,
    matched: true
  };
}

export function matchScannedStaff(
  rawEmployee: string,
  extractedDepartment: string,
  flatStaff: ScanStaffEntry[],
  learnedAlias: ScanLearnedAlias | null
): ScanStaffMatch {
  if (
    !learnedAlias ||
    !hasCompatibleNameNumber(rawEmployee, learnedAlias.employee)
  ) {
    return strictScanStaffMatch(rawEmployee, extractedDepartment, flatStaff);
  }

  const aliasKey = normalizePersonName(learnedAlias.employee);
  const aliasEntries = flatStaff.filter(
    (entry) => normalizePersonName(entry.employee) === aliasKey
  );
  const selected = aliasEntries.find(
    (entry) => entry.department === learnedAlias.department
  ) || aliasEntries.find(
    (entry) => entry.department === extractedDepartment
  ) || aliasEntries.find((entry) => entry.department !== 'Technik') || aliasEntries[0];

  return selected
    ? {
      employee: selected.employee,
      department: selected.department,
      matched: true
    }
    : {
      employee: learnedAlias.employee,
      department: learnedAlias.department || extractedDepartment,
      matched: true
    };
}

function uniqueNames(names: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawName of names) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    const key = normalizePersonName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export interface AdditionalStaff {
  business: string;
  department: string;
  employee: string;
  employeeKey?: string;
  hidden?: boolean;
}

export function buildEffectiveStaffConfig(additionalStaff: AdditionalStaff[] = [], includeHidden = false) {
  const config: Record<string, Record<string, string[]>> = {
    Shiraz: {},
    Djadoo: {}
  };

  for (const [department, employees] of Object.entries(SHIRAZ_BASE_STAFF)) {
    config.Shiraz[department] = uniqueNames(employees);
  }
  config.Djadoo.Personal = uniqueNames(DJADOO_PERSONAL_STAFF);

  const shirazTechnikOnly: string[] = [];
  const djadooTechnikOnly: string[] = [];
  const cateringOnly: string[] = [];
  const hiddenEmployeeKeys = new Set<string>();

  if (!includeHidden) {
    for (const item of additionalStaff) {
      if (item.hidden) hiddenEmployeeKeys.add(item.employeeKey || normalizePersonName(item.employee));
    }
  }

  for (const item of additionalStaff) {
    if (!includeHidden && item.hidden) continue;

    if (
      item.business === 'Catering' ||
      (item.business === 'Shiraz' && item.department === 'Catering')
    ) {
      cateringOnly.push(item.employee);
      continue;
    }
    if (!config[item.business]) continue;
    if (item.business === 'Shiraz' && item.department === 'Technik') {
      shirazTechnikOnly.push(item.employee);
      continue;
    }
    if (item.business === 'Djadoo' && item.department === 'Technik') {
      djadooTechnikOnly.push(item.employee);
      continue;
    }

    config[item.business][item.department] ||= [];
    config[item.business][item.department] = uniqueNames([
      ...config[item.business][item.department],
      item.employee
    ]);
  }

  const shirazAllExceptTechnik: string[] = [];
  for (const [department, employees] of Object.entries(config.Shiraz)) {
    if (department !== 'Technik') shirazAllExceptTechnik.push(...employees);
  }
  config.Shiraz.Technik = uniqueNames([...shirazAllExceptTechnik, ...shirazTechnikOnly]);
  config.Djadoo.Technik = uniqueNames([
    ...shirazAllExceptTechnik,
    ...config.Djadoo.Personal,
    ...djadooTechnikOnly
  ]);
  config.Shiraz.Catering = uniqueNames([
    ...shirazAllExceptTechnik,
    ...config.Djadoo.Personal,
    ...cateringOnly
  ]);

  function orderDepartments(source: Record<string, string[]>, order: string[]) {
    const ordered: Record<string, string[]> = {};
    for (const key of order) if (source[key]) ordered[key] = source[key];
    for (const key of Object.keys(source)) if (!ordered[key]) ordered[key] = source[key];
    return ordered;
  }

  config.Shiraz = orderDepartments(config.Shiraz, SHIRAZ_DEPARTMENT_ORDER);
  config.Djadoo = orderDepartments(config.Djadoo, DJADOO_DEPARTMENT_ORDER);
  if (!includeHidden && hiddenEmployeeKeys.size) {
    for (const business of Object.keys(config)) {
      for (const department of Object.keys(config[business])) {
        config[business][department] = config[business][department].filter(
          (name) => !hiddenEmployeeKeys.has(normalizePersonName(name))
        );
      }
    }
  }

  return config;
}
