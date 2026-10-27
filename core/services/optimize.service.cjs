const path = require("path");
const { createRequire } = require("module");
const requireCjs = createRequire(__filename);

const __dirname_local = __dirname;

const ingredientsLoaderPath = path.join(
  __dirname_local,
  "..",
  "db",
  "ingredients",
  "_index",
  "LOAD_INGREDIENTS.cjs"
);

let loadIngredientsFn = null;
let lpSolverModule = null;

function loadIngredientsModule() {
  try {
    const mod = requireCjs(ingredientsLoaderPath);
    loadIngredientsFn =
      (mod && (mod.loadIngredients || mod.default || mod.LOAD_INGREDIENTS)) ||
      (typeof mod === "function" ? mod : null);
    return typeof loadIngredientsFn === "function";
  } catch (_err) {
    loadIngredientsFn = null;
    return false;
  }
}

const { solveJsLpModel } = requireCjs(path.join(__dirname, "..", "optimizer", "solver", "solverPool.cjs"));

function loadLpSolverModule() {
  try {
    const mod = requireCjs("javascript-lp-solver");
    lpSolverModule = mod || null;
    return !!lpSolverModule;
  } catch (_err) {
    lpSolverModule = null;
    return false;
  }
}

// Initial attempt
loadIngredientsModule();
loadLpSolverModule();

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round4(v) {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

function sumBy(arr, fn) {
  return arr.reduce((s, x) => s + fn(x), 0);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[%()+]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstNumeric(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const v = toNumber(obj[key], null);
      if (isFiniteNumber(v)) return v;
    }
  }
  return null;
}


function getConstraintBands(nutrientKey) {
  const k = normalizeKey(nutrientKey);

  if (["me", "amen", "ne"].includes(k)) {
    return {
      numeric_tolerance: 0.0001,
      warn_band_below: 10,
      warn_band_above: 0
    };
  }

  return {
    numeric_tolerance: 0.001,
    warn_band_below: 0,
    warn_band_above: 0
  };
}
function validateIngredient(row, index) {
  const errors = [];
  const id = row?.id;
  const display_name = row?.display_name ?? row?.id ?? `ingredient_${index + 1}`;
  const min = toNumber(row?.min, 0);
  const max = toNumber(row?.max, 0);
  const enabled = row?.enabled !== false;

  const costInfo = normalizeIngredientCostInput(row);
  const cost = toNumber(costInfo.normalized_cost_per_metric_ton, null);

  if (!id || typeof id !== "string") {
    errors.push(`ingredient_pool[${index}].id is required`);
  }
  if (!isFiniteNumber(min)) {
    errors.push(`ingredient_pool[${index}].min must be numeric`);
  }
  if (!isFiniteNumber(max)) {
    errors.push(`ingredient_pool[${index}].max must be numeric`);
  }
  if (!isFiniteNumber(cost)) {
    errors.push(`ingredient_pool[${index}].cost (or cost_value) must be numeric`);
  }
  if (isFiniteNumber(min) && min < 0) {
    errors.push(`ingredient_pool[${index}].min cannot be negative`);
  }
  if (isFiniteNumber(max) && max < 0) {
    errors.push(`ingredient_pool[${index}].max cannot be negative`);
  }
  if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
    errors.push(`ingredient_pool[${index}] min cannot be greater than max`);
  }

  return {
    errors,
    normalized: {
      id,
      display_name,
      min: round4(min),
      max: round4(max),
      cost,
      enabled,
      cost_input: costInfo,
      profile_override:
        row?.profile_override && typeof row.profile_override === "object"
          ? clone(row.profile_override)
          : null
    }
  };
}

function validateConstraint(row, index) {
  const errors = [];
  const key = row?.key;
  const min = row?.min == null ? null : toNumber(row.min, null);
  const target = row?.target == null ? null : toNumber(row.target, null);
  const max = row?.max == null ? null : toNumber(row.max, null);
  const hardness = row?.hardness || "hard";

  if (!key || typeof key !== "string") {
    errors.push(`nutrient_constraints[${index}].key is required`);
  }
  if (row?.min != null && !isFiniteNumber(min)) {
    errors.push(`nutrient_constraints[${index}].min must be numeric`);
  }
  if (row?.target != null && !isFiniteNumber(target)) {
    errors.push(`nutrient_constraints[${index}].target must be numeric`);
  }
  if (row?.max != null && !isFiniteNumber(max)) {
    errors.push(`nutrient_constraints[${index}].max must be numeric`);
  }
  if (min != null && max != null && min > max) {
    errors.push(`nutrient_constraints[${index}] min cannot be greater than max`);
  }

  return {
    errors,
    normalized: {
      key,
      min,
      target,
      max,
      hardness,
      penalty_low: row?.penalty_low == null ? null : toNumber(row.penalty_low, null),
      penalty_high: row?.penalty_high == null ? null : toNumber(row.penalty_high, null),
      penalty_target: row?.penalty_target == null ? null : toNumber(row.penalty_target, null)
    }
  };
}

function buildGreedyLeastCostBasisSolution(ingredientsEnabled, formulaBasis) {
  const working = ingredientsEnabled.map(x => ({
    id: x.id,
    display_name: x.display_name,
    min: round4(x.min),
    max: round4(x.max),
    cost: x.cost,
    inclusion: round4(x.min)
  }));

  let remaining = round4(formulaBasis - sumBy(working, x => x.inclusion));

  const cheapestFirst = [...working].sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.id.localeCompare(b.id);
  });

  for (const item of cheapestFirst) {
    if (remaining <= 0) break;

    const room = round4(item.max - item.inclusion);
    if (room <= 0) continue;

    const add = round4(Math.min(room, remaining));
    item.inclusion = round4(item.inclusion + add);
    remaining = round4(remaining - add);
  }

  const optimizedFormula = working
    .filter(x => x.inclusion > 0)
    .map(x => ({
      id: x.id,
      display_name: x.display_name,
      inclusion: round4(x.inclusion),
      cost: x.cost,
      cost_contribution: round4((x.inclusion / formulaBasis) * x.cost),
      status: "used"
    }));

  const totalInclusion = round4(sumBy(optimizedFormula, x => x.inclusion));
  const totalCostPerTon = round4(sumBy(optimizedFormula, x => x.cost_contribution));

  const atMin = working
    .filter(x => Math.abs(x.inclusion - x.min) <= 0.0001)
    .map(x => x.id);

  const atMax = working
    .filter(x => Math.abs(x.inclusion - x.max) <= 0.0001)
    .map(x => x.id);

  const excluded = working
    .filter(x => x.inclusion <= 0.0001)
    .map(x => x.id);

  return {
    optimizedFormula,
    totalInclusion,
    totalCostPerTon,
    remainingGap: round4(Math.max(0, remaining)),
    atMin,
    atMax,
    excluded,
    rawWorking: working
  };
}

function extractIngredientDb(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.db && typeof payload.db === "object") return payload.db;
  if (payload.ingredients && typeof payload.ingredients === "object") return payload.ingredients;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function loadIngredientDbForContext(context) {
  if (typeof loadIngredientsFn !== "function") {
    loadIngredientsModule();
  }
  if (typeof loadIngredientsFn !== "function") {
    return {
      ok: false,
      error: "Ingredient loader function not available",
      db: {},
      raw: null
    };
  }

  const reqObj = {
    locale: context.locale || "US",
    species: context.species || "poultry",
    type: context.type || "broiler",
    production: context.production || "",
    breed: context.breed || "generic",
    region: context.region || "us",
    version: context.version || "v1"
  };

  const attempts = [
    () => loadIngredientsFn(reqObj),
    () => loadIngredientsFn(reqObj.species, reqObj.type, reqObj.region, reqObj.version),
    () => loadIngredientsFn(reqObj.species, reqObj.region, reqObj.version),
    () => loadIngredientsFn()
  ];

  let raw = null;
  let lastError = null;

  for (const fn of attempts) {
    try {
      raw = fn();
      if (raw) break;
    } catch (err) {
      lastError = err;
    }
  }

  const db = extractIngredientDb(raw);

  if (!db || typeof db !== "object" || Array.isArray(db)) {
    return {
      ok: false,
      error: lastError?.message || "Ingredient DB could not be loaded",
      db: {},
      raw
    };
  }

  return {
    ok: true,
    error: null,
    db,
    raw
  };
}

function buildResolverAliases(requestedId, requestedDisplayName) {
  const source = [requestedId, requestedDisplayName]
    .filter(Boolean)
    .map(normalizeKey);

  const set = new Set(source);

  for (const s of source) {
    if (!s) continue;

    if (s === "corn") {
      set.add("corn_grain_avg");
      set.add("corn_grain");
      set.add("maize");
      set.add("maize_grain");
    }

    if (["soybean_meal_48", "sbm_48", "sbm48", "sbm"].includes(s)) {
      set.add("soybean_meal_48_cp");
      set.add("soybean_meal_46_5_cp");
      set.add("soybean_meal_45_6_cp_avg");
      set.add("soybean_meal");
    }

    if (s === "oil") {
      set.add("soybean_degummed_oil");
      set.add("soybean_acid_oil");
      set.add("canola_oil");
      set.add("corn_oil");
      set.add("vegetable_oil");
    }

    if (["l_lys_hcl", "lysine_hcl", "l_lysine_hcl"].includes(s) || /^lys\d+$/.test(s) || s.includes("lysine")) {
      set.add("l_lys_hcl");
      set.add("l_lysine_hcl");
    }

    if (["l_thr", "l_threonine"].includes(s) || /^thr\d+$/.test(s) || s.includes("threonine")) {
      set.add("l_thr");
      set.add("l_threonine");
    }

    if (["dl_met", "dl_methionine", "dlm"].includes(s) || /^met\d+$/.test(s) || s.includes("methionine")) {
      set.add("dl_met");
      set.add("dl_methionine");
    }
  }

  return [...set];
}

// Strip species/variant suffixes from a normalized DB key to get the base ingredient name.
// e.g. "oats_grain_equine" → "oats_grain", "molasses_equine" → "molasses"
function stripSpeciesSuffix(normKey) {
  return normKey
    .replace(/_equine$/, '')
    .replace(/_horse$/, '')
    .replace(/_dairy$/, '')
    .replace(/_beef$/, '')
    .replace(/_swine$/, '')
    .replace(/_poultry$/, '')
    .replace(/_broiler$/, '')
    .replace(/_layer$/, '')
    .replace(/_sheep$/, '')
    .replace(/_goat$/, '')
    .replace(/_aqua$/, '')
    .replace(/_ruminant$/, '');
}

function resolveIngredientRecord(db, requestedId, requestedDisplayName = "") {
  const targets = buildResolverAliases(requestedId, requestedDisplayName);

  // Pass 1: exact normalized key match
  for (const alias of targets) {
    for (const [dbKey, row] of Object.entries(db || {})) {
      const dbKeyNorm = normalizeKey(dbKey);
      if (dbKeyNorm === alias) {
        return { db_key: dbKey, row, resolution_method: "db_key_or_alias" };
      }
    }
  }

  // Pass 2: exact normalized display_name match
  for (const alias of targets) {
    for (const [dbKey, row] of Object.entries(db || {})) {
      const displayName = row?.display_name || row?.name || "";
      const displayNorm = normalizeKey(displayName);
      if (displayNorm === alias) {
        return { db_key: dbKey, row, resolution_method: "display_name_or_alias" };
      }
    }
  }

  // Pass 3: prefix match on species-suffix-stripped DB key.
  // Handles equine/dairy/etc. DBs where keys are "oats_grain_equine" but the
  // requested ingredient is named just "Oats" (alias "oats").
  // Rule: stripped DB key equals alias OR stripped key starts with alias + "_".
  for (const alias of targets) {
    if (alias.length < 4) continue; // avoid overly short aliases causing false matches
    for (const [dbKey, row] of Object.entries(db || {})) {
      const dbKeyNorm = normalizeKey(dbKey);
      const stripped = stripSpeciesSuffix(dbKeyNorm);
      if (stripped === alias || stripped.startsWith(alias + "_")) {
        return { db_key: dbKey, row, resolution_method: "prefix_stripped_key" };
      }
    }
  }

  // Pass 4: prefix match on normalized display_name (first word matches alias).
  // e.g. alias "oats" matches display_name "Oats, Grain (Whole / Crimped)".
  for (const alias of targets) {
    if (alias.length < 4) continue;
    for (const [dbKey, row] of Object.entries(db || {})) {
      const displayName = row?.display_name || row?.name || "";
      const displayNorm = normalizeKey(displayName);
      if (displayNorm === alias || displayNorm.startsWith(alias + "_")) {
        return { db_key: dbKey, row, resolution_method: "display_name_prefix" };
      }
    }
  }

  return null;
}

function deriveSidFromTotalAndDigestibility(totalValue, digValue) {
  if (!isFiniteNumber(totalValue)) return null;
  if (!isFiniteNumber(digValue)) return null;
  return round4(totalValue * (digValue / 100));
}

