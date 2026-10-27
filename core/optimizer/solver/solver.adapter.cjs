"use strict";

const solveLP = require("./solveLP.cjs");
const solveMILP = require("./solveMILP.cjs");

async function solverAdapter(model = {}, options = {}) {
  const mode = String(options.solver_mode || "lp").toLowerCase();

  if (mode === "milp") {
    return solveMILP(model, options);
  }

  return solveLP(model, options);
}

module.exports = solverAdapter;
