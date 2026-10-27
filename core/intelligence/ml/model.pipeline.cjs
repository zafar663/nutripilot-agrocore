"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/ml/model.pipeline.cjs
 * 
 * Level 4: ML model pipeline for scenario recommendations and outcome prediction.
 * Uses gradient boosting (decision tree ensemble) implemented in pure JS.
 * No Python dependency — runs directly in Node.js.
 * 
 * Models:
 * 1. ScenarioRecommender — predicts optimal nutrient constraints
 * 2. OutcomePredictor — predicts FCR/gain from formula profile
 * 3. ConstraintOptimizer — suggests relaxation when infeasible
 */

const { getDb } = require("../db/aie.schema.cjs");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const MODEL_DIR = path.join(__dirname, "../../../data/models");
if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────
// GRADIENT BOOSTING — Pure JS implementation
// Simple but effective for tabular data
// ─────────────────────────────────────────────────────────────

class DecisionStump {
  constructor() {
    this.feature = null;
    this.threshold = null;
    this.left = null;
    this.right = null;
  }

  fit(X, residuals) {
    let bestLoss = Infinity;
    const n = X.length;
    const nFeatures = X[0].length;

    for (let f = 0; f < nFeatures; f++) {
      const values = [...new Set(X.map(x => x[f]))].sort((a, b) => a - b);
      for (let i = 0; i < values.length - 1; i++) {
        const threshold = (values[i] + values[i + 1]) / 2;
        const left = [], right = [];
        for (let j = 0; j < n; j++) {
          (X[j][f] <= threshold ? left : right).push(residuals[j]);
        }
        if (!left.length || !right.length) continue;
        const loss = mse(left) * left.length + mse(right) * right.length;
        if (loss < bestLoss) {
          bestLoss = loss;
          this.feature = f;
          this.threshold = threshold;
          this.left = mean(left);
          this.right = mean(right);
        }
      }
    }
  }

  predict(x) {
    return x[this.feature] <= this.threshold ? this.left : this.right;
  }
}

class GradientBoostingRegressor {
  constructor({ n_estimators = 100, learning_rate = 0.1, min_samples = 10 } = {}) {
    this.n_estimators = n_estimators;
    this.learning_rate = learning_rate;
    this.min_samples = min_samples;
    this.trees = [];
    this.base_prediction = null;
    this.feature_names = [];
  }

  fit(X, y) {
    if (X.length < this.min_samples) return false;
    this.base_prediction = mean(y);
    let predictions = new Array(X.length).fill(this.base_prediction);

    for (let i = 0; i < this.n_estimators; i++) {
      const residuals = y.map((yi, j) => yi - predictions[j]);
      const tree = new DecisionStump();
      tree.fit(X, residuals);
      this.trees.push(tree);
      predictions = predictions.map((p, j) => p + this.learning_rate * tree.predict(X[j]));
    }
    return true;
  }

  predict(x) {
    if (!this.trees.length) return this.base_prediction;
    return this.trees.reduce(
      (pred, tree) => pred + this.learning_rate * tree.predict(x),
      this.base_prediction
    );
  }

  serialize() {
    return JSON.stringify({
      base_prediction: this.base_prediction,
      learning_rate: this.learning_rate,
      feature_names: this.feature_names,
      trees: this.trees.map(t => ({
        feature: t.feature,
        threshold: t.threshold,
        left: t.left,
        right: t.right
      }))
    });
  }

  static deserialize(data) {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    const model = new GradientBoostingRegressor();
    model.base_prediction = obj.base_prediction;
    model.learning_rate = obj.learning_rate;
    model.feature_names = obj.feature_names || [];
    model.trees = obj.trees.map(t => {
      const tree = new DecisionStump();
      tree.feature = t.feature;
      tree.threshold = t.threshold;
      tree.left = t.left;
      tree.right = t.right;
      return tree;
    });
    return model;
  }
}

// ─────────────────────────────────────────────────────────────
// OUTCOME PREDICTOR — predicts FCR from formula nutrients
// ─────────────────────────────────────────────────────────────

const OUTCOME_FEATURES = [
  'cp_pct', 'de_mcal_kg', 'ndf_pct', 'adf_pct',
  'ca_pct', 'p_pct', 'lys_pct', 'nsc_pct',
  'ee_pct', 'cf_pct', 'mg_pct'
];

