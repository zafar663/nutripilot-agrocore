"use strict";
/**
 * Cat (Felis catus) Requirements Engine
 * Standards supported:
 *   - AAFCO 2024 (Cat Food Nutrient Profiles)
 *   - NRC 2006 (Nutrient Requirements of Dogs and Cats)
 *   - FEDIAF 2023 (Nutritional Guidelines for Complete Pet Food)
 *
 * Key cat-specific nutrients (obligate carnivore):
 *   - Taurine: REQUIRED — cats cannot synthesize (unlike dogs)
 *   - Arachidonic acid: REQUIRED — cats cannot elongate from linoleic
 *   - Vitamin A (retinol): REQUIRED — cats cannot convert beta-carotene
 *   - Niacin: REQUIRED — cats cannot convert tryptophan to niacin
 *   - Arginine: CRITICALLY REQUIRED — deficiency causes rapid hyperammonemia
 *   - Vitamin D: REQUIRED — cats cannot synthesize from sunlight adequately
 *   - Carnitine: conditionally essential
 */

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function round(v, d = 4) { const n = Number(v); if (!Number.isFinite(n)) return null; return Number(n.toFixed(d)); }

const AAFCO_2024 = {
  adult_maintenance: {
    label: "Cat — Adult Maintenance (AAFCO 2024)",
    standard: "AAFCO_2024", life_stage: "adult_maintenance",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 26.0,               // cats have high protein requirement
      arg: 1.04,                  // CRITICAL — deficiency = hyperammonemia
      his: 0.31, ile: 0.52, leu: 1.25, lys: 0.83,
      met: 0.62, met_cys: 1.10,
      phe: 0.42, phe_tyr: 1.53,  // tyr conditionally essential in cats
      thr: 0.73, trp: 0.16, val: 0.62,
      taurine_min: 0.10,          // % DM — REQUIRED in cats
    },
    fat: {
      ee_min: 9.0,
      linoleic_min: 0.60,         // n-6
      arachidonic_min: 0.02,      // REQUIRED — cats cannot synthesize
      epa_dha_min: null,
      alpha_linolenic_min: null,
    },
    minerals: {
      ca_min: 0.60, ca_max: null,
      p_min: 0.50, p_max: null,
      ca_p_ratio_min: 0.9, ca_p_ratio_max: null,
      k_min: 0.60,                // cats have high K requirement
      na_min: 0.20,
      cl_min: 0.30,
      mg_min: 0.04, mg_max: 0.10, // limit Mg for struvite crystal prevention
      fe_min: 80,
      cu_min: 5.0,
      mn_min: 1.5,
      zn_min: 75,
      i_min: 0.60,
      se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 6668,            // IU/kg — REQUIRED as retinol (no beta-carotene)
      vit_a_max: 333300,
      vit_d_min: 280, vit_d_max: 30080,
      vit_e_min: 40,
      vit_k_min: 0.10,            // mg/kg — cats may need dietary source
      vit_b1_min: 5.6,            // cats have high thiamine requirement
      vit_b2_min: 4.0,
      vit_b6_min: 4.0,            // high requirement
      vit_b12_min: 0.020,
      niacin_min: 60,             // VERY HIGH — cats cannot convert trp to niacin
      pantothenic_min: 5.75,
      folic_min: 0.80,
      biotin_min: 0.070,
      choline_min: 2550,
    },
  },

  growth_reproduction: {
    label: "Cat — Growth & Reproduction (AAFCO 2024)",
    standard: "AAFCO_2024", life_stage: "growth_reproduction",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 30.0,
      arg: 1.25, his: 0.33, ile: 0.56, leu: 1.28, lys: 1.20,
      met: 0.62, met_cys: 1.10,
      phe: 0.42, phe_tyr: 1.53,
      thr: 0.73, trp: 0.16, val: 0.62,
      taurine_min: 0.10,
    },
    fat: {
      ee_min: 9.0,
      linoleic_min: 0.60,
      arachidonic_min: 0.02,
      epa_dha_min: 0.01,          // DHA for kitten brain development
      alpha_linolenic_min: null,
    },
    minerals: {
      ca_min: 1.00, p_min: 0.80,
      ca_p_ratio_min: 0.9,
      k_min: 0.60, na_min: 0.20, cl_min: 0.30,
      mg_min: 0.04, mg_max: 0.10,
      fe_min: 80, cu_min: 5.0, mn_min: 1.5, zn_min: 75,
      i_min: 0.60, se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 6668, vit_a_max: 333300,
      vit_d_min: 280, vit_d_max: 30080,
      vit_e_min: 40, vit_k_min: 0.10,
      vit_b1_min: 5.6, vit_b2_min: 4.0, vit_b6_min: 4.0,
      vit_b12_min: 0.020, niacin_min: 60, pantothenic_min: 5.75,
      folic_min: 0.80, biotin_min: 0.070, choline_min: 2550,
    },
  },
};

