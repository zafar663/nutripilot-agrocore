"use strict";

/**
 * core/engine/analyzeFormula.cjs
 * AgroCore v1.4.4+ (enterprise targets + performance gating)
 *
 * Fixes/Features (kept):
 * 1) Prevents non-nutrient keys (_LOCK/meta/schema/note/etc.) from entering evaluation
 * 2) Normalizes ingredients_source/meta fields (ingredients_mode string + ingredients_file string)
 * 3) Uses nutrient registry (when present) as the allow-list for requirement keys
 * 4) Adds WhatsApp-ready clarification_text + examples when NEEDS_CLARIFICATION
 *
 * PATCH UPS:
 * A) Requirements values can be numbers OR objects like {min:3000, unit:"kcal_per_kg"}
 * B) Registry allow-list cannot block SID keys (we union registry keys + SID keys)
 * C) If requirements doc has evaluation_keys[], we honor it (intersection with requirements + allow-list)
 * D) Always returns parsed + itemsResolved in ok:true response (debugging)
 *
 * NORMALIZE:
 * E) Engine-side NORMALIZE: if input.normalize === true, scale inclusions to total=100.00
 *
 * ENTERPRISE:
 * F) Optional enterprise targets generator overlays selected profile targets_raw (safe)
 * G) Performance gating: ONLY when enterprise Lys curve is explicitly enabled.
 *    If enabled and FI/egg inputs are missing → NEEDS_PERFORMANCE_INPUT (do NOT guess).
 *
 * IMPORTANT:
 * - Lys curve is OPTIONAL. If user doesn't opt-in (enterprise.lys_curve.enabled !== true),
 *   analyzer remains static per requirements profile.
 */

const fs = require("node:fs");
const path = require("node:path");

const { parseFormulaText } = require("../parser/parseFormulaText.cjs");
const { loadIngredients } = require("../db/ingredients/_index/LOAD_INGREDIENTS.cjs");

// Canonical US requirements resolver (index+library) with BOM-safe JSON read inside.
const { resolveRequirements } = require("./requirements/LOAD_REQUIREMENTS_PROFILE.cjs");

// ---- Enterprise generator (try a couple paths to avoid brittle imports) ----
function tryRequireEnterpriseGenerator() {
  const candidates = [
    path.join(__dirname, "../requirements/generator/GEN_ENTERPRISE_TARGETS_V1.cjs"),
    path.join(__dirname, "../db/requirements/generator/GEN_ENTERPRISE_TARGETS_V1.cjs"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return require(p);
    } catch (_) {}
  }
  return null;
}
const _ENTERPRISE_MOD = tryRequireEnterpriseGenerator();
const genEnterpriseTargetsV1 =
  _ENTERPRISE_MOD && typeof _ENTERPRISE_MOD.genEnterpriseTargetsV1 === "function"
    ? _ENTERPRISE_MOD.genEnterpriseTargetsV1
    : null;

// ---- Registry (optional). If missing, we still work. ----
const REGISTRY_REL = "../schema/master_nutrient_registry.v1.json";
let _REGISTRY_CACHE = null;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function tryLoadRegistry() {
  if (_REGISTRY_CACHE) return _REGISTRY_CACHE;
  try {
    const p = path.join(__dirname, REGISTRY_REL);
    if (!fs.existsSync(p)) return null;
    _REGISTRY_CACHE = readJson(p);
    return _REGISTRY_CACHE;
  } catch (_) {
    return null;
  }
}

// ---- small helpers ----
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function toNumberOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function round4(x) {
  return +num(x).toFixed(4);
}

/**
 * PATCH: normalize requirements values into a number.
 */
