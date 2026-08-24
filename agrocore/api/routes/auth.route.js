import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import { sendMail } from '../../core/email/mailer.js';
import { verifySuperAdmin, checkSuperPassword, signSuperAdmin, totpEnabled, verifyTotp, generateTotpSecret, verifyTotpWith, otpauthUri,
  clientIp, listAllowedIps, allowlistActive, isIpAllowed, addAllowedIp, removeAllowedIp, superAdminIpGate,
  setSuperPassword, passwordIsRotated, createSaResetToken, verifySaResetToken, consumeSaResetToken } from '../middleware/super-admin.mw.js';
import { invalidateUserStatus } from '../middleware/auth-gate.mw.js';
import { trafficSummary, logLoginEvent, userActivity } from '../middleware/traffic.mw.js';
import { listBlocked, unblockIp, blockIp } from '../middleware/ip-block.mw.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || (() => { throw new Error('[auth] JWT_SECRET env var is required'); })();

// Login brute-force protection — keyed by IP, max 10 attempts per 15 min
const loginAttempts = new Map();
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const WINDOW = 15 * 60 * 1000; // 15 min
  const MAX = 10;
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW) {
    entry = { count: 0, windowStart: now };
    loginAttempts.set(ip, entry);
  }
  if (entry.count >= MAX) return false;
  entry.count++;
  return true;
}
function resetLoginRateLimit(ip) { loginAttempts.delete(ip); }

// ── Super-admin (owner) login — password + optional TOTP 2FA, verified SERVER-SIDE ──
router.post('/v1/super-admin/login', (req, res) => {
  const { password, code } = req.body || {};
  if (!checkSuperPassword(password)) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  if (totpEnabled() && !verifyTotp(code)) {
    return res.status(401).json({ success: false, error: 'Invalid authenticator code', need_2fa: true });
  }
  // IP allow-list: if it is active and you are on an UNKNOWN network (travelling),
  // only let you in when 2FA is enforced — then auto-enrol this IP so it works from here on.
  if (allowlistActive() && !isIpAllowed(req)) {
    if (!totpEnabled()) {
      return res.status(403).json({ success: false, error: 'This device/network is not on your allow-list. Turn on 2FA to sign in while travelling, or connect from an approved network.', new_ip: clientIp(req) });
    }
    addAllowedIp(clientIp(req), 'auto-enrolled at login ' + new Date().toISOString().slice(0, 10));
  }
  return res.json({ success: true, token: signSuperAdmin(), twofa: totpEnabled(), ip: clientIp(req) });
});

// ── Super-admin Security: IP allow-list management (owner-token gated) ──────────
router.get('/v1/super-admin/security/status', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const { env, custom } = listAllowedIps();
  return res.json({ success: true, your_ip: clientIp(req), active: allowlistActive(), env_ips: env, ips: custom, twofa: totpEnabled() });
});

router.post('/v1/super-admin/security/allow-ip', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const ip = String(req.body?.ip || clientIp(req)).trim();
  const label = String(req.body?.label || '').slice(0, 80) || null;
  addAllowedIp(ip, label);
  const { custom } = listAllowedIps();
  return res.json({ success: true, added: ip, ips: custom });
});

router.post('/v1/super-admin/security/remove-ip', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const ip = String(req.body?.ip || '').trim();
  const removed = removeAllowedIp(ip);
  const { custom } = listAllowedIps();
  return res.json({ success: true, removed, ips: custom });
});

// Rotate the owner password (verify current password + 2FA, then store a fresh bcrypt hash).
router.post('/v1/super-admin/change-password', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const { current_password, new_password, code } = req.body || {};
  if (!checkSuperPassword(current_password)) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
  if (totpEnabled() && !verifyTotp(code)) return res.status(401).json({ success: false, error: 'Invalid authenticator code' });
  if (!new_password || String(new_password).length < 10) return res.status(400).json({ success: false, error: 'New password must be at least 10 characters' });
  if (String(new_password) === String(current_password)) return res.status(400).json({ success: false, error: 'New password must be different from the current one' });
  const okSet = setSuperPassword(new_password);
  if (!okSet) return res.status(500).json({ success: false, error: 'Could not save the new password' });
  return res.json({ success: true, message: 'Password updated. Use the new password next time you sign in.' });
});

