// ============================================================
// Feed Mill Intelligence Engine â€” Batch Service
// nutripilot-agrocore/core/services/mill/mill.batch.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { lookupIngredientPrice } = require('./mill.price.service.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ CREATE FORMULA SNAPSHOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called when nutritionist releases formula from NutriPilot
// Freezes the formula version at release time â€” immutable audit record
function createFormulaSnapshot({
  formula_id,
  formula_version,
  formula_name,
  species,
  feed_type,
  released_by,
  released_at,
  formula_json,       // full formula object from NutriPilot
  cost_per_ton,
  nutrients_json      // expected nutrient profile
}) {
  const db = getMillDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO mill_formula_snapshots (
      id, formula_id, formula_version, formula_name,
      species, feed_type, released_by, released_at,
      formula_json, cost_per_ton, nutrients_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    formula_id,
    formula_version,
    formula_name,
    species || null,
    feed_type || null,
    released_by,
    released_at,
    typeof formula_json === 'string' ? formula_json : JSON.stringify(formula_json),
    cost_per_ton || null,
    nutrients_json ? JSON.stringify(nutrients_json) : null
  );

  console.log(`[MillBatch] Formula snapshot created: ${id}`);
  return { ok: true, snapshot_id: id };
}

// â”€â”€ CREATE BATCH JOB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Auto-created when formula is released to mill
// Status starts as 'pending' â€” mill manager confirms to start
function createBatch({
  mill_id,
  formula_snapshot_id,
  planned_qty_tons,
  priority = 1,
  connector_source = 'manual_entry',
  operator_id = null,
  notes = null
}) {
  const db = getMillDb();
  const id = randomUUID();

  // Generate human-readable batch number: MILL-YYYYMMDD-XXXX
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const short = id.slice(0, 4).toUpperCase();
  const batch_number = `BATCH-${today}-${short}`;

  db.prepare(`
    INSERT INTO mill_batches (
      id, mill_id, formula_snapshot_id, batch_number,
      planned_qty_tons, status, priority,
      connector_source, operator_id, notes
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    id,
    mill_id,
    formula_snapshot_id,
    batch_number,
    planned_qty_tons,
    priority,
    connector_source,
    operator_id,
    notes
  );

  console.log(`[MillBatch] Batch created: ${batch_number}`);
  return { ok: true, batch_id: id, batch_number };
}

// â”€â”€ ADD PLANNED INGREDIENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Populates planned_kg from formula snapshot for each ingredient
function addBatchIngredients(batch_id, ingredients) {
  const db = getMillDb();
  const millRow = db.prepare('SELECT mill_id FROM mill_batches WHERE id = ?').get(batch_id);
  const millId = millRow?.mill_id || null;

  const insert = db.prepare(`
    INSERT INTO mill_batch_ingredients (
      id, batch_id, ingredient_id, ingredient_name,
      planned_kg, cost_per_kg, planned_cost, lot_number, silo_bin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const ing of items) {
      const costPerKg = ing.cost_per_kg || lookupIngredientPrice(db, millId, ing.ingredient_id, ing.ingredient_name) || null;
      insert.run(
        randomUUID(),
        batch_id,
        ing.ingredient_id,
        ing.ingredient_name,
        ing.planned_kg,
        costPerKg,
        costPerKg ? ing.planned_kg * costPerKg : null,
        ing.lot_number || null,
        ing.silo_bin || null
      );
    }
  });

  insertMany(ingredients);
  console.log(`[MillBatch] ${ingredients.length} ingredients added to batch ${batch_id}`);
  return { ok: true, count: ingredients.length };
}

// â”€â”€ UPDATE BATCH STATUS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateBatchStatus(batch_id, status) {
  const db = getMillDb();

  const validStatuses = [
    'pending', 'confirmed', 'in_progress',
    'completed', 'reviewed', 'dispatched', 'cancelled'
  ];

  if (!validStatuses.includes(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }

  if (status === 'dispatched') {
    const { assertQcAllowsDispatch } = require('./mill.qc.service.cjs');
    const gate = assertQcAllowsDispatch(batch_id);
    if (!gate.ok) return gate;
  }
  if (status === 'in_progress' || status === 'confirmed') {
    const batch = getMillDb().prepare('SELECT mill_id FROM mill_batches WHERE id = ?').get(batch_id);
    if (batch) {
      const { assertFlushAllowsStart } = require('./mill.floor.service.cjs');
      const flush = assertFlushAllowsStart(batch.mill_id, batch_id);
      if (!flush.ok) return flush;
      const { assertBatchLotsUsable } = require('./mill.lotlock.service.cjs');
      const lock = assertBatchLotsUsable(batch_id);
      if (!lock.ok) return lock;
    }
  }

  // Set timestamp for key status transitions
  const timestampField = {
    in_progress: 'started_at',
    completed:   'completed_at',
    reviewed:    'reviewed_at',
    dispatched:  'dispatched_at'
  }[status];

  const now = new Date().toISOString();

  if (timestampField) {
    db.prepare(`
      UPDATE mill_batches
      SET status = ?, ${timestampField} = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, now, batch_id);
  } else {
    db.prepare(`
      UPDATE mill_batches
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, batch_id);
  }

  console.log(`[MillBatch] Batch ${batch_id} â†’ ${status}`);
  return { ok: true, batch_id, status };
}

