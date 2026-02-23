// C:\Users\Administrator\My Drive\NutriPilot\nutripilot-agrocore\core\engine\analyzeFormula.cjs
"use strict";

/**
 * core/engine/analyzeFormula.cjs
 * AgroCore v1.4.4+ — STABILIZED
 *
 * Full file replacement (safe):
 * - Keeps all existing behavior (registry, DM scaling, CP modes, parsing, evaluation)
 * - Adds robust requirements source flattening:
 *   ✅ supports req.sources OR req.source OR fallback to legacy-style fields
 *   ✅ exposes meta.requirements_mode / *_file paths
 *   ✅ exposes requirements_source.requirements_* fields
 *
 * ADDITION (2026-02-22):
 * - Adds requirements mapping/meta passthrough immediately after resolveRequirements():
 *   ✅ meta.requirements_targets_raw_keys_used
 *   ✅ meta.requirements_targets_mapped_keys_used
 *   ✅ meta.requirements_targets_mapping_applied
 *
 * FIX (2026-02-22):
 * - Adds meta.requirements_targets_raw (so PS targets_num counting works)
 */

const fs = require("node:fs");
const path = require("node:path");

const { parseFormulaText } = require("../parser/parseFormulaText.cjs");
const { loadIngredients } = require("../db/ingredients/_index/LOAD_INGREDIENTS.cjs");

// Canonical requirements resolver (index+library) with BOM-safe JSON read inside.
const { resolveRequirements } = require("./requirements/LOAD_REQUIREMENTS_PROFILE.cjs");

// -------------------- Small helpers --------------------
function pickOverrideCaseInsensitive(obj, key) {
  if (!obj || !key) return null;
  if (obj[key] != null) return obj[key];
  const k2 = String(key).toLowerCase();
  if (obj[k2] != null) return obj[k2];
  for (const kk of Object.keys(obj)) {
    if (String(kk).toLowerCase() === k2) return obj[kk];
  }
  return null;
}

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

function normalizePercentLike(x) {
  // Accepts 86 or 0.86, returns percent number (0..100)
  const n = toNumberOrNull(x);
  if (!isNum(n)) return null;
  if (n > 0 && n <= 1) return +(n * 100).toFixed(6);
  if (n > 1 && n <= 100) return +n.toFixed(6);
  return null;
}

// requirements values may be number | {min/target/...} | "1.23"
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

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[‐-–—]/g, "-");
}

