'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { getMoneyLeakSummary } = require('./mill.deviation.service.cjs');
const { getShrinkageReport } = require('./mill.inventory.service.cjs');
const { getInboundPulse } = require('../../db/mill/mill.db.cjs');

function dailyPack(mill_id, date) {
  const db = getMillDb();
  const day = date || new Date().toISOString().slice(0, 10);
  const batches = db.prepare(`
    SELECT b.batch_number, b.status, b.planned_qty_tons, b.actual_qty_tons, s.formula_name, b.created_at
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ? AND date(b.created_at) = ?
    ORDER BY b.created_at
  `).all(mill_id, day);
  let leak = {};
  let shrink = {};
  try { leak = getMoneyLeakSummary(mill_id) || {}; } catch (_e) {}
  try { shrink = getShrinkageReport(mill_id) || {}; } catch (_e) {}
  let downtime = [];
  try {
    downtime = db.prepare(`
      SELECT machine, cause_category, duration_minutes, started_at
      FROM mill_downtime_events WHERE mill_id = ? AND date(started_at) = ?
    `).all(mill_id, day);
  } catch (_e) {}
  let haccp = [];
  try {
    haccp = db.prepare(`SELECT ccp, passed, signed_by, signed_at FROM mill_haccp_signoff WHERE mill_id = ? AND date(created_at) = ?`).all(mill_id, day);
  } catch (_e) {}
  const pulse = getInboundPulse(mill_id) || {};
  return {
    ok: true,
    mill_id,
    date: day,
    batches,
    deviation_cost: leak.total_deviation_cost || 0,
    flags: leak.total_flags || 0,
    shrink,
    downtime,
    haccp,
    mill_edge: pulse,
  };
}

function packToCsv(pack) {
  const lines = [
    `Mill IQ daily pack,${pack.date},${pack.mill_id}`,
    `Deviation $,${pack.deviation_cost},Flags,${pack.flags}`,
    '',
    'Batch,Formula,Status,Planned,Actual',
    ...(pack.batches || []).map((b) =>
      [b.batch_number, b.formula_name, b.status, b.planned_qty_tons, b.actual_qty_tons].join(',')
    ),
    '',
    'Downtime machine,Cause,Minutes',
    ...(pack.downtime || []).map((d) => [d.machine, d.cause_category, d.duration_minutes].join(',')),
  ];
  return lines.join('\n');
}

module.exports = { dailyPack, packToCsv };
