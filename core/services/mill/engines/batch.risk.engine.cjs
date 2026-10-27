// ============================================================
// Feed Mill Intelligence Engine — Batch Risk Engine
// nutripilot-agrocore/core/services/mill/engines/batch.risk.engine.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../../db/mill/mill.db.js');

// ── RISK SCORING WEIGHTS ─────────────────────────────────────
// Total must equal 100
const WEIGHTS = {
  formula_deviation: 35,  // how accurately was formula executed
  qc_results:        30,  // pellet quality, moisture, fines
  ingredient_flags:  20,  // flagged ingredients in batch
  supplier_risk:     15   // lot quality variation from suppliers
};

// ── SCORE BANDS ──────────────────────────────────────────────
const RISK_BANDS = {
  low:     { min: 80, max: 100, label: 'Low risk',    color: 'green'  },
  medium:  { min: 60, max: 79,  label: 'Medium risk', color: 'amber'  },
  high:    { min: 40, max: 59,  label: 'High risk',   color: 'orange' },
  critical:{ min: 0,  max: 39,  label: 'Critical',    color: 'red'    }
};

// ── GET RISK BAND ─────────────────────────────────────────────
function getRiskBand(score) {
  if (score >= 80) return RISK_BANDS.low;
  if (score >= 60) return RISK_BANDS.medium;
  if (score >= 40) return RISK_BANDS.high;
  return RISK_BANDS.critical;
}

// ── SCORE FORMULA DEVIATION ──────────────────────────────────
// 35 points — based on deviation severity across all ingredients
function scoreFormulaDeviation(batch_id, db) {
  const ingredients = db.prepare(`
    SELECT deviation_pct, deviation_flag, cost_impact
    FROM mill_batch_ingredients
    WHERE batch_id = ? AND actual_kg IS NOT NULL
  `).all(batch_id);

  if (ingredients.length === 0) {
    return { score: WEIGHTS.formula_deviation, detail: 'No actuals recorded', penalty: 0 };
  }

  const flagged = ingredients.filter(i => i.deviation_flag === 'flag').length;
  const warned  = ingredients.filter(i => i.deviation_flag === 'warn').length;
  const total   = ingredients.length;

  const avgDeviation = ingredients.reduce(
    (s, i) => s + Math.abs(i.deviation_pct || 0), 0
  ) / total;

  // Penalty calculation
  let penalty = 0;
  penalty += flagged * 8    // each flagged ingredient = -8 points
  penalty += warned  * 3    // each warned ingredient  = -3 points
  penalty += Math.min(avgDeviation * 1.5, 10) // avg deviation penalty max 10

  const score = Math.max(0, WEIGHTS.formula_deviation - penalty);

  return {
    score:         Math.round(score * 10) / 10,
    max:           WEIGHTS.formula_deviation,
    flagged_count: flagged,
    warned_count:  warned,
    avg_deviation: Math.round(avgDeviation * 100) / 100,
    penalty:       Math.round(penalty * 10) / 10,
    detail:        `${flagged} flagged, ${warned} warned across ${total} ingredients`
  };
}

// ── SCORE QC RESULTS ─────────────────────────────────────────
// 30 points — based on QC test results
function scoreQcResults(batch_id, db) {
  const qc = db.prepare(`
    SELECT * FROM mill_qc_results WHERE batch_id = ?
  `).get(batch_id);

  // No QC recorded yet — partial penalty
  if (!qc) {
    return {
      score:   WEIGHTS.qc_results * 0.6,
      max:     WEIGHTS.qc_results,
      status:  'not_tested',
      penalty: WEIGHTS.qc_results * 0.4,
      detail:  'QC not yet recorded — score estimated'
    };
  }

  let penalty = 0;

  // Overall status penalty
  if (qc.overall_status === 'fail') penalty += 20;
  else if (qc.overall_status === 'warn') penalty += 8;

  // Moisture penalty
  if (qc.moisture_pct && qc.moisture_target) {
    const moistureOver = qc.moisture_pct - qc.moisture_target;
    if (moistureOver > 2)      penalty += 10;
    else if (moistureOver > 0) penalty += 5;
  }

  // PDI penalty
  if (qc.pdi_pct && qc.pdi_target) {
    const pdiUnder = qc.pdi_target - qc.pdi_pct;
    if (pdiUnder > 10)      penalty += 8;
    else if (pdiUnder > 5)  penalty += 4;
    else if (pdiUnder > 0)  penalty += 2;
  }

  // Fines penalty
  if (qc.fines_pct && qc.fines_target) {
    const finesOver = qc.fines_pct - qc.fines_target;
    if (finesOver > 5)      penalty += 6;
    else if (finesOver > 2) penalty += 3;
  }

  const score = Math.max(0, WEIGHTS.qc_results - penalty);

  return {
    score:           Math.round(score * 10) / 10,
    max:             WEIGHTS.qc_results,
    overall_status:  qc.overall_status,
    moisture_pct:    qc.moisture_pct,
    pdi_pct:         qc.pdi_pct,
    fines_pct:       qc.fines_pct,
    penalty:         Math.round(penalty * 10) / 10,
    detail:          `QC status: ${qc.overall_status}`
  };
}