function buildOutcomePredictorDataset({ species, production }) {
  const db = getDb();

  const rows = db.prepare(`
    SELECT 
      bo.fcr, bo.avg_daily_gain_kg, bo.health_score,
      bo.mortality_pct, bf.event_id
    FROM batch_outcomes bo
    JOIN batch_formulas bf ON bo.batch_id = bf.batch_id
    JOIN formula_events fe ON bf.event_id = fe.id
    WHERE fe.species = ? AND fe.production = ?
      AND bo.fcr IS NOT NULL
      AND bf.event_id IS NOT NULL
  `).all(species, production);

  if (rows.length < 10) return null;

  const getNutrients = db.prepare(`
    SELECT nutrient_key, actual_value FROM formula_nutrients WHERE event_id = ?
  `);

  const X = [], y_fcr = [], y_gain = [];

  for (const row of rows) {
    const nutrients = getNutrients.all(row.event_id);
    const nutrientMap = {};
    for (const n of nutrients) nutrientMap[n.nutrient_key] = n.actual_value;

    const features = OUTCOME_FEATURES.map(f => nutrientMap[f] ?? 0);
    X.push(features);
    y_fcr.push(row.fcr);
    if (row.avg_daily_gain_kg != null) y_gain.push(row.avg_daily_gain_kg);
  }

  return { X, y_fcr, y_gain, n: rows.length };
}

function trainOutcomePredictor({ species, production }) {
  const db = getDb();
  const dataset = buildOutcomePredictorDataset({ species, production });

  if (!dataset) {
    return { ok: false, reason: 'insufficient_data' };
  }

  const model = new GradientBoostingRegressor({
    n_estimators: 50,
    learning_rate: 0.1,
    min_samples: 10
  });
  model.feature_names = OUTCOME_FEATURES;

  const trained = model.fit(dataset.X, dataset.y_fcr);
  if (!trained) return { ok: false, reason: 'training_failed' };

  const modelId = randomUUID();
  const modelPath = path.join(MODEL_DIR, `outcome_${species}_${production}_${modelId}.json`);
  fs.writeFileSync(modelPath, model.serialize());

  // Deactivate old models
  db.prepare(`
    UPDATE ml_models SET active = 0
    WHERE model_type = 'outcome_predictor' AND species = ? AND production = ?
  `).run(species, production);

  // Register new model
  db.prepare(`
    INSERT INTO ml_models (id, model_type, species, production, version, trained_at, 
      sample_count, features, model_path, active)
    VALUES (?, 'outcome_predictor', ?, ?, ?, datetime('now'), ?, ?, ?, 1)
  `).run(
    modelId, species, production,
    `v${Date.now()}`, dataset.n,
    JSON.stringify(OUTCOME_FEATURES), modelPath
  );

  return { ok: true, model_id: modelId, samples: dataset.n };
}

