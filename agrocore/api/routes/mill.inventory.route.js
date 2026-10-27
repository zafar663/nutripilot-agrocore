// ============================================================
// Feed Mill Intelligence Engine — Inventory Route
// nutripilot-agrocore/agrocore/api/routes/mill.inventory.route.js
// ============================================================

import express from 'express';
import {
  openDailyInventory,
  recordReceipt,
  closeDailyInventory,
  getInventorySnapshot,
  getShrinkageReport,
  preBatchStockCheck
} from '../../../core/services/mill/mill.inventory.service.cjs';
import { hideMillManagerPrices } from '../../../core/services/mill/mill.price.service.cjs';

const router = express.Router();

// ── POST /v1/mill/inventory/open ────────────────────────────
// Opens daily inventory record for an ingredient
// Run at start of day before any batching begins
router.post('/open', (req, res) => {
  try {
    const {
      mill_id,
      ingredient_id,
      ingredient_name,
      opening,
      opening_kg,
      cost_per_unit,
      cost_per_kg,
      record_date
    } = req.body;

    const openingMass = opening ?? opening_kg;
    if (!mill_id || !ingredient_id || !ingredient_name || openingMass === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id, ingredient_id, ingredient_name and opening are required'
      });
    }

    const result = openDailyInventory({
      mill_id,
      ingredient_id,
      ingredient_name,
      opening: Number(openingMass),
      cost_per_unit: (cost_per_unit ?? cost_per_kg) != null ? Number(cost_per_unit ?? cost_per_kg) : null,
      record_date: record_date || null
    });

    return res.status(201).json(result);

  } catch (err) {
    console.error('[InventoryRoute] /open error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/inventory/receipt ─────────────────────────
// Records raw material receipt from supplier
router.post('/receipt', (req, res) => {
  try {
    const {
      mill_id,
      ingredient_id,
      ingredient_name,
      received,
      received_kg,
      cost_per_unit,
      cost_per_kg,
      record_date,
      lot_number,
      supplier_name,
      supplier_lot_id
    } = req.body;

    const receivedMass = received ?? received_kg;
    if (!mill_id || !ingredient_id || !receivedMass) {
      return res.status(400).json({
        ok: false,
        error: 'mill_id, ingredient_id and received are required'
      });
    }

    const result = recordReceipt({
      mill_id,
      ingredient_id,
      ingredient_name: ingredient_name || ingredient_id,
      received: Number(receivedMass),
      cost_per_unit: (cost_per_unit ?? cost_per_kg) != null ? Number(cost_per_unit ?? cost_per_kg) : null,
      lot_number: lot_number || supplier_lot_id || null,
      supplier_name: supplier_name || null,
      record_date: record_date || null
    });

    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);

  } catch (err) {
    console.error('[InventoryRoute] /receipt error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/inventory/close/:mill_id ──────────────────
// Closes daily inventory — calculates variance and shrinkage
// Run at end of production day
router.post('/close/:mill_id', (req, res) => {
  try {
    const { mill_id }    = req.params;
    const { record_date, physical_counts, closed_by } = req.body || {};

    const result = closeDailyInventory(mill_id, record_date || null, {
      physical_counts: physical_counts || {},
      closed_by: closed_by || null
    });
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);

  } catch (err) {
    console.error('[InventoryRoute] /close error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/inventory/snapshot/:mill_id ────────────────
// Current stock levels for all ingredients at a mill
router.get('/snapshot/:mill_id', (req, res) => {
  try {
    const { date } = req.query;
    const result = getInventorySnapshot(
      req.params.mill_id,
      date || null
    );
    return res.json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[InventoryRoute] /snapshot error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/inventory/shrinkage/:mill_id ───────────────
// Shrinkage report across date range
router.get('/shrinkage/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = getShrinkageReport(
      req.params.mill_id,
      days ? parseInt(days) : 7
    );
    return res.json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[InventoryRoute] /shrinkage error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/inventory/stock-check/:batch_id ────────────
// Check stock availability for a specific batch
router.get('/stock-check/:batch_id', (req, res) => {
  try {
    const result = preBatchStockCheck(req.params.batch_id);
    return res.json(result);

  } catch (err) {
    console.error('[InventoryRoute] /stock-check error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;