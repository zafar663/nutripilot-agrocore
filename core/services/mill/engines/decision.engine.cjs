// ============================================================
// Feed Mill Intelligence Engine — Decision Engine
// nutripilot-agrocore/core/services/mill/engines/decision.engine.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../../db/mill/mill.db.js');

// ── ISSUE CATEGORIES ─────────────────────────────────────────
const ISSUE_TYPES = {
  FORMULA_DEVIATION:  'formula_deviation',
  SHRINKAGE:          'shrinkage',
  QC_FAILURE:         'qc_failure',
  DOWNTIME:           'downtime',
  SUPPLIER_VARIATION: 'supplier_variation'
};

// ── RECOMMENDED FIXES ────────────────────────────────────────
const FIXES = {
  formula_deviation_over: {
    action:   'Review batching scale calibration for overused ingredients',
    how:      'Check weigh hopper zero calibration. Verify scale drift on affected ingredient line.',
    priority: 'high',
    effort:   'low'
  },
  formula_deviation_under: {
    action:   'Investigate underuse — check ingredient flow and feeder settings',
    how:      'Inspect feeder gates for blockage. Check ingredient bin level sensors.',
    priority: 'high',
    effort:   'low'
  },
  shrinkage_high: {
    action:   'Investigate stock variance — check for spillage, weighing error, or theft',
    how:      'Conduct physical stock count. Review intake and usage logs for the day.',
    priority: 'medium',
    effort:   'medium'
  },
  qc_moisture_high: {
    action:   'Reduce conditioner steam or increase cooling time',
    how:      'Lower steam pressure by 0.5 bar. Extend cooler residence time by 2 minutes.',
    priority: 'high',
    effort:   'low'
  },
  qc_pdi_low: {
    action:   'Increase conditioner temperature or adjust die specification',
    how:      'Raise conditioning temp by 2-3°C. Check die hole wear — replace if >20% worn.',
    priority: 'medium',
    effort:   'medium'
  },
  qc_fines_high: {
    action:   'Check pellet die condition and cooler settings',
    how:      'Inspect die for wear. Reduce cooler airflow. Check crumbler gap if applicable.',
    priority: 'medium',
    effort:   'medium'
  },
  downtime_mechanical: {
    action:   'Schedule preventive maintenance for affected machine',
    how:      'Log fault in maintenance system. Schedule inspection within 24 hours.',
    priority: 'high',
    effort:   'medium'
  },
  supplier_variation: {
    action:   'Request COA re-analysis from supplier and adjust formula moisture correction',
    how:      'Send lot sample for lab analysis. Compare against contract specification.',
    priority: 'medium',
    effort:   'medium'
  }
};

