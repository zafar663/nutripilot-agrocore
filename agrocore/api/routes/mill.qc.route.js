// ============================================================
// Feed Mill Intelligence Engine — QC Route
// nutripilot-agrocore/agrocore/api/routes/mill.qc.route.js
// ============================================================

import express from 'express';
import { createRequire } from 'module';
import multer from 'multer';
import OpenAI from 'openai';
import {
  recordQcResult,
  overrideQcDecision,
  getQcTrend,
  getPendingQc,
  evaluateQcResult,
  applyImageQc,
  getQcForBatch
} from '../../../core/services/mill/mill.qc.service.cjs';

const require = createRequire(import.meta.url);
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const router = express.Router();

// ── POST /v1/mill/qc/:batch_id ───────────────────────────────
// Records QC test results for a batch
// Auto-evaluates and sets hold/release decision
router.post('/:batch_id', (req, res) => {
  try {
    const { batch_id } = req.params;
    const {
      moisture_pct,
      pdi_pct,
      fines_pct,
      protein_pct,
      particle_size_mm,
      targets,
      notes,
      reviewed_by
    } = req.body;

    const result = recordQcResult({
      batch_id,
      moisture_pct:    moisture_pct    ?? null,
      pdi_pct:         pdi_pct         ?? null,
      fines_pct:       fines_pct       ?? null,
      protein_pct:     protein_pct     ?? null,
      particle_size_mm: particle_size_mm ?? null,
      targets:         targets         || {},
      notes:           notes           || null,
      reviewed_by:     reviewed_by     || null
    });

    return res.status(201).json(result);

  } catch (err) {
    console.error('[QcRoute] /record error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/qc/evaluate ────────────────────────────────
// Dry-run QC evaluation without saving
// Useful for previewing results before committing
router.post('/evaluate', (req, res) => {
  try {
    const {
      moisture_pct,
      pdi_pct,
      fines_pct,
      protein_pct,
      targets
    } = req.body;

    const result = evaluateQcResult({
      moisture_pct:  moisture_pct  ?? null,
      pdi_pct:       pdi_pct       ?? null,
      fines_pct:     fines_pct     ?? null,
      protein_pct:   protein_pct   ?? null,
      targets:       targets       || {}
    });

    return res.json({ ok: true, evaluation: result });

  } catch (err) {
    console.error('[QcRoute] /evaluate error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /v1/mill/qc/:batch_id/override ────────────────────
// Manual override of hold/release decision
// Full audit trail — reason and reviewer required
router.patch('/:batch_id/override', (req, res) => {
  try {
    const { batch_id } = req.params;
    const { decision, override_reason, reviewed_by } = req.body;

    if (!decision || !override_reason || !reviewed_by) {
      return res.status(400).json({
        ok: false,
        error: 'decision, override_reason and reviewed_by are all required'
      });
    }

    const result = overrideQcDecision(
      batch_id, decision, override_reason, reviewed_by
    );

    if (!result.ok) return res.status(400).json(result);
    return res.json(result);

  } catch (err) {
    console.error('[QcRoute] /override error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/qc/pending/:mill_id ────────────────────────
// Batches completed but not yet QC reviewed
router.get('/pending/:mill_id', (req, res) => {
  try {
    const result = getPendingQc(req.params.mill_id);
    return res.json(result);

  } catch (err) {
    console.error('[QcRoute] /pending error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /v1/mill/qc/trend/:mill_id ──────────────────────────
// QC trend across recent batches — for weekly report
router.get('/trend/:mill_id', (req, res) => {
  try {
    const { days } = req.query;
    const result = getQcTrend(
      req.params.mill_id,
      days ? parseInt(days) : 30
    );
    return res.json(result);

  } catch (err) {
    console.error('[QcRoute] /trend error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/result/:batch_id', (req, res) => {
  try {
    return res.json(getQcForBatch(req.params.batch_id));
  } catch (err) {
    console.error('[QcRoute] /result error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /v1/mill/qc/analyze-image ──────────────────────────
// Mill IQ visual feed quality analysis via AI vision
// Accepts: multipart image upload OR { image_base64, batch_id, formula_name, species }
router.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    let imageData = null;
    let mimeType  = 'image/jpeg';

    if (req.file) {
      imageData = req.file.buffer.toString('base64');
      mimeType  = req.file.mimetype || 'image/jpeg';
    } else if (req.body?.image_base64) {
      imageData = req.body.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
      mimeType  = req.body.image_mime || 'image/jpeg';
    }

    if (!imageData) {
      return res.status(400).json({ ok: false, error: 'image required (upload field "image" or body.image_base64)' });
    }

    const { batch_id, formula_name, species, production_phase } = req.body || {};

    const contextStr = [
      formula_name  && `Formula: ${formula_name}`,
      species       && `Species: ${species}`,
      production_phase && `Phase: ${production_phase}`,
      batch_id      && `Batch ID: ${batch_id}`
    ].filter(Boolean).join(', ') || 'No batch context provided';

    const prompt = `You are a feed mill quality control expert analyzing a feed/pellet image.

Context: ${contextStr}

Analyze this image and provide a structured quality assessment. Evaluate:
1. **Pellet Quality**: uniformity, shape, length consistency, broken pellets, fines
2. **Color & Appearance**: expected color for species/formula, discoloration, mold signs
3. **Texture & Surface**: smooth vs rough, dusty, oily sheen
4. **Estimated PDI**: pellet durability index estimate based on visual appearance
5. **Estimated Fines %**: visual estimate of fine particle content
6. **Issues Detected**: any visible quality problems
7. **Overall Grade**: PASS / WARN / FAIL with brief reason
8. **Recommended Actions**: specific corrective actions if issues found

Respond in this exact JSON format:
{
  "overall_grade": "PASS|WARN|FAIL",
  "confidence": "high|medium|low",
  "pellet_quality": { "score": 1-10, "notes": "..." },
  "color_appearance": { "score": 1-10, "notes": "..." },
  "texture_surface": { "score": 1-10, "notes": "..." },
  "estimated_pdi_pct": null or number,
  "estimated_fines_pct": null or number,
  "issues": ["issue1", "issue2"],
  "recommendations": ["action1", "action2"],
  "summary": "One sentence overall assessment"
}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'mock') {
      const mock = {
        ok: true, mock: true,
        overall_grade: 'PASS', confidence: 'low',
        pellet_quality: { score: 7, notes: 'Uniform shape, minimal breakage' },
        color_appearance: { score: 8, notes: 'Consistent golden-brown color' },
        texture_surface: { score: 7, notes: 'Smooth surface, low dust' },
        estimated_pdi_pct: 78, estimated_fines_pct: 3.5,
        issues: [], recommendations: [],
        summary: 'Feed appears to be within acceptable quality parameters (mock response — configure OPENAI_API_KEY for real analysis)',
        batch_id, formula_name, species
      };
      if (batch_id) {
        try { mock.qc = applyImageQc(batch_id, mock); } catch (_e) {}
      }
      return res.json(mock);
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData}`, detail: 'high' } }
        ]
      }]
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let analysis = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      analysis = { summary: raw, overall_grade: 'WARN', confidence: 'low', issues: [], recommendations: [] };
    }

    let qc = null;
    if (batch_id) {
      try { qc = applyImageQc(batch_id, analysis); } catch (_e) {}
    }
    res.json({ ok: true, ...analysis, batch_id, formula_name, species, analyzed_at: new Date().toISOString(), qc });
  } catch (e) {
    console.error('[QcRoute] /analyze-image error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;