function predictOutcome({ species, production, nutrient_profile }) {
  const db = getDb();

  const modelRecord = db.prepare(`
    SELECT * FROM ml_models
    WHERE model_type = 'outcome_predictor' AND species = ? AND production = ? AND active = 1
    ORDER BY trained_at DESC LIMIT 1
  `).get(species, production);

  if (!modelRecord?.model_path) {
    return { ok: false, reason: 'no_model', message: 'Not enough data yet to predict outcomes' };
  }

  try {
    const modelData = fs.readFileSync(modelRecord.model_path, 'utf8');
    const model = GradientBoostingRegressor.deserialize(modelData);
    const features = OUTCOME_FEATURES.map(f => nutrient_profile[f] ?? 0);
    const predicted_fcr = model.predict(features);

    return {
      ok: true,
      predicted_fcr: Number(predicted_fcr.toFixed(3)),
      confidence: Math.min(1, modelRecord.sample_count / 50),
      model_version: modelRecord.version,
      sample_basis: modelRecord.sample_count
    };
  } catch (err) {
    return { ok: false, reason: 'prediction_error', message: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// SCENARIO RECOMMENDER — suggests optimal constraints
// ─────────────────────────────────────────────────────────────

const SCENARIO_FEATURES = [
  'body_weight_kg', 'intake_pct_bw',
  'cp_pct_target', 'de_mcal_kg_target',
  'ndf_pct_target', 'ca_pct_target'
];

function getScenarioRecommendations({ species, production, body_weight_kg, intake_pct_bw }) {
  const db = getDb();

  // Layer 1: NRC targets (always the base)
  const base = { source: 'nrc', confidence: 1.0 };

  // Layer 2: Community insights
  const insights = db.prepare(`
    SELECT nutrient_key, field, p25, p50, p75, sample_count
    FROM community_insights
    WHERE species = ? AND production = ?
      AND sample_count >= 5
    ORDER BY sample_count DESC
  `).all(species, production);

  const community = {};
  for (const insight of insights) {
    if (!community[insight.nutrient_key]) community[insight.nutrient_key] = {};
    community[insight.nutrient_key][insight.field] = {
      p25: insight.p25,
      p50: insight.p50,
      p75: insight.p75,
      sample_count: insight.sample_count
    };
  }

  // Layer 3: Outcome-based optimal ranges
  const optimalRanges = db.prepare(`
    SELECT nutrient_key, nutrient_range_min, nutrient_range_max,
      avg_fcr, avg_daily_gain, sample_count, confidence
    FROM nutrient_outcome_correlations
    WHERE species = ? AND production = ?
      AND confidence >= 0.3
      AND sample_count >= 5
    ORDER BY avg_fcr ASC
  `).all(species, production);

  const outcomeOptimal = {};
  for (const range of optimalRanges) {
    if (!outcomeOptimal[range.nutrient_key]) {
      outcomeOptimal[range.nutrient_key] = range; // best FCR range
    }
  }

  // Layer 4: ML prediction (if model exists)
  const mlModel = db.prepare(`
    SELECT * FROM ml_models
    WHERE model_type = 'scenario_recommender' 
      AND species = ? AND production = ? AND active = 1
    ORDER BY trained_at DESC LIMIT 1
  `).get(species, production);

  return {
    source_layers: {
      nrc: base,
      community: { constraints: community, total_insights: insights.length },
      outcome: { optimal_ranges: outcomeOptimal },
      ml: mlModel ? { model_version: mlModel.version, sample_basis: mlModel.sample_count } : null
    },
    recommendation_confidence: calculateConfidence(insights.length, Object.keys(outcomeOptimal).length),
    generated_at: new Date().toISOString()
  };
}

function calculateConfidence(communityInsights, outcomeRanges) {
  if (communityInsights === 0 && outcomeRanges === 0) return 0.1; // NRC only
  if (communityInsights < 10) return 0.3;
  if (outcomeRanges === 0) return 0.5;
  if (outcomeRanges < 5) return 0.7;
  return 0.9;
}

// ─────────────────────────────────────────────────────────────
// CONSTRAINT OPTIMIZER — suggests relaxation when infeasible
// ─────────────────────────────────────────────────────────────

function suggestConstraintRelaxation({ species, production, failed_constraints }) {
  const db = getDb();
  const suggestions = [];

  for (const constraint of failed_constraints) {
    const { key, actual, min, max, status } = constraint;

    // Check community data for this constraint
    const community = db.prepare(`
      SELECT field, p50, p75, p90, sample_count
      FROM community_insights
      WHERE species = ? AND production = ? AND nutrient_key = ?
    `).all(species, production, key);

    const communityMap = {};
    for (const c of community) communityMap[c.field] = c;

    if (status === 'FAIL' && min != null) {
      const communityMin = communityMap['min'];
      suggestions.push({
        nutrient_key: key,
        action: 'relax_min',
        current_min: min,
        suggested_min: communityMin ? communityMin.p25 : min * 0.85,
        reason: communityMin
          ? `Community data shows 25% of nutritionists use MIN=${communityMin.p25.toFixed(3)} for this nutrient`
          : `Relax MIN by 15% to improve feasibility`,
        confidence: communityMin ? Math.min(1, communityMin.sample_count / 20) : 0.3
      });
    }

    if (status === 'HIGH' && max != null) {
      const communityMax = communityMap['max'];
      suggestions.push({
        nutrient_key: key,
        action: 'relax_max',
        current_max: max,
        suggested_max: communityMax ? communityMax.p75 : max * 1.15,
        reason: communityMax
          ? `Community data shows 75% of nutritionists allow MAX=${communityMax.p75.toFixed(3)}`
          : `Relax MAX by 15% to improve feasibility`,
        confidence: communityMax ? Math.min(1, communityMax.sample_count / 20) : 0.3
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

// Helpers
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function mse(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

module.exports = {
  trainOutcomePredictor,
  predictOutcome,
  getScenarioRecommendations,
  suggestConstraintRelaxation,
  GradientBoostingRegressor,
  OUTCOME_FEATURES
};
