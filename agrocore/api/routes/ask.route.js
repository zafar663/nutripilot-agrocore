/**
 * ask.route.js  —  POST /api/ask
 *
 * Browser-callable endpoint for Discora / web clients.
 * Accepts a natural-language question, routes it to the correct
 * AgroCore service, returns a formatted text answer + structured data.
 *
 * CORS is already enabled globally in server.js (app.use(cors())).
 */

import express from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const require     = createRequire(import.meta.url);
const __dirname   = dirname(fileURLToPath(import.meta.url));
const PERF_BASE   = resolve(__dirname, '../../../core/db/requirements');
const router      = express.Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function logQ(params) {
  try {
    const AIE = require('../../../core/intelligence/AIE.cjs');
    AIE.onQuestionAsked({ source: 'discora', ...params });
  } catch (_) {}
}

/** Detect question type from natural-language text */
function classifyQuestion(q) {
  const t = q.toLowerCase();

  // Formula: multiple lines OR contains numeric inclusion values
  const lines = q.split('\n').filter(l => l.trim());
  const hasFormulaLines = lines.length >= 2 && lines.some(l => /\d+(\.\d+)?/.test(l));
  if (hasFormulaLines) return 'formula';

  const BREED_NAMES = [
    'ross', 'cobb', 'hubbard', 'arbor', 'lohmann', 'isa brown', 'hy-line',
    'pic', 'topigs', 'duroc', 'landrace', 'yorkshire', 'pietrain',
    'holstein', 'friesian', 'jersey', 'murrah', 'angus', 'hereford',
    'dorper', 'boer', 'merino',
  ];
  if (BREED_NAMES.some(b => t.includes(b))) return 'breed_standards';

  const NUTRIENT_WORDS = [
    'lysine', 'methionine', 'threonine', 'tryptophan', 'protein', 'crude protein',
    'energy', 'me ', 'ame', 'nme', 'calcium', 'phosphorus', 'sodium', 'chloride',
    'linoleic', 'fat', 'fibre', 'fiber', 'moisture', 'amino acid', 'requirement',
    'nutrient', 'sid', 'digestible',
  ];
  if (NUTRIENT_WORDS.some(w => t.includes(w))) return 'nutrient_req';

  const MILL_WORDS = [
    'pellet', 'pdi', 'fines', 'conditioning', 'die', 'hammer mill', 'grind',
    'milling', 'mixing', 'cooling', 'crumble', 'shrinkage', 'moisture loss',
    'aflatoxin', 'mycotoxin', 'ddgs', 'canola', 'fish meal', 'fat', 'oil blend',
  ];
  if (MILL_WORDS.some(w => t.includes(w))) return 'mill_ops';

  return 'general';
}

/** Extract species hint from question text */
function extractSpecies(q) {
  const t = q.toLowerCase();
  if (/\b(broiler|layer|turkey|quail|poultry|chicken|hen|pullet|ross|cobb|hubbard)\b/.test(t)) return 'poultry';
  if (/\b(swine|pig|piglet|sow|boar|grower|finisher pig)\b/.test(t)) return 'swine';
  if (/\b(dairy|cow|holstein|jersey|buffalo|cattle|heifer)\b/.test(t)) return 'dairy';
  if (/\b(beef|steer|angus|hereford)\b/.test(t)) return 'beef';
  if (/\b(sheep|lamb|dorper|merino)\b/.test(t)) return 'sheep';
  if (/\b(goat|boer|caprine)\b/.test(t)) return 'goat';
  return null;
}

