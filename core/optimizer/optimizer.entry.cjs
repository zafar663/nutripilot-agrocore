"use strict";

const solverAdapter = require("./solver/solver.adapter.cjs");
const interpretSolution = require("./interpretSolution.cjs");
const { analyzeFormula } = require("../engine/analyzeFormula.cjs");

function normalizeNutrientConstraints(list) {
  return (Array.isArray(list) ? list : []).map((c) => {
    const base = {
      kind: "nutrient",
      label: c.key,
      hardness: c.hardness || "hard",
      key: c.key
    };

    // New rich format: { key, min, target, max, hardness }
    if (Object.prototype.hasOwnProperty.call(c, "min") ||
        Object.prototype.hasOwnProperty.call(c, "max") ||
        Object.prototype.hasOwnProperty.call(c, "target")) {
      return {
        ...base,
        min: c.min,
        target: c.target,
        max: c.max
      };
    }

    // Legacy format: { key, op, value, hardness }
    return {
      ...base,
      op: c.op,
      value: c.value
    };
  });
}

function expandHardAndSoftConstraints(normalized) {
  const hard = [];
  const soft = [];
  const target_rows = [];

  for (const c of normalized) {
    const hardness = String(c.hardness || "hard").toLowerCase();
    const bucket = hardness === "soft" ? soft : hard;

    // New rich format
    const hasRich =
      Object.prototype.hasOwnProperty.call(c, "min") ||
      Object.prototype.hasOwnProperty.call(c, "max") ||
      Object.prototype.hasOwnProperty.call(c, "target");

    if (hasRich) {
      if (c.min !== undefined && c.min !== null && c.min !== "") {
        bucket.push({
          kind: "nutrient",
          label: `${c.key}_min`,
          key: c.key,
          op: ">=",
          value: Number(c.min),
          hardness: c.hardness || "hard",
          bound_type: "min"
        });
      }

      if (c.max !== undefined && c.max !== null && c.max !== "") {
        bucket.push({
          kind: "nutrient",
          label: `${c.key}_max`,
          key: c.key,
          op: "<=",
          value: Number(c.max),
          hardness: c.hardness || "hard",
          bound_type: "max"
        });
      }

      if (c.target !== undefined && c.target !== null && c.target !== "") {
        target_rows.push({
          kind: "nutrient_target",
          key: c.key,
          target: Number(c.target),
          hardness: c.hardness || "hard"
        });
      }

      continue;
    }

    // Legacy format
    bucket.push({
      kind: "nutrient",
      label: c.key,
      key: c.key,
      op: c.op,
      value: Number(c.value),
      hardness: c.hardness || "hard",
      bound_type: "legacy"
    });
  }

  return { hard, soft, target_rows };
}

function buildSolverPayload(payload, nutrientConstraints) {
  const normalized = normalizeNutrientConstraints(nutrientConstraints);
  const expanded = expandHardAndSoftConstraints(normalized);

  return {
    ...payload,
    active_ingredients: Array.isArray(payload.ingredients) ? payload.ingredients : [],
    constraints: {
      hard: expanded.hard,
      soft: expanded.soft,
      target_rows: expanded.target_rows,
      nutrient_constraints: normalized
    }
  };
}

async function runInfeasibilityDebug(payload, options) {
  const original = Array.isArray(payload.nutrient_constraints) ? payload.nutrient_constraints : [];
  const normalized = normalizeNutrientConstraints(original);
  const expanded = expandHardAndSoftConstraints(normalized);
  const hardOnly = expanded.hard;

  const debug = [];

  for (let i = 0; i < hardOnly.length; i++) {
    const removed = hardOnly[i];
    const reducedHard = hardOnly.filter((_, idx) => idx !== i);

    const testPayload = {
      ...payload,
      active_ingredients: Array.isArray(payload.ingredients) ? payload.ingredients : [],
      constraints: {
        hard: reducedHard,
        soft: expanded.soft,
        target_rows: expanded.target_rows,
        nutrient_constraints: normalized
      }
    };

    const testResult = await solverAdapter(testPayload, options);

    debug.push({
      removed_constraint: {
        key: removed.key,
        op: removed.op,
        value: removed.value,
        hardness: removed.hardness || "hard",
        bound_type: removed.bound_type || "legacy"
      },
      solver_status: testResult.solver_status || "UNKNOWN",
      feasible: !!testResult.ok
    });
  }

  return {
    tested_constraints: debug.length,
    blocking_constraints: debug.filter((x) => x.feasible),
    all_results: debug
  };
}

function buildAnalyzerSummary(analyzer) {
  if (!analyzer || !analyzer.evaluation) return null;

  const findings = Array.isArray(analyzer.evaluation.findings) ? analyzer.evaluation.findings : [];
  const deviations = analyzer.deviations_canonical || {};

  return {
    overall: analyzer.evaluation.overall || "UNKNOWN",
    key_findings: findings.map((f) => {
      const d = deviations[f.nutrient] || {};
      return {
        nutrient: f.nutrient,
        status: f.status,
        actual: d.actual,
        required: d.required,
        diff: d.diff,
        pct: d.pct
      };
    })
  };
}

function buildTargetSummary(targetRows, analyzer) {
  const out = {};
  if (!Array.isArray(targetRows) || !analyzer || !analyzer.nutrient_profile_full) return out;

  const actuals = analyzer.nutrient_profile_full;

  for (const row of targetRows) {
    const key = row.key;
    const target = Number(row.target);
    const actual = Number(actuals[key]);

    if (!Number.isFinite(target) || !Number.isFinite(actual)) continue;

    const diff = actual - target;
    const pct = target === 0 ? 0 : (diff / target) * 100;

    out[key] = {
      actual: key === "me" ? Number(actual.toFixed(1)) : Number(actual.toFixed(4)),
      target,
      diff: key === "me" ? Number(diff.toFixed(1)) : Number(diff.toFixed(4)),
      pct: Number(pct.toFixed(2))
    };
  }

  return out;
}

async function optimizerEntry(payload = {}) {
  const options = payload.options || {};
  const nutrientConstraints = Array.isArray(payload.nutrient_constraints)
    ? payload.nutrient_constraints
    : [];

  const solverInput = buildSolverPayload(payload, nutrientConstraints);
  const solverResult = await solverAdapter(solverInput, options);

  if (!solverResult.ok) {
    const shouldDebugInfeasibility = !!options.debug_infeasibility;

    return {
      ...solverResult,
      infeasibility_debug: shouldDebugInfeasibility
        ? await runInfeasibilityDebug(payload, options)
        : null
    };
  }

  const interpreted = interpretSolution(
    solverResult.variable_values,
    solverResult.lp_payload.variables
  );

  const analysis = await analyzeFormula({
    locale: payload.locale,
    species: payload.species,
    type: payload.type,
    production: payload.production,
    breed: payload.breed,
    phase: payload.phase,
    region: payload.region,
    version: payload.version,
    cp_apply_mode: payload.cp_apply_mode || "RECOMPUTE_SID_FROM_TOTAL",
    formula_text: interpreted.formula_text
  });

  const analyzer_summary = buildAnalyzerSummary(analysis);
  const target_summary = buildTargetSummary(
    solverResult.lp_payload?.rows?.target_rows || [],
    analysis
  );

  return {
    ...solverResult,
    optimized_formula: interpreted.formula,
    optimized_formula_text: interpreted.formula_text,
    analyzer: analysis,
    analyzer_summary,
    target_summary
  };
}

module.exports = optimizerEntry;
