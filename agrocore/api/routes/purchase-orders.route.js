// ============================================================
// NutriPilot — Purchase Order Routes
// nutripilot-agrocore/agrocore/api/routes/purchase-orders.route.js
// ============================================================
import express from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import pdfParse from 'pdf-parse';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const require   = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Database  = require('better-sqlite3');
const { randomUUID } = require('crypto');

const router = express.Router();

// All purchaser/supplier endpoints belong to the VendorPulse module.
import { requireModule } from '../middleware/requireModule.js';
router.use(requireModule('vendorpulse'));

function getMillDb() {
  const dbPath = require('path').join(process.cwd(), 'data', 'mill.db');
  return new Database(dbPath);
}

const ok  = (res, data)      => res.json({ ok: true, data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// ── Ensure PO tables exist ────────────────────────────────────────────────────
function ensurePOTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id              TEXT PRIMARY KEY,
      po_number       TEXT UNIQUE NOT NULL,
      supplier_id     TEXT,
      supplier_name   TEXT NOT NULL,
      status          TEXT DEFAULT 'draft',
      -- draft | submitted | approved | received | rejected
      total_usd       REAL DEFAULT 0,
      delivery_date   TEXT,
      notes           TEXT,
      submitted_by    TEXT,
      submitted_at    TEXT,
      approved_by     TEXT,
      approved_at     TEXT,
      received_by     TEXT,
      received_at     TEXT,
      rejected_by     TEXT,
      rejected_at     TEXT,
      rejection_note  TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id              TEXT PRIMARY KEY,
      po_id           TEXT NOT NULL,
      ingredient_id   TEXT,
      ingredient_name TEXT NOT NULL,
      ingredient_code TEXT,
      quantity        REAL NOT NULL,
      unit            TEXT DEFAULT 'mt',
      agreed_price    REAL,
      currency        TEXT DEFAULT 'USD',
      exchange_rate   REAL DEFAULT 1,
      usd_price       REAL,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
    );

    CREATE TABLE IF NOT EXISTS purchaser_suppliers (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      country         TEXT,
      currency        TEXT DEFAULT 'USD',
      contact_name    TEXT,
      contact_email   TEXT,
      contact_phone   TEXT,
      payment_terms   TEXT,
      rating          INTEGER DEFAULT 3,
      active_contracts INTEGER DEFAULT 0,
      total_pos       INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'active',
      preferred_ingredients TEXT,  -- JSON array
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_contracts (
      id              TEXT PRIMARY KEY,
      supplier_id     TEXT NOT NULL,
      supplier_name   TEXT NOT NULL,
      contract_name   TEXT NOT NULL,
      contract_type   TEXT DEFAULT 'supply',
      start_date      TEXT NOT NULL,
      expiry_date     TEXT NOT NULL,
      value_usd       REAL,
      currency        TEXT DEFAULT 'USD',
      payment_terms   TEXT,
      notes           TEXT,
      file_name       TEXT,
      file_url        TEXT,
      created_by      TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES purchaser_suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchaser_notifications (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      message         TEXT NOT NULL,
      read            INTEGER DEFAULT 0,
      action_url      TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_po_status      ON purchase_orders(status);
    CREATE INDEX IF NOT EXISTS idx_po_supplier    ON purchase_orders(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_po_lines_po    ON purchase_order_lines(po_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_sup  ON supplier_contracts(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_notif_read     ON purchaser_notifications(read);
  `);
}

// ── Generate PO number ────────────────────────────────────────────────────────
function generatePONumber(db) {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM purchase_orders
  `).get();
  const next = (row.cnt || 0) + 1;
  return `PO-${String(next).padStart(4, '0')}`;
}

// ── Calculate total USD ───────────────────────────────────────────────────────
function calcTotalUSD(lines) {
  return lines.reduce((sum, l) => {
    const usd = l.usd_price || (l.agreed_price || 0) * (l.exchange_rate || 1);
    return sum + (usd * (l.quantity || 0));
  }, 0);
}

// ════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ════════════════════════════════════════════════════════════════

// GET /v1/purchase-orders
router.get('/purchase-orders', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const { status, supplier_id } = req.query;

    let query = 'SELECT * FROM purchase_orders';
    const params = [];
    const conditions = [];

    if (status)      { conditions.push('status = ?');      params.push(status); }
    if (supplier_id) { conditions.push('supplier_id = ?'); params.push(supplier_id); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC';

    const pos = db.prepare(query).all(...params);

    // Attach lines to each PO
    const result = pos.map(po => {
      const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE po_id = ?').all(po.id);
      return { ...po, lines };
    });

    db.close();
    ok(res, result);
  } catch(e) { err(res, e); }
});



// POST /v1/purchase-orders
router.post('/purchase-orders', (req, res) => {
  try {
    const { supplier_id, supplier_name, delivery_date, notes, submitted_by, lines = [] } = req.body;
    if (!supplier_name) return err(res, new Error('supplier_name required'), 400);

    const db = getMillDb();
    ensurePOTables(db);

    const id        = randomUUID();
    const po_number = generatePONumber(db);
    const now       = new Date().toISOString();
    const totalUSD  = calcTotalUSD(lines);

    db.prepare(`
      INSERT INTO purchase_orders
        (id, po_number, supplier_id, supplier_name, status, total_usd,
         delivery_date, notes, submitted_by, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, po_number, supplier_id || null, supplier_name,
           totalUSD, delivery_date || null, notes || null,
           submitted_by || 'purchaser', now, now, now);

    const insertLine = db.prepare(`
      INSERT INTO purchase_order_lines
        (id, po_id, ingredient_id, ingredient_name, ingredient_code,
         quantity, unit, agreed_price, currency, exchange_rate, usd_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const line of lines) {
      const usdPrice = (line.agreed_price || 0) * (line.exchange_rate || 1);
      insertLine.run(
        randomUUID(), id,
        line.ingredient_id || null,
        line.ingredient_name || '',
        line.ingredient_code || null,
        line.quantity || 0,
        line.unit || 'mt',
        line.agreed_price || null,
        line.currency || 'USD',
        line.exchange_rate || 1,
        usdPrice || null,
        line.notes || null
      );
    }

    // Auto-notify
    db.prepare(`
      INSERT INTO purchaser_notifications (id, type, title, message, created_at)
      VALUES (?, 'po_update', 'PO Submitted', ?, ?)
    `).run(randomUUID(), `${po_number} submitted to ${supplier_name} — ${lines.length} line(s).`, now);

    db.close();
    ok(res, { id, po_number, status: 'submitted', total_usd: totalUSD, lines_inserted: lines.length });
  } catch(e) { err(res, e); }
});

// PATCH /v1/purchase-orders/:id/approve
router.patch('/purchase-orders/:id/approve', (req, res) => {
  try {
    const { approved_by } = req.body;
    const db = getMillDb();
    ensurePOTables(db);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return err(res, new Error('PO not found'), 404);
    if (!['submitted', 'draft'].includes(po.status)) {
      return err(res, new Error(`Cannot approve PO with status: ${po.status}`), 400);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE purchase_orders
      SET status='approved', approved_by=?, approved_at=?, updated_at=?
      WHERE id=?
    `).run(approved_by || 'manager', now, now, req.params.id);

    db.prepare(`
      INSERT INTO purchaser_notifications (id, type, title, message, created_at)
      VALUES (?, 'approval', 'PO Approved', ?, ?)
    `).run(randomUUID(), `${po.po_number} approved by ${approved_by || 'manager'}.`, now);

    db.close();
    ok(res, { id: req.params.id, po_number: po.po_number, status: 'approved' });
  } catch(e) { err(res, e); }
});

// PATCH /v1/purchase-orders/:id/reject
router.patch('/purchase-orders/:id/reject', (req, res) => {
  try {
    const { rejected_by, rejection_note } = req.body;
    if (!rejection_note) return err(res, new Error('rejection_note required'), 400);
    const db = getMillDb();
    ensurePOTables(db);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return err(res, new Error('PO not found'), 404);

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE purchase_orders
      SET status='rejected', rejected_by=?, rejected_at=?, rejection_note=?, updated_at=?
      WHERE id=?
    `).run(rejected_by || 'manager', now, rejection_note, now, req.params.id);

    db.prepare(`
      INSERT INTO purchaser_notifications (id, type, title, message, created_at)
      VALUES (?, 'rejection', 'PO Rejected', ?, ?)
    `).run(randomUUID(), `${po.po_number} rejected. Note: ${rejection_note}`, now);

    db.close();
    ok(res, { id: req.params.id, po_number: po.po_number, status: 'rejected' });
  } catch(e) { err(res, e); }
});

// PATCH /v1/purchase-orders/:id/receive
router.patch('/purchase-orders/:id/receive', (req, res) => {
  try {
    const { received_by, notes } = req.body;
    const db = getMillDb();
    ensurePOTables(db);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return err(res, new Error('PO not found'), 404);
    if (po.status !== 'approved') {
      return err(res, new Error(`Cannot receive PO with status: ${po.status}`), 400);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE purchase_orders
      SET status='received', received_by=?, received_at=?,
          notes=COALESCE(?, notes), updated_at=?
      WHERE id=?
    `).run(received_by || 'warehouse', notes || null, now, req.params.id);

    db.prepare(`
      INSERT INTO purchaser_notifications (id, type, title, message, created_at)
      VALUES (?, 'po_update', 'Goods Received', ?, ?)
    `).run(randomUUID(), `${po.po_number} — goods received by ${received_by || 'warehouse'}.`, now);

    db.close();
    ok(res, { id: req.params.id, po_number: po.po_number, status: 'received' });
  } catch(e) { err(res, e); }
});

// DELETE /v1/purchase-orders/:id  (draft only)
router.delete('/purchase-orders/:id', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return err(res, new Error('PO not found'), 404);
    if (po.status !== 'draft') return err(res, new Error('Only draft POs can be deleted'), 400);

    db.prepare('DELETE FROM purchase_order_lines WHERE po_id = ?').run(req.params.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
    db.close();
    ok(res, { deleted: req.params.id });
  } catch(e) { err(res, e); }
});

// ════════════════════════════════════════════════════════════════
// SUPPLIERS
// ════════════════════════════════════════════════════════════════

// GET /v1/suppliers
router.get('/suppliers', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const suppliers = db.prepare('SELECT * FROM purchaser_suppliers ORDER BY name').all();
    db.close();
    ok(res, suppliers.map(s => ({
      ...s,
      preferred_ingredients: s.preferred_ingredients ? JSON.parse(s.preferred_ingredients) : []
    })));
  } catch(e) { err(res, e); }
});

// POST /v1/suppliers
router.post('/suppliers', (req, res) => {
  try {
    const { name, country, currency, contact_name, contact_email,
            contact_phone, payment_terms, rating, status, preferred_ingredients } = req.body;
    if (!name) return err(res, new Error('name required'), 400);

    const db = getMillDb();
    ensurePOTables(db);
    const id  = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO purchaser_suppliers
        (id, name, country, currency, contact_name, contact_email, contact_phone,
         payment_terms, rating, status, preferred_ingredients, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, country || null, currency || 'USD',
           contact_name || null, contact_email || null, contact_phone || null,
           payment_terms || null, rating || 3, status || 'active',
           preferred_ingredients ? JSON.stringify(preferred_ingredients) : null,
           now, now);

    db.close();
    ok(res, { id, name, status: 'active' });
  } catch(e) { err(res, e); }
});

// PUT /v1/suppliers/:id
router.put('/suppliers/:id', (req, res) => {
  try {
    const { name, country, currency, contact_name, contact_email,
            contact_phone, payment_terms, rating, status, preferred_ingredients } = req.body;
    const db = getMillDb();
    ensurePOTables(db);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE purchaser_suppliers SET
        name=?, country=?, currency=?, contact_name=?, contact_email=?,
        contact_phone=?, payment_terms=?, rating=?, status=?,
        preferred_ingredients=?, updated_at=?
      WHERE id=?
    `).run(name, country || null, currency || 'USD',
           contact_name || null, contact_email || null, contact_phone || null,
           payment_terms || null, rating || 3, status || 'active',
           preferred_ingredients ? JSON.stringify(preferred_ingredients) : null,
           now, req.params.id);

    db.close();
    ok(res, { id: req.params.id, updated: true });
  } catch(e) { err(res, e); }
});

// ════════════════════════════════════════════════════════════════
// CONTRACTS
// ════════════════════════════════════════════════════════════════

// GET /v1/suppliers/contracts
router.get('/suppliers/contracts', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const contracts = db.prepare(`
      SELECT * FROM supplier_contracts ORDER BY expiry_date ASC
    `).all();
    db.close();
    ok(res, contracts);
  } catch(e) { err(res, e); }
});

// POST /v1/suppliers/contracts
router.post('/suppliers/contracts', (req, res) => {
  try {
    const { supplier_id, supplier_name, contract_name, contract_type,
            start_date, expiry_date, value_usd, currency, payment_terms,
            notes, file_name, file_url, created_by } = req.body;

    if (!supplier_name || !contract_name || !expiry_date) {
      return err(res, new Error('supplier_name, contract_name, expiry_date required'), 400);
    }

    const db = getMillDb();
    ensurePOTables(db);
    const id  = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO supplier_contracts
        (id, supplier_id, supplier_name, contract_name, contract_type,
         start_date, expiry_date, value_usd, currency, payment_terms,
         notes, file_name, file_url, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, supplier_id || null, supplier_name, contract_name,
           contract_type || 'supply', start_date || now.split('T')[0],
           expiry_date, value_usd || null, currency || 'USD',
           payment_terms || null, notes || null,
           file_name || null, file_url || null,
           created_by || 'purchaser', now);

    db.close();
    ok(res, { id, contract_name, status: 'saved' });
  } catch(e) { err(res, e); }
});

// ════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════

// GET /v1/notifications
router.get('/notifications', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const notifications = db.prepare(`
      SELECT * FROM purchaser_notifications ORDER BY created_at DESC LIMIT 50
    `).all();
    db.close();
    ok(res, notifications.map(n => ({ ...n, read: n.read === 1 })));
  } catch(e) { err(res, e); }
});

// POST /v1/notifications/mark-read
router.post('/notifications/mark-read', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    db.prepare('UPDATE purchaser_notifications SET read = 1').run();
    db.close();
    ok(res, { marked_read: true });
  } catch(e) { err(res, e); }
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════

// GET /v1/purchaser/dashboard
router.get('/purchaser/dashboard', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);

    const open_pos = db.prepare(`
      SELECT COUNT(*) as cnt FROM purchase_orders WHERE status IN ('draft','submitted','approved')
    `).get().cnt;

    const pending_approvals = db.prepare(`
      SELECT COUNT(*) as cnt FROM ingredient_prices WHERE status = 'pending_review'
    `).get().cnt;

    const active_suppliers = db.prepare(`
      SELECT COUNT(*) as cnt FROM purchaser_suppliers WHERE status = 'active'
    `).get().cnt;

    const activity = db.prepare(`
      SELECT type, message, created_at as time FROM purchaser_notifications
      ORDER BY created_at DESC LIMIT 8
    `).all().map(n => ({
      ...n,
      id: randomUUID(),
      icon: n.type === 'approval' ? '✓'
          : n.type === 'rejection' ? '✗'
          : n.type === 'po_update' ? '⊞'
          : '◉'
    }));

    db.close();
    ok(res, {
      open_pos,
      pending_approvals,
      active_suppliers,
      avg_price_change: '+3.2%',
      open_pos_delta:   `${open_pos} active`,
      pending_delta:    pending_approvals > 5 ? `${pending_approvals} waiting` : 'On track',
      supplier_delta:   `${active_suppliers} active`,
      activity,
      price_alerts: []
    });
  } catch(e) { err(res, e); }
});

