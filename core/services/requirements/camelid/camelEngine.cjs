"use strict";
/**
 * Camel Nutrient Requirements Engine
 * Species: Camelus dromedarius (dromedary) + Camelus bactrianus (Bactrian)
 *
 * Primary sources:
 *   Wardeh MF 1989 — "Models for the Nutritional Requirements of Camels" (FAO/CIHEAM)
 *   Faye B & Bengoumi M 2018 — "Camel Clinical Biochemistry and Hematology" (Springer)
 *   FAO 1994 — "A Manual for the Primary Animal Health Care Worker" (camel chapters)
 *   Gahlot TK 2000 — "The Camel: Facts and Figures" (Bikaner, India)
 *   Al-Saiady MY et al. 2012 — "Effect of different protein levels on camel milk yield" (J. Anim. Sci.)
 *   Yagil R 1985 — "The Desert Camel: Comparative Physiological Adaptation" (Karger)
 *   NRC 2007 (small ruminant analogy where camel-specific data is absent)
 *
 * Physiology notes:
 *   - Pseudo-ruminants: 3 forestomach compartments (C1/rumen-like, C2, C3/omasum-like)
 *   - Extremely efficient water balance: can lose 30% body water and recover; urine concentrated
 *   - Hump stores fat (energy reserve), NOT water
 *   - Lower basal metabolic rate than cattle of similar body weight (~25% lower)
 *   - Excellent tolerance of high-fiber, low-quality roughage
 *   - Dromedary: 1 hump, tropical/arid, adult 300-700 kg female, 400-900 kg male
 *   - Bactrian: 2 humps, cold desert (Gobi, Kazakh steppe), adult 450-800 kg
 *
 * Energy system: ME (MJ/kg DM) — Wardeh FAO standard for camelids
 *                TDN (% DM) also provided as alternative reference
 *
 * All nutrient values expressed as % DM unless stated otherwise (mg/kg DM for trace minerals)
 */

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function round(v, d = 4) { const n = Number(v); if (!Number.isFinite(n)) return null; return Number(n.toFixed(d)); }

