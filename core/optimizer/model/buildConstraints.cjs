"use strict";

const {
  CONSTRAINT_KINDS,
  CONSTRAINT_HARDNESS,
  normalizeNutrientConstraint,
  validateNutrientConstraint,
  toFiniteNumber
} = require("../optimizer.types.cjs");

/**
 * Build normalized optimizer constraints.
 */
function buildConstraints(payload = {}, options = {}) {
  const nutrientRows = Array.isArray(payload.nutrient_constraints)
    ? payload.nutrient_constraints
    : [];

  const nutrientConstraints = nutrientRows.map((row, i) => {
    const normalized = normalizeNutrientConstraint(row, i);
    return {
      ...normalized,
      validation_errors: validateNutrientConstraint(normalized)
    };
  });

  const formulaTotalConstraint = {
    row_index: 0,
    kind: CONSTRAINT_KINDS.FORMULA_TOTAL,
    key: "formula_total",
    op: "=",
    value: toFiniteNumber(options.formula_total, 100),
    hardness: CONSTRAINT_HARDNESS.HARD,
    penalty: null,
    label: "Total formula must equal target total"
  };

  const softConstraints = nutrientConstraints.filter(c => c.hardness === CONSTRAINT_HARDNESS.SOFT);
  const hardConstraints = [
    formulaTotalConstraint,
    ...nutrientConstraints.filter(c => c.hardness === CONSTRAINT_HARDNESS.HARD)
  ];

  return {
    all: [formulaTotalConstraint, ...nutrientConstraints],
    hard: hardConstraints,
    soft: softConstraints,
    formula_total: formulaTotalConstraint,
    nutrient_constraints: nutrientConstraints
  };
}

module.exports = buildConstraints;
