// ============================================================
// Feed Mill Intelligence Engine — Dispatch Route
// nutripilot-agrocore/agrocore/api/routes/mill.dispatch.route.js
// ============================================================

import express from 'express';
import {
  createDispatchRecord,
  updateDeliveryStatus,
  getDispatchQueue,
  getDispatchHistory,
  getBatchTraceability,
  logComplaint,
  getOpenComplaints
} from '../../../core/services/mill/mill.dispatch.service.cjs';

const router = express.Router();

// ── POST /v1/mill/dispatch ───────────────────────────────────
// Creates a dispatch record and marks batch as dispatched
router.post('/', (req, res) => {
  try {
    const {
      batch_id,
      mill_id,
      customer_id,
      farm_id,
      customer_name,
      quantity_tons,
      mill_mass,
      leftover_mass,
      silo_bin,
      vehicle_id,
      driver_name,
      notes,
      lot_numbers
    } = req.body;

    if (!batch_id || !mill_id || !customer_name || (quantity_tons == null && mill_mass == null)) {
      return res.status(400).json({
        ok: false,
        error: 'batch_id, mill_id, customer_name and mill_mass (or quantity_tons) are required'
      });
    }

    const result = createDispatchRecord({
      batch_id,
      mill_id,
      customer_id:   customer_id   || null,
      farm_id:       farm_id       || null,
      customer_name,
      quantity_tons: quantity_tons != null ? Number(quantity_tons) : null,
      mill_mass:     mill_mass != null ? Number(mill_mass) : null,
      leftover_mass: leftover_mass != null ? Number(leftover_mass) : null,
      silo_bin:      silo_bin      || null,
      vehicle_id:    vehicle_id    || null,
      driver_name:   driver_name   || null,
      lot_numbers:   lot_numbers   || null,
      notes:         notes         || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);

  } catch (err) {
    console.error('[DispatchRoute] / error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /v1/mill/dispatch/:dispatch_id/status ─────────────
// Updates delivery status — in_transit, delivered, failed
router.patch('/:dispatch_id/status', (req, res) => {
  try {
    const { dispatch_id }          = req.params;
    const { status, delivered_at } = req.body;

    if (!status) {
      return res.status(400).json({ ok: false, error: 'status is required' });
    }

    const result = updateDeliveryStatus(dispatch_id, status, delivered_at || null);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);

  } catch (err) {
    console.error('[DispatchRoute] /status error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/dispatch/queue/:mill_id ─────────────────────
// Pending and in-transit dispatches
router.get('/queue/:mill_id', (req, res) => {
  try {
    const result = getDispatchQueue(req.params.mill_id);
    return res.json(result);
  } catch (err) {
    console.error('[DispatchRoute] /queue error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/dispatch/history/:mill_id ───────────────────
// Dispatch history across date range
router.get('/history/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = getDispatchHistory(
      req.params.mill_id,
      days ? parseInt(days) : 30
    );
    return res.json(result);
  } catch (err) {
    console.error('[DispatchRoute] /history error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/dispatch/trace/:batch_id ───────────────────
// Full batch traceability — where did this batch go
router.get('/trace/:batch_id', (req, res) => {
  try {
    const result = getBatchTraceability(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[DispatchRoute] /trace error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/dispatch/complaint ────────────────────────
// Logs a farm or customer complaint linked to a batch
router.post('/complaint', (req, res) => {
  try {
    const {
      batch_id,
      dispatch_id,
      farm_id,
      customer_name,
      complaint_type,
      severity,
      description
    } = req.body;

    if (!customer_name || !complaint_type || !description) {
      return res.status(400).json({
        ok: false,
        error: 'customer_name, complaint_type and description are required'
      });
    }

    const result = logComplaint({
      batch_id:      batch_id      || null,
      dispatch_id:   dispatch_id   || null,
      farm_id:       farm_id       || null,
      customer_name,
      complaint_type,
      severity:      severity      || 'medium',
      description
    });

    return res.status(201).json(result);

  } catch (err) {
    console.error('[DispatchRoute] /complaint error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/dispatch/complaints/:mill_id ───────────────
// Open unresolved complaints for a mill
router.get('/complaints/:mill_id', (req, res) => {
  try {
    const result = getOpenComplaints(req.params.mill_id);
    return res.json(result);
  } catch (err) {
    console.error('[DispatchRoute] /complaints error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;