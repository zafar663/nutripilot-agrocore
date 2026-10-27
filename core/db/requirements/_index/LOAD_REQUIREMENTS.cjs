// core/db/requirements/_index/LOAD_REQUIREMENTS.cjs
"use strict";

const fs = require("fs");
const path = require("path");

function safePathResolve(...parts) {
  // NP_SAFE_PATH_RESOLVE_v1
  // Prevents path.resolve(undefined) crash; preserves behavior for normal strings.
  return path.resolve(...parts.map((p) => (p == null ? "" : String(p))));
}

function readJson(p) {
  const s = fs.readFileSync(p, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(s);
}
function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return readJson(p);
  } catch (_) {
    return null;
  }
}
function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}
function normalizeToken(s) {
  return safeLower(s).replace(/\s+/g, "_").replace(/[^a-z0-9_]+/g, "_");
}

function loadLegacyIndex(baseDir) {
  const indexPath = path.join(baseDir, "_index", "requirements.index.v1.json");
  const idx = readJsonIfExists(indexPath);
  return { idx, indexPath };
}
function loadAliases(baseDir) {
  const aliasPath = path.join(baseDir, "_index", "requirements.aliases.v1.json");
  const aliases = readJsonIfExists(aliasPath) || {};
  return { aliases, aliasPath };
}
function applyAlias(mapObj, rawValue) {
  const v0 = String(rawValue ?? "").trim();
  if (!v0) return "";
  const key = safeLower(v0);
  if (mapObj && Object.prototype.hasOwnProperty.call(mapObj, key)) return mapObj[key];

  const norm = normalizeToken(v0);
  if (mapObj && Object.prototype.hasOwnProperty.call(mapObj, norm)) return mapObj[norm];
  return norm;
}
function buildKey({ species, type, breed, region, version }) {
  return `${normalizeToken(species)}/${normalizeToken(type)}/${normalizeToken(breed)}/${normalizeToken(region)}/${normalizeToken(version)}`;
}

