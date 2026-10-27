/*
  AgroCore Ingredients Loader
  File: core/db/ingredients/_index/LOAD_INGREDIENTS.cjs

  Purpose:
  Choose correct ingredient matrix by:
  species / region / version / basis (e.g., sid)
  with safe fallbacks to legacy DB (ONLY if ALLOW_LEGACY_ING=1).

  Also normalizes SID fields to engine keys:
  sid_lys -> lys, sid_met -> met, sid_metcys -> met_cys, etc.

  CommonJS compatible (Node 20.x)

  TEMP BRIDGE (PHASE A):
  - GLOBAL DB is currently empty/placeholder.
  - If requested region != 'us', force 'us' so analyzer remains usable.
  - Later: remove this and populate GLOBAL properly (BR tables ? global).
*/

"use strict";

const fs = require("fs");
const path = require("path");

// New structured DB root
const ING_ROOT = path.resolve(__dirname, "..");

// Preferred legacy locations (support both)
const LEGACY_DEFAULT_A = path.resolve(ING_ROOT, "..", "ingredients.poultry.v0.json");
const LEGACY_DEFAULT_B = path.resolve(ING_ROOT, "ingredients.poultry.v0.json");
const LEGACY_DEFAULT_C = path.resolve(ING_ROOT, "ingredients", "ingredients.poultry.v0.json");

// Simple cache per file (cache ONLY successful parses)
const JSON_CACHE = new Map();

function stripUtf8Bom(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Wrapper support: {_LOCK, meta, ingredients:{...}} -> return ingredients
function unwrapToDb(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj.ingredients && typeof obj.ingredients === "object") return obj.ingredients;
  // also tolerate {db:{...}} wrappers (used elsewhere)
  if (obj.db && typeof obj.db === "object") return obj.db;
  return obj;
}

/**
 * Read JSON safely.
 * - If missing: return null
 * - If empty/whitespace: return null
 * - If invalid/truncated JSON: return null (do NOT crash the API)
 */
function readJson(absPath) {
  if (JSON_CACHE.has(absPath)) return JSON_CACHE.get(absPath);

  if (!fs.existsSync(absPath)) return null;

  try {
    const raw = fs.readFileSync(absPath, "utf8");
    const text = stripUtf8Bom(raw);

    if (!text || !String(text).trim()) return null;

    const json = JSON.parse(text);

    // cache only successful parses
    JSON_CACHE.set(absPath, json);
    return json;
  } catch (e) {
    // Skip bad JSON so we can fall back to other candidates / legacy.
    // This is critical during development when a DB file may be mid-write/truncated.
    console.error(`[ING_DB] Invalid JSON, skipping: ${absPath}`);
    console.error(`[ING_DB] ${e && e.message ? e.message : String(e)}`);
    return null;
  }
}

/**
 * TEMP bridge: force ingredient-region to US unless the caller explicitly requests US.
 * We do NOT touch locale; only the ingredient matrix region.
 */
function regionEffective(regionIn) {
  const r = String(regionIn || "").toLowerCase().trim();
  if (!r) return { requested: "", effective: "us", forced: true };
  if (r === "us") return { requested: r, effective: r, forced: false };
  return { requested: r, effective: "us", forced: true };
}

function buildCandidates({ species = "poultry", region = "global", version = "v1", basis = "sid" } = {}) {
  const s = String(species).toLowerCase().trim();
  const r = String(region || "global").toLowerCase().trim();
  const v = String(version || "v1").toLowerCase().trim();
  const b = String(basis || "sid").toLowerCase().trim();

  // NutrixDB unified � check first
  const nutrixDb = path.resolve(
    ING_ROOT,
    "nutrixdb",
    "v1",
    "nutrixdb.ingredients.v1.json"
  );

  const byRegion = path.resolve(
    ING_ROOT,
    s,
    r,
    v,
    `ingredients.${s}.${r}.${b}.${v}.json`
  );

  const globalFallback = path.resolve(
    ING_ROOT,
    s,
    "global",
    v,
    `ingredients.${s}.global.${b}.${v}.json`
  );

  // Species-specific file takes priority over unified nutrixdb.
  // nutrixdb serves as fallback for species that don't have a dedicated file.
  return [byRegion, globalFallback, nutrixDb];
}

