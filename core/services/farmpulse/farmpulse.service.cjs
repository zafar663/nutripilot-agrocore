"use strict";
// ============================================================
// FarmPulse Service — All CRUD + KPI computation
// nutripilot-agrocore/core/services/farmpulse/farmpulse.service.cjs
// ============================================================

const { getFarmPulseDb } = require("../../db/farmpulse/farmpulse.db.cjs");

// ── Helpers ──────────────────────────────────────────────────────────────────
function now() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

function computeKpis({ bird_count, feed_intake_kg, avg_body_weight_g,
  mortality_count, cull_count, age_days, prev_body_weight_g, egg_count, entry_frequency }) {
  const out = {};
  const periodDays = entry_frequency === 'weekly' ? 7 : entry_frequency === 'monthly' ? 30 : 1;

  // Feed per bird
  if (feed_intake_kg != null && bird_count > 0)
    out.feed_intake_per_bird_g = (feed_intake_kg * 1000) / bird_count;

  // ADG — weight gain divided by period days
  if (avg_body_weight_g != null && prev_body_weight_g != null)
    out.adg_g = (avg_body_weight_g - prev_body_weight_g) / periodDays;

  // FCR = total period feed per bird / weight gain per bird (in kg)
  if (feed_intake_kg != null && avg_body_weight_g != null && prev_body_weight_g != null && bird_count > 0) {
    const totalFeedKg = feed_intake_kg * periodDays;
    const gainKgPerBird = (avg_body_weight_g - prev_body_weight_g) / 1000;
    if (gainKgPerBird > 0) out.fcr_period = (totalFeedKg / bird_count) / gainKgPerBird;
  }

  // Mortality %
  if (mortality_count != null && bird_count > 0)
    out.mortality_rate_pct = (mortality_count / bird_count) * 100;

  // EPI = (livability% * avg_bw_kg * 100) / (FCR * age)
  if (out.fcr_period && age_days && avg_body_weight_g && mortality_count != null && bird_count > 0) {
    const livability = ((bird_count - (mortality_count || 0)) / bird_count) * 100;
    out.epi = (livability * (avg_body_weight_g / 1000) * 100) / (out.fcr_period * age_days);
  }

  // Egg production %
  if (egg_count != null && bird_count > 0)
    out.egg_production_pct = (egg_count / bird_count) * 100;

  // egg_mass_g
  if (egg_count != null && avg_body_weight_g != null && bird_count > 0)
    out.egg_mass_g = (egg_count * avg_body_weight_g) / bird_count;

  return out;
}

// ── FARMS ────────────────────────────────────────────────────────────────────
function getFarms(status) {
  const db = getFarmPulseDb();
  let sql = `
    SELECT f.*,
      (SELECT COUNT(*) FROM flocks fl WHERE fl.farm_id = f.id AND fl.status = 'active') as flock_count,
      (SELECT COUNT(*) FROM houses h WHERE h.farm_id = f.id) as house_count
    FROM farms f`;
  const params = [];
  if (status) { sql += ` WHERE f.status = ?`; params.push(status); }
  sql += ` ORDER BY f.name`;
  return db.prepare(sql).all(...params);
}

function getFarm(id) {
  const db = getFarmPulseDb();
  const farm = db.prepare(`SELECT * FROM farms WHERE id = ?`).get(id);
  if (!farm) return null;
  farm.flocks  = db.prepare(`SELECT * FROM flocks WHERE farm_id = ? ORDER BY placement_date DESC`).all(id);
  farm.houses  = db.prepare(`SELECT * FROM houses WHERE farm_id = ? ORDER BY house_name`).all(id);
  return farm;
}

