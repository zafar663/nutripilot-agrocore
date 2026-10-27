// ============================================================
// Feed Mill Intelligence Engine â€” Inventory Service
// nutripilot-agrocore/core/services/mill/mill.inventory.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { lookupIngredientPrice } = require('./mill.price.service.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ SHRINKAGE THRESHOLDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SHRINKAGE_THRESHOLDS = {
  warn:  1.0,   // > 1% variance â€” monitor
  flag:  3.0    // > 3% variance â€” investigate immediately
};

// â”€â”€ OPEN DAILY INVENTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Creates or retrieves today's inventory record for an ingredient
function openDailyInventory({
  mill_id,
  ingredient_id,
  ingredient_name,
  opening,
  opening_kg,
  cost_per_unit = null,
  cost_per_kg,
  record_date = null
}) {
  opening = opening ?? opening_kg;
  cost_per_unit = cost_per_unit ?? cost_per_kg ?? null;
  const db = getMillDb();
  const date = record_date || new Date().toISOString().slice(0, 10);

  // Check if record already exists for today
  const existing = db.prepare(`
    SELECT * FROM mill_inventory
    WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
  `).get(mill_id, ingredient_id, date);

  if (existing) {
    return { ok: true, inventory_id: existing.id, already_exists: true };
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO mill_inventory (
      id, mill_id, ingredient_id, ingredient_name,
      record_date, opening, cost_per_unit
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, mill_id, ingredient_id, ingredient_name,
         date, opening, cost_per_unit);

  console.log(`[MillInventory] Opened inventory: ${ingredient_name} â€” ${date}`);
  return { ok: true, inventory_id: id, already_exists: false };
}

// â”€â”€ RECORD RECEIPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Adds received quantity when raw material arrives
function recordReceipt({
  mill_id,
  ingredient_id,
  ingredient_name,
  received,
  received_kg,
  cost_per_unit = null,
  cost_per_kg,
  supplier_lot_id = null,
  lot_number = null,
  supplier_name = null,
  record_date = null
}) {
  received = received ?? received_kg;
  cost_per_unit = cost_per_unit ?? cost_per_kg ?? null;
  const db = getMillDb();
  if (cost_per_unit == null) {
    cost_per_unit = lookupIngredientPrice(db, mill_id, ingredient_id, ingredient_name);
  }
  const date = record_date || new Date().toISOString().slice(0, 10);

  // Ensure inventory record exists for today
  const existing = db.prepare(`
    SELECT * FROM mill_inventory
    WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
  `).get(mill_id, ingredient_id, date);

  if (!existing) {
    return {
      ok: false,
      error: `No inventory record open for ${ingredient_name} on ${date}. Open daily inventory first.`
    };
  }

  db.prepare(`
    UPDATE mill_inventory
    SET received  = COALESCE(received, 0) + ?,
        cost_per_unit  = COALESCE(?, cost_per_unit),
        updated_at   = datetime('now')
    WHERE id = ?
  `).run(received, cost_per_unit, existing.id);

  const lot = lot_number || supplier_lot_id;
  if (lot) {
    try {
      db.prepare(`
        INSERT INTO mill_supplier_lots (
          id, mill_id, supplier_id, supplier_name, ingredient_id, ingredient_name,
          lot_number, received_date, quantity_kg, price_per_kg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), mill_id, supplier_name || 'supplier', supplier_name || 'supplier',
        ingredient_id, ingredient_name || ingredient_id, String(lot), date, received, cost_per_unit
      );
    } catch (_e) {}
    try {
      const { applyCoAToLot } = require('./mill.lotlock.service.cjs');
      applyCoAToLot({
        mill_id,
        lot_number: lot,
        ingredient_id,
        ingredient_name: ingredient_name || ingredient_id,
        supplier_name
      });
    } catch (_e) {}
  }

  console.log(`[MillInventory] Receipt recorded: ${received} ${ingredient_name}`);
  return { ok: true, inventory_id: existing.id, received };
}

// â”€â”€ RECORD USAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Updates used from batch actuals
// Called automatically after batch actuals are recorded
function recordUsageFromBatch(batch_id, record_date = null) {
  const db = getMillDb();
  const date = record_date || new Date().toISOString().slice(0, 10);

  // Get batch mill
  const batch = db.prepare(
    'SELECT mill_id FROM mill_batches WHERE id = ?'
  ).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  // Get all actual weights from this batch
  const ingredients = db.prepare(`
    SELECT ingredient_id, ingredient_name, actual_kg
    FROM mill_batch_ingredients
    WHERE batch_id = ? AND actual_kg IS NOT NULL
  `).all(batch_id);

  if (ingredients.length === 0) {
    return { ok: false, error: 'No actuals recorded for this batch' };
  }

  const updateUsage = db.transaction((items) => {
    for (const ing of items) {
      const inventory = db.prepare(`
        SELECT id FROM mill_inventory
        WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
      `).get(batch.mill_id, ing.ingredient_id, date);

      if (inventory) {
        db.prepare(`
          UPDATE mill_inventory
          SET used    = COALESCE(used, 0) + ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(ing.actual_kg, inventory.id);
      }
    }
  });

  updateUsage(ingredients);
  console.log(`[MillInventory] Usage recorded from batch ${batch_id}`);
  return { ok: true, batch_id, ingredients_updated: ingredients.length };
}

