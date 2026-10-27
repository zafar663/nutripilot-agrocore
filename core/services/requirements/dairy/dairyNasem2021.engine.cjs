"use strict";
/**
 * Dairy NASEM 2021 Requirements Engine
 * Published sources (not Cornell CNCPS software):
 *   - NASEM 2021 Nutrient Requirements of Dairy Cattle, 8th Revised Edition
 *   - CNCPS literature: Fox et al. (2004) J. Anim. Sci.; Van Amburgh et al. (2015)
 *     and related NASEM/CNCPS equations in the public dairy nutrition literature.
 *
 * Two modes:
 *   static  — lookup from pre-built NASEM 2021 requirement tables
 *   dynamic — NEL, DMI, MP, Ca, P from those published equations and animal inputs
 *
 * Usage:
 *   const { resolveDairyRequirements } = require('./dairyNasem2021.engine.cjs');
 *   const reqs = resolveDairyRequirements({ mode: 'static', production: 'lactating', phase: 'peak', milk_kg_day: 35 });
 *   const reqs = resolveDairyRequirements({ mode: 'dynamic', bw_kg: 650, milk_kg_day: 40, fat_pct: 3.8, protein_pct: 3.2, dim: 60 });
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
// STATIC TABLES — NASEM 2021
// All values are per kg DM unless otherwise noted
// Energy: NEL (Mcal/kg), TDN (%), ME (Mcal/kg)
// Protein: MP (g/day), RUP (% CP), RDP (% CP), CP (%)
// Minerals: % of DM unless noted as ppm
// ═══════════════════════════════════════════════════════════════════════════

const STATIC_REQUIREMENTS = {

  // ── LACTATING COWS ───────────────────────────────────────────────────────
  lactating_early: {
    // Early lactation: 0-60 DIM, ~30-35 kg/day milk
    label: "Lactating Cow — Early (0-60 DIM)",
    production: "lactating",
    phase: "early",
    dim_range: [0, 60],
    energy: {
      nel_mcal_kg: 1.65,       // NASEM 2021 (vs 1.54 NRC 2001)
      tdn: 74,
      me_mcal_kg: 2.90,
      nem_mcal_day: 8.20,      // maintenance NEL (650kg cow)
      nel_milk_mcal_per_kg: 0.327, // NEL per kg 3.5% FCM
    },
    protein: {
      cp: 17.5,                // % DM
      mp_g_day: 2450,          // metabolizable protein g/day
      rup_pct_cp: 38,          // rumen undegradable protein % of CP
      rdp_pct_cp: 62,
      mp_lys_pct: 7.2,         // Lys as % of MP (NASEM 2021)
      mp_met_pct: 2.4,         // Met as % of MP
    },
    fiber: {
      ndf_min: 28,             // % DM minimum
      adf_min: 19,
      ndf_forage_min: 19,      // NDF from forage minimum
      peNDF_min: 22,
    },
    minerals: {
      ca: 0.57,                // NASEM 2021 Table 21-1 (700 kg Holstein, early lactation)
      p: 0.38,
      mg: 0.25,
      k: 1.0,
      na: 0.22,
      cl: 0.25,
      s: 0.22,
      // Trace minerals (ppm DM) — NASEM 2021 Table 21-1
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg (vs NRC 2001's 0.11)
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 16,              // NASEM 2021: 16 ppm early lactation
      mn_ppm: 28,              // NASEM 2021: 28 ppm early lactation
      se_ppm: 0.30,
      zn_ppm: 57,              // NASEM 2021: 57 ppm early lactation
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM (NASEM 2021: 110 IU/kg BW × 650 kg ÷ 20 kg DMI)
      vit_d: 1000,             // IU/kg DM (NASEM 2021: 30 IU/kg BW × 650 kg ÷ 20 kg DMI)
      vit_e: 20,
    },
  },

  lactating_peak: {
    // Peak lactation: 60-120 DIM, ~35-45 kg/day milk
    label: "Lactating Cow — Peak (60-120 DIM)",
    production: "lactating",
    phase: "peak",
    dim_range: [60, 120],
    energy: {
      nel_mcal_kg: 1.72,
      tdn: 76,
      me_mcal_kg: 3.00,
      nem_mcal_day: 8.20,
      nel_milk_mcal_per_kg: 0.327,
    },
    protein: {
      cp: 17.0,
      mp_g_day: 2600,
      rup_pct_cp: 40,
      rdp_pct_cp: 60,
      mp_lys_pct: 7.2,
      mp_met_pct: 2.4,
    },
    fiber: {
      ndf_min: 27,
      adf_min: 18,
      ndf_forage_min: 18,
      peNDF_min: 21,
    },
    minerals: {
      ca: 0.57,                // NASEM 2021 Table 21-1 peak lactation
      p: 0.37,
      mg: 0.20,
      k: 1.0,
      na: 0.22,
      cl: 0.25,
      s: 0.20,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 16,              // NASEM 2021: 16 ppm peak lactation
      mn_ppm: 26,              // NASEM 2021: 26 ppm peak lactation
      se_ppm: 0.30,
      zn_ppm: 58,              // NASEM 2021: 58 ppm peak lactation
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 20,
    },
  },

  lactating_mid: {
    // Mid lactation: 120-200 DIM, ~28-35 kg/day milk
    label: "Lactating Cow — Mid (120-200 DIM)",
    production: "lactating",
    phase: "mid",
    dim_range: [120, 200],
    energy: {
      nel_mcal_kg: 1.62,
      tdn: 72,
      me_mcal_kg: 2.85,
      nem_mcal_day: 8.20,
      nel_milk_mcal_per_kg: 0.327,
    },
    protein: {
      cp: 16.5,
      mp_g_day: 2200,
      rup_pct_cp: 36,
      rdp_pct_cp: 64,
      mp_lys_pct: 7.2,
      mp_met_pct: 2.4,
    },
    fiber: {
      ndf_min: 28,
      adf_min: 19,
      ndf_forage_min: 19,
      peNDF_min: 22,
    },
    minerals: {
      ca: 0.65,
      p: 0.38,                 // NASEM 2021: 0.38-0.39 ppm mid lactation
      mg: 0.20,
      k: 1.0,
      na: 0.22,
      cl: 0.25,
      s: 0.20,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 21,              // NASEM 2021: 21 ppm mid lactation
      mn_ppm: 31,              // NASEM 2021: 31 ppm mid lactation
      se_ppm: 0.30,
      zn_ppm: 66,              // NASEM 2021: 66 ppm mid lactation
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 20,
    },
  },

  lactating_late: {
    // Late lactation: 200-305 DIM, ~20-28 kg/day milk
    label: "Lactating Cow — Late (200-305 DIM)",
    production: "lactating",
    phase: "late",
    dim_range: [200, 305],
    energy: {
      nel_mcal_kg: 1.55,
      tdn: 69,
      me_mcal_kg: 2.72,
      nem_mcal_day: 8.20,
      nel_milk_mcal_per_kg: 0.327,
    },
    protein: {
      cp: 15.5,
      mp_g_day: 1900,
      rup_pct_cp: 34,
      rdp_pct_cp: 66,
      mp_lys_pct: 7.2,
      mp_met_pct: 2.4,
    },
    fiber: {
      ndf_min: 30,
      adf_min: 20,
      ndf_forage_min: 20,
      peNDF_min: 23,
    },
    minerals: {
      ca: 0.58,
      p: 0.32,
      mg: 0.20,
      k: 1.0,
      na: 0.22,
      cl: 0.25,
      s: 0.20,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 19,              // NASEM 2021: 19 ppm late lactation
      mn_ppm: 28,              // NASEM 2021: 28 ppm late lactation
      se_ppm: 0.30,
      zn_ppm: 62,              // NASEM 2021: 62 ppm late lactation
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 20,
    },
  },

  // ── DRY COWS ─────────────────────────────────────────────────────────────
  dry_far_off: {
    // Far-off dry: 60-21 days before calving
    label: "Dry Cow — Far Off (>21 days pre-calving)",
    production: "dry",
    phase: "far_off",
    energy: {
      nel_mcal_kg: 1.30,       // NASEM 2021 (vs 1.25 NRC 2001 — Overton work)
      tdn: 58,
      me_mcal_kg: 2.28,
      nem_mcal_day: 7.70,      // 630kg BW maintenance
    },
    protein: {
      cp: 13.0,
      mp_g_day: 1050,
      rup_pct_cp: 30,
      rdp_pct_cp: 70,
      mp_lys_pct: 7.2,
      mp_met_pct: 2.4,
    },
    fiber: {
      ndf_min: 40,
      adf_min: 26,
      ndf_forage_min: 30,
      peNDF_min: 30,
    },
    minerals: {
      ca: 0.32,                // NASEM 2021 far-off dry: ~0.31-0.33%
      p: 0.19,                 // NASEM 2021 far-off dry: ~0.17-0.20%
      mg: 0.13,                // NASEM 2021 far-off dry: 0.13% (not 0.35%)
      k: 0.65,                 // Limit K for DCAD management
      na: 0.10,
      cl: 0.20,
      s: 0.20,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 15,              // NASEM 2021 dry cows
      mn_ppm: 37,              // NASEM 2021 dry cows: 37 ppm
      se_ppm: 0.30,
      zn_ppm: 50,              // NASEM 2021 dry cows: 50 ppm
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 80,               // NASEM 2021: high Vit E pre-calving
    },
    dcad_meq_kg: 0,            // Target DCAD (mEq/kg DM) - neutral for far off
  },

  dry_close_up: {
    // Close-up dry: 21 days before calving
    label: "Dry Cow — Close Up (0-21 days pre-calving)",
    production: "dry",
    phase: "close_up",
    energy: {
      nel_mcal_kg: 1.60,       // NASEM 2021 — higher than NRC 2001 (1.54)
      tdn: 72,
      me_mcal_kg: 2.80,
      nem_mcal_day: 7.70,
    },
    protein: {
      cp: 15.0,
      mp_g_day: 1250,
      rup_pct_cp: 38,
      rdp_pct_cp: 62,
      mp_lys_pct: 7.2,
      mp_met_pct: 2.4,
    },
    fiber: {
      ndf_min: 33,
      adf_min: 21,
      ndf_forage_min: 22,
      peNDF_min: 25,
    },
    minerals: {
      ca: 0.39,                // NASEM 2021 close-up: ~0.39% (low for DCAD)
      p: 0.21,                 // NASEM 2021 close-up: ~0.21%
      mg: 0.14,                // NASEM 2021 close-up: 0.14% (not 0.40%)
      k: 0.65,
      na: 0.10,
      cl: 0.35,                // Anionic salts — DCAD
      s: 0.30,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 15,              // NASEM 2021 dry cows
      mn_ppm: 37,              // NASEM 2021 dry cows: 37 ppm
      se_ppm: 0.30,
      zn_ppm: 50,              // NASEM 2021 dry cows: 50 ppm
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 80,               // Critical for immune function at calving
    },
    dcad_meq_kg: -100,         // Negative DCAD target for close-up
  },

  // ── HEIFERS ──────────────────────────────────────────────────────────────
  heifer_breeding: {
    label: "Heifer — Breeding (12-15 months)",
    production: "heifer",
    phase: "breeding",
    energy: {
      nel_mcal_kg: 1.45,
      tdn: 65,
      me_mcal_kg: 2.55,
      adg_kg: 0.8,
    },
    protein: {
      cp: 14.0,
      mp_g_day: 850,
      rup_pct_cp: 28,
      rdp_pct_cp: 72,
    },
    fiber: {
      ndf_min: 35,
      adf_min: 22,
    },
    minerals: {
      ca: 0.55,
      p: 0.30,
      mg: 0.18,
      k: 0.80,
      na: 0.18,
      cl: 0.20,
      s: 0.18,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 30,
      se_ppm: 0.30,
      zn_ppm: 45,
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 25,
    },
  },

  heifer_pre_fresh: {
    label: "Heifer — Pre-Fresh (last 60 days of gestation)",
    production: "heifer",
    phase: "pre_fresh",
    energy: {
      nel_mcal_kg: 1.55,
      tdn: 69,
      me_mcal_kg: 2.72,
    },
    protein: {
      cp: 14.5,
      mp_g_day: 1050,
      rup_pct_cp: 33,
      rdp_pct_cp: 67,
    },
    fiber: {
      ndf_min: 35,
      adf_min: 22,
    },
    minerals: {
      ca: 0.50,
      p: 0.28,
      mg: 0.14,                // NASEM 2021: 0.14% (not 0.35%)
      k: 0.70,
      na: 0.12,
      cl: 0.25,
      s: 0.22,
      co_ppm: 0.20,            // NASEM 2021: 0.20 mg/kg
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 15,
      mn_ppm: 37,
      se_ppm: 0.30,
      zn_ppm: 50,
    },
    vitamins: {
      vit_a: 3500,             // IU/kg DM
      vit_d: 1000,             // IU/kg DM
      vit_e: 80,
    },
  },

  // ── GROWING HEIFERS ──────────────────────────────────────────────────────
  heifer_weaned: {
    // Weaned heifer: ~16 weeks to 6 months, BW 70-160 kg, ADG 0.7-0.8 kg/day
    // NASEM 2021 Tables 10-1 and 10-2
    label: "Heifer — Weaned (4-6 months)",
    production: "heifer",
    phase: "weaned",
    energy: {
      nel_mcal_kg: 1.65,       // High density needed to support rapid early growth
      tdn: 72,
      me_mcal_kg: 2.90,
      adg_kg: 0.75,
    },
    protein: {
      cp: 18.0,                // NASEM 2021: high CP for lean tissue deposition
      mp_g_day: 480,
      rup_pct_cp: 22,
      rdp_pct_cp: 78,
    },
    fiber: {
      ndf_min: 25,
      adf_min: 17,
    },
    minerals: {
      ca: 0.65,                // NASEM 2021: high Ca demand for skeletal growth
      p: 0.42,
      mg: 0.14,
      k: 0.80,
      na: 0.22,
      cl: 0.22,
      s: 0.18,
      co_ppm: 0.20,
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 30,
      se_ppm: 0.30,
      zn_ppm: 45,
    },
    vitamins: {
      vit_a: 3500,
      vit_d: 1000,
      vit_e: 25,
    },
  },

  heifer_growing: {
    // Growing heifer: 6-12 months, BW 160-280 kg, ADG 0.8-0.9 kg/day
    // NASEM 2021 Tables 10-1 and 10-2
    label: "Heifer — Growing (6-12 months)",
    production: "heifer",
    phase: "growing",
    energy: {
      nel_mcal_kg: 1.52,       // NASEM 2021: moderate density, forage-based diet possible
      tdn: 68,
      me_mcal_kg: 2.68,
      adg_kg: 0.85,
    },
    protein: {
      cp: 15.5,                // NASEM 2021: lower than weaned phase as rumen matures
      mp_g_day: 650,
      rup_pct_cp: 25,
      rdp_pct_cp: 75,
    },
    fiber: {
      ndf_min: 30,
      adf_min: 20,
    },
    minerals: {
      ca: 0.60,                // NASEM 2021: still high for bone growth
      p: 0.38,
      mg: 0.16,
      k: 0.80,
      na: 0.20,
      cl: 0.20,
      s: 0.18,
      co_ppm: 0.20,
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 50,
      mn_ppm: 30,
      se_ppm: 0.30,
      zn_ppm: 45,
    },
    vitamins: {
      vit_a: 3500,
      vit_d: 1000,
      vit_e: 25,
    },
  },

  // ── DAIRY BULL ────────────────────────────────────────────────────────────
  dairy_bull: {
    // Mature dairy bull: 500-900 kg, maintenance + breeding season
    // NASEM 2021 Chapter 11; breeding season adds ~10-15% above maintenance
    label: "Dairy Bull — Mature",
    production: "bull",
    phase: "mature",
    energy: {
      nel_mcal_kg: 1.40,       // NASEM 2021: maintenance-level, forage-based
      tdn: 63,
      me_mcal_kg: 2.46,
    },
    protein: {
      cp: 12.0,                // NASEM 2021: 11-13% depending on season; 12% is mid-range
      mp_g_day: 950,
      rup_pct_cp: 30,
      rdp_pct_cp: 70,
    },
    fiber: {
      ndf_min: 40,             // Bulls tolerate high-forage diets; keep energy controlled
      adf_min: 25,
    },
    minerals: {
      ca: 0.32,                // NASEM 2021: lower than lactating cow — no milk drain
      p: 0.22,
      mg: 0.20,
      k: 0.65,
      na: 0.18,
      cl: 0.20,
      s: 0.18,
      co_ppm: 0.20,
      cu_ppm: 11,
      i_ppm: 0.50,
      fe_ppm: 15,
      mn_ppm: 25,
      se_ppm: 0.30,            // NASEM 2021: Se important for sperm motility
      zn_ppm: 45,              // NASEM 2021: Zn important for testosterone synthesis
    },
    vitamins: {
      vit_a: 3500,             // NASEM 2021: Vit A critical for spermatogenesis
      vit_d: 1000,
      vit_e: 40,               // NASEM 2021: Vit E elevated — antioxidant for sperm quality
    },
  },

  // ── CALVES ───────────────────────────────────────────────────────────────
  calf_pre_weaning: {
    label: "Calf — Pre-Weaning (0-8 weeks)",
    production: "calf",
    phase: "pre_weaning",
    energy: {
      me_mcal_kg: 4.40,        // Milk replacer ME basis
      nel_mcal_kg: null,
    },
    protein: {
      cp: 22.0,                // Milk replacer basis
      mp_g_day: null,
    },
    minerals: {
      ca: 0.70,
      p: 0.45,
      mg: 0.07,
      k: 0.65,
      na: 0.25,
      se_ppm: 0.30,
      zn_ppm: 40,
      cu_ppm: 10,
      mn_ppm: 20,
      fe_ppm: 50,
    },
    vitamins: {
      vit_a: 220,
      vit_d: 110,
      vit_e: 50,
    },
  },

  calf_post_weaning: {
    label: "Calf — Post-Weaning (8-16 weeks)",
    production: "calf",
    phase: "post_weaning",
    energy: {
      nel_mcal_kg: 1.45,
      tdn: 65,
      me_mcal_kg: 2.55,
      adg_kg: 0.7,
    },
    protein: {
      cp: 16.0,
      mp_g_day: 400,
      rup_pct_cp: 20,
      rdp_pct_cp: 80,
    },
    minerals: {
      ca: 0.70,
      p: 0.45,
      mg: 0.10,
      k: 0.80,
      na: 0.25,
      se_ppm: 0.30,
      zn_ppm: 40,
      cu_ppm: 10,
      mn_ppm: 20,
      fe_ppm: 50,
    },
    vitamins: {
      vit_a: 220,
      vit_d: 110,
      vit_e: 25,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC ENGINE — CNCPS / NASEM 2021 EQUATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate maintenance NEL requirement (Mcal/day)
 * NASEM 2021: NEm = 0.073 × BW^0.75 × adjustment factors
 */
