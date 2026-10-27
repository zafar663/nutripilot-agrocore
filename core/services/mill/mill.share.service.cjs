'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');
const {
  createFormulaSnapshot,
  createBatch,
  addBatchIngredients,
} = require('./mill.batch.service.cjs');

function ensureShareSchema(db) {
  try { db.exec(`ALTER TABLE mill_formula_snapshots ADD COLUMN share_scope TEXT DEFAULT 'formula'`); } catch (_e) {}
  try { db.exec(`ALTER TABLE mill_formula_snapshots ADD COLUMN mill_id TEXT`); } catch (_e) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS mill_nutritionist_shares (
      id TEXT PRIMARY KEY,
      mill_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_user TEXT,
      formula_id TEXT,
      snapshot_id TEXT,
      batch_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mill_silos (
      mill_id TEXT NOT NULL,
      bin TEXT NOT NULL,
      ingredient_id TEXT,
      ingredient_name TEXT,
      leftover_mass REAL DEFAULT 0,
      last_species TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (mill_id, bin)
    );
    CREATE TABLE IF NOT EXISTS mill_stock_alert_log (
      mill_id TEXT PRIMARY KEY,
      last_sent_at TEXT,
      last_payload TEXT
    );
  `);
}

function stripCosts(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripCosts);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/cost|price|usd|eur|pkr|unit_price/i.test(k)) continue;
    out[k] = stripCosts(v);
  }
  return out;
}

function parseRows(formula) {
  let rows = formula.formula_rows || formula.rows || formula.ingredients || [];
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch (_e) { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows;
}

function ingredientLines(formula, plannedKgTotal) {
  const rows = parseRows(formula);
  const totalIncl = rows.reduce((s, r) => s + Number(r.inclusion_pct || r.inclusion || r.pct || 0), 0);
  return rows.map((r) => {
    const name = r.ingredient_name || r.name || r.label || 'ingredient';
    const id = r.ingredient_id || r.id || r.code || name;
    const incl = Number(r.inclusion_pct || r.inclusion || r.pct || 0);
    let kg = Number(r.kg || r.planned_kg || 0);
    if (!kg && plannedKgTotal && totalIncl > 0) kg = plannedKgTotal * (incl / totalIncl);
    return { ingredient_id: String(id), ingredient_name: String(name), planned_kg: kg || 0 };
  }).filter((l) => l.ingredient_name);
}

function upsertCatalogue(db, mill_id, lines) {
  const ins = db.prepare(`
    INSERT INTO mill_ingredient_catalogue (id, mill_id, ingredient_id, ingredient_name, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET ingredient_name = excluded.ingredient_name
  `);
  for (const line of lines) {
    const catId = `${mill_id}:${line.ingredient_id}`.slice(0, 80);
    try {
      ins.run(catId, mill_id, line.ingredient_id, line.ingredient_name);
    } catch (_e) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO mill_ingredient_catalogue (mill_id, ingredient_id, ingredient_name)
          VALUES (?, ?, ?)
        `).run(mill_id, line.ingredient_id, line.ingredient_name);
      } catch (_e2) {}
    }
  }
}

function defaultBatchTons(db, mill_id) {
  try {
    const row = db.prepare(`SELECT default_batch_size_tons FROM mill_configurations WHERE id = ?`).get(mill_id);
    const n = Number(row?.default_batch_size_tons);
    if (n > 0) return n;
  } catch (_e) {}
  return 10;
}

/**
 * Nutritionist share into Mill IQ.
 * kind: 'ingredients' — catalogue only (no recipe, no prices, no batch)
 * kind: 'formula' — snapshot + auto pending batch (no prices)
 */
