// ============================================================
// Feed Mill Intelligence Engine — Lot lock
// CoA / toxin holds a supplier lot and can rewrite the formula.
// ============================================================

import express from 'express';
import {
  listLotLocks,
  applyCoAToLot,
  unlockLot,
  rewriteFormulasForLock
} from '../../../core/services/mill/mill.lotlock.service.cjs';

const router = express.Router();

router.post('/coa', (req, res) => {
  try {
    const result = applyCoAToLot(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err) {
    console.error('[LotLock] /coa error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/unlock', (req, res) => {
  try {
    const { lot_id, by, reason } = req.body || {};
    const result = unlockLot({ lot_id, by, reason });
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[LotLock] /unlock error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/rewrite', (req, res) => {
  try {
    const { mill_id, lot_id, mode, by } = req.body || {};
    const result = rewriteFormulasForLock({ mill_id, lot_id, mode, by });
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[LotLock] /rewrite error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:mill_id', (req, res) => {
  try {
    return res.json(listLotLocks(req.params.mill_id));
  } catch (err) {
    console.error('[LotLock] /list error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
