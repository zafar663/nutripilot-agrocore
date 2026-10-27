'use strict';

const { randomUUID } = require('crypto');
const { getMillDb } = require('../../db/mill/mill.db.cjs');

const LOCK_LIMITS = {
  aflatoxin_ppb: 20,
  don_ppb: 1000,
  ochratoxin_ppb: 5,
  zearalenone_ppb: 100,
  moisture_pct: 18
};

function ensureLotLockSchema(db) {
  for (const [col, def] of [
    ['aflatoxin_ppb', 'REAL'],
    ['don_ppb', 'REAL'],
    ['ochratoxin_ppb', 'REAL'],
    ['zearalenone_ppb', 'REAL'],
    ['lock_status', 'TEXT'],
    ['lock_reason', 'TEXT'],
    ['locked_at', 'TEXT'],
    ['locked_by', 'TEXT'],
    ['lab_cp', 'REAL'],
    ['lab_me', 'REAL']
  ]) {
    try { db.exec(`ALTER TABLE mill_supplier_lots ADD COLUMN ${col} ${def}`); } catch (_e) {}
  }
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function evaluateLotLock(lot) {
  const reasons = [];
  const a = Number(lot.aflatoxin_ppb);
  const don = Number(lot.don_ppb);
  const och = Number(lot.ochratoxin_ppb);
  const zea = Number(lot.zearalenone_ppb);
  const moist = Number(lot.moisture_pct);
  if (Number.isFinite(a) && a > LOCK_LIMITS.aflatoxin_ppb) {
    reasons.push(`aflatoxin ${a} ppb > ${LOCK_LIMITS.aflatoxin_ppb}`);
  }
  if (Number.isFinite(don) && don > LOCK_LIMITS.don_ppb) {
    reasons.push(`DON ${don} ppb > ${LOCK_LIMITS.don_ppb}`);
  }
  if (Number.isFinite(och) && och > LOCK_LIMITS.ochratoxin_ppb) {
    reasons.push(`ochratoxin ${och} ppb > ${LOCK_LIMITS.ochratoxin_ppb}`);
  }
  if (Number.isFinite(zea) && zea > LOCK_LIMITS.zearalenone_ppb) {
    reasons.push(`ZEA ${zea} ppb > ${LOCK_LIMITS.zearalenone_ppb}`);
  }
  if (Number.isFinite(moist) && moist > LOCK_LIMITS.moisture_pct) {
    reasons.push(`moisture ${moist}% > ${LOCK_LIMITS.moisture_pct}%`);
  }
  const qc = String(lot.qc_status || '').toLowerCase();
  if (qc === 'rejected' || qc === 'quarantine') reasons.push(`CoA ${qc}`);
  return {
    locked: reasons.length > 0,
    reasons,
    lock_reason: reasons.join('; ')
  };
}

function snapshotIngredients(snap) {
  let raw = snap?.formula_json;
  try { raw = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_e) { raw = {}; }
  const list = raw?.ingredients || raw?.rows || raw?.actuals || [];
  return Array.isArray(list) ? list : [];
}

function ingredientMatch(line, ingredientId, ingredientName) {
  const id = norm(ingredientId);
  const name = norm(ingredientName);
  const lid = norm(line.ingredient_id || line.code || line.id);
  const lname = norm(line.ingredient_name || line.name);
  return (id && (lid === id || lname === id)) || (name && (lname === name || lid === name));
}

function formulasUsingIngredient(mill_id, ingredientId, ingredientName) {
  const db = getMillDb();
  const snaps = db.prepare(`
    SELECT s.*
    FROM mill_formula_snapshots s
    JOIN mill_batches b ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ?
    GROUP BY s.id
    ORDER BY s.released_at DESC
  `).all(mill_id);
  const extra = db.prepare('SELECT * FROM mill_formula_snapshots ORDER BY released_at DESC LIMIT 80').all();
  const seen = new Set();
  const out = [];
  for (const s of [...snaps, ...extra]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const lines = snapshotIngredients(s);
    if (lines.some(l => ingredientMatch(l, ingredientId, ingredientName))) {
      out.push({
        snapshot_id: s.id,
        formula_id: s.formula_id,
        formula_name: s.formula_name,
        formula_version: s.formula_version,
        species: s.species,
        released_at: s.released_at
      });
    }
  }
  return out;
}

function applyCoAToLot(body = {}) {
  const db = getMillDb();
  ensureLotLockSchema(db);
  const mill_id = body.mill_id;
  const lot_number = String(body.lot_number || '').trim();
  const ingredient_name = String(body.ingredient_name || body.ingredient_id || '').trim();
  if (!mill_id || !lot_number || !ingredient_name) {
    return { ok: false, error: 'mill_id, lot_number and ingredient_name are required' };
  }

  let lot = db.prepare(`
    SELECT * FROM mill_supplier_lots
    WHERE mill_id = ? AND lower(lot_number) = lower(?)
    ORDER BY received_date DESC LIMIT 1
  `).get(mill_id, lot_number);

  if (!lot) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO mill_supplier_lots (
        id, mill_id, supplier_id, supplier_name, ingredient_id, ingredient_name,
        lot_number, received_date, quantity_kg, qc_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      id, mill_id,
      body.supplier_name || 'lab',
      body.supplier_name || 'lab',
      body.ingredient_id || ingredient_name,
      ingredient_name,
      lot_number,
      body.received_date || new Date().toISOString().slice(0, 10),
      Number(body.quantity_kg || 0)
    );
    lot = db.prepare('SELECT * FROM mill_supplier_lots WHERE id = ?').get(id);
  }

  const next = {
    ...lot,
    aflatoxin_ppb: body.aflatoxin_ppb != null ? Number(body.aflatoxin_ppb) : lot.aflatoxin_ppb,
    don_ppb: body.don_ppb != null ? Number(body.don_ppb) : lot.don_ppb,
    ochratoxin_ppb: body.ochratoxin_ppb != null ? Number(body.ochratoxin_ppb) : lot.ochratoxin_ppb,
    zearalenone_ppb: body.zearalenone_ppb != null ? Number(body.zearalenone_ppb) : lot.zearalenone_ppb,
    moisture_pct: body.moisture_pct != null ? Number(body.moisture_pct) : lot.moisture_pct,
    protein_pct: body.protein_pct != null ? Number(body.protein_pct) : lot.protein_pct,
    lab_cp: body.lab_cp != null ? Number(body.lab_cp) : (body.protein_pct != null ? Number(body.protein_pct) : lot.lab_cp),
    lab_me: body.lab_me != null ? Number(body.lab_me) : lot.lab_me,
    qc_status: body.qc_status || lot.qc_status
  };
  const verdict = evaluateLotLock(next);
  const lock_status = verdict.locked ? 'locked' : 'open';
  db.prepare(`
    UPDATE mill_supplier_lots SET
      aflatoxin_ppb = ?, don_ppb = ?, ochratoxin_ppb = ?, zearalenone_ppb = ?,
      moisture_pct = ?, protein_pct = ?, lab_cp = ?, lab_me = ?,
      qc_status = ?, lock_status = ?, lock_reason = ?,
      locked_at = ?, locked_by = ?, qc_notes = ?
    WHERE id = ?
  `).run(
    next.aflatoxin_ppb, next.don_ppb, next.ochratoxin_ppb, next.zearalenone_ppb,
    next.moisture_pct, next.protein_pct, next.lab_cp, next.lab_me,
    verdict.locked ? (next.qc_status === 'accepted' ? 'quarantine' : next.qc_status) : (next.qc_status || 'accepted'),
    lock_status,
    verdict.lock_reason || null,
    verdict.locked ? new Date().toISOString() : null,
    verdict.locked ? (body.locked_by || body.received_by || 'coa') : null,
    verdict.lock_reason || lot.qc_notes || null,
    lot.id
  );
  const saved = db.prepare('SELECT * FROM mill_supplier_lots WHERE id = ?').get(lot.id);
  const formulas = formulasUsingIngredient(mill_id, saved.ingredient_id, saved.ingredient_name);
  return {
    ok: true,
    lot: saved,
    locked: verdict.locked,
    lock_reason: verdict.lock_reason,
    limits: LOCK_LIMITS,
    formulas
  };
}

