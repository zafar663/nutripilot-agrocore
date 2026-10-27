// ============================================================
// Feed Mill Intelligence Engine â€” Deviation Service
// nutripilot-agrocore/core/services/mill/mill.deviation.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');

// â”€â”€ DEVIATION THRESHOLDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// These drive the PASS / WARN / FLAG classification
const THRESHOLDS = {
  pass:          2.0,   // <= 2% deviation â€” acceptable
  warn:          5.0,   // > 2% and <= 5% â€” monitor
  flag:          5.0,   // > 5% â€” investigate immediately
  cost_warn:     10.0,  // cost impact > $10 per ingredient â€” warn
  cost_flag:     50.0   // cost impact > $50 per ingredient â€” flag
};

// â”€â”€ CLASSIFY DEVIATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function classifyDeviation(deviation_pct, cost_impact) {
  const abs = Math.abs(deviation_pct || 0);
  const absCost = Math.abs(cost_impact || 0);

  if (abs > THRESHOLDS.flag || absCost > THRESHOLDS.cost_flag) return 'flag';
  if (abs > THRESHOLDS.pass || absCost > THRESHOLDS.cost_warn) return 'warn';
  return 'pass';
}

// â”€â”€ CALCULATE BATCH DEVIATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Core function â€” runs after actuals are recorded
// Produces full deviation report for one batch
function calculateBatchDeviation(batch_id) {
  try { require('./mill.price.service.cjs').applyPricesToBatch(batch_id); } catch (_e) {}
  const db = getMillDb();

  // Get batch + snapshot
  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.feed_type, s.species,
           s.cost_per_ton as planned_cost_per_ton,
           s.released_by, s.released_at
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  // Get all ingredients with actuals
  const ingredients = db.prepare(`
    SELECT * FROM mill_batch_ingredients
    WHERE batch_id = ?
    ORDER BY ABS(COALESCE(deviation_pct, 0)) DESC
  `).all(batch_id);

  // Check actuals exist
  const withActuals = ingredients.filter(i => i.actual_kg !== null);
  if (withActuals.length === 0) {
    return { ok: false, error: 'No actuals recorded yet for this batch' };
  }

  // â”€â”€ Per-ingredient analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ingredientAnalysis = ingredients.map(ing => {
    const deviation_pct = ing.deviation_pct || 0;
    const cost_impact   = ing.cost_impact   || 0;
    const classification = classifyDeviation(deviation_pct, cost_impact);
    const direction = deviation_pct > 0 ? 'over' : deviation_pct < 0 ? 'under' : 'exact';

    return {
      ingredient_id:   ing.ingredient_id,
      ingredient_name: ing.ingredient_name,
      planned_kg:      ing.planned_kg,
      actual_kg:       ing.actual_kg,
      deviation_kg:    ing.actual_kg !== null ? ing.actual_kg - ing.planned_kg : null,
      deviation_pct:   deviation_pct,
      direction,
      cost_impact,
      classification,
      planned_cost:    ing.planned_cost,
      actual_cost:     ing.actual_cost
    };
  });

  // â”€â”€ Batch-level summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const totalPlannedKg    = ingredients.reduce((s, i) => s + (i.planned_kg   || 0), 0);
  const totalActualKg     = withActuals.reduce((s, i) => s + (i.actual_kg    || 0), 0);
  const totalPlannedCost  = ingredients.reduce((s, i) => s + (i.planned_cost || 0), 0);
  const totalActualCost   = withActuals.reduce((s, i) => s + (i.actual_cost  || 0), 0);
  const totalCostImpact   = totalActualCost - totalPlannedCost;

  const flagged = ingredientAnalysis.filter(i => i.classification === 'flag');
  const warned  = ingredientAnalysis.filter(i => i.classification === 'warn');
  const passed  = ingredientAnalysis.filter(i => i.classification === 'pass');

  // â”€â”€ Overall batch classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let overall_status;
  if (flagged.length > 0)       overall_status = 'flag';
  else if (warned.length > 0)   overall_status = 'warn';
  else                          overall_status = 'pass';

  // â”€â”€ Top losses (for money leak dashboard) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const top_losses = ingredientAnalysis
    .filter(i => i.cost_impact < 0)
    .sort((a, b) => a.cost_impact - b.cost_impact)
    .slice(0, 3);

  // â”€â”€ Top overuse (cost overrun) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const top_overuse = ingredientAnalysis
    .filter(i => i.cost_impact > 0)
    .sort((a, b) => b.cost_impact - a.cost_impact)
    .slice(0, 3);

  // â”€â”€ Save deviation summary to batch record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  db.prepare(`
    UPDATE mill_batches
    SET updated_at = datetime('now')
    WHERE id = ?
  `).run(batch_id);

  const report = {
    ok: true,
    batch_id,
    batch_number:       batch.batch_number,
    formula_name:       batch.formula_name,
    species:            batch.species,
    feed_type:          batch.feed_type,
    released_by:        batch.released_by,

    // Quantity summary
    planned_qty_tons:   batch.planned_qty_tons,
    actual_qty_tons:    batch.actual_qty_tons,
    total_planned_kg:   Math.round(totalPlannedKg * 100) / 100,
    total_actual_kg:    Math.round(totalActualKg  * 100) / 100,

    // Cost summary
    total_planned_cost: Math.round(totalPlannedCost * 100) / 100,
    total_actual_cost:  Math.round(totalActualCost  * 100) / 100,
    total_cost_impact:  Math.round(totalCostImpact  * 100) / 100,
    cost_direction:     totalCostImpact > 0 ? 'over_budget' : totalCostImpact < 0 ? 'under_budget' : 'on_budget',

    // Classification
    overall_status,
    flagged_count:      flagged.length,
    warned_count:       warned.length,
    passed_count:       passed.length,
    ingredients_total:  ingredients.length,
    actuals_recorded:   withActuals.length,

    // Ingredients detail
    ingredients:        ingredientAnalysis,

    // Money leak highlights
    top_losses,
    top_overuse,

    // Timestamps
    generated_at: new Date().toISOString()
  };

  return report;
}

// â”€â”€ BATCH DEVIATION HISTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns deviation summaries across multiple batches
// Used for trend analysis and batch comparison
function getDeviationHistory(mill_id, limit = 30) {
  const db = getMillDb();

  const batches = db.prepare(`
    SELECT b.id, b.batch_number, b.formula_snapshot_id,
           b.planned_qty_tons, b.actual_qty_tons,
           b.status, b.completed_at,
           s.formula_name, s.species, s.feed_type,
           COUNT(i.id)                                    as ingredient_count,
           SUM(CASE WHEN i.deviation_flag = 'flag' THEN 1 ELSE 0 END) as flagged_count,
           SUM(CASE WHEN i.deviation_flag = 'warn' THEN 1 ELSE 0 END) as warned_count,
           SUM(COALESCE(i.cost_impact, 0))                as total_cost_impact,
           AVG(ABS(COALESCE(i.deviation_pct, 0)))         as avg_deviation_pct
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    LEFT JOIN mill_batch_ingredients i ON b.id = i.batch_id
    WHERE b.mill_id = ?
      AND b.status IN ('completed', 'reviewed', 'dispatched')
    GROUP BY b.id
    ORDER BY b.completed_at DESC
    LIMIT ?
  `).all(mill_id, limit);

  return {
    ok: true,
    mill_id,
    batches,
    count: batches.length
  };
}

// â”€â”€ FORMULA DRIFT DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detects if the same ingredient is consistently over or under
// across multiple batches â€” systematic batching error
function detectFormulaDrift(mill_id, days = 30) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const driftData = db.prepare(`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      COUNT(i.id)                           as batch_count,
      AVG(i.deviation_pct)                  as avg_deviation_pct,
      SUM(i.cost_impact)                    as total_cost_impact,
      SUM(CASE WHEN i.deviation_pct > 0 THEN 1 ELSE 0 END) as over_count,
      SUM(CASE WHEN i.deviation_pct < 0 THEN 1 ELSE 0 END) as under_count,
      MIN(i.deviation_pct)                  as min_deviation,
      MAX(i.deviation_pct)                  as max_deviation
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND b.created_at >= ?
      AND i.actual_kg IS NOT NULL
    GROUP BY i.ingredient_id, i.ingredient_name
    HAVING batch_count >= 3
    ORDER BY ABS(avg_deviation_pct) DESC
  `).all(mill_id, cutoff.toISOString());

  // Flag ingredients with consistent drift direction
  const driftFlags = driftData.map(row => {
    const consistency = row.batch_count > 0
      ? Math.max(row.over_count, row.under_count) / row.batch_count
      : 0;

    const drift_direction =
      row.over_count  > row.under_count ? 'consistently_over'  :
      row.under_count > row.over_count  ? 'consistently_under' :
      'variable';

    const drift_severity =
      Math.abs(row.avg_deviation_pct) > THRESHOLDS.flag ? 'high'   :
      Math.abs(row.avg_deviation_pct) > THRESHOLDS.pass ? 'medium' :
      'low';

    return {
      ...row,
      consistency_ratio:  Math.round(consistency * 100) / 100,
      drift_direction,
      drift_severity,
      is_drifting: consistency >= 0.7 && Math.abs(row.avg_deviation_pct) > THRESHOLDS.pass
    };
  });

  const drifting = driftFlags.filter(d => d.is_drifting);

  return {
    ok: true,
    mill_id,
    period_days: days,
    ingredients_analysed: driftData.length,
    drifting_count: drifting.length,
    drifting_ingredients: drifting,
    all_ingredients: driftFlags,
    generated_at: new Date().toISOString()
  };
}

// â”€â”€ MONEY LEAK SUMMARY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Top-level dashboard number â€” total $ lost today / this week
function getMoneyLeakSummary(mill_id, period = 'today') {
  const db = getMillDb();

  let cutoff;
  const now = new Date();

  if (period === 'today') {
    const d = new Date();
    cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00.000Z`;
  } else if (period === 'week') {
    cutoff = new Date(now.setDate(now.getDate() - 7)).toISOString();
  } else if (period === 'month') {
    cutoff = new Date(now.setDate(now.getDate() - 30)).toISOString();
  } else {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }

  // Use DATE() comparison to handle SQLite datetime format differences
  const cutoffDate = cutoff.slice(0, 10); // YYYY-MM-DD

  const result = db.prepare(`
    SELECT
      COUNT(DISTINCT b.id)                              as batch_count,
      SUM(CASE WHEN i.cost_impact > 0 THEN i.cost_impact ELSE 0 END) as total_overuse_cost,
      SUM(CASE WHEN i.cost_impact < 0 THEN ABS(i.cost_impact) ELSE 0 END) as total_underuse_savings,
      SUM(ABS(COALESCE(i.cost_impact, 0)))              as total_deviation_cost,
      COUNT(CASE WHEN i.deviation_flag = 'flag' THEN 1 END) as total_flags,
      COUNT(CASE WHEN i.deviation_flag = 'warn' THEN 1 END) as total_warns
    FROM mill_batches b
    JOIN mill_batch_ingredients i ON b.id = i.batch_id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) >= ?
      AND i.actual_kg IS NOT NULL
  `).get(mill_id, cutoffDate);

  let top_leaks = [];
  try {
    top_leaks = db.prepare(`
      SELECT COALESCE(i.ingredient_name, i.ingredient_id) as ingredient_name,
        ROUND(SUM(CASE WHEN i.cost_impact > 0 THEN i.cost_impact ELSE 0 END), 2) as overuse_cost,
        ROUND(AVG(i.deviation_pct), 2) as avg_deviation_pct
      FROM mill_batches b
      JOIN mill_batch_ingredients i ON b.id = i.batch_id
      WHERE b.mill_id = ?
        AND DATE(b.created_at) >= ?
        AND i.actual_kg IS NOT NULL
      GROUP BY COALESCE(i.ingredient_id, i.ingredient_name)
      HAVING SUM(CASE WHEN i.cost_impact > 0 THEN i.cost_impact ELSE 0 END) > 0
          OR ABS(AVG(COALESCE(i.deviation_pct, 0))) >= 0.5
      ORDER BY SUM(CASE WHEN i.cost_impact > 0 THEN i.cost_impact ELSE 0 END) DESC,
               ABS(AVG(COALESCE(i.deviation_pct, 0))) DESC
      LIMIT 6
    `).all(mill_id, cutoffDate);
  } catch (_e) { top_leaks = []; }

  return {
    ok: true,
    mill_id,
    period,
    cutoff,
    ...result,
    top_leaks,
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  calculateBatchDeviation,
  getDeviationHistory,
  detectFormulaDrift,
  getMoneyLeakSummary,
  classifyDeviation,
  THRESHOLDS
};