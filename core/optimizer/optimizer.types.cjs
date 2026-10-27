"use strict";

/**
 * NutriPilot Optimizer Types / Contracts
 * Commercial Schema v1
 */

const OPTIMIZER_VERSION = "v1.commercial_schema";
const OPTIMIZER_STAGE = "commercial_schema_ready";

const OPTIMIZER_MODES = Object.freeze({
  LEAST_COST: "least_cost",
  REPAIR: "repair",
  SCENARIO: "scenario"
});

const SOLVER_MODES = Object.freeze({
  LP: "lp",
  MILP: "milp"
});

const CONSTRAINT_KINDS = Object.freeze({
  NUTRIENT: "nutrient",
  INGREDIENT: "ingredient",
  FORMULA_TOTAL: "formula_total"
});

const CONSTRAINT_HARDNESS = Object.freeze({
  HARD: "hard",
  SOFT: "soft"
});

const DEFAULT_OPTIMIZER_OPTIONS = Object.freeze({
  optimizer_mode: OPTIMIZER_MODES.LEAST_COST,
  solver_mode: SOLVER_MODES.LP,
  currency: "USD",
  cost_unit: "USD/ton",
  formula_total: 100,
  allow_soft_constraints: false,
  include_disabled_ingredients: false,
  verbose: false
});

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return fallback;
}

function normalizeOptimizerOptions(input = {}) {
  const merged = {
    ...DEFAULT_OPTIMIZER_OPTIONS,
    ...(input || {})
  };

  merged.formula_total = toFiniteNumber(merged.formula_total, 100);
  merged.allow_soft_constraints = toBool(merged.allow_soft_constraints, false);
  merged.include_disabled_ingredients = toBool(merged.include_disabled_ingredients, false);
  merged.verbose = toBool(merged.verbose, false);

  const mode = String(merged.optimizer_mode || OPTIMIZER_MODES.LEAST_COST).toLowerCase();
  const solver = String(merged.solver_mode || SOLVER_MODES.LP).toLowerCase();

  merged.optimizer_mode = Object.values(OPTIMIZER_MODES).includes(mode)
    ? mode
    : OPTIMIZER_MODES.LEAST_COST;

  merged.solver_mode = Object.values(SOLVER_MODES).includes(solver)
    ? solver
    : SOLVER_MODES.LP;

  return merged;
}

function normalizeIngredient(row = {}, index = 0) {
  const id = String(row.id || row.key || row.name || "").trim();

  return {
    row_index: index,
    id,
    display_name: String(row.display_name || row.name || id || `ingredient_${index + 1}`).trim(),
    enabled: toBool(row.enabled, true),

    min: toFiniteNumber(row.min, 0),
    max: toFiniteNumber(row.max, 100),
    fixed: row.fixed === null || row.fixed === undefined || row.fixed === ""
      ? null
      : toFiniteNumber(row.fixed, null),

    step: row.step === null || row.step === undefined || row.step === ""
      ? null
      : toFiniteNumber(row.step, null),

    cost: toFiniteNumber(row.cost, null),
    cost_unit: String(row.cost_unit || "").trim() || null,
    lot_id: String(row.lot_id || "").trim() || null,

    metadata: {
      source_mode: String(row.source_mode || "request").trim(),
      tags: Array.isArray(row.tags) ? row.tags : []
    }
  };
}

function normalizeNutrientConstraint(row = {}, index = 0) {
  const key = String(row.key || "").trim();
  const op = String(row.op || row.operator || ">=").trim();
  const hardness = String(row.hardness || row.constraint_type || CONSTRAINT_HARDNESS.HARD).toLowerCase();

  return {
    row_index: index,
    kind: CONSTRAINT_KINDS.NUTRIENT,
    key,
    op,
    value: toFiniteNumber(row.value, null),
    hardness: Object.values(CONSTRAINT_HARDNESS).includes(hardness)
      ? hardness
      : CONSTRAINT_HARDNESS.HARD,
    penalty: toFiniteNumber(row.penalty, null),
    label: String(row.label || key || `constraint_${index + 1}`).trim()
  };
}

function validateIngredient(ingredient = {}) {
  const errors = [];

  if (!ingredient.id) {
    errors.push("INGREDIENT_ID_MISSING");
  }
  if (ingredient.min !== null && ingredient.max !== null && ingredient.min > ingredient.max) {
    errors.push("INGREDIENT_MIN_GT_MAX");
  }
  if (ingredient.fixed !== null) {
    if (ingredient.min !== null && ingredient.fixed < ingredient.min) {
      errors.push("INGREDIENT_FIXED_LT_MIN");
    }
    if (ingredient.max !== null && ingredient.fixed > ingredient.max) {
      errors.push("INGREDIENT_FIXED_GT_MAX");
    }
  }
  if (ingredient.cost !== null && ingredient.cost < 0) {
    errors.push("INGREDIENT_COST_NEGATIVE");
  }

  return errors;
}

function validateNutrientConstraint(c = {}) {
  const errors = [];

  if (!c.key) errors.push("NUTRIENT_KEY_MISSING");
  if (!["<=", ">=", "="].includes(c.op)) errors.push("NUTRIENT_OPERATOR_INVALID");
  if (c.value === null) errors.push("NUTRIENT_VALUE_MISSING");

  return errors;
}

module.exports = {
  OPTIMIZER_VERSION,
  OPTIMIZER_STAGE,
  OPTIMIZER_MODES,
  SOLVER_MODES,
  CONSTRAINT_KINDS,
  CONSTRAINT_HARDNESS,
  DEFAULT_OPTIMIZER_OPTIONS,
  normalizeOptimizerOptions,
  normalizeIngredient,
  normalizeNutrientConstraint,
  validateIngredient,
  validateNutrientConstraint,
  toFiniteNumber,
  toBool
};