// GET /v1/purchase-orders/:id
router.get('/purchase-orders/:id', (req, res) => {
  try {
    const db = getMillDb();
    ensurePOTables(db);
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return err(res, new Error('PO not found'), 404);
    const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE po_id = ?').all(po.id);
    db.close();
    ok(res, { ...po, lines });
  } catch(e) { err(res, e); }
});


// ── 2. ADD THESE HELPER FUNCTIONS (add before the routes) ────────

const CURRENCY_PATTERNS = [
  { code: 'USD', patterns: [/\bUSD\b/i, /\$(?!\d*\.\d*%)/] },
  { code: 'PKR', patterns: [/\bPKR\b/i, /\bRs\.?\b/i] },
  { code: 'AED', patterns: [/\bAED\b/i, /\bDhs?\b/i] },
  { code: 'SAR', patterns: [/\bSAR\b/i, /\bSR\b/i] },
  { code: 'EUR', patterns: [/\bEUR\b/i, /€/] },
  { code: 'GBP', patterns: [/\bGBP\b/i, /£/] },
  { code: 'INR', patterns: [/\bINR\b/i] },
  { code: 'IDR', patterns: [/\bIDR\b/i, /\bRp\b/i] },
  { code: 'BDT', patterns: [/\bBDT\b/i] },
  { code: 'NGN', patterns: [/\bNGN\b/i, /₦/] },
  { code: 'BRL', patterns: [/\bBRL\b/i, /R\$/] },
  { code: 'CAD', patterns: [/\bCAD\b/i] },
  { code: 'AUD', patterns: [/\bAUD\b/i] },
];

