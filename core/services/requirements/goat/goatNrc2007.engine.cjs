"use strict";
/**
 * Goat NRC 2007 Requirements Engine
 * Source: NRC 2007 Nutrient Requirements of Small Ruminants
 * Species: Goats (Capra hircus) — dairy, meat (Boer), fiber (Angora/Cashmere)
 *
 * Two modes:
 *   static  — lookup from pre-built NRC 2007 tables
 *   dynamic — calculate from animal inputs using NRC 2007 equations
 *
 * Note: Goats tolerate higher Cu than sheep (max ~50 ppm vs 15 ppm)
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
// BREED ADJUSTMENTS — NRC 2007 Goat
// Dairy breeds: higher energy/protein multiplier for milk
// Fiber breeds (Angora/Cashmere): higher sulfur for mohair/cashmere keratin
// ═══════════════════════════════════════════════════════════════════════════
const DAIRY_GOAT_BREEDS = new Set([
  'saanen','alpine','nubian','lamancha','la_mancha','toggenburg','oberhasli',
  'alpine_dairy','british_alpine','british_saanen','sable','boer_dairy',
  'beetal_dairy','murciana_granadina','maltese'
]);
const FIBER_GOAT_BREEDS = new Set(['angora','cashmere','cashgora','nigora']);

function getGoatBreedProfile(breed) {
  const b = String(breed || 'generic').toLowerCase().replace(/[\s-]/g, '_');
  if (DAIRY_GOAT_BREEDS.has(b)) return { energy_factor: 1.05, protein_factor: 1.05, label_prefix: breed };
  if (FIBER_GOAT_BREEDS.has(b)) return { s_boost: 0.04, label_prefix: breed }; // +0.04% S for fiber
  return { label_prefix: breed && breed !== 'generic' ? breed : null };
}

const STATIC_REQUIREMENTS = {

  doe_maintenance: {
    label: "Doe — Maintenance (non-pregnant, non-lactating)",
    production: "doe", phase: "maintenance",
    energy: { me_mcal_kg: 2.07, tdn: 58 },
    protein: { cp: 9.5, mp_g_day: 68, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 38, adf_min: 24 },
    minerals: {
      ca: 0.22, p: 0.16, mg: 0.12, k: 0.65, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  doe_early_gestation: {
    label: "Doe — Early Gestation (first 15 weeks)",
    production: "doe", phase: "early_gestation",
    energy: { me_mcal_kg: 2.14, tdn: 60 },
    protein: { cp: 10.0, mp_g_day: 72, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 36, adf_min: 23 },
    minerals: {
      ca: 0.28, p: 0.20, mg: 0.14, k: 0.65, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  doe_late_gestation: {
    label: "Doe — Late Gestation (last 6 weeks)",
    production: "doe", phase: "late_gestation",
    energy: { me_mcal_kg: 2.50, tdn: 70 },
    protein: { cp: 12.5, mp_g_day: 105, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 30, adf_min: 20 },
    minerals: {
      ca: 0.52, p: 0.32, mg: 0.18, k: 0.70, na: 0.09, cl: 0.10, s: 0.18,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 30 },
  },

  doe_early_lactation: {
    label: "Doe — Early Lactation (2-3 kg/day milk)",
    production: "doe", phase: "early_lactation",
    energy: { me_mcal_kg: 2.68, tdn: 75 },
    protein: { cp: 14.0, mp_g_day: 135, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 25, adf_min: 17 },
    minerals: {
      ca: 0.52, p: 0.36, mg: 0.20, k: 0.80, na: 0.14, cl: 0.15, s: 0.20,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.20, zn_ppm: 45,   // NRC 2007: Se 0.20 ppm, Zn 40-50 for lactation
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  doe_peak_lactation: {
    label: "Doe — Peak Lactation Dairy (3-4 kg/day milk)",
    production: "doe", phase: "peak_lactation",
    energy: { me_mcal_kg: 2.86, tdn: 80 },
    protein: { cp: 15.5, mp_g_day: 155, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 22, adf_min: 15 },
    minerals: {
      ca: 0.60, p: 0.40, mg: 0.22, k: 0.85, na: 0.18, cl: 0.20, s: 0.22,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.20, zn_ppm: 45,   // NRC 2007: Se 0.20 ppm, Zn 40-50 for lactation
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  doe_late_lactation: {
    label: "Doe — Late Lactation (1-2 kg/day milk)",
    production: "doe", phase: "late_lactation",
    energy: { me_mcal_kg: 2.32, tdn: 65 },
    protein: { cp: 12.0, mp_g_day: 105, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 30, adf_min: 20 },
    minerals: {
      ca: 0.42, p: 0.30, mg: 0.18, k: 0.75, na: 0.12, cl: 0.12, s: 0.18,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.15, zn_ppm: 40,   // NRC 2007: Se 0.15, Zn 40 for late lactation
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  kid_growing: {
    label: "Kid — Growing Meat (15-30 kg, ADG 150-200g/day)",
    production: "kid", phase: "growing",
    energy: { me_mcal_kg: 2.50, tdn: 70 },
    protein: { cp: 14.0, mp_g_day: 115, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 25, adf_min: 17 },
    minerals: {
      ca: 0.45, p: 0.28, mg: 0.14, k: 0.65, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  kid_finishing: {
    label: "Kid — Finishing Meat (25-45 kg, ADG 200-300g/day)",
    production: "kid", phase: "finishing",
    energy: { me_mcal_kg: 2.68, tdn: 75 },
    protein: { cp: 13.0, mp_g_day: 130, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 20, adf_min: 13 },
    minerals: {
      ca: 0.40, p: 0.26, mg: 0.12, k: 0.60, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  buck_maintenance: {
    label: "Buck — Maintenance",
    production: "buck", phase: "maintenance",
    energy: { me_mcal_kg: 2.07, tdn: 58 },
    protein: { cp: 10.0, mp_g_day: 75, rdp_pct_cp: 65, rup_pct_cp: 35 },
    fiber: { ndf_min: 38, adf_min: 24 },
    minerals: {
      ca: 0.22, p: 0.16, mg: 0.12, k: 0.65, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  buck_breeding: {
    label: "Buck — Breeding Season",
    production: "buck", phase: "breeding",
    energy: { me_mcal_kg: 2.32, tdn: 65 },
    protein: { cp: 11.5, mp_g_day: 95, rdp_pct_cp: 62, rup_pct_cp: 38 },
    fiber: { ndf_min: 30, adf_min: 20 },
    minerals: {
      ca: 0.30, p: 0.20, mg: 0.14, k: 0.70, na: 0.09, cl: 0.10, s: 0.16,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 35,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  // ── Additional phases to match UI phase options ──────────────────────────

  doe_mid_lactation: {
    label: "Doe — Mid Lactation (2-3 months, 2-3 kg/day milk)",
    production: "doe", phase: "mid_lactation",
    // NRC 2007: between early and late lactation; milk ~2-3 kg/day
    energy: { me_mcal_kg: 2.50, tdn: 70 },
    protein: { cp: 13.0, mp_g_day: 120, rdp_pct_cp: 60, rup_pct_cp: 40 },
    fiber: { ndf_min: 28, adf_min: 18 },
    minerals: {
      ca: 0.50, p: 0.34, mg: 0.20, k: 0.80, na: 0.14, cl: 0.15, s: 0.20,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
      mn_ppm: 30, se_ppm: 0.18, zn_ppm: 42,
    },
    vitamins: { vit_a: 2000, vit_d: 275, vit_e: 20 },
  },

  kid_milk_fed: {
    label: "Kid — Milk-Fed (Pre-ruminant, 0-8 weeks)",
    production: "kid", phase: "milk_fed",
    // NRC 2007: high digestibility, essentially milk-replacer diet formulation
    energy: { me_mcal_kg: 3.21, tdn: 90 },
    protein: { cp: 20.0, mp_g_day: 170, rdp_pct_cp: 50, rup_pct_cp: 50 },
    fiber: { ndf_min: 10, adf_min: 6 },
    minerals: {
      ca: 0.70, p: 0.45, mg: 0.16, k: 0.65, na: 0.10, cl: 0.10, s: 0.18,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 40,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 40,
    },
    vitamins: { vit_a: 3000, vit_d: 600, vit_e: 30 },
  },

  kid_starter: {
    label: "Kid — Starter (8-16 weeks, transitioning ruminant)",
    production: "kid", phase: "starter",
    // NRC 2007: weaning transition; high CP, moderate NDF to develop rumen
    energy: { me_mcal_kg: 2.86, tdn: 80 },
    protein: { cp: 16.0, mp_g_day: 130, rdp_pct_cp: 58, rup_pct_cp: 42 },
    fiber: { ndf_min: 18, adf_min: 12 },
    minerals: {
      ca: 0.55, p: 0.36, mg: 0.14, k: 0.65, na: 0.09, cl: 0.10, s: 0.18,
      co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 35,
      mn_ppm: 30, se_ppm: 0.10, zn_ppm: 38,
    },
    vitamins: { vit_a: 2500, vit_d: 500, vit_e: 25 },
  },
};

const PHASE_MAP = {
  maintenance: 'doe_maintenance',
  early_gestation: 'doe_early_gestation',
  late_gestation: 'doe_late_gestation',
  early_lactation: 'doe_early_lactation',
  lactating: 'doe_early_lactation',
  peak_lactation: 'doe_peak_lactation',
  mid_lactation: 'doe_mid_lactation',
  late_lactation: 'doe_late_lactation',
  milk_fed: 'kid_milk_fed',
  starter: 'kid_starter',
  grower: 'kid_growing',
  growing: 'kid_growing',
  finisher: 'kid_finishing',
  finishing: 'kid_finishing',
  buck: 'buck_maintenance',
  buck_maintenance: 'buck_maintenance',
  buck_breeding: 'buck_breeding',
  breeding: 'buck_breeding',
  doe: 'doe_maintenance',
  kid: 'kid_growing',
};

function resolvePhaseKey(production, phase) {
  const pr = String(production || '').toLowerCase();
  const ph = String(phase || '').toLowerCase();
  const combined = `${pr}_${ph}`;
  if (STATIC_REQUIREMENTS[combined]) return combined;
  if (PHASE_MAP[combined]) return PHASE_MAP[combined];
  if (PHASE_MAP[ph]) return PHASE_MAP[ph];
  if (pr === 'buck') return ph === 'breeding' ? 'buck_breeding' : 'buck_maintenance';
  if (pr === 'kid') return ph === 'finishing' ? 'kid_finishing' : 'kid_growing';
  return 'doe_maintenance';
}

function resolveStatic(context) {
  const phaseKey = resolvePhaseKey(context.production, context.phase);
  const table = STATIC_REQUIREMENTS[phaseKey];
  if (!table) return { ok: false, error: 'PHASE_NOT_FOUND', phase: phaseKey };
  const bp = getGoatBreedProfile(context.breed);
  const ef = bp.energy_factor || 1.0;
  const pf = bp.protein_factor || 1.0;
  const sb = bp.s_boost || 0;
  const breedLabel = bp.label_prefix
    ? `${String(bp.label_prefix).charAt(0).toUpperCase() + String(bp.label_prefix).slice(1).replace(/_/g,' ')} — ${table.label}`
    : table.label;
  return {
    ok: true, mode: 'static', standard: 'NRC_2007_Goat',
    phase_key: phaseKey, breed_used: context.breed || 'generic', label: breedLabel,
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
    vit_a: table.vitamins?.vit_a ?? null,
    vit_d: table.vitamins?.vit_d ?? null,
    vit_e: table.vitamins?.vit_e ?? null,
  };
}

function resolveDynamic(context) {
  const bw_kg = num(context.bw_kg, 60);
  const adg_kg = num(context.adg_kg, 0);
  const milk_kg_day = num(context.milk_kg_day, 0);
  const fat_pct = num(context.fat_pct, 3.8);
  const protein_pct = num(context.protein_pct, 3.2);
  const days_pregnant = num(context.days_pregnant, 0);
  const bp = getGoatBreedProfile(context.breed);
  const ef = bp.energy_factor || 1.0;
  const pf = bp.protein_factor || 1.0;
  const sb = bp.s_boost || 0;

  const mem = 0.093 * Math.pow(bw_kg, 0.75);
  const milk_energy = 0.376 * fat_pct + 0.209 * protein_pct + 0.948 * 4.5;
  const me_milk = milk_kg_day * milk_energy / 0.644;
  const me_gain = adg_kg * 2.1 / 0.45;
  const me_preg = days_pregnant > 100 ? 0.45 : 0;
  const me_total = (mem + me_milk + me_gain + me_preg) * ef;
  const dmi_kg = Math.max(0.5, Math.min(3.5, bw_kg * 0.04));
  const me_mcal_kg = round(me_total / dmi_kg, 3);
  const mp = (2.2 * Math.pow(bw_kg, 0.75) + adg_kg * 233 + milk_kg_day * 47) * pf;
  const cp = round(mp / (dmi_kg * 10 * 0.65), 2);

  let phase_label = 'Maintenance';
  if (milk_kg_day > 0) phase_label = `Lactating (${milk_kg_day} kg/d)`;
  else if (adg_kg > 0) phase_label = `Growing (ADG ${adg_kg} kg)`;
  else if (days_pregnant > 100) phase_label = 'Late Gestation';

  const breedLabel = bp.label_prefix
    ? `${String(bp.label_prefix).charAt(0).toUpperCase() + String(bp.label_prefix).slice(1).replace(/_/g,' ')} — Dynamic Goat ${phase_label} (${bw_kg} kg BW)`
    : `Dynamic — Goat ${phase_label} (${bw_kg} kg BW)`;

  return {
    ok: true, mode: 'dynamic', standard: 'NRC_2007_Goat',
    breed_used: context.breed || 'generic', label: breedLabel,
    inputs: { bw_kg, adg_kg, milk_kg_day, fat_pct, protein_pct, days_pregnant, breed: context.breed || 'generic' },
    me_mcal_kg, tdn: round(me_mcal_kg / 0.0356, 1),
    cp, mp_g_day: round(mp, 0),
    rup: milk_kg_day > 2 ? 42 : 35, rdp: milk_kg_day > 2 ? 58 : 65,
    ndf: milk_kg_day > 2 ? 22 : 38, adf: milk_kg_day > 2 ? 15 : 24,
    ca: round((0.0154 * bw_kg + milk_kg_day * 1.2 + adg_kg * 10) / (dmi_kg * 1000) * 100 / 0.45, 3),
    total_p: round((0.018 * bw_kg + milk_kg_day * 0.9 + adg_kg * 5) / (dmi_kg * 1000) * 100 / 0.68, 3),
    mg: 0.20, k: 0.75, na: 0.10, cl: 0.12, s: round(0.18 + sb, 3),
    co_ppm: 0.10, cu_ppm: 15, i_ppm: 0.50, fe_ppm: 30,
    mn_ppm: 30,
    se_ppm: milk_kg_day > 0 ? 0.20 : 0.10,    // NRC 2007: 0.20 ppm during lactation
    zn_ppm: milk_kg_day > 0 ? 45 : 35,         // NRC 2007: 40-50 ppm during lactation
    vit_a: 2000, vit_d: 275, vit_e: 20,
  };
}

function resolveGoatRequirements(context = {}) {
  const mode = String(context.mode || context.requirements_mode || 'static').toLowerCase();
  try {
    return mode === 'dynamic' ? resolveDynamic(context) : resolveStatic(context);
  } catch (e) {
    return { ok: false, error: 'GOAT_ENGINE_ERROR', message: e.message, mode };
  }
}

module.exports = { resolveGoatRequirements, STATIC_REQUIREMENTS };