// ── BUILD ISSUE LIST ─────────────────────────────────────────
// Scans today's data and builds ranked issue list
function buildIssueList(mill_id, date = null) {
  const db = getMillDb();
  const today = date || new Date().toISOString().slice(0, 10);
  const issues = [];

  // ── 1. Formula deviation issues ──────────────────────────
  const deviations = db.prepare(`
    SELECT
      i.ingredient_name,
      i.deviation_pct,
      i.cost_impact,
      i.deviation_flag,
      CASE
        WHEN i.deviation_pct > 0 THEN 'over'
        WHEN i.deviation_pct < 0 THEN 'under'
        ELSE 'exact'
      END as direction,
      b.batch_number,
      b.id as batch_id
    FROM mill_batch_ingredients i
    JOIN mill_batches b ON i.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) = ?
      AND i.actual_kg IS NOT NULL
      AND i.deviation_flag IN ('warn', 'flag')
    ORDER BY ABS(i.cost_impact) DESC
  `).all(mill_id, today);

  for (const dev of deviations) {
    const fixKey = dev.direction === 'over'
      ? 'formula_deviation_over'
      : 'formula_deviation_under';

    const fix = FIXES[fixKey];
    const severity = dev.deviation_flag === 'flag' ? 'high' : 'medium';

    issues.push({
      issue_type:    ISSUE_TYPES.FORMULA_DEVIATION,
      severity,
      title:         `${dev.ingredient_name} ${dev.direction === 'over' ? 'overuse' : 'underuse'} in ${dev.batch_number}`,
      detail:        `${dev.ingredient_name} deviated ${dev.deviation_pct > 0 ? '+' : ''}${dev.deviation_pct}% from formula — cost impact $${Math.abs(dev.cost_impact).toFixed(2)}`,
      dollar_impact: Math.abs(dev.cost_impact),
      batch_id:      dev.batch_id,
      batch_number:  dev.batch_number,
      ingredient:    dev.ingredient_name,
      ...fix
    });
  }

  // ── 2. QC issues ─────────────────────────────────────────
  const qcIssues = db.prepare(`
    SELECT
      q.*,
      b.batch_number,
      b.planned_qty_tons
    FROM mill_qc_results q
    JOIN mill_batches b ON q.batch_id = b.id
    WHERE b.mill_id = ?
      AND DATE(b.created_at) = ?
      AND q.overall_status IN ('warn', 'fail')
  `).all(mill_id, today);

  for (const qc of qcIssues) {
    // Moisture
    if (qc.moisture_pct && qc.moisture_target && qc.moisture_pct > qc.moisture_target) {
      issues.push({
        issue_type:    ISSUE_TYPES.QC_FAILURE,
        severity:      qc.moisture_pct > qc.moisture_target + 1 ? 'high' : 'medium',
        title:         `High moisture in ${qc.batch_number}`,
        detail:        `Moisture ${qc.moisture_pct}% exceeds target ${qc.moisture_target}% — mold risk in storage`,
        dollar_impact: qc.planned_qty_tons * 8,  // estimated rework cost per ton
        batch_id:      qc.batch_id,
        batch_number:  qc.batch_number,
        ...FIXES.qc_moisture_high
      });
    }

    // PDI
    if (qc.pdi_pct && qc.pdi_target && qc.pdi_pct < qc.pdi_target) {
      issues.push({
        issue_type:    ISSUE_TYPES.QC_FAILURE,
        severity:      qc.pdi_pct < qc.pdi_target - 10 ? 'high' : 'medium',
        title:         `Low pellet quality in ${qc.batch_number}`,
        detail:        `PDI ${qc.pdi_pct}% below target ${qc.pdi_target}% — feed may crumble in transit`,
        dollar_impact: qc.planned_qty_tons * 5,
        batch_id:      qc.batch_id,
        batch_number:  qc.batch_number,
        ...FIXES.qc_pdi_low
      });
    }

    // Fines
    if (qc.fines_pct && qc.fines_target && qc.fines_pct > qc.fines_target) {
      issues.push({
        issue_type:    ISSUE_TYPES.QC_FAILURE,
        severity:      'medium',
        title:         `Excessive fines in ${qc.batch_number}`,
        detail:        `Fines ${qc.fines_pct}% above target ${qc.fines_target}%`,
        dollar_impact: qc.planned_qty_tons * 3,
        batch_id:      qc.batch_id,
        batch_number:  qc.batch_number,
        ...FIXES.qc_fines_high
      });
    }
  }

  // ── 3. Shrinkage issues ───────────────────────────────────
  const shrinkage = db.prepare(`
    SELECT
      ingredient_name,
      variance_kg,
      variance_pct,
      shrinkage_value
    FROM mill_inventory
    WHERE mill_id = ?
      AND record_date = ?
      AND ABS(COALESCE(variance_pct, 0)) > 1.0
    ORDER BY ABS(shrinkage_value) DESC
  `).all(mill_id, today);

  for (const s of shrinkage) {
    issues.push({
      issue_type:    ISSUE_TYPES.SHRINKAGE,
      severity:      Math.abs(s.variance_pct) > 3 ? 'high' : 'medium',
      title:         `Stock variance on ${s.ingredient_name}`,
      detail:        `${s.ingredient_name} shows ${s.variance_pct}% variance (${s.variance_kg}kg) — estimated loss $${Math.abs(s.shrinkage_value || 0).toFixed(2)}`,
      dollar_impact: Math.abs(s.shrinkage_value || 0),
      ingredient:    s.ingredient_name,
      ...FIXES.shrinkage_high
    });
  }

  // ── 4. Downtime issues ────────────────────────────────────
  const downtime = db.prepare(`
    SELECT *
    FROM mill_downtime_events
    WHERE mill_id = ?
      AND DATE(started_at) = ?
      AND downtime_type = 'unplanned'
    ORDER BY COALESCE(estimated_cost, 0) DESC
  `).all(mill_id, today);

  for (const dt of downtime) {
    issues.push({
      issue_type:    ISSUE_TYPES.DOWNTIME,
      severity:      (dt.estimated_cost || 0) > 100 ? 'high' : 'medium',
      title:         `Unplanned downtime — ${dt.machine}`,
      detail:        `${dt.machine} stopped for ${dt.duration_minutes} minutes — estimated cost $${(dt.estimated_cost || 0).toFixed(2)}`,
      dollar_impact: dt.estimated_cost || 0,
      machine:       dt.machine,
      ...FIXES.downtime_mechanical
    });
  }

  return issues;
}

