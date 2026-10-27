"use strict";

/**
 * MILP placeholder for future hybrid extension.
 */
async function solveMILP(model = {}, options = {}) {
  return {
    ok: false,
    solver_mode: "milp",
    solver_status: "NOT_IMPLEMENTED",
    notes: [
      "MILP is reserved for later hybrid/commercial rules."
    ]
  };
}

module.exports = solveMILP;