function createFarm({ name, location, species, contact_name, contact_phone, capacity,
  production_focus, housing_system, supervisor_name }) {
  const db = getFarmPulseDb();
  const r  = db.prepare(`
    INSERT INTO farms (name, location, species, contact_name, contact_phone, capacity,
      production_focus, housing_system, supervisor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, location || null, species, contact_name || null, contact_phone || null,
    capacity || null, production_focus || null, housing_system || null, supervisor_name || null);
  return db.prepare(`SELECT * FROM farms WHERE id = ?`).get(r.lastInsertRowid);
}

function updateFarm(id, fields) {
  const db       = getFarmPulseDb();
  const allowed  = ['name','location','species','contact_name','contact_phone','capacity','status',
    'production_focus','housing_system','supervisor_name'];
  const updates  = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return getFarm(id);
  updates.push(['updated_at', now()]);
  const sql = `UPDATE farms SET ${updates.map(([k]) => `${k}=?`).join(',')} WHERE id=?`;
  db.prepare(sql).run(...updates.map(([,v]) => v), id);
  return db.prepare(`SELECT * FROM farms WHERE id = ?`).get(id);
}

// ── FLOCKS ───────────────────────────────────────────────────────────────────
function getFlocks({ farm_id, status } = {}) {
  const db     = getFarmPulseDb();
  const where  = [];
  const params = [];
  if (farm_id) { where.push(`fl.farm_id = ?`); params.push(farm_id); }
  if (status)  { where.push(`fl.status = ?`);  params.push(status); }
  const sql = `
    SELECT fl.*, f.name as farm_name,
      (SELECT COUNT(*) FROM houses h WHERE h.flock_id = fl.id) as house_count,
      (SELECT record_date FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as last_record_date,
      (SELECT avg_body_weight_g FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as kpi_avg_body_weight_g,
      (SELECT COALESCE(fcr_period, fcr) FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as kpi_fcr,
      (SELECT mortality_rate_pct FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as kpi_mortality_rate_pct,
      (SELECT epi FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as kpi_epi,
      (SELECT feed_intake_kg FROM daily_records dr WHERE dr.flock_id = fl.id ORDER BY record_date DESC LIMIT 1) as kpi_feed_intake_kg
    FROM flocks fl
    LEFT JOIN farms f ON f.id = fl.farm_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY fl.placement_date DESC`;
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    ...r,
    latest_kpis: r.last_record_date ? {
      avg_body_weight_g:  r.kpi_avg_body_weight_g,
      fcr:                r.kpi_fcr,
      avg_fcr:            r.kpi_fcr,
      mortality_rate_pct: r.kpi_mortality_rate_pct,
      avg_mortality_pct:  r.kpi_mortality_rate_pct,
      epi:                r.kpi_epi,
      avg_epi:            r.kpi_epi,
      feed_intake_kg:     r.kpi_feed_intake_kg,
    } : null
  }));
}

function getFlock(id) {
  const db    = getFarmPulseDb();
  const flock = db.prepare(`
    SELECT fl.*, f.name as farm_name FROM flocks fl
    LEFT JOIN farms f ON f.id = fl.farm_id WHERE fl.id = ?
  `).get(id);
  if (!flock) return null;
  flock.houses = db.prepare(`SELECT * FROM houses WHERE flock_id = ?`).all(id);
  if (!flock.houses.length) {
    flock.houses = db.prepare(`SELECT * FROM houses WHERE farm_id = ? ORDER BY house_name`).all(flock.farm_id);
  }
  const last = db.prepare(`
    SELECT avg_body_weight_g, COALESCE(fcr_period, fcr) as fcr, adg_g, mortality_rate_pct, epi,
           feed_intake_kg, record_date
    FROM daily_records WHERE flock_id = ?
    ORDER BY record_date DESC LIMIT 1
  `).get(id);
  if (last) flock.latest_kpis = last;
  return flock;
}

function createFlock({ farm_id, flock_code, breed, production_type,
  initial_count, placement_date, expected_end_date, notes, age_at_placement_weeks }) {
  const db = getFarmPulseDb();
  if (!farm_id) throw new Error('Select a farm before adding a flock.');
  const farm = db.prepare(`SELECT id FROM farms WHERE id = ?`).get(farm_id);
  if (!farm) throw new Error('That farm was not found. Open the farm again, then add the flock.');
  const r  = db.prepare(`
    INSERT INTO flocks (farm_id, flock_code, breed, production_type,
      initial_count, placement_date, expected_end_date, notes, age_at_placement_weeks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(farm_id, flock_code, breed || null, production_type,
    initial_count, placement_date, expected_end_date || null, notes || null,
    age_at_placement_weeks == null || age_at_placement_weeks === '' ? null : Number(age_at_placement_weeks));
  const newId = r.lastInsertRowid;
  try {
    const unused = db.prepare(`SELECT id FROM houses WHERE farm_id=? AND (flock_id IS NULL OR flock_id=0) ORDER BY id`).all(farm_id);
    if (unused.length) {
      db.prepare(`UPDATE houses SET flock_id=? WHERE id=?`).run(newId, unused[0].id);
    } else {
      const anyHouse = db.prepare(`SELECT id FROM houses WHERE farm_id=?`).get(farm_id);
      if (!anyHouse) {
        db.prepare(`INSERT INTO houses (farm_id, flock_id, house_name) VALUES (?, ?, 'House 1')`).run(farm_id, newId);
      }
    }
  } catch (e) {
    console.error('[FarmPulse] assign house to flock failed:', e?.message || e);
  }
  try { return getFlock(newId); } catch (_) {
    return db.prepare(`SELECT * FROM flocks WHERE id = ?`).get(newId);
  }
}

function updateFlock(id, fields) {
  const db      = getFarmPulseDb();
  const allowed = ['flock_code','breed','production_type','initial_count',
                   'placement_date','expected_end_date','actual_end_date','status','notes','age_at_placement_weeks'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return getFlock(id);
  updates.push(['updated_at', now()]);
  const sql = `UPDATE flocks SET ${updates.map(([k]) => `${k}=?`).join(',')} WHERE id=?`;
  db.prepare(sql).run(...updates.map(([,v]) => v), id);
  try { return getFlock(id); } catch (_) {
    return db.prepare(`SELECT * FROM flocks WHERE id = ?`).get(id);
  }
}

// ── HOUSES ───────────────────────────────────────────────────────────────────
function getHouses({ farm_id, flock_id } = {}) {
  const db     = getFarmPulseDb();
  const where  = [];
  const params = [];
  if (farm_id)  { where.push(`h.farm_id = ?`);  params.push(farm_id); }
  if (flock_id) { where.push(`h.flock_id = ?`); params.push(flock_id); }
  return db.prepare(`
    SELECT h.*, f.name as farm_name, fl.flock_code
    FROM houses h
    LEFT JOIN farms f ON f.id = h.farm_id
    LEFT JOIN flocks fl ON fl.id = h.flock_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY h.house_name
  `).all(...params);
}

function createHouse({ farm_id, flock_id, house_name, capacity, area_m2, ventilation_type }) {
  const db = getFarmPulseDb();
  const r  = db.prepare(`
    INSERT INTO houses (farm_id, flock_id, house_name, capacity, area_m2, ventilation_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(farm_id, flock_id || null, house_name,
    capacity || null, area_m2 || null, ventilation_type || null);
  return db.prepare(`SELECT * FROM houses WHERE id = ?`).get(r.lastInsertRowid);
}

function updateHouse(id, fields) {
  const db      = getFarmPulseDb();
  const allowed = ['house_name','capacity','area_m2','ventilation_type','flock_id','status'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return db.prepare(`SELECT * FROM houses WHERE id = ?`).get(id);
  const sql = `UPDATE houses SET ${updates.map(([k]) => `${k}=?`).join(',')} WHERE id=?`;
  db.prepare(sql).run(...updates.map(([,v]) => v), id);
  return db.prepare(`SELECT * FROM houses WHERE id = ?`).get(id);
}

// ── FEED BATCHES ─────────────────────────────────────────────────────────────
function getFeedBatches({ farm_id, status } = {}) {
  const db     = getFarmPulseDb();
  const where  = [];
  const params = [];
  if (farm_id) { where.push(`fb.farm_id = ?`); params.push(farm_id); }
  if (status)  { where.push(`fb.status = ?`);  params.push(status); }
  return db.prepare(`
    SELECT fb.*, f.name as farm_name,
      (SELECT COUNT(*) FROM daily_records dr WHERE dr.feed_batch_id = fb.id) as records_using_batch
    FROM feed_batches fb
    LEFT JOIN farms f ON f.id = fb.farm_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY fb.delivery_date DESC
  `).all(...params);
}

function createFeedBatch({ farm_id, batch_code, formula_id, formula_version,
  feed_phase, quantity_kg, manufacture_date, delivery_date, expiry_date,
  supplier, mill_batch_ref, pellet_quality, notes }) {
  const db = getFarmPulseDb();
  const r  = db.prepare(`
    INSERT INTO feed_batches (farm_id, batch_code, formula_id, formula_version,
      feed_phase, quantity_kg, manufacture_date, delivery_date, expiry_date,
      supplier, mill_batch_ref, pellet_quality, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(farm_id, batch_code, formula_id || null, formula_version || null,
    feed_phase || null, quantity_kg, manufacture_date || null, delivery_date,
    expiry_date || null, supplier || null, mill_batch_ref || null,
    pellet_quality || null, notes || null);
  return db.prepare(`SELECT * FROM feed_batches WHERE id = ?`).get(r.lastInsertRowid);
}

// ── DAILY RECORDS ─────────────────────────────────────────────────────────────
function getDailyRecords({ flock_id, house_id, from, to, limit = 90 } = {}) {
  const db     = getFarmPulseDb();
  const where  = [];
  const params = [];
  if (flock_id) { where.push(`dr.flock_id = ?`);        params.push(flock_id); }
  if (house_id) { where.push(`dr.house_id = ?`);        params.push(house_id); }
  if (from)     { where.push(`dr.record_date >= ?`);    params.push(from); }
  if (to)       { where.push(`dr.record_date <= ?`);    params.push(to); }
  params.push(limit);
  return db.prepare(`
    SELECT dr.*, COALESCE(dr.fcr_period, dr.fcr) as fcr, h.house_name, fl.flock_code, fb.batch_code as feed_batch_code
    FROM daily_records dr
    LEFT JOIN houses h ON h.id = dr.house_id
    LEFT JOIN flocks fl ON fl.id = dr.flock_id
    LEFT JOIN feed_batches fb ON fb.id = dr.feed_batch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY dr.record_date DESC
    LIMIT ?
  `).all(...params);
}

function createDailyRecord(data) {
  const db = getFarmPulseDb();
  const n = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);
  if (!data.flock_id) throw new Error('Select a flock before saving a daily record.');
  if (!data.house_id) {
    const house = db.prepare(`
      SELECT id FROM houses
      WHERE flock_id=? OR farm_id=(SELECT farm_id FROM flocks WHERE id=?)
      ORDER BY CASE WHEN flock_id=? THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(data.flock_id, data.flock_id, data.flock_id);
    if (!house) throw new Error('This farm has no house. Add a house, then save the record.');
    data.house_id = house.id;
  }
  const s = (v) => (v === undefined || v === null || v === '') ? null : String(v);

  const prev = db.prepare(`
    SELECT avg_body_weight_g, cumulative_mortality
    FROM daily_records WHERE flock_id = ? AND house_id = ?
    ORDER BY record_date DESC LIMIT 1
  `).get(data.flock_id, data.house_id);

  const kpis = computeKpis({
    bird_count:         data.bird_count,
    feed_intake_kg:     n(data.feed_intake_kg),
    avg_body_weight_g:  n(data.avg_body_weight_g),
    mortality_count:    data.mortality_count || 0,
    cull_count:         data.cull_count || 0,
    age_days:           n(data.age_days),
    prev_body_weight_g: prev?.avg_body_weight_g ?? null,
    egg_count:          n(data.egg_count),
    entry_frequency:    data.entry_frequency || 'daily',
  });

  let water_feed_ratio = null;
  if (data.water_intake_l && data.feed_intake_kg && data.feed_intake_kg > 0)
    water_feed_ratio = (data.water_intake_l * 1000) / (data.feed_intake_kg * 1000);

  const feed_per_bird_g = kpis.feed_intake_per_bird_g || null;
  const cum_mort = (prev?.cumulative_mortality || 0) + (data.mortality_count || 0) + (data.cull_count || 0);

  const r = db.prepare(`
    INSERT INTO daily_records (
      flock_id, house_id, feed_batch_id, record_date, bird_count, age_days,
      feed_intake_kg, feed_intake_per_bird_g, water_intake_l, water_feed_ratio,
      avg_body_weight_g, target_body_weight_g, uniformity_pct,
      egg_count, egg_production_pct, avg_egg_weight_g, egg_mass_g,
      mortality_count, cull_count, cumulative_mortality,
      temperature_c, humidity_pct, light_hours,
      fcr_period, adg_g, mortality_rate_pct, epi, notes,
      bcs, exercise_hours, ammonia_ppm, lameness_count, scc,
      diarrhoea_score, respiratory_score, floor_eggs, milk_fat_pct, milk_protein_pct,
      entry_frequency
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.flock_id, data.house_id, n(data.feed_batch_id),
    data.record_date, data.bird_count, n(data.age_days),
    n(data.feed_intake_kg), n(feed_per_bird_g), n(data.water_intake_l), n(water_feed_ratio),
    n(data.avg_body_weight_g), n(data.target_body_weight_g), n(data.uniformity_pct),
    n(data.egg_count), n(kpis.egg_production_pct),
    n(data.avg_egg_weight_g), n(kpis.egg_mass_g),
    data.mortality_count || 0, data.cull_count || 0, cum_mort,
    n(data.temperature_c), n(data.humidity_pct), n(data.light_hours),
    n(kpis.fcr_period), n(kpis.adg_g), n(kpis.mortality_rate_pct), n(kpis.epi),
    s(data.notes),
    n(data.bcs), n(data.exercise_hours), n(data.ammonia_ppm), n(data.lameness_count), n(data.scc),
    n(data.diarrhoea_score), n(data.respiratory_score), n(data.floor_eggs), n(data.milk_fat_pct), n(data.milk_protein_pct),
    data.entry_frequency || 'daily'
  );

  const saved = db.prepare(`
    SELECT dr.*, COALESCE(dr.fcr_period, dr.fcr) as fcr, h.house_name, fl.flock_code
    FROM daily_records dr
    LEFT JOIN houses h ON h.id = dr.house_id
    LEFT JOIN flocks fl ON fl.id = dr.flock_id
    WHERE dr.id = ?
  `).get(r.lastInsertRowid);

  try { runAlertEngine(db, saved, kpis, data); } catch(e) {
    console.error('[AlertEngine] OUTER ERROR', e.message, e.stack);
  }

  return saved;
}

function updateDailyRecord(id, data) {
  const db = getFarmPulseDb();
  const allowed = ['record_date','bird_count','feed_intake_kg','water_intake_l','avg_body_weight_g',
    'mortality_count','cull_count','temperature_c','humidity_pct','light_hours',
    'egg_count','avg_egg_weight_g','notes','bcs','exercise_hours','ammonia_ppm',
    'lameness_count','scc','diarrhoea_score','respiratory_score','floor_eggs',
    'milk_fat_pct','milk_protein_pct','entry_frequency'];
  const keys = Object.keys(data).filter(k => allowed.includes(k));
  if (!keys.length) return { id, updated: false };
  const fields = keys.map(k => k + '=?').join(',');
  const values = keys.map(k => data[k]);
  db.prepare('UPDATE daily_records SET ' + fields + ' WHERE id=?').run(...values, id);
  return { id, updated: true };
}

function deleteDailyRecord(id) {
  const db = getFarmPulseDb();
  db.prepare('DELETE FROM daily_records WHERE id = ?').run(id);
  return { id, deleted: true };
}

// ── Alert engine ──────────────────────────────────────────────────────────────
function runAlertEngine(db, record, kpis, data) {
  const date     = record.record_date;
  const flock_id = record.flock_id;
  const house_id = record.house_id;

  function fire(alert_type, severity, message, metric_value, threshold_value) {
    const exists = db.prepare(`
      SELECT id FROM alerts
      WHERE flock_id=? AND alert_type=? AND alert_date=? AND status != 'resolved'
    `).get(flock_id, alert_type, date);
    if (exists) return;
    db.prepare(`
      INSERT INTO alerts (flock_id, house_id, alert_date, alert_type, severity, message, metric_value, threshold_value)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(flock_id, house_id, date, alert_type, severity, message, metric_value, threshold_value);
    console.log(`[AlertEngine] ${severity.toUpperCase()} — ${alert_type}: ${message}`);
  }

  const flock = db.prepare('SELECT * FROM flocks WHERE id = ?').get(flock_id);
  const breed = flock ? flock.breed || null : null;
  let std = null;
  let warnPct = 5;
  let alertPct = 10;

  if (breed) {
    try {
      const path = require('path');
      const fss  = require('fs');
      const BASE = path.join(__dirname, '../../db/requirements');
      let breedData = null;
      try {
        const perfIdx = JSON.parse(fss.readFileSync(path.join(BASE, 'performance.index.v1.json'), 'utf8'));
        const findInIndex = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          for (const k of Object.keys(obj)) {
            if (k === '_meta') continue;
            if (k === breed && typeof obj[k] === 'string') return obj[k];
            const found = findInIndex(obj[k]);
            if (found) return found;
          }
          return null;
        };
        const relPath = findInIndex(perfIdx);
        if (relPath) {
          const fullPath = path.join(BASE, relPath);
          if (fss.existsSync(fullPath)) breedData = JSON.parse(fss.readFileSync(fullPath, 'utf8'));
        }
        if (!breedData) {
          const libs = [
            path.join(BASE, 'performance.library.all_breeds.v2025.json'),
            path.join(BASE, 'performance.library.dairy.v2025.json'),
            path.join(BASE, 'performance.library.beef.v2025.json'),
            path.join(BASE, 'sheep', 'performance.library.sheep.v2025.json'),
            path.join(BASE, 'goat',  'performance.library.goat.v2025.json'),
          ];
          for (const libPath of libs) {
            try {
              const lib = JSON.parse(fss.readFileSync(libPath, 'utf8'));
              for (const section of Object.values(lib)) {
                if (typeof section !== 'object' || !section) continue;
                if (section[breed] && (section[breed].curve || section[breed].lactation_curve)) { breedData = section[breed]; break; }
                for (const sub of Object.values(section)) {
                  if (typeof sub !== 'object' || !sub) continue;
                  if (sub[breed] && (sub[breed].curve || sub[breed].lactation_curve)) { breedData = sub[breed]; break; }
                }
                if (breedData) break;
              }
              if (breedData) break;
            } catch(e) {}
          }
        }
      } catch(e) { console.error('[AlertEngine] index load error', e.message); }

      if (breedData) {
        const curve = breedData.curve || breedData.lactation_curve || [];
        warnPct  = breedData.warn_threshold_pct  || 5;
        alertPct = breedData.alert_threshold_pct || 10;
        const ageDays = record.age_days || 0;
        const getAge = (pt) => pt.week != null ? pt.week : (pt.day != null ? pt.day : (pt.age != null ? pt.age : 0));
        const useWeeks = curve.length && curve[0].week != null;
        const age = useWeeks ? ageDays / 7 : ageDays;
        let best = curve[0];
        for (const pt of curve) {
          if (Math.abs(getAge(pt) - age) < Math.abs(getAge(best) - age)) best = pt;
        }
        std = best || null;
      }
    } catch(e) { console.error('[AlertEngine] breed load error', e.message, e.stack); }
  }

  const bwG    = record.avg_body_weight_g;
  const stdBwG = std ? (std.body_wt_g != null ? std.body_wt_g : (std.body_wt_kg != null ? std.body_wt_kg * 1000 : null)) : null;
  if (bwG != null && stdBwG != null && stdBwG > 0) {
    const dev = ((bwG - stdBwG) / stdBwG) * 100;
    if (dev < -alertPct)
      fire('std_deviation', 'critical', `Body weight ${bwG}g is ${Math.abs(dev).toFixed(1)}% below breed standard (${stdBwG}g)`, bwG, stdBwG);
    else if (dev < -warnPct)
      fire('std_deviation', 'high', `Body weight ${bwG}g is ${Math.abs(dev).toFixed(1)}% below breed standard (${stdBwG}g)`, bwG, stdBwG);
  }

  const fcr    = kpis.fcr_period;
  const stdFcr = std ? (std.fcr != null ? std.fcr : null) : null;
  if (fcr != null && stdFcr != null && stdFcr > 0) {
    const dev = ((fcr - stdFcr) / stdFcr) * 100;
    if (dev > alertPct)
      fire('fcr_drift', 'critical', `FCR ${fcr.toFixed(2)} is ${dev.toFixed(1)}% above breed standard (${stdFcr})`, fcr, stdFcr);
    else if (dev > warnPct)
      fire('fcr_drift', 'high', `FCR ${fcr.toFixed(2)} is ${dev.toFixed(1)}% above breed standard (${stdFcr})`, fcr, stdFcr);
  } else if (fcr != null && fcr > 2.5) {
    fire('fcr_drift', 'high', `FCR ${fcr.toFixed(2)} exceeds general target ceiling (2.5)`, fcr, 2.5);
  }

  const mort       = kpis.mortality_rate_pct;
  const stdMortMax = std ? (std.mortality_pct_max != null ? std.mortality_pct_max : null) : null;
  if (mort != null && stdMortMax != null) {
    if (mort >= stdMortMax * 2)
      fire('mortality_spike', 'critical', `Mortality ${mort.toFixed(2)}% is ${(mort/stdMortMax).toFixed(1)}x breed maximum (${stdMortMax}%)`, mort, stdMortMax);
    else if (mort >= stdMortMax)
      fire('mortality_spike', 'high', `Mortality ${mort.toFixed(2)}% exceeds breed standard maximum (${stdMortMax}%)`, mort, stdMortMax);
  } else if (mort != null) {
    if (mort >= 1.0) fire('mortality_spike', 'critical', `Mortality ${mort.toFixed(2)}% exceeds critical threshold (1%)`, mort, 1.0);
    else if (mort >= 0.5) fire('mortality_spike', 'high', `Mortality ${mort.toFixed(2)}% exceeds warning threshold (0.5%)`, mort, 0.5);
  }

  const fpb = kpis.feed_intake_per_bird_g;
  if (fpb != null && fpb < 20)
    fire('feed_drop', 'medium', `Feed intake ${fpb.toFixed(1)}g/bird is very low`, fpb, 20);

  const wfr = record.water_feed_ratio;
  if (wfr != null && wfr > 4.0)
    fire('water_spike', 'medium', `Water:feed ratio ${wfr.toFixed(1)} is abnormally high`, wfr, 4.0);

  const temp = data.temperature_c;
  if (temp != null && temp > 30)
    fire('heat_stress', 'high', `House temperature ${temp}°C — heat stress risk elevated`, temp, 30);

  const eggProd = record.egg_production_pct;
  const stdEgg  = std ? (std.egg_prod_pct != null ? std.egg_prod_pct : null) : null;
  if (eggProd != null && stdEgg != null && stdEgg > 0) {
    const dev = ((eggProd - stdEgg) / stdEgg) * 100;
    if (dev < -alertPct)
      fire('production_drop', 'critical', `Egg production ${eggProd.toFixed(1)}% is ${Math.abs(dev).toFixed(1)}% below standard (${stdEgg}%)`, eggProd, stdEgg);
    else if (dev < -warnPct)
      fire('production_drop', 'high', `Egg production ${eggProd.toFixed(1)}% is ${Math.abs(dev).toFixed(1)}% below standard (${stdEgg}%)`, eggProd, stdEgg);
  }

  const epi    = kpis.epi;
  const stdEpi = std ? (std.epi_min != null ? std.epi_min : null) : null;
  if (epi != null && stdEpi != null && epi < stdEpi * (1 - alertPct/100))
    fire('std_deviation', 'high', `EPI ${epi.toFixed(0)} is below breed minimum (${stdEpi})`, epi, stdEpi);
}

// ── FLOCK TREND ───────────────────────────────────────────────────────────────
function getFlockTrend(flock_id, from, to) {
  const db     = getFarmPulseDb();
  const where  = [`dr.flock_id = ?`];
  const params = [flock_id];
  if (from) { where.push(`dr.record_date >= ?`); params.push(from); }
  if (to)   { where.push(`dr.record_date <= ?`); params.push(to); }

  const flock = db.prepare(`SELECT * FROM flocks WHERE id = ?`).get(flock_id);
  const trend = db.prepare(`
    SELECT dr.record_date, dr.house_id, dr.age_days, dr.bird_count, h.house_name,
           dr.avg_body_weight_g, COALESCE(dr.fcr_period, dr.fcr) as fcr_period, dr.adg_g, dr.mortality_rate_pct,
           dr.epi, dr.feed_intake_kg, dr.feed_intake_per_bird_g,
           dr.water_feed_ratio, dr.egg_production_pct, dr.avg_egg_weight_g,
           dr.std_body_wt_g, dr.std_fcr, dr.dev_body_wt_pct, dr.dev_fcr_pct,
           dr.temperature_c, dr.humidity_pct, dr.light_hours, dr.egg_count, dr.perf_status,
           dr.bcs, dr.exercise_hours, dr.ammonia_ppm, dr.lameness_count, dr.scc,
           dr.diarrhoea_score, dr.respiratory_score, dr.floor_eggs, dr.milk_fat_pct, dr.milk_protein_pct,
           dr.entry_frequency,
           fb.batch_code as feed_batch_code, fb.formula_version
    FROM daily_records dr
    LEFT JOIN houses h ON h.id = dr.house_id
    LEFT JOIN feed_batches fb ON fb.id = dr.feed_batch_id
    WHERE ${where.join(' AND ')}
    ORDER BY dr.record_date ASC
  `).all(...params);

  // Compute cumulative FCR — uses entry_frequency to determine period days
  const CHICK_WEIGHT_G = 42;
  let cumFeedKg = 0;
  let prevAgeDays = 0;
  for (const row of trend) {
    const ageDays = row.age_days || 0;
    const freq = row.entry_frequency || 'daily';
    const periodDays = freq === 'weekly' ? 7 : freq === 'monthly' ? 30 : Math.max(1, ageDays - prevAgeDays);
    if (row.feed_intake_kg) cumFeedKg += row.feed_intake_kg * periodDays;
    if (row.avg_body_weight_g && row.bird_count && cumFeedKg > 0) {
      const cumGainKg = ((row.avg_body_weight_g - CHICK_WEIGHT_G) / 1000) * row.bird_count;
      row.fcr_cumulative = cumGainKg > 0 ? cumFeedKg / cumGainKg : null;
    } else {
      row.fcr_cumulative = null;
    }
    // Use cumulative FCR for charting
    row.fcr = row.fcr_cumulative;
    // Also expose period FCR for reference
    row.fcr_daily = row.fcr_period;
    prevAgeDays = ageDays;
  }

  return { flock, trend };
}

// ── ALERTS ────────────────────────────────────────────────────────────────────
function getAlerts({ flock_id, farm_id, status, severity } = {}) {
  const db     = getFarmPulseDb();
  const where  = [];
  const params = [];
  if (flock_id) { where.push(`a.flock_id = ?`);  params.push(flock_id); }
  if (status)   { where.push(`a.status = ?`);     params.push(status); }
  if (severity) { where.push(`a.severity = ?`);   params.push(severity); }
  if (farm_id)  { where.push(`fl.farm_id = ?`);   params.push(farm_id); }
  return db.prepare(`
    SELECT a.*, h.house_name, fl.flock_code, f.name as farm_name
    FROM alerts a
    LEFT JOIN houses h ON h.id = a.house_id
    LEFT JOIN flocks fl ON fl.id = a.flock_id
    LEFT JOIN farms f ON f.id = fl.farm_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.created_at DESC
    LIMIT 200
  `).all(...params);
}

function resolveAlert(id, { status, resolved_by }) {
  const db = getFarmPulseDb();
  db.prepare(`UPDATE alerts SET status=?, resolved_at=?, resolved_by=? WHERE id=?`).run(status, now(), resolved_by || null, id);
  return db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id);
}

function createAlert({ flock_id, house_id, alert_date, alert_type,
  severity, message, metric_value, threshold_value }) {
  const db = getFarmPulseDb();
  const r  = db.prepare(`
    INSERT INTO alerts (flock_id, house_id, alert_date, alert_type,
      severity, message, metric_value, threshold_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(flock_id, house_id || null, alert_date, alert_type,
    severity, message, metric_value || null, threshold_value || null);
  return db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(r.lastInsertRowid);
}

// ── ENVIRONMENTAL LOGS ────────────────────────────────────────────────────────
function createEnvironmentalLog(data) {
  const db = getFarmPulseDb();
  let thi = null;
  if (data.temperature_c != null && data.humidity_pct != null) {
    thi = data.temperature_c - (0.55 - 0.0055 * data.humidity_pct) * (data.temperature_c - 14.5);
  }
  const r = db.prepare(`
    INSERT INTO environmental_logs (house_id, flock_id, logged_at,
      temperature_c, humidity_pct, thi, ammonia_ppm, co2_ppm,
      wind_speed_ms, water_ph, water_tds, light_lux, light_hours,
      stocking_density_m2, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.house_id, data.flock_id || null, data.logged_at || now(),
    data.temperature_c || null, data.humidity_pct || null, thi,
    data.ammonia_ppm || null, data.co2_ppm || null, data.wind_speed_ms || null,
    data.water_ph || null, data.water_tds || null, data.light_lux || null,
    data.light_hours || null, data.stocking_density_m2 || null, data.notes || null
  );
  return db.prepare(`SELECT * FROM environmental_logs WHERE id = ?`).get(r.lastInsertRowid);
}

// ── BODY WEIGHT SAMPLES ───────────────────────────────────────────────────────
function createBodyWeightSample(data) {
  const db = getFarmPulseDb();
  const r  = db.prepare(`
    INSERT INTO body_weight_samples (flock_id, house_id, sample_date, age_days,
      birds_weighed, avg_weight_g, min_weight_g, max_weight_g, cv_pct,
      uniformity_pct, std_weight_g, dev_pct, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    data.flock_id, data.house_id, data.sample_date, data.age_days || null,
    data.birds_weighed, data.avg_weight_g, data.min_weight_g || null,
    data.max_weight_g || null, data.cv_pct || null, data.uniformity_pct || null,
    data.std_weight_g || null, data.dev_pct || null, data.notes || null
  );
  return db.prepare(`SELECT * FROM body_weight_samples WHERE id = ?`).get(r.lastInsertRowid);
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function getSummary(farm_id) {
  const db     = getFarmPulseDb();
  const flocks = farm_id
    ? db.prepare(`SELECT COUNT(*) as c FROM flocks fl WHERE fl.farm_id = ? AND fl.status='active'`).get(farm_id)
    : db.prepare(`SELECT COUNT(*) as c FROM flocks fl WHERE fl.status='active'`).get();
  const alerts = db.prepare(`
    SELECT COUNT(*) as c, severity FROM alerts a
    LEFT JOIN flocks fl ON fl.id = a.flock_id
    WHERE a.status='open' ${farm_id ? `AND fl.farm_id=${farm_id}` : ''}
    GROUP BY severity
  `).all();
  const open     = alerts.reduce((s, a) => s + a.c, 0);
  const critical = alerts.filter(a => a.severity === 'critical').reduce((s, a) => s + a.c, 0);
  const recent   = getAlerts({ farm_id, status: 'open' }).slice(0, 5);
  return {
    active_flocks: flocks?.c || 0,
    open_alerts: open, critical_alerts: critical,
    farms_with_issues: critical > 0 ? 1 : 0,
    avg_fcr_today: null, avg_mortality_today: null,
    recent_alerts: recent
  };
}

// ── EGG GRADING (Feature 1) ───────────────────────────────────────────────────
function getEggGradings({ flock_id, farm_id, from, to } = {}) {
  const db = getFarmPulseDb();
  const where = []; const params = [];
  if (flock_id) { where.push('eg.flock_id = ?'); params.push(flock_id); }
  if (from) { where.push('eg.grading_date >= ?'); params.push(from); }
  if (to)   { where.push('eg.grading_date <= ?'); params.push(to); }
  if (farm_id) { where.push('fl.farm_id = ?'); params.push(farm_id); }
  return db.prepare(`
    SELECT eg.*, fl.flock_code, h.house_name FROM egg_grading_records eg
    LEFT JOIN flocks fl ON fl.id = eg.flock_id
    LEFT JOIN houses h ON h.id = eg.house_id
    ${where.length ? 'WHERE '+where.join(' AND ') : ''}
    ORDER BY eg.grading_date DESC LIMIT 200
  `).all(...params);
}
function createEggGrading({ flock_id, house_id, grading_date, grade_aa=0, grade_a=0, grade_b=0, grade_c=0, cracked=0, dirty=0, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO egg_grading_records (flock_id,house_id,grading_date,grade_aa,grade_a,grade_b,grade_c,cracked,dirty,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(flock_id, house_id||null, grading_date, grade_aa, grade_a, grade_b, grade_c, cracked, dirty, notes||null);
  return db.prepare(`SELECT * FROM egg_grading_records WHERE id=?`).get(r.lastInsertRowid);
}

function getEggInventory({ farm_id, flock_id } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)  { where.push('ei.farm_id=?');  params.push(farm_id); }
  if (flock_id) { where.push('ei.flock_id=?'); params.push(flock_id); }
  return db.prepare(`SELECT ei.* FROM egg_inventory ei ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY ei.txn_date DESC LIMIT 200`).all(...params);
}
function createEggInventoryTxn({ farm_id, flock_id, txn_date, txn_type, grade, quantity, unit_price, reference_id, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO egg_inventory (farm_id,flock_id,txn_date,txn_type,grade,quantity,unit_price,reference_id,notes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(farm_id, flock_id||null, txn_date, txn_type, grade||null, quantity, unit_price||null, reference_id||null, notes||null);
  return db.prepare(`SELECT * FROM egg_inventory WHERE id=?`).get(r.lastInsertRowid);
}

function getEggSales({ farm_id, flock_id, from, to } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)  { where.push('es.farm_id=?');   params.push(farm_id); }
  if (flock_id) { where.push('es.flock_id=?');  params.push(flock_id); }
  if (from) { where.push('es.sale_date>=?'); params.push(from); }
  if (to)   { where.push('es.sale_date<=?'); params.push(to); }
  return db.prepare(`SELECT es.* FROM egg_sales es ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY es.sale_date DESC LIMIT 200`).all(...params);
}
function createEggSale({ farm_id, flock_id, sale_date, customer_name, grade, quantity_trays, eggs_per_tray=30, unit_price, payment_status='pending', notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO egg_sales (farm_id,flock_id,sale_date,customer_name,grade,quantity_trays,eggs_per_tray,unit_price,payment_status,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(farm_id,flock_id||null,sale_date,customer_name||null,grade||null,quantity_trays,eggs_per_tray,unit_price,payment_status,notes||null);
  return db.prepare(`SELECT * FROM egg_sales WHERE id=?`).get(r.lastInsertRowid);
}

// ── HATCHERY (Feature 2) ──────────────────────────────────────────────────────
function getHatchRecords({ farm_id, flock_id } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)  { where.push('hr.farm_id=?');   params.push(farm_id); }
  if (flock_id) { where.push('hr.flock_id=?');  params.push(flock_id); }
  return db.prepare(`SELECT hr.* FROM hatch_records hr ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY hr.set_date DESC LIMIT 200`).all(...params);
}
function createHatchRecord({ farm_id, flock_id, setter_id, set_date, eggs_set, candling_date, infertile=0, early_dead=0, late_dead=0, hatch_date, chicks_hatched=0, culled_chicks=0, hatchability_pct, notes }) {
  const db = getFarmPulseDb();
  const denom = Number(eggs_set || 0) - Number(infertile || 0);
  const hp = denom > 0 ? Math.round((Number(chicks_hatched || 0) / denom) * 10000) / 100 : null;
  const r = db.prepare(`INSERT INTO hatch_records (farm_id,flock_id,setter_id,set_date,eggs_set,candling_date,infertile,early_dead,late_dead,hatch_date,chicks_hatched,culled_chicks,hatchability_pct,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(farm_id,flock_id||null,setter_id||null,set_date,eggs_set,candling_date||null,infertile,early_dead,late_dead,hatch_date||null,chicks_hatched,culled_chicks,hatchability_pct||hp,notes||null);
  return db.prepare(`SELECT * FROM hatch_records WHERE id=?`).get(r.lastInsertRowid);
}
function getChickSales({ farm_id } = {}) {
  const db = getFarmPulseDb();
  return db.prepare(`SELECT cs.* FROM chick_sales cs WHERE cs.farm_id=? ORDER BY cs.sale_date DESC LIMIT 200`).all(farm_id);
}
function createChickSale({ farm_id, hatch_record_id, sale_date, customer_name, breed, sex, quantity, unit_price, delivery_address, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO chick_sales (farm_id,hatch_record_id,sale_date,customer_name,breed,sex,quantity,unit_price,delivery_address,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(farm_id,hatch_record_id||null,sale_date,customer_name||null,breed||null,sex||null,quantity,unit_price,delivery_address||null,notes||null);
  return db.prepare(`SELECT * FROM chick_sales WHERE id=?`).get(r.lastInsertRowid);
}

// ── MEDICINE (Feature 3) ──────────────────────────────────────────────────────
function getMedicineInventory({ farm_id } = {}) {
  const db = getFarmPulseDb();
  return db.prepare(`SELECT * FROM medicine_inventory WHERE farm_id=? ORDER BY product_name`).all(farm_id);
}
function createMedicineItem({ farm_id, product_name, product_type, active_ingredient, batch_no, expiry_date, quantity_units, unit, unit_cost, withdrawal_days=0, supplier, storage_condition, reorder_level }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO medicine_inventory (farm_id,product_name,product_type,active_ingredient,batch_no,expiry_date,quantity_units,unit,unit_cost,withdrawal_days,supplier,storage_condition,reorder_level)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(farm_id,product_name,product_type||null,active_ingredient||null,batch_no||null,expiry_date||null,quantity_units||0,unit||'dose',unit_cost||null,withdrawal_days,supplier||null,storage_condition||null,reorder_level||null);
  return db.prepare(`SELECT * FROM medicine_inventory WHERE id=?`).get(r.lastInsertRowid);
}
function updateMedicineItem(id, fields) {
  const db = getFarmPulseDb();
  const allowed = ['product_name','product_type','quantity_units','unit_cost','expiry_date','status','reorder_level'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return db.prepare(`SELECT * FROM medicine_inventory WHERE id=?`).get(id);
  updates.push(['updated_at', now()]);
  db.prepare(`UPDATE medicine_inventory SET ${updates.map(([k])=>`${k}=?`).join(',')} WHERE id=?`).run(...updates.map(([,v])=>v), id);
  return db.prepare(`SELECT * FROM medicine_inventory WHERE id=?`).get(id);
}
function getMedicineTransactions({ medicine_id, flock_id } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (medicine_id) { where.push('mt.medicine_id=?'); params.push(medicine_id); }
  if (flock_id)    { where.push('mt.flock_id=?');    params.push(flock_id); }
  return db.prepare(`SELECT mt.*, mi.product_name FROM medicine_transactions mt
    LEFT JOIN medicine_inventory mi ON mi.id = mt.medicine_id
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY mt.txn_date DESC LIMIT 200`).all(...params);
}
function createMedicineTxn({ medicine_id, flock_id, txn_date, txn_type, quantity, unit_cost, reason, administered_by, notes }) {
  const db = getFarmPulseDb();
  const med = db.prepare(`SELECT * FROM medicine_inventory WHERE id=?`).get(medicine_id);
  if (!med) throw new Error('Medicine not found');
  const delta = txn_type === 'purchase' ? quantity : -quantity;
  db.prepare(`UPDATE medicine_inventory SET quantity_units=quantity_units+?, updated_at=? WHERE id=?`).run(delta, now(), medicine_id);
  let withdrawEnd = null;
  if (txn_type === 'usage' && med.withdrawal_days > 0) {
    const d = new Date(txn_date); d.setDate(d.getDate() + med.withdrawal_days);
    withdrawEnd = d.toISOString().split('T')[0];
  }
  const r = db.prepare(`INSERT INTO medicine_transactions (medicine_id,flock_id,txn_date,txn_type,quantity,unit_cost,reason,administered_by,withdrawal_end_date,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(medicine_id,flock_id||null,txn_date,txn_type,quantity,unit_cost||null,reason||null,administered_by||null,withdrawEnd,notes||null);
  const newQty = (med.quantity_units||0) + delta;
  if (newQty <= (med.reorder_level||0)) {
    try { db.prepare(`UPDATE medicine_inventory SET status='low' WHERE id=?`).run(medicine_id); } catch(e) {}
  }
  return db.prepare(`SELECT * FROM medicine_transactions WHERE id=?`).get(r.lastInsertRowid);
}

// ── BIRD PURCHASES + TRANSFERS (Feature 4) ────────────────────────────────────
function getBirdPurchases({ farm_id } = {}) {
  const db = getFarmPulseDb();
  return db.prepare(`SELECT bp.*, f.name as farm_name FROM bird_purchases bp
    LEFT JOIN farms f ON f.id = bp.farm_id
    WHERE bp.farm_id=? ORDER BY bp.purchase_date DESC LIMIT 200`).all(farm_id);
}
function createBirdPurchase({ farm_id, house_id, purchase_date, breed, production_type, sex, age_days=0, quantity, unit_price, supplier_name, supplier_cert, health_status, health_cert_no, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO bird_purchases (farm_id,house_id,purchase_date,breed,production_type,sex,age_days,quantity,unit_price,supplier_name,supplier_cert,health_status,health_cert_no,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(farm_id,house_id||null,purchase_date,breed||null,production_type||null,sex||null,age_days,quantity,unit_price||null,supplier_name||null,supplier_cert||null,health_status||null,health_cert_no||null,notes||null);
  return db.prepare(`SELECT * FROM bird_purchases WHERE id=?`).get(r.lastInsertRowid);
}
function getBirdTransfers({ farm_id } = {}) {
  const db = getFarmPulseDb();
  return db.prepare(`SELECT bt.*,
    ff.name as from_farm_name, tf.name as to_farm_name,
    ffl.flock_code as from_flock_code, tfl.flock_code as to_flock_code
    FROM bird_transfers bt
    LEFT JOIN farms ff ON ff.id = bt.from_farm_id
    LEFT JOIN farms tf ON tf.id = bt.to_farm_id
    LEFT JOIN flocks ffl ON ffl.id = bt.from_flock_id
    LEFT JOIN flocks tfl ON tfl.id = bt.to_flock_id
    WHERE bt.from_farm_id=? OR bt.to_farm_id=?
    ORDER BY bt.transfer_date DESC LIMIT 200`).all(farm_id, farm_id);
}
function createBirdTransfer({ transfer_date, from_farm_id, from_house_id, from_flock_id, to_farm_id, to_house_id, to_flock_id, quantity, avg_weight_g, reason, transfer_by, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO bird_transfers (transfer_date,from_farm_id,from_house_id,from_flock_id,to_farm_id,to_house_id,to_flock_id,quantity,avg_weight_g,reason,transfer_by,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(transfer_date,from_farm_id||null,from_house_id||null,from_flock_id||null,to_farm_id||null,to_house_id||null,to_flock_id||null,quantity,avg_weight_g||null,reason||null,transfer_by||null,notes||null);
  return db.prepare(`SELECT * FROM bird_transfers WHERE id=?`).get(r.lastInsertRowid);
}

// ── FARM EXPENSES (Feature 5) ─────────────────────────────────────────────────
function getFarmExpenses({ farm_id, flock_id, from, to, category } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)  { where.push('fe.farm_id=?');   params.push(farm_id); }
  if (flock_id) { where.push('fe.flock_id=?');  params.push(flock_id); }
  if (category) { where.push('fe.category=?');  params.push(category); }
  if (from) { where.push('fe.expense_date>=?'); params.push(from); }
  if (to)   { where.push('fe.expense_date<=?'); params.push(to); }
  const rows = db.prepare(`SELECT fe.* FROM farm_expenses fe ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY fe.expense_date DESC LIMIT 500`).all(...params);
  const totals = {};
  for (const r of rows) totals[r.category] = (totals[r.category]||0) + (r.amount||0);
  return { expenses: rows, totals, grand_total: rows.reduce((s,r)=>s+(r.amount||0),0) };
}
function createExpense({ farm_id, flock_id, expense_date, category, description, amount, reference_no, paid_to, payment_method, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO farm_expenses (farm_id,flock_id,expense_date,category,description,amount,reference_no,paid_to,payment_method,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(farm_id,flock_id||null,expense_date,category,description,amount,reference_no||null,paid_to||null,payment_method||null,notes||null);
  return db.prepare(`SELECT * FROM farm_expenses WHERE id=?`).get(r.lastInsertRowid);
}

// ── BREEDER SEX RECORDS (Feature 6) ──────────────────────────────────────────
function getBreederSexRecords({ flock_id, from, to } = {}) {
  const db = getFarmPulseDb(); const where = [`bsr.flock_id=?`]; const params = [flock_id];
  if (from) { where.push('bsr.record_date>=?'); params.push(from); }
  if (to)   { where.push('bsr.record_date<=?'); params.push(to); }
  return db.prepare(`SELECT bsr.*, h.house_name FROM breeder_sex_records bsr
    LEFT JOIN houses h ON h.id = bsr.house_id
    WHERE ${where.join(' AND ')} ORDER BY bsr.record_date DESC LIMIT 200`).all(...params);
}
function createBreederSexRecord({ flock_id, house_id, record_date, male_count, female_count, male_feed_kg, female_feed_kg, male_avg_weight_g, female_avg_weight_g, male_mortality=0, female_mortality=0, male_std_weight_g, female_std_weight_g, notes }) {
  const db = getFarmPulseDb();
  const male_fcr   = (male_feed_kg   && male_avg_weight_g   && male_count   > 0) ? (male_feed_kg   / ((male_avg_weight_g/1000)   * male_count))   : null;
  const female_fcr = (female_feed_kg && female_avg_weight_g && female_count > 0) ? (female_feed_kg / ((female_avg_weight_g/1000) * female_count)) : null;
  const r = db.prepare(`INSERT INTO breeder_sex_records (flock_id,house_id,record_date,male_count,female_count,male_feed_kg,female_feed_kg,male_avg_weight_g,female_avg_weight_g,male_mortality,female_mortality,male_fcr,female_fcr,male_std_weight_g,female_std_weight_g,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(flock_id,house_id||null,record_date,male_count,female_count,male_feed_kg||null,female_feed_kg||null,male_avg_weight_g||null,female_avg_weight_g||null,male_mortality,female_mortality,male_fcr,female_fcr,male_std_weight_g||null,female_std_weight_g||null,notes||null);
  return db.prepare(`SELECT * FROM breeder_sex_records WHERE id=?`).get(r.lastInsertRowid);
}

// ── COMPARATIVE REPORTS (Feature 7) ──────────────────────────────────────────
function getComparativeReport({ farm_ids } = {}) {
  const db = getFarmPulseDb();
  const all = db.prepare(`
    SELECT f.id as farm_id, f.name as farm_name,
      fl.id as flock_id, fl.flock_code, fl.production_type,
      AVG(COALESCE(dr.fcr_period, dr.fcr)) as avg_fcr, AVG(dr.adg_g) as avg_adg,
      AVG(dr.mortality_rate_pct) as avg_mortality_pct,
      AVG(dr.epi) as avg_epi,
      AVG(dr.egg_production_pct) as avg_egg_pct,
      COUNT(dr.id) as record_count
    FROM farms f
    JOIN flocks fl ON fl.farm_id = f.id AND fl.status='active'
    LEFT JOIN daily_records dr ON dr.flock_id = fl.id
    ${farm_ids && farm_ids.length ? `WHERE f.id IN (${farm_ids.map(()=>'?').join(',')})` : ''}
    GROUP BY f.id, fl.id
    ORDER BY avg_fcr ASC
  `).all(...(farm_ids||[]));
  return all;
}

// ── SLAUGHTER / PROCESSING (Feature 8) ───────────────────────────────────────
function getSlaughterRecords({ farm_id, flock_id } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)  { where.push('sr.farm_id=?');   params.push(farm_id); }
  if (flock_id) { where.push('sr.flock_id=?');  params.push(flock_id); }
  return db.prepare(`SELECT sr.*, fl.flock_code FROM slaughter_records sr
    LEFT JOIN flocks fl ON fl.id = sr.flock_id
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY sr.slaughter_date DESC LIMIT 200`).all(...params);
}
function createSlaughterRecord({ farm_id, flock_id, slaughter_date, birds_in, live_weight_kg, dead_on_arrival=0, birds_slaughtered, carcass_weight_kg, grade_a=0, grade_b=0, downgrade=0, condemnations=0, abattoir_name, slaughter_cost, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO slaughter_records (farm_id,flock_id,slaughter_date,birds_in,live_weight_kg,dead_on_arrival,birds_slaughtered,carcass_weight_kg,grade_a,grade_b,downgrade,condemnations,abattoir_name,slaughter_cost,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(farm_id,flock_id||null,slaughter_date,birds_in,live_weight_kg||null,dead_on_arrival,birds_slaughtered||null,carcass_weight_kg||null,grade_a,grade_b,downgrade,condemnations,abattoir_name||null,slaughter_cost||null,notes||null);
  return db.prepare(`SELECT * FROM slaughter_records WHERE id=?`).get(r.lastInsertRowid);
}
function getProcessingRecords({ farm_id, slaughter_record_id } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)             { where.push('pr.farm_id=?');             params.push(farm_id); }
  if (slaughter_record_id) { where.push('pr.slaughter_record_id=?'); params.push(slaughter_record_id); }
  return db.prepare(`SELECT pr.* FROM processing_records pr ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY pr.process_date DESC LIMIT 200`).all(...params);
}
function createProcessingRecord({ slaughter_record_id, farm_id, process_date, product_type, quantity_units, unit_weight_kg, unit_price, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO processing_records (slaughter_record_id,farm_id,process_date,product_type,quantity_units,unit_weight_kg,unit_price,notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(slaughter_record_id||null,farm_id,process_date,product_type||null,quantity_units,unit_weight_kg||null,unit_price||null,notes||null);
  return db.prepare(`SELECT * FROM processing_records WHERE id=?`).get(r.lastInsertRowid);
}

// ── TRADE CUSTOMERS + LIVE BIRD TRADING (Feature 10) ─────────────────────────
function getTradeCustomers() {
  const db = getFarmPulseDb();
  return db.prepare(`SELECT * FROM trade_customers WHERE status='active' ORDER BY customer_name`).all();
}
function createTradeCustomer({ customer_name, customer_type, contact_name, phone, email, address, credit_limit=0, notes }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO trade_customers (customer_name,customer_type,contact_name,phone,email,address,credit_limit,notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(customer_name,customer_type||null,contact_name||null,phone||null,email||null,address||null,credit_limit,notes||null);
  return db.prepare(`SELECT * FROM trade_customers WHERE id=?`).get(r.lastInsertRowid);
}
function getLiveBirdTrades({ farm_id, customer_id, from, to } = {}) {
  const db = getFarmPulseDb(); const where = []; const params = [];
  if (farm_id)     { where.push('lbt.farm_id=?');     params.push(farm_id); }
  if (customer_id) { where.push('lbt.customer_id=?'); params.push(customer_id); }
  if (from) { where.push('lbt.trade_date>=?'); params.push(from); }
  if (to)   { where.push('lbt.trade_date<=?'); params.push(to); }
  return db.prepare(`SELECT lbt.*, tc.customer_name, fl.flock_code FROM live_bird_trades lbt
    LEFT JOIN trade_customers tc ON tc.id = lbt.customer_id
    LEFT JOIN flocks fl ON fl.id = lbt.flock_id
    ${where.length?'WHERE '+where.join(' AND '):''}
    ORDER BY lbt.trade_date DESC LIMIT 200`).all(...params);
}
function createLiveBirdTrade({ farm_id, flock_id, customer_id, trade_date, trade_type, birds_qty, avg_live_weight_kg, price_per_kg, transport_cost=0, payment_status='pending', weighbridge_ref, notes }) {
  const db = getFarmPulseDb();
  const total_weight = (birds_qty && avg_live_weight_kg) ? birds_qty * avg_live_weight_kg : null;
  const total_amount = (total_weight && price_per_kg) ? total_weight * price_per_kg : null;
  const r = db.prepare(`INSERT INTO live_bird_trades (farm_id,flock_id,customer_id,trade_date,trade_type,birds_qty,avg_live_weight_kg,price_per_kg,total_weight_kg,total_amount,transport_cost,payment_status,weighbridge_ref,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(farm_id,flock_id||null,customer_id||null,trade_date,trade_type,birds_qty,avg_live_weight_kg||null,price_per_kg,total_weight,total_amount,transport_cost,payment_status,weighbridge_ref||null,notes||null);
  return db.prepare(`SELECT * FROM live_bird_trades WHERE id=?`).get(r.lastInsertRowid);
}

// ── NOTIFICATION LOG (Feature 9) ──────────────────────────────────────────────
function logNotification({ flock_id, alert_id, channel, recipient, message, status='sent', provider_sid, error_message }) {
  const db = getFarmPulseDb();
  const r = db.prepare(`INSERT INTO notification_log (flock_id,alert_id,channel,recipient,message,status,provider_sid,error_message)
    VALUES (?,?,?,?,?,?,?,?)`).run(flock_id||null,alert_id||null,channel,recipient,message,status,provider_sid||null,error_message||null);
  return db.prepare(`SELECT * FROM notification_log WHERE id=?`).get(r.lastInsertRowid);
}

module.exports = {
  getFarms, getFarm, createFarm, updateFarm,
  getFlocks, getFlock, createFlock, updateFlock,
  getHouses, createHouse, updateHouse,
  getFeedBatches, createFeedBatch,
  getDailyRecords, createDailyRecord, updateDailyRecord, deleteDailyRecord, getFlockTrend,
  getAlerts, resolveAlert, createAlert,
  createEnvironmentalLog, createBodyWeightSample,
  getSummary,
  // Feature 1 — Egg
  getEggGradings, createEggGrading,
  getEggInventory, createEggInventoryTxn,
  getEggSales, createEggSale,
  // Feature 2 — Hatchery
  getHatchRecords, createHatchRecord,
  getChickSales, createChickSale,
  // Feature 3 — Medicine
  getMedicineInventory, createMedicineItem, updateMedicineItem,
  getMedicineTransactions, createMedicineTxn,
  // Feature 4 — Bird movements
  getBirdPurchases, createBirdPurchase,
  getBirdTransfers, createBirdTransfer,
  // Feature 5 — Expenses
  getFarmExpenses, createExpense,
  // Feature 6 — Breeder sex records
  getBreederSexRecords, createBreederSexRecord,
  // Feature 7 — Comparative
  getComparativeReport,
  // Feature 8 — Slaughter/Processing
  getSlaughterRecords, createSlaughterRecord,
  getProcessingRecords, createProcessingRecord,
  // Feature 10 — CTS
  getTradeCustomers, createTradeCustomer,
  getLiveBirdTrades, createLiveBirdTrade,
  // Feature 9 — Notifications
  logNotification
};
