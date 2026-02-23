"use strict";

/**
 * core/parser/parseFormulaText.cjs
 *
 * CP/grade enforcement (FIXED):
 * ✅ Do NOT ask for “grade” if the user already typed it (SBM 44/46/48, Canola 34/36/38, Rapeseed 28/30, etc.)
 * ✅ If user typed only generic (SBM / Canola meal / Rapeseed meal / Wheat / Sunflower meal / etc.) → ask
 *
 * Conservative:
 * - exact aliases via resolveAlias()
 * - no fuzzy guessing of ingredient names
 * - BUT we DO upgrade a generic family key into a specific tier key when the raw text clearly contains the tier.
 */

const { resolveAlias } = require("../aliases/resolveAlias.cjs");
const { suggestClosest } = require("../utils/UTIL_FUZZY_SUGGEST.cjs");

// ---- Config: CP/grade-tiered ingredient families (US poultry v1) ----

const CP_TIER_FAMILIES = [
  {
    family: "soybean_meal",
    prompt:
      "Soybean meal protein varies. Please specify grade (SBM 44 / 46 / 48). Example: 'SBM 48 35'.",
    specific_keys: new Set(["sbm_44", "sbm_46", "sbm_48"]),
    generic_keys: new Set(["soybean_meal"]),
    tier_hint_re: /\b(44|46|48)\b/i
  },
  {
    family: "wheat",
    prompt:
      "Wheat protein varies. Please specify CP tier (10.5 / 13 / 15). Example: 'Wheat 13 20'.",
    specific_keys: new Set(["wheat_10_5", "wheat_13", "wheat_15"]),
    generic_keys: new Set(["wheat"]),
    tier_hint_re: /\b(10\.5|10\.50|13|15)\b/i
  },
  {
    family: "sunflower_meal",
    prompt:
      "Sunflower meal protein varies. Please specify CP tier (30 / 36 / 47) like 'Sunflower meal 36 10'.",
    specific_keys: new Set([
      "sunflower_meal_30",
      "sunflower_meal_36",
      "sunflower_meal_47",
      "sunflower_expeller"
    ]),
    generic_keys: new Set(["sunflower_meal"]),
    tier_hint_re: /\b(30|36|47)\b/i
  },
  {
    family: "meat_bone_meal",
    prompt:
      "Meat & bone meal varies. Please specify CP tier (e.g., 45% or 50%) like 'MBM 45 3'.",
    specific_keys: new Set(["meat_bone_meal_45", "meat_bone_meal_50"]),
    generic_keys: new Set(["meat_bone_meal"]),
    tier_hint_re: /\b(45|50)\b/i
  },
  {
    family: "ddgs",
    prompt:
      "DDGS varies by grain/process. Please specify: corn DDGS / wheat DDGS / barley DDGS (and high-starch if applicable). Example: 'Corn DDGS 8'.",
    specific_keys: new Set(["ddgs_corn", "ddgs_wheat", "ddgs_barley", "ddgs_corn_high_starch"]),
    generic_keys: new Set(["ddgs"]),
    tier_hint_re: /\b(corn|wheat|barley|high starch|high-starch)\b/i
  },
  {
    family: "corn_gluten_meal",
    prompt:
      "Corn gluten meal varies (e.g., 40% vs 60%). Please specify grade like 'CGM 60 2'.",
    specific_keys: new Set(["corn_gluten_meal_40", "corn_gluten_meal_60"]),
    generic_keys: new Set(["corn_gluten_meal"]),
    tier_hint_re: /\b(40|60)\b/i
  },
  {
    family: "canola_rapeseed",
    prompt:
      "Canola/Rapeseed meals vary by type and protein. Please specify: Canola meal 34/36/38 OR Rapeseed meal 28/30 (and confirm if it is 00-rapeseed). Example: 'Canola meal 36 8' or 'Rapeseed meal 28 8'.",
    specific_keys: new Set([
      "canola_meal_34",
      "canola_meal_36",
      "canola_meal_38",
      "rapeseed_meal_28",
      "rapeseed_meal_30"
    ]),
    generic_keys: new Set(["canola_meal", "rapeseed_meal"]),
    tier_hint_re: /\b(28|30|34|36|38)\b/i
  }
];