function expandConstraintRowsForPercentBasis(nutrientConstraints, formulaBasis = 100) {
  const rows = [];

  for (const c of nutrientConstraints) {
    const coeffs = c.coefficients || {};

    if (isFiniteNumber(c.min)) {
      rows.push({
        nutrient: c.nutrient,
        sense: ">=",
        rhs: round4(c.min * formulaBasis),
        coefficients: coeffs,
        hardness: c.hardness,
        source: "min"
      });
    }

    if (isFiniteNumber(c.max)) {
      rows.push({
        nutrient: c.nutrient,
        sense: "<=",
        rhs: round4(c.max * formulaBasis),
        coefficients: coeffs,
        hardness: c.hardness,
        source: "max"
      });
    }
  }

  return rows;
}

function getNutrientValueForKey(ingredientRow, nutrientKey) {
  const k = normalizeKey(nutrientKey);

  const directAliases = {
    me: ["me", "me_kcal_per_kg"],
    cp: ["cp", "cp_pct"],
    ee: ["ee", "ee_pct", "fat_pct"],
    cf: ["cf", "cf_pct", "crude_fiber_pct"],
    ndf: ["ndf", "ndf_pct"],
    adf: ["adf", "adf_pct"],
    starch: ["starch", "starch_pct"],
    ash: ["ash", "ash_pct"],
    nsc: ["nsc", "nsc_pct"],
    ca: ["ca", "ca_pct", "calcium"],
    total_p: ["total_p", "p_pct", "phosphorus_pct"],
    mg: ["mg", "mg_pct", "magnesium"],
    k: ["k", "k_pct", "potassium"],
    s: ["s", "s_pct", "sulfur"],
    avp: ["avp", "available_p", "available_phosphorus"],
    na: ["na", "na_pct", "sodium"],
    cl: ["cl", "cl_pct", "chloride"],

    sid_lys: ["sid_lys", "sid_lys_pct"],
    sid_met: ["sid_met", "sid_met_pct"],
    sid_thr: ["sid_thr", "sid_thr_pct"],
    sid_trp: ["sid_trp", "sid_trp_pct"],

    total_lys: ["total_lys", "lys", "lys_pct"],
    total_met: ["total_met", "met", "met_pct"],
    total_thr: ["total_thr", "thr", "thr_pct"],
    total_trp: ["total_trp", "trp", "trp_pct"]
  };

  if (k === "sid_lys") {
    const direct = firstNumeric(ingredientRow, ["sid_lys", "sid_lys_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalLys = firstNumeric(ingredientRow, ["total_lys", "lys", "lys_pct"]);
    const digLys = firstNumeric(ingredientRow, ["dig_lys", "sid_coeff_lys", "digestibility_lys"]);
    return deriveSidFromTotalAndDigestibility(totalLys, digLys);
  }

  if (k === "sid_met") {
    const direct = firstNumeric(ingredientRow, ["sid_met", "sid_met_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalMet = firstNumeric(ingredientRow, ["total_met", "met", "met_pct"]);
    const digMet = firstNumeric(ingredientRow, ["dig_met", "sid_coeff_met", "digestibility_met"]);
    return deriveSidFromTotalAndDigestibility(totalMet, digMet);
  }

  if (k === "sid_thr") {
    const direct = firstNumeric(ingredientRow, ["sid_thr", "sid_thr_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalThr = firstNumeric(ingredientRow, ["total_thr", "thr", "thr_pct"]);
    const digThr = firstNumeric(ingredientRow, ["dig_thr", "sid_coeff_thr", "digestibility_thr"]);
    return deriveSidFromTotalAndDigestibility(totalThr, digThr);
  }

  if (k === "sid_trp") {
    const direct = firstNumeric(ingredientRow, ["sid_trp", "sid_trp_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalTrp = firstNumeric(ingredientRow, ["total_trp", "trp", "trp_pct"]);
    const digTrp = firstNumeric(ingredientRow, ["dig_trp", "sid_coeff_trp", "digestibility_trp"]);
    return deriveSidFromTotalAndDigestibility(totalTrp, digTrp);
  }

  if (k === "sid_metcys") {
    let direct = firstNumeric(ingredientRow, [
      "sid_metcys",
      "sid_met_cys",
      "sid_met_plus_cys",
      "sid_methionine_cystine"
    ]);
    if (direct === 0) direct = null;

    const totalMetCys = firstNumeric(ingredientRow, [
      "total_metcys",
      "metcys",
      "met_cys",
      "methionine_cystine"
    ]);
    const digMetCys = firstNumeric(ingredientRow, [
      "dig_metcys",
      "sid_coeff_metcys",
      "digestibility_metcys"
    ]);
    const fromMetCys = deriveSidFromTotalAndDigestibility(totalMetCys, digMetCys);

    const sidMet = getNutrientValueForKey(ingredientRow, "sid_met");
    const totalCys = firstNumeric(ingredientRow, ["total_cys", "cys", "cys_pct"]);
    const digCys = firstNumeric(ingredientRow, ["dig_cys", "sid_coeff_cys", "digestibility_cys"]);
    const sidCys = firstNumeric(ingredientRow, ["sid_cys", "sid_cys_pct"])
      ?? deriveSidFromTotalAndDigestibility(totalCys, digCys);
    const sum = (isFiniteNumber(sidMet) ? sidMet : 0) + (isFiniteNumber(sidCys) ? sidCys : 0);

    if (isFiniteNumber(direct) && sum > direct + 0.08) {
      if (isFiniteNumber(fromMetCys) && Math.abs(fromMetCys - direct) <= 0.05) return direct;
      if (isFiniteNumber(fromMetCys) && fromMetCys > direct + 0.05) return round4(fromMetCys);
      if (sum > 0) return round4(sum);
    }
    if (isFiniteNumber(direct) && direct > 0) return direct;
    if (isFiniteNumber(fromMetCys)) return fromMetCys;
    if (sum > 0) return round4(sum);
    return null;
  }

  if (k === "total_metcys") {
    const direct = firstNumeric(ingredientRow, [
      "total_metcys",
      "metcys",
      "met_cys",
      "methionine_cystine"
    ]);
    if (isFiniteNumber(direct)) return direct;

    const totalMet = firstNumeric(ingredientRow, ["total_met", "met", "met_pct"]);
    const totalCys = firstNumeric(ingredientRow, ["total_cys", "cys", "cys_pct"]);
    if (isFiniteNumber(totalMet) && isFiniteNumber(totalCys)) {
      return round4(totalMet + totalCys);
    }
    return null;
  }

  return firstNumeric(ingredientRow, directAliases[k] || [k]);
}

/**
 * NEW FUNCTION 1
 * Enterprise deviation variables for soft min/max/target handling.
 * Hard constraints stay hard.
 * Soft constraints introduce nonnegative penalty variables.
 */
function buildDeviationVariables({
  constraintsAll,
  nutrientMatrix,
  formulaBasis,
  penalties = {}
}) {
  const variableIds = [];
  const variableBoundsMap = {};
  const variableObjectiveMap = {};
  const solverRows = [];
  const diagnostics = [];

  const defaultPenaltyLow = toNumber(penalties?.nutrient_low, 10000);
  const defaultPenaltyHigh = toNumber(penalties?.nutrient_high, 10000);
  const defaultPenaltyTarget = toNumber(penalties?.nutrient_target, 1000);

  for (const c of constraintsAll || []) {
    const nutrientKey = c.key;
    const keyNorm = normalizeKey(nutrientKey);
    const hardness = normalizeKey(c.hardness || "hard");
    const coeffsBase = { ...(nutrientMatrix?.[nutrientKey] || {}) };

    const penaltyLow = toNumber(c.penalty_low, defaultPenaltyLow);
    const penaltyHigh = toNumber(c.penalty_high, defaultPenaltyHigh);
    const penaltyTarget = toNumber(c.penalty_target, defaultPenaltyTarget);

    if (hardness !== "soft") {
      if (isFiniteNumber(c.min)) {
        solverRows.push({
          nutrient: nutrientKey,
          sense: ">=",
          rhs: round4(c.min * formulaBasis),
          coefficients: { ...coeffsBase },
          hardness: "hard",
          source: "min"
        });
      }

      if (isFiniteNumber(c.max)) {
        solverRows.push({
          nutrient: nutrientKey,
          sense: "<=",
          rhs: round4(c.max * formulaBasis),
          coefficients: { ...coeffsBase },
          hardness: "hard",
          source: "max"
        });
      }

      continue;
    }

    if (isFiniteNumber(c.min)) {
      const varId = `dev_low__${keyNorm}`;
      variableIds.push(varId);
      variableBoundsMap[varId] = { min: 0 };
      variableObjectiveMap[varId] = penaltyLow;

      solverRows.push({
        nutrient: nutrientKey,
        sense: ">=",
        rhs: round4(c.min * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varId]: 1
        },
        hardness: "soft",
        source: "min"
      });

      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varId,
        deviation_type: "deficit_to_min",
        penalty: penaltyLow
      });
    }

    if (isFiniteNumber(c.max)) {
      const varId = `dev_high__${keyNorm}`;
      variableIds.push(varId);
      variableBoundsMap[varId] = { min: 0 };
      variableObjectiveMap[varId] = penaltyHigh;

      solverRows.push({
        nutrient: nutrientKey,
        sense: "<=",
        rhs: round4(c.max * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varId]: -1
        },
        hardness: "soft",
        source: "max"
      });

      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varId,
        deviation_type: "excess_above_max",
        penalty: penaltyHigh
      });
    }

    if (isFiniteNumber(c.target)) {
      const varLowId = `dev_target_low__${keyNorm}`;
      const varHighId = `dev_target_high__${keyNorm}`;

      variableIds.push(varLowId, varHighId);
      variableBoundsMap[varLowId] = { min: 0 };
      variableBoundsMap[varHighId] = { min: 0 };
      variableObjectiveMap[varLowId] = penaltyTarget;
      variableObjectiveMap[varHighId] = penaltyTarget;

      solverRows.push({
        nutrient: nutrientKey,
        sense: ">=",
        rhs: round4(c.target * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varLowId]: 1
        },
        hardness: "soft",
        source: "target_low"
      });

      solverRows.push({
        nutrient: nutrientKey,
        sense: "<=",
        rhs: round4(c.target * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varHighId]: -1
        },
        hardness: "soft",
        source: "target_high"
      });

      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varLowId,
        deviation_type: "below_target",
        penalty: penaltyTarget
      });
      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varHighId,
        deviation_type: "above_target",
        penalty: penaltyTarget
      });
    }
  }

  return {
    variable_ids: variableIds,
    variable_bounds_map: variableBoundsMap,
    variable_objective_map: variableObjectiveMap,
    solver_rows: solverRows,
    diagnostics
  };
}

/**
 * NEW FUNCTION 2
 * Movement variables to penalize movement away from starting formula.
 * move_up_i >= x_i - start_i
 * move_down_i >= start_i - x_i
 */
function buildMovementVariables({
  ingredientsEnabled,
  startingFormula,
  penalties = {}
}) {
  const variableIds = [];
  const variableBoundsMap = {};
  const variableObjectiveMap = {};
  const solverRows = [];
  const diagnostics = [];

  const defaultPenaltyMovement = toNumber(penalties?.movement, 1);
  const startingMap = buildStartingFormulaMap(startingFormula);
  const hasStartingFormula = Object.keys(startingMap).length > 0;

  if (!hasStartingFormula) {
    return {
      variable_ids: [],
      variable_bounds_map: {},
      variable_objective_map: {},
      solver_rows: [],
      diagnostics: [],
      has_starting_formula: false
    };
  }

  for (const ing of ingredientsEnabled || []) {
    const ingNorm = normalizeKey(ing.id);
    const startInclusion = round4(toNumber(startingMap?.[ing.id]?.inclusion, 0));
    const movePenalty = toNumber(
      ing?.movement_penalty,
      defaultPenaltyMovement
    );

    const moveUpId = `move_up__${ingNorm}`;
    const moveDownId = `move_down__${ingNorm}`;

    variableIds.push(moveUpId, moveDownId);
    variableBoundsMap[moveUpId] = { min: 0 };
    variableBoundsMap[moveDownId] = { min: 0 };
    variableObjectiveMap[moveUpId] = movePenalty;
    variableObjectiveMap[moveDownId] = movePenalty;

    // x - move_up <= start
    solverRows.push({
      nutrient: `movement_${ing.id}`,
      sense: "<=",
      rhs: startInclusion,
      coefficients: {
        [ing.id]: 1,
        [moveUpId]: -1
      },
      hardness: "soft",
      source: "move_up"
    });

    // x + move_down >= start
    solverRows.push({
      nutrient: `movement_${ing.id}`,
      sense: ">=",
      rhs: startInclusion,
      coefficients: {
        [ing.id]: 1,
        [moveDownId]: 1
      },
      hardness: "soft",
      source: "move_down"
    });

    diagnostics.push({
      ingredient_id: ing.id,
      start_inclusion: startInclusion,
      move_up_variable: moveUpId,
      move_down_variable: moveDownId,
      penalty: movePenalty
    });
  }

  return {
    variable_ids: variableIds,
    variable_bounds_map: variableBoundsMap,
    variable_objective_map: variableObjectiveMap,
    solver_rows: solverRows,
    diagnostics,
    has_starting_formula: true
  };
}