function reqMin(v) {
  if (v === undefined || v === null) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  if (typeof v === "object") {
    const pick = v.min ?? v.target ?? v.value ?? v.req ?? v.requirement ?? null;
    return reqMin(pick);
  }

  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function computeDeb(n) {
  const na = num(n.na);
  const k = num(n.k);
  const cl = num(n.cl);
  const deb = na * (10000 / 23.0) + k * (10000 / 39.1) - cl * (10000 / 35.45);
  return +deb.toFixed(2);
}

/**
 * Normalize ingredients loader output into a stable shape:
 * { mode: "structured"|"legacy"|..., file: "relative/or/abs/path"|null }
 */
function normalizeIngredientsSource(ingLoaded) {
  if (ingLoaded && ingLoaded.source && typeof ingLoaded.source === "object") {
    const m = String(ingLoaded.source.mode || "structured");
    const f = ingLoaded.source.file || ingLoaded.source.path || null;
    return { mode: m, file: f };
  }

  const m = String(ingLoaded && (ingLoaded.mode || "structured"));
  const f = (ingLoaded && (ingLoaded.file || ingLoaded.path)) || null;
  return { mode: m, file: f };
}

/**
 * Normalize requirements target keys (your JSON) into engine canonical keys.
 */
function normalizeRequirementTargets(targets) {
  const t = targets && typeof targets === "object" ? targets : {};
  const out = {};

  for (const [k0, v] of Object.entries(t)) {
    if (!k0) continue;
    const k = String(k0).toLowerCase().trim();

    let canon = k;

    // skip known non-nutrient envelopes
    if (
      canon === "_lock" ||
      canon === "meta" ||
      canon === "schema" ||
      canon === "note" ||
      canon === "_meta"
    )
      continue;

    // energy
    if (
      k === "me_kcal_per_kg" ||
      k === "me_kcal_kg" ||
      k === "me_kcalkg" ||
      k === "me"
    )
      canon = "me";

    // percent-style suffix
    if (canon.endsWith("_pct")) canon = canon.slice(0, -4);

    // common aliases
    if (canon === "avail_p") canon = "avp";
    if (canon === "available_p") canon = "avp";

    // variants
    if (canon === "metcys") canon = "met_cys";
    if (canon === "sid_met_cys") canon = "sid_metcys";

    out[canon] = v;
  }

  return out;
}

/**
 * Allow-list nutrient keys.
 * PATCH: union(registry keys, SID keys, basic keys)
 */
function buildAllowedNutrientKeys(registry) {
  const base = new Set([
    "me",
    "cp",
    "ca",
    "avp",
    "na",
    "k",
    "cl",
    "deb",
    "lys",
    "met",
    "met_cys",
    "thr",
    "trp",
    "arg",
    "ile",
    "leu",
    "val",
    "sid_lys",
    "sid_met",
    "sid_metcys",
    "sid_thr",
    "sid_trp",
    "sid_arg",
    "sid_ile",
    "sid_leu",
    "sid_val",
  ]);

  if (registry && registry.nutrients && typeof registry.nutrients === "object") {
    for (const k of Object.keys(registry.nutrients)) base.add(k);
  }

  return base;
}

/**
 * Decide which nutrient keys we will evaluate.
 */
function pickEvaluationKeys({ requirements, evaluation_keys, allowedKeys }) {
  const req = requirements || {};
  let keys = [];

  if (Array.isArray(evaluation_keys) && evaluation_keys.length > 0) {
    keys = evaluation_keys.slice();
  } else {
    keys = Object.keys(req);
  }

  const out = [];
  for (const k of keys) {
    if (!k) continue;
    if (k === "_LOCK" || k === "meta" || k === "schema" || k === "note" || k === "_meta")
      continue;
    if (!allowedKeys.has(k)) continue;
    const v = reqMin(req[k]);
    if (v === null) continue;
    out.push(k);
  }
  return out;
}

function buildCoverage(itemsResolved, db, keysWanted, altMap) {
  const coverage = {};
  for (const k of keysWanted) {
    let present = 0;
    let missing = 0;
    let nonzero = 0;

    for (const it of itemsResolved) {
      const ing = db[it.ingredient];
      if (!ing) {
        missing++;
        continue;
      }
      const rawKey = altMap[k] || k;
      const v = ing[rawKey];
      if (v === undefined || v === null) {
        missing++;
      } else {
        present++;
        if (Number(v) !== 0) nonzero++;
      }
    }

    coverage[k] = {
      present,
      missing,
      nonzero,
      supported: present > 0 && missing === 0,
    };
  }
  return coverage;
}

function sumNutrients(itemsResolved, db, keysWanted, altMap) {
  const out = {};
  for (const k of keysWanted) out[k] = 0;

  for (const it of itemsResolved) {
    const ing = db[it.ingredient];
    if (!ing) continue;

    const pct = num(it.inclusion) / 100.0;

    for (const k of keysWanted) {
      const rawKey = altMap[k] || k;
      const v = ing[rawKey];
      if (v === undefined || v === null) continue;
      out[k] += num(v) * pct;
    }
  }

  const rounded = {};
  for (const k of Object.keys(out)) {
    if (k === "me") rounded[k] = +num(out[k]).toFixed(1);
    else rounded[k] = round4(out[k]);
  }

  if (keysWanted.includes("na") && keysWanted.includes("k") && keysWanted.includes("cl")) {
    rounded.deb = computeDeb(rounded);
  }

  return rounded;
}

function evaluateAgainstRequirements(profileReqs, actual, keysUsed) {
  const findings = [];
  let overall = "OK";

  for (const k of keysUsed) {
    const required = reqMin(profileReqs[k]);
    if (required === null) continue;

    const act = num(actual[k]);
    const diff = act - required;
    const pct = required === 0 ? 0 : (diff / required) * 100;

    let status = "OK";
    if (pct < -5) status = "FAIL";
    else if (pct < -2) status = "WARN";

    findings.push({ nutrient: k, status, pct: +pct.toFixed(2) });

    if (status === "FAIL") overall = "FAIL";
    else if (status === "WARN" && overall !== "FAIL") overall = "WARN";
  }

  return { overall, findings };
}

// ---- WhatsApp-friendly clarification formatting ----
function fmtPct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(n);
}