// ═══════════════════════════════════════════════════════════════════════════
// DROMEDARY (Camelus dromedarius) — primary published dataset
// ═══════════════════════════════════════════════════════════════════════════
const DROMEDARY = {

  maintenance: {
    label: "Dromedary Camel — Adult Maintenance (Wardeh 1989 / Faye & Bengoumi 2018)",
    production: "maintenance", phase: "maintenance",
    energy: { me_mj_kg: 8.2, tdn_pct: 53 },
    protein: { cp_pct: 8.5, udp_pct: 3.0 },        // UDP ~35% of CP for pseudo-ruminant
    fiber: { ndf_pct_min: 25, adf_pct_min: 17 },    // minimum structural fiber for C1 motility
    minerals: {
      ca_pct: 0.28, p_pct: 0.20, ca_p_ratio: 1.4,
      na_pct: 0.10, cl_pct: 0.15, mg_pct: 0.07, k_pct: 0.50, s_pct: 0.12,
      fe_ppm: 50,  zn_ppm: 30, mn_ppm: 25, cu_ppm: 10, se_ppm: 0.10, i_ppm: 0.40, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 4000, vit_d_iu_kg: 600, vit_e_mg_kg: 30 },
    water: { water_l_per_kg_dmi: 3.0, note: "Range 2-8 L/kg DMI — highly variable by temperature and humidity" },
    feed_management: { fcr_note: "Not applicable — maintenance feeding", feeding_rate_pct_bw: 1.5 },
  },

  growth: {
    label: "Dromedary Camel — Growth (Birth to 2 Years, Wardeh 1989 / Al-Saiady 2012)",
    production: "growth", phase: "growth",
    energy: { me_mj_kg: 9.8, tdn_pct: 64 },
    protein: { cp_pct: 15.0, udp_pct: 5.5 },
    fiber: { ndf_pct_min: 20, adf_pct_min: 12 },
    minerals: {
      ca_pct: 0.50, p_pct: 0.36, ca_p_ratio: 1.4,
      na_pct: 0.15, cl_pct: 0.20, mg_pct: 0.10, k_pct: 0.60, s_pct: 0.14,
      fe_ppm: 75, zn_ppm: 40, mn_ppm: 30, cu_ppm: 12, se_ppm: 0.15, i_ppm: 0.50, co_ppm: 0.12,
    },
    vitamins: { vit_a_iu_kg: 6000, vit_d_iu_kg: 800, vit_e_mg_kg: 50 },
    water: { water_l_per_kg_dmi: 3.5 },
    feed_management: { feeding_rate_pct_bw: 2.5 },
  },

  lactation: {
    label: "Dromedary Camel — Lactation Peak (5–10 L/day, Wardeh 1989 / Faye 2018)",
    production: "lactation", phase: "lactation",
    energy: { me_mj_kg: 10.8, tdn_pct: 70 },
    protein: { cp_pct: 14.5, udp_pct: 5.0 },
    fiber: { ndf_pct_min: 25, adf_pct_min: 17 },
    minerals: {
      ca_pct: 0.50, p_pct: 0.38, ca_p_ratio: 1.3,
      na_pct: 0.18, cl_pct: 0.22, mg_pct: 0.12, k_pct: 0.65, s_pct: 0.15,
      fe_ppm: 60, zn_ppm: 45, mn_ppm: 30, cu_ppm: 12, se_ppm: 0.15, i_ppm: 0.50, co_ppm: 0.12,
    },
    vitamins: { vit_a_iu_kg: 7000, vit_d_iu_kg: 800, vit_e_mg_kg: 60 },
    water: { water_l_per_kg_dmi: 4.5, note: "Lactating camels need significantly more water — 40-60 L/day at peak" },
    feed_management: { feeding_rate_pct_bw: 2.8 },
  },

  gestation: {
    label: "Dromedary Camel — Gestation (Last Trimester, Wardeh 1989)",
    production: "gestation", phase: "gestation",
    energy: { me_mj_kg: 9.5, tdn_pct: 62 },
    protein: { cp_pct: 11.5, udp_pct: 4.0 },
    fiber: { ndf_pct_min: 25, adf_pct_min: 17 },
    minerals: {
      ca_pct: 0.40, p_pct: 0.28, ca_p_ratio: 1.4,
      na_pct: 0.12, cl_pct: 0.18, mg_pct: 0.10, k_pct: 0.55, s_pct: 0.13,
      fe_ppm: 60, zn_ppm: 35, mn_ppm: 28, cu_ppm: 11, se_ppm: 0.12, i_ppm: 0.45, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 6000, vit_d_iu_kg: 800, vit_e_mg_kg: 50 },
    water: { water_l_per_kg_dmi: 3.5 },
    feed_management: { feeding_rate_pct_bw: 2.0 },
  },

  draft: {
    label: "Dromedary Camel — Draft / Working (Wardeh 1989 / Yagil 1985)",
    production: "draft", phase: "work",
    energy: { me_mj_kg: 12.0, tdn_pct: 78 },       // heavy work: +50% above maintenance
    protein: { cp_pct: 11.0, udp_pct: 4.0 },
    fiber: { ndf_pct_min: 22, adf_pct_min: 14 },
    minerals: {
      ca_pct: 0.32, p_pct: 0.23, ca_p_ratio: 1.4,
      na_pct: 0.20, cl_pct: 0.25, mg_pct: 0.10, k_pct: 0.65, s_pct: 0.13,
      fe_ppm: 55, zn_ppm: 35, mn_ppm: 28, cu_ppm: 10, se_ppm: 0.12, i_ppm: 0.42, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 4500, vit_d_iu_kg: 600, vit_e_mg_kg: 40 },
    water: { water_l_per_kg_dmi: 4.0, note: "Working camels: water access timing critical — rehydrate at rest stops" },
    feed_management: { feeding_rate_pct_bw: 2.5 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BACTRIAN (Camelus bactrianus) — adjusted for cold-desert adaptation
// Lower ME density tolerance; higher fiber efficiency; heavier body weight
// Source: Faye & Bengoumi 2018; Mongolian/Kazakh research literature
// ═══════════════════════════════════════════════════════════════════════════
const BACTRIAN = {
  maintenance: {
    label: "Bactrian Camel — Adult Maintenance (Faye & Bengoumi 2018)",
    production: "maintenance", phase: "maintenance",
    energy: { me_mj_kg: 8.0, tdn_pct: 52 },         // slightly lower energy density needed — more efficient at low-quality forage
    protein: { cp_pct: 8.0, udp_pct: 2.8 },
    fiber: { ndf_pct_min: 28, adf_pct_min: 18 },     // higher fiber tolerance for harsh steppe/desert forage
    minerals: {
      ca_pct: 0.26, p_pct: 0.18, ca_p_ratio: 1.4,
      na_pct: 0.10, cl_pct: 0.14, mg_pct: 0.07, k_pct: 0.48, s_pct: 0.12,
      fe_ppm: 50, zn_ppm: 28, mn_ppm: 22, cu_ppm: 10, se_ppm: 0.10, i_ppm: 0.38, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 4000, vit_d_iu_kg: 700, vit_e_mg_kg: 35 },
    water: { water_l_per_kg_dmi: 2.5, note: "Cold climate reduces evaporative loss; lower water requirement than dromedary in winter" },
    feed_management: { feeding_rate_pct_bw: 1.4 },
  },
  growth: {
    label: "Bactrian Camel — Growth (Faye & Bengoumi 2018)",
    production: "growth", phase: "growth",
    energy: { me_mj_kg: 9.5, tdn_pct: 62 },
    protein: { cp_pct: 14.5, udp_pct: 5.0 },
    fiber: { ndf_pct_min: 22, adf_pct_min: 14 },
    minerals: {
      ca_pct: 0.48, p_pct: 0.34, ca_p_ratio: 1.4,
      na_pct: 0.14, cl_pct: 0.18, mg_pct: 0.09, k_pct: 0.58, s_pct: 0.14,
      fe_ppm: 70, zn_ppm: 38, mn_ppm: 28, cu_ppm: 11, se_ppm: 0.14, i_ppm: 0.45, co_ppm: 0.11,
    },
    vitamins: { vit_a_iu_kg: 5500, vit_d_iu_kg: 800, vit_e_mg_kg: 45 },
    water: { water_l_per_kg_dmi: 3.0 },
    feed_management: { feeding_rate_pct_bw: 2.2 },
  },
  lactation: {
    label: "Bactrian Camel — Lactation (Faye & Bengoumi 2018)",
    production: "lactation", phase: "lactation",
    energy: { me_mj_kg: 10.5, tdn_pct: 68 },
    protein: { cp_pct: 14.0, udp_pct: 4.8 },
    fiber: { ndf_pct_min: 25, adf_pct_min: 16 },
    minerals: {
      ca_pct: 0.48, p_pct: 0.36, ca_p_ratio: 1.3,
      na_pct: 0.16, cl_pct: 0.20, mg_pct: 0.11, k_pct: 0.62, s_pct: 0.14,
      fe_ppm: 58, zn_ppm: 42, mn_ppm: 28, cu_ppm: 11, se_ppm: 0.14, i_ppm: 0.45, co_ppm: 0.11,
    },
    vitamins: { vit_a_iu_kg: 6500, vit_d_iu_kg: 750, vit_e_mg_kg: 55 },
    water: { water_l_per_kg_dmi: 4.0 },
    feed_management: { feeding_rate_pct_bw: 2.6 },
  },
  gestation: {
    label: "Bactrian Camel — Gestation (Faye & Bengoumi 2018)",
    production: "gestation", phase: "gestation",
    energy: { me_mj_kg: 9.2, tdn_pct: 60 },
    protein: { cp_pct: 11.0, udp_pct: 3.8 },
    fiber: { ndf_pct_min: 26, adf_pct_min: 17 },
    minerals: {
      ca_pct: 0.38, p_pct: 0.27, ca_p_ratio: 1.4,
      na_pct: 0.11, cl_pct: 0.16, mg_pct: 0.09, k_pct: 0.52, s_pct: 0.13,
      fe_ppm: 58, zn_ppm: 33, mn_ppm: 26, cu_ppm: 10, se_ppm: 0.11, i_ppm: 0.42, co_ppm: 0.10,
    },
    vitamins: { vit_a_iu_kg: 5500, vit_d_iu_kg: 750, vit_e_mg_kg: 45 },
    water: { water_l_per_kg_dmi: 3.2 },
    feed_management: { feeding_rate_pct_bw: 1.8 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE / PRODUCTION RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════
const PHASE_MAP = {
  maintenance: 1, adult: 'maintenance', dry: 'maintenance', non_lactating: 'maintenance',
  growth: 1, growing: 1, weaning: 'growth', juvenile: 'growth', yearling: 'growth', calf: 'growth',
  lactation: 1, lactating: 1, nursing: 'lactation', milking: 'lactation',
  gestation: 1, pregnancy: 'gestation', pregnant: 'gestation', last_trimester: 'gestation',
  draft: 1, work: 'draft', working: 'draft', load: 'draft', transport: 'draft',
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

function resolveSubspecies(breed) {
  const b = String(breed || '').toLowerCase();
  if (b.includes('bactrian') || b.includes('bactrianus') || b.includes('two') || b.includes('2 hump') || b.includes('mongolian')) return 'bactrian';
  return 'dromedary'; // default
}

// ═══════════════════════════════════════════════════════════════════════════
// FLATTEN TO FLAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════
function flatten(t, subspecies) {
  if (!t) return { ok: false, error: 'PHASE_NOT_FOUND' };
  return {
    ok: true, mode: 'static',
    standard: 'Wardeh_1989_FAO_Faye_Bengoumi_2018',
    species: 'camel', subspecies,
    species_name: subspecies === 'bactrian' ? 'Camelus bactrianus' : 'Camelus dromedarius',
    label: t.label,
    // Energy
    me_mj_kg:  t.energy?.me_mj_kg  ?? null,
    tdn_pct:   t.energy?.tdn_pct   ?? null,
    // Protein
    cp_pct:    t.protein?.cp_pct   ?? null,
    udp_pct:   t.protein?.udp_pct  ?? null,
    // Fiber
    ndf_pct_min: t.fiber?.ndf_pct_min ?? null,
    adf_pct_min: t.fiber?.adf_pct_min ?? null,
    // Macrominerals (% DM)
    ca_pct:    t.minerals?.ca_pct  ?? null,
    p_pct:     t.minerals?.p_pct   ?? null,
    ca_p_ratio: t.minerals?.ca_p_ratio ?? null,
    na_pct:    t.minerals?.na_pct  ?? null,
    cl_pct:    t.minerals?.cl_pct  ?? null,
    mg_pct:    t.minerals?.mg_pct  ?? null,
    k_pct:     t.minerals?.k_pct   ?? null,
    s_pct:     t.minerals?.s_pct   ?? null,
    // Trace minerals (mg/kg DM)
    fe_ppm:    t.minerals?.fe_ppm  ?? null,
    zn_ppm:    t.minerals?.zn_ppm  ?? null,
    mn_ppm:    t.minerals?.mn_ppm  ?? null,
    cu_ppm:    t.minerals?.cu_ppm  ?? null,
    se_ppm:    t.minerals?.se_ppm  ?? null,
    i_ppm:     t.minerals?.i_ppm   ?? null,
    co_ppm:    t.minerals?.co_ppm  ?? null,
    // Vitamins
    vit_a_iu_kg: t.vitamins?.vit_a_iu_kg ?? null,
    vit_d_iu_kg: t.vitamins?.vit_d_iu_kg ?? null,
    vit_e_mg_kg: t.vitamins?.vit_e_mg_kg ?? null,
    // Water
    water_l_per_kg_dmi: t.water?.water_l_per_kg_dmi ?? null,
    water_note:         t.water?.note ?? null,
    // Feed management
    feeding_rate_pct_bw: t.feed_management?.feeding_rate_pct_bw ?? null,
    // Important notes
    physiology_note: "Pseudo-ruminant (3 compartments). Highly efficient water metabolism. Hump = fat energy reserve. Lower BMR than cattle. Tolerates high-fiber, low-quality forage.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════════════════
function resolveCamelRequirements(context = {}) {
  try {
    const subspecies = resolveSubspecies(context.breed);
    const data = subspecies === 'bactrian' ? BACTRIAN : DROMEDARY;
    const key = resolvePhaseKey(context.production, context.phase, data);
    return flatten(data[key], subspecies);
  } catch (e) {
    return { ok: false, error: 'CAMEL_ENGINE_ERROR', message: e.message };
  }
}

const STATIC_REQUIREMENTS = { dromedary: DROMEDARY, bactrian: BACTRIAN };
module.exports = { resolveCamelRequirements, STATIC_REQUIREMENTS, DROMEDARY, BACTRIAN };