/**
 * NEW FUNCTION 3
 * Final objective = ingredient cost + nutrient deviation penalties + movement penalties
 */
function buildObjectiveFunction({
  ingredientIds,
  ingredientCostVector,
  deviationBuild,
  movementBuild
}) {
  const mergedCostVector = {};
  const seen = new Set();

  for (const id of ingredientIds || []) {
    mergedCostVector[id] = toNumber(ingredientCostVector?.[id], 0);
    seen.add(id);
  }

  for (const [id, val] of Object.entries(deviationBuild?.variable_objective_map || {})) {
    mergedCostVector[id] = toNumber(val, 0);
    seen.add(id);
  }

  for (const [id, val] of Object.entries(movementBuild?.variable_objective_map || {})) {
    mergedCostVector[id] = toNumber(val, 0);
    seen.add(id);
  }

  return {
    all_variable_ids: [...seen],
    objective_cost_vector: mergedCostVector,
    extra_variable_bounds_map: {
      ...(deviationBuild?.variable_bounds_map || {}),
      ...(movementBuild?.variable_bounds_map || {})
    },
    objective_breakdown: {
      ingredient_variables: ingredientIds || [],
      deviation_variables: deviationBuild?.variable_ids || [],
      movement_variables: movementBuild?.variable_ids || []
    }
  };
}

function buildJavascriptLpModel({
  allVariableIds,
  objectiveCostVector,
  variableBoundsMap,
  basisConstraint,
  solverReadyConstraints
}) {
  const constraints = {
    basis_eq: {
      equal: basisConstraint.rhs
    }
  };

  for (const id of allVariableIds) {
    const b = variableBoundsMap[id] || null;

    if (b && isFiniteNumber(b.min)) {
      constraints[`var_${id}_min`] = { min: b.min };
    }
    if (b && isFiniteNumber(b.max)) {
      constraints[`var_${id}_max`] = { max: b.max };
    }
  }

  solverReadyConstraints.forEach((row, idx) => {
    const key = `${normalizeKey(row.nutrient)}_${row.source}_${idx}`;
    if (row.sense === ">=") {
      constraints[key] = { min: row.rhs };
    } else if (row.sense === "<=") {
      constraints[key] = { max: row.rhs };
    } else if (row.sense === "=") {
      constraints[key] = { equal: row.rhs };
    }
  });

  const variables = {};

  for (const id of allVariableIds) {
    const v = {
      cost: toNumber(objectiveCostVector?.[id], 0),
      basis_eq: toNumber(basisConstraint?.coefficients?.[id], 0)
    };

    const b = variableBoundsMap[id] || null;
    if (b && isFiniteNumber(b.min)) {
      v[`var_${id}_min`] = 1;
    }
    if (b && isFiniteNumber(b.max)) {
      v[`var_${id}_max`] = 1;
    }

    solverReadyConstraints.forEach((row, idx) => {
      const key = `${normalizeKey(row.nutrient)}_${row.source}_${idx}`;
      v[key] = toNumber(row.coefficients?.[id], 0);
    });

    variables[id] = v;
  }

  return {
    optimize: "cost",
    opType: "min",
    constraints,
    variables
  };
}

async function solveWithJavascriptLp(model) {
  return solveJsLpModel(model);
}

function buildOptimizedFormulaFromLpResult(variableIds, ingredientsEnabled, result, formulaBasis) {
  const ingredientMap = {};
  ingredientsEnabled.forEach(ing => {
    ingredientMap[ing.id] = ing;
  });

  const optimizedFormula = [];

  for (const id of variableIds) {
    const ing = ingredientMap[id];
    if (!ing) continue;

    const inclusion = round4(toNumber(result?.[id], 0));
    if (inclusion <= 0.0001) continue;

    optimizedFormula.push({
      id,
      display_name: ing.display_name,
      inclusion,
      cost: ing.cost,
      cost_contribution: round4((inclusion / formulaBasis) * ing.cost),
      status: "used"
    });
  }

  return optimizedFormula;
}

function calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, formulaBasis) {
  const results = {};
  const inclusions = {};

  optimizedFormula.forEach(row => {
    inclusions[row.id] = row.inclusion;
  });

  for (const nutrientKey of Object.keys(nutrientMatrix || {})) {
    let total = 0;
    const coeffs = nutrientMatrix[nutrientKey] || {};

    for (const [id, coeff] of Object.entries(coeffs)) {
      const inclusion = toNumber(inclusions[id], 0);
      total += inclusion * toNumber(coeff, 0);
    }

    results[nutrientKey] = round4(total / formulaBasis);
  }

  return results;
}

function evaluateConstraintSatisfaction(constraintsAll, nutrientResults) {
  return constraintsAll.map(c => {
    const actual = toNumber(nutrientResults?.[c.key], null);
    const hardness = normalizeKey(c.hardness || "hard");
    const bands = getConstraintBands(c.key);

    const tol = bands.numeric_tolerance;
    const warnBandBelow = toNumber(bands.warn_band_below, 0);
    const warnBandAbove = toNumber(bands.warn_band_above, 0);

    const min_ok_strict =
      !isFiniteNumber(c.min) || (isFiniteNumber(actual) && actual >= (c.min - tol));

    const max_ok_strict =
      !isFiniteNumber(c.max) || (isFiniteNumber(actual) && actual <= (c.max + tol));

    const min_warn_ok =
      !isFiniteNumber(c.min) ||
      (isFiniteNumber(actual) && actual >= (c.min - warnBandBelow));

    const max_warn_ok =
      !isFiniteNumber(c.max) ||
      (isFiniteNumber(actual) && actual <= (c.max + warnBandAbove));

    let status = "OK";

    if (min_ok_strict && max_ok_strict) {
      status = "OK";
    } else if (hardness === "soft") {
      status = "WARN";
    } else if (!min_ok_strict && min_warn_ok && max_ok_strict) {
      status = "WARN";
    } else {
      status = "FAIL";
    }

    return {
      nutrient: c.key,
      min: c.min,
      target: c.target,
      max: c.max,
      actual,
      numeric_tolerance_used: tol,
      warning_band_below_used: warnBandBelow,
      warning_band_above_used: warnBandAbove,
      min_ok: min_ok_strict,
      max_ok: max_ok_strict,
      min_warn_ok,
      max_warn_ok,
      status,
      hardness: c.hardness
    };
  });
}

function buildStartingFormulaMap(startingFormula) {
  const map = {};
  (Array.isArray(startingFormula) ? startingFormula : []).forEach(row => {
    if (!row?.id) return;
    map[row.id] = {
      id: row.id,
      display_name: row.display_name || row.id,
      inclusion: round4(toNumber(row.inclusion, 0))
    };
  });
  return map;
}

function applyPracticalControlsToIngredients(ingredientsEnabled, body) {
  const locked = Array.isArray(body.locked_ingredients) ? body.locked_ingredients : [];
  const excluded = Array.isArray(body.excluded_ingredients) ? body.excluded_ingredients : [];
  const maxMovement = body?.max_movement && typeof body.max_movement === "object" ? body.max_movement : {};
  const startingFormulaMap = buildStartingFormulaMap(body.starting_formula);

  const lockedMap = {};
  locked.forEach(row => {
    if (!row?.id) return;
    const val = toNumber(row.inclusion, null);
    if (isFiniteNumber(val)) {
      lockedMap[row.id] = round4(val);
    }
  });

  const excludedSet = new Set(excluded.map(x => String(x)));

  const adjusted = ingredientsEnabled.map(ing => {
    let adjustedMin = ing.min;
    let adjustedMax = ing.max;
    const notes = [];

    if (Object.prototype.hasOwnProperty.call(lockedMap, ing.id)) {
      adjustedMin = lockedMap[ing.id];
      adjustedMax = lockedMap[ing.id];
      notes.push("locked");
    } else if (excludedSet.has(ing.id)) {
      adjustedMin = 0;
      adjustedMax = 0;
      notes.push("excluded");
    } else if (
      Object.prototype.hasOwnProperty.call(maxMovement, ing.id) &&
      Object.prototype.hasOwnProperty.call(startingFormulaMap, ing.id)
    ) {
      const move = toNumber(maxMovement[ing.id], null);
      const start = toNumber(startingFormulaMap[ing.id].inclusion, null);

      if (isFiniteNumber(move) && move >= 0 && isFiniteNumber(start)) {
        adjustedMin = Math.max(ing.min, round4(start - move));
        adjustedMax = Math.min(ing.max, round4(start + move));
        notes.push("max_movement_applied");
      }
    }

    if (adjustedMin > adjustedMax) {
      adjustedMin = adjustedMax;
      notes.push("bounds_collapsed_after_controls");
    }

    return {
      ...ing,
      min: round4(adjustedMin),
      max: round4(adjustedMax),
      _practical_control_notes: notes
    };
  });

  const controlsAppliedToBounds = adjusted.map(ing => {
    const original = ingredientsEnabled.find(x => x.id === ing.id) || ing;
    return {
      id: ing.id,
      display_name: ing.display_name,
      original_min: original.min,
      original_max: original.max,
      adjusted_min: ing.min,
      adjusted_max: ing.max,
      notes: ing._practical_control_notes || []
    };
  });

  return {
    adjustedIngredients: adjusted.map(({ _practical_control_notes, ...rest }) => rest),
    practicalControls: {
      locked_ingredients: clone(locked),
      excluded_ingredients: clone(excluded),
      max_movement: clone(maxMovement),
      controls_applied_to_bounds: controlsAppliedToBounds
    }
  };
}

function buildStartingFormulaComparison(startingFormula, optimizedFormula, ingredientsEnabled) {
  const hasStartingFormula = Array.isArray(startingFormula) && startingFormula.length > 0;
  const startMap = buildStartingFormulaMap(startingFormula);
  const optMap = {};
  (optimizedFormula || []).forEach(row => {
    optMap[row.id] = row;
  });

  const rows = ingredientsEnabled.map(ing => {
    const start = startMap[ing.id];
    const opt = optMap[ing.id];

    return {
      id: ing.id,
      display_name: ing.display_name,
      start_inclusion: round4(toNumber(start?.inclusion, 0)),
      optimized_inclusion: round4(toNumber(opt?.inclusion, 0)),
      delta_inclusion: round4(toNumber(opt?.inclusion, 0) - toNumber(start?.inclusion, 0)),
      start_cost: 0,
      optimized_cost: isFiniteNumber(opt?.cost) ? opt.cost : null
    };
  });

  return { has_starting_formula: hasStartingFormula, rows };
}

function buildInclusionDelta(startingFormulaComparison) {
  return (startingFormulaComparison?.rows || [])
    .map(row => ({
      id: row.id,
      display_name: row.display_name,
      start_inclusion: row.start_inclusion,
      optimized_inclusion: row.optimized_inclusion,
      delta_inclusion: row.delta_inclusion,
      direction:
        row.delta_inclusion > 0 ? "up" :
        row.delta_inclusion < 0 ? "down" : "same"
    }))
    .sort((a, b) => Math.abs(b.delta_inclusion) - Math.abs(a.delta_inclusion));
}

function calculateFormulaCostFromRows(rows, ingredientCostMap, formulaBasis) {
  return round4(sumBy(rows || [], row => {
    const inclusion = toNumber(row?.inclusion, 0);
    const cost = toNumber(ingredientCostMap[row?.id], 0);
    return (inclusion / formulaBasis) * cost;
  }));
}

function buildCostDelta(startingFormula, optimizedFormula, ingredientsEnabled, formulaBasis) {
  const ingredientCostMap = {};
  ingredientsEnabled.forEach(ing => {
    ingredientCostMap[ing.id] = ing.cost;
  });

  const startRows = Array.isArray(startingFormula) ? startingFormula : [];
  const optRows = Array.isArray(optimizedFormula) ? optimizedFormula : [];

  const startTotalCost = calculateFormulaCostFromRows(startRows, ingredientCostMap, formulaBasis);
  const optimizedTotalCost = calculateFormulaCostFromRows(optRows, ingredientCostMap, formulaBasis);

  return {
    start_total_cost_per_ton: startTotalCost,
    optimized_total_cost_per_ton: optimizedTotalCost,
    delta_cost_per_ton: round4(optimizedTotalCost - startTotalCost)
  };
}

function calculateNutrientResultsFromStartingFormula(startingFormula, nutrientMatrix, formulaBasis) {
  const normalized = (Array.isArray(startingFormula) ? startingFormula : []).map(row => ({
    id: row.id,
    inclusion: round4(toNumber(row.inclusion, 0))
  }));
  return calculateNutrientResultsFromFormula(normalized, nutrientMatrix, formulaBasis);
}

