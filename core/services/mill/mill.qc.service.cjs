// ============================================================
// Feed Mill Intelligence Engine â€” QC Service
// nutripilot-agrocore/core/services/mill/mill.qc.service.cjs
// ============================================================

'use strict';

const { getMillDb } = require('../../db/mill/mill.db.cjs');
const { randomUUID } = require('crypto');

// â”€â”€ QC TARGETS (defaults â€” overridden by mill.qc.targets.v1.json) â”€â”€
const QC_DEFAULTS = {
  moisture: { min: 0,    max: 13.5,  unit: '%' },
  pdi:      { min: 75.0, max: 100.0, unit: '%' },   // pellet durability index
  fines:    { min: 0,    max: 5.0,   unit: '%' },   // fines percentage
  protein:  { min: null, max: null,  unit: '%' }    // set per formula
};

// â”€â”€ EVALUATE QC RESULT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Compares test results against targets
// Returns PASS / WARN / FAIL per parameter and overall
function evaluateQcResult({ moisture_pct, pdi_pct, fines_pct, protein_pct, targets = {} }) {
  const t = {
    moisture: { ...QC_DEFAULTS.moisture, ...( targets.moisture || {}) },
    pdi:      { ...QC_DEFAULTS.pdi,      ...( targets.pdi      || {}) },
    fines:    { ...QC_DEFAULTS.fines,    ...( targets.fines    || {}) },
    protein:  { ...QC_DEFAULTS.protein,  ...( targets.protein  || {}) }
  };

  const results = {};

  // Moisture
  if (moisture_pct !== null && moisture_pct !== undefined) {
    const pass = moisture_pct >= t.moisture.min && moisture_pct <= t.moisture.max;
    const warn = !pass && moisture_pct <= t.moisture.max + 1.0;
    results.moisture = {
      value:   moisture_pct,
      target:  `â‰¤ ${t.moisture.max}%`,
      status:  pass ? 'pass' : warn ? 'warn' : 'fail',
      message: pass ? 'Within target' :
               warn ? `Slightly above target (${t.moisture.max}%)` :
               `Exceeds maximum (${t.moisture.max}%) â€” mold risk`
    };
  }

  // PDI
  if (pdi_pct !== null && pdi_pct !== undefined) {
    const pass = pdi_pct >= t.pdi.min;
    const warn = !pass && pdi_pct >= t.pdi.min - 5;
    results.pdi = {
      value:   pdi_pct,
      target:  `â‰¥ ${t.pdi.min}%`,
      status:  pass ? 'pass' : warn ? 'warn' : 'fail',
      message: pass ? 'Pellet quality acceptable' :
               warn ? `Below target (${t.pdi.min}%) â€” monitor` :
               `Poor pellet quality â€” feed may crumble in transit`
    };
  }

  // Fines
  if (fines_pct !== null && fines_pct !== undefined) {
    const pass = fines_pct <= t.fines.max;
    const warn = !pass && fines_pct <= t.fines.max + 2;
    results.fines = {
      value:   fines_pct,
      target:  `â‰¤ ${t.fines.max}%`,
      status:  pass ? 'pass' : warn ? 'warn' : 'fail',
      message: pass ? 'Fines within acceptable range' :
               warn ? `Fines slightly elevated â€” check conditioner` :
               `Excessive fines â€” review pelleting settings`
    };
  }

  // Protein (if target provided)
  if (protein_pct !== null && protein_pct !== undefined &&
      t.protein.min !== null && t.protein.max !== null) {
    const pass = protein_pct >= t.protein.min && protein_pct <= t.protein.max;
    const warn = !pass && protein_pct >= t.protein.min - 0.5;
    results.protein = {
      value:   protein_pct,
      target:  `${t.protein.min}â€“${t.protein.max}%`,
      status:  pass ? 'pass' : warn ? 'warn' : 'fail',
      message: pass ? 'Protein within specification' :
               warn ? `Protein near lower limit â€” verify batching` :
               `Protein out of specification â€” check formula execution`
    };
  }

  // Overall status â€” worst individual result wins
  const statuses = Object.values(results).map(r => r.status);
  const overall =
    statuses.includes('fail') ? 'fail' :
    statuses.includes('warn') ? 'warn' :
    statuses.length > 0       ? 'pass' :
    'pending';

  // Release recommendation
  const release_recommendation =
    overall === 'pass' ? 'pass'   :
    overall === 'warn' ? 'pass'   :   // warn = pass with note
    overall === 'fail' ? 'hold'   :
    'pending';

  return {
    parameters: results,
    overall_status: overall,
    release_recommendation,
    requires_review: overall === 'fail' || statuses.includes('warn')
  };
}