function calcNelMaintenance(bw_kg, breed = 'holstein', environment_factor = 1.0) {
  const sbw = bw_kg * 0.96; // shrunk body weight
  const metabolic_bw = Math.pow(sbw, 0.75);

  // Breed coefficients (NASEM 2021 Table 3-1)
  const breed_coeff = {
    holstein: 0.073,
    jersey: 0.071,
    guernsey: 0.072,
    ayrshire: 0.072,
    brown_swiss: 0.073,
    generic: 0.073,
  };
  const coeff = breed_coeff[breed.toLowerCase()] || 0.073;

  // NASEM 2021: NEm is ~10.5% lower than NRC 2001
  const nel_m = coeff * metabolic_bw * environment_factor;
  return round(nel_m, 3);
}

/**
 * Calculate NEL for milk production (Mcal/day)
 * NASEM 2021: NEL = milk_kg × (0.0929 × fat_pct + 0.0563 × protein_pct + 0.0395 × lactose_pct)
 * Simplified: use 3.5% FCM energy content = 0.327 Mcal/kg
 */
function calcNelMilk(milk_kg_day, fat_pct = 3.8, protein_pct = 3.2, lactose_pct = 4.8) {
  const nel_milk = milk_kg_day * (
    0.0929 * fat_pct +
    0.0563 * protein_pct +
    0.0395 * lactose_pct
  );
  return round(nel_milk, 3);
}

