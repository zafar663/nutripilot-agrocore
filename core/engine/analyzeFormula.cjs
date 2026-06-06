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

 *

 * MIN CHANGE (2026-02-25):

 * - If requirements resolve to GENERIC (fallback), keep analysis but warn user:

 *   ✅ meta.requirements_fallback_used

 *   ✅ meta.requirements_warning

 *   ✅ requirements_used.fallback_used / requirements_used.warning

 *

 * MINIMAL FIXES (2026-02-27):

 * 1) ✅ normKey handles underscores -> spaces (sbm_48 -> sbm 48)

 * 2) ✅ Aliases loader supports BOTH shapes:

 *    - { aliases: { ... } } / { map: { ... } } / { db: { ... } }

 *    - { "corn": "corn_grain_avg", ... } (direct map)

 *    - ignores _LOCK/meta/schema envelopes so they don't pollute alias table

 * 3) ✅ Requirements targets are populated from Option-B library profiles (inherits + targets_override)

 *    when resolver returns only a profile shell.

 *

 * MINIMAL BUGFIX (2026-02-27, REQUIRED FOR ME/CP):

 * 4) ✅ Alias resolution supports 2-step chains (e.g. "sbm 48" -> "sbm_48" -> "soybean_meal_48_cp")

 *    with loop-guard. This fixes ME/CP=0 when corn/SBM resolve via chained aliases.

 *

 * MINIMAL FIX (2026-02-28):

 * 5) ✅ ALWAYS merge Option-B library profiles (inherits + targets_override) when libPath is present,

 *    not only when targets_override is empty. This ensures missing keys fall back to GENERIC (Option A).

 *

 * MINIMAL BUGFIX (2026-02-28, REQUIRED FOR SID_*):

 * 6) ✅ If ingredient DB stores nutrient keys as *_pct (e.g., sid_lys_pct),

 *    read from *_pct when raw key is missing (affects coverage + summation).

 *

 * MINIMAL BUGFIX (2026-03-01, REQUIRED FOR SYNTHETIC AA SID_*):

 * 7) ✅ If SID AA key is missing (e.g., sid_lys undefined) but total_lys exists (like l_lys_hcl),

 *    compute SID from TOTAL using digestibility coefficient if present; otherwise assume 100% (SID=TOTAL).

 *

 * ✅ MINIMAL FIX (2026-03-02):

 * 8) Layer production routing: requirements library uses production="egg" (not "layer").

 *    Keep meta.production="layer" for UI, but pass production_req_used="egg" to resolveRequirements().

 *

 * ✅ MINIMAL FIX (2026-03-02):

 * 9) Preserve rich layer phases like lay_peak/lay_early/etc (do NOT strip to "peak").

 *

 * ✅ MINIMAL ADDITION (SAFE, ONLY THIS CHANGE):

 * 10) LAB ingredient overrides v2 (silent incorporation; DOES NOT mutate cached DB):

 *     - Reads params.lab.__lab_overrides_v2 = { [ingredientKeyOrAlias]: { dm?:number, cp?:number } }

 *     - Applies overrides by cloning only affected ingredient objects into a per-request db_eff

 *     - Uses db_eff for coverage + summation ONLY (ratios/ref comparisons remain unchanged)

 */



const fs = require("node:fs");

const path = require("node:path");



const { parseFormulaText } = require("../parser/parseFormulaText.cjs");

const { loadIngredients } = require("../db/ingredients/_index/LOAD_INGREDIENTS.cjs");



// Canonical requirements resolver (index+library) with BOM-safe JSON read inside.

const { resolveRequirements } = require("./requirements/LOAD_REQUIREMENTS_PROFILE.cjs");

const { getSpeciesProfile } = require("../services/species/SPECIES_PROFILE_ROUTER.cjs");

const { generateEquineTargets } = require("../services/requirements/equine/equineNrc2007.engine.cjs");
const { resolveSwineRequirements } = require("../services/requirements/swine/swinePic2021.engine.cjs");
const { resolveDairyRequirements } = require("../services/requirements/dairy/dairyNasem2021.engine.cjs");
const { resolveBeefRequirements } = require("../services/requirements/beef/beefNasem2016.engine.cjs");
const { resolveSheepRequirements } = require("../services/requirements/sheep/sheepNrc2007.engine.cjs");
const { resolveGoatRequirements } = require("../services/requirements/goat/goatNrc2007.engine.cjs");
const { resolveShrimpRequirements } = require("../services/requirements/aqua/shrimpNrc2011.engine.cjs");
const { resolveSalmonidRequirements } = require("../services/requirements/aqua/salmonNrc2011.engine.cjs");
const { resolveTilapiaRequirements } = require("../services/requirements/aqua/tilapiaEngine.cjs");
const { resolveCarpRequirements } = require("../services/requirements/aqua/carpEngine.cjs");
const { resolveCatfishRequirements } = require("../services/requirements/aqua/catfishEngine.cjs");
const { resolveMarineFishRequirements } = require("../services/requirements/aqua/seabassSeabreamEngine.cjs");
const { resolveDogRequirements } = require("../services/requirements/dog/dogEngine.cjs");
const { resolveCatRequirements } = require("../services/requirements/cat/catEngine.cjs");

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



/**

 * MINIMAL FIX (aliasing):

 * Also replace underscores with spaces so parser tokens like "sbm_48"

 * match alias keys like "sbm 48".

 */

function normKey(s) {

  return String(s || "")

    .toLowerCase()

    .trim()

    .replace(/[_]+/g, " ") // ✅ sbm_48 -> sbm 48

    .replace(/\s+/g, " ")

    .replace(/[‐-–—]/g, "-")

    .trim();

}



/**

 * NEW (minimal, safe): alias key normalization that PRESERVES underscores.

 * Needed to support chained aliases like:

 *   "sbm 48" -> "sbm_48" -> "soybean_meal_48_cp"

 */