// â”€â”€ RECORD ACTUAL WEIGHTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called when batch completes â€” operator enters or system imports actuals
function recordActualWeights(batch_id, actuals) {
  const db = getMillDb();
  const { assertBatchLotsUsable } = require('./mill.lotlock.service.cjs');
  const lock = assertBatchLotsUsable(batch_id, actuals || []);
  if (!lock.ok) return lock;

  const update = db.prepare(`
    UPDATE mill_batch_ingredients
    SET
      actual_kg     = ?,
      deviation_pct = CASE
                        WHEN planned_kg > 0
                        THEN ROUND(((? - planned_kg) / planned_kg) * 100, 2)
                        ELSE NULL
                      END,
      actual_cost   = CASE
                        WHEN cost_per_kg IS NOT NULL THEN ? * cost_per_kg
                        ELSE NULL
                      END,
      cost_impact   = CASE
                        WHEN cost_per_kg IS NOT NULL AND planned_cost IS NOT NULL
                        THEN (? * cost_per_kg) - planned_cost
                        ELSE NULL
                      END,
      deviation_flag = CASE
                        WHEN planned_kg > 0 AND ABS(((? - planned_kg) / planned_kg) * 100) > 5
                        THEN 'flag'
                        WHEN planned_kg > 0 AND ABS(((? - planned_kg) / planned_kg) * 100) > 2
                        THEN 'warn'
                        ELSE 'none'
                      END,
      updated_at    = datetime('now')
    WHERE batch_id = ? AND ingredient_id = ?
  `);

  const updateMany = db.transaction((items) => {
    for (const a of items) {
      update.run(
        a.actual_kg,
        a.actual_kg,
        a.actual_kg,
        a.actual_kg,
        a.actual_kg,
        a.actual_kg,
        batch_id,
        a.ingredient_id
      );
    }
  });

  updateMany(actuals);
  console.log(`[MillBatch] Actuals recorded for batch ${batch_id}`);
  return { ok: true, batch_id, updated: actuals.length };
}

// â”€â”€ GET BATCH QUEUE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns all batches for a mill, ordered by priority + created date
function getBatchQueue(mill_id, status_filter = null) {
  const db = getMillDb();

  const query = status_filter
    ? `SELECT b.*, s.formula_name, s.species, s.feed_type, s.cost_per_ton
       FROM mill_batches b
       LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
       WHERE b.mill_id = ? AND b.status = ?
       ORDER BY b.priority DESC, b.created_at ASC`
    : `SELECT b.*, s.formula_name, s.species, s.feed_type, s.cost_per_ton
       FROM mill_batches b
       LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
       WHERE b.mill_id = ?
       ORDER BY b.priority DESC, b.created_at ASC`;

  const rows = status_filter
    ? db.prepare(query).all(mill_id, status_filter)
    : db.prepare(query).all(mill_id);

  return { ok: true, batches: rows, count: rows.length };
}

// â”€â”€ GET BATCH DETAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Full batch record including ingredients, QC, snapshot
function getBatchDetail(batch_id) {
  const db = getMillDb();

  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.species, s.feed_type,
           s.formula_json, s.nutrients_json, s.cost_per_ton,
           s.released_by, s.released_at
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const ingredients = db.prepare(`
    SELECT * FROM mill_batch_ingredients
    WHERE batch_id = ?
    ORDER BY ingredient_name
  `).all(batch_id);

  const qc = db.prepare(`
    SELECT * FROM mill_qc_results
    WHERE batch_id = ?
  `).get(batch_id);

  // Calculate total planned and actual costs
  const total_planned_cost = ingredients.reduce((sum, i) => sum + (i.planned_cost || 0), 0);
  const total_actual_cost  = ingredients.reduce((sum, i) => sum + (i.actual_cost || 0), 0);

  return {
    ok: true,
    batch,
    ingredients,
    qc: qc || null,
    ingredient_count: ingredients.length,
    flagged_ingredients: ingredients.filter(i => i.deviation_flag === 'flag').length,
    warned_ingredients: ingredients.filter(i => i.deviation_flag === 'warn').length,
    total_planned_cost,
    total_actual_cost,
    cost_currency: 'USD'
  };
}