const UNIT_PATTERNS = [
  { code: 'mt',       patterns: [/\bM\.?T\.?\b/i, /\bmetric\s*ton/i, /\/mt\b/i, /\bton\b/i] },
  { code: 'kg',       patterns: [/\bkg\b/i, /\/kg\b/i, /\bkilogram/i] },
  { code: 'lb',       patterns: [/\blb\b/i, /\bpound/i] },
  { code: 'bag_50kg', patterns: [/\b50\s*kg\s*bag/i, /bag\s*50/i] },
  { code: 'bag_40kg', patterns: [/\b40\s*kg\s*bag/i, /bag\s*40/i] },
  { code: 'maund',    patterns: [/\bmaund\b/i, /\bmn\b/i] },
  { code: 'quintal',  patterns: [/\bquintal\b/i, /\bqtl\b/i] },
  { code: 'cwt',      patterns: [/\bcwt\b/i, /\bhundredweight\b/i] },
];

const JUNK_LINES = [
  /^(date|remarks|note|total|subtotal|tax|vat|gst|discount|page|ref|invoice|quotation|price\s*list|dear|regards|sincerely|attached|please|thank|contact|email|phone|www|http)/i,
  /^[\d\s\-\/]+$/, // pure numbers/dates
  /^[^a-z]{0,3}$/i, // too short or no letters
];

