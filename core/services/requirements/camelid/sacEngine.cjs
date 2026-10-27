"use strict";
/**
 * South American Camelid (SAC) Requirements Engine
 * Species: Vicugna pacos (alpaca) + Lama glama (llama)
 *          + Vicugna vicugna (vicuña) + Lama guanicoe (guanaco) [wild, reference only]
 *
 * Primary sources:
 *   Van Saun RJ 2006 — "Nutritional Diseases of South American Camelids" (Small Rum. Res.)
 *   NRC 2007 — "Nutrient Requirements of Small Ruminants" (Table 16-1, llama/alpaca)
 *   Judson GJ & McFarlane JD 2002 — "Mineral disorders in SACs" (Aust. Vet. J.)
 *   Cebra C et al. 2014 — "Llama and Alpaca Care" (Elsevier, comprehensive reference)
     Fowler ME 2010 — "Medicine and Surgery of Camelids" (Wiley-Blackwell, 3rd ed.)
 *   Herd DB & Sprott LR 1986 — "Body condition, nutrition and reproduction of llamas" (Texas A&M)
 *   Cheeke PR & Dierenfeld ES 2010 — "Comparative Animal Nutrition and Metabolism" (CABI)
 *
 * Physiology notes:
 *   - Pseudo-ruminants: 3 stomach compartments (C1/C2 = fermentation, C3 = true stomach)
 *   - More hindgut fermentation than cattle; more efficient at extracting energy from low-quality forage
 *   - COPPER SENSITIVE: similar to sheep — chronic copper toxicity at levels safe for cattle
 *     Keep dietary Cu ≤ 15 mg/kg DM (Van Saun 2006)
 *   - SELENIUM deficiency is common — Andean soils historically Se-poor; important in all SAC programs
 *   - Vitamin D: outdoor animals usually adequate; housed animals may need supplementation
 *   - Alpaca body weight: 55-90 kg adult female; 65-100 kg adult male
 *   - Llama body weight: 100-200 kg adult female; 130-200 kg adult male
 *
 * Energy system: DE (Mcal/kg DM) — NRC 2007 SAC standard; ME also provided
 *
 * All nutrient values expressed as % DM unless stated otherwise (mg/kg DM for trace minerals)
 */

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function round(v, d = 4) { const n = Number(v); if (!Number.isFinite(n)) return null; return Number(n.toFixed(d)); }

