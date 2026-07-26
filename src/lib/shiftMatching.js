export function normalizeForMatch(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/-/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ');
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function buildStaffDirectoryText(staffConfig) {
  const lines = [];
  Object.keys(staffConfig || {}).forEach((business) => {
    Object.keys(staffConfig[business] || {}).forEach((dept) => {
      lines.push(`${business} / ${dept}: ${(staffConfig[business][dept] || []).join(', ')}`);
    });
  });
  return lines.join('\n');
}

export function buildFlatStaffList(staffConfig) {
  const flat = [];
  Object.keys(staffConfig || {}).forEach((business) => {
    Object.keys(staffConfig[business] || {}).forEach((department) => {
      (staffConfig[business][department] || []).forEach((employee) => {
        flat.push({ business, department, employee });
      });
    });
  });
  return flat;
}

// Snaps a guessed business/department/employee to the closest ACTUAL combo,
// so slight mismatches (accents, casing, wrong department guess) don't break the dropdowns.
export function resolveShiftMatch(result, staffConfig) {
  const flat = buildFlatStaffList(staffConfig);
  if (flat.length === 0) return result;
  const targetEmp = normalizeForMatch(result.employee);
  const targetBiz = normalizeForMatch(result.business);
  const targetDept = normalizeForMatch(result.department);

  let best = flat[0];
  let bestScore = Infinity;
  flat.forEach((entry) => {
    const empNorm = normalizeForMatch(entry.employee);
    let score = empNorm === targetEmp ? 0 : levenshtein(empNorm, targetEmp);
    if (normalizeForMatch(entry.business) === targetBiz) score -= 0.5;
    if (normalizeForMatch(entry.department) === targetDept) score -= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  });

  // If no real name is close enough, keep the raw guess — don't snap to a random person.
  // Threshold: allow up to ~30% of the name length in edits (min 2) before rejecting.
  const threshold = Math.max(2, Math.floor(targetEmp.length * 0.3));
  if (bestScore > threshold) {
    return { business: result.business, department: result.department, employee: result.employee };
  }
  return best;
}