// â”€â”€ RECORD QC RESULT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Saves QC test result for a batch â€” auto-evaluates on save
function recordQcResult({
  batch_id,
  moisture_pct   = null,
  pdi_pct        = null,
  fines_pct      = null,
  protein_pct    = null,
  particle_size_mm = null,
  targets        = {},
  notes          = null,
  reviewed_by    = null
}) {
  const db = getMillDb();

  // Check for existing QC record
  const existing = db.prepare(
    'SELECT id FROM mill_qc_results WHERE batch_id = ?'
  ).get(batch_id);

  // Run evaluation
  const evaluation = evaluateQcResult({
    moisture_pct, pdi_pct, fines_pct, protein_pct, targets
  });

  const overall_status     = evaluation.overall_status;
  const release_decision   = evaluation.release_recommendation;
  const hold_reason        = overall_status === 'fail'
    ? Object.entries(evaluation.parameters)
        .filter(([, v]) => v.status === 'fail')
        .map(([k, v]) => `${k}: ${v.message}`)
        .join('; ')
    : null;

  const now = new Date().toISOString();

  if (existing) {
    // Update existing record
    db.prepare(`
      UPDATE mill_qc_results SET
        moisture_pct     = ?,
        pdi_pct          = ?,
        fines_pct        = ?,
        protein_pct      = ?,
        particle_size_mm = ?,
        overall_status   = ?,
        hold_reason      = ?,
        release_decision = ?,
        reviewed_by      = ?,
        reviewed_at      = ?,
        notes            = ?
      WHERE batch_id = ?
    `).run(
      moisture_pct, pdi_pct, fines_pct, protein_pct, particle_size_mm,
      overall_status, hold_reason, release_decision,
      reviewed_by, reviewed_by ? now : null, notes,
      batch_id
    );

    console.log(`[MillQC] QC updated for batch ${batch_id} â€” ${overall_status}`);
    return {
      ok: true,
      qc_id: existing.id,
      batch_id,
      overall_status,
      release_decision,
      evaluation
    };

  } else {
    // Insert new record
    const id = randomUUID();
    db.prepare(`
      INSERT INTO mill_qc_results (
        id, batch_id, moisture_pct, moisture_target,
        pdi_pct, pdi_target, fines_pct, fines_target,
        protein_pct, protein_target, particle_size_mm,
        overall_status, hold_reason, release_decision,
        reviewed_by, reviewed_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, batch_id,
      moisture_pct, QC_DEFAULTS.moisture.max,
      pdi_pct,      QC_DEFAULTS.pdi.min,
      fines_pct,    QC_DEFAULTS.fines.max,
      protein_pct,  targets?.protein?.min || null,
      particle_size_mm,
      overall_status, hold_reason, release_decision,
      reviewed_by, reviewed_by ? now : null, notes
    );

    console.log(`[MillQC] QC recorded for batch ${batch_id} â€” ${overall_status}`);
    return {
      ok: true,
      qc_id: id,
      batch_id,
      overall_status,
      release_decision,
      evaluation
    };
  }
}

// â”€â”€ OVERRIDE QC DECISION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Allows mill manager to manually override hold/release
// All overrides are logged with reason â€” full audit trail
function overrideQcDecision(batch_id, decision, override_reason, reviewed_by) {
  const db = getMillDb();

  if (decision === 'release') decision = 'pass';
  const valid = ['pass', 'rework', 'reject', 'hold'];
  if (!valid.includes(decision)) {
    return { ok: false, error: `Invalid decision: ${decision}` };
  }

  const qc = db.prepare(
    'SELECT * FROM mill_qc_results WHERE batch_id = ?'
  ).get(batch_id);

  if (!qc) return { ok: false, error: 'No QC record found for this batch' };

  const now = new Date().toISOString();
  const override_note = `OVERRIDE by ${reviewed_by} at ${now}: ${override_reason}`;
  const updated_notes = qc.notes
    ? `${qc.notes} | ${override_note}`
    : override_note;

  db.prepare(`
    UPDATE mill_qc_results SET
      release_decision = ?,
      overall_status   = CASE WHEN ? = 'pass' THEN 'pass' ELSE overall_status END,
      reviewed_by      = ?,
      reviewed_at      = ?,
      notes            = ?
    WHERE batch_id = ?
  `).run(decision, decision, reviewed_by, now, updated_notes, batch_id);

  console.log(`[MillQC] Decision override: batch ${batch_id} â†’ ${decision} by ${reviewed_by}`);
  return {
    ok: true,
    batch_id,
    decision,
    overridden_by: reviewed_by,
    override_reason,
    overridden_at: now
  };
}

// â”€â”€ GET QC SUMMARY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// QC trend across recent batches â€” for weekly report
function getQcTrend(mill_id, days = 30) {
  const db = getMillDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = db.prepare(`
    SELECT
      q.*,
      b.batch_number,
      b.planned_qty_tons,
      s.formula_name,
      s.feed_type
    FROM mill_qc_results q
    JOIN mill_batches b     ON q.batch_id = b.id
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    WHERE b.mill_id = ?
      AND b.created_at >= ?
    ORDER BY b.created_at DESC
  `).all(mill_id, cutoff.toISOString());

  const total      = rows.length;
  const passed     = rows.filter(r => r.overall_status === 'pass').length;
  const warned     = rows.filter(r => r.overall_status === 'warn').length;
  const failed     = rows.filter(r => r.overall_status === 'fail').length;
  const held       = rows.filter(r => r.release_decision === 'hold').length;

  const avgMoisture = rows
    .filter(r => r.moisture_pct !== null)
    .reduce((s, r, _, a) => s + r.moisture_pct / a.length, 0);

  const avgPdi = rows
    .filter(r => r.pdi_pct !== null)
    .reduce((s, r, _, a) => s + r.pdi_pct / a.length, 0);

  const paramCard = (key, valueKey, label, targetLabel) => {
    const testedRows = rows.filter(r => r[valueKey] != null);
    let pass = 0, warn = 0, fail = 0;
    const values = [];
    for (const r of testedRows) {
      values.push(Number(r[valueKey]));
      const ev = evaluateQcResult({
        moisture_pct: r.moisture_pct,
        pdi_pct: r.pdi_pct,
        fines_pct: r.fines_pct,
        protein_pct: r.protein_pct,
      });
      const st = ev.parameters?.[key]?.status;
      if (st === 'fail') fail += 1;
      else if (st === 'warn') warn += 1;
      else if (st === 'pass') pass += 1;
    }
    const avg = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null;
    return {
      key,
      label,
      target_label: targetLabel,
      tested: testedRows.length,
      pass,
      warn,
      fail,
      pass_rate: testedRows.length ? Math.round((pass / testedRows.length) * 100) : null,
      avg,
      min: values.length ? Math.round(Math.min(...values) * 100) / 100 : null,
      max: values.length ? Math.round(Math.max(...values) * 100) / 100 : null,
    };
  };

  const parameter_breakdown = [
    paramCard('moisture', 'moisture_pct', 'Moisture %', '≤ 13.5%'),
    paramCard('pdi', 'pdi_pct', 'PDI %', '≥ 75%'),
    paramCard('fines', 'fines_pct', 'Fines %', '≤ 5%'),
    paramCard('protein', 'protein_pct', 'Protein %', 'formula spec'),
  ];

  return {
    ok: true,
    mill_id,
    period_days: days,
    total_batches_tested: total,
    passed, warned, failed, held,
    pass_rate: total > 0 ? Math.round((passed / total) * 100) : null,
    avg_moisture_pct: Math.round(avgMoisture * 100) / 100 || null,
    avg_pdi_pct:      Math.round(avgPdi      * 100) / 100 || null,
    parameter_breakdown,
    batches: rows,
    generated_at: new Date().toISOString()
  };
}

// â”€â”€ GET PENDING QC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Batches that are completed but not yet QC reviewed
function getPendingQc(mill_id) {
  const db = getMillDb();

  const rows = db.prepare(`
    SELECT b.id, b.batch_number, b.planned_qty_tons,
           b.completed_at, s.formula_name, s.feed_type,
           q.overall_status as qc_status
    FROM mill_batches b
    JOIN mill_formula_snapshots s ON b.formula_snapshot_id = s.id
    LEFT JOIN mill_qc_results q ON b.id = q.batch_id
    WHERE b.mill_id = ?
      AND b.status = 'completed'
      AND (q.id IS NULL OR q.overall_status = 'pending')
    ORDER BY b.completed_at ASC
  `).all(mill_id);

  return {
    ok: true,
    mill_id,
    pending_count: rows.length,
    batches: rows
  };
}

function getQcForBatch(batch_id) {
  const db = getMillDb();
  const qc = db.prepare('SELECT * FROM mill_qc_results WHERE batch_id = ?').get(batch_id);
  return { ok: true, batch_id, qc: qc || null };
}

function assertQcAllowsDispatch(batch_id) {
  const db = getMillDb();
  const qc = db.prepare('SELECT * FROM mill_qc_results WHERE batch_id = ?').get(batch_id);
  if (!qc) {
    return { ok: false, error: 'QC not recorded — cannot dispatch this batch' };
  }
  if (qc.release_decision === 'hold' || qc.release_decision === 'reject' || qc.release_decision === 'rework') {
    return { ok: false, error: `QC ${qc.release_decision} — release the batch before dispatch` };
  }
  if (qc.overall_status === 'fail' || qc.overall_status === 'pending') {
    return { ok: false, error: `QC status is ${qc.overall_status} — cannot dispatch until released` };
  }
  return { ok: true, qc };
}

function applyImageQc(batch_id, analysis) {
  if (!batch_id || !analysis) return { ok: false, error: 'batch_id required' };
  const db = getMillDb();
  const existing = db.prepare('SELECT * FROM mill_qc_results WHERE batch_id = ?').get(batch_id);
  const grade = String(analysis.overall_grade || '').toUpperCase();
  const imgNote = `[Image QC ${grade || 'n/a'}] ${analysis.summary || ''}`.trim();
  const notes = existing?.notes ? `${existing.notes}\n${imgNote}` : imgNote;
  const recorded = recordQcResult({
    batch_id,
    moisture_pct: existing?.moisture_pct ?? null,
    pdi_pct: analysis.estimated_pdi_pct ?? existing?.pdi_pct ?? null,
    fines_pct: analysis.estimated_fines_pct ?? existing?.fines_pct ?? null,
    protein_pct: existing?.protein_pct ?? null,
    particle_size_mm: existing?.particle_size_mm ?? null,
    notes,
    reviewed_by: existing?.reviewed_by || 'image-qc'
  });
  if (grade === 'FAIL' && recorded.ok) {
    db.prepare(`
      UPDATE mill_qc_results SET
        overall_status = 'fail',
        release_decision = 'hold',
        hold_reason = COALESCE(hold_reason, '') || CASE WHEN hold_reason IS NULL OR hold_reason = '' THEN 'Image QC FAIL' ELSE '; Image QC FAIL' END
      WHERE batch_id = ?
    `).run(batch_id);
    recorded.overall_status = 'fail';
    recorded.release_decision = 'hold';
  }
  return recorded;
}

module.exports = {
  evaluateQcResult,
  recordQcResult,
  overrideQcDecision,
  getQcTrend,
  getPendingQc,
  getQcForBatch,
  assertQcAllowsDispatch,
  applyImageQc,
  QC_DEFAULTS
};