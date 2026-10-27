// Global authentication boundary for the product API.
// Requires a valid login JWT (or a valid external API-license key) for every product
// endpoint. A small allow-list keeps genuinely public surfaces open:
//   - login / register / password recovery / contact-sales (landing page)
//   - health / runtime / requirements options
//   - Nutrix Lite case URLs (token-in-URL); creating cases requires the Nutrix Lite module
//   - the super-admin console (which has its own password + 2FA + IP gate)
// Everything else (formulation, mill, farmpulse, prices, AI, admin, …) returns 401 to
// anonymous callers. On top of that this gate now also enforces:
//   - LIVE user status (a suspended/rejected user is booted immediately, even mid-session)
//   - per-endpoint module locks for endpoints not otherwise behind requireModule().
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { createRequire } from 'module';
import { getTursoClient, decrypt } from '../../../core/db/turso/turso.adapter.js';
import { accountAccessState, revokePayload } from '../lib/account-access.js';

const { normalizeEmail, encodeUsername } = createRequire(import.meta.url)('../../../core/lib/normalize-email.cjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('[auth-gate] JWT_SECRET env var is required — refusing to start');
function _encOwner(e) { return encodeUsername(e); }
const _ownerEmail = process.env.SUPER_ADMIN_EMAIL || 'feednutritionmillconsulting@gmail.com';
const DB_PATH = process.env.NUTRIX_DB_PATH || `/var/www/nutripilot-agrocore/data/users/${_encOwner(_ownerEmail)}/nutrix.db`;

const PUBLIC_EXACT = new Set([
  '/v1/health',
  '/v1/requirements/options',
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/forgot-password',
  '/v1/auth/reset-password',
  '/v1/auth/contact-sales',
  '/v1/auth/request-trial',
  '/v1/billing/checkout',
  '/v1/billing/extra-seat',
  '/v1/billing/geo',
  '/v1/billing/webhook',
]);

const PUBLIC_PREFIX = [
  '/v1/billing/invoice',
  '/v1/super-admin',    // self-protected: server-side password + TOTP 2FA + IP allow-list
  '/v1/translate',      // landing-page language switcher
  '/v1/registrations',  // public bot / waitlist signup
  '/v1/exchange-rates', // public pricing display
  '/v1/requirements/lookup',       // read-only reference data, used by feedbot
  '/api/farmpulse/nutrient-library',    // read-only breed nutrient standards, used by feedbot
  '/api/farmpulse/breed-standards',     // read-only breed performance standards, used by feedbot
  '/v1/diet-intent',                    // diet intent parser — used by feedbot and web chat
  '/v1/inbound/batch',
  '/v1/inbound/feed-analysis',
  '/v1/inbound/weighbridge',
  '/v1/inbound/dispatch',
  '/v1/inbound/ping',
  '/v1/inbound/process',
  '/v1/intelligence/learn',
];

// Every product route is locked to its module here so access is airtight at the
// API level — not just hidden in the UI.  JWT modules are server-signed and cannot
// be forged or edited client-side.  'admin' module implicitly passes all checks.
const MODULE_PREFIX = [
  // ── NutriX — Formulation, Optimisation, Ingredients, Prices, AI ─────────
  { pre: '/v1/analyze',                 module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/optimize',                module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/nutrix-ai',               module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/nutrix',                  module: 'nutrix' },
  { pre: '/v1/formulas',                module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/shared-formulas',         module: 'nutrix' },
  { pre: '/v1/ingredients',             module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/custom-ingredient-dbs',   module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/raw-materials',           module: 'nutrix' },
  { pre: '/v1/ingredient-intelligence', module: 'nutrix' },
  { pre: '/v1/intelligence',            module: 'nutrix' },
  { pre: '/v1/prices',                  module: 'nutrix' },
  { pre: '/v1/multimix',                module: 'nutrix' },
  { pre: '/v1/batching',                module: 'nutrix' },
  { pre: '/v1/batch-analysis',          module: 'nutrix' },
  { pre: '/v1/copilot',                 module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/enzyme-curves',           module: 'nutrix' },
  { pre: '/v1/qc',                      module: 'nutrix' },
  { pre: '/v1/ingest',                  module: 'nutrix' },
  { pre: '/v1/table-export',            module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/table-import-preview',    module: 'nutrix', also: ['nutrixlite'] },
  { pre: '/v1/lite',                    module: 'nutrixlite' },
  // ── VendorPulse — Procurement, Purchase Orders, Price Lists ─────────────
  { pre: '/v1/purchase-orders',         module: 'vendorpulse' },
  { pre: '/v1/price-lists',             module: 'vendorpulse' },
];
const MODULE_ALIASES = { formulation: 'nutrix', prices: 'nutrix', lab: 'nutrix', 'feed-mill': 'milliq', purchaser: 'vendorpulse', 'farm-pulse': 'farmpulse' };

function isLocalReq(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  return ip.includes('127.0.0.1') || ip === '::1' || ip.includes('::ffff:127.0.0.1');
}

function isPublic(p, req) {
  if (PUBLIC_EXACT.has(p)) return true;
  if (p === '/v1/lite/health') return true;
  // Shared Lite links stay token-gated (no login). Creating cases requires the Nutrix Lite module.
  if (/^\/v1\/lite\/cases\/[^/]+\/[^/]+/.test(p)) return true;
  if (p === '/v1/lite/cases' && req?.method === 'POST' && isLocalReq(req)) return true;
  return PUBLIC_PREFIX.some(pre => p === pre || p.startsWith(pre + '/'));
}
function requiredModuleHit(p) {
  return MODULE_PREFIX.find(m => p === m.pre || p.startsWith(m.pre + '/')) || null;
}

// ── Live user data cache (status + modules), refreshed every 15 s ────────────
// Single DB read per user per 15 s covers both suspension and module changes.
// This means super-admin module grants/revocations take effect within 15 seconds
// for every active session — no re-login required.
const userCache = new Map();     // id -> { status, modules, ts }
const STATUS_TTL_MS = 15000;

function liveUserData(userId) {
  if (!userId) return { error: true };
  const c = userCache.get(userId);
  if (c && (Date.now() - c.ts) < STATUS_TTL_MS) return c;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    let row;
    try {
      row = db.prepare('SELECT status, modules_granted, module_access, turso_url, turso_token, provisioned_by FROM np_users WHERE id = ?').get(userId);
    } catch (_col) {
      row = db.prepare('SELECT status, modules_granted, turso_url, turso_token, provisioned_by FROM np_users WHERE id = ?').get(userId);
    }
    db.close();
    if (!row) {
      const missing = { missing: true, ts: Date.now() };
      userCache.set(userId, missing);
      return missing;
    }
    let modules = [];
    try { modules = JSON.parse(row.modules_granted || '[]'); } catch { modules = []; }
    const data = {
      status:          row.status,
      modules,
      module_access:   row.module_access || '{}',
      turso_url:       row.turso_url  || null,
      turso_token:     row.turso_token || null,
      provisioned_by:  (row.provisioned_by || '').toLowerCase() || null,
      ts:              Date.now(),
    };
    userCache.set(userId, data);
    return data;
  } catch (_e) { return { error: true }; }
}

function bearerOrDownloadToken(req) {
  const hdr = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (hdr) return hdr;
  const p = String(req.path || req.url || "");
  if (p.includes("/edge-kit/")) {
    const q = req.query?.access_token || req.query?.token;
    if (q) return String(q);
  }
  const cookie = String(req.headers.cookie || "");
  const m = cookie.match(/(?:^|;\s*)np_auth_token=([^;]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  return "";
}

export function authGate(req, res, next) {
  if (req.apiKey) return next();
  if (req.method === "OPTIONS") return next();
  if (isPublic(req.path, req)) return next();

  const token = bearerOrDownloadToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Authentication required" });

  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (_e) {
    return res.status(401).json({ ok: false, success: false, revoke: true, account_status: 'expired', error: 'Invalid or expired session' });
  }
  req.user = user;

  // Lock the per-user DB identity to the JWT-verified email so no client-supplied
  // header can redirect requests to another user's data. Super-admins may still
  // pass x-nutrix-user to inspect any user's workspace.
  const isSuper = user.super_admin === true;
  if (isSuper && req.headers['x-nutrix-user']) {
    req.nutrixUser = normalizeEmail(req.headers['x-nutrix-user']) || req.headers['x-nutrix-user'];
  } else {
    req.nutrixUser = normalizeEmail(user.email) || null;
  }

  // Attach Turso client if the user has configured their own database (BYOD)
  if (!isSuper && user.email) {
    const tursoInfo = liveUserData(user.id);
    if (tursoInfo?.turso_url && tursoInfo?.turso_token) {
      try {
        const url   = decrypt(tursoInfo.turso_url);
        const token = decrypt(tursoInfo.turso_token);
        if (url && token) req.tursoClient = getTursoClient(url, token);
      } catch (_) {}
    }
  }

  if (!isSuper && user.id) {
    const live = liveUserData(user.id);
    if (live?.error) {
      // Infra failure — do not lock everyone out.
    } else if (live?.missing) {
      return res.status(401).json(revokePayload({ reason: 'inactive', error: 'Your account is no longer active. Contact the administrator.' }));
    } else if (live) {
      const state = accountAccessState(live.status, live.modules, live.module_access);
      if (state.blocked) return res.status(401).json(revokePayload(state));
      user.modules = state.modules;
      user.status = live.status;
      req.workspaceOwner = live.provisioned_by || req.nutrixUser;
    }
  }
  if (!req.workspaceOwner) req.workspaceOwner = req.nutrixUser;

  // Per-endpoint module lock (reads user.modules which is now live from DB above).
  const hit = requiredModuleHit(req.path);
  if (hit && !isSuper) {
    const mods = (Array.isArray(user.modules) ? user.modules : []).map(k => MODULE_ALIASES[k] || k);
    const allowed = [hit.module, ...(hit.also || [])];
    if (!mods.includes('admin') && !allowed.some(m => mods.includes(m))) {
      return res.status(403).json({ ok: false, error: `Your subscription does not include the "${hit.module}" module.`, module: hit.module });
    }
  }

  return next();
}

// Call this after any status or module change so the next request sees it immediately
// (rather than waiting up to 15 s for the cache to expire).
export function invalidateUserStatus(userId) { if (userId) userCache.delete(userId); }