function clone(obj) {
  return obj && typeof obj === "object" ? JSON.parse(JSON.stringify(obj)) : obj;
}

/**
 * Normalize DB row keys so calculator can use engine keys consistently.
 * If DB provides sid_* fields, expose them also as engine keys.
 */
function normalizeSidToEngineKeys(db) {
  if (!db || typeof db !== "object") return db;

  const map = {
    lys: "sid_lys",
    met: "sid_met",
    met_cys: "sid_metcys",
    thr: "sid_thr",
    trp: "sid_trp",
    arg: "sid_arg",
    ile: "sid_ile",
    leu: "sid_leu",
    val: "sid_val"
  };

  const out = {};

  for (const ingKey of Object.keys(db)) {
    const row = db[ingKey] && typeof db[ingKey] === "object"
      ? { ...db[ingKey] }
      : db[ingKey];

    if (row && typeof row === "object") {
      // Universal ingredient nutrient container support.
      // Poultry/old DB may use nutrient_profile; newer species DBs may use nutrients.
      const sourceNutrients =
        row.nutrients && typeof row.nutrients === "object"
          ? row.nutrients
          : row.nutrient_profile && typeof row.nutrient_profile === "object"
            ? row.nutrient_profile
            : null;

      if (sourceNutrients) {
        row.nutrients = { ...sourceNutrients };

        // Also expose nutrient keys at row root for existing engine compatibility.
        for (const [k, v] of Object.entries(sourceNutrients)) {
          if (typeof row[k] === "undefined") row[k] = v;
        }
      }

      // Existing poultry SID compatibility mapping.
      for (const engineKey of Object.keys(map)) {
        const sidKey = map[engineKey];

        if (typeof row[engineKey] === "undefined" && typeof row[sidKey] !== "undefined") {
          row[engineKey] = row[sidKey];
        }

        if (
          row.nutrients &&
          typeof row.nutrients === "object" &&
          typeof row.nutrients[engineKey] === "undefined" &&
          typeof row.nutrients[sidKey] !== "undefined"
        ) {
          row.nutrients[engineKey] = row.nutrients[sidKey];
        }
      }
    }

    out[ingKey] = row;
  }

  return out;
}

function pickLegacyPath() {
  if (fs.existsSync(LEGACY_DEFAULT_A)) return LEGACY_DEFAULT_A;
  if (fs.existsSync(LEGACY_DEFAULT_B)) return LEGACY_DEFAULT_B;
  if (fs.existsSync(LEGACY_DEFAULT_C)) return LEGACY_DEFAULT_C;
  return LEGACY_DEFAULT_A; // expected path (even if missing)
}

/**
 * Load global invariants (minerals + synthetic AA) merged into every region DB.
 *
 * core/db/ingredients/_invariants/ingredients.global.invariants.v1.json
 *
 * This loader supports:
 *   { db: {...} } OR { ingredients: {...} } OR flat object {...}
 */
function loadGlobalInvariantsDb() {
  const invPath = path.resolve(
    ING_ROOT,
    "_invariants",
    "ingredients.global.invariants.v1.json"
  );

  const obj = readJson(invPath);
  if (!obj) return { db: {}, path: invPath, exists: false };

  const db = unwrapToDb(obj) || {};
  return { db: (db && typeof db === "object") ? db : {}, path: invPath, exists: true };
}

/**
 * Merge invariants into base.
 * Rule: base wins on conflicts, BUT base null/undefined must NOT erase invariant values.
 * - If ingredient missing in base: take invariant row.
 * - If both objects: merge field-by-field, skipping null/undefined from base.
 */