// Legacy vendor format: phases[]
function pickPhaseLegacy(reqDoc, phase) {
  const phases = Array.isArray(reqDoc?.phases) ? reqDoc.phases : [];
  if (!phases.length) return null;
  const wanted = normalizeToken(phase || "");
  if (!wanted) return phases[0];
  const hit = phases.find((p) => normalizeToken(p?.phase) === wanted);
  return hit || phases[0];
}
function toRequirementsMapLegacy(phaseObj) {
  const out = {};
  if (!phaseObj || typeof phaseObj !== "object") return out;
  for (const [k, v] of Object.entries(phaseObj)) {
    if (k === "phase" || k === "age_days" || k === "_meta") continue;
    const num = Number(v);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

/**
 * Extract numeric targets from a candidate object.
 * Returns {} if nothing numeric found.
 *
 * NP_EXTRACT_NUMERIC_TARGETS_V2
 * - Supports numbers, numeric strings, unit-bearing strings ("2780 kcal/kg"),
 *   and common wrapped objects ({value},{target},{min},{max}, etc.).
 * - Back-compatible with old behavior for plain numbers.
 */
function extractNumericTargets(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;

  for (const [k, v] of Object.entries(obj)) {
    let num = NaN;

    // 1) Plain number
    if (typeof v === "number") {
      num = v;

      // 2) Numeric string (e.g., "2780" or "0.74" or "2780 kcal/kg")
    } else if (typeof v === "string") {
      const s = v.trim();
      const m = s.match(/-?\d+(\.\d+)?/);
      if (m) num = Number(m[0]);

      // 3) Object wrapper (e.g., { value: 2780 }, { target: 0.74 }, { min: 0.7 })
    } else if (v && typeof v === "object") {
      const candidate =
        v.value ??
        v.target ??
        v.recommended ??
        v.req ??
        v.minimum ??
        v.min ??
        v.maximum ??
        v.max;

      if (typeof candidate === "number") {
        num = candidate;
      } else if (typeof candidate === "string") {
        const s = candidate.trim();
        const m = s.match(/-?\d+(\.\d+)?/);
        if (m) num = Number(m[0]);
      }
    }

    if (Number.isFinite(num)) out[k] = num;
  }

  return out;
}

/**
 * Resolve "profiles keyed by reqKey" schema with inheritance.
 * Library schema supported:
 *   lib.profiles[reqKey] = {
 *     label, production, phase,
 *     targets: {...},
 *     inherits: "baseReqKey",
 *     targets_override: {...},
 *     tolerance: {...},
 *     evaluation_keys: [...]
 *   }
 */
function resolveProfileByReqKey(libObj, reqKey, _seen = new Set()) {
  const profiles = libObj && libObj.profiles && typeof libObj.profiles === "object" ? libObj.profiles : null;
  if (!profiles || !reqKey) return null;

  const key = String(reqKey);
  if (_seen.has(key)) return null;
  _seen.add(key);

  const prof = profiles[key];
  if (!prof || typeof prof !== "object") return null;

  // base
  let base = null;
  if (typeof prof.inherits === "string" && prof.inherits.trim()) {
    base = resolveProfileByReqKey(libObj, prof.inherits.trim(), _seen);
  }

  const baseTargets = base && base.targets && typeof base.targets === "object" ? base.targets : {};
  const baseOverride = base && base.targets_override && typeof base.targets_override === "object" ? base.targets_override : {};

  const thisTargets = prof.targets && typeof prof.targets === "object" ? prof.targets : {};
  const thisOverride = prof.targets_override && typeof prof.targets_override === "object" ? prof.targets_override : {};

  // Merge order: base.targets -> base.targets_override -> this.targets -> this.targets_override
  const mergedTargets = Object.assign({}, baseTargets, baseOverride, thisTargets, thisOverride);

  // Carry tolerance/eval keys forward (child overrides base if provided)
  const mergedTolerance =
    prof.tolerance && typeof prof.tolerance === "object"
      ? prof.tolerance
      : base && base.tolerance && typeof base.tolerance === "object"
        ? base.tolerance
        : null;

  const mergedEvalKeys = Array.isArray(prof.evaluation_keys)
    ? prof.evaluation_keys
    : base && Array.isArray(base.evaluation_keys)
      ? base.evaluation_keys
      : null;

  return {
    key,
    label: prof.label || (base ? base.label : null) || null,
    production: prof.production || (base ? base.production : null) || null,
    phase: prof.phase || (base ? base.phase : null) || null,
    targets: mergedTargets,
    tolerance: mergedTolerance || null,
    evaluation_keys: mergedEvalKeys || null,
    inherits: prof.inherits || null,
    feed_intake: prof.feed_intake || (base ? base.feed_intake : null) || null,
    doc_meta: prof.doc_meta || (base ? base.doc_meta : null) || null,
  };
}

/**
 * Try to interpret different library schemas into a merged numeric target map.
 * Supported:
 * - lib.profiles.generic.targets_by_phase[phase]
 * - lib.targets_by_phase[phase]
 * - lib.targets (numeric flat object)
 * - lib.nutrient_targets (numeric flat object)
 * - NEW Schema D:
 *   - lib.profiles[reqKey].targets (+ inherits + targets_override)
 */
function resolveTargetsFromLibrary({ libObj, breedKey, phaseKey, reqKey }) {
  if (!libObj || typeof libObj !== "object") return { requirements: {}, profile: null };

  // ---- Schema D (your current broiler library) ----
  if (reqKey && libObj.profiles && typeof libObj.profiles === "object" && libObj.profiles[reqKey]) {
    const prof = resolveProfileByReqKey(libObj, reqKey);
    const req = extractNumericTargets(prof?.targets || {});
    if (Object.keys(req).length) {
      return {
        requirements: req,
        profile: prof
          ? {
              key: prof.key,
              label: prof.label || null,
              production: prof.production || null,
              phase: prof.phase || phaseKey || null,
              tolerance: prof.tolerance || null,
              evaluation_keys: prof.evaluation_keys || null,
              feed_intake: prof.feed_intake || null,
              doc_meta: prof.doc_meta || null,
            }
          : null,
      };
    }
  }

  // ---- Schema A (preferred older shape): profiles.generic.targets_by_phase[phase] ----
  const profiles = libObj.profiles && typeof libObj.profiles === "object" ? libObj.profiles : null;
  if (profiles) {
    const generic = profiles["generic"] || {};
    const prof = profiles[breedKey] || {};

    const genericPhase =
      generic?.targets_by_phase && generic.targets_by_phase[phaseKey] ? generic.targets_by_phase[phaseKey] : null;

    const merged = Object.assign({}, genericPhase || {}, generic?.targets_override || {}, prof?.targets_override || {});

    const req = extractNumericTargets(merged);
    if (Object.keys(req).length) return { requirements: req, profile: null };
  }

  // ---- Schema B: top-level targets_by_phase[phase] ----
  if (libObj.targets_by_phase && typeof libObj.targets_by_phase === "object") {
    const phaseObj = libObj.targets_by_phase[phaseKey] || libObj.targets_by_phase["starter"];
    const req = extractNumericTargets(phaseObj);
    if (Object.keys(req).length) return { requirements: req, profile: null };
  }

  // ---- Schema C: flat numeric objects ----
  if (libObj.targets && typeof libObj.targets === "object") {
    const req = extractNumericTargets(libObj.targets);
    if (Object.keys(req).length) return { requirements: req, profile: null };
  }
  if (libObj.nutrient_targets && typeof libObj.nutrient_targets === "object") {
    const req = extractNumericTargets(libObj.nutrient_targets);
    if (Object.keys(req).length) return { requirements: req, profile: null };
  }

  return { requirements: {}, profile: null };
}

/**
 * Recursively list files under a directory (safe: ignores permission errors).
 * NOTE: used only as a last-resort fallback when exact phase file is missing.
 */
function listFilesRecursive(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

/**
 * Find a phase JSON anywhere under:
 * core/db/requirements/poultry/<type>/
 * Preference order:
 * 1) exact .../v1/<region>/<phase>.json (current behavior)
 * 2) any file named "<phase>.json" under the <type> subtree
 * 3) if phase not found, no result.
 */
function findPhaseFileSmart({ baseDir, typeToken, regionToken, phaseToken }) {
  // 1) exact (current)
  const exact = path.join(baseDir, "poultry", typeToken, "v1", regionToken, `${phaseToken}.json`);
  if (fs.existsSync(exact)) return exact;

  // 2) scan anywhere under poultry/<type> for a matching filename
  const typeRoot = path.join(baseDir, "poultry", typeToken);
  if (!fs.existsSync(typeRoot)) return null;

  const wantName = `${phaseToken}.json`.toLowerCase();
  const files = listFilesRecursive(typeRoot);

  const hits = files.filter((p) => path.basename(p).toLowerCase() === wantName);
  if (!hits.length) return null;

  const prefer = hits
    .map((p) => ({ p, score: scorePhaseCandidate(p, regionToken) }))
    .sort((a, b) => b.score - a.score);

  return prefer[0].p;
}

function scorePhaseCandidate(p, regionToken) {
  const s = p.replace(/\\/g, "/").toLowerCase();
  let score = 0;
  if (s.includes("/v1/")) score += 5;
  if (regionToken && s.includes(`/${regionToken.toLowerCase()}/`)) score += 5;
  if (s.includes("/poultry/")) score += 1;
  return score;
}

// -------- Swine requirements loader --------
function resolveSwineRequirements({ baseDir, type, production, breed, phase, region }) {
  const libPath = path.join(
    baseDir,
    "swine",
    "v1",
    "requirements.library.swine.v1.json"
  );

  if (!fs.existsSync(libPath)) {
    return {
      ok: false,
      error: "SWINE_LIBRARY_MISSING",
      message: `Swine library not found at: ${libPath}`,
      details: { libPath },
    };
  }

  const libObj = readJsonIfExists(libPath);
  if (!libObj || !libObj.phases || typeof libObj.phases !== "object") {
    return {
      ok: false,
      error: "SWINE_LIBRARY_INVALID",
      message: "Swine library loaded but phases object is missing or invalid.",
      details: { libPath },
    };
  }

  // Resolve phase key — map incoming phase to library phase key
  const ph = normalizeToken(phase || "grower");
  const phaseAliases = {
    // nursery
    "nursery":           "nursery_p3",
    "nursery_phase_1":   "nursery_p1",
    "nursery_phase_2":   "nursery_p2",
    "nursery_phase_3":   "nursery_p3",
    "prestart":          "nursery_p1",
    "starter":           "nursery_p1",
    // grow-finish
    "grow":              "grower",
    "grow_finish":       "grower",
    "growfinish":        "grower",
    "finisher":          "finisher_early",
    "finish":            "finisher_early",
    "finisher_1":        "finisher_early",
    "finisher_2":        "finisher_mid",
    "finisher_3":        "finisher_late",
    "finisher_4":        "finisher_market",
    "market":            "finisher_market",
    // reproductive
    "gestation_early":   "gestation",
    "gestation_late":    "gestation",
    "gestating":         "gestation",
    "lactating":         "lactation",
    "sow":               "gestation",
    "gilt":              "gilt_development_early",
    "gilt_dev":          "gilt_development_early",
    "gilt_development":  "gilt_development_early",
    "wean_to_estrus":    "gestation",
    // boar
    "mature_boar":       "boar",
    "boar_production":   "boar",
  };

  // Try exact match first, then alias, then default
  let resolvedPhaseKey = null;
  if (libObj.phases[ph]) {
    resolvedPhaseKey = ph;
  } else if (phaseAliases[ph] && libObj.phases[phaseAliases[ph]]) {
    resolvedPhaseKey = phaseAliases[ph];
  } else {
    // fuzzy: find first phase key that contains the input
    const keys = Object.keys(libObj.phases);
    const fuzzy = keys.find(k => k.includes(ph) || ph.includes(k));
    resolvedPhaseKey = fuzzy || "grower";
  }

  const phaseData = libObj.phases[resolvedPhaseKey];
  if (!phaseData || typeof phaseData !== "object") {
    return {
      ok: false,
      error: "SWINE_PHASE_NOT_FOUND",
      message: `Swine phase '${ph}' (resolved: '${resolvedPhaseKey}') not found in library.`,
      details: { libPath, requestedPhase: ph, resolvedPhaseKey, availablePhases: Object.keys(libObj.phases) },
    };
  }

  // Build flat numeric requirements from phase data
  const requirements = buildSwineRequirements(phaseData);

  if (!Object.keys(requirements).length) {
    return {
      ok: false,
      error: "SWINE_PHASE_EMPTY",
      message: `Swine phase '${resolvedPhaseKey}' resolved but produced no numeric requirements.`,
      details: { libPath, resolvedPhaseKey },
    };
  }

  // Build profile object (mirrors poultry profile shape)
  const profile = {
    key: resolvedPhaseKey,
    label: phaseData.label || resolvedPhaseKey,
    production: production || null,
    phase: resolvedPhaseKey,
    feed_intake: {
      reference_kg_day: typeof phaseData.feed_intake_reference_kg_day === "object"
        ? phaseData.feed_intake_reference_kg_day
        : { value: phaseData.feed_intake_reference_kg_day || null },
      feeding_mode: phaseData.feeding_mode || "ad_libitum",
      by_bcs: phaseData.feed_intake_by_bcs || null,
      daily_requirements: phaseData.daily_requirements || null,
    },
    doc_meta: phaseData.doc_meta || null,
    body_weight_range_kg: phaseData.body_weight_range_kg || null,
    breeding_targets: phaseData.breeding_targets || null,
    special_ingredients: phaseData.special_ingredients || null,
  };

  return {
    ok: true,
    reqKey: `swine/${resolvedPhaseKey}`,
    reqFilePath: libPath,
    breed: "generic",
    phase: resolvedPhaseKey,
    requirements,
    profile,
    doc_meta: phaseData.doc_meta || libObj.library_meta || null,
    source: {
      mode: "swine_v1",
      libPath,
      resolvedPhaseKey,
      requestedPhase: ph,
    },
  };
}

/**
 * Flatten swine phase data into numeric requirements map.
 * Handles nested structures: energy, sid_amino_acids, minerals,
 * trace_minerals_added_ppm, vitamins_added_per_kg_diet.
 */
function buildSwineRequirements(phaseData) {
  const out = {};

  // Energy
  if (phaseData.energy && typeof phaseData.energy === "object") {
    const e = phaseData.energy;
    if (Number.isFinite(e.ne_kcal_kg))  out.ne_kcal_per_kg  = e.ne_kcal_kg;
    if (Number.isFinite(e.me_kcal_kg))  out.me_kcal_per_kg  = e.me_kcal_kg;
  }

  // SID Amino Acids
  if (phaseData.sid_amino_acids && typeof phaseData.sid_amino_acids === "object") {
    const aa = phaseData.sid_amino_acids;
    if (Number.isFinite(aa.lys_ne_ratio_g_mcal))  out.sid_lys_ne_ratio  = aa.lys_ne_ratio_g_mcal;
    if (Number.isFinite(aa.lys_me_ratio_g_mcal))  out.sid_lys_me_ratio  = aa.lys_me_ratio_g_mcal;
    if (Number.isFinite(aa.lys_pct))               out.sid_lys_pct       = aa.lys_pct;
    if (Number.isFinite(aa.lys_min_g_day))         out.sid_lys_min_g_day = aa.lys_min_g_day;
    if (Number.isFinite(aa.sid_lys_pct_typical))   out.sid_lys_pct_typical = aa.sid_lys_pct_typical;
    if (Number.isFinite(aa.l_lys_hcl_max_pct))     out.l_lys_hcl_max_pct = aa.l_lys_hcl_max_pct;

    // AA ratios to Lys
    if (aa.ratios_to_lys && typeof aa.ratios_to_lys === "object") {
      const r = aa.ratios_to_lys;
      if (Number.isFinite(r.met_cys)) out.sid_met_cys_to_lys = r.met_cys;
      if (Number.isFinite(r.thr))     out.sid_thr_to_lys      = r.thr;
      if (Number.isFinite(r.trp))     out.sid_trp_to_lys      = r.trp;
      if (Number.isFinite(r.val))     out.sid_val_to_lys      = r.val;
      if (Number.isFinite(r.ile))     out.sid_ile_to_lys      = r.ile;
      if (Number.isFinite(r.leu))     out.sid_leu_to_lys      = r.leu;
      if (Number.isFinite(r.his))     out.sid_his_to_lys      = r.his;
      if (Number.isFinite(r.phe_tyr)) out.sid_phe_tyr_to_lys  = r.phe_tyr;
    }
  }

  // Minerals
  if (phaseData.minerals && typeof phaseData.minerals === "object") {
    const m = phaseData.minerals;
    if (Number.isFinite(m.sttd_p_ne_ratio_g_mcal))  out.sttd_p_ne_ratio  = m.sttd_p_ne_ratio_g_mcal;
    if (Number.isFinite(m.sttd_p_me_ratio_g_mcal))  out.sttd_p_me_ratio  = m.sttd_p_me_ratio_g_mcal;
    if (Number.isFinite(m.avail_p_ne_ratio_g_mcal)) out.avail_p_ne_ratio = m.avail_p_ne_ratio_g_mcal;
    if (Number.isFinite(m.avail_p_me_ratio_g_mcal)) out.avail_p_me_ratio = m.avail_p_me_ratio_g_mcal;
    if (Number.isFinite(m.sttd_p_pct))              out.sttd_p_pct       = m.sttd_p_pct;
    if (Number.isFinite(m.avail_p_pct))              out.avail_p_pct      = m.avail_p_pct;
    if (Number.isFinite(m.calcium_pct))              out.calcium_pct      = m.calcium_pct;
    if (Number.isFinite(m.sodium_pct))               out.sodium_pct       = m.sodium_pct;
    if (Number.isFinite(m.chloride_pct))             out.chloride_pct     = m.chloride_pct;
    if (Number.isFinite(m.ca_to_p_ratio_analyzed))  out.ca_to_p_ratio    = m.ca_to_p_ratio_analyzed;
    if (Number.isFinite(m.ndf_min_pct))              out.ndf_min_pct      = m.ndf_min_pct;
    if (Number.isFinite(m.linoleic_acid_pct)) {
      out.linoleic_acid_pct = m.linoleic_acid_pct;
      out.linoleic = m.linoleic_acid_pct;
    }
    // nested ca_to_p_ratio object
    if (m.ca_to_p_ratio && typeof m.ca_to_p_ratio === "object") {
      if (Number.isFinite(m.ca_to_p_ratio.min)) out.ca_to_p_ratio_min = m.ca_to_p_ratio.min;
      if (Number.isFinite(m.ca_to_p_ratio.max)) out.ca_to_p_ratio_max = m.ca_to_p_ratio.max;
    }
  }

  // Lactation: SID Lys from daily_requirements
  if (!out.sid_lys_ne_ratio && !out.sid_lys_me_ratio && !out.sid_lys_min_g_day) {
    const dr = phaseData.daily_requirements;
    const fi = phaseData.feed_intake_reference_kg_day;
    const refIntake = typeof fi === "object" ? (fi.herd || fi.sows || 6.0) : (typeof fi === "number" ? fi : 6.0);
    const lysGDay = dr && dr.sid_lys_g_day
      ? (dr.sid_lys_g_day.single_diet_herd || dr.sid_lys_g_day.single_diet_sows || null)
      : null;
    if (typeof lysGDay === "number" && lysGDay > 0) {
      out.sid_lys_min_g_day = lysGDay;
      out.sid_lys_ref_intake_kg_day = refIntake;
    }
  }
  // Trace minerals (ppm)
  if (phaseData.trace_minerals_added_ppm && typeof phaseData.trace_minerals_added_ppm === "object") {
    const t = phaseData.trace_minerals_added_ppm;
    if (Number.isFinite(t.zn))      out.trace_zn_ppm      = t.zn;
    if (Number.isFinite(t.fe))      out.trace_fe_ppm      = t.fe;
    if (Number.isFinite(t.mn))      out.trace_mn_ppm      = t.mn;
    if (Number.isFinite(t.cu))      out.trace_cu_ppm      = t.cu;
    if (Number.isFinite(t.iodine))  out.trace_iodine_ppm  = t.iodine;
    if (Number.isFinite(t.se))      out.trace_se_ppm      = t.se;
  }

  // Vitamins (per kg diet)
  if (phaseData.vitamins_added_per_kg_diet && typeof phaseData.vitamins_added_per_kg_diet === "object") {
    const v = phaseData.vitamins_added_per_kg_diet;
    if (Number.isFinite(v.vit_a_iu))             out.vit_a_iu_per_kg             = v.vit_a_iu;
    if (Number.isFinite(v.vit_d3_iu))            out.vit_d3_iu_per_kg            = v.vit_d3_iu;
    if (Number.isFinite(v.vit_e_iu))             out.vit_e_iu_per_kg             = v.vit_e_iu;
    if (Number.isFinite(v.vit_k_mg))             out.vit_k_mg_per_kg             = v.vit_k_mg;
    if (Number.isFinite(v.niacin_mg))            out.niacin_mg_per_kg            = v.niacin_mg;
    if (Number.isFinite(v.riboflavin_mg))        out.riboflavin_mg_per_kg        = v.riboflavin_mg;
    if (Number.isFinite(v.pantothenic_acid_mg))  out.pantothenic_acid_mg_per_kg  = v.pantothenic_acid_mg;
    if (Number.isFinite(v.vit_b12_mcg))          out.vit_b12_mcg_per_kg          = v.vit_b12_mcg;
    if (Number.isFinite(v.choline_mg))           out.choline_mg_per_kg           = v.choline_mg;
    if (Number.isFinite(v.folic_acid_mcg))       out.folic_acid_mcg_per_kg       = v.folic_acid_mcg;
    if (Number.isFinite(v.biotin_mcg))           out.biotin_mcg_per_kg           = v.biotin_mcg;
    if (Number.isFinite(v.thiamine_mg))          out.thiamine_mg_per_kg          = v.thiamine_mg;
    if (Number.isFinite(v.pyridoxine_mg))        out.pyridoxine_mg_per_kg        = v.pyridoxine_mg;
  }

  return out;
}

// -------- Option-B (index+library) --------
function resolveOptionB({ baseDir, type, production, breed, phase, region }) {
  const t = normalizeToken(type);
  const prod = normalizeToken(production);
  const b = normalizeToken(breed || "generic");
  const ph = normalizeToken(phase || "starter");
  const reg = normalizeToken(region || "us");

  const wrapPath = path.join(baseDir, "poultry", t, "v1", `requirements.index.poultry.${t}.v1.json`);
  const wrap = readJsonIfExists(wrapPath);

  let indexPath = null;
  let libPath = null;
  let indexObj = null;
  let libObj = null;

  const prodSlot = wrap && wrap.productions && wrap.productions[prod] ? wrap.productions[prod] : null;
  const slotLooksLikePointers =
    prodSlot &&
    typeof prodSlot === "object" &&
    (typeof prodSlot.index_file === "string" || typeof prodSlot.library_file === "string");

  const slotLooksLikeIndex = prodSlot && typeof prodSlot === "object" && (prodSlot.breeds || prodSlot.map);

  const looksLikeIndexContentOld =
    wrap &&
    typeof wrap === "object" &&
    (wrap.breeds || wrap.map || wrap.defaults) &&
    !wrap.productions &&
    !wrap.index_file &&
    !wrap.library_file;

  const looksLikeIndexContentWithProductions =
    wrap &&
    typeof wrap === "object" &&
    wrap.productions &&
    typeof wrap.productions === "object" &&
    !!prodSlot &&
    slotLooksLikeIndex &&
    !slotLooksLikePointers;

  if (looksLikeIndexContentOld || looksLikeIndexContentWithProductions) {
    indexObj = wrap;
    indexPath = wrapPath;

    const wrapDir = path.dirname(wrapPath);
    const preferredLib = `requirements.library.poultry.${t}.v1.json`;

    const preferredPath = path.join(wrapDir, preferredLib);
    if (fs.existsSync(preferredPath)) {
      libPath = preferredPath;
      libObj = readJsonIfExists(libPath);
    } else {
      const candidates = fs
        .readdirSync(wrapDir)
        .filter((n) => n.toLowerCase().endsWith(".json") && n.toLowerCase().includes("library"));
      const libName = candidates[0];
      if (libName) {
        libPath = path.join(wrapDir, libName);
        libObj = readJsonIfExists(libPath);
      }
    }

    if (!libObj) {
      return {
        ok: false,
        error: "REQUIREMENTS_OPTIONB_LIBRARY_MISSING",
        message: "Option-B index found but library file missing/unreadable beside it.",
        details: { wrapPath, indexPath, libPath },
      };
    }
  } else {
    if (slotLooksLikePointers) {
      indexPath = safePathResolve(path.dirname(wrapPath), prodSlot.index_file);
      libPath = safePathResolve(path.dirname(wrapPath), prodSlot.library_file);
    } else if (wrap?.index_file && wrap?.library_file) {
      indexPath = safePathResolve(path.dirname(wrapPath), wrap.index_file);
      libPath = safePathResolve(path.dirname(wrapPath), wrap.library_file);
    } else {
      const directDir = path.join(baseDir, "poultry", t, prod);
      const di = path.join(directDir, `index.poultry_${t}_${prod}.v1.json`);
      const dl = path.join(directDir, `library.poultry_${t}_${prod}.v1.json`);
      if (fs.existsSync(di) && fs.existsSync(dl)) {
        indexPath = di;
        libPath = dl;
      }
    }

    if (!indexPath || !libPath || !fs.existsSync(indexPath) || !fs.existsSync(libPath)) {
      return {
        ok: false,
        error: "REQUIREMENTS_OPTIONB_NOT_FOUND",
        message: `Option-B requirements not found for poultry/${t}/${prod}. Missing index/library.`,
        details: { wrapPath, indexPath, libPath },
      };
    }

    indexObj = readJsonIfExists(indexPath);
    libObj = readJsonIfExists(libPath);

    if (!indexObj || !libObj) {
      return {
        ok: false,
        error: "REQUIREMENTS_OPTIONB_FILES_UNREADABLE",
        message: "Option-B index/library unreadable",
        details: { indexPath, libPath },
      };
    }
  }

  if (!indexObj) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_INDEX_MISSING",
      message: "Option-B index object could not be loaded.",
      details: { wrapPath, indexPath, libPath },
    };
  }

  const canonicalSlot = indexObj?.productions && indexObj.productions[prod] ? indexObj.productions[prod] : null;
  const breedsMap = (canonicalSlot && (canonicalSlot.breeds || canonicalSlot.map)) || indexObj?.map || indexObj?.breeds || {};

  const defaults = indexObj?.defaults || {};
  const defaultBreed = normalizeToken(defaults?.breed || "generic");
  const defaultPhase = normalizeToken(defaults?.phase || "starter");
  // Apply breed_aliases from index before lookup
  const breedAliases = indexObj?.breed_aliases || {};
  const bResolved = breedAliases[b] ? normalizeToken(breedAliases[b]) : b;
  const breedKey = breedsMap[bResolved]
    ? bResolved
    : breedsMap[b]
      ? b
      : breedsMap[defaultBreed]
        ? defaultBreed
        : breedsMap["generic"]
          ? "generic"
        : Object.keys(breedsMap)[0];

  const phasesMap = breedKey ? breedsMap[breedKey] : null;

  if (!phasesMap || typeof phasesMap !== "object") {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_INDEX_INVALID",
      message: "Option-B index missing (breeds|map)[breed][phase]",
      details: {
        indexPath: indexPath || wrapPath,
        breedKey,
        hasBreeds: !!indexObj?.breeds || !!canonicalSlot?.breeds,
        hasMap: !!indexObj?.map || !!canonicalSlot?.map,
        prod,
      },
    };
  }

  const reqKey = phasesMap[ph] || phasesMap[defaultPhase] || phasesMap["starter"] || Object.values(phasesMap)[0];

  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_REQKEY_MISSING",
      message: "Option-B index could not resolve reqKey",
      details: { indexPath: indexPath || wrapPath, breedKey, phase: ph, prod },
    };
  }

  // ---------- Library merge (NOW supports Schema D) ----------
  const libResolved = resolveTargetsFromLibrary({ libObj, breedKey, phaseKey: ph, reqKey });
  let requirements = libResolved.requirements || {};
  const profile = libResolved.profile || null;

  // ---------- SMART FALLBACK (phase JSON files anywhere under poultry/<type>) ----------
  if (!Object.keys(requirements).length) {
    const phaseFile = findPhaseFileSmart({ baseDir, typeToken: t, regionToken: reg, phaseToken: ph });
    const phaseDoc = phaseFile ? readJsonIfExists(phaseFile) : null;

    if (phaseDoc && typeof phaseDoc === "object") {
      requirements = extractNumericTargets(phaseDoc);

      if (Object.keys(requirements).length) {
        return {
          ok: true,
          reqKey,
          requirements,
          breed: breedKey,
          phase: ph,
          profile: profile || null,
          source: {
            mode: "option_b_fallback_phase_file",
            wrapPath,
            indexPath: indexPath || wrapPath,
            libPath: libPath || null,
            phaseFile,
          },
          doc_meta: phaseDoc?._LOCK || phaseDoc?._meta || null,
        };
      }
    }

    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message:
        "Option-B resolved reqKey but targets are empty: library schema missing/empty and phase fallback file not found/empty.",
      reqKey,
      details: {
        libPath: libPath || null,
        breedKey,
        phase: ph,
        triedExactPhaseFile: path.join(baseDir, "poultry", t, "v1", reg, `${ph}.json`),
        triedSmartPhaseSearchUnder: path.join(baseDir, "poultry", t),
        prod,
      },
    };
  }

  return {
    ok: true,
    reqKey,
    requirements,
    profile: profile || null,
    breed: breedKey,
    phase: ph,
    source: { mode: "option_b", wrapPath, indexPath: indexPath || wrapPath, libPath: libPath || null },
    doc_meta: libObj?._LOCK || libObj?._meta || null,
  };
}

