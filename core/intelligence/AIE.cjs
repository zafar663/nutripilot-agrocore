"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/AIE.cjs
 * 
 * Main entry point — unified API for all 4 intelligence levels.
 * Import this in routes and other backend modules.
 */

const { logFormulaEvent, logConstraintAdjustment, logScenarioUsage, logBatchOutcome, logQAEvent } = require("./collectors/event.collector.cjs");
const { logActivity } = require("./collectors/activity.collector.cjs");
const { rebuildCommunityInsights, getCommunityInsights, getTopIngredients, getScenarioStats, getConstraintPatterns } = require("./aggregators/pattern.aggregator.cjs");
const { rebuildOutcomeCorrelations, getNutrientOutcomeCorrelations, getOptimalNutrientRanges } = require("./aggregators/outcome.analyzer.cjs");
const { trainOutcomePredictor, predictOutcome, getScenarioRecommendations, suggestConstraintRelaxation } = require("./ml/model.pipeline.cjs");

// ─────────────────────────────────────────────────────────────
// LEVEL 2: USER FEEDBACK
// ─────────────────────────────────────────────────────────────

/**
 * Called after every formula analysis
 */
function onFormulaAnalyzed(params) {
  const event_id = logFormulaEvent({ ...params, optimization_result: 'analyzed' });
  logActivity({
    source: 'nutrix', kind: 'analyze', user_id: params.user_id,
    species: params.species, mill_id: params.farm_id || params.mill_id,
    title: `Analyzed ${params.species || ''} formula`,
    text: String(params.formula_text || '').slice(0, 4000),
    metadata: { type: params.type, production: params.production }
  });
  _maybeAutoTrain(params.species, params.production);
  return event_id;
}

/**
 * Auto-train ML models every 25 formula events (min 10 samples required).
 * Runs in background — does not block the API response.
 */
function _maybeAutoTrain(species, production) {
  try {
    const { getDb } = require("./db/aie.schema.cjs");
    const db = getDb();
    const { n } = db.prepare(
      "SELECT COUNT(*) as n FROM formula_events WHERE species = ?"
    ).get(species || '');
    if (n >= 10 && n % 25 === 0) {
      setImmediate(() => {
        try {
          trainOutcomePredictor({ species, production });
          console.log(`[AIE] Auto-trained ML model: species=${species} n=${n}`);
        } catch (e) {
          console.error('[AIE] Auto-train error:', e.message);
        }
      });
    }
  } catch (e) {
    console.error('[AIE] _maybeAutoTrain error:', e.message);
  }
}

/**
 * Called after every optimization
 */
function onFormulaOptimized(params) {
  logActivity({
    source: 'nutrix', kind: 'optimize', user_id: params.user_id,
    species: params.species, mill_id: params.farm_id || params.mill_id,
    title: `Optimize ${params.feasible ? 'feasible' : 'infeasible'} ${params.species || ''} ${params.cost_per_ton != null ? 'cost ' + params.cost_per_ton : ''}`,
    text: JSON.stringify({
      feasible: params.feasible, cost_per_ton: params.cost_per_ton,
      mode: params.optimization_mode, production: params.production
    }).slice(0, 2000),
    metadata: { feasible: params.feasible }
  });
  return logFormulaEvent({ ...params, optimization_result: params.feasible ? 'feasible' : 'infeasible' });
}

/**
 * Called when user adjusts a nutrient constraint
 */
function onConstraintAdjusted(params) {
  return logConstraintAdjustment(params);
}

/**
 * Called when user applies a scenario
 */
function onScenarioApplied(params) {
  return logScenarioUsage(params);
}

/**
 * Called after every Q&A question is answered (WhatsApp or Discora)
 */
function onQuestionAsked({ source, user_id, question, answer, query_type, species, breed, phase, nutrient, resolved, latency_ms }) {
  logActivity({
    source: source || "web",
    kind: "ai",
    user_id,
    species,
    title: question,
    text: answer,
    metadata: { query_type, breed, phase, nutrient, resolved, latency_ms }
  });
  return logQAEvent({ source, user_id, question, answer, query_type, species, breed, phase, nutrient, resolved, latency_ms });
}

function onActivity(evt) {
  return logActivity(evt);
}

// ─────────────────────────────────────────────────────────────
// LEVEL 3: OUTCOME LEARNING
// ─────────────────────────────────────────────────────────────

/**
 * Called from FarmPulse when batch outcome is recorded
 */
