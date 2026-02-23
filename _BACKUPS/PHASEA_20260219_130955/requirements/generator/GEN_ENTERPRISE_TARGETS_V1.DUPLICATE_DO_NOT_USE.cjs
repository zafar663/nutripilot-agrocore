"use strict";

/**
 * Enterprise Targets Generator v1 (extended with optional Lys curve)
 *
 * Goal: produce a complete targets_raw object (AA + minerals + energy) using
 *       performance inputs when available, otherwise falling back to static targets.
 *
 * IMPORTANT DESIGN:
 * - We never break the analyzer: for each key, we either return a generated value
 *   or we omit it (so analyzer keeps static targets).
 * - model_used_by_key: "model" or "static_fallback"
 *
 * NEW (Lys curve):
 * - Optional, selectable lys_curve modes (layer vs breeder behavior differs)
 * - Layers: egg mass drives Lys; BW contributes only small maintenance term
 * - Broiler breeders: BW is more important; egg output + BW model is available
 *
 * CLEAN UPGRADE (Auto-fit to static target):
 * - In layer egg_mass_plus_bw_maint mode, we can auto-fit the egg production coefficient
 *   so the generated SID Lys matches the selected requirements profile (staticTargetsRaw.sid_lys_pct),
 *   while keeping BW as a small maintenance term.
 */

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function clamp(x, lo, hi) {
  if (!isNum(x)) return x;
  return Math.max(lo, Math.min(hi, x));
}

function toNumberOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function mgDayToPctOfDiet(mg_d, feed_intake_g_d) {
  if (!isNum(mg_d) || !isNum(feed_intake_g_d) || feed_intake_g_d <= 0) return null;
  // % = mg_d / (FI_g_d * 10)
  return mg_d / (feed_intake_g_d * 10);
}

function gDayToPctOfDiet(g_d, feed_intake_g_d) {
  if (!isNum(g_d) || !isNum(feed_intake_g_d) || feed_intake_g_d <= 0) return null;
  // % = (g_d * 100) / FI_g_d
  return (g_d * 100) / feed_intake_g_d;
}

function kcalDayToKcalPerKg(kcal_d, feed_intake_g_d) {
  if (!isNum(kcal_d) || !isNum(feed_intake_g_d) || feed_intake_g_d <= 0) return null;
  const fi_kg_d = feed_intake_g_d / 1000;
  return kcal_d / fi_kg_d;
}

/**
 * Compute egg mass (g/day)
 * Supports:
 * - egg_mass_g_per_d directly
 * - or hen_day_pct + egg_weight_g
 */
function computeEggMass(perf) {
  if (!perf || typeof perf !== "object") return null;

  const em_direct = toNumberOrNull(perf.egg_mass_g_per_d);
  if (isNum(em_direct) && em_direct >= 0) return em_direct;

  const hdp = toNumberOrNull(perf.hen_day_pct);
  const ew = toNumberOrNull(perf.egg_weight_g);
  if (isNum(hdp) && isNum(ew) && hdp >= 0 && ew >= 0) {
    return (hdp / 100) * ew;
  }
  return null;
}

/**
 * Default coefficients (V1 placeholders you can refine later)
 * (These remain used for AA, minerals, ME unless overridden by opts.coefs)
 */
const DEFAULT_COEFS = {
  // SID AA mg/day = A + B*EggMass
  // NOTE: Lys can be overridden by lys_curve; others remain as-is for now.
  sid_lys: { A: 650, B: 45 },
  sid_met: { A: 280, B: 18 },
  sid_metcys: { A: 520, B: 26 },
  sid_thr: { A: 420, B: 22 },
  sid_trp: { A: 120, B: 7 },
  sid_arg: { A: 720, B: 35 },

  // Minerals g/day = A + B*EggMass
  ca: { A: 2.0, B: 0.090 },
  avp: { A: 0.35, B: 0.010 },

  // Sodium mg/day = A + B*EggMass
  na: { A: 180, B: 4.0 },

  // Energy kcal/day = A + B*EggMass
  me: { A: 230, B: 11.5 }
};

