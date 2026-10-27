'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');
const { hideMillManagerPrices, applyPricesToBatch } = require('./mill.price.service.cjs');
const { siloSpeciesConflict } = require('./mill.share.service.cjs');
const { getInboundPulse } = require('../../db/mill/mill.db.cjs');
const { getAllMills } = require('./mill.config.service.cjs');
const { preBatchStockCheck, getInventorySnapshot } = require('./mill.inventory.service.cjs');
const { getMoneyLeakSummary } = require('./mill.deviation.service.cjs');

function ensureFloorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mill_flush_log (
      id TEXT PRIMARY KEY,
      mill_id TEXT NOT NULL,
      from_batch_id TEXT,
      to_batch_id TEXT,
      from_species TEXT,
      to_species TEXT,
      flush_required INTEGER DEFAULT 0,
      flush_done INTEGER DEFAULT 0,
      signed_by TEXT,
      signed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mill_haccp_signoff (
      id TEXT PRIMARY KEY,
      mill_id TEXT NOT NULL,
      batch_id TEXT,
      ccp TEXT NOT NULL,
      passed INTEGER DEFAULT 0,
      signed_by TEXT,
      signed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mill_process_qc (
      id TEXT PRIMARY KEY,
      mill_id TEXT NOT NULL,
      batch_id TEXT,
      grind_size_mm REAL,
      conditioner_temp REAL,
      pellet_temp REAL,
      pdi_pct REAL,
      kwh_per_ton REAL,
      notes TEXT,
      recorded_at TEXT DEFAULT (datetime('now'))
    );
  `);
  for (const [table, col, def] of [
    ['mill_batch_ingredients', 'lot_number', 'TEXT'],
    ['mill_batch_ingredients', 'silo_bin', 'TEXT'],
    ['mill_dispatch_records', 'lot_numbers', 'TEXT'],
    ['mill_weighbridge_receipts', 'lot_number', 'TEXT'],
    ['mill_weighbridge_receipts', 'photo_path', 'TEXT'],
    ['mill_weighbridge_receipts', 'photo_data', 'TEXT'],
    ['mill_weighbridge_receipts', 'gate_status', 'TEXT'],
    ['mill_weighbridge_receipts', 'gate_missing', 'TEXT'],
    ['mill_weighbridge_receipts', 'gate_override_by', 'TEXT'],
    ['mill_weighbridge_receipts', 'gate_override_reason', 'TEXT'],
  ]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (_e) {}
  }
}

function speciesOf(batchId) {
  const db = getMillDb();
  const row = db.prepare(`
    SELECT s.species, s.feed_type, b.id, b.mill_id, b.batch_number
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batchId);
  return row || null;
}

function assertFlushAllowsStart(mill_id, next_batch_id) {
  const db = getMillDb();
  ensureFloorSchema(db);
  const next = speciesOf(next_batch_id);
  const prev = db.prepare(`
    SELECT b.id, s.species, s.feed_type
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ? AND b.id != ? AND b.status IN ('completed','reviewed','dispatched','in_progress')
    ORDER BY COALESCE(b.completed_at, b.updated_at) DESC LIMIT 1
  `).get(mill_id, next_batch_id);
  if (!prev || !next) return { ok: true, flush_required: false };
  const from = String(prev.species || prev.feed_type || '').toLowerCase();
  const to = String(next.species || next.feed_type || '').toLowerCase();
  const medicated = /medicat|coccidi|antibiotic/.test(from + to);
  const speciesChange = from && to && from !== to;
  const flush_required = !!(speciesChange || medicated);
  const siloClash = siloSpeciesConflict(mill_id, next.species || next.feed_type);
  if (siloClash.length && !flush_required) {
    return {
      ok: false,
      error: `Bin leftover from another species (${siloClash.map(s => s.bin).join(', ')}). Flush or empty those bins first.`,
      flush_required: true,
      silos: siloClash,
    };
  }
  if (!flush_required) return { ok: true, flush_required: false };
  const done = db.prepare(
    `SELECT * FROM mill_flush_log WHERE mill_id = ? AND to_batch_id = ? AND flush_done = 1`
  ).get(mill_id, next_batch_id);
  if (done) return { ok: true, flush_required: true, flush_done: true };
  return {
    ok: false,
    error: `Flush required (${from || 'previous'} → ${to || 'next'}). Sign flush before this batch.`,
    flush_required: true
  };
}

