"use strict";

/**
 * CORE_NORMALIZE_FORMULA.cjs
 * B1 normalization preview:
 * - Keep additives/premixes/enzymes/binders FIXED (not scaled)
 * - Scale only nutritive ingredients to (100 - fixedSum)
 *
 * This function returns a "normalized preview" object.
 * Whether the engine USES it for nutrient calc is controlled in analyzeFormula.cjs (audit-first default).
 */

module.exports = function normalizeFormula(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { items: [], total: 0, normalized: false, fixed_additives_total: 0 };

  const FIXED_KEYS = new Set([
    "vitamin_premix",
    "mineral_premix",
    "phytase",
    "nsps_enzyme",
    "protease",
    "toxin_binder",
    "anti_coccidial",
    "agps"
  ]);

  const fixed = [];
  const variable = [];

  for (const it of list) {
    const key = String(it.ingredient || "").toLowerCase();
    if (FIXED_KEYS.has(key)) fixed.push(it);
    else variable.push(it);
  }

  const fixedSum = fixed.reduce((s, it) => s + (Number(it.inclusion) || 0), 0);
  const variableSum = variable.reduce((s, it) => s + (Number(it.inclusion) || 0), 0);

  // Guardrails: if fixed already consumes the formula or nothing variable exists, do not normalize.
  if (fixedSum >= 100 || variableSum <= 0) {
    const total = fixedSum + variableSum;
    return {
      items: list.map(it => ({
        ingredient: it.ingredient,
        inclusion: Number((Number(it.inclusion) || 0).toFixed(4)),
        lot: it.lot ?? null
      })),
      total: Number(total.toFixed(4)),
      normalized: false,
      fixed_additives_total: Number(fixedSum.toFixed(4))
    };
  }

  const targetVariableTotal = 100 - fixedSum;
  const factor = targetVariableTotal / variableSum;

  const out = [
    ...variable.map(it => ({
      ingredient: it.ingredient,
      inclusion: Number(((Number(it.inclusion) || 0) * factor).toFixed(4)),
      lot: it.lot ?? null
    })),
    ...fixed.map(it => ({
      ingredient: it.ingredient,
      inclusion: Number((Number(it.inclusion) || 0).toFixed(4)),
      lot: it.lot ?? null
    }))
  ];

  const outTotal = out.reduce((s, it) => s + (Number(it.inclusion) || 0), 0);

  return {
    items: out,
    total: Number(outTotal.toFixed(4)),
    normalized: true,
    fixed_additives_total: Number(fixedSum.toFixed(4)),
    variable_total_before: Number(variableSum.toFixed(4)),
    variable_scaled_to: Number(targetVariableTotal.toFixed(4))
  };
};
