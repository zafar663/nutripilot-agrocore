"use strict";

const buildNutrientCoefficients = require("./buildNutrientCoefficients.cjs");
const solveLP_ORTools = require("./solveLP_ORTools.cjs");

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeConstraint(constraint = {}, defaultHardness = "hard") {
  const hasRichBounds =
    Object.prototype.hasOwnProperty.call(constraint, "min") ||
    Object.prototype.hasOwnProperty.call(constraint, "max") ||
    Object.prototype.hasOwnProperty.call(constraint, "target");

  return {
    kind: constraint.kind || "nutrient",
    label: constraint.label || constraint.key || null,
    key: constraint.key || null,

    // legacy format
    op: constraint.op || ">=",
    value: toFiniteNumber(constraint.value, null),

    // rich format
    min: toFiniteNumber(constraint.min, null),
    max: toFiniteNumber(constraint.max, null),
    target: toFiniteNumber(constraint.target, null),

    hardness: constraint.hardness || defaultHardness,
    penalty: toFiniteNumber(constraint.penalty, null),

    constraint_format: hasRichBounds ? "rich" : "legacy",
    bound_type: constraint.bound_type || "legacy"
  };
}

function normalizeActiveIngredient(ing = {}, idx = 0) {
  const fixedRaw = ing.fixed;
  const hasFixed =
    fixedRaw !== undefined &&
    fixedRaw !== null &&
    Number.isFinite(Number(fixedRaw));

  const fixedValue = hasFixed ? Number(fixedRaw) : null;
  const minValue = toFiniteNumber(ing.min, 0);
  const maxValue = toFiniteNumber(ing.max, 100);

  const lowerBound = hasFixed ? fixedValue : minValue;
  const upperBound = hasFixed ? fixedValue : maxValue;

  return {
    index: idx,
    var_name: `x_${ing.id}`,
    ingredient_id: ing.id,
    display_name: ing.display_name || ing.id,
    lower_bound: lowerBound,
    upper_bound: upperBound,
    fixed: fixedValue,
    cost: toFiniteNumber(ing.cost, 0)
  };
}

function expandNutrientConstraintRows(constraints = [], defaultBucket = "hard") {
  const out = [];
  const targetRows = [];

  for (const c of constraints) {
    if (!c || c.kind !== "nutrient" || !c.key) continue;

    const format = c.constraint_format || "legacy";

    if (format === "rich") {
      if (c.min !== null) {
        out.push({
          ...c,
          label: c.label || `${c.key}_min`,
          op: ">=",
          value: c.min,
          bound_type: "min",
          hardness: c.hardness || defaultBucket
        });
      }

      if (c.max !== null) {
        out.push({
          ...c,
          label: c.label || `${c.key}_max`,
          op: "<=",
          value: c.max,
          bound_type: "max",
          hardness: c.hardness || defaultBucket
        });
      }

      if (c.target !== null) {
        targetRows.push({
          kind: "nutrient_target",
          nutrient_key: c.key,
          label: c.label || `${c.key}_target`,
          target: c.target,
          hardness: c.hardness || defaultBucket
        });
      }

      continue;
    }

    if (c.value !== null) {
      out.push({
        ...c,
        bound_type: c.bound_type || "legacy"
      });
    }
  }

  return {
    expanded_rows: out,
    target_rows: targetRows
  };
}