function shareFromNutritionist({ mill_id, kind, formula, released_by }) {
  const db = getMillDb();
  ensureShareSchema(db);
  if (!mill_id) throw new Error('mill_id is required');
  if (!formula) throw new Error('formula is required');
  const scope = kind === 'ingredients' ? 'ingredients' : 'formula';
  const clean = stripCosts(formula);
  const millTons = defaultBatchTons(db, mill_id);
  const plannedKg = millTons * 1000;
  const lines = ingredientLines(clean, plannedKg);

  upsertCatalogue(db, mill_id, lines);

  if (scope === 'ingredients') {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO mill_nutritionist_shares (id, mill_id, kind, source_user, formula_id)
      VALUES (?, ?, 'ingredients', ?, ?)
    `).run(id, mill_id, released_by || null, formula.id || formula.formula_id || null);
    return {
      ok: true,
      kind: 'ingredients',
      mill_id,
      ingredients: lines.map((l) => ({ id: l.ingredient_id, name: l.ingredient_name })),
      message: 'Ingredients shared with the mill. Recipes and prices were not sent.',
    };
  }

  const { snapshot_id } = createFormulaSnapshot({
    formula_id: String(formula.formula_id || formula.id || randomUUID()),
    formula_version: String(formula.version || 1),
    formula_name: formula.formula_name || formula.name || 'Shared formula',
    species: formula.species || null,
    feed_type: formula.type || formula.feed_type || null,
    released_by: released_by || 'nutritionist',
    released_at: new Date().toISOString(),
    formula_json: clean,
    cost_per_ton: null,
    nutrients_json: stripCosts(formula.nutrient_profile || formula.nutrients_json || null),
  });

  try {
    db.prepare(`UPDATE mill_formula_snapshots SET share_scope = 'formula', mill_id = ?, cost_per_ton = NULL WHERE id = ?`)
      .run(mill_id, snapshot_id);
  } catch (_e) {}

  const { batch_id, batch_number } = createBatch({
      mill_id,
      formula_snapshot_id: snapshot_id,
      planned_qty_tons: millTons,
      connector_source: 'nutritionist_share',
      notes: 'Queued from NutriX share',
    });
    if (lines.length) {
      addBatchIngredients(batch_id, lines.map((l) => ({
        ingredient_id: l.ingredient_id,
        ingredient_name: l.ingredient_name,
        planned_kg: l.planned_kg,
      })));
    }

  db.prepare(`
    INSERT INTO mill_nutritionist_shares (id, mill_id, kind, source_user, formula_id, snapshot_id, batch_id)
    VALUES (?, ?, 'formula', ?, ?, ?, ?)
  `).run(randomUUID(), mill_id, released_by || null, formula.id || formula.formula_id || null, snapshot_id, batch_id);

  return {
    ok: true,
    kind: 'formula',
    mill_id,
    snapshot_id,
    batch_id,
    batch_number,
    planned_qty_tons: millTons,
    message: 'Formula shared. A pending mill batch was queued. Prices were not sent.',
  };
}

function listSharedFormulas(mill_id) {
  const db = getMillDb();
  ensureShareSchema(db);
  const rows = db.prepare(`
    SELECT id, formula_id, formula_version, formula_name, species, feed_type,
           released_by, released_at, created_at, mill_id, share_scope
    FROM mill_formula_snapshots
    WHERE COALESCE(share_scope, 'formula') = 'formula'
      AND (mill_id IS NULL OR mill_id = ?)
    ORDER BY created_at DESC
  `).all(mill_id);
  return { ok: true, mill_id, formulas: rows.map((r) => ({ ...r, cost_per_ton: null })), count: rows.length };
}

function listSharedIngredients(mill_id) {
  const db = getMillDb();
  ensureShareSchema(db);
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT ingredient_id, ingredient_name FROM mill_ingredient_catalogue
      WHERE mill_id = ? ORDER BY ingredient_name
    `).all(mill_id);
  } catch (_e) {
    rows = [];
  }
  return { ok: true, mill_id, ingredients: rows };
}

function listSilos(mill_id) {
  const db = getMillDb();
  ensureShareSchema(db);
  const rows = db.prepare(`SELECT * FROM mill_silos WHERE mill_id = ? ORDER BY bin`).all(mill_id);
  return { ok: true, mill_id, silos: rows };
}

function upsertSilo({ mill_id, bin, ingredient_id, ingredient_name, leftover_mass, last_species }) {
  const db = getMillDb();
  ensureShareSchema(db);
  if (!mill_id || !bin) throw new Error('mill_id and bin are required');
  db.prepare(`
    INSERT INTO mill_silos (mill_id, bin, ingredient_id, ingredient_name, leftover_mass, last_species, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(mill_id, bin) DO UPDATE SET
      ingredient_id = excluded.ingredient_id,
      ingredient_name = excluded.ingredient_name,
      leftover_mass = excluded.leftover_mass,
      last_species = excluded.last_species,
      updated_at = datetime('now')
  `).run(mill_id, String(bin), ingredient_id || null, ingredient_name || null, leftover_mass || 0, last_species || null);
  return listSilos(mill_id);
}

function siloSpeciesConflict(mill_id, nextSpecies) {
  if (!nextSpecies) return [];
  const db = getMillDb();
  ensureShareSchema(db);
  return db.prepare(`
    SELECT bin, ingredient_name, last_species, leftover_mass
    FROM mill_silos
    WHERE mill_id = ? AND leftover_mass > 0 AND last_species IS NOT NULL
      AND lower(last_species) != lower(?)
  `).all(mill_id, nextSpecies);
}

module.exports = {
  ensureShareSchema,
  shareFromNutritionist,
  listSharedFormulas,
  listSharedIngredients,
  listSilos,
  upsertSilo,
  siloSpeciesConflict,
  stripCosts,
};
