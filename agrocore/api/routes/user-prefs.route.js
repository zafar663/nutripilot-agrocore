import express from 'express';
import { getUserMillDb } from '../../../core/db/turso/turso.adapter.js';

const router = express.Router();

const SCHEMA = `CREATE TABLE IF NOT EXISTS user_preferences (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  pref_key   TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(username, pref_key)
)`;

// GET /v1/user-prefs?key=<pref_key>
router.get('/', async (req, res) => {
  try {
    const db  = getUserMillDb(req);
    await db.exec(SCHEMA);
    const key = String(req.query.key || '');
    if (!key) return res.status(400).json({ ok: false, error: 'key required' });
    const user = String(req.nutrixUser || 'default');
    const row = await db.get(
      'SELECT value_json, updated_at FROM user_preferences WHERE username=? AND pref_key=?',
      [user, key]
    );
    res.json({ ok: true, value: row ? JSON.parse(row.value_json) : null, updated_at: row?.updated_at || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /v1/user-prefs?key=<pref_key>  body: { value: any }
router.put('/', async (req, res) => {
  try {
    const db  = getUserMillDb(req);
    await db.exec(SCHEMA);
    const key = String(req.query.key || req.body?.key || '');
    if (!key) return res.status(400).json({ ok: false, error: 'key required' });
    const { value } = req.body || {};
    if (value === undefined) return res.status(400).json({ ok: false, error: 'value required' });
    const username   = String(req.nutrixUser || 'default');
    const id         = `${username}__${key}`;
    const updated_at = new Date().toISOString();
    await db.run(`
      INSERT INTO user_preferences (id, username, pref_key, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username, pref_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `, [id, username, key, JSON.stringify(value), updated_at]);
    res.json({ ok: true, updated_at });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
