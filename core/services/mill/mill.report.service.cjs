// ============================================================
// Feed Mill Intelligence Engine â€” Report Service
// nutripilot-agrocore/core/services/mill/mill.report.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { getDailyDecisionSummary } = require('./engines/decision.engine.cjs');
const { getMoneyLeakSummary, getDeviationHistory, detectFormulaDrift } = require('./mill.deviation.service.cjs');
const { getQcTrend } = require('./mill.qc.service.cjs');
const { getShrinkageReport } = require('./mill.inventory.service.cjs');
const { getDispatchHistory } = require('./mill.dispatch.service.cjs');
const { getDowntimeHistory, getMaintenanceAlerts } = require('./mill.downtime.service.cjs');
const { scoreMillBatches } = require('./engines/batch.risk.engine.cjs');

function dayKey(value) {
  return String(value || '').replace('T', ' ').slice(0, 10);
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

/** mill-edge stores kg in planned_qty_tons / actual_qty_tons */
function asTons(mass, notes) {
  const n = Number(mass || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const note = String(notes || '');
  const looksKg = n > 80 || /unit kg|stored as mill unit|PLC mill-edge/i.test(note);
  return round3(looksKg ? n / 1000 : n);
}

function periodBounds(period, date) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (period === 'week') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: today, period: 'week' };
  }
  if (period === 'month') {
    const from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    return { from, to: today, period: 'month' };
  }
  const day = date || today;
  return { from: day, to: day, period: 'day' };
}