// ── SCORE INGREDIENT FLAGS ───────────────────────────────────
// 20 points — based on flagged ingredients and cost impact
function scoreIngredientFlags(batch_id, db) {
  const ingredients = db.prepare(`
    SELECT deviation_flag, cost_impact, ingredient_name
    FROM mill_batch_ingredients
    WHERE batch_id = ?
  `).all(batch_id);

  if (ingredients.length === 0) {
    return {
      score:  WEIGHTS.ingredient_flags,
      max:    WEIGHTS.ingredient_flags,
      detail: 'No ingredients recorded'
    };
  }

  const flagged     = ingredients.filter(i => i.deviation_flag === 'flag');
  const totalImpact = ingredients.reduce(
    (s, i) => s + Math.abs(i.cost_impact || 0), 0
  );

  let penalty = 0;
  penalty += flagged.length * 6           // each flag = -6 points
  penalty += Math.min(totalImpact / 20, 8) // cost impact penalty max 8

  const score = Math.max(0, WEIGHTS.ingredient_flags - penalty);

  return {
    score:          Math.round(score * 10) / 10,
    max:            WEIGHTS.ingredient_flags,
    flagged_count:  flagged.length,
    total_impact:   Math.round(totalImpact * 100) / 100,
    flagged_names:  flagged.map(i => i.ingredient_name),
    penalty:        Math.round(penalty * 10) / 10,
    detail:         `${flagged.length} flagged ingredients, $${totalImpact.toFixed(2)} total impact`
  };
}

// ── SCORE SUPPLIER RISK ──────────────────────────────────────
// 15 points — based on supplier lot QC status
function scoreSupplierRisk(batch_id, db) {
  // Get ingredients used in this batch
  const ingredients = db.prepare(`
    SELECT DISTINCT ingredient_id
    FROM mill_batch_ingredients
    WHERE batch_id = ?
  `).all(batch_id);

  if (ingredients.length === 0) {
    return {
      score:  WEIGHTS.supplier_risk,
      max:    WEIGHTS.supplier_risk,
      detail: 'No supplier data available'
    };
  }

  // Check supplier lot status for these ingredients
  const ingredientIds = ingredients.map(i => `'${i.ingredient_id}'`).join(',');

  const lots = db.prepare(`
    SELECT qc_status, ingredient_name
    FROM mill_supplier_lots
    WHERE ingredient_id IN (${ingredientIds})
    ORDER BY received_date DESC
  `).all();

  if (lots.length === 0) {
    return {
      score:   WEIGHTS.supplier_risk * 0.8,
      max:     WEIGHTS.supplier_risk,
      detail:  'No supplier lot data — partial score',
      penalty: WEIGHTS.supplier_risk * 0.2
    };
  }

  const rejected    = lots.filter(l => l.qc_status === 'rejected').length;
  const quarantine  = lots.filter(l => l.qc_status === 'quarantine').length;
  const pending     = lots.filter(l => l.qc_status === 'pending').length;

  let penalty = 0;
  penalty += rejected   * 8
  penalty += quarantine * 5
  penalty += pending    * 1

  const score = Math.max(0, WEIGHTS.supplier_risk - penalty);

  return {
    score:          Math.round(score * 10) / 10,
    max:            WEIGHTS.supplier_risk,
    lots_checked:   lots.length,
    rejected_count: rejected,
    quarantine_count: quarantine,
    pending_count:  pending,
    penalty:        Math.round(penalty * 10) / 10,
    detail:         `${lots.length} lots checked — ${rejected} rejected, ${quarantine} quarantine`
  };
}

