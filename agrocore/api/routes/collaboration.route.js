// agrocore/api/routes/collaboration.route.js
// Real-time collaboration: share formulas, list collaborators

import express from 'express';
import { getNutrixDb } from '../../../core/db/nutrix/nutrix.db.js';
import { randomUUID } from 'crypto';

const router = express.Router();

function getUser(req) {
  return req.nutrixUser || 'default';
}

// POST /v1/formulas/:id/share  — share with another user or open to all
router.post('/formulas/:id/share', (req, res) => {
  try {
    const db = getNutrixDb(getUser(req));
    const formulaId = req.params.id;
    const { shared_with, permission = 'view' } = req.body || {};

    if (!['view', 'edit'].includes(permission)) {
      return res.status(400).json({ ok: false, error: "permission must be 'view' or 'edit'" });
    }

    const formula = db.prepare('SELECT id FROM formulas WHERE id = ?').get(formulaId);
    if (!formula) return res.status(404).json({ ok: false, error: 'Formula not found' });

    const id = randomUUID();
    db.prepare(`
      INSERT INTO shared_formulas (id, formula_id, shared_by, shared_with, permission)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, formulaId, getUser(req), shared_with || null, permission);

    res.json({ ok: true, share_id: id, formula_id: formulaId, permission });
  } catch (e) {
    console.error('[Collab] share error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /v1/formulas/:id/share  — list all shares for a formula
router.get('/formulas/:id/share', (req, res) => {
  try {
    const db = getNutrixDb(getUser(req));
    const rows = db.prepare('SELECT * FROM shared_formulas WHERE formula_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /v1/formulas/:id/share/:shareId  — revoke a share
router.delete('/formulas/:id/share/:shareId', (req, res) => {
  try {
    const db = getNutrixDb(getUser(req));
    db.prepare('DELETE FROM shared_formulas WHERE id = ? AND formula_id = ?').run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /v1/shared-formulas — formulas shared with the current user
router.get('/shared-formulas', (req, res) => {
  try {
    const user = getUser(req);
    const db = getNutrixDb(user);
    const rows = db.prepare(`
      SELECT sf.*, f.formula_name, f.species, f.type, f.phase, f.status, f.updated_at
      FROM shared_formulas sf
      JOIN formulas f ON sf.formula_id = f.id
      WHERE sf.shared_with = ? OR sf.shared_with IS NULL
      ORDER BY sf.created_at DESC
    `).all(user);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
