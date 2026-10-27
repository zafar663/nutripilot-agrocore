"use strict";

const extractDuals = require("./extractDuals.cjs");

/**
 * Normalize raw solver output into a stable API-style response.
 */
function interpretSolution(rawSolverResult = {}, model = {}, options = {}) {
  return {
    ok: !!rawSolverResult.ok,
    phase: "phase1_lp_payload",
    meta: {
      solver_mode: rawSolverResult.solver_mode || options.solver_mode || "lp",
      solver_status: rawSolverResult.solver_status || "UNKNOWN",
      optimizer_stage: model?.meta?.optimizer_stage || "commercial_schema_ready"
    },
    objective: model?.objective || null,
    objective_value: rawSolverResult.objective_value ?? null,
    formula: rawSolverResult.variable_values || {},
    lp_payload: rawSolverResult.lp_payload || null,
    model_summary: rawSolverResult.model_summary || null,
    coefficient_diagnostics: rawSolverResult.coefficient_diagnostics || null,
    diagnostics: {
      duals: extractDuals(rawSolverResult)
    },
    notes: rawSolverResult.notes || []
  };
}

module.exports = interpretSolution;