// Traffic dashboard — request volume, top endpoints, active users, recent activity.
router.get('/v1/super-admin/traffic', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  try {
    const data = trafficSummary();
    // Enrich email-keyed rows with the person's real name (from np_users).
    try {
      const db = getDb();
      const nameMap = {};
      db.prepare('SELECT email, full_name FROM np_users').all().forEach(u => { nameMap[(u.email || '').toLowerCase()] = u.full_name || u.email; });
      const nm = (e) => e === 'anonymous' ? 'Anonymous (public)' : e === 'api-key' ? 'API / integration' : (nameMap[(e || '').toLowerCase()] || e);
      (data.top_users || []).forEach(u => { u.name = nm(u.user); });
      (data.active_now || []).forEach(u => { u.name = nm(u.email); });
      (data.recent_logins || []).forEach(u => { u.name = nm(u.email); });
    } catch (_e) {}
    return res.json({ success: true, data, blocked: listBlocked() });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Full activity for one user (drill-down).
router.get('/v1/super-admin/traffic/user', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const email = String(req.query.email || '').trim();
  if (!email) return res.status(400).json({ success: false, error: 'email required' });
  try { return res.json({ success: true, data: userActivity(email) }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Manually unblock / block an IP.
router.post('/v1/super-admin/traffic/unblock', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const removed = unblockIp(String(req.body?.ip || '').trim());
  return res.json({ success: true, removed, blocked: listBlocked() });
});
router.post('/v1/super-admin/traffic/block', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const ok = blockIp(String(req.body?.ip || '').trim(), req.body?.reason || 'manual block', 0);
  return res.json({ success: ok, blocked: listBlocked() });
});

// ── Owner analytics: per-user usage, per-section volume, Bot cost, cross-platform ──
const DISCORA_DB_PATH = '/var/www/discora-api/db/discora.sqlite';
const REG_DB_PATH = '/var/www/nutripilot-agrocore/data/registrations.db';
const BOT_LOG_PATH = process.env.BOT_LOG_PATH || '/root/.pm2/logs/liveiq-whatsapp-out.log';
const BOT_COST_PER_MSG = Number(process.env.BOT_COST_PER_MSG || 0.008); // USD per WhatsApp message (Twilio est.)

function analyticsModule(p) {
  p = p || '';
  if (p.startsWith('/v1/mill') || p.startsWith('/api/mill')) return 'Mill IQ';
  if (p.startsWith('/api/farmpulse') || p.startsWith('/v1/farmpulse')) return 'Farm Pulse';
  if (/^\/v1\/(purchase|raw-materials|price-lists|suppliers|exchange-rates|vendor)/.test(p)) return 'VendorPulse';
  if (p.startsWith('/v1/super-admin')) return 'Super Admin';
  if (p.startsWith('/v1/admin')) return 'Admin';
  if (p.startsWith('/v1/auth')) return 'Auth / Login';
  if (p.startsWith('/api-keys') || p.startsWith('/v1/api-keys')) return 'API Keys';
  if (p.startsWith('/v1/prices') || p.startsWith('/api/prices')) return 'Prices';
  if (p.startsWith('/upload')) return 'Uploads';
  return 'Nutrix / Formulation';
}
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

router.get('/v1/super-admin/analytics', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  try {
    const out = { agrocore: {}, discora: {}, bot: {}, generatedAt: new Date().toISOString() };

    // AgroCore — from traffic_log
    const db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS traffic_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), method TEXT, path TEXT, status INTEGER, user TEXT, ip TEXT)");
    const rows = db.prepare('SELECT ts, path, status, user, ip FROM traffic_log').all();
    const byModule = {}, byUser = {}, byIp = {}, byDay = {}, byStatus = {}, perUserMod = {};
    for (const r of rows) {
      const m = analyticsModule(r.path); byModule[m] = (byModule[m] || 0) + 1;
      const u = r.user || 'anonymous'; byUser[u] = (byUser[u] || 0) + 1;
      byIp[r.ip || '?'] = (byIp[r.ip || '?'] || 0) + 1;
      byDay[(r.ts || '').slice(0, 10)] = (byDay[(r.ts || '').slice(0, 10)] || 0) + 1;
      byStatus[String(r.status || 0)[0] + 'xx'] = (byStatus[String(r.status || 0)[0] + 'xx'] || 0) + 1;
      (perUserMod[u] = perUserMod[u] || {})[m] = (perUserMod[u][m] || 0) + 1;
    }
    // Map login emails → real names (from np_users)
    const nameMap = {};
    try { db.prepare('SELECT email, full_name FROM np_users').all().forEach(u => { nameMap[(u.email || '').toLowerCase()] = u.full_name || u.email; }); } catch (_e) {}
    const displayName = (u) => u === 'anonymous' ? 'Anonymous (public)' : u === 'api-key' ? 'API / integration' : (nameMap[(u || '').toLowerCase()] || u);
    out.agrocore = {
      total: rows.length, byModule: topN(byModule, 12),
      topUsers: topN(byUser, 12).map(([email, c]) => ({ name: displayName(email), email, count: c })),
      topIps: topN(byIp, 10), byDay: Object.entries(byDay).sort(), byStatus: Object.entries(byStatus).sort(),
      perUserModule: topN(byUser, 12).map(([email]) => ({ name: displayName(email), email, total: byUser[email], modules: Object.entries(perUserMod[email] || {}).sort((a, b) => b[1] - a[1]) })),
    };

    // Discora — best-effort cross-db read
    try {
      const dd = new Database(DISCORA_DB_PATH, { readonly: true });
      const q = (s) => { try { return dd.prepare(s).all(); } catch { return []; } };
      const daily = {}; const bump = (rs) => rs.forEach(r => { const d = (r.ts || '').slice(0, 10); if (d) daily[d] = (daily[d] || 0) + 1; });
      bump(q("SELECT created_at ts FROM posts")); bump(q("SELECT created_at ts FROM comments")); bump(q("SELECT created_at ts FROM messages"));
      const at = {
        Posts: (q("SELECT COUNT(*) c FROM posts")[0] || {}).c || 0, Comments: (q("SELECT COUNT(*) c FROM comments")[0] || {}).c || 0,
        Messages: (q("SELECT COUNT(*) c FROM messages")[0] || {}).c || 0, Endorsements: (q("SELECT COUNT(*) c FROM endorsements")[0] || {}).c || 0,
        Follows: (q("SELECT COUNT(*) c FROM follows")[0] || {}).c || 0, 'Profile views': (q("SELECT COUNT(*) c FROM profile_views")[0] || {}).c || 0,
      };
      const ua = {};
      q("SELECT u.name n, COUNT(*) c FROM posts p JOIN users u ON u.id=p.author_id GROUP BY p.author_id").forEach(r => ua[r.n] = (ua[r.n] || 0) + r.c);
      q("SELECT u.name n, COUNT(*) c FROM comments cm JOIN users u ON u.id=cm.author_id GROUP BY cm.author_id").forEach(r => ua[r.n] = (ua[r.n] || 0) + r.c);
      out.discora = { users: (q("SELECT COUNT(*) c FROM users")[0] || {}).c || 0, actionTotals: Object.entries(at), totalActions: Object.values(at).reduce((a, b) => a + b, 0), topUsers: topN(ua, 10), byDay: Object.entries(daily).sort() };
      dd.close();
    } catch (e) { out.discora = { error: e.message }; }

    // Bot — from persistent bot_registrations (name + message_count), with cost per user
    try {
      const rdb = new Database(REG_DB_PATH, { readonly: true });
      const regs = rdb.prepare('SELECT name, phone, message_count FROM bot_registrations').all();
      rdb.close();
      const clean = (n, ph) => (String(n || '').replace(/[\[\]*]/g, '').split(',')[0].trim()) || ('…' + String(ph || '').slice(-4));
      const total = regs.reduce((s, r) => s + (r.message_count || 0), 0);
      const active = regs.filter(r => (r.message_count || 0) > 0);
      out.bot = {
        totalMessages: total, uniqueUsers: regs.length, activeUsers: active.length,
        costPerMsg: BOT_COST_PER_MSG, estCostUsd: +(total * BOT_COST_PER_MSG).toFixed(2),
        byUser: active.sort((a, b) => (b.message_count || 0) - (a.message_count || 0)).slice(0, 15)
          .map(r => ({ name: clean(r.name, r.phone), phone: '…' + String(r.phone || '').slice(-4), count: r.message_count || 0, costUsd: +((r.message_count || 0) * BOT_COST_PER_MSG).toFixed(2) })),
      };
    } catch (e) { out.bot = { error: e.message }; }

    return res.json({ success: true, data: out });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Whether 2FA is currently enforced (so the login screen can show the code field).
router.get('/v1/super-admin/2fa/status', (req, res) => res.json({ success: true, enabled: totpEnabled() }));

// One-time enrolment — generate a secret to add to the authenticator app (owner-gated).
router.post('/v1/super-admin/2fa/setup', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const secret = generateTotpSecret();
  return res.json({ success: true, secret, otpauth_uri: otpauthUri(secret), already_enabled: totpEnabled() });
});

// Test a code against a candidate secret BEFORE enabling (prevents lock-out).
router.post('/v1/super-admin/2fa/verify', superAdminIpGate, (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(401).json({ success: false, error: 'Auth required' });
  const { secret, code } = req.body || {};
  return res.json({ success: true, valid: verifyTotpWith(secret, code) });
});
function encodeOwner(email) { return String(email).replace(/@/g, '_at_').replace(/\./g, '_dot_'); }
const OWNER_EMAIL_RAW = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const DB_PATH = `/var/www/nutripilot-agrocore/data/users/${encodeOwner(OWNER_EMAIL_RAW)}/nutrix.db`;
const APP_URL = process.env.APP_URL || 'https://agrocoreprime.com';
const RESET_TTL_MIN = 60;


function getContactDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS contact_sales (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    company_name TEXT,
    country TEXT,
    role TEXT,
    phone TEXT,
    message TEXT,
    interest TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT (datetime('now')),
    notes TEXT
  )`);
  return db;
}

function getDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS np_users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_name TEXT,
    company_type TEXT,
    country TEXT,
    country_tier INTEGER DEFAULT 1,
    role TEXT,
    plan_interest TEXT,
    modules_interest TEXT,
    use_case TEXT,
    expected_users INTEGER,
    heard_from TEXT,
    status TEXT DEFAULT 'pending',
    modules_granted TEXT DEFAULT '[]',
    plan_granted TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT,
    notes TEXT,
    turso_url TEXT,
    turso_token TEXT
  )`);
  // Safe migrations for existing DBs
  try { db.exec(`ALTER TABLE np_users ADD COLUMN turso_url TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE np_users ADD COLUMN turso_token TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE np_users ADD COLUMN provisioned_by TEXT`); } catch (_) {}
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  return db;
}

