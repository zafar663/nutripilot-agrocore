// ============================================================
// Feed Mill Intelligence Engine — Deviation Engine
// nutripilot-agrocore/core/services/mill/engines/deviation.engine.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../../db/mill/mill.db.js');

// ── PATTERN THRESHOLDS ───────────────────────────────────────
const PATTERN_THRESHOLDS = {
  drift_consistency:    0.70,  // 70% same direction = drifting
  drift_min_batches:    3,     // minimum batches to detect drift
  outlier_zscore:       2.0,   // z-score threshold for outlier detection
  volatility_cv:        0.15,  // coefficient of variation > 15% = volatile
  min_batches_trend:    5      // minimum batches for trend analysis
};

// ── CALCULATE Z-SCORE ────────────────────────────────────────
function zScore(value, mean, stdDev) {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

// ── STANDARD DEVIATION ───────────────────────────────────────
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ── INGREDIENT DEVIATION PATTERN ────────────────────────────
// Analyses deviation pattern for one ingredient across batches
function analyseIngredientPattern(mill_id, ingredient_id, days = 30) {
  const db = getMillDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const records = db.prepare(`
    SELECT
      i.deviation_pct,
      i.cost_impact,
      i.actual_kg,
      i.planned_kg,
      i.ingredient_name,
      b.batch_number,
      b.created_at
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND i.ingredient_id = ?
      AND DATE(b.created_at) >= ?
      AND i.actual_kg IS NOT NULL
    ORDER BY b.created_at ASC
  `).all(mill_id, ingredient_id, cutoff.toISOString().slice(0, 10));

  if (records.length < 2) {
    return {
      ingredient_id,
      ingredient_name: records[0]?.ingredient_name || ingredient_id,
      insufficient_data: true,
      batch_count: records.length,
      message: `Need at least 2 batches — only ${records.length} found`
    };
  }

  const deviations  = records.map(r => r.deviation_pct || 0);
  const costImpacts = records.map(r => r.cost_impact   || 0);

  const meanDeviation   = deviations.reduce((s, v) => s + v, 0) / deviations.length;
  const stdDevDeviation = stdDev(deviations);
  const totalCostImpact = costImpacts.reduce((s, v) => s + v, 0);

  // Drift detection
  const overCount   = deviations.filter(d => d > 0).length;
  const underCount  = deviations.filter(d => d < 0).length;
  const exactCount  = deviations.filter(d => d === 0).length;
  const consistency = Math.max(overCount, underCount) / deviations.length;

  const isDrifting = (
    consistency >= PATTERN_THRESHOLDS.drift_consistency &&
    records.length >= PATTERN_THRESHOLDS.drift_min_batches &&
    Math.abs(meanDeviation) > 2.0
  );

  const driftDirection =
    overCount > underCount  ? 'consistently_over'  :
    underCount > overCount  ? 'consistently_under' :
    'variable';

  // Volatility — coefficient of variation
  const cv = meanDeviation !== 0
    ? Math.abs(stdDevDeviation / meanDeviation)
    : stdDevDeviation;
  const isVolatile = cv > PATTERN_THRESHOLDS.volatility_cv;

  // Outlier detection
  const outliers = records.filter(r => {
    const z = Math.abs(zScore(r.deviation_pct || 0, meanDeviation, stdDevDeviation));
    return z > PATTERN_THRESHOLDS.outlier_zscore;
  });

  // Trend — is deviation getting worse over time?
  let trend = 'stable';
  if (records.length >= PATTERN_THRESHOLDS.min_batches_trend) {
    const firstHalf  = deviations.slice(0, Math.floor(deviations.length / 2));
    const secondHalf = deviations.slice(Math.floor(deviations.length / 2));
    const firstMean  = firstHalf.reduce((s, v)  => s + v, 0) / firstHalf.length;
    const secondMean = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const trendDelta = secondMean - firstMean;

    if (Math.abs(trendDelta) > 1.5) {
      trend = trendDelta > 0 ? 'worsening_over' : 'worsening_under';
    }
  }

  // Severity classification
  const severity =
    (isDrifting && Math.abs(meanDeviation) > 5) ? 'critical' :
    isDrifting                                   ? 'high'     :
    isVolatile                                   ? 'medium'   :
    'low';

  return {
    ingredient_id,
    ingredient_name:    records[0].ingredient_name,
    batch_count:        records.length,
    period_days:        days,

    // Deviation statistics
    mean_deviation_pct: Math.round(meanDeviation   * 100) / 100,
    std_dev_pct:        Math.round(stdDevDeviation * 100) / 100,
    min_deviation_pct:  Math.round(Math.min(...deviations) * 100) / 100,
    max_deviation_pct:  Math.round(Math.max(...deviations) * 100) / 100,
    total_cost_impact:  Math.round(totalCostImpact * 100) / 100,

    // Pattern analysis
    drift: {
      is_drifting:       isDrifting,
      direction:         driftDirection,
      consistency_ratio: Math.round(consistency * 100) / 100,
      over_count:        overCount,
      under_count:       underCount,
      exact_count:       exactCount
    },

    volatility: {
      is_volatile:             isVolatile,
      coefficient_of_variation: Math.round(cv * 100) / 100
    },

    outliers: {
      count:   outliers.length,
      batches: outliers.map(o => o.batch_number)
    },

    trend,
    severity,

    // Raw data for charting
    history: records.map(r => ({
      batch_number:  r.batch_number,
      deviation_pct: r.deviation_pct,
      cost_impact:   r.cost_impact,
      date:          r.created_at.slice(0, 10)
    }))
  };
}

// ── MILL-WIDE DEVIATION ANALYSIS ─────────────────────────────
// Runs pattern analysis across all ingredients at a mill
function analyseMillDeviationPatterns(mill_id, days = 30) {
  const db = getMillDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Get all ingredients active in this period
  const ingredients = db.prepare(`
    SELECT DISTINCT i.ingredient_id, i.ingredient_name
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) >= ?
      AND i.actual_kg IS NOT NULL
    ORDER BY i.ingredient_name
  `).all(mill_id, cutoff.toISOString().slice(0, 10));

  if (ingredients.length === 0) {
    return {
      ok: true,
      mill_id,
      message: 'No batch data found for this period',
      ingredients_analysed: 0
    };
  }

  // Analyse each ingredient
  const analyses = ingredients.map(ing =>
    analyseIngredientPattern(mill_id, ing.ingredient_id, days)
  );

  // Filter out insufficient data
  const valid = analyses.filter(a => !a.insufficient_data);

  // Summary counts
  const drifting   = valid.filter(a => a.drift.is_drifting);
  const volatile   = valid.filter(a => a.volatility.is_volatile);
  const critical   = valid.filter(a => a.severity === 'critical');
  const withImpact = valid
    .filter(a => Math.abs(a.total_cost_impact) > 0)
    .sort((a, b) => Math.abs(b.total_cost_impact) - Math.abs(a.total_cost_impact));

  // Total financial impact of all deviations
  const totalImpact = valid.reduce(
    (s, a) => s + Math.abs(a.total_cost_impact || 0), 0
  );

  return {
    ok: true,
    mill_id,
    period_days:             days,
    ingredients_analysed:    valid.length,
    drifting_count:          drifting.length,
    volatile_count:          volatile.length,
    critical_count:          critical.length,
    total_financial_impact:  Math.round(totalImpact * 100) / 100,

    // Priority lists
    drifting_ingredients:    drifting.sort((a, b) =>
      Math.abs(b.total_cost_impact) - Math.abs(a.total_cost_impact)
    ),
    volatile_ingredients:    volatile,
    top_cost_impact:         withImpact.slice(0, 5),

    // All analyses
    all_ingredients:         valid,

    generated_at: new Date().toISOString()
  };
}

// ── BATCH COMPARISON ─────────────────────────────────────────
// Side-by-side comparison of multiple batches
// Identifies what made best batches succeed
function compareBatches(batch_ids) {
  const db = getMillDb();

  if (!batch_ids || batch_ids.length < 2) {
    return { ok: false, error: 'Provide at least 2 batch IDs to compare' };
  }

  const placeholders = batch_ids.map(() => '?').join(',');

  const batches = db.prepare(`
    SELECT
      b.id, b.batch_number, b.status,
      b.planned_qty_tons, b.actual_qty_tons,
      s.formula_name, s.species, s.feed_type,
      COUNT(i.id)                                        as ingredient_count,
      AVG(ABS(COALESCE(i.deviation_pct, 0)))             as avg_deviation_pct,
      SUM(COALESCE(i.cost_impact, 0))                    as total_cost_impact,
      SUM(CASE WHEN i.deviation_flag = 'flag' THEN 1 ELSE 0 END) as flagged_count,
      SUM(CASE WHEN i.deviation_flag = 'warn' THEN 1 ELSE 0 END) as warned_count
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    LEFT JOIN mill_batch_ingredients i ON b.id = i.batch_id
    WHERE b.id IN (${placeholders})
    GROUP BY b.id
    ORDER BY avg_deviation_pct ASC
  `).all(...batch_ids);

  if (batches.length === 0) {
    return { ok: false, error: 'No batches found for provided IDs' };
  }

  // Best and worst batch
  const best  = batches[0];
  const worst = batches[batches.length - 1];

  // Per-ingredient comparison across batches
  const ingredientComparison = db.prepare(`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      b.batch_number,
      i.planned_kg,
      i.actual_kg,
      i.deviation_pct,
      i.cost_impact,
      i.deviation_flag
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.id IN (${placeholders})
    ORDER BY i.ingredient_name, b.created_at
  `).all(...batch_ids);

  // Group by ingredient
  const byIngredient = {};
  for (const row of ingredientComparison) {
    if (!byIngredient[row.ingredient_id]) {
      byIngredient[row.ingredient_id] = {
        ingredient_id:   row.ingredient_id,
        ingredient_name: row.ingredient_name,
        batches:         []
      };
    }
    byIngredient[row.ingredient_id].batches.push({
      batch_number:  row.batch_number,
      planned_kg:    row.planned_kg,
      actual_kg:     row.actual_kg,
      deviation_pct: row.deviation_pct,
      cost_impact:   row.cost_impact,
      flag:          row.deviation_flag
    });
  }

  return {
    ok: true,
    batch_count:          batches.length,
    best_batch:           best.batch_number,
    worst_batch:          worst.batch_number,
    best_avg_deviation:   Math.round(best.avg_deviation_pct  * 100) / 100,
    worst_avg_deviation:  Math.round(worst.avg_deviation_pct * 100) / 100,
    batches,
    ingredient_comparison: Object.values(byIngredient),
    generated_at:          new Date().toISOString()
  };
}

// ── PERFORMANCE SCORE ────────────────────────────────────────
// Single 0-100 score per batch combining FCR proxy metrics
// Used for batch ranking and farm correlation
function calculatePerformanceScore(batch_id) {
  const db = getMillDb();

  const batch = db.prepare(`
    SELECT b.*, s.formula_name
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  const ingredients = db.prepare(`
    SELECT deviation_pct, deviation_flag, cost_impact
    FROM mill_batch_ingredients
    WHERE batch_id = ? AND actual_kg IS NOT NULL
  `).all(batch_id);

  const qc = db.prepare(
    'SELECT * FROM mill_qc_results WHERE batch_id = ?'
  ).get(batch_id);

  if (ingredients.length === 0) {
    return {
      ok: true,
      batch_id,
      performance_score: null,
      message: 'No actuals recorded — score unavailable'
    };
  }

  // Score components
  let score = 100;

  // Deviation penalty
  const flagged = ingredients.filter(i => i.deviation_flag === 'flag').length;
  const warned  = ingredients.filter(i => i.deviation_flag === 'warn').length;
  score -= flagged * 10;
  score -= warned  * 4;

  // QC penalty
  if (qc) {
    if (qc.overall_status === 'fail') score -= 20;
    if (qc.overall_status === 'warn') score -= 8;
  } else {
    score -= 5; // penalty for no QC
  }

  // Cost impact penalty
  const totalImpact = ingredients.reduce(
    (s, i) => s + Math.abs(i.cost_impact || 0), 0
  );
  score -= Math.min(totalImpact / 10, 10);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade =
    score >= 90 ? 'A' :
    score >= 80 ? 'B' :
    score >= 70 ? 'C' :
    score >= 60 ? 'D' : 'F';

  return {
    ok: true,
    batch_id,
    batch_number:      batch.batch_number,
    formula_name:      batch.formula_name,
    performance_score: score,
    grade,
    breakdown: {
      started_at:    100,
      deviation_penalty: -(flagged * 10 + warned * 4),
      qc_penalty:    qc ? (qc.overall_status === 'fail' ? -20 : qc.overall_status === 'warn' ? -8 : 0) : -5,
      cost_penalty:  -Math.min(totalImpact / 10, 10)
    },
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  analyseIngredientPattern,
  analyseMillDeviationPatterns,
  compareBatches,
  calculatePerformanceScore,
  PATTERN_THRESHOLDS
};
