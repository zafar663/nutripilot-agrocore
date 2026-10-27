// ============================================================
// Feed Mill Intelligence Engine â€” Downtime Service
// nutripilot-agrocore/core/services/mill/mill.downtime.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ DOWNTIME COST RATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Default cost per minute of downtime â€” overridden per mill
const DEFAULT_COST_PER_MINUTE = 8.50; // $ per minute lost production

// â”€â”€ LOG DOWNTIME EVENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called when unplanned stop occurs or planned maintenance starts
function logDowntimeEvent({
  mill_id,
  batch_id        = null,
  machine,
  downtime_type   = 'unplanned',
  started_at      = null,
  cause_category  = null,
  cause_description = null,
  cost_per_minute = DEFAULT_COST_PER_MINUTE,
  notes           = null
}) {
  const db = getMillDb();

  const valid_types = ['planned', 'unplanned'];
  if (!valid_types.includes(downtime_type)) {
    return { ok: false, error: `Invalid type: ${downtime_type}` };
  }

  const valid_categories = ['mechanical', 'electrical', 'process', 'material', 'other'];
  if (cause_category && !valid_categories.includes(cause_category)) {
    return { ok: false, error: `Invalid category: ${cause_category}` };
  }

  const id  = randomUUID();
  const now = started_at || new Date().toISOString();

  db.prepare(`
    INSERT INTO mill_downtime_events (
      id, mill_id, batch_id, machine,
      downtime_type, started_at,
      cause_category, cause_description, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, mill_id, batch_id, machine,
    downtime_type, now,
    cause_category, cause_description, notes
  );

  console.log(`[MillDowntime] Event logged: ${machine} â€” ${downtime_type}`);
  return {
    ok: true,
    downtime_id:   id,
    mill_id,
    machine,
    downtime_type,
    started_at:    now
  };
}

// â”€â”€ CLOSE DOWNTIME EVENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called when machine is back online â€” calculates duration and cost
function closeDowntimeEvent({
  downtime_id,
  ended_at       = null,
  resolved_by    = null,
  cost_per_minute = DEFAULT_COST_PER_MINUTE,
  notes          = null
}) {
  const db = getMillDb();

  const event = db.prepare(
    'SELECT * FROM mill_downtime_events WHERE id = ?'
  ).get(downtime_id);

  if (!event) return { ok: false, error: 'Downtime event not found' };
  if (event.ended_at) return { ok: false, error: 'Downtime event already closed' };

  const now         = ended_at || new Date().toISOString();
  const startTime   = new Date(event.started_at).getTime();
  const endTime     = new Date(now).getTime();
  const durationMin = Math.round((endTime - startTime) / 60000 * 10) / 10;

  // Estimate lost production
  // Assume 10 tons/hour average throughput
  const TONS_PER_HOUR  = 10;
  const lost_tons      = Math.round((durationMin / 60) * TONS_PER_HOUR * 100) / 100;
  const estimated_cost = Math.round(durationMin * cost_per_minute * 100) / 100;

  const updatedNotes = notes
    ? `${event.notes || ''} | ${notes}`.trim()
    : event.notes;

  db.prepare(`
    UPDATE mill_downtime_events SET
      ended_at          = ?,
      duration_minutes  = ?,
      lost_tons         = ?,
      estimated_cost    = ?,
      resolved_by       = ?,
      notes             = ?
    WHERE id = ?
  `).run(
    now, durationMin, lost_tons,
    estimated_cost, resolved_by,
    updatedNotes, downtime_id
  );

  console.log(`[MillDowntime] Event closed: ${event.machine} â€” ${durationMin} min â€” $${estimated_cost}`);
  return {
    ok: true,
    downtime_id,
    machine:        event.machine,
    started_at:     event.started_at,
    ended_at:       now,
    duration_minutes: durationMin,
    lost_tons,
    estimated_cost,
    resolved_by
  };
}

// â”€â”€ GET ACTIVE DOWNTIME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Events that have started but not yet been closed
function getActiveDowntime(mill_id) {
  const db = getMillDb();

  const rows = db.prepare(`
    SELECT *,
      ROUND((julianday('now') - julianday(started_at)) * 1440, 1) as running_minutes,
      ROUND((julianday('now') - julianday(started_at)) * 1440 * ?, 2) as running_cost
    FROM mill_downtime_events
    WHERE mill_id = ? AND ended_at IS NULL
    ORDER BY started_at ASC
  `).all(DEFAULT_COST_PER_MINUTE, mill_id);

  const totalRunningCost = rows.reduce(
    (s, r) => s + (r.running_cost || 0), 0
  );

  return {
    ok: true,
    mill_id,
    active_count:       rows.length,
    total_running_cost: Math.round(totalRunningCost * 100) / 100,
    events:             rows
  };
}

// â”€â”€ GET DOWNTIME HISTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDowntimeHistory(mill_id, days = 30) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = db.prepare(`
    SELECT *
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) >= ?
    ORDER BY started_at DESC
  `).all(mill_id, cutoff.toISOString().slice(0, 10));

  // Summary statistics
  const unplanned     = rows.filter(r => r.downtime_type === 'unplanned');
  const planned       = rows.filter(r => r.downtime_type === 'planned');
  const totalMinutes  = rows.reduce((s, r) => s + (r.duration_minutes || 0), 0);
  const totalCost     = rows.reduce((s, r) => s + (r.estimated_cost   || 0), 0);
  const totalLostTons = rows.reduce((s, r) => s + (r.lost_tons        || 0), 0);

  // By machine â€” which machine has most downtime
  const byMachine = {};
  for (const row of rows) {
    if (!byMachine[row.machine]) {
      byMachine[row.machine] = {
        machine:         row.machine,
        event_count:     0,
        total_minutes:   0,
        total_cost:      0,
        unplanned_count: 0
      };
    }
    byMachine[row.machine].event_count++;
    byMachine[row.machine].total_minutes  += row.duration_minutes  || 0;
    byMachine[row.machine].total_cost     += row.estimated_cost    || 0;
    if (row.downtime_type === 'unplanned') byMachine[row.machine].unplanned_count++;
  }

  // By category
  const byCategory = {};
  for (const row of rows) {
    const cat = row.cause_category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  // Most problematic machine
  const worstMachine = Object.values(byMachine)
    .sort((a, b) => b.total_cost - a.total_cost)[0] || null;

  return {
    ok: true,
    mill_id,
    period_days:        days,
    total_events:       rows.length,
    unplanned_events:   unplanned.length,
    planned_events:     planned.length,
    total_minutes:      Math.round(totalMinutes  * 10) / 10,
    total_cost:         Math.round(totalCost     * 100) / 100,
    total_lost_tons:    Math.round(totalLostTons * 100) / 100,
    by_machine:         Object.values(byMachine),
    by_category:        byCategory,
    worst_machine:      worstMachine,
    events:             rows,
    generated_at:       new Date().toISOString()
  };
}

// â”€â”€ DOWNTIME SUMMARY TODAY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDowntimeSummaryToday(mill_id) {
  const db = getMillDb();
  const today = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT *
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) = ?
    ORDER BY started_at DESC
  `).all(mill_id, today);

  const active    = rows.filter(r => !r.ended_at);
  const closed    = rows.filter(r => r.ended_at);
  const totalMin  = closed.reduce((s, r) => s + (r.duration_minutes || 0), 0);
  const totalCost = closed.reduce((s, r) => s + (r.estimated_cost   || 0), 0);

  return {
    ok: true,
    mill_id,
    date:             today,
    total_events:     rows.length,
    active_count:     active.length,
    closed_count:     closed.length,
    total_minutes:    Math.round(totalMin  * 10) / 10,
    total_cost:       Math.round(totalCost * 100) / 100,
    active_events:    active,
    closed_events:    closed
  };
}

