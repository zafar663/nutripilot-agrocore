// â”€â”€â”€ FarmPulse Route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { Router } from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { learn } from '../lib/learn-hook.js';

const require    = createRequire(import.meta.url);
const __dirname  = dirname(fileURLToPath(import.meta.url));
const PERF_BASE  = resolve(__dirname, '../../../core/db/requirements');
const { ensureFarmPulseForRequest } = require('../../../core/db/farmpulse/ensure-farmpulse-schema.cjs');
const router     = Router();

router.use(async (req, res, next) => {
  try { await ensureFarmPulseForRequest(req); } catch (e) {
    console.error('[FarmPulse] workspace schema ensure failed:', e?.message || e);
  }
  next();
});

function logQ(params) {
  try {
    const AIE = require('../../../core/intelligence/AIE.cjs');
    AIE.onQuestionAsked(params);
  } catch (_) {}
}

// â”€â”€ Service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const svc = require('../../../core/services/farmpulse/farmpulse.service.cjs');

// â”€â”€ Performance standards index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let perfIndex = {};
try {
  const indexPath = join(PERF_BASE, 'performance.index.v1.json');
  console.log('[FarmPulse] Index path:', indexPath);
  console.log('[FarmPulse] Index exists:', existsSync(indexPath));
  perfIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  console.log('[FarmPulse] Index top-level keys:', Object.keys(perfIndex));
} catch (err) {
  console.error('[FarmPulse] Index load failed:', err.message);
}

function normalizeBreed(b) {
  return String(b || '').toLowerCase().replace(/[\s\-]/g, '_');
}

function flattenIndex(obj, out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_meta') continue;
    if (typeof v === 'string') out[normalizeBreed(k)] = v;
    else if (typeof v === 'object') flattenIndex(v, out);
  }
  return out;
}