// ═══════════════════════════════════════════════════════════════════════════
// ALPACA (Vicugna pacos) — fiber + companion + dairy production
// Body weight: 55-90 kg adult female; 65-100 kg male
// ═══════════════════════════════════════════════════════════════════════════
const ALPACA = {

  maintenance: {
    label: "Alpaca — Adult Maintenance (NRC 2007 / Van Saun 2006)",
    production: "maintenance", phase: "maintenance",
    energy: { de_mcal_kg: 2.10, me_mj_kg: 7.5, tdn_pct: 48 },
    protein: {
      cp_pct: 10.0, mp_g_day: null,   // MP demand estimated at ~45 g/day for 65 kg adult
      // No published essential AA profiles for SACs — use ruminant analogy for formulation
    },
    fiber: {
      ndf_pct_min: 30, adf_pct_min: 20,   // high fiber tolerance; forage-based diet expected
      ndf_pct_max: 65, adf_pct_max: 45,    // above this, intake drops and performance suffers
    },
    minerals: {
      ca_pct: 0.32, p_pct: 0.22, ca_p_ratio: 1.5,
      na_pct: 0.08, cl_pct: 0.12, mg_pct: 0.12, k_pct: 0.50, s_pct: 0.14,
      // Trace minerals: copper CRITICAL — keep below maximum
      fe_ppm: 50,  cu_ppm: 10, cu_max_ppm: 15,   // HARD MAXIMUM: 15 mg/kg (Van Saun 2006)
      zn_ppm: 35,  mn_ppm: 20, se_ppm: 0.15,      // Se supplementation commonly needed
      i_ppm: 0.30, co_ppm: 0.10,
    },
    vitamins: {
      vit_a_iu_kg: 3500, vit_d_iu_kg: 600, vit_e_mg_kg: 30,
      vit_d_note: "Outdoor animals usually sufficient; housed SACs may need supplementation",
    },
    fleece: null,
    water: { water_l_per_day: 4, note: "Relatively drought-tolerant; estimates 3-6 L/day for maintenance" },
    feed_management: { feeding_rate_pct_bw: 1.8, dry_matter_intake_pct_bw: 1.5 },
  },

  growth: {
    label: "Alpaca — Growth / Cria (Weaning to 12 Months, NRC 2007 / Cebra 2014)",
    production: "growth", phase: "growth",
    energy: { de_mcal_kg: 2.50, me_mj_kg: 9.0, tdn_pct: 57 },
    protein: { cp_pct: 14.5 },
    fiber: { ndf_pct_min: 22, adf_pct_min: 14, ndf_pct_max: 55, adf_pct_max: 38 },
    minerals: {
      ca_pct: 0.52, p_pct: 0.36, ca_p_ratio: 1.4,
      na_pct: 0.12, cl_pct: 0.15, mg_pct: 0.14, k_pct: 0.58, s_pct: 0.16,
      fe_ppm: 65, cu_ppm: 12, cu_max_ppm: 15,
      zn_ppm: 45, mn_ppm: 25, se_ppm: 0.20, i_ppm: 0.40, co_ppm: 0.12,
    },
    vitamins: { vit_a_iu_kg: 5500, vit_d_iu_kg: 800, vit_e_mg_kg: 50 },
    fleece: null,
    water: { water_l_per_day: 3 },
    feed_management: { feeding_rate_pct_bw: 3.0, dry_matter_intake_pct_bw: 2.5 },
  },

  gestation: {
    label: "Alpaca — Gestation (Last Trimester, Van Saun 2006 / NRC 2007)",
    production: "gestation", phase: "gestation",
    energy: { de_mcal_kg: 2.35, me_mj_kg: 8.4, tdn_pct: 54 },
    protein: { cp_pct: 12.0 },
    fiber: { ndf_pct_min: 28, adf_pct_min: 18, ndf_pct_max: 62, adf_pct_max: 43 },
    minerals: {
      ca_pct: 0.42, p_pct: 0.28, ca_p_ratio: 1.5,
      na_pct: 0.10, cl_pct: 0.14, mg_pct: 0.13, k_pct: 0.54, s_pct: 0.15,
      fe_ppm: 58, cu_ppm: 11, cu_max_ppm: 15,
      zn_ppm: 40, mn_ppm: 22, se_ppm: 0.18, i_ppm: 0.35, co_ppm: 0.11,
    },
    vitamins: { vit_a_iu_kg: 4500, vit_d_iu_kg: 700, vit_e_mg_kg: 40 },
    fleece: null,
    water: { water_l_per_day: 5 },
    feed_management: { feeding_rate_pct_bw: 2.0, dry_matter_intake_pct_bw: 1.8 },
  },

  lactation: {
    label: "Alpaca — Lactation (NRC 2007 / Van Saun 2006 / Cebra 2014)",
    production: "lactation", phase: "lactation",
    energy: { de_mcal_kg: 2.65, me_mj_kg: 9.5, tdn_pct: 60 },
    protein: { cp_pct: 15.5 },
    fiber: { ndf_pct_min: 25, adf_pct_min: 16, ndf_pct_max: 58, adf_pct_max: 40 },
    minerals: {
      ca_pct: 0.55, p_pct: 0.40, ca_p_ratio: 1.4,
      na_pct: 0.15, cl_pct: 0.18, mg_pct: 0.16, k_pct: 0.62, s_pct: 0.16,
      fe_ppm: 65, cu_ppm: 12, cu_max_ppm: 15,
      zn_ppm: 45, mn_ppm: 25, se_ppm: 0.20, i_ppm: 0.40, co_ppm: 0.12,
    },
    vitamins: { vit_a_iu_kg: 5500, vit_d_iu_kg: 750, vit_e_mg_kg: 50 },
    fleece: null,
    water: { water_l_per_day: 6, note: "Water intake increases ~50% during lactation" },
    feed_management: { feeding_rate_pct_bw: 2.8, dry_matter_intake_pct_bw: 2.3 },
  },

  fiber_production: {
    label: "Alpaca — Fiber Production (Shearing Year, Van Saun 2006 / Judson 2002)",
    production: "fiber_production", phase: "fiber",
    // Similar to maintenance but sulfur amino acids (Met + Cys) critical for fleece quality and yield
    energy: { de_mcal_kg: 2.15, me_mj_kg: 7.7, tdn_pct: 49 },
    protein: {
      cp_pct: 12.0,
      // Sulfur amino acids key for fiber: target met+cys ≥ 0.45% DM (Fowler 2010)
      met_cys_note: "Met + Cys ≥ 0.45% DM critical for fleece yield and fineness (Fowler 2010)",
    },
    fiber: { ndf_pct_min: 28, adf_pct_min: 18, ndf_pct_max: 62, adf_pct_max: 43 },
    minerals: {
      ca_pct: 0.34, p_pct: 0.23, ca_p_ratio: 1.5,
      na_pct: 0.08, cl_pct: 0.12, mg_pct: 0.12, k_pct: 0.52, s_pct: 0.18,   // higher S for cysteine in fleece
      fe_ppm: 52, cu_ppm: 10, cu_max_ppm: 15,
      zn_ppm: 40, mn_ppm: 20, se_ppm: 0.15, i_ppm: 0.32, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 3800, vit_d_iu_kg: 650, vit_e_mg_kg: 35 },
    fleece: {
      target_yield_kg: 2.5,         // 2-4 kg/year typical huacaya; 1.5-3 kg suri
      fineness_note: "Fiber fineness improves with higher Met+Cys and adequate Zn. Se deficiency linked to weak fiber (Judson 2002).",
    },
    water: { water_l_per_day: 4 },
    feed_management: { feeding_rate_pct_bw: 1.9, dry_matter_intake_pct_bw: 1.6 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// LLAMA (Lama glama) — fiber, companion, pack animal production
// Body weight: 100-200 kg adult female; 130-200 kg adult male (much larger than alpaca)
// Nutrient concentrations similar to alpaca but body-weight-adjusted intake higher
// ═══════════════════════════════════════════════════════════════════════════
const LLAMA = {

  maintenance: {
    label: "Llama — Adult Maintenance (NRC 2007 / Van Saun 2006)",
    production: "maintenance", phase: "maintenance",
    energy: { de_mcal_kg: 2.00, me_mj_kg: 7.2, tdn_pct: 46 },   // llamas thrive on lower-quality forage
    protein: { cp_pct: 9.5 },
    fiber: { ndf_pct_min: 32, adf_pct_min: 20, ndf_pct_max: 68, adf_pct_max: 48 },
    minerals: {
      ca_pct: 0.30, p_pct: 0.20, ca_p_ratio: 1.5,
      na_pct: 0.08, cl_pct: 0.11, mg_pct: 0.11, k_pct: 0.48, s_pct: 0.13,
      fe_ppm: 45,  cu_ppm: 10, cu_max_ppm: 15,    // CRITICAL: same Cu sensitivity as alpaca
      zn_ppm: 32, mn_ppm: 18, se_ppm: 0.14, i_ppm: 0.28, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 3200, vit_d_iu_kg: 550, vit_e_mg_kg: 28 },
    water: { water_l_per_day: 6, note: "5-8 L/day for 130 kg llama at maintenance in temperate climate" },
    feed_management: { feeding_rate_pct_bw: 1.7, dry_matter_intake_pct_bw: 1.4 },
  },

  growth: {
    label: "Llama — Growth / Cria (NRC 2007 / Cebra 2014)",
    production: "growth", phase: "growth",
    energy: { de_mcal_kg: 2.40, me_mj_kg: 8.6, tdn_pct: 55 },
    protein: { cp_pct: 14.0 },
    fiber: { ndf_pct_min: 24, adf_pct_min: 15, ndf_pct_max: 58, adf_pct_max: 40 },
    minerals: {
      ca_pct: 0.50, p_pct: 0.34, ca_p_ratio: 1.5,
      na_pct: 0.12, cl_pct: 0.15, mg_pct: 0.13, k_pct: 0.55, s_pct: 0.15,
      fe_ppm: 60, cu_ppm: 11, cu_max_ppm: 15,
      zn_ppm: 42, mn_ppm: 22, se_ppm: 0.18, i_ppm: 0.38, co_ppm: 0.11,
    },
    vitamins: { vit_a_iu_kg: 5000, vit_d_iu_kg: 750, vit_e_mg_kg: 45 },
    water: { water_l_per_day: 4 },
    feed_management: { feeding_rate_pct_bw: 2.8, dry_matter_intake_pct_bw: 2.3 },
  },

  gestation: {
    label: "Llama — Gestation (Last Trimester, Van Saun 2006 / NRC 2007)",
    production: "gestation", phase: "gestation",
    energy: { de_mcal_kg: 2.25, me_mj_kg: 8.1, tdn_pct: 52 },
    protein: { cp_pct: 11.5 },
    fiber: { ndf_pct_min: 30, adf_pct_min: 19, ndf_pct_max: 65, adf_pct_max: 45 },
    minerals: {
      ca_pct: 0.40, p_pct: 0.26, ca_p_ratio: 1.5,
      na_pct: 0.10, cl_pct: 0.13, mg_pct: 0.12, k_pct: 0.52, s_pct: 0.14,
      fe_ppm: 55, cu_ppm: 10, cu_max_ppm: 15,
      zn_ppm: 38, mn_ppm: 20, se_ppm: 0.16, i_ppm: 0.33, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 4200, vit_d_iu_kg: 650, vit_e_mg_kg: 38 },
    water: { water_l_per_day: 7 },
    feed_management: { feeding_rate_pct_bw: 1.9, dry_matter_intake_pct_bw: 1.7 },
  },

  lactation: {
    label: "Llama — Lactation (Van Saun 2006 / Cebra 2014)",
    production: "lactation", phase: "lactation",
    energy: { de_mcal_kg: 2.55, me_mj_kg: 9.1, tdn_pct: 58 },
    protein: { cp_pct: 15.0 },
    fiber: { ndf_pct_min: 26, adf_pct_min: 17, ndf_pct_max: 60, adf_pct_max: 42 },
    minerals: {
      ca_pct: 0.52, p_pct: 0.38, ca_p_ratio: 1.4,
      na_pct: 0.14, cl_pct: 0.17, mg_pct: 0.15, k_pct: 0.60, s_pct: 0.16,
      fe_ppm: 62, cu_ppm: 11, cu_max_ppm: 15,
      zn_ppm: 43, mn_ppm: 23, se_ppm: 0.18, i_ppm: 0.38, co_ppm: 0.11,
    },
    vitamins: { vit_a_iu_kg: 5200, vit_d_iu_kg: 700, vit_e_mg_kg: 48 },
    water: { water_l_per_day: 9 },
    feed_management: { feeding_rate_pct_bw: 2.5, dry_matter_intake_pct_bw: 2.1 },
  },

  pack: {
    label: "Llama — Pack / Working Animal (Cebra 2014 / Fowler 2010)",
    production: "pack", phase: "work",
    energy: { de_mcal_kg: 2.35, me_mj_kg: 8.4, tdn_pct: 54 },   // light-moderate work; increase 20-40% for heavy pack
    protein: { cp_pct: 11.0 },
    fiber: { ndf_pct_min: 28, adf_pct_min: 18, ndf_pct_max: 60, adf_pct_max: 42 },
    minerals: {
      ca_pct: 0.32, p_pct: 0.22, ca_p_ratio: 1.5,
      na_pct: 0.15, cl_pct: 0.18, mg_pct: 0.12, k_pct: 0.60, s_pct: 0.13,
      fe_ppm: 50, cu_ppm: 10, cu_max_ppm: 15,
      zn_ppm: 35, mn_ppm: 20, se_ppm: 0.14, i_ppm: 0.30, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 3500, vit_d_iu_kg: 600, vit_e_mg_kg: 35 },
    water: { water_l_per_day: 8, note: "Water every 4-6 hours when working; electrolyte loss significant on hot days" },
    feed_management: { feeding_rate_pct_bw: 2.0, dry_matter_intake_pct_bw: 1.7 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE / PRODUCTION RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_MAP = {
  maintenance: 1, adult: 'maintenance', dry: 'maintenance', non_lactating: 'maintenance',
  growth: 1, growing: 1, cria: 'growth', weaning: 'growth', juvenile: 'growth', yearling: 'growth',
  gestation: 1, pregnancy: 'gestation', pregnant: 'gestation', last_trimester: 'gestation',
  lactation: 1, lactating: 1, nursing: 'lactation', milking: 'lactation',
  fiber_production: 1, fiber: 'fiber_production', shearing: 'fiber_production', fleece: 'fiber_production',
  pack: 1, work: 'pack', working: 'pack', transport: 'pack', load: 'pack',
};

function resolvePhaseKey(production, phase, data) {
  const pr = String(production || '').toLowerCase().replace(/[^a-z_]/g, '');
  const ph = String(phase || '').toLowerCase().replace(/[^a-z_]/g, '');
  for (const k of [ph, pr]) {
    if (data[k]) return k;
    const m = PHASE_MAP[k];
    if (m && m !== 1 && data[m]) return m;
  }
  return 'maintenance';
}

function resolveSpecies(species, breed) {
  const s = String(species || breed || '').toLowerCase();
  if (s.includes('llama') || s.includes('guanaco') || s.includes('lama glama')) return 'llama';
  return 'alpaca'; // default for SAC — alpaca more common in commercial programs
}

// ═══════════════════════════════════════════════════════════════════════════
// FLATTEN TO FLAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════
function flatten(t, sacSpecies) {
  if (!t) return { ok: false, error: 'PHASE_NOT_FOUND' };
  const speciesName = sacSpecies === 'llama' ? 'Lama glama' : 'Vicugna pacos';
  return {
    ok: true, mode: 'static',
    standard: 'NRC_2007_VanSaun_2006_Cebra_2014',
    species: 'south_american_camelid', sac_species: sacSpecies,
    species_name: speciesName, label: t.label,
    // Energy
    de_mcal_kg:  t.energy?.de_mcal_kg  ?? null,
    me_mj_kg:    t.energy?.me_mj_kg    ?? null,
    tdn_pct:     t.energy?.tdn_pct     ?? null,
    // Protein
    cp_pct:      t.protein?.cp_pct     ?? null,
    met_cys_note: t.protein?.met_cys_note ?? null,
    // Fiber
    ndf_pct_min:  t.fiber?.ndf_pct_min  ?? null,
    adf_pct_min:  t.fiber?.adf_pct_min  ?? null,
    ndf_pct_max:  t.fiber?.ndf_pct_max  ?? null,
    adf_pct_max:  t.fiber?.adf_pct_max  ?? null,
    // Macrominerals (% DM)
    ca_pct:      t.minerals?.ca_pct    ?? null,
    p_pct:       t.minerals?.p_pct     ?? null,
    ca_p_ratio:  t.minerals?.ca_p_ratio ?? null,
    na_pct:      t.minerals?.na_pct    ?? null,
    cl_pct:      t.minerals?.cl_pct    ?? null,
    mg_pct:      t.minerals?.mg_pct    ?? null,
    k_pct:       t.minerals?.k_pct     ?? null,
    s_pct:       t.minerals?.s_pct     ?? null,
    // Trace minerals (mg/kg DM)
    fe_ppm:      t.minerals?.fe_ppm    ?? null,
    cu_ppm:      t.minerals?.cu_ppm    ?? null,
    cu_max_ppm:  t.minerals?.cu_max_ppm ?? null,  // CRITICAL safety ceiling
    zn_ppm:      t.minerals?.zn_ppm    ?? null,
    mn_ppm:      t.minerals?.mn_ppm    ?? null,
    se_ppm:      t.minerals?.se_ppm    ?? null,
    i_ppm:       t.minerals?.i_ppm     ?? null,
    co_ppm:      t.minerals?.co_ppm    ?? null,
    // Vitamins
    vit_a_iu_kg:  t.vitamins?.vit_a_iu_kg  ?? null,
    vit_d_iu_kg:  t.vitamins?.vit_d_iu_kg  ?? null,
    vit_d_note:   t.vitamins?.vit_d_note   ?? null,
    vit_e_mg_kg:  t.vitamins?.vit_e_mg_kg  ?? null,
    // Fleece (alpaca only)
    fleece_target_yield_kg: t.fleece?.target_yield_kg ?? null,
    fleece_note:            t.fleece?.fineness_note   ?? null,
    // Water
    water_l_per_day: t.water?.water_l_per_day ?? null,
    water_note:      t.water?.note            ?? null,
    // Feed management
    feeding_rate_pct_bw:    t.feed_management?.feeding_rate_pct_bw    ?? null,
    dmi_pct_bw:             t.feed_management?.dry_matter_intake_pct_bw ?? null,
    // CRITICAL safety note
    cu_safety_warning: "SACs are COPPER SENSITIVE — max 15 mg/kg DM. Chronic copper toxicity risk at levels safe for cattle (Van Saun 2006).",
    se_note:           "Selenium deficiency endemic in SACs in many regions. Supplement via selenium yeast or selenium salt (NRC 2007).",
    physiology_note:   "Pseudo-ruminant (3 compartments C1/C2/C3). Higher hindgut fermentation than cattle. Efficient on low-quality forage. Lower basal ME requirement per kg BW than sheep.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════════════════
function resolveSACRequirements(context = {}) {
  try {
    const sacSpecies = resolveSpecies(context.species, context.breed);
    const data = sacSpecies === 'llama' ? LLAMA : ALPACA;
    const key = resolvePhaseKey(context.production, context.phase, data);
    return flatten(data[key], sacSpecies);
  } catch (e) {
    return { ok: false, error: 'SAC_ENGINE_ERROR', message: e.message };
  }
}

const STATIC_REQUIREMENTS = { alpaca: ALPACA, llama: LLAMA };
module.exports = { resolveSACRequirements, STATIC_REQUIREMENTS, ALPACA, LLAMA };
