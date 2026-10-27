// ============================================================
// Feed Mill Intelligence Engine â€” Weighbridge Service
// nutripilot-agrocore/core/services/mill/mill.weighbridge.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { lookupIngredientPrice } = require('./mill.price.service.cjs');
const { randomUUID } = require('crypto');

// Stock and receipts use this mill's weight_unit (kg, lb, g…). No hidden kg conversion.

function millWeightUnit(mill_id) {
  const db = getMillDb();
  try {
    const row = db.prepare('SELECT weight_unit FROM mill_configurations WHERE id = ?').get(mill_id);
    if (row?.weight_unit) return String(row.weight_unit);
  } catch (_e) {}
  return 'kg';
}

/** Identity — mill stock stays in mill.weight_unit. Do not convert to kg. */
function toKg(value, _unit) {
  return Number(value) || 0;
}
function fromKg(value, _unit) {
  return Number(value) || 0;
}
function formatWeight(value, unit) {
  const n = Number(value) || 0;
  return { value: n, unit: unit || 'kg', raw_kg: n };
}

function ensureGateSchema(db) {
  for (const [col, def] of [
    ['lot_number', 'TEXT'],
    ['photo_path', 'TEXT'],
    ['photo_data', 'TEXT'],
    ['gate_status', 'TEXT'],
    ['gate_missing', 'TEXT'],
    ['gate_override_by', 'TEXT'],
    ['gate_override_reason', 'TEXT']
  ]) {
    try { db.exec(`ALTER TABLE mill_weighbridge_receipts ADD COLUMN ${col} ${def}`); } catch (_e) {}
  }
}

/** Truck cannot enter inventory without weight + moisture + photo + lot ID. */
function evaluateInboundGate({ mill_mass, moisture_pct, lot_number, photo_data, photo_path }) {
  const missing = [];
  if (!(Number(mill_mass) > 0)) missing.push('weight');
  const moisture = Number(moisture_pct);
  if (!Number.isFinite(moisture) || moisture < 0 || moisture > 45) missing.push('moisture');
  if (!String(lot_number || '').trim()) missing.push('lot');
  const photo = String(photo_data || photo_path || '').trim();
  if (!photo) missing.push('photo');
  return { ok: missing.length === 0, missing };
}

function writeGateStamp(db, receipt_id, fields) {
  ensureGateSchema(db);
  const row = db.prepare('SELECT * FROM mill_weighbridge_receipts WHERE id = ?').get(receipt_id);
  if (!row) return null;
  if (fields.photo_data && String(fields.photo_data).length > 1200000) {
    fields.photo_data = null;
  }
  db.prepare(`
    UPDATE mill_weighbridge_receipts SET
      lot_number = ?,
      moisture_pct = ?,
      photo_data = ?,
      photo_path = ?,
      gate_status = ?,
      gate_missing = ?,
      gate_override_by = ?,
      gate_override_reason = ?,
      qc_status = ?
    WHERE id = ?
  `).run(
    fields.lot_number != null ? String(fields.lot_number) : row.lot_number,
    fields.moisture_pct != null && fields.moisture_pct !== '' ? Number(fields.moisture_pct) : row.moisture_pct,
    fields.photo_data != null ? String(fields.photo_data) : row.photo_data,
    fields.photo_path != null ? String(fields.photo_path) : row.photo_path,
    fields.gate_status || row.gate_status,
    fields.gate_missing != null ? (Array.isArray(fields.gate_missing) ? fields.gate_missing.join(',') : String(fields.gate_missing)) : row.gate_missing,
    fields.gate_override_by != null ? String(fields.gate_override_by) : row.gate_override_by,
    fields.gate_override_reason != null ? String(fields.gate_override_reason) : row.gate_override_reason,
    fields.qc_status || row.qc_status,
    receipt_id
  );
  return db.prepare('SELECT * FROM mill_weighbridge_receipts WHERE id = ?').get(receipt_id);
}