/**
 * Calculate NEL for pregnancy (Mcal/day)
 * NASEM 2021: significant only in last trimester
 */
function calcNelPregnancy(days_pregnant = 0, bw_kg = 650) {
  if (days_pregnant < 190) return 0;
  // NASEM 2021 equation
  const calf_bw = 0.066 * bw_kg; // expected calf BW
  const nel_p = (0.00318 * days_pregnant - 0.0352) * (calf_bw / 45) * 0.218;
  return round(Math.max(0, nel_p), 3);
}

/**
 * Calculate NEL for body reserve change (Mcal/day)
 * Positive = gain (costs energy), Negative = loss (provides energy)
 * NASEM 2021: 5.12 Mcal/kg BCS unit (Holstein)
 */
function calcNelBodyReserves(bcs_change_per_day = 0) {
  // BCS change per day × Mcal per BCS unit
  // 1 BCS unit ≈ 56 kg BW change, NEL = 5.12 Mcal/kg
  const nel_br = bcs_change_per_day * 56 * 5.12;
  return round(nel_br, 3);
}

/**
 * Calculate DMI (kg/day) — NASEM 2021 equations
 */
function calcDMI(bw_kg = 650, milk_kg_day = 35, dim = 60, breed = 'holstein') {
  // NRC 2001 lactating DMI with the week-of-lactation lag used by NASEM.
  let dmi_base = (0.372 * milk_kg_day + 0.0968 * Math.pow(bw_kg, 0.75)) *
    (1 - Math.exp(-0.192 * (dim / 7 + 3.67)));
  if (String(breed || '').toLowerCase() === 'jersey') dmi_base *= 0.92;
  return round(Math.max(8, Math.min(35, dmi_base)), 2);
}