/** Extract breed name from question text */
function extractBreed(q) {
  const patterns = [
    /\b(ross\s*\d+)\b/i, /\b(cobb\s*\d+)\b/i, /\b(hubbard\s*\w+)\b/i,
    /\b(lohmann\s*\w+)\b/i, /\b(isa\s*brown)\b/i, /\b(hy-line\s*\w+)\b/i,
    /\b(pic\s*\d+)\b/i, /\b(topigs\s*\d+)\b/i,
    /\b(holstein)\b/i, /\b(jersey)\b/i, /\b(murrah)\b/i,
    /\b(angus)\b/i, /\b(hereford)\b/i,
    /\b(dorper)\b/i, /\b(boer)\b/i, /\b(merino)\b/i,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

/** Extract production stage from question text */
function extractProduction(q) {
  const t = q.toLowerCase();
  if (/\b(broiler|meat)\b/.test(t)) return 'broiler';
  if (/\b(layer|laying)\b/.test(t)) return 'layer';
  if (/\b(breeder)\b/.test(t)) return 'broiler_breeder';
  if (/\b(turkey)\b/.test(t)) return 'turkey';
  if (/\b(quail)\b/.test(t)) return 'quail';
  return null;
}

/** Load nutrient library for a species+production key */
function loadNutrientLibrary(species, production) {
  const libMap = {
    'poultry_broiler':         join(PERF_BASE, 'poultry', 'broiler', 'v1', 'library.poultry_broiler_meat.v1.json'),
    'poultry_layer':           join(PERF_BASE, 'poultry', 'layer', 'v1', 'requirements.library.poultry.layer.v1.json'),
    'poultry_layer_breeder':   join(PERF_BASE, 'poultry', 'layer_breeder', 'v1', 'requirements.library.poultry.layer_breeder.v1.json'),
    'poultry_broiler_breeder': join(PERF_BASE, 'poultry', 'broiler_breeder', 'v1', 'requirements.library.poultry.broiler_breeder.v1.json'),
    'poultry_turkey':          join(PERF_BASE, 'poultry', 'turkey', 'v1', 'requirements.library.poultry.turkey.v1.json'),
    'poultry_quail':           join(PERF_BASE, 'poultry', 'quail', 'v1', 'requirements.library.poultry.quail.v1.json'),
    'swine':                   join(PERF_BASE, 'swine', 'v1', 'requirements.library.swine.v1.json'),
  };
  const key = production ? `${species}_${production}` : species;
  const libPath = libMap[key] || libMap[species];
  if (!libPath || !existsSync(libPath)) return null;
  return JSON.parse(readFileSync(libPath, 'utf8'));
}

/** Format nutrient library profiles into a readable answer */
function formatNutrientAnswer(lib, question) {
  if (!lib) return null;
  const profiles = lib.profiles || lib;
  const keys = Object.keys(profiles);
  if (!keys.length) return null;

  // Pick first matching profile or the first one
  const t = question.toLowerCase();
  const match = keys.find(k => t.split(/\s+/).some(w => w.length > 3 && k.toLowerCase().includes(w))) || keys[0];
  const profile = profiles[match];
  if (!profile) return null;

  const SHOW = ['cp_pct', 'de_mcal_kg', 'me_mcal_kg', 'sid_lys_pct', 'sid_met_pct', 'sid_thr_pct',
                'calcium_pct', 'av_phos_pct', 'sodium_pct', 'linoleic_pct'];
  const LABELS = {
    cp_pct: 'Crude Protein', de_mcal_kg: 'DE (Mcal/kg)', me_mcal_kg: 'ME (Mcal/kg)',
    sid_lys_pct: 'SID Lysine', sid_met_pct: 'SID Methionine', sid_thr_pct: 'SID Threonine',
    calcium_pct: 'Calcium', av_phos_pct: 'Av. Phosphorus', sodium_pct: 'Sodium',
    linoleic_pct: 'Linoleic Acid',
  };

  const lines = [`📊 *Nutrient Requirements — ${match.replace(/_/g, ' ')}*`, ''];
  for (const key of SHOW) {
    const val = profile[key];
    if (val == null) continue;
    const label = LABELS[key] || key;
    const min = val.min != null ? val.min : null;
    const max = val.max != null ? val.max : null;
    const tgt = val.target != null ? val.target : null;
    const range = [min != null ? `min ${min}` : null, tgt != null ? `target ${tgt}` : null, max != null ? `max ${max}` : null].filter(Boolean).join(' · ');
    lines.push(`• ${label}: ${range || '-'}`);
  }
  lines.push('', `_Source: AgroCore nutrient library — profile: ${match}_`);
  return lines.join('\n');
}

// ── Route ────────────────────────────────────────────────────────────────────

router.post('/api/ask', async (req, res) => {
  const t0 = Date.now();
  const { question, source = 'discora', user_id = null } = req.body || {};

  if (!question || !String(question).trim()) {
    return res.status(400).json({ success: false, error: 'question is required' });
  }

  const q = String(question).trim();
  const type = classifyQuestion(q);
  const species = extractSpecies(q);
  const breed = extractBreed(q);
  const production = extractProduction(q);

  try {
    // ── Formula analysis ──────────────────────────────────────────────────
    if (type === 'formula') {
      const { analyzeFormula } = require('../../../core/engine/analyzeFormula.cjs');
      const result = await analyzeFormula({ formula_text: q, species: species || 'poultry', production: production || 'broiler' });

      const lines = ['🔬 *Formula Analysis*', ''];
      const np = result?.nutrient_profile_core || result?.nutrient_profile || {};
      const statusMap = {};
      for (const [k, v] of Object.entries(np)) {
        if (v?.status) statusMap[k] = v.status;
        const icon = v?.status === 'OK' ? '✅' : v?.status === 'FAIL' ? '❌' : v?.status === 'HIGH' ? '⚠️' : '•';
        if (v?.actual != null) lines.push(`${icon} ${k}: ${v.actual}${v?.unit || ''}`);
      }
      const totalInclusion = result?.parsed?.total_inclusion ?? result?.parsed?.total;
      if (totalInclusion != null) lines.push('', `Total inclusion: ${Number(totalInclusion).toFixed(2)}%`);

      const answer = lines.join('\n');
      logQ({ source, user_id, question: q, answer, query_type: 'formula', species, resolved: true, latency_ms: Date.now() - t0 });
      return res.json({ success: true, type: 'formula', answer, data: result });
    }

    // ── Nutrient requirements ─────────────────────────────────────────────
    if (type === 'nutrient_req') {
      const sp = species || 'poultry';
      const prod = production || 'broiler';
      const lib = loadNutrientLibrary(sp, prod);
      const answer = formatNutrientAnswer(lib, q)
        || `I found the nutrient library for ${sp} ${prod}, but couldn't match a specific phase from your question. Try asking: "lysine requirements Ross 308 starter".`;

      logQ({ source, user_id, question: q, answer, query_type: 'nutrient_req', species: sp, breed, phase: prod, resolved: !!lib, latency_ms: Date.now() - t0 });
      return res.json({ success: true, type: 'nutrient_req', answer, data: { species: sp, production: prod } });
    }

    // ── Breed standards ───────────────────────────────────────────────────
    if (type === 'breed_standards' && breed) {
      const flat = (() => {
        const perfIndexPath = join(PERF_BASE, 'performance.index.v1.json');
        if (!existsSync(perfIndexPath)) return {};
        const idx = JSON.parse(readFileSync(perfIndexPath, 'utf8'));
        const out = {};
        function walk(obj) {
          for (const [k, v] of Object.entries(obj)) {
            if (k === '_meta') continue;
            if (typeof v === 'string') out[k.toLowerCase().replace(/[\s-]/g, '_')] = v;
            else if (typeof v === 'object') walk(v);
          }
        }
        walk(idx);
        return out;
      })();

      const breedKey = breed.toLowerCase().replace(/[\s-]/g, '_');
      const filePath = flat[breedKey];
      if (filePath && existsSync(filePath)) {
        const file = JSON.parse(readFileSync(filePath, 'utf8'));
        const curve = file.curve || file.curve_male || file.lactation_curve || [];
        const snippet = curve.slice(0, 5);
        const lines = [`📊 *Production Standards — ${breed}*`, ''];
        if (snippet.length) {
          lines.push('Age · Body Weight · FCR (first 5 data points):');
          for (const pt of snippet) {
            const age = pt.age_days ?? pt.week ?? pt.day ?? '-';
            const bw  = pt.body_weight_g ?? pt.bw_g ?? pt.milk_yield_l_day ?? '-';
            const fcr = pt.fcr ?? pt.fcr_cumulative ?? '-';
            lines.push(`  Day ${age}: BW ${bw}g  FCR ${fcr}`);
          }
          lines.push('', `_${curve.length} data points total · Source: ${file._meta?.source || 'AgroCore breed library'}_`);
        } else {
          lines.push('Data loaded but no growth curve found in this file.');
        }
        const answer = lines.join('\n');
        logQ({ source, user_id, question: q, answer, query_type: 'breed_standards', species, breed, resolved: true, latency_ms: Date.now() - t0 });
        return res.json({ success: true, type: 'breed_standards', answer, data: { breed, points: curve.length } });
      }

      const answer = `I couldn't find breed standards for "${breed}" in the library. Try: Ross 308, Cobb 500, Lohmann Brown, Holstein.`;
      logQ({ source, user_id, question: q, answer, query_type: 'breed_standards', species, breed, resolved: false, latency_ms: Date.now() - t0 });
      return res.json({ success: true, type: 'breed_standards', answer });
    }

    // ── Fallback ──────────────────────────────────────────────────────────
    const answer = [
      '👋 I\'m AgroCore Prime AI — here\'s what I can help with:',
      '',
      '📋 *Formula analysis* — paste your ingredient list with %',
      '🧪 *Nutrient requirements* — e.g. "lysine Ross 308 starter"',
      '📊 *Breed standards* — e.g. "Cobb 500 growth standards"',
      '🏭 *Mill operations* — e.g. "PDI targets broiler"',
    ].join('\n');

    logQ({ source, user_id, question: q, answer, query_type: 'general', resolved: false, latency_ms: Date.now() - t0 });
    return res.json({ success: true, type: 'general', answer });

  } catch (err) {
    console.error('[ask.route] error:', err);
    logQ({ source, user_id, question: q, query_type: type, resolved: false, latency_ms: Date.now() - t0 });
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
});

export default router;
