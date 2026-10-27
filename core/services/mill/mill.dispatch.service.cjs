// ============================================================
// Feed Mill Intelligence Engine â€” Dispatch Service
// nutripilot-agrocore/core/services/mill/mill.dispatch.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ CREATE DISPATCH RECORD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called when batch is ready to leave the mill
function createDispatchRecord({
  batch_id,
  mill_id,
  customer_id    = null,
  farm_id        = null,
  customer_name,
  quantity_tons,
  mill_mass      = null,
  leftover_mass  = null,
  silo_bin       = null,
  lot_numbers    = null,
  vehicle_id     = null,
  driver_name    = null,
  notes          = null
}) {
  const db = getMillDb();

  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.feed_type
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const validStatuses = ['completed', 'reviewed', 'dispatched'];
  if (!validStatuses.includes(batch.status)) {
    return {
      ok: false,
      error: `Batch must be completed or reviewed before dispatch. Current status: ${batch.status}`
    };
  }

  const { assertQcAllowsDispatch } = require('./mill.qc.service.cjs');
  const gate = assertQcAllowsDispatch(batch_id);
  if (!gate.ok) return gate;
  const { assertFlushAllowsStart } = require('./mill.floor.service.cjs');
  const flush = assertFlushAllowsStart(mill_id, batch_id);
  if (!flush.ok) return flush;

  const qty = mill_mass != null && mill_mass !== '' ? Number(mill_mass) : Number(quantity_tons);
  if (!qty && qty !== 0) {
    return { ok: false, error: 'mill_mass or quantity_tons is required' };
  }
  const leftover = leftover_mass != null && leftover_mass !== '' ? Number(leftover_mass) : Math.max(0, (batch.planned_qty_tons || 0) - qty);

  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO mill_dispatch_records (
      id, batch_id, mill_id, customer_id, farm_id,
      customer_name, quantity_tons, mill_mass, leftover_mass, silo_bin, lot_numbers, vehicle_id,
      driver_name, dispatched_at, delivery_status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id, batch_id, mill_id, customer_id, farm_id,
    customer_name, qty, qty, leftover, silo_bin || null, lot_numbers || null, vehicle_id,
    driver_name, now, notes
  );

  // Update batch status to dispatched
  db.prepare(`
    UPDATE mill_batches
    SET status = 'dispatched', dispatched_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, batch_id);

  console.log(`[MillDispatch] Dispatch created for batch ${batch_id} â†’ ${customer_name}`);
  return {
    ok: true,
    dispatch_id:   id,
    batch_id,
    batch_number:  batch.batch_number,
    formula_name:  batch.formula_name,
    customer_name,
    quantity_tons: qty,
    mill_mass: qty,
    leftover_mass: leftover,
    silo_bin: silo_bin || null,
    vehicle_id: vehicle_id || null,
    dispatched_at: now
  };
}

// â”€â”€ UPDATE DELIVERY STATUS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateDeliveryStatus(dispatch_id, status, delivered_at = null) {
  const db = getMillDb();

  const valid = ['pending', 'in_transit', 'delivered', 'failed'];
  if (!valid.includes(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE mill_dispatch_records
    SET delivery_status = ?,
        delivered_at    = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
    WHERE id = ?
  `).run(status, status, delivered_at || now, dispatch_id);

  console.log(`[MillDispatch] Dispatch ${dispatch_id} â†’ ${status}`);
  return { ok: true, dispatch_id, status };
}

// â”€â”€ GET DISPATCH QUEUE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All pending/in-transit dispatches for a mill
function getDispatchQueue(mill_id) {
  const db = getMillDb();

  const rows = db.prepare(`
    SELECT d.*, b.batch_number, s.formula_name, s.feed_type, s.species
    FROM mill_dispatch_records d
    JOIN mill_batches b ON d.batch_id = b.id
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE d.mill_id = ?
      AND d.delivery_status IN ('pending', 'in_transit')
    ORDER BY d.dispatched_at DESC
  `).all(mill_id);

  return { ok: true, mill_id, dispatches: rows, count: rows.length };
}

