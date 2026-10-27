"use strict";
/**
 * Swine PIC 2021 Requirements Engine
 * Source: PIC Nutrition and Feeding Guidelines 2021
 * Energy basis: NRC 2012
 * All SID amino acids derived from Lys:NE ratio × NE density
 */

const fs = require("fs");
const path = require("path");

const LIBRARY_PATH = path.resolve(
  __dirname,
  "../../../db/requirements/swine/v1/requirements.library.swine.v1.json"
);

let _library = null;
function getLibrary() {
  if (_library) return _library;
  try {
    const raw = fs.readFileSync(LIBRARY_PATH, "utf8");
    _library = JSON.parse(raw);
  } catch (e) {
    _library = { phases: {} };
  }
  return _library;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(d));
}

/**
 * Resolve swine requirements for a given context.
 * Returns requirements in the same format as the equine engine:
 * { sid_lys, sid_met, sid_metcys, sid_thr, sid_trp, sid_val, sid_ile, sid_leu,
 *   ne, me, ca, avp, na, ... }
 */
function resolveSwineRequirements(context) {
  const lib = getLibrary();

  // Map frontend phase keys to library phase keys
  const phaseMap = {
    grower:                    "grower",
    finisher_early:            "finisher_early",
    finisher_mid:              "finisher_mid",
    finisher_late:             "finisher_late",
    finisher_market:           "finisher_market",
    market:                    "finisher_market",
    nursery_p1:                "nursery_p1",
    nursery_p2:                "nursery_p2",
    nursery_p3:                "nursery_p3",
    weaning:                   "nursery_p1",
    gestation:                 "gestation",
    lactation:                 "lactation",
    boar:                      "boar",
    production:                "boar",
    gilt_development_early:    "gilt_development_early",
    gilt_development_mid:      "gilt_development_mid",
    gilt_development_prebreed: "gilt_development_prebreed",
    development:               "gilt_development_mid",
    prebreed:                  "gilt_development_prebreed",
    growing:                   "grower",
    finishing:                 "finisher_mid",
    receiving:                 "grower"
  };

  const phaseKey = phaseMap[String(context?.phase || "").toLowerCase()] || "grower";
  const phaseData = lib?.phases?.[phaseKey];

  if (!phaseData) {
    return { ok: false, message: `No swine requirements found for phase: ${phaseKey}` };
  }

  const ne_kcal_kg = num(phaseData?.energy?.ne_kcal_kg, 2365);
  const me_kcal_kg = num(phaseData?.energy?.me_kcal_kg, 3175);
  const ne_mcal_kg = ne_kcal_kg / 1000;
  const me_mcal_kg = me_kcal_kg / 1000;

  const feed_intake_kg_day = num(
    context?.body_weight_kg || phaseData?.feed_intake_reference_kg_day,
    phaseData?.feed_intake_reference_kg_day || 1.8
  );

  // ── SID Amino Acids ──────────────────────────────────────────
  const aa = phaseData?.sid_amino_acids || {};

  // If lys_pct is directly specified use it, otherwise calculate from NE ratio
  let sid_lys_pct;
  if (aa.lys_pct && num(aa.lys_pct) > 0) {
    sid_lys_pct = round(num(aa.lys_pct), 4);
  } else {
    const lys_ne_ratio = num(aa.lys_ne_ratio_g_mcal, 4.74); // g Lys / Mcal NE
    // sid_lys% = (lys_ne_ratio × ne_mcal_kg) / 10
    sid_lys_pct = round((lys_ne_ratio * ne_mcal_kg) / 10, 4);
  }

  const ratios = aa.ratios_to_lys || {};
  const r = (key, fallback) => round(sid_lys_pct * num(ratios[key], fallback) / 100, 4);

  const sid_met_cys_pct = r("met_cys", 58);
  const sid_thr_pct     = r("thr", 65);
  const sid_trp_pct     = r("trp", 18);
  const sid_val_pct     = r("val", 68);
  const sid_ile_pct     = r("ile", 56);
  const sid_leu_pct     = r("leu", 101);
  const sid_his_pct     = r("his", 34);

  // Met alone ≈ 35% of Met+Cys
  const sid_met_pct = round(sid_met_cys_pct * 0.35, 4);

  // ── Proximate ────────────────────────────────────────────────
  const cp_pct = num(phaseData?.proximate?.cp_pct, null) || null;

  // ── Minerals ─────────────────────────────────────────────────
  const min = phaseData?.minerals || {};
  const sttd_p_pct = (() => {
    if (min.sttd_p_pct) return num(min.sttd_p_pct);
    if (min.sttd_p_ne_ratio_g_mcal) return round(num(min.sttd_p_ne_ratio_g_mcal) * ne_mcal_kg / 10, 3);
    if (min.sttd_p_me_ratio_g_mcal) return round(num(min.sttd_p_me_ratio_g_mcal) * me_mcal_kg / 10, 3);
    return 0.30;
  })();

  const ca_pct = round(sttd_p_pct * num(min.ca_to_p_ratio?.min || 1.25), 3);
  const na_pct = round(num(min.sodium_pct, 0.25), 3);
  const cl_pct = round(num(min.chloride_pct, 0.25), 3);

  // ── Build requirements profile ────────────────────────────────
  const reqs = {
    ok: true,
    species: "swine",
    phase: phaseKey,
    phase_label: phaseData.label,
    standard: "PIC_2021",
    energy_system: "NE",
    feed_intake_reference_kg_day: feed_intake_kg_day,

    // Proximate
    cp_pct: cp_pct != null ? round(cp_pct, 2) : undefined,

    // Energy
    ne:    round(ne_kcal_kg, 0),
    ne_kcal_kg: round(ne_kcal_kg, 0),
    me:    round(me_kcal_kg, 0),
    me_kcal_kg: round(me_kcal_kg, 0),

    // SID Amino Acids — percent of diet
    sid_lys:     sid_lys_pct,
    sid_met:     sid_met_pct,
    sid_metcys:  sid_met_cys_pct,
    sid_met_cys: sid_met_cys_pct,
    sid_thr:     sid_thr_pct,
    sid_trp:     sid_trp_pct,
    sid_val:     sid_val_pct,
    sid_ile:     sid_ile_pct,
    sid_leu:     sid_leu_pct,
    sid_his:     sid_his_pct,

    // Minerals
    sttd_p:  sttd_p_pct,
    avp:     sttd_p_pct,
    ca:      ca_pct,
    na:      na_pct,
    cl:      cl_pct,

    // Trace minerals (ppm)
    zn_ppm: num(phaseData?.trace_minerals_added_ppm?.zn, 100),
    fe_ppm: num(phaseData?.trace_minerals_added_ppm?.fe, 100),
    mn_ppm: num(phaseData?.trace_minerals_added_ppm?.mn, 40),
    cu_ppm: num(phaseData?.trace_minerals_added_ppm?.cu, 15),
    se_ppm: num(phaseData?.trace_minerals_added_ppm?.se, 0.30),

    // Raw phase data for reference
    _phase_data: phaseData
  };

  // Return only nutrient fields — strip metadata
const { ok, species, phase, phase_label, standard, energy_system,
        feed_intake_reference_kg_day, _phase_data, ...nutrientTargets } = reqs;
return { ok, ...nutrientTargets };
}