const NRC_2006 = {
  adult_maintenance: {
    label: "Cat — Adult Maintenance (NRC 2006 RA)",
    standard: "NRC_2006", life_stage: "adult_maintenance",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 26.0,
      arg: 1.04, his: 0.33, ile: 0.54, leu: 1.28, lys: 0.73,
      met: 0.62, met_cys: 1.10,
      phe: 0.42, phe_tyr: 1.53,
      thr: 0.73, trp: 0.16, val: 0.64,
      taurine_min: 0.10,
    },
    fat: {
      ee_min: 9.0, linoleic_min: 0.55,
      arachidonic_min: 0.02, epa_dha_min: 0.01,
      alpha_linolenic_min: 0.02,
    },
    minerals: {
      ca_min: 0.72, p_min: 0.64,
      ca_p_ratio_min: 0.9,
      k_min: 0.52, na_min: 0.17, cl_min: 0.24,
      mg_min: 0.04, mg_max: 0.10,
      fe_min: 80, cu_min: 5.0, mn_min: 1.2, zn_min: 74.7,
      i_min: 0.46, se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 3332, vit_a_max: 333300,
      vit_d_min: 280, vit_d_max: 30080,
      vit_e_min: 38, vit_k_min: 0.10,
      vit_b1_min: 5.6, vit_b2_min: 4.0, vit_b6_min: 4.0,
      vit_b12_min: 0.020, niacin_min: 40, pantothenic_min: 5.75,
      folic_min: 0.80, biotin_min: 0.070, choline_min: 2550,
    },
  },
  growth: {
    label: "Cat — Growth/Kitten (NRC 2006 RA)",
    standard: "NRC_2006", life_stage: "growth",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 30.0,
      arg: 1.25, his: 0.33, ile: 0.54, leu: 1.28, lys: 1.20,
      met: 0.62, met_cys: 1.10,
      phe: 0.42, phe_tyr: 1.53,
      thr: 0.73, trp: 0.17, val: 0.64,
      taurine_min: 0.10,
    },
    fat: {
      ee_min: 9.0, linoleic_min: 0.55,
      arachidonic_min: 0.02, epa_dha_min: 0.025,
      alpha_linolenic_min: 0.02,
    },
    minerals: {
      ca_min: 1.00, p_min: 0.80,
      ca_p_ratio_min: 0.9,
      k_min: 0.52, na_min: 0.17, cl_min: 0.24,
      mg_min: 0.04, mg_max: 0.10,
      fe_min: 80, cu_min: 5.0, mn_min: 1.2, zn_min: 74.7,
      i_min: 0.46, se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 6668, vit_a_max: 333300,
      vit_d_min: 280, vit_d_max: 30080,
      vit_e_min: 38, vit_k_min: 0.10,
      vit_b1_min: 5.6, vit_b2_min: 4.0, vit_b6_min: 4.0,
      vit_b12_min: 0.020, niacin_min: 40, pantothenic_min: 5.75,
      folic_min: 0.80, biotin_min: 0.070, choline_min: 2550,
    },
  },
};

