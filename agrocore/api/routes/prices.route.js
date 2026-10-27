// ============================================================
// NutriPilot — Ingredient Price Routes
// nutripilot-agrocore/agrocore/api/routes/prices.route.js
// ============================================================
import express from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require     = createRequire(import.meta.url);
const __dirname   = dirname(fileURLToPath(import.meta.url));
const Database    = require('better-sqlite3');
const { randomUUID } = require('crypto');

const router = express.Router();

// ── Weight unit conversion to kg ─────────────────────────────
// kg per 1 unit of the named weight unit.
const WEIGHT_TO_KG = {
  kg:        1,
  lb:        0.453592,
  mt:        1000,
  metric_ton:1000,
  ton:       1000,        // treated as metric tonne (legacy default)
  short_ton: 907.18474,   // US short ton (2000 lb)
  bag_40kg:  40,
  bag_50kg:  50,
  maund:     37.3242,     // Pakistani maund
  quintal:   100,         // India/Turkey
  cwt:       45.3592,     // US hundredweight
  g:         0.001,
};

// Normalize any weight-unit string (per_metric_ton, tonne, pounds, etc.) to a
// canonical key in WEIGHT_TO_KG. Stripping a leading "per_"/"per " is the main
// fix — that's why "per_metric_ton" rows were never divided to per-kg.
function normalizeWeightUnit(u) {
  let k = String(u || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/^per_/, '');
  const aliases = {
    kilogram: 'kg', kilograms: 'kg', kgs: 'kg', kilo: 'kg',
    pound: 'lb', pounds: 'lb', lbs: 'lb',
    tonne: 'mt', tonnes: 'mt', metricton: 'mt', metric_tonne: 'mt', t: 'mt', mts: 'mt',
    us_ton: 'short_ton', shortton: 'short_ton',
    gram: 'g', grams: 'g',
    'bag-40kg': 'bag_40kg', 'bag-50kg': 'bag_50kg',
  };
  k = aliases[k] || k;
  // Generic bag_NNkg → divide by NN; map to a synthetic factor via direct compute upstream.
  return k;
}

function toKgPerUnit(pricePerUnit, weightUnit) {
  const key = normalizeWeightUnit(weightUnit);
  // Handle arbitrary bag sizes like bag_25kg that aren't in the table.
  const bag = key.match(/^bag_(\d+(?:\.\d+)?)kg$/);
  const factor = bag ? parseFloat(bag[1]) : (WEIGHT_TO_KG[key] || 1);
  return pricePerUnit / factor;
}

