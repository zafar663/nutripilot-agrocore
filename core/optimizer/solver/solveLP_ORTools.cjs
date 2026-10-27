"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function solveLP_ORTools(lpPayload = {}) {
  const scriptPath = path.join(process.cwd(), "core", "optimizer", "python", "ortools_lp_solver.py");

  let lastError = null;

  try {
    const proc = spawnSync("python", [scriptPath], {
      input: JSON.stringify(lpPayload),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.error) {
      lastError = proc.error.message || String(proc.error);
    } else if (proc.status !== 0) {
      lastError = proc.stderr || `Python exited with code ${proc.status}`;
    } else {
      return JSON.parse(proc.stdout);
    }
  } catch (err) {
    lastError = err.message || String(err);
  }

  return {
    ok: false,
    solver_status: "PYTHON_ORTOOLS_EXECUTION_FAILED",
    objective_value: null,
    variable_values: {},
    notes: [lastError || "Unknown OR-Tools execution error."]
  };
}

module.exports = solveLP_ORTools;