/**
 * Calculate Metabolizable Protein requirement (g/day)
 * NASEM 2021: MP = MP_maintenance + MP_milk + MP_pregnancy + MP_growth
 */
function calcMP(bw_kg = 650, milk_kg_day = 35, fat_pct = 3.8, protein_pct = 3.2,
  days_pregnant = 0, growth_kg_day = 0) {

  // MP maintenance (NASEM 2021)
  const mp_m = 3.8 * Math.pow(bw_kg, 0.75); // g/day

  // MP for milk (NASEM 2021: milk true protein / 0.67 efficiency)
  const milk_protein_g = milk_kg_day * protein_pct * 10; // g/day
  const mp_milk = milk_protein_g / 0.67;

  // MP for pregnancy (significant only last trimester)
  const mp_preg = days_pregnant > 190
    ? (0.00268 * days_pregnant - 0.1102) * 480 / 0.67 // simplified
    : 0;

  // MP for growth
  const mp_growth = growth_kg_day * 233 / 0.67; // g/kg growth

  const mp_total = mp_m + mp_milk + mp_preg + mp_growth;
  return round(mp_total, 0);
}

/**
 * Calculate Ca requirement (% DM)
 * NASEM 2021: Ca = (Ca_maint + Ca_milk + Ca_preg + Ca_growth) / DMI / absorption
 */
