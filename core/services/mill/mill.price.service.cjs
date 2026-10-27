'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { currentWorkspaceUser } = require('../../db/workspace-context.cjs');

const PRICE_KEYS = new Set([
  'cost_per_kg', 'cost_per_unit', 'price_per_kg', 'price_per_unit',
  'price_per_kg_usd', 'planned_cost', 'actual_cost', 'total_planned_cost',
  'total_actual_cost', 'inventory_value', 'shrinkage_value',
  'cost_per_ton', 'total_shrinkage_value',
  'planned_ingredient_cost', 'actual_ingredient_cost', 'avg_price_per_kg',
  'receiptIngredientPrice', 'receiptEstimatedCost'
]);

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function hideMillManagerPrices(value) {
  if (Array.isArray(value)) return value.map(hideMillManagerPrices);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (PRICE_KEYS.has(k)) continue;
      out[k] = hideMillManagerPrices(v);
    }
    return out;
  }
  return value;
}

function namesMatch(ingredientId, ingredientName, rowId, rowName) {
  const nid = norm(ingredientId);
  const nname = norm(ingredientName);
  const a = norm(rowId);
  const b = norm(rowName);
  if (nid && (a === nid || b === nid)) return true;
  if (nname && (a === nname || b === nname)) return true;
  if (nname && b && nname.length >= 4 && b.length >= 4 && (b.includes(nname) || nname.includes(b))) return true;
  return false;
}

function pickPrice(rows, field, ingredientId, ingredientName) {
  for (const r of rows) {
    const val = r[field];
    if (val == null || Number(val) <= 0) continue;
    if (namesMatch(ingredientId, ingredientName, r.ingredient_id || r.ingredient_code, r.ingredient_name || r.name)) {
      return Number(val);
    }
  }
  return null;
}

function tryAll(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); }
  catch (_e) { return []; }
}

function lookupOnDb(db, millId, ingredientId, ingredientName) {
  let p = pickPrice(tryAll(db,
    `SELECT ingredient_id, ingredient_name, price_per_kg FROM mill_ingredient_catalogue WHERE mill_id = ? OR mill_id IS NULL`,
    [millId]
  ), 'price_per_kg', ingredientId, ingredientName);
  if (p) return p;

  p = pickPrice(tryAll(db,
    `SELECT ingredient_id, ingredient_name, ingredient_code, price_per_unit, weight_unit, price_per_kg_usd
     FROM price_list_items WHERE mill_id = ?`,
    [millId]
  ), 'price_per_kg_usd', ingredientId, ingredientName);
  if (p) return p;

  const listRows = tryAll(db,
    `SELECT ingredient_id, ingredient_name, ingredient_code, price_per_unit, weight_unit
     FROM price_list_items WHERE mill_id = ?`,
    [millId]
  );
  for (const r of listRows) {
    if (!namesMatch(ingredientId, ingredientName, r.ingredient_id || r.ingredient_code, r.ingredient_name)) continue;
    const unit = String(r.weight_unit || 'kg').toLowerCase();
    const raw = Number(r.price_per_unit);
    if (!(raw > 0)) continue;
    if (unit === 'kg' || unit === 'kgs') return raw;
    if (unit === 'mt' || unit === 'metric_ton' || unit === 'ton' || unit === 'tonne') return raw / 1000;
    if (unit === 'lb') return raw / 0.453592;
  }

  p = pickPrice(tryAll(db,
    `SELECT ingredient_id, ingredient_name, price_per_kg FROM ingredient_prices
     WHERE status = 'approved' AND price_per_kg IS NOT NULL
     ORDER BY COALESCE(approved_at, created_at) DESC`
  ), 'price_per_kg', ingredientId, ingredientName);
  if (p) return p;

  p = pickPrice(tryAll(db,
    `SELECT ingredient_id, ingredient_name, cost_per_unit as price FROM mill_inventory
     WHERE mill_id = ? AND cost_per_unit IS NOT NULL ORDER BY record_date DESC`,
    [millId]
  ), 'price', ingredientId, ingredientName);
  if (p) return p;

  p = pickPrice(tryAll(db,
    `SELECT ingredient_id, ingredient_name, price_per_kg FROM mill_supplier_lots
     WHERE mill_id = ? AND price_per_kg IS NOT NULL ORDER BY received_date DESC`,
    [millId]
  ), 'price_per_kg', ingredientId, ingredientName);
  if (p) return p;

  try {
    const mix = db.prepare(`SELECT ingredient_id, name, cost FROM millmix_ingredients`).all();
    p = pickPrice(mix.map(r => ({ ...r, ingredient_name: r.name })), 'cost', ingredientId, ingredientName);
    if (p) return p;
  } catch (_e) {}

  return null;
}

function extraPriceDbs(primary) {
  const dbs = [];
  const seen = new Set();
  const mark = (db) => {
    try {
      const name = db.name || db.memory;
      if (name && seen.has(name)) return;
      if (name) seen.add(name);
      dbs.push(db);
    } catch (_e) { dbs.push(db); }
  };
  mark(primary);
  const user = currentWorkspaceUser();
  const enc = user ? String(user).toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_dot_') : '';
  const candidates = [
    path.join(__dirname, '../../../data/mill.db'),
    path.join(process.cwd(), 'data/mill.db'),
  ];
  if (enc) candidates.push(path.join(__dirname, '../../../data/users', enc, 'mill.db'));
  const opened = [];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const real = fs.realpathSync(p);
      if (seen.has(real)) continue;
      seen.add(real);
      const extra = new Database(real, { readonly: true, fileMustExist: true });
      opened.push(extra);
      dbs.push(extra);
    } catch (_e) {}
  }
  return { dbs, opened };
}

function lookupIngredientPrice(db, millId, ingredientId, ingredientName) {
  const { dbs, opened } = extraPriceDbs(db || getMillDb());
  try {
    for (const d of dbs) {
      const p = lookupOnDb(d, millId, ingredientId, ingredientName);
      if (p != null) return p;
    }
  } finally {
    for (const d of opened) {
      try { d.close(); } catch (_e) {}
    }
  }
  return null;
}

function applyPricesToBatch(batch_id) {
  const db = getMillDb();
  const batch = db.prepare('SELECT id, mill_id FROM mill_batches WHERE id = ?').get(batch_id);
  if (!batch) return { ok: false, error: 'Batch not found' };
  const ings = db.prepare('SELECT * FROM mill_batch_ingredients WHERE batch_id = ?').all(batch_id);
  const upd = db.prepare(`
    UPDATE mill_batch_ingredients SET
      cost_per_kg = ?,
      planned_cost = CASE WHEN ? IS NOT NULL THEN planned_kg * ? ELSE planned_cost END,
      actual_cost = CASE WHEN ? IS NOT NULL AND actual_kg IS NOT NULL THEN actual_kg * ? ELSE actual_cost END,
      cost_impact = CASE WHEN ? IS NOT NULL AND actual_kg IS NOT NULL
        THEN (actual_kg * ?) - (planned_kg * ?) ELSE cost_impact END,
      updated_at = datetime('now')
    WHERE id = ?
  `);
  let n = 0;
  const tx = db.transaction(() => {
    for (const ing of ings) {
      const price = lookupIngredientPrice(db, batch.mill_id, ing.ingredient_id, ing.ingredient_name);
      if (price == null) continue;
      upd.run(price, price, price, price, price, price, price, price, ing.id);
      n += 1;
    }
  });
  tx();
  return { ok: true, priced: n, batch_id };
}

module.exports = {
  hideMillManagerPrices,
  lookupIngredientPrice,
  applyPricesToBatch,
  PRICE_KEYS
};