function toSnake(s) {
  return normKey(s)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// -------------------- Registry (optional) --------------------
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

function extractRegistryKeys(registry) {
  // Supports registry.nutrients as ARRAY or OBJECT
  if (!registry || !registry.nutrients) return [];
  if (Array.isArray(registry.nutrients)) {
    return registry.nutrients
      .map((n) => (n && typeof n.key === "string" ? n.key.trim() : ""))
      .filter(Boolean);
  }
  if (typeof registry.nutrients === "object") {
    return Object.keys(registry.nutrients);
  }
  return [];
}

// -------------------- Aliases (optional) --------------------
const ALIASES_REL = "../db/aliases/poultry/us/v1/aliases.poultry.us.v1.json";
let _ALIASES_CACHE = null;

function tryLoadAliases() {
  if (_ALIASES_CACHE) return _ALIASES_CACHE;
  try {
    const p = path.join(__dirname, ALIASES_REL);
    if (!fs.existsSync(p)) return null;
    const j = readJson(p);
    _ALIASES_CACHE = j && j.aliases && typeof j.aliases === "object" ? j.aliases : null;
    return _ALIASES_CACHE;
  } catch (_) {
    return null;
  }
}

function resolveDbKeyWithTrace(rawKey, aliases, db) {
  const raw = String(rawKey || "").trim();
  if (!raw) return { raw: rawKey, resolved: raw, via: "none", found_in_db: false };

  // 1) direct hit
  if (db[raw]) return { raw: rawKey, resolved: raw, via: "direct", found_in_db: true };

  const n = normKey(raw);

  // 2) alias hit
  if (aliases && aliases[n]) {
    const mapped = String(aliases[n] || "").trim();
    if (mapped && db[mapped]) return { raw: rawKey, resolved: mapped, via: "alias", found_in_db: true };

    const mappedSnake = toSnake(mapped);
    if (mappedSnake && db[mappedSnake]) {
      return { raw: rawKey, resolved: mappedSnake, via: "alias_snake", found_in_db: true };
    }

    if (mapped) return { raw: rawKey, resolved: mapped, via: "alias", found_in_db: !!db[mapped] };
  }

  // 3) snake fallback
  const snake = toSnake(raw);
  if (snake && db[snake]) return { raw: rawKey, resolved: snake, via: "snake", found_in_db: true };

  return { raw: rawKey, resolved: raw, via: "none", found_in_db: false };
}

// -------------------- Normalize sources --------------------
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

// -------------------- Requirements key normalization --------------------
function normalizeRequirementTargets(targets) {
  const t = targets && typeof targets === "object" ? targets : {};
  const out = {};

  for (const [k0, v] of Object.entries(t)) {
    if (!k0) continue;
    const k = String(k0).toLowerCase().trim();

    let canon = k;

    // skip known non-nutrient envelopes
    if (canon === "_lock" || canon === "meta" || canon === "schema" || canon === "note" || canon === "_meta") {
      continue;
    }

    // energy
    if (k === "me_kcal_per_kg" || k === "me_kcal_kg" || k === "me_kcalkg" || k === "me") canon = "me";

    // percent-style suffix
    if (canon.endsWith("_pct")) canon = canon.slice(0, -4);

    // common aliases
    if (canon === "avail_p" || canon === "available_p") canon = "avp";

    // variants
    if (canon === "metcys") canon = "met_cys";
    if (canon === "sid_met_cys") canon = "sid_metcys";

    out[canon] = v;
  }

  return out;
}

// -------------------- Keys allow-list --------------------
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
    "total_lys",
    "total_met",
    "total_metcys",
    "total_thr",
    "total_trp",
    "total_arg",
    "total_ile",
    "total_leu",
    "total_val",
  ]);

  for (const k of extractRegistryKeys(registry)) base.add(k);

  return base;
}

function pickEvaluationKeys({ requirements, evaluation_keys, allowedKeys }) {
  const req = requirements || {};
  let keys = [];

  if (Array.isArray(evaluation_keys) && evaluation_keys.length > 0) keys = evaluation_keys.slice();
  else keys = Object.keys(req);

  const out = [];
  for (const k of keys) {
    if (!k) continue;
    if (k === "_LOCK" || k === "meta" || k === "schema" || k === "note" || k === "_meta") continue;
    if (!allowedKeys.has(k)) continue;

    const v = reqMin(req[k]);
    if (v === null) continue;

    out.push(k);
  }
  return out;
}

function normalizeKeyList(keysWanted) {
  // Ensure keys are strings and remove accidental numeric keys "0","1",...
  const out = [];
  const seen = new Set();
  for (const k of Array.isArray(keysWanted) ? keysWanted : []) {
    if (typeof k !== "string") continue;
    const kk = k.trim();
    if (!kk) continue;
    if (/^\d+$/.test(kk)) continue;
    if (seen.has(kk)) continue;
    seen.add(kk);
    out.push(kk);
  }
  return out;
}

function buildCoverage(itemsResolved, db, keysWanted, altMap) {
  const keys = normalizeKeyList(keysWanted);
  const coverage = {};
  for (const k of keys) {
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

    coverage[k] = { present, missing, nonzero, supported: present > 0 };
  }
  return coverage;
}

// -------------------- AA / digestibility helpers --------------------
const NON_DM_SCALE_KEYS = new Set(["deb"]);

function aaNameFromKey(k) {
  // sid_lys -> lys ; total_met -> met
  if (!k) return "";
  return String(k).replace(/^sid_/, "").replace(/^total_/, "");
}

function getSidCoef(ing, aa) {
  if (!ing || !aa) return null;

  // Preferred object form: ing.sid_coefs = { lys:0.90, met:0.91, ... }
  if (ing.sid_coefs && typeof ing.sid_coefs === "object") {
    const v = ing.sid_coefs[aa];
    const n = toNumberOrNull(v);
    return isNum(n) && n > 0 && n <= 1 ? n : null;
  }

  // Or flattened: ing.sid_coef_lys, ing.sid_coef_met ...
  const flat = toNumberOrNull(ing[`sid_coef_${aa}`]);
  if (isNum(flat) && flat > 0 && flat <= 1) return flat;

  return null;
}

