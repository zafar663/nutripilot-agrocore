"use strict";

/**
 * Build objective definition.
 * Phase 1 commercial schema:
 * least_cost is active
 * repair/scenario reserved structurally
 */
function buildObjective(payload = {}, options = {}) {
  const optimizerMode = String(options.optimizer_mode || "least_cost").toLowerCase();

  const out = {
    type: "minimize",
    metric: "cost",
    optimizer_mode: optimizerMode,
    terms: [],
    notes: []
  };

  if (optimizerMode === "repair") {
    out.metric = "cost_plus_repair_penalty";
    out.notes.push("Repair mode structure reserved; penalty math not implemented yet.");
    return out;
  }

  if (optimizerMode === "scenario") {
    out.metric = "scenario_cost";
    out.notes.push("Scenario mode structure reserved; scenario engine not implemented yet.");
    return out;
  }

  out.metric = "cost";
  out.notes.push("Commercial schema v1 objective = least_cost.");
  return out;
}

module.exports = buildObjective;
