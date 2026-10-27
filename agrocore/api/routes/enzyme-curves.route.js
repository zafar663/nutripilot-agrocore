// agrocore/api/routes/enzyme-curves.route.js
// Non-linear enzyme/additive dose-response curves stored as piecewise breakpoints.
// The LP uses linear-interpolated "effective nutrient value" at the expected inclusion level.

import express from 'express';
import { getUserNpDb } from '../../../core/db/turso/turso.adapter.js';
import { randomUUID } from 'crypto';

const router = express.Router();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ingredient_response_curves (
  id             TEXT PRIMARY KEY,
  ingredient_id  TEXT NOT NULL,
  nutrient_key   TEXT NOT NULL,
  curve_name     TEXT,
  breakpoints    TEXT NOT NULL DEFAULT '[]',
  unit           TEXT NOT NULL DEFAULT 'inclusion_pct',
  reference      TEXT,
  model_type     TEXT NOT NULL DEFAULT 'breakpoints',
  model_params   TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ingredient_id, nutrient_key)
)`;

async function ensureSchema(db) {
  await db.exec(SCHEMA);
}

/** Piecewise-linear interpolation of [[dose, release], ...] breakpoints at dose x */
function interpolateBreakpoints(breakpoints, x) {
  if (!Array.isArray(breakpoints) || !breakpoints.length) return null;
  const sorted = [...breakpoints].sort((a, b) => a[0] - b[0]);
  if (x <= sorted[0][0]) return sorted[0][1];
  if (x >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return Math.round((y0 + t * (y1 - y0)) * 1e6) / 1e6;
    }
  }
  return sorted[sorted.length - 1][1];
}

/**
 * Evaluate enzyme dose-response at dose x using the specified model.
 * model_type: 'breakpoints' | 'mm' (Michaelis-Menten) | 'exponential'
 * model_params: { Rmax, Km } for mm; { Rmax, k } for exponential
 */
export function evaluateEnzymeCurve(model_type, breakpoints, model_params, x) {
  const mt = (model_type || 'breakpoints').toLowerCase();
  const mp = (typeof model_params === 'string' ? JSON.parse(model_params || '{}') : model_params) || {};

  if (mt === 'mm') {
    // Michaelis-Menten: R(d) = Rmax × d / (Km + d)
    const Rmax = Number(mp.Rmax || mp.rmax || 0);
    const Km   = Number(mp.Km   || mp.km   || 1);
    if (!Rmax || Km <= 0) return null;
    return Math.round(Rmax * x / (Km + x) * 1e6) / 1e6;
  }

  if (mt === 'exponential') {
    // Exponential saturation: R(d) = Rmax × (1 - exp(-k × d))
    const Rmax = Number(mp.Rmax || mp.rmax || 0);
    const k    = Number(mp.k || 1);
    if (!Rmax || k <= 0) return null;
    return Math.round(Rmax * (1 - Math.exp(-k * x)) * 1e6) / 1e6;
  }

  // Default: piecewise-linear breakpoints
  return interpolateBreakpoints(breakpoints, x);
}

// ── GET /v1/enzyme-curves ─────────────────────────────────────────────────────
// ?ingredient_id=phytase  (optional filter)
router.get('/enzyme-curves', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { ingredient_id } = req.query;
    const sql = ingredient_id
      ? 'SELECT * FROM ingredient_response_curves WHERE ingredient_id = ? ORDER BY nutrient_key'
      : 'SELECT * FROM ingredient_response_curves ORDER BY ingredient_id, nutrient_key';
    const params = ingredient_id ? [ingredient_id] : [];
    const rows = await db.all(sql, params);
    rows.forEach(r => {
      r.breakpoints = JSON.parse(r.breakpoints || '[]');
      r.model_type = r.model_type || 'breakpoints';
      r.model_params = JSON.parse(r.model_params || '{}');
    });
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /v1/enzyme-curves ───────────────────────────────────────────────────
// Create or replace a response curve for (ingredient_id, nutrient_key)
router.post('/enzyme-curves', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { ingredient_id, nutrient_key, curve_name, breakpoints, unit, reference, model_type, model_params } = req.body || {};
    const mt = model_type || 'breakpoints';

    if (!ingredient_id || !nutrient_key) {
      return res.status(400).json({ ok: false, error: 'ingredient_id and nutrient_key are required' });
    }
    if (mt === 'breakpoints') {
      if (!Array.isArray(breakpoints) || breakpoints.length < 2) {
        return res.status(400).json({ ok: false, error: 'breakpoints must be an array of at least 2 [dose, release] pairs' });
      }
      for (const bp of breakpoints) {
        if (!Array.isArray(bp) || bp.length < 2 || !Number.isFinite(bp[0]) || !Number.isFinite(bp[1])) {
          return res.status(400).json({ ok: false, error: 'Each breakpoint must be [dose, nutrient_release] with numeric values' });
        }
      }
    }

    const id = randomUUID();
    await db.run(`
      INSERT INTO ingredient_response_curves
        (id, ingredient_id, nutrient_key, curve_name, breakpoints, unit, reference, model_type, model_params)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ingredient_id, nutrient_key) DO UPDATE SET
        curve_name  = excluded.curve_name,
        breakpoints = excluded.breakpoints,
        unit        = excluded.unit,
        reference   = excluded.reference,
        model_type  = excluded.model_type,
        model_params = excluded.model_params,
        updated_at  = datetime('now')
    `, [id, ingredient_id, nutrient_key, curve_name || '', JSON.stringify(breakpoints || []), unit || 'inclusion_pct', reference || '', mt, JSON.stringify(model_params || {})]);

    const saved = await db.get('SELECT * FROM ingredient_response_curves WHERE ingredient_id = ? AND nutrient_key = ?',
      [ingredient_id, nutrient_key]);
    if (saved) {
      saved.breakpoints = JSON.parse(saved.breakpoints || '[]');
      saved.model_params = JSON.parse(saved.model_params || '{}');
    }

    res.json({ ok: true, data: saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /v1/enzyme-curves/:id ─────────────────────────────────────────────
router.delete('/enzyme-curves/:id', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await db.run('DELETE FROM ingredient_response_curves WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /v1/enzyme-curves/effective ──────────────────────────────────────────
// Returns effective nutrient values for an ingredient at a given inclusion level.
// Used by the optimizer to compute LP coefficients for enzyme/additive ingredients.
// ?ingredient_id=phytase&inclusion=0.05
router.get('/enzyme-curves/effective', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { ingredient_id } = req.query;
    const inclusion = parseFloat(req.query.inclusion);

    if (!ingredient_id) return res.status(400).json({ ok: false, error: 'ingredient_id is required' });
    if (!Number.isFinite(inclusion)) return res.status(400).json({ ok: false, error: 'inclusion must be a number' });

    const curves = await db.all('SELECT * FROM ingredient_response_curves WHERE ingredient_id = ?', [ingredient_id]);

    const effectiveNutrients = {};
    for (const curve of curves) {
      const bps = JSON.parse(curve.breakpoints || '[]');
      const val = evaluateEnzymeCurve(curve.model_type, bps, curve.model_params, inclusion);
      if (val !== null) effectiveNutrients[curve.nutrient_key] = val;
    }

    res.json({
      ok: true,
      ingredient_id,
      inclusion,
      effective_nutrients: effectiveNutrients,
      curve_count: curves.length
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /v1/enzyme-curves/batch-effective ───────────────────────────────────
// Bulk version: resolve effective values for multiple ingredients at once.
// Body: { ingredients: [{ ingredient_id, inclusion }] }
router.post('/enzyme-curves/batch-effective', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];

    if (!ingredients.length) return res.status(400).json({ ok: false, error: 'ingredients array is required' });

    const results = {};
    for (const { ingredient_id, inclusion } of ingredients) {
      if (!ingredient_id || !Number.isFinite(Number(inclusion))) continue;
      const inc = Number(inclusion);
      const curves = await db.all('SELECT * FROM ingredient_response_curves WHERE ingredient_id = ?', [ingredient_id]);
      if (!curves.length) continue;

      const effectiveNutrients = {};
      for (const curve of curves) {
        const bps = JSON.parse(curve.breakpoints || '[]');
        const val = evaluateEnzymeCurve(curve.model_type, bps, curve.model_params, inc);
        if (val !== null) effectiveNutrients[curve.nutrient_key] = val;
      }

      if (Object.keys(effectiveNutrients).length > 0) {
        results[ingredient_id] = { inclusion: inc, effective_nutrients: effectiveNutrients };
      }
    }

    res.json({ ok: true, results, ingredient_count: Object.keys(results).length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /v1/enzyme-curves/seed-defaults ─────────────────────────────────────
// Seeds literature-based dose-response curves for standard enzymes that have no
// user-defined curves yet.  Safe to call repeatedly — only inserts missing entries.
// Breakpoints: [inclusion_pct, nutrient_release_value]
// Sources: NRC 1994/2012, Ravindran 2013, Bedford & Partridge 2010, EFSA 2016 reviews.
// Each entry may include model_type ('breakpoints'|'mm'|'exponential') and model_params.
// mm_params: { Rmax, Km } — fitted to NRC/literature breakpoints for the response curve.
const ENZYME_DEFAULT_CURVES = [
  // ─── PHYTASE (100,000 FTU/g product; 0.005% = 500 FTU/kg diet) ───────────
  { ingredient_id: 'phytase', nutrient_key: 'avp',
    curve_name: 'Phytase — Available P release (NRC 2012)',
    reference: 'NRC 2012; Ravindran et al. 2015',
    breakpoints: [[0,0],[0.0025,0.065],[0.005,0.105],[0.01,0.135],[0.02,0.155],[0.04,0.165]],
    model_type: 'mm', model_params: { Rmax: 0.172, Km: 0.0038 } },
  { ingredient_id: 'phytase', nutrient_key: 'me',
    curve_name: 'Phytase — ME equivalence kcal/kg (poultry)',
    reference: 'Selle & Ravindran 2007',
    breakpoints: [[0,0],[0.0025,25],[0.005,42],[0.01,58],[0.02,68],[0.04,74]],
    model_type: 'mm', model_params: { Rmax: 78, Km: 0.0048 } },
  { ingredient_id: 'phytase', nutrient_key: 'ca',
    curve_name: 'Phytase — Ca requirement reduction %',
    reference: 'NRC 2012',
    breakpoints: [[0,0],[0.0025,0.030],[0.005,0.050],[0.01,0.065],[0.02,0.075]] },
  { ingredient_id: 'phytase', nutrient_key: 'sid_lys',
    curve_name: 'Phytase — SID Lys improvement %',
    reference: 'Ravindran et al. 2015',
    breakpoints: [[0,0],[0.005,0.010],[0.01,0.016],[0.02,0.020]] },
  { ingredient_id: 'phytase', nutrient_key: 'sid_met',
    curve_name: 'Phytase — SID Met improvement %',
    reference: 'Ravindran et al. 2015',
    breakpoints: [[0,0],[0.005,0.007],[0.01,0.011],[0.02,0.014]] },
  // Swine phytase
  { ingredient_id: 'phytase_swine', nutrient_key: 'avp',
    curve_name: 'Phytase — Available P release swine (NRC 2012)',
    reference: 'NRC 2012',
    breakpoints: [[0,0],[0.0025,0.070],[0.005,0.110],[0.01,0.140],[0.02,0.158]] },
  { ingredient_id: 'phytase_swine', nutrient_key: 'me',
    curve_name: 'Phytase — ME equivalence kcal/kg (swine)',
    reference: 'NRC 2012',
    breakpoints: [[0,0],[0.005,35],[0.01,50],[0.02,60]] },

  // ─── XYLANASE / NSPase (wheat-barley diet basis) ─────────────────────────
  { ingredient_id: 'xylanase', nutrient_key: 'me',
    curve_name: 'Xylanase — ME release kcal/kg (wheat diet)',
    reference: 'Bedford & Partridge 2010; Cowieson et al. 2014',
    breakpoints: [[0,0],[0.001,35],[0.005,75],[0.01,100],[0.02,118],[0.04,125]] },
  { ingredient_id: 'xylanase', nutrient_key: 'sid_lys',
    curve_name: 'Xylanase — SID Lys improvement %',
    reference: 'Cowieson et al. 2014',
    breakpoints: [[0,0],[0.005,0.008],[0.01,0.013],[0.02,0.016]] },
  { ingredient_id: 'xylanase_swine', nutrient_key: 'me',
    curve_name: 'Xylanase — ME release kcal/kg (swine wheat diet)',
    reference: 'Bedford & Partridge 2010',
    breakpoints: [[0,0],[0.005,50],[0.01,75],[0.02,90]] },

  // ─── BETA-GLUCANASE (barley-based diets) ─────────────────────────────────
  { ingredient_id: 'beta_glucanase', nutrient_key: 'me',
    curve_name: 'Beta-glucanase — ME release kcal/kg (barley diet)',
    reference: 'Choct 2006',
    breakpoints: [[0,0],[0.005,55],[0.01,85],[0.02,100]] },

  // ─── PROTEASE ─────────────────────────────────────────────────────────────
  { ingredient_id: 'protease', nutrient_key: 'sid_lys',
    curve_name: 'Protease — SID Lys improvement %',
    reference: 'Cowieson & Roos 2016; Romero et al. 2013',
    breakpoints: [[0,0],[0.005,0.018],[0.01,0.030],[0.02,0.040],[0.04,0.046]] },
  { ingredient_id: 'protease', nutrient_key: 'sid_met',
    curve_name: 'Protease — SID Met improvement %',
    reference: 'Cowieson & Roos 2016',
    breakpoints: [[0,0],[0.005,0.012],[0.01,0.020],[0.02,0.026]] },
  { ingredient_id: 'protease', nutrient_key: 'sid_thr',
    curve_name: 'Protease — SID Thr improvement %',
    reference: 'Cowieson & Roos 2016',
    breakpoints: [[0,0],[0.005,0.010],[0.01,0.017],[0.02,0.022]] },
  { ingredient_id: 'protease', nutrient_key: 'cp',
    curve_name: 'Protease — CP digestibility improvement %',
    reference: 'Romero et al. 2013',
    breakpoints: [[0,0],[0.005,0.4],[0.01,0.7],[0.02,0.9]] },
  { ingredient_id: 'protease', nutrient_key: 'me',
    curve_name: 'Protease — ME release kcal/kg',
    reference: 'Cowieson & Roos 2016',
    breakpoints: [[0,0],[0.005,45],[0.01,75],[0.02,95]] },

  // ─── AMYLASE ──────────────────────────────────────────────────────────────
  { ingredient_id: 'amylase', nutrient_key: 'me',
    curve_name: 'Amylase — ME release kcal/kg',
    reference: 'Cowieson et al. 2010; BASF Technical Bulletin',
    breakpoints: [[0,0],[0.005,40],[0.01,65],[0.02,82],[0.04,90]] },

  // ─── LIPASE ───────────────────────────────────────────────────────────────
  { ingredient_id: 'lipase', nutrient_key: 'me',
    curve_name: 'Lipase — ME release kcal/kg (fat digestibility improvement)',
    reference: 'Guerreiro Neto et al. 2011',
    breakpoints: [[0,0],[0.005,30],[0.01,52],[0.02,68],[0.04,78]] },

  // ─── MANNANASE ────────────────────────────────────────────────────────────
  { ingredient_id: 'mannanase', nutrient_key: 'me',
    curve_name: 'Mannanase — ME release kcal/kg (SBM diet)',
    reference: 'Jackson et al. 2004',
    breakpoints: [[0,0],[0.005,50],[0.01,78],[0.02,92]] },

  // ─── MULTI-ENZYME (typical phytase+xylanase+protease combo) ──────────────
  { ingredient_id: 'multi_enzyme', nutrient_key: 'me',
    curve_name: 'Multi-enzyme — combined ME release kcal/kg',
    reference: 'MDPI Applied Sciences 16:2862 (2025)',
    breakpoints: [[0,0],[0.005,90],[0.01,140],[0.02,175],[0.04,195]] },
  { ingredient_id: 'multi_enzyme', nutrient_key: 'avp',
    curve_name: 'Multi-enzyme — avP release %',
    reference: 'MDPI Applied Sciences 16:2862 (2025)',
    breakpoints: [[0,0],[0.005,0.095],[0.01,0.125],[0.02,0.145]] },
  { ingredient_id: 'multi_enzyme', nutrient_key: 'sid_lys',
    curve_name: 'Multi-enzyme — SID Lys improvement %',
    reference: 'MDPI Applied Sciences 16:2862 (2025)',
    breakpoints: [[0,0],[0.005,0.025],[0.01,0.042],[0.02,0.054]] },
];

router.post('/enzyme-curves/seed-defaults', async (req, res) => {
  try {
    const db = getUserNpDb(req);
    await ensureSchema(db);
    const { ingredient_ids } = req.body || {};  // optional filter
    const seeded = [];
    const skipped = [];

    const toSeed = ingredient_ids
      ? ENZYME_DEFAULT_CURVES.filter(c => ingredient_ids.includes(c.ingredient_id))
      : ENZYME_DEFAULT_CURVES;

    for (const def of toSeed) {
      const existing = await db.get(
        'SELECT id FROM ingredient_response_curves WHERE ingredient_id = ? AND nutrient_key = ?',
        [def.ingredient_id, def.nutrient_key]
      );

      if (existing && !req.body?.overwrite) {
        skipped.push(`${def.ingredient_id}:${def.nutrient_key}`);
        continue;
      }

      const id = existing?.id || randomUUID();
      await db.run(`
        INSERT INTO ingredient_response_curves
          (id, ingredient_id, nutrient_key, curve_name, breakpoints, unit, reference, model_type, model_params)
        VALUES (?, ?, ?, ?, ?, 'inclusion_pct', ?, ?, ?)
        ON CONFLICT(ingredient_id, nutrient_key) DO UPDATE SET
          curve_name   = excluded.curve_name,
          breakpoints  = excluded.breakpoints,
          reference    = excluded.reference,
          model_type   = excluded.model_type,
          model_params = excluded.model_params,
          updated_at   = datetime('now')
      `, [id, def.ingredient_id, def.nutrient_key, def.curve_name,
          JSON.stringify(def.breakpoints), def.reference || '',
          def.model_type || 'breakpoints', JSON.stringify(def.model_params || {})]);
      seeded.push(`${def.ingredient_id}:${def.nutrient_key}`);
    }

    res.json({ ok: true, seeded, skipped, total_defaults: ENZYME_DEFAULT_CURVES.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
