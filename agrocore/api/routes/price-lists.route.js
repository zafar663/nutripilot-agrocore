// ============================================================
// Price Lists Route
// File: agrocore/api/routes/price-lists.route.js
// Mount in START_AGROCORE_SERVER.mjs:
//   import priceListsRouter from "./api/routes/price-lists.route.js";
//   app.use("/v1/price-lists", priceListsRouter);
// ============================================================

import express from 'express';
import { createRequire } from 'node:module';
import { learn } from '../lib/learn-hook.js';
const require = createRequire(import.meta.url);
const { randomUUID } = require('crypto');

function getMillDb() {
  const Database = require('better-sqlite3');
  const dbPath = require('path').join(process.cwd(), 'data', 'mill.db');
  return new Database(dbPath);
}

const router = express.Router();
const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// Per-kg unit normaliser (mirrors prices.route.js).
const WEIGHT_TO_KG = { kg:1, lb:0.453592, mt:1000, metric_ton:1000, ton:1000, short_ton:907.18474, bag_40kg:40, bag_50kg:50, maund:37.3242, quintal:100, cwt:45.3592, g:0.001 };
function normUnit(u) {
  let k = String(u||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/^per_/,'');
  const a = { kilogram:'kg', kgs:'kg', pound:'lb', pounds:'lb', lbs:'lb', tonne:'mt', tonnes:'mt', t:'mt', us_ton:'short_ton' };
  return a[k] || k;
}
function perKgOf(pricePerUnit, weightUnit) {
  const k = normUnit(weightUnit);
  const bag = k.match(/^bag_(\d+(?:\.\d+)?)kg$/);
  const factor = bag ? parseFloat(bag[1]) : (WEIGHT_TO_KG[k] || 1);
  return Number(pricePerUnit) / factor;
}

/**
 * Publish a price list's approved items into the live price tables that
 * formulation/Multimix read (ingredient_prices + mill_ingredient_catalogue).
 * Without this, approving a monthly list never reaches the optimizer.
 */
function publishPriceListItems(db, listId, approvedBy) {
  const items = db.prepare(
    `SELECT * FROM price_list_items WHERE price_list_id = ? AND status = 'approved'`
  ).all(listId);
  const now = new Date().toISOString();
  const insPrice = db.prepare(`INSERT INTO ingredient_prices
    (id, submission_id, ingredient_id, ingredient_name, price_per_unit, price_per_kg, price_per_kg_usd,
     currency, weight_unit, price_basis, supplier, effective_date, exchange_rate, status, approved_by, approved_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?, ?)`);
  const updCat = db.prepare(`UPDATE mill_ingredient_catalogue SET price_per_kg = ?, currency = ?, price_updated_at = ? WHERE ingredient_id = ?`);
  let published = 0;
  for (const it of items) {
    const ingId = it.ingredient_id || it.ingredient_code;
    if (!ingId) continue;
    const ppk = perKgOf(it.price_per_unit, it.weight_unit);
    const rate = Number(it.exchange_rate) || 1;
    insPrice.run(randomUUID(), `pricelist_${listId}`, ingId, it.ingredient_name || '',
      it.price_per_unit, ppk, ppk / rate, it.currency || 'USD', it.weight_unit || 'mt',
      'per_unit', it.supplier || null, it.effective_date || null, rate, approvedBy || 'price_list', now, now);
    updCat.run(ppk, it.currency || 'USD', now, ingId);
    published++;
  }
  return published;
}

// ── GET /v1/price-lists?mill_id=xxx ──────────────────────────
router.get('/', (req, res) => {
  try {
    const db = getMillDb();
    const { mill_id, status } = req.query;
    let sql = `SELECT pl.*, 
      (SELECT COUNT(*) FROM price_list_items pli WHERE pli.price_list_id = pl.id) as item_count
      FROM price_lists pl WHERE 1=1`;
    const params = [];
    if (mill_id) { sql += ` AND pl.mill_id = ?`; params.push(mill_id); }
    if (status)  { sql += ` AND pl.status = ?`;  params.push(status); }
    sql += ` ORDER BY pl.created_at DESC`;
    const lists = db.prepare(sql).all(...params);
    ok(res, lists);
  } catch(e) { err(res, e); }
});

