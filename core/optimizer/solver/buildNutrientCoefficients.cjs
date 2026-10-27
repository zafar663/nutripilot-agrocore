"use strict";

/**
 * Build nutrient coefficient matrix from ingredient DB.
 * Optimizer-ready version:
 * - supports current loader export shape
 * - uses canonical ID mapping for common commercial names
 * - derives SID amino acids from total_* and dig_* when sid_* is absent
 * - treats non-applicable nutrient gaps as 0 instead of noisy missing values
 * - only reports suspicious missing values for commercially relevant ingredients
 */

const loadIngredientsModule = require("../../db/ingredients/_index/LOAD_INGREDIENTS.cjs");

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveLoadIngredients(mod) {
  if (typeof mod === "function") return mod;
  if (mod && typeof mod.loadIngredients === "function") return mod.loadIngredients;
  if (mod && typeof mod.LOAD_INGREDIENTS === "function") return mod.LOAD_INGREDIENTS;
  if (mod && typeof mod.default === "function") return mod.default;
  return null;
}

function extractDbObject(loaded) {
  if (!loaded) return {};
  if (loaded.db && typeof loaded.db === "object") return loaded.db;
  if (loaded.ingredients && typeof loaded.ingredients === "object") return loaded.ingredients;
  if (typeof loaded === "object") return loaded;
  return {};
}

function tryLoadIngredients(loadFn, context) {
  const attempts = [
    () => loadFn({
      species: context.species || "poultry",
      type: context.type || "broiler",
      region: context.region || "us",
      version: context.version || "v1",
      locale: context.locale || "US"
    }),
    () => loadFn(
      context.species || "poultry",
      context.type || "broiler",
      context.region || "us",
      context.version || "v1"
    ),
    () => loadFn()
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return { ok: true, result: attempt() };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    result: null,
    error: lastError ? (lastError.message || String(lastError)) : "Unknown loader error"
  };
}

function resolveIngredientId(requestedId) {
  const id = String(requestedId || "").trim().toLowerCase();

  const map = {
    "corn": "corn_grain_avg",
    "maize": "corn_grain_avg",

    "sbm": "soybean_meal_48_cp",
    "sbm_48": "soybean_meal_48_cp",
    "soybean meal 48": "soybean_meal_48_cp",
    "soybean_meal_48": "soybean_meal_48_cp",

    "canola meal": "canola_meal",
    "canola oil": "canola_oil",
    "corn oil": "corn_oil",

    "dcp": "dcp",
    "limestone": "limestone",
    "salt": "salt",
    "sodium bicarbonate": "sodium_bicarbonate",

    "dl_met": "dl_met",
    "dl-methionine": "dl_met",
    "dl methionine": "dl_met",

    "l_lys_hcl": "l_lys_hcl",
    "l-lys hcl": "l_lys_hcl",
    "l lys hcl": "l_lys_hcl",
    "lysine hcl": "l_lys_hcl",

    "l_thr": "l_thr",
    "l-thr": "l_thr",
    "l threonine": "l_thr",

    "l_arg": "l_arg",
    "l_cys": "l_cys"
  };

  return map[id] || requestedId;
}

function deriveSidValue(ingredientData, sidKey) {
  const aa = String(sidKey || "").replace(/^sid_/, "");

  if (aa === "metcys") {
    const sidMetDirect = safeNumber(ingredientData.sid_met);
    const sidCysDirect = safeNumber(ingredientData.sid_cys);
    let stored = safeNumber(ingredientData.sid_metcys);
    if (stored === 0) stored = null;
    const tot = safeNumber(ingredientData.total_metcys);
    const digMc = safeNumber(ingredientData.dig_metcys);
    const fromDig =
      tot !== null && digMc !== null && digMc > 5 && digMc <= 100 ? tot * (digMc / 100) : null;
    const sum =
      sidMetDirect !== null || sidCysDirect !== null
        ? (sidMetDirect || 0) + (sidCysDirect || 0)
        : 0;

    if (stored != null && sum > stored + 0.08) {
      if (fromDig != null && Math.abs(fromDig - stored) <= 0.05) return stored;
      if (fromDig != null && fromDig > stored + 0.05) return fromDig;
      if (sum > 0) return sum;
    }
    if (stored != null && stored > 0) return stored;
    if (fromDig != null) return fromDig;
    if (sum > 0) return sum;

    const totalMet = safeNumber(ingredientData.total_met);
    const totalCys = safeNumber(ingredientData.total_cys);
    const digMet = safeNumber(ingredientData.dig_met);
    const digCys = safeNumber(ingredientData.dig_cys);

    const sidMetDerived =
      totalMet !== null
        ? (digMet !== null ? (totalMet * digMet / 100) : totalMet)
        : 0;

    const sidCysDerived =
      totalCys !== null
        ? (digCys !== null ? (totalCys * digCys / 100) : totalCys)
        : 0;

    const combined = sidMetDerived + sidCysDerived;
    return combined > 0 ? combined : null;
  }

  const totalKey = `total_${aa}`;
  const digKey = `dig_${aa}`;

  const totalVal = safeNumber(ingredientData[totalKey]);
  const digVal = safeNumber(ingredientData[digKey]);

  if (totalVal === null) return null;

  if (digVal !== null) {
    return totalVal * digVal / 100;
  }

  return totalVal;
}

