"use strict";
/**
 * Dog (Canis lupus familiaris) Requirements Engine
 * Standards supported:
 *   - AAFCO 2024 (Dog Food Nutrient Profiles) — US regulatory standard
 *   - NRC 2006 (Nutrient Requirements of Dogs and Cats) — scientific standard
 *   - FEDIAF 2023 (Nutritional Guidelines for Complete Pet Food) — European standard
 *
 * Life stages:
 *   puppy_early    — 0-4 weeks (neonatal/nursing)
 *   puppy          — 4-14 weeks (weaning to juvenile)
 *   puppy_juvenile — 14 weeks to adult (growth)
 *   adult          — adult maintenance
 *   adult_active   — working/active dogs
 *   senior         — >7 years
 *   gestation      — pregnant females
 *   lactation      — nursing females
 *
 * Energy system: ME (kcal/kg DM) — AAFCO/NRC standard for companion animals
 *
 * Key dog-specific nutrients:
 *   - Taurine: not required (dogs can synthesize) but recent DCM research adds interest
 *   - Carnitine: conditionally essential
 *   - Arachidonic acid: not required (dogs can elongate linoleic acid)
 *   - Vitamin C: not required (dogs synthesize)
 */

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function round(v, d = 4) { const n = Number(v); if (!Number.isFinite(n)) return null; return Number(n.toFixed(d)); }