// -------------------- Summation --------------------
function sumNutrients(itemsResolved, db, keysWanted, altMap, options = {}) {
  const keys = normalizeKeyList(keysWanted);

  const out = {};
  for (const k of keys) out[k] = 0;

  const dmMode = options && options.dm_scale_mode ? String(options.dm_scale_mode).trim() : "ME_ONLY";
  const cpMode = options && options.cp_apply_mode ? String(options.cp_apply_mode).trim() : "NONE";

  for (const it of itemsResolved) {
    const ing = db[it.ingredient];
    if (!ing) continue;

    const pct = num(it.inclusion) / 100.0;
    const dmRatio = isNum(it.dm_ratio) && it.dm_ratio > 0 ? it.dm_ratio : 1;
    const cpRatio = isNum(it.cp_ratio) && it.cp_ratio > 0 ? it.cp_ratio : 1;

    // Ingredient-level DM scaling factor (based on actual DM vs reference)
    const dmPolicy = ing && ing.adjust_policy ? ing.adjust_policy.dm_scale : null;
    const dmPct = toNumberOrNull(ing.dm_pct);

    let dmKeyFactorBase = 1;
    if (dmPolicy && dmPolicy.enabled === true && isNum(dmPct) && dmPct > 0) {
      const ref = toNumberOrNull(dmPolicy.ref_dm_pct);
      const refUsed = isNum(ref) && ref > 0 ? ref : 88;
      dmKeyFactorBase = dmPct / refUsed;
    }

    for (const k of keys) {
      const rawKey = altMap[k] || k;

      // Base value from DB
      let v = ing[rawKey];
      if (v === undefined || v === null) continue;

      // ---- CP logic ----
      // - CP scales with cp_ratio
      // - total_* scales with cp_ratio
      // - sid_* recomputed from (total_* * cp_ratio) × digestibility coef (recommended)
      if (cpMode !== "NONE" && cpRatio !== 1) {
        if (k === "cp") {
          v = num(v) * cpRatio;
        } else if (k.startsWith("total_")) {
          v = num(v) * cpRatio;
        } else if (k.startsWith("sid_")) {
          const aa = aaNameFromKey(k);
          const totalKey = `total_${aa}`;
          const totalBase = toNumberOrNull(ing[totalKey]);

          if (cpMode === "RECOMPUTE_SID_FROM_TOTAL") {
            const coef = getSidCoef(ing, aa);
            if (isNum(totalBase) && isNum(coef)) {
              const totalAdj = totalBase * cpRatio;
              v = totalAdj * coef;
            } else {
              // Missing pieces: keep DB SID value (do NOT scale directly)
              v = num(v);
            }
          } else if (cpMode === "TOTAL_ONLY") {
            v = num(v);
          } else if (cpMode === "SCALE_SID_DIRECT") {
            v = num(v) * cpRatio;
          }
        }
      }

      // ---- DM scaling mode ----
      let dmKeyFactor = 1;
      if (dmKeyFactorBase !== 1) {
        if (dmMode === "ALL_NUTRIENTS") {
          dmKeyFactor = NON_DM_SCALE_KEYS.has(k) ? 1 : dmKeyFactorBase;
        } else {
          dmKeyFactor = k === "me" ? dmKeyFactorBase : 1;
        }
      }

      out[k] += num(v) * dmRatio * dmKeyFactor * pct;
    }
  }

  const rounded = {};
  for (const k of Object.keys(out)) {
    if (k === "me") rounded[k] = +num(out[k]).toFixed(1);
    else rounded[k] = round4(out[k]);
  }

  if (keys.includes("na") && keys.includes("k") && keys.includes("cl")) {
    rounded.deb = computeDeb(rounded);
  }

  return rounded;
}

// -------------------- Evaluation --------------------
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

// -------------------- Clarification text helpers --------------------
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

// -------------------- NORMALIZE (engine-side) --------------------
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
  if (!("total" in parsed) && !("total_inclusion" in parsed)) parsed.total = total;
}