function mergePreferBase(base, inv) {
  const out = { ...(base || {}) };

  for (const [k, invObj] of Object.entries(inv || {})) {
    const baseObj = out[k];

    // ingredient missing in base -> add full invariant row
    if (baseObj == null) {
      out[k] = invObj;
      continue;
    }

    // merge only when both are plain-ish objects
    if (!invObj || typeof invObj !== "object" || Array.isArray(invObj)) continue;
    if (!baseObj || typeof baseObj !== "object" || Array.isArray(baseObj)) continue;

    // start from invariants, then overlay base values ONLY if real (not null/undefined)
    const merged = { ...invObj };
    for (const [fk, fv] of Object.entries(baseObj)) {
      if (fv === null || typeof fv === "undefined") continue; // do not wipe invariant values
      merged[fk] = fv;
    }

    out[k] = merged;
  }

  return out;
}

function filterBySpecies(db, species) {
  if (!species || !db) return db;
  const s = String(species).toLowerCase().trim();
  const out = {};
  for (const [key, ing] of Object.entries(db)) {
    if (key.startsWith('_')) continue;
    const compat = ing.species_compatibility;
    if (!compat || !Array.isArray(compat) || compat.includes(s) || compat.includes("all")) {
      out[key] = ing;
    }
  }
  return out;
}
function loadIngredients(selectors = {}) {
  // TEMP BRIDGE: force ingredient region to US unless region=us was explicitly requested
  const rr = regionEffective(selectors.region);
  const selectorsEff = rr.forced ? { ...selectors, region: rr.effective } : selectors;

  const candidates = buildCandidates(selectorsEff);

  // Load invariants once (and report whether found)
  const inv = loadGlobalInvariantsDb();

  // 1) Try structured DB
  for (const absPath of candidates) {
    const obj = readJson(absPath);
    if (!obj) continue;

    let db0 = unwrapToDb(obj) || {};
    db0 = mergePreferBase(db0, inv.db);
    const keys = Object.keys(db0);

    if (keys.length === 0) continue;

    const filtered = filterBySpecies(db0, selectorsEff.species);
const db = normalizeSidToEngineKeys(clone(filtered));

    return {
      ok: true,
      mode: "structured",
      source: {
        mode: "structured",
        file: path.relative(process.cwd(), absPath),
        invariants: {
          exists: inv.exists,
          file: path.relative(process.cwd(), inv.path),
          merged: true
        },
        region_override: {
          requested: rr.requested,
          effective: rr.effective,
          forced: rr.forced
        }
      },
      db,
      meta: obj && obj.meta ? obj.meta : undefined,
      _LOCK: obj && typeof obj._LOCK !== "undefined" ? obj._LOCK : undefined
    };
  }

  // 2) Legacy fallback ONLY if allowed
  const allowLegacy = String(process.env.ALLOW_LEGACY_ING || "").trim() === "1";
  if (!allowLegacy) {
    const err = new Error(
      "Structured ingredient DB not found/empty and legacy fallback is disabled (set ALLOW_LEGACY_ING=1 to allow)."
    );
    err.code = "ING_DB_MISSING";
    throw err;
  }

  const legacyPath = pickLegacyPath();
  const legacyObj = readJson(legacyPath);
  const legacyDb0 = unwrapToDb(legacyObj) || {};

  if (!legacyObj || Object.keys(legacyDb0).length === 0) {
    const err = new Error("No ingredient DB available (structured empty, legacy missing/empty).");
    err.code = "ING_DB_MISSING";
    throw err;
  }

  // Note: we ALSO merge invariants into legacy for consistency
  const legacyMerged0 = mergePreferBase(legacyDb0, inv.db);
  const legacyDb = normalizeSidToEngineKeys(clone(legacyMerged0));

  return {
    ok: true,
    mode: "legacy",
    source: {
      mode: "legacy",
      file: path.relative(process.cwd(), legacyPath),
      invariants: {
        exists: inv.exists,
        file: path.relative(process.cwd(), inv.path),
        merged: true
      },
      region_override: {
        requested: rr.requested,
        effective: rr.effective,
        forced: rr.forced
      }
    },
    db: legacyDb
  };
}

module.exports = { loadIngredients, buildCandidates };