/**
 * Lys curve defaults by type.
 *
 * Modes:
 * - "egg_mass"                  : Lys mg/d = A + B*EggMass
 * - "egg_mass_plus_bw_maint"    : Lys mg/d = (egg term) + (BW maintenance small)
 * - "breeder_egg_output_plus_bw": Lys mg/d = (a*EggOutput_g_d + b*BW_kg)  [strong BW]
 *
 * Parameters:
 * - layer_egg_mg_per_g          : production Lys per g egg mass (mg/g)
 * - layer_bw_maint_mg_per_kg    : maintenance Lys per kg BW per day (mg/kg/d)
 * - layer_bw_maint_scale        : scales BW maintenance contribution (small multiplier)
 *
 * AUTO-FIT (layers):
 * - auto_fit_to_static          : if true and staticTargetsRaw.sid_lys_pct exists, fit mg_per_g
 *                                so generated Lys matches static target (minus BW maintenance)
 * - fit_min_mg_per_g, fit_max_mg_per_g : clamp fitted mg_per_g to safe bounds
 *
 * Breeders:
 * - breeder_a_mg_per_g_egg      : mg Lys per g egg output (mg/g)
 * - breeder_b_mg_per_kg_bw      : mg Lys per kg BW (mg/kg)
 */
const DEFAULT_LYS_CURVE = {
  layer: {
    mode: "egg_mass_plus_bw_maint",

    // default production coefficient (used if auto-fit cannot run)
    layer_egg_mg_per_g: 12.0,

    // maintenance term (small)
    layer_bw_maint_mg_per_kg: 37.0,
    layer_bw_maint_scale: 0.35,

    // auto-fit production coefficient to static SID Lys target
    auto_fit_to_static: true,
    fit_min_mg_per_g: 8,
    fit_max_mg_per_g: 40
  },

  broiler_breeder: {
    mode: "breeder_egg_output_plus_bw",
    breeder_a_mg_per_g_egg: 14.5,
    breeder_b_mg_per_kg_bw: 32.2
  }
};

