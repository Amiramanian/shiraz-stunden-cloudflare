// Base staff configuration for Shiraz and Djadoo
// Mirrors the original Google Apps Script config

export const SHIRAZ_BASE_STAFF = {
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

export const SHIRAZ_DEPARTMENT_ORDER = ['Bar', 'Küche', 'Service', 'Fahrer', 'Catering', 'Technik'];
export const DJADOO_DEPARTMENT_ORDER = ['Personal', 'Technik'];

// People who only get Hinweise (notes) — not part of any business/department, no shifts.
export const HINWEIS_ONLY_STAFF = ['Fr Bobrik'];

function cleanDisplayName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

export function normalizePersonName(name) {
  const normalized = cleanDisplayName(name)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ');
  // Ghadir's name was previously misspelled "Ghadir" — keep matching existing stored data.
  if (normalized === 'ghader') return 'ghadir';
  return normalized;
}

function uniqueNames(names) {
  const result = [];
  const seen = {};
  names.forEach((name) => {
    const cleaned = cleanDisplayName(name);
    const key = normalizePersonName(cleaned);
    if (!cleaned || seen[key]) return;
    seen[key] = true;
    result.push(cleaned);
  });
  return result;
}

// Build effective staff config from base + dynamically added StaffMember records.
// includeHidden=false (app): hide staff flagged `hidden` everywhere in the app.
// includeHidden=true (export/sync): include everyone so Excel still shows them.
export function buildEffectiveStaffConfig(additionalStaff = [], includeHidden = false) {
  const config = {
    Shiraz: {},
    Djadoo: {}
  };

  Object.keys(SHIRAZ_BASE_STAFF).forEach((dept) => {
    config.Shiraz[dept] = uniqueNames([...SHIRAZ_BASE_STAFF[dept]]);
  });

  config.Djadoo.Personal = uniqueNames([...DJADOO_PERSONAL_STAFF]);

  const shirazTechnikOnly = [];
  const djadooTechnikOnly = [];
  const cateringOnly = [];

  // Collect globally hidden employee keys (hidden from the app, but kept in Excel)
  const hiddenEmployeeKeys = new Set();
  if (!includeHidden) {
    additionalStaff.forEach((item) => {
      if (item.hidden) {
        hiddenEmployeeKeys.add(item.employeeKey || normalizePersonName(item.employee));
      }
    });
  }

  additionalStaff.forEach((item) => {
    if (!includeHidden && item.hidden) return; // skip hidden staff in the app

    if (
      item.business === 'Catering' ||
      (item.business === 'Shiraz' && item.department === 'Catering')
    ) {
      cateringOnly.push(item.employee);
      return;
    }
    if (!config[item.business]) return;
    if (item.business === 'Shiraz' && item.department === 'Technik') {
      shirazTechnikOnly.push(item.employee);
      return;
    }
    if (item.business === 'Djadoo' && item.department === 'Technik') {
      djadooTechnikOnly.push(item.employee);
      return;
    }

    if (!config[item.business][item.department]) {
      config[item.business][item.department] = [];
    }
    config[item.business][item.department] = uniqueNames([
      ...config[item.business][item.department],
      item.employee
    ]);
  });

  // Technik = all staff from all Shiraz departments (except Technik itself) + shirazTechnikOnly
  const shirazAllExceptTechnik = [];
  Object.keys(config.Shiraz).forEach((dept) => {
    if (dept === 'Technik') return;
    shirazAllExceptTechnik.push(...config.Shiraz[dept]);
  });
  config.Shiraz.Technik = uniqueNames([...shirazAllExceptTechnik, ...shirazTechnikOnly]);

  // Djadoo Technik = all Shiraz staff + Djadoo Personal + djadooTechnikOnly
  config.Djadoo.Technik = uniqueNames([
    ...shirazAllExceptTechnik,
    ...config.Djadoo.Personal,
    ...djadooTechnikOnly
  ]);

  // Catering is a Shiraz department containing all operational staff.
  config.Shiraz.Catering = uniqueNames([
    ...shirazAllExceptTechnik,
    ...config.Djadoo.Personal,
    ...cateringOnly
  ]);

  // Order departments
  const orderedShiraz = {};
  SHIRAZ_DEPARTMENT_ORDER.forEach((d) => { if (config.Shiraz[d]) orderedShiraz[d] = config.Shiraz[d]; });
  Object.keys(config.Shiraz).forEach((d) => { if (!orderedShiraz[d]) orderedShiraz[d] = config.Shiraz[d]; });
  config.Shiraz = orderedShiraz;

  const orderedDjadoo = {};
  DJADOO_DEPARTMENT_ORDER.forEach((d) => { if (config.Djadoo[d]) orderedDjadoo[d] = config.Djadoo[d]; });
  Object.keys(config.Djadoo).forEach((d) => { if (!orderedDjadoo[d]) orderedDjadoo[d] = config.Djadoo[d]; });
  config.Djadoo = orderedDjadoo;

  // Filter out globally-hidden employees from every department (app only)
  if (!includeHidden && hiddenEmployeeKeys.size > 0) {
    Object.keys(config).forEach((business) => {
      Object.keys(config[business]).forEach((department) => {
        config[business][department] = config[business][department].filter(
          (name) => !hiddenEmployeeKeys.has(normalizePersonName(name))
        );
      });
    });
  }

  return config;
}

export function getAllStaffUnique(config) {
  let all = [];
  Object.keys(config).forEach((business) => {
    Object.keys(config[business]).forEach((dept) => {
      all = all.concat(config[business][dept]);
    });
  });
  return uniqueNames(all);
}

// Hinweise employee list includes everyone from shifts plus Hinweis-only staff (e.g. Fr Bobrik).
export function getAllHinweisEmployees(config) {
  return uniqueNames([...getAllStaffUnique(config), ...HINWEIS_ONLY_STAFF]);
}

export function getDepartmentList(business, config) {
  return Object.keys(config[business] || []);
}

export function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/_/g, '')
    .replace(/[0-9]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