const BREED_LIBRARY_PATH = join(PERF_BASE, 'performance.library.all_breeds.v2025.json');
const DAIRY_LIBRARY_PATH = join(PERF_BASE, 'performance.library.dairy.v2025.json');
const BEEF_LIBRARY_PATH  = join(PERF_BASE, 'performance.library.beef.v2025.json');
let breedLibrary = {};
try {
  if (existsSync(BREED_LIBRARY_PATH)) {
    breedLibrary = JSON.parse(readFileSync(BREED_LIBRARY_PATH, 'utf8'));
    console.log('[FarmPulse] Breed library loaded, sections:', Object.keys(breedLibrary).filter(k => k !== '_meta'));
  }
  if (existsSync(DAIRY_LIBRARY_PATH)) {
    const dairyLib = JSON.parse(readFileSync(DAIRY_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, dairyLib);
    console.log('[FarmPulse] Dairy library loaded, sections:', Object.keys(dairyLib).filter(k => k !== '_meta'));
  }
  const SHEEP_LIBRARY_PATH = join(PERF_BASE, 'sheep', 'performance.library.sheep.v2025.json');  if (existsSync(SHEEP_LIBRARY_PATH)) {
    const sheepLib = JSON.parse(readFileSync(SHEEP_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, sheepLib);
  }
  const GOAT_LIBRARY_PATH = join(PERF_BASE, 'goat', 'performance.library.goat.v2025.json');
  if (existsSync(GOAT_LIBRARY_PATH)) {
    const goatLib = JSON.parse(readFileSync(GOAT_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, goatLib);
  }  if (existsSync(BEEF_LIBRARY_PATH)) {
    const beefLib = JSON.parse(readFileSync(BEEF_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, beefLib);
    console.log('[FarmPulse] Beef library loaded, sections:', Object.keys(beefLib).filter(k => k !== '_meta'));
  }  if (existsSync(GOAT_LIBRARY_PATH)) {
    const goatLib = JSON.parse(readFileSync(GOAT_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, goatLib);
    console.log('[FarmPulse] Goat library loaded, sections:', Object.keys(goatLib).filter(k => k !== '_meta'));
  }
  const FEED_MILL_PATH = join(PERF_BASE, 'feed.mill.library.v2025.json');
  console.log('[FarmPulse] Feed mill path:', FEED_MILL_PATH, 'exists:', existsSync(FEED_MILL_PATH));
  if (existsSync(FEED_MILL_PATH)) {
    const feedMillLib = JSON.parse(readFileSync(FEED_MILL_PATH, 'utf8'));
    breedLibrary['feed_mill'] = feedMillLib;
    console.log('[FarmPulse] Feed mill library loaded, sections:', Object.keys(feedMillLib).filter(k => k !== '_meta'));
  }
  const EQUINE_HORSE_PATH  = join(PERF_BASE, 'equine', 'horse',  'performance.library.equine.v2025.json');
  const EQUINE_DONKEY_PATH = join(PERF_BASE, 'equine', 'donkey', 'performance.library.donkey.v2025.json');
  const EQUINE_MULE_PATH   = join(PERF_BASE, 'equine', 'mule',   'performance.library.mule.v2025.json');
  if (existsSync(EQUINE_HORSE_PATH)) {
    const lib = JSON.parse(readFileSync(EQUINE_HORSE_PATH, 'utf8'));
    breedLibrary['equine'] = { ...breedLibrary['equine'], ...lib };
    console.log('[FarmPulse] Equine horse library loaded');
  }
  if (existsSync(EQUINE_DONKEY_PATH)) {
    const lib = JSON.parse(readFileSync(EQUINE_DONKEY_PATH, 'utf8'));
    breedLibrary['equine_donkey'] = { ...breedLibrary['equine_donkey'], ...lib };
    console.log('[FarmPulse] Donkey library loaded');
  }
  if (existsSync(EQUINE_MULE_PATH)) {
    const lib = JSON.parse(readFileSync(EQUINE_MULE_PATH, 'utf8'));
    breedLibrary['equine_mule'] = { ...breedLibrary['equine_mule'], ...lib };
    console.log('[FarmPulse] Mule library loaded');
  }
  const AQUA_LIBRARY_PATH      = join(PERF_BASE, 'aquaculture', 'performance.library.aquaculture.v2025.json');
  const CAMELID_LIBRARY_PATH   = join(PERF_BASE, 'camelid',     'performance.library.camelid.v2025.json');
  const COMPANION_LIBRARY_PATH = join(PERF_BASE, 'companion',   'performance.library.companion.v2025.json');
  const RABBIT_LIBRARY_PATH    = join(PERF_BASE, 'rabbit',      'performance.library.rabbit.v2025.json');
  if (existsSync(AQUA_LIBRARY_PATH)) {
    const lib = JSON.parse(readFileSync(AQUA_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, lib);
    console.log('[FarmPulse] Aquaculture library loaded');
  }
  if (existsSync(CAMELID_LIBRARY_PATH)) {
    const lib = JSON.parse(readFileSync(CAMELID_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, lib);
    console.log('[FarmPulse] Camelid library loaded');
  }
  if (existsSync(COMPANION_LIBRARY_PATH)) {
    const lib = JSON.parse(readFileSync(COMPANION_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, lib);
    console.log('[FarmPulse] Companion animal library loaded');
  }
  if (existsSync(RABBIT_LIBRARY_PATH)) {
    const lib = JSON.parse(readFileSync(RABBIT_LIBRARY_PATH, 'utf8'));
    Object.assign(breedLibrary, lib);
    console.log('[FarmPulse] Rabbit library loaded');
  }
} catch(e) { console.error('[FarmPulse] Breed library load failed:', e.message); }

function loadPerfFile(relPath) {
  if (relPath && relPath.startsWith('library:')) {
    const key = relPath.replace('library:', '');
    const dotIdx = key.indexOf('.');
    const section = key.substring(0, dotIdx);
    const breed = key.substring(dotIdx + 1);
    return breedLibrary[section]?.[breed] ?? null;
  }
  const full = join(PERF_BASE, ...relPath.split('/'));
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, 'utf8'));
}

function ok(res, data)  { res.json({ success: true, data }); }
function err(res, e, status = 500) {
  console.error('[FarmPulse]', e.message || e);
  res.status(status).json({ success: false, error: e.message || String(e) });
}

// â”€â”€ Breed standards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/breed-standards', (req, res) => {
  try {
    const flat = flattenIndex(perfIndex);
    if (!req.query.breed) return ok(res, Object.keys(flat));
    const p = flat[normalizeBreed(req.query.breed)];
    if (!p) return res.status(404).json({ success: false, error: `Breed '${req.query.breed}' not found` });
    const file = loadPerfFile(p);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    ok(res, file.curve || file.curve_male || file.lactation_curve || []);
  } catch (e) { err(res, e); }
});

router.get('/breed-standards/detail', (req, res) => {
  try {
    if (!req.query.breed) return res.status(400).json({ success: false, error: 'breed required' });
    const flat = flattenIndex(perfIndex);
    const p    = flat[normalizeBreed(req.query.breed)];
    if (!p) return res.status(404).json({ success: false, error: `Breed '${req.query.breed}' not found` });
    const file = loadPerfFile(p);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (!file.curve && (file.curve_male || file.curve_female)) { file.curve = file.curve_male || file.curve_female; } if (!file.curve && file.lactation_curve) { file.curve = file.lactation_curve; }
    logQ({ source: req.headers['x-source'] || 'web', question: `breed standards: ${req.query.breed}`, query_type: 'breed_standards', species: file.species || null, breed: req.query.breed, resolved: true });
    ok(res, file);
  } catch (e) { err(res, e); }
});

router.get('/breed-standards/index', (_req, res) => ok(res, perfIndex));

// ── Mill batch linkage ────────────────────────────────────────────────────────
router.get('/nutrient-library', (req, res) => {
  try {
    const { species, production, breed, phase } = req.query;
    if (!species) return res.status(400).json({ success: false, error: 'species required' });
    const libMap = {
      'poultry_broiler': join(PERF_BASE, 'poultry', 'broiler', 'v1', 'library.poultry_broiler_meat.v1.json'),
      'poultry_layer': join(PERF_BASE, 'poultry', 'layer', 'v1', 'requirements.library.poultry.layer.v1.json'),
      'poultry_layer_breeder': join(PERF_BASE, 'poultry', 'layer_breeder', 'v1', 'requirements.library.poultry.layer_breeder.v1.json'),
      'poultry_broiler_breeder': join(PERF_BASE, 'poultry', 'broiler_breeder', 'v1', 'requirements.library.poultry.broiler_breeder.v1.json'),
      'poultry_turkey': join(PERF_BASE, 'poultry', 'turkey', 'v1', 'requirements.library.poultry.turkey.v1.json'),
      'poultry_quail': join(PERF_BASE, 'poultry', 'quail', 'v1', 'requirements.library.poultry.quail.v1.json'),
      'swine': join(PERF_BASE, 'swine', 'v1', 'requirements.library.swine.v1.json'),
    };
    const key = production ? species + '_' + production : species;
    const libPath = libMap[key] || libMap[species];
    if (!libPath || !existsSync(libPath)) return res.status(404).json({ success: false, error: 'No nutrient library for ' + key });
    const lib = JSON.parse(readFileSync(libPath, 'utf8'));
    const profiles = lib.profiles || lib;
    logQ({ source: req.headers['x-source'] || 'web', question: `nutrient requirements: ${species} ${production || ''} ${breed || ''} ${phase || ''}`.trim(), query_type: 'nutrient_req', species, breed: breed || null, phase: phase || null, resolved: true });
    if (breed || phase) {
      const filtered = {};
      for (const [k, v] of Object.entries(profiles)) {
        const matchBreed = !breed || k.includes(breed.toLowerCase().replace(/\s/g,''));
        const matchPhase = !phase || k.includes(phase.toLowerCase());
        if (matchBreed && matchPhase) filtered[k] = v;
      }
      return res.json({ success: true, data: { profiles: filtered } });
    }
    res.json({ success: true, data: lib });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mill-library', (req, res) => {
  try {
    const lib = breedLibrary['feed_mill'];
    if (!lib) return res.status(404).json({ success: false, error: 'Feed mill library not loaded' });
    const { section } = req.query;
    logQ({ source: req.headers['x-source'] || 'web', question: `mill operations: ${section || 'all'}`, query_type: 'mill_ops', resolved: true });
    if (section) {
      const data = lib[section];
      if (!data) return res.status(404).json({ success: false, error: 'Section not found' });
      return res.json({ success: true, data });
    }
    res.json({ success: true, data: lib });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/mill-batches', (_req, res) => {
  try {
    const millDbPath = resolve(__dirname, '../../../data/mill.db');
    const Database   = require('better-sqlite3');
    const millDb     = new Database(millDbPath, { readonly: true });
    const batches    = millDb.prepare(`
      SELECT mb.id, mb.mill_id, mb.batch_number, mb.planned_qty_tons, mb.actual_qty_tons,
             mb.status, mb.dispatched_at, mb.completed_at, mb.created_at,
             fs.formula_id, fs.formula_version, fs.formula_name, fs.feed_type, fs.species,
             fs.cost_per_ton
      FROM mill_batches mb
      LEFT JOIN mill_formula_snapshots fs ON fs.id = mb.formula_snapshot_id
      WHERE mb.status IN ('dispatched','completed','reviewed','in_progress')
      ORDER BY COALESCE(mb.completed_at, mb.dispatched_at, mb.created_at) DESC
      LIMIT 80
    `).all();
    const ids = batches.map(b => b.id).filter(Boolean);
    let ings = [];
    if (ids.length) {
      try {
        const ph = ids.map(() => '?').join(',');
        ings = millDb.prepare(`
          SELECT batch_id, ingredient_id, ingredient_name, planned_kg, actual_kg,
                 deviation_pct, deviation_flag, cost_per_kg, planned_cost, actual_cost, cost_impact
          FROM mill_batch_ingredients WHERE batch_id IN (${ph})
        `).all(...ids);
      } catch (_e) {
        try {
          const ph = ids.map(() => '?').join(',');
          ings = millDb.prepare(`
            SELECT batch_id, ingredient_id, ingredient_name, planned_kg, actual_kg,
                   deviation_pct, deviation_flag
            FROM mill_batch_ingredients WHERE batch_id IN (${ph})
          `).all(...ids);
        } catch (__e) {
          ings = [];
        }
      }
    }
    const by = {};
    for (const i of ings) {
      if (!by[i.batch_id]) by[i.batch_id] = [];
      by[i.batch_id].push(i);
    }
    millDb.close();
    res.json({ success: true, data: batches.map(b => ({ ...b, ingredients: by[b.id] || [] })) });
  } catch (e) { err(res, e); }
});

// â”€â”€ Farms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/farms',      (req, res) => { try { ok(res, svc.getFarms(req.query.status)); } catch(e) { err(res,e); }});
router.get('/farms/:id',  (req, res) => { try { const f = svc.getFarm(+req.params.id); f ? ok(res,f) : res.status(404).json({success:false,error:'Not found'}); } catch(e){err(res,e);}});
router.post('/farms',     (req, res) => { try { ok(res, svc.createFarm(req.body)); } catch(e) { err(res,e); }});
router.patch('/farms/:id',(req, res) => { try { ok(res, svc.updateFarm(+req.params.id, req.body)); } catch(e){err(res,e);}});

// â”€â”€ Flocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/flocks',       (req, res) => { try { ok(res, svc.getFlocks({ farm_id: req.query.farm_id ? +req.query.farm_id : null, status: req.query.status })); } catch(e){err(res,e);}});
router.get('/flocks/:id',   (req, res) => { try { const f = svc.getFlock(+req.params.id); f ? ok(res,f) : res.status(404).json({success:false,error:'Not found'}); } catch(e){err(res,e);}});
router.get('/flocks/:id/adaptive-ration', (req, res) => {
  try {
    const flock = svc.getFlock(+req.params.id);
    if (!flock) return res.status(404).json({ success: false, error: 'Flock not found' });
    const records = svc.getDailyRecords({ flock_id: flock.id, limit: 1 });
    const record = records[0] || null;
    const ageDays = flock.placement_date
      ? Math.round((Date.now() - new Date(flock.placement_date).getTime()) / 86400000)
        + ((flock.age_at_placement_weeks || 0) * 7)
      : (record?.age_days ?? null);

    let standardPoint = null;
    if (flock.breed) {
      const flat = flattenIndex(perfIndex);
      const perfPath = flat[normalizeBreed(flock.breed)];
      const file = perfPath ? loadPerfFile(perfPath) : null;
      const curve = file ? (file.curve || file.curve_male || file.curve_female || []) : [];
      if (curve.length && ageDays != null) {
        const useWeeks = curve[0].week != null;
        const ageNorm = useWeeks ? ageDays / 7 : ageDays;
        const getAge = (pt) => pt.week ?? pt.day ?? pt.age ?? 0;
        standardPoint = curve[0];
        for (const pt of curve) {
          if (Math.abs(getAge(pt) - ageNorm) < Math.abs(getAge(standardPoint) - ageNorm)) standardPoint = pt;
        }
      }
    }

    const { proposeAdaptiveRation, inferPoultryPhase, mapProductionType } = require('../../../core/services/farmpulse/precision.feed.service.cjs');
    const mapped = mapProductionType(flock.production_type);
    const phase = inferPoultryPhase(mapped.type, ageDays) || 'grower';
    let bookTargets = {};
    try {
      const load = require('../../../core/db/requirements/_index/LOAD_REQUIREMENTS.cjs');
      const loaded = (load.loadRequirementsProfile || load)({
        species: mapped.species,
        type: mapped.type,
        breed: flock.breed || 'generic',
        phase,
        production: mapped.production,
        region: 'global',
        version: 'v1'
      });
      bookTargets = loaded?.requirements || loaded?.profile?.targets || loaded?.targets || {};
    } catch (_e) {}

    const proposal = proposeAdaptiveRation({
      flock, record, standardPoint, bookTargets,
      type: mapped.type, phase, ageDays
    });
    return ok(res, proposal);
  } catch (e) { err(res, e); }
});
router.post('/flocks',      (req, res) => { try { ok(res, svc.createFlock(req.body)); } catch(e){err(res,e);}});
router.patch('/flocks/:id', (req, res) => { try { ok(res, svc.updateFlock(+req.params.id, req.body)); } catch(e){err(res,e);}});

// â”€â”€ Houses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/houses',       (req, res) => { try { ok(res, svc.getHouses({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null })); } catch(e){err(res,e);}});
router.post('/houses',      (req, res) => { try { ok(res, svc.createHouse(req.body)); } catch(e){err(res,e);}});
router.patch('/houses/:id', (req, res) => { try { ok(res, svc.updateHouse(+req.params.id, req.body)); } catch(e){err(res,e);}});

// â”€â”€ Feed batches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/feed-batches',  (req, res) => { try { ok(res, svc.getFeedBatches({ farm_id: req.query.farm_id ? +req.query.farm_id : null, status: req.query.status })); } catch(e){err(res,e);}});
router.post('/feed-batches', (req, res) => { try { ok(res, svc.createFeedBatch(req.body)); } catch(e){err(res,e);}});

// â”€â”€ Daily records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/daily-records', (req, res) => { try { ok(res, svc.getDailyRecords({ flock_id: req.query.flock_id ? +req.query.flock_id : null, house_id: req.query.house_id ? +req.query.house_id : null, from: req.query.from, to: req.query.to, limit: req.query.limit ? +req.query.limit : 90 })); } catch(e){err(res,e);}});
router.patch('/daily-records/:id', (req, res) => { try { ok(res, svc.updateDailyRecord(+req.params.id, req.body)); } catch(e){err(res,e);}});
router.delete('/daily-records/:id', (req, res) => { try { ok(res, svc.deleteDailyRecord(+req.params.id)); } catch(e){err(res,e);}});
router.post('/daily-records',(req, res) => {
  try {
    const data = svc.createDailyRecord(req.body);
    const b = req.body || {};
    learn({
      source: 'farmpulse', kind: 'daily_record',
      user_id: b.recorded_by || b.user_id || null,
      species: b.species || null,
      title: `Farm daily record flock ${b.flock_id || ''}`,
      text: JSON.stringify({
        mortality: b.mortality, feed_kg: b.feed_kg, body_weight: b.body_weight,
        fcr: b.fcr, egg_count: b.egg_count, water_l: b.water_l
      }).slice(0, 2000),
      metadata: { flock_id: b.flock_id }
    });
    ok(res, data);
  } catch(e) { err(res,e); }
});
router.get('/daily-records/flock/:id/trend', (req, res) => { try { ok(res, svc.getFlockTrend(+req.params.id, req.query.from, req.query.to)); } catch(e){err(res,e);}});

// â”€â”€ Alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/alerts',        (req, res) => { try { ok(res, svc.getAlerts({ flock_id: req.query.flock_id ? +req.query.flock_id : null, farm_id: req.query.farm_id ? +req.query.farm_id : null, status: req.query.status, severity: req.query.severity })); } catch(e){err(res,e);}});
router.patch('/alerts/:id',  (req, res) => { try { ok(res, svc.resolveAlert(+req.params.id, req.body)); } catch(e){err(res,e);}});

// â”€â”€ Environmental logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/environmental-logs', (req, res) => { try { ok(res, svc.createEnvironmentalLog(req.body)); } catch(e){err(res,e);}});

// â”€â”€ Body weight samples â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/body-weight-samples', (req, res) => { try { ok(res, svc.createBodyWeightSample(req.body)); } catch(e){err(res,e);}});

// â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/summary', (req, res) => { try { ok(res, svc.getSummary(req.query.farm_id ? +req.query.farm_id : null)); } catch(e){err(res,e);}});

// ════════════════════════════════════════════════════════════════════
// POULSOFT-PARITY ROUTES
// ════════════════════════════════════════════════════════════════════

// ── Egg Grading (Feature 1) ───────────────────────────────────────────────────
router.get('/egg-gradings',  (req, res) => { try { ok(res, svc.getEggGradings({ flock_id: req.query.flock_id ? +req.query.flock_id : null, farm_id: req.query.farm_id ? +req.query.farm_id : null, from: req.query.from, to: req.query.to })); } catch(e){err(res,e);}});
router.post('/egg-gradings', (req, res) => { try { ok(res, svc.createEggGrading(req.body)); } catch(e){err(res,e);}});

router.get('/egg-inventory',  (req, res) => { try { ok(res, svc.getEggInventory({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null })); } catch(e){err(res,e);}});
router.post('/egg-inventory', (req, res) => { try { ok(res, svc.createEggInventoryTxn(req.body)); } catch(e){err(res,e);}});

router.get('/egg-sales',  (req, res) => { try { ok(res, svc.getEggSales({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null, from: req.query.from, to: req.query.to })); } catch(e){err(res,e);}});
router.post('/egg-sales', (req, res) => { try { ok(res, svc.createEggSale(req.body)); } catch(e){err(res,e);}});

// ── Hatchery (Feature 2) ──────────────────────────────────────────────────────
router.get('/hatch-records',  (req, res) => { try { ok(res, svc.getHatchRecords({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null })); } catch(e){err(res,e);}});
router.post('/hatch-records', (req, res) => { try { ok(res, svc.createHatchRecord(req.body)); } catch(e){err(res,e);}});
router.get('/chick-sales',  (req, res) => { try { ok(res, svc.getChickSales({ farm_id: req.query.farm_id ? +req.query.farm_id : null })); } catch(e){err(res,e);}});
router.post('/chick-sales', (req, res) => { try { ok(res, svc.createChickSale(req.body)); } catch(e){err(res,e);}});

// ── Medicine / Vaccine (Feature 3) ───────────────────────────────────────────
router.get('/medicine',         (req, res) => { try { ok(res, svc.getMedicineInventory({ farm_id: req.query.farm_id ? +req.query.farm_id : null })); } catch(e){err(res,e);}});
router.post('/medicine',        (req, res) => { try { ok(res, svc.createMedicineItem(req.body)); } catch(e){err(res,e);}});
router.patch('/medicine/:id',   (req, res) => { try { ok(res, svc.updateMedicineItem(+req.params.id, req.body)); } catch(e){err(res,e);}});
router.get('/medicine-transactions',  (req, res) => { try { ok(res, svc.getMedicineTransactions({ medicine_id: req.query.medicine_id ? +req.query.medicine_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null })); } catch(e){err(res,e);}});
router.post('/medicine-transactions', (req, res) => { try { ok(res, svc.createMedicineTxn(req.body)); } catch(e){err(res,e);}});

// ── Bird Purchases + Transfers (Feature 4) ────────────────────────────────────
router.get('/bird-purchases',  (req, res) => { try { ok(res, svc.getBirdPurchases({ farm_id: req.query.farm_id ? +req.query.farm_id : null })); } catch(e){err(res,e);}});
router.post('/bird-purchases', (req, res) => { try { ok(res, svc.createBirdPurchase(req.body)); } catch(e){err(res,e);}});
router.get('/bird-transfers',  (req, res) => { try { ok(res, svc.getBirdTransfers({ farm_id: req.query.farm_id ? +req.query.farm_id : null })); } catch(e){err(res,e);}});
router.post('/bird-transfers', (req, res) => { try { ok(res, svc.createBirdTransfer(req.body)); } catch(e){err(res,e);}});

// ── Farm Expenses (Feature 5) ─────────────────────────────────────────────────
router.get('/expenses',  (req, res) => { try { ok(res, svc.getFarmExpenses({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null, from: req.query.from, to: req.query.to, category: req.query.category })); } catch(e){err(res,e);}});
router.post('/expenses', (req, res) => { try { ok(res, svc.createExpense(req.body)); } catch(e){err(res,e);}});

// ── Breeder Sex Records (Feature 6) ──────────────────────────────────────────
router.get('/breeder-sex-records',  (req, res) => { try { ok(res, svc.getBreederSexRecords({ flock_id: req.query.flock_id ? +req.query.flock_id : null, from: req.query.from, to: req.query.to })); } catch(e){err(res,e);}});
router.post('/breeder-sex-records', (req, res) => { try { ok(res, svc.createBreederSexRecord(req.body)); } catch(e){err(res,e);}});

// ── Comparative Reports (Feature 7) ──────────────────────────────────────────
router.get('/comparative', (req, res) => {
  try {
    const ids = req.query.farm_ids ? req.query.farm_ids.split(',').map(Number) : null;
    ok(res, svc.getComparativeReport({ farm_ids: ids }));
  } catch(e){err(res,e);}
});

// ── Slaughter / Processing (Feature 8) ───────────────────────────────────────
router.get('/slaughter-records',  (req, res) => { try { ok(res, svc.getSlaughterRecords({ farm_id: req.query.farm_id ? +req.query.farm_id : null, flock_id: req.query.flock_id ? +req.query.flock_id : null })); } catch(e){err(res,e);}});
router.post('/slaughter-records', (req, res) => { try { ok(res, svc.createSlaughterRecord(req.body)); } catch(e){err(res,e);}});
router.get('/processing-records',  (req, res) => { try { ok(res, svc.getProcessingRecords({ farm_id: req.query.farm_id ? +req.query.farm_id : null, slaughter_record_id: req.query.slaughter_record_id ? +req.query.slaughter_record_id : null })); } catch(e){err(res,e);}});
router.post('/processing-records', (req, res) => { try { ok(res, svc.createProcessingRecord(req.body)); } catch(e){err(res,e);}});

// ── SMS/WhatsApp Alerts (Feature 9) ──────────────────────────────────────────
router.post('/notify', async (req, res) => {
  try {
    const { channel = 'sms', recipient, message, flock_id, alert_id } = req.body;
    if (!recipient || !message) return res.status(400).json({ success: false, error: 'recipient and message required' });

    const SID   = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM  = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER;

    let provider_sid = null;
    let status = 'sent';
    let error_message = null;

    if (SID && TOKEN && FROM) {
      try {
        const twilio = require('twilio');
        const client = twilio(SID, TOKEN);
        const to = channel === 'whatsapp' ? `whatsapp:${recipient}` : recipient;
        const from = channel === 'whatsapp' ? `whatsapp:${FROM}` : FROM;
        const result = await client.messages.create({ body: message, to, from });
        provider_sid = result.sid;
      } catch(twilioErr) {
        status = 'failed';
        error_message = twilioErr.message;
        console.error('[FarmPulse] Twilio error:', twilioErr.message);
      }
    } else {
      status = 'failed';
      error_message = 'Twilio not configured';
      console.warn('[FarmPulse] Twilio not configured — notification not sent');
    }

    const log = svc.logNotification({ flock_id: flock_id||null, alert_id: alert_id||null, channel, recipient, message, status, provider_sid, error_message });
    ok(res, { log, status });
  } catch(e){err(res,e);}
});

// ── CTS / Live Bird Trading (Feature 10) ─────────────────────────────────────
router.get('/trade-customers',  (req, res) => { try { ok(res, svc.getTradeCustomers()); } catch(e){err(res,e);}});
router.post('/trade-customers', (req, res) => { try { ok(res, svc.createTradeCustomer(req.body)); } catch(e){err(res,e);}});
router.get('/live-bird-trades',  (req, res) => { try { ok(res, svc.getLiveBirdTrades({ farm_id: req.query.farm_id ? +req.query.farm_id : null, customer_id: req.query.customer_id ? +req.query.customer_id : null, from: req.query.from, to: req.query.to })); } catch(e){err(res,e);}});
router.post('/live-bird-trades', (req, res) => { try { ok(res, svc.createLiveBirdTrade(req.body)); } catch(e){err(res,e);}});

// ── Performance Analysis ──────────────────────────────────────────────────────
// POST /api/farmpulse/perf-analyze
// Body: { breed, age, age_unit?, kpis: { body_wt_g?, fcr?, mortality_pct?,
//         egg_prod_pct?, egg_wt_g?, adg_g?, feed_per_bird_g? } }
router.post('/perf-analyze', (req, res) => {
  try {
    const { breed, age, age_unit = 'day', kpis = {} } = req.body || {};
    if (!breed) return res.status(400).json({ ok: false, error: 'breed required' });
    if (age == null) return res.status(400).json({ ok: false, error: 'age required' });

    // Resolve age to days
    const ageDays = age_unit === 'week'  ? Number(age) * 7
                  : age_unit === 'month' ? Number(age) * 30
                  : Number(age);

    // Look up breed in the performance index
    const flat      = flattenIndex(perfIndex);
    const perfPath  = flat[normalizeBreed(breed)];
    const file      = perfPath ? loadPerfFile(perfPath) : null;
    const curve     = file ? (file.curve || file.curve_male || file.curve_female || file.lactation_curve || []) : [];

    // Interpolate nearest curve point
    let std = null;
    if (curve.length) {
      const useWeeks = curve[0].week != null;
      const ageNorm  = useWeeks ? ageDays / 7 : ageDays;
      const getAge   = (pt) => pt.week ?? pt.day ?? pt.age ?? 0;
      let best = curve[0];
      for (const pt of curve) {
        if (Math.abs(getAge(pt) - ageNorm) < Math.abs(getAge(best) - ageNorm)) best = pt;
      }
      std = best;
    }

    const warnPct  = file?.warn_threshold_pct  || 5;
    const alertPct = file?.alert_threshold_pct || 10;
    const deviations = [];

    function addDev(kpiKey, actual, standard, higherIsBetter = false) {
      if (actual == null || standard == null || standard === 0) return;
      const dev_pct = ((actual - standard) / standard) * 100;
      const bad = higherIsBetter ? -dev_pct : dev_pct;
      deviations.push({
        kpi: kpiKey, actual, standard, deviation_pct: Number(dev_pct.toFixed(2)),
        status: bad >= alertPct ? 'critical' : bad >= warnPct ? 'warning' : 'ok'
      });
    }

    const stdBwKg = std ? (std.body_wt_kg ?? (std.body_wt_g ? std.body_wt_g / 1000 : null)) : null;
    const stdBwG  = std ? (std.body_wt_g  ?? (stdBwKg ? stdBwKg * 1000 : null)) : null;
    addDev('body_wt_g',    kpis.body_wt_g,    stdBwG,                  true);
    addDev('fcr',          kpis.fcr,           std?.fcr,               false);
    addDev('mortality_pct',kpis.mortality_pct, std?.mortality_pct_max, false);
    addDev('egg_prod_pct', kpis.egg_prod_pct,  std?.egg_prod_pct,      true);
    addDev('egg_wt_g',     kpis.egg_wt_g,      std?.egg_wt_g,          true);
    addDev('adg_g',        kpis.adg_g,         std?.adg_g,             true);

    const hasCritical = deviations.some(d => d.status === 'critical');
    const hasWarning  = deviations.some(d => d.status === 'warning');
    const overall     = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : deviations.length ? 'OK' : 'NO_DATA';

    const findings = deviations
      .filter(d => d.status !== 'ok')
      .map(d => ({
        kpi: d.kpi,
        message: `${d.kpi} is ${Math.abs(d.deviation_pct).toFixed(1)}% ${d.deviation_pct > 0 ? 'above' : 'below'} breed standard`,
        severity: d.status
      }));

    ok(res, {
      breed, age, age_unit, age_days: ageDays,
      standard: std,
      deviations,
      findings,
      overall,
      breed_found: !!std,
      breed_meta: file?._meta || null
    });
  } catch(e) { err(res, e); }
});

export default router;



