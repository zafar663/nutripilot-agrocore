"use strict";
/**
 * Beef Cattle NASEM 2016 Requirements Engine
 * Sources:
 *   - NASEM 2016 Nutrient Requirements of Beef Cattle, 8th Revised Edition
 *   - Model updated April 2024
 *
 * Two modes:
 *   static  — lookup from pre-built NASEM 2016 requirement tables (default)
 *   dynamic — calculate from animal inputs using NASEM 2016 equations (premium)
 *
 * Usage:
 *   const { resolveBeefRequirements } = require('./beefNasem2016.engine.cjs');
 *   const reqs = resolveBeefRequirements({ mode: 'static', production: 'growing', phase: 'stocker' });
 *   const reqs = resolveBeefRequirements({ mode: 'dynamic', bw_kg: 400, adg_kg: 1.5, sex: 'steer' });
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(d));
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC TABLES — NASEM 2016
// ═══════════════════════════════════════════════════════════════════════════
const STATIC_REQUIREMENTS = {

  // ── GROWING CATTLE ───────────────────────────────────────────────────────
  stocker_light: {
    label: "Stocker — Light (200-300 kg, ADG 0.8-1.0 kg)",
    production: "growing",
    phase: "stocker_light",
    bw_range_kg: [200, 300],
    adg_kg: 0.9,
    energy: {
      nem_mcal_kg: 1.28,      // NEm concentration in diet
      neg_mcal_kg: 0.77,      // NEg concentration in diet
      tdn: 62,
      me_mcal_kg: 2.24,
    },
    protein: {
      cp: 13.0,
      mp_g_day: 650,
      rup_pct_cp: 30,
      rdp_pct_cp: 70,
    },
    fiber: {
      ndf_min: 25,
      adf_min: 17,
    },
    minerals: {
      ca: 0.57,
      p: 0.26,
      mg: 0.10,
      k: 0.65,
      na: 0.07,              // NASEM 2016 growing: 0.06-0.08% DM
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg (not 0.30 max tolerance)
      zn_ppm: 30,
    },
    vitamins: {
      vit_a: 2200,   // IU/kg DM
      vit_d: 275,
      vit_e: 15,
    },
  },

  stocker_heavy: {
    label: "Stocker — Heavy (300-400 kg, ADG 1.0-1.2 kg)",
    production: "growing",
    phase: "stocker_heavy",
    bw_range_kg: [300, 400],
    adg_kg: 1.1,
    energy: {
      nem_mcal_kg: 1.32,
      neg_mcal_kg: 0.82,
      tdn: 64,
      me_mcal_kg: 2.31,
    },
    protein: {
      cp: 12.5,
      mp_g_day: 750,
      rup_pct_cp: 32,
      rdp_pct_cp: 68,
    },
    fiber: {
      ndf_min: 25,
      adf_min: 17,
    },
    minerals: {
      ca: 0.52,
      p: 0.24,
      mg: 0.10,
      k: 0.65,
      na: 0.07,              // NASEM 2016 growing: 0.06-0.08% DM
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  // ── FEEDLOT ──────────────────────────────────────────────────────────────
  feedlot_receiving: {
    label: "Feedlot — Receiving/Receiving (300-350 kg)",
    production: "feedlot",
    phase: "receiving",
    energy: {
      nem_mcal_kg: 1.35,
      neg_mcal_kg: 0.85,
      tdn: 65,
      me_mcal_kg: 2.36,
    },
    protein: {
      cp: 14.0,
      mp_g_day: 800,
      rup_pct_cp: 35,
      rdp_pct_cp: 65,
    },
    fiber: { ndf_min: 22, adf_min: 15 },
    minerals: {
      ca: 0.60,
      p: 0.28,
      mg: 0.10,
      k: 0.65,
      na: 0.09,              // NASEM 2016 feedlot receiving: 0.08-0.10% DM
      cl: 0.20,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  feedlot_growing: {
    label: "Feedlot — Growing Phase (350-450 kg, ADG 1.3-1.5 kg)",
    production: "feedlot",
    phase: "growing",
    adg_kg: 1.4,
    energy: {
      nem_mcal_kg: 1.52,
      neg_mcal_kg: 0.99,
      tdn: 72,
      me_mcal_kg: 2.61,
    },
    protein: {
      cp: 13.0,
      mp_g_day: 950,
      rup_pct_cp: 38,
      rdp_pct_cp: 62,
    },
    fiber: { ndf_min: 15, adf_min: 10 },
    minerals: {
      ca: 0.55,
      p: 0.26,
      mg: 0.10,
      k: 0.65,
      na: 0.09,              // NASEM 2016 feedlot growing: 0.08-0.10% DM
      cl: 0.20,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  feedlot_finishing: {
    label: "Feedlot — Finishing Phase (450-600 kg, ADG 1.5-1.8 kg)",
    production: "feedlot",
    phase: "finishing",
    adg_kg: 1.6,
    energy: {
      nem_mcal_kg: 1.72,
      neg_mcal_kg: 1.15,
      tdn: 78,
      me_mcal_kg: 2.90,
    },
    protein: {
      cp: 12.0,
      mp_g_day: 1050,
      rup_pct_cp: 40,
      rdp_pct_cp: 60,
    },
    fiber: { ndf_min: 12, adf_min: 8 },
    minerals: {
      ca: 0.50,
      p: 0.24,
      mg: 0.10,
      k: 0.60,
      na: 0.09,              // NASEM 2016 feedlot finishing: 0.08-0.10% DM
      cl: 0.20,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  // ── BEEF COWS ─────────────────────────────────────────────────────────────
  cow_dry_mid: {
    label: "Beef Cow — Dry Mid-Gestation (months 4-7)",
    production: "cow",
    phase: "dry_mid",
    energy: {
      nem_mcal_kg: 1.00,
      neg_mcal_kg: null,
      tdn: 50,
      me_mcal_kg: 1.78,
    },
    protein: {
      cp: 8.0,
      mp_g_day: 450,
      rup_pct_cp: 25,
      rdp_pct_cp: 75,
    },
    fiber: { ndf_min: 40, adf_min: 26 },
    minerals: {
      ca: 0.27,
      p: 0.18,
      mg: 0.12,
      k: 0.65,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 40,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2800, vit_d: 275, vit_e: 15 },
  },

  cow_late_gestation: {
    label: "Beef Cow — Late Gestation (last 60-90 days)",
    production: "cow",
    phase: "late_gestation",
    energy: {
      nem_mcal_kg: 1.12,
      neg_mcal_kg: null,
      tdn: 55,
      me_mcal_kg: 1.96,
    },
    protein: {
      cp: 10.0,
      mp_g_day: 700,
      rup_pct_cp: 30,
      rdp_pct_cp: 70,
    },
    fiber: { ndf_min: 35, adf_min: 23 },
    minerals: {
      ca: 0.35,
      p: 0.22,
      mg: 0.20,
      k: 0.70,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 40,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2800, vit_d: 275, vit_e: 100 },
  },

  cow_early_lactation: {
    label: "Beef Cow — Early Lactation (first 3 months)",
    production: "cow",
    phase: "early_lactation",
    energy: {
      nem_mcal_kg: 1.25,
      neg_mcal_kg: null,
      tdn: 62,
      me_mcal_kg: 2.24,
    },
    protein: {
      cp: 12.0,
      mp_g_day: 1050,
      rup_pct_cp: 32,
      rdp_pct_cp: 68,
    },
    fiber: { ndf_min: 28, adf_min: 18 },
    minerals: {
      ca: 0.45,
      p: 0.28,
      mg: 0.20,
      k: 0.70,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 40,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2800, vit_d: 275, vit_e: 15 },
  },

  cow_mid_lactation: {
    label: "Beef Cow — Mid Lactation (months 3-6)",
    production: "cow",
    phase: "mid_lactation",
    energy: {
      nem_mcal_kg: 1.18,
      neg_mcal_kg: null,
      tdn: 58,
      me_mcal_kg: 2.10,
    },
    protein: {
      cp: 11.0,
      mp_g_day: 850,
      rup_pct_cp: 28,
      rdp_pct_cp: 72,
    },
    fiber: { ndf_min: 32, adf_min: 21 },
    minerals: {
      ca: 0.40,
      p: 0.26,
      mg: 0.18,
      k: 0.70,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 40,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2800, vit_d: 275, vit_e: 15 },
  },

  // ── BULLS ────────────────────────────────────────────────────────────────
  bull_maintenance: {
    label: "Bull — Maintenance",
    production: "bull",
    phase: "maintenance",
    energy: {
      nem_mcal_kg: 1.05,
      neg_mcal_kg: null,
      tdn: 52,
      me_mcal_kg: 1.87,
    },
    protein: {
      cp: 9.0,
      mp_g_day: 600,
      rup_pct_cp: 28,
      rdp_pct_cp: 72,
    },
    fiber: { ndf_min: 38, adf_min: 25 },
    minerals: {
      ca: 0.28,
      p: 0.18,
      mg: 0.10,
      k: 0.65,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  bull_breeding: {
    label: "Bull — Breeding Season",
    production: "bull",
    phase: "breeding",
    energy: {
      nem_mcal_kg: 1.15,
      neg_mcal_kg: null,
      tdn: 57,
      me_mcal_kg: 2.06,
    },
    protein: {
      cp: 10.5,
      mp_g_day: 800,
      rup_pct_cp: 32,
      rdp_pct_cp: 68,
    },
    fiber: { ndf_min: 32, adf_min: 21 },
    minerals: {
      ca: 0.35,
      p: 0.22,
      mg: 0.12,
      k: 0.65,
      na: 0.10,
      cl: 0.15,
      s: 0.15,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      cu_ppm: 10,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 20,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },

  // ── CALVES ───────────────────────────────────────────────────────────────
  calf_pre_weaning: {
    label: "Beef Calf — Pre-Weaning",
    production: "calf",
    phase: "pre_weaning",
    energy: {
      nem_mcal_kg: 1.45,
      neg_mcal_kg: 0.93,
      tdn: 68,
      me_mcal_kg: 2.47,
    },
    protein: {
      cp: 16.0,
      mp_g_day: 350,
      rup_pct_cp: 20,
      rdp_pct_cp: 80,
    },
    fiber: { ndf_min: 20, adf_min: 13 },
    minerals: {
      ca: 0.70,
      p: 0.45,
      mg: 0.10,
      k: 0.80,
      na: 0.10,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
      cu_ppm: 10,
      mn_ppm: 20,
      fe_ppm: 50,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      i_ppm: 0.50,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 25 },
  },

  calf_post_weaning: {
    label: "Beef Calf — Post-Weaning (200-300 kg)",
    production: "calf",
    phase: "post_weaning",
    energy: {
      nem_mcal_kg: 1.28,
      neg_mcal_kg: 0.77,
      tdn: 62,
      me_mcal_kg: 2.24,
    },
    protein: {
      cp: 13.5,
      mp_g_day: 550,
      rup_pct_cp: 28,
      rdp_pct_cp: 72,
    },
    fiber: { ndf_min: 25, adf_min: 17 },
    minerals: {
      ca: 0.60,
      p: 0.30,
      mg: 0.10,
      k: 0.65,
      na: 0.10,
      se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
      zn_ppm: 30,
      cu_ppm: 10,
      mn_ppm: 20,
      fe_ppm: 50,
      co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
      i_ppm: 0.50,
    },
    vitamins: { vit_a: 2200, vit_d: 275, vit_e: 15 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC ENGINE — NASEM 2016 EQUATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate NEm requirement (Mcal/day)
 * NASEM 2016: NEm = 0.077 × SBW^0.75 × activity_factor
 */