/**
 * Format requirements as target profile rows
 * (same structure analyzeFormula expects)
 */
function getSwineTargetProfile(context) {
  const reqs = resolveSwineRequirements(context);
  if (!reqs.ok) return [];

  const rows = [];

  const addRow = (key, label, target, unit = "%") => {
    if (target == null || !Number.isFinite(Number(target))) return;
    rows.push({
      key,
      label,
      target: round(Number(target), 4),
      min: null,
      max: null,
      unit,
      source: "PIC_2021"
    });
  };

  // Energy
  addRow("ne",      "NE (kcal/kg)",     reqs.ne_kcal_kg, "kcal/kg");
  addRow("me",      "ME (kcal/kg)",     reqs.me_kcal_kg, "kcal/kg");

  // SID Amino Acids
  addRow("sid_lys",     "SID Lysine",         reqs.sid_lys);
  addRow("sid_met",     "SID Methionine",      reqs.sid_met);
  addRow("sid_metcys",  "SID Met+Cys",         reqs.sid_metcys);
  addRow("sid_thr",     "SID Threonine",       reqs.sid_thr);
  addRow("sid_trp",     "SID Tryptophan",      reqs.sid_trp);
  addRow("sid_val",     "SID Valine",          reqs.sid_val);
  addRow("sid_ile",     "SID Isoleucine",      reqs.sid_ile);
  addRow("sid_leu",     "SID Leucine",         reqs.sid_leu);

  // Minerals
  addRow("avp",   "Avail. Phosphorus",  reqs.avp);
  addRow("ca",    "Calcium",            reqs.ca);
  addRow("na",    "Sodium",             reqs.na);
  addRow("cl",    "Chloride",           reqs.cl);

  return rows;
}

module.exports = {
  resolveSwineRequirements,
  getSwineTargetProfile
};
