// ============================================================
// Feed Mill Intelligence Engine — Batch Route
// nutripilot-agrocore/agrocore/api/routes/mill.batch.route.js
// ============================================================

import express from 'express';
import {
  processFormulaRelease,
  createBatch,
  updateBatchStatus,
  recordActualWeights,
  getBatchQueue,
  getBatchDetail,
  addBatchIngredients,
  populateBatchFromSnapshot
} from '../../../core/services/mill/mill.batch.service.cjs';

import {
  preBatchStockCheck
} from '../../../core/services/mill/mill.inventory.service.cjs';

import {
  calculateBatchDeviation
} from '../../../core/services/mill/mill.deviation.service.cjs';

import {
  recordUsageFromBatch
} from '../../../core/services/mill/mill.inventory.service.cjs';

import { hideMillManagerPrices } from '../../../core/services/mill/mill.price.service.cjs';
import { getMillDb } from '../../../core/db/mill/mill.db.js';
import { listSharedFormulas } from '../../../core/services/mill/mill.share.service.cjs';
import { learn } from '../lib/learn-hook.js';

const router = express.Router();

// ── POST /v1/mill/batch/release ──────────────────────────────
// Called by Formula Release tab in NutriPilot
// Creates formula snapshot + batch job in one atomic operation
router.post('/release', (req, res) => {
  try {
    const {
      formula_id,
      formula_version,
      formula_name,
      species,
      feed_type,
      released_by,
      formula_json,
      cost_per_ton,
      nutrients_json,
      mill_id,
      planned_qty_tons,
      priority,
      ingredients
    } = req.body;

    // Validate required fields
    const required = { formula_id, formula_name, released_by, mill_id, planned_qty_tons };
    const missing  = Object.entries(required)
      .filter(([, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);

    if (missing.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    const result = processFormulaRelease({
      formula_id,
      formula_version:  formula_version  || 'v1',
      formula_name,
      species:          species           || null,
      feed_type:        feed_type         || null,
      released_by,
      formula_json:     formula_json      || {},
      cost_per_ton:     cost_per_ton      || null,
      nutrients_json:   nutrients_json    || null,
      mill_id,
      planned_qty_tons: Number(planned_qty_tons),
      priority:         priority          || 1,
      ingredients:      ingredients       || []
    });

    learn({
      source: 'milliq', kind: 'mill_release', user_id: released_by, mill_id, species,
      title: `Released ${formula_name} to mill`,
      text: `qty ${planned_qty_tons} t cost ${cost_per_ton || ''}`,
      metadata: { formula_id, batch_number: result.batch_number }
    });

    return res.status(201).json({
      ...result,
      message: `Batch ${result.batch_number} created and queued for mill`
    });

  } catch (err) {
    console.error('[MillRoute] /release error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/batch/queue/:mill_id ────────────────────────
// Returns batch queue for a mill — all statuses or filtered
router.get('/queue/:mill_id', (req, res) => {
  try {
    const { mill_id }      = req.params;
    const { status }       = req.query;

    const result = getBatchQueue(mill_id, status || null);
    return res.json(result);

  } catch (err) {
    console.error('[MillRoute] /queue error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/batch/:batch_id ─────────────────────────────
// Full batch detail — ingredients, QC, snapshot
router.get('/:batch_id', (req, res) => {
  try {
    const result = getBatchDetail(req.params.batch_id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(hideMillManagerPrices(result));

  } catch (err) {
    console.error('[MillRoute] /batch detail error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /v1/mill/batch/:batch_id/status ───────────────────
// Updates batch status — confirm, start, complete, dispatch
// Runs stock check automatically when confirming
router.patch('/:batch_id/status', (req, res) => {
  try {
    const { batch_id }  = req.params;
    const { status, operator_id } = req.body;

    if (!status) {
      return res.status(400).json({ ok: false, error: 'status is required' });
    }

    // Auto stock check when mill manager confirms a batch
    if (status === 'confirmed') {
      const stockCheck = preBatchStockCheck(batch_id);
      if (!stockCheck.can_proceed) {
        return res.status(400).json({
          ok: false,
          error: 'Insufficient stock to confirm batch',
          stock_check: stockCheck
        });
      }
    }

    const result = updateBatchStatus(batch_id, status);
    if (!result.ok) return res.status(400).json(result);

    return res.json({
      ...result,
      message: `Batch status updated to ${status}`
    });

  } catch (err) {
    console.error('[MillRoute] /status error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/batch/:batch_id/actuals ───────────────────
// Records actual ingredient weights after batching
// Automatically triggers deviation calculation + inventory update
router.post('/:batch_id/actuals', (req, res) => {
  try {
    const { batch_id }   = req.params;
    const { actuals, record_date } = req.body;

    if (!actuals || !Array.isArray(actuals) || actuals.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'actuals array is required and must not be empty'
      });
    }

    // Validate actuals structure
    const invalid = actuals.filter(a => !a.ingredient_id || a.actual_kg === undefined);
    if (invalid.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Each actual must have ingredient_id and actual_kg'
      });
    }

    // Step 1 — record actual weights
    const actualsResult = recordActualWeights(batch_id, actuals);
    if (!actualsResult.ok) return res.status(400).json(actualsResult);

    // Step 2 — auto update batch status to completed
    updateBatchStatus(batch_id, 'completed');

    // Step 3 — auto calculate deviation
    const deviation = calculateBatchDeviation(batch_id);

    // Step 4 — auto update inventory usage
    const inventoryUpdate = recordUsageFromBatch(batch_id, record_date || null);

    return res.json({
      ok: true,
      batch_id,
      actuals_recorded: actualsResult.updated,
      deviation_summary: {
        overall_status:    deviation.overall_status,
        total_cost_impact: deviation.total_cost_impact,
        flagged_count:     deviation.flagged_count,
        warned_count:      deviation.warned_count
      },
      inventory_updated: inventoryUpdate.ok,
      message: 'Actuals recorded — deviation calculated — inventory updated'
    });

  } catch (err) {
    console.error('[MillRoute] /actuals error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/batch/:batch_id/ingredients ───────────────
// Adds ingredients to an existing batch
// Used when ingredients were not included in the release payload
router.post('/:batch_id/ingredients', (req, res) => {
  try {
    const { batch_id }   = req.params;
    const { ingredients } = req.body;

    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'ingredients array is required'
      });
    }

    const result = addBatchIngredients(batch_id, ingredients);
    return res.status(201).json(result);

  } catch (err) {
    console.error('[MillRoute] /ingredients error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/batch/:batch_id/stock-check ────────────────
// Pre-batch stock availability check
router.get('/:batch_id/stock-check', (req, res) => {
  try {
    const result = preBatchStockCheck(req.params.batch_id);
    return res.json(result);

  } catch (err) {
    console.error('[MillRoute] /stock-check error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/batch/library/:mill_id ──────────────────────
// Formula library — all approved snapshots available for this mill
router.get('/library/:mill_id', (req, res) => {
  try {
    return res.json(listSharedFormulas(req.params.mill_id));
  } catch (err) {
    console.error('[MillRoute] /library error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/batch/from-library ─────────────────────────
// Operator picks a formula from library + enters batch size
// Creates a new batch in pending status
router.post('/from-library', (req, res) => {
  try {
    const { snapshot_id, mill_id, planned_qty_tons, operator_id, notes } = req.body;

    if (!snapshot_id || !mill_id || !planned_qty_tons) {
      return res.status(400).json({
        ok: false,
        error: 'snapshot_id, mill_id and planned_qty_tons are required'
      });
    }

    const result = createBatch({
      formula_snapshot_id: snapshot_id,
      mill_id,
      planned_qty_tons: Number(planned_qty_tons),
      operator_id: operator_id || null,
      notes: notes || null
    });
    populateBatchFromSnapshot(result.batch_id, snapshot_id, Number(planned_qty_tons));

    return res.status(201).json({
      ...result,
      message: `Batch ${result.batch_number} created from library`
    });
  } catch (err) {
    console.error('[MillRoute] /from-library error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;