function calcNem(bw_kg, sex = 'steer', activity = 1.0) {
  const sbw = bw_kg * 0.96;
  const metabolic_bw = Math.pow(sbw, 0.75);
  // Sex adjustments (NASEM 2016)
  const sex_coeff = { steer: 0.077, heifer: 0.077, bull: 0.086, cow: 0.077 };
  const coeff = sex_coeff[sex.toLowerCase()] || 0.077;
  return round(coeff * metabolic_bw * activity, 3);
}

/**
 * Calculate NEg requirement (Mcal/day)
 * NASEM 2016: NEg = 0.0557 × SBW^0.75 × ADG^1.097 / EBG_ratio
 */
function calcNeg(bw_kg, adg_kg, sex = 'steer') {
  const sbw = bw_kg * 0.96;
  const metabolic_bw = Math.pow(sbw, 0.75);
  // Empty body gain / ADG ratio by sex
  const ebg_ratio = { steer: 0.956, heifer: 0.941, bull: 0.970, cow: 0.941 };
  const ratio = ebg_ratio[sex.toLowerCase()] || 0.956;
  const ebg = adg_kg * ratio;
  // NASEM 2016 NEg equation
  const neg = 0.0557 * metabolic_bw * Math.pow(ebg, 1.097);
  return round(neg, 3);
}

