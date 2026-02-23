"use strict";

/**
 * core/engine/requirements/LOAD_REQUIREMENTS_PROFILE.cjs
 *
 * v1.0 - Delegates to core/db/requirements/_index/LOAD_REQUIREMENTS.cjs (Option-B capable)
 *
 * Why:
 * - Engine previously used a legacy loader expecting:
 *   core/db/requirements/<species>/<type>/v1/requirements.library.<species>.<type>.v1.json
 * - But new architecture uses:
 *   core/db/requirements/_index/LOAD_REQUIREMENTS.cjs with:
 *   - legacy vendor index (requirements.index.v1.json) AND
 *   - Option-B wrapper + (index+library) per production (meat/layer/breeder)
 */

const { loadRequirementsProfile } = require("../../db/requirements/_index/LOAD_REQUIREMENTS.cjs");

function resolveRequirements(selectors = {}) {
  console.log("[DBG resolveRequirements selectors IN]", selectors);
  // normalize incoming selectors from analyzeFormula payload
  const input = {
    species: selectors.species || "poultry",
    type: selectors.type || "broiler",
    breed: selectors.breed || "generic",
    phase: selectors.phase || "starter",
    region: selectors.region || "global",
    version: selectors.version || "v1",
    production: selectors.production || selectors.production_type || selectors.productionType || ""
  };

  const r = loadRequirementsProfile(input);
  console.log("[DBG resolveRequirements normalized input]", input);
  console.log("[DBG loadRequirementsProfile OUT]", { ok:r?.ok, error:r?.error, message:r?.message, reqKey:r?.reqKey, source:r?.source, details:r?.details, reqFilePath:r?.reqFilePath });

  // Keep the same response contract analyzeFormula expects
  if (!r || r.ok !== true) {
    return {
      ok: false,
      error: r?.error || "REQUIREMENTS_LOAD_FAILED",
      message: r?.message || "Requirements could not be loaded.",
      details: r?.details || null,
      key: r?.key || null,
      reqFilePath: r?.reqFilePath || null,
      source: r?.source || null,
      selectors: input
    };
  }

  return {
    ok: true,
    reqKey: r.reqKey,
    requirements: r.requirements,
    phase: r.phase,
    breed: r.breed,
    source: r.source || null,
    doc_meta: r.doc_meta || null
  };
}

module.exports = { resolveRequirements };