// â”€â”€ FULL RELEASE FLOW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Single call that handles the complete formula release â†’ batch creation flow
// Called by the mill.batch.route when NutriPilot releases a formula
function processFormulaRelease({
  formula_id,
  formula_version,
  formula_name,
  species,
  feed_type,
  released_by,
  formula_json,
  cost_per_ton,
  nutrients_json,
  mill_id,
  planned_qty_tons,
  priority = 1,
  ingredients = []
}) {
  const db = getMillDb();

  const fullFlow = db.transaction(() => {
    const released_at = new Date().toISOString();

    // Step 1 â€” freeze formula snapshot
    const { snapshot_id } = createFormulaSnapshot({
      formula_id,
      formula_version,
      formula_name,
      species,
      feed_type,
      released_by,
      released_at,
      formula_json,
      cost_per_ton,
      nutrients_json
    });

    // Step 2 â€” create batch job
    const { batch_id, batch_number } = createBatch({
      mill_id,
      formula_snapshot_id: snapshot_id,
      planned_qty_tons,
      priority,
      connector_source: 'manual_entry'
    });

    // Step 3 â€” add planned ingredients
    if (ingredients.length > 0) {
      addBatchIngredients(batch_id, ingredients);
    }

    return { snapshot_id, batch_id, batch_number };
  });

  const result = fullFlow();
  console.log(`[MillBatch] Formula release processed â†’ ${result.batch_number}`);
  return { ok: true, ...result };
}

function _norm(s) {
  return String(s || '').trim().toLowerCase();
}

function _lineCode(line) {
  return String(line.code || line.ingredient_id || '').trim();
}

function _lineName(line) {
  return String(line.name || line.ingredient_name || _lineCode(line) || 'unknown').trim();
}

function findIngredientRow(db, batch_id, line) {
  const code = _lineCode(line);
  const name = _lineName(line);
  if (code) {
    const byId = db.prepare(
      `SELECT * FROM mill_batch_ingredients WHERE batch_id = ? AND ingredient_id = ?`
    ).get(batch_id, code);
    if (byId) return byId;
  }
  if (name) {
    return db.prepare(
      `SELECT * FROM mill_batch_ingredients WHERE batch_id = ? AND lower(ingredient_name) = ?`
    ).get(batch_id, _norm(name)) || null;
  }
  return null;
}

function ensurePlcSnapshot({ mill_id, formula_name, lines }) {
  const db = getMillDb();
  const fname = String(formula_name || '').trim();
  if (fname) {
    const hit = db.prepare(
      `SELECT * FROM mill_formula_snapshots WHERE lower(formula_name) = ? ORDER BY released_at DESC LIMIT 1`
    ).get(_norm(fname));
    if (hit) return hit;
  }
  const id = randomUUID();
  const released_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO mill_formula_snapshots (
      id, formula_id, formula_version, formula_name,
      species, feed_type, released_by, released_at,
      formula_json, cost_per_ton, nutrients_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `plc:${mill_id}`,
    'plc',
    fname || 'PLC production',
    null,
    null,
    'plc-edge',
    released_at,
    JSON.stringify({ source: 'plc', ingredients: lines }),
    null,
    null
  );
  return db.prepare('SELECT * FROM mill_formula_snapshots WHERE id = ?').get(id);
}

function populateBatchFromSnapshot(batch_id, snapshot_id, planned_qty_tons) {
  const db = getMillDb();
  const snap = db.prepare('SELECT * FROM mill_formula_snapshots WHERE id = ?').get(snapshot_id);
  if (!snap) return { ok: false };
  let fj = {};
  try { fj = JSON.parse(snap.formula_json || '{}'); } catch (_e) { fj = {}; }
  let rows = fj.formula_rows || fj.rows || fj.ingredients || [];
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch (_e2) { rows = []; }
  }
  if (!Array.isArray(rows) || !rows.length) return { ok: true, count: 0 };
  const plannedKg = Number(planned_qty_tons || 0) * 1000;
  const totalIncl = rows.reduce((s, r) => s + Number(r.inclusion_pct || r.inclusion || r.pct || 0), 0);
  const items = rows.map((r) => {
    const incl = Number(r.inclusion_pct || r.inclusion || r.pct || 0);
    let kg = Number(r.kg || r.planned_kg || 0);
    if (!kg && plannedKg && totalIncl > 0) kg = plannedKg * (incl / totalIncl);
    return {
      ingredient_id: String(r.ingredient_id || r.id || r.code || r.name || ''),
      ingredient_name: String(r.ingredient_name || r.name || r.label || 'ingredient'),
      planned_kg: kg || 0,
    };
  });
  addBatchIngredients(batch_id, items);
  return { ok: true, count: items.length };
}

