"use strict";

function roundInclusion(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  if (n >= 1) return Number(n.toFixed(3));
  if (n >= 0.1) return Number(n.toFixed(3));
  if (n >= 0.01) return Number(n.toFixed(4));
  return Number(n.toFixed(5));
}

function interpretSolution(variableValues = {}, variables = []) {
  const formula_raw = {};
  const formula = {};
  const lines = [];

  for (const v of Array.isArray(variables) ? variables : []) {
    const varName = v.var_name;
    const ingredientId = v.ingredient_id;
    const displayName = v.display_name || ingredientId;

    const rawValue = Number(variableValues[varName] ?? 0);
    if (!Number.isFinite(rawValue) || rawValue <= 0) continue;

    const roundedValue = roundInclusion(rawValue);

    formula_raw[ingredientId] = rawValue;
    formula[ingredientId] = roundedValue;
    lines.push(`${displayName} ${roundedValue}`);
  }

  return {
    formula_raw,
    formula,
    formula_text: lines.join("\n")
  };
}

module.exports = interpretSolution;