function finalizeReceiptGate(receipt_id, extra = {}) {
  const db = getMillDb();
  ensureGateSchema(db);
  const row = db.prepare('SELECT * FROM mill_weighbridge_receipts WHERE id = ?').get(receipt_id);
  if (!row) return { ok: false, error: 'Receipt not found' };

  const mill_mass = Number(row.mill_mass || 0);
  const gate = evaluateInboundGate({
    mill_mass,
    moisture_pct: extra.moisture_pct != null ? extra.moisture_pct : row.moisture_pct,
    lot_number: extra.lot_number != null ? extra.lot_number : row.lot_number,
    photo_data: extra.photo_data != null ? extra.photo_data : row.photo_data,
    photo_path: extra.photo_path != null ? extra.photo_path : row.photo_path
  });

  const override = !!(extra.force_post && String(extra.override_reason || '').trim());
  if (gate.ok || override) {
    if (!row.inventory_updated) {
      const posted = postReceiptToInventory(
        receipt_id, row.mill_id, row.ingredient_id, row.ingredient_name, mill_mass, row.receipt_date,
        {
          lot_number: extra.lot_number != null ? extra.lot_number : row.lot_number,
          price: row.price_per_unit,
          supplier_name: row.supplier_name,
          storage_bin: row.storage_bin,
          moisture_pct: extra.moisture_pct != null ? extra.moisture_pct : row.moisture_pct,
          protein_pct: extra.protein_pct != null ? extra.protein_pct : row.protein_pct
        }
      );
      if (!posted.ok) return { ok: false, error: posted.error || 'Inventory post failed', gate };
    }
    writeGateStamp(db, receipt_id, {
      ...extra,
      gate_status: override && !gate.ok ? 'override' : 'posted',
      gate_missing: [],
      gate_override_by: override ? (extra.override_by || extra.received_by || 'manager') : null,
      gate_override_reason: override ? extra.override_reason : null,
      qc_status: 'accepted'
    });
    return {
      ok: true,
      receipt_id,
      inventory_posted: true,
      gate_status: override && !gate.ok ? 'override' : 'posted',
      missing: [],
      gate
    };
  }

  writeGateStamp(db, receipt_id, {
    ...extra,
    gate_status: 'held',
    gate_missing: gate.missing,
    qc_status: 'held'
  });
  return {
    ok: true,
    receipt_id,
    inventory_posted: false,
    gate_status: 'held',
    missing: gate.missing,
    error: `Held at gate — missing ${gate.missing.join(', ')}. Truck cannot enter inventory.`,
    gate
  };
}

function completeInboundGate(receipt_id, extra = {}) {
  return finalizeReceiptGate(receipt_id, extra);
}

