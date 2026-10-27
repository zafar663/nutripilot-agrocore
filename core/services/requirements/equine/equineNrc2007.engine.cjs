"use strict";

/**
 * Equine NRC 2007 Dynamic Requirement Engine - v2
 *
 * Primary basis:
 * NRC 2007 Nutrient Requirements of Horses, 6th revised edition.
 * National Academies Press, Washington DC.
 *
 * v2 implemented:
 * - Adult maintenance (BW-scaled equations)
 * - Performance / work (light / moderate / heavy / very_heavy)
 * - Growth: foal, weanling, yearling (age + mature BW based)
 * - Reproduction: pregnant mare (gestation month 1-11)
 * - Lactation: lactating mare (month 1-6+)
 * - Senior: maintenance + practical adjustments
 * - Metabolic: low-NSC safety limits
 * - Full macro minerals: Ca, P, Mg, Na, Cl, K, S
 * - Full trace minerals: Cu, Zn, Mn, Fe, Se, I, Co
 * - Vitamins: A, D, E
 * - All nutrients expressed as g/day AND diet % / ppm / IU/kg
 * - Ca:P ratio enforced
 */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function numz(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function round(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(d));
}

function safeDiv(a, b) {
  a = Number(a);
  b = Number(b);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

function pctFromGDay(gDay, dmiKgDay) {
  return round(safeDiv(gDay, dmiKgDay * 1000) * 100, 3);
}

function gDayFromPct(pct, dmiKgDay) {
  return round(pct / 100 * dmiKgDay * 1000, 1);
}

function ppmFromMgDay(mgDay, dmiKgDay) {
  return round(safeDiv(mgDay, dmiKgDay), 2);
}

function iuKgFromIuDay(iuDay, dmiKgDay) {
  return round(safeDiv(iuDay, dmiKgDay), 0);
}

function mgKgFromMgDay(mgDay, dmiKgDay) {
  return round(safeDiv(mgDay, dmiKgDay), 3);
}

// ─────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────
function maintenanceDeMcalDay(bodyWeightKg, maintenanceClass) {
  const avg = 1.4 + 0.03 * bodyWeightKg;
  const cls = String(maintenanceClass || "average").toLowerCase();
  const factor = cls === "low" ? 0.9 : cls === "high" ? 1.1 : 1.0;
  return avg * factor;
}

function adjustDeForHorseType(deMcalDay, horseType) {
  const t = String(horseType || "horse").toLowerCase();
  if (t === "pony")     return deMcalDay * 0.85;
  if (t === "donkey")   return deMcalDay * 0.75;
  if (t === "mule")     return deMcalDay * 0.87;
  if (t === "draft")    return deMcalDay * 1.10;
  if (t === "miniature") return deMcalDay * 0.70;
  return deMcalDay;
}

// ─────────────────────────────────────────────
// WORK FACTORS (NRC 2007 Table 1-1)
// ─────────────────────────────────────────────
function workFactor(workLevel) {
  const w = String(workLevel || "").toLowerCase();
  if (w === "light")      return 1.20;
  if (w === "moderate")   return 1.40;
  if (w === "heavy")      return 1.60;
  if (w === "very_heavy" || w === "intense") return 1.90;
  return 1.00;
}

function cpWorkFactor(workLevel) {
  const w = String(workLevel || "").toLowerCase();
  if (w === "light")      return 1.10;
  if (w === "moderate")   return 1.20;
  if (w === "heavy")      return 1.25;
  if (w === "very_heavy") return 1.30;
  return 1.00;
}

// ─────────────────────────────────────────────
// DMI ESTIMATE
// ─────────────────────────────────────────────
function estimateDmiKgDay(bodyWeightKg, intakePctBw) {
  return bodyWeightKg * (num(intakePctBw, 2.0) / 100);
}

// ─────────────────────────────────────────────
// GROWTH EQUATIONS (NRC 2007 Chapter 2)
// Foal: 0-6 months, Weanling: 6-12 months, Yearling: 12-24 months
// ─────────────────────────────────────────────
function growthDeMcalDay(bodyWeightKg, matureWeightKg, ageMonths) {
  const mw  = num(matureWeightKg, 500);
  const bw  = num(bodyWeightKg, 200);
  const age = num(ageMonths, 12);
  const maintenanceDE = 1.4 + 0.03 * bw;
  // NRC 2007 Chapter 2: growth energy based on age and mature BW fraction
  const mwFraction = safeDiv(bw, mw);
  let growthFactor = 1.0;
  if (age <= 3)       growthFactor = 2.10; // nursing foal
  else if (age <= 6)  growthFactor = 1.85; // late nursing
  else if (age <= 12) growthFactor = 1.55; // weanling
  else if (age <= 18) growthFactor = 1.35; // yearling early
  else if (age <= 24) growthFactor = 1.20; // yearling late
  else                growthFactor = 1.10; // long yearling
  // Correction: smaller fraction of mature BW = more energy per kg
  const correction = mwFraction < 0.5 ? 1.05 : 1.0;
  return maintenanceDE * growthFactor * correction;
}

// ─────────────────────────────────────────────
// REPRODUCTION (NRC 2007 Chapter 4)
// Gestation month 1-11
// ─────────────────────────────────────────────
function gestationDeMcalDay(bodyWeightKg, gestationMonth) {
  const bw = num(bodyWeightKg, 500);
  const gm = num(gestationMonth, 9);
  const maintenance = 1.4 + 0.03 * bw;
  // NRC 2007 Table 4-1: monthly gestation energy factors
  const factors = {
    1: 1.00, 2: 1.00, 3: 1.00, 4: 1.00,
    5: 1.01, 6: 1.02, 7: 1.04, 8: 1.07,
    9: 1.11, 10: 1.13, 11: 1.20
  };
  const factor = factors[Math.min(Math.max(Math.round(gm), 1), 11)] || 1.0;
  return maintenance * factor;
}

// ─────────────────────────────────────────────
// LACTATION (NRC 2007 Chapter 5)
// Month 1-6+
// ─────────────────────────────────────────────
function lactationDeMcalDay(bodyWeightKg, lactationMonth) {
  const bw = num(bodyWeightKg, 500);
  const lm = num(lactationMonth, 1);
  const maintenance = 1.4 + 0.03 * bw;
  // NRC 2007 Table 5-1: peak early lactation, gradual decline
  const factors = {
    1: 1.78, 2: 1.75, 3: 1.70,
    4: 1.60, 5: 1.52, 6: 1.45,
    7: 1.38, 8: 1.32, 9: 1.28,
    10: 1.25, 11: 1.22, 12: 1.20
  };
  const factor = factors[Math.min(Math.max(Math.round(lm), 1), 12)] || 1.20;
  return maintenance * factor;
}

// ─────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────
function generateEquineTargets(input = {}) {
  const bodyWeightKg   = num(input.body_weight_kg, 500);
  const horseType      = String(input.horse_type || "horse").toLowerCase();
  const production     = String(input.production || "maintenance").toLowerCase();
  const maintenanceClass = input.maintenance_class || "average";
  const workLevel      = input.work_level || null;
  const intakePctBw    = num(input.intake_pct_bw, 2.0);
  const gestationMonth = numz(input.gestation_month, 9);
  const lactationMonth = numz(input.lactation_month, 1);
  const ageMonths      = numz(input.age_months, 12);
  const matureWeightKg = num(input.mature_weight_kg, bodyWeightKg);

  const dmiKgDay = estimateDmiKgDay(bodyWeightKg, intakePctBw);

  // ── DE ──────────────────────────────────────
  let deMcalDay = adjustDeForHorseType(
    maintenanceDeMcalDay(bodyWeightKg, maintenanceClass),
    horseType
  );

  if (production === "performance" || production === "work" || workLevel) {
    deMcalDay = maintenanceDeMcalDay(bodyWeightKg, maintenanceClass) * workFactor(workLevel || "light");
  } else if (production === "stallion" || production === "breeding_stallion") {
    // NRC 2007: breeding stallions treated as light-to-moderate work during season
    deMcalDay = maintenanceDeMcalDay(bodyWeightKg, maintenanceClass) * workFactor("moderate");
  } else if (production === "growth") {
    deMcalDay = growthDeMcalDay(bodyWeightKg, matureWeightKg, ageMonths);
  } else if (production === "reproduction") {
    deMcalDay = gestationDeMcalDay(bodyWeightKg, gestationMonth);
  } else if (production === "lactation") {
    deMcalDay = lactationDeMcalDay(bodyWeightKg, lactationMonth);
  } else if (production === "senior") {
    deMcalDay = maintenanceDeMcalDay(bodyWeightKg, "high"); // seniors need ~10% more
  } else if (production === "metabolic") {
    deMcalDay = maintenanceDeMcalDay(bodyWeightKg, "low"); // calorie restriction
  }

  // ── PROTEIN (CP) ────────────────────────────
  // NRC 2007: maintenance 8%, performance 10-12%, growth 14-16%, lactation 14%
  let cpPct = 8.0;
  if (production === "stallion" || production === "breeding_stallion") {
    cpPct = 9.2; // NRC 2007: breeding stallions need ~15% above maintenance
  } else if (production === "performance" || workLevel) {
    cpPct = cpWorkFactor(workLevel || "light") * 8.0;
  } else if (production === "growth") {
    cpPct = ageMonths <= 6 ? 16.0 : ageMonths <= 12 ? 14.5 : 12.5;
  } else if (production === "reproduction") {
    cpPct = gestationMonth >= 9 ? 11.0 : 10.0;
  } else if (production === "lactation") {
    cpPct = lactationMonth <= 3 ? 14.0 : 12.0;
  } else if (production === "senior") {
    cpPct = 12.0; // seniors: higher quality protein needed
  } else if (production === "metabolic") {
    cpPct = 10.0;
  }

  // ── LYSINE ──────────────────────────────────
  // NRC 2007: ~3.8% of CP for maintenance, higher for growth
  let lysPct = round(cpPct * 0.038, 3);
  if (production === "growth") lysPct = round(cpPct * 0.045, 3);
  if (production === "lactation") lysPct = round(cpPct * 0.042, 3);

  // ── MACROMINERALS ───────────────────────────
  // NRC 2007 Table 16-1 and equations
  // Ca and P scale with BW and production
  let caGDay = 0, pGDay = 0;

  if (production === "maintenance" || production === "senior" || production === "metabolic") {
    caGDay = round(0.04 * bodyWeightKg, 1);   // 40 mg/kg BW/day = 0.04 g/kg
    pGDay  = round(0.028 * bodyWeightKg, 1);  // 28 mg/kg BW/day
  } else if (production === "stallion" || production === "breeding_stallion") {
    // NRC 2007: Ca/P same as maintenance; adequate but not elevated (no fetal/milk drain)
    caGDay = round(0.04 * bodyWeightKg, 1);
    pGDay  = round(0.028 * bodyWeightKg, 1);
  } else if (production === "performance" || workLevel) {
    caGDay = round(0.04 * bodyWeightKg * workFactor(workLevel || "light") * 0.85, 1);
    pGDay  = round(caGDay * 0.75, 1);
  } else if (production === "growth") {
    caGDay = round(0.04 * bodyWeightKg * 2.0, 1);
    pGDay  = round(0.04 * bodyWeightKg * 1.5, 1);
  } else if (production === "reproduction") {
    caGDay = gestationMonth >= 9 ? round(0.04 * bodyWeightKg * 1.5, 1) : round(0.04 * bodyWeightKg, 1);
    pGDay  = round(caGDay * 0.75, 1);
  } else if (production === "lactation") {
    caGDay = lactationMonth <= 3 ? round(0.04 * bodyWeightKg * 2.2, 1) : round(0.04 * bodyWeightKg * 1.8, 1);
    pGDay  = round(caGDay * 0.75, 1);
  }

  const caPct = pctFromGDay(caGDay, dmiKgDay);
  const pPct  = pctFromGDay(pGDay, dmiKgDay);

  // Magnesium: NRC ~15 mg/kg BW/day maintenance
  const mgGDay = round(0.015 * bodyWeightKg, 1);
  const mgPct  = pctFromGDay(mgGDay, dmiKgDay);

  // Sodium: NRC 20 mg/kg BW/day maintenance; work increases
  let naGDay = round(0.020 * bodyWeightKg, 1);
  if (production === "performance" || workLevel) naGDay = round(naGDay * workFactor(workLevel || "light") * 0.7, 1);
  const naPct = pctFromGDay(naGDay, dmiKgDay);

  // Chloride: ~80 mg/kg BW/day NRC
  let clGDay = round(0.080 * bodyWeightKg, 1);
  if (production === "performance" || workLevel) clGDay = round(clGDay * 1.5, 1);
  const clPct = pctFromGDay(clGDay, dmiKgDay);

  // Potassium: NRC 50 mg/kg BW/day
  let kGDay = round(0.050 * bodyWeightKg, 1);
  if (production === "performance" || workLevel) kGDay = round(kGDay * 1.3, 1);
  const kPct = pctFromGDay(kGDay, dmiKgDay);

  // Sulfur: NRC 0.15% of DM
  const sPct = 0.15;

  // ── TRACE MINERALS (NRC 2007 Table 16-1) ───
  // Expressed as mg/day then converted to ppm (mg/kg DM)
  const cuMgDay  = round(0.1 * bodyWeightKg, 1);   // 0.1 mg/kg BW: maintenance 10 ppm typical
  const znMgDay  = round(0.4 * bodyWeightKg, 1);   // 0.4 mg/kg BW: 40 ppm
  const mnMgDay  = round(0.4 * bodyWeightKg, 1);   // 0.4 mg/kg BW: 40 ppm
  const feMgDay  = round(0.5 * bodyWeightKg, 1);   // 0.5 mg/kg BW: 50 ppm
  const seMgDay  = round(0.001 * bodyWeightKg, 3); // 1 µg/kg BW → 0.1 ppm
  const iMgDay   = round(0.0035 * bodyWeightKg, 3);// 3.5 µg/kg BW → 0.35 ppm
  const coMgDay  = round(0.001 * bodyWeightKg, 3); // 0.1 ppm

  const cuPpm  = ppmFromMgDay(cuMgDay,  dmiKgDay);
  const znPpm  = ppmFromMgDay(znMgDay,  dmiKgDay);
  const mnPpm  = ppmFromMgDay(mnMgDay,  dmiKgDay);
  const fePpm  = ppmFromMgDay(feMgDay,  dmiKgDay);
  const sePpm  = ppmFromMgDay(seMgDay,  dmiKgDay);
  const iPpm   = ppmFromMgDay(iMgDay,   dmiKgDay);
  const coPpm  = ppmFromMgDay(coMgDay,  dmiKgDay);

  // Growth / breeding stallion adjustments for trace minerals
  const growthTraceFactor = (production === "growth") ? 1.5 : 1.0;
  // Breeding stallion: elevated Zn and Cu for sperm quality and testosterone synthesis
  const stallionZnFactor  = (production === "stallion" || production === "breeding_stallion") ? 2.0 : 1.0;
  const stallionCuFactor  = (production === "stallion" || production === "breeding_stallion") ? 1.5 : 1.0;
  const stallionSeFactor  = (production === "stallion" || production === "breeding_stallion") ? 2.0 : 1.0;

  // ── VITAMINS (NRC 2007) ─────────────────────
  // Vit A: NRC maintenance 2000 IU/kg DM (30 IU/kg BW/day)
  let vitAIuDay = round(30 * bodyWeightKg, 0);
  if (production === "reproduction" || production === "lactation") vitAIuDay = round(45 * bodyWeightKg, 0);
  if (production === "growth") vitAIuDay = round(40 * bodyWeightKg, 0);
  if (production === "stallion" || production === "breeding_stallion") vitAIuDay = round(40 * bodyWeightKg, 0);

  // Vit D: NRC 6.6 IU/kg BW/day maintenance
  let vitDIuDay = round(6.6 * bodyWeightKg, 0);
  if (production === "growth") vitDIuDay = round(8.0 * bodyWeightKg, 0);

  // Vit E: NRC 1-2 IU/kg BW/day; elevated for breeding stallion (antioxidant for sperm quality)
  let vitEIuDay = round(1.0 * bodyWeightKg, 0);
  if (production === "performance" || workLevel) vitEIuDay = round(2.0 * bodyWeightKg * workFactor(workLevel || "light") * 0.5, 0);
  if (production === "growth") vitEIuDay = round(1.5 * bodyWeightKg, 0);
  if (production === "reproduction" || production === "lactation") vitEIuDay = round(1.5 * bodyWeightKg, 0);
  if (production === "stallion" || production === "breeding_stallion") vitEIuDay = round(2.0 * bodyWeightKg, 0); // 1000 IU/day for 500 kg = 100 IU/kg DM

  const vitAIuKg = iuKgFromIuDay(vitAIuDay, dmiKgDay);
  const vitDIuKg = iuKgFromIuDay(vitDIuDay, dmiKgDay);
  const vitEIuKg = iuKgFromIuDay(vitEIuDay, dmiKgDay);
  // ── B VITAMINS & BIOTIN ─────────────────────
  // NRC 2007 + practical commercial recommendations
  // Expressed as mg/day then converted to mg/kg DM

  // Thiamine (B1): NRC 3 mg/kg DM; performance + breeding stallion higher
  let thiamineMgDay = round(3.0 * dmiKgDay, 1);
  if (production === "performance" || workLevel || production === "stallion" || production === "breeding_stallion") thiamineMgDay = round(5.0 * dmiKgDay, 1);

  // Riboflavin (B2): NRC 2 mg/kg DM
  const riboflavinMgDay = round(2.0 * dmiKgDay, 1);

  // Niacin: NRC no requirement set; practical 10-20 mg/kg DM
  const niacinMgDay = round(15.0 * dmiKgDay, 1);

  // Pantothenic Acid: practical 15 mg/kg DM
  const pantothenicMgDay = round(15.0 * dmiKgDay, 1);

  // Biotin: NRC practical 0.12-0.2 mg/kg DM; hoof health 0.2 mg/kg DM
  const biotinMgDay = round(0.16 * dmiKgDay, 2);

  // Folic Acid: practical 1.5-2.5 mg/kg DM
  const folicAcidMgDay = round(2.0 * dmiKgDay, 2);

  // Vitamin B6: practical 2-3 mg/kg DM
  const vitB6MgDay = round(2.5 * dmiKgDay, 1);

  // Vitamin B12: practical 0.01-0.02 mg/kg DM
  const vitB12MgDay = round(0.015 * dmiKgDay, 3);

  // Choline: practical 250-500 mg/kg DM
  const cholineMgDay = round(400.0 * dmiKgDay, 0);

  // Methionine: ~1.4% of CP (NRC limiting AA after lysine)
  const metPct = round(cpPct * 0.014, 3);

  // Convert to diet concentration (mg/kg DM = ppm)
  const thiaminePpm    = mgKgFromMgDay(thiamineMgDay, dmiKgDay);
  const riboflavinPpm  = mgKgFromMgDay(riboflavinMgDay, dmiKgDay);
  const niacinPpm      = mgKgFromMgDay(niacinMgDay, dmiKgDay);
  const pantothenicPpm = mgKgFromMgDay(pantothenicMgDay, dmiKgDay);
  const biotinPpm      = mgKgFromMgDay(biotinMgDay, dmiKgDay);
  const folicAcidPpm   = mgKgFromMgDay(folicAcidMgDay, dmiKgDay);
  const vitB6Ppm       = mgKgFromMgDay(vitB6MgDay, dmiKgDay);
  const vitB12Ppm      = mgKgFromMgDay(vitB12MgDay, dmiKgDay);
  const cholinePpm     = mgKgFromMgDay(cholineMgDay, dmiKgDay);

  // ── FIBRE / CARBOHYDRATES ───────────────────
  // Metabolic horses need strict NSC limits
  let ndfPct    = 25;
  let adfPct    = 15;
  let starchPct = 20;
  let sugarPct  = 10;
  let nscPct    = 25;
  let eePct     = 10;
  let cfPct     = 15;

  if (production === "metabolic") {
    starchPct = 10;  // strict low starch
    sugarPct  = 5;   // strict low sugar
    nscPct    = 12;  // strict low NSC
    ndfPct    = 40;  // high fibre
    adfPct    = 25;
    cfPct     = 20;
  } else if (production === "performance" || workLevel) {
    starchPct = 25;  // performance horses can handle more starch
    nscPct    = 30;
    eePct     = 12;
  } else if (production === "growth") {
    starchPct = 22;
    nscPct    = 28;
  }

  // ── BUILD TARGETS ───────────────────────────
  const targets = {
    // Energy
    de_mcal_day:      round(deMcalDay, 2),
    dm_intake_kg_day: round(dmiKgDay, 2),
    de_mcal_kg:       round(safeDiv(deMcalDay, dmiKgDay), 3),

    // Protein
    cp_pct:    round(cpPct, 2),
    cp_g_day:  gDayFromPct(cpPct, dmiKgDay),
    lys_pct:   round(lysPct, 3),
    lys_g_day: gDayFromPct(lysPct, dmiKgDay),

    // Macrominerals - daily
    ca_g_day: caGDay,
    p_g_day:  pGDay,
    mg_g_day: mgGDay,
    na_g_day: naGDay,
    cl_g_day: clGDay,
    k_g_day:  kGDay,

    // Macrominerals - concentration
    ca_pct:        round(caPct, 3),
    p_pct:         round(pPct, 3),
    mg_pct:        round(mgPct, 3),
    na_pct:        round(naPct, 3),
    cl_pct:        round(clPct, 3),
    k_pct:         round(kPct, 3),
    s_pct:         round(sPct, 3),
    ca_p_ratio:    round(safeDiv(caGDay, pGDay), 2),

    // Trace minerals - ppm
    cu_ppm: round(cuPpm * growthTraceFactor * stallionCuFactor, 2),
    zn_ppm: round(znPpm * growthTraceFactor * stallionZnFactor, 2),
    mn_ppm: round(mnPpm * growthTraceFactor, 2),
    fe_ppm: round(fePpm, 2),
    se_ppm: round(sePpm * stallionSeFactor, 3),
    i_ppm:  round(iPpm, 3),
    co_ppm: round(coPpm, 3),

    // Vitamins
    vit_a_iu_kg: vitAIuKg,
    vit_d_iu_kg: vitDIuKg,
    vit_e_iu_kg: vitEIuKg,

    // Methionine
    met_pct: metPct,

    // B vitamins and biotin (mg/kg DM)
    vit_b1_ppm:         thiaminePpm,
    vit_b2_ppm:         riboflavinPpm,
    niacin_ppm:         niacinPpm,
    pantothenic_ppm:    pantothenicPpm,
    biotin_ppm:         biotinPpm,
    folic_acid_ppm:     folicAcidPpm,
    vit_b6_ppm:         vitB6Ppm,
    vit_b12_ppm:        vitB12Ppm,
    choline_ppm:        cholinePpm,

    // Fibre / carbohydrates
    ndf_pct:    ndfPct,
    adf_pct:    adfPct,
    cf_pct:     cfPct,
    starch_pct: starchPct,
    sugar_pct:  sugarPct,
    nsc_pct:    nscPct,
    ee_pct:     eePct
  };

  return {
    ok: true,
    status: "NRC_ENGINE_V2_ACTIVE",
    model: "nrc2007_equine_v2",
    basis: "equation_derived_nrc2007_full_commercial",
    source_reference: {
      primary: "National Research Council. 2007. Nutrient Requirements of Horses. Sixth Revised Edition. National Academies Press."
    },
    input: {
      body_weight_kg:   bodyWeightKg,
      horse_type:       horseType,
      production,
      maintenance_class: maintenanceClass,
      work_level:       workLevel,
      intake_pct_bw:    intakePctBw,
      gestation_month:  gestationMonth,
      lactation_month:  lactationMonth,
      age_months:       ageMonths,
      mature_weight_kg: matureWeightKg
    },
    targets
  };
}

module.exports = {
  generateEquineTargets
};