function genEnterpriseTargetsV1(staticTargetsRaw, context, performance, opts = {}) {
  const trace = {};
  const model_used_by_key = {};
  const targets_raw_generated = {};

  const coefs = { ...DEFAULT_COEFS, ...(opts.coefs || {}) };
  const type = context?.type || null;

  const fi = toNumberOrNull(performance?.feed_intake_g_per_d);
  const egg_mass = computeEggMass(performance);
  const bw_kg = toNumberOrNull(performance?.body_weight_kg);

  trace.feed_intake_g_per_d = fi;
  trace.egg_mass_g_per_d = egg_mass;
  trace.hen_day_pct = toNumberOrNull(performance?.hen_day_pct);
  trace.egg_weight_g = toNumberOrNull(performance?.egg_weight_g);
  trace.body_weight_kg = bw_kg;

  const canModelAA =
    isNum(fi) &&
    fi > 0 &&
    isNum(egg_mass) &&
    egg_mass >= 0 &&
    (type === "layer" || type === "broiler_breeder");

  const canModelMin = canModelAA;
  const canModelME = isNum(fi) && fi > 0 && isNum(egg_mass) && egg_mass >= 0;

  function setOrFallback(rawKey, generatedValue) {
    if (isNum(generatedValue)) {
      targets_raw_generated[rawKey] = generatedValue;
      model_used_by_key[rawKey] = "model";
    } else {
      model_used_by_key[rawKey] = "static_fallback";
    }
  }

  function computeSidLysMgDay() {
    const lysCurveUser =
      opts && opts.lys_curve && typeof opts.lys_curve === "object" ? opts.lys_curve : {};

    const defaultsByType =
      type === "broiler_breeder"
        ? DEFAULT_LYS_CURVE.broiler_breeder
        : type === "layer"
          ? DEFAULT_LYS_CURVE.layer
          : null;

    if (!defaultsByType) {
      trace.lys_curve = { enabled: false, reason: "no_default_for_type" };
      return null;
    }

    const cfg = { ...defaultsByType, ...lysCurveUser };
    const mode = cfg.mode || defaultsByType.mode;

    trace.lys_curve = {
      enabled: true,
      mode,
      note: null,
      params_used: { ...cfg }
    };

    if (!isNum(egg_mass) || egg_mass < 0) {
      trace.lys_curve.note = "egg_mass_missing";
      return null;
    }

    if (mode === "egg_mass") {
      const A = isNum(cfg.A) ? cfg.A : coefs.sid_lys.A;
      const B = isNum(cfg.B) ? cfg.B : coefs.sid_lys.B;
      trace.lys_curve.note = "Lys mg/d = A + B*EggMass";
      return A + B * egg_mass;
    }

    if (mode === "egg_mass_plus_bw_maint") {
      const prod_mg_per_g_default = toNumberOrNull(cfg.layer_egg_mg_per_g);

      const maint_mg_per_kg = toNumberOrNull(cfg.layer_bw_maint_mg_per_kg);
      const maint_scale = toNumberOrNull(cfg.layer_bw_maint_scale);

      // maintenance is optional for layers
      let maint = 0;
      if (isNum(bw_kg) && bw_kg > 0 && isNum(maint_mg_per_kg) && isNum(maint_scale)) {
        maint = bw_kg * maint_mg_per_kg * maint_scale;
      }

      const autoFit = cfg.auto_fit_to_static !== false; // default true
      const staticPct = toNumberOrNull(staticTargetsRaw?.sid_lys_pct);

      let prod_mg_per_g = prod_mg_per_g_default;
      let fitInfo = { used: false };

      if (autoFit && isNum(staticPct) && isNum(fi) && fi > 0) {
        const target_mg_d = staticPct * fi * 10;
        const prod_needed = Math.max(target_mg_d - maint, 0);

        const fitted = prod_needed / egg_mass;

        const lo = isNum(cfg.fit_min_mg_per_g) ? cfg.fit_min_mg_per_g : 8;
        const hi = isNum(cfg.fit_max_mg_per_g) ? cfg.fit_max_mg_per_g : 40;

        prod_mg_per_g = clamp(fitted, lo, hi);

        fitInfo = {
          used: true,
          static_sid_lys_pct: staticPct,
          target_mg_d,
          maint_mg_d: maint,
          prod_needed_mg_d: prod_needed,
          fitted_mg_per_g: fitted,
          fitted_clamped_mg_per_g: prod_mg_per_g,
          clamp: { lo, hi }
        };
      }

      const prod = isNum(prod_mg_per_g) ? prod_mg_per_g * egg_mass : null;

      trace.lys_curve.note =
        "Lys mg/d = (egg_mass*mg_per_g[auto-fit]) + (BW_kg*maint_mg_per_kg*scale)";
      trace.lys_curve.components = { prod_mg_d: prod, maint_mg_d: maint, prod_mg_per_g };
      trace.lys_curve.fit = fitInfo;

      if (!isNum(prod)) return null;
      return prod + maint;
    }

    if (mode === "breeder_egg_output_plus_bw") {
      const a = toNumberOrNull(cfg.breeder_a_mg_per_g_egg);
      const b = toNumberOrNull(cfg.breeder_b_mg_per_kg_bw);

      if (!isNum(a) || !isNum(b)) return null;
      if (!isNum(bw_kg) || bw_kg <= 0) {
        trace.lys_curve.note = "BW required for breeder mode; falling back";
        return null;
      }

      const lys = a * egg_mass + b * bw_kg;
      trace.lys_curve.note = "Lys mg/d = a*EggOutput_g_d + b*BW_kg";
      trace.lys_curve.components = { egg_term_mg_d: a * egg_mass, bw_term_mg_d: b * bw_kg };
      return lys;
    }

    trace.lys_curve.note = "unknown_mode_fallback";
    return null;
  }

  // ===== SID AA =====
  if (canModelAA) {
    const lys_mg_d_curve = computeSidLysMgDay();
    const lys_mg_d_legacy = coefs.sid_lys.A + coefs.sid_lys.B * egg_mass;
    const lys_mg_d = isNum(lys_mg_d_curve) ? lys_mg_d_curve : lys_mg_d_legacy;

    const met_mg_d = coefs.sid_met.A + coefs.sid_met.B * egg_mass;
    const metcys_mg_d = coefs.sid_metcys.A + coefs.sid_metcys.B * egg_mass;
    const thr_mg_d = coefs.sid_thr.A + coefs.sid_thr.B * egg_mass;
    const trp_mg_d = coefs.sid_trp.A + coefs.sid_trp.B * egg_mass;
    const arg_mg_d = coefs.sid_arg.A + coefs.sid_arg.B * egg_mass;

    trace.aa_mg_d = { lys_mg_d, met_mg_d, metcys_mg_d, thr_mg_d, trp_mg_d, arg_mg_d };
    trace.aa_mg_d_source = {
      lys: isNum(lys_mg_d_curve) ? "lys_curve" : "legacy_linear_A_plus_B_egg_mass"
    };

    setOrFallback("sid_lys_pct", clamp(mgDayToPctOfDiet(lys_mg_d, fi), 0, 5));
    setOrFallback("sid_met_pct", clamp(mgDayToPctOfDiet(met_mg_d, fi), 0, 5));
    setOrFallback("sid_metcys_pct", clamp(mgDayToPctOfDiet(metcys_mg_d, fi), 0, 8));
    setOrFallback("sid_thr_pct", clamp(mgDayToPctOfDiet(thr_mg_d, fi), 0, 5));
    setOrFallback("sid_trp_pct", clamp(mgDayToPctOfDiet(trp_mg_d, fi), 0, 2));
    setOrFallback("sid_arg_pct", clamp(mgDayToPctOfDiet(arg_mg_d, fi), 0, 6));
  } else {
    ["sid_lys_pct","sid_met_pct","sid_metcys_pct","sid_thr_pct","sid_trp_pct","sid_arg_pct"]
      .forEach(k => { model_used_by_key[k] = "static_fallback"; });
  }

  // ===== Minerals =====
  if (canModelMin) {
    const ca_g_d = coefs.ca.A + coefs.ca.B * egg_mass;
    const avp_g_d = coefs.avp.A + coefs.avp.B * egg_mass;
    const na_mg_d = coefs.na.A + coefs.na.B * egg_mass;

    trace.minerals = { ca_g_d, avp_g_d, na_mg_d };

    setOrFallback("ca_pct", clamp(gDayToPctOfDiet(ca_g_d, fi), 0, 10));
    setOrFallback("avp_pct", clamp(gDayToPctOfDiet(avp_g_d, fi), 0, 3));
    setOrFallback("na_pct", clamp(mgDayToPctOfDiet(na_mg_d, fi), 0, 1));
  } else {
    ["ca_pct","avp_pct","na_pct"].forEach(k => { model_used_by_key[k] = "static_fallback"; });
  }

  // ===== Energy (ME) =====
  if (canModelME) {
    const me_kcal_d_user = toNumberOrNull(performance?.me_kcal_per_d);
    const me_kcal_d = isNum(me_kcal_d_user)
      ? me_kcal_d_user
      : (coefs.me.A + coefs.me.B * egg_mass);

    trace.me = { me_kcal_d_user, me_kcal_d };

    const me_kcal_per_kg = kcalDayToKcalPerKg(me_kcal_d, fi);
    setOrFallback("me_kcal_per_kg", clamp(me_kcal_per_kg, 1500, 4500));
  } else {
    model_used_by_key["me_kcal_per_kg"] = "static_fallback";
  }

  // ===== Protein (CP) =====
  model_used_by_key["cp_pct"] = "static_fallback";

  return {
    ok: true,
    generator_id: "enterprise_targets_v1",
    targets_raw_generated,
    model_used_by_key,
    trace
  };
}

module.exports = { genEnterpriseTargetsV1 };