function getNutrientValue(ingredientData, nutrientKey) {
  const k = String(nutrientKey || "");
  if (k === "sid_metcys" || k === "sid_met_cys") {
    return deriveSidValue(ingredientData, "sid_metcys");
  }

  const direct = safeNumber(ingredientData[nutrientKey]);
  if (direct !== null) return direct;

  if (/^sid_/.test(nutrientKey)) {
    return deriveSidValue(ingredientData, nutrientKey);
  }

  return null;
}

function isSyntheticAA(category) {
  return String(category || "").toLowerCase() === "synthetic_aa";
}

function isMineralOrElectrolyte(category, resolvedId) {
  const c = String(category || "").toLowerCase();
  const id = String(resolvedId || "").toLowerCase();

  return (
    c === "mineral" ||
    id === "dcp" ||
    id === "limestone" ||
    id === "salt" ||
    id === "sodium_bicarbonate"
  );
}

function isOilOrFat(category) {
  return String(category || "").toLowerCase() === "oil_fat";
}

function shouldDefaultZero(ingredientData, nutrientKey, resolvedId) {
  const category = ingredientData?.category || "";

  if (isOilOrFat(category)) {
    return true;
  }

  if (isMineralOrElectrolyte(category, resolvedId)) {
    return true;
  }

  if (isSyntheticAA(category)) {
    // Keep table AMEn. Zero ME used to make Lys-HCl look like an energy hole, so the
    // solver dropped it to protect ME and left SID Lys short.
    if (["cp", "ca", "avp", "na", "cl", "k", "cf", "ndf", "adf", "ee", "starch"].includes(nutrientKey)) return true;
  }

  return false;
}

function buildNutrientCoefficients(model = {}) {
  const context = model?.meta?.request_context || {};
  const loadFn = resolveLoadIngredients(loadIngredientsModule);

  if (!loadFn) {
    return {
      ok: false,
      matrix: {},
      ingredient_hits: {},
      missing_ingredients: (model.active_ingredients || []).map(x => x.id),
      missing_nutrient_values: [],
      resolved_ids: {},
      loader_error: "Could not resolve a callable export from LOAD_INGREDIENTS.cjs"
    };
  }

  const loadedAttempt = tryLoadIngredients(loadFn, context);

  if (!loadedAttempt.ok) {
    return {
      ok: false,
      matrix: {},
      ingredient_hits: {},
      missing_ingredients: (model.active_ingredients || []).map(x => x.id),
      missing_nutrient_values: [],
      resolved_ids: {},
      loader_error: loadedAttempt.error
    };
  }

  const db = extractDbObject(loadedAttempt.result);
  const ingredients = Array.isArray(model.active_ingredients) ? model.active_ingredients : [];
  const nutrientRows = Array.isArray(model?.constraints?.nutrient_constraints)
    ? model.constraints.nutrient_constraints
    : [];

  const matrix = {};
  const ingredient_hits = {};
  const missing_ingredients = [];
  const missing_nutrient_values = [];
  const resolved_ids = {};

  for (const ing of ingredients) {
    const resolvedId = resolveIngredientId(ing.id);
    resolved_ids[ing.id] = resolvedId;
    ingredient_hits[ing.id] = !!db[resolvedId];
    if (!db[resolvedId]) missing_ingredients.push(ing.id);
  }

  for (const constraint of nutrientRows) {
    const key = constraint.key;
    matrix[key] = {};

    for (const ing of ingredients) {
      const variable = `x_${ing.id}`;
      const resolvedId = resolveIngredientId(ing.id);
      const ingredientData = db[resolvedId];

      if (!ingredientData) {
        matrix[key][variable] = null;
        continue;
      }

      const nutrientValue = getNutrientValue(ingredientData, key);

      if (nutrientValue !== null) {
        matrix[key][variable] = nutrientValue;
        continue;
      }

      if (shouldDefaultZero(ingredientData, key, resolvedId)) {
        matrix[key][variable] = 0;
        continue;
      }

      matrix[key][variable] = null;
      missing_nutrient_values.push({
        ingredient_id: ing.id,
        resolved_id: resolvedId,
        nutrient_key: key
      });
    }
  }

  return {
    ok: true,
    matrix,
    ingredient_hits,
    missing_ingredients,
    missing_nutrient_values,
    resolved_ids,
    loader_error: null
  };
}

module.exports = buildNutrientCoefficients;