/**
 * Calculate DMI (kg/day)
 * NASEM 2016 equation for growing cattle
 */
function calcDMI(bw_kg, adg_kg, nem_diet) {
  // NASEM 2016 DMI prediction
  const dmi = (bw_kg * 0.1 * Math.pow(nem_diet / 1.348, -1)) *
    (1 - Math.exp(-0.011 * bw_kg * 0.96));
  return round(Math.max(4, Math.min(20, dmi)), 2);
}

/**
 * Calculate MP requirement (g/day)
 * NASEM 2016: MP = MP_maintenance + MP_gain + MP_pregnancy
 */
function calcMP(bw_kg, adg_kg, sex = 'steer', days_pregnant = 0) {
  const sbw = bw_kg * 0.96;
  // MP maintenance
  const mp_m = 3.8 * Math.pow(sbw, 0.75);
  // MP for gain
  const ebg_ratio = { steer: 0.956, heifer: 0.941, bull: 0.970 };
  const ratio = ebg_ratio[sex.toLowerCase()] || 0.956;
  const ebg = adg_kg * ratio;
  // Retained protein in gain (NASEM 2016)
  const rp = (268 - 29.4 * (0.0557 * Math.pow(sbw, 0.75) * Math.pow(ebg, 0.097))) * ebg;
  const mp_g = rp / 0.49; // efficiency of MP use for gain
  // MP for pregnancy (last trimester only)
  const mp_p = days_pregnant > 190 ? (0.00274 * days_pregnant - 0.0969) * 490 : 0;
  return round(mp_m + mp_g + mp_p, 0);
}

