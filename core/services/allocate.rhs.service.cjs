'use strict';

/**
 * Usable mill tonnes for joint allocation.
 * physical stock − locked lots − reserved batches + inbound POs in the period.
 */

function safeRequire(p) {
  try { return require(p); } catch { return null; }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function keyOf(name, id) {
  return String(name || id || '').trim().toLowerCase();
}

function openMillDb() {
  const mill = safeRequire('../db/mill/mill.db.cjs');
  if (mill && typeof mill.getMillDb === 'function') {
    try { return mill.getMillDb(); } catch { /* fall through */ }
  }
  return null;
}

function tableExists(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function latestInventoryTons(db, millId) {
  const out = new Map();
  if (!tableExists(db, 'mill_inventory')) return out;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT ingredient_id, ingredient_name, record_date, opening, received, used, closing
      FROM mill_inventory WHERE mill_id = ?
    `).all(millId);
  } catch {
    return out;
  }
  const latest = new Map();
  for (const r of rows) {
    const k = r.ingredient_id || r.ingredient_name;
    const prev = latest.get(k);
    if (!prev || String(r.record_date) > String(prev.record_date)) latest.set(k, r);
  }
  for (const r of latest.values()) {
    const kg = (r.closing != null && Number(r.closing) > 0)
      ? num(r.closing)
      : num(r.opening) + num(r.received) - num(r.used);
    const k = keyOf(r.ingredient_name, r.ingredient_id);
    if (!k) continue;
    out.set(k, { name: r.ingredient_name || r.ingredient_id, id: r.ingredient_id, stock_kg: Math.max(0, kg) });
  }
  return out;
}

function lockedLotKg(db, millId) {
  const byKey = new Map();
  if (!tableExists(db, 'mill_supplier_lots')) return byKey;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT ingredient_id, ingredient_name, quantity_kg, lock_status, qc_status
      FROM mill_supplier_lots WHERE mill_id = ?
    `).all(millId);
  } catch {
    return byKey;
  }
  for (const r of rows) {
    const locked = r.lock_status === 'locked' || r.qc_status === 'rejected' || r.qc_status === 'quarantine';
    if (!locked) continue;
    const k = keyOf(r.ingredient_name, r.ingredient_id);
    if (!k) continue;
    byKey.set(k, (byKey.get(k) || 0) + num(r.quantity_kg));
  }
  return byKey;
}

function reservedBatchKg(db, millId) {
  const byKey = new Map();
  if (!tableExists(db, 'mill_batches')) return byKey;
  let batches = [];
  try {
    batches = db.prepare(`
      SELECT id, status FROM mill_batches
      WHERE mill_id = ? AND lower(IFNULL(status,'')) IN ('queued','pending','released','planned','hold')
    `).all(millId);
  } catch {
    return byKey;
  }
  if (!batches.length) return byKey;
  const hasIng = tableExists(db, 'mill_batch_ingredients');
  for (const b of batches) {
    if (hasIng) {
      try {
        const rows = db.prepare(`
          SELECT ingredient_id, ingredient_name, planned_kg FROM mill_batch_ingredients WHERE batch_id = ?
        `).all(b.id);
        for (const r of rows) {
          const k = keyOf(r.ingredient_name, r.ingredient_id);
          if (!k) continue;
          byKey.set(k, (byKey.get(k) || 0) + num(r.planned_kg));
        }
      } catch { /* ignore */ }
    }
  }
  return byKey;
}