function buildClarificationText(needs) {
  const lines = [];
  lines.push("⚠️ Need ingredient clarification (CP/grade) before analysis:");
  needs.forEach((c, idx) => {
    const inc = fmtPct(c.inclusion);
    const opt = c.options && c.options.length ? ` Options: ${c.options.join(" / ")}.` : "";
    lines.push(`${idx + 1}) ${c.raw}${inc ? ` (${inc}%)` : ""} → ${c.prompt}${opt}`);
  });

  lines.push("");
  lines.push("Reply by specifying the grade, e.g.:");
  return lines.join("\n");
}

function buildClarificationExamples(needs) {
  const ex = [];

  for (const c of needs) {
    const inc = fmtPct(c.inclusion) || "10";
    switch (c.family) {
      case "soybean_meal":
        ex.push(`SBM 48 ${inc}`);
        break;
      case "wheat":
        ex.push(`Wheat 13 ${inc}`);
        break;
      case "sunflower_meal":
        ex.push(`Sunflower meal 36 ${inc}`);
        break;
      case "meat_bone_meal":
        ex.push(`MBM 45 ${inc}`);
        break;
      case "ddgs":
        ex.push(`Corn DDGS ${inc}`);
        break;
      case "corn_gluten_meal":
        ex.push(`CGM 60 ${inc}`);
        break;
      case "canola_rapeseed":
        ex.push(`Canola meal 36 ${inc}`);
        break;
      default:
        break;
    }
    if (ex.length >= 2) break;
  }

  return ex.length ? ex : [];
}

// ---- NORMALIZE (engine-side) ----
function computeParsedTotal(parsed) {
  if (!parsed || typeof parsed !== "object") return 0;
  if (parsed.total != null) return Number(parsed.total) || 0;
  if (parsed.total_inclusion != null) return Number(parsed.total_inclusion) || 0;

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  let s = 0;
  for (const it of items) s += Number(it?.inclusion || 0);
  return s;
}

function setParsedTotal(parsed, total) {
  if (!parsed || typeof parsed !== "object") return;
  if ("total" in parsed) parsed.total = total;
  if ("total_inclusion" in parsed) parsed.total_inclusion = total;

  if (!("total" in parsed) && !("total_inclusion" in parsed)) {
    parsed.total = total;
  }
}

function normalizeParsedInclusions(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const originalTotal = computeParsedTotal(parsed);

  if (!items.length || originalTotal <= 0) {
    return { normalized: false, originalTotal, factor: null };
  }

  const factor = 100 / originalTotal;

  for (const it of items) {
    const inc = Number(it?.inclusion || 0);
    it.inclusion = +(inc * factor).toFixed(6);
  }

  setParsedTotal(parsed, 100);

  parsed.normalization = {
    normalized: true,
    original_total: +originalTotal.toFixed(4),
    factor: +factor.toFixed(8),
  };

  return { normalized: true, originalTotal, factor };
}