function normalizeParsedInclusions(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const originalTotal = computeParsedTotal(parsed);

  if (!items.length || originalTotal <= 0) return { normalized: false, originalTotal, factor: null };

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

// -------------------- main --------------------
function analyzeFormula(params = {}) {
  const options = params && params.options && typeof params.options === "object" ? params.options : {};

  const {
    locale = "US",
    formula_text = "",
    species = "poultry",
    type = "broiler",
    breed = "generic",
    phase = "starter",
    region = "us",
    version = "v1",
    normalize = false,
  } = params;

  const parsed = parseFormulaText(formula_text);

  const dm_scale_mode_effective = options && options.dm_scale_mode ? String(options.dm_scale_mode).trim() : null;
  const cp_apply_mode_effective = options && options.cp_apply_mode ? String(options.cp_apply_mode).trim() : null;

  const _version = String(version || "v1").trim();
  let _production = String(params.production || "").trim().toLowerCase();

  // NP_PRODUCTION_EFF_SINGLE_SOURCE_v1
  // Single source of truth for production:
  // - uses params.production if provided
  // - otherwise infers from type
  let _production_inferred = false;

  // Normalize/alias incoming production values
  if (_production === "egg") _production = "layer";
  if (_production === "female") _production = "breeder";

  const production_eff = _production && _production.trim()
    ? _production.trim()
    : String(type || "").toLowerCase() === "broiler"
      ? "meat"
      : String(type || "").toLowerCase() === "layer"
        ? "layer"
        : String(type || "").toLowerCase() === "broiler_breeder"
          ? "breeder"
          : "";

  if (!_production) {
    _production = production_eff;
    _production_inferred = true;
  }

  // ---- Option-B phase canonicalization for requirements ----
  const _phase_input = String(phase || "").trim();
  let _phase_req = _phase_input.toLowerCase();
  if (_phase_req.includes("_")) {
    const parts = _phase_req.split("_").filter(Boolean);
    const tail = parts[parts.length - 1];
    const allowed = new Set([
      "prelay",
      "pre-lay",
      "early",
      "peak",
      "late",
      "starter",
      "grower",
      "finisher",
      "breeder",
      "layer",
      "meat",
      "prepeak",
      "postpeak",
      "post-peak",
      "parent",
    ]);
    if (allowed.has(tail)) _phase_req = tail;
  }
  if (_phase_req === "pre-lay") _phase_req = "prelay";
  if (_phase_req === "post-peak") _phase_req = "postpeak";

  // poultry waterfowl inference (only if still missing)
  if (!_production && String(species || "").toLowerCase() === "poultry") {
    const t = String(type || "").toLowerCase();
    if (["duck", "goose", "quail", "turkey"].includes(t)) {
      const ph = String(phase || "").toLowerCase();
      if (ph.includes("breeder") || ph.includes("parent") || ph === "breeder") _production = "breeder";
      else if (ph.includes("lay") || ph === "layer") _production = "layer";
      else _production = "meat";
      _production_inferred = true;
    }
  }

  // Clarification (non-blocking)
  let needs_clarification = null;
  let clarification_text = null;
  let clarification_examples = null;

  if (parsed.needs_clarification && parsed.needs_clarification.length > 0) {
    needs_clarification = parsed.needs_clarification;
    clarification_text = buildClarificationText(parsed.needs_clarification);
    clarification_examples = buildClarificationExamples(parsed.needs_clarification);
  }

  if (normalize === true) normalizeParsedInclusions(parsed);

  // Ingredients DB (basis=sid for poultry)
  const ingLoaded = loadIngredients({ species, region, version, basis: "sid" });
  const db = ingLoaded.db || {};
  const ingredients_source = normalizeIngredientsSource(ingLoaded);

  // Unknown + resolved items + resolution map + overrides applied
  const unknown = [];
  const itemsResolved = [];
  const resolution_map = [];
  const aliases = tryLoadAliases();

  const dm_overrides_applied = [];
  const cp_overrides_applied = [];

  const ovRoot =
    params && params.lab && params.lab.ingredient_overrides && typeof params.lab.ingredient_overrides === "object"
      ? params.lab.ingredient_overrides
      : null;

  // resolve + compute dm_ratio/cp_ratio
  for (const it of parsed.items || []) {
    const rawKey = it.ingredient;

    const trace = resolveDbKeyWithTrace(rawKey, aliases, db);
    const resolvedKey = trace.resolved;
    const has = !!db[resolvedKey];
    const ing = has ? db[resolvedKey] : null;

    const labOv = ovRoot ? (pickOverrideCaseInsensitive(ovRoot, resolvedKey) || pickOverrideCaseInsensitive(ovRoot, rawKey)) : null;

    // ---- DM override ----
    const dm_from_parser_pct = normalizePercentLike(it.dm_percent);
    const dm_from_lab_pct = labOv ? normalizePercentLike(labOv.dm) : null;
    const dm_ref_pct = ing ? normalizePercentLike(ing.dm_pct) : null;
    const dm_used_pct = isNum(dm_from_lab_pct) ? dm_from_lab_pct : isNum(dm_from_parser_pct) ? dm_from_parser_pct : null;

    let dm_ratio = 1;
    if (isNum(dm_used_pct) && isNum(dm_ref_pct) && dm_used_pct > 0 && dm_ref_pct > 0) {
      dm_ratio = +((dm_used_pct / dm_ref_pct).toFixed(8));
      if (dm_ratio !== 1) {
        dm_overrides_applied.push({
          ingredient: resolvedKey,
          raw: String(rawKey || ""),
          dm_percent_used: dm_used_pct,
          dm_percent_ref: dm_ref_pct,
          dm_ratio,
          source: isNum(dm_from_lab_pct) ? "lab" : "parser",
        });
      }
    }

    // ---- CP override ----
    const cp_from_lab_pct = labOv ? normalizePercentLike(labOv.cp) : null;
    const cp_ref_pct = ing ? normalizePercentLike(ing.cp) : null;

    let cp_ratio = 1;
    if (isNum(cp_from_lab_pct) && isNum(cp_ref_pct) && cp_from_lab_pct > 0 && cp_ref_pct > 0) {
      cp_ratio = +((cp_from_lab_pct / cp_ref_pct).toFixed(8));
      if (cp_ratio !== 1) {
        cp_overrides_applied.push({
          ingredient: resolvedKey,
          raw: String(rawKey || ""),
          cp_actual: cp_from_lab_pct,
          cp_ref: cp_ref_pct,
          cp_ratio,
          source: "lab",
        });
      }
    }

    resolution_map.push({
      raw: String(rawKey || ""),
      canonical: String(resolvedKey || ""),
      via: trace.via || "none",
      found_in_db: has,
      inclusion: it.inclusion,
    });

    if (!has) {
      unknown.push({ ingredient: rawKey, dbKey: resolvedKey, has_dbKey: false, inclusion: it.inclusion });
      continue;
    }

    itemsResolved.push({
      ingredient: resolvedKey,
      inclusion: it.inclusion,
      lot: it.lot ?? null,
      raw: rawKey !== resolvedKey ? rawKey : undefined,
      dm_ratio,
      cp_ratio,
    });
  }

  // ---- DM gating ----
  if (dm_overrides_applied.length > 0 && !dm_scale_mode_effective) {
    return {
      ok: false,
      error: "NEEDS_DM_SCALE_MODE",
      message: "DM overrides were provided. Choose whether to apply DM scaling to ME only or to all nutrients.",
      choices: ["ME_ONLY", "ALL_NUTRIENTS"],
      meta: {
        locale,
        species,
        type,
        breed,
        phase,
        region,
        version,
        normalize: !!normalize,
        dm_scale_mode_used: null,
        cp_apply_mode_used: cp_apply_mode_effective || null,
        dm_overrides_applied,
        cp_overrides_applied,
        ingredients_mode: ingredients_source.mode,
        ingredients_file: ingredients_source.file,
        production: production_eff,
        production_inferred: _production_inferred,
        resolution_map,
        needs_clarification,
        clarification_text,
        clarification_examples,
      },
      parsed,
      itemsResolved,
      unknown,
      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
    };
  }

  // ---- CP gating ----
  if (cp_overrides_applied.length > 0 && !cp_apply_mode_effective) {
    return {
      ok: false,
      error: "NEEDS_CP_APPLY_MODE",
      message: "CP overrides were provided. Choose how CP should affect Total AAs and how SID AAs should be recomputed.",
      choices: ["RECOMPUTE_SID_FROM_TOTAL", "TOTAL_ONLY", "SCALE_SID_DIRECT"],
      recommended: "RECOMPUTE_SID_FROM_TOTAL",
      meta: {
        locale,
        species,
        type,
        breed,
        phase,
        region,
        version,
        normalize: !!normalize,
        dm_scale_mode_used: dm_scale_mode_effective || "ME_ONLY",
        cp_apply_mode_used: null,
        dm_overrides_applied,
        cp_overrides_applied,
        ingredients_mode: ingredients_source.mode,
        ingredients_file: ingredients_source.file,
        production: production_eff,
        production_inferred: _production_inferred,
        resolution_map,
        needs_clarification,
        clarification_text,
        clarification_examples,
      },
      parsed,
      itemsResolved,
      unknown,
      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
    };
  }

  // Requirements
  let req = null;
  let reqKey = null;
  let profileReqs_raw = {};
  let evaluation_keys_from_profile = [];
  let requirements_load_error = null;

  // NEW: mapping passthrough vars (default null)
  let requirements_targets_raw_keys_used = null;
  let requirements_targets_mapped_keys_used = null;
  let requirements_targets_mapping_applied = null;

  // FIX: expose raw targets into meta for diagnostics
  let requirements_targets_raw = null;

  try {
    req = resolveRequirements({
      species,
      type,
      breed,
      phase: _phase_req,
      region,
      version: _version,
      production: production_eff, // ✅ critical: never pass undefined
    });

    // -------------------- Requirements mapping/meta passthrough (NEW) --------------------
    try {
      // Loader may store these under req.meta (preferred) or occasionally at top-level
      const m = req && req.meta && typeof req.meta === "object" ? req.meta : req;

      if (m) {
        if (m.requirements_targets_raw && typeof m.requirements_targets_raw === "object") {
          requirements_targets_raw = m.requirements_targets_raw;
        }

        if (Array.isArray(m.requirements_targets_raw_keys_used))
          requirements_targets_raw_keys_used = m.requirements_targets_raw_keys_used;

        if (Array.isArray(m.requirements_targets_mapped_keys_used))
          requirements_targets_mapped_keys_used = m.requirements_targets_mapped_keys_used;

        if (typeof m.requirements_targets_mapping_applied === "boolean")
          requirements_targets_mapping_applied = m.requirements_targets_mapping_applied;
      }
    } catch (_) {}
    // -------------------------------------------------------------------------------

    if (req && req.ok) {
      reqKey = req.reqKey || null;
      profileReqs_raw =
        req && req.requirements && typeof req.requirements === "object"
          ? req.requirements
          : req?.profile?.targets
            ? req.profile.targets
            : {};
      evaluation_keys_from_profile = Array.isArray(req.profile?.evaluation_keys) ? req.profile.evaluation_keys : [];
    } else {
      requirements_load_error = req?.error || "REQUIREMENTS_UNKNOWN";
    }
  } catch (e) {
    requirements_load_error = "REQUIREMENTS_LOAD_FAILED";
    return {
      ok: false,
      error: "REQUIREMENTS_LOAD_FAILED",
      message: e.message,
      parsed,
      itemsResolved,
      unknown,
      meta: {
        dm_scale_mode_used: dm_scale_mode_effective || "ME_ONLY",
        cp_apply_mode_used: cp_apply_mode_effective || "NONE",
        locale,
        species,
        type,
        breed,
        phase,
        region,
        version,
        normalize: !!normalize,
        dm_overrides_applied,
        cp_overrides_applied,
      },
      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
    };
  }

  const effectiveTargetsRaw = profileReqs_raw;
  const profileReqs = normalizeRequirementTargets(effectiveTargetsRaw);

  // -------------------- Requirements source flattening (NEW) --------------------
  const _srcCandidate =
    req && req.sources && typeof req.sources === "object"
      ? req.sources
      : req && req.source && typeof req.source === "object"
        ? req.source
        : null;

  const _src = _srcCandidate || {};

  const requirements_mode =
    _src && typeof _src.mode === "string" && _src.mode.trim()
      ? String(_src.mode).trim()
      : req && req.ok
        ? "option_b"
        : null;

  const requirements_wrap_file =
    (typeof _src.wrapPath === "string" && _src.wrapPath.trim())
      ? _src.wrapPath
      : (typeof _src.wrap_file === "string" && _src.wrap_file.trim())
        ? _src.wrap_file
        : (typeof req?.wrapPath === "string" && req.wrapPath.trim())
          ? req.wrapPath
          : (typeof req?.wrap_file === "string" && req.wrap_file.trim())
            ? req.wrap_file
            : null;

  const requirements_index_file =
    (typeof _src.indexPath === "string" && _src.indexPath.trim())
      ? _src.indexPath
      : (typeof _src.index_file === "string" && _src.index_file.trim())
        ? _src.index_file
        : (typeof req?.indexPath === "string" && req.indexPath.trim())
          ? req.indexPath
          : (typeof req?.index_file === "string" && req.index_file.trim())
            ? req.index_file
            : null;

  const requirements_library_file =
    (typeof _src.libPath === "string" && _src.libPath.trim())
      ? _src.libPath
      : (typeof _src.library_file === "string" && _src.library_file.trim())
        ? _src.library_file
        : (typeof req?.libPath === "string" && req.libPath.trim())
          ? req.libPath
          : (typeof req?.library_file === "string" && req.library_file.trim())
            ? req.library_file
            : null;
  // ---------------------------------------------------------------------------

  const requirements_source = req && req.ok
    ? {
      reqKey,
      production: production_eff,
      production_inferred: _production_inferred,
      canonical: true,

      requirements_mode,
      requirements_wrap_file,
      requirements_index_file,
      requirements_library_file,

      sources: _srcCandidate || null,
      resolved: req.resolved || null,
    }
    : {
      reqKey: null,
      production: production_eff,
      production_inferred: _production_inferred,
      canonical: false,

      requirements_mode: requirements_mode || null,
      requirements_wrap_file: requirements_wrap_file || null,
      requirements_index_file: requirements_index_file || null,
      requirements_library_file: requirements_library_file || null,

      sources: _srcCandidate || null,
      resolved: null,
      error: requirements_load_error || "REQUIREMENTS_UNKNOWN",
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

  const evaluation_keys_defined_by_profile = req && req.ok
    ? pickEvaluationKeys({
      requirements: profileReqs,
      evaluation_keys: evaluation_keys_from_profile,
      allowedKeys,
    })
    : [];

  const keysWanted = evaluation_keys_defined_by_profile.slice();

  const registryKeysAll = extractRegistryKeys(registry);

  const keysForProfile = registryKeysAll.length
    ? registryKeysAll
    : keysWanted.length
      ? keysWanted
      : [
        "me",
        "amen",
        "ne",
        "cp",
        "starch",
        "sugars",
        "ee",
        "linoleic",
        "linolenic",
        "oleic",
        "sfa",
        "ufa",
        "cf",
        "ndf",
        "adf",
        "lignin",
        "nsp_total",
        "nsp_sol",
        "nsp_insol",
        "beta_glucans",
        "arabinoxylans",
        "ca",
        "p_total",
        "avp",
        "npp",
        "dig_p",
        "mg",
        "s",
        "na",
        "k",
        "cl",
        "deb",
        "sid_lys",
        "sid_met",
        "sid_cys",
        "sid_metcys",
        "sid_thr",
        "sid_trp",
        "sid_arg",
        "sid_ile",
        "sid_val",
        "sid_leu",
        "total_lys",
        "total_met",
        "total_cys",
        "total_metcys",
        "total_thr",
        "total_trp",
        "total_arg",
        "total_ile",
        "total_val",
        "total_leu",
        "vit_a",
        "vit_d3",
        "vit_e",
        "vit_k",
        "vit_b1",
        "vit_b2",
        "vit_b6",
        "vit_b12",
        "niacin",
        "pantothenic_acid",
        "folic_acid",
        "biotin",
        "choline",
        "zn",
        "mn",
        "cu",
        "fe",
        "i",
        "se",
      ];

  const sumOptions = {
    dm_scale_mode: dm_scale_mode_effective || "ME_ONLY",
    cp_apply_mode: cp_apply_mode_effective || "NONE",
  };

  const nutrient_profile_full_core = sumNutrients(itemsResolved, db, keysForProfile, altMap, sumOptions);

  const normalizedKeysForCoverage = normalizeKeyList(keysForProfile);
  const coverage = buildCoverage(itemsResolved, db, normalizedKeysForCoverage, altMap);

  const evaluation_keys_used = keysWanted.filter((k) => coverage[k] && coverage[k].supported);
  const evaluation_keys_skipped_unsupported = keysWanted.filter((k) => !evaluation_keys_used.includes(k));

  const nutrient_profile = {};
  for (const k of evaluation_keys_used) nutrient_profile[k] = nutrient_profile_full_core[k];
  nutrient_profile.unknown = unknown;
  nutrient_profile.coverage = {};
  for (const k of evaluation_keys_used) nutrient_profile.coverage[k] = coverage[k];

  const nutrient_profile_core = JSON.parse(JSON.stringify(nutrient_profile));

  const requirements_canonical = {};
  const deviations_canonical = {};

  for (const k of evaluation_keys_used) {
    const act = num(nutrient_profile_full_core[k]);
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

  const evaluation = req && req.ok
    ? evaluateAgainstRequirements(profileReqs, nutrient_profile_full_core, evaluation_keys_used)
    : { overall: "NO_REQUIREMENTS", findings: [] };

  return {
    ok: true,

    parsed,
    itemsResolved,
    unknown,

    meta: {
      dm_scale_mode_used: dm_scale_mode_effective || "ME_ONLY",
      cp_apply_mode_used: cp_apply_mode_effective || "NONE",

      locale,
      species,
      type,
      breed,
      phase,
      region,
      version,
      normalize: !!normalize,

      reqKey,

      production: production_eff,
      production_inferred: _production_inferred,

      ingredients_mode: ingredients_source.mode,
      ingredients_file: ingredients_source.file,

      dm_overrides_applied,
      cp_overrides_applied,

      needs_clarification,
      clarification_text,
      clarification_examples,

      resolution_map,
      enterprise_targets: null,

      // requirements convenience fields in meta
      requirements_mode: requirements_mode || null,
      requirements_wrap_file: requirements_wrap_file || null,
      requirements_index_file: requirements_index_file || null,
      requirements_library_file: requirements_library_file || null,

      // NEW: mapping behavior passthrough
      requirements_targets_raw: requirements_targets_raw || null,
      requirements_targets_raw_keys_used,
      requirements_targets_mapped_keys_used,
      requirements_targets_mapping_applied,
    },

    ingredients_source: {
      mode: ingredients_source.mode,
      file: ingredients_source.file,
    },

    requirements_used: req && req.ok
      ? {
        label: req.profile?.label || null,
        phase: req.profile?.phase || phase,
        targets_raw: profileReqs_raw,
        targets_raw_effective: effectiveTargetsRaw,
        targets: profileReqs,
        tolerance: req.profile?.tolerance || null,
        resolved: req.resolved || null,
        sources: _srcCandidate || null,
      }
      : null,

    requirements_source,

    requirements_basis_note: req && req.ok
      ? `PASS/FAIL/WARN is evaluated against the selected requirements profile: ${species} → ${type} → ${breed} → ${phase} (region=${region}, version=${version}, reqKey=${reqKey}).`
      : `No requirements profile could be loaded for: ${species} → ${type} → ${breed} → ${phase} (region=${region}, version=${version}, production=${_production}).`,

    registry_loaded,
    evaluation_keys_used,
    evaluation_keys_defined_by_profile,
    evaluation_keys_skipped_unsupported,

    nutrient_profile,
    nutrient_profile_core,

    nutrient_profile_full: { ...nutrient_profile_full_core, coverage, unknown },

    requirements_canonical,
    deviations_canonical,
    evaluation,
    overall: evaluation.overall,
    version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",
  };
}

module.exports = { analyzeFormula };