function eachDate(from, to) {
  const out = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = String(to);
  for (let i = 0; i < 62; i++) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(key);
    if (key >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function isComplete(status) {
  return ['completed', 'reviewed', 'dispatched'].includes(String(status || ''));
}

/**
 * Mill-wide production for one mill: every formula, every batch.
 * period = day | week | month
 */
function getMillWideProduction(mill_id, period = 'day', date = null) {
  const db = getMillDb();
  const p = ['day', 'week', 'month'].includes(String(period)) ? String(period) : 'day';
  const bounds = periodBounds(p, date);

  const selectSql = `
    SELECT
      b.id, b.batch_number, b.status, b.created_at, b.completed_at,
      b.planned_qty_tons, b.actual_qty_tons, b.notes, b.connector_source,
      s.formula_name, s.feed_type, s.species
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ?
  `;

  let rows = db.prepare(`
    ${selectSql}
      AND substr(replace(b.created_at, 'T', ' '), 1, 10) BETWEEN ? AND ?
    ORDER BY b.created_at ASC
  `).all(mill_id, bounds.from, bounds.to);

  if (p === 'day' && !rows.length) {
    rows = db.prepare(`
      ${selectSql}
        AND datetime(replace(replace(b.created_at, 'T', ' '), 'Z', '')) >= datetime('now', '-36 hours')
      ORDER BY b.created_at ASC
    `).all(mill_id);
  }

  const batches = rows.map(r => {
    const planned = asTons(r.planned_qty_tons, r.notes);
    const actual = asTons(r.actual_qty_tons || r.planned_qty_tons, r.notes);
    return {
      id: r.id,
      batch_number: r.batch_number,
      formula_name: r.formula_name || 'Unnamed formula',
      feed_type: r.feed_type || null,
      species: r.species || null,
      planned_tons: planned,
      actual_tons: actual,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      day: dayKey(r.created_at),
      source: r.connector_source || null
    };
  });

  const completed = batches.filter(b => isComplete(b.status));
  const byFormulaMap = {};
  for (const b of batches) {
    const k = b.formula_name;
    if (!byFormulaMap[k]) {
      byFormulaMap[k] = {
        formula_name: k,
        species: b.species,
        feed_type: b.feed_type,
        batches: 0,
        completed: 0,
        planned_tons: 0,
        actual_tons: 0
      };
    }
    byFormulaMap[k].batches += 1;
    byFormulaMap[k].planned_tons += b.planned_tons;
    if (isComplete(b.status)) {
      byFormulaMap[k].completed += 1;
      byFormulaMap[k].actual_tons += b.actual_tons;
    }
  }
  const by_formula = Object.values(byFormulaMap)
    .sort((a, b) => b.actual_tons - a.actual_tons)
    .map(x => ({
      ...x,
      planned_tons: round3(x.planned_tons),
      actual_tons: round3(x.actual_tons)
    }));

  const byDayMap = {};
  for (const key of eachDate(bounds.from, bounds.to)) {
    byDayMap[key] = { date: key, batches: 0, completed: 0, planned_tons: 0, actual_tons: 0 };
  }
  for (const b of batches) {
    if (!byDayMap[b.day]) {
      byDayMap[b.day] = { date: b.day, batches: 0, completed: 0, planned_tons: 0, actual_tons: 0 };
    }
    byDayMap[b.day].batches += 1;
    byDayMap[b.day].planned_tons += b.planned_tons;
    if (isComplete(b.status)) {
      byDayMap[b.day].completed += 1;
      byDayMap[b.day].actual_tons += b.actual_tons;
    }
  }
  const by_day = Object.values(byDayMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(x => ({
      ...x,
      planned_tons: round3(x.planned_tons),
      actual_tons: round3(x.actual_tons)
    }));

  const planned = batches.reduce((s, b) => s + b.planned_tons, 0);
  const actual = completed.reduce((s, b) => s + b.actual_tons, 0);
  const daysWithWork = by_day.filter(d => d.batches > 0).length || 1;

  return {
    ok: true,
    report_type: 'mill_wide_production',
    mill_id,
    period: p,
    from_date: bounds.from,
    to_date: bounds.to,
    date: p === 'day' ? bounds.from : `${bounds.from} → ${bounds.to}`,
    generated_at: new Date().toISOString(),
    total_batches: batches.length,
    completed_batches: completed.length,
    completion_rate: batches.length
      ? Math.round((completed.length / batches.length) * 100)
      : 0,
    planned_tons: round3(planned),
    actual_tons: round3(actual),
    avg_tons_per_day: round3(actual / daysWithWork),
    formulas: by_formula.length,
    by_formula,
    by_day,
    batches
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function millUnits(db, mill_id) {
  try {
    const row = db.prepare('SELECT weight_unit, large_weight_unit FROM mill_configurations WHERE id = ?').get(mill_id);
    return {
      weight_unit: row?.weight_unit || 'kg',
      large_weight_unit: row?.large_weight_unit || 'metric_ton'
    };
  } catch (_e) {
    return { weight_unit: 'kg', large_weight_unit: 'metric_ton' };
  }
}

function tonsToMillMass(tons, weightUnit) {
  const t = Number(tons) || 0;
  const u = String(weightUnit || 'kg').toLowerCase();
  if (u === 'metric_ton' || u === 't' || u === 'mt' || u === 'ton') return t;
  const kg = t * 1000;
  if (u === 'lb' || u === 'lbs') return kg * 2.2046226218;
  if (u === 'g') return kg * 1000;
  return kg;
}

function shrinkFlag(pct, warn = 1, flag = 3) {
  const a = Math.abs(Number(pct) || 0);
  if (a > flag) return 'flag';
  if (a > warn) return 'warn';
  return 'none';
}

function safeAll(db, sql, params) {
  try { return db.prepare(sql).all(...params); } catch (_e) { return []; }
}

function safeGet(db, sql, params) {
  try { return db.prepare(sql).get(...params) || {}; } catch (_e) { return {}; }
}

function ingKey(id, name) {
  const a = String(id || '').trim().toLowerCase();
  const b = String(name || '').trim().toLowerCase();
  return a || b || 'unknown';
}

/**
 * Mill-wide mass balance: inbound vs batched vs produced vs dispatched vs book shrink.
 * period = day | week | month
 */
function getMillMassBalance(mill_id, period = 'day', date = null) {
  const db = getMillDb();
  const p = ['day', 'week', 'month'].includes(String(period)) ? String(period) : 'day';
  const bounds = periodBounds(p, date);
  const units = millUnits(db, mill_id);
  const prod = getMillWideProduction(mill_id, p, date);

  let inboundRows = safeAll(db, `
    SELECT ingredient_id, ingredient_name, mill_mass, receipt_date, moisture_pct, total_cost
    FROM mill_weighbridge_receipts
    WHERE mill_id = ?
      AND substr(replace(receipt_date, 'T', ' '), 1, 10) BETWEEN ? AND ?
  `, [mill_id, bounds.from, bounds.to]);
  if (!inboundRows.length) {
    inboundRows = safeAll(db, `
      SELECT ingredient_id, ingredient_name,
             COALESCE(mill_mass, net_weight, net_weight_kg, 0) as mill_mass,
             receipt_date, moisture_pct, total_cost
      FROM mill_weighbridge_receipts
      WHERE mill_id = ?
        AND substr(replace(receipt_date, 'T', ' '), 1, 10) BETWEEN ? AND ?
    `, [mill_id, bounds.from, bounds.to]);
  }

  let invRows = safeAll(db, `
    SELECT ingredient_id, ingredient_name, record_date,
           opening, received, used, closing, expected_closing,
           variance, variance_pct, shrinkage_value, cost_per_unit
    FROM mill_inventory
    WHERE mill_id = ? AND record_date BETWEEN ? AND ?
    ORDER BY record_date ASC
  `, [mill_id, bounds.from, bounds.to]);

  let usageRows = safeAll(db, `
    SELECT i.ingredient_id, i.ingredient_name,
           COALESCE(i.actual_kg, i.planned_kg, 0) as used_mass,
           COALESCE(i.planned_kg, 0) as planned_mass,
           COALESCE(i.cost_impact, 0) as cost_impact,
           b.created_at, b.status, b.notes
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND substr(replace(b.created_at, 'T', ' '), 1, 10) BETWEEN ? AND ?
  `, [mill_id, bounds.from, bounds.to]);

  let dispatchRows = safeAll(db, `
    SELECT mill_mass, quantity_tons, leftover_mass, dispatched_at, notes
    FROM mill_dispatch_records
    WHERE mill_id = ?
      AND substr(replace(dispatched_at, 'T', ' '), 1, 10) BETWEEN ? AND ?
  `, [mill_id, bounds.from, bounds.to]);

  if (p === 'day' && !inboundRows.length && !invRows.length && !usageRows.length && !prod.batches.length) {
    usageRows = safeAll(db, `
      SELECT i.ingredient_id, i.ingredient_name,
             COALESCE(i.actual_kg, i.planned_kg, 0) as used_mass,
             COALESCE(i.planned_kg, 0) as planned_mass,
             COALESCE(i.cost_impact, 0) as cost_impact,
             b.created_at, b.status, b.notes
      FROM mill_batch_ingredients i
      JOIN mill_batches b ON i.batch_id = b.id
      WHERE b.mill_id = ?
        AND datetime(replace(replace(b.created_at, 'T', ' '), 'Z', '')) >= datetime('now', '-36 hours')
    `, [mill_id]);
  }

  const qc = safeGet(db, `
    SELECT AVG(q.moisture_pct) as finished_moisture, COUNT(q.id) as qc_rows
    FROM mill_qc_results q
    JOIN mill_batches b ON q.batch_id = b.id
    WHERE b.mill_id = ?
      AND substr(replace(COALESCE(q.created_at, b.created_at), 'T', ' '), 1, 10) BETWEEN ? AND ?
      AND q.moisture_pct IS NOT NULL
  `, [mill_id, bounds.from, bounds.to]);

  const byIng = {};
  const ensure = (id, name) => {
    const k = ingKey(id, name);
    if (!byIng[k]) {
      byIng[k] = {
        ingredient_id: id || null,
        ingredient_name: name || 'Unnamed',
        opening: 0,
        inbound: 0,
        received: 0,
        used_book: 0,
        used_batch: 0,
        planned_batch: 0,
        expected_closing: 0,
        closing: 0,
        variance: 0,
        variance_pct: 0,
        shrinkage_value: 0,
        inbound_moisture_n: 0,
        inbound_moisture_sum: 0,
        receipts: 0,
        flag: 'none'
      };
    }
    if (name && byIng[k].ingredient_name === 'Unnamed') byIng[k].ingredient_name = name;
    return byIng[k];
  };

  const invByIngDays = {};
  for (const r of invRows) {
    const g = ensure(r.ingredient_id, r.ingredient_name);
    const k = ingKey(r.ingredient_id, r.ingredient_name);
    if (!invByIngDays[k]) invByIngDays[k] = [];
    invByIngDays[k].push(r);
    g.received += Number(r.received || 0);
    g.used_book += Number(r.used || 0);
    g.shrinkage_value += Number(r.shrinkage_value || 0);
  }
  for (const [k, days] of Object.entries(invByIngDays)) {
    days.sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const g = byIng[k];
    g.opening = Number(days[0].opening || 0);
    const last = days[days.length - 1];
    const used = g.used_book;
    const received = g.received;
    g.expected_closing = g.opening + received - used;
    g.closing = last.closing != null && last.closing !== ''
      ? Number(last.closing)
      : g.expected_closing;
    g.variance = g.closing - g.expected_closing;
    g.variance_pct = g.expected_closing
      ? round2((g.variance / g.expected_closing) * 100)
      : 0;
    g.flag = shrinkFlag(g.variance_pct);
  }

  for (const r of inboundRows) {
    const g = ensure(r.ingredient_id, r.ingredient_name);
    g.inbound += Number(r.mill_mass || 0);
    g.receipts += 1;
    if (r.moisture_pct != null && Number.isFinite(Number(r.moisture_pct))) {
      g.inbound_moisture_n += 1;
      g.inbound_moisture_sum += Number(r.moisture_pct);
    }
  }

  for (const r of usageRows) {
    const g = ensure(r.ingredient_id, r.ingredient_name);
    g.used_batch += Number(r.used_mass || 0);
    g.planned_batch += Number(r.planned_mass || 0);
  }

  const by_ingredient = Object.values(byIng)
    .map(g => {
      const inbound = g.inbound || g.received;
      const used = g.used_batch || g.used_book;
      const expected = g.opening + inbound - used;
      const closing = g.closing || expected;
      const variance = closing - expected;
      const variance_pct = expected ? round2((variance / expected) * 100) : round2(g.variance_pct);
      return {
        ingredient_id: g.ingredient_id,
        ingredient_name: g.ingredient_name,
        opening: round2(g.opening),
        inbound: round2(inbound),
        weighbridge: round2(g.inbound),
        received: round2(g.received),
        used: round2(used),
        used_batch: round2(g.used_batch),
        used_book: round2(g.used_book),
        expected_closing: round2(expected),
        closing: round2(closing),
        variance: round2(variance),
        variance_pct,
        shrinkage_value: round2(g.shrinkage_value),
        receipts: g.receipts,
        inbound_moisture: g.inbound_moisture_n ? round2(g.inbound_moisture_sum / g.inbound_moisture_n) : null,
        flag: shrinkFlag(variance_pct)
      };
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance) || b.used - a.used);

  const opening = by_ingredient.reduce((s, r) => s + r.opening, 0);
  const inbound = by_ingredient.reduce((s, r) => s + r.inbound, 0);
  const used = by_ingredient.reduce((s, r) => s + r.used, 0);
  const expected_closing = by_ingredient.reduce((s, r) => s + r.expected_closing, 0);
  const closing = by_ingredient.reduce((s, r) => s + r.closing, 0);
  const book_variance = closing - expected_closing;
  const book_variance_pct = expected_closing ? round2((book_variance / expected_closing) * 100) : 0;
  const total_shrinkage_value = by_ingredient.reduce((s, r) => s + (r.shrinkage_value || 0), 0);

  const produced_tons = Number(prod.actual_tons || 0);
  const planned_tons = Number(prod.planned_tons || 0);
  const produced = tonsToMillMass(produced_tons, units.weight_unit);
  const planned = tonsToMillMass(planned_tons, units.weight_unit);

  let dispatched_tons = 0;
  let leftover = 0;
  for (const d of dispatchRows) {
    dispatched_tons += asTons(d.mill_mass != null ? d.mill_mass : d.quantity_tons, d.notes);
    const left = Number(d.leftover_mass || 0);
    leftover += left > 80 ? left : tonsToMillMass(left, units.weight_unit);
  }
  const dispatched = tonsToMillMass(dispatched_tons, units.weight_unit);

  const process_shrink = used - produced;
  const process_shrink_pct = used ? round2((process_shrink / used) * 100) : 0;
  const dispatch_gap = produced - dispatched;
  const dispatch_gap_pct = produced ? round2((dispatch_gap / produced) * 100) : 0;

  const inboundMoistureVals = inboundRows
    .map(r => Number(r.moisture_pct))
    .filter(n => Number.isFinite(n));
  const inbound_moisture = inboundMoistureVals.length
    ? round2(inboundMoistureVals.reduce((s, n) => s + n, 0) / inboundMoistureVals.length)
    : null;
  const finished_moisture = qc.finished_moisture != null ? round2(qc.finished_moisture) : null;
  const moisture_drop_pts = inbound_moisture != null && finished_moisture != null
    ? round2(inbound_moisture - finished_moisture)
    : null;

  const processFlag = shrinkFlag(process_shrink_pct, 1.5, 3);
  const bookFlag = shrinkFlag(book_variance_pct);
  const flags = [processFlag, bookFlag, ...by_ingredient.map(r => r.flag)];
  const status = flags.includes('flag') ? 'investigate' : flags.includes('warn') ? 'watch' : 'balanced';

  const byDayMap = {};
  for (const key of eachDate(bounds.from, bounds.to)) {
    byDayMap[key] = { date: key, inbound: 0, used: 0, produced: 0, dispatched: 0 };
  }
  for (const r of inboundRows) {
    const k = dayKey(r.receipt_date);
    if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
    byDayMap[k].inbound += Number(r.mill_mass || 0);
  }
  if (!inboundRows.length) {
    for (const r of invRows) {
      const k = String(r.record_date || '').slice(0, 10);
      if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
      byDayMap[k].inbound += Number(r.received || 0);
    }
  }
  for (const r of usageRows) {
    const k = dayKey(r.created_at);
    if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
    byDayMap[k].used += Number(r.used_mass || 0);
  }
  if (!usageRows.length) {
    for (const r of invRows) {
      const k = String(r.record_date || '').slice(0, 10);
      if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
      byDayMap[k].used += Number(r.used || 0);
    }
  }
  for (const b of prod.batches || []) {
    if (!isComplete(b.status)) continue;
    const k = b.day || dayKey(b.created_at);
    if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
    byDayMap[k].produced += tonsToMillMass(b.actual_tons, units.weight_unit);
  }
  for (const d of dispatchRows) {
    const k = dayKey(d.dispatched_at);
    if (!byDayMap[k]) byDayMap[k] = { date: k, inbound: 0, used: 0, produced: 0, dispatched: 0 };
    byDayMap[k].dispatched += tonsToMillMass(asTons(d.mill_mass != null ? d.mill_mass : d.quantity_tons, d.notes), units.weight_unit);
  }
  const by_day = Object.values(byDayMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      date: d.date,
      inbound: round2(d.inbound),
      used: round2(d.used),
      produced: round2(d.produced),
      dispatched: round2(d.dispatched),
      process_shrink: round2(d.used - d.produced)
    }));

  const equation = `Opening ${round2(opening)} + In ${round2(inbound)} − Used ${round2(used)} = expected ${round2(expected_closing)} · book ${round2(closing)} · process shrink ${round2(process_shrink)} (${process_shrink_pct}%)`;

  return {
    ok: true,
    report_type: 'mill_mass_balance',
    mill_id,
    period: p,
    from_date: bounds.from,
    to_date: bounds.to,
    date: p === 'day' ? bounds.from : `${bounds.from} → ${bounds.to}`,
    generated_at: new Date().toISOString(),
    weight_unit: units.weight_unit,
    large_weight_unit: units.large_weight_unit,
    status,
    opening: round2(opening),
    inbound: round2(inbound),
    received: round2(by_ingredient.reduce((s, r) => s + r.received, 0)),
    used: round2(used),
    used_batch: round2(by_ingredient.reduce((s, r) => s + r.used_batch, 0)),
    used_book: round2(by_ingredient.reduce((s, r) => s + r.used_book, 0)),
    produced: round2(produced),
    planned: round2(planned),
    produced_tons: round3(produced_tons),
    planned_tons: round3(planned_tons),
    dispatched: round2(dispatched),
    leftover: round2(leftover),
    expected_closing: round2(expected_closing),
    closing: round2(closing),
    book_stock: round2(closing),
    variance: round2(book_variance),
    variance_pct: book_variance_pct,
    process_shrink: round2(process_shrink),
    process_shrink_pct,
    dispatch_gap: round2(dispatch_gap),
    dispatch_gap_pct,
    inbound_moisture,
    finished_moisture,
    moisture_drop_pts,
    total_shrinkage_value: round2(total_shrinkage_value),
    batches: prod.total_batches,
    completed_batches: prod.completed_batches,
    dispatch_loads: dispatchRows.length,
    receipts: inboundRows.length,
    ingredients_tracked: by_ingredient.length,
    flagged_count: by_ingredient.filter(r => r.flag === 'flag').length,
    warned_count: by_ingredient.filter(r => r.flag === 'warn').length,
    equation,
    by_ingredient,
    by_day,
    shrink: (() => {
      try { return getShrinkageReport(mill_id, p === 'month' ? 30 : p === 'week' ? 7 : 1); }
      catch (_e) { return null; }
    })()
  };
}

// â”€â”€ DAILY PRODUCTION REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tons produced, batches, throughput, formula accuracy — whole mill
function getDailyProductionReport(mill_id, date = null) {
  const db   = getMillDb();
  const today = date || new Date().toISOString().slice(0, 10);
  const prod = getMillWideProduction(mill_id, 'day', today);
  const batches = prod.batches;

  const completed   = batches.filter(b => isComplete(b.status));
  const inProgress  = batches.filter(b => b.status === 'in_progress');
  const pending     = batches.filter(b => b.status === 'pending');

  // Ingredient deviation summary across all batches today
  const deviationSummary = db.prepare(`
    SELECT
      COUNT(*)                                              as total_ingredients,
      SUM(CASE WHEN i.deviation_flag = 'flag' THEN 1 ELSE 0 END) as flagged,
      SUM(CASE WHEN i.deviation_flag = 'warn' THEN 1 ELSE 0 END) as warned,
      SUM(CASE WHEN i.deviation_flag = 'none' THEN 1 ELSE 0 END) as passed,
      SUM(COALESCE(i.cost_impact, 0))                       as total_cost_impact,
      AVG(ABS(COALESCE(i.deviation_pct, 0)))                as avg_deviation_pct
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND substr(replace(b.created_at, 'T', ' '), 1, 10) = ?
      AND i.actual_kg IS NOT NULL
  `).get(mill_id, today);

  // Downtime today
  const downtime = db.prepare(`
    SELECT
      COUNT(*)                          as events,
      SUM(COALESCE(duration_minutes,0)) as total_minutes,
      SUM(COALESCE(estimated_cost,0))   as total_cost
    FROM mill_downtime_events
    WHERE mill_id = ? AND DATE(started_at) = ?
  `).get(mill_id, today);

  return {
    ok: true,
    report_type:        'daily_production',
    mill_id,
    date:               today,
    generated_at:       new Date().toISOString(),

    // Production summary — whole mill, every formula
    total_batches:      prod.total_batches,
    completed_batches:  prod.completed_batches,
    in_progress:        inProgress.length,
    pending_batches:    pending.length,
    planned_tons:       prod.planned_tons,
    actual_tons:        prod.actual_tons,
    completion_rate:    prod.completion_rate,
    formulas:           prod.formulas,
    by_formula:         prod.by_formula,
    by_day:             prod.by_day,

    // Formula accuracy
    deviation_summary:  deviationSummary,
    formula_accuracy:   deviationSummary?.total_ingredients > 0
      ? Math.round(((deviationSummary.passed || 0) / deviationSummary.total_ingredients) * 100)
      : null,

    // Downtime
    downtime: {
      events:        downtime?.events        || 0,
      total_minutes: downtime?.total_minutes || 0,
      total_cost:    Math.round((downtime?.total_cost || 0) * 100) / 100
    },

    // Batch list
    batches: prod.batches
  };
}

// â”€â”€ DAILY FORMULA VS ACTUAL REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Planned vs actual per ingredient across all today's batches
function getDailyFormulaVsActualReport(mill_id, date = null) {
  const db    = getMillDb();
  const today = date || new Date().toISOString().slice(0, 10);

  const ingredients = db.prepare(`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      COUNT(DISTINCT i.batch_id)              as batch_count,
      SUM(i.planned_kg)                       as total_planned_kg,
      SUM(COALESCE(i.actual_kg, 0))           as total_actual_kg,
      AVG(COALESCE(i.deviation_pct, 0))       as avg_deviation_pct,
      SUM(COALESCE(i.cost_impact, 0))         as total_cost_impact,
      SUM(CASE WHEN i.deviation_flag = 'flag' THEN 1 ELSE 0 END) as flag_count,
      SUM(CASE WHEN i.deviation_flag = 'warn' THEN 1 ELSE 0 END) as warn_count
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) = ?
      AND i.actual_kg IS NOT NULL
    GROUP BY i.ingredient_id, i.ingredient_name
    ORDER BY ABS(SUM(COALESCE(i.cost_impact, 0))) DESC
  `).all(mill_id, today);

  const totalCostImpact = ingredients.reduce(
    (s, i) => s + (i.total_cost_impact || 0), 0
  );
  const totalFlagged = ingredients.reduce((s, i) => s + (i.flag_count || 0), 0);
  const totalWarned  = ingredients.reduce((s, i) => s + (i.warn_count || 0), 0);

  return {
    ok: true,
    report_type:       'daily_formula_vs_actual',
    mill_id,
    date:              today,
    generated_at:      new Date().toISOString(),
    total_cost_impact: Math.round(totalCostImpact * 100) / 100,
    total_flagged:     totalFlagged,
    total_warned:      totalWarned,
    ingredients:       ingredients.map(i => ({
      ...i,
      avg_deviation_pct: Math.round(i.avg_deviation_pct * 100) / 100,
      total_cost_impact: Math.round(i.total_cost_impact * 100) / 100,
      status: i.flag_count > 0 ? 'flag' : i.warn_count > 0 ? 'warn' : 'pass'
    }))
  };
}

// â”€â”€ DAILY COST PER TON REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// True cost per ton including ingredient overuse and waste
function getDailyCostReport(mill_id, date = null) {
  const db    = getMillDb();
  const today = date || new Date().toISOString().slice(0, 10);

  const batches = db.prepare(`
    SELECT
      b.id, b.batch_number, b.planned_qty_tons, b.actual_qty_tons,
      s.formula_name, s.feed_type, s.cost_per_ton as target_cost_per_ton,
      SUM(COALESCE(i.planned_cost, 0)) as planned_ingredient_cost,
      SUM(COALESCE(i.actual_cost,  0)) as actual_ingredient_cost,
      SUM(COALESCE(i.cost_impact,  0)) as cost_deviation
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    LEFT JOIN mill_batch_ingredients i ON b.id = i.batch_id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) = ?
      AND b.status IN ('completed', 'reviewed', 'dispatched')
    GROUP BY b.id
  `).all(mill_id, today);

  const enriched = batches.map(b => {
    const qty = b.actual_qty_tons || b.planned_qty_tons || 1;
    const actual_cost_per_ton = qty > 0
      ? Math.round((b.actual_ingredient_cost / qty) * 100) / 100
      : null;
    const variance_per_ton = b.target_cost_per_ton && actual_cost_per_ton
      ? Math.round((actual_cost_per_ton - b.target_cost_per_ton) * 100) / 100
      : null;

    return {
      ...b,
      actual_cost_per_ton,
      variance_per_ton,
      planned_ingredient_cost: Math.round(b.planned_ingredient_cost * 100) / 100,
      actual_ingredient_cost:  Math.round(b.actual_ingredient_cost  * 100) / 100,
      cost_deviation:          Math.round(b.cost_deviation          * 100) / 100
    };
  });

  const totalActualCost   = enriched.reduce((s, b) => s + (b.actual_ingredient_cost || 0), 0);
  const totalPlannedCost  = enriched.reduce((s, b) => s + (b.planned_ingredient_cost || 0), 0);
  const totalCostDeviation = totalActualCost - totalPlannedCost;

  return {
    ok: true,
    report_type:          'daily_cost_per_ton',
    mill_id,
    date:                 today,
    generated_at:         new Date().toISOString(),
    total_planned_cost:   Math.round(totalPlannedCost   * 100) / 100,
    total_actual_cost:    Math.round(totalActualCost    * 100) / 100,
    total_cost_deviation: Math.round(totalCostDeviation * 100) / 100,
    batches:              enriched
  };
}

// â”€â”€ WEEKLY TOP 3 LOSSES REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Owner-level one-page decision report
function getWeeklyTop3LossesReport(mill_id) {
  const db   = getMillDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  // Top loss ingredients
  const topIngredients = db.prepare(`
    SELECT
      i.ingredient_name,
      COUNT(DISTINCT b.id)              as batch_count,
      SUM(ABS(COALESCE(i.cost_impact,0))) as total_impact,
      AVG(ABS(COALESCE(i.deviation_pct,0))) as avg_deviation,
      SUM(CASE WHEN i.deviation_flag = 'flag' THEN 1 ELSE 0 END) as flag_count
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) >= ?
      AND i.actual_kg IS NOT NULL
      AND ABS(COALESCE(i.cost_impact,0)) > 0
    GROUP BY i.ingredient_id, i.ingredient_name
    ORDER BY total_impact DESC
    LIMIT 3
  `).all(mill_id, cutoffDate);

  // Shrinkage losses
  const shrinkageLoss = db.prepare(`
    SELECT SUM(COALESCE(shrinkage_value,0)) as total
    FROM mill_inventory
    WHERE mill_id = ? AND record_date >= ?
  `).get(mill_id, cutoffDate);

  // Downtime losses
  const downtimeLoss = db.prepare(`
    SELECT SUM(COALESCE(estimated_cost,0)) as total
    FROM mill_downtime_events
    WHERE mill_id = ? AND DATE(started_at) >= ?
  `).get(mill_id, cutoffDate);

  // QC failures
  const qcFailures = db.prepare(`
    SELECT COUNT(*) as count
    FROM mill_qc_results q
    JOIN mill_batches b ON q.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) >= ?
      AND q.overall_status = 'fail'
  `).get(mill_id, cutoffDate);

  const totalLoss =
    topIngredients.reduce((s, i) => s + (i.total_impact || 0), 0) +
    (shrinkageLoss?.total || 0) +
    (downtimeLoss?.total  || 0);

  return {
    ok: true,
    report_type:     'weekly_top3_losses',
    mill_id,
    period_days:     7,
    from_date:       cutoffDate,
    generated_at:    new Date().toISOString(),
    total_loss:      Math.round(totalLoss * 100) / 100,
    top_ingredients: topIngredients.map(i => ({
      ...i,
      total_impact:  Math.round(i.total_impact  * 100) / 100,
      avg_deviation: Math.round(i.avg_deviation * 100) / 100
    })),
    shrinkage_loss:  Math.round((shrinkageLoss?.total || 0) * 100) / 100,
    downtime_loss:   Math.round((downtimeLoss?.total  || 0) * 100) / 100,
    qc_failures:     qcFailures?.count || 0
  };
}

// â”€â”€ WEEKLY MILL PERFORMANCE REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getWeeklyMillPerformanceReport(mill_id) {
  const db      = getMillDb();
  const prod    = getMillWideProduction(mill_id, 'week');
  const cutoffDate = prod.from_date;
  const dailyStats = (prod.by_day || []).map(d => ({
    date: d.date,
    total_batches: d.batches,
    planned_tons: d.planned_tons,
    actual_tons: d.actual_tons,
    completed: d.completed
  }));

  const totalBatches   = prod.total_batches;
  const totalCompleted = prod.completed_batches;
  const totalTons      = prod.actual_tons;

  // Best and worst day
  const worked     = dailyStats.filter(d => d.total_batches > 0);
  const sorted     = [...worked].sort((a, b) => b.actual_tons - a.actual_tons);
  const bestDay    = sorted[0]  || null;
  const worstDay   = sorted[sorted.length - 1] || null;

  // Downtime trend
  const downtimeTrend = db.prepare(`
    SELECT
      DATE(started_at) as date,
      COUNT(*)         as events,
      SUM(COALESCE(duration_minutes,0)) as minutes,
      SUM(COALESCE(estimated_cost,0))   as cost
    FROM mill_downtime_events
    WHERE mill_id = ? AND DATE(started_at) >= ?
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `).all(mill_id, cutoffDate);

  return {
    ok: true,
    report_type:      'weekly_mill_performance',
    mill_id,
    period_days:      7,
    from_date:        cutoffDate,
    generated_at:     new Date().toISOString(),
    total_batches:    totalBatches,
    total_completed:  totalCompleted,
    completion_rate:  totalBatches > 0
      ? Math.round((totalCompleted / totalBatches) * 100) : 0,
    total_tons:       Math.round(totalTons * 100) / 100,
    avg_tons_per_day: prod.avg_tons_per_day,
    best_day:         bestDay,
    worst_day:        worstDay,
    daily_stats:      dailyStats,
    by_formula:       prod.by_formula,
    downtime_trend:   downtimeTrend
  };
}

// â”€â”€ WEEKLY SUPPLIER WATCH REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getWeeklySupplierWatchReport(mill_id) {
  const db     = getMillDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const lots = db.prepare(`
    SELECT
      supplier_name,
      ingredient_name,
      COUNT(*)                                    as lot_count,
      AVG(COALESCE(moisture_pct,0))               as avg_moisture,
      SUM(CASE WHEN qc_status = 'rejected'   THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN qc_status = 'quarantine' THEN 1 ELSE 0 END) as quarantine,
      SUM(CASE WHEN qc_status = 'accepted'   THEN 1 ELSE 0 END) as accepted,
      SUM(CASE WHEN qc_status = 'pending'    THEN 1 ELSE 0 END) as pending,
      SUM(COALESCE(quantity_kg,0))                as total_kg,
      AVG(COALESCE(price_per_kg,0))               as avg_price_per_kg
    FROM mill_supplier_lots
    WHERE mill_id = ? AND received_date >= ?
    GROUP BY supplier_name, ingredient_name
    ORDER BY rejected DESC, quarantine DESC
  `).all(mill_id, cutoffDate);

  // Score each supplier
  const scored = lots.map(lot => {
    const total      = lot.lot_count || 1;
    const pass_rate  = Math.round(((lot.accepted || 0) / total) * 100);
    const risk_score =
      lot.rejected   > 0 ? 'high'   :
      lot.quarantine > 0 ? 'medium' :
      lot.pending    > 0 ? 'low'    :
      'clear';

    return {
      ...lot,
      avg_moisture:   Math.round((lot.avg_moisture   || 0) * 100) / 100,
      avg_price_per_kg: Math.round((lot.avg_price_per_kg || 0) * 100) / 100,
      pass_rate,
      risk_score
    };
  });

  const highRisk = scored.filter(s => s.risk_score === 'high');

  return {
    ok: true,
    report_type:      'weekly_supplier_watch',
    mill_id,
    period_days:      7,
    from_date:        cutoffDate,
    generated_at:     new Date().toISOString(),
    total_suppliers:  [...new Set(lots.map(l => l.supplier_name))].length,
    high_risk_count:  highRisk.length,
    high_risk:        highRisk,
    suppliers:        scored
  };
}

// â”€â”€ MONTHLY PROFITABILITY REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getMonthlyProfitabilityReport(mill_id, year = null, month = null) {
  const db   = getMillDb();
  const now  = new Date();
  const y    = year  || now.getFullYear();
  const m    = month || now.getMonth() + 1;
  const pad  = String(m).padStart(2, '0');
  const from = `${y}-${pad}-01`;
  const to   = `${y}-${pad}-31`;

  const batches = db.prepare(`
    SELECT
      s.feed_type,
      COUNT(b.id)                              as batch_count,
      SUM(COALESCE(b.planned_qty_tons,0))      as planned_tons,
      SUM(COALESCE(b.actual_qty_tons, b.planned_qty_tons, 0)) as actual_tons,
      SUM(COALESCE(i.planned_cost,0))          as planned_cost,
      SUM(COALESCE(i.actual_cost, 0))          as actual_cost,
      SUM(COALESCE(i.cost_impact, 0))          as cost_deviation
    FROM mill_batches b
    LEFT JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    LEFT JOIN mill_batch_ingredients i ON b.id = i.batch_id
    WHERE b.mill_id = ?
      AND substr(replace(b.created_at, 'T', ' '), 1, 10) BETWEEN ? AND ?
      AND b.status IN ('completed','reviewed','dispatched')
    GROUP BY s.feed_type
    ORDER BY actual_tons DESC
  `).all(mill_id, from, to);

  const totalPlanned   = batches.reduce((s, b) => s + (b.planned_cost    || 0), 0);
  const totalActual    = batches.reduce((s, b) => s + (b.actual_cost     || 0), 0);
  const totalDeviation = batches.reduce((s, b) => s + (b.cost_deviation  || 0), 0);
  const totalTons      = batches.reduce((s, b) => s + (b.actual_tons     || 0), 0);

  // Monthly downtime cost
  const downtimeCost = db.prepare(`
    SELECT SUM(COALESCE(estimated_cost,0)) as total
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) BETWEEN ? AND ?
  `).get(mill_id, from, to);

  // Monthly shrinkage
  const shrinkageCost = db.prepare(`
    SELECT SUM(COALESCE(shrinkage_value,0)) as total
    FROM mill_inventory
    WHERE mill_id = ? AND record_date BETWEEN ? AND ?
  `).get(mill_id, from, to);

  const totalLoss =
    totalDeviation +
    (downtimeCost?.total  || 0) +
    (shrinkageCost?.total || 0);

  return {
    ok: true,
    report_type:         'monthly_profitability',
    mill_id,
    year:                y,
    month:               m,
    period:              `${y}-${pad}`,
    generated_at:        new Date().toISOString(),
    total_planned_cost:  Math.round(totalPlanned   * 100) / 100,
    total_actual_cost:   Math.round(totalActual    * 100) / 100,
    total_deviation:     Math.round(totalDeviation * 100) / 100,
    total_tons:          Math.round(totalTons      * 100) / 100,
    cost_per_ton:        totalTons > 0
      ? Math.round((totalActual / totalTons) * 100) / 100 : null,
    downtime_cost:       Math.round((downtimeCost?.total  || 0) * 100) / 100,
    shrinkage_cost:      Math.round((shrinkageCost?.total || 0) * 100) / 100,
    total_identified_loss: Math.round(totalLoss * 100) / 100,
    by_feed_type:        batches.map(b => ({
      ...b,
      planned_cost:   Math.round(b.planned_cost   * 100) / 100,
      actual_cost:    Math.round(b.actual_cost    * 100) / 100,
      cost_deviation: Math.round(b.cost_deviation * 100) / 100,
      cost_per_ton:   b.actual_tons > 0
        ? Math.round((b.actual_cost / b.actual_tons) * 100) / 100 : null
    }))
  };
}