function calcCa(bw_kg = 650, milk_kg_day = 35, days_pregnant = 0, dmi_kg = 22) {
  const ca_maint = 0.0154 * bw_kg;        // g/day endogenous loss
  const ca_milk = milk_kg_day * 1.22;      // g/day (1.22 g Ca/kg milk)
  const ca_preg = days_pregnant > 190 ? 10 : 0; // g/day fetal
  const ca_total_g = (ca_maint + ca_milk + ca_preg) / 0.38; // absorption 38%
  return round(ca_total_g / (dmi_kg * 1000) * 100, 3); // % DM
}

/**
 * Calculate P requirement (% DM)
 */
function calcP(bw_kg = 650, milk_kg_day = 35, dmi_kg = 22) {
  const p_maint = 0.0180 * bw_kg;         // g/day endogenous loss
  const p_milk = milk_kg_day * 0.90;       // g/day (0.90 g P/kg milk)
  const p_total_g = (p_maint + p_milk) / 0.68; // absorption 68%
  return round(p_total_g / (dmi_kg * 1000) * 100, 3); // % DM
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_MAP = {
  // Lactating
  early: 'lactating_early',
  early_lactation: 'lactating_early',
  peak: 'lactating_peak',
  peak_lactation: 'lactating_peak',
  mid: 'lactating_mid',
  mid_lactation: 'lactating_mid',
  late: 'lactating_late',
  late_lactation: 'lactating_late',
  lactating: 'lactating_peak',
  // Dry
  dry: 'dry_far_off',
  far_off: 'dry_far_off',
  dry_far_off: 'dry_far_off',
  close_up: 'dry_close_up',
  dry_close_up: 'dry_close_up',
  transition: 'dry_close_up',
  pre_fresh: 'dry_close_up',
  // Heifer — growing stages
  heifer_weaned: 'heifer_weaned',
  weaned: 'heifer_weaned',
  heifer_4_6: 'heifer_weaned',
  grower_heifer: 'heifer_weaned',
  heifer_growing: 'heifer_growing',
  growing: 'heifer_growing',
  heifer_6_12: 'heifer_growing',
  yearling: 'heifer_growing',
  // Heifer — breeding & pre-fresh
  heifer: 'heifer_breeding',
  breeding: 'heifer_breeding',
  heifer_breeding: 'heifer_breeding',
  bred: 'heifer_pre_fresh',
  heifer_pre_fresh: 'heifer_pre_fresh',
  // Bull — both maintenance and breeding season map to same table (single mature bull profile)
  bull: 'dairy_bull',
  dairy_bull: 'dairy_bull',
  mature_bull: 'dairy_bull',
  sire: 'dairy_bull',
  bull_maintenance: 'dairy_bull',
  bull_breeding: 'dairy_bull',
  // Calf
  calf: 'calf_pre_weaning',
  pre_weaning: 'calf_pre_weaning',
  calf_pre_weaning: 'calf_pre_weaning',
  post_weaning: 'calf_post_weaning',
  calf_post_weaning: 'calf_post_weaning',
};

function resolvePhaseKey(production, phase) {
  const combined = `${production}_${phase}`.toLowerCase().replace(/\s+/g, '_');
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[phase]) return PHASE_MAP[phase];
  if (PHASE_MAP[production]) return PHASE_MAP[production];

  // DIM-based fallback for lactating
  return 'lactating_peak';
}

