// Server-side super-admin (owner) auth. Replaces the frontend-hardcoded key + client-side hash.
// - Password is verified on the SERVER (never in the browser).
// - On success we issue a short-lived signed JWT with a super_admin claim.
// - Protected endpoints verify that JWT — no master key is shipped to the client.
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || (() => { throw new Error('[super-admin] JWT_SECRET env var is required'); })();
const SALT = process.env.SUPER_ADMIN_SALT || 'agrocore_sa_2026';
// Hash of the owner password (same one already in use). Overridable via env.
const STORED_HASH = process.env.SUPER_ADMIN_HASH || 'ae99083e74428268ce2c6eb99fa085c38d1a77f6244670ae493b388b26f9b797';

export function checkSuperPassword(pw) {
  // Once the owner rotates their password, a bcrypt hash is stored in the DB and takes
  // precedence. Until then, fall back to the original salted-SHA256 env hash.
  const dbHash = getStoredPasswordHash();
  if (dbHash) { try { return bcrypt.compareSync(String(pw || ''), dbHash); } catch (_e) { return false; } }
  return crypto.createHash('sha256').update(String(pw || '') + SALT).digest('hex') === STORED_HASH;
}
export function passwordIsRotated() { return !!getStoredPasswordHash(); }
export function setSuperPassword(pw) {
  const hash = bcrypt.hashSync(String(pw || ''), 10);
  return setCfg('password_hash', hash);
}
export function signSuperAdmin() {
  // Owner token also carries the 'admin' module so it passes requireModule('admin') gates.
  return jwt.sign({ super_admin: true, modules: ['admin'] }, JWT_SECRET, { expiresIn: '12h' });
}
export function verifySuperAdmin(req) {
  try {
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-super-admin-token'];
    if (!t) return false;
    const p = jwt.verify(t, JWT_SECRET);
    return !!(p && p.super_admin === true);
  } catch (_e) { return false; }
}

