// Additive API-key boundary for external/third-party consumers.
// - Validates x-api-key when present; rejects invalid/revoked keys (401).
// - Enforces a per-key sliding-window rate limit (429).
// - Passes through when NO x-api-key is present, so the first-party app is unaffected.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const path = require('path');
const { createHash } = require('crypto');

export function keysDb() { return new Database(path.join(process.cwd(), 'data', 'mill.db')); }
export function ensureApiKeysTable(d) {
  d.prepare(`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, name TEXT, key_hash TEXT, prefix TEXT,
    scopes TEXT, plant_ids TEXT, rate_per_min INTEGER DEFAULT 60,
    plan TEXT, max_users INTEGER, expires_at TEXT,
    enabled INTEGER DEFAULT 1, created_by TEXT, created_at TEXT, last_used TEXT, revoked_at TEXT
  )`).run();
  // Add columns to a pre-existing table.
  for (const col of ['plan TEXT', 'max_users INTEGER', 'expires_at TEXT']) {
    try { d.prepare(`ALTER TABLE api_keys ADD COLUMN ${col}`).run(); } catch (_e) { /* exists */ }
  }
}
export function hashApiKey(k) { return createHash('sha256').update(String(k)).digest('hex'); }

// In-memory per-key fixed-window limiter (resets each minute).
const buckets = new Map();
function rateOk(id, limit) {
  const now = Date.now(), win = 60000;
  let b = buckets.get(id);
  if (!b || now - b.start >= win) { b = { start: now, count: 0 }; buckets.set(id, b); }
  b.count++;
  return b.count <= (Number(limit) || 60);
}

export function apiKeyGate(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return next(); // first-party app path — unaffected
  try {
    const d = keysDb(); ensureApiKeysTable(d);
    const row = d.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1 AND revoked_at IS NULL").get(hashApiKey(key));
    if (row) d.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    d.close();
    if (!row) return res.status(401).json({ ok: false, error: 'Invalid or revoked API key' });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ ok: false, error: 'API license expired — contact your provider to renew' });
    }
    if (!rateOk(row.id, row.rate_per_min)) return res.status(429).json({ ok: false, error: 'Rate limit exceeded — slow down' });
    req.apiKey = { id: row.id, name: row.name, scopes: JSON.parse(row.scopes || '[]'), plant_ids: JSON.parse(row.plant_ids || '[]') };
    res.setHeader('X-RateLimit-Limit', String(row.rate_per_min || 60));
    next();
  } catch (_e) { return res.status(500).json({ ok: false, error: 'API key check failed' }); }
}

/** Strict variant for endpoints reserved for external consumers — REQUIRES a valid key. */
export function requireApiKey(req, res, next) {
  if (!req.headers['x-api-key']) return res.status(401).json({ ok: false, error: 'API key required (x-api-key header)' });
  return apiKeyGate(req, res, next);
}
