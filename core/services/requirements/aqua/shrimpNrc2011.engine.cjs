"use strict";
/**
 * Whiteleg Shrimp (Litopenaeus vannamei) Requirements Engine
 * Primary Source: NRC 2011 Nutrient Requirements of Fish and Shrimp
 * Updates: Peer-reviewed literature 2011-2024
 * Standard Label: "NRC 2011 + Literature 2011-2024"
 *
 * Key system differences from terrestrial animals:
 * - Uses Digestible Energy (DE, kcal/kg) not ME
 * - Uses Digestible Protein (DP, %) not CP
 * - Amino acids expressed as % of diet DM
 * - Phosphorus: available/digestible P critical (excreted via gills)
 * - Omega-3: EPA+DHA critical for survival and immunity
 *
 * Production phases:
 *   nauplii/zoea → mysis → post-larvae (PL) → juvenile → grow-out → broodstock
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
// STATIC TABLES — NRC 2011 + Literature updates
// All values per kg diet DM unless noted
// ═══════════════════════════════════════════════════════════════════════════
const STATIC_REQUIREMENTS = {

  post_larvae: {
    label: "Shrimp — Post-Larvae (PL1-PL20, <0.05g)",
    production: "post_larvae", phase: "post_larvae",
    bw_range_g: [0, 0.05],
    energy: {
      de_kcal_kg: 3200,        // Digestible Energy
      de_mj_kg: 13.4,
    },
    protein: {
      dp_pct: 40,              // Digestible Protein %
      cp_pct: 44,              // Crude Protein %
      // Essential amino acids (% diet DM) — NRC 2011 Table 9-1
      arg: 2.4, his: 0.9, ile: 1.6, leu: 2.8, lys: 2.3,
      met: 0.9, met_cys: 1.5, phe: 1.7, phe_tyr: 2.8,
      thr: 1.5, trp: 0.4, val: 1.8,
    },
    lipids: {
      total_lipid_pct: 8,
      // Fatty acids (% diet DM) — updated from 2011-2024 literature
      epa_dha_pct: 0.8,        // Glencross 2020: critical for PL survival
      linoleic_pct: 0.5,       // n-6 HUFA
      cholesterol_pct: 0.5,    // shrimp cannot synthesize cholesterol
      lecithin_pct: 1.5,       // phospholipid critical for PL
    },
    carbohydrates: {
      starch_max_pct: 20,      // shrimp have limited amylase activity
    },
    minerals: {
      ca_pct: 1.5,
      p_pct: 1.2,              // total P
      avail_p_pct: 0.8,        // digestible/available P
      mg_pct: 0.20,
      k_pct: 0.80,
      na_pct: 0.30,
      fe_ppm: 60,
      zn_ppm: 30,
      mn_ppm: 20,
      cu_ppm: 10,
      se_ppm: 0.30,
      i_ppm: 0.20,
    },
    vitamins: {
      vit_a_iu_kg: 10000,
      vit_d_iu_kg: 500,
      vit_e_mg_kg: 100,
      vit_c_mg_kg: 500,        // ascorbic acid — shrimp cannot synthesize
      vit_k_mg_kg: 10,
      vit_b1_mg_kg: 60,
      vit_b2_mg_kg: 40,
      vit_b6_mg_kg: 30,
      vit_b12_mg_kg: 0.05,
      niacin_mg_kg: 200,
      pantothenic_mg_kg: 75,
      folic_mg_kg: 10,
      biotin_mg_kg: 1.0,
      choline_mg_kg: 3000,
      inositol_mg_kg: 400,     // critical for shrimp — updated from literature
    },
    feed_management: {
      fcr_target: 1.2,
      feeding_rate_pct_bw: 20,
      feeds_per_day: 6,
    },
  },

  juvenile: {
    label: "Shrimp — Juvenile (0.05-2g, PL20-30 days)",
    production: "juvenile", phase: "juvenile",
    bw_range_g: [0.05, 2],
    energy: {
      de_kcal_kg: 3100,
      de_mj_kg: 13.0,
    },
    protein: {
      dp_pct: 36,
      cp_pct: 40,
      arg: 2.2, his: 0.8, ile: 1.5, leu: 2.6, lys: 2.1,
      met: 0.8, met_cys: 1.4, phe: 1.6, phe_tyr: 2.6,
      thr: 1.4, trp: 0.4, val: 1.7,
    },
    lipids: {
      total_lipid_pct: 7,
      epa_dha_pct: 0.6,
      linoleic_pct: 0.5,
      cholesterol_pct: 0.3,
      lecithin_pct: 1.0,
    },
    carbohydrates: { starch_max_pct: 25 },
    minerals: {
      ca_pct: 1.2, p_pct: 1.0, avail_p_pct: 0.6,
      mg_pct: 0.18, k_pct: 0.70, na_pct: 0.25,
      fe_ppm: 50, zn_ppm: 25, mn_ppm: 15, cu_ppm: 8,
      se_ppm: 0.25, i_ppm: 0.15,
    },
    vitamins: {
      vit_a_iu_kg: 8000, vit_d_iu_kg: 400, vit_e_mg_kg: 80,
      vit_c_mg_kg: 300, vit_k_mg_kg: 8,
      vit_b1_mg_kg: 50, vit_b2_mg_kg: 30, vit_b6_mg_kg: 25,
      vit_b12_mg_kg: 0.04, niacin_mg_kg: 150, pantothenic_mg_kg: 60,
      folic_mg_kg: 8, biotin_mg_kg: 0.8, choline_mg_kg: 2500,
      inositol_mg_kg: 300,
    },
    feed_management: {
      fcr_target: 1.3, feeding_rate_pct_bw: 10, feeds_per_day: 4,
    },
  },

  grow_out_early: {
    label: "Shrimp — Early Grow-out (2-10g, 30-60 days)",
    production: "grow_out", phase: "early",
    bw_range_g: [2, 10],
    energy: {
      de_kcal_kg: 2900,
      de_mj_kg: 12.1,
    },
    protein: {
      dp_pct: 32,
      cp_pct: 36,
      arg: 2.0, his: 0.7, ile: 1.4, leu: 2.4, lys: 1.9,
      met: 0.7, met_cys: 1.2, phe: 1.5, phe_tyr: 2.4,
      thr: 1.3, trp: 0.3, val: 1.6,
    },
    lipids: {
      total_lipid_pct: 6,
      epa_dha_pct: 0.5,
      linoleic_pct: 0.4,
      cholesterol_pct: 0.25,
      lecithin_pct: 0.8,
    },
    carbohydrates: { starch_max_pct: 28 },
    minerals: {
      ca_pct: 1.0, p_pct: 0.9, avail_p_pct: 0.5,
      mg_pct: 0.15, k_pct: 0.65, na_pct: 0.22,
      fe_ppm: 45, zn_ppm: 22, mn_ppm: 12, cu_ppm: 6,
      se_ppm: 0.22, i_ppm: 0.12,
    },
    vitamins: {
      vit_a_iu_kg: 6000, vit_d_iu_kg: 300, vit_e_mg_kg: 60,
      vit_c_mg_kg: 200, vit_k_mg_kg: 6,
      vit_b1_mg_kg: 40, vit_b2_mg_kg: 25, vit_b6_mg_kg: 20,
      vit_b12_mg_kg: 0.03, niacin_mg_kg: 120, pantothenic_mg_kg: 50,
      folic_mg_kg: 6, biotin_mg_kg: 0.6, choline_mg_kg: 2000,
      inositol_mg_kg: 200,
    },
    feed_management: {
      fcr_target: 1.4, feeding_rate_pct_bw: 6, feeds_per_day: 4,
    },
  },

  grow_out_late: {
    label: "Shrimp — Late Grow-out (10-20g, 60-100 days)",
    production: "grow_out", phase: "late",
    bw_range_g: [10, 20],
    energy: {
      de_kcal_kg: 2800,
      de_mj_kg: 11.7,
    },
    protein: {
      dp_pct: 30,
      cp_pct: 34,
      arg: 1.8, his: 0.6, ile: 1.3, leu: 2.2, lys: 1.8,
      met: 0.7, met_cys: 1.1, phe: 1.4, phe_tyr: 2.2,
      thr: 1.2, trp: 0.3, val: 1.5,
    },
    lipids: {
      total_lipid_pct: 6,
      epa_dha_pct: 0.4,
      linoleic_pct: 0.4,
      cholesterol_pct: 0.20,
      lecithin_pct: 0.6,
    },
    carbohydrates: { starch_max_pct: 30 },
    minerals: {
      ca_pct: 0.9, p_pct: 0.8, avail_p_pct: 0.45,
      mg_pct: 0.13, k_pct: 0.60, na_pct: 0.20,
      fe_ppm: 40, zn_ppm: 20, mn_ppm: 10, cu_ppm: 5,
      se_ppm: 0.20, i_ppm: 0.10,
    },
    vitamins: {
      vit_a_iu_kg: 5000, vit_d_iu_kg: 250, vit_e_mg_kg: 50,
      vit_c_mg_kg: 150, vit_k_mg_kg: 5,
      vit_b1_mg_kg: 35, vit_b2_mg_kg: 20, vit_b6_mg_kg: 18,
      vit_b12_mg_kg: 0.02, niacin_mg_kg: 100, pantothenic_mg_kg: 40,
      folic_mg_kg: 5, biotin_mg_kg: 0.5, choline_mg_kg: 1800,
      inositol_mg_kg: 150,
    },
    feed_management: {
      fcr_target: 1.5, feeding_rate_pct_bw: 4, feeds_per_day: 4,
    },
  },

  broodstock: {
    label: "Shrimp — Broodstock (>20g, maturation)",
    production: "broodstock", phase: "maturation",
    bw_range_g: [20, 50],
    energy: {
      de_kcal_kg: 3200,
      de_mj_kg: 13.4,
    },
    protein: {
      dp_pct: 40,
      cp_pct: 45,
      arg: 2.5, his: 1.0, ile: 1.8, leu: 3.0, lys: 2.5,
      met: 1.0, met_cys: 1.7, phe: 1.9, phe_tyr: 3.0,
      thr: 1.7, trp: 0.5, val: 2.0,
    },
    lipids: {
      total_lipid_pct: 10,
      epa_dha_pct: 1.2,        // critical for egg quality — Wouters 2001 updated
      linoleic_pct: 0.8,
      cholesterol_pct: 0.6,
      lecithin_pct: 2.0,       // critical for oocyte maturation
    },
    carbohydrates: { starch_max_pct: 18 },
    minerals: {
      ca_pct: 1.6, p_pct: 1.3, avail_p_pct: 0.9,
      mg_pct: 0.22, k_pct: 0.85, na_pct: 0.32,
      fe_ppm: 65, zn_ppm: 35, mn_ppm: 25, cu_ppm: 12,
      se_ppm: 0.35, i_ppm: 0.25,
    },
    vitamins: {
      vit_a_iu_kg: 12000, vit_d_iu_kg: 600, vit_e_mg_kg: 150,
      vit_c_mg_kg: 600, vit_k_mg_kg: 12,
      vit_b1_mg_kg: 70, vit_b2_mg_kg: 50, vit_b6_mg_kg: 35,
      vit_b12_mg_kg: 0.06, niacin_mg_kg: 250, pantothenic_mg_kg: 90,
      folic_mg_kg: 12, biotin_mg_kg: 1.2, choline_mg_kg: 3500,
      inositol_mg_kg: 500,
    },
    feed_management: {
      fcr_target: 1.3, feeding_rate_pct_bw: 5, feeds_per_day: 4,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC ENGINE
// Based on Bureau (2006) bioenergetic model adapted for shrimp
// ═══════════════════════════════════════════════════════════════════════════

function calcDE(bw_g, temp_c = 28, salinity_ppt = 15) {
  // DE requirement (kcal/day) — maintenance + growth
  // Shrimp maintenance ~50 kcal/kg BW^0.8/day at 28°C
  const bw_kg = bw_g / 1000;
  const de_maint = 50 * Math.pow(bw_kg, 0.8);
  // Temperature correction (Q10 = 2 for shrimp)
  const temp_factor = Math.pow(2, (temp_c - 28) / 10);
  // Salinity correction
  const sal_factor = salinity_ppt >= 10 && salinity_ppt <= 25 ? 1.0 : 1.05;
  return round(de_maint * temp_factor * sal_factor, 2);
}

function calcDP(bw_g, adg_g_day) {
  // DP requirement (g/day)
  const bw_kg = bw_g / 1000;
  const dp_maint = 0.45 * Math.pow(bw_kg, 0.75) * 1000; // g/day
  const dp_growth = adg_g_day * 0.18 / 0.70; // 18% protein in gain, 70% efficiency
  return round(dp_maint + dp_growth, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_MAP = {
  post_larvae: 'post_larvae', pl: 'post_larvae', larvae: 'post_larvae',
  juvenile: 'juvenile', fingerling: 'juvenile',
  grow_out: 'grow_out_early', grow_out_early: 'grow_out_early',
  early: 'grow_out_early', growing: 'grow_out_early',
  grow_out_late: 'grow_out_late', late: 'grow_out_late', finishing: 'grow_out_late',
  broodstock: 'broodstock', maturation: 'broodstock', spawner: 'broodstock',
};

function resolvePhaseKey(production, phase) {
  const pr = String(production || '').toLowerCase();
  const ph = String(phase || '').toLowerCase();
  const combined = `${pr}_${ph}`;
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[ph]) return PHASE_MAP[ph];
  if (PHASE_MAP[pr]) return PHASE_MAP[pr];
  return 'grow_out_early';
}

function resolveStatic(context) {
  const phaseKey = resolvePhaseKey(context.production, context.phase);
  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };

  return {
    ok: true, mode: 'static',
    standard: 'NRC_2011_Shrimp_plus_Literature_2011_2024',
    species: 'shrimp', species_name: 'Litopenaeus vannamei',
    phase_key: phaseKey, label: table.label,
    // Energy — DE system
    digestible_energy_fish: table.energy?.de_kcal_kg ?? null,
    de_kcal_kg: table.energy?.de_kcal_kg ?? null,
    de_mj_kg: table.energy?.de_mj_kg ?? null,
    // Protein
    cp: table.protein?.cp_pct ?? null,
    digestible_protein_fish: table.protein?.dp_pct ?? null,
    dp_pct: table.protein?.dp_pct ?? null,
    // Essential AAs (% DM)
    total_arg: table.protein?.arg ?? null,
    total_his: table.protein?.his ?? null,
    total_ile: table.protein?.ile ?? null,
    total_leu: table.protein?.leu ?? null,
    total_lys: table.protein?.lys ?? null,
    total_met: table.protein?.met ?? null,
    total_metcys: table.protein?.met_cys ?? null,
    phe: table.protein?.phe ?? null,
    total_thr: table.protein?.thr ?? null,
    total_trp: table.protein?.trp ?? null,
    total_val: table.protein?.val ?? null,
    // Lipids
    ee: table.lipids?.total_lipid_pct ?? null,
    dha_epa: table.lipids?.epa_dha_pct ?? null,
    linoleic: table.lipids?.linoleic_pct ?? null,
    cholesterol: table.lipids?.cholesterol_pct ?? null,
    lecithin: table.lipids?.lecithin_pct ?? null,
    // Minerals
    ca: table.minerals?.ca_pct ?? null,
    total_p: table.minerals?.p_pct ?? null,
    avp: table.minerals?.avail_p_pct ?? null,
    mg: table.minerals?.mg_pct ?? null,
    k: table.minerals?.k_pct ?? null,
    na: table.minerals?.na_pct ?? null,
    fe: table.minerals?.fe_ppm ?? null,
    zn: table.minerals?.zn_ppm ?? null,
    mn: table.minerals?.mn_ppm ?? null,
    cu: table.minerals?.cu_ppm ?? null,
    se: table.minerals?.se_ppm ?? null,
    i: table.minerals?.i_ppm ?? null,
    // Vitamins
    vit_a: table.vitamins?.vit_a_iu_kg ?? null,
    vit_d3: table.vitamins?.vit_d_iu_kg ?? null,
    vit_e: table.vitamins?.vit_e_mg_kg ?? null,
    vit_c: table.vitamins?.vit_c_mg_kg ?? null,
    niacin: table.vitamins?.niacin_mg_kg ?? null,
    choline: table.vitamins?.choline_mg_kg ?? null,
    inositol: table.vitamins?.inositol_mg_kg ?? null,
    // Feed management
    fcr_target: table.feed_management?.fcr_target ?? null,
    feeding_rate_pct_bw: table.feed_management?.feeding_rate_pct_bw ?? null,
    feeds_per_day: table.feed_management?.feeds_per_day ?? null,
  };
}

function resolveDynamic(context) {
  const bw_g = num(context.bw_g || context.bw_kg ? context.bw_kg * 1000 : 5, 5);
  const adg_g_day = num(context.adg_g_day, 0.3);
  const temp_c = num(context.temp_c, 28);
  const salinity_ppt = num(context.salinity_ppt, 15);
  const density_m2 = num(context.density_m2, 50);

  const de_day = calcDE(bw_g, temp_c, salinity_ppt);
  const dp_day = calcDP(bw_g, adg_g_day);

  // Phase determination
  let phaseKey = 'grow_out_early';
  if (bw_g < 0.05) phaseKey = 'post_larvae';
  else if (bw_g < 2) phaseKey = 'juvenile';
  else if (bw_g < 10) phaseKey = 'grow_out_early';
  else if (bw_g < 20) phaseKey = 'grow_out_late';
  else phaseKey = 'broodstock';

  const base = resolveStatic({ production: phaseKey, phase: phaseKey });

  return {
    ...base,
    ok: true, mode: 'dynamic',
    standard: 'NRC_2011_Shrimp_plus_Literature_2011_2024',
    label: `Dynamic — Shrimp ${bw_g}g BW, ADG ${adg_g_day}g/day, ${temp_c}°C`,
    inputs: { bw_g, adg_g_day, temp_c, salinity_ppt, density_m2 },
    de_mcal_day: round(de_day / 1000, 4),
    dp_g_day: dp_day,
  };
}

function resolveShrimpRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();
  try {
    return mode === 'dynamic' ? resolveDynamic(context) : resolveStatic(context);
  } catch (e) {
    return { ok: false, error: 'SHRIMP_ENGINE_ERROR', message: e.message, mode };
  }
}

module.exports = { resolveShrimpRequirements, STATIC_REQUIREMENTS };