function signFlush({ mill_id, to_batch_id, signed_by, notes }) {
  const db = getMillDb();
  ensureFloorSchema(db);
  const next = speciesOf(to_batch_id);
  const prev = db.prepare(`
    SELECT b.id, s.species FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ? AND b.id != ? ORDER BY COALESCE(b.completed_at, b.updated_at) DESC LIMIT 1
  `).get(mill_id, to_batch_id);
  db.prepare(`
    INSERT INTO mill_flush_log (id, mill_id, from_batch_id, to_batch_id, from_species, to_species, flush_required, flush_done, signed_by, signed_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, datetime('now'), ?)
  `).run(randomUUID(), mill_id, prev?.id || null, to_batch_id, prev?.species || null, next?.species || null, signed_by || 'mill-operator', notes || null);
  return { ok: true };
}

function defaultCcps() {
  return [
    { ccp: 'magnet_check', label: 'Magnet / tramp metal' },
    { ccp: 'scale_zero', label: 'Scale zero / calibration sticker' },
    { ccp: 'flush', label: 'Flush / sequencing' },
    { ccp: 'retained_sample', label: 'Retained sample taken' },
    { ccp: 'pellet_temp', label: 'Pellet / mash temperature in range' },
  ];
}

function getHaccpPack(mill_id, batch_id) {
  const db = getMillDb();
  ensureFloorSchema(db);
  const signs = batch_id
    ? db.prepare('SELECT * FROM mill_haccp_signoff WHERE mill_id = ? AND batch_id = ?').all(mill_id, batch_id)
    : [];
  const by = new Map(signs.map(s => [s.ccp, s]));
  return {
    ok: true,
    mill_id,
    batch_id,
    ccps: defaultCcps().map(c => ({ ...c, signoff: by.get(c.ccp) || null })),
  };
}