function buildNutrientDelta(startingFormula, optimizedFormula, nutrientMatrix, constraintsAll, formulaBasis) {
  const hasStartingFormula = Array.isArray(startingFormula) && startingFormula.length > 0;
  const startResults = hasStartingFormula
    ? calculateNutrientResultsFromStartingFormula(startingFormula, nutrientMatrix, formulaBasis)
    : {};
  const optimizedResults = calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, formulaBasis);

  return {
    has_starting_formula: hasStartingFormula,
    rows: constraintsAll.map(c => ({
      nutrient: c.key,
      start_actual: hasStartingFormula ? toNumber(startResults[c.key], null) : null,
      optimized_actual: toNumber(optimizedResults[c.key], null),
      delta: hasStartingFormula
        ? round4(toNumber(optimizedResults[c.key], 0) - toNumber(startResults[c.key], 0))
        : null,
      min: c.min,
      target: c.target,
      max: c.max
    }))
  };
}

function buildBindingConstraints(constraintsAll, nutrientResults, tolerance = 0.001) {
  return constraintsAll
    .map(c => {
      const actual = toNumber(nutrientResults?.[c.key], null);
      const slackToMin = isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null;
      const slackToMax = isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null;
      const distanceToTarget = isFiniteNumber(c.target) && isFiniteNumber(actual) ? round4(actual - c.target) : null;

      return {
        nutrient: c.key,
        binding_min: isFiniteNumber(slackToMin) ? Math.abs(slackToMin) <= tolerance : false,
        binding_max: isFiniteNumber(slackToMax) ? Math.abs(slackToMax) <= tolerance : false,
        near_target: isFiniteNumber(distanceToTarget) ? Math.abs(distanceToTarget) <= tolerance : false,
        actual,
        min: c.min,
        target: c.target,
        max: c.max,
        slack_to_min: slackToMin,
        slack_to_max: slackToMax,
        distance_to_target: distanceToTarget
      };
    })
    .filter(row => row.binding_min || row.binding_max || row.near_target);
}

function buildNutrientSlack(constraintsAll, nutrientResults) {
  return constraintsAll.map(c => {
    const actual = toNumber(nutrientResults?.[c.key], null);
    return {
      nutrient: c.key,
      actual,
      min: c.min,
      target: c.target,
      max: c.max,
      slack_to_min: isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null,
      slack_to_max: isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null,
      distance_to_target: isFiniteNumber(c.target) && isFiniteNumber(actual) ? round4(actual - c.target) : null,
      hardness: c.hardness
    };
  });
}

function buildIngredientBoundStatus(ingredientsEnabled, optimizedFormula, tolerance = 0.0001) {
  const optMap = {};
  (optimizedFormula || []).forEach(row => {
    optMap[row.id] = row;
  });

  return ingredientsEnabled.map(ing => {
    const inclusion = round4(toNumber(optMap[ing.id]?.inclusion, 0));
    return {
      id: ing.id,
      display_name: ing.display_name,
      inclusion,
      min: ing.min,
      max: ing.max,
      cost: ing.cost,
      at_min: Math.abs(inclusion - ing.min) <= tolerance,
      at_max: Math.abs(inclusion - ing.max) <= tolerance,
      excluded: inclusion <= tolerance,
      slack_to_min: round4(inclusion - ing.min),
      slack_to_max: round4(ing.max - inclusion)
    };
  });
}

function buildOptimizationSummary({
  optimizedFormula,
  costSummary,
  bindingConstraints,
  ingredientBoundStatus,
  inclusionDelta
}) {
  const topBindingNutrients = (bindingConstraints || []).map(x => x.nutrient);

  const ingredientsAtMax = (ingredientBoundStatus || [])
    .filter(x => x.at_max)
    .map(x => x.id);

  const ingredientsAtMin = (ingredientBoundStatus || [])
    .filter(x => x.at_min)
    .map(x => x.id);

  const topMovedIngredients = (inclusionDelta || [])
    .filter(x => x.direction !== "same")
    .slice(0, 5)
    .map(x => ({
      id: x.id,
      delta_inclusion: x.delta_inclusion,
      direction: x.direction
    }));

  return {
    total_cost_per_ton: costSummary?.total_cost_per_ton ?? null,
    top_binding_nutrients: topBindingNutrients,
    ingredients_at_max: ingredientsAtMax,
    ingredients_at_min: ingredientsAtMin,
    top_moved_ingredients: topMovedIngredients
  };
}

function buildInfeasibilityDiagnostics({
  basisFeasibilityNotes,
  constraintSatisfaction,
  solverStatus,
  lpSolveAttempt
}) {
  const failedConstraints = (constraintSatisfaction || [])
    .filter(x => x.status === "FAIL")
    .map(x => ({
      nutrient: x.nutrient,
      actual: x.actual,
      min: x.min,
      target: x.target,
      max: x.max
    }));

  return {
    has_infeasibility: (basisFeasibilityNotes || []).length > 0 || failedConstraints.length > 0,
    solver_status: solverStatus?.termination || null,
    lp_status: lpSolveAttempt?.status || null,
    notes: clone(basisFeasibilityNotes || []),
    failed_constraints: failedConstraints
  };
}


function buildObjectiveBreakdownFromLpResult({
  lpRawResult,
  ingredientVariableIds,
  objectiveCostVector,
  formulaBasis
}) {
  const raw = lpRawResult || {};
  const ingredientIds = new Set(ingredientVariableIds || []);

  let ingredient_cost_component = 0;
  let deviation_penalty_component = 0;
  let movement_penalty_component = 0;

  const rows = [];

  for (const [id, cost] of Object.entries(objectiveCostVector || {})) {
    const value = toNumber(raw[id], 0);
    if (!isFiniteNumber(value) || Math.abs(value) <= 0.0000001) continue;

    const unitCost = toNumber(cost, 0);
    const contribution = round4(value * unitCost);

    let bucket = "other";
    if (ingredientIds.has(id)) {
      bucket = "ingredient";
      ingredient_cost_component += contribution;
    } else if (String(id).startsWith("dev_")) {
      bucket = "deviation_penalty";
      deviation_penalty_component += contribution;
    } else if (String(id).startsWith("move_")) {
      bucket = "movement_penalty";
      movement_penalty_component += contribution;
    }

    rows.push({
      id,
      bucket,
      variable_value: round4(value),
      unit_cost: unitCost,
      objective_contribution: contribution
    });
  }

  const total_objective_value = round4(
    ingredient_cost_component +
    deviation_penalty_component +
    movement_penalty_component
  );

  return {
    ingredient_cost_component: round4(ingredient_cost_component),
    deviation_penalty_component: round4(deviation_penalty_component),
    movement_penalty_component: round4(movement_penalty_component),
    total_objective_value,
    rows: rows.sort((a, b) => b.objective_contribution - a.objective_contribution)
  };
}

function buildPenaltyUsageDiagnostics({
  lpRawResult,
  objectiveCostVector
}) {
  const raw = lpRawResult || {};
  const rows = [];

  for (const [id, valueRaw] of Object.entries(raw)) {
    const value = toNumber(valueRaw, 0);
    if (!isFiniteNumber(value) || value <= 0.0000001) continue;

    if (!String(id).startsWith("dev_") && !String(id).startsWith("move_")) continue;

    const penalty = toNumber(objectiveCostVector?.[id], 0);
    const objective_contribution = round4(value * penalty);

    rows.push({
      id,
      category: String(id).startsWith("dev_") ? "deviation" : "movement",
      variable_value: round4(value),
      penalty,
      objective_contribution
    });
  }

  const deviation_rows = rows.filter(x => x.category === "deviation");
  const movement_rows = rows.filter(x => x.category === "movement");

  return {
    active_penalty_variables_count: rows.length,
    active_deviation_variables_count: deviation_rows.length,
    active_movement_variables_count: movement_rows.length,
    deviation_rows: deviation_rows.sort((a, b) => b.objective_contribution - a.objective_contribution),
    movement_rows: movement_rows.sort((a, b) => b.objective_contribution - a.objective_contribution)
  };
}

function buildEconomicDriverSummary({
  bindingConstraints,
  ingredientBoundStatus,
  inclusionDelta,
  objectiveBreakdownResult,
  penaltyUsage
}) {
  const top_binding_nutrients = (bindingConstraints || [])
    .slice(0, 10)
    .map(x => ({
      nutrient: x.nutrient,
      actual: x.actual,
      min: x.min,
      target: x.target,
      max: x.max,
      slack_to_min: x.slack_to_min,
      slack_to_max: x.slack_to_max,
      distance_to_target: x.distance_to_target
    }));

  const ingredients_at_max = (ingredientBoundStatus || [])
    .filter(x => x.at_max)
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, 10)
    .map(x => ({
      id: x.id,
      inclusion: x.inclusion,
      max: x.max,
      slack_to_max: x.slack_to_max
    }));

  const ingredients_at_min = (ingredientBoundStatus || [])
    .filter(x => x.at_min)
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, 10)
    .map(x => ({
      id: x.id,
      inclusion: x.inclusion,
      min: x.min,
      slack_to_min: x.slack_to_min
    }));

  const top_moved_ingredients = (inclusionDelta || [])
    .filter(x => x.direction !== "same")
    .slice(0, 10);

  const top_objective_contributors = (objectiveBreakdownResult?.rows || [])
    .slice(0, 15);

  const top_penalty_drivers = [
    ...((penaltyUsage?.deviation_rows || []).slice(0, 10)),
    ...((penaltyUsage?.movement_rows || []).slice(0, 10))
  ].sort((a, b) => b.objective_contribution - a.objective_contribution).slice(0, 10);

  return {
    top_binding_nutrients,
    ingredients_at_max,
    ingredients_at_min,
    top_moved_ingredients,
    top_objective_contributors,
    top_penalty_drivers
  };
}

function buildObjectiveBreakdownPerTon(objectiveBreakdownResult, formulaBasis) {
  const basis = toNumber(formulaBasis, 100);
  const safeBasis = basis > 0 ? basis : 100;

  const ingredientRaw = toNumber(objectiveBreakdownResult?.ingredient_cost_component, 0);
  const deviationRaw = toNumber(objectiveBreakdownResult?.deviation_penalty_component, 0);
  const movementRaw = toNumber(objectiveBreakdownResult?.movement_penalty_component, 0);
  const totalRaw = toNumber(objectiveBreakdownResult?.total_objective_value, 0);

  return {
    basis: safeBasis,
    ingredient_cost_component_per_ton: round4(ingredientRaw / safeBasis),
    deviation_penalty_component_per_ton: round4(deviationRaw / safeBasis),
    movement_penalty_component_per_ton: round4(movementRaw / safeBasis),
    total_objective_value_per_ton: round4(totalRaw / safeBasis)
  };
}

function buildIngredientMovementReasonEngine({
  inclusionDelta,
  ingredientBoundStatus,
  bindingConstraints,
  penaltyUsage,
  nutrientSlack
}) {
  const atMaxSet = new Set(
    (ingredientBoundStatus || []).filter(x => x.at_max).map(x => x.id)
  );

  const atMinSet = new Set(
    (ingredientBoundStatus || []).filter(x => x.at_min).map(x => x.id)
  );

  const topBinding = (bindingConstraints || []).map(x => x.nutrient);
  const activePenaltyIds = new Set(
    ((penaltyUsage?.movement_rows || []).map(x => x.id))
  );

  function inferReason(row) {
    const reasons = [];
    const id = row.id || "";
    const idNorm = normalizeKey(id);
    const delta = toNumber(row.delta_inclusion, 0);

    if (delta > 0) {
      if (["sbm_48", "soybean_meal_48_cp", "soybean_meal"].includes(idNorm)) {
        reasons.push("protein_or_amino_acid_support");
      }
      if (["l_lys_hcl"].includes(idNorm)) reasons.push("lysine_support");
      if (["dl_met"].includes(idNorm)) reasons.push("methionine_support");
      if (["l_thr"].includes(idNorm)) reasons.push("threonine_support");
      if (["dcp"].includes(idNorm)) reasons.push("available_phosphorus_or_calcium_support");
      if (["limestone"].includes(idNorm)) reasons.push("calcium_support");
      if (["salt", "sodium_bicarbonate"].includes(idNorm)) reasons.push("sodium_or_chloride_support");
      if (["corn"].includes(idNorm)) reasons.push("energy_or_least_cost_balance");
      if (["oil"].includes(idNorm)) reasons.push("energy_density_support");
    }

    if (delta < 0) {
      if (["oil"].includes(idNorm)) reasons.push("reduced_high_cost_energy");
      if (["salt"].includes(idNorm)) reasons.push("electrolyte_rebalance");
      if (["limestone"].includes(idNorm)) reasons.push("calcium_rebalance");
    }

    if (atMaxSet.has(id)) reasons.push("hit_max_inclusion");
    if (atMinSet.has(id)) reasons.push("hit_min_inclusion");

    const moveUpId = `move_up__${idNorm}`;
    const moveDownId = `move_down__${idNorm}`;
    if (activePenaltyIds.has(moveUpId) || activePenaltyIds.has(moveDownId)) {
      reasons.push("movement_penalty_active");
    }

    if (topBinding.includes("cp") || topBinding.includes("sid_lys") || topBinding.includes("sid_metcys") || topBinding.includes("sid_thr")) {
      if (delta > 0 && ["sbm_48", "l_lys_hcl", "dl_met", "l_thr"].includes(idNorm)) {
        reasons.push("binding_amino_acid_or_protein_constraint");
      }
    }

    if (topBinding.includes("avp") || topBinding.includes("ca")) {
      if (delta > 0 && ["dcp", "limestone"].includes(idNorm)) {
        reasons.push("binding_mineral_constraint");
      }
    }

    if (topBinding.includes("na") || topBinding.includes("cl")) {
      if (["salt", "sodium_bicarbonate"].includes(idNorm)) {
        reasons.push("binding_electrolyte_constraint");
      }
    }

    if (topBinding.includes("me")) {
      if (["corn", "oil"].includes(idNorm)) {
        reasons.push("energy_constraint_pressure");
      }
    }

    return [...new Set(reasons)];
  }

  return {
    rows: (inclusionDelta || [])
      .filter(x => x.direction !== "same")
      .map(row => ({
        id: row.id,
        display_name: row.display_name,
        start_inclusion: row.start_inclusion,
        optimized_inclusion: row.optimized_inclusion,
        delta_inclusion: row.delta_inclusion,
        direction: row.direction,
        inferred_reasons: inferReason(row)
      }))
      .sort((a, b) => Math.abs(b.delta_inclusion) - Math.abs(a.delta_inclusion))
  };
}