function listLotLocks(mill_id) {
  const db = getMillDb();
  ensureLotLockSchema(db);
  const lots = db.prepare(`
    SELECT * FROM mill_supplier_lots
    WHERE mill_id = ?
    ORDER BY CASE WHEN lock_status = 'locked' THEN 0 ELSE 1 END, received_date DESC
  `).all(mill_id);
  const locked = lots.filter(l => l.lock_status === 'locked' || l.qc_status === 'rejected' || l.qc_status === 'quarantine');
  return {
    ok: true,
    mill_id,
    limits: LOCK_LIMITS,
    locked_count: locked.length,
    lots: lots.map(l => ({
      ...l,
      locked: l.lock_status === 'locked' || l.qc_status === 'rejected' || l.qc_status === 'quarantine',
      formulas: (l.lock_status === 'locked')
        ? formulasUsingIngredient(mill_id, l.ingredient_id, l.ingredient_name)
        : []
    }))
  };
}

function unlockLot({ lot_id, by, reason }) {
  const db = getMillDb();
  ensureLotLockSchema(db);
  const lot = db.prepare('SELECT * FROM mill_supplier_lots WHERE id = ?').get(lot_id);
  if (!lot) return { ok: false, error: 'Lot not found' };
  if (!String(reason || '').trim()) return { ok: false, error: 'Unlock reason is required' };
  db.prepare(`
    UPDATE mill_supplier_lots SET
      lock_status = 'open',
      qc_status = CASE WHEN qc_status IN ('rejected','quarantine') THEN 'accepted' ELSE qc_status END,
      lock_reason = ?,
      locked_at = NULL,
      locked_by = ?,
      qc_notes = ?
    WHERE id = ?
  `).run(`Unlocked by ${by || 'manager'}: ${reason}`, by || 'manager', `Unlocked: ${reason}`, lot_id);
  return { ok: true, lot_id, locked: false };
}

