export const SHIRAZ_BASE_STAFF: Record<string, string[]> = {
  Bar: ['Amir2', 'Behrouz', 'Mostafa'],
  Küche: [
    'Hossein', 'Nima', 'Kashef', 'Ahmed', 'Shakur', 'Aref', 'Mohsen',
    'Filimon', 'Porya', 'Sadegh', 'M.Asef', 'Ghader', 'Zakaria',
    'Jafar', 'Ali zia', 'Iman', 'Ali ghorbani'
  ],
  Service: [
    'Reyhan', 'Alireza', 'Masoud', 'Narin', 'Shima', 'Yeganeh',
    'Nian', 'Niloufar', 'Dilman', 'Araz'
  ],
  Fahrer: [
    'Yusef', 'Erfan', 'Malik Lugman', 'Malik Tanwir', 'Vahid',
    'Kazem', 'Amir2', 'Masoud'
  ],
  Betriebsleiter: ['Amir', 'Kianoush', 'Pascha']
};

export const DJADOO_PERSONAL_STAFF = [
  'Reyhan', 'Jafar', 'Kashef', 'Mirheiydar', 'Nabi', 'Martin',
  'Niloufar', 'Yeganeh', 'Behrouz', 'Mostafa', 'Mohammad Bar',
  'Mr. Mohammadi', 'Dilman', 'Nian', 'Kianoush', 'Aref', 'Nami', 'Mohsen'
];

export const HINWEIS_ONLY_STAFF = ['Fr Bobrik'];

const SHIRAZ_DEPARTMENT_ORDER = ['Bar', 'Küche', 'Service', 'Fahrer', 'Betriebsleiter', 'Technik'];
const DJADOO_DEPARTMENT_ORDER = ['Personal', 'Technik'];
const CATERING_DEPARTMENT_ORDER = ['Catering'];

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
    Djadoo: {},
    Catering: {}
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
    if (!config[item.business]) continue;
    if (!includeHidden && item.hidden) continue;

    if (item.business === 'Catering') {
      cateringOnly.push(item.employee);
      continue;
    }
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
  config.Catering.Catering = uniqueNames([
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
  config.Catering = orderDepartments(config.Catering, CATERING_DEPARTMENT_ORDER);

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