function buildEconomicPressureSummary({
  objectiveBreakdownPerTon,
  penaltyUsage,
  economicDriverSummary,
  bindingConstraints,
  ingredientBoundStatus
}) {
  const ingredient_cost_per_ton = toNumber(objectiveBreakdownPerTon?.ingredient_cost_component_per_ton, 0);
  const deviation_penalty_per_ton = toNumber(objectiveBreakdownPerTon?.deviation_penalty_component_per_ton, 0);
  const movement_penalty_per_ton = toNumber(objectiveBreakdownPerTon?.movement_penalty_component_per_ton, 0);
  const total_objective_per_ton = toNumber(objectiveBreakdownPerTon?.total_objective_value_per_ton, 0);

  const top_penalty_drivers = (economicDriverSummary?.top_penalty_drivers || []).slice(0, 5);
  const top_binding_nutrients = (economicDriverSummary?.top_binding_nutrients || []).slice(0, 5);
  const ingredients_at_max = (economicDriverSummary?.ingredients_at_max || []).slice(0, 5);
  const ingredients_at_min = (economicDriverSummary?.ingredients_at_min || []).slice(0, 5);
  const top_objective_contributors = (economicDriverSummary?.top_objective_contributors || []).slice(0, 5);

  let dominant_pressure = "ingredient_cost";
  if (deviation_penalty_per_ton >= movement_penalty_per_ton && deviation_penalty_per_ton > 0) {
    dominant_pressure = "deviation_penalty";
  } else if (movement_penalty_per_ton > deviation_penalty_per_ton && movement_penalty_per_ton > 0) {
    dominant_pressure = "movement_penalty";
  }

  return {
    ingredient_cost_per_ton,
    deviation_penalty_per_ton,
    movement_penalty_per_ton,
    total_objective_per_ton,
    dominant_pressure,
    active_deviation_variables_count: toNumber(penaltyUsage?.active_deviation_variables_count, 0),
    active_movement_variables_count: toNumber(penaltyUsage?.active_movement_variables_count, 0),
    top_penalty_drivers,
    top_binding_nutrients,
    ingredients_at_max,
    ingredients_at_min,
    top_objective_contributors
  };
}

function buildConstraintSensitivityCases(constraintsAll) {
  const cases = [];

  for (const c of constraintsAll || []) {
    const k = normalizeKey(c.key);

    let step = 0.01;
    if (["me", "amen", "ne"].includes(k)) step = 5;
    else if (["cp"].includes(k)) step = 0.1;
    else if (["ca", "avp"].includes(k)) step = 0.01;
    else if (["na", "cl"].includes(k)) step = 0.005;
    else if (k.startsWith("sid_") || k.startsWith("total_")) step = 0.01;

    if (isFiniteNumber(c.min)) {
      cases.push({
        nutrient: c.key,
        side: "min",
        direction: "tighten",
        delta: step,
        base_value: c.min,
        test_value: round4(c.min + step),
        hardness: c.hardness
      });
    }

    if (isFiniteNumber(c.max)) {
      cases.push({
        nutrient: c.key,
        side: "max",
        direction: "tighten",
        delta: step,
        base_value: c.max,
        test_value: round4(c.max - step),
        hardness: c.hardness
      });
    }
  }

  return cases;
}

function buildConstraintSensitivitySummary({
  baseObjectivePerTon,
  constraintSatisfaction,
  economicPressureSummary
}) {
  const baseObjective = toNumber(baseObjectivePerTon?.total_objective_value_per_ton, null);

  const candidate_constraints = (constraintSatisfaction || [])
    .filter(x => x.status === "OK" || x.status === "WARN")
    .map(x => ({
      nutrient: x.nutrient,
      min: x.min,
      max: x.max,
      actual: x.actual,
      hardness: x.hardness
    }));

  return {
    enabled: true,
    method: "finite_difference_preparation",
    base_objective_per_ton: baseObjective,
    dominant_pressure: economicPressureSummary?.dominant_pressure || null,
    candidate_constraints
  };
}

function buildSelectedSensitivityCases(constraintSensitivityCases) {
  const list = Array.isArray(constraintSensitivityCases) ? constraintSensitivityCases : [];
  const MAX = 80;
  return list.slice(0, MAX);
}

async function runSensitivityPerturbationPass({
  selectedCases,
  constraintsAll,
  context,
  ingredientVariableIds,
  ingredientsEnabled,
  nutrientMatrix,
  ingredientBoundsMap,
  basisConstraint,
  objectiveBuild
}) {
  const rows = [];

  for (const sCase of selectedCases || []) {
    const testConstraints = (constraintsAll || []).map(c => {
      if (normalizeKey(c.key) !== normalizeKey(sCase.nutrient)) return { ...c };
      return {
        ...c,
        min: sCase.side === "min" ? sCase.test_value : c.min,
        max: sCase.side === "max" ? sCase.test_value : c.max
      };
    });

    const testDeviationBuild = buildDeviationVariables({
      constraintsAll: testConstraints,
      nutrientMatrix,
      formulaBasis: context.formula_basis,
      penalties: context.penalties
    });

    const testSolverReadyConstraints = [
      ...testDeviationBuild.solver_rows
    ];

    const testObjectiveCostVector = {
      ...(objectiveBuild?.objective_cost_vector || {})
    };

    const testVariableBoundsMap = {
      ...ingredientBoundsMap,
      ...(testDeviationBuild.variable_bounds_map || {})
    };

    const testAllVariableIds = Array.from(new Set([
      ...(ingredientVariableIds || []),
      ...Object.keys(testDeviationBuild.variable_bounds_map || {})
    ]));

    const testJavascriptLpModel = buildJavascriptLpModel({
      allVariableIds: testAllVariableIds,
      objectiveCostVector: testObjectiveCostVector,
      variableBoundsMap: testVariableBoundsMap,
      basisConstraint,
      solverReadyConstraints: testSolverReadyConstraints
    });

    const solve = await solveWithJavascriptLp(testJavascriptLpModel);

    const lpExplicitlyInfeasible =
      solve?.result?.feasible === false ||
      solve?.result?.result === "Infeasible";

    const lpHasNumericObjective =
      isFiniteNumber(toNumber(solve?.result?.result, null));

    const lpHasDecisionValues =
      !!solve?.result &&
      (ingredientVariableIds || []).some(id => isFiniteNumber(toNumber(solve.result[id], null)));

    const feasible =
      !!solve?.ok &&
      !!solve?.result &&
      !lpExplicitlyInfeasible &&
      (lpHasNumericObjective || lpHasDecisionValues);

    let testObjectivePerTon = null;
    let testIngredientCostPerTon = null;

    if (feasible) {
      const rawObjective = toNumber(solve?.result?.result, null);
      if (isFiniteNumber(rawObjective) && isFiniteNumber(context.formula_basis) && context.formula_basis > 0) {
        testObjectivePerTon = round4(rawObjective / context.formula_basis);
      }

      testIngredientCostPerTon = calculateIngredientCostPerTonFromLpResult({
        lpRawResult: solve?.result,
        ingredientVariableIds,
        objectiveCostVector: objectiveBuild?.objective_cost_vector || {},
        formulaBasis: context.formula_basis
      });
    }

    rows.push({
      nutrient: sCase.nutrient,
      side: sCase.side,
      direction: sCase.direction,
      delta: sCase.delta,
      base_value: sCase.base_value,
      test_value: sCase.test_value,
      solve_status: feasible ? "optimal_or_feasible" : "failed_or_infeasible",
      test_objective_per_ton: testObjectivePerTon,
      test_ingredient_cost_per_ton: testIngredientCostPerTon
    });
  }

  return { rows };
}

function calculateIngredientCostPerTonFromLpResult({
  lpRawResult,
  ingredientVariableIds,
  objectiveCostVector,
  formulaBasis
}) {
  const raw = lpRawResult || {};
  const basis = toNumber(formulaBasis, 100);
  const safeBasis = basis > 0 ? basis : 100;

  let total = 0;

  for (const id of ingredientVariableIds || []) {
    const value = toNumber(raw[id], 0);
    const unitCost = toNumber(objectiveCostVector?.[id], 0);
    if (!isFiniteNumber(value) || !isFiniteNumber(unitCost)) continue;
    total += value * unitCost;
  }

  return round4(total / safeBasis);
}

function normalizeCostBasisName(basis) {
  const b = normalizeKey(basis || "per_metric_ton");

  if (["per_metric_ton", "metric_ton", "mt", "tonne"].includes(b)) return "per_metric_ton";
  if (["per_ton", "ton", "short_ton"].includes(b)) return "per_ton";
  if (["per_kg", "kg"].includes(b)) return "per_kg";
  if (["per_lb", "lb", "pound"].includes(b)) return "per_lb";

  return "per_metric_ton";
}

function normalizeCostBasisToMetricTon(costValue, costBasis) {
  const value = toNumber(costValue, null);
  if (!isFiniteNumber(value)) return null;

  const basis = normalizeCostBasisName(costBasis);

  if (basis === "per_metric_ton") return round4(value);
  if (basis === "per_ton") return round4(value * 1.10231131);
  if (basis === "per_kg") return round4(value * 1000);
  if (basis === "per_lb") return round4(value * 2204.62262);

  return round4(value);
}

function buildCostDisplayViews(costPerMetricTon, currency) {
  const v = toNumber(costPerMetricTon, null);
  if (!isFiniteNumber(v)) {
    return {
      currency: currency || "USD",
      per_metric_ton: null,
      per_ton: null,
      per_kg: null,
      per_lb: null
    };
  }

  return {
    currency: currency || "USD",
    per_metric_ton: round4(v),
    per_ton: round4(v / 1.10231131),
    per_kg: round4(v / 1000),
    per_lb: round4(v / 2204.62262)
  };
}

function normalizeIngredientCostInput(row) {
  const costValue = row?.cost ?? row?.cost_value ?? null;
  const costCurrency = row?.cost_currency || "USD";
  const costBasis = row?.cost_basis || "per_metric_ton";

  const normalizedCostPerMetricTon = normalizeCostBasisToMetricTon(costValue, costBasis);

  return {
    original_cost_value: toNumber(costValue, null),
    original_cost_currency: costCurrency,
    original_cost_basis: normalizeCostBasisName(costBasis),
    normalized_cost_per_metric_ton: normalizedCostPerMetricTon,
    display_costs: buildCostDisplayViews(normalizedCostPerMetricTon, costCurrency)
  };
}

function convertMetricTonCostToBasis(costPerMetricTon, basis) {
  const v = toNumber(costPerMetricTon, null);
  if (!isFiniteNumber(v)) return null;

  const b = normalizeCostBasisName(basis);

  if (b === "per_metric_ton") return round4(v);
  if (b === "per_ton") return round4(v / 1.10231131);
  if (b === "per_kg") return round4(v / 1000);
  if (b === "per_lb") return round4(v / 2204.62262);

  return round4(v);
}

function getPreferredDisplayCostBasis(body) {
  return normalizeCostBasisName(body?.display_cost_basis || "per_metric_ton");
}

function getPreferredDisplayCurrency(body, ingredientsEnabled) {
  const explicit = body?.display_currency;
  if (explicit) return String(explicit).toUpperCase();

  const currencies = Array.from(new Set(
    (ingredientsEnabled || [])
      .map(x => x?.cost_input?.original_cost_currency)
      .filter(Boolean)
      .map(x => String(x).toUpperCase())
  ));

  if (currencies.length === 1) return currencies[0];
  if (currencies.length === 0) return "USD";
  return "MULTI";
}