/**
 * Calculate Ca requirement (% DM)
 */
function calcCa(bw_kg, adg_kg, dmi_kg) {
  const ca_maint = 0.0154 * bw_kg;   // g/day endogenous
  const ca_gain = adg_kg * 7.1;       // g/kg gain
  const ca_total = (ca_maint + ca_gain) / 0.50; // absorption 50%
  return round(ca_total / (dmi_kg * 1000) * 100, 3);
}

/**
 * Calculate P requirement (% DM)
 */
function calcP(bw_kg, adg_kg, dmi_kg) {
  const p_maint = 0.0180 * bw_kg;
  const p_gain = adg_kg * 4.0;
  const p_total = (p_maint + p_gain) / 0.68;
  return round(p_total / (dmi_kg * 1000) * 100, 3);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_MAP = {
  // Growing/stocker
  stocker: 'stocker_light',
  stocker_light: 'stocker_light',
  stocker_heavy: 'stocker_heavy',
  growing: 'stocker_light',
  backgrounding: 'stocker_heavy',
  // Feedlot
  receiving: 'feedlot_receiving',
  feedlot: 'feedlot_growing',
  feedlot_growing: 'feedlot_growing',
  finishing: 'feedlot_finishing',
  feedlot_finishing: 'feedlot_finishing',
  // Cow
  dry_mid: 'cow_dry_mid',
  dry: 'cow_dry_mid',
  maintenance: 'cow_dry_mid',
  late_gestation: 'cow_late_gestation',
  pre_calving: 'cow_late_gestation',
  close_up: 'cow_late_gestation',
  early_lactation: 'cow_early_lactation',
  lactating: 'cow_early_lactation',
  mid_lactation: 'cow_mid_lactation',
  // Bull
  bull_maintenance: 'bull_maintenance',
  bull_breeding: 'bull_breeding',
  breeding: 'bull_breeding',
  // Calf
  calf: 'calf_pre_weaning',
  pre_weaning: 'calf_pre_weaning',
  post_weaning: 'calf_post_weaning',
};

function resolvePhaseKey(production, phase) {
  const combined = `${production}_${phase}`.toLowerCase().replace(/\s+/g, '_');
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[phase]) return PHASE_MAP[phase];
  if (PHASE_MAP[production]) return PHASE_MAP[production];
  return 'stocker_light';
}