function isLotLocked(mill_id, lot_number, ingredient_id) {
  if (!lot_number && !ingredient_id) return { locked: false };
  const db = getMillDb();
  ensureLotLockSchema(db);
  if (lot_number) {
    const lot = db.prepare(`
      SELECT * FROM mill_supplier_lots
      WHERE mill_id = ? AND lower(lot_number) = lower(?)
      ORDER BY received_date DESC LIMIT 1
    `).get(mill_id, String(lot_number));
    if (lot && (lot.lock_status === 'locked' || lot.qc_status === 'rejected' || lot.qc_status === 'quarantine')) {
      return { locked: true, lot, reason: lot.lock_reason || `Lot ${lot.lot_number} is locked` };
    }
  }
  if (ingredient_id) {
    const locked = db.prepare(`
      SELECT * FROM mill_supplier_lots
      WHERE mill_id = ? AND (lower(ingredient_id) = lower(?) OR lower(ingredient_name) = lower(?))
        AND (lock_status = 'locked' OR qc_status IN ('rejected','quarantine'))
    `).all(mill_id, ingredient_id, ingredient_id);
    const open = db.prepare(`
      SELECT COUNT(*) as n FROM mill_supplier_lots
      WHERE mill_id = ? AND (lower(ingredient_id) = lower(?) OR lower(ingredient_name) = lower(?))
        AND IFNULL(lock_status,'open') != 'locked'
        AND IFNULL(qc_status,'pending') NOT IN ('rejected','quarantine')
    `).get(mill_id, ingredient_id, ingredient_id);
    if (locked.length && !(open?.n > 0)) {
      return {
        locked: true,
        lot: locked[0],
        reason: `${locked[0].ingredient_name} has no usable lot — ${locked[0].lock_reason || 'locked by CoA'}`
      };
    }
  }
  return { locked: false };
}

function assertLotsUsable(mill_id, items = []) {
  for (const item of items) {
    const check = isLotLocked(mill_id, item.lot_number, item.ingredient_id || item.ingredient_name);
    if (check.locked) {
      return { ok: false, error: check.reason, lot: check.lot };
    }
  }
  return { ok: true };
}

