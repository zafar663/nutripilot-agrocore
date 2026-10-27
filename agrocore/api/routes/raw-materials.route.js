// ============================================================
// NutriPilot — Raw Materials Route
// Manages user's master ingredient list with their own codes
// nutripilot-agrocore/agrocore/api/routes/raw-materials.route.js
// ============================================================
import express from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require    = createRequire(import.meta.url);
const __dirname  = dirname(fileURLToPath(import.meta.url));
const Database   = require('better-sqlite3');
const { randomUUID } = require('crypto');

const router = express.Router();

function getDb() {
  const path = require('path').join(process.cwd(), 'data', 'mill.db');
  return new Database(path);
}

const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// ── Auto-generate ingredient code ────────────────────────────
function generateCode(ingredientName, existingCodes = []) {
  // Generate from first letters of words e.g. "Corn, Grain (Average)" → "CGA001"
  const words = ingredientName
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  
  let prefix = words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
  if (prefix.length < 2) prefix = ingredientName.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
  
  let counter = 1;
  let code = `${prefix}${String(counter).padStart(3, '0')}`;
  while (existingCodes.includes(code)) {
    counter++;
    code = `${prefix}${String(counter).padStart(3, '0')}`;
  }
  return code;
}

// ── GET /v1/raw-materials — list all raw materials ────────────
router.get('/', (req, res) => {
  try {
    const { mill_id, active } = req.query;
    const db = getDb();
    let query = 'SELECT * FROM raw_materials WHERE 1=1';
    const params = [];
    if (mill_id) { query += ' AND mill_id = ?'; params.push(mill_id); }
    if (active !== 'false') { query += ' AND is_active = 1'; }
    query += ' ORDER BY ingredient_name ASC';
    const rows = db.prepare(query).all(...params);
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ── POST /v1/raw-materials — add ingredient to raw materials ──
router.post('/', (req, res) => {
  try {
    const { mill_id, ingredient_id, ingredient_name, ingredient_code, category, notes, created_by } = req.body;
    if (!ingredient_id || !ingredient_name) return err(res, new Error('ingredient_id and ingredient_name required'), 400);

    const db = getDb();
    
    // Check if already exists — return existing record (cross-species reuse)
    const existing = db.prepare('SELECT * FROM raw_materials WHERE mill_id = ? AND ingredient_id = ?').get(mill_id || null, ingredient_id);
    if (existing) {
      db.close();
      return ok(res, existing);
    }

    // Auto-generate code if not provided
    let code = ingredient_code || null;
    if (code) {
      const codeExists = db.prepare('SELECT id FROM raw_materials WHERE mill_id = ? AND ingredient_code = ?').get(mill_id || null, code);
      if (codeExists) {
        db.close();
        return err(res, new Error(`Code ${code} already in use`), 409);
      }
    }

    const id  = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO raw_materials (id, mill_id, ingredient_id, ingredient_name, ingredient_code, category, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, mill_id || null, ingredient_id, ingredient_name, code, category || null, notes || null, created_by || 'nutritionist', now, now);

    const saved = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(id);
    db.close();
    ok(res, saved);
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/raw-materials/:id/code — update ingredient code ─
router.patch('/:id/code', (req, res) => {
  try {
    const { ingredient_code, updated_by, changed_by, admin_override = false } = req.body;
    if (!ingredient_code) return err(res, new Error('ingredient_code required'), 400);

    const db = getDb();
    const row = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Raw material not found'), 404);

    // Check if locked
    if (row.code_locked && !admin_override && changed_by !== 'nutritionist' && changed_by !== row.created_by) {
      return err(res, new Error(`Code ${row.ingredient_code} is locked. Contact master admin to change.`), 403);
    }

    // Check uniqueness
    const codeExists = db.prepare('SELECT id FROM raw_materials WHERE mill_id = ? AND ingredient_code = ? AND id != ?').get(row.mill_id, ingredient_code, req.params.id);
    if (codeExists) {
      db.close();
      return err(res, new Error(`Code ${ingredient_code} already in use`), 409);
    }

    const now = new Date().toISOString();
    // Build audit log
    const existingLog = row.code_change_log ? JSON.parse(row.code_change_log) : [];
    existingLog.push({
      old_code:    row.ingredient_code,
      new_code:    ingredient_code,
      changed_by:  updated_by || 'nutritionist',
      changed_at:  now,
      admin_override
    });

    db.prepare(`
      UPDATE raw_materials
      SET ingredient_code = ?, code_changed_by = ?, code_changed_at = ?,
          code_change_log = ?, updated_at = ?
      WHERE id = ?
    `).run(ingredient_code, updated_by || 'nutritionist', now, JSON.stringify(existingLog), now, req.params.id);

    const updated = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
    db.close();
    ok(res, updated);
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/raw-materials/:id/lock — lock/unlock code (admin only)
router.patch('/:id/lock', (req, res) => {
  try {
    const { lock, reason, admin_user } = req.body;
    const db = getDb();
    const row = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Raw material not found'), 404);

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE raw_materials
      SET code_locked = ?, code_locked_at = ?, code_locked_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(lock ? 1 : 0, lock ? now : null, reason || null, now, req.params.id);

    const updated = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
    db.close();
    ok(res, { ...updated, message: lock ? `Code ${row.ingredient_code} locked` : `Code ${row.ingredient_code} unlocked` });
  } catch(e) { err(res, e); }
});

// ── DELETE /v1/raw-materials/:id — deactivate ─────────────────
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE raw_materials SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), req.params.id);
    db.close();
    ok(res, { id: req.params.id, is_active: false });
  } catch(e) { err(res, e); }
});

// ── GET /v1/raw-materials/code/:ingredient_id — get code for ingredient
router.get('/code/:ingredient_id', (req, res) => {
  try {
    const { mill_id } = req.query;
    const db = getDb();
    const row = db.prepare('SELECT * FROM raw_materials WHERE ingredient_id = ? AND mill_id = ?')
      .get(req.params.ingredient_id, mill_id || null);
    db.close();
    if (!row) return err(res, new Error('Not found'), 404);
    ok(res, row);
  } catch(e) { err(res, e); }
});

// ── POST /v1/raw-materials/:id/use — auto-lock on first use in PO/batch
router.post('/:id/use', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Not found'), 404);
    if (!row.code_locked) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE raw_materials SET code_locked=1, code_locked_at=?, code_locked_reason=? WHERE id=?`)
        .run(now, 'Auto-locked on first use', req.params.id);
    }
    db.close();
    ok(res, { locked: true });
  } catch(e) { err(res, e); }
});

export default router;