"use strict";

// Box-Muller Gaussian noise
function gaussianNoise(stddev) {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function round4(v) {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

/**
 * Perturb the nutrient-coefficient entries in a javascript-lp-solver model.
 * Only touches the coefficients belonging to real ingredient variables (not
 * deviation / movement penalty variables), and only the nutrient constraint
 * columns (not basis_eq or per-variable min/max bound columns).
 */
function perturbLpModel(lpModel, ingredientIds, variancePct) {
  const idSet = new Set(ingredientIds);
  const skipExact = new Set(['cost', 'basis_eq']);
  // Pattern: var_{anyId}_min  or  var_{anyId}_max  — these are bound rows, not nutrients
  const boundPattern = /^var_.+_(min|max)$/;

  const perturbedVars = {};
  for (const [varId, varData] of Object.entries(lpModel.variables)) {
    const isIngredient = idSet.has(varId);
    const out = {};
    for (const [key, coeff] of Object.entries(varData)) {
      if (isIngredient && !skipExact.has(key) && !boundPattern.test(key)) {
        // Perturb: multiply by (1 + ε), clamped to ≥ 0
        const noise = gaussianNoise(variancePct);
        out[key] = Math.max(0, coeff * (1 + noise));
      } else {
        out[key] = coeff;
      }
    }
    perturbedVars[varId] = out;
  }

  return {
    optimize: lpModel.optimize,
    opType: lpModel.opType,
    constraints: lpModel.constraints,   // shallow copy fine — not perturbed
    variables: perturbedVars
  };
}

function percentileValue(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(p * sortedArr.length)));
  return sortedArr[idx];
}

/**
 * Run Monte Carlo stochastic analysis on a pre-built LP model.
 *
 * @param {object} opts
 * @param {object} opts.lpModel          javascript-lp-solver model from /v1/optimize response
 * @param {string[]} opts.ingredientIds  list of ingredient variable IDs in the model
 * @param {number} opts.scenarios        number of MC iterations (50–1000, default 300)
 * @param {number} opts.confidence       confidence level for robust cost (0.5–0.99, default 0.95)
 * @param {number} opts.nutrientVariancePct  std-dev of Gaussian noise as fraction (default 0.05 = 5%)
 * @param {object} opts.lpSolver         javascript-lp-solver module (must have .Solve())
 */
async function monteCarloRisk({
  lpModel,
  ingredientIds = [],
  scenarios = 300,
  confidence = 0.95,
  nutrientVariancePct = 0.05,
  lpSolver,
  solveFn = null,
  concurrency = 4
}) {
  const runSolve = typeof solveFn === 'function'
    ? solveFn
    : (lpSolver && typeof lpSolver.Solve === 'function'
      ? async (model) => ({ ok: true, result: lpSolver.Solve(model) })
      : null);

  if (!lpModel || !runSolve) {
    return {
      enabled: false,
      status: 'LP_MODEL_OR_SOLVER_MISSING',
      notes: ['lpModel and a loaded lpSolver are required.']
    };
  }

  const costs = [];
  let infeasibleCount = 0;
  const conc = Math.max(1, Math.min(8, Number(concurrency) || 4));

  for (let i = 0; i < scenarios; i += conc) {
    const batch = [];
    for (let j = 0; j < conc && i + j < scenarios; j++) {
      batch.push(perturbLpModel(lpModel, ingredientIds, nutrientVariancePct));
    }
    const solved = await Promise.all(batch.map(async (model) => {
      try {
        const wrapped = await runSolve(model);
        return wrapped?.result || wrapped;
      } catch {
        return null;
      }
    }));
    for (const result of solved) {
      const cost = result?.result;
      if (typeof cost === 'number' && Number.isFinite(cost) && result?.feasible !== false) {
        costs.push(cost);
      } else {
        infeasibleCount++;
      }
    }
  }

  if (!costs.length) {
    return {
      enabled: true,
      status: 'NO_FEASIBLE_SCENARIOS',
      scenarios_run: scenarios,
      feasible_count: 0,
      infeasible_count: infeasibleCount,
      notes: ['All perturbed scenarios were infeasible. Constraints may be too tight for the given variance.']
    };
  }

  costs.sort((a, b) => a - b);

  const mean = round4(costs.reduce((s, c) => s + c, 0) / costs.length);
  const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length;
  const stdDev = round4(Math.sqrt(variance));

  const p5  = percentileValue(costs, 0.05);
  const p25 = percentileValue(costs, 0.25);
  const p50 = percentileValue(costs, 0.50);
  const p75 = percentileValue(costs, 0.75);
  const p95 = percentileValue(costs, 0.95);
  const robustCost = percentileValue(costs, confidence);

  return {
    enabled: true,
    status: 'OK',
    scenarios_requested: scenarios,
    scenarios_run: scenarios,
    feasible_count: costs.length,
    infeasible_count: infeasibleCount,
    nutrient_variance_pct: nutrientVariancePct,
    confidence_level: confidence,
    cost_distribution: {
      min:    round4(costs[0]),
      p5:     round4(p5),
      p25:    round4(p25),
      p50:    round4(p50),
      p75:    round4(p75),
      p95:    round4(p95),
      max:    round4(costs[costs.length - 1]),
      mean,
      std_dev: stdDev
    },
    robust_cost_at_confidence: round4(robustCost),
    risk_indicator: p50 > 0 ? round4((p95 - p50) / p50) : null,
    notes: [
      `Monte Carlo: ${costs.length} feasible of ${scenarios} scenarios at ±${Math.round(nutrientVariancePct * 100)}% nutrient variance.`,
      `Robust cost at ${Math.round(confidence * 100)}th percentile: $${round4(robustCost)}/ton.`,
      infeasibleCount > 0 ? `${infeasibleCount} scenarios were infeasible (constraints not satisfiable under perturbation).` : ''
    ].filter(Boolean)
  };
}

module.exports = monteCarloRisk;