// â”€â”€ CLOSE DAILY INVENTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Run at end of day â€” calculates closing stock, variance, shrinkage
function closeDailyInventory(mill_id, record_date = null, opts = {}) {
  const db = getMillDb();
  const date = record_date || new Date().toISOString().slice(0, 10);
  const physical = opts.physical_counts || {};
  const closed_by = opts.closed_by || null;

  const records = db.prepare(`
    SELECT * FROM mill_inventory
    WHERE mill_id = ? AND record_date = ?
  `).all(mill_id, date);

  if (records.length === 0) {
    return { ok: false, error: `No inventory records found for ${date}` };
  }

  const closeAll = db.transaction((items) => {
    const results = [];

    for (const rec of items) {
      const opening    = rec.opening   || 0;
      const received   = rec.received  || 0;
      const used       = rec.used      || 0;
      const expected_closing = opening + received - used;
      const phys = physical[rec.ingredient_id];
      const closing = phys != null && phys !== '' ? Number(phys) : expected_closing;
      const variance  = closing - expected_closing;
      const variance_pct = expected_closing > 0
        ? Math.round((variance / expected_closing) * 10000) / 100
        : 0;

      const shrinkage_value = rec.cost_per_unit
        ? Math.abs(variance) * rec.cost_per_unit
        : null;

      // Classify shrinkage
      const shrinkage_flag =
        Math.abs(variance_pct) > SHRINKAGE_THRESHOLDS.flag ? 'flag' :
        Math.abs(variance_pct) > SHRINKAGE_THRESHOLDS.warn ? 'warn' :
        'none';

      const closeNote = closed_by
        ? `Shift close by ${closed_by}${phys != null && phys !== '' ? ' (physical count)' : ' (book qty)'}`
        : rec.notes;
      db.prepare(`
        UPDATE mill_inventory SET
          closing       = ?,
          expected_closing = ?,
          variance      = ?,
          variance_pct     = ?,
          shrinkage_value  = ?,
          notes            = ?,
          updated_at       = datetime('now')
        WHERE id = ?
      `).run(
        closing, expected_closing,
        Math.round(variance  * 100) / 100,
        variance_pct,
        shrinkage_value ? Math.round(shrinkage_value * 100) / 100 : null,
        closeNote,
        rec.id
      );

      results.push({
        ingredient_id:   rec.ingredient_id,
        ingredient_name: rec.ingredient_name,
        opening:      opening,
        received:     received,
        used:         used,
        expected_closing: Math.round(expected_closing * 100) / 100,
        closing:      Math.round(closing   * 100) / 100,
        variance:     Math.round(variance * 100) / 100,
        variance_pct,
        shrinkage_value,
        shrinkage_flag
      });
    }

    return results;
  });

  const results = closeAll(records);

  // Summary
  const flagged  = results.filter(r => r.shrinkage_flag === 'flag');
  const warned   = results.filter(r => r.shrinkage_flag === 'warn');
  const totalShrinkageValue = results
    .reduce((s, r) => s + (r.shrinkage_value || 0), 0);

  console.log(`[MillInventory] Daily close complete for ${date} â€” ${results.length} ingredients`);

  return {
    ok: true,
    mill_id,
    record_date: date,
    closed_by,
    ingredients_closed: results.length,
    flagged_count:      flagged.length,
    warned_count:       warned.length,
    total_shrinkage_value: Math.round(totalShrinkageValue * 100) / 100,
    flagged_ingredients: flagged,
    results
  };
}