/**
 * Ingest a completed-batch report from the mill-edge agent / PLC.
 * Creates the mill batch if Nutrix never saw it, then records actuals and
 * computes deviation against planned (recipe target or PLC target column).
 */
function ingestPlcBatch({ mill_id, batch_number, formula_name, lines, source = 'file_import', operator_id = null, weight_unit = null }) {
  const db = getMillDb();
  const number = String(batch_number || '').trim();
  if (!mill_id || !number) return { ok: false, error: 'mill_id and batch_number are required' };
  let millUnit = weight_unit;
  try {
    const mill = db.prepare('SELECT weight_unit FROM mill_configurations WHERE id = ?').get(mill_id);
    if (!millUnit && mill?.weight_unit) millUnit = mill.weight_unit;
  } catch (_e) {}
  millUnit = millUnit || 'kg';
  const clean = (Array.isArray(lines) ? lines : [])
    .map(l => ({
      code: _lineCode(l),
      name: _lineName(l),
      planned_kg: l.planned_kg != null && l.planned_kg !== '' ? Number(l.planned_kg) : null,
      actual_kg: Number(l.actual_kg ?? l.actual ?? 0),
    }))
    .filter(l => (l.code || l.name) && Number.isFinite(l.actual_kg));
  if (!clean.length) return { ok: false, error: 'No ingredient actuals in report' };

  let batch = db.prepare(
    `SELECT id, formula_snapshot_id FROM mill_batches WHERE mill_id = ? AND batch_number = ?`
  ).get(mill_id, number);

  if (!batch) {
    const snap = ensurePlcSnapshot({ mill_id, formula_name, lines: clean });
    const totalMass = clean.reduce((s, l) => s + (l.planned_kg != null ? l.planned_kg : l.actual_kg), 0);
    const id = randomUUID();
    const note = `PLC mill-edge · unit ${millUnit} (values stored as mill unit, not converted)`;
    db.prepare(`
      INSERT INTO mill_batches (
        id, mill_id, formula_snapshot_id, batch_number,
        planned_qty_tons, status, priority, connector_source, operator_id, notes
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', 1, ?, ?, ?)
    `).run(id, mill_id, snap.id, number, totalMass, source, operator_id, note);
    addBatchIngredients(id, clean.map(l => ({
      ingredient_id: l.code || l.name,
      ingredient_name: l.name,
      planned_kg: l.planned_kg != null ? l.planned_kg : l.actual_kg,
    })));
    batch = { id, formula_snapshot_id: snap.id };
  } else {
    for (const l of clean) {
      if (findIngredientRow(db, batch.id, l)) continue;
      addBatchIngredients(batch.id, [{
        ingredient_id: l.code || l.name,
        ingredient_name: l.name,
        planned_kg: l.planned_kg != null ? l.planned_kg : 0,
      }]);
    }
  }

  const actuals = [];
  for (const l of clean) {
    const row = findIngredientRow(db, batch.id, l);
    actuals.push({
      ingredient_id: row ? row.ingredient_id : (l.code || l.name),
      actual_kg: l.actual_kg,
    });
  }
  recordActualWeights(batch.id, actuals);
  try { require('./mill.price.service.cjs').applyPricesToBatch(batch.id); } catch (_e) {}
  updateBatchStatus(batch.id, 'completed');
  const actualMass = clean.reduce((s, l) => s + l.actual_kg, 0);
  db.prepare(`UPDATE mill_batches SET actual_qty_tons = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(actualMass, batch.id);

  return { ok: true, batch_id: batch.id, batch_number: number, actuals: actuals.length, weight_unit: millUnit };
}

module.exports = {
  createFormulaSnapshot,
  createBatch,
  addBatchIngredients,
  updateBatchStatus,
  recordActualWeights,
  getBatchQueue,
  getBatchDetail,
  processFormulaRelease,
  ingestPlcBatch,
  populateBatchFromSnapshot
};