function signHaccp({ mill_id, batch_id, ccp, passed, signed_by, notes }) {
  const db = getMillDb();
  ensureFloorSchema(db);
  db.prepare(`
    INSERT INTO mill_haccp_signoff (id, mill_id, batch_id, ccp, passed, signed_by, signed_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(randomUUID(), mill_id, batch_id || null, ccp, passed ? 1 : 0, signed_by || 'mill-operator', notes || null);
  return { ok: true };
}

function recordProcessQc(body) {
  const db = getMillDb();
  ensureFloorSchema(db);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO mill_process_qc (id, mill_id, batch_id, grind_size_mm, conditioner_temp, pellet_temp, pdi_pct, kwh_per_ton, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.mill_id, body.batch_id || null,
    body.grind_size_mm ?? null, body.conditioner_temp ?? null, body.pellet_temp ?? null,
    body.pdi_pct ?? null, body.kwh_per_ton ?? null, body.notes || null
  );
  return { ok: true, id };
}

function getProcessQc(mill_id, batch_id) {
  const db = getMillDb();
  ensureFloorSchema(db);
  const rows = batch_id
    ? db.prepare('SELECT * FROM mill_process_qc WHERE mill_id = ? AND batch_id = ? ORDER BY recorded_at DESC').all(mill_id, batch_id)
    : db.prepare('SELECT * FROM mill_process_qc WHERE mill_id = ? ORDER BY recorded_at DESC LIMIT 40').all(mill_id);
  return { ok: true, rows };
}

function productionReadiness(mill_id) {
  const db = getMillDb();
  const snaps = db.prepare(`
    SELECT s.id, s.formula_name, s.species, s.feed_type, s.formula_json
    FROM mill_formula_snapshots s
    JOIN mill_batches b ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ?
    GROUP BY s.id
    ORDER BY MAX(b.created_at) DESC
    LIMIT 20
  `).all(mill_id);
  const stock = getInventorySnapshot(mill_id);
  const stockMap = new Map();
  for (const i of (stock.ingredients || [])) {
    stockMap.set(String(i.ingredient_id || '').toLowerCase(), Number(i.current_stock || 0));
    stockMap.set(String(i.ingredient_name || '').toLowerCase(), Number(i.current_stock || 0));
  }
  const formulas = snaps.map(s => {
    let ings = [];
    try {
      const j = typeof s.formula_json === 'string' ? JSON.parse(s.formula_json) : (s.formula_json || {});
      ings = j.ingredients || j.rows || j.actuals || [];
    } catch (_e) {}
    let limiting = null;
    let maxMass = Infinity;
    for (const ing of ings) {
      const id = ing.ingredient_id || ing.code || ing.id;
      const name = ing.ingredient_name || ing.name;
      const need = Number(ing.planned_kg || ing.kg || ing.actual_kg || 0);
      if (!need) continue;
      const have = stockMap.get(String(id || '').toLowerCase())
        ?? stockMap.get(String(name || '').toLowerCase())
        ?? 0;
      const possible = have / need;
      if (possible < maxMass) {
        maxMass = possible;
        limiting = { name: name || id, have, need };
      }
    }
    const max_batches = Number.isFinite(maxMass) ? Math.floor(maxMass * 100) / 100 : null;
    return {
      snapshot_id: s.id,
      formula_name: s.formula_name,
      species: s.species,
      limiting_ingredient: limiting?.name || null,
      max_producible_batches: max_batches,
      status: max_batches == null ? 'unknown' : max_batches >= 1 ? 'ready' : 'short',
    };
  });
  return hideMillManagerPrices({ ok: true, mill_id, formulas });
}

function massBalance(mill_id, period = 'day', date = null) {
  const { getMillMassBalance } = require('./mill.report.service.cjs');
  return hideMillManagerPrices(getMillMassBalance(mill_id, period || 'day', date || null));
}

function pedigree(batch_id) {
  applyPricesToBatch(batch_id);
  const db = getMillDb();
  ensureFloorSchema(db);
  const { getBatchPassport } = require('./mill.report.service.cjs');
  const pass = getBatchPassport(batch_id);
  const ings = db.prepare('SELECT ingredient_id, ingredient_name, planned_kg, actual_kg, lot_number, silo_bin, deviation_pct, cost_impact, deviation_flag FROM mill_batch_ingredients WHERE batch_id = ?').all(batch_id);
  const lots = db.prepare(`
    SELECT lot_number, ingredient_name, supplier_name, received_date, storage_bin
    FROM mill_supplier_lots WHERE ingredient_id IN (
      SELECT ingredient_id FROM mill_batch_ingredients WHERE batch_id = ?
    )
    ORDER BY received_date DESC LIMIT 40
  `).all(batch_id);
  const process = db.prepare('SELECT * FROM mill_process_qc WHERE batch_id = ? ORDER BY recorded_at DESC').all(batch_id);
  const haccp = db.prepare('SELECT * FROM mill_haccp_signoff WHERE batch_id = ?').all(batch_id);
  const flush = db.prepare('SELECT * FROM mill_flush_log WHERE to_batch_id = ?').all(batch_id);
  return hideMillManagerPrices({
    ...pass,
    ingredients: ings,
    supplier_lots: lots,
    process_qc: process,
    haccp,
    flush,
    farm_loop: {
      note: 'Link dispatch.farm_id to Farm Pulse flock to close FCR vs mill deviation.',
      dispatch: pass.dispatches || pass.dispatch || [],
    },
  });
}

function operatorQueue(mill_id) {
  const db = getMillDb();
  const rows = db.prepare(`
    SELECT b.id, b.batch_number, b.status, b.priority, s.formula_name, s.species,
           b.planned_qty_tons, b.notes
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ? AND b.status IN ('pending','confirmed','in_progress')
    ORDER BY b.priority DESC, b.created_at ASC
  `).all(mill_id);
  return { ok: true, mill_id, batches: rows };
}

function groupLive(owner) {
  const mills = getAllMills(true, owner);
  const list = (mills.mills || []).map(m => {
    const leak = (() => {
      try { return getMoneyLeakSummary(m.id); } catch (_e) { return {}; }
    })();
    const pulse = getInboundPulse(m.id);
    return {
      mill_id: m.id,
      name: m.mill_name,
      mill_name: m.mill_name,
      mill_code: m.mill_code,
      mill_edge: pulse,
      health: pulse.last_ok_at ? 'edge live' : (pulse.last_fail_at ? 'edge error' : 'idle'),
      batch_count: leak.batch_count || 0,
      flags: leak.total_flags || 0,
      deviation_cost: leak.total_deviation_cost || 0,
    };
  });
  return hideMillManagerPrices({ ok: true, mills: list });
}

module.exports = {
  ensureFloorSchema,
  assertFlushAllowsStart,
  signFlush,
  getHaccpPack,
  signHaccp,
  recordProcessQc,
  getProcessQc,
  productionReadiness,
  massBalance,
  pedigree,
  operatorQueue,
  groupLive,
  hideMillManagerPrices,
};