function onBatchOutcomeRecorded(params) {
  logBatchOutcome(params);
  // Trigger correlation rebuild if enough data
  const { getDb } = require("./db/aie.schema.cjs");
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as n FROM batch_outcomes").get();
  if (count.n >= 5 && count.n % 5 === 0) {
    // Rebuild every 5 new outcomes
    rebuildOutcomeCorrelations();
  }
}

// ─────────────────────────────────────────────────────────────
// INTELLIGENCE QUERIES
// ─────────────────────────────────────────────────────────────

/**
 * Get full intelligence package for a species+production combination.
 * Returns all available insights across all levels.
 */
function getIntelligence({ species, production, body_weight_kg, intake_pct_bw }) {
  const community = getCommunityInsights({ species, production });
  const topIngredients = getTopIngredients({ species, production });
  const scenarioStats = getScenarioStats({ species });
  const constraintPatterns = getConstraintPatterns({ species, production });
  const optimalRanges = getOptimalNutrientRanges({ species, production });
  const recommendations = getScenarioRecommendations({ species, production, body_weight_kg, intake_pct_bw });

  return {
    species,
    production,
    community_insights: {
      constraint_patterns: community,
      top_ingredients: topIngredients,
      scenario_stats: scenarioStats,
      user_adjustments: constraintPatterns
    },
    outcome_insights: {
      optimal_ranges: optimalRanges
    },
    recommendations,
    data_quality: {
      community_sample_count: community.length,
      outcome_ranges_count: optimalRanges.length,
      has_ml_model: recommendations.source_layers.ml != null,
      confidence: recommendations.recommendation_confidence
    }
  };
}

/**
 * Get constraint relaxation suggestions when formula is infeasible
 */
function getRelaxationSuggestions({ species, production, failed_constraints }) {
  return suggestConstraintRelaxation({ species, production, failed_constraints });
}

/**
 * Predict formula outcome (FCR, gain) from nutrient profile
 */
function predictFormulaOutcome({ species, production, nutrient_profile }) {
  return predictOutcome({ species, production, nutrient_profile });
}

// ─────────────────────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────────────────────

/**
 * Rebuild all aggregated data — run nightly or on-demand
 */
function rebuildAllInsights() {
  const results = {};
  try { results.community = rebuildCommunityInsights(); } catch (e) { results.community_error = e.message; }
  try { results.outcomes = rebuildOutcomeCorrelations(); } catch (e) { results.outcomes_error = e.message; }
  return results;
}

/**
 * Train ML models for a species+production
 */
function trainModels({ species, production }) {
  return trainOutcomePredictor({ species, production });
}

/**
 * Get AIE system status
 */
function getStatus() {
  const { getDb } = require("./db/aie.schema.cjs");
  const db = getDb();

  return {
    version: '1.0.0',
    levels: {
      1: { name: 'Expert Rules (NRC)', status: 'active' },
      2: { name: 'User Feedback Learning', status: 'active', data: {
        formula_events: db.prepare("SELECT COUNT(*) as n FROM formula_events").get().n,
        adjustments: db.prepare("SELECT COUNT(*) as n FROM user_constraint_adjustments").get().n,
        community_insights: db.prepare("SELECT COUNT(*) as n FROM community_insights").get().n,
        activity_events: (() => { try { return db.prepare("SELECT COUNT(*) as n FROM activity_events").get().n; } catch { return 0; } })(),
        qa_events: (() => { try { return db.prepare("SELECT COUNT(*) as n FROM qa_events").get().n; } catch { return 0; } })()
      }},
      3: { name: 'Outcome Learning (FarmPulse)', status: 'active', data: {
        batches: db.prepare("SELECT COUNT(*) as n FROM farm_batches").get().n,
        outcomes: db.prepare("SELECT COUNT(*) as n FROM batch_outcomes").get().n,
        correlations: db.prepare("SELECT COUNT(*) as n FROM nutrient_outcome_correlations").get().n
      }},
      4: { name: 'ML Models', status: 'active', data: {
        models: db.prepare("SELECT COUNT(*) as n FROM ml_models WHERE active = 1").get().n,
        predictions: db.prepare("SELECT COUNT(*) as n FROM ml_predictions").get().n
      }}
    }
  };
}

module.exports = {
  // Level 2 — event logging
  onFormulaAnalyzed,
  onFormulaOptimized,
  onConstraintAdjusted,
  onScenarioApplied,
  onQuestionAsked,
  onActivity,
  // Level 3 — outcome learning
  onBatchOutcomeRecorded,
  // Intelligence queries
  getIntelligence,
  getRelaxationSuggestions,
  predictFormulaOutcome,
  // Maintenance
  rebuildAllInsights,
  trainModels,
  getStatus
};