function buildPreferredCostDisplaySummary({
  preferredBasis,
  preferredCurrency,
  costSummary,
  objectiveBreakdownPerTon,
  ingredientsEnabled
}) {
  const ingredientCostMetricTon = toNumber(costSummary?.total_cost_per_ton, null);
  const objectiveMetricTon = toNumber(objectiveBreakdownPerTon?.total_objective_value_per_ton, null);
  const deviationMetricTon = toNumber(objectiveBreakdownPerTon?.deviation_penalty_component_per_ton, null);
  const movementMetricTon = toNumber(objectiveBreakdownPerTon?.movement_penalty_component_per_ton, null);

  return {
    preferred_display_basis: preferredBasis,
    preferred_display_currency: preferredCurrency,
    ingredient_cost_in_preferred_basis: convertMetricTonCostToBasis(ingredientCostMetricTon, preferredBasis),
    objective_cost_in_preferred_basis: convertMetricTonCostToBasis(objectiveMetricTon, preferredBasis),
    deviation_penalty_in_preferred_basis: convertMetricTonCostToBasis(deviationMetricTon, preferredBasis),
    movement_penalty_in_preferred_basis: convertMetricTonCostToBasis(movementMetricTon, preferredBasis),
    ingredient_items: (ingredientsEnabled || []).map(x => ({
      id: x.id,
      display_name: x.display_name,
      original_cost_value: x.cost_input?.original_cost_value ?? null,
      original_cost_currency: x.cost_input?.original_cost_currency ?? null,
      original_cost_basis: x.cost_input?.original_cost_basis ?? null,
      normalized_cost_per_metric_ton: x.cost_input?.normalized_cost_per_metric_ton ?? null,
      preferred_display_cost: convertMetricTonCostToBasis(
        x.cost_input?.normalized_cost_per_metric_ton,
        preferredBasis
      ),
      preferred_display_basis: preferredBasis,
      preferred_display_currency: x.cost_input?.original_cost_currency ?? preferredCurrency
    }))
  };
}

function buildDashboardSummaryBlock({
  status,
  solverStatus,
  formulaSummary,
  optimizationSummary
}) {
  return {
    status,
    solver_method: solverStatus?.method || null,
    termination: solverStatus?.termination || null,
    feasible: solverStatus?.feasible ?? null,
    total_inclusion: formulaSummary?.total_inclusion ?? null,
    normalized_to_basis: formulaSummary?.normalized_to_basis ?? null,
    nonzero_ingredient_count: formulaSummary?.nonzero_ingredient_count ?? null,
    top_binding_nutrients: optimizationSummary?.top_binding_nutrients || []
  };
}

function buildDashboardEconomicsBlock({
  costSummary,
  preferredCostDisplaySummary,
  objectiveBreakdownPerTon,
  economicPressureSummary
}) {
  return {
    ingredient_cost_per_metric_ton: costSummary?.total_cost_per_ton ?? null,
    ingredient_cost_in_preferred_basis: preferredCostDisplaySummary?.ingredient_cost_in_preferred_basis ?? null,
    preferred_display_basis: preferredCostDisplaySummary?.preferred_display_basis ?? null,
    preferred_display_currency: preferredCostDisplaySummary?.preferred_display_currency ?? null,
    objective_cost_per_metric_ton: objectiveBreakdownPerTon?.total_objective_value_per_ton ?? null,
    deviation_penalty_per_metric_ton: objectiveBreakdownPerTon?.deviation_penalty_component_per_ton ?? null,
    movement_penalty_per_metric_ton: objectiveBreakdownPerTon?.movement_penalty_component_per_ton ?? null,
    dominant_pressure: economicPressureSummary?.dominant_pressure ?? null,
    top_penalty_drivers: economicPressureSummary?.top_penalty_drivers || []
  };
}

function buildDashboardConstraintsBlock({
  constraintSatisfaction,
  bindingConstraints,
  economicPressureSummary
}) {
  return {
    rows: constraintSatisfaction || [],
    binding_constraints: bindingConstraints || [],
    top_binding_nutrients: economicPressureSummary?.top_binding_nutrients || []
  };
}

function buildDashboardMovementsBlock({
  inclusionDelta,
  ingredientMovementReasonEngine
}) {
  return {
    inclusion_delta: inclusionDelta || [],
    movement_reasons: ingredientMovementReasonEngine?.rows || []
  };
}

function buildDashboardSensitivityBlock({
  sensitivityPerturbationRows,
  constraintSensitivitySummary
}) {
  return {
    enabled: constraintSensitivitySummary?.enabled ?? false,
    method: constraintSensitivitySummary?.method ?? null,
    base_objective_per_ton: constraintSensitivitySummary?.base_objective_per_ton ?? null,
    rows: sensitivityPerturbationRows || []
  };
}