// ---- Enterprise performance gating helpers ----
function computeEggMassFromPerformance(perf) {
  if (!perf || typeof perf !== "object") return null;

  const em = toNumberOrNull(perf.egg_mass_g_per_d);
  if (isNum(em) && em >= 0) return em;

  const hdp = toNumberOrNull(perf.hen_day_pct);
  const ew = toNumberOrNull(perf.egg_weight_g);
  if (isNum(hdp) && isNum(ew) && hdp >= 0 && ew >= 0) return (hdp / 100) * ew;

  return null;
}

function isLysCurveExplicitlyEnabled(enterprise) {
  const ent = enterprise && typeof enterprise === "object" ? enterprise : {};
  return !!(ent.enabled && ent.lys_curve && ent.lys_curve.enabled === true);
}

function needsPerformanceForEnterpriseLys({ type, enterprise, performance }) {
  // Gate ONLY when curve is explicitly enabled
  if (!isLysCurveExplicitlyEnabled(enterprise)) return { needed: false };

  const ent = enterprise && typeof enterprise === "object" ? enterprise : {};
  const perf = performance && typeof performance === "object" ? performance : {};

  const fi = toNumberOrNull(perf.feed_intake_g_per_d);
  const bw = toNumberOrNull(perf.body_weight_kg);

  const mode = String(ent.lys_curve?.mode || "").toLowerCase().trim();

  // For breeders we want explicit egg_mass_g_per_d (no HDP/EW guessing)
  const breederNeedsEggMassExplicit = type === "broiler_breeder";

  const eggMass = breederNeedsEggMassExplicit
    ? toNumberOrNull(perf.egg_mass_g_per_d)
    : computeEggMassFromPerformance(perf);

  const missing = [];

  if (!isNum(fi) || fi <= 0) {
    missing.push({
      key: "feed_intake_g_per_d",
      label: "Feed intake (g/hen/day)",
      example: "110",
    });
  }

  // Egg output requirement (layer can use HDP+EW OR egg_mass; breeder must use egg_mass)
  if (type === "layer") {
    const hasEggMass = isNum(toNumberOrNull(perf.egg_mass_g_per_d));
    const hdp = toNumberOrNull(perf.hen_day_pct);
    const ew = toNumberOrNull(perf.egg_weight_g);
    const hasHdpEw = isNum(hdp) && isNum(ew);

    if (!isNum(eggMass) || eggMass < 0) {
      if (!hasEggMass && !hasHdpEw) {
        missing.push({
          key: "egg_mass_inputs",
          label: "Egg mass inputs",
          example: "hen_day_pct=92 and egg_weight_g=62 (or egg_mass_g_per_d=57)",
        });
      }
    }
  } else if (type === "broiler_breeder") {
    if (!isNum(eggMass) || eggMass <= 0) {
      missing.push({
        key: "egg_mass_g_per_d",
        label: "Egg output (g/hen/day)",
        example: "45",
      });
    }
  }

  // BW gating:
  // - layer: optional (maintenance term)
  // - broiler_breeder: require BW when mode uses BW term
  const bwRequiredForThisMode =
    type === "broiler_breeder" &&
    (mode === "breeder_egg_output_plus_bw" || mode === "egg_mass_plus_bw_maint");

  if (bwRequiredForThisMode) {
    if (!isNum(bw) || bw <= 0) {
      missing.push({
        key: "body_weight_kg",
        label: "Body weight (kg)",
        example: "3.8",
      });
    }
  }

  if (!missing.length) return { needed: false };

  return {
    needed: true,
    missing,
    detected: { fi, egg_mass_g_per_d: eggMass, body_weight_kg: bw, mode },
  };
}