// â”€â”€ GET DISPATCH HISTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDispatchHistory(mill_id, days = 30) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = db.prepare(`
    SELECT d.*, b.batch_number, s.formula_name, s.feed_type
    FROM mill_dispatch_records d
    JOIN mill_batches b ON d.batch_id = b.id
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE d.mill_id = ?
      AND DATE(d.dispatched_at) >= ?
    ORDER BY d.dispatched_at DESC
  `).all(mill_id, cutoff.toISOString().slice(0, 10));

  const delivered   = rows.filter(r => r.delivery_status === 'delivered').length;
  const in_transit  = rows.filter(r => r.delivery_status === 'in_transit').length;
  const pending     = rows.filter(r => r.delivery_status === 'pending').length;
  const failed      = rows.filter(r => r.delivery_status === 'failed').length;
  const totalTons   = rows.reduce((s, r) => s + (r.quantity_tons || 0), 0);

  return {
    ok: true,
    mill_id,
    period_days:  days,
    total:        rows.length,
    delivered,
    in_transit,
    pending,
    failed,
    total_tons:   Math.round(totalTons * 100) / 100,
    dispatches:   rows
  };
}

// â”€â”€ BATCH TRACEABILITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// One-click â€” which farms/customers received a specific batch
// Critical for feed recall and complaint investigation
function getBatchTraceability(batch_id) {
  const db = getMillDb();

  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.feed_type, s.species,
           s.formula_json, s.released_by, s.released_at
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const dispatches = db.prepare(`
    SELECT * FROM mill_dispatch_records WHERE batch_id = ?
  `).all(batch_id);

  const ingredients = db.prepare(`
    SELECT ingredient_id, ingredient_name, actual_kg, deviation_pct, deviation_flag
    FROM mill_batch_ingredients WHERE batch_id = ?
  `).all(batch_id);

  const qc = db.prepare(
    'SELECT * FROM mill_qc_results WHERE batch_id = ?'
  ).get(batch_id);

  const complaints = db.prepare(
    'SELECT * FROM mill_complaints WHERE batch_id = ?'
  ).all(batch_id);

  return {
    ok: true,
    batch_id,
    batch_number:      batch.batch_number,
    formula_name:      batch.formula_name,
    species:           batch.species,
    feed_type:         batch.feed_type,
    released_by:       batch.released_by,
    released_at:       batch.released_at,
    planned_qty_tons:  batch.planned_qty_tons,
    actual_qty_tons:   batch.actual_qty_tons,
    status:            batch.status,

    // Where did it go
    dispatched_to:     dispatches.map(d => ({
      dispatch_id:     d.id,
      customer_name:   d.customer_name,
      farm_id:         d.farm_id,
      quantity_tons:   d.quantity_tons,
      dispatched_at:   d.dispatched_at,
      delivery_status: d.delivery_status,
      vehicle_id:      d.vehicle_id
    })),

    // What was in it
    ingredients,
    qc: qc || null,
    complaints,

    // Summary
    total_recipients:  dispatches.length,
    complaint_count:   complaints.length,
    generated_at:      new Date().toISOString()
  };
}

// â”€â”€ LOG COMPLAINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function logComplaint({
  batch_id      = null,
  dispatch_id   = null,
  farm_id       = null,
  customer_name,
  complaint_type,
  severity      = 'medium',
  description
}) {
  const db = getMillDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO mill_complaints (
      id, batch_id, dispatch_id, farm_id,
      customer_name, complaint_type, severity, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, batch_id, dispatch_id, farm_id,
    customer_name, complaint_type, severity, description
  );

  console.log(`[MillDispatch] Complaint logged: ${complaint_type} from ${customer_name}`);
  return { ok: true, complaint_id: id, batch_id, customer_name };
}

// â”€â”€ GET OPEN COMPLAINTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getOpenComplaints(mill_id) {
  const db = getMillDb();

  const rows = db.prepare(`
    SELECT c.*, b.batch_number, b.mill_id,
           s.formula_name, s.feed_type
    FROM mill_complaints c
    LEFT JOIN mill_batches b ON c.batch_id = b.id
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ? AND c.resolved = 0
    ORDER BY
      CASE c.severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        ELSE 4
      END,
      c.created_at DESC
  `).all(mill_id);

  return {
    ok: true,
    mill_id,
    open_count: rows.length,
    complaints: rows
  };
}

module.exports = {
  createDispatchRecord,
  updateDeliveryStatus,
  getDispatchQueue,
  getDispatchHistory,
  getBatchTraceability,
  logComplaint,
  getOpenComplaints
};