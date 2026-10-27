// ─── Performance Analysis Route ───────────────────────────────────────────────
// POST /api/farmpulse/perf-analyze
// Body: { breed, age, age_unit, production, kpis: { body_wt_g, fcr, adg_g,
//         mortality_pct, egg_prod_pct, egg_wt_g, feed_per_bird_g } }
// Returns: { ok, standard, deviations, overall, findings }
//
// Used by: WhatsApp perf-analyzer.js, FarmPulse web daily record view
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';

const router = Router();

// TODO: import breed standards service when core/farmpulse/breed-standards.service.js is ready
// import { analyzePerformance } from '../../core/farmpulse/breed-standards.service.js';

router.post('/', async (req, res) => {
  try {
    const { breed, age, age_unit = 'day', kpis = {} } = req.body;
    if (!breed || !age) {
      return res.status(400).json({ ok: false, error: 'breed and age required' });
    }
    // TODO: replace stub with real analyzePerformance() call
    res.json({
      ok: true,
      breed,
      age,
      age_unit,
      standard: null,
      deviations: [],
      overall: 'STUB',
      message: 'perf-analyze.route.js stub — fill implementation'
    });
  } catch (err) {
    console.error('[perf-analyze]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
