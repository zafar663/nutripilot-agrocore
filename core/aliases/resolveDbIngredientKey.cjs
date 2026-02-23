const fs = require("node:fs");
const path = require("node:path");

function normKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

let _cache = null;

function toAliasArray(v) {
  // Make alias values safe:
  // - array -> array
  // - string -> [string]
  // - object -> try common fields or keys
  // - null/undefined -> []
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];

  if (typeof v === "object") {
    // common patterns: { aliases:[...] } or { alias:[...] } or { list:[...] }
    if (Array.isArray(v.aliases)) return v.aliases;
    if (Array.isArray(v.alias)) return v.alias;
    if (Array.isArray(v.list)) return v.list;

    // if it is a map like { "sbm": true, "soybean meal": true }
    // treat object keys as aliases (best-effort, defensive)
    return Object.keys(v);
  }

  return [];
}

function loadAliasDb() {
  if (_cache) return _cache;

  const dbPath = path.join(__dirname, "alias.db.json");
  const raw = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  const db = JSON.parse(raw);

  const canonToAliases = new Map();

  // Accept db.aliases as the canonical container (your current format)
  // If aliases is missing/malformed, default to {}
  const aliasRoot = (db && typeof db === "object" && db.aliases && typeof db.aliases === "object")
    ? db.aliases
    : {};

  for (const [canon, arrLike] of Object.entries(aliasRoot)) {
    const arr = toAliasArray(arrLike);
    canonToAliases.set(normKey(canon), arr.map(normKey).filter(Boolean));
  }

  _cache = { canonToAliases };
  return _cache;
}

function buildDbNormIndex(ingredientsDB) {
  const idx = new Map();
  for (const k of Object.keys(ingredientsDB || {})) {
    const nk = normKey(k);
    if (!idx.has(nk)) idx.set(nk, k);
  }
  return idx;
}

function resolveDbIngredientKey(inputKey, ingredientsDB) {
  if (!inputKey) return null;

  // direct hit (exact key)
  if (ingredientsDB && Object.prototype.hasOwnProperty.call(ingredientsDB, inputKey)) return inputKey;

  const nInput = normKey(inputKey);
  const dbIdx = buildDbNormIndex(ingredientsDB);

  // normalized hit on DB keys
  if (dbIdx.has(nInput)) return dbIdx.get(nInput);

  const { canonToAliases } = loadAliasDb();

  // Fast path: canonical key match (normalized)
  if (canonToAliases.has(nInput)) {
    const aliases = canonToAliases.get(nInput) || [];
    for (const a of aliases) {
      if (dbIdx.has(a)) return dbIdx.get(a);
    }
  }

  // Full scan: input matches any alias → return canonical or alias that exists in DB
  for (const [canonNorm, aliases] of canonToAliases.entries()) {
    if ((aliases || []).includes(nInput)) {
      // Try canonical first (if canonical is also a DB key)
      if (dbIdx.has(canonNorm)) return dbIdx.get(canonNorm);

      // Then try any alias that matches a DB key
      for (const a of aliases || []) {
        if (dbIdx.has(a)) return dbIdx.get(a);
      }
    }
  }

  return null;
}

module.exports = { resolveDbIngredientKey };