const FEDIAF_2023 = {
  adult_maintenance: {
    label: "Cat — Adult Maintenance (FEDIAF 2023)",
    standard: "FEDIAF_2023", life_stage: "adult_maintenance",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 25.0,
      arg: 1.04, his: 0.31, ile: 0.52, leu: 1.25, lys: 0.83,
      met: 0.62, met_cys: 1.10, phe: 0.42, phe_tyr: 1.53,
      thr: 0.73, trp: 0.16, val: 0.62, taurine_min: 0.10,
    },
    fat: {
      ee_min: 9.0, linoleic_min: 0.50,
      arachidonic_min: 0.02, epa_dha_min: 0.01,
      alpha_linolenic_min: 0.02,
    },
    minerals: {
      ca_min: 0.50, p_min: 0.40, ca_p_ratio_min: 0.9,
      k_min: 0.60, na_min: 0.20, cl_min: 0.30,
      mg_min: 0.04, mg_max: 0.10,
      fe_min: 80, cu_min: 5.0, mn_min: 1.5, zn_min: 75,
      i_min: 0.60, se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 6668, vit_d_min: 280, vit_e_min: 40, vit_k_min: 0.10,
      vit_b1_min: 5.6, vit_b2_min: 4.0, vit_b6_min: 4.0,
      vit_b12_min: 0.020, niacin_min: 60, pantothenic_min: 5.75,
      folic_min: 0.80, biotin_min: 0.070, choline_min: 2550,
    },
  },
  growth_reproduction: {
    label: "Cat — Growth & Reproduction (FEDIAF 2023)",
    standard: "FEDIAF_2023", life_stage: "growth_reproduction",
    energy: { me_cat_kcal_kg: 3500 },
    protein: {
      cp_min: 30.0,
      arg: 1.25, his: 0.33, ile: 0.56, leu: 1.28, lys: 1.20,
      met: 0.62, met_cys: 1.10, phe: 0.42, phe_tyr: 1.53,
      thr: 0.73, trp: 0.16, val: 0.62, taurine_min: 0.10,
    },
    fat: {
      ee_min: 9.0, linoleic_min: 0.50,
      arachidonic_min: 0.02, epa_dha_min: 0.01,
    },
    minerals: {
      ca_min: 1.00, p_min: 0.80, ca_p_ratio_min: 0.9,
      k_min: 0.60, na_min: 0.20, cl_min: 0.30,
      mg_min: 0.04, mg_max: 0.10,
      fe_min: 80, cu_min: 5.0, mn_min: 1.5, zn_min: 75,
      i_min: 0.60, se_min: 0.10,
    },
    vitamins: {
      vit_a_min: 6668, vit_d_min: 280, vit_e_min: 40, vit_k_min: 0.10,
      vit_b1_min: 5.6, vit_b2_min: 4.0, vit_b6_min: 4.0,
      vit_b12_min: 0.020, niacin_min: 60, pantothenic_min: 5.75,
      folic_min: 0.80, biotin_min: 0.070, choline_min: 2550,
    },
  },
};

function resolveLifeStage(production, phase) {
  const ph = String(phase || production || '').toLowerCase();
  if (ph.includes('kitten') || ph.includes('growth') || ph.includes('juvenile') || ph.includes('puppy')) return 'growth';
  if (ph.includes('gestation') || ph.includes('lactation') || ph.includes('pregnant') || ph.includes('nursing')) return 'growth';
  return 'adult_maintenance';
}

function resolveStandard(mode) {
  const m = String(mode || 'aafco_2024').toLowerCase();
  if (m.includes('nrc')) return 'NRC_2006';
  if (m.includes('fediaf')) return 'FEDIAF_2023';
  return 'AAFCO_2024';
}

