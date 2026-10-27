"use strict";
/**
 * Salmonid Requirements Engine — Atlantic Salmon & Rainbow Trout
 * Primary Source: NRC 2011 Nutrient Requirements of Fish and Shrimp
 * Updates: Bureau (Guelph) bioenergetic model, Glencross 2020, INRA 2021,
 *          peer-reviewed literature 2011-2024
 * Standard Label: "NRC 2011 + Literature 2011-2024"
 *
 * Species covered:
 *   atlantic_salmon — Salmo salar (coldwater, marine grow-out)
 *   rainbow_trout   — Oncorhynchus mykiss (coldwater, freshwater/sea)
 *
 * Energy system: Digestible Energy (DE, MJ/kg) — Bureau model
 * Protein system: Digestible Protein (DP, %) with digestible AA profile
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

const STATIC_REQUIREMENTS = {

  // ── ATLANTIC SALMON ───────────────────────────────────────────────────────
  salmon_fry: {
    label: "Atlantic Salmon — Fry (<10g)",
    species: "atlantic_salmon", production: "salmon", phase: "fry",
    bw_range_g: [0, 10],
    energy: { de_mj_kg: 19.5, de_kcal_kg: 4659 },
    protein: {
      dp_pct: 50, cp_pct: 55,
      // Digestible AA (% diet DM) — NRC 2011 updated with Espe 2012
      lys: 2.6, met: 1.6, met_cys: 2.2, thr: 2.0, arg: 2.8,
      ile: 2.0, leu: 3.2, val: 2.2, his: 1.0, trp: 0.5, phe: 2.0,
    },
    lipids: {
      total_lipid_pct: 18,
      epa_dha_pct: 2.0,        // Glencross 2020: critical for fry development
      epa_pct: 1.0, dha_pct: 1.2,
      n3_n6_ratio: 2.0,        // updated from literature
      linoleic_pct: 1.0,
    },
    minerals: {
      ca_pct: 0.5, p_pct: 0.9, avail_p_pct: 0.6,
      mg_pct: 0.05, k_pct: 0.80, na_pct: 0.30,
      fe_ppm: 60, zn_ppm: 30, mn_ppm: 12, cu_ppm: 5,
      se_ppm: 0.40, i_ppm: 1.0, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 5000, vit_d_iu_kg: 2400, vit_e_mg_kg: 300,
      vit_c_mg_kg: 200, vit_k_mg_kg: 10,
      vit_b1_mg_kg: 15, vit_b2_mg_kg: 20, vit_b6_mg_kg: 10,
      vit_b12_mg_kg: 0.02, niacin_mg_kg: 75, pantothenic_mg_kg: 50,
      folic_mg_kg: 5, biotin_mg_kg: 0.15, choline_mg_kg: 3000,
      inositol_mg_kg: 300,
    },
    feed_management: { fcr_target: 0.9, feeds_per_day: 8, feeding_rate_pct_bw: 3 },
  },

  salmon_smolt: {
    label: "Atlantic Salmon — Smolt (10-100g, freshwater)",
    species: "atlantic_salmon", production: "salmon", phase: "smolt",
    bw_range_g: [10, 100],
    energy: { de_mj_kg: 19.0, de_kcal_kg: 4541 },
    protein: {
      dp_pct: 46, cp_pct: 50,
      lys: 2.4, met: 1.5, met_cys: 2.0, thr: 1.8, arg: 2.5,
      ile: 1.8, leu: 3.0, val: 2.0, his: 0.9, trp: 0.5, phe: 1.8,
    },
    lipids: {
      total_lipid_pct: 20,
      epa_dha_pct: 1.8, epa_pct: 0.9, dha_pct: 1.1,
      n3_n6_ratio: 2.0, linoleic_pct: 1.2,
    },
    minerals: {
      ca_pct: 0.5, p_pct: 0.8, avail_p_pct: 0.55,
      mg_pct: 0.05, k_pct: 0.75, na_pct: 0.28,
      fe_ppm: 55, zn_ppm: 28, mn_ppm: 10, cu_ppm: 5,
      se_ppm: 0.35, i_ppm: 1.0, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 4000, vit_d_iu_kg: 2000, vit_e_mg_kg: 250,
      vit_c_mg_kg: 150, vit_k_mg_kg: 8,
      vit_b1_mg_kg: 12, vit_b2_mg_kg: 18, vit_b6_mg_kg: 8,
      vit_b12_mg_kg: 0.02, niacin_mg_kg: 60, pantothenic_mg_kg: 40,
      folic_mg_kg: 4, biotin_mg_kg: 0.12, choline_mg_kg: 2500,
      inositol_mg_kg: 250,
    },
    feed_management: { fcr_target: 1.0, feeds_per_day: 6, feeding_rate_pct_bw: 2 },
  },

  salmon_post_smolt: {
    label: "Atlantic Salmon — Post-Smolt (100g-1kg, early sea)",
    species: "atlantic_salmon", production: "salmon", phase: "post_smolt",
    bw_range_g: [100, 1000],
    energy: { de_mj_kg: 18.5, de_kcal_kg: 4422 },
    protein: {
      dp_pct: 42, cp_pct: 46,
      lys: 2.2, met: 1.4, met_cys: 1.9, thr: 1.7, arg: 2.3,
      ile: 1.7, leu: 2.8, val: 1.9, his: 0.8, trp: 0.4, phe: 1.7,
    },
    lipids: {
      total_lipid_pct: 22,
      epa_dha_pct: 1.5, epa_pct: 0.8, dha_pct: 1.0,
      n3_n6_ratio: 1.8, linoleic_pct: 1.5,
    },
    minerals: {
      ca_pct: 0.4, p_pct: 0.75, avail_p_pct: 0.50,
      mg_pct: 0.05, k_pct: 0.70, na_pct: 0.25,
      fe_ppm: 50, zn_ppm: 25, mn_ppm: 8, cu_ppm: 4,
      se_ppm: 0.30, i_ppm: 1.0, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 3500, vit_d_iu_kg: 1800, vit_e_mg_kg: 200,
      vit_c_mg_kg: 100, vit_k_mg_kg: 7,
      vit_b1_mg_kg: 10, vit_b2_mg_kg: 15, vit_b6_mg_kg: 7,
      vit_b12_mg_kg: 0.015, niacin_mg_kg: 50, pantothenic_mg_kg: 35,
      folic_mg_kg: 3, biotin_mg_kg: 0.10, choline_mg_kg: 2200,
      inositol_mg_kg: 200,
    },
    feed_management: { fcr_target: 1.1, feeds_per_day: 4, feeding_rate_pct_bw: 1.5 },
  },

  salmon_grow_out: {
    label: "Atlantic Salmon — Grow-out (1-4kg, sea cage)",
    species: "atlantic_salmon", production: "salmon", phase: "grow_out",
    bw_range_g: [1000, 4000],
    energy: { de_mj_kg: 17.5, de_kcal_kg: 4183 },
    protein: {
      dp_pct: 38, cp_pct: 42,
      lys: 2.0, met: 1.3, met_cys: 1.8, thr: 1.6, arg: 2.1,
      ile: 1.6, leu: 2.6, val: 1.8, his: 0.7, trp: 0.4, phe: 1.6,
    },
    lipids: {
      total_lipid_pct: 26,     // high energy diet for fast growth
      epa_dha_pct: 1.2,
      epa_pct: 0.6, dha_pct: 0.8,
      n3_n6_ratio: 1.5,
      linoleic_pct: 2.0,       // plant oil inclusion increasing
    },
    minerals: {
      ca_pct: 0.4, p_pct: 0.70, avail_p_pct: 0.45,
      mg_pct: 0.04, k_pct: 0.65, na_pct: 0.22,
      fe_ppm: 45, zn_ppm: 22, mn_ppm: 7, cu_ppm: 4,
      se_ppm: 0.28, i_ppm: 1.0, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 3000, vit_d_iu_kg: 1500, vit_e_mg_kg: 150,
      vit_c_mg_kg: 80, vit_k_mg_kg: 6,
      vit_b1_mg_kg: 8, vit_b2_mg_kg: 12, vit_b6_mg_kg: 6,
      vit_b12_mg_kg: 0.01, niacin_mg_kg: 40, pantothenic_mg_kg: 30,
      folic_mg_kg: 2.5, biotin_mg_kg: 0.08, choline_mg_kg: 2000,
      inositol_mg_kg: 150,
    },
    feed_management: { fcr_target: 1.15, feeds_per_day: 2, feeding_rate_pct_bw: 1.0 },
  },

  salmon_finishing: {
    label: "Atlantic Salmon — Finishing/Pre-harvest (4-6kg)",
    species: "atlantic_salmon", production: "salmon", phase: "finishing",
    bw_range_g: [4000, 6000],
    energy: { de_mj_kg: 16.5, de_kcal_kg: 3944 },
    protein: {
      dp_pct: 35, cp_pct: 38,
      lys: 1.8, met: 1.2, met_cys: 1.6, thr: 1.5, arg: 2.0,
      ile: 1.5, leu: 2.4, val: 1.7, his: 0.7, trp: 0.3, phe: 1.5,
    },
    lipids: {
      total_lipid_pct: 30,
      epa_dha_pct: 1.5,        // increased for fillet quality — Glencross 2024
      epa_pct: 0.8, dha_pct: 1.0,
      n3_n6_ratio: 2.0,
      linoleic_pct: 1.5,
      astaxanthin_mg_kg: 60,   // fillet pigmentation — industry standard
    },
    minerals: {
      ca_pct: 0.4, p_pct: 0.65, avail_p_pct: 0.42,
      mg_pct: 0.04, k_pct: 0.60, na_pct: 0.20,
      fe_ppm: 40, zn_ppm: 20, mn_ppm: 6, cu_ppm: 3,
      se_ppm: 0.25, i_ppm: 1.0, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 2500, vit_d_iu_kg: 1200, vit_e_mg_kg: 120,
      vit_c_mg_kg: 60, vit_k_mg_kg: 5,
      vit_b1_mg_kg: 7, vit_b2_mg_kg: 10, vit_b6_mg_kg: 5,
      vit_b12_mg_kg: 0.01, niacin_mg_kg: 35, pantothenic_mg_kg: 25,
      folic_mg_kg: 2, biotin_mg_kg: 0.07, choline_mg_kg: 1800,
      inositol_mg_kg: 100,
    },
    feed_management: { fcr_target: 1.20, feeds_per_day: 2, feeding_rate_pct_bw: 0.8 },
  },

  salmon_broodstock: {
    label: "Atlantic Salmon — Broodstock (maturation)",
    species: "atlantic_salmon", production: "broodstock", phase: "maturation",
    energy: { de_mj_kg: 16.0, de_kcal_kg: 3824 },
    protein: {
      dp_pct: 42, cp_pct: 46,
      lys: 2.2, met: 1.5, met_cys: 2.0, thr: 1.8, arg: 2.5,
      ile: 1.8, leu: 2.9, val: 2.0, his: 0.9, trp: 0.5, phe: 1.9,
    },
    lipids: {
      total_lipid_pct: 22,
      epa_dha_pct: 2.5,        // critical for egg quality and larval survival
      epa_pct: 1.2, dha_pct: 1.5,
      n3_n6_ratio: 3.0,
      linoleic_pct: 0.8,
      astaxanthin_mg_kg: 80,
    },
    minerals: {
      ca_pct: 0.6, p_pct: 0.90, avail_p_pct: 0.60,
      mg_pct: 0.06, k_pct: 0.80, na_pct: 0.30,
      fe_ppm: 65, zn_ppm: 35, mn_ppm: 12, cu_ppm: 6,
      se_ppm: 0.45, i_ppm: 1.2, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 6000, vit_d_iu_kg: 3000, vit_e_mg_kg: 400,
      vit_c_mg_kg: 300, vit_k_mg_kg: 12,
      vit_b1_mg_kg: 18, vit_b2_mg_kg: 25, vit_b6_mg_kg: 12,
      vit_b12_mg_kg: 0.03, niacin_mg_kg: 90, pantothenic_mg_kg: 60,
      folic_mg_kg: 6, biotin_mg_kg: 0.20, choline_mg_kg: 3500,
      inositol_mg_kg: 350,
    },
    feed_management: { fcr_target: 1.1, feeds_per_day: 2, feeding_rate_pct_bw: 0.8 },
  },

  // ── RAINBOW TROUT ─────────────────────────────────────────────────────────
  trout_fry: {
    label: "Rainbow Trout — Fry (<5g)",
    species: "rainbow_trout", production: "trout", phase: "fry",
    bw_range_g: [0, 5],
    energy: { de_mj_kg: 17.5, de_kcal_kg: 4183 },
    protein: {
      dp_pct: 48, cp_pct: 52,
      lys: 2.4, met: 1.5, met_cys: 2.1, thr: 1.9, arg: 2.6,
      ile: 1.9, leu: 3.0, val: 2.1, his: 0.9, trp: 0.5, phe: 1.9,
    },
    lipids: {
      total_lipid_pct: 14,
      epa_dha_pct: 1.5, epa_pct: 0.8, dha_pct: 0.9,
      n3_n6_ratio: 2.0, linoleic_pct: 1.0,
    },
    minerals: {
      ca_pct: 0.5, p_pct: 0.85, avail_p_pct: 0.55,
      mg_pct: 0.05, k_pct: 0.75, na_pct: 0.28,
      fe_ppm: 55, zn_ppm: 28, mn_ppm: 10, cu_ppm: 4,
      se_ppm: 0.35, i_ppm: 0.8, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 4500, vit_d_iu_kg: 2000, vit_e_mg_kg: 250,
      vit_c_mg_kg: 180, vit_k_mg_kg: 8,
      vit_b1_mg_kg: 12, vit_b2_mg_kg: 18, vit_b6_mg_kg: 9,
      vit_b12_mg_kg: 0.02, niacin_mg_kg: 65, pantothenic_mg_kg: 45,
      folic_mg_kg: 4, biotin_mg_kg: 0.12, choline_mg_kg: 2800,
      inositol_mg_kg: 280,
    },
    feed_management: { fcr_target: 0.85, feeds_per_day: 8, feeding_rate_pct_bw: 4 },
  },

  trout_grow_out: {
    label: "Rainbow Trout — Grow-out (50g-1kg)",
    species: "rainbow_trout", production: "trout", phase: "grow_out",
    bw_range_g: [50, 1000],
    energy: { de_mj_kg: 16.0, de_kcal_kg: 3824 },
    protein: {
      dp_pct: 38, cp_pct: 42,
      lys: 2.0, met: 1.3, met_cys: 1.8, thr: 1.6, arg: 2.1,
      ile: 1.6, leu: 2.6, val: 1.8, his: 0.7, trp: 0.4, phe: 1.6,
    },
    lipids: {
      total_lipid_pct: 20,
      epa_dha_pct: 1.0, epa_pct: 0.5, dha_pct: 0.7,
      n3_n6_ratio: 1.5, linoleic_pct: 1.5,
    },
    minerals: {
      ca_pct: 0.4, p_pct: 0.72, avail_p_pct: 0.45,
      mg_pct: 0.05, k_pct: 0.65, na_pct: 0.22,
      fe_ppm: 45, zn_ppm: 22, mn_ppm: 8, cu_ppm: 3,
      se_ppm: 0.28, i_ppm: 0.8, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 3000, vit_d_iu_kg: 1500, vit_e_mg_kg: 150,
      vit_c_mg_kg: 80, vit_k_mg_kg: 6,
      vit_b1_mg_kg: 8, vit_b2_mg_kg: 12, vit_b6_mg_kg: 6,
      vit_b12_mg_kg: 0.01, niacin_mg_kg: 45, pantothenic_mg_kg: 30,
      folic_mg_kg: 2.5, biotin_mg_kg: 0.08, choline_mg_kg: 2000,
      inositol_mg_kg: 180,
    },
    feed_management: { fcr_target: 1.0, feeds_per_day: 3, feeding_rate_pct_bw: 1.2 },
  },

  trout_finishing: {
    label: "Rainbow Trout — Finishing (>1kg, pre-harvest)",
    species: "rainbow_trout", production: "trout", phase: "finishing",
    bw_range_g: [1000, 4000],
    energy: { de_mj_kg: 15.5, de_kcal_kg: 3705 },
    protein: {
      dp_pct: 34, cp_pct: 38,
      lys: 1.8, met: 1.2, met_cys: 1.6, thr: 1.5, arg: 2.0,
      ile: 1.5, leu: 2.4, val: 1.7, his: 0.7, trp: 0.3, phe: 1.5,
    },
    lipids: {
      total_lipid_pct: 24,
      epa_dha_pct: 1.2, epa_pct: 0.6, dha_pct: 0.8,
      n3_n6_ratio: 2.0, linoleic_pct: 1.2,
      astaxanthin_mg_kg: 40,
    },
    minerals: {
      ca_pct: 0.4, p_pct: 0.65, avail_p_pct: 0.40,
      mg_pct: 0.04, k_pct: 0.60, na_pct: 0.20,
      fe_ppm: 40, zn_ppm: 20, mn_ppm: 6, cu_ppm: 3,
      se_ppm: 0.25, i_ppm: 0.8, co_ppm: 0.05,
    },
    vitamins: {
      vit_a_iu_kg: 2500, vit_d_iu_kg: 1200, vit_e_mg_kg: 120,
      vit_c_mg_kg: 60, vit_k_mg_kg: 5,
      vit_b1_mg_kg: 7, vit_b2_mg_kg: 10, vit_b6_mg_kg: 5,
      vit_b12_mg_kg: 0.01, niacin_mg_kg: 35, pantothenic_mg_kg: 25,
      folic_mg_kg: 2, biotin_mg_kg: 0.07, choline_mg_kg: 1800,
      inositol_mg_kg: 120,
    },
    feed_management: { fcr_target: 1.05, feeds_per_day: 2, feeding_rate_pct_bw: 0.9 },
  },
};

const PHASE_MAP = {
  fry: 'salmon_fry', larvae: 'salmon_fry', starter: 'salmon_fry',
  smolt: 'salmon_smolt', parr: 'salmon_smolt',
  post_smolt: 'salmon_post_smolt',
  grow_out: 'salmon_grow_out', growing: 'salmon_grow_out', grower: 'salmon_grow_out',
  finishing: 'salmon_finishing', pre_harvest: 'salmon_finishing',
  broodstock: 'salmon_broodstock', maturation: 'salmon_broodstock',
  trout_fry: 'trout_fry', trout_grow_out: 'trout_grow_out',
  trout_finishing: 'trout_finishing',
};

function resolvePhaseKey(species, production, phase) {
  const sp = String(species || '').toLowerCase();
  const pr = String(production || '').toLowerCase();
  const ph = String(phase || '').toLowerCase();

  // Trout-specific
  if (sp === 'rainbow_trout' || pr === 'trout') {
    if (ph === 'fry' || ph === 'starter') return 'trout_fry';
    if (ph === 'finishing' || ph === 'pre_harvest') return 'trout_finishing';
    return 'trout_grow_out';
  }

  const combined = `${pr}_${ph}`;
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[ph]) return PHASE_MAP[ph];
  return 'salmon_grow_out';
}

function resolveStatic(context) {
  const species = String(context.species || context.type || 'atlantic_salmon').toLowerCase();
  const phaseKey = resolvePhaseKey(species, context.production, context.phase);
  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };

  return {
    ok: true, mode: 'static',
    standard: 'NRC_2011_Salmonid_plus_Literature_2011_2024',
    species: table.species, phase_key: phaseKey, label: table.label,
    digestible_energy_fish: table.energy?.de_kcal_kg ?? null,
    de_mj_kg: table.energy?.de_mj_kg ?? null,
    de_kcal_kg: table.energy?.de_kcal_kg ?? null,
    cp: table.protein?.cp_pct ?? null,
    digestible_protein_fish: table.protein?.dp_pct ?? null,
    dp_pct: table.protein?.dp_pct ?? null,
    total_lys: table.protein?.lys ?? null, total_met: table.protein?.met ?? null,
    total_metcys: table.protein?.met_cys ?? null, total_thr: table.protein?.thr ?? null,
    total_arg: table.protein?.arg ?? null, total_ile: table.protein?.ile ?? null,
    total_leu: table.protein?.leu ?? null, total_val: table.protein?.val ?? null,
    total_his: table.protein?.his ?? null, total_trp: table.protein?.trp ?? null,
    ee: table.lipids?.total_lipid_pct ?? null,
    dha_epa: table.lipids?.epa_dha_pct ?? null,
    epa: table.lipids?.epa_pct ?? null, dha: table.lipids?.dha_pct ?? null,
    n3_n6_ratio: table.lipids?.n3_n6_ratio ?? null,
    linoleic: table.lipids?.linoleic_pct ?? null,
    astaxanthin_mg_kg: table.lipids?.astaxanthin_mg_kg ?? null,
    ca: table.minerals?.ca_pct ?? null,
    total_p: table.minerals?.p_pct ?? null,
    avp: table.minerals?.avail_p_pct ?? null,
    mg: table.minerals?.mg_pct ?? null,
    k: table.minerals?.k_pct ?? null, na: table.minerals?.na_pct ?? null,
    fe: table.minerals?.fe_ppm ?? null, zn: table.minerals?.zn_ppm ?? null,
    mn: table.minerals?.mn_ppm ?? null, cu: table.minerals?.cu_ppm ?? null,
    se: table.minerals?.se_ppm ?? null, i: table.minerals?.i_ppm ?? null,
    vit_a: table.vitamins?.vit_a_iu_kg ?? null,
    vit_d3: table.vitamins?.vit_d_iu_kg ?? null,
    vit_e: table.vitamins?.vit_e_mg_kg ?? null,
    vit_c: table.vitamins?.vit_c_mg_kg ?? null,
    niacin: table.vitamins?.niacin_mg_kg ?? null,
    choline: table.vitamins?.choline_mg_kg ?? null,
    inositol: table.vitamins?.inositol_mg_kg ?? null,
    fcr_target: table.feed_management?.fcr_target ?? null,
    feeding_rate_pct_bw: table.feed_management?.feeding_rate_pct_bw ?? null,
  };
}

function resolveSalmonidRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();
  try {
    return mode === 'static' ? resolveStatic(context) : resolveStatic(context);
  } catch (e) {
    return { ok: false, error: 'SALMONID_ENGINE_ERROR', message: e.message, mode };
  }
}

module.exports = { resolveSalmonidRequirements, STATIC_REQUIREMENTS };