// ── POST /v1/price-lists ─────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const db = getMillDb();
    const { mill_id, name, description, created_by, created_by_role, valid_from, valid_to, notes } = req.body;
    if (!mill_id || !name || !created_by) return err(res, new Error('mill_id, name and created_by required'), 400);
    const id = randomUUID();
    db.prepare(`INSERT INTO price_lists (id, mill_id, name, description, status, created_by, created_by_role, valid_from, valid_to, notes)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
      .run(id, mill_id, name, description || '', created_by, created_by_role || 'purchaser', valid_from || null, valid_to || null, notes || '');
    const list = db.prepare(`SELECT * FROM price_lists WHERE id = ?`).get(id);
    ok(res, list);
  } catch(e) { err(res, e); }
});

// ── GET /v1/price-lists/:id ───────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const db = getMillDb();
    const list = db.prepare(`SELECT * FROM price_lists WHERE id = ?`).get(req.params.id);
    if (!list) return err(res, new Error('Price list not found'), 404);
    const items = db.prepare(`SELECT * FROM price_list_items WHERE price_list_id = ? ORDER BY ingredient_name`).all(req.params.id);
    ok(res, { ...list, items });
  } catch(e) { err(res, e); }
});

// ── POST /v1/price-lists/:id/items ───────────────────────────
// Add items to a price list (batch)
router.post('/:id/items', (req, res) => {
  try {
    const db = getMillDb();
    const list = db.prepare(`SELECT * FROM price_lists WHERE id = ?`).get(req.params.id);
    if (!list) return err(res, new Error('Price list not found'), 404);

    const { items, submitted_by } = req.body;
    if (!Array.isArray(items) || !items.length) return err(res, new Error('items array required'), 400);

    const WEIGHT_TO_KG = { kg:1, lb:0.453592, mt:1000, metric_ton:1000, ton:1000, short_ton:907.18474, bag_40kg:40, bag_50kg:50, maund:37.3242, quintal:100, cwt:45.3592, g:0.001 };
    const normUnit = (u) => {
      let k = String(u||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/^per_/,'');
      const a = { kilogram:'kg', kgs:'kg', pound:'lb', pounds:'lb', lbs:'lb', tonne:'mt', tonnes:'mt', t:'mt', us_ton:'short_ton' };
      return a[k] || k;
    };

    const insert = db.prepare(`INSERT OR REPLACE INTO price_list_items 
      (id, price_list_id, mill_id, ingredient_code, ingredient_name, ingredient_id, 
       price_per_unit, currency, weight_unit, exchange_rate, price_per_kg_usd, 
       supplier, effective_date, notes, submitted_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const uk = normUnit(row.weight_unit);
        const bagm = uk.match(/^bag_(\d+(?:\.\d+)?)kg$/);
        const factor = bagm ? parseFloat(bagm[1]) : (WEIGHT_TO_KG[uk] || 1);
        const price_per_kg = row.price_per_unit / factor;
        // USD = local / (local-per-USD rate); matches prices.route.js convention.
        const price_per_kg_usd = price_per_kg / (row.exchange_rate || 1);
        insert.run(
          randomUUID(), req.params.id, list.mill_id,
          row.ingredient_code || '', row.ingredient_name,
          row.ingredient_id || row.ingredient_code || '',
          row.price_per_unit, row.currency || 'USD',
          row.weight_unit || 'mt', row.exchange_rate || 1,
          price_per_kg_usd, row.supplier || '',
          row.effective_date || '', row.notes || '',
          submitted_by || 'purchaser'
        );
      }
    });

    insertMany(items);

    // Update price list status to pending_review if was draft
    if (list.status === 'draft') {
      db.prepare(`UPDATE price_lists SET status = 'pending_review', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    }

    const updated = db.prepare(`SELECT * FROM price_lists WHERE id = ?`).get(req.params.id);
    const updatedItems = db.prepare(`SELECT * FROM price_list_items WHERE price_list_id = ?`).all(req.params.id);
    ok(res, { ...updated, items: updatedItems, rows_inserted: items.length });
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/price-lists/:id/activate ───────────────────────
router.patch('/:id/activate', (req, res) => {
  try {
    const db = getMillDb();
    const { activated_by, mill_id } = req.body;
    // Deactivate current active list for this mill
    if (mill_id) {
      db.prepare(`UPDATE price_lists SET status = 'draft', updated_at = datetime('now') 
        WHERE mill_id = ? AND status = 'active'`).run(mill_id);
    }
    db.prepare(`UPDATE price_lists SET status = 'active', activated_by = ?, activated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(activated_by || 'nutritionist', req.params.id);
    // Approve all pending items
    db.prepare(`UPDATE price_list_items SET status = 'approved', approved_by = ?, approved_at = datetime('now')
      WHERE price_list_id = ? AND status = 'pending'`).run(activated_by || 'nutritionist', req.params.id);
    // Publish approved prices to the live tables formulation/Multimix read.
    const published = publishPriceListItems(db, req.params.id, activated_by || 'nutritionist');
    learn({
      source: 'nutrix', kind: 'price_activate', user_id: activated_by || 'nutritionist', mill_id,
      title: `Price list activated ${req.params.id}`,
      text: `Published ${published} prices`,
      metadata: { price_list_id: req.params.id, published }
    });
    ok(res, { message: 'Price list activated', prices_published: published });
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/price-lists/:id/archive ────────────────────────
router.patch('/:id/archive', (req, res) => {
  try {
    const db = getMillDb();
    db.prepare(`UPDATE price_lists SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(req.params.id);
    ok(res, { message: 'Price list archived' });
  } catch(e) { err(res, e); }
});

// ── GET /v1/price-lists/active/:mill_id ──────────────────────
router.get('/active/:mill_id', (req, res) => {
  try {
    const db = getMillDb();
    const list = db.prepare(`SELECT pl.*, pli.ingredient_code, pli.ingredient_name, 
      pli.price_per_unit, pli.price_per_kg_usd, pli.currency, pli.weight_unit
      FROM price_lists pl
      LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id
      WHERE pl.mill_id = ? AND pl.status = 'active'
      ORDER BY pli.ingredient_name`).all(req.params.mill_id);
    ok(res, list);
  } catch(e) { err(res, e); }
});

// PATCH /v1/price-lists/:id/items/:itemId/approve
router.patch('/:id/items/:itemId/approve', (req, res) => {
  try {
    const db = getMillDb();
    const { approved_by } = req.body;
    db.prepare(`UPDATE price_list_items SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND price_list_id = ?`)
      .run(approved_by || 'nutritionist', req.params.itemId, req.params.id);
    // Publish this approved item's price to the live tables formulation/Multimix read.
    const it = db.prepare(`SELECT * FROM price_list_items WHERE id = ? AND price_list_id = ?`).get(req.params.itemId, req.params.id);
    if (it && (it.ingredient_id || it.ingredient_code)) {
      const ingId = it.ingredient_id || it.ingredient_code;
      const ppk = perKgOf(it.price_per_unit, it.weight_unit);
      const rate = Number(it.exchange_rate) || 1;
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO ingredient_prices
        (id, submission_id, ingredient_id, ingredient_name, price_per_unit, price_per_kg, price_per_kg_usd,
         currency, weight_unit, price_basis, supplier, effective_date, exchange_rate, status, approved_by, approved_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?, ?)`).run(
        randomUUID(), `pricelist_${req.params.id}`, ingId, it.ingredient_name || '', it.price_per_unit, ppk, ppk / rate,
        it.currency || 'USD', it.weight_unit || 'mt', 'per_unit', it.supplier || null, it.effective_date || null, rate,
        approved_by || 'price_list', now, now);
      db.prepare(`UPDATE mill_ingredient_catalogue SET price_per_kg = ?, currency = ?, price_updated_at = ? WHERE ingredient_id = ?`)
        .run(ppk, it.currency || 'USD', now, ingId);
    }
    ok(res, { message: 'Item approved' });
  } catch(e) { err(res, e); }
});

router.patch('/:id/items/:itemId/reject', (req, res) => {
  try {
    const db = getMillDb();
    const { rejected_by, rejection_note } = req.body;
    db.prepare(`UPDATE price_list_items SET status = 'rejected', rejection_note = ?, updated_at = datetime('now') WHERE id = ? AND price_list_id = ?`)
      .run(rejection_note || '', req.params.itemId, req.params.id);
    ok(res, { message: 'Item rejected' });
  } catch(e) { err(res, e); }
});

export default router;