// Reference milk yields per phase for static BW-scaling (kg/day assumed in NASEM 2021 tables)
const PHASE_REF_MILK = {
  lactating_early: 32, lactating_peak: 38, lactating_mid: 28, lactating_late: 20,
  dry_far_off: 0,  dry_close_up: 0,
  heifer_weaned: 0, heifer_growing: 0, heifer_breeding: 0, heifer_pre_fresh: 0,
  dairy_bull: 0,
  calf_pre_weaning: 0, calf_post_weaning: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// STATIC MODE — return pre-built table, scaled to actual BW when provided
// ═══════════════════════════════════════════════════════════════════════════
function resolveStatic(context) {
  const phaseKey = resolvePhaseKey(
    String(context.production || 'lactating').toLowerCase(),
    String(context.phase || 'peak').toLowerCase()
  );

  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) {
    return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };
  }

  // Flatten all sub-objects into top-level nutrient keys
  const targets = {
    ok: true,
    mode: 'static',
    standard: 'NASEM_2021',
    phase_key: phaseKey,
    label: table.label,
    // Energy
    nel_mcal_kg: table.energy?.nel_mcal_kg ?? null,
    tdn: table.energy?.tdn ?? null,
    me_mcal_kg: table.energy?.me_mcal_kg ?? null,
    // Protein
    cp: table.protein?.cp ?? null,
    mp_g_day: table.protein?.mp_g_day ?? null,
    rup: table.protein?.rup_pct_cp ?? null,
    rdp: table.protein?.rdp_pct_cp ?? null,
    mp_lys: table.protein?.mp_lys_pct ?? null,
    mp_met: table.protein?.mp_met_pct ?? null,
    // Fiber
    ndf: table.fiber?.ndf_min ?? null,
    adf: table.fiber?.adf_min ?? null,
    peNDF: table.fiber?.peNDF_min ?? null,
    // Macrominerals — base values from table (calibrated to 650 kg Holstein)
    ca: table.minerals?.ca ?? null,
    total_p: table.minerals?.p ?? null,
    mg: table.minerals?.mg ?? null,
    k: table.minerals?.k ?? null,
    na: table.minerals?.na ?? null,
    cl: table.minerals?.cl ?? null,
    s: table.minerals?.s ?? null,
    // Trace minerals — from NASEM 2021 Table 21-1 (concentration targets, ppm in DM)
    co_ppm: table.minerals?.co_ppm ?? null,
    cu_ppm: table.minerals?.cu_ppm ?? null,
    i_ppm: table.minerals?.i_ppm ?? null,
    fe_ppm: table.minerals?.fe_ppm ?? null,
    mn_ppm: table.minerals?.mn_ppm ?? null,
    se_ppm: table.minerals?.se_ppm ?? null,
    zn_ppm: table.minerals?.zn_ppm ?? null,
    // Vitamins
    vit_a: table.vitamins?.vit_a ?? null,
    vit_d: table.vitamins?.vit_d ?? null,
    vit_e: table.vitamins?.vit_e ?? null,
    // DCAD
    dcad_meq_kg: table.dcad_meq_kg ?? null,
  };

  // ── BW SCALING: recalculate BW-dependent macrominerals when actual BW is given ──
  // Static tables were built for a 650 kg Holstein. Ca, P, Mg, K all have
  // a BW-driven maintenance component (NASEM 2021 Ch 20). When actual BW differs,
  // we recalculate using the same NASEM 2021 equations, using the phase's reference
  // milk yield as the production input.
  const actual_bw = num(context.bw_kg, 0);
  if (actual_bw >= 100 && Math.abs(actual_bw - 650) > 20) {
    const ref_milk  = num(context.milk_kg_day, PHASE_REF_MILK[phaseKey] ?? 0);
    const ref_dmi   = calcDMI(actual_bw, Math.max(ref_milk, 0.01), 90);
    const ref_preg  = num(context.days_pregnant, 0);

    // Ca: (maint_loss + milk_drain + preg_drain) / absorption / DMI
    const ca_recalc = calcCa(actual_bw, ref_milk, ref_preg, ref_dmi);
    if (ca_recalc != null) targets.ca = ca_recalc;

    // P: (maint_loss + milk_drain) / absorption / DMI
    const p_recalc  = calcP(actual_bw, ref_milk, ref_dmi);
    if (p_recalc  != null) targets.total_p = p_recalc;

    // Mg: NASEM 2021 — endogenous fecal = 0.003 × BW g/day; milk = 0.12 × milk_kg
    // Absorption 17% for lactating; expressed as % DM
    const mg_maint_g  = 0.003  * actual_bw;
    const mg_milk_g   = 0.12   * ref_milk;
    const mg_total_g  = (mg_maint_g + mg_milk_g) / 0.17;
    targets.mg = round(mg_total_g / (ref_dmi * 1000) * 100, 3);

    // K: NASEM 2021 — endogenous = 0.036 × BW g/day; milk = 1.5 × milk_kg
    // Absorption ~90%; expressed as % DM
    const k_maint_g  = 0.036 * actual_bw;
    const k_milk_g   = 1.50  * ref_milk;
    const k_total_g  = (k_maint_g + k_milk_g) / 0.90;
    targets.k = round(k_total_g / (ref_dmi * 1000) * 100, 3);

    targets._bw_scaled = true;
    targets._bw_used_kg = actual_bw;
  }

  return targets;
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC MODE — CNCPS/NASEM 2021 equations
// ═══════════════════════════════════════════════════════════════════════════
function resolveDynamic(context) {
  const bw_kg = num(context.bw_kg, 650);
  const milk_kg_day = num(context.milk_kg_day, 30);
  const fat_pct = num(context.fat_pct, 3.8);
  const protein_pct = num(context.protein_pct, 3.2);
  const lactose_pct = num(context.lactose_pct, 4.8);
  const dim = num(context.dim, 100);
  const days_pregnant = num(context.days_pregnant, 0);
  const breed = String(context.breed || 'holstein').toLowerCase();
  const bcs = num(context.bcs, 3.0);
  const bcs_target = num(context.bcs_target, bcs);
  const bcs_change_per_day = (bcs_target - bcs) / Math.max(dim, 30);
  const environment_factor = num(context.environment_factor, 1.0);

  // Typed intake wins. Otherwise NRC 2001 lactating prediction.
  const dmi_override = num(context.dmi_kg, 0);
  const dmi_kg = dmi_override > 0 ? round(dmi_override, 2) : calcDMI(bw_kg, milk_kg_day, dim, breed);

  // Calculate energy requirements (Mcal/day)
  const nel_m = calcNelMaintenance(bw_kg, breed, environment_factor);
  const nel_milk = calcNelMilk(milk_kg_day, fat_pct, protein_pct, lactose_pct);
  const nel_preg = calcNelPregnancy(days_pregnant, bw_kg);
  const nel_br = calcNelBodyReserves(bcs_change_per_day);
  const nel_total_day = nel_m + nel_milk + nel_preg + nel_br;

  // NEL concentration (Mcal/kg DM)
  const nel_mcal_kg = round(nel_total_day / dmi_kg, 3);

  // Protein requirements
  const mp_g_day = calcMP(bw_kg, milk_kg_day, fat_pct, protein_pct, days_pregnant);

  // Mineral requirements
  const ca_pct = calcCa(bw_kg, milk_kg_day, days_pregnant, dmi_kg);
  const p_pct = calcP(bw_kg, milk_kg_day, dmi_kg);

  // CP % from MP (NASEM 2021: MP = 0.67 × digestible CP supply)
  // Approximate: CP ≈ MP / (dmi_kg × 10 × 0.65)
  const cp_pct = round(mp_g_day / (dmi_kg * 10 * 0.65), 2);

  // RUP/RDP split depends on milk level
  const rup_pct = milk_kg_day > 35 ? 42 : milk_kg_day > 25 ? 38 : 32;
  const rdp_pct = 100 - rup_pct;

  // Determine phase label from DIM
  let phase_label = 'Peak Lactation';
  if (dim < 60) phase_label = 'Early Lactation';
  else if (dim < 120) phase_label = 'Peak Lactation';
  else if (dim < 200) phase_label = 'Mid Lactation';
  else phase_label = 'Late Lactation';

  return {
    ok: true,
    mode: 'dynamic',
    standard: 'NASEM_2021_published_CNCPS',
    label: `Dynamic — ${phase_label} (${milk_kg_day}kg milk, ${bw_kg}kg BW)`,
    // Inputs used
    inputs: { bw_kg, milk_kg_day, fat_pct, protein_pct, dim, days_pregnant, breed, bcs },
    // Daily totals (for reference)
    nel_total_mcal_day: round(nel_total_day, 2),
    nel_maintenance_mcal_day: nel_m,
    nel_milk_mcal_day: nel_milk,
    nel_pregnancy_mcal_day: nel_preg,
    dmi_predicted_kg: dmi_kg,
    // Diet concentration targets
    nel_mcal_kg,
    tdn: round(nel_mcal_kg / 0.0224, 1), // TDN approximation
    me_mcal_kg: round(nel_mcal_kg / 0.576, 3), // ME ≈ NEL / 0.576 (lactating)
    cp: cp_pct,
    mp_g_day,
    rup: rup_pct,
    rdp: rdp_pct,
    mp_lys: 7.2,  // NASEM 2021 fixed
    mp_met: 2.4,  // NASEM 2021 fixed
    // Fiber
    ndf: milk_kg_day > 35 ? 26 : milk_kg_day > 25 ? 28 : 30,
    adf: milk_kg_day > 35 ? 17 : milk_kg_day > 25 ? 19 : 20,
    peNDF: milk_kg_day > 35 ? 20 : 22,
    // Macrominerals
    ca: ca_pct,
    total_p: p_pct,
    mg: round((0.0048 * bw_kg + 0.12 * milk_kg_day) / (dmi_kg * 1000) * 100, 3),
    k: round((0.036 * bw_kg + 1.5 * milk_kg_day) / (dmi_kg * 1000) * 100, 3),
    na: 0.22,
    cl: 0.25,
    s: 0.20,
    // Trace minerals (NASEM 2021 Ch 21)
    // Zn: endogenous fecal 0.06 mg/kg BW + milk secretion 3.9 mg/kg milk; apparent absorption 15%; ×1.3 safety
    // Mn: endogenous fecal 0.004 mg/kg BW + milk secretion 0.025 mg/kg milk; apparent absorption 0.75%; ×1.5 safety
    // Cu, Se, Co, I, Fe: NASEM 2021 Table 21-1 fixed dietary concentrations
    co_ppm: 0.20,
    cu_ppm: 11,
    i_ppm: 0.50,
    fe_ppm: dim < 120 ? 16 : dim < 200 ? 21 : 19,
    mn_ppm: round((0.004 * bw_kg + 0.025 * milk_kg_day) * 1.5 / 0.0075 / dmi_kg, 1),
    se_ppm: 0.30,
    zn_ppm: round((0.06 * bw_kg + 3.9 * milk_kg_day) * 1.3 / 0.15 / dmi_kg, 1),
    // Vitamins (IU/kg DM — NASEM 2021: 110 IU Vit A / kg BW ÷ 20 kg DMI)
    vit_a: 3500,
    vit_d: 1000,
    vit_e: 20,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════
function resolveDairyRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();

  try {
    if (mode === 'dynamic') {
      return resolveDynamic(context);
    } else {
      return resolveStatic(context);
    }
  } catch (e) {
    return {
      ok: false,
      error: 'DAIRY_ENGINE_ERROR',
      message: e.message,
      mode,
    };
  }
}

module.exports = { resolveDairyRequirements, resolveStatic, resolveDynamic, STATIC_REQUIREMENTS };
