import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parseDietRequest, listTypes, listBreeds, listPhases } = require('../../../core/services/diet-parser.service.cjs');

import express from 'express';
const router = express.Router();

// POST /v1/diet-intent/parse
// Body: { text: string }
// Returns: parsed diet intent struct
router.post('/parse', (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
  try {
    const result = parseDietRequest(text);
    if (result.error) return res.status(422).json({ ok: false, ...result });
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[diet-intent/parse]', err?.message);
    return res.status(500).json({ ok: false, error: 'Parse failed' });
  }
});

// GET /v1/diet-intent/types
// Lists all known species/types
router.get('/types', (_req, res) => {
  res.json({ ok: true, types: listTypes() });
});

// GET /v1/diet-intent/breeds/:typeKey
router.get('/breeds/:typeKey', (req, res) => {
  const breeds = listBreeds(req.params.typeKey);
  if (!breeds) return res.status(404).json({ ok: false, error: 'Unknown type key' });
  res.json({ ok: true, breeds });
});

// GET /v1/diet-intent/phases/:typeKey
router.get('/phases/:typeKey', (req, res) => {
  const phases = listPhases(req.params.typeKey);
  if (!phases) return res.status(404).json({ ok: false, error: 'Unknown type key' });
  res.json({ ok: true, phases });
});

export default router;