// ── Supported currencies ──────────────────────────────────────
const CURRENCIES = [
  { code: 'USD', symbol: '$',   name: 'US Dollar' },
  { code: 'EUR', symbol: '€',   name: 'Euro' },
  { code: 'GBP', symbol: '£',   name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼',   name: 'Saudi Riyal' },
  { code: 'PKR', symbol: '₨',   name: 'Pakistani Rupee' },
  { code: 'INR', symbol: '₹',   name: 'Indian Rupee' },
  { code: 'BDT', symbol: '৳',   name: 'Bangladeshi Taka' },
  { code: 'NGN', symbol: '₦',   name: 'Nigerian Naira' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'IDR', symbol: 'Rp',  name: 'Indonesian Rupiah' },
  { code: 'BRL', symbol: 'R$',  name: 'Brazilian Real' },
  { code: 'ZAR', symbol: 'R',   name: 'South African Rand' },
  { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$',  name: 'Canadian Dollar' },
];

const WEIGHT_UNITS = [
  { code: 'kg',         label: 'kg',          factor: 1 },
  { code: 'lb',         label: 'lb',          factor: 0.453592 },
  { code: 'mt',         label: 'Metric Ton',  factor: 1000 },
  { code: 'bag_40kg',   label: 'Bag (40kg)',  factor: 40 },
  { code: 'bag_50kg',   label: 'Bag (50kg)',  factor: 50 },
  { code: 'maund',      label: 'Maund (37.3kg)', factor: 37.3242 },
  { code: 'quintal',    label: 'Quintal (100kg)', factor: 100 },
  { code: 'cwt',        label: 'CWT (45.4kg)', factor: 45.3592 },
];

function getMillDb() {
  const dbPath = require('path').join(process.cwd(), 'data', 'mill.db');
  return new Database(dbPath);
}

const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// ── GET /v1/prices/meta — currencies + weight units ──────────
router.get('/meta', (req, res) => {
  ok(res, { currencies: CURRENCIES, weight_units: WEIGHT_UNITS });
});

// ── POST /v1/prices/submit — purchaser submits price batch ────
router.post('/submit', (req, res) => {
  try {
    const { batch_name, source = 'manual', submitted_by, currency, region, country, rows = [] } = req.body;
    if (!batch_name || !rows.length) return err(res, new Error('batch_name and rows required'), 400);

    const db = getMillDb();
    const submissionId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO price_submissions (id, batch_name, source, submitted_by, submitted_at, status, currency, region, country)
      VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)
    `).run(submissionId, batch_name, source, submitted_by || 'purchaser', now, currency || 'USD', region || null, country || null);

    const insertRow = db.prepare(`
      INSERT INTO ingredient_prices
        (id, submission_id, ingredient_id, ingredient_name, price_per_unit, price_per_kg,
         price_per_kg_usd, currency, weight_unit, price_basis, supplier, effective_date, exchange_rate, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)
    `);

    let inserted = 0;
    for (const row of rows) {
      if (!row.ingredient_id && !row.ingredient_name) continue;
      const weightUnit  = row.weight_unit || 'kg';
      const pricePerUnit = row.price_per_unit || row.price || null;
      const exchangeRate = row.exchange_rate || 1.0;
      const pricePerKg  = pricePerUnit ? toKgPerUnit(pricePerUnit, weightUnit) : null;
      const pricePerKgUsd = pricePerKg ? pricePerKg / exchangeRate : null;

      insertRow.run(
        randomUUID(), submissionId,
        row.ingredient_id || '', row.ingredient_name || '',
        pricePerUnit, pricePerKg, pricePerKgUsd,
        row.currency || currency || 'USD',
        weightUnit, row.price_basis || 'per_unit',
        row.supplier || null, row.effective_date || null,
        exchangeRate, now
      );
      inserted++;
    }

    db.close();
    ok(res, { submission_id: submissionId, rows_inserted: inserted, status: 'pending_review' });
  } catch(e) { err(res, e); }
});

// ── GET /v1/prices/submissions — list all submissions ─────────
router.get('/submissions', (req, res) => {
  try {
    const { status } = req.query;
    const db = getMillDb();
    let query = `
      SELECT ps.*, COUNT(ip.id) as row_count,
             SUM(CASE WHEN ip.status='approved' THEN 1 ELSE 0 END) as approved_count,
             SUM(CASE WHEN ip.status='rejected' THEN 1 ELSE 0 END) as rejected_count,
             SUM(CASE WHEN ip.status='pending_review' THEN 1 ELSE 0 END) as pending_count
      FROM price_submissions ps
      LEFT JOIN ingredient_prices ip ON ip.submission_id = ps.id
    `;
    const params = [];
    if (status) { query += ' WHERE ps.status = ?'; params.push(status); }
    query += ' GROUP BY ps.id ORDER BY ps.submitted_at DESC';
    const rows = db.prepare(query).all(...params);
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ── GET /v1/prices/submissions/:id — single submission + rows ─
router.get('/submissions/:id', (req, res) => {
  try {
    const db = getMillDb();
    const submission = db.prepare('SELECT * FROM price_submissions WHERE id = ?').get(req.params.id);
    if (!submission) return err(res, new Error('Submission not found'), 404);
    const rows = db.prepare('SELECT * FROM ingredient_prices WHERE submission_id = ? ORDER BY ingredient_name').all(req.params.id);
    db.close();
    ok(res, { ...submission, rows });
  } catch(e) { err(res, e); }
});

// ── GET /v1/prices/pending — pending review items ─────────────
router.get('/pending', (req, res) => {
  try {
    const db = getMillDb();
    const rows = db.prepare(`
      SELECT ip.*, ps.batch_name, ps.submitted_by, ps.submitted_at, ps.source, ps.currency as batch_currency
      FROM ingredient_prices ip
      JOIN price_submissions ps ON ps.id = ip.submission_id
      WHERE ip.status = 'pending_review'
      ORDER BY ps.submitted_at DESC, ip.ingredient_name ASC
    `).all();
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/prices/:id/approve — approve a price row ────────
router.patch('/:id/approve', (req, res) => {
  try {
    const { approved_by, price_per_kg_override, exchange_rate } = req.body;
    const db = getMillDb();
    const row = db.prepare('SELECT * FROM ingredient_prices WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Price row not found'), 404);

    const now = new Date().toISOString();
    const finalPricePerKg = price_per_kg_override || row.price_per_kg;
    const finalExchangeRate = exchange_rate || row.exchange_rate || 1.0;
    const finalPricePerKgUsd = finalPricePerKg ? finalPricePerKg / finalExchangeRate : null;

    db.prepare(`
      UPDATE ingredient_prices
      SET status='approved', approved_by=?, approved_at=?,
          price_per_kg=?, price_per_kg_usd=?, exchange_rate=?
      WHERE id=?
    `).run(approved_by || 'nutritionist', now, finalPricePerKg, finalPricePerKgUsd, finalExchangeRate, req.params.id);

    // Update mill_ingredient_catalogue with latest approved price
    db.prepare(`
      UPDATE mill_ingredient_catalogue
      SET price_per_kg=?, currency=?, price_updated_at=?
      WHERE ingredient_id=?
    `).run(finalPricePerKg, row.currency, now, row.ingredient_id);

    // Update submission status
    const submissionRows = db.prepare('SELECT status FROM ingredient_prices WHERE submission_id=?').all(row.submission_id);
    const allApproved = submissionRows.every(r => r.status === 'approved');
    const someApproved = submissionRows.some(r => r.status === 'approved');
    const newStatus = allApproved ? 'approved' : someApproved ? 'partially_approved' : 'pending_review';
    db.prepare('UPDATE price_submissions SET status=? WHERE id=?').run(newStatus, row.submission_id);

    db.close();
    ok(res, { id: req.params.id, status: 'approved', price_per_kg: finalPricePerKg });
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/prices/:id/reject — reject with note ────────────
router.patch('/:id/reject', (req, res) => {
  try {
    const { rejected_by, rejection_note } = req.body;
    if (!rejection_note) return err(res, new Error('rejection_note is required'), 400);
    const db = getMillDb();
    const row = db.prepare('SELECT * FROM ingredient_prices WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Price row not found'), 404);

    db.prepare(`
      UPDATE ingredient_prices SET status='rejected', rejection_note=?, approved_by=?, approved_at=? WHERE id=?
    `).run(rejection_note, rejected_by || 'nutritionist', new Date().toISOString(), req.params.id);

    const submissionRows = db.prepare('SELECT status FROM ingredient_prices WHERE submission_id=?').all(row.submission_id);
    const allRejected = submissionRows.every(r => r.status === 'rejected');
    const someApproved = submissionRows.some(r => r.status === 'approved');
    const newStatus = allRejected ? 'rejected' : someApproved ? 'partially_approved' : 'pending_review';
    db.prepare('UPDATE price_submissions SET status=? WHERE id=?').run(newStatus, row.submission_id);

    db.close();
    ok(res, { id: req.params.id, status: 'rejected' });
  } catch(e) { err(res, e); }
});

// ── PATCH /v1/prices/:id/update — nutritionist edits price ────
router.patch('/:id/update', (req, res) => {
  try {
    const { price_per_unit, price_per_kg, currency, weight_unit, exchange_rate, updated_by, supplier } = req.body;
    const db = getMillDb();
    const row = db.prepare('SELECT * FROM ingredient_prices WHERE id = ?').get(req.params.id);
    if (!row) return err(res, new Error('Price row not found'), 404);

    const wUnit = weight_unit || row.weight_unit || 'kg';
    const ppu   = price_per_unit != null ? price_per_unit : row.price_per_unit;
    const ppkg  = price_per_kg != null ? price_per_kg : (ppu ? toKgPerUnit(ppu, wUnit) : row.price_per_kg);
    const exRate = exchange_rate || row.exchange_rate || 1.0;
    const ppkgUsd = ppkg ? ppkg / exRate : null;

    db.prepare(`
      UPDATE ingredient_prices
      SET price_per_unit=?, price_per_kg=?, price_per_kg_usd=?,
          currency=?, weight_unit=?, exchange_rate=?, supplier=?,
          status='approved', approved_by=?, approved_at=?
      WHERE id=?
    `).run(ppu, ppkg, ppkgUsd, currency || row.currency, wUnit,
           exRate, supplier || row.supplier,
           updated_by || 'nutritionist', new Date().toISOString(), req.params.id);

    // Update catalogue
    db.prepare(`
      UPDATE mill_ingredient_catalogue SET price_per_kg=?, currency=?, price_updated_at=? WHERE ingredient_id=?
    `).run(ppkg, currency || row.currency, new Date().toISOString(), row.ingredient_id);

    db.close();
    ok(res, { id: req.params.id, price_per_kg: ppkg, status: 'approved' });
  } catch(e) { err(res, e); }
});

// ── POST /v1/prices/direct — nutritionist adds price directly ─
router.post('/direct', (req, res) => {
  try {
    const { ingredient_id, ingredient_name, price_per_unit, price_per_kg,
            currency, weight_unit, exchange_rate, supplier, effective_date, added_by } = req.body;
    if (!ingredient_id) return err(res, new Error('ingredient_id required'), 400);

    const db = getMillDb();
    const now = new Date().toISOString();
    const wUnit = weight_unit || 'kg';
    const ppu   = price_per_unit || price_per_kg || null;
    const ppkg  = price_per_kg || (ppu ? toKgPerUnit(ppu, wUnit) : null);
    const exRate = exchange_rate || 1.0;
    const ppkgUsd = ppkg ? ppkg / exRate : null;
    const ownerUsername = req.nutrixUser || added_by || null;

    // Create auto-approved submission
    const subId = randomUUID();
    db.prepare(`
      INSERT INTO price_submissions (id, batch_name, source, submitted_by, submitted_at, status, currency)
      VALUES (?, ?, 'direct', ?, ?, 'approved', ?)
    `).run(subId, `Direct: ${ingredient_name || ingredient_id}`, ownerUsername || 'nutritionist', now, currency || 'USD');

    const priceId = randomUUID();
    db.prepare(`
      INSERT INTO ingredient_prices
        (id, submission_id, ingredient_id, ingredient_name, price_per_unit, price_per_kg,
         price_per_kg_usd, currency, weight_unit, supplier, effective_date, exchange_rate,
         status, approved_by, approved_at, created_at, owner_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)
    `).run(priceId, subId, ingredient_id, ingredient_name || ingredient_id,
           ppu, ppkg, ppkgUsd, currency || 'USD', wUnit,
           supplier || null, effective_date || null, exRate,
           ownerUsername || 'nutritionist', now, now, ownerUsername);

    // Update catalogue
    db.prepare(`
      UPDATE mill_ingredient_catalogue SET price_per_kg=?, currency=?, price_updated_at=? WHERE ingredient_id=?
    `).run(ppkg, currency || 'USD', now, ingredient_id);

    db.close();
    ok(res, { id: priceId, ingredient_id, price_per_kg: ppkg, status: 'approved' });
  } catch(e) { err(res, e); }
});

// ── GET /v1/prices/current — latest approved price per ingredient (user-scoped)
// User-specific prices (owner_username = req.nutrixUser) take priority over
// global market reference prices (owner_username IS NULL).
router.get('/current', (req, res) => {
  try {
    const { ingredient_id } = req.query;
    const userEmail = req.nutrixUser || null;
    const db = getMillDb();

    // For each ingredient: if the user has their own price, return their latest;
    // otherwise fall back to the latest global (NULL owner) price.
    let query = `
      SELECT ip.ingredient_id, ip.ingredient_name,
             ip.price_per_kg, ip.price_per_kg_usd, ip.currency,
             ip.weight_unit, ip.price_per_unit, ip.exchange_rate,
             ip.supplier, ip.effective_date, ip.approved_at
      FROM ingredient_prices ip
      WHERE ip.status = 'approved'
        AND (ip.owner_username = ? OR ip.owner_username IS NULL)
        AND ip.approved_at = (
          SELECT MAX(ip2.approved_at)
          FROM ingredient_prices ip2
          WHERE ip2.ingredient_id = ip.ingredient_id
            AND ip2.status = 'approved'
            AND CASE
              WHEN EXISTS(
                SELECT 1 FROM ingredient_prices ip3
                WHERE ip3.ingredient_id = ip.ingredient_id
                  AND ip3.status = 'approved'
                  AND ip3.owner_username = ?
              ) THEN ip2.owner_username = ?
              ELSE ip2.owner_username IS NULL
            END
        )
    `;
    const params = [userEmail, userEmail, userEmail];
    if (ingredient_id) { query += ' AND ip.ingredient_id = ?'; params.push(ingredient_id); }
    query += ' ORDER BY ip.ingredient_name';
    const rows = db.prepare(query).all(...params);
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ── ADD THIS ROUTE to prices.route.js ────────────────────────
// Find the existing route:
//   router.get('/history/:ingredient_id', (req, res) => {
// Add this NEW route BEFORE it:
 
router.get('/history', (req, res) => {
  try {
    const { submitted_by, status, ingredient, limit = 100 } = req.query;
    const db = getMillDb();
 
    let query = `
      SELECT
        ip.id,
        ip.ingredient_id   as ingredient_code,
        ip.ingredient_name,
        ip.price_per_unit  as price,
        ROUND(ip.price_per_unit * ip.exchange_rate, 2) as usd_price,
        ip.currency,
        ip.weight_unit,
        ip.exchange_rate,
        ip.supplier,
        ip.effective_date,
        ip.status,
        ip.rejection_note,
        ip.approved_at,
        ip.created_at      as submitted_at,
        ps.batch_name,
        ps.submitted_by,
        ps.source
      FROM ingredient_prices ip
      LEFT JOIN price_submissions ps ON ps.id = ip.submission_id
      WHERE 1=1
    `;
 
    const params = [];
 
    if (submitted_by) {
      query += ' AND ps.submitted_by = ?';
      params.push(submitted_by);
    }
 
    if (status && status !== 'all') {
      query += ' AND ip.status = ?';
      params.push(status);
    }
 
    if (ingredient) {
      query += ' AND (ip.ingredient_name LIKE ? OR ip.ingredient_id LIKE ?)';
      params.push(`%${ingredient}%`, `%${ingredient}%`);
    }
 
    query += ' ORDER BY ip.created_at DESC LIMIT ?';
    params.push(Number(limit));
 
    const rows = db.prepare(query).all(...params);
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ── GET /v1/prices/history/:ingredient_id — price history ─────
router.get('/history/:ingredient_id', (req, res) => {
  try {
    const db = getMillDb();
    const rows = db.prepare(`
      SELECT ip.*, ps.batch_name, ps.submitted_by, ps.source
      FROM ingredient_prices ip
      LEFT JOIN price_submissions ps ON ps.id = ip.submission_id
      WHERE ip.ingredient_id = ? AND ip.status = 'approved'
      ORDER BY ip.approved_at DESC LIMIT 20
    `).all(req.params.ingredient_id);
    db.close();
    ok(res, rows);
  } catch(e) { err(res, e); }
});

// ═══════════════════════════════════════════════════════════════
// ADD TO prices.route.js
// GET /v1/prices/approved-costs
// Returns latest approved USD price per ingredient name
// ═══════════════════════════════════════════════════════════════

// Find in prices.route.js:
// export default router;
//
// Add BEFORE it:

router.get('/approved-costs', (req, res) => {
  try {
    const db = getMillDb();

    // Get latest approved price per ingredient (by ingredient_name, most recent)
    const costs = db.prepare(`
      SELECT
        ip.ingredient_name,
        ip.ingredient_id as ingredient_code,
        ip.price_per_unit,
        ip.price_per_kg_usd,
        ip.currency,
        ip.weight_unit,
        ip.exchange_rate,
        ip.supplier,
        ip.approved_at,
        ROUND(ip.price_per_unit * ip.exchange_rate, 4) as usd_per_unit,
        ROUND(ip.price_per_kg_usd, 4) as usd_per_kg
      FROM ingredient_prices ip
      INNER JOIN (
        SELECT ingredient_name, MAX(approved_at) as latest_approved
        FROM ingredient_prices
        WHERE status = 'approved'
        GROUP BY ingredient_name
      ) latest ON ip.ingredient_name = latest.ingredient_name
                AND ip.approved_at = latest.latest_approved
      WHERE ip.status = 'approved'
      ORDER BY ip.ingredient_name ASC
    `).all();

    // Build a lookup map: ingredient_name (lowercase) -> cost data
    const costMap = {};
    for (const row of costs) {
      const key = (row.ingredient_name || '').toLowerCase().trim();
      costMap[key] = {
        ingredient_name: row.ingredient_name,
        ingredient_code: row.ingredient_code,
        price_per_unit:  row.price_per_unit,
        currency:        row.currency,
        weight_unit:     row.weight_unit,
        usd_per_unit:    row.usd_per_unit,
        usd_per_kg:      row.usd_per_kg || null,
        supplier:        row.supplier,
        approved_at:     row.approved_at,
      };
    }

    // Resolve the price list name. Priority:
    // 1. Most recent approved price whose submission_id links to a price_lists row
    // 2. Most recently published/active price_lists row (prices approved outside the list workflow)
    let priceListName = null;
    try {
      const latestRow = db.prepare(`
        SELECT submission_id FROM ingredient_prices
        WHERE status = 'approved' AND submission_id LIKE 'pricelist_%'
        ORDER BY approved_at DESC LIMIT 1
      `).get();
      if (latestRow) {
        const listId = latestRow.submission_id.replace(/^pricelist_/, '');
        const pl = db.prepare(`SELECT name FROM price_lists WHERE id = ?`).get(listId);
        if (pl) priceListName = pl.name;
      }
      // Fallback: take the most recently created/updated price list regardless of how prices were approved
      if (!priceListName) {
        const pl = db.prepare(`SELECT name FROM price_lists ORDER BY updated_at DESC, created_at DESC LIMIT 1`).get();
        if (pl) priceListName = pl.name;
      }
    } catch { /* price_lists table may not exist — ignore */ }

    db.close();
    res.json({
      ok: true,
      count: costs.length,
      costs,
      cost_map: costMap,
      price_list_name: priceListName,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Purchaser-set ingredient restrictions (max/min %, availability, exclude) ─
function ensureRestrictionsTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS ingredient_restrictions (
    id TEXT PRIMARY KEY,
    mill_id TEXT,
    ingredient_id TEXT,
    ingredient_name TEXT,
    max_pct REAL, min_pct REAL, available_tons REAL,
    excluded INTEGER DEFAULT 0,
    note TEXT, set_by TEXT, status TEXT DEFAULT 'active', updated_at TEXT
  )`).run();
  // Add mill_id to a pre-existing table.
  try { db.prepare('ALTER TABLE ingredient_restrictions ADD COLUMN mill_id TEXT').run(); } catch (_e) { /* exists */ }
}

// GET /v1/prices/restrictions — active restrictions (Multimix/formulation).
//   ?all=1 returns drafts too (for the purchaser screen).
router.get('/restrictions', (req, res) => {
  try {
    const db = getMillDb();
    ensureRestrictionsTable(db);
    const millId = req.query.mill_id;
    const params = [];
    let sql = 'SELECT * FROM ingredient_restrictions WHERE 1=1';
    if (req.query.all !== '1') sql += " AND status='active'";
    if (millId) { sql += " AND (mill_id = ? OR mill_id IS NULL OR mill_id = '')"; params.push(millId); }
    sql += ' ORDER BY ingredient_name';
    const rows = db.prepare(sql).all(...params);
    db.close();
    ok(res, rows);
  } catch (e) { err(res, e); }
});

// PATCH /v1/prices/restrictions/apply?mill_id= — publish drafts (optionally for one plant)
router.patch('/restrictions/apply', (req, res) => {
  try {
    const db = getMillDb();
    ensureRestrictionsTable(db);
    const millId = req.query.mill_id || (req.body && req.body.mill_id);
    let r;
    if (millId) {
      r = db.prepare("UPDATE ingredient_restrictions SET status='active', updated_at=? WHERE status='draft' AND mill_id=?")
        .run(new Date().toISOString(), millId);
    } else {
      r = db.prepare("UPDATE ingredient_restrictions SET status='active', updated_at=? WHERE status='draft'")
        .run(new Date().toISOString());
    }
    db.close();
    ok(res, { applied: r.changes });
  } catch (e) { err(res, e); }
});

// POST /v1/prices/restrictions — upsert one ingredient's restriction (by name)
router.post('/restrictions', (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.ingredient_name || '').trim();
    if (!name) return err(res, new Error('ingredient_name is required'), 400);
    const db = getMillDb();
    ensureRestrictionsTable(db);
    const now = new Date().toISOString();
    const millId = b.mill_id || null;
    const num = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);
    const existing = db.prepare('SELECT id FROM ingredient_restrictions WHERE lower(ingredient_name) = lower(?) AND IFNULL(mill_id,"") = IFNULL(?,"")').get(name, millId);
    if (existing) {
      // Editing reverts to draft so it must be re-applied.
      db.prepare(`UPDATE ingredient_restrictions SET ingredient_id=?, max_pct=?, min_pct=?, available_tons=?, excluded=?, note=?, set_by=?, status='draft', updated_at=? WHERE id=?`)
        .run(b.ingredient_id || null, num(b.max_pct), num(b.min_pct), num(b.available_tons), b.excluded ? 1 : 0, b.note || null, b.set_by || 'purchaser', now, existing.id);
      db.close();
      return ok(res, { id: existing.id, updated: true });
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO ingredient_restrictions (id, mill_id, ingredient_id, ingredient_name, max_pct, min_pct, available_tons, excluded, note, set_by, status, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?)`)
      .run(id, millId, b.ingredient_id || null, name, num(b.max_pct), num(b.min_pct), num(b.available_tons), b.excluded ? 1 : 0, b.note || null, b.set_by || 'purchaser', now);
    db.close();
    ok(res, { id, created: true });
  } catch (e) { err(res, e); }
});

// DELETE /v1/prices/restrictions/:id
router.delete('/restrictions/:id', (req, res) => {
  try {
    const db = getMillDb();
    ensureRestrictionsTable(db);
    db.prepare('DELETE FROM ingredient_restrictions WHERE id = ?').run(req.params.id);
    db.close();
    ok(res, { deleted: req.params.id });
  } catch (e) { err(res, e); }
});

export default router;
