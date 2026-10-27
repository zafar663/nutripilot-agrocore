const fs = require("fs");
const path = require("path");
const { runOptimization } = require("./optimize.service.cjs");

/**
 * NutriPilot Multimix Service
 * Enterprise file-backed baseline
 *
 * Supports:
 * - Formula Set + Cost Set + Ingredient Profile Set orchestration
 * - real optimizer execution through runOptimization()
 * - request controls (batch_name, stop_on_error, include_failed_cases, response_mode)
 * - in-memory scenario application to stored formulas
 * - normalization into optimizer request shape
 * - batch summary intelligence
 * - scenario metadata
 * - stronger error capture and auditability
 * - automatic scenario comparison output
 */

const DATA_ROOT = path.join(__dirname, "../../data");
const FORMULA_SETS_DIR = path.join(DATA_ROOT, "formula_sets");
const COST_SETS_DIR = path.join(DATA_ROOT, "cost_sets");
const INGREDIENT_PROFILE_SETS_DIR = path.join(DATA_ROOT, "ingredient_profile_sets");
const FORMULAS_DIR = path.join(DATA_ROOT, "formulas");

const COSTLY_SYNTHETIC_IDS = new Set([
  "dl_met",
  "l_lys_hcl",
  "l_thr",
  "l_trp",
  "val",
  "l_val",
  "ile",
  "l_ile"
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round4(v) {
  return Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function safeNowIso() {
  return new Date().toISOString();
}

function ensureDirExists(dirPath, label) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`${label} directory not found: ${dirPath}`);
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in file: ${filePath}. ${err.message}`);
  }
}

function buildFormulaSetPath(formulaSetId) {
  return path.join(FORMULA_SETS_DIR, `${formulaSetId}.json`);
}

function buildCostSetPath(costSetId) {
  return path.join(COST_SETS_DIR, `${costSetId}.json`);
}

function buildIngredientProfileSetPath(profileSetId) {
  return path.join(INGREDIENT_PROFILE_SETS_DIR, `${profileSetId}.json`);
}

function buildFormulaPath({ formulaId }) {
  return path.join(FORMULAS_DIR, `${formulaId}.json`);
}

function loadFormulaSet(formulaSetId) {
  return readJsonFile(buildFormulaSetPath(formulaSetId));
}

function loadCostSet(costSetId) {
  return readJsonFile(buildCostSetPath(costSetId));
}

function loadIngredientProfileSet(ingredientProfileSetId) {
  return readJsonFile(buildIngredientProfileSetPath(ingredientProfileSetId));
}

function loadStoredFormula(formulaSetItem) {
  const formulaId = formulaSetItem?.formula_id;

  if (!isNonEmptyString(formulaId)) {
    throw new Error("Formula Set item is missing formula_id.");
  }

  const filePath = buildFormulaPath({ formulaId });
  return readJsonFile(filePath);
}

function validateMultimixRequest(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new Error("Multimix payload must be an object.");
  }

  if (!isNonEmptyString(payload.formula_set_id)) {
    errors.push("formula_set_id is required.");
  }

  if (!isNonEmptyString(payload.cost_set_id)) {
    errors.push("cost_set_id is required.");
  }

  if (!isNonEmptyString(payload.ingredient_profile_set_id)) {
    errors.push("ingredient_profile_set_id is required.");
  }

  if (payload.batch_name != null && !isNonEmptyString(payload.batch_name)) {
    errors.push("batch_name must be a non-empty string when provided.");
  }

  if (payload.stop_on_error != null && typeof payload.stop_on_error !== "boolean") {
    errors.push("stop_on_error must be boolean when provided.");
  }

  if (payload.include_failed_cases != null && typeof payload.include_failed_cases !== "boolean") {
    errors.push("include_failed_cases must be boolean when provided.");
  }

  if (
    payload.response_mode != null &&
    !["full", "summary"].includes(String(payload.response_mode).toLowerCase())
  ) {
    errors.push('response_mode must be either "full" or "summary".');
  }

  if (errors.length > 0) {
    const err = new Error(`Invalid Multimix request: ${errors.join(" ")}`);
    err.code = "MULTIMIX_REQUEST_VALIDATION_FAILED";
    throw err;
  }
}

function validateMultimixComparisonRequest(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new Error("Multimix comparison payload must be an object.");
  }

  if (payload.comparison_name != null && !isNonEmptyString(payload.comparison_name)) {
    errors.push("comparison_name must be a non-empty string when provided.");
  }

  if (!isPlainObject(payload.baseline)) {
    errors.push("baseline object is required.");
  }

  if (!isPlainObject(payload.scenario)) {
    errors.push("scenario object is required.");
  }

  if (errors.length > 0) {
    const err = new Error(`Invalid Multimix comparison request: ${errors.join(" ")}`);
    err.code = "MULTIMIX_COMPARISON_REQUEST_VALIDATION_FAILED";
    throw err;
  }

  validateMultimixRequest(payload.baseline);
  validateMultimixRequest(payload.scenario);
}

function validateFormulaSet(formulaSet, formulaSetId) {
  const errors = [];

  if (!isPlainObject(formulaSet)) {
    errors.push(`Formula Set ${formulaSetId} must be an object.`);
  }

  if (!isNonEmptyString(formulaSet?.formula_set_id)) {
    errors.push(`Formula Set ${formulaSetId} is missing formula_set_id.`);
  }

  if (!Array.isArray(formulaSet?.items) || formulaSet.items.length === 0) {
    errors.push(`Formula Set ${formulaSetId} has no items.`);
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.code = "FORMULA_SET_INVALID";
    throw err;
  }
}

function validateCostSet(costSet, costSetId) {
  const errors = [];

  if (!isPlainObject(costSet)) {
    errors.push(`Cost Set ${costSetId} must be an object.`);
  }

  if (!isNonEmptyString(costSet?.cost_set_id)) {
    errors.push(`Cost Set ${costSetId} is missing cost_set_id.`);
  }

  if (!Array.isArray(costSet?.items)) {
    errors.push(`Cost Set ${costSetId} items must be an array.`);
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.code = "COST_SET_INVALID";
    throw err;
  }
}

function validateIngredientProfileSet(profileSet, profileSetId) {
  const errors = [];

  if (!isPlainObject(profileSet)) {
    errors.push(`Ingredient Profile Set ${profileSetId} must be an object.`);
  }

  if (!isNonEmptyString(profileSet?.ingredient_profile_set_id)) {
    errors.push(`Ingredient Profile Set ${profileSetId} is missing ingredient_profile_set_id.`);
  }

  if (!Array.isArray(profileSet?.items)) {
    errors.push(`Ingredient Profile Set ${profileSetId} items must be an array.`);
  }

  if (errors.length > 0) {
    const err = new Error(errors.join(" "));
    err.code = "INGREDIENT_PROFILE_SET_INVALID";
    throw err;
  }
}

function normalizeControls(payload) {
  const responseModeRaw = String(payload?.response_mode || "full").toLowerCase();

  return {
    batch_name: isNonEmptyString(payload?.batch_name) ? payload.batch_name.trim() : null,
    stop_on_error: payload?.stop_on_error === true,
    include_failed_cases: payload?.include_failed_cases !== false,
    response_mode: responseModeRaw === "summary" ? "summary" : "full"
  };
}

function indexCostSetItems(costSet) {
  const map = new Map();
  const items = asArray(costSet?.items);

  for (const item of items) {
    if (!isNonEmptyString(item?.ingredient_id)) continue;
    map.set(item.ingredient_id, item);
  }

  return map;
}

function indexIngredientProfileSetItems(profileSet) {
  const map = new Map();
  const items = asArray(profileSet?.items);

  for (const item of items) {
    if (!isNonEmptyString(item?.ingredient_id)) continue;
    map.set(item.ingredient_id, item);
  }

  return map;
}

function applyEnvironmentToFormula({
  formula,
  costSetIndex,
  ingredientProfileIndex
}) {
  const workingFormula = deepClone(formula);

  if (!Array.isArray(workingFormula.ingredients)) {
    workingFormula.ingredients = [];
  }

  for (const ingredient of workingFormula.ingredients) {
    const ingredientId = ingredient?.ingredient_id || ingredient?.id;

    if (!isNonEmptyString(ingredientId)) continue;

    const costItem = costSetIndex.get(ingredientId);
    if (costItem) {
      ingredient.cost = {
        original_cost_value: costItem.original_cost_value ?? null,
        original_cost_basis: costItem.original_cost_basis ?? null,
        original_cost_currency: costItem.original_cost_currency ?? null,
        normalized_cost_per_metric_ton: costItem.normalized_cost_per_metric_ton ?? null,
        pricing_type: costItem.pricing_type ?? null,
        supplier_id: costItem.supplier_id ?? null,
        supplier_name: costItem.supplier_name ?? null,
        source: costItem.source ?? null,
        last_updated: costItem.last_updated ?? null
      };
    }

    const profileItem = ingredientProfileIndex.get(ingredientId);
    if (profileItem) {
      ingredient.profile_override = {
        source: profileItem.source ?? null,
        method: profileItem.method ?? null,
        sample_code: profileItem.sample_code ?? null,
        sample_date: profileItem.sample_date ?? null,
        origin: profileItem.origin ?? null,
        supplier_id: profileItem.supplier_id ?? null,
        nutrient_profile: profileItem.nutrient_profile || {},
        digestibility_profile: profileItem.digestibility_profile || {},
        analysis_reference: profileItem.analysis_reference ?? null,
        last_modified: profileItem.last_modified ?? null,
        modified_by: profileItem.modified_by ?? null
      };
    }
  }

  return workingFormula;
}

function buildIngredientPoolFromStoredFormula(workingFormula) {
  const ingredients = asArray(workingFormula?.ingredients);

  return ingredients.map((item, index) => {
    const id = item?.ingredient_id || item?.id || `ingredient_${index + 1}`;
    const displayName = item?.display_name || item?.name || id;

    const min = toNumber(item?.min, 0);
    const max = toNumber(item?.max, 100);
    const enabled = item?.enabled !== false;

    const normalizedCostPerMetricTon =
      toNumber(item?.cost?.normalized_cost_per_metric_ton, null) ??
      toNumber(item?.cost?.cost_per_metric_ton, null) ??
      toNumber(item?.cost?.value, null) ??
      toNumber(item?.cost, null) ??
      0;

    const row = {
      id,
      display_name: displayName,
      min,
      max,
      cost: normalizedCostPerMetricTon,
      enabled
    };

    if (item?.cost && isPlainObject(item.cost)) {
      row.cost_value = item.cost.original_cost_value ?? null;
      row.cost_basis = item.cost.original_cost_basis ?? null;
      row.cost_currency = item.cost.original_cost_currency ?? null;
    }

    if (isPlainObject(item?.profile_override)) {
      row.profile_override = deepClone(item.profile_override);
    }

    return row;
  });
}

function buildNutrientConstraintsFromStoredFormula(workingFormula) {
  const constraints = asArray(workingFormula?.nutrient_constraints);

  return constraints.map((item) => ({
    key: item?.key,
    min: item?.min ?? null,
    target: item?.target ?? null,
    max: item?.max ?? null,
    hardness: item?.hardness || "hard",
    penalty_low: item?.penalty_low ?? null,
    penalty_high: item?.penalty_high ?? null,
    penalty_target: item?.penalty_target ?? null
  }));
}

function buildStartingFormulaFromStoredFormula(workingFormula) {
  const ingredients = asArray(workingFormula?.ingredients);

  return ingredients
    .map((item, index) => ({
      id: item?.ingredient_id || item?.id || `ingredient_${index + 1}`,
      inclusion: toNumber(item?.inclusion, null)
    }))
    .filter((x) => x.id && x.inclusion != null);
}

function extractFormulaContext(formulaSetItem, workingFormula) {
  return {
    locale: formulaSetItem?.locale || workingFormula?.locale || "US",
    species: formulaSetItem?.species || workingFormula?.species || null,
    type: formulaSetItem?.type || workingFormula?.type || null,
    production: formulaSetItem?.production || workingFormula?.production || null,
    breed: formulaSetItem?.breed || workingFormula?.breed || null,
    phase: formulaSetItem?.phase || workingFormula?.phase || null,
    region: formulaSetItem?.region || workingFormula?.region || "us",
    version: formulaSetItem?.version || workingFormula?.version || "v1",
    objective: formulaSetItem?.objective || workingFormula?.objective || "least_cost",
    formula_basis: toNumber(
      formulaSetItem?.formula_basis ?? workingFormula?.formula_basis,
      100
    ),
    cp_apply_mode:
      formulaSetItem?.cp_apply_mode ||
      workingFormula?.cp_apply_mode ||
      "RECOMPUTE_SID_FROM_TOTAL",
    display_cost_basis:
      formulaSetItem?.display_cost_basis ||
      workingFormula?.display_cost_basis ||
      null,
    display_currency:
      formulaSetItem?.display_currency ||
      workingFormula?.display_currency ||
      null
  };
}

function buildOptimizerPayload({
  formulaSetItem,
  workingFormula
}) {
  const context = extractFormulaContext(formulaSetItem, workingFormula);
  const ingredientPool = buildIngredientPoolFromStoredFormula(workingFormula);
  const nutrientConstraints = buildNutrientConstraintsFromStoredFormula(workingFormula);
  const startingFormula = buildStartingFormulaFromStoredFormula(workingFormula);

  if (ingredientPool.length === 0) {
    const err = new Error(
      `Stored formula ${formulaSetItem?.formula_id || "unknown"} has no ingredients to build optimizer payload.`
    );
    err.code = "FORMULA_INGREDIENT_POOL_EMPTY";
    throw err;
  }

  if (nutrientConstraints.length === 0) {
    const err = new Error(
      `Stored formula ${formulaSetItem?.formula_id || "unknown"} has no nutrient_constraints to build optimizer payload.`
    );
    err.code = "FORMULA_NUTRIENT_CONSTRAINTS_EMPTY";
    throw err;
  }

  const payload = {
    ...context,
    ingredient_pool: ingredientPool,
    nutrient_constraints: nutrientConstraints
  };

  if (startingFormula.length > 0) {
    payload.starting_formula = startingFormula;
  }

  if (isPlainObject(workingFormula?.penalties)) {
    payload.penalties = deepClone(workingFormula.penalties);
  }

  if (Array.isArray(workingFormula?.locked_ingredients)) {
    payload.locked_ingredients = deepClone(workingFormula.locked_ingredients);
  }

  if (Array.isArray(workingFormula?.excluded_ingredients)) {
    payload.excluded_ingredients = deepClone(workingFormula.excluded_ingredients);
  }

  if (isPlainObject(workingFormula?.practical_controls)) {
    Object.assign(payload, deepClone(workingFormula.practical_controls));
  }

  return payload;
}

function getResultStatus(payloadOrRow) {
  return String(
    payloadOrRow?.status ||
    payloadOrRow?.payload?.status ||
    ""
  ).toLowerCase();
}

function isFeasiblePayload(payload) {
  const status = getResultStatus(payload);
  if (status === "optimal") return true;
  if (payload?.dashboard_summary?.feasible === true) return true;
  return false;
}

function getCostAfterPerTon(payloadOrRow) {
  return toNumber(
    payloadOrRow?.cost_summary?.total_cost_per_ton ??
    payloadOrRow?.payload?.cost_summary?.total_cost_per_ton,
    null
  );
}

function getBindingNutrients(payload) {
  return asArray(payload?.binding_constraints)
    .map((x) => x?.nutrient)
    .filter(Boolean);
}

function getDashboardTopBindingNutrients(payload) {
  return asArray(payload?.dashboard_summary?.top_binding_nutrients).filter(Boolean);
}

function getUsedIngredientIds(payload) {
  return asArray(payload?.optimized_formula)
    .map((x) => x?.id)
    .filter(Boolean);
}

function getCostlySyntheticFlags(payload) {
  return getUsedIngredientIds(payload).filter((id) =>
    COSTLY_SYNTHETIC_IDS.has(String(id).toLowerCase())
  );
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of asArray(items)) {
    const key = getKey(item);
    if (key == null || key === "") continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function mapToSortedCountRows(map, keyName) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a[keyName]).localeCompare(String(b[keyName]));
    });
}

function pickTop(arr, n = 10) {
  return asArray(arr).slice(0, n);
}

function buildFailureItems(resultRows) {
  return resultRows
    .filter((x) => !x.ok)
    .map((x) => ({
      formula_id: x.formula_id,
      formula_code: x.formula_code ?? null,
      formula_name: x.formula_name,
      formula_version_id: x.formula_version_id ?? null,
      version_label: x.version_label ?? null,
      http_status: x.http_status,
      status: x.payload?.status || "error",
      message: x.payload?.message || null
    }));
}

function buildHighestCostFormulas(resultRows, topN = 10) {
  return resultRows
    .filter((x) => x.ok)
    .map((x) => ({
      formula_id: x.formula_id,
      formula_code: x.formula_code ?? null,
      formula_name: x.formula_name,
      formula_version_id: x.formula_version_id ?? null,
      version_label: x.version_label ?? null,
      cost_after_per_ton: getCostAfterPerTon(x.payload)
    }))
    .filter((x) => x.cost_after_per_ton != null)
    .sort((a, b) => b.cost_after_per_ton - a.cost_after_per_ton)
    .slice(0, topN);
}

function buildTopBindingNutrients(resultRows, topN = 10) {
  const all = [];

  for (const row of resultRows.filter((x) => x.ok)) {
    const fromBinding = getBindingNutrients(row.payload);
    const fallback = getDashboardTopBindingNutrients(row.payload);
    const source = fromBinding.length > 0 ? fromBinding : fallback;

    for (const nutrient of source) {
      all.push(nutrient);
    }
  }

  return pickTop(
    mapToSortedCountRows(countBy(all, (x) => x), "nutrient"),
    topN
  );
}

function buildIngredientUsageFrequency(resultRows, topN = 20) {
  const all = [];

  for (const row of resultRows.filter((x) => x.ok)) {
    for (const id of getUsedIngredientIds(row.payload)) {
      all.push(id);
    }
  }

  return pickTop(
    mapToSortedCountRows(countBy(all, (x) => x), "id"),
    topN
  );
}

function buildCostlySyntheticUsage(resultRows, topN = 10) {
  const all = [];

  for (const row of resultRows.filter((x) => x.ok)) {
    for (const id of getCostlySyntheticFlags(row.payload)) {
      all.push(id);
    }
  }

  return pickTop(
    mapToSortedCountRows(countBy(all, (x) => x), "id"),
    topN
  );
}

function buildMultimixSummary(resultRows) {
  const successfulRows = resultRows.filter((x) => x.ok);
  const failedRows = resultRows.filter((x) => !x.ok);

  const feasibleRows = successfulRows.filter((x) => isFeasiblePayload(x.payload));
  const infeasibleRows = successfulRows.filter((x) => !isFeasiblePayload(x.payload));

  const costRows = successfulRows
    .map((x) => getCostAfterPerTon(x.payload))
    .filter((v) => v != null);

  const totalCostAfter = round4(costRows.reduce((sum, v) => sum + v, 0));
  const averageCostAfter =
    costRows.length > 0 ? round4(totalCostAfter / costRows.length) : null;

  return {
    successful_result_count: successfulRows.length,
    failed_result_count: failedRows.length,
    feasible_count: feasibleRows.length,
    infeasible_count: infeasibleRows.length,
    total_cost_after_per_ton_sum: totalCostAfter,
    average_cost_after_per_ton: averageCostAfter,
    total_cost_before_per_ton_sum: null,
    total_savings_per_ton_sum: null,
    top_binding_nutrients: buildTopBindingNutrients(resultRows, 10),
    ingredient_usage_frequency: buildIngredientUsageFrequency(resultRows, 20),
    costly_synthetic_usage_frequency: buildCostlySyntheticUsage(resultRows, 10),
    highest_cost_formulas: buildHighestCostFormulas(resultRows, 10),
    failure_items: buildFailureItems(resultRows)
  };
}

function buildReturnedResults(resultRows, controls) {
  let rows = [...resultRows];

  if (!controls.include_failed_cases) {
    rows = rows.filter((x) => x.ok);
  }

  if (controls.response_mode === "summary") {
    return rows.map((x) => ({
      formula_id: x.formula_id,
      formula_code: x.formula_code ?? null,
      formula_name: x.formula_name,
      formula_version_id: x.formula_version_id ?? null,
      version_label: x.version_label ?? null,
      ok: x.ok,
      http_status: x.http_status,
      status: x.payload?.status || null,
      message: x.payload?.message || null,
      meta: x.payload?.meta || null,
      cost_summary: x.payload?.cost_summary || null,
      dashboard_summary: x.payload?.dashboard_summary || null,
      environment: x.environment || null
    }));
  }

  return rows;
}

function buildScenarioMetadata({
  formulaSet,
  costSet,
  ingredientProfileSet
}) {
  return {
    formula_set: {
      formula_set_id: formulaSet?.formula_set_id ?? null,
      formula_set_name: formulaSet?.formula_set_name ?? null,
      item_count: asArray(formulaSet?.items).length,
      version: formulaSet?.version ?? null,
      last_modified: formulaSet?.last_modified ?? null
    },
    cost_set: {
      cost_set_id: costSet?.cost_set_id ?? null,
      cost_set_name: costSet?.cost_set_name ?? null,
      item_count: asArray(costSet?.items).length,
      effective_date: costSet?.effective_date ?? null,
      currency: costSet?.currency ?? null,
      version: costSet?.version ?? null,
      last_modified: costSet?.last_modified ?? null
    },
    ingredient_profile_set: {
      ingredient_profile_set_id: ingredientProfileSet?.ingredient_profile_set_id ?? null,
      ingredient_profile_set_name: ingredientProfileSet?.ingredient_profile_set_name ?? null,
      item_count: asArray(ingredientProfileSet?.items).length,
      effective_date: ingredientProfileSet?.effective_date ?? null,
      version: ingredientProfileSet?.version ?? null,
      last_modified: ingredientProfileSet?.last_modified ?? null
    }
  };
}

function buildResultRow({
  item,
  optimizerResult,
  environmentMeta,
  audit
}) {
  return {
    formula_id: item?.formula_id ?? null,
    formula_code: item?.formula_code ?? null,
    formula_name: item?.formula_name ?? null,
    formula_version_id: item?.formula_version_id ?? null,
    version_label: item?.version_label ?? null,
    ok: !!optimizerResult?.ok,
    http_status: optimizerResult?.http_status || 200,
    payload: optimizerResult?.payload || null,
    environment: environmentMeta,
    audit: audit || null
  };
}

function buildAuditEnvelope({
  formulaSetItem,
  optimizerPayload,
  storedFormula,
  workingFormula
}) {
  return {
    formula_id: formulaSetItem?.formula_id ?? null,
    formula_version_id: formulaSetItem?.formula_version_id ?? null,
    ingredient_count_stored: asArray(storedFormula?.ingredients).length,
    ingredient_count_working: asArray(workingFormula?.ingredients).length,
    optimizer_ingredient_pool_count: asArray(optimizerPayload?.ingredient_pool).length,
    optimizer_constraint_count: asArray(optimizerPayload?.nutrient_constraints).length,
    has_starting_formula: asArray(optimizerPayload?.starting_formula).length > 0,
    objective: optimizerPayload?.objective || null,
    formula_basis: optimizerPayload?.formula_basis ?? null
  };
}

async function runMultimix(payload) {
  try {
    ensureDirExists(DATA_ROOT, "Data root");
    ensureDirExists(FORMULA_SETS_DIR, "Formula set");
    ensureDirExists(COST_SETS_DIR, "Cost set");
    ensureDirExists(INGREDIENT_PROFILE_SETS_DIR, "Ingredient profile set");
    ensureDirExists(FORMULAS_DIR, "Formula");

    validateMultimixRequest(payload);
    const controls = normalizeControls(payload);

    const startedAtIso = safeNowIso();
    const startedAtMs = Date.now();

    const formulaSet = loadFormulaSet(payload.formula_set_id);
    const costSet = loadCostSet(payload.cost_set_id);
    const ingredientProfileSet = loadIngredientProfileSet(payload.ingredient_profile_set_id);

    validateFormulaSet(formulaSet, payload.formula_set_id);
    validateCostSet(costSet, payload.cost_set_id);
    validateIngredientProfileSet(ingredientProfileSet, payload.ingredient_profile_set_id);

    const formulaSetItems = asArray(formulaSet?.items);
    const costSetIndex = indexCostSetItems(costSet);
    const ingredientProfileIndex = indexIngredientProfileSetItems(ingredientProfileSet);

    const results = [];
    let stoppedEarly = false;
    let stopReason = null;

    for (const item of formulaSetItems) {
      try {
        const storedFormula = loadStoredFormula(item);

        const workingFormula = applyEnvironmentToFormula({
          formula: storedFormula,
          costSetIndex,
          ingredientProfileIndex
        });

        const optimizerPayload = buildOptimizerPayload({
          formulaSetItem: item,
          workingFormula
        });

        const optimizerResult = await runOptimization(optimizerPayload);

        const resultRow = buildResultRow({
          item,
          optimizerResult,
          environmentMeta: {
            cost_set_id: costSet?.cost_set_id ?? null,
            ingredient_profile_set_id: ingredientProfileSet?.ingredient_profile_set_id ?? null
          },
          audit: buildAuditEnvelope({
            formulaSetItem: item,
            optimizerPayload,
            storedFormula,
            workingFormula
          })
        });

        results.push(resultRow);

        if (!resultRow.ok && controls.stop_on_error) {
          stoppedEarly = true;
          stopReason = `Stopped on first failed case: ${item?.formula_id || "unknown_formula"}`;
          break;
        }
      } catch (err) {
        const errorRow = {
          formula_id: item?.formula_id ?? null,
          formula_code: item?.formula_code ?? null,
          formula_name: item?.formula_name ?? null,
          formula_version_id: item?.formula_version_id ?? null,
          version_label: item?.version_label ?? null,
          ok: false,
          http_status: 500,
          payload: {
            status: "error",
            message: err?.message || "Multimix item failed",
            meta: {
              engine: "AgroCore",
              module: "multimix_v1",
              stage: "item_runtime_error",
              error_code: err?.code || null,
              timestamp_utc: safeNowIso()
            }
          },
          environment: {
            cost_set_id: costSet?.cost_set_id ?? null,
            ingredient_profile_set_id: ingredientProfileSet?.ingredient_profile_set_id ?? null
          },
          audit: {
            formula_id: item?.formula_id ?? null,
            formula_version_id: item?.formula_version_id ?? null,
            error_code: err?.code || null
          }
        };

        results.push(errorRow);

        if (controls.stop_on_error) {
          stoppedEarly = true;
          stopReason = `Stopped on runtime error: ${item?.formula_id || "unknown_formula"}`;
          break;
        }
      }
    }

    const succeeded = results.filter((x) => x.ok).length;
    const failed = results.filter((x) => !x.ok).length;
    const summary = buildMultimixSummary(results);
    const returnedResults = buildReturnedResults(results, controls);
    const finishedAtIso = safeNowIso();
    const elapsedMs = Date.now() - startedAtMs;

    return {
      ok: true,
      http_status: 200,
      payload: {
        status: "completed",
        batch_name: controls.batch_name,
        multimix_run: {
          multimix_run_id: `mmx_${Date.now()}`,
          started_at: startedAtIso,
          finished_at: finishedAtIso,
          elapsed_ms: elapsedMs
        },
        controls,
        scenario: buildScenarioMetadata({
          formulaSet,
          costSet,
          ingredientProfileSet
        }),
        total_formulas: formulaSetItems.length,
        processed_formulas: results.length,
        succeeded,
        failed,
        stopped_early: stoppedEarly,
        stop_reason: stopReason,
        summary,
        results: returnedResults,
        meta: {
          engine: "AgroCore",
          module: "multimix_v1",
          execution_mode: "sequential",
          data_backend: "file_backed",
          timestamp_utc: safeNowIso()
        }
      }
    };
  } catch (err) {
    const statusCode =
      err?.code === "MULTIMIX_REQUEST_VALIDATION_FAILED" ? 400 : 500;

    return {
      ok: false,
      http_status: statusCode,
      payload: {
        status: "error",
        message: err?.message || "Multimix service failed",
        meta: {
          engine: "AgroCore",
          module: "multimix_v1",
          stage: "service_runtime_error",
          error_code: err?.code || null,
          data_backend: "file_backed",
          timestamp_utc: safeNowIso()
        }
      }
    };
  }
}

function indexResultsByFormulaId(results) {
  const map = new Map();
  for (const row of asArray(results)) {
    if (!isNonEmptyString(row?.formula_id)) continue;
    map.set(row.formula_id, row);
  }
  return map;
}

function compareTopBindingNutrients(baselineSummary, scenarioSummary) {
  const baseline = asArray(baselineSummary?.top_binding_nutrients).map(x => x?.nutrient).filter(Boolean);
  const scenario = asArray(scenarioSummary?.top_binding_nutrients).map(x => x?.nutrient).filter(Boolean);

  const baselineSet = new Set(baseline);
  const scenarioSet = new Set(scenario);

  return {
    baseline: baseline,
    scenario: scenario,
    added_in_scenario: scenario.filter(x => !baselineSet.has(x)),
    removed_in_scenario: baseline.filter(x => !scenarioSet.has(x))
  };
}

function buildFormulaDeltaRows(baselineResults, scenarioResults) {
  const baselineMap = indexResultsByFormulaId(baselineResults);
  const scenarioMap = indexResultsByFormulaId(scenarioResults);

  const allFormulaIds = Array.from(new Set([
    ...Array.from(baselineMap.keys()),
    ...Array.from(scenarioMap.keys())
  ])).sort();

  return allFormulaIds.map(formulaId => {
    const base = baselineMap.get(formulaId) || null;
    const scen = scenarioMap.get(formulaId) || null;

    const baseCost = getCostAfterPerTon(base);
    const scenCost = getCostAfterPerTon(scen);

    return {
      formula_id: formulaId,
      formula_name: scen?.formula_name ?? base?.formula_name ?? null,
      baseline_ok: base?.ok ?? false,
      scenario_ok: scen?.ok ?? false,
      baseline_status: base?.status ?? base?.payload?.status ?? null,
      scenario_status: scen?.status ?? scen?.payload?.status ?? null,
      baseline_cost_after_per_ton: baseCost,
      scenario_cost_after_per_ton: scenCost,
      delta_cost_after_per_ton:
        Number.isFinite(baseCost) && Number.isFinite(scenCost)
          ? round4(scenCost - baseCost)
          : null
    };
  });
}

function buildComparisonSummary(baselinePayload, scenarioPayload) {
  const baselineSummary = baselinePayload?.summary || {};
  const scenarioSummary = scenarioPayload?.summary || {};

  const baselineAvg = toNumber(baselineSummary.average_cost_after_per_ton, null);
  const scenarioAvg = toNumber(scenarioSummary.average_cost_after_per_ton, null);
  const baselineTotal = toNumber(baselineSummary.total_cost_after_per_ton_sum, null);
  const scenarioTotal = toNumber(scenarioSummary.total_cost_after_per_ton_sum, null);

  return {
    baseline_average_cost_after_per_ton: baselineAvg,
    scenario_average_cost_after_per_ton: scenarioAvg,
    delta_average_cost_after_per_ton:
      Number.isFinite(baselineAvg) && Number.isFinite(scenarioAvg)
        ? round4(scenarioAvg - baselineAvg)
        : null,
    baseline_total_cost_after_per_ton_sum: baselineTotal,
    scenario_total_cost_after_per_ton_sum: scenarioTotal,
    delta_total_cost_after_per_ton_sum:
      Number.isFinite(baselineTotal) && Number.isFinite(scenarioTotal)
        ? round4(scenarioTotal - baselineTotal)
        : null,
    baseline_successful_result_count: baselineSummary.successful_result_count ?? null,
    scenario_successful_result_count: scenarioSummary.successful_result_count ?? null,
    baseline_failed_result_count: baselineSummary.failed_result_count ?? null,
    scenario_failed_result_count: scenarioSummary.failed_result_count ?? null,
    binding_nutrient_shift: compareTopBindingNutrients(baselineSummary, scenarioSummary)
  };
}

async function runMultimixComparison(payload) {
  try {
    validateMultimixComparisonRequest(payload);

    const startedAtIso = safeNowIso();
    const startedAtMs = Date.now();

    const baselineRequest = {
      ...deepClone(payload.baseline),
      response_mode: payload?.baseline?.response_mode || "summary"
    };

    const scenarioRequest = {
      ...deepClone(payload.scenario),
      response_mode: payload?.scenario?.response_mode || "summary"
    };

    const baselineRun = await runMultimix(baselineRequest);
    const scenarioRun = await runMultimix(scenarioRequest);

    if (!baselineRun?.ok) {
      return {
        ok: false,
        http_status: baselineRun?.http_status || 500,
        payload: {
          status: "error",
          message: "Baseline scenario failed",
          baseline_error: baselineRun?.payload || null,
          meta: {
            engine: "AgroCore",
            module: "multimix_compare_v1",
            stage: "baseline_run_failed",
            timestamp_utc: safeNowIso()
          }
        }
      };
    }

    if (!scenarioRun?.ok) {
      return {
        ok: false,
        http_status: scenarioRun?.http_status || 500,
        payload: {
          status: "error",
          message: "Comparison scenario failed",
          scenario_error: scenarioRun?.payload || null,
          meta: {
            engine: "AgroCore",
            module: "multimix_compare_v1",
            stage: "scenario_run_failed",
            timestamp_utc: safeNowIso()
          }
        }
      };
    }

    const baselinePayload = baselineRun.payload;
    const scenarioPayload = scenarioRun.payload;

    const formulaDeltas = buildFormulaDeltaRows(
      baselinePayload?.results || [],
      scenarioPayload?.results || []
    );

    const finishedAtIso = safeNowIso();
    const elapsedMs = Date.now() - startedAtMs;

    return {
      ok: true,
      http_status: 200,
      payload: {
        status: "completed",
        comparison_name: isNonEmptyString(payload?.comparison_name)
          ? payload.comparison_name.trim()
          : null,
        multimix_comparison_run: {
          multimix_comparison_run_id: `mmxc_${Date.now()}`,
          started_at: startedAtIso,
          finished_at: finishedAtIso,
          elapsed_ms: elapsedMs
        },
        baseline_run: {
          multimix_run: baselinePayload?.multimix_run || null,
          scenario: baselinePayload?.scenario || null,
          summary: baselinePayload?.summary || null
        },
        scenario_run: {
          multimix_run: scenarioPayload?.multimix_run || null,
          scenario: scenarioPayload?.scenario || null,
          summary: scenarioPayload?.summary || null
        },
        comparison_summary: buildComparisonSummary(baselinePayload, scenarioPayload),
        formula_deltas: formulaDeltas,
        meta: {
          engine: "AgroCore",
          module: "multimix_compare_v1",
          timestamp_utc: safeNowIso()
        }
      }
    };
  } catch (err) {
    const statusCode =
      err?.code === "MULTIMIX_COMPARISON_REQUEST_VALIDATION_FAILED" ? 400 : 500;

    return {
      ok: false,
      http_status: statusCode,
      payload: {
        status: "error",
        message: err?.message || "Multimix comparison failed",
        meta: {
          engine: "AgroCore",
          module: "multimix_compare_v1",
          stage: "service_runtime_error",
          error_code: err?.code || null,
          timestamp_utc: safeNowIso()
        }
      }
    };
  }
}

module.exports = {
  runMultimix,
  runMultimixComparison,
  loadFormulaSet,
  loadCostSet,
  loadIngredientProfileSet,
  loadStoredFormula,
  applyEnvironmentToFormula,
  buildOptimizerPayload
};