function loadRequirementsProfile(input = {}) {
  const baseDir = path.join(__dirname, ".."); // core/db/requirements
  const { idx, indexPath } = loadLegacyIndex(baseDir);
  const { aliases, aliasPath } = loadAliases(baseDir);

  const species = applyAlias(aliases?.species, input.species || "poultry");
  const type = applyAlias(aliases?.type, input.type || "broiler");
  const breed = applyAlias(aliases?.breed, input.breed || "ross_308");
  const region = applyAlias(aliases?.region, input.region || "global");
  const version = applyAlias(aliases?.version, input.version || "v2025");
  const phase = input.phase || "starter";
  const production = input.production || "";

  // NP_OPTIONB_PREFER_CANONICAL_V1
  if (String(production || "").trim()) {
    const tTok = normalizeToken(type);
    const pTok = normalizeToken(production);

    const directDir = path.join(baseDir, "poultry", tTok, pTok);
    const di = path.join(directDir, `index.poultry_${tTok}_${pTok}.v1.json`);
    const dl = path.join(directDir, `library.poultry_${tTok}_${pTok}.v1.json`);

    if (fs.existsSync(di) && fs.existsSync(dl)) {
      const obFirst = resolveOptionB({ baseDir, type, production, breed, phase, region });
      if (obFirst && obFirst.ok) {
        return {
          ok: true,
          requirements: obFirst.requirements,
          profile: obFirst.profile || null,
          reqKey: obFirst.reqKey,
          reqFilePath: obFirst.source?.indexPath || null,
          meta: {
            mode: "option_b_preferred",
            source: obFirst.source || null,
            resolved: { reqKey: obFirst.reqKey, breed: obFirst.breed, phase: obFirst.phase, production },
          },
        };
      }
    }
  }

  // A) Legacy vendor index
  if (idx && Array.isArray(idx.entries)) {
    const key = buildKey({ species, type, breed, region, version });
    const match = idx.entries.find((e) => e && e.key === key);
    if (match?.path) {
      const reqFilePath = path.join(baseDir, match.path);
      const doc = readJsonIfExists(reqFilePath);
      if (!doc) {
        return {
          ok: false,
          error: "REQUIREMENTS_FILE_UNREADABLE",
          message: `Requirements file not readable: ${reqFilePath}`,
          key,
          reqFilePath,
        };
      }
      const phaseObj = pickPhaseLegacy(doc, phase);
      if (!phaseObj) {
        return {
          ok: false,
          error: "REQUIREMENTS_EMPTY",
          message: `Requirements file has no phases[]: ${reqFilePath}`,
          key,
          reqFilePath,
        };
      }
      const requirements = toRequirementsMapLegacy(phaseObj);
      if (!Object.keys(requirements).length) {
        return {
          ok: false,
          error: "REQUIREMENTS_PHASE_EMPTY",
          message: `Phase found but no numeric keys: ${reqFilePath}`,
          key,
          reqFilePath,
          phase: phaseObj?.phase || phase,
        };
      }
      return {
        ok: true,
        reqKey: key,
        reqFilePath,
        species,
        type,
        breed,
        region,
        version,
        phase: phaseObj?.phase || phase,
        requirements,
        doc_meta: doc?._meta || null,
      };
    }
  }

  // C) Swine v1
  if (normalizeToken(species) === "swine") {
    const swineResult = resolveSwineRequirements({ baseDir, type, production, breed, phase, region });
    if (swineResult.ok) {
      return {
        ok: true,
        reqKey: swineResult.reqKey,
        reqFilePath: swineResult.reqFilePath,
        species,
        type: normalizeToken(type),
        breed: swineResult.breed || "generic",
        region,
        version,
        phase: swineResult.phase,
        requirements: swineResult.requirements,
        profile: swineResult.profile || null,
        doc_meta: swineResult.doc_meta || null,
        source: swineResult.source || null,
        resolved: { reqKey: swineResult.reqKey, breed: swineResult.breed, phase: swineResult.phase, production },
      };
    }
    return Object.assign({ species, type: normalizeToken(type), breed, region, version, phase, production }, swineResult);
  }

  // B) Option-B for poultry + v1
  if (normalizeToken(species) === "poultry" && normalizeToken(version) === "v1") {
    if (!String(production || "").trim()) {
      return {
        ok: false,
        error: "REQUIREMENTS_NEEDS_PRODUCTION",
        message: "Option-B V1 requires input.production (meat/layer/breeder).",
        meta: { species, type, breed, region, version, phase },
      };
    }

    const ob = resolveOptionB({ baseDir, type, production, breed, phase, region });
    if (ob.ok) {
      return {
        ok: true,
        reqKey: ob.reqKey,
        reqFilePath: ob.source?.indexPath || null,
        species,
        type: normalizeToken(type),
        breed: ob.breed,
        region,
        version,
        phase: ob.phase,
        requirements: ob.requirements,
        profile: ob.profile || null,
        doc_meta: ob.doc_meta || null,
        source: ob.source || null,
        resolved: { reqKey: ob.reqKey, breed: ob.breed, phase: ob.phase, production },
      };
    }

    return Object.assign({ species, type: normalizeToken(type), breed, region, version, phase, production }, ob);
  }

  return {
    ok: false,
    error: "REQUIREMENTS_PROFILE_NOT_FOUND",
    message: "No requirements profile found in legacy index, and Option-B not applicable.",
    meta: { species, type, breed, region, version, phase, production },
    indexPath,
    aliasPath,
  };
}

// Feed intake adjustment function
// Takes requirements at reference GPD and adjusts to actual GPD
function adjustRequirementsForFeedIntake(requirements, referenceGpd, actualGpd) {
  if (!requirements || !referenceGpd || !actualGpd || referenceGpd === actualGpd) {
    return requirements;
  }
  const skip = new Set(['me_kcal_per_kg', 'me_mj_per_kg', 'ne_kcal_per_kg']);
  const adjusted = {};
  for (const [key, val] of Object.entries(requirements)) {
    if (typeof val !== 'number') { adjusted[key] = val; continue; }
    if (skip.has(key)) { adjusted[key] = val; continue; }
    // daily_mg = val * referenceGpd * 10
    // adjusted_pct = daily_mg / actualGpd / 10
    adjusted[key] = Math.round((val * referenceGpd / actualGpd) * 1000) / 1000;
  }
  return adjusted;
}

// --- Robust exports (supports all calling styles) ---
module.exports = loadRequirementsProfile;
module.exports.loadRequirementsProfile = loadRequirementsProfile;
module.exports.loadRequirements = loadRequirementsProfile; // back-compat
module.exports.default = loadRequirementsProfile;
module.exports.adjustRequirementsForFeedIntake = adjustRequirementsForFeedIntake;