// â”€â”€ MONTHLY LOSS RECOVERY REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The subscription-retention report â€” shows what was detected and fixed
function getMonthlyLossRecoveryReport(mill_id, year = null, month = null) {
  const db   = getMillDb();
  const now  = new Date();
  const y    = year  || now.getFullYear();
  const m    = month || now.getMonth() + 1;
  const pad  = String(m).padStart(2, '0');
  const from = `${y}-${pad}-01`;
  const to   = `${y}-${pad}-31`;

  // Total losses detected
  const deviationLoss = db.prepare(`
    SELECT SUM(ABS(COALESCE(i.cost_impact,0))) as total
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) BETWEEN ? AND ?
      AND i.actual_kg IS NOT NULL
  `).get(mill_id, from, to);

  const shrinkageLoss = db.prepare(`
    SELECT SUM(COALESCE(shrinkage_value,0)) as total
    FROM mill_inventory
    WHERE mill_id = ? AND record_date BETWEEN ? AND ?
  `).get(mill_id, from, to);

  const downtimeLoss = db.prepare(`
    SELECT SUM(COALESCE(estimated_cost,0)) as total
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) BETWEEN ? AND ?
      AND downtime_type = 'unplanned'
  `).get(mill_id, from, to);

  // Batch counts
  const batchStats = db.prepare(`
    SELECT
      COUNT(*)                                          as total,
      SUM(CASE WHEN status IN ('reviewed','dispatched') THEN 1 ELSE 0 END) as reviewed
    FROM mill_batches
    WHERE mill_id = ?
      AND DATE(created_at) BETWEEN ? AND ?
  `).get(mill_id, from, to);

  // QC stats
  const qcStats = db.prepare(`
    SELECT
      COUNT(*)                                           as total,
      SUM(CASE WHEN overall_status = 'pass' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN overall_status = 'fail' THEN 1 ELSE 0 END) as failed
    FROM mill_qc_results q
    JOIN mill_batches b ON q.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) BETWEEN ? AND ?
  `).get(mill_id, from, to);

  const totalDetected =
    (deviationLoss?.total || 0) +
    (shrinkageLoss?.total || 0) +
    (downtimeLoss?.total  || 0);

  return {
    ok: true,
    report_type:            'monthly_loss_recovery',
    mill_id,
    year:                   y,
    month:                  m,
    period:                 `${y}-${pad}`,
    generated_at:           new Date().toISOString(),

    // What the system detected
    total_loss_detected:    Math.round(totalDetected        * 100) / 100,
    deviation_loss:         Math.round((deviationLoss?.total || 0) * 100) / 100,
    shrinkage_loss:         Math.round((shrinkageLoss?.total || 0) * 100) / 100,
    downtime_loss:          Math.round((downtimeLoss?.total  || 0) * 100) / 100,

    // Operational performance
    batches_total:          batchStats?.total    || 0,
    batches_reviewed:       batchStats?.reviewed || 0,
    review_rate:            batchStats?.total > 0
      ? Math.round(((batchStats.reviewed || 0) / batchStats.total) * 100) : 0,

    // QC performance
    qc_tested:              qcStats?.total  || 0,
    qc_passed:              qcStats?.passed || 0,
    qc_failed:              qcStats?.failed || 0,
    qc_pass_rate:           qcStats?.total > 0
      ? Math.round(((qcStats.passed || 0) / qcStats.total) * 100) : 0,

    // Value of the system
    value_statement: totalDetected > 0
      ? `This system identified $${totalDetected.toFixed(2)} in losses this month across formula deviation, shrinkage, and unplanned downtime.`
      : 'No significant losses detected this month.'
  };
}

