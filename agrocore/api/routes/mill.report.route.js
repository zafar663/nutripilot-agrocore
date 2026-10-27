// ============================================================
// Feed Mill Intelligence Engine — Report Route
// nutripilot-agrocore/agrocore/api/routes/mill.report.route.js
// ============================================================

import express from 'express';

// Intelligence engines
import {
  getTop3Issues,
  getBestSingleFix,
  getDailyDecisionSummary
} from '../../../core/services/mill/engines/decision.engine.cjs';

import {
  scoreBatch,
  scoreMillBatches
} from '../../../core/services/mill/engines/batch.risk.engine.cjs';

import {
  analyseIngredientPattern,
  analyseMillDeviationPatterns,
  compareBatches,
  calculatePerformanceScore
} from '../../../core/services/mill/engines/deviation.engine.cjs';

// Report service
import {
  getMillWideProduction,
  getMillMassBalance,
  getDailyProductionReport,
  getDailyFormulaVsActualReport,
  getDailyCostReport,
  getWeeklyTop3LossesReport,
  getWeeklyMillPerformanceReport,
  getWeeklySupplierWatchReport,
  getMonthlyProfitabilityReport,
  getMonthlyLossRecoveryReport,
  getBatchPassport,
  getFullDailyPackage,
  getFullWeeklyPackage,
  getFullMonthlyPackage
} from '../../../core/services/mill/mill.report.service.cjs';
import { hideMillManagerPrices } from '../../../core/services/mill/mill.price.service.cjs';

const router = express.Router();

// ══════════════════════════════════════════════════════════════
// INTELLIGENCE ENGINE ROUTES
// ══════════════════════════════════════════════════════════════

// ── GET /v1/mill/report/top3/:mill_id ────────────────────────
router.get('/top3/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getTop3Issues(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /top3 error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/best-fix/:mill_id ───────────────────
router.get('/best-fix/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getBestSingleFix(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /best-fix error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/daily-decision/:mill_id ──────────────
router.get('/daily-decision/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyDecisionSummary(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /daily-decision error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/daily/:mill_id ──────────────────────
router.get('/daily/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyDecisionSummary(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /daily error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/risk/:batch_id ──────────────────────
router.get('/risk/:batch_id', (req, res) => {
  try {
    const result = scoreBatch(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /risk error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/risk-overview/:mill_id ──────────────
router.get('/risk-overview/:mill_id', (req, res) => {
  try {
    const result = scoreMillBatches(req.params.mill_id);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /risk-overview error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/patterns/:mill_id ───────────────────
router.get('/patterns/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = analyseMillDeviationPatterns(
      req.params.mill_id,
      days ? parseInt(days) : 30
    );
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /patterns error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/ingredient/:mill_id/:ingredient_id ──
router.get('/ingredient/:mill_id/:ingredient_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = analyseIngredientPattern(
      req.params.mill_id,
      req.params.ingredient_id,
      days ? parseInt(days) : 30
    );
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /ingredient error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/report/compare ────────────────────────────
router.post('/compare', (req, res) => {
  try {
    const { batch_ids } = req.body;
    if (!batch_ids || !Array.isArray(batch_ids) || batch_ids.length < 2) {
      return res.status(400).json({
        ok: false,
        error: 'Provide at least 2 batch_ids'
      });
    }
    const result = compareBatches(batch_ids);
    if (!result.ok) return res.status(400).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /compare error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/performance/:batch_id ───────────────
router.get('/performance/:batch_id', (req, res) => {
  try {
    const result = calculatePerformanceScore(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /performance error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// DAILY REPORT ROUTES
// ══════════════════════════════════════════════════════════════

// ── GET /v1/mill/report/mill-production/:mill_id ────────────
// Whole mill: every formula, day | week | month
router.get('/mill-production/:mill_id', (req, res) => {
  try {
    const period = String(req.query.period || 'day');
    const date = req.query.date || null;
    const result = getMillWideProduction(req.params.mill_id, period, date);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /mill-production error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/mass-balance/:mill_id ───────────────
// Whole mill: inbound vs batched vs produced vs dispatched vs book shrink
router.get('/mass-balance/:mill_id', (req, res) => {
  try {
    const period = String(req.query.period || 'day');
    const date = req.query.date || null;
    const result = getMillMassBalance(req.params.mill_id, period, date);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /mass-balance error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/production/:mill_id ─────────────────
router.get('/production/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyProductionReport(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /production error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/formula-vs-actual/:mill_id ──────────
router.get('/formula-vs-actual/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyFormulaVsActualReport(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /formula-vs-actual error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/cost/:mill_id ───────────────────────
router.get('/cost/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyCostReport(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /cost error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/daily-package/:mill_id ──────────────
// All daily reports in one call
router.get('/daily-package/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getFullDailyPackage(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /daily-package error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// WEEKLY REPORT ROUTES
// ══════════════════════════════════════════════════════════════

// ── GET /v1/mill/report/weekly-performance/:mill_id ─────────
router.get('/weekly-performance/:mill_id', (req, res) => {
  try {
    const result = getWeeklyMillPerformanceReport(req.params.mill_id);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /weekly-performance error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/weekly-losses/:mill_id ──────────────
router.get('/weekly-losses/:mill_id', (req, res) => {
  try {
    const result = getWeeklyTop3LossesReport(req.params.mill_id);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /weekly-losses error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/supplier-watch/:mill_id ─────────────
router.get('/supplier-watch/:mill_id', (req, res) => {
  try {
    const result = getWeeklySupplierWatchReport(req.params.mill_id);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /supplier-watch error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/weekly-package/:mill_id ─────────────
// All weekly reports in one call
router.get('/weekly-package/:mill_id', (req, res) => {
  try {
    const result = getFullWeeklyPackage(req.params.mill_id);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /weekly-package error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// MONTHLY REPORT ROUTES
// ══════════════════════════════════════════════════════════════

// ── GET /v1/mill/report/monthly-profitability/:mill_id ──────
router.get('/monthly-profitability/:mill_id', (req, res) => {
  try {
    const { year, month } = req.query;
    const result = getMonthlyProfitabilityReport(
      req.params.mill_id,
      year  ? parseInt(year)  : null,
      month ? parseInt(month) : null
    );
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /monthly-profitability error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/loss-recovery/:mill_id ──────────────
router.get('/loss-recovery/:mill_id', (req, res) => {
  try {
    const { year, month } = req.query;
    const result = getMonthlyLossRecoveryReport(
      req.params.mill_id,
      year  ? parseInt(year)  : null,
      month ? parseInt(month) : null
    );
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /loss-recovery error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/report/monthly-package/:mill_id ────────────
// All monthly reports in one call
router.get('/monthly-package/:mill_id', (req, res) => {
  try {
    const { year, month } = req.query;
    const result = getFullMonthlyPackage(
      req.params.mill_id,
      year  ? parseInt(year)  : null,
      month ? parseInt(month) : null
    );
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /monthly-package error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// BATCH PASSPORT
// ══════════════════════════════════════════════════════════════

// ── GET /v1/mill/report/passport/:batch_id ──────────────────
// Complete audit-ready batch record
router.get('/passport/:batch_id', (req, res) => {
  try {
    const result = getBatchPassport(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[ReportRoute] /passport error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;