// ── SCORE BATCH ───────────────────────────────────────────────
// Master function — combines all four scoring dimensions
function scoreBatch(batch_id) {
  const db = getMillDb();

  // Verify batch exists
  const batch = db.prepare(`
    SELECT b.*, s.formula_name, s.species, s.feed_type
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.id = ?
  `).get(batch_id);

  if (!batch) return { ok: false, error: 'Batch not found' };

  // Score each dimension
  const deviationScore  = scoreFormulaDeviation(batch_id, db);
  const qcScore         = scoreQcResults(batch_id, db);
  const flagScore       = scoreIngredientFlags(batch_id, db);
  const supplierScore   = scoreSupplierRisk(batch_id, db);

  // Total score
  const totalScore = Math.round(
    (deviationScore.score + qcScore.score +
     flagScore.score + supplierScore.score) * 10
  ) / 10;

  const riskBand = getRiskBand(totalScore);

  // Release recommendation
  const release_recommendation =
    totalScore >= 80 ? 'clear_for_dispatch'      :
    totalScore >= 60 ? 'dispatch_with_note'       :
    totalScore >= 40 ? 'hold_pending_review'      :
    'hold_do_not_dispatch';

  // Key risks for summary
  const key_risks = [];
  if (deviationScore.flagged_count > 0) {
    key_risks.push(`${deviationScore.flagged_count} ingredient(s) outside tolerance`);
  }
  if (qcScore.overall_status === 'fail') {
    key_risks.push('QC failure recorded');
  }
  if (qcScore.overall_status === 'warn') {
    key_risks.push('QC warning recorded');
  }
  if (flagScore.flagged_count > 0) {
    key_risks.push(`Flagged: ${flagScore.flagged_names.join(', ')}`);
  }
  if (supplierScore.rejected_count > 0) {
    key_risks.push(`${supplierScore.rejected_count} supplier lot(s) rejected`);
  }

  return {
    ok: true,
    batch_id,
    batch_number:           batch.batch_number,
    formula_name:           batch.formula_name,
    species:                batch.species,
    feed_type:              batch.feed_type,
    status:                 batch.status,

    // Overall score
    risk_score:             totalScore,
    risk_band:              riskBand.label,
    risk_color:             riskBand.color,
    release_recommendation,
    key_risks,

    // Dimension scores
    dimensions: {
      formula_deviation: deviationScore,
      qc_results:        qcScore,
      ingredient_flags:  flagScore,
      supplier_risk:     supplierScore
    },

    // Weights used
    weights: WEIGHTS,

    generated_at: new Date().toISOString()
  };
}

// ── SCORE ALL PENDING BATCHES ────────────────────────────────
// Scores all completed/reviewed batches for a mill
// Used for batch queue risk overview
function scoreMillBatches(mill_id) {
  const db = getMillDb();

  const batches = db.prepare(`
    SELECT id, batch_number
    FROM mill_batches
    WHERE mill_id = ?
      AND status IN ('completed', 'reviewed')
    ORDER BY created_at DESC
    LIMIT 20
  `).all(mill_id);

  if (batches.length === 0) {
    return {
      ok: true,
      mill_id,
      message: 'No completed batches to score',
      scores: []
    };
  }

  const scores = batches.map(b => {
    const result = scoreBatch(b.id);
    return {
      batch_id:               b.id,
      batch_number:           b.batch_number,
      risk_score:             result.risk_score,
      risk_band:              result.risk_band,
      risk_color:             result.risk_color,
      release_recommendation: result.release_recommendation,
      key_risks:              result.key_risks
    };
  });

  // Sort by risk score ascending — most risky first
  scores.sort((a, b) => a.risk_score - b.risk_score);

  const critical = scores.filter(s => s.risk_score < 40).length;
  const high     = scores.filter(s => s.risk_score >= 40 && s.risk_score < 60).length;
  const medium   = scores.filter(s => s.risk_score >= 60 && s.risk_score < 80).length;
  const low      = scores.filter(s => s.risk_score >= 80).length;

  return {
    ok: true,
    mill_id,
    total_scored:    scores.length,
    critical_count:  critical,
    high_count:      high,
    medium_count:    medium,
    low_count:       low,
    scores,
    generated_at:    new Date().toISOString()
  };
}

module.exports = {
  scoreBatch,
  scoreMillBatches,
  getRiskBand,
  WEIGHTS,
  RISK_BANDS
};