router.post('/v1/auth/register', async (req, res) => {
  try {
    const db = getDb();
    const { full_name, email, password, company_name, company_type,
      country, country_tier, role, plan_interest, modules_interest,
      use_case, expected_users, heard_from } = req.body;
    if (!full_name || !email || !password)
      return res.status(400).json({ success: false, error: 'Name, email and password required' });
    const existing = db.prepare('SELECT id FROM np_users WHERE email = ?').get(email.toLowerCase());
    if (existing)
      return res.status(409).json({ success: false, error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const id = 'usr_' + Date.now();
    db.prepare(`INSERT INTO np_users
      (id, full_name, email, password_hash, company_name, company_type, country, country_tier,
       role, plan_interest, modules_interest, use_case, expected_users, heard_from)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, full_name, email.toLowerCase(), hash, company_name, company_type,
      country, country_tier || 1, role, plan_interest,
      JSON.stringify(modules_interest || []), use_case, expected_users, heard_from);
    res.json({ success: true, status: 'pending' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/login', async (req, res) => {
  const loginIp = (req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
  if (!checkLoginRateLimit(loginIp)) {
    return res.status(429).json({ success: false, error: 'Too many login attempts. Please wait 15 minutes before trying again.' });
  }
  try {
    const { email, password } = req.body;
    const db = getDb();
    const user = db.prepare('SELECT * FROM np_users WHERE email = ?').get((email || '').toLowerCase().trim());
    if (!user) { logLoginEvent(email, false, loginIp, 'no such account'); return res.status(401).json({ success: false, error: 'Invalid email or password' }); }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { logLoginEvent(email, false, loginIp, 'wrong password'); return res.status(401).json({ success: false, error: 'Invalid email or password' }); }
    if (user.status === 'pending') { logLoginEvent(email, false, loginIp, 'pending'); return res.json({ success: false, status: 'pending', error: 'Account awaiting approval' }); }
    if (user.status === 'rejected') { logLoginEvent(email, false, loginIp, 'rejected'); return res.json({ success: false, status: 'rejected', error: 'Account not approved' }); }
    if (user.status === 'suspended') { logLoginEvent(email, false, loginIp, 'suspended'); return res.json({ success: false, status: 'suspended', error: 'Account suspended' }); }
    resetLoginRateLimit(loginIp);
    logLoginEvent(email, true, loginIp, 'ok');
    const token = jwt.sign(
      { id: user.id, email: user.email, full_name: user.full_name,
        modules: JSON.parse(user.modules_granted || '[]'), plan: user.plan_granted },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ success: true, token, user: {
      id: user.id, full_name: user.full_name, email: user.email,
      company_name: user.company_name, country: user.country,
      role: user.role, plan: user.plan_granted,
      modules: JSON.parse(user.modules_granted || '[]'), status: user.status
    }});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/v1/auth/me', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    // Super-admin tokens have no DB row — return as-is
    if (decoded.super_admin) return res.json({ success: true, user: decoded });
    // Return live modules + plan from DB so the client can detect changes without re-login
    const db = getDb();
    const row = db.prepare('SELECT modules_granted, plan_granted, status FROM np_users WHERE id = ?').get(decoded.id);
    db.close();
    if (!row) return res.json({ success: true, user: decoded });
    res.json({ success: true, user: {
      ...decoded,
      modules: JSON.parse(row.modules_granted || '[]'),
      plan:    row.plan_granted,
      status:  row.status,
    }});
  } catch (e) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// ── Admin routes (require admin role) ──────────────────────────────────────
function requireAdmin(req, res, next) {
  if (verifySuperAdmin(req)) { req.user = { modules: ["admin"], super_admin: true }; return next(); }
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.modules?.includes('admin')) return res.status(403).json({ success: false, error: 'Admin access required' });
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

router.get('/v1/auth/admin/users', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS traffic_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')), method TEXT, path TEXT, status INTEGER, user TEXT, ip TEXT)`);
    const registered = db.prepare(`SELECT u.id, u.full_name, u.email, u.company_name, u.company_type, u.country, u.role, u.plan_interest, u.modules_interest, u.use_case, u.expected_users, u.heard_from, u.status, u.modules_granted, u.plan_granted, u.created_at, u.approved_at, u.notes,
        (SELECT MAX(t.ts) FROM traffic_log t WHERE LOWER(t.user) = LOWER(u.email)) AS last_active,
        (SELECT COUNT(*) FROM traffic_log t WHERE LOWER(t.user) = LOWER(u.email)) AS activity_count
      FROM np_users u
      WHERE (u.provisioned_by IS NULL OR u.provisioned_by = '')
      ORDER BY u.created_at DESC`).all();

    // Also discover users who have a data directory but no np_users entry (logged in outside the registration flow)
    const DATA_USERS_ROOT = '/var/www/nutripilot-agrocore/data/users';
    const registeredEmails = new Set(registered.map(u => (u.email || '').toLowerCase()));
    const discovered = [];
    try {
      const dirs = fs.readdirSync(DATA_USERS_ROOT);
      for (const dir of dirs) {
        if (dir === 'default') continue;
        // decode directory name back to email
        const email = dir.replace(/_at_/g, '@').replace(/_dot_/g, '.');
        if (!email.includes('@')) continue; // skip non-email dirs
        if (registeredEmails.has(email.toLowerCase())) continue; // already in np_users
        // check if they have any actual data
        try {
          const udb = new Database(`${DATA_USERS_ROOT}/${dir}/nutrix.db`, { readonly: true });
          const fCount = udb.prepare(`SELECT COUNT(*) as c FROM formulas`).get()?.c || 0;
          udb.close();
          if (fCount > 0) {
            discovered.push({
              id: `dir_${dir}`,
              full_name: email.split('@')[0],
              email,
              status: 'active',
              modules_granted: '[]',
              plan_granted: null,
              created_at: null,
              approved_at: null,
              notes: `Discovered — ${fCount} formula(s) saved. Not formally registered.`,
              last_active: null,
              activity_count: 0,
            });
          }
        } catch {}
      }
    } catch {}

    res.json({ success: true, users: [...registered, ...discovered] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/admin/users/:id/approve', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { modules_granted, plan_granted, notes } = req.body;
    db.prepare(`UPDATE np_users SET status='approved', modules_granted=?, plan_granted=?, approved_at=datetime('now'), notes=? WHERE id=?`)
      .run(JSON.stringify(modules_granted || []), plan_granted || '', notes || '', req.params.id);
    invalidateUserStatus(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/admin/users/:id/reject', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { notes } = req.body;
    db.prepare(`UPDATE np_users SET status='rejected', notes=? WHERE id=?`)
      .run(notes || '', req.params.id);
    invalidateUserStatus(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/admin/users/:id/suspend', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`UPDATE np_users SET status='suspended' WHERE id=?`).run(req.params.id);
    invalidateUserStatus(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/v1/auth/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { modules_granted, plan_granted, notes } = req.body;
    db.prepare(`UPDATE np_users SET modules_granted=?, plan_granted=?, notes=? WHERE id=?`)
      .run(JSON.stringify(modules_granted || []), plan_granted || '', notes || '', req.params.id);
    invalidateUserStatus(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ── Discora-specific admin endpoints ────────────────────────────────────────
// Dedicated approval flow for Discora signups, scoped to just the 'discora' module
// so it never touches a user's status/modules for other products.
router.get('/v1/auth/admin/discora-users', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT id, full_name, email, role, status, modules_interest, modules_granted, created_at, approved_at, notes FROM np_users WHERE modules_interest LIKE '%discora%' OR modules_granted LIKE '%discora%' ORDER BY created_at DESC`).all();
    const users = rows.map(r => ({ ...r, discora_status: JSON.parse(r.modules_granted || '[]').includes('discora') ? 'approved' : 'pending' }));
    res.json({ success: true, users });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/admin/discora-users/:id/approve', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT modules_granted FROM np_users WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    const modules = JSON.parse(row.modules_granted || '[]');
    if (!modules.includes('discora')) modules.push('discora');
    db.prepare(`UPDATE np_users SET modules_granted = ? WHERE id = ?`).run(JSON.stringify(modules), req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/admin/discora-users/:id/reject', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT modules_interest, modules_granted FROM np_users WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    const interest = JSON.parse(row.modules_interest || '[]').filter(m => m !== 'discora');
    const granted = JSON.parse(row.modules_granted || '[]').filter(m => m !== 'discora');
    db.prepare(`UPDATE np_users SET modules_interest = ?, modules_granted = ? WHERE id = ?`).run(JSON.stringify(interest), JSON.stringify(granted), req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Discora.pro members (native Discora users from discora.sqlite)
router.get('/v1/auth/admin/discora-members', requireAdmin, (req, res) => {
  try {
    const dd = new Database(DISCORA_DB_PATH, { readonly: true });
    const users = dd.prepare(`SELECT id, email, name, role, title, institution, location, verified, created_at, is_admin, field_fellow, fellow_tier FROM users ORDER BY created_at DESC`).all();
    dd.close();
    res.json({ success: true, users });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Contact Sales
router.post('/v1/auth/contact-sales', async (req, res) => {
  try {
    const db = getContactDb();
    const { full_name, email, company_name, country, role, phone, message, interest } = req.body;
    if (!full_name || !email)
      return res.status(400).json({ success: false, error: 'Name and email required' });
    const id = 'cs_' + Date.now();
    db.prepare(`INSERT INTO contact_sales (id, full_name, email, company_name, country, role, phone, message, interest) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, full_name, email.toLowerCase(), company_name, country, role, phone, message, interest);
    res.json({ success: true, message: 'Thank you! Our sales team will contact you within 24 hours.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/v1/auth/admin/contact-sales', (req, res) => {
  try {
    if (!verifySuperAdmin(req))
      return res.status(403).json({ success: false, error: 'Forbidden' });
    const db = getContactDb();
    const inquiries = db.prepare(`SELECT * FROM contact_sales ORDER BY created_at DESC`).all();
    res.json({ success: true, inquiries });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Nutritionist feedback noteboard ─────────────────────────────────────────
function getFeedbackDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS np_feedback (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    full_name TEXT,
    message TEXT NOT NULL,
    page_context TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`);
  return db;
}

router.post('/v1/feedback/bot', (req, res) => {
  try {
    const secret = req.headers['x-bot-secret'];
    if (!secret || secret !== (process.env.DISCORA_BOT_SECRET || '')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });
    const phone = String(req.body?.phone || '').slice(0, 50);
    const page_context = String(req.body?.page_context || '').slice(0, 200);
    const db = getFeedbackDb();
    const id = 'fb_' + Date.now();
    db.prepare(`INSERT INTO np_feedback (id, user_email, full_name, message, page_context) VALUES (?, ?, ?, ?, ?)`)
      .run(id, phone || 'whatsapp_user', phone || null, message, page_context);
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/feedback', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });
    const page_context = String(req.body?.page_context || '').slice(0, 200);
    const db = getFeedbackDb();
    const id = 'fb_' + Date.now();
    db.prepare(`INSERT INTO np_feedback (id, user_email, full_name, message, page_context) VALUES (?, ?, ?, ?, ?)`)
      .run(id, decoded.email, decoded.full_name || null, message, page_context);
    res.json({ success: true, id });
  } catch (e) {
    res.status(401).json({ success: false, error: e.message || 'Invalid token' });
  }
});

router.get('/v1/auth/admin/feedback', (req, res) => {
  try {
    if (!verifySuperAdmin(req))
      return res.status(403).json({ success: false, error: 'Forbidden' });
    const db = getFeedbackDb();
    const feedback = db.prepare(`SELECT * FROM np_feedback ORDER BY created_at DESC`).all();
    res.json({ success: true, feedback });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ── Password recovery ───────────────────────────────────────────────────────
router.post('/v1/auth/forgot-password', async (req, res) => {
  const genericMsg = 'If an account exists for that email, a reset link has been sent.';
  try {
    const db = getDb();
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    // Super-admin email — handled by the SA reset flow (separate credential store).
    if (email === (process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com').toLowerCase()) {
      try {
        const raw = createSaResetToken();
        const link = `${APP_URL}/super-admin?reset=${raw}`;
        const subject = 'AgroCore Prime — Admin Password Reset';
        const text = `A password reset was requested for your AgroCore Prime admin account.\n\nClick the link below to set a new password. This link expires in 30 minutes.\n\n${link}\n\nIf you did not request this, ignore this email.`;
        const html = `<p>A password reset was requested for your AgroCore Prime admin account.</p><p><a href="${link}"><strong>Click here to reset your password</strong></a></p><p>This link expires in <strong>30 minutes</strong>.</p><p>If you did not request this, ignore this email.</p>`;
        await sendMail({ to: email, subject, text, html });
      } catch (saErr) { console.error('[forgot-password] super-admin reset failed:', saErr.message); }
      return res.json({ success: true, message: genericMsg });
    }

    const user = db.prepare('SELECT id, email, full_name, status FROM np_users WHERE email = ?').get(email);
    if (user && user.status !== 'rejected' && user.status !== 'suspended') {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const id = 'pr_' + Date.now();
      const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60000).toISOString();
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(user.id);
      db.prepare(`INSERT INTO password_resets (id, user_id, email, token_hash, expires_at) VALUES (?,?,?,?,?)`)
        .run(id, user.id, user.email, tokenHash, expiresAt);
      const link = `${APP_URL}/reset-password?token=${rawToken}`;
      const subject = 'Reset your AgroCore Prime password';
      const text = `Hello ${user.full_name || ''},

We received a request to reset your AgroCore Prime password.
Click the link below to choose a new password. This link expires in ${RESET_TTL_MIN} minutes.

${link}

If you did not request this, you can safely ignore this email.
`;
      const html = `<p>Hello ${user.full_name || ''},</p><p>We received a request to reset your AgroCore Prime password.</p><p><a href="${link}">Click here to choose a new password</a>. This link expires in ${RESET_TTL_MIN} minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`;
      try { await sendMail({ to: user.email, subject, text, html }); }
      catch (mailErr) { console.error('[forgot-password] email send failed:', mailErr.message); }
    }
    res.json({ success: true, message: genericMsg });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/v1/auth/reset-password', async (req, res) => {
  try {
    const db = getDb();
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ success: false, error: 'Token and new password required' });
    if (String(password).length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(tokenHash);
    if (!row || row.used_at) return res.status(400).json({ success: false, error: 'This reset link is invalid or has already been used.' });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, error: 'This reset link has expired. Please request a new one.' });
    const hash = await bcrypt.hash(String(password), 10);
    db.prepare('UPDATE np_users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
    db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(row.id);
    res.json({ success: true, message: 'Your password has been reset. You can now sign in.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Super-admin forgot/reset password ────────────────────────────────────────
const SA_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const APP_URL_SA = process.env.APP_URL || 'https://agrocoreprime.com';

router.post('/v1/super-admin/forgot-password', async (req, res) => {
  try {
    const raw = createSaResetToken();
    const link = `${APP_URL_SA}/super-admin?reset=${raw}`;
    const subject = 'AgroCore Prime — Super-Admin Password Reset';
    const text = `A password reset was requested for the AgroCore Prime super-admin account.\n\nClick the link below to set a new password. This link expires in 30 minutes.\n\n${link}\n\nIf you did not request this, ignore this email. Your password has not been changed.`;
    const html = `<p>A password reset was requested for the AgroCore Prime super-admin account.</p><p><a href="${link}"><strong>Click here to reset your password</strong></a></p><p>This link expires in <strong>30 minutes</strong>.</p><p>If you did not request this, ignore this email — your password has not been changed.</p>`;
    await sendMail({ to: SA_EMAIL, subject, text, html });
    res.json({ success: true, message: `Reset link sent to the registered super-admin email.` });
  } catch (e) {
    console.error('[sa-forgot-password]', e.message);
    res.status(500).json({ success: false, error: 'Failed to send reset email. Check server mail config.' });
  }
});

router.post('/v1/super-admin/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) return res.status(400).json({ success: false, error: 'Token and new password required.' });
    if (String(new_password).length < 10) return res.status(400).json({ success: false, error: 'Password must be at least 10 characters.' });
    const valid = verifySaResetToken(token);
    if (!valid) return res.status(400).json({ success: false, error: 'Reset link is invalid or has expired. Please request a new one.' });
    consumeSaResetToken(token);
    setSuperPassword(new_password);
    res.json({ success: true, message: 'Password updated. You can now sign in with your new password.' });
  } catch (e) {
    console.error('[sa-reset-password]', e.message);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

// ── Super Admin: Platform Users — per-user activity across Bot + Discora ──
const DISCORA_DB = '/var/www/discora-api/db/discora.sqlite';
const BOT_REG_DB = '/var/www/nutripilot-agrocore/data/registrations.db';

router.get('/v1/super-admin/platform-users', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  const result = { bot: [], discora: [] };

  // ── Bot users ──
  try {
    const db = new Database(BOT_REG_DB);
    result.bot = db.prepare(`
      SELECT name, phone, company, country, role, message_count, daily_msg_count,
             monthly_msg_count, paid_deepfix_credits, subscription_status,
             registered_at, last_seen
      FROM bot_registrations ORDER BY message_count DESC
    `).all();
    db.close();
  } catch {}

  // ── Discora per-user activity ──
  try {
    const db = new Database(DISCORA_DB);
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.title, u.institution, u.location,
             u.verified, u.reputation, u.field_fellow, u.fellow_tier, u.created_at,
             u.last_seen_at,
             COUNT(DISTINCT p.id)  AS posts,
             COUNT(DISTINCT c.id)  AS comments,
             COUNT(DISTINCT pr.id) AS reactions,
             MAX(p.created_at)     AS last_post,
             MAX(c.created_at)     AS last_comment
      FROM users u
      LEFT JOIN posts    p  ON p.author_id  = u.id
      LEFT JOIN comments c  ON c.author_id  = u.id
      LEFT JOIN post_reactions pr ON pr.user_id = u.id
      GROUP BY u.id
      ORDER BY (COUNT(DISTINCT p.id) + COUNT(DISTINCT c.id)) DESC
    `).all();
    result.discora = rows.map(r => ({
      ...r,
      last_active: [r.last_seen_at, r.last_post, r.last_comment].filter(Boolean).sort().pop() || null
    }));
    db.close();
  } catch (e) { result.discora_error = e.message; }

  res.json({ success: true, ...result });
});

// ── Super Admin: Sub-Users (all enterprise sub-accounts created via admin portal) ──
import path from 'path';
import { createRequire as _cr } from 'node:module';
const _req = _cr(import.meta.url);
const MILL_DB_PATH_SA = path.join(process.cwd(), 'data', 'mill.db');

router.get('/v1/super-admin/sub-users', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    // All enterprise/member NP users (not provisioned sub-users, not rejected)
    const AUTH_DB = DB_PATH;
    const adb = new Database(AUTH_DB);
    const npUsers = adb.prepare(`
      SELECT full_name, email, plan_granted, modules_granted, status, created_at
      FROM np_users
      WHERE (provisioned_by IS NULL OR provisioned_by = '') AND status != 'rejected'
      ORDER BY created_at ASC
    `).all();
    adb.close();

    // All sub-users from admin portal
    const db = new Database(MILL_DB_PATH_SA);
    try { db.exec('ALTER TABLE admin_users ADD COLUMN created_ip TEXT'); } catch {}
    try { db.exec('ALTER TABLE admin_users ADD COLUMN created_by_jwt TEXT'); } catch {}
    const allSubs = db.prepare(`
      SELECT id, name, email, role, status, modules, owner_email,
             created_by, created_by_jwt, created_ip, created_at, updated_at
      FROM admin_users ORDER BY created_at DESC
    `).all().map(u => ({ ...u, modules: u.modules ? JSON.parse(u.modules) : [] }));
    db.close();

    const npEmails = new Set(npUsers.map(u => u.email));

    // Group sub-users under their NP user
    const groups = npUsers.map(np => ({
      np_user: {
        name: np.full_name,
        email: np.email,
        plan: np.plan_granted,
        modules: np.modules_granted ? JSON.parse(np.modules_granted) : [],
        status: np.status,
        created_at: np.created_at
      },
      sub_users: allSubs.filter(su => su.owner_email === np.email)
    }));

    // Sub-users whose owner_email doesn't match any NP user (legacy/orphan)
    const unowned = allSubs.filter(su => !su.owner_email || !npEmails.has(su.owner_email));

    res.json({ success: true, groups, unowned, total_sub_users: allSubs.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Super Admin: Module Traffic — per-user × module breakdown with timestamps ──
function moduleOfPath(p) {
  if (/^\/v1\/(analyze|optimize|nutrix-ai|formulas|prices|multimix|nutrix|enzyme|batch-analysis|copilot|ingredient|raw-material|lab|quality)/.test(p)) return 'Nutrix';
  if (p.startsWith('/v1/mill')) return 'Mill IQ';
  if (p.startsWith('/api/farmpulse') || p.startsWith('/v1/farm')) return 'Farm Pulse';
  if (/^\/v1\/(purchase|raw-materials|price-lists|suppliers|exchange-rates|vendorpulse)/.test(p)) return 'VendorPulse';
  if (p.startsWith('/v1/admin')) return 'Admin';
  if (p.startsWith('/v1/auth')) return 'Auth';
  if (p.startsWith('/v1/lite')) return 'Nutrix Lite';
  if (p.startsWith('/v1/super-admin')) return 'Super Admin';
  return 'Other';
}

router.get('/v1/super-admin/module-traffic', (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    const days = Number(req.query.days || 30);
    const db = getDb();
    const rows = db.prepare(`
      SELECT user, path, COUNT(*) as count, MIN(ts) as first_seen, MAX(ts) as last_seen
      FROM traffic_log
      WHERE ts >= datetime('now', ? || ' days')
        AND user IS NOT NULL AND user NOT IN ('', 'anonymous', 'api-key')
      GROUP BY user, path
      ORDER BY last_seen DESC
      LIMIT 2000
    `).all(`-${days}`);

    // Group by user × module
    const map = {};
    for (const r of rows) {
      const mod = moduleOfPath(r.path);
      const key = `${r.user}|||${mod}`;
      if (!map[key]) map[key] = { user: r.user, module: mod, requests: 0, first_seen: r.first_seen, last_seen: r.last_seen };
      map[key].requests += r.count;
      if (r.first_seen < map[key].first_seen) map[key].first_seen = r.first_seen;
      if (r.last_seen > map[key].last_seen) map[key].last_seen = r.last_seen;
    }

    // Enrich with user display names from np_users
    const adb = getDb();
    const nameMap = {};
    try { adb.prepare('SELECT email, full_name FROM np_users').all().forEach(u => { nameMap[u.email.toLowerCase()] = u.full_name; }); } catch {}

    const data = Object.values(map)
      .map(r => ({ ...r, name: nameMap[r.user.toLowerCase()] || r.user }))
      .sort((a, b) => (b.last_seen > a.last_seen ? 1 : -1));

    // Module summary
    const modSummary = {};
    for (const r of data) { modSummary[r.module] = (modSummary[r.module] || 0) + r.requests; }

    res.json({ success: true, data, mod_summary: Object.entries(modSummary).sort((a,b)=>b[1]-a[1]).map(([module,count])=>({module,count})) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Turso BYOD: save credentials ─────────────────────────────────────────────
import { encrypt, decrypt, getTursoClient } from '../../../core/db/turso/turso.adapter.js';

router.post('/v1/auth/turso', async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const turso_url   = (req.body.turso_url   || '').trim();
    const turso_token = (req.body.turso_token || '').trim();

    // Basic URL format check (client-side already does this, belt-and-suspenders)
    if (turso_url && !turso_url.startsWith('libsql://')) {
      return res.status(400).json({ success: false, error: 'Invalid URL format. The URL must start with libsql:// (not https://).' });
    }

    // Note: we intentionally skip a live connection probe here.
    // The server may not be able to reach turso.io (firewall/outbound restrictions),
    // which would make valid credentials appear invalid. Errors surface on first real use.

    const db = getDb();
    const encUrl   = turso_url   ? encrypt(turso_url)   : null;
    const encToken = turso_token ? encrypt(turso_token) : null;
    db.prepare(`UPDATE np_users SET turso_url=?, turso_token=? WHERE email=?`)
      .run(encUrl, encToken, userEmail.toLowerCase());

    res.json({ success: true, message: turso_url ? 'Turso database connected.' : 'Turso database disconnected.' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Turso BYOD: get connection status (no token returned) ─────────────────────
router.get('/v1/auth/turso', (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const db  = getDb();
    const row = db.prepare(`SELECT turso_url FROM np_users WHERE email=?`).get(userEmail.toLowerCase());
    const url = row?.turso_url ? decrypt(row.turso_url) : null;

    res.json({ success: true, connected: !!url, turso_url: url ? maskUrl(url) : null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch (_) { return url.slice(0, 30) + '...'; }
}

// ── Turso BYOD: auto-provision a database via Platform API ────────────────────
router.post('/v1/auth/turso/provision', async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const org           = process.env.TURSO_ORG;
    const platformToken = process.env.TURSO_PLATFORM_TOKEN;
    if (!org || !platformToken) {
      return res.status(503).json({ success: false, error: 'Auto-provisioning is not configured on this server.' });
    }

    // Check if already connected — don't create duplicates
    const db  = getDb();
    const existing = db.prepare(`SELECT turso_url FROM np_users WHERE email=?`).get(userEmail.toLowerCase());
    if (existing?.turso_url) {
      return res.status(409).json({ success: false, error: 'A private database is already connected to this account.' });
    }

    // Build a safe, unique DB name from email
    const safeName = 'np-' + userEmail
      .replace(/@.*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 24)
      .replace(/-+$/, '');
    const dbName = safeName + '-' + Date.now().toString(36);

    // 1. Create the database
    const createRes = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/databases`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${platformToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: dbName, group: 'default' }),
      }
    );
    if (!createRes.ok) {
      const err = await createRes.text();
      return res.status(502).json({ success: false, error: `Turso create failed: ${err}` });
    }
    const createData = await createRes.json();
    const hostname   = createData.database?.Hostname;
    if (!hostname) return res.status(502).json({ success: false, error: 'Turso did not return a hostname.' });
    const turso_url = `libsql://${hostname}`;

    // 2. Create an auth token for this database
    const tokenRes = await fetch(
      `https://api.turso.tech/v1/organizations/${org}/databases/${dbName}/auth/tokens`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${platformToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expiration: 'never' }),
      }
    );
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(502).json({ success: false, error: `Turso token creation failed: ${err}` });
    }
    const tokenData  = await tokenRes.json();
    const turso_token = tokenData.jwt;
    if (!turso_token) return res.status(502).json({ success: false, error: 'Turso did not return a token.' });

    // 3. Verify connectivity
    try {
      const { getTursoClient } = await import('../../../core/db/turso/turso.adapter.js');
      const client = getTursoClient(turso_url, turso_token);
      await client.execute('SELECT 1');
    } catch (e) {
      return res.status(502).json({ success: false, error: 'Database created but connection test failed: ' + e.message });
    }

    // 4. Store encrypted credentials
    const encUrl   = encrypt(turso_url);
    const encToken = encrypt(turso_token);
    db.prepare(`UPDATE np_users SET turso_url=?, turso_token=? WHERE email=?`)
      .run(encUrl, encToken, userEmail.toLowerCase());

    res.json({ success: true, turso_url: maskUrl(turso_url), message: 'Private database created and connected.' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Discora Field Fellows proxy — key never goes to the browser ───────────────
const DISCORA_BASE = 'https://api.discora.pro/fellow';
function discoraHeaders() {
  const key = process.env.DISCORA_SA_KEY;
  if (!key) throw new Error('DISCORA_SA_KEY not configured');
  return { 'X-SA-Key': key, 'Content-Type': 'application/json' };
}

router.get('/v1/super-admin/fellows', superAdminIpGate, async (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    const r = await fetch(`${DISCORA_BASE}/sa/applications`, { headers: discoraHeaders() });
    const j = await r.json();
    res.json(j);
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

router.post('/v1/super-admin/fellows/:id/approve', superAdminIpGate, async (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    const r = await fetch(`${DISCORA_BASE}/sa/applications/${req.params.id}/approve`, { method: 'POST', headers: discoraHeaders() });
    const j = await r.json();
    res.json(j);
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

router.post('/v1/super-admin/fellows/:id/reject', superAdminIpGate, async (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    const r = await fetch(`${DISCORA_BASE}/sa/applications/${req.params.id}/reject`, { method: 'POST', headers: discoraHeaders() });
    const j = await r.json();
    res.json(j);
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

router.post('/v1/super-admin/fellows/announce', superAdminIpGate, async (req, res) => {
  if (!verifySuperAdmin(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
  try {
    const r = await fetch(`${DISCORA_BASE}/sa/announce`, { method: 'POST', headers: discoraHeaders() });
    const j = await r.json();
    res.json(j);
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

export default router;