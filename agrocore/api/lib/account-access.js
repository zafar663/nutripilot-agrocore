/** Live account + license-window checks used by login and the API gate. */

export function parseModuleAccess(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function ymd(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function moduleWindowActive(entry) {
  if (!entry || typeof entry !== 'object') return true;
  const today = todayUTC();
  const from = ymd(entry.from);
  const until = ymd(entry.until);
  if (from && today < from) return false;
  if (until && today > until) return false;
  return true;
}

export function parseGrantedModules(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function effectiveModules(granted, moduleAccess) {
  const access = parseModuleAccess(moduleAccess);
  return parseGrantedModules(granted).filter((key) => moduleWindowActive(access[key]));
}

export function licenseUntil(granted, moduleAccess) {
  const access = parseModuleAccess(moduleAccess);
  const list = parseGrantedModules(granted);
  if (!list.length) return null;
  const dates = [];
  for (const key of list) {
    const until = ymd(access[key]?.until);
    if (!until) return null;
    dates.push(until);
  }
  dates.sort();
  return dates[dates.length - 1];
}

const OK_STATUS = new Set(['', 'approved', 'active', 'unknown']);

export function accountAccessState(status, granted, moduleAccess) {
  const st = String(status || '').toLowerCase();
  if (st && !OK_STATUS.has(st)) {
    const reason = ['rejected', 'pending', 'suspended'].includes(st) ? st : 'inactive';
    return {
      blocked: true,
      reason,
      modules: [],
      error: reason === 'rejected'
        ? 'Your account is not approved. Contact the administrator.'
        : reason === 'pending'
          ? 'Your account is awaiting approval.'
          : reason === 'suspended'
            ? 'Your account has been suspended. Contact the administrator.'
            : 'Your account is no longer active. Contact the administrator.',
    };
  }

  const grantedList = parseGrantedModules(granted);
  const live = effectiveModules(grantedList, moduleAccess);
  const access = parseModuleAccess(moduleAccess);
  const dated = grantedList.filter((key) => access[key] && (access[key].from || access[key].until));
  if (grantedList.length && live.length === 0 && dated.length === grantedList.length) {
    return {
      blocked: true,
      reason: 'expired',
      modules: [],
      error: 'Your license period has ended. Contact the administrator to renew.',
    };
  }

  return { blocked: false, reason: null, modules: live, error: null };
}

export function revokePayload(state) {
  return {
    ok: false,
    success: false,
    revoke: true,
    account_status: state.reason,
    error: state.error,
  };
}