// â”€â”€ MAINTENANCE ALERT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Flags machines with repeated downtime â€” preventive maintenance signal
function getMaintenanceAlerts(mill_id, days = 14, min_events = 2) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = db.prepare(`
    SELECT
      machine,
      COUNT(*)                          as event_count,
      SUM(COALESCE(duration_minutes,0)) as total_minutes,
      SUM(COALESCE(estimated_cost,0))   as total_cost,
      MAX(started_at)                   as last_event,
      SUM(CASE WHEN downtime_type = 'unplanned' THEN 1 ELSE 0 END) as unplanned_count
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) >= ?
    GROUP BY machine
    HAVING event_count >= ?
    ORDER BY total_cost DESC
  `).all(mill_id, cutoff.toISOString().slice(0, 10), min_events);

  const alerts = rows.map(r => ({
    ...r,
    total_minutes: Math.round(r.total_minutes * 10)  / 10,
    total_cost:    Math.round(r.total_cost    * 100) / 100,
    alert_level:
      r.event_count >= 5 || r.total_cost > 500 ? 'critical' :
      r.event_count >= 3 || r.total_cost > 200 ? 'high'     :
      'medium',
    recommendation: `Schedule preventive maintenance for ${r.machine} â€” ${r.event_count} events in ${days} days`
  }));

  return {
    ok: true,
    mill_id,
    period_days:  days,
    alert_count:  alerts.length,
    alerts,
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  logDowntimeEvent,
  closeDowntimeEvent,
  getActiveDowntime,
  getDowntimeHistory,
  getDowntimeSummaryToday,
  getMaintenanceAlerts,
  DEFAULT_COST_PER_MINUTE
};