// ============================================================
// Feed Mill Intelligence Engine — Weighbridge Route
// nutripilot-agrocore/agrocore/api/routes/mill.weighbridge.route.js
// ============================================================

import express from 'express';
import {
  recordWeighbridgeReceipt,
  recordManualReceipt,
  completeInboundGate,
  getReceiptsByMill,
  getStockSnapshot,
  getIngredientAvailability,
  getDailyUsageReport
} from '../../../core/services/mill/mill.weighbridge.service.cjs';
import { hideMillManagerPrices } from '../../../core/services/mill/mill.price.service.cjs';
import { maybeNotifyStockAlerts } from '../../../core/services/mill/mill.alert.service.cjs';

const router = express.Router();

// ── POST /v1/mill/weighbridge/receipt ─────────────────────────
// Record a weighbridge receipt — gross/tare → net auto-calculated
router.post('/receipt', (req, res) => {
  try {
    const {
      mill_id, ingredient_id, ingredient_name,
      supplier_id, supplier_name,
      vehicle_id, driver_name,
      gross_weight, tare_weight,
      recorded_unit,
      price_per_unit, price_per_kg, currency,
      moisture_pct, protein_pct,
      storage_bin, receipt_date,
      received_by, notes,
      receipt_number, lot_number,
      photo_data, photo_path, force_post, override_reason, override_by
    } = req.body;

    if (!mill_id || !ingredient_id || !gross_weight || !tare_weight) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id, ingredient_id, gross_weight and tare_weight are required'
      });
    }

    const result = recordWeighbridgeReceipt({
      mill_id, ingredient_id,
      ingredient_name: ingredient_name || ingredient_id,
      supplier_id:     supplier_id     || null,
      supplier_name:   supplier_name   || null,
      vehicle_id:      vehicle_id      || null,
      driver_name:     driver_name     || null,
      gross_weight:    Number(gross_weight),
      tare_weight:     Number(tare_weight),
      recorded_unit:   recorded_unit   || null,
      price_per_unit:  price_per_unit ? Number(price_per_unit) : (price_per_kg ? Number(price_per_kg) : null),
      currency:        currency        || 'USD',
      receipt_number:  receipt_number  || null,
      lot_number:      lot_number      || null,
      photo_data:      photo_data      || null,
      photo_path:      photo_path      || null,
      force_post:      !!force_post,
      override_reason: override_reason || null,
      override_by:     override_by     || received_by || null,
      moisture_pct:    moisture_pct    ? Number(moisture_pct)   : null,
      protein_pct:     protein_pct     ? Number(protein_pct)    : null,
      storage_bin:     storage_bin     || null,
      receipt_date:    receipt_date    || null,
      received_by:     received_by     || null,
      notes:           notes           || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[Weighbridge] /receipt error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/weighbridge/manual ──────────────────────────
// Manual receipt — direct quantity entry without weighbridge
router.post('/manual', (req, res) => {
  try {
    const {
      mill_id, ingredient_id, ingredient_name,
      quantity, unit,
      supplier_id, supplier_name,
      price_per_unit, currency,
      receipt_date, received_by, notes, lot_number,
      moisture_pct, photo_data, photo_path, force_post, override_reason, override_by
    } = req.body;

    if (!mill_id || !ingredient_id || !quantity) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id, ingredient_id and quantity are required'
      });
    }

    const result = recordManualReceipt({
      mill_id, ingredient_id,
      ingredient_name: ingredient_name || ingredient_id,
      quantity:        Number(quantity),
      unit:            unit            || 'kg',
      supplier_id:     supplier_id     || null,
      supplier_name:   supplier_name   || null,
      price_per_unit:  price_per_unit  ? Number(price_per_unit) : null,
      currency:        currency        || 'USD',
      receipt_date:    receipt_date    || null,
      received_by:     received_by     || null,
      notes:           notes           || null,
      lot_number:      lot_number      || null,
      moisture_pct:    moisture_pct != null && moisture_pct !== '' ? Number(moisture_pct) : null,
      photo_data:      photo_data || null,
      photo_path:      photo_path || null,
      force_post:      !!force_post,
      override_reason: override_reason || null,
      override_by:     override_by || received_by || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[Weighbridge] /manual error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/weighbridge/receipt/:id/complete ────────────
// Add missing moisture / lot / photo, then post if the gate is clear
router.post('/receipt/:id/complete', (req, res) => {
  try {
    const result = completeInboundGate(req.params.id, {
      moisture_pct: req.body?.moisture_pct,
      lot_number: req.body?.lot_number,
      photo_data: req.body?.photo_data,
      photo_path: req.body?.photo_path,
      received_by: req.body?.received_by
    });
    if (!result.ok) return res.status(400).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /complete error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/weighbridge/receipt/:id/override ────────────
// Manager override with a written reason — still records the gap
router.post('/receipt/:id/override', (req, res) => {
  try {
    const reason = String(req.body?.override_reason || req.body?.reason || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ ok: false, error: 'Override reason is required' });
    }
    const result = completeInboundGate(req.params.id, {
      moisture_pct: req.body?.moisture_pct,
      lot_number: req.body?.lot_number,
      photo_data: req.body?.photo_data,
      force_post: true,
      override_reason: reason,
      override_by: req.body?.override_by || req.body?.received_by || 'manager'
    });
    if (!result.ok) return res.status(400).json(result);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /override error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/weighbridge/receipts/:mill_id ────────────────
router.get('/receipts/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getReceiptsByMill(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /receipts error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/weighbridge/stock/:mill_id ───────────────────
// Current stock snapshot — green/amber/red per ingredient
router.get('/stock/:mill_id', (req, res) => {
  try {
    const { unit } = req.query;
    const result = getStockSnapshot(req.params.mill_id, unit || 'kg');
    const to = req.user?.email || req.nutrixUser;
    maybeNotifyStockAlerts(req.params.mill_id, result, to).catch(() => {});
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /stock error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/weighbridge/availability ────────────────────
// Check ingredient availability for a formula at a specific plant
// Called by formulation workspace when plant is selected
router.post('/availability', (req, res) => {
  try {
    const { mill_id, ingredients } = req.body;

    if (!mill_id || !ingredients?.length) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id and ingredients array are required'
      });
    }

    const result = getIngredientAvailability(mill_id, ingredients);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /availability error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/weighbridge/usage/:mill_id ───────────────────
// Daily usage report — tonnage per ingredient
router.get('/usage/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getDailyUsageReport(req.params.mill_id, date || null);
    return res.json(hideMillManagerPrices(result));
  } catch (err) {
    console.error('[Weighbridge] /usage error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});


export default router;