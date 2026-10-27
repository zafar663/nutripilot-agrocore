// ============================================================
// Feed Mill Intelligence Engine — Downtime Route
// nutripilot-agrocore/agrocore/api/routes/mill.downtime.route.js
// ============================================================

import express from 'express';
import {
  logDowntimeEvent,
  closeDowntimeEvent,
  getActiveDowntime,
  getDowntimeHistory,
  getDowntimeSummaryToday,
  getMaintenanceAlerts
} from '../../../core/services/mill/mill.downtime.service.cjs';

const router = express.Router();

// ── POST /v1/mill/downtime ───────────────────────────────────
// Logs a new downtime event when machine stops
router.post('/', (req, res) => {
  try {
    const {
      mill_id,
      batch_id,
      machine,
      downtime_type,
      started_at,
      cause_category,
      cause_description,
      notes
    } = req.body;

    if (!mill_id || !machine) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id and machine are required'
      });
    }

    const result = logDowntimeEvent({
      mill_id,
      batch_id:          batch_id          || null,
      machine,
      downtime_type:     downtime_type     || 'unplanned',
      started_at:        started_at        || null,
      cause_category:    cause_category    || null,
      cause_description: cause_description || null,
      notes:             notes             || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);

  } catch (err) {
    console.error('[DowntimeRoute] / error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /v1/mill/downtime/:downtime_id/close ───────────────
// Closes a downtime event — calculates duration and cost
router.patch('/:downtime_id/close', (req, res) => {
  try {
    const { downtime_id }                    = req.params;
    const { ended_at, resolved_by, notes }   = req.body;

    const result = closeDowntimeEvent({
      downtime_id,
      ended_at:    ended_at    || null,
      resolved_by: resolved_by || null,
      notes:       notes       || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.json(result);

  } catch (err) {
    console.error('[DowntimeRoute] /close error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/downtime/active/:mill_id ───────────────────
// All currently open downtime events — live running cost
router.get('/active/:mill_id', (req, res) => {
  try {
    const result = getActiveDowntime(req.params.mill_id);
    return res.json(result);
  } catch (err) {
    console.error('[DowntimeRoute] /active error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/downtime/today/:mill_id ────────────────────
// Today's downtime summary — total minutes, cost, events
router.get('/today/:mill_id', (req, res) => {
  try {
    const result = getDowntimeSummaryToday(req.params.mill_id);
    return res.json(result);
  } catch (err) {
    console.error('[DowntimeRoute] /today error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/downtime/history/:mill_id ──────────────────
// Downtime history with machine breakdown and category analysis
router.get('/history/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = getDowntimeHistory(
      req.params.mill_id,
      days ? parseInt(days) : 30
    );
    return res.json(result);
  } catch (err) {
    console.error('[DowntimeRoute] /history error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/downtime/alerts/:mill_id ───────────────────
// Maintenance alerts — machines with repeated downtime
router.get('/alerts/:mill_id', (req, res) => {
  try {
    const { days, min_events } = req.query;
    const result = getMaintenanceAlerts(
      req.params.mill_id,
      days       ? parseInt(days)       : 14,
      min_events ? parseInt(min_events) : 2
    );
    return res.json(result);
  } catch (err) {
    console.error('[DowntimeRoute] /alerts error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;