"use strict";

/**
 * Scenario comparison placeholder.
 */
function scenarioCompare(results = []) {
  return {
    compared: Array.isArray(results) ? results.length : 0,
    best: null,
    notes: [
      "Scenario compare scaffold created."
    ]
  };
}

module.exports = scenarioCompare;