// ── RANK ISSUES ───────────────────────────────────────────────
// Sorts by severity then dollar impact
function rankIssues(issues) {
  const severityWeight = { high: 3, medium: 2, low: 1 };

  return issues.sort((a, b) => {
    const severityDiff =
      (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
    if (severityDiff !== 0) return severityDiff;
    return (b.dollar_impact || 0) - (a.dollar_impact || 0);
  });
}

// ── TOP 3 ISSUES ──────────────────────────────────────────────
// The always-visible dashboard widget — top 3 financial drains
function getTop3Issues(mill_id, date = null) {
  const issues  = buildIssueList(mill_id, date);
  const ranked  = rankIssues(issues);
  const top3    = ranked.slice(0, 3);
  const totalImpact = ranked.reduce((s, i) => s + (i.dollar_impact || 0), 0);

  return {
    ok: true,
    mill_id,
    date: date || new Date().toISOString().slice(0, 10),
    total_issues:        ranked.length,
    total_dollar_impact: Math.round(totalImpact * 100) / 100,
    top_3:               top3,
    all_issues:          ranked,
    generated_at:        new Date().toISOString()
  };
}

// ── BEST SINGLE FIX ───────────────────────────────────────────
// The one change with highest ROI right now
function getBestSingleFix(mill_id, date = null) {
  const issues = buildIssueList(mill_id, date);
  const ranked = rankIssues(issues);

  if (ranked.length === 0) {
    return {
      ok: true,
      mill_id,
      no_issues: true,
      message: 'No issues detected today — all batches within tolerance'
    };
  }

  const best = ranked[0];

  return {
    ok: true,
    mill_id,
    best_fix: {
      issue:         best.title,
      detail:        best.detail,
      action:        best.action,
      how:           best.how,
      dollar_impact: best.dollar_impact,
      effort:        best.effort,
      priority:      best.priority
    },
    generated_at: new Date().toISOString()
  };
}

// ── DAILY DECISION SUMMARY ────────────────────────────────────
// Full summary for daily report — issues, fixes, total impact
function getDailyDecisionSummary(mill_id, date = null) {
  const today     = date || new Date().toISOString().slice(0, 10);
  const issues    = buildIssueList(mill_id, today);
  const ranked    = rankIssues(issues);

  const byType = {};
  for (const issue of ranked) {
    if (!byType[issue.issue_type]) byType[issue.issue_type] = [];
    byType[issue.issue_type].push(issue);
  }

  const totalImpact   = ranked.reduce((s, i) => s + (i.dollar_impact || 0), 0);
  const highCount     = ranked.filter(i => i.severity === 'high').length;
  const mediumCount   = ranked.filter(i => i.severity === 'medium').length;

  return {
    ok: true,
    mill_id,
    date:                today,
    total_issues:        ranked.length,
    high_severity:       highCount,
    medium_severity:     mediumCount,
    total_dollar_impact: Math.round(totalImpact * 100) / 100,
    top_3:               ranked.slice(0, 3),
    best_single_fix:     ranked[0] || null,
    issues_by_type:      byType,
    all_issues:          ranked,
    generated_at:        new Date().toISOString()
  };
}

module.exports = {
  buildIssueList,
  rankIssues,
  getTop3Issues,
  getBestSingleFix,
  getDailyDecisionSummary,
  ISSUE_TYPES,
  FIXES
};