function aliasKeyNorm(s) {

  return String(s || "")

    .toLowerCase()

    .trim()

    .replace(/\s+/g, " ")

    .replace(/[‐-–—]/g, "-")

    .trim();

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



function tryLoadRegistry(speciesProfile) {

  try {

    const rel = speciesProfile?.nutrient_registry || REGISTRY_REL;

    const normalizedRel = String(rel).replace(/^core[\\/]/, "../");

    const p = path.join(__dirname, normalizedRel);



    if (!fs.existsSync(p)) return null;



    return readJson(p);

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



/**

 * MINIMAL FIX #1:

 * Support BOTH alias JSON shapes safely:

 *  1) { aliases: { ... } } / { map: { ... } } / { db: { ... } }

 *  2) { "corn": "corn_grain_avg", ... } (direct map)

 * And do NOT treat _LOCK/meta/schema envelopes as alias entries.

 *

 * MINIMAL BUGFIX:

 * Store keys in TWO forms:

 *  - aliasKeyNorm(): preserves underscores (so we can chase "sbm_48")

 *  - normKey(): underscores->spaces (so parser tokens match "sbm 48")

 */

function tryLoadAliases() {

  if (_ALIASES_CACHE) return _ALIASES_CACHE;

  try {

    const p = path.join(__dirname, ALIASES_REL);

    if (!fs.existsSync(p)) return null;

    const j = readJson(p);



    let map =

      j && j.aliases && typeof j.aliases === "object" && !Array.isArray(j.aliases)

        ? j.aliases

        : j && j.map && typeof j.map === "object" && !Array.isArray(j.map)

          ? j.map

          : j && j.db && typeof j.db === "object" && !Array.isArray(j.db)

            ? j.db

            : j && typeof j === "object" && !Array.isArray(j)

              ? j

              : null;



    if (!map) return null;



    const cleaned = {};

    for (const [k, v] of Object.entries(map)) {

      const kk = String(k || "").trim();

      if (!kk) continue;

      if (kk === "_LOCK" || kk === "_lock" || kk === "meta" || kk === "schema" || kk === "note") continue;

      if (v === null || v === undefined) continue;

      if (typeof v === "object") continue; // only accept string/number mappings



      const vv = String(v).trim();

      if (!vv) continue;



      // 1) preserve underscore form

      const kA = aliasKeyNorm(kk);

      if (kA) cleaned[kA] = vv;



      // 2) space-normalized form (parser-friendly)

      const kN = normKey(kk);

      if (kN && kN !== kA) cleaned[kN] = vv;

    }



    _ALIASES_CACHE = cleaned;

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



  // We'll try alias lookups using both normalizations:

  const nSpace = normKey(raw);      // underscores -> spaces

  const nKeep = aliasKeyNorm(raw);  // preserves underscores



  // Helper to attempt resolution with an alias key, plus chained hops if needed.

  const tryAliasChain = (key, tag) => {

    if (!aliases) return null;

    const seen = new Set();

    let curKey = key;



    for (let hop = 0; hop < 3; hop++) {

      if (!curKey) break;

      if (seen.has(curKey)) break;

      seen.add(curKey);



      const mapped = aliases[curKey];

      if (!mapped) break;



      const m = String(mapped || "").trim();

      if (!m) break;



      // If mapped is a DB key, done.

      if (db[m]) return { resolved: m, via: hop === 0 ? tag : `${tag}_chain${hop}`, found_in_db: true };



      // Also try snake(db-id) quickly

      const mSnake = toSnake(m);

      if (mSnake && db[mSnake]) {

        return { resolved: mSnake, via: hop === 0 ? `${tag}_snake` : `${tag}_chain${hop}_snake`, found_in_db: true };

      }



      // Otherwise, attempt next hop using BOTH key norms.

      const nextKeep = aliasKeyNorm(m);

      const nextSpace = normKey(m);



      // Prefer underscore-preserving hop first (more specific), then space.

      if (nextKeep && !seen.has(nextKeep)) curKey = nextKeep;

      else if (nextSpace && !seen.has(nextSpace)) curKey = nextSpace;

      else break;

    }



    // Alias existed but didn't land on DB key

    const firstMapped = aliases[key];

    if (firstMapped) return { resolved: String(firstMapped).trim(), via: tag, found_in_db: !!db[String(firstMapped).trim()] };

    return null;

  };



  // 2) alias hit (space-normalized)

  const hitSpace = tryAliasChain(nSpace, "alias");

  if (hitSpace) return { raw: rawKey, resolved: hitSpace.resolved, via: hitSpace.via, found_in_db: hitSpace.found_in_db };



  // 2b) alias hit (underscore-preserving)

  const hitKeep = tryAliasChain(nKeep, "alias_keep");

  if (hitKeep) return { raw: rawKey, resolved: hitKeep.resolved, via: hitKeep.via, found_in_db: hitKeep.found_in_db };



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



/**

 * MINIMAL BUGFIX #6 + #7 (pct + synthetic AA SID fallback):

 * Read a nutrient from DB using:

 *  1) rawKey

 *  2) rawKey+"_pct"

 *  3) If rawKey is "sid_*" and missing, use TOTAL_* (or TOTAL_*_pct) × sid_coef_* if present, else TOTAL_*.

 * This fixes l_lys_hcl where only total_lys exists (78.8) and sid_lys is undefined.

 */

function getIngValueWithPctFallback(ing, rawKey) {

  if (!ing || !rawKey) return undefined;



  const v = ing[rawKey];

  if (v !== undefined && v !== null) return v;



  const pctKey = `${rawKey}_pct`;

  const v2 = ing[pctKey];

  if (v2 !== undefined && v2 !== null) return v2;



  // ✅ Synthetic AA SID fallback: sid_* -> total_* (assume SID=TOTAL unless coef provided)

  if (String(rawKey).startsWith("sid_")) {

    const aa = aaNameFromKey(rawKey);

    if (aa) {

      const totalKey = `total_${aa}`;

      const t1 = ing[totalKey];

      if (t1 !== undefined && t1 !== null) {

        const coef = getSidCoef(ing, aa);

        const tn = toNumberOrNull(t1);

        if (isNum(tn)) return isNum(coef) ? tn * coef : tn;

        return t1;

      }

      const totalPctKey = `${totalKey}_pct`;

      const t2 = ing[totalPctKey];

      if (t2 !== undefined && t2 !== null) {

        const coef = getSidCoef(ing, aa);

        const tn = toNumberOrNull(t2);

        if (isNum(tn)) return isNum(coef) ? tn * coef : tn;

        return t2;

      }

    }

  }



  return undefined;

}



function buildCoverage(itemsResolved, db_eff, keysWanted, altMap) {

  const keys = normalizeKeyList(keysWanted);

  const coverage = {};

  for (const k of keys) {

    let present = 0;

    let missing = 0;

    let nonzero = 0;



    for (const it of itemsResolved) {

      const ing = db_eff[it.ingredient];

      if (!ing) {

        missing++;

        continue;

      }

      const rawKey = altMap[k] || k;

      const v = getIngValueWithPctFallback(ing, rawKey); // ✅ pct + synthetic SID fallback

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



// -------------------- Summation --------------------

function sumNutrients(itemsResolved, db_eff, keysWanted, altMap, options = {}) {

  const keys = normalizeKeyList(keysWanted);



  const out = {};

  for (const k of keys) out[k] = 0;



  const dmMode = options && options.dm_scale_mode ? String(options.dm_scale_mode).trim() : "ME_ONLY";

  const cpMode = options && options.cp_apply_mode ? String(options.cp_apply_mode).trim() : "NONE";



  for (const it of itemsResolved) {

    const ing = db_eff[it.ingredient];

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



      // Base value from DB (with pct + synthetic SID fallback)

      let v = getIngValueWithPctFallback(ing, rawKey);

      if (v === undefined || v === null) continue;



      // ---- CP logic ----

      // - CP scales with cp_ratio

      // - total_* scales with cp_ratio

      // - sid_* recomputed from (total_* * cp_ratio) × digestibility coef (recommended)

      if (cpMode !== "NONE") {

        if (k === "cp") {

          v = num(v) * cpRatio;

        } else if (k.startsWith("total_")) {

          v = num(v) * cpRatio;

        } else if (k.startsWith("sid_")) {

          const aa = aaNameFromKey(k);



          if (cpMode === "RECOMPUTE_SID_FROM_TOTAL" && (aa === "metcys" || aa === "met_cys")) {

            const totalMetBase = toNumberOrNull(getIngValueWithPctFallback(ing, "total_met"));

            const totalCysBase = toNumberOrNull(getIngValueWithPctFallback(ing, "total_cys"));

            const coefMet = getSidCoef(ing, "met");

            const coefCys = getSidCoef(ing, "cys");



            const sidMetPart =

              isNum(totalMetBase)

                ? ((totalMetBase * cpRatio) * (isNum(coefMet) ? coefMet : 1))

                : 0;



            const sidCysPart =

              isNum(totalCysBase)

                ? ((totalCysBase * cpRatio) * (isNum(coefCys) ? coefCys : 1))

                : 0;



            const combined = sidMetPart + sidCysPart;



            if (combined > 0) {

              v = combined;

            } else {

              v = num(v);

            }

          } else {

            const totalKey = `total_${aa}`;

            const totalBase = toNumberOrNull(getIngValueWithPctFallback(ing, totalKey));



            if (cpMode === "RECOMPUTE_SID_FROM_TOTAL") {

              const coef = getSidCoef(ing, aa);

              if (isNum(totalBase) && isNum(coef)) {

                const totalAdj = totalBase * cpRatio;

                v = totalAdj * coef;

              } else if (isNum(totalBase) && !isNum(coef)) {

                // If coef missing but total exists (e.g., synthetics), assume SID=TOTAL

                v = totalBase * cpRatio;

              } else {

                // Missing pieces: keep DB-derived SID value (do NOT scale directly)

                v = num(v);

              }

            } else if (cpMode === "TOTAL_ONLY") {

              v = num(v);

            } else if (cpMode === "SCALE_SID_DIRECT") {

              v = num(v) * cpRatio;

            }

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



function mergeEquineDailyAndSafetyEvaluation({ baseEvaluation, requirements, actual }) {

  const evaluation = {

    overall: baseEvaluation?.overall || "OK",

    findings: Array.isArray(baseEvaluation?.findings) ? [...baseEvaluation.findings] : []

  };



  function addFinding(key, actualValue, requiredValue, status, message) {

    evaluation.findings.push({

      nutrient: key,

      key,

      actual: actualValue,

      required: requiredValue,

      status,

      message

    });



    if (status === "FAIL") evaluation.overall = "FAIL";

    else if (status === "WARN" && evaluation.overall !== "FAIL") evaluation.overall = "WARN";

  }



  const dailyKeys = ["de_mcal_day", "cp_g_day", "lys_g_day", "ca_g_day", "p_g_day"];



  for (const key of dailyKeys) {

  let req = Number(requirements?.[key]);

  const act = Number(actual?.[key]);



  // Derive daily requirement if only concentration target exists.

  // cp_pct ? cp_g_day, lys_pct ? lys_g_day, de_mcal_kg ? de_mcal_day

  if (!Number.isFinite(req) || req <= 0) {

    const sourceKey = key

      .replace("_g_day", "_pct")

      .replace("_mcal_day", "_mcal_kg");



    const sourceVal = Number(requirements?.[sourceKey]);

    const dmiKgDay = Number(actual?.dm_intake_kg_day);



    if (Number.isFinite(sourceVal) && sourceVal > 0 && Number.isFinite(dmiKgDay) && dmiKgDay > 0) {

      if (key.endsWith("_g_day")) {

        req = Number((sourceVal * dmiKgDay * 10).toFixed(1));

      }



      if (key.endsWith("_mcal_day")) {

        req = Number((sourceVal * dmiKgDay).toFixed(3));

      }

    }

  }



  if (!Number.isFinite(req) || req <= 0) continue;

  if (!Number.isFinite(act)) continue;



  if (act < req * 0.95) {

    addFinding(key, act, req, "FAIL", `${key} is below daily requirement`);

  } else if (act > req * 1.25) {

    addFinding(key, act, req, "WARN", `${key} is above daily requirement`);

  }

}



  // Equine safety layer: high-starch/high-NSC and low-fiber checks

  const safetyChecks = [

    { key: "nsc_pct", mode: "max", limit: Number(requirements?.nsc_pct) || 25, failFactor: 1.15 },

    { key: "starch_pct", mode: "max", limit: Number(requirements?.starch_pct) || 20, failFactor: 1.15 },

    { key: "sugar_pct", mode: "max", limit: Number(requirements?.sugar_pct) || 10, failFactor: 1.25 },

    { key: "ndf_pct", mode: "min", limit: Number(requirements?.ndf_pct) || 25, failFactor: 0.90 },

    { key: "adf_pct", mode: "min", limit: Number(requirements?.adf_pct) || 15, failFactor: 0.90 }

  ];



  for (const check of safetyChecks) {

    const act = Number(actual?.[check.key]);

    if (!Number.isFinite(act)) continue;



    if (check.mode === "max" && act > check.limit) {

      const status = act > check.limit * check.failFactor ? "FAIL" : "WARN";

      addFinding(check.key, act, check.limit, status, `${check.key} exceeds equine safety limit`);

    }



    if (check.mode === "min" && act < check.limit) {

      const status = act < check.limit * check.failFactor ? "FAIL" : "WARN";

      addFinding(check.key, act, check.limit, status, `${check.key} is below equine fiber minimum`);

    }

  }



  return evaluation;

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



/**

 * MINIMAL FIX #2:

 * Load targets from Option-B library profiles (inherits + targets_override)

 * by walking inheritance and merging targets_override.

 */

function resolveTargetsFromLibraryProfiles(reqKey, libPath) {

  if (!reqKey || !libPath) return null;



  let lib;

  try {

    lib = readJson(libPath);

  } catch (_) {

    return null;

  }



  const profiles = lib && lib.profiles && typeof lib.profiles === "object" ? lib.profiles : null;

  if (!profiles) return null;



  const seen = new Set();

  function walk(key, depth) {

    if (!key || depth > 20) return {};

    if (seen.has(key)) return {};

    seen.add(key);



    const p = profiles[key];

    if (!p || typeof p !== "object") return {};



    const parentKey = typeof p.inherits === "string" ? p.inherits : null;

    const base = parentKey ? walk(parentKey, depth + 1) : {};



    const ov = p.targets_override && typeof p.targets_override === "object" ? p.targets_override : {};

    return { ...base, ...ov };

  }



  const merged = walk(reqKey, 0);

  return merged && typeof merged === "object" ? merged : null;

}



// -------------------- main --------------------

function analyzeFormula(params = {}) {

  const options = params && params.options && typeof params.options === "object" ? params.options : {};



  const {

    locale = "US",

    formula_text = "",

    resolved_rows = [],

    species = "poultry",

    type = "broiler",

    breed = "generic",

    phase = "starter",

    region = "us",

    version = "v1",

    normalize = false,
    body_weight_kg = 500,
    intake_pct_bw = 2.0,
    feedIntakeGpd = null,
  } = params;



  const parsed =

    Array.isArray(resolved_rows) && resolved_rows.length

      ? {

          rows: resolved_rows.map((r) => {

            const id = String(r.ingredient_id || r.canonical_id || r.ingredient_code || "").trim();



            return {

              id,

              name: id,

              ingredient_id: id,

              ingredient_code: id,

              raw_name: String(r.raw_name || r.ingredient_name || id).trim(),

              matched_name: String(r.ingredient_name || r.raw_name || id).trim(),

              canonical_id: id,

              inclusion: Number(r.inclusion || 0),

              resolved: r.resolved !== false,

              confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 1,

              family: r.family || null,

              grade_hint: r.grade_hint ?? null,

              nutritive: r.nutritive !== false,

            };

          }),

          total: resolved_rows.reduce((s, r) => s + Number(r?.inclusion || 0), 0),

          total_inclusion: resolved_rows.reduce((s, r) => s + Number(r?.inclusion || 0), 0),

          skipped: [],

          unknown_raw: [],

        }

      : parseFormulaText(formula_text);



  const dm_scale_mode_effective = options && options.dm_scale_mode ? String(options.dm_scale_mode).trim() : null;

  const cp_apply_mode_effective = (params && params.cp_apply_mode) ? String(params.cp_apply_mode).trim() : ((options && options.cp_apply_mode) ? String(options.cp_apply_mode).trim() : null);



  const _version = String(version || "v1").trim();

  let _production = String(params.production || "").trim().toLowerCase();



  // NP_PRODUCTION_EFF_SINGLE_SOURCE_v1

  // Single source of truth for production:

  // - uses params.production if provided

  // - otherwise infers from type

  let _production_inferred = false;



  // ✅ MINIMAL FIX: normalize incoming production for layer type

  // The layer requirements library uses production="egg" (not "layer").

  // Preserve UI semantics elsewhere.

  if (String(type || "").toLowerCase() === "layer") {

    if (_production === "layer") _production = "egg";

    // If user already sends egg, keep as egg (do NOT rewrite to layer)

  } else {

    if (_production === "egg") _production = "layer"; // legacy behavior for non-layer types if needed

  }



  if (_production === "female") _production = "breeder";



  // ✅ MINIMAL FIX: production_eff should align to requirements production key

  const production_eff = _production && _production.trim()

    ? _production.trim()

    : String(type || "").toLowerCase() === "broiler"

      ? "meat"

      : String(type || "").toLowerCase() === "layer"

        ? "egg"     // ✅ for layer type, requirements production is "egg"

        : String(type || "").toLowerCase() === "broiler_breeder"

          ? "breeder"

          : "";



  if (!_production) {

    _production = production_eff;

    _production_inferred = true;

  }



  // ✅ MINIMAL FIX: keep UI production separate from requirements production

  // UI: "layer" makes sense for dashboards. Requirements: "egg" matches your index.

  const production_ui = String(type || "").toLowerCase() === "layer" ? "layer" : production_eff;

  const production_req_used = production_eff;



  // ---- Option-B phase canonicalization for requirements ----

  const _phase_input = String(phase || "").trim();

  let _phase_req = _phase_input.toLowerCase();
  // Preserve full phase key for swine (gilt_development_early, nursery_p1 etc)
  const _is_swine = String(species || "").toLowerCase() === "swine";

  // ✅ MINIMAL FIX: preserve rich layer phases like lay_peak, lay_early, lay_mid, lay_late
  if (String(type || "").toLowerCase() === "layer" && _phase_req.startsWith("lay_")) {
    // keep as-is (do not strip to "peak")
  } else {
    if (!_is_swine && _phase_req.includes("_")) {
      const parts = _phase_req.split("_").filter(Boolean);
      const tail = parts[parts.length - 1];
      const allowed = new Set([
        "prelay", "pre-lay", "early", "peak", "late", "starter",
        "grower", "finisher", "breeder", "layer", "meat",
        "prepeak", "postpeak", "post-peak", "parent",
      ]);
      if (allowed.has(tail)) _phase_req = tail;
    }
    if (_phase_req === "pre-lay") _phase_req = "prelay";
    if (_phase_req === "post-peak") _phase_req = "postpeak";
  }



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



// __REAL_DB_ID_REMAP__

// Map parser/alias intermediate IDs to real live DB IDs before nutrient summation.

function remapToRealDbId(id) {

  const s = String(id || "").trim().toLowerCase();



  const map = {

    sbm_44: "soybean_meal_44_5_cp",

    sbm44: "soybean_meal_44_5_cp",



    sbm_46: "soybean_meal_46_5_cp",

    sbm46: "soybean_meal_46_5_cp",



    sbm_48: "soybean_meal_48_cp",

    sbm48: "soybean_meal_48_cp",



    fish_meal: "fish_meal_54_cp",

    fishmeal: "fish_meal_54_cp",

    fish_meal_54: "fish_meal_54_cp",

    fish_meal54: "fish_meal_54_cp",



    millet_bajra: "millet_grain",

    milletbajra: "millet_grain",

    bajra: "millet_grain",



    "salt nacl": "salt",

    "salt nacl ": "salt",

    "salt (nacl)": "salt",

    nacl: "salt",



    anti_coccidial: null,

    toxin_binder: null

  };



  return Object.prototype.hasOwnProperty.call(map, s) ? map[s] : id;

}

  // __LAB_OVERRIDES_V2__ (silent incorporation)

  // Accepts user keys ("corn", "sbm 48") and resolves them via aliases -> canonical DB key.

  const __lab_overrides_v2 =

    params && params.lab && params.lab.__lab_overrides_v2 && typeof params.lab.__lab_overrides_v2 === "object"

      ? params.lab.__lab_overrides_v2

      : null;



  const lab_overrides_v2_applied = [];

  let db_eff = db;



  try {

    if (__lab_overrides_v2) {

      const outDb = { ...db };



      for (const [rawK, ov] of Object.entries(__lab_overrides_v2)) {

        if (!ov || typeof ov !== "object") continue;



        const tr = resolveDbKeyWithTrace(rawK, aliases, db);

        const canon = tr && tr.resolved ? tr.resolved : String(rawK || "").trim();

        if (!canon || !outDb[canon] || typeof outDb[canon] !== "object") continue;



        const cloned = { ...outDb[canon] };

        let touched = false;



        if (Object.prototype.hasOwnProperty.call(ov, "dm") && typeof ov.dm === "number") {

          cloned.dm = ov.dm;

          cloned.dm_pct = ov.dm;

          touched = true;

        }



        if (Object.prototype.hasOwnProperty.call(ov, "cp") && typeof ov.cp === "number") {

          cloned.cp = ov.cp;

          touched = true;

        }



        if (touched) {

          outDb[canon] = cloned;

          lab_overrides_v2_applied.push({

            raw: String(rawK || ""),

            canonical: String(canon || ""),

            dm: (typeof ov.dm === "number") ? ov.dm : null,

            cp: (typeof ov.cp === "number") ? ov.cp : null

          });

        }

      }



      db_eff = outDb;

    }

  } catch (_) {}



  // __LAB_OVERRIDES_V2__ END

const dm_overrides_applied = [];

  const cp_overrides_applied = [];



  const ovRoot =

    params && params.lab && params.lab.ingredient_overrides && typeof params.lab.ingredient_overrides === "object"

      ? params.lab.ingredient_overrides

      : null;



  // ✅ MINIMAL ADDITION: LAB OVERRIDES v2 root (silent; may be absent)

  const __lab_overrides =

    params && params.lab && params.lab.__lab_overrides_v2 && typeof params.lab.__lab_overrides_v2 === "object"

      ? params.lab.__lab_overrides_v2

      : null;



  // resolve + compute dm_ratio/cp_ratio

  for (const it of (Array.isArray(parsed.items) && parsed.items.length ? parsed.items : (parsed.rows || []))) {

    const rawKey = String(

  it.ingredient ||

  it.ingredient_id ||

  it.id ||

  it.name ||

  it.canonical_id ||

  it.ingredient_code ||

  ""

).trim();



    const trace = resolveDbKeyWithTrace(rawKey, aliases, db);

    const resolvedKey = trace.resolved;

    const has = !!db[resolvedKey];

    const ing = has ? db[resolvedKey] : null;



    const labOv = ovRoot

      ? (pickOverrideCaseInsensitive(ovRoot, resolvedKey) || pickOverrideCaseInsensitive(ovRoot, rawKey))

      : null;



    // ---- DM override ----

    const dm_from_parser_pct = normalizePercentLike(it.dm_percent);

    const dm_from_lab_pct = labOv ? normalizePercentLike(labOv.dm) : null;

    const dm_ref_pct = ing ? normalizePercentLike(ing.dm_pct) : null;

    const dm_used_pct = isNum(dm_from_lab_pct)

      ? dm_from_lab_pct

      : (isNum(dm_from_parser_pct) ? dm_from_parser_pct : null);



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

        production: production_ui,

        production_req_used,

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

        production: production_ui,

        production_req_used,

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



  // ✅ MINIMAL ADDITION (v2 apply): clone only affected ingredient objects into per-request db_eff

  // NOTE: Does NOT affect dm_ratio/cp_ratio calculations above (those use original db values).

  db_eff = db;

  try {

    if (__lab_overrides && typeof __lab_overrides === "object") {

      const appliedAny = [];

      const dbCopy = { ...db };



      for (const [k0, ov] of Object.entries(__lab_overrides)) {

        if (!ov || typeof ov !== "object") continue;



        const keyRaw = String(k0 || "").trim();

        if (!keyRaw) continue;



        // Allow overrides by canonical DB key OR by alias/raw label (resolve via aliases+db)

        let resolvedKey = keyRaw;

        if (!dbCopy[resolvedKey]) {

          const tr = resolveDbKeyWithTrace(keyRaw, aliases, dbCopy);

          resolvedKey = tr && tr.resolved ? tr.resolved : keyRaw;

        }



        const base = dbCopy[resolvedKey];

        if (!base || typeof base !== "object") continue;



        // clone so we never mutate DB cache

        const ing2 = { ...base };

        const applied = { ingredient: resolvedKey };



        if (Object.prototype.hasOwnProperty.call(ov, "dm") && typeof ov.dm === "number") {

          // Keep existing schema behavior: dm_pct is used by dm_policy; dm may also exist in some DBs

          ing2.dm_pct = ov.dm;

          ing2.dm = ov.dm;

          applied.dm = ov.dm;

        }

        if (Object.prototype.hasOwnProperty.call(ov, "cp") && typeof ov.cp === "number") {

          ing2.cp = ov.cp;

          applied.cp = ov.cp;

        }



        if (Object.keys(applied).length > 1) {

          dbCopy[resolvedKey] = ing2;

          appliedAny.push(applied);

        }

      }



      if (appliedAny.length > 0) {

        // Reuse existing meta arrays (no new meta fields introduced)

        for (const a of appliedAny) dm_overrides_applied.push(a);

        db_eff = dbCopy;

      }

    }

  } catch (_) {}



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



  // MIN CHANGE: generic fallback warning

  let requirements_fallback_used = false;

  let requirements_warning = null;



  const speciesProfile = getSpeciesProfile(species);



  try {

    if (speciesProfile?.species === "equine") {

  const eq = generateEquineTargets({

    species,

    type,

    breed,

    phase: _phase_req,

    production: production_req_used,

    body_weight_kg: Number(body_weight_kg) || 500,
    intake_pct_bw: Number(intake_pct_bw) || 2.0,

    region,

    version: _version

  });



  req = {

  ok: true,

  reqKey: `equine_${type || "horse"}_${production_req_used || "maintenance"}_dynamic_nrc2007_v1`,



  // ?? THIS IS THE FIX

  requirements: eq?.targets || {},



  profile: {

    label: "Equine NRC 2007 dynamic requirements",

    targets: eq?.targets || {}

  },

    sources: {

  mode: "dynamic_nrc2007",

      requirements_index_file: "core/db/requirements/equine/index.equine.v1.json",

      requirements_library_file: "core/db/requirements/equine/horse/library.equine_horse_profiles.v1.json",

      resolved: false,

      warning: eq?.message || "Equine NRC 2007 engine pending."

    },

    meta: {

      nrc_engine_status: eq?.status || "NRC_ENGINE_PENDING"

    }

  };

  } else if (speciesProfile?.species === "dairy") {
  const mode = params?.requirements_mode || "static";
  const da = resolveDairyRequirements({
    mode,
    production: production_req_used,
    phase: _phase_req,
    bw_kg: Number(body_weight_kg) || 650,
    milk_kg_day: Number(params?.milk_kg_day) || 30,
    fat_pct: Number(params?.fat_pct) || 3.8,
    protein_pct: Number(params?.protein_pct) || 3.2,
    dim: Number(params?.dim) || 100,
    days_pregnant: Number(params?.days_pregnant) || 0,
    breed: breed || "holstein",
  });
  req = {
    ok: true,
    reqKey: `dairy_${production_req_used || "lactating"}_${_phase_req || "peak"}_nasem2021_${mode}`,
    requirements: da || {},
    profile: { label: `Dairy NASEM 2021 (${mode})`, targets: da || {} },
    sources: { mode: `dairy_nasem2021_${mode}`, resolved: true },
    meta: { engine: "dairyNasem2021", requirements_mode: mode }
  };

  } else if (speciesProfile?.species === "beef") {
  const mode = params?.requirements_mode || "static";
  const bf = resolveBeefRequirements({
    mode,
    production: production_req_used,
    phase: _phase_req,
    bw_kg: Number(body_weight_kg) || 400,
    adg_kg: Number(params?.adg_kg) || 1.2,
    sex: type || "steer",
    days_pregnant: Number(params?.days_pregnant) || 0,
  });
  req = {
    ok: true,
    reqKey: `beef_${production_req_used || "growing"}_${_phase_req || "stocker"}_nasem2016_${mode}`,
    requirements: bf || {},
    profile: { label: `Beef NASEM 2016 (${mode})`, targets: bf || {} },
    sources: { mode: `beef_nasem2016_${mode}`, resolved: true },
    meta: { engine: "beefNasem2016", requirements_mode: mode }
  };

  } else if (speciesProfile?.species === "sheep") {
  const mode = params?.requirements_mode || "static";
  const sh = resolveSheepRequirements({
    mode, production: production_req_used, phase: _phase_req,
    bw_kg: Number(body_weight_kg) || 70,
    adg_kg: Number(params?.adg_kg) || 0,
    milk_kg_day: Number(params?.milk_kg_day) || 0,
    days_pregnant: Number(params?.days_pregnant) || 0,
  });
  req = {
    ok: true,
    reqKey: `sheep_${production_req_used || "ewe"}_${_phase_req || "maintenance"}_nrc2007_${mode}`,
    requirements: sh || {},
    profile: { label: `Sheep NRC 2007 (${mode})`, targets: sh || {} },
    sources: { mode: `sheep_nrc2007_${mode}`, resolved: true },
    meta: { engine: "sheepNrc2007", requirements_mode: mode }
  };
} else if (speciesProfile?.species === "goat") {
  const mode = params?.requirements_mode || "static";
  const gt = resolveGoatRequirements({
    mode, production: production_req_used, phase: _phase_req,
    bw_kg: Number(body_weight_kg) || 60,
    adg_kg: Number(params?.adg_kg) || 0,
    milk_kg_day: Number(params?.milk_kg_day) || 0,
    fat_pct: Number(params?.fat_pct) || 3.8,
    protein_pct: Number(params?.protein_pct) || 3.2,
    days_pregnant: Number(params?.days_pregnant) || 0,
  });
  req = {
    ok: true,
    reqKey: `goat_${production_req_used || "doe"}_${_phase_req || "maintenance"}_nrc2007_${mode}`,
    requirements: gt || {},
    profile: { label: `Goat NRC 2007 (${mode})`, targets: gt || {} },
    sources: { mode: `goat_nrc2007_${mode}`, resolved: true },
    meta: { engine: "goatNrc2007", requirements_mode: mode }
  };
} else if (speciesProfile?.species === "aqua" || speciesProfile?.species === "aquaculture") {
  const mode = params?.requirements_mode || "static";
  const aquaType = String(type || params?.aqua_type || 'tilapia').toLowerCase();
  let aq;
  if (aquaType.includes('shrimp') || aquaType.includes('prawn') || aquaType === 'shrimp') {
    aq = resolveShrimpRequirements({ mode, production: production_req_used, phase: _phase_req, bw_g: Number(params?.bw_g) || 5, temp_c: Number(params?.temp_c) || 28, salinity_ppt: Number(params?.salinity_ppt) || 15 });
  } else if (aquaType.includes('salmon') || aquaType.includes('trout') || aquaType === 'salmon') {
    aq = resolveSalmonidRequirements({ mode, species: aquaType, production: production_req_used, phase: _phase_req });
  } else if (aquaType.includes('tilapia')) {
    aq = resolveTilapiaRequirements({ mode, production: production_req_used, phase: _phase_req });
  } else if (aquaType.includes('carp')) {
    aq = resolveCarpRequirements({ mode, production: production_req_used, phase: _phase_req });
  } else if (aquaType.includes('catfish') || aquaType.includes('pangasius')) {
    aq = resolveCatfishRequirements({ mode, production: production_req_used, phase: _phase_req });
  } else if (aquaType.includes('bass') || aquaType.includes('bream') || aquaType.includes('marine')) {
    aq = resolveMarineFishRequirements({ mode, production: production_req_used, phase: _phase_req });
  } else {
    aq = resolveTilapiaRequirements({ mode, production: production_req_used, phase: _phase_req });
  }
  req = {
    ok: true,
    reqKey: `aqua_${aquaType}_${production_req_used || "grow_out"}_${_phase_req || "grow_out"}_nrc2011`,
    requirements: aq || {},
    profile: { label: `Aquaculture NRC 2011 — ${aquaType}`, targets: aq || {} },
    sources: { mode: `aqua_nrc2011`, resolved: true },
    meta: { engine: "aquaNrc2011", aqua_type: aquaType, requirements_mode: mode }
  };

  } else if (speciesProfile?.species === "dog") {
  const mode = params?.requirements_mode || "aafco_2024";
  const dg = resolveDogRequirements({ mode, production: production_req_used, phase: _phase_req, breed: breed || params?.breed || 'generic' });
  req = {
    ok: true,
    reqKey: `dog_${_phase_req || "adult"}_${mode}`,
    requirements: dg || {},
    profile: { label: `Dog (${mode.toUpperCase()})`, targets: dg || {} },
    sources: { mode: `dog_${mode}`, resolved: true },
    meta: { engine: "dogEngine", requirements_mode: mode }
  };

} else if (speciesProfile?.species === "cat") {
  const mode = params?.requirements_mode || "aafco_2024";
  const ct = resolveCatRequirements({ mode, production: production_req_used, phase: _phase_req });
  req = {
    ok: true,
    reqKey: `cat_${_phase_req || "adult"}_${mode}`,
    requirements: ct || {},
    profile: { label: `Cat (${mode.toUpperCase()})`, targets: ct || {} },
    sources: { mode: `cat_${mode}`, resolved: true },
    meta: { engine: "catEngine", requirements_mode: mode }
  };

} else if (speciesProfile?.species === "swine") {
  const sw = resolveSwineRequirements({ species, type, breed, phase: _phase_req, production: production_req_used, body_weight_kg: Number(body_weight_kg) || 50 });
  req = {
    ok: true,
    reqKey: `swine_${type || "grow_finish"}_${_phase_req || "grower"}_pic2021_v1`,
    requirements: sw || {},
    profile: { label: "Swine PIC 2021", targets: sw || {} },
    sources: { mode: "swine_pic2021", resolved: true },
    meta: { engine: "swinePic2021" }
  };
} else {

  req = resolveRequirements({
    species,
    type,
    breed,
    phase: _phase_req,
    region,
    version: _version,
    production: production_req_used,
  });
  // Apply feed intake adjustment for layer
  if (feedIntakeGpd && req && req.ok && req.profile?.feed_intake?.recommended_gpd) {
    const refGpd = req.profile.feed_intake.recommended_gpd;
    const actualGpd = Number(feedIntakeGpd);
    if (actualGpd > 0 && actualGpd !== refGpd) {
      const { adjustRequirementsForFeedIntake } = require('../db/requirements/_index/LOAD_REQUIREMENTS.cjs');
      req.requirements = adjustRequirementsForFeedIntake(req.requirements, refGpd, actualGpd);
      req.feed_intake_adjusted = true;
      req.feed_intake_actual_gpd = actualGpd;
      req.feed_intake_reference_gpd = refGpd;
    }
  }
}
    // ?? FALLBACK FIX: use index + library directly if resolver fails

if (!req || !req.reqKey) {

  try {

    const indexPath = path.join(

      __dirname,

      "..",

      "db",

      "requirements",

      species,

      type,

      version,

      `requirements.index.${species}.${type}.${version}.json`

    );



    if (fs.existsSync(indexPath)) {

      const index = readJson(indexPath);



      const breedMap =

        index?.productions?.[production_req_used]?.profiles ||

        index?.productions?.[production_req_used]?.breeds;



      if (breedMap && breedMap[breed] && breedMap[breed][phase]) {

        reqKey = breedMap[breed][phase];



        const libPath = path.join(

          __dirname,

          "..",

          "db",

          "requirements",

          species,

          type,

          version,

          `requirements.library.${species}.${type}.${version}.json`

        );



        if (fs.existsSync(libPath)) {

          const lib = readJson(libPath);



          req = {

            ok: true,

            reqKey,

            requirements: lib?.profiles?.[reqKey] || {},

            profile: { targets: lib?.profiles?.[reqKey] || {} },

            sources: {

              indexPath,

              libPath

            }

          };

        }

      }

    }

  } catch (e) {

    requirements_load_error = e.message;

  }

}



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



      // Base extraction (existing)

      profileReqs_raw =

        req && req.requirements && typeof req.requirements === "object"

          ? req.requirements

          : req?.profile?.targets

            ? req.profile.targets

            : {};



      evaluation_keys_from_profile = Array.isArray(req.profile?.evaluation_keys) ? req.profile.evaluation_keys : [];



      // -------------------- MINIMAL FIX #5: ALWAYS merge library profiles if libPath present --------------------

      try {

        const libPath = (req?.sources?.libPath) || (req?.libPath) || null;

        const rk = reqKey || req?.reqKey || null;

        if (rk && libPath) {

          const merged = resolveTargetsFromLibraryProfiles(rk, libPath);

          if (merged && typeof merged === "object" && Object.keys(merged).length) {

            profileReqs_raw = merged; // ✅ effective merged targets

          }

        }

      } catch (_) {}

      // ---------------------------------------------------------------------------------------------------------



      // -------------------- MIN CHANGE: Generic fallback warning --------------------

      try {

        const requestedBreed = String(breed || "").trim().toLowerCase();

        const resolvedBreed =

          String(

            req?.resolved?.breed_used ??

            req?.resolved?.breed_eff ??

            req?.resolved?.breed ??

            ""

          ).trim().toLowerCase();



        if (requestedBreed && requestedBreed !== "generic" && resolvedBreed === "generic") {

          requirements_fallback_used = true;

          requirements_warning =

            `Requested breed '${requestedBreed}' not found in requirements library; using GENERIC targets (NOT breeder-company recommendations).`;

        }



        if (!requirements_warning && requestedBreed === "generic") {

          requirements_fallback_used = true;

          requirements_warning =

            "GENERIC targets selected (NOT breeder-company recommendations).";

        }

      } catch (_) {}

      // ---------------------------------------------------------------------------

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

        production: production_ui,

        production_req_used,

      },

      version: "AgroCore v1.4.4 (clarification-gated; enterprise targets)",

    };

  }
  // Apply feed intake adjustment ONLY for laying phases - not rearing
  const _layingPhases = new Set(['lay_early','lay_peak','lay_mid','lay_late','lay']);
  if (feedIntakeGpd && req?.profile?.feed_intake?.recommended_gpd && _layingPhases.has(String(_phase_req||'').toLowerCase())) {
    const refGpd = req.profile.feed_intake.recommended_gpd;
    const actualGpd = Number(feedIntakeGpd);
    if (actualGpd > 0 && actualGpd !== refGpd) {
      const adjusted = {};
      for (const [k, v] of Object.entries(profileReqs_raw)) {
        if (typeof v !== 'number') { adjusted[k] = v; continue; }
        if (k === 'me_kcal_per_kg') {
          if (actualGpd < 95) {
            // Low intake � high density needed � ME at commercial ceiling
            adjusted[k] = 2950;
          } else if (actualGpd > 120) {
            // High intake � diluted diet � ME at commercial floor
            adjusted[k] = 2650;
          } else {
            // Normal zone 95-120g � maintain SID Lys:ME ratio
            const sid_lys_ref = Number(profileReqs_raw['sid_lys_pct'] || 0);
            if (sid_lys_ref > 0) {
              const sid_lys_adj = sid_lys_ref * refGpd / actualGpd;
              const ref_ratio = sid_lys_ref * 10 / v;
              const me_adj = Math.round(sid_lys_adj * 10 / ref_ratio);
              adjusted[k] = Math.min(2950, Math.max(2650, me_adj));
            } else {
              adjusted[k] = v;
            }
          }
        } else if (k === 'me_mj_per_kg' || k === 'ne_kcal_per_kg' || k === 'ge_kcal_per_kg') {
          adjusted[k] = v; // leave other energy keys unchanged
        } else {
          // All nutrients adjust proportionally to feed intake
          adjusted[k] = Math.round((v * refGpd / actualGpd) * 1000) / 1000;
        }
      }
      profileReqs_raw = adjusted;
    }
  }
  const effectiveTargetsRaw = profileReqs_raw;
  const _bypassNormalize = new Set(["equine","swine","dairy","beef","sheep","goat","aqua","aquaculture","dog","cat"]);
  const profileReqs = _bypassNormalize.has(speciesProfile?.species || "")
  ? (effectiveTargetsRaw || {})
  : normalizeRequirementTargets(effectiveTargetsRaw);



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

      production: production_req_used,

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

      production: production_req_used,

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

const registry = tryLoadRegistry(speciesProfile);

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
    p_total: "p_total",
    total_p: "p_total",
  };



  const evaluation_keys_defined_by_profile = req && req.ok

    ? pickEvaluationKeys({

      requirements: req?.profile?.targets || {},

      evaluation_keys: evaluation_keys_from_profile,

      allowedKeys,

    })

    : [];



// -------------------------------------------------------------

// UNIVERSAL NUTRIENT KEY SET � future proof for all species

// Covers: Poultry, Equine, Swine, Ruminant, Aquaculture, Companion

// -------------------------------------------------------------

const UNIVERSAL_KEYS = [

  // -- ENERGY --------------------------------------------------

  "me", "me_mj", "amen", "ne", "ge",

  "de_mcal_kg", "de_mcal_day", "dm_intake_kg_day",

  "nfe_mcal_kg",        // net feed energy (ruminant)

  "nel_mcal_kg",        // net energy lactation (dairy)

  "neg_mcal_kg",        // net energy gain (beef)

  "nem_mcal_kg",        // net energy maintenance (beef)

  "ufl", "ufe",         // French UF system (ruminant/equine)

  "tdn",                // total digestible nutrients (ruminant)



  // -- PROXIMATE -----------------------------------------------

  "dm", "moisture", "cp", "ee", "cf", "ash",

  "cp_pct", "cp_g_day",

  "ee_pct", "cf_pct",



  // -- CARBOHYDRATES / FIBRE -----------------------------------

  "ndf", "adf", "lignin", "ndf_pct", "adf_pct",

  "nsp_total", "nsp_sol", "nsp_insol",

  "beta_glucans", "arabinoxylans",

  "starch", "sugars",

  "starch_pct", "sugar_pct", "nsc_pct",

  "peNDF",              // physically effective NDF (ruminant)



  // -- PROTEIN / AMINO ACIDS � TOTAL ---------------------------

  "total_lys", "total_met", "total_cys", "total_metcys",

  "total_thr", "total_trp", "total_arg",

  "total_val", "total_ile", "total_leu",

  "total_his", "total_phe", "total_tyr",

  "total_gly", "total_ser", "total_pro",

  "lys_pct", "lys_g_day", "met_pct",



  // -- PROTEIN / AMINO ACIDS � SID (Poultry/Swine) -------------

  "sid_lys", "sid_met", "sid_cys", "sid_metcys",

  "sid_thr", "sid_trp", "sid_arg",

  "sid_val", "sid_ile", "sid_leu",

  "sid_his", "sid_phe",



  // -- PROTEIN / AMINO ACIDS � RUP/RDP (Ruminant) --------------

  "rup",                // rumen undegradable protein

  "rdp",                // rumen degradable protein

  "mp",                 // metabolisable protein

  "mp_lys", "mp_met",   // MP amino acids (dairy)



  // -- FATTY ACIDS ----------------------------------------------

  "linoleic", "linolenic", "oleic",

  "sfa", "ufa", "mufa", "pufa",

  "epa", "dha", "dha_epa",  // omega-3 (aquaculture/companion)

  "ara",                     // arachidonic acid (companion)



  // -- MACROMINERALS --------------------------------------------

  "ca", "total_p", "avp", "npp", "dig_p",

  "mg", "na", "k", "cl", "s",

  "ca_pct", "ca_g_day",

  "p_pct", "p_g_day",

  "mg_pct", "na_pct", "cl_pct", "k_pct", "s_pct",

  "ca_p_ratio", "deb",



  // -- TRACE MINERALS ------------------------------------------

  "cu", "zn", "mn", "fe", "i", "se", "co", "mo", "cr", "f",

  "cu_ppm", "zn_ppm", "mn_ppm", "fe_ppm",

  "se_ppm", "i_ppm", "co_ppm", "mo_ppm",



  // -- VITAMINS -------------------------------------------------

  "vit_a", "vit_d3", "vit_d", "vit_e", "vit_k",

  "vit_b1", "vit_b2", "vit_b6", "vit_b12",

  "niacin", "pantothenic_acid", "folic_acid", "biotin", "choline",

  "vit_c",              // aquaculture/companion

  "inositol",           // aquaculture

  "vit_a_iu_kg", "vit_d_iu_kg", "vit_e_iu_kg",

  "vit_b1_ppm", "vit_b2_ppm", "niacin_ppm", "pantothenic_ppm",

  "biotin_ppm", "folic_acid_ppm", "vit_b6_ppm", "vit_b12_ppm",

  "choline_ppm",



  // -- RUMINANT SPECIFIC ----------------------------------------

  "ndf_d",              // NDF digestibility

  "starch_d",           // starch digestibility

  "cp_d",               // CP digestibility (ruminant)

  "rumen_ph_effect",    // buffer capacity

  "me_ruminant",        // ME for ruminants (MJ/kg)



  // -- AQUACULTURE SPECIFIC -------------------------------------

  "digestible_energy_fish",  // DE for fish (kcal/kg)

  "digestible_protein_fish", // DP for fish



  // -- COMPANION ANIMAL SPECIFIC --------------------------------

  "me_dog_kcal_kg",    // ME for dogs

  "me_cat_kcal_kg",    // ME for cats

  "taurine",           // cats

  "carnitine",         // companion



  // -- PELLET / PROCESSING --------------------------------------

  "pellet_qf", "press_cf", "abrasive_f",



  // -- LEGACY / COMPATIBILITY -----------------------------------

  "avp", "npp", "p_total", "total_p",

];



const CORE_KEYS = speciesProfile?.species === "equine"

  ? UNIVERSAL_KEYS

  : [

      ...UNIVERSAL_KEYS.filter(k =>

        !k.endsWith('_pct') &&

        !k.endsWith('_g_day') &&

        !k.endsWith('_ppm') &&

        !k.endsWith('_iu_kg')

      ),

      "me", "cp", "ca", "avp", "na", "cl", "k", "p_total", "total_p", "deb"

    ];



const keysWanted = Array.from(new Set([

  ...CORE_KEYS,

  ...extractRegistryKeys(registry)

]));



const registryKeysAll = extractRegistryKeys(registry);



const keysForProfile = registryKeysAll.length

  ? Array.from(new Set([

      ...registryKeysAll,

      ...CORE_KEYS

    ]))

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



  // ✅ MINIMAL CHANGE: use db_eff (per-request overrides) for summation + coverage

  const nutrient_profile_full_core = sumNutrients(itemsResolved, db_eff, keysForProfile, altMap, sumOptions);

  // -------------------- Equine daily nutrient calculations --------------------

// Equine requires both diet concentration and daily intake-based supply.

// Example: CP g/day = CP% � DMI kg/day � 10

if (speciesProfile?.species === "equine") {

  const dmiKgDay =

    Number(profileReqs?.dm_intake_kg_day) > 0

      ? Number(profileReqs.dm_intake_kg_day)

      : 0;



  if (dmiKgDay > 0) {

    nutrient_profile_full_core.dm_intake_kg_day = dmiKgDay;



    if (Number(nutrient_profile_full_core.de_mcal_kg) > 0) {

      nutrient_profile_full_core.de_mcal_day =

        Number((Number(nutrient_profile_full_core.de_mcal_kg) * dmiKgDay).toFixed(3));

    }



    if (Number(nutrient_profile_full_core.cp_pct) > 0) {

      nutrient_profile_full_core.cp_g_day =

        Number((Number(nutrient_profile_full_core.cp_pct) * dmiKgDay * 10).toFixed(1));

    }



    if (Number(nutrient_profile_full_core.lys_pct) > 0) {

      nutrient_profile_full_core.lys_g_day =

        Number((Number(nutrient_profile_full_core.lys_pct) * dmiKgDay * 10).toFixed(1));

    }



    if (Number(nutrient_profile_full_core.ca_pct) > 0) {

      nutrient_profile_full_core.ca_g_day =

        Number((Number(nutrient_profile_full_core.ca_pct) * dmiKgDay * 10).toFixed(1));

    }



    if (Number(nutrient_profile_full_core.p_pct) > 0) {

      nutrient_profile_full_core.p_g_day =

        Number((Number(nutrient_profile_full_core.p_pct) * dmiKgDay * 10).toFixed(1));

    }



    if (

      Number(nutrient_profile_full_core.ca_pct) > 0 &&

      Number(nutrient_profile_full_core.p_pct) > 0

    ) {

      nutrient_profile_full_core.ca_p_ratio =

        Number((Number(nutrient_profile_full_core.ca_pct) / Number(nutrient_profile_full_core.p_pct)).toFixed(2));

    }

  }

}



  // Enforce sulfur AA invariants

  if (isNum(nutrient_profile_full_core.total_met) || isNum(nutrient_profile_full_core.total_cys)) {

    nutrient_profile_full_core.total_metcys =

      num(nutrient_profile_full_core.total_met) + num(nutrient_profile_full_core.total_cys);

  }



  if (isNum(nutrient_profile_full_core.sid_met) || isNum(nutrient_profile_full_core.sid_cys)) {

    nutrient_profile_full_core.sid_metcys =

      num(nutrient_profile_full_core.sid_met) + num(nutrient_profile_full_core.sid_cys);

  }



 const normalizedKeysForCoverage = normalizeKeyList(keysForProfile);

const coverage = buildCoverage(itemsResolved, db_eff, normalizedKeysForCoverage, altMap);



const CORE_KEYS_SET = new Set(CORE_KEYS);



const evaluation_keys_used = keysWanted.filter((k) =>

  (coverage[k] && coverage[k].supported) || CORE_KEYS_SET.has(k)

);



const evaluation_keys_skipped_unsupported = keysWanted.filter((k) =>

  !evaluation_keys_used.includes(k) && !CORE_KEYS_SET.has(k)

);



const nutrient_profile = {};

for (const k of evaluation_keys_used) nutrient_profile[k] = nutrient_profile_full_core[k];

nutrient_profile.unknown = unknown;

nutrient_profile.coverage = {};

for (const k of evaluation_keys_used) {

  nutrient_profile.coverage[k] = coverage[k] || {

    supported: CORE_KEYS_SET.has(k),

    present: Object.prototype.hasOwnProperty.call(nutrient_profile_full_core, k),

    source: CORE_KEYS_SET.has(k) ? "core_override" : "unknown"

  };

}



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

  

  let evaluation = req && req.ok

  ? evaluateAgainstRequirements(profileReqs, nutrient_profile_full_core, evaluation_keys_used)

  : { overall: "NO_REQUIREMENTS", findings: [] };



if (speciesProfile?.species === "equine" && req) {

  const eqEval = mergeEquineDailyAndSafetyEvaluation({

    baseEvaluation: evaluation,

    requirements: profileReqs,

    actual: nutrient_profile_full_core

  });



  evaluation.findings = [

    ...(evaluation.findings || []),

    ...(eqEval.findings || [])

  ];



  if (eqEval.overall === "FAIL") {

    evaluation.overall = "FAIL";

  } else if (eqEval.overall === "WARN" && evaluation.overall !== "FAIL") {

    evaluation.overall = "WARN";

  }

}



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



      production: production_ui,            // ✅ UI semantics

      production_req_used,                  // ✅ requirements semantics (egg for layer type)

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



      // MIN CHANGE: generic fallback visibility

      requirements_fallback_used,

      requirements_warning,



      // NEW: mapping behavior passthrough

      requirements_targets_raw: requirements_targets_raw || null,

      requirements_targets_raw_keys_used,

      requirements_targets_mapped_keys_used,

      requirements_targets_mapping_applied,

// __LAB_OVERRIDES_V2__ RESULT (safe)

      lab_overrides_v2_applied,

},



    ingredients_source: {

      mode: ingredients_source.mode,

      file: ingredients_source.file,

    },



    requirements_used: req && req.ok

      ? {

        reqKey, // ✅ required for your PS loop ($r.requirements_used.reqKey)



        label: req.profile?.label || null,

        phase: req.profile?.phase || phase,

        targets_raw: profileReqs_raw,

        targets_raw_effective: effectiveTargetsRaw,

        targets: profileReqs,

        tolerance: req.profile?.tolerance || null,

        resolved: req.resolved || null,

        sources: _srcCandidate || null,



        // MIN CHANGE: mirror warning where UI usually reads

        fallback_used: requirements_fallback_used,

        warning: requirements_warning,

      }

      : null,



    requirements_source,



    requirements_basis_note: req && req.ok

      ? `PASS/FAIL/WARN is evaluated against the selected requirements profile: ${species} → ${type} → ${breed} → ${phase} (region=${region}, version=${version}, reqKey=${reqKey}).`

      : `No requirements profile could be loaded for: ${species} → ${type} → ${breed} → ${phase} (region=${region}, version=${version}, production=${production_req_used}).`,



    registry_loaded,

    

    // __REGISTRY_KEYS__ DIAGNOSTIC (safe; remove after verification)

    registry_keys_count: registryKeysAll.length,

    registry_keys_sample: registryKeysAll.slice(0, 30),

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
