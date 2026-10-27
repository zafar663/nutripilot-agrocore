"use strict";

/**
 * Optional future chance-constraint layer.
 */
function chanceConstraint(input = {}) {
  return {
    enabled: false,
    status: "DEFERRED_OPTIONAL_LAYER",
    notes: [
      "Chance-constraint support reserved for future implementation."
    ]
  };
}

module.exports = chanceConstraint;