async function solveLP(model = {}, options = {}) {
  const activeRaw = Array.isArray(model.active_ingredients)
    ? model.active_ingredients
    : [];

  const hardRaw = Array.isArray(model?.constraints?.hard)
    ? model.constraints.hard
    : [];

  const softRaw = Array.isArray(model?.constraints?.soft)
    ? model.constraints.soft
    : [];

  const nutrientConstraintsRaw = Array.isArray(model?.constraints?.nutrient_constraints)
    ? model.constraints.nutrient_constraints
    : [];

  const targetRowsRaw = Array.isArray(model?.constraints?.target_rows)
    ? model.constraints.target_rows
    : [];

  const hard =
    hardRaw.length > 0
      ? hardRaw.map((c) => normalizeConstraint(c, "hard"))
      : nutrientConstraintsRaw
          .filter((c) => String(c.hardness || "hard").toLowerCase() !== "soft")
          .map((c) => normalizeConstraint(c, "hard"));

  const soft =
    softRaw.length > 0
      ? softRaw.map((c) => normalizeConstraint(c, "soft"))
      : nutrientConstraintsRaw
          .filter((c) => String(c.hardness || "hard").toLowerCase() === "soft")
          .map((c) => normalizeConstraint(c, "soft"));

  const expandedHardResult = expandNutrientConstraintRows(hard, "hard");
  const expandedSoftResult = expandNutrientConstraintRows(soft, "soft");

  const expandedHard = expandedHardResult.expanded_rows;
  const expandedSoft = expandedSoftResult.expanded_rows;
  const targetRows =
    targetRowsRaw.length > 0
      ? targetRowsRaw
          .filter((r) => r && (r.key || r.nutrient_key) && Number.isFinite(Number(r.target)))
          .map((r) => ({
            kind: "nutrient_target",
            nutrient_key: r.nutrient_key || r.key,
            key: r.key || r.nutrient_key,
            label: r.label || r.key || r.nutrient_key,
            target: Number(r.target),
            hardness: r.hardness || "hard"
          }))
      : [
          ...expandedHardResult.target_rows,
          ...expandedSoftResult.target_rows
        ];

  const active = activeRaw
    .filter((ing) => ing && ing.id)
    .map((ing, idx) => normalizeActiveIngredient(ing, idx));

  const costVector = active.map((v) => ({
    var_name: v.var_name,
    ingredient_id: v.ingredient_id,
    coefficient: v.cost
  }));

  const normalizedConstraints = {
    ...(model.constraints || {}),
    hard: expandedHard,
    soft: expandedSoft,
    target_rows: targetRows,
    nutrient_constraints: [...expandedHard, ...expandedSoft]
  };

  const coefficientResult = buildNutrientCoefficients({
    ...model,
    active_ingredients: activeRaw,
    constraints: normalizedConstraints
  });

  const coefficientMatrix = coefficientResult.matrix || {};


  const formulaTotalValue =
    toFiniteNumber(model?.constraints?.formula_total?.value, null) ??
    toFiniteNumber(options.formula_total, 100);

  const formulaTotalRow = {
    row_name: "formula_total",
    kind: "formula_total",
    operator: "=",
    rhs: formulaTotalValue,
    coefficients: Object.fromEntries(active.map((v) => [v.var_name, 1]))
  };

  const nutrientRowsHard = expandedHard
    .filter((c) => c.kind === "nutrient" && c.key && c.value !== null)
    .map((c) => ({
      row_name: c.label || c.key,
      kind: "nutrient",
      nutrient_key: c.key,
      operator: c.op,
      rhs: c.value,
      hardness: c.hardness,
      coefficients: coefficientMatrix[c.key] || {},
      coefficient_status: coefficientResult.ok
        ? "LOADED_FROM_INGREDIENT_DB"
        : "INGREDIENT_DB_LOAD_FAILED"
    }));

  const nutrientRowsSoft = expandedSoft
    .filter((c) => c.kind === "nutrient" && c.key && c.value !== null)
    .map((c) => ({
      row_name: c.label || c.key,
      kind: "nutrient",
      nutrient_key: c.key,
      operator: c.op,
      rhs: c.value,
      hardness: c.hardness,
      penalty: c.penalty,
      coefficients: coefficientMatrix[c.key] || {},
      coefficient_status: coefficientResult.ok
        ? "LOADED_FROM_INGREDIENT_DB"
        : "INGREDIENT_DB_LOAD_FAILED"
    }));

  const lpPayload = {
    objective: {
      type: "minimize",
      metric: model?.objective?.metric || "cost",
      cost_vector: costVector
    },
    variables: active,
    rows: {
      formula_total: formulaTotalRow,
      nutrient_hard: nutrientRowsHard,
      nutrient_soft: nutrientRowsSoft,
      target_rows: targetRows
    }
  };

  const solveResult = solveLP_ORTools(lpPayload);

  return {
    ok: !!solveResult.ok,
    solver_mode: "lp",
    solver_status: solveResult.solver_status || "UNKNOWN",
    objective_value: solveResult.objective_value ?? null,
    variable_values: solveResult.variable_values || {},
    lp_payload: lpPayload,
    coefficient_diagnostics: {
      ingredient_hits: coefficientResult.ingredient_hits || {},
      missing_ingredients: coefficientResult.missing_ingredients || [],
      missing_nutrient_values: coefficientResult.missing_nutrient_values || [],
      resolved_ids: coefficientResult.resolved_ids || {},
      loader_error: coefficientResult.loader_error || null
    },
    notes: [
      "LP payload built successfully.",
      coefficientResult.ok
        ? "Nutrient coefficients loaded from ingredient DB."
        : "Ingredient DB linkage failed; review coefficient diagnostics.",
      ...(solveResult.notes || []),
      nutrientRowsSoft.length > 0
        ? "Soft constraints are reported but not yet enforced in Phase 1."
        : "No soft constraints supplied."
    ],
    model_summary: {
      ingredient_count_active: active.length,
      hard_constraint_count: expandedHard.length,
      soft_constraint_count: expandedSoft.length,
      target_row_count: targetRows.length,
      variable_count: active.length,
      hard_nutrient_row_count: nutrientRowsHard.length,
      soft_nutrient_row_count: nutrientRowsSoft.length
    }
  };
}

module.exports = solveLP;