// â”€â”€ PRE-BATCH STOCK CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Checks if enough stock exists before confirming a batch
// Called when mill manager confirms a pending batch
function preBatchStockCheck(batch_id) {
  const db = getMillDb();
  const date = new Date().toISOString().slice(0, 10);

  const batch = db.prepare(
    'SELECT mill_id FROM mill_batches WHERE id = ?'
  ).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const ingredients = db.prepare(`
    SELECT ingredient_id, ingredient_name, planned_kg
    FROM mill_batch_ingredients
    WHERE batch_id = ?
  `).all(batch_id);

  const checks = [];
  let canProceed = true;

  for (const ing of ingredients) {
    const inventory = db.prepare(`
      SELECT closing, opening, received, used
      FROM mill_inventory
      WHERE mill_id = ? AND ingredient_id = ? AND record_date = ?
    `).get(batch.mill_id, ing.ingredient_id, date);

    const available_kg = inventory
      ? (inventory.closing ||
         (inventory.opening || 0) + (inventory.received || 0) - (inventory.used || 0))
      : null;

    const sufficient = available_kg !== null ? available_kg >= ing.planned_kg : null;
    const shortfall_kg = available_kg !== null && !sufficient
      ? Math.round((ing.planned_kg - available_kg) * 100) / 100
      : 0;

    if (sufficient === false) canProceed = false;

    checks.push({
      ingredient_id:   ing.ingredient_id,
      ingredient_name: ing.ingredient_name,
      planned_kg:      ing.planned_kg,
      available_kg:    available_kg !== null ? Math.round(available_kg * 100) / 100 : null,
      sufficient:      sufficient,
      shortfall_kg,
      status: sufficient === null  ? 'unknown'      :
              sufficient           ? 'sufficient'   :
                                     'insufficient'
    });
  }

  return {
    ok: true,
    batch_id,
    can_proceed: canProceed,
    ingredients_checked: checks.length,
    shortfalls: checks.filter(c => c.status === 'insufficient'),
    unknowns:   checks.filter(c => c.status === 'unknown'),
    checks
  };
}

// â”€â”€ GET INVENTORY SNAPSHOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Current stock levels for all ingredients at a mill
function getInventorySnapshot(mill_id, record_date = null) {
  const db = getMillDb();
  const date = record_date || new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT *,
      CASE
        WHEN closing IS NOT NULL AND closing > 0 THEN closing
        ELSE COALESCE(opening,0) + COALESCE(received,0) - COALESCE(used,0)
      END as current_stock
    FROM mill_inventory
    WHERE mill_id = ? AND record_date = ?
    ORDER BY ingredient_name
  `).all(mill_id, date);

  const totalShrinkageValue = rows
    .reduce((s, r) => s + (r.shrinkage_value || 0), 0);

  return {
    ok: true,
    mill_id,
    record_date: date,
    ingredient_count: rows.length,
    total_shrinkage_value: Math.round(totalShrinkageValue * 100) / 100,
    ingredients: rows
  };
}

// â”€â”€ GET SHRINKAGE REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Shrinkage summary across a date range â€” for weekly/monthly reports
function getShrinkageReport(mill_id, days = 7) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      ingredient_id,
      ingredient_name,
      COUNT(*)                              as days_tracked,
      SUM(COALESCE(variance, 0))         as total_variance,
      AVG(COALESCE(variance_pct, 0))        as avg_variance_pct,
      SUM(COALESCE(shrinkage_value, 0))     as total_shrinkage_value,
      SUM(COALESCE(used, 0))             as total_used,
      SUM(COALESCE(received, 0))         as total_received
    FROM mill_inventory
    WHERE mill_id = ? AND record_date >= ?
    GROUP BY ingredient_id, ingredient_name
    ORDER BY total_shrinkage_value DESC
  `).all(mill_id, cutoffDate);

  const totalShrinkage = rows.reduce((s, r) => s + (r.total_shrinkage_value || 0), 0);
  const flagged = rows.filter(r =>
    Math.abs(r.avg_variance_pct) > SHRINKAGE_THRESHOLDS.flag
  );

  return {
    ok: true,
    mill_id,
    period_days:           days,
    from_date:             cutoffDate,
    ingredients_tracked:   rows.length,
    total_shrinkage_value: Math.round(totalShrinkage * 100) / 100,
    flagged_count:         flagged.length,
    flagged_ingredients:   flagged,
    ingredients:           rows,
    generated_at:          new Date().toISOString()
  };
}

module.exports = {
  openDailyInventory,
  recordReceipt,
  recordUsageFromBatch,
  closeDailyInventory,
  preBatchStockCheck,
  getInventorySnapshot,
  getShrinkageReport,
  SHRINKAGE_THRESHOLDS
};