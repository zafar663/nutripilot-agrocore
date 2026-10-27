// Admin-only API-key management: create / list / revoke keys for external consumers.
import express from 'express';
import { createRequire } from 'node:module';
import { ensureApiKeysTable, hashApiKey, keysDb } from '../middleware/api-key.middleware.js';
import { verifySuperAdmin } from '../middleware/super-admin.mw.js';

const require = createRequire(import.meta.url);
const { randomUUID } = require('crypto');
const router = express.Router();
const ok  = (r, d) => r.json({ ok: true, data: d });
const err = (r, e, s = 500) => r.status(s).json({ ok: false, error: e.message || String(e) });

// API licenses are OWNER-controlled — only a valid Super-Admin token (server-issued) may manage them.
router.use((req, res, next) => {
  if (verifySuperAdmin(req)) return next();
  return res.status(401).json({ ok: false, error: 'Super-admin (owner) authentication required to manage API licenses' });
});

// List keys (never returns the secret) with expiry status.
router.get('/', (req, res) => {
  try {
    const d = keysDb(); ensureApiKeysTable(d);
    const now = Date.now();
    const rows = d.prepare(`SELECT id, name, prefix, scopes, plant_ids, rate_per_min, plan, max_users, expires_at, enabled, created_by, created_at, last_used, revoked_at
      FROM api_keys ORDER BY created_at DESC`).all()
      .map(r => {
        const expMs = r.expires_at ? new Date(r.expires_at).getTime() : null;
        const days_to_expiry = expMs != null ? Math.ceil((expMs - now) / 86400000) : null;
        return {
          ...r, scopes: JSON.parse(r.scopes || '[]'), plant_ids: JSON.parse(r.plant_ids || '[]'),
          days_to_expiry,
          expired: expMs != null && expMs < now,
          expiring_soon: days_to_expiry != null && days_to_expiry <= 30 && days_to_expiry >= 0,
          active: r.enabled === 1 && !r.revoked_at && !(expMs != null && expMs < now),
        };
      });
    d.close();
    ok(res, rows);
  } catch (e) { err(res, e); }
});

// Create a key — returns the plaintext ONCE (we only store the hash).
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const d = keysDb(); ensureApiKeysTable(d);
    const id = randomUUID();
    const key = 'nx_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
    const prefix = key.slice(0, 12) + '…';
    // Default a 1-year licence if no expiry supplied.
    const expires_at = b.expires_at || new Date(Date.now() + 365 * 86400000).toISOString();
    d.prepare(`INSERT INTO api_keys (id, name, key_hash, prefix, scopes, plant_ids, rate_per_min, plan, max_users, expires_at, enabled, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(
      id, b.name || 'API key', hashApiKey(key), prefix,
      JSON.stringify(Array.isArray(b.scopes) ? b.scopes : []),
      JSON.stringify(Array.isArray(b.plant_ids) ? b.plant_ids : []),
      Number(b.rate_per_min) || 60, b.plan || null,
      (b.max_users != null && b.max_users !== '') ? Number(b.max_users) : null,
      expires_at, b.created_by || 'admin', new Date().toISOString());
    d.close();
    ok(res, { id, api_key: key, prefix, expires_at, note: 'Copy this key now — it is shown only once.' });
  } catch (e) { err(res, e); }
});

// Revoke a key.
router.patch('/:id/revoke', (req, res) => {
  try {
    const d = keysDb(); ensureApiKeysTable(d);
    const r = d.prepare("UPDATE api_keys SET revoked_at = ?, enabled = 0 WHERE id = ?").run(new Date().toISOString(), req.params.id);
    d.close();
    if (!r.changes) return err(res, new Error('Key not found'), 404);
    ok(res, { revoked: true });
  } catch (e) { err(res, e); }
});

export default router;
