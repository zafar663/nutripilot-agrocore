// ============================================================
// Feed Mill Intelligence Engine — Deviation Route
// nutripilot-agrocore/agrocore/api/routes/mill.deviation.route.js
// ============================================================

import express from 'express';
import {
  calculateBatchDeviation,
  getDeviationHistory,
  detectFormulaDrift,
  getMoneyLeakSummary
} from '../../../core/services/mill/mill.deviation.service.cjs';
import { hideMillManagerPrices } from '../../../core/services/mill/mill.price.service.cjs';

const router = express.Router();

// ── GET /v1/mill/deviation/:batch_id ────────────────────────
// Full deviation report for one batch
router.get('/:batch_id', (req, res) => {
  try {
    const result = calculateBatchDeviation(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[DeviationRoute] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/deviation/history/:mill_id ──────────────────
// Deviation history across recent batches — for trend view
router.get('/history/:mill_id', (req, res) => {
  try {
    const { limit } = req.query;
    const result = getDeviationHistory(
      req.params.mill_id,
      limit ? parseInt(limit) : 30
    );
    return res.json(result);

  } catch (err) {
    console.error('[DeviationRoute] /history error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/deviation/drift/:mill_id ───────────────────
// Formula drift detection — finds systematic batching errors
router.get('/drift/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = detectFormulaDrift(
      req.params.mill_id,
      days ? parseInt(days) : 30
    );
    return res.json(result);

  } catch (err) {
    console.error('[DeviationRoute] /drift error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/deviation/money-leak/:mill_id ──────────────
// Money leak dashboard — total $ lost today / week / month
router.get('/money-leak/:mill_id', (req, res) => {
  try {
    const { period } = req.query;
    const result = getMoneyLeakSummary(
      req.params.mill_id,
      period || 'today'
    );
    return res.json(result);

  } catch (err) {
    console.error('[DeviationRoute] /money-leak error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;