// ── TOTP 2FA (RFC 6238) — works with Microsoft Authenticator / Google Authenticator ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s) {
  let bits = ''; const bytes = [];
  s = String(s || '').replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  const rem = bits.length % 5;
  if (rem) out += B32[parseInt(bits.slice(bits.length - rem).padEnd(5, '0'), 2)];
  return out;
}
function hotp(secretBuf, counter) {
  const b = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { b[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const h = crypto.createHmac('sha1', secretBuf).update(b).digest();
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}
export function totpEnabled() { return !!process.env.SUPER_ADMIN_TOTP_SECRET; }
export function verifyTotp(token) {
  const secret = process.env.SUPER_ADMIN_TOTP_SECRET;
  if (!secret) return true;                 // 2FA not configured → skip
  if (!token) return false;
  const buf = base32Decode(secret);
  const t = Math.floor(Date.now() / 1000 / 30);
  for (const w of [-2, -1, 0, 1, 2]) { if (hotp(buf, t + w) === String(token).trim()) return true; }
  return false;
}
// Setup helpers (used once to enrol the authenticator app).
export function generateTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
export function verifyTotpWith(secret, token) {
  if (!secret || !token) return false;
  const buf = base32Decode(secret);
  const t = Math.floor(Date.now() / 1000 / 30);
  for (const w of [-2, -1, 0, 1, 2]) { if (hotp(buf, t + w) === String(token).trim()) return true; }
  return false;
}
export function otpauthUri(secret, label = 'Nutrix Super Admin', issuer = 'Nutrix') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ── Super-admin IP allow-list ─────────────────────────────────────────────────
// Goal: everyone who is NOT on an approved IP gets a 404 on the super-admin surface.
// Traveller-safe: the list is EMPTY by default (→ allow all, nothing changes) and the
// login endpoint can auto-enrol a new IP once the owner passes password + 2FA, so you
// never get locked out on the road. Break-glass: SUPER_ADMIN_IPS env is always allowed.
function _encodeOwner(email) { return String(email).replace(/@/g, '_at_').replace(/\./g, '_dot_'); }
const _ownerEmail = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const IP_DB_PATH = process.env.NUTRIX_DB_PATH || `/var/www/nutripilot-agrocore/data/users/${_encodeOwner(_ownerEmail)}/nutrix.db`;

export function clientIp(req) {
  // nginx resolves the TRUE visitor IP from Cloudflare (set_real_ip_from + CF-Connecting-IP)
  // and OVERWRITES X-Real-IP with it — so X-Real-IP is unforgeable. We trust ONLY that
  // (and the socket for direct localhost). Raw cf-connecting-ip/x-forwarded-for are NOT
  // trusted, since a direct-to-origin attacker could set them.
  let ip = req.headers['x-real-ip']
    || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  ip = String(ip).replace(/^::ffff:/, '');
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function ipDb() {
  const db = new Database(IP_DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS super_admin_ips (
    ip TEXT PRIMARY KEY,
    label TEXT,
    added_at TEXT DEFAULT (datetime('now'))
  )`);
  return db;
}

// Small owner-config store (holds the rotated password hash, etc.).
function cfgDb() {
  const db = new Database(IP_DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS super_admin_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  return db;
}
function getCfg(k) {
  try { const db = cfgDb(); const r = db.prepare('SELECT value FROM super_admin_config WHERE key = ?').get(k); db.close(); return r ? r.value : null; }
  catch (_e) { return null; }
}
function setCfg(k, v) {
  try {
    const db = cfgDb();
    db.prepare(`INSERT INTO super_admin_config (key, value, updated_at) VALUES (?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(k, v);
    db.close(); return true;
  } catch (_e) { return false; }
}
function getStoredPasswordHash() { return getCfg('password_hash'); }

function envIps() {
  return String(process.env.SUPER_ADMIN_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

export function listAllowedIps() {
  let custom = [];
  try { const db = ipDb(); custom = db.prepare('SELECT ip, label, added_at FROM super_admin_ips ORDER BY added_at DESC').all(); db.close(); }
  catch (_e) { custom = []; }
  return { env: envIps(), custom };
}

export function allowlistActive() {
  const { env, custom } = listAllowedIps();
  return (env.length + custom.length) > 0;
}

export function isIpAllowed(req) {
  const { env, custom } = listAllowedIps();
  if (env.length + custom.length === 0) return true;      // empty → allow all (traveller-safe default)
  const ip = clientIp(req);
  return env.includes(ip) || custom.some(r => r.ip === ip);
}

export function addAllowedIp(ip, label) {
  if (!ip) return false;
  try { const db = ipDb(); db.prepare('INSERT OR REPLACE INTO super_admin_ips (ip, label, added_at) VALUES (?,?,datetime(\'now\'))').run(ip, label || null); db.close(); return true; }
  catch (_e) { return false; }
}

export function removeAllowedIp(ip) {
  try { const db = ipDb(); const r = db.prepare('DELETE FROM super_admin_ips WHERE ip = ?').run(ip); db.close(); return r.changes > 0; }
  catch (_e) { return false; }
}

// Gate for the sensitive super-admin surface: unknown IPs get a bare 404 (endpoint looks absent).
export function superAdminIpGate(req, res, next) {
  if (isIpAllowed(req)) return next();
  return res.status(404).end();
}

// ── Super-admin password reset tokens ─────────────────────────────────────────
const RESET_TTL_MIN = 30;
function resetDb() {
  const db = new Database(IP_DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS sa_reset_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`);
  return db;
}

export function createSaResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000).toISOString();
  const db = resetDb();
  // invalidate any existing unused tokens first
  db.prepare(`UPDATE sa_reset_tokens SET used_at = datetime('now') WHERE used_at IS NULL`).run();
  db.prepare(`INSERT INTO sa_reset_tokens (id, token_hash, expires_at) VALUES (?,?,?)`).run(id, hash, expires);
  db.close();
  return raw;
}

export function verifySaResetToken(raw) {
  if (!raw) return false;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const db = resetDb();
  const row = db.prepare(`SELECT * FROM sa_reset_tokens WHERE token_hash = ? AND used_at IS NULL`).get(hash);
  db.close();
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  return row.id;
}

export function consumeSaResetToken(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const db = resetDb();
  const r = db.prepare(`UPDATE sa_reset_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL`).run(hash);
  db.close();
  return r.changes > 0;
}