function flattenCat(table, standard) {
  if (!table) return { ok: false, error: 'LIFE_STAGE_NOT_FOUND' };
  return {
    ok: true, mode: 'static', standard,
    species: 'cat', label: table.label,
    me_cat_kcal_kg: table.energy?.me_cat_kcal_kg ?? null,
    cp: table.protein?.cp_min ?? null,
    arg: table.protein?.arg ?? null, his: table.protein?.his ?? null,
    ile: table.protein?.ile ?? null, leu: table.protein?.leu ?? null,
    lys: table.protein?.lys ?? null, met: table.protein?.met ?? null,
    met_cys: table.protein?.met_cys ?? null,
    thr: table.protein?.thr ?? null, trp: table.protein?.trp ?? null,
    val: table.protein?.val ?? null,
    taurine: table.protein?.taurine_min ?? null,
    ee: table.fat?.ee_min ?? null,
    linoleic: table.fat?.linoleic_min ?? null,
    arachidonic_acid: table.fat?.arachidonic_min ?? null,
    epa_dha: table.fat?.epa_dha_min ?? null,
    ca: table.minerals?.ca_min ?? null,
    total_p: table.minerals?.p_min ?? null,
    k: table.minerals?.k_min ?? null,
    na: table.minerals?.na_min ?? null,
    cl: table.minerals?.cl_min ?? null,
    mg: table.minerals?.mg_min ?? null,
    fe_ppm: table.minerals?.fe_min ?? null,
    cu_ppm: table.minerals?.cu_min ?? null,
    mn_ppm: table.minerals?.mn_min ?? null,
    zn_ppm: table.minerals?.zn_min ?? null,
    i_ppm: table.minerals?.i_min ?? null,
    se_ppm: table.minerals?.se_min ?? null,
    vit_a: table.vitamins?.vit_a_min ?? null,
    vit_d: table.vitamins?.vit_d_min ?? null,
    vit_e: table.vitamins?.vit_e_min ?? null,
    vit_k: table.vitamins?.vit_k_min ?? null,
    niacin: table.vitamins?.niacin_min ?? null,
    pantothenic_acid: table.vitamins?.pantothenic_min ?? null,
    folic_acid: table.vitamins?.folic_min ?? null,
    choline: table.vitamins?.choline_min ?? null,
    cat_notes: "Obligate carnivore — taurine, arachidonic acid, vitamin A (retinol), niacin, and arginine are critically required",
  };
}

function resolveCatRequirements(context = {}) {
  try {
    const standard = resolveStandard(context.requirements_mode || context.mode);
    const lifeStage = resolveLifeStage(context.production, context.phase);

    let table;
    if (standard === 'NRC_2006') {
      table = NRC_2006[lifeStage] || NRC_2006.adult_maintenance;
    } else if (standard === 'FEDIAF_2023') {
      const key = lifeStage === 'adult_maintenance' ? 'adult_maintenance' : 'growth_reproduction';
      table = FEDIAF_2023[key] || FEDIAF_2023.adult_maintenance;
    } else {
      const key = lifeStage === 'adult_maintenance' ? 'adult_maintenance' : 'growth_reproduction';
      table = AAFCO_2024[key] || AAFCO_2024.adult_maintenance;
    }

    return flattenCat(table, standard);
  } catch (e) {
    return { ok: false, error: 'CAT_ENGINE_ERROR', message: e.message };
  }
}