// â”€â”€ BATCH PASSPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Complete audit-ready record for one batch
// Every ingredient, QC result, dispatch, and timeline in one document
function getBatchPassport(batch_id) {
  const db = getMillDb();

  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.feed_type, s.species,
           s.formula_json, s.nutrients_json, s.cost_per_ton,
           s.released_by, s.released_at, s.formula_version
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const ingredients = db.prepare(`
    SELECT * FROM mill_batch_ingredients
    WHERE batch_id = ? ORDER BY ingredient_name
  `).all(batch_id);

  const qc = db.prepare(
    'SELECT * FROM mill_qc_results WHERE batch_id = ?'
  ).get(batch_id);

  const dispatches = db.prepare(
    'SELECT * FROM mill_dispatch_records WHERE batch_id = ? ORDER BY dispatched_at'
  ).all(batch_id);

  const complaints = db.prepare(
    'SELECT * FROM mill_complaints WHERE batch_id = ?'
  ).all(batch_id);

  // Deviation summary
  const withActuals  = ingredients.filter(i => i.actual_kg !== null);
  const flagged      = ingredients.filter(i => i.deviation_flag === 'flag');
  const warned       = ingredients.filter(i => i.deviation_flag === 'warn');
  const totalPlanned = ingredients.reduce((s, i) => s + (i.planned_kg    || 0), 0);
  const totalActual  = withActuals.reduce((s, i) => s + (i.actual_kg     || 0), 0);
  const totalCost    = withActuals.reduce((s, i) => s + (i.cost_impact   || 0), 0);

  // Overall quality determination
  const overall_quality =
    flagged.length > 2 || (qc?.overall_status === 'fail') ? 'poor'      :
    flagged.length > 0 || (qc?.overall_status === 'warn') ? 'acceptable':
    'good';

  return {
    ok: true,
    report_type:       'batch_passport',
    generated_at:      new Date().toISOString(),

    // Identity
    batch_id,
    batch_number:      batch.batch_number,
    formula_name:      batch.formula_name,
    formula_version:   batch.formula_version,
    species:           batch.species,
    feed_type:         batch.feed_type,
    overall_quality,

    // Production
    planned_qty_tons:  batch.planned_qty_tons,
    actual_qty_tons:   batch.actual_qty_tons,
    status:            batch.status,
    connector_source:  batch.connector_source,
    operator_id:       batch.operator_id,

    // Timeline
    timeline: {
      released_at:   batch.released_at,
      released_by:   batch.released_by,
      created_at:    batch.created_at,
      started_at:    batch.started_at,
      completed_at:  batch.completed_at,
      reviewed_at:   batch.reviewed_at,
      dispatched_at: batch.dispatched_at
    },

    // Formula execution
    formula_execution: {
      ingredients_total:    ingredients.length,
      actuals_recorded:     withActuals.length,
      flagged_count:        flagged.length,
      warned_count:         warned.length,
      total_planned_kg:     Math.round(totalPlanned * 100) / 100,
      total_actual_kg:      Math.round(totalActual  * 100) / 100,
      total_cost_impact:    Math.round(totalCost    * 100) / 100,
      ingredients
    },

    // Quality control
    qc: qc || { status: 'not_tested' },

    // Distribution
    dispatch: {
      count:      dispatches.length,
      recipients: dispatches.map(d => ({
        customer_name:   d.customer_name,
        farm_id:         d.farm_id,
        quantity_tons:   d.quantity_tons,
        dispatched_at:   d.dispatched_at,
        delivery_status: d.delivery_status
      }))
    },

    // Complaints
    complaints: {
      count:      complaints.length,
      records:    complaints
    }
  };
}