async function runOptimization(inputBody = {}) {
  const req = { body: inputBody };
  let captured = null;

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      captured = {
        ok: !(this.statusCode >= 400),
        http_status: this.statusCode || 200,
        payload
      };
      return captured;
    }
  };

  try {
      const startedAt = Date.now();
      const body = req.body || {};
      const errors = [];
  
      const context = {
        locale: body.locale || "US",
        species: body.species || null,
        type: body.type || null,
        production: body.production || null,
        breed: body.breed || null,
        phase: body.phase || null,
        region: body.region || "us",
        version: body.version || "v1",
        objective: body.objective || "least_cost",
        formula_basis: toNumber(body.formula_basis, 100),
        cp_apply_mode: body.cp_apply_mode || "RECOMPUTE_SID_FROM_TOTAL",
        display_cost_basis: getPreferredDisplayCostBasis(body),
        display_currency: body?.display_currency || null,
        penalties: {
          nutrient_low: toNumber(body?.penalties?.nutrient_low, 10000),
          nutrient_high: toNumber(body?.penalties?.nutrient_high, 10000),
          nutrient_target: toNumber(body?.penalties?.nutrient_target, 1000),
          movement: toNumber(body?.penalties?.movement, 1)
        }
      };
  
      if (!Array.isArray(body.ingredient_pool) || body.ingredient_pool.length === 0) {
        errors.push("ingredient_pool is required and must be a non-empty array");
      }
  
      if (!Array.isArray(body.nutrient_constraints) || body.nutrient_constraints.length === 0) {
        errors.push("nutrient_constraints is required and must be a non-empty array");
      }
  
      const normalizedIngredients = Array.isArray(body.ingredient_pool)
        ? body.ingredient_pool.map(validateIngredient)
        : [];
  
      const normalizedConstraints = Array.isArray(body.nutrient_constraints)
        ? body.nutrient_constraints.map(validateConstraint)
        : [];
  
      for (const item of normalizedIngredients) {
        errors.push(...item.errors);
      }
      for (const item of normalizedConstraints) {
        errors.push(...item.errors);
      }
  
      const ingredientsAll = normalizedIngredients.map(x => x.normalized);
      let ingredientsEnabled = ingredientsAll.filter(x => x.enabled);
      const constraintsAll = normalizedConstraints.map(x => x.normalized);
  
      if (ingredientsEnabled.length === 0) {
        errors.push("No enabled ingredients available for optimization");
      }
  
      if (!isFiniteNumber(context.formula_basis) || context.formula_basis <= 0) {
        errors.push("formula_basis must be a positive number");
      }
  
      if (context.objective !== "least_cost") {
        errors.push(`Unsupported objective '${context.objective}'. Current supported objective: least_cost`);
      }
  
      if (errors.length > 0) {
  return {
    ok: false,
    http_status: 400,
    payload: {
      status: "error",
      message: "Optimizer request validation failed",
      errors,
      meta: {
        engine: "AgroCore",
        module: "optimizer_v1",
        stage: "request_validation",
        timestamp_utc: new Date().toISOString()
      }
    }
  };
}
  
      const practicalControlResult = applyPracticalControlsToIngredients(ingredientsEnabled, body);
      ingredientsEnabled = practicalControlResult.adjustedIngredients;
      const practicalControls = practicalControlResult.practicalControls;
  
      const totalMin = round4(sumBy(ingredientsEnabled, x => x.min));
      const totalMax = round4(sumBy(ingredientsEnabled, x => x.max));
  
      const basisFeasibilityNotes = [];
      if (totalMin > context.formula_basis) {
        basisFeasibilityNotes.push(
          `Sum of ingredient minimums (${totalMin}) exceeds formula basis (${context.formula_basis})`
        );
      }
      if (totalMax < context.formula_basis) {
        basisFeasibilityNotes.push(
          `Sum of ingredient maximums (${totalMax}) is below formula basis (${context.formula_basis})`
        );
      }
  
      const loaderResult = loadIngredientDbForContext(context);
      const ingredientDb = loaderResult.db || {};
      const requestedNutrientKeys = constraintsAll.map(x => x.key);
  
      const ingredientResolutionItems = [];
      const nutrientCoefficientsUsed = [];
      const missingNutrientCoefficientItems = [];
  
      for (const ing of ingredientsEnabled) {
        console.log(`[optimize-debug] ing=${ing.id} display=${ing.display_name} profile_override_keys=${JSON.stringify(Object.keys(ing?.profile_override?.nutrient_profile||{}))}`);
        // PRIORITY 1: user's nutrient profile (FACT DB / custom DB).
        // If the frontend sent profile_override.nutrient_profile with data,
        // use it directly — no backend DB lookup needed. This means any ingredient
        // name or code works regardless of what the backend reference DB contains.
        const userProfile =
          ing?.profile_override?.nutrient_profile &&
          typeof ing.profile_override.nutrient_profile === "object" &&
          Object.keys(ing.profile_override.nutrient_profile).length > 0
            ? ing.profile_override.nutrient_profile
            : null;

        if (userProfile) {
          ingredientResolutionItems.push({
            requested_id: ing.id,
            requested_display_name: ing.display_name,
            resolved: true,
            db_key: null,
            db_display_name: null,
            resolution_method: "user_profile"
          });

          const coeffs = {};
          const overrideKeysApplied = [];
          for (const nutrientKey of requestedNutrientKeys) {
            const normalizedNutrientKey = normalizeKey(nutrientKey);
            let value = null;
            if (Object.prototype.hasOwnProperty.call(userProfile, nutrientKey)) {
              value = toNumber(userProfile[nutrientKey], null);
            }
            if (!isFiniteNumber(value) && Object.prototype.hasOwnProperty.call(userProfile, normalizedNutrientKey)) {
              value = toNumber(userProfile[normalizedNutrientKey], null);
            }
            if (isFiniteNumber(value)) {
              coeffs[nutrientKey] = value;
              overrideKeysApplied.push(normalizedNutrientKey);
            }
          }

          nutrientCoefficientsUsed.push({
            requested_id: ing.id,
            requested_display_name: ing.display_name,
            resolved: true,
            db_key: null,
            coefficients: coeffs,
            override_keys_applied: [...new Set(overrideKeysApplied)]
          });
          continue;
        }

        // PRIORITY 2: backend reference DB lookup (fallback for ingredients
        // that have no user-supplied nutrient profile).
        const resolved = resolveIngredientRecord(ingredientDb, ing.id, ing.display_name);

        if (!resolved) {
          ingredientResolutionItems.push({
            requested_id: ing.id,
            requested_display_name: ing.display_name,
            resolved: false,
            db_key: null,
            db_display_name: null,
            resolution_method: null
          });

          nutrientCoefficientsUsed.push({
            requested_id: ing.id,
            requested_display_name: ing.display_name,
            resolved: false,
            db_key: null,
            coefficients: {}
          });

          for (const nutrientKey of requestedNutrientKeys) {
            missingNutrientCoefficientItems.push({
              ingredient_id: ing.id,
              nutrient_key: nutrientKey,
              reason: "ingredient_not_resolved"
            });
          }
          continue;
        }

        ingredientResolutionItems.push({
          requested_id: ing.id,
          requested_display_name: ing.display_name,
          resolved: true,
          db_key: resolved.db_key,
          db_display_name: resolved.row?.display_name || null,
          resolution_method: resolved.resolution_method || "matched"
        });

        const coeffs = {};
        const overrideKeysApplied = [];
        for (const nutrientKey of requestedNutrientKeys) {
          const normalizedNutrientKey = normalizeKey(nutrientKey);
          let value = getNutrientValueForKey(resolved.row, nutrientKey);

          // L-Arg fallback for SID Arg
          if (
            !isFiniteNumber(value) &&
            String(ing.id || "").trim().toLowerCase() === "l_arg" &&
            normalizedNutrientKey === "sid_arg"
          ) {
            const totalArg = getNutrientValueForKey(resolved.row, "total_arg");
            if (isFiniteNumber(totalArg)) {
              value = round4(Number(totalArg) * 0.93);
            }
          }

          if (isFiniteNumber(value)) {
            coeffs[nutrientKey] = value;
          } else {
            const idNorm = String(ing.id || "").trim().toLowerCase();
            const categoryNorm = String(
              resolved?.row?.category || ing.category || ""
            ).trim().toLowerCase();

            const isSyntheticAA =
              idNorm === "l_arg" ||
              idNorm === "l_lys_hcl" ||
              idNorm === "dl_met" ||
              idNorm === "l_thr" ||
              idNorm === "l_trp" ||
              idNorm === "l_val" ||
              idNorm === "l_ile" ||
              categoryNorm === "synthetic_aa";

            if (isSyntheticAA) {
              coeffs[nutrientKey] = 0;
            } else {
              missingNutrientCoefficientItems.push({
                ingredient_id: ing.id,
                db_key: resolved.db_key,
                nutrient_key: nutrientKey,
                reason: "nutrient_missing"
              });
            }
          }
        }

        nutrientCoefficientsUsed.push({
          requested_id: ing.id,
          requested_display_name: ing.display_name,
          resolved: true,
          db_key: resolved.db_key,
          coefficients: coeffs,
          override_keys_applied: [...new Set(overrideKeysApplied)]
        });

      } // closes for (const ing of ingredientsEnabled)

const matrixCellsExpected = ingredientsEnabled.length * requestedNutrientKeys.length;
      const matrixCellsWithValues = nutrientCoefficientsUsed.reduce(
        (s, row) => s + Object.keys(row.coefficients || {}).length,
        0
      );
      const matrixCellsMissing = Math.max(0, matrixCellsExpected - matrixCellsWithValues);
  
      const ingredientVariableIds = ingredientsEnabled.map(x => x.id);
  
      const ingredientCostVector = {};
      ingredientsEnabled.forEach(ing => {
        ingredientCostVector[ing.id] = ing.cost;
      });
  
      const nutrientMatrix = {};
      for (const nutrientKey of requestedNutrientKeys) {
        nutrientMatrix[nutrientKey] = {};
        nutrientCoefficientsUsed.forEach(row => {
          const ingId = row.requested_id;
          const coeff = row.coefficients?.[nutrientKey];
          nutrientMatrix[nutrientKey][ingId] = isFiniteNumber(coeff) ? coeff : 0;
        });
      }
  
      const ingredientBoundsMap = {};
      ingredientsEnabled.forEach(ing => {
        ingredientBoundsMap[ing.id] = {
          min: ing.min,
          max: ing.max
        };
      });
  
      const basisConstraint = {
        type: "equality",
        coefficients: ingredientVariableIds.reduce((acc, id) => {
          acc[id] = 1;
          return acc;
        }, {}),
        rhs: context.formula_basis
      };
  
      const nutrientConstraintRows = constraintsAll.map(c => ({
        nutrient: c.key,
        coefficients: nutrientMatrix[c.key] || {},
        min: c.min ?? null,
        max: c.max ?? null,
        target: c.target ?? null,
        hardness: c.hardness,
        penalty_low: c.penalty_low ?? null,
        penalty_high: c.penalty_high ?? null,
        penalty_target: c.penalty_target ?? null
      }));
  
      const deviationBuild = buildDeviationVariables({
        constraintsAll,
        nutrientMatrix,
        formulaBasis: context.formula_basis,
        penalties: context.penalties
      });
  
      const movementBuild = buildMovementVariables({
        ingredientsEnabled,
        startingFormula: body.starting_formula,
        penalties: context.penalties
      });
  
      const objectiveBuild = buildObjectiveFunction({
        ingredientIds: ingredientVariableIds,
        ingredientCostVector,
        deviationBuild,
        movementBuild
      });
  
      const variableBoundsMap = {
        ...ingredientBoundsMap,
        ...objectiveBuild.extra_variable_bounds_map
      };
  
      const solverReadyConstraints = [
        ...deviationBuild.solver_rows,
        ...movementBuild.solver_rows
      ];
  
      const optimizerLpModel = {
        variables: objectiveBuild.all_variable_ids,
        objective: {
          type: "minimize_cost_plus_penalties",
          cost_vector: objectiveBuild.objective_cost_vector
        },
        ingredient_bounds: ingredientBoundsMap,
        extra_variable_bounds: objectiveBuild.extra_variable_bounds_map,
        basis_constraint: basisConstraint,
        nutrient_constraints: nutrientConstraintRows,
        deviation_variables: deviationBuild.diagnostics,
        movement_variables: movementBuild.diagnostics,
        objective_breakdown: objectiveBuild.objective_breakdown
      };
  
      const javascriptLpModel = buildJavascriptLpModel({
        allVariableIds: objectiveBuild.all_variable_ids,
        objectiveCostVector: objectiveBuild.objective_cost_vector,
        variableBoundsMap,
        basisConstraint,
        solverReadyConstraints
      });
  
      const lpSolveAttempt =
        basisFeasibilityNotes.length === 0
          ? await solveWithJavascriptLp(javascriptLpModel)
          : {
              ok: false,
              status: "precheck_failed",
              message: "Basis feasibility precheck failed before LP solve.",
              result: null
            };
  
      let optimizedFormula = [];
      let totalInclusion = 0;
      let totalCostPerTon = 0;
      let solveDiagnostics = {
        at_min: [],
        at_max: [],
        excluded: [],
        remaining_gap: 0
      };
  
      let nutrientResults = {};
      let constraintSatisfaction = [];
      let finalSolveMode = "basis_only_fallback";
      let lpObjectiveValue = null;
      let lpRawResult = lpSolveAttempt.result || null;
  
      const lpHasNumericObjective =
        isFiniteNumber(toNumber(lpSolveAttempt?.result?.result, null));
  
      const lpExplicitlyInfeasible =
        lpSolveAttempt?.result?.feasible === false ||
        lpSolveAttempt?.result?.result === "Infeasible";
  
      const lpHasDecisionValues =
        !!lpSolveAttempt?.result &&
        ingredientVariableIds.some(id =>
          isFiniteNumber(toNumber(lpSolveAttempt.result[id], null))
        );
  
      const lpFeasible =
        !!lpSolveAttempt.ok &&
        !!lpSolveAttempt.result &&
        !lpExplicitlyInfeasible &&
        (lpHasNumericObjective || lpHasDecisionValues);
  
      if (lpFeasible) {
        const lpFormula = buildOptimizedFormulaFromLpResult(
          ingredientVariableIds,
          ingredientsEnabled,
          lpSolveAttempt.result,
          context.formula_basis
        );
  
        const lpTotalInclusion = round4(sumBy(lpFormula, x => x.inclusion));
        const lpRemainingGap = round4(Math.max(0, context.formula_basis - lpTotalInclusion));
        const lpTotalCost = round4(sumBy(lpFormula, x => x.cost_contribution));
  
        optimizedFormula = lpFormula;
        totalInclusion = lpTotalInclusion;
        totalCostPerTon = lpTotalCost;
  
        solveDiagnostics = {
          at_min: ingredientsEnabled
            .filter(ing => {
              const row = lpFormula.find(x => x.id === ing.id);
              const inclusion = row ? row.inclusion : 0;
              return Math.abs(inclusion - ing.min) <= 0.0001;
            })
            .map(x => x.id),
  
          at_max: ingredientsEnabled
            .filter(ing => {
              const row = lpFormula.find(x => x.id === ing.id);
              const inclusion = row ? row.inclusion : 0;
              return Math.abs(inclusion - ing.max) <= 0.0001;
            })
            .map(x => x.id),
  
          excluded: ingredientsEnabled
            .filter(ing => {
              const row = lpFormula.find(x => x.id === ing.id);
              const inclusion = row ? row.inclusion : 0;
              return inclusion <= 0.0001;
            })
            .map(x => x.id),
  
          remaining_gap: lpRemainingGap
        };
  
        if (lpRemainingGap > 0.0001) {
          basisFeasibilityNotes.push(
            `LP solve returned formula with remaining inclusion gap: ${lpRemainingGap}`
          );
        }
  
        nutrientResults = calculateNutrientResultsFromFormula(
          optimizedFormula,
          nutrientMatrix,
          context.formula_basis
        );
  
        constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);
        finalSolveMode = "true_lp_with_penalties";
        lpObjectiveValue = toNumber(lpSolveAttempt.result?.result, null);
      } else {
        feasible = false;
        optimizedFormula = [];
        totalInclusion = 0;
        totalCostPerTon = null;

        solveDiagnostics = {
          at_min: [],
          at_max: [],
          excluded: [],
          remaining_gap: null,
          reason: "LP_INFEASIBLE_NO_GREEDY_FALLBACK",
          notes: basisFeasibilityNotes || [],
          lp_status: lpSolveAttempt?.status || null
        };

        nutrientResults = {};
        constraintSatisfaction = [];
        finalSolveMode = "lp_infeasible_no_fallback";
        lpObjectiveValue = null;
  
        solveDiagnostics = {
          at_min: basisSolve.atMin,
          at_max: basisSolve.atMax,
          excluded: basisSolve.excluded,
          remaining_gap: basisSolve.remainingGap
        };
  
        if (basisSolve.remainingGap > 0.0001) {
          basisFeasibilityNotes.push(
            `Unable to fill formula basis. Remaining inclusion gap: ${basisSolve.remainingGap}`
          );
        }
  
        nutrientResults = calculateNutrientResultsFromFormula(
          optimizedFormula,
          nutrientMatrix,
          context.formula_basis
        );
  
        constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);
      }
  
      const hardFailures = constraintSatisfaction.filter(
        x => normalizeKey(x.hardness || "hard") !== "soft" && x.status === "FAIL"
      );
  
      const feasible =
        basisFeasibilityNotes.length === 0 &&
        hardFailures.length === 0;
  
      const solveTimeMs = Date.now() - startedAt;
  
      const costSummary = {
        total_cost_per_ton: totalCostPerTon,
        currency: "USD",
        cost_basis: "per_metric_ton"
      };
  
      const startingFormulaComparison = buildStartingFormulaComparison(
        body.starting_formula,
        optimizedFormula,
        ingredientsEnabled
      );
  
      const inclusionDelta = buildInclusionDelta(startingFormulaComparison);
  
      const costDelta = buildCostDelta(
        body.starting_formula,
        optimizedFormula,
        ingredientsEnabled,
        context.formula_basis
      );
  
      const nutrientDelta = buildNutrientDelta(
        body.starting_formula,
        optimizedFormula,
        nutrientMatrix,
        constraintsAll,
        context.formula_basis
      );
  
      const bindingConstraints = buildBindingConstraints(constraintsAll, nutrientResults);
      const nutrientSlack = buildNutrientSlack(constraintsAll, nutrientResults);
      const ingredientBoundStatus = buildIngredientBoundStatus(ingredientsEnabled, optimizedFormula);
  
      const optimizationSummary = buildOptimizationSummary({
        optimizedFormula,
        costSummary,
        bindingConstraints,
        ingredientBoundStatus,
        inclusionDelta
      });
      const objectiveBreakdownResult = buildObjectiveBreakdownFromLpResult({
        lpRawResult,
        ingredientVariableIds,
        objectiveCostVector: objectiveBuild.objective_cost_vector,
        formulaBasis: context.formula_basis
      });
  
      const penaltyUsage = buildPenaltyUsageDiagnostics({
        lpRawResult,
        objectiveCostVector: objectiveBuild.objective_cost_vector
      });
  
      const economicDriverSummary = buildEconomicDriverSummary({
        bindingConstraints,
        ingredientBoundStatus,
        inclusionDelta,
        objectiveBreakdownResult,
        penaltyUsage
      });
      const objectiveBreakdownPerTon = buildObjectiveBreakdownPerTon(
        objectiveBreakdownResult,
        context.formula_basis
      );
  
      const ingredientMovementReasonEngine = buildIngredientMovementReasonEngine({
        inclusionDelta,
        ingredientBoundStatus,
        bindingConstraints,
        penaltyUsage,
        nutrientSlack
      });
      const economicPressureSummary = buildEconomicPressureSummary({
        objectiveBreakdownPerTon,
        penaltyUsage,
        economicDriverSummary,
        bindingConstraints,
        ingredientBoundStatus
      });
      const constraintSensitivityCases = buildConstraintSensitivityCases(constraintsAll);
  
      const constraintSensitivitySummary = buildConstraintSensitivitySummary({
        baseObjectivePerTon: objectiveBreakdownPerTon,
        constraintSatisfaction,
        economicPressureSummary
      });
      const selectedSensitivityCases = buildSelectedSensitivityCases(
        constraintSensitivityCases
      );
  
      const sensitivityPerturbationPass = await runSensitivityPerturbationPass({
        selectedCases: selectedSensitivityCases,
        constraintsAll,
        context,
        ingredientVariableIds,
        ingredientsEnabled,
        nutrientMatrix,
        ingredientBoundsMap,
        basisConstraint,
        objectiveBuild
      });
  
                      const sensitivityPerturbationRows = (sensitivityPerturbationPass?.rows || []).map(row => {
        const baseObjectivePerTon = toNumber(objectiveBreakdownPerTon?.total_objective_value_per_ton, null);
        const testObjectivePerTon = toNumber(row.test_objective_per_ton, null);
        const deltaObjectivePerTon =
          isFiniteNumber(baseObjectivePerTon) && isFiniteNumber(testObjectivePerTon)
            ? round4(testObjectivePerTon - baseObjectivePerTon)
            : null;
  
        const marginalCostEstimate =
          isFiniteNumber(deltaObjectivePerTon) && isFiniteNumber(row.delta) && row.delta !== 0
            ? round4(deltaObjectivePerTon / row.delta)
            : null;
  
        const baseIngredientCostPerTon = toNumber(costSummary?.total_cost_per_ton, null);
        const testIngredientCostPerTon = toNumber(row.test_ingredient_cost_per_ton, null);
        const ingredientCostDeltaPerTon =
          isFiniteNumber(baseIngredientCostPerTon) && isFiniteNumber(testIngredientCostPerTon)
            ? round4(testIngredientCostPerTon - baseIngredientCostPerTon)
            : null;
  
        const ingredientMarginalCostEstimate =
          isFiniteNumber(ingredientCostDeltaPerTon) && isFiniteNumber(row.delta) && row.delta !== 0
            ? round4(ingredientCostDeltaPerTon / row.delta)
            : null;
  
        return {
          ...row,
          base_objective_per_ton: baseObjectivePerTon,
          delta_objective_per_ton: deltaObjectivePerTon,
          marginal_cost_estimate: marginalCostEstimate,
          base_ingredient_cost_per_ton: baseIngredientCostPerTon,
          test_ingredient_cost_per_ton: testIngredientCostPerTon,
          ingredient_cost_delta_per_ton: ingredientCostDeltaPerTon,
          ingredient_marginal_cost_estimate: ingredientMarginalCostEstimate
        };
      });
      const preferredDisplayCurrency = getPreferredDisplayCurrency(body, ingredientsEnabled);
  
      const preferredCostDisplaySummary = buildPreferredCostDisplaySummary({
        preferredBasis: context.display_cost_basis,
        preferredCurrency: preferredDisplayCurrency,
        costSummary,
        objectiveBreakdownPerTon,
        ingredientsEnabled
      });
  
  
      const solverStatus = {
  termination:
    finalSolveMode === "true_lp_with_penalties"
      ? (feasible ? "lp_optimal_or_feasible" : "lp_infeasible_or_failed")
      : finalSolveMode === "lp_infeasible_no_fallback"
      ? "lp_infeasible_no_fallback"
      : (feasible ? "basis_only_greedy" : "basis_only_infeasible"),
  feasible,
  infeasible: !feasible,
  method:
    finalSolveMode === "true_lp_with_penalties"
      ? "javascript_lp_solver"
      : finalSolveMode === "lp_infeasible_no_fallback"
      ? "none"
      : "greedy_least_cost_basis_fill",
  solve_time_ms: solveTimeMs
};
  
      const infeasibilityDiagnostics = buildInfeasibilityDiagnostics({
        basisFeasibilityNotes,
        constraintSatisfaction,
        solverStatus,
        lpSolveAttempt
      });
      const dashboardSummary = buildDashboardSummaryBlock({
        status: feasible ? "optimal" : "infeasible",
        solverStatus,
        formulaSummary: {
          total_inclusion: totalInclusion,
          normalized_to_basis: Math.abs(totalInclusion - context.formula_basis) <= 0.0001,
          nonzero_ingredient_count: optimizedFormula.length
        },
        optimizationSummary
      });
  
      const dashboardEconomics = buildDashboardEconomicsBlock({
        costSummary,
        preferredCostDisplaySummary,
        objectiveBreakdownPerTon,
        economicPressureSummary
      });
  
      const dashboardConstraints = buildDashboardConstraintsBlock({
        constraintSatisfaction,
        bindingConstraints,
        economicPressureSummary
      });
  
      const dashboardMovements = buildDashboardMovementsBlock({
        inclusionDelta,
        ingredientMovementReasonEngine
      });
  
      const dashboardSensitivity = buildDashboardSensitivityBlock({
        sensitivityPerturbationRows,
        constraintSensitivitySummary
      });
  
  
      return res.json({
      status: feasible ? "optimal" : "infeasible",
      objective: context.objective,
      message:
        finalSolveMode === "true_lp_with_penalties"
          ? "True LP least-cost solution generated successfully with deviation and movement penalties."
          : lpSolveAttempt.status === "solver_not_available"
            ? "LP solver not available. Returned basis-only fallback solution."
            : lpSolveAttempt.status === "solver_runtime_error"
              ? "LP solver failed at runtime. Returned basis-only fallback solution."
              : feasible
                ? "Least-cost basis solution generated successfully. Nutrient coefficient extraction completed."
                : "Least-cost solution could not be generated.",

      context: {
        locale: context.locale,
        species: context.species,
        type: context.type,
        production: context.production,
        breed: context.breed,
        phase: context.phase,
        region: context.region,
        version: context.version,
        formula_basis: context.formula_basis,
        cp_apply_mode: context.cp_apply_mode,
        penalties: context.penalties
      },

      dashboard_summary: dashboardSummary,
      dashboard_economics: dashboardEconomics,
      dashboard_constraints: dashboardConstraints,
      dashboard_movements: dashboardMovements,
      dashboard_sensitivity: dashboardSensitivity,
      optimizer_input_summary: {
        ingredient_count_total: ingredientsAll.length,
        ingredient_count_enabled: ingredientsEnabled.length,
        nutrient_constraint_count: constraintsAll.length,
        total_min_inclusion_enabled: totalMin,
        total_max_inclusion_enabled: totalMax
      },

      optimizer_inputs_normalized: {
        ingredient_pool_enabled: clone(ingredientsEnabled),
        nutrient_constraints: clone(constraintsAll),
        locked_ingredients: Array.isArray(body.locked_ingredients) ? clone(body.locked_ingredients) : [],
        starting_formula: Array.isArray(body.starting_formula) ? clone(body.starting_formula) : []
      },

      ingredient_cost_normalization: {
        canonical_cost_unit: "per_metric_ton",
        currency_conversion_applied: false,
        items: ingredientsEnabled.map(x => ({
          id: x.id,
          display_name: x.display_name,
          original_cost_value: x.cost_input?.original_cost_value ?? null,
          original_cost_currency: x.cost_input?.original_cost_currency ?? null,
          original_cost_basis: x.cost_input?.original_cost_basis ?? null,
          normalized_cost_per_metric_ton: x.cost_input?.normalized_cost_per_metric_ton ?? null,
          display_costs: x.cost_input?.display_costs ?? null
        }))
      },
      cost_display_preferences: {
        requested_display_cost_basis: context.display_cost_basis,
        requested_display_currency: context.display_currency,
        effective_display_currency: preferredDisplayCurrency,
        currency_conversion_applied: false
      },
      preferred_cost_display_summary: preferredCostDisplaySummary,
      optimizer_model: {
        variable_ids: objectiveBuild.all_variable_ids,
        ingredient_variable_ids: ingredientVariableIds,
        objective: context.objective,
        basis_target: context.formula_basis,
        ingredient_bounds: ingredientsEnabled.map(x => ({
          id: x.id,
          min: x.min,
          max: x.max,
          cost: x.cost
        })),
        cost_vector: Object.entries(objectiveBuild.objective_cost_vector).map(([id, cost]) => ({
          id,
          cost
        })),
        nutrient_constraint_keys: requestedNutrientKeys,
        objective_breakdown: objectiveBuild.objective_breakdown
      },

      optimizer_lp_model: optimizerLpModel,
      solver_ready_constraints: solverReadyConstraints,
      javascript_lp_model: javascriptLpModel,

      lp_solver_attempt: {
        attempted: basisFeasibilityNotes.length === 0,
        solver_loaded: !!lpSolverModule,
        status: lpSolveAttempt.status,
        message: lpSolveAttempt.message,
        objective_value: lpObjectiveValue,
        solve_mode_used: finalSolveMode,
        raw_result: lpRawResult
      },

      practical_controls: practicalControls,

      deviation_variables: deviationBuild.diagnostics,
      movement_variables: movementBuild.diagnostics,

      ingredient_resolution: {
        loader_ok: loaderResult.ok,
        loader_error: loaderResult.error,
        loader_path: ingredientsLoaderPath,
        resolved_count: ingredientResolutionItems.filter(x => x.resolved).length,
        unresolved_count: ingredientResolutionItems.filter(x => !x.resolved).length,
        items: ingredientResolutionItems
      },

      nutrient_coefficients_used: nutrientCoefficientsUsed,

      missing_nutrient_coefficients: {
        count: missingNutrientCoefficientItems.length,
        items: missingNutrientCoefficientItems
      },

      optimizer_matrix_summary: {
        ingredients_enabled: ingredientsEnabled.length,
        nutrient_keys_requested: requestedNutrientKeys.length,
        matrix_cells_expected: matrixCellsExpected,
        matrix_cells_with_values: matrixCellsWithValues,
        matrix_cells_missing: matrixCellsMissing
      },

      nutrient_results: nutrientResults,
      constraint_satisfaction: constraintSatisfaction,

      starting_formula_comparison: startingFormulaComparison,
      inclusion_delta: inclusionDelta,
      cost_delta: costDelta,
      nutrient_delta: nutrientDelta,

      binding_constraints: bindingConstraints,
      nutrient_slack: nutrientSlack,
      ingredient_bound_status: ingredientBoundStatus,
      optimization_summary: optimizationSummary,
      objective_breakdown_result: objectiveBreakdownResult,
      penalty_usage: penaltyUsage,
      economic_driver_summary: economicDriverSummary,
      objective_breakdown_per_ton: objectiveBreakdownPerTon,
      ingredient_movement_reason_engine: ingredientMovementReasonEngine,
      economic_pressure_summary: economicPressureSummary,
      constraint_sensitivity_cases: constraintSensitivityCases,
      constraint_sensitivity_summary: constraintSensitivitySummary,
      selected_sensitivity_cases: selectedSensitivityCases,
      sensitivity_perturbation_rows: sensitivityPerturbationRows,
      infeasibility_diagnostics: infeasibilityDiagnostics,

      formula_summary: {
        basis_target: context.formula_basis,
        basis_precheck_passed: totalMin <= context.formula_basis && totalMax >= context.formula_basis,
        total_inclusion: totalInclusion,
        normalized_to_basis: Math.abs(totalInclusion - context.formula_basis) <= 0.01,
        nonzero_ingredient_count: optimizedFormula.length
      },

      cost_summary: {
        ...costSummary,
        preferred_display_basis: context.display_cost_basis,
        preferred_display_currency: preferredDisplayCurrency,
        total_cost_in_preferred_basis: preferredCostDisplaySummary?.ingredient_cost_in_preferred_basis ?? null
      },
      optimized_formula: optimizedFormula,

      constraint_diagnostics: {
        nutrient_constraints_loaded: constraintsAll.length,
        nutrient_constraints_applied:
          finalSolveMode === "true_lp_with_penalties" ? solverReadyConstraints.length : 0,
        hard_failures_count: hardFailures.length,
        soft_warnings_count: constraintSatisfaction.filter(x => x.status === "WARN").length,
        note:
          finalSolveMode === "true_lp_with_penalties"
            ? "Hard constraints were enforced; soft constraints and targets were handled using deviation penalties; movement penalties were also active when starting_formula was provided."
            : "Nutrient constraints loaded and coefficients extracted, but fallback solve was used."
      },

      ingredient_diagnostics: {
        at_min: solveDiagnostics.at_min,
        at_max: solveDiagnostics.at_max,
        excluded: solveDiagnostics.excluded,
        locked: Array.isArray(body.locked_ingredients) ? clone(body.locked_ingredients) : []
      },

      comparison_vs_input: {
        has_starting_formula: Array.isArray(body.starting_formula) && body.starting_formula.length > 0,
        note: "Comparison engine active for inclusion, nutrient, cost, and movement penalty diagnostics."
      },

      solver_status: solverStatus,
      feasibility_notes: basisFeasibilityNotes,

      meta: {
        engine: "AgroCore",
        module: "optimizer_v1",
        stage: finalSolveMode === "true_lp_with_penalties"
          ? "true_lp_solve_with_deviation_and_movement_penalties"
          : "basis_only_solve_plus_coefficient_extraction",
        optimizer_mode: finalSolveMode === "true_lp_with_penalties"
          ? "least_cost_true_lp_with_penalties"
          : "least_cost_basis_only",
        analyzer_postcheck_used: false,
        timestamp_utc: new Date().toISOString()
            }
    });
} catch (err) {
    return {
      ok: false,
      http_status: 500,
      payload: {
        status: "error",
        message: err?.message || "Optimizer service failed",
        meta: {
          engine: "AgroCore",
          module: "optimizer_v1",
          stage: "service_runtime_error",
          timestamp_utc: new Date().toISOString()
        }
      }
    };
  }
}

module.exports = {
  runOptimization
};