function assertBatchLotsUsable(batch_id, extraItems = []) {
  const db = getMillDb();
  const batch = db.prepare('SELECT mill_id FROM mill_batches WHERE id = ?').get(batch_id);
  if (!batch) return { ok: false, error: 'Batch not found' };
  const rows = db.prepare(`
    SELECT ingredient_id, ingredient_name, lot_number
    FROM mill_batch_ingredients WHERE batch_id = ?
  `).all(batch_id);
  return assertLotsUsable(batch.mill_id, [...rows, ...extraItems]);
}

function rewriteFormulasForLock({ mill_id, lot_id, mode = 'exclude', by }) {
  const db = getMillDb();
  ensureLotLockSchema(db);
  const lot = db.prepare('SELECT * FROM mill_supplier_lots WHERE id = ?').get(lot_id);
  if (!lot) return { ok: false, error: 'Lot not found' };
  if (lot.lock_status !== 'locked' && lot.qc_status !== 'rejected' && lot.qc_status !== 'quarantine') {
    return { ok: false, error: 'Lot is not locked — nothing to rewrite' };
  }

  const { createFormulaSnapshot } = require('./mill.batch.service.cjs');
  const snaps = db.prepare('SELECT * FROM mill_formula_snapshots ORDER BY released_at DESC LIMIT 80').all();
  const created = [];
  for (const s of snaps) {
    const json = (() => {
      try { return typeof s.formula_json === 'string' ? JSON.parse(s.formula_json) : (s.formula_json || {}); }
      catch (_e) { return {}; }
    })();
    const key = json.ingredients ? 'ingredients' : json.rows ? 'rows' : json.actuals ? 'actuals' : null;
    if (!key || !Array.isArray(json[key])) continue;
    const already = String(s.formula_version || '').includes('-LOCK')
      && String(s.formula_name || '').includes(lot.lot_number);
    if (already) continue;
    const hit = json[key].some(l => ingredientMatch(l, lot.ingredient_id, lot.ingredient_name));
    if (!hit) continue;

    const next = { ...json };
    if (mode === 'apply_coa') {
      next[key] = json[key].map(l => {
        if (!ingredientMatch(l, lot.ingredient_id, lot.ingredient_name)) return l;
        return {
          ...l,
          lot_number: lot.lot_number,
          lab_cp: lot.lab_cp || lot.protein_pct,
          lab_moisture: lot.moisture_pct,
          lock_note: lot.lock_reason,
          max_inclusion: 0,
          inclusion_pct: 0,
          inclusion: 0
        };
      });
    } else {
      next[key] = json[key].filter(l => !ingredientMatch(l, lot.ingredient_id, lot.ingredient_name));
    }
    next.lot_lock = {
      lot_number: lot.lot_number,
      ingredient_name: lot.ingredient_name,
      reason: lot.lock_reason,
      mode,
      at: new Date().toISOString()
    };

    const snap = createFormulaSnapshot({
      formula_id: s.formula_id,
      formula_version: `${s.formula_version || '1'}-LOCK`,
      formula_name: `${s.formula_name} (lot lock ${lot.lot_number})`,
      species: s.species,
      feed_type: s.feed_type,
      released_by: by || 'lot-lock',
      released_at: new Date().toISOString(),
      formula_json: next,
      cost_per_ton: s.cost_per_ton,
      nutrients_json: s.nutrients_json ? (() => {
        try { return JSON.parse(s.nutrients_json); } catch (_e) { return null; }
      })() : null
    });
    created.push({
      snapshot_id: snap.snapshot_id,
      from: s.formula_name,
      version: `${s.formula_version || '1'}-LOCK`
    });
  }

  return {
    ok: true,
    lot_id: lot.id,
    lot_number: lot.lot_number,
    mode,
    rewritten: created.length,
    snapshots: created
  };
}

module.exports = {
  LOCK_LIMITS,
  ensureLotLockSchema,
  evaluateLotLock,
  applyCoAToLot,
  listLotLocks,
  unlockLot,
  isLotLocked,
  assertLotsUsable,
  assertBatchLotsUsable,
  rewriteFormulasForLock,
  formulasUsingIngredient
};
