// C:\Users\Administrator\My Drive\NutriPilot\nutripilot-agrocore\core\aliases\resolveAlias.cjs

const fs = require("node:fs");
const path = require("node:path");

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[\/]/g, " ")          // ✅ NEW: normalize slashes (millet/bajra)
    .replace(/[%]/g, " % ")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ NEW: keep SBM grades, strip other trailing grades like "fish meal 54"
function stripTrailingGrade(cleaned) {
  const s = String(cleaned || "").trim();

  // keep SBM grade (you already have sbm_44 in db)
  if (/^sbm\b/.test(s)) return s;

  // drop: "fish meal 54" -> "fish meal"
  // drop: "dlm 99" -> "dlm"
  return s.replace(/\s+\d{1,3}(\.\d+)?$/g, "").trim();
}

// ✅ NEW: remove the standalone % token (alternate match path)
function dropPercentToken(cleaned) {
  return String(cleaned || "")
    .replace(/\s%(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ NEW: tiny hard fallback for known PDF labels (last resort)
const FALLBACK_CANONICAL = {
  "fish meal": "fish_meal",
  "fishmeal": "fish_meal",

  "rice broken": "rice_broken",
  "broken rice": "rice_broken",

  "millet bajra": "millet_bajra",
  "bajra": "millet_bajra",

  "soyabean oil": "soybean_oil",
  "soybean oil": "soybean_oil",
  "soya oil": "soybean_oil",

  "dlm": "dl_met",
  "dl met": "dl_met",
  "dl-methionine": "dl_met",

  "choline chloride": "choline_chloride",
  "anti coccidial": "anti_coccidial",
  "anti-coccidial": "anti_coccidial",
  "toxin binder": "toxin_binder",

  "vitamin premix": "vitamin_premix",
  "mineral premix": "mineral_premix",
};

let _cache = null;

function loadAliasDb() {
  if (_cache) return _cache;

  const dbPath = path.join(__dirname, "alias.db.json");

  if (!fs.existsSync(dbPath)) {
    console.warn("[Alias] alias.db.json not found. Alias resolution disabled.");
    _cache = { db: { aliases: {} }, map: new Map() };
    return _cache;
  }

  const raw = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  const db = JSON.parse(raw);

  const map = new Map();

  for (const [canonicalKey, aliasArray] of Object.entries(db.aliases || {})) {
    // 1️⃣ Canonical self mapping
    const normalizedCanonical = norm(canonicalKey);
    if (normalizedCanonical) {
      map.set(normalizedCanonical, canonicalKey);
    }

    // 2️⃣ Explicit aliases
    for (const alias of aliasArray || []) {
      const normalizedAlias = norm(alias);
      if (!normalizedAlias) continue;

      // Never overwrite an existing mapping
      if (!map.has(normalizedAlias)) {
        map.set(normalizedAlias, canonicalKey);
      }
    }
  }

  _cache = { db, map };
  return _cache;
}

/**
 * Conservative alias resolver:
 * - exact normalized match only (+ safe alt forms)
 * - canonical self-key always works
 * - never guesses
 * - safe fallback if alias DB missing
 */
function resolveAlias(rawName, { locale = "US" } = {}) {
  const raw = String(rawName ?? "");
  const cleaned = norm(raw);

  const { map } = loadAliasDb();

  // 1) exact
  if (map.has(cleaned)) {
    return {
      raw_name: raw,
      cleaned_name: cleaned,
      canonical_key: map.get(cleaned),
      method: "exact",
      locale,
      unknown: false,
    };
  }

  // 2) try without standalone % token (e.g., "sbm 44 %" -> "sbm 44")
  const noPct = dropPercentToken(cleaned);
  if (noPct && noPct !== cleaned && map.has(noPct)) {
    return {
      raw_name: raw,
      cleaned_name: cleaned,
      canonical_key: map.get(noPct),
      method: "exact_no_pct_token",
      locale,
      unknown: false,
    };
  }

  // 3) try stripping trailing grade (e.g., "fish meal 54" -> "fish meal")
  const stripped = stripTrailingGrade(noPct || cleaned);
  if (stripped && stripped !== (noPct || cleaned) && map.has(stripped)) {
    return {
      raw_name: raw,
      cleaned_name: cleaned,
      canonical_key: map.get(stripped),
      method: "exact_stripped_grade",
      locale,
      unknown: false,
    };
  }

  // 4) last-resort fallback map (still conservative: only known labels)
  const fb =
    FALLBACK_CANONICAL[noPct] ||
    FALLBACK_CANONICAL[stripped] ||
    FALLBACK_CANONICAL[cleaned];

  if (fb) {
    return {
      raw_name: raw,
      cleaned_name: cleaned,
      canonical_key: fb,
      method: "fallback_map",
      locale,
      unknown: false,
    };
  }

  return {
    raw_name: raw,
    cleaned_name: cleaned,
    canonical_key: null,
    method: "unknown",
    locale,
    unknown: true,
  };
}

module.exports = { resolveAlias, loadAliasDb };
