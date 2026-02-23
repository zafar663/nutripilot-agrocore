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

// Simple cache per file
const JSON_CACHE = new Map();

function stripUtf8Bom(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Wrapper support: {_LOCK, meta, ingredients:{...}} -> return ingredients
function unwrapToDb(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj.ingredients && typeof obj.ingredients === "object") return obj.ingredients;
  return obj;
}

function readJson(absPath) {
  if (JSON_CACHE.has(absPath)) return JSON_CACHE.get(absPath);

  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf8");
  const text = stripUtf8Bom(raw);
  const json = JSON.parse(text);

  JSON_CACHE.set(absPath, json);
  return json;
}

function buildCandidates({ species = "poultry", region = "global", version = "v1", basis = "sid" } = {}) {
  const s = String(species).toLowerCase().trim();
  const r = String(region || "global").toLowerCase().trim();
  const v = String(version || "v1").toLowerCase().trim();
  const b = String(basis || "sid").toLowerCase().trim();

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

  return [byRegion, globalFallback];
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
    const row = db[ingKey] && typeof db[ingKey] === "object" ? { ...db[ingKey] } : db[ingKey];

    if (row && typeof row === "object") {
      for (const engineKey of Object.keys(map)) {
        const sidKey = map[engineKey];
        if (typeof row[engineKey] === "undefined" && typeof row[sidKey] !== "undefined") {
          row[engineKey] = row[sidKey];
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


function loadGlobalInvariantsDb() {
  // core/db/ingredients/_global_invariants/v1/ingredients.global_invariants.v1.json
  const invPath = path.resolve(
    ING_ROOT,
    "_global_invariants",
    "v1",
    "ingredients.global_invariants.v1.json"
  );

  const obj = readJson(invPath);
  if (!obj) return {};

  // Supports {db:{...}} OR wrapper-like shapes
  const db = (obj && typeof obj === "object" && obj.db && typeof obj.db === "object")
    ? obj.db
    : unwrapToDb(obj) || {};

  return db && typeof db === "object" ? db : {};
}

function mergePreferBase(base, inv) {
  // base wins on conflicts; invariants fill missing fields only
  const out = { ...(base || {}) };
  for (const [k, invObj] of Object.entries(inv || {})) {
    const baseObj = out[k];
    if (!baseObj) { out[k] = invObj; continue; }
    if (!invObj || typeof invObj !== "object" || !baseObj || typeof baseObj !== "object") continue;
    out[k] = { ...invObj, ...baseObj };
  }
  return out;
}

function loadIngredients(selectors = {}) {
  const candidates = buildCandidates(selectors);

  // 1) Try structured DB
  for (const absPath of candidates) {
    const obj = readJson(absPath);
    if (!obj) continue;

    let db0 = unwrapToDb(obj) || {};
    db0 = mergePreferBase(db0, loadGlobalInvariantsDb());
    const keys = Object.keys(db0);

    if (keys.length === 0) continue;

    const db = normalizeSidToEngineKeys(clone(db0));

    return {
      ok: true,
      mode: "structured",
      source: { mode: "structured", file: path.relative(process.cwd(), absPath) },
      db,
      meta: obj && obj.meta ? obj.meta : undefined,
      _LOCK: obj && typeof obj._LOCK !== "undefined" ? obj._LOCK : undefined
    };
  }

  // 2) Legacy fallback ONLY if allowed
  const allowLegacy = String(process.env.ALLOW_LEGACY_ING || "").trim() === "1";
  if (!allowLegacy) {
    const err = new Error("Structured ingredient DB not found/empty and legacy fallback is disabled (set ALLOW_LEGACY_ING=1 to allow).");
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

  const legacyDb = normalizeSidToEngineKeys(clone(legacyDb0));

  return {
    ok: true,
    mode: "legacy",
    source: { mode: "legacy", file: path.relative(process.cwd(), legacyPath) },
    db: legacyDb
  };
}

module.exports = { loadIngredients, buildCandidates };

