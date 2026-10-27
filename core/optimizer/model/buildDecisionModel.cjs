"use strict";

const buildObjective = require("./buildObjective.cjs");
const buildConstraints = require("./buildConstraints.cjs");
const {
  OPTIMIZER_VERSION,
  OPTIMIZER_STAGE,
  normalizeIngredient,
  validateIngredient
} = require("../optimizer.types.cjs");

/**
 * Convert optimizer request into a normalized commercial decision model.
 */
function buildDecisionModel(payload = {}, options = {}) {
  const rawIngredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];

  const normalizedIngredients = rawIngredients.map((row, i) => {
    const normalized = normalizeIngredient(row, i);
    return {
      ...normalized,
      validation_errors: validateIngredient(normalized)
    };
  });

  const activeIngredients = normalizedIngredients.filter(x =>
    options.include_disabled_ingredients ? true : x.enabled
  );

  const constraints = buildConstraints(payload, options);
  const objective = buildObjective(payload, options);

  const validation = {
    ingredient_errors: normalizedIngredients
      .filter(x => Array.isArray(x.validation_errors) && x.validation_errors.length > 0)
      .map(x => ({
        id: x.id,
        errors: x.validation_errors
      })),
    constraint_errors: constraints.nutrient_constraints
      .filter(x => Array.isArray(x.validation_errors) && x.validation_errors.length > 0)
      .map(x => ({
        key: x.key,
        label: x.label,
        errors: x.validation_errors
      }))
  };

  return {
    meta: {
      optimizer_version: OPTIMIZER_VERSION,
      optimizer_stage: OPTIMIZER_STAGE,
      request_context: {
        species: payload.species || null,
        type: payload.type || null,
        production: payload.production || null,
        breed: payload.breed || null,
        phase: payload.phase || null,
        region: payload.region || null,
        version: payload.version || null
      }
    },

    ingredients: normalizedIngredients,
    active_ingredients: activeIngredients,
    objective,
    constraints,
    options,
    validation,

    summaries: {
      ingredient_count_total: normalizedIngredients.length,
      ingredient_count_active: activeIngredients.length,
      hard_constraint_count: constraints.hard.length,
      soft_constraint_count: constraints.soft.length,
      nutrient_constraint_count: constraints.nutrient_constraints.length
    }
  };
}

module.exports = buildDecisionModel;
