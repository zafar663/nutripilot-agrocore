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
  "fish meal": "fish_meal_54_cp",
  "fishmeal": "fish_meal_54_cp",
  "fish meal 54": "fish_meal_54_cp",
  "fish meal 54%": "fish_meal_54_cp",
  "fishmeal 54": "fish_meal_54_cp",

  "rice broken": "rice_broken",
  "broken rice": "rice_broken",

  "millet bajra": "millet_grain",
  "millet/bajra": "millet_grain",
  "millet": "millet_grain",
  "bajra": "millet_grain",

  "soyabean oil": "soy_oil",
  "soybean oil": "soy_oil",
  "soya oil": "soy_oil",
  "soy oil": "soy_oil",
  "vegetable oil": "soy_oil",
  "oil": "soy_oil",

  "canola meal": "canola_meal",
  "canola meal 36": "canola_meal",
  "canola meal 36%": "canola_meal",
  "canola 36": "canola_meal",

  "sunflower meal": "sunflower_meal",
  "sunflower meal 26-28": "sunflower_meal",
  "sunflower meal 26 28": "sunflower_meal",
  "sunflower meal 26-28%": "sunflower_meal",

  "c g": "corn_gluten_meal_60_cp",
  "cg": "corn_gluten_meal_60_cp",
  "c g 60": "corn_gluten_meal_60_cp",
  "c g 60%": "corn_gluten_meal_60_cp",
  "cg 60": "corn_gluten_meal_60_cp",
  "cg 60%": "corn_gluten_meal_60_cp",
  "corn gluten": "corn_gluten_meal_60_cp",
  "corn gluten meal": "corn_gluten_meal_60_cp",
  "corn gluten meal 60": "corn_gluten_meal_60_cp",
  "corn gluten meal 60%": "corn_gluten_meal_60_cp",

  "dlm": "dl_met",
  "dlm 99": "dl_met",
  "dlm 99%": "dl_met",
  "dl met": "dl_met",
  "dl-methionine": "dl_met",

  "choline chloride": "choline_chloride",
  "anti coccidial": "anti_coccidial",
  "anti-coccidial": "anti_coccidial",
  "toxin binder": "toxin_binder",

  "vitamin premix": "vitamin_premix",
  "mineral premix": "mineral_premix",

  "acid oil": "acid_oil",
  "acidoil": "acid_oil",
  "crude acid oil": "acid_oil",
  "palm acid oil": "acid_oil",
  "soy acid oil": "acid_oil",
  "fatty acid oil": "acid_oil",

  "iso leucine": "l_ile",
  "iso-leucine": "l_ile",
  "isoleucine": "l_ile",
  "l isoleucine": "l_ile",
  "l-isoleucine": "l_ile",
  "l ile": "l_ile",

  "l valine": "l_val",
  "l-valine": "l_val",
  "valine": "l_val",
  "l val": "l_val",

  "l tryptophan": "l_trp",
  "l-tryptophan": "l_trp",
  "tryptophan": "l_trp",
  "l trp": "l_trp",

  "l arginine": "l_arg",
  "l-arginine": "l_arg",
  "arginine": "l_arg",

  "l threonine": "l_thr",
  "l-threonine": "l_thr",
  "threonine": "l_thr",

  "genphase broiler": "anti_coccidial",
  "genphase": "anti_coccidial",
  "salinomycin": "anti_coccidial",
  "monensin": "anti_coccidial",
  "diclazuril": "anti_coccidial",
  "narasin": "anti_coccidial",
  "coccidiostat": "anti_coccidial",

  "mbm": "meat_bone_meal_45_cp",
  "mbm 45": "meat_bone_meal_45_cp",
  "mbm 45%": "meat_bone_meal_45_cp",
  "mbm 48": "meat_bone_meal_45_cp",
  "mbm 48%": "meat_bone_meal_45_cp",
  "meat bone meal": "meat_bone_meal_45_cp",
  "meat and bone meal": "meat_bone_meal_45_cp",
  "meat & bone meal": "meat_bone_meal_45_cp",

  "soybean hulls": "soybean_hulls",
  "sb hulls": "soybean_hulls",
  "soy hulls": "soybean_hulls",
  "wheat midds": "wheat_middlings",
  "wheat middlings": "wheat_middlings",
  "wheat mill run": "wheat_middlings",
  "alfalfa sun cured 17": "alfalfa_meal_17_cp",
  "alfalfa sun cured 17%": "alfalfa_meal_17_cp",
  "alfalfa meal": "alfalfa_meal_17_cp",
  "alfalfa": "alfalfa_meal_17_cp",
  "beet pulp": "beet_pulp",
  "sugar beet pulp": "beet_pulp",
  "cane molasses": "molasses_cane",
  "molasses": "molasses_cane",
  "mono-dicalcium phosphate": "dicalcium_phosphate",
  "monodicalcium phosphate": "dicalcium_phosphate",
  "dicalcium phosphate": "dicalcium_phosphate",
  "monosodium phosphate": "monosodium_phosphate",
  "soy oil - mixer": "soy_oil",
  "soy oil mixer": "soy_oil",
  "lime stone": "limestone",
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