// ═══════════════════════════════════════════════════════════════════════════
// BREED ADJUSTMENTS
// Bos indicus breeds: ~15% lower maintenance energy (NASEM 2016 recognized)
// Large-frame Bos taurus: standard
// ═══════════════════════════════════════════════════════════════════════════
const BOS_INDICUS_BREEDS = new Set([
  'brahman','nelore','nellore','gir','gyr','kankrej','ongole','sahiwal',
  'red_sindhi','tharparkar','brahman_cross','brangus','simbrah','senepol',
  'zebu','zebu_cross'
]);
const HIGH_ENERGY_BREEDS = new Set(['wagyu','wagyu_fullblood','wagyu_f1','japanese_black']); // higher energy/fat
const LEAN_MUSCULAR_BREEDS = new Set(['limousin','belgian_blue','piedmontese']); // lower fat, higher protein

function getBreedProfile(breed) {
  const b = String(breed || 'generic').toLowerCase().replace(/[\s-]/g, '_');
  if (BOS_INDICUS_BREEDS.has(b)) return { maintenance_factor: 0.85, label_prefix: breed };
  if (HIGH_ENERGY_BREEDS.has(b)) return { maintenance_factor: 1.0, energy_boost: 0.05, label_prefix: breed };
  if (LEAN_MUSCULAR_BREEDS.has(b)) return { maintenance_factor: 1.0, cp_boost: 0.5, label_prefix: breed };
  return { maintenance_factor: 1.0, label_prefix: breed && breed !== 'generic' ? breed : null };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC MODE
// ═══════════════════════════════════════════════════════════════════════════
function resolveStatic(context) {
  const phaseKey = resolvePhaseKey(
    String(context.production || 'growing').toLowerCase(),
    String(context.phase || 'stocker').toLowerCase()
  );
  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };

  const bp = getBreedProfile(context.breed);
  const mf = bp.maintenance_factor;
  const breedLabel = bp.label_prefix
    ? `${bp.label_prefix.charAt(0).toUpperCase() + bp.label_prefix.slice(1).replace(/_/g,' ')} — ${table.label}`
    : table.label;

  return {
    ok: true,
    mode: 'static',
    standard: 'NASEM_2016',
    phase_key: phaseKey,
    breed_used: context.breed || 'generic',
    breed_type: BOS_INDICUS_BREEDS.has(String(context.breed||'').toLowerCase().replace(/[\s-]/g,'_')) ? 'bos_indicus' : 'bos_taurus',
    label: breedLabel,
    nem_mcal_kg: table.energy?.nem_mcal_kg != null ? round(table.energy.nem_mcal_kg * mf * (1 + (bp.energy_boost||0)), 3) : null,
    neg_mcal_kg: table.energy?.neg_mcal_kg != null ? round(table.energy.neg_mcal_kg * mf, 3) : null,
    tdn: table.energy?.tdn != null ? round(table.energy.tdn * mf, 1) : null,
    me_mcal_kg: table.energy?.me_mcal_kg != null ? round(table.energy.me_mcal_kg * mf * (1 + (bp.energy_boost||0)), 3) : null,
    cp: table.protein?.cp != null ? round(table.protein.cp + (bp.cp_boost||0), 2) : null,
    mp_g_day: table.protein?.mp_g_day != null ? round(table.protein.mp_g_day * mf, 0) : null,
    rup: table.protein?.rup_pct_cp ?? null,
    rdp: table.protein?.rdp_pct_cp ?? null,
    ndf: table.fiber?.ndf_min ?? null,
    adf: table.fiber?.adf_min ?? null,
    ca: table.minerals?.ca ?? null,
    total_p: table.minerals?.p ?? null,
    mg: table.minerals?.mg ?? null,
    k: table.minerals?.k ?? null,
    na: table.minerals?.na ?? null,
    cl: table.minerals?.cl ?? null,
    s: table.minerals?.s ?? null,
    co_ppm: table.minerals?.co_ppm ?? null,
    cu_ppm: table.minerals?.cu_ppm ?? null,
    i_ppm: table.minerals?.i_ppm ?? null,
    fe_ppm: table.minerals?.fe_ppm ?? null,
    mn_ppm: table.minerals?.mn_ppm ?? null,
    se_ppm: table.minerals?.se_ppm ?? null,
    zn_ppm: table.minerals?.zn_ppm ?? null,
    vit_a: table.vitamins?.vit_a ?? null,
    vit_d: table.vitamins?.vit_d ?? null,
    vit_e: table.vitamins?.vit_e ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC MODE
// ═══════════════════════════════════════════════════════════════════════════
function resolveDynamic(context) {
  const bw_kg = num(context.bw_kg, 350);
  const adg_kg = num(context.adg_kg, 1.2);
  const sex = String(context.sex || context.type || 'steer').toLowerCase();
  const days_pregnant = num(context.days_pregnant, 0);
  const activity = num(context.activity_factor, 1.0);
  const bp = getBreedProfile(context.breed);
  const mf = bp.maintenance_factor;

  // Calculate daily requirements (apply breed maintenance factor to NEm)
  const nem_day = round(calcNem(bw_kg, sex, activity) * mf, 3);
  const neg_day = calcNeg(bw_kg, adg_kg, sex);
  const mp = round(calcMP(bw_kg, adg_kg, sex, days_pregnant) * mf, 0);

  // Estimate diet NEm/NEg concentrations
  // Assume typical feedlot diet — varies with diet composition
  const nem_diet = round((adg_kg > 1.2 ? 1.52 : adg_kg > 0.8 ? 1.35 : 1.20) * mf * (1 + (bp.energy_boost||0)), 3);
  const neg_diet = round((adg_kg > 1.2 ? 0.99 : adg_kg > 0.8 ? 0.85 : 0.72) * mf, 3);
  const tdn = round(nem_diet / 0.02, 1);
  const me_mcal_kg = round(nem_diet / 0.576, 3);

  // DMI
  const dmi_kg = calcDMI(bw_kg, adg_kg, nem_diet);

  // CP from MP
  const cp = round(mp / (dmi_kg * 10 * 0.65) + (bp.cp_boost||0), 2);
  const rup = adg_kg > 1.2 ? 38 : 30;

  // Minerals
  const ca_pct = calcCa(bw_kg, adg_kg, dmi_kg);
  const p_pct = calcP(bw_kg, adg_kg, dmi_kg);

  // Phase label
  let phase_label = 'Growing';
  if (adg_kg > 1.4) phase_label = 'Finishing';
  else if (adg_kg > 1.0) phase_label = 'Growing/Feedlot';
  else phase_label = 'Stocker/Backgrounding';

  const breedLabel = bp.label_prefix
    ? `${bp.label_prefix.charAt(0).toUpperCase() + bp.label_prefix.slice(1).replace(/_/g,' ')} — Dynamic ${phase_label} (${bw_kg}kg ${sex}, ADG ${adg_kg}kg)`
    : `Dynamic — ${phase_label} (${bw_kg}kg ${sex}, ADG ${adg_kg}kg)`;

  return {
    ok: true,
    mode: 'dynamic',
    standard: 'NASEM_2016',
    breed_used: context.breed || 'generic',
    label: breedLabel,
    inputs: { bw_kg, adg_kg, sex, days_pregnant, breed: context.breed || 'generic' },
    nem_mcal_kg: nem_diet,
    neg_mcal_kg: neg_diet,
    nem_mcal_day: nem_day,
    neg_mcal_day: neg_day,
    tdn,
    me_mcal_kg,
    dmi_predicted_kg: dmi_kg,
    cp,
    mp_g_day: mp,
    rup,
    rdp: 100 - rup,
    ndf: adg_kg > 1.4 ? 12 : adg_kg > 1.0 ? 15 : 22,
    adf: adg_kg > 1.4 ? 8 : adg_kg > 1.0 ? 10 : 15,
    ca: ca_pct,
    total_p: p_pct,
    mg: 0.10,
    k: 0.65,
    na: 0.07,
    cl: 0.15,
    s: 0.15,
    co_ppm: 0.15,          // NASEM 2016: 0.15 mg/kg
    cu_ppm: 10,
    i_ppm: 0.50,
    fe_ppm: 50,
    mn_ppm: 20,
    se_ppm: 0.10,          // NASEM 2016 requirement: 0.10 mg/kg
    zn_ppm: 30,
    vit_a: 2200,
    vit_d: 275,
    vit_e: 15,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════
function resolveBeefRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();
  try {
    return mode === 'dynamic' ? resolveDynamic(context) : resolveStatic(context);
  } catch (e) {
    return { ok: false, error: 'BEEF_ENGINE_ERROR', message: e.message, mode };
  }
}

module.exports = { resolveBeefRequirements, resolveStatic, resolveDynamic, STATIC_REQUIREMENTS };