// â”€â”€ RECORD WEIGHBRIDGE RECEIPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function recordWeighbridgeReceipt({
  mill_id,
  ingredient_id,
  ingredient_name,
  supplier_id       = null,
  supplier_name     = null,
  vehicle_id        = null,
  driver_name       = null,
  gross_weight,
  tare_weight,
  recorded_unit     = null,
  moisture_pct      = null,
  protein_pct       = null,
  storage_bin       = null,
  receipt_date      = null,
  received_by       = null,
  notes             = null,
  receipt_type      = 'weighbridge',
  receipt_number    = null,
  lot_number        = null,
  price_per_unit    = null,
  currency          = 'USD',
  photo_data        = null,
  photo_path        = null,
  force_post        = false,
  override_reason   = null,
  override_by       = null
}) {
  const db = getMillDb();

  const millUnit = millWeightUnit(mill_id);
  recorded_unit = recorded_unit || millUnit;

  if (gross_weight <= tare_weight) {
    return {
      ok: false,
      error: `Gross weight (${gross_weight}) must be greater than tare weight (${tare_weight})`
    };
  }

  const net_weight    = gross_weight - tare_weight;
  const mill_mass     = net_weight;

  if (!price_per_unit) {
    price_per_unit = lookupIngredientPrice(db, mill_id, ingredient_id, ingredient_name);
  }

  const total_cost = price_per_unit ? mill_mass * price_per_unit : null;
  const date          = receipt_date || new Date().toISOString().slice(0, 10);
  const id            = randomUUID();

  db.prepare(`
    INSERT INTO mill_weighbridge_receipts (
      id, mill_id, ingredient_id, ingredient_name,
      supplier_id, supplier_name,
      vehicle_id, driver_name,
      gross_weight, tare_weight,
      recorded_unit, mill_mass,
      receipt_type, price_per_unit, price_unit,
      total_cost, currency,
      moisture_pct, protein_pct,
      qc_status, storage_bin,
      receipt_date, received_by, notes, receipt_number
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      'pending', ?,
      ?, ?, ?, ?
    )
  `).run(
    id, mill_id, ingredient_id, ingredient_name,
    supplier_id, supplier_name,
    vehicle_id, driver_name,
    gross_weight, tare_weight,
    recorded_unit, mill_mass,
    receipt_type, price_per_unit, recorded_unit,
    total_cost, currency,
    moisture_pct, protein_pct,
    storage_bin,
    date, received_by, notes, receipt_number || null
  );

  const gateResult = finalizeReceiptGate(id, {
    lot_number,
    moisture_pct,
    photo_data,
    photo_path,
    force_post,
    override_reason,
    override_by: override_by || received_by
  });

  console.log(`[Weighbridge] Receipt recorded: ${net_weight} ${recorded_unit} ${ingredient_name} gate=${gateResult.gate_status}`);

  return {
    ok: true,
    receipt_id:    id,
    ingredient_name,
    gross_weight,
    tare_weight,
    net_weight,
    mill_mass: mill_mass,
    recorded_unit,
    total_cost,
    inventory_posted: !!gateResult.inventory_posted,
    gate_status: gateResult.gate_status,
    missing: gateResult.missing || [],
    held: gateResult.gate_status === 'held',
    message: gateResult.inventory_posted
      ? 'Posted to stock'
      : (gateResult.error || 'Held at gate')
  };
}

// â”€â”€ RECORD MANUAL RECEIPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// For receipts without a weighbridge â€” direct quantity entry
function recordManualReceipt({
  mill_id,
  ingredient_id,
  ingredient_name,
  quantity,
  unit              = null,
  supplier_id       = null,
  supplier_name     = null,
  price_per_unit    = null,
  currency          = 'USD',
  receipt_date      = null,
  received_by       = null,
  notes             = null,
  lot_number        = null,
  moisture_pct      = null,
  photo_data        = null,
  photo_path        = null,
  force_post        = false,
  override_reason   = null,
  override_by       = null
}) {
  unit = unit || millWeightUnit(mill_id);
  const mill_mass   = Number(quantity) || 0;
  const date        = receipt_date || new Date().toISOString().slice(0, 10);
  const id          = randomUUID();
  const db          = getMillDb();
  if (!price_per_unit) {
    price_per_unit = lookupIngredientPrice(db, mill_id, ingredient_id, ingredient_name);
  }

  db.prepare(`
    INSERT INTO mill_weighbridge_receipts (
      id, mill_id, ingredient_id, ingredient_name,
      supplier_id, supplier_name,
      gross_weight, tare_weight,
      recorded_unit, mill_mass,
      receipt_type, price_per_unit, price_unit,
      total_cost, currency,
      qc_status,
      receipt_date, received_by, notes
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, 0,
      ?, ?,
      'manual', ?, ?,
      ?, ?,
      'accepted',
      ?, ?, ?
    )
  `).run(
    id, mill_id, ingredient_id, ingredient_name,
    supplier_id, supplier_name,
    quantity, 
    unit, mill_mass,
    price_per_unit, unit,
    price_per_unit ? quantity * price_per_unit : null, currency,
    date, received_by, notes
  );

  const gateResult = finalizeReceiptGate(id, {
    lot_number,
    moisture_pct,
    photo_data,
    photo_path,
    force_post,
    override_reason,
    override_by: override_by || received_by
  });

  return {
    ok: true,
    receipt_id:    id,
    ingredient_name,
    quantity,
    quantity_kg: mill_mass,
    unit,
    inventory_posted: !!gateResult.inventory_posted,
    gate_status: gateResult.gate_status,
    missing: gateResult.missing || [],
    held: gateResult.gate_status === 'held',
    message: gateResult.inventory_posted
      ? 'Posted to stock'
      : (gateResult.error || 'Held at gate')
  };
}

