import express from 'express';
import { getUserMillDb } from '../../../core/db/turso/turso.adapter.js';
import { learn } from '../lib/learn-hook.js';

const router = express.Router();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS premix_library (
  username     TEXT PRIMARY KEY,
  library_json TEXT NOT NULL DEFAULT '[]',
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS premix_saved (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  premix_json  TEXT NOT NULL,
  saved_at     TEXT NOT NULL
)`;

const ok  = (res, data) => res.json({ ok: true, ...data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// GET /v1/premix/library  — load user's raw-material library
router.get('/library', async (req, res) => {
  try {
    const db = getUserMillDb(req);
    await db.exec(SCHEMA);
    const username = String(req.nutrixUser || 'default');
    const row = await db.get('SELECT library_json FROM premix_library WHERE username=?', [username]);
    return ok(res, { library: row ? JSON.parse(row.library_json) : [] });
  } catch (e) { return err(res, e); }
});

// PUT /v1/premix/library  — replace entire library (upsert)
router.put('/library', async (req, res) => {
  try {
    const { library } = req.body || {};
    if (!Array.isArray(library)) return err(res, new Error('library must be an array'), 400);
    const db         = getUserMillDb(req);
    await db.exec(SCHEMA);
    const username   = String(req.nutrixUser || 'default');
    const updated_at = new Date().toISOString();
    await db.run(`
      INSERT INTO premix_library (username, library_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET library_json=excluded.library_json, updated_at=excluded.updated_at
    `, [username, JSON.stringify(library), updated_at]);
    return ok(res, { updated_at });
  } catch (e) { return err(res, e); }
});

// GET /v1/premix/saved  — list all saved premixes for user (newest first)
router.get('/saved', async (req, res) => {
  try {
    const db       = getUserMillDb(req);
    await db.exec(SCHEMA);
    const username = String(req.nutrixUser || 'default');
    const rows     = await db.all('SELECT premix_json FROM premix_saved WHERE username=? ORDER BY saved_at DESC', [username]);
    return ok(res, { saved: rows.map(r => JSON.parse(r.premix_json)) });
  } catch (e) { return err(res, e); }
});

// POST /v1/premix/saved  — upsert a saved premix
router.post('/saved', async (req, res) => {
  try {
    const premix   = req.body || {};
    if (!premix.id) premix.id = 'pmx_' + Date.now();
    const db       = getUserMillDb(req);
    await db.exec(SCHEMA);
    const username = String(req.nutrixUser || 'default');
    const saved_at = premix.savedAt || new Date().toISOString();
    await db.run(`
      INSERT INTO premix_saved (id, username, premix_json, saved_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET premix_json=excluded.premix_json, saved_at=excluded.saved_at
    `, [premix.id, username, JSON.stringify(premix), saved_at]);
    learn({
      source: 'nutrix', kind: 'premix_save', user_id: username,
      species: premix.species || premix.speciesKey || null,
      title: `Premix ${premix.name || premix.premixName || premix.id}`,
      text: JSON.stringify({ name: premix.name, code: premix.code, cost: premix.cost }).slice(0, 2000),
      metadata: { id: premix.id }
    });
    return ok(res, { premix });
  } catch (e) { return err(res, e); }
});

// DELETE /v1/premix/saved/:id  — delete a saved premix
router.delete('/saved/:id', async (req, res) => {
  try {
    const db       = getUserMillDb(req);
    const username = String(req.nutrixUser || 'default');
    const result   = await db.run('DELETE FROM premix_saved WHERE id=? AND username=?', [req.params.id, username]);
    if (result.changes === 0) return err(res, new Error('Premix not found'), 404);
    return ok(res, { deleted: true });
  } catch (e) { return err(res, e); }
});

export default router;