function inboundPoKg(db, periodStart, periodEnd) {
  const byKey = new Map();
  if (!tableExists(db, 'purchase_orders') || !tableExists(db, 'purchase_order_lines')) return byKey;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT l.ingredient_id, l.ingredient_name, l.quantity, l.unit, p.delivery_date, p.status
      FROM purchase_order_lines l
      JOIN purchase_orders p ON p.id = l.po_id
      WHERE lower(IFNULL(p.status,'')) IN ('approved','submitted','draft')
    `).all();
  } catch {
    return byKey;
  }
  const start = periodStart ? String(periodStart).slice(0, 10) : '';
  const end = periodEnd ? String(periodEnd).slice(0, 10) : '';
  for (const r of rows) {
    const d = String(r.delivery_date || '').slice(0, 10);
    if (start && d && d < start) continue;
    if (end && d && d > end) continue;
    const unit = String(r.unit || 'mt').toLowerCase();
    let kg = num(r.quantity);
    if (unit === 'mt' || unit === 't' || unit === 'ton' || unit === 'tonne') kg *= 1000;
    else if (unit === 'lb') kg *= 0.453592;
    const k = keyOf(r.ingredient_name, r.ingredient_id);
    if (!k || kg <= 0) continue;
    byKey.set(k, (byKey.get(k) || 0) + kg);
  }
  return byKey;
}

function resolveUsableTonnes({ mill_id, period_start = null, period_end = null, extra_stock = [] } = {}) {
  const items = new Map();
  const db = mill_id ? openMillDb() : null;
  if (db && mill_id) {
    const stock = latestInventoryTons(db, mill_id);
    const locked = lockedLotKg(db, mill_id);
    const reserved = reservedBatchKg(db, mill_id);
    const inbound = inboundPoKg(db, period_start, period_end);
    const keys = new Set([...stock.keys(), ...locked.keys(), ...reserved.keys(), ...inbound.keys()]);
    for (const k of keys) {
      const s = stock.get(k) || { name: k, id: k, stock_kg: 0 };
      const locked_kg = locked.get(k) || 0;
      const reserved_kg = reserved.get(k) || 0;
      const inbound_kg = inbound.get(k) || 0;
      const physical = Math.max(0, s.stock_kg);
      const usable_kg = Math.max(0, physical - locked_kg - reserved_kg);
      items.set(k, {
        key: k,
        name: s.name || k,
        id: s.id || k,
        stock_t: physical / 1000,
        locked_t: locked_kg / 1000,
        reserved_t: reserved_kg / 1000,
        inbound_t: inbound_kg / 1000,
        usable_t: usable_kg / 1000,
        available_t: (usable_kg + inbound_kg) / 1000,
        source: 'mill'
      });
    }
  }

  for (const row of extra_stock || []) {
    const k = keyOf(row.name, row.id);
    if (!k) continue;
    const cur = items.get(k) || {
      key: k, name: row.name || k, id: row.id || k,
      stock_t: 0, locked_t: 0, reserved_t: 0, inbound_t: 0, usable_t: 0, available_t: 0, source: 'typed'
    };
    if (row.usable_t != null || row.available_t != null || row.stock_t != null) {
      const typed = num(row.usable_t ?? row.available_t ?? row.stock_t);
      if (cur.source === 'typed' || cur.available_t <= 0) {
        cur.usable_t = typed;
        cur.available_t = typed + num(cur.inbound_t);
        cur.source = cur.source === 'mill' ? 'mill+typed' : 'typed';
      } else {
        cur.usable_t = Math.min(cur.usable_t, typed);
        cur.available_t = cur.usable_t + num(cur.inbound_t);
      }
    }
    if (row.inbound_t != null) cur.inbound_t = Math.max(cur.inbound_t, num(row.inbound_t));
    if (row.must_use_t != null) cur.must_use_t = num(row.must_use_t, 0);
    if (row.unlimited) cur.unlimited = true;
    items.set(k, cur);
  }

  return {
    mill_id: mill_id || null,
    period_start: period_start || null,
    period_end: period_end || null,
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

function farmPlanTons({ formulas = [], days = 30 } = {}) {
  const fp = safeRequire('./farmpulse/farmpulse.service.cjs');
  if (!fp || typeof fp.getFlocks !== 'function') {
    return { ok: false, error: 'Farm Pulse is not available', rows: [] };
  }
  let flocks = [];
  try { flocks = fp.getFlocks({ status: 'active' }) || []; } catch { flocks = []; }
  const rows = [];
  for (const f of formulas) {
    const species = String(f.species || f.type || f.phase || '').toLowerCase();
    const name = String(f.name || f.formula_name || '').toLowerCase();
    const hits = flocks.filter(fl => {
      const pt = String(fl.production_type || '').toLowerCase();
      const breed = String(fl.breed || '').toLowerCase();
      const farmSpecies = String(fl.species || '').toLowerCase();
      if (name && (name.includes(pt) || name.includes(breed))) return true;
      if (species && (species.includes(pt) || pt.includes(species) || species.includes(farmSpecies))) return true;
      return false;
    });
    let tons = 0;
    const used = [];
    for (const fl of hits) {
      const birds = num(fl.initial_count);
      const intakeKg = num(fl.latest_kpis?.feed_intake_kg || fl.kpi_feed_intake_kg);
      const intakePerBirdG = birds > 0 && intakeKg > 0 ? (intakeKg * 1000) / birds : 0;
      const dailyKg = intakePerBirdG > 0 ? (intakePerBirdG / 1000) * birds : intakeKg;
      const t = (dailyKg * num(days, 30)) / 1000;
      if (t > 0) {
        tons += t;
        used.push({ flock_id: fl.id, flock_code: fl.flock_code, farm_name: fl.farm_name, tons: Math.round(t * 100) / 100 });
      }
    }
    rows.push({
      formula_id: f.id,
      formula_name: f.name || f.formula_name,
      tons: Math.round(tons * 100) / 100,
      flocks: used
    });
  }
  return { ok: true, days: num(days, 30), rows };
}

module.exports = { resolveUsableTonnes, farmPlanTons };