// â”€â”€ POST RECEIPT TO INVENTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function postReceiptToInventory(receipt_id, mill_id, ingredient_id, ingredient_name, mill_mass, date, extra = {}) {
  const db = getMillDb();
  const price = extra.price != null ? extra.price : lookupIngredientPrice(db, mill_id, ingredient_id, ingredient_name);

  // Ensure inventory record exists for today
  let inventory = db.prepare(`
    SELECT id FROM mill_inventory
    WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
  `).get(mill_id, ingredient_id, date);

  if (!inventory) {
    // Auto-create inventory record with 0 opening if not exists
    const inv_id = randomUUID();
    db.prepare(`
      INSERT INTO mill_inventory (
        id, mill_id, ingredient_id, ingredient_name, record_date,
        opening, received
      ) VALUES (?, ?, ?, ?, ?, 0, 0)
    `).run(inv_id, mill_id, ingredient_id, ingredient_name, date);
    inventory = { id: inv_id };
  }

  db.prepare(`
    UPDATE mill_inventory
    SET received = COALESCE(received, 0) + ?,
        cost_per_unit = COALESCE(?, cost_per_unit),
        updated_at  = datetime('now')
    WHERE id = ?
  `).run(mill_mass, price, inventory.id);

  if (extra.lot_number) {
    try {
      db.prepare(`
        INSERT INTO mill_supplier_lots (
          id, mill_id, supplier_id, supplier_name, ingredient_id, ingredient_name,
          lot_number, received_date, quantity_kg, price_per_kg, storage_bin, moisture_pct, protein_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), mill_id, extra.supplier_name || 'supplier', extra.supplier_name || 'supplier',
        ingredient_id, ingredient_name || ingredient_id, String(extra.lot_number), date, mill_mass, price, extra.storage_bin || null,
        extra.moisture_pct != null ? Number(extra.moisture_pct) : null,
        extra.protein_pct != null ? Number(extra.protein_pct) : null
      );
    } catch (_e) {}
    try {
      const { applyCoAToLot } = require('./mill.lotlock.service.cjs');
      applyCoAToLot({
        mill_id,
        lot_number: extra.lot_number,
        ingredient_id,
        ingredient_name: ingredient_name || ingredient_id,
        supplier_name: extra.supplier_name,
        moisture_pct: extra.moisture_pct,
        protein_pct: extra.protein_pct
      });
    } catch (_e) {}
  }

  // Mark receipt as posted
  db.prepare(`
    UPDATE mill_weighbridge_receipts
    SET inventory_updated = 1
    WHERE id = ?
  `).run(receipt_id);

  return { ok: true };
}

// â”€â”€ GET RECEIPTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getReceiptsByMill(mill_id, date = null) {
  const db = getMillDb();
  ensureGateSchema(db);
  let rows;
  if (date) {
    rows = db.prepare(`
      SELECT * FROM mill_weighbridge_receipts
      WHERE mill_id = ? AND receipt_date = ?
      ORDER BY created_at DESC
    `).all(mill_id, date);
  } else {
    rows = db.prepare(`
      SELECT * FROM mill_weighbridge_receipts
      WHERE mill_id = ?
      ORDER BY created_at DESC
    `).all(mill_id);
  }
  const receipts = rows.map(r => {
    const { photo_data, ...rest } = r;
    const missing = String(r.gate_missing || '').split(',').map(s => s.trim()).filter(Boolean);
    const status = r.gate_status || (r.inventory_updated ? 'posted' : (missing.length ? 'held' : 'posted'));
    return {
      ...rest,
      has_photo: !!(photo_data || r.photo_path),
      gate_status: status,
      missing,
      held: status === 'held'
    };
  });
  return {
    ok: true,
    mill_id,
    date: date || 'all',
    count: receipts.length,
    held_count: receipts.filter(r => r.held).length,
    posted_count: receipts.filter(r => r.gate_status === 'posted' || r.gate_status === 'override').length,
    receipts
  };
}

// â”€â”€ GET STOCK SNAPSHOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Current stock for all ingredients at a mill
// Returns in mill's preferred unit
function getStockSnapshot(mill_id, display_unit = null, target_date = null) {
  const db   = getMillDb();
  let date = target_date || new Date().toISOString().slice(0, 10);
  const millUnit = millWeightUnit(mill_id);

  const stockSql = `
    SELECT
      i.*,
      CASE
        WHEN i.closing IS NOT NULL AND i.closing > 0 THEN i.closing
        ELSE COALESCE(i.opening,0) + COALESCE(i.received,0) - COALESCE(i.used,0)
      END as current_stock,
      c.min_stock,
      c.max_stock,
      c.reorder_qty,
      c.display_unit as preferred_unit,
      c.lead_time_days
    FROM mill_inventory i
    LEFT JOIN mill_ingredient_catalogue c
      ON i.mill_id = c.mill_id AND i.ingredient_id = c.ingredient_id
    WHERE i.mill_id = ? AND i.record_date = ?
    ORDER BY i.ingredient_name
  `;

  let rows = db.prepare(stockSql).all(mill_id, date);
  if (!rows.length && !target_date) {
    const latest = db.prepare(`SELECT MAX(record_date) as d FROM mill_inventory WHERE mill_id = ?`).get(mill_id);
    if (latest?.d) {
      date = latest.d;
      rows = db.prepare(stockSql).all(mill_id, date);
    }
  }

  const enriched = rows.map(row => {
    const unit     = millUnit;
    const stock = row.current_stock || 0;
    const minS = row.min_stock || 0;
    const maxS = row.max_stock;

    const status =
      stock <= 0           ? 'out'     :
      stock <= minS        ? 'critical':
      stock <= minS * 2    ? 'low'     :
      maxS && stock >= maxS * 0.9 ? 'full' :
      'ok';

    const indicator =
      status === 'out'      ? 'red'   :
      status === 'critical' ? 'red'   :
      status === 'low'      ? 'amber' :
      'green';

    return {
      ingredient_id:   row.ingredient_id,
      ingredient_name: row.ingredient_name,
      current_stock:   Math.round(stock * 100) / 100,
      display_unit:    unit,
      min_stock:       minS,
      max_stock:       maxS || null,
      opening:         row.opening || 0,
      received:        row.received || 0,
      used:            row.used || 0,
      cost_per_unit:   row.cost_per_unit || 0,
      expected_closing: (row.opening || 0) + (row.received || 0) - (row.used || 0),
      status,
      indicator,
      needs_reorder:   status === 'low' || status === 'critical' || status === 'out',
      reorder_qty:     row.reorder_qty || null,
      lead_time_days:  row.lead_time_days
    };
  });

  const reorderList  = enriched.filter(r => r.needs_reorder);
  const criticalList = enriched.filter(r => r.status === 'critical' || r.status === 'out');
  const inventory_value = enriched.reduce((s, r) => s + (r.current_stock || 0) * (r.cost_per_unit || 0), 0);
  const usedToday = enriched.reduce((s, r) => s + (r.used || 0), 0);
  const stockNow = enriched.reduce((s, r) => s + (r.current_stock || 0), 0);
  const coverage_days = usedToday > 0 ? Math.round((stockNow / usedToday) * 10) / 10 : null;

  return {
    ok: true,
    mill_id,
    date,
    display_unit: millUnit,
    total_ingredients: enriched.length,
    reorder_count:     reorderList.length,
    critical_count:    criticalList.length,
    inventory_value:   Math.round(inventory_value * 100) / 100,
    coverage_days,
    ingredients:       enriched,
    reorder_list:      reorderList
  };
}

// â”€â”€ GET INGREDIENT AVAILABILITY FOR FORMULATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called by formulation workspace when nutritionist selects a plant
// Returns green/amber/red per ingredient for a given batch size
function getIngredientAvailability(mill_id, ingredients_needed, target_date = null) {
  const db   = getMillDb();
  const date = target_date || new Date().toISOString().slice(0, 10);

  const results = [];

  for (const needed of ingredients_needed) {
    const inventory = db.prepare(`
      SELECT
        CASE
          WHEN closing IS NOT NULL AND closing > 0 THEN closing
          ELSE COALESCE(opening,0) + COALESCE(received,0) - COALESCE(used,0)
        END as current_stock
      FROM mill_inventory
      WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
    `).get(mill_id, needed.ingredient_id, date);

    const available = inventory?.current_stock || 0;
    const required  = needed.required_kg || needed.required || 0;

    const pct_covered = required > 0
      ? Math.min(100, Math.round((available / required) * 100))
      : null;

    const indicator =
      available <= 0              ? 'red'   :
      available < required        ? 'red'   :
      available < required * 1.2  ? 'amber' :
      'green';

    results.push({
      ingredient_id:    needed.ingredient_id,
      ingredient_name:  needed.ingredient_name,
      required,
      available:        Math.round(available * 100) / 100,
      shortfall:        Math.max(0, Math.round((required - available) * 100) / 100),
      pct_covered,
      indicator,
      can_proceed:      available >= required
    });
  }

  const canProceed    = results.every(r => r.can_proceed || r.required === 0);
  const shortfalls    = results.filter(r => !r.can_proceed && r.required > 0);
  const unknowns      = results.filter(r => r.available === 0 && r.required > 0);

  return {
    ok: true,
    mill_id,
    can_proceed: canProceed,
    ingredients: results,
    shortfalls,
    unknowns
  };
}

// â”€â”€ GET DAILY USAGE REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDailyUsageReport(mill_id, date = null) {
  const db    = getMillDb();
  const today = date || new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      i.*,
      c.display_unit,
      c.min_stock,
      COALESCE(i.closing,
        COALESCE(i.opening,0) + COALESCE(i.received,0) - COALESCE(i.used,0)
      ) as closing_stock
    FROM mill_inventory i
    LEFT JOIN mill_ingredient_catalogue c
      ON i.mill_id = c.mill_id AND i.ingredient_id = c.ingredient_id
    WHERE i.mill_id = ? AND i.record_date = ?
    ORDER BY COALESCE(i.used,0) DESC
  `).all(mill_id, today);

  const millUnit = millWeightUnit(mill_id);
  const totalUsed = rows.reduce((s, r) => s + (r.used || 0), 0);

  return {
    ok: true,
    mill_id,
    date: today,
    total_used: Math.round(totalUsed * 100) / 100,
    weight_unit: millUnit,
    ingredient_count: rows.length,
    ingredients: rows.map(r => {
      const unit = millUnit;
      return {
        ingredient_id:    r.ingredient_id,
        ingredient_name:  r.ingredient_name,
        opening:          r.opening || 0,
        received:         r.received || 0,
        used:             r.used || 0,
        closing:          Math.round((r.closing_stock || 0) * 100) / 100,
        display_unit:     unit,
        variance:         r.variance || 0,
        shrinkage_value:  r.shrinkage_value || 0
      };
    })
  };
}

module.exports = {
  recordWeighbridgeReceipt,
  recordManualReceipt,
  postReceiptToInventory,
  evaluateInboundGate,
  completeInboundGate,
  getReceiptsByMill,
  getStockSnapshot,
  getIngredientAvailability,
  getDailyUsageReport,
  toKg,
  fromKg,
  formatWeight,
  millWeightUnit
};