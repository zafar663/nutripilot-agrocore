"use strict";
/**
 * Sheep NRC 2007 Requirements Engine
 * Source: NRC 2007 Nutrient Requirements of Small Ruminants
 * Species: Sheep (Ovis aries) — meat, wool, dairy breeds
 *
 * Two modes:
 *   static  — lookup from pre-built NRC 2007 tables
 *   dynamic — calculate from animal inputs using NRC 2007 equations
 *
 * CRITICAL: Sheep are highly sensitive to Cu toxicity.
 * Max dietary Cu: 15 ppm total diet. Engine enforces 7 ppm recommendation.
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
// BREED ADJUSTMENTS — NRC 2007 Sheep
// Wool breeds: higher sulfur (cysteine for wool keratin)
// Dairy sheep: higher energy/protein multiplier when lactating
// ═══════════════════════════════════════════════════════════════════════════
const WOOL_BREEDS = new Set(['merino','rambouillet','corriedale','polwarth','booroola_merino','debouillet','peppin_merino']);
const DAIRY_SHEEP_BREEDS = new Set(['lacaune','awassi','awassi_dairy','east_friesian','british_friesland','chios','comisana','sarda','manchega']);

function getSheepBreedProfile(breed) {
  const b = String(breed || 'generic').toLowerCase().replace(/[\s-]/g, '_');
  if (WOOL_BREEDS.has(b)) return { s_boost: 0.06, label_prefix: breed };  // +0.06% S for wool
  if (DAIRY_SHEEP_BREEDS.has(b)) return { energy_factor: 1.05, protein_factor: 1.05, label_prefix: breed };
  return { label_prefix: breed && breed !== 'generic' ? breed : null };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATIC TABLES — NRC 2007 SHEEP
// ═══════════════════════════════════════════════════════════════════════════
const STATIC_REQUIREMENTS = {

  ewe_maintenance: {
    label: "Ewe — Maintenance (non-pregnant, non-lactating)",
    production: "ewe", phase: "maintenance",
    energy: { me_mcal_kg: 1.96, tdn: 55 },
    protein: { cp: 9.0, mp_g_day: 65, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 40, adf_min: 26 },
    minerals: {
      ca: 0.20, p: 0.16, mg: 0.12, k: 0.50, na: 0.09, cl: 0.10, s: 0.14,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20, mo_ppm: 0.50,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_early_gestation: {
    label: "Ewe — Early Gestation (first 15 weeks)",
    production: "ewe", phase: "early_gestation",
    energy: { me_mcal_kg: 2.07, tdn: 58 },
    protein: { cp: 9.5, mp_g_day: 70, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 38, adf_min: 24 },
    minerals: {
      ca: 0.27, p: 0.19, mg: 0.12, k: 0.50, na: 0.09, cl: 0.10, s: 0.14,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_late_gestation_single: {
    label: "Ewe — Late Gestation Single Lamb (last 6 weeks)",
    production: "ewe", phase: "late_gestation_single",
    energy: { me_mcal_kg: 2.50, tdn: 70 },
    protein: { cp: 12.0, mp_g_day: 100, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 30, adf_min: 20 },
    minerals: {
      ca: 0.47, p: 0.30, mg: 0.18, k: 0.60, na: 0.09, cl: 0.10, s: 0.18,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.30, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 30 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_late_gestation_twins: {
    label: "Ewe — Late Gestation Twins/Triplets (last 6 weeks)",
    production: "ewe", phase: "late_gestation_twins",
    energy: { me_mcal_kg: 2.68, tdn: 75 },
    protein: { cp: 13.5, mp_g_day: 115, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 28, adf_min: 18 },
    minerals: {
      ca: 0.56, p: 0.36, mg: 0.20, k: 0.65, na: 0.09, cl: 0.10, s: 0.18,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.30, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 30 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_early_lactation_single: {
    label: "Ewe — Early Lactation Single Lamb (first 8 weeks)",
    production: "ewe", phase: "early_lactation_single",
    energy: { me_mcal_kg: 2.86, tdn: 80 },
    protein: { cp: 14.5, mp_g_day: 130, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 25, adf_min: 17 },
    minerals: {
      ca: 0.58, p: 0.38, mg: 0.18, k: 0.65, na: 0.14, cl: 0.15, s: 0.20,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.30, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_early_lactation_twins: {
    label: "Ewe — Early Lactation Twins (first 8 weeks)",
    production: "ewe", phase: "early_lactation_twins",
    energy: { me_mcal_kg: 3.04, tdn: 85 },
    protein: { cp: 16.0, mp_g_day: 145, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 22, adf_min: 15 },
    minerals: {
      ca: 0.66, p: 0.43, mg: 0.20, k: 0.70, na: 0.14, cl: 0.15, s: 0.20,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.30, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  lamb_growing: {
    label: "Lamb — Growing (20-40 kg, ADG 200-300g/day)",
    production: "lamb", phase: "growing",
    energy: { me_mcal_kg: 2.50, tdn: 70 },
    protein: { cp: 14.0, mp_g_day: 130, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 25, adf_min: 17 },
    minerals: {
      ca: 0.45, p: 0.28, mg: 0.12, k: 0.55, na: 0.10, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  lamb_finishing: {
    label: "Lamb — Finishing (30-50 kg, ADG 300-400g/day)",
    production: "lamb", phase: "finishing",
    energy: { me_mcal_kg: 2.86, tdn: 80 },
    protein: { cp: 13.5, mp_g_day: 155, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 18, adf_min: 12 },
    minerals: {
      ca: 0.40, p: 0.26, mg: 0.12, k: 0.55, na: 0.10, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ram_maintenance: {
    label: "Ram — Maintenance",
    production: "ram", phase: "maintenance",
    energy: { me_mcal_kg: 2.07, tdn: 58 },
    protein: { cp: 9.5, mp_g_day: 75, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 38, adf_min: 24 },
    minerals: {
      ca: 0.22, p: 0.17, mg: 0.12, k: 0.50, na: 0.09, cl: 0.10, s: 0.14,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ram_breeding: {
    label: "Ram — Breeding Season",
    production: "ram", phase: "breeding",
    energy: { me_mcal_kg: 2.32, tdn: 65 },
    protein: { cp: 11.0, mp_g_day: 90, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 32, adf_min: 21 },
    minerals: {
      ca: 0.30, p: 0.20, mg: 0.12, k: 0.55, na: 0.09, cl: 0.10, s: 0.14,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  // ── Additional phases to match UI phase options ──────────────────────────

  ewe_flushing: {
    label: "Ewe — Flushing / Pre-mating (2-3 weeks)",
    production: "ewe", phase: "flushing",
    // NRC 2007: ~15% energy boost above maintenance to elevate ovulation rate
    energy: { me_mcal_kg: 2.32, tdn: 65 },
    protein: { cp: 10.5, mp_g_day: 85, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 35, adf_min: 22 },
    minerals: {
      ca: 0.25, p: 0.18, mg: 0.12, k: 0.55, na: 0.09, cl: 0.10, s: 0.14,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.20, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  ewe_late_lactation: {
    label: "Ewe — Late Lactation (6-12 weeks, declining milk)",
    production: "ewe", phase: "late_lactation",
    // NRC 2007: moderate milk yield 0.5-1 L/day; Ca/P lower than peak
    energy: { me_mcal_kg: 2.32, tdn: 65 },
    protein: { cp: 11.0, mp_g_day: 95, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 30, adf_min: 20 },
    minerals: {
      ca: 0.42, p: 0.28, mg: 0.15, k: 0.60, na: 0.12, cl: 0.12, s: 0.16,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.20, fe_ppm: 30,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    },
    vitamins: { vit_a: 1540, vit_d: 275, vit_e: 15 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  lamb_creep: {
    label: "Lamb — Creep (Pre-weaning, 0-8 weeks)",
    production: "lamb", phase: "creep",
    // NRC 2007: high-energy starter alongside dam's milk; digestible, fine-particle
    energy: { me_mcal_kg: 3.04, tdn: 85 },
    protein: { cp: 18.0, mp_g_day: 150, rdp_pct_cp: 55, rup_pct_cp: 45 },
    fiber: { ndf_min: 15, adf_min: 10 },
    minerals: {
      ca: 0.50, p: 0.32, mg: 0.14, k: 0.55, na: 0.10, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.20, fe_ppm: 40,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 25,
    },
    vitamins: { vit_a: 2200, vit_d: 550, vit_e: 25 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },

  lamb_starter: {
    label: "Lamb — Starter (Weaning to 20 kg)",
    production: "lamb", phase: "starter",
    // NRC 2007: transition from milk to solid feed; high CP for lean gain
    energy: { me_mcal_kg: 2.86, tdn: 80 },
    protein: { cp: 17.0, mp_g_day: 140, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 18, adf_min: 12 },
    minerals: {
      ca: 0.48, p: 0.30, mg: 0.12, k: 0.55, na: 0.10, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 35,
      mn_ppm: 20, se_ppm: 0.10, zn_ppm: 22,
    },
    vitamins: { vit_a: 1800, vit_d: 400, vit_e: 20 },
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  },
};

const PHASE_MAP = {
  maintenance: 'ewe_maintenance',
  flushing: 'ewe_flushing',
  pre_mating: 'ewe_flushing',
  early_gestation: 'ewe_early_gestation',
  late_gestation: 'ewe_late_gestation_single',
  late_gestation_single: 'ewe_late_gestation_single',
  late_gestation_twins: 'ewe_late_gestation_twins',
  early_lactation: 'ewe_early_lactation_single',
  early_lactation_single: 'ewe_early_lactation_single',
  early_lactation_twins: 'ewe_early_lactation_twins',
  lactating: 'ewe_early_lactation_single',
  late_lactation: 'ewe_late_lactation',
  creep: 'lamb_creep',
  starter: 'lamb_starter',
  grower: 'lamb_growing',
  growing: 'lamb_growing',
  finisher: 'lamb_finishing',
  finishing: 'lamb_finishing',
  ram: 'ram_maintenance',
  ram_maintenance: 'ram_maintenance',
  ram_breeding: 'ram_breeding',
  breeding: 'ram_breeding',
  ewe: 'ewe_maintenance',
  lamb: 'lamb_growing',
};

function resolvePhaseKey(production, phase) {
  const pr = String(production || '').toLowerCase();
  const ph = String(phase || '').toLowerCase();
  const combined = `${pr}_${ph}`;
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[ph]) return PHASE_MAP[ph];
  if (pr === 'ram') return phase === 'breeding' ? 'ram_breeding' : 'ram_maintenance';
  if (pr === 'lamb') return ph === 'finishing' ? 'lamb_finishing' : 'lamb_growing';
  return 'ewe_maintenance';
}

function resolveStatic(context) {
  const phaseKey = resolvePhaseKey(context.production, context.phase);
  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };
  const bp = getSheepBreedProfile(context.breed);
  const ef = bp.energy_factor || 1.0;
  const pf = bp.protein_factor || 1.0;
  const sb = bp.s_boost || 0;
  const breedLabel = bp.label_prefix
    ? `${String(bp.label_prefix).charAt(0).toUpperCase() + String(bp.label_prefix).slice(1).replace(/_/g,' ')} — ${table.label}`
    : table.label;
  return {
    ok: true, mode: 'static', standard: 'NRC_2007_Sheep',
    phase_key: phaseKey, breed_used: context.breed || 'generic', label: breedLabel,
    cu_warning: table.cu_warning,
    me_mcal_kg: table.energy?.me_mcal_kg != null ? round(table.energy.me_mcal_kg * ef, 3) : null,
    tdn: table.energy?.tdn != null ? round(table.energy.tdn * ef, 1) : null,
    cp: table.protein?.cp != null ? round(table.protein.cp * pf, 2) : null,
    mp_g_day: table.protein?.mp_g_day != null ? round(table.protein.mp_g_day * pf, 0) : null,
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
    s: table.minerals?.s != null ? round(table.minerals.s + sb, 3) : null,
    co_ppm: table.minerals?.co_ppm ?? null,
    cu_ppm: table.minerals?.cu_ppm ?? null,
    i_ppm: table.minerals?.i_ppm ?? null,
    fe_ppm: table.minerals?.fe_ppm ?? null,
    mn_ppm: table.minerals?.mn_ppm ?? null,
    se_ppm: table.minerals?.se_ppm ?? null,
    zn_ppm: table.minerals?.zn_ppm ?? null,
    mo_ppm: table.minerals?.mo_ppm ?? null,
    vit_a: table.vitamins?.vit_a ?? null,
    vit_d: table.vitamins?.vit_d ?? null,
    vit_e: table.vitamins?.vit_e ?? null,
  };
}

function resolveDynamic(context) {
  const bw_kg = num(context.bw_kg, 70);
  const adg_kg = num(context.adg_kg, 0);
  const milk_kg_day = num(context.milk_kg_day, 0);
  const days_pregnant = num(context.days_pregnant, 0);
  const bp = getSheepBreedProfile(context.breed);
  const ef = bp.energy_factor || 1.0;
  const pf = bp.protein_factor || 1.0;
  const sb = bp.s_boost || 0;

  const mem = 0.109 * Math.pow(bw_kg, 0.75);
  const me_milk = milk_kg_day * (0.376 * 6.0 + 0.209 * 5.5 + 0.948 * 4.5) / 0.644;
  const me_gain = adg_kg * 2.0 / 0.45;
  const me_preg = days_pregnant > 100 ? 0.4 : 0;
  const me_total = (mem + me_milk + me_gain + me_preg) * ef;
  const dmi_kg = Math.max(0.5, Math.min(3.0, bw_kg * 0.035));
  const me_mcal_kg = round(me_total / dmi_kg, 3);
  const mp = (1.8 * Math.pow(bw_kg, 0.75) + adg_kg * 233 + milk_kg_day * 47) * pf;
  const cp = round(mp / (dmi_kg * 10 * 0.65), 2);

  let phase_label = 'Maintenance';
  if (milk_kg_day > 0) phase_label = `Lactating (${milk_kg_day} kg/d)`;
  else if (adg_kg > 0) phase_label = `Growing (ADG ${adg_kg} kg)`;
  else if (days_pregnant > 100) phase_label = 'Late Gestation';

  const breedLabel = bp.label_prefix
    ? `${String(bp.label_prefix).charAt(0).toUpperCase() + String(bp.label_prefix).slice(1).replace(/_/g,' ')} — Dynamic Sheep ${phase_label} (${bw_kg} kg BW)`
    : `Dynamic — Sheep ${phase_label} (${bw_kg} kg BW)`;

  return {
    ok: true, mode: 'dynamic', standard: 'NRC_2007_Sheep',
    breed_used: context.breed || 'generic', label: breedLabel,
    inputs: { bw_kg, adg_kg, milk_kg_day, days_pregnant },
    me_mcal_kg, tdn: round(me_mcal_kg / 0.0356, 1),
    cp, mp_g_day: round(mp, 0),
    rup: milk_kg_day > 0 ? 40 : 35, rdp: milk_kg_day > 0 ? 60 : 65,
    ndf: milk_kg_day > 0 ? 25 : 38, adf: milk_kg_day > 0 ? 17 : 24,
    ca: round((0.0154 * bw_kg + milk_kg_day * 1.2 + adg_kg * 10) / (dmi_kg * 1000) * 100 / 0.45, 3),
    total_p: round((0.018 * bw_kg + milk_kg_day * 0.9 + adg_kg * 5) / (dmi_kg * 1000) * 100 / 0.68, 3),
    mg: 0.18, k: 0.65, na: 0.09, cl: 0.10, s: round(0.16 + sb, 3),
    co_ppm: 0.10, cu_ppm: 7, i_ppm: 0.10, fe_ppm: 30,
    mn_ppm: 20, se_ppm: 0.10, zn_ppm: 20,
    vit_a: 1540, vit_d: 275, vit_e: 15,
    cu_warning: "Max 15 ppm Cu total diet — sheep Cu toxicity risk",
  };
}

function resolveSheepRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();
  try {
    return mode === 'dynamic' ? resolveDynamic(context) : resolveStatic(context);
  } catch (e) {
    return { ok: false, error: 'SHEEP_ENGINE_ERROR', message: e.message, mode };
  }
}

module.exports = { resolveSheepRequirements, STATIC_REQUIREMENTS };
