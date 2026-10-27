'use strict';

/** One mailbox, one account. Turns gmail,com / spaces / fullwidth @ into a real email. */
function normalizeEmail(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').replace(/＠/g, '@');
  const at = s.lastIndexOf('@');
  if (at < 0) return s;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).replace(/,/g, '.');
  return `${local}@${domain}`;
}

function emailAliases(raw) {
  const original = String(raw || '').trim().toLowerCase();
  const canon = normalizeEmail(raw);
  const out = [];
  const add = (e) => {
    if (e && !out.includes(e)) out.push(e);
  };
  add(canon);
  add(original);
  const at = canon.lastIndexOf('@');
  if (at >= 0) {
    const local = canon.slice(0, at);
    const domain = canon.slice(at + 1);
    const lastDot = domain.lastIndexOf('.');
    if (lastDot > 0) add(`${local}@${domain.slice(0, lastDot)},${domain.slice(lastDot + 1)}`);
  }
  return out;
}

function encodeUsername(username) {
  return normalizeEmail(username)
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/,/g, '_dot_');
}

function lookupUserByEmail(db, raw) {
  if (!db || !raw) return null;
  for (const e of emailAliases(raw)) {
    const row = db.prepare('SELECT * FROM np_users WHERE lower(email) = ?').get(e);
    if (row) return row;
  }
  return null;
}

module.exports = {
  normalizeEmail,
  emailAliases,
  encodeUsername,
  lookupUserByEmail,
};