function detectCurrency(text) {
  for (const { code, patterns } of CURRENCY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return code;
    }
  }
  return null;
}

function detectUnit(text) {
  for (const { code, patterns } of UNIT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return code;
    }
  }
  return null;
}

function isJunkLine(line) {
  return JUNK_LINES.some(p => p.test(line.trim()));
}

function parsePrice(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPricesFromText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const fullText       = lines.join(' ');
  const globalCurrency = detectCurrency(fullText) || 'USD';
  const globalUnit     = /metric\s*ton|\/mt\b|\bMT\b/i.test(fullText) ? 'mt' : detectUnit(fullText) || 'mt';

  const results = [];
  const seen    = new Set();
  let sectionCurrency = globalCurrency;

  for (const line of lines) {
    // Track section currency
    const curr = detectCurrency(line);
    if (curr) sectionCurrency = curr;

    // Must start with a digit (row number)
    if (!/^\d/.test(line)) continue;

    // Find ingredient code: exactly [A-Z]{2,4} followed by exactly 3 digits
    // e.g. CRN001, SBM002, FSH003, LMS007
    const codeMatch = line.match(/([A-Z]{3})(\d{3})(?=[\d,])/);
    if (!codeMatch) continue;

    const code     = codeMatch[1] + codeMatch[2];
    const codeIdx  = line.indexOf(code);

    // Name is everything between the leading digit and the code
    let name = line.substring(0, codeIdx)
      .replace(/^\d{1,3}/, '') // remove row number
      .replace(/\s*[A-Z]{1,2}$/, '') // remove trailing partial code letters (e.g. "CP" from "48% CP")
      .trim();

    if (!name || name.length < 3) continue;

    // Price is right after the code
    const afterCode  = line.substring(codeIdx + code.length);
    const priceMatch = afterCode.match(/^(\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?|\d+\.\d{1,4})/);
    if (!priceMatch) continue;

    const price = parsePrice(priceMatch[1]);
    if (!price || price <= 0 || price > 9999999) continue;

    // Date
    const dateMatch = line.match(/(\d{2}-[A-Za-z]{3}-\d{4})/);

    const key = `${name.toLowerCase()}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      ingredient_name: name.replace(/\s+/g, ' ').trim(),
      ingredient_code: code,
      price,
      currency:        sectionCurrency,
      unit: globalUnit,
      effective_date:  dateMatch ? dateMatch[1] : '',
      supplier:        '',
      notes:           '',
      source_line:     line,
    });
  }

  return {
    rows:            results,
    global_currency: globalCurrency,
    global_unit:     globalUnit,
    total_lines:     lines.length,
    matched_rows:    results.length,
  };
}

// ── 3. ADD THIS ROUTE (add near other routes in purchase-orders.route.js) ────

// POST /v1/prices/parse-pdf
router.post('/prices/parse-pdf', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return err(res, new Error('No file uploaded. Field name must be "file"'), 400);

    // Detect file type
    let detected = null;
    try { detected = await fileTypeFromBuffer(file.buffer); } catch {}

    const mime     = detected?.mime || file.mimetype || '';
    const ext      = detected?.ext  || '';
    const filename = file.originalname || 'upload.pdf';

    const isPdf = mime === 'application/pdf' || ext === 'pdf' || filename.endsWith('.pdf');
    if (!isPdf) return err(res, new Error(`Expected PDF, got: ${mime || 'unknown'}`), 400);

    // Parse PDF text
    let text = '';
    try {
      const pdf = await pdfParse(file.buffer);
      text = pdf?.text || '';
    } catch (pdfErr) {
      return err(res, new Error(`PDF parse failed: ${pdfErr?.message}`), 400);
    }

    if (!text.trim()) {
      return res.json({
        ok: true,
        data: { rows: [], global_currency: 'USD', global_unit: 'mt', total_lines: 0, matched_rows: 0 },
        message: 'PDF was readable but contained no extractable text (may be scanned image).',
        filename,
      });
    }

    const result = extractPricesFromText(text);

    ok(res, {
      ...result,
      filename,
      text_length: text.length,
    });

  } catch (e) { err(res, e); }
});

export default router;