// ═══════════════════════════════════════════════════════════════════════════
// AAFCO 2024 PROFILES
// All values % DM unless noted as mg/kg or IU/kg
// ═══════════════════════════════════════════════════════════════════════════
const AAFCO_2024 = {
  adult_maintenance: {
    label: "Dog — Adult Maintenance (AAFCO 2024)",
    standard: "AAFCO_2024", life_stage: "adult_maintenance",
    energy: { me_kcal_kg: 3500 },  // typical complete dry food
    protein: {
      cp_min: 18.0,                 // % DM minimum
      // Essential amino acids % DM
      arg: 0.51, his: 0.19, ile: 0.38, leu: 0.68, lys: 0.63,
      met: 0.33, met_cys: 0.65, phe: 0.45, phe_tyr: 0.74,
      thr: 0.48, trp: 0.16, val: 0.49,
    },
    fat: {
      ee_min: 5.5,                  // % DM minimum
      linoleic_min: 1.1,            // % DM (n-6)
      epa_dha_min: null,            // no minimum set by AAFCO for adult
      alpha_linolenic_min: null,
    },
    minerals: {
      ca_min: 0.50, ca_max: 2.50,
      p_min: 0.40, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 2.0,
      k_min: 0.40,
      na_min: 0.08,
      cl_min: 0.09,
      mg_min: 0.06,
      fe_min: 40,      // mg/kg
      cu_min: 7.3,     // mg/kg
      mn_min: 1.25,    // mg/kg
      zn_min: 100,     // mg/kg
      i_min: 1.0,      // mg/kg  i_max: 11
      se_min: 0.11,    // mg/kg  se_max: 2.0
    },
    vitamins: {
      vit_a_min: 5000,    // IU/kg   vit_a_max: 250000
      vit_d_min: 500,     // IU/kg   vit_d_max: 3000
      vit_e_min: 50,      // IU/kg
      vit_k_min: null,    // no minimum — dogs synthesize
      vit_b1_min: 1.0,    // mg/kg
      vit_b2_min: 2.2,    // mg/kg
      vit_b6_min: 1.5,    // mg/kg
      vit_b12_min: 0.028, // mg/kg
      niacin_min: 13.6,   // mg/kg
      pantothenic_min: 4.0, // mg/kg
      folic_min: 0.18,    // mg/kg
      biotin_min: null,   // no minimum
      choline_min: 1360,  // mg/kg
    },
  },

  growth_reproduction: {
    label: "Dog — Growth & Reproduction (AAFCO 2024)",
    standard: "AAFCO_2024", life_stage: "growth_reproduction",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 22.5,
      arg: 0.62, his: 0.19, ile: 0.45, leu: 0.72, lys: 0.77,
      met: 0.35, met_cys: 0.70, phe: 0.45, phe_tyr: 0.74,
      thr: 0.54, trp: 0.20, val: 0.56,
    },
    fat: {
      ee_min: 8.5,
      linoleic_min: 1.3,
      epa_dha_min: 0.05,          // updated AAFCO 2024 — DHA for brain development
      alpha_linolenic_min: null,
    },
    minerals: {
      ca_min: 1.20, ca_max: 1.80,  // tighter range for large breeds
      p_min: 1.00, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 1.8,
      k_min: 0.44,
      na_min: 0.22,
      cl_min: 0.22,
      mg_min: 0.06,
      fe_min: 88,
      cu_min: 12.4,
      mn_min: 1.25,
      zn_min: 100,
      i_min: 1.0,
      se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000,
      vit_d_min: 500,
      vit_e_min: 50,
      vit_b1_min: 1.0,
      vit_b2_min: 2.2,
      vit_b6_min: 1.5,
      vit_b12_min: 0.028,
      niacin_min: 13.6,
      pantothenic_min: 4.0,
      folic_min: 0.18,
      choline_min: 1360,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// NRC 2006 PROFILES
// ═══════════════════════════════════════════════════════════════════════════
const NRC_2006 = {
  adult_maintenance: {
    label: "Dog — Adult Maintenance (NRC 2006 RA)",
    standard: "NRC_2006", life_stage: "adult_maintenance",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 20.0,               // NRC RA slightly higher than AAFCO min
      arg: 0.48, his: 0.20, ile: 0.38, leu: 0.68, lys: 0.63,
      met: 0.41, met_cys: 0.74, phe: 0.45, phe_tyr: 0.89,
      thr: 0.56, trp: 0.20, val: 0.49,
    },
    fat: {
      ee_min: 5.5,
      linoleic_min: 1.1,
      epa_dha_min: 0.11,          // NRC 2006 recommends EPA+DHA for adult
      alpha_linolenic_min: 0.44,
    },
    minerals: {
      ca_min: 0.60, ca_max: 2.50,
      p_min: 0.50, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 2.0,
      k_min: 0.44,
      na_min: 0.08,
      cl_min: 0.09,
      mg_min: 0.08,
      fe_min: 30,
      cu_min: 7.3,
      mn_min: 1.2,
      zn_min: 60,
      i_min: 0.88,
      se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000, vit_a_max: 250000,
      vit_d_min: 500, vit_d_max: 3000,
      vit_e_min: 30,
      vit_b1_min: 1.0, vit_b2_min: 2.2, vit_b6_min: 1.5,
      vit_b12_min: 0.028, niacin_min: 11.4, pantothenic_min: 4.0,
      folic_min: 0.18, choline_min: 1360,
      // Taurine — not required but NRC 2006 notes importance
      taurine_note: "Not required — dogs synthesize from methionine/cysteine. Monitor in grain-free diets (DCM concern).",
    },
  },

  growth: {
    label: "Dog — Growth/Puppy (NRC 2006 RA)",
    standard: "NRC_2006", life_stage: "growth",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 22.0,               // NRC RA for growth
      // Puppy 14 weeks+
      arg: 0.62, his: 0.22, ile: 0.47, leu: 0.84, lys: 0.77,
      met: 0.45, met_cys: 0.82, phe: 0.53, phe_tyr: 0.89,
      thr: 0.60, trp: 0.21, val: 0.56,
    },
    fat: {
      ee_min: 8.5,
      linoleic_min: 1.3,
      epa_dha_min: 0.13,          // DHA critical for brain/retinal development
      alpha_linolenic_min: 0.44,
      arachidonic_min: null,       // dogs elongate from linoleic
    },
    minerals: {
      ca_min: 1.20, ca_max: 1.80,
      p_min: 1.00, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 1.8,
      k_min: 0.44, na_min: 0.22, cl_min: 0.22, mg_min: 0.10,
      fe_min: 88, cu_min: 12.4, mn_min: 1.4, zn_min: 100,
      i_min: 1.0, se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000, vit_d_min: 500, vit_e_min: 50,
      vit_b1_min: 1.0, vit_b2_min: 2.2, vit_b6_min: 1.5,
      vit_b12_min: 0.028, niacin_min: 11.4, pantothenic_min: 4.0,
      folic_min: 0.18, choline_min: 1360,
    },
  },

  gestation_lactation: {
    label: "Dog — Gestation/Lactation (NRC 2006 RA)",
    standard: "NRC_2006", life_stage: "gestation_lactation",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 22.0,
      arg: 0.89, his: 0.22, ile: 0.59, leu: 1.18, lys: 0.93,
      met: 0.51, met_cys: 0.93, phe: 0.64, phe_tyr: 1.06,
      thr: 0.73, trp: 0.25, val: 0.70,
    },
    fat: {
      ee_min: 8.5, linoleic_min: 1.3,
      epa_dha_min: 0.13, alpha_linolenic_min: 0.44,
    },
    minerals: {
      ca_min: 1.20, ca_max: 1.80, p_min: 1.00, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 1.8,
      k_min: 0.44, na_min: 0.22, cl_min: 0.22, mg_min: 0.10,
      fe_min: 88, cu_min: 12.4, mn_min: 1.4, zn_min: 100,
      i_min: 1.0, se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000, vit_d_min: 500, vit_e_min: 50,
      vit_b1_min: 1.0, vit_b2_min: 2.2, vit_b6_min: 1.5,
      vit_b12_min: 0.028, niacin_min: 11.4, pantothenic_min: 4.0,
      folic_min: 0.18, choline_min: 1360,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FEDIAF 2023 PROFILES
// ═══════════════════════════════════════════════════════════════════════════
const FEDIAF_2023 = {
  adult_maintenance: {
    label: "Dog — Adult Maintenance (FEDIAF 2023)",
    standard: "FEDIAF_2023", life_stage: "adult_maintenance",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 18.0,
      arg: 0.48, his: 0.19, ile: 0.38, leu: 0.68, lys: 0.63,
      met: 0.33, met_cys: 0.65, phe: 0.45, phe_tyr: 0.74,
      thr: 0.48, trp: 0.16, val: 0.49,
    },
    fat: {
      ee_min: 5.0, linoleic_min: 1.0,
      epa_dha_min: 0.1,           // FEDIAF sets EPA+DHA recommendation
      alpha_linolenic_min: 0.2,
    },
    minerals: {
      ca_min: 0.50, ca_max: 2.50, p_min: 0.40, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 2.0,
      k_min: 0.40, na_min: 0.08, cl_min: 0.09, mg_min: 0.06,
      fe_min: 40, cu_min: 7.3, mn_min: 1.0, zn_min: 75,
      i_min: 0.75, se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000, vit_d_min: 500, vit_e_min: 50,
      vit_b1_min: 1.0, vit_b2_min: 2.2, vit_b6_min: 1.5,
      vit_b12_min: 0.028, niacin_min: 13.6, pantothenic_min: 4.0,
      folic_min: 0.18, choline_min: 1360,
    },
  },
  growth_reproduction: {
    label: "Dog — Growth & Reproduction (FEDIAF 2023)",
    standard: "FEDIAF_2023", life_stage: "growth_reproduction",
    energy: { me_kcal_kg: 3500 },
    protein: {
      cp_min: 22.5,
      arg: 0.62, his: 0.19, ile: 0.45, leu: 0.72, lys: 0.77,
      met: 0.35, met_cys: 0.70, phe: 0.45, phe_tyr: 0.74,
      thr: 0.54, trp: 0.20, val: 0.56,
    },
    fat: {
      ee_min: 8.5, linoleic_min: 1.3,
      epa_dha_min: 0.1, alpha_linolenic_min: 0.2,
    },
    minerals: {
      ca_min: 1.0, ca_max: 1.8, p_min: 0.80, p_max: 1.60,
      ca_p_ratio_min: 1.0, ca_p_ratio_max: 1.8,
      k_min: 0.44, na_min: 0.22, cl_min: 0.22, mg_min: 0.06,
      fe_min: 88, cu_min: 12.4, mn_min: 1.0, zn_min: 75,
      i_min: 0.75, se_min: 0.11,
    },
    vitamins: {
      vit_a_min: 5000, vit_d_min: 500, vit_e_min: 50,
      vit_b1_min: 1.0, vit_b2_min: 2.2, vit_b6_min: 1.5,
      vit_b12_min: 0.028, niacin_min: 13.6, pantothenic_min: 4.0,
      folic_min: 0.18, choline_min: 1360,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE / LIFE STAGE MAPPING
// ═══════════════════════════════════════════════════════════════════════════
function resolveLifeStage(production, phase) {
  const pr = String(production || '').toLowerCase();
  const ph = String(phase || '').toLowerCase();
  const combined = `${pr}_${ph}`;

  if (ph.includes('puppy') || ph.includes('growth') || ph.includes('juvenile') || pr === 'puppy') return 'growth_reproduction';
  if (ph.includes('gestation') || ph.includes('lactation') || ph.includes('pregnant') || ph.includes('nursing')) return 'gestation_lactation';
  if (ph.includes('senior') || ph.includes('geriatric')) return 'adult_maintenance';
  if (ph.includes('active') || ph.includes('working') || ph.includes('performance')) return 'adult_maintenance';
  return 'adult_maintenance';
}

function resolveStandard(requirements_mode) {
  const mode = String(requirements_mode || 'aafco_2024').toLowerCase();
  if (mode.includes('nrc')) return 'NRC_2006';
  if (mode.includes('fediaf')) return 'FEDIAF_2023';
  return 'AAFCO_2024';
}

function flattenDog(table, standard) {
  if (!table) return { ok: false, error: 'LIFE_STAGE_NOT_FOUND' };
  return {
    ok: true, mode: 'static', standard,
    species: 'dog', label: table.label,
    me_dog_kcal_kg: table.energy?.me_kcal_kg ?? null,
    // Protein
    cp: table.protein?.cp_min ?? null,
    arg: table.protein?.arg ?? null, his: table.protein?.his ?? null,
    ile: table.protein?.ile ?? null, leu: table.protein?.leu ?? null,
    lys: table.protein?.lys ?? null, met: table.protein?.met ?? null,
    met_cys: table.protein?.met_cys ?? null, phe: table.protein?.phe ?? null,
    thr: table.protein?.thr ?? null, trp: table.protein?.trp ?? null,
    val: table.protein?.val ?? null,
    // Fat
    ee: table.fat?.ee_min ?? null,
    linoleic: table.fat?.linoleic_min ?? null,
    epa_dha: table.fat?.epa_dha_min ?? null,
    linolenic: table.fat?.alpha_linolenic_min ?? null,
    // Minerals
    ca: table.minerals?.ca_min ?? null,
    ca_max: table.minerals?.ca_max ?? null,
    total_p: table.minerals?.p_min ?? null,
    p_max: table.minerals?.p_max ?? null,
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
    // Vitamins
    vit_a: table.vitamins?.vit_a_min ?? null,
    vit_d: table.vitamins?.vit_d_min ?? null,
    vit_e: table.vitamins?.vit_e_min ?? null,
    niacin: table.vitamins?.niacin_min ?? null,
    pantothenic_acid: table.vitamins?.pantothenic_min ?? null,
    folic_acid: table.vitamins?.folic_min ?? null,
    choline: table.vitamins?.choline_min ?? null,
    taurine_note: table.vitamins?.taurine_note ?? null,
  };
}

function resolveDogRequirements(context = {}) {
  try {
    const standard = resolveStandard(context.requirements_mode || context.mode);
    const lifeStage = resolveLifeStage(context.production, context.phase);
    const breed = String(context.breed || 'generic').toLowerCase();
    const isLargeBreed = breed === 'large' || breed.includes('large');
    const isPuppy = lifeStage === 'growth_reproduction';

    let table;
    if (standard === 'NRC_2006') {
      table = NRC_2006[lifeStage] || NRC_2006.adult_maintenance;
    } else if (standard === 'FEDIAF_2023') {
      const fediafKey = lifeStage === 'adult_maintenance' ? 'adult_maintenance' : 'growth_reproduction';
      table = FEDIAF_2023[fediafKey] || FEDIAF_2023.adult_maintenance;
    } else {
      const aafcoKey = lifeStage === 'adult_maintenance' ? 'adult_maintenance' : 'growth_reproduction';
      table = AAFCO_2024[aafcoKey] || AAFCO_2024.adult_maintenance;
    }

    const result = flattenDog(table, standard);

    // Large breed puppy Ca/P adjustment — CRITICAL
    // Large breeds prone to osteochondrosis if Ca too high during growth
   if (isPuppy && isLargeBreed) {
      result.ca = 0.95;          // min Ca for large breed puppy
      result.ca_max = 1.2;       // MAX Ca restricted vs 1.8 for small breeds
      result.total_p = 0.80;
      result.p_max = 1.20;
      result.ca_p_ratio_max = 1.6;
      result.me_dog_kcal_kg = 3200;  // lower energy for controlled growth
      result.large_breed_note = "Large breed puppy: Ca max 1.2% DM — prevents OCD/HOD (WSAVA 2021)";
      result.label = result.label + " — Large Breed";
    }

    return result;
  } catch (e) {
    return { ok: false, error: 'DOG_ENGINE_ERROR', message: e.message };
  }
}

const STATIC_REQUIREMENTS = {
  adult_maintenance: {
    label: "Dog — Adult Maintenance (AAFCO 2024)",
    production: "adult_maintenance", phase: "adult_maintenance",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 18.0, arg: 0.51, his: 0.19, ile: 0.38, leu: 0.68, lys: 0.63, met: 0.33, met_cys: 0.65, phe: 0.45, phe_tyr: 0.74, thr: 0.53, trp: 0.16, val: 0.49 },
    fat: { ee_pct: 5.5, linoleic_pct: 1.10, epa_dha_pct: 0.05 },
    minerals: { ca_pct: 0.50, p_pct: 0.40, ca_p_ratio_min: 1.0, ca_p_ratio_max: 2.0, k_pct: 0.40, na_pct: 0.08, cl_pct: 0.12, mg_pct: 0.06, fe_mg_kg: 40, cu_mg_kg: 7.3, mn_mg_kg: 1.25, zn_mg_kg: 80, i_mg_kg: 0.82, se_mg_kg: 0.35 },
    vitamins: { vit_a_iu_kg: 5000, vit_d_iu_kg: 125, vit_e_iu_kg: 50, vit_b1_mg_kg: 1.0, vit_b2_mg_kg: 2.2, vit_b6_mg_kg: 1.0, vit_b12_mg_kg: 0.022, niacin_mg_kg: 13.6, choline_mg_kg: 1360 },
  },
  growth_puppy: {
    label: "Dog — Growth / Puppy (AAFCO 2024)",
    production: "growth", phase: "puppy",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 22.5, arg: 0.56, his: 0.22, ile: 0.45, leu: 0.72, lys: 0.88, met: 0.35, met_cys: 0.70, phe: 0.45, phe_tyr: 0.83, thr: 0.63, trp: 0.20, val: 0.55 },
    fat: { ee_pct: 8.5, linoleic_pct: 1.30, epa_dha_pct: 0.05 },
    minerals: { ca_pct: 1.20, p_pct: 1.00, ca_p_ratio_min: 1.0, ca_p_ratio_max: 1.8, k_pct: 0.40, na_pct: 0.30, cl_pct: 0.45, mg_pct: 0.06, fe_mg_kg: 40, cu_mg_kg: 7.3, mn_mg_kg: 1.25, zn_mg_kg: 80, i_mg_kg: 0.82, se_mg_kg: 0.35 },
    vitamins: { vit_a_iu_kg: 5000, vit_d_iu_kg: 125, vit_e_iu_kg: 50, vit_b1_mg_kg: 1.0, vit_b2_mg_kg: 2.2, vit_b6_mg_kg: 1.0, niacin_mg_kg: 13.6, choline_mg_kg: 1360 },
    notes: "Large and giant breed puppies need Ca:P ratio controlled to 1.0-1.5 to prevent developmental orthopedic disease.",
  },
  gestation_lactation: {
    label: "Dog — Gestation & Lactation (AAFCO 2024)",
    production: "gestation_lactation", phase: "gestation_lactation",
    energy: { me_kcal_kg: 3500 },
    protein: { cp_pct: 22.5, arg: 0.56, lys: 0.88, met_cys: 0.70, thr: 0.63 },
    fat: { ee_pct: 8.5, linoleic_pct: 1.30, epa_dha_pct: 0.05 },
    minerals: { ca_pct: 1.20, p_pct: 1.00, k_pct: 0.40, na_pct: 0.30, mg_pct: 0.06, fe_mg_kg: 40, cu_mg_kg: 7.3, zn_mg_kg: 80, se_mg_kg: 0.35 },
    vitamins: { vit_a_iu_kg: 5000, vit_d_iu_kg: 125, vit_e_iu_kg: 50, niacin_mg_kg: 13.6, choline_mg_kg: 1360 },
    notes: "Energy demand increases 25-50% in late gestation and up to 3× during peak lactation.",
  },
  senior: {
    label: "Dog — Senior (>7 years, AAFCO 2024)",
    production: "senior", phase: "senior",
    energy: { me_kcal_kg: 3200 },
    protein: { cp_pct: 18.0, lys: 0.63, met_cys: 0.65 },
    fat: { ee_pct: 5.5, linoleic_pct: 1.10 },
    minerals: { ca_pct: 0.50, p_pct: 0.40, na_pct: 0.08, k_pct: 0.40, mg_pct: 0.06, zn_mg_kg: 80, se_mg_kg: 0.35 },
    vitamins: { vit_a_iu_kg: 5000, vit_d_iu_kg: 125, vit_e_iu_kg: 50, niacin_mg_kg: 13.6 },
    notes: "Reduce energy density. Maintain protein to prevent muscle loss. Monitor Ca/P for renal health.",
  },
};

module.exports = { resolveDogRequirements, STATIC_REQUIREMENTS, AAFCO_2024, NRC_2006, FEDIAF_2023 };