// â”€â”€ FULL DAILY PACKAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All daily reports in one call â€” for the daily report bundle
function getFullDailyPackage(mill_id, date = null) {
  const today = date || new Date().toISOString().slice(0, 10);

  return {
    ok: true,
    report_type:    'full_daily_package',
    mill_id,
    date:           today,
    generated_at:   new Date().toISOString(),
    production:     getDailyProductionReport(mill_id, today),
    formula_vs_actual: getDailyFormulaVsActualReport(mill_id, today),
    cost:           getDailyCostReport(mill_id, today),
    money_leak:     getMoneyLeakSummary(mill_id, 'today'),
    decision:       getDailyDecisionSummary(mill_id, today),
    mass_balance:   getMillMassBalance(mill_id, 'day', today)
  };
}

// â”€â”€ FULL WEEKLY PACKAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getFullWeeklyPackage(mill_id) {
  return {
    ok: true,
    report_type:   'full_weekly_package',
    mill_id,
    generated_at:  new Date().toISOString(),
    performance:   getWeeklyMillPerformanceReport(mill_id),
    top3_losses:   getWeeklyTop3LossesReport(mill_id),
    shrinkage:     getShrinkageReport(mill_id, 7),
    mass_balance:  getMillMassBalance(mill_id, 'week'),
    qc_trend:      getQcTrend(mill_id, 7),
    deviation_history: getDeviationHistory(mill_id, 20),
    supplier_watch: getWeeklySupplierWatchReport(mill_id),
    drift:         detectFormulaDrift(mill_id, 7),
    maintenance_alerts: getMaintenanceAlerts(mill_id, 7)
  };
}