function buildPerformancePrompt({ type, missing }) {
  const lines = [];
  lines.push("⚠️ To apply the enterprise Lys curve, I need a few performance inputs:");

  for (const m of missing) {
    lines.push(`- ${m.label} (send as: ${m.key}=${m.example})`);
  }

  lines.push("");
  if (type === "layer") {
    lines.push("Examples:");
    lines.push("feed_intake_g_per_d=110");
    lines.push("hen_day_pct=92");
    lines.push("egg_weight_g=62");
    lines.push("body_weight_kg=1.55 (optional for layer maintenance term)");
  } else if (type === "broiler_breeder") {
    lines.push("Examples:");
    lines.push("feed_intake_g_per_d=155");
    lines.push("egg_mass_g_per_d=45");
    lines.push("body_weight_kg=3.8 (required when breeder BW mode is used)");
  }
  return lines.join("\n");
}

// ---- main ----
function analyzeFormula({
  locale = "US",
  formula_text = "",
  species = "poultry",
  type = "broiler",
  breed = "generic",
  phase = "starter",
  region = "us",
  version = "v1",
  normalize = false,

  // enterprise inputs (optional)
  enterprise = null,
  performance = null,
} = {}) {
  const parsed = parseFormulaText(formula_text);

  // ---- Option-B production (function-scope; safe to use anywhere below) ----
  const _version = String(version || "v1").trim();

  // prefer explicit input.production; fallback to enterprise?.production (since you used it in tests)
    // prefer explicit enterprise?.production (tests), otherwise infer from poultry type+phase
  let _production = String(((enterprise && (enterprise?.production || enterprise?.production_type || enterprise?.productionType || enterprise?.category)) || "")).trim().toLowerCase();let _production_inferred = false;

  if (!_production && String(species||"").toLowerCase()==="poultry") {
    const t = String(type||"").toLowerCase();
    if (["duck","goose","quail","turkey"].includes(t)) {
      const ph = String(phase||"").toLowerCase();
      if (ph.includes("breeder") || ph.includes("parent") || ph==="breeder") _production="breeder";
      else if (ph.includes("lay") || ph==="layer") _production="layer";
      else _production="meat";
      _production_inferred = true;
    }
  }


  // Clarification (non-blocking)
  let needs_clarification = null;
  let clarification_text = null;
  let clarification_examples = null;

  if (parsed.needs_clarification && parsed.needs_clarification.length > 0) {
    // Clarification is recorded but does not block requirements/evaluation (dev mode)
    needs_clarification = parsed.needs_clarification;
    clarification_text = buildClarificationText(parsed.needs_clarification);
    clarification_examples = buildClarificationExamples(parsed.needs_clarification);
  }

  if (normalize === true) {
    normalizeParsedInclusions(parsed);
  }

  // Ingredients DB (US phase keeps basis=sid)
  const ingLoaded = loadIngredients({ species, region, version, basis: "sid" });
  const db = ingLoaded.db || {};
  const ingredients_source = normalizeIngredientsSource(ingLoaded);

  // Unknown ingredients
  const unknown = [];
  const itemsResolved = [];

  for (const it of parsed.items || []) {
    const key = it.ingredient;
    const has = !!db[key];
    if (!has) {
      unknown.push({
        ingredient: key,
        dbKey: key,
        has_dbKey: false,
        inclusion: it.inclusion,
      });
      continue;
    }
    itemsResolved.push({ ingredient: key, inclusion: it.inclusion, lot: it.lot ?? null });
  }

  // Requirements (US canonical loader)
  let req;
  try {
    // ---- Option-B requirements: production (meat/layer/breeder) ----
    let production = (enterprise?.production || enterprise?.production_type || enterprise?.category || "").toString().trim().toLowerCase();
    let production_inferred = false;

    if (!production && String(species||'').toLowerCase()==='poultry') {
      const t = String(type||'').toLowerCase();
      if (['duck','goose','quail','turkey'].includes(t)) {
        const ph = String(phase||'').toLowerCase();
        if (ph.includes('breeder') || ph.includes('parent') || ph === 'breeder') production = 'breeder';
        else if (ph.includes('lay') || ph === 'layer') production = 'layer';
        else production = 'meat';
        production_inferred = true;
      }
    }
    // (deduped) production inference moved to function-scope above

req = resolveRequirements({ species, type, breed, phase, region, version: _version, production: _production });
} catch (e) {
    return {
      ok: false,
      error: "REQUIREMENTS_LOAD_FAILED",
      message: e.message,
      parsed,
      itemsResolved,
      unknown,
      meta: { locale, species, type, breed, phase, region, version, normalize: !!normalize },
      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
    };
  }

  const reqKey = req.reqKey;

  // Raw targets from requirements profile
  const profileReqs_raw = (req && req.requirements && typeof req.requirements === "object") ? req.requirements : (req.profile && req.profile.targets ? req.profile.targets : {});
  const evaluation_keys_from_profile = Array.isArray(req.profile?.evaluation_keys)
    ? req.profile.evaluation_keys
    : [];

// Option-B fallback: if profile has no evaluation_keys, evaluate all keys present in targets_raw
  // (removed duplicate) evaluation_keys_used was declared earlier by mistake
// ---- Enterprise performance gating (ONLY if Lys curve explicitly enabled) ----
  const gate = needsPerformanceForEnterpriseLys({ type, enterprise, performance });
  if (gate.needed) {
    const prompt_text = buildPerformancePrompt({ type, missing: gate.missing });

    return {
      ok: false,
      error: "NEEDS_PERFORMANCE_INPUT",
      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
      meta: {
        locale,
        species,
        type,
        breed,
        phase,
        region,
        version,
        normalize: !!normalize,
        reqKey,
        production: _production,
        production_inferred: _production_inferred,
        production: _production,
        production_inferred: _production_inferred,
        ingredients_mode: ingredients_source.mode,
        ingredients_file: ingredients_source.file,
      },
      parsed,
      itemsResolved,
      unknown,
      requirements_used: {
        label: req.profile?.label || null,
        phase: req.profile?.phase || phase,
        targets_raw: profileReqs_raw,
        tolerance: req.profile?.tolerance || null,
        resolved: req.resolved,
        sources: req.sources,
      },
      enterprise: {
        enabled: true,
        lys_curve: enterprise?.lys_curve || null,
        missing: gate.missing,
        detected: gate.detected,
      },
      prompt_text,
      message:
        "You enabled the enterprise Lys curve. Please provide the missing performance inputs so I can convert mg/day → % correctly.",
    };
  }

  // ---- Enterprise targets overlay (safe; never breaks analyzer) ----
  let enterprise_targets = null;
  let effectiveTargetsRaw = profileReqs_raw;

  const ent = enterprise && typeof enterprise === "object" ? enterprise : null;
  const perf = performance && typeof performance === "object" ? performance : null;

  // generator should run ONLY if user opted into Lys curve OR provided enterprise coefs
  const hasAnyEnterpriseSignal = !!(
    ent &&
    ent.enabled &&
    ((ent.lys_curve && ent.lys_curve.enabled === true) ||
      (ent.coefs && typeof ent.coefs === "object" && Object.keys(ent.coefs).length > 0))
  );

  if (hasAnyEnterpriseSignal && typeof genEnterpriseTargetsV1 === "function") {
    try {
      const ctx = { species, type, breed, phase, region, version, locale };

      // pass lys_curve only when explicitly enabled
      const lysCurveOpts = ent.lys_curve && ent.lys_curve.enabled === true ? ent.lys_curve : undefined;

      const opts = {
        coefs: ent.coefs || undefined,
        lys_curve: lysCurveOpts,
      };

      enterprise_targets = genEnterpriseTargetsV1(profileReqs_raw, ctx, perf, opts);

      if (enterprise_targets && enterprise_targets.ok && enterprise_targets.targets_raw_generated) {
        effectiveTargetsRaw = { ...profileReqs_raw, ...enterprise_targets.targets_raw_generated };
      }
    } catch (e) {
      enterprise_targets = {
        ok: false,
        generator_id: "enterprise_targets_v1",
        error: "ENTERPRISE_GENERATOR_FAILED",
        message: e.message,
      };
      effectiveTargetsRaw = profileReqs_raw;
    }
  } else if (hasAnyEnterpriseSignal && typeof genEnterpriseTargetsV1 !== "function") {
    enterprise_targets = {
      ok: false,
      generator_id: "enterprise_targets_v1",
      error: "ENTERPRISE_GENERATOR_MISSING",
      message: "genEnterpriseTargetsV1 not found. Check module path.",
    };
  }

  // normalize targets keys to engine canonical keys
  const profileReqs = normalizeRequirementTargets(effectiveTargetsRaw);

  const requirements_source = {
    reqKey,
        production: _production,
        production_inferred: _production_inferred,
        production: _production,
        production_inferred: _production_inferred,
    canonical: true,
    sources: req.sources,
    resolved: req.resolved,
  };

  // Keys (clean)
  const registry = tryLoadRegistry();
  const registry_loaded = !!registry;
  const allowedKeys = buildAllowedNutrientKeys(registry);

  // Map "friendly" keys to ingredient DB keys
  const altMap = {
    lys: "sid_lys",
    met: "sid_met",
    met_cys: "sid_metcys",
    thr: "sid_thr",
    trp: "sid_trp",
    arg: "sid_arg",
    ile: "sid_ile",
    leu: "sid_leu",
    val: "sid_val",
  };

  const evaluation_keys_defined_by_profile = pickEvaluationKeys({
    requirements: profileReqs,
    evaluation_keys: evaluation_keys_from_profile,
    allowedKeys,
  });

  const keysWanted = evaluation_keys_defined_by_profile.slice();

  // Compute
  const nutrient_profile_full = sumNutrients(itemsResolved, db, keysWanted, altMap);
  const coverage = buildCoverage(itemsResolved, db, keysWanted, altMap);

    // (removed duplicate) evaluation_keys_used was declared earlier by mistake
const evaluation_keys_used = keysWanted.filter((k) => coverage[k] && coverage[k].supported);
const evaluation_keys_skipped_unsupported = keysWanted.filter((k) => !evaluation_keys_used.includes(k));

  const nutrient_profile = {};
  for (const k of evaluation_keys_used) nutrient_profile[k] = nutrient_profile_full[k];
  nutrient_profile.unknown = unknown;
  nutrient_profile.coverage = {};
  for (const k of evaluation_keys_used) nutrient_profile.coverage[k] = coverage[k];

  const nutrient_profile_core = JSON.parse(JSON.stringify(nutrient_profile));

  const requirements_canonical = {};
  const deviations_canonical = {};

  for (const k of evaluation_keys_used) {
    const act = num(nutrient_profile_full[k]);
    const reqv = num(reqMin(profileReqs[k]));

    requirements_canonical[k] = reqv;

    const diff = act - reqv;
    const pct = reqv === 0 ? 0 : (diff / reqv) * 100;

    deviations_canonical[k] = {
      actual: k === "me" ? +act.toFixed(1) : round4(act),
      required: reqv,
      diff: k === "me" ? +diff.toFixed(1) : round4(diff),
      pct: +pct.toFixed(2),
    };
  }

  const evaluation = evaluateAgainstRequirements(profileReqs, nutrient_profile_full, evaluation_keys_used);

  return {
    ok: true,

    parsed,
    itemsResolved,
    unknown,

    meta: {
      species,
      type,
      breed,
      region,
      version,
      phase,
      reqKey,
        production: _production,
        production_inferred: _production_inferred,
        production: _production,
        production_inferred: _production_inferred,
      locale,
      normalize: !!normalize,
      ingredients_mode: ingredients_source.mode,
      ingredients_file: ingredients_source.file,
      enterprise_targets: enterprise_targets || null,
    },

    ingredients_source: {
      mode: ingredients_source.mode,
      file: ingredients_source.file,
    },

    requirements_used: {
      label: req.profile?.label || null,
      phase: req.profile?.phase || phase,
      targets_raw: profileReqs_raw,
      targets_raw_effective: effectiveTargetsRaw,
      targets: profileReqs,
      tolerance: req.profile?.tolerance || null,
      resolved: req.resolved,
      sources: req.sources,
    },

    requirements_source,
    requirements_basis_note:
      `PASS/FAIL/WARN is evaluated against the selected requirements profile: ` +
      `${species} → ${type} → ${breed} → ${phase} (region=${region}, version=${version}, reqKey=${reqKey}).`,

    registry_loaded,
    evaluation_keys_used,
    evaluation_keys_defined_by_profile,
    evaluation_keys_skipped_unsupported,

    nutrient_profile,
    nutrient_profile_core,
    nutrient_profile_full: {
      ...nutrient_profile_full,
      unknown,
      coverage,
    },

    requirements_canonical,
    deviations_canonical,
    evaluation,
    overall: evaluation.overall,
    version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
  };
}

module.exports = { analyzeFormula };






















