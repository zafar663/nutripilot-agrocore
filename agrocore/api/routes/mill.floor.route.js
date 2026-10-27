import express from 'express';
import {
  signFlush,
  getHaccpPack,
  signHaccp,
  recordProcessQc,
  getProcessQc,
  productionReadiness,
  massBalance,
  pedigree,
  operatorQueue,
  groupLive,
  hideMillManagerPrices,
  assertFlushAllowsStart,
} from '../../../core/services/mill/mill.floor.service.cjs';

const router = express.Router();

router.get('/readiness/:mill_id', (req, res) => {
  try { return res.json(productionReadiness(req.params.mill_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/shrink/:mill_id', (req, res) => {
  try { return res.json(massBalance(req.params.mill_id, req.query.period, req.query.date)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/pedigree/:batch_id', (req, res) => {
  try { return res.json(pedigree(req.params.batch_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/operator/:mill_id', (req, res) => {
  try { return res.json(operatorQueue(req.params.mill_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/group-live', (req, res) => {
  try { return res.json(groupLive(String(req.nutrixUser || '').toLowerCase())); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/flush-check/:mill_id/:batch_id', (req, res) => {
  try { return res.json(assertFlushAllowsStart(req.params.mill_id, req.params.batch_id)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/flush', (req, res) => {
  try { return res.json(signFlush(req.body || {})); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/haccp/:mill_id', (req, res) => {
  try { return res.json(getHaccpPack(req.params.mill_id, req.query.batch_id || null)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/haccp', (req, res) => {
  try { return res.json(signHaccp(req.body || {})); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/process/:mill_id', (req, res) => {
  try { return res.json(getProcessQc(req.params.mill_id, req.query.batch_id || null)); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/process', (req, res) => {
  try { return res.json(recordProcessQc(req.body || {})); }
  catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
});

export { hideMillManagerPrices };
export default router;