// ---- Utilities ----

function cleanName(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[%]/g, "")
    .replace(/[(),]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

function mergeItemsLotReady(items) {
  const map = new Map();

  for (const it of items) {
    const lot = it.lot ?? null;
    const mergeKey = `${it.ingredient}__LOT__${lot}`;

    const prev = map.get(mergeKey);
    if (!prev) {
      map.set(mergeKey, { ...it, lot });
    } else {
      prev.inclusion = (Number(prev.inclusion) || 0) + (Number(it.inclusion) || 0);

      if (it.is_unknown) {
        prev.is_unknown = true;
        prev.raw = prev.raw ? `${prev.raw}; ${it.raw}` : it.raw;
      }

      if (it.needs_clarification) {
        prev.needs_clarification = true;
        prev.clarification_family = it.clarification_family || prev.clarification_family;
      }
    }
  }

  const out = Array.from(map.values()).map(x => ({
    ...x,
    inclusion: +Number(x.inclusion).toFixed(4)
  }));

  out.sort((a, b) => (b.inclusion || 0) - (a.inclusion || 0));
  return out;
}

// candidate suggestions for unknowns (best-effort)
function buildCandidatesFromAliasDb() {
  try {
    // alias.db.json should exist in your project; used only for suggestions (not resolution).
    const aliasDb = require("../aliases/alias.db.json");
    const keys = new Set();
    for (const k of Object.keys(aliasDb.aliases || {})) keys.add(k);
    for (const arr of Object.values(aliasDb.aliases || {})) {
      for (const a of arr || []) keys.add(cleanName(a));
    }
    return Array.from(keys);
  } catch (_) {
    return [];
  }
}
const CANDIDATES = buildCandidatesFromAliasDb();

// Determine clarification options per family
function optionsForFamily(family) {
  switch (family) {
    case "soybean_meal":
      return ["sbm_44", "sbm_46", "sbm_48"];
    case "wheat":
      return ["wheat_10_5", "wheat_13", "wheat_15"];
    case "sunflower_meal":
      return ["sunflower_meal_30", "sunflower_meal_36", "sunflower_meal_47", "sunflower_expeller"];
    case "meat_bone_meal":
      return ["meat_bone_meal_45", "meat_bone_meal_50"];
    case "ddgs":
      return ["ddgs_corn", "ddgs_wheat", "ddgs_barley", "ddgs_corn_high_starch"];
    case "corn_gluten_meal":
      return ["corn_gluten_meal_40", "corn_gluten_meal_60"];
    case "canola_rapeseed":
      return ["canola_meal_34", "canola_meal_36", "canola_meal_38", "rapeseed_meal_28", "rapeseed_meal_30"];
    default:
      return [];
  }
}

/**
 * Upgrade a generic canonical key into a specific tier key when the raw text clearly contains the tier.
 * This is the key fix:
 * - If alias resolution returns "soybean_meal" and raw contains 48 => upgrade to "sbm_48" (no clarification)
 * - If alias resolution returns "canola_meal" and raw contains 36 => upgrade to "canola_meal_36"
 */
function upgradeTierIfImplied(canonicalKey, rawClean) {
  const s = String(rawClean || "");

  // SBM 44/46/48
  if (canonicalKey === "soybean_meal") {
    const m = s.match(/\b(44|46|48)\b/);
    if (m) return `sbm_${m[1]}`;
  }

  // Wheat tiers
  if (canonicalKey === "wheat") {
    if (/\b10\.5\b/.test(s) || /\b10\.50\b/.test(s)) return "wheat_10_5";
    const m = s.match(/\b(13|15)\b/);
    if (m) return `wheat_${m[1]}`;
  }

  // Sunflower meal tiers
  if (canonicalKey === "sunflower_meal") {
    const m = s.match(/\b(30|36|47)\b/);
    if (m) return `sunflower_meal_${m[1]}`;
    if (/\bexpeller\b/.test(s)) return "sunflower_expeller";
  }

  // MBM tiers
  if (canonicalKey === "meat_bone_meal") {
    const m = s.match(/\b(45|50)\b/);
    if (m) return `meat_bone_meal_${m[1]}`;
  }

  // DDGS grain type (and high starch)
  if (canonicalKey === "ddgs") {
    const isHigh = /\bhigh starch\b|\bhigh-starch\b/.test(s);
    if (/\bcorn\b/.test(s)) return isHigh ? "ddgs_corn_high_starch" : "ddgs_corn";
    if (/\bwheat\b/.test(s)) return "ddgs_wheat";
    if (/\bbarley\b/.test(s)) return "ddgs_barley";
  }

  // CGM 40/60
  if (canonicalKey === "corn_gluten_meal") {
    const m = s.match(/\b(40|60)\b/);
    if (m) return `corn_gluten_meal_${m[1]}`;
  }

  // Canola / Rapeseed
  if (canonicalKey === "canola_meal") {
    const m = s.match(/\b(34|36|38)\b/);
    if (m) return `canola_meal_${m[1]}`;
  }
  if (canonicalKey === "rapeseed_meal") {
    const m = s.match(/\b(28|30)\b/);
    if (m) return `rapeseed_meal_${m[1]}`;
  }

  return canonicalKey;
}

function shouldClarifyCpTier(resolvedCanonicalKey, rawClean) {
  const raw = String(rawClean || "");

  for (const fam of CP_TIER_FAMILIES) {
    // already specific => never clarify
    if (fam.specific_keys && fam.specific_keys.has(resolvedCanonicalKey)) return null;

    // generic => clarify ONLY if no tier is implied
    if (fam.generic_keys && fam.generic_keys.has(resolvedCanonicalKey)) {
      // if user clearly typed a tier, we should not clarify (upgradeTierIfImplied handles it)
      if (fam.tier_hint_re && fam.tier_hint_re.test(raw)) return null;

      return {
        family: fam.family,
        canonical_key: resolvedCanonicalKey,
        prompt: fam.prompt
      };
    }
  }

  return null;
}

// ---- Main ----

function parseFormulaText(formulaText) {
  const lines = (formulaText || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const rawItems = [];
  const skipped = [];
  const unknown_raw = [];
  const needs_clarification = [];
  let total = 0;

  for (const line of lines) {
    const match = line.match(/^(.+?)[\s:=]+(-?\d+(\.\d+)?)\s*%?$/);

    if (!match) {
      skipped.push(line);
      continue;
    }

    const rawName = match[1];
    const inclusion = Number(match[2]);

    if (!rawName || !Number.isFinite(inclusion)) {
      skipped.push(line);
      continue;
    }

    const rawClean = cleanName(rawName);

    // 1) Resolve alias (exact)
    const ali = resolveAlias(rawClean);
    let canonical = ali && ali.canonical_key ? ali.canonical_key : null;

    if (!canonical) {
      unknown_raw.push({
        raw: rawName,
        cleaned: rawClean,
        inclusion,
        suggestions: suggestClosest(rawClean, CANDIDATES, 6)
      });

      rawItems.push({
        ingredient: rawClean,
        inclusion,
        is_unknown: true,
        raw: rawName,
        lot: null
      });

      total += inclusion;
      continue;
    }

    // 1.5) Upgrade generic tier families when tier is clearly implied by input
    canonical = upgradeTierIfImplied(canonical, rawClean);

    // 2) CP/grade enforcement (ask only when still generic AND no tier implied)
    const clarify = shouldClarifyCpTier(canonical, rawClean);
    if (clarify) {
      needs_clarification.push({
        raw: rawName,
        cleaned: rawClean,
        inclusion,
        canonical_key: canonical,
        family: clarify.family,
        prompt: clarify.prompt,
        options: optionsForFamily(clarify.family)
      });

      // keep raw token so it shows as unknown until clarified
      rawItems.push({
        ingredient: rawClean,
        inclusion,
        is_unknown: true,
        raw: rawName,
        lot: null,
        needs_clarification: true,
        clarification_family: clarify.family
      });

      total += inclusion;
      continue;
    }

    // 3) Accept canonical
    rawItems.push({ ingredient: canonical, inclusion, lot: null });
    total += inclusion;
  }

  const items = mergeItemsLotReady(rawItems);

  return {
    items,
    total,
    skipped,
    unknown_raw,
    needs_clarification
  };
}

module.exports = { parseFormulaText };