const STATIC_REQUIREMENTS = {
  adult_maintenance: {
    label: "Cat — Adult Maintenance (AAFCO 2024)",
    production: "adult_maintenance", phase: "adult_maintenance",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 26.0, arg: 1.04, his: 0.31, ile: 0.52, leu: 1.25, lys: 0.83, met: 0.62, met_cys: 1.10, phe: 0.42, thr: 0.73, trp: 0.16, val: 0.62, taurine_pct: 0.10 },
    fat: { ee_pct: 9.0, linoleic_pct: 0.60, arachidonic_pct: 0.02 },
    minerals: { ca_pct: 0.60, p_pct: 0.50, k_pct: 0.60, na_pct: 0.20, cl_pct: 0.30, mg_pct: 0.04, fe_mg_kg: 80, cu_mg_kg: 5.0, mn_mg_kg: 1.5, zn_mg_kg: 75, i_mg_kg: 0.60, se_mg_kg: 0.10 },
    vitamins: { vit_a_iu_kg: 6668, vit_d_iu_kg: 280, vit_e_iu_kg: 40, vit_b1_mg_kg: 5.6, vit_b2_mg_kg: 4.0, vit_b6_mg_kg: 4.0, niacin_mg_kg: 60, choline_mg_kg: 2550 },
    notes: "Obligate carnivore. Taurine, arachidonic acid, preformed vitamin A, and niacin are critically required from animal sources.",
  },
  growth: {
    label: "Cat — Growth / Kitten (AAFCO 2024)",
    production: "growth", phase: "kitten",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 30.0, arg: 1.25, his: 0.33, ile: 0.56, leu: 1.28, lys: 1.20, met: 0.62, met_cys: 1.10, phe: 0.42, thr: 0.73, trp: 0.16, val: 0.62, taurine_pct: 0.10 },
    fat: { ee_pct: 9.0, linoleic_pct: 0.60, arachidonic_pct: 0.02, epa_dha_pct: 0.01 },
    minerals: { ca_pct: 1.00, p_pct: 0.80, k_pct: 0.60, na_pct: 0.20, cl_pct: 0.30, mg_pct: 0.04, fe_mg_kg: 80, cu_mg_kg: 5.0, mn_mg_kg: 1.5, zn_mg_kg: 75, i_mg_kg: 0.60, se_mg_kg: 0.10 },
    vitamins: { vit_a_iu_kg: 6668, vit_d_iu_kg: 280, vit_e_iu_kg: 40, vit_b1_mg_kg: 5.6, vit_b2_mg_kg: 4.0, vit_b6_mg_kg: 4.0, niacin_mg_kg: 60, choline_mg_kg: 2550 },
    notes: "DHA required for kitten brain and retinal development. Higher Ca/P and protein vs adult.",
  },
  gestation_lactation: {
    label: "Cat — Gestation & Lactation (AAFCO 2024)",
    production: "gestation_lactation", phase: "gestation_lactation",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 30.0, arg: 1.25, lys: 1.20, met_cys: 1.10, taurine_pct: 0.10 },
    fat: { ee_pct: 9.0, linoleic_pct: 0.60, arachidonic_pct: 0.02, epa_dha_pct: 0.01 },
    minerals: { ca_pct: 1.00, p_pct: 0.80, k_pct: 0.60, na_pct: 0.20, mg_pct: 0.04, fe_mg_kg: 80, cu_mg_kg: 5.0, zn_mg_kg: 75, se_mg_kg: 0.10 },
    vitamins: { vit_a_iu_kg: 6668, vit_d_iu_kg: 280, vit_e_iu_kg: 40, niacin_mg_kg: 60, choline_mg_kg: 2550 },
    notes: "Same profile as growth/kitten. Queen energy demand doubles during peak lactation.",
  },
  senior: {
    label: "Cat — Senior / Mature (>10 years, AAFCO 2024 + NRC 2006)",
    production: "senior", phase: "senior",
    energy: { me_kcal_kg: 3200 },
    protein: { cp_pct: 30.0, arg: 1.04, his: 0.31, ile: 0.52, leu: 1.25, lys: 0.83, met: 0.62, met_cys: 1.10, taurine_pct: 0.10 },
    fat: { ee_pct: 9.0, linoleic_pct: 0.60, arachidonic_pct: 0.02, epa_dha_pct: 0.03 },
    minerals: { ca_pct: 0.60, p_pct: 0.50, k_pct: 0.60, na_pct: 0.20, cl_pct: 0.30, mg_pct: 0.04, fe_mg_kg: 80, cu_mg_kg: 5.0, mn_mg_kg: 1.5, zn_mg_kg: 75, i_mg_kg: 0.60, se_mg_kg: 0.10 },
    vitamins: { vit_a_iu_kg: 6668, vit_d_iu_kg: 280, vit_e_iu_kg: 40, vit_b1_mg_kg: 5.6, vit_b2_mg_kg: 4.0, vit_b6_mg_kg: 4.0, niacin_mg_kg: 60, choline_mg_kg: 2550 },
    notes: "Maintain high protein (≥30% DM) to offset muscle wasting. Senior cats often have reduced digestive efficiency. Increase EPA+DHA for joint and cognitive support. Monitor phosphorus for kidney disease risk.",
  },
};

module.exports = { resolveCatRequirements, STATIC_REQUIREMENTS, AAFCO_2024, NRC_2006, FEDIAF_2023 };
