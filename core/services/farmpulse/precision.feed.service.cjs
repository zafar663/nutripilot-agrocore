'use strict';

const ENERGY_KEYS = new Set([
  'me_kcal_per_kg', 'me_mj_per_kg', 'ne_kcal_per_kg', 'ge_kcal_per_kg',
  'me', 'ame', 'tme', 'nel_mcal_kg', 'me_mcal_kg'
]);

const BROILER_PHASE_INTAKE = { starter: 40, grower: 100, finisher: 180 };
const LAYER_PHASE_INTAKE = {
  starter: 20, grower: 50, developer: 80, prelay: 100,
  lay_early: 110, lay_peak: 110, lay_mid: 112, lay_late: 115, lay: 110
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function inferPoultryPhase(type, ageDays) {
  const t = String(type || '').toLowerCase();
  const d = Number(ageDays);
  if (!Number.isFinite(d) || d < 0) return null;
  if (t === 'broiler' || t === 'broiler_meat' || t === 'meat') {
    if (d <= 10) return 'starter';
    if (d <= 24) return 'grower';
    return 'finisher';
  }
  if (t === 'layer' || t === 'layers' || t === 'layer_breeder') {
    if (d < 42) return 'starter';
    if (d < 84) return 'grower';
    if (d < 112) return 'developer';
    if (d < 126) return 'prelay';
    if (d < 210) return 'lay_early';
    if (d < 336) return 'lay_peak';
    if (d < 448) return 'lay_mid';
    return 'lay_late';
  }
  return null;
}

function mapProductionType(productionType) {
  const t = String(productionType || '').toLowerCase();
  if (/broiler|meat/.test(t) && !/breeder/.test(t)) return { species: 'poultry', type: 'broiler', production: 'meat' };
  if (/layer/.test(t)) return { species: 'poultry', type: 'layer', production: 'egg' };
  if (/breeder/.test(t)) return { species: 'poultry', type: 'broiler_breeder', production: 'breeder' };
  return { species: 'poultry', type: t || 'broiler', production: '' };
}

function referenceIntakeGpd(type, phase, profileGpd) {
  if (Number(profileGpd) > 0) return Number(profileGpd);
  const t = String(type || '').toLowerCase();
  if (t === 'layer' || t === 'layers' || t === 'layer_breeder') {
    return LAYER_PHASE_INTAKE[phase] || 110;
  }
  return BROILER_PHASE_INTAKE[phase] || 100;
}

function intakeFromRecord(record) {
  if (!record) return null;
  const birds = Number(record.bird_count);
  const kg = Number(record.feed_intake_kg);
  const days = Number(record.entry_frequency === 'weekly' ? 7 : record.entry_frequency === 'monthly' ? 30 : 1);
  if (Number.isFinite(kg) && kg > 0 && Number.isFinite(birds) && birds > 0) {
    return Math.round((kg * 1000) / birds / (days || 1));
  }
  if (Number.isFinite(record.feed_intake_per_bird_g) && record.feed_intake_per_bird_g > 0) {
    return Math.round(Number(record.feed_intake_per_bird_g));
  }
  return null;
}

function standardFromPoint(pt) {
  if (!pt) return { intake_gpd: null, body_wt_g: null, fcr: null };
  const intake = pt.feed_per_bird_g ?? pt.daily_feed_g ?? pt.feed_intake_g
    ?? (pt.feed_intake_kg != null && Number(pt.feed_intake_kg) < 0.8 ? Number(pt.feed_intake_kg) * 1000 : null);
  const bw = pt.body_wt_g ?? (pt.body_wt_kg != null ? Number(pt.body_wt_kg) * 1000 : null);
  return {
    intake_gpd: intake != null ? Number(intake) : null,
    body_wt_g: bw != null ? Number(bw) : null,
    fcr: pt.fcr != null ? Number(pt.fcr) : null
  };
}

function densityFactor({ actualGpd, refGpd, actualBwG, stdBwG }) {
  let factor = 1;
  const reasons = [];
  if (Number(actualGpd) > 0 && Number(refGpd) > 0 && actualGpd !== refGpd) {
    factor = refGpd / actualGpd;
    reasons.push(`intake ${actualGpd} g vs book ${refGpd} g`);
  }
  if (Number(actualBwG) > 0 && Number(stdBwG) > 0 && actualBwG < stdBwG * 0.92) {
    const lag = ((stdBwG - actualBwG) / stdBwG) * 100;
    factor *= 1.04;
    reasons.push(`body weight ${Math.round(actualBwG)} g is ${lag.toFixed(0)}% behind standard`);
  }
  const clamped = clamp(factor, 0.85, 1.18);
  if (clamped !== factor) reasons.push(`density clamped to ${clamped.toFixed(2)}×`);
  return { factor: clamped, reasons };
}

function applyPrecisionDensity(targets, opts = {}) {
  if (!targets || typeof targets !== 'object') return { targets, applied: false };
  const actualGpd = Number(opts.actualGpd);
  const refGpd = Number(opts.refGpd);
  const type = String(opts.type || '').toLowerCase();
  const { factor, reasons } = densityFactor({
    actualGpd, refGpd, actualBwG: opts.actualBwG, stdBwG: opts.stdBwG
  });
  if (!reasons.length || Math.abs(factor - 1) < 0.01) {
    return { targets, applied: false, factor: 1, reasons: [] };
  }

  const phase = String(opts.phase || '').toLowerCase();
  const laying = new Set(['lay_early', 'lay_peak', 'lay_mid', 'lay_late', 'lay']);
  const adjusted = {};
  for (const [k, v] of Object.entries(targets)) {
    if (typeof v !== 'number') { adjusted[k] = v; continue; }
    if (ENERGY_KEYS.has(k)) {
      if (type === 'layer' && laying.has(phase) && (k === 'me_kcal_per_kg' || k === 'me')) {
        if (actualGpd > 0 && actualGpd < 95) adjusted[k] = 2950;
        else if (actualGpd > 120) adjusted[k] = 2650;
        else {
          const sid = Number(targets.sid_lys_pct || 0);
          if (sid > 0) {
            const sidAdj = sid * refGpd / actualGpd;
            const ratio = sid * 10 / v;
            adjusted[k] = Math.round(clamp(sidAdj * 10 / ratio, 2650, 2950));
          } else adjusted[k] = v;
        }
      } else if (type === 'broiler' || type === 'meat') {
        adjusted[k] = Math.round(clamp(v * (0.97 + (factor - 1) * 0.35), v - 80, v + 80));
      } else {
        adjusted[k] = v;
      }
      continue;
    }
    adjusted[k] = Math.round(v * factor * 1000) / 1000;
  }
  return { targets: adjusted, applied: true, factor, reasons };
}

function proposeAdaptiveRation({
  flock, record, standardPoint, bookTargets, type, phase, ageDays
}) {
  const mapped = mapProductionType(type || flock?.production_type);
  const std = standardFromPoint(standardPoint);
  const actualGpd = intakeFromRecord(record);
  const actualBwG = record?.avg_body_weight_g != null ? Number(record.avg_body_weight_g) : null;
  const actualFcr = record?.fcr_period != null ? Number(record.fcr_period) : (record?.fcr != null ? Number(record.fcr) : null);
  const inferredPhase = phase || inferPoultryPhase(mapped.type, ageDays) || 'grower';
  const refGpd = std.intake_gpd || referenceIntakeGpd(mapped.type, inferredPhase, null);
  const density = applyPrecisionDensity(bookTargets || {}, {
    actualGpd, refGpd, type: mapped.type, phase: inferredPhase,
    actualBwG, stdBwG: std.body_wt_g
  });

  const notes = [...(density.reasons || [])];
  if (actualFcr != null && std.fcr != null && actualFcr > std.fcr * 1.08) {
    notes.push(`FCR ${actualFcr.toFixed(2)} vs book ${std.fcr.toFixed(2)} — review, not auto-rewritten`);
  }
  if (!actualGpd && !actualBwG) {
    notes.push('Need feed intake or body weight on the latest daily record');
  }

  return {
    ok: true,
    released: false,
    flock_id: flock?.id || null,
    flock_code: flock?.flock_code || null,
    farm_name: flock?.farm_name || null,
    breed: flock?.breed || null,
    age_days: ageDays,
    species: mapped.species,
    type: mapped.type,
    production: mapped.production,
    phase: inferredPhase,
    actual: {
      intake_gpd: actualGpd,
      body_wt_g: actualBwG,
      fcr: actualFcr,
      record_date: record?.record_date || null,
      bird_count: record?.bird_count || null
    },
    standard: std,
    density_factor: density.factor,
    applied: density.applied,
    book_targets: bookTargets || {},
    proposed_targets: density.targets,
    notes,
    message: density.applied
      ? `Proposed ${density.factor.toFixed(2)}× nutrient density. Nutritionist must review and release — this does not change the mill formula.`
      : (notes[0] || 'House is on book. No density change proposed.')
  };
}

module.exports = {
  ENERGY_KEYS,
  inferPoultryPhase,
  mapProductionType,
  referenceIntakeGpd,
  intakeFromRecord,
  standardFromPoint,
  densityFactor,
  applyPrecisionDensity,
  proposeAdaptiveRation
};