// â”€â”€ FULL MONTHLY PACKAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getFullMonthlyPackage(mill_id, year = null, month = null) {
  return {
    ok: true,
    report_type:   'full_monthly_package',
    mill_id,
    generated_at:  new Date().toISOString(),
    profitability: getMonthlyProfitabilityReport(mill_id, year, month),
    loss_recovery: getMonthlyLossRecoveryReport(mill_id, year, month),
    qc_trend:      getQcTrend(mill_id, 30),
    shrinkage:     getShrinkageReport(mill_id, 30),
    mass_balance:  getMillMassBalance(mill_id, 'month'),
    dispatch:      getDispatchHistory(mill_id, 30),
    downtime:      getDowntimeHistory(mill_id, 30),
    risk_overview: scoreMillBatches(mill_id),
    supplier_watch: getWeeklySupplierWatchReport(mill_id)
  };
}

module.exports = {
  getMillWideProduction,
  getMillMassBalance,
  getDailyProductionReport,
  getDailyFormulaVsActualReport,
  getDailyCostReport,
  getWeeklyTop3LossesReport,
  getWeeklyMillPerformanceReport,
  getWeeklySupplierWatchReport,
  getMonthlyProfitabilityReport,
  getMonthlyLossRecoveryReport,
  getBatchPassport,
  getFullDailyPackage,
  getFullWeeklyPackage,
  getFullMonthlyPackage
};