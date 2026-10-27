import express from 'express';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserMillDb } from '../../../core/db/turso/turso.adapter.js';
import { learn } from '../lib/learn-hook.js';
import { ensureNutrixDatabaseForUser } from '../../../core/services/ensure-nutrix-database.js';
const requireCjs = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { normalizeEmail, emailAliases: sharedEmailAliases } = requireCjs('../../../core/lib/normalize-email.cjs');
const { applyUsdKgPrices } = requireCjs('../../../core/db/ingredients/price-book.usd-kg.cjs');

const router = express.Router();

// Category-rank sort: grains → protein meals → agri by-products → fats → amino acids → minerals → vitamins → feed additives
function ingredientCategoryRank(row) {
  const s = String(row?.ingredient_name || '').toLowerCase();
  const cat = String(row?.category || '').toLowerCase();
  // 1 Grains
  if (cat === 'cereal_grain' || /yellow corn|maize grain|corn grain/.test(s)) return 10;
  if (/\bcorn\b|\bmaize\b/.test(s) && !/gluten|distiller|ddg|oil|bran|germ|silage|hominy/.test(s)) return 11;
  if (/\bwheat\b/.test(s) && !/bran|gluten|middling|mill run|shorts|germ|straw|silage/.test(s)) return 12;
  if (/\bbarley\b/.test(s) && !/straw|malt/.test(s)) return 13;
  if (/sorghum|milo/.test(s)) return 14;
  if (/ oat|\boats\b/.test(s) && !/hull|straw|hay/.test(s)) return 15;
  if (/\brye\b/.test(s)) return 16;
  if (/triticale/.test(s)) return 17;
  if (/broken rice|rice.grain/.test(s)) return 18;
  if (/cassava|tapioca|manioc/.test(s)) return 19;
  // 2 Protein meals
  if (cat === 'oilseed_meal' || /soybean meal|soya meal|soyabean meal|\bsbm\b/.test(s)) return 20;
  if (/full.fat soy|soybean.*full|extruded soy|roasted soy/.test(s)) return 21;
  if (/canola meal|rapeseed meal/.test(s)) return 22;
  if (/sunflower meal/.test(s)) return 23;
  if (/cottonseed/.test(s)) return 24;
  if (/peanut meal|groundnut meal/.test(s)) return 25;
  if (/palm kernel meal|palm kernel expeller|\bpke\b/.test(s)) return 26;
  if (cat === 'animal_protein' || /fish meal|fish, meal/.test(s)) return 27;
  if (/blood meal/.test(s)) return 28;
  if (/feather meal|hydrolyzed feather/.test(s)) return 29;
  if (/meat.and.bone|\bmbm\b/.test(s)) return 30;
  if (/poultry by|poultry meal|\bpbm\b/.test(s)) return 31;
  if (cat === 'single_cell_protein' || /algae|spirulina|chlorella/.test(s)) return 32;
  if (cat === 'microbial_protein' || /plasma protein|blood plasma/.test(s)) return 33;
  // 3 Agri by-products
  if (/ddgs|distiller/.test(s)) return 40;
  if (/corn gluten|maize gluten/.test(s)) return 41;
  if (/corn germ|corn bran|hominy/.test(s)) return 42;
  if (cat === 'plant_byproduct' || /wheat bran/.test(s)) return 43;
  if (/wheat middling|wheat shorts|wheat mill|wheat pollard/.test(s)) return 44;
  if (/rice bran|rice polish/.test(s)) return 45;
  if (/rice hull|rice husk/.test(s)) return 46;
  if (/soybean hull|soy hull/.test(s)) return 47;
  if (cat === 'by_product_fiber' || /beet pulp/.test(s)) return 48;
  if (/citrus pulp/.test(s)) return 49;
  if (/brewer/.test(s)) return 50;
  if (cat === 'bakery_byproduct' || /bakery|bread by/.test(s)) return 51;
  if (cat === 'starch_source' || /molasses/.test(s)) return 52;
  if (cat === 'forage' || cat === 'forage_legume' || /alfalfa/.test(s)) return 53;
  if (/silage|haylage|straw|hay\b/.test(s)) return 54;
  // 4 Fats & oils
  if (cat === 'oil_fat' || /soybean oil|soy oil/.test(s)) return 60;
  if (/palm oil/.test(s) && !/kernel/.test(s)) return 61;
  if (/tallow/.test(s)) return 62;
  if (/poultry fat|chicken fat/.test(s)) return 63;
  if (/animal fat|grease/.test(s)) return 64;
  if (/fish oil/.test(s)) return 65;
  if (/\boil\b/.test(s)) return 66;
  // 5 Crystalline amino acids
  if (/l-lysine|lysine hcl|lysine sulph|lysine sulf/.test(s)) return 70;
  if (/lysine/.test(s)) return 71;
  if (/methionine|dlm|\bmha\b/.test(s)) return 72;
  if (/threonine/.test(s)) return 73;
  if (/tryptophan/.test(s)) return 74;
  if (/valine/.test(s)) return 75;
  if (/isoleucine/.test(s)) return 76;
  if (/leucine/.test(s)) return 77;
  if (/arginine/.test(s)) return 78;
  if (/histidine/.test(s)) return 79;
  if (/phenylalanine/.test(s)) return 80;
  if (/cysteine|cystine/.test(s)) return 81;
  if (/glycine/.test(s)) return 82;
  if (/glutamic acid|glutamine/.test(s)) return 83;
  // 6 Macro minerals
  if (/limestone|calcium carbonate|caco3|oyster shell/.test(s)) return 90;
  if (/dicalcium|\bdcp\b|di.calcium phosphate/.test(s)) return 91;
  if (/monocalcium|\bmcp\b|mono.calcium phosphate/.test(s)) return 92;
  if (/calcium phosphate/.test(s)) return 93;
  if (/\bsalt\b|sodium chloride|\bnacl\b/.test(s)) return 94;
  if (/sodium bicarbonate|nahco3/.test(s)) return 95;
  if (/potassium chloride|\bkcl\b/.test(s)) return 96;
  if (/magnesium oxide|\bmgo\b/.test(s)) return 97;
  if (/magnesium sulfate|mgso4|kieserite/.test(s)) return 98;
  if (/\burea\b/.test(s)) return 99;
  // 7 Micro minerals
  if (/zinc/.test(s)) return 100;
  if (/copper|cupric/.test(s)) return 101;
  if (/manganese/.test(s)) return 102;
  if (/\biron\b|ferrous|ferric/.test(s)) return 103;
  if (/selenium/.test(s)) return 104;
  if (/iodine/.test(s)) return 105;
  if (/cobalt/.test(s)) return 106;
  if (/chromium/.test(s)) return 107;
  if (/trace mineral|micro mineral|mineral mix/.test(s)) return 108;
  // 8 Vitamins
  if (/vitamin a|retinol/.test(s)) return 110;
  if (/vitamin d/.test(s)) return 111;
  if (/vitamin e|tocopherol/.test(s)) return 112;
  if (/vitamin k/.test(s)) return 113;
  if (/vitamin b12|cyanocobalamin/.test(s)) return 114;
  if (/folic acid|folate/.test(s)) return 115;
  if (/biotin/.test(s)) return 116;
  if (/pantothenic/.test(s)) return 117;
  if (/niacin|nicotinic/.test(s)) return 118;
  if (/riboflavin/.test(s)) return 119;
  if (/thiamine|thiamin/.test(s)) return 120;
  if (/pyridoxine/.test(s)) return 121;
  if (/choline/.test(s)) return 122;
  if (/vitamin/.test(s)) return 123;
  if (/premix/.test(s)) return 125;
  // 9 Feed additives & enzymes
  if (/phytase/.test(s)) return 140;
  if (/xylanase/.test(s)) return 141;
  if (/protease/.test(s)) return 142;
  if (/amylase/.test(s)) return 143;
  if (/enzyme/.test(s)) return 144;
  if (cat === 'additive' || /probiotic|bacillus|lactobacillus/.test(s)) return 145;
  if (/prebiotic|mannan|fructo.oligo/.test(s)) return 146;
  if (/mycotoxin|toxin binder|bentonite/.test(s)) return 147;
  if (/coccidiostat|salinomycin|monensin|lasalocid/.test(s)) return 148;
  if (/antioxidant|ethoxyquin/.test(s)) return 149;
  if (/organic acid|formic|butyrate|lactic acid|citric acid/.test(s)) return 150;
  if (cat === 'feed_additive' || /yeast/.test(s)) return 151;
  return 200;
}

function sortByCategory(rows) {
  return (rows || []).slice().sort((a, b) => {
    const ra = ingredientCategoryRank(a);
    const rb = ingredientCategoryRank(b);
    if (ra !== rb) return ra - rb;
    return String(a.ingredient_name || '').localeCompare(String(b.ingredient_name || ''), undefined, { sensitivity: 'base' });
  });
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS ingredient_intelligence_library (
  id          TEXT PRIMARY KEY,
  mill_id     TEXT NOT NULL,
  species     TEXT NOT NULL DEFAULT 'poultry',
  username    TEXT NOT NULL DEFAULT 'default',
  db_id       TEXT NOT NULL DEFAULT 'base',
  rows_json   TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
)`;

async function ensureSchema(db) {
  await db.exec(SCHEMA);
  await db.addColumnIfMissing('ingredient_intelligence_library', 'db_id', "TEXT NOT NULL DEFAULT 'base'");
  // Recreate unique index with db_id if the old one (without db_id) exists
  try {
    await db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_ii_library_key ON ingredient_intelligence_library(mill_id, species, username, db_id)",
      []
    );
  } catch (_) {}
}

function millOf(req)    { return String(req.query.mill_id  || req.body?.mill_id  || 'default'); }
function speciesOf(req) { return String(req.query.species  || req.body?.species  || 'poultry').toLowerCase(); }
function dbIdOf(req)    { return String(req.query.db_id    || req.body?.db_id    || 'base'); }

function canonicalUsername(u) {
  return normalizeEmail(u);
}

const ok  = (res, data) => res.json({ ok: true, ...data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

function deduplicateRows(rows) {
  const seenProfileIds = new Set();
  const seenCodes      = new Set();
  const result = [];
  for (const row of rows || []) {
    const next = { ...row };
    const profId = String(next.profile_id || '').trim();
    const code   = String(next.ingredient_code || '').trim().toUpperCase();
    if (profId && seenProfileIds.has(profId)) continue;
    if (profId) seenProfileIds.add(profId);
    if (code && seenCodes.has(code)) next.ingredient_code = '';
    else if (code) seenCodes.add(code);
    result.push(next);
  }
  return result;
}

function rowMatchKeys(row) {
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  return [
    'id:' + norm(row?.profile_id),
    'id:' + norm(row?.ingredient_code),
    'id:' + norm(row?.base_ingredient_id),
    'nm:' + norm(row?.ingredient_name),
  ].filter(k => k.length > 3);
}

/** Never let a client PUT wipe prices that already exist for the same ingredient. */
function mergePreservedPrices(incoming, previous) {
  if (!Array.isArray(previous) || previous.length === 0) return incoming || [];
  const prevByKey = new Map();
  for (const row of previous) {
    for (const k of rowMatchKeys(row)) if (!prevByKey.has(k)) prevByKey.set(k, row);
  }
  return (incoming || []).map((row) => {
    let prev = null;
    for (const k of rowMatchKeys(row)) {
      if (prevByKey.has(k)) { prev = prevByKey.get(k); break; }
    }
    if (!prev) return row;
    const newPrice = Number(row.price);
    const oldPrice = Number(prev.price);
    const incomingHasPrice = Number.isFinite(newPrice) && newPrice > 0;
    const previousHasPrice = Number.isFinite(oldPrice) && oldPrice > 0;
    if (!incomingHasPrice && previousHasPrice) {
      return {
        ...row,
        price: prev.price,
        price_basis: prev.price_basis || row.price_basis,
        currency: prev.currency || row.currency,
        price_manual: true
      };
    }
    return row;
  });
}

function countPricedRows(rows) {
  return (rows || []).filter((r) => Number.isFinite(Number(r.price)) && Number(r.price) > 0).length;
}

function parseIntelRows(row) {
  if (!row) return [];
  try { return deduplicateRows(JSON.parse(row.rows_json || '[]')); } catch { return []; }
}

function ensureRealPrices(rows) {
  return applyUsdKgPrices(deduplicateRows(rows || []), { replaceInsane: true });
}

function intelScore(row) {
  const rows = parseIntelRows(row);
  return rows.length * 1000 + countPricedRows(rows);
}

function usernamesOf(req) {
  const raw = [
    req.nutrixUser,
    req.headers?.['x-nutrix-user'],
    'default'
  ].map((v) => String(v || '').trim()).filter(Boolean);
  const out = [];
  for (const u of raw) {
    if (!out.includes(u)) out.push(u);
    const low = u.toLowerCase();
    if (!out.includes(low)) out.push(low);
  }
  return out;
}

function emailAliases(u) {
  return sharedEmailAliases(u);
}

function millAliases(mill) {
  const m = String(mill || 'default').trim() || 'default';
  return [...new Set([m, 'default', 'personal'])];
}

function intelRowCount(row) {
  return parseIntelRows(row).length;
}

async function pickExactIntelRow(db, mill, spec, username, dbId) {
  if (!username) return null;
  const users = emailAliases(username);
  if (!users.length) return null;
  const wantedMill = String(mill || '').trim();
  const ph = users.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT rows_json, updated_at, mill_id, username FROM ingredient_intelligence_library
     WHERE species=? AND db_id=? AND LOWER(username) IN (${ph})`,
    [spec, dbId, ...users.map((u) => String(u).toLowerCase())]
  );
  let best = null;
  let bestN = -1;
  for (const row of rows || []) {
    const n = intelRowCount(row);
    const millMatch = wantedMill && String(row?.mill_id || '') === wantedMill;
    if (n > bestN || (n === bestN && millMatch)) {
      bestN = n;
      best = row;
    }
  }
  if (!best && rows?.length) {
    best = rows.find((r) => wantedMill && String(r.mill_id || '') === wantedMill) || rows[0];
  }
  if (best) return best;
  for (const millId of millAliases(mill)) {
    for (const u of users) {
      const row = await db.get(
        'SELECT rows_json, updated_at, mill_id, username FROM ingredient_intelligence_library WHERE mill_id=? AND species=? AND username=? AND db_id=?',
        [millId, spec, u, dbId]
      );
      if (row) return row;
    }
  }
  return null;
}

// GET /v1/ingredient-intelligence/counts
router.get('/counts', async (req, res) => {
  try {
    const db       = getUserMillDb(req);
    await ensureSchema(db);
    const username = String(req.nutrixUser || '').trim();
    if (!username || username.toLowerCase() === 'default') return ok(res, { counts: {} });
    const users = emailAliases(username);
    const counts = {};
    if (users.length) {
      const ph = users.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT db_id, json_array_length(rows_json) AS cnt FROM ingredient_intelligence_library
         WHERE species=? AND LOWER(username) IN (${ph})`,
        [speciesOf(req), ...users.map((u) => String(u).toLowerCase())]
      );
      for (const r of rows || []) {
        const n = Number(r.cnt) || 0;
        if (n > (counts[r.db_id] || 0)) counts[r.db_id] = n;
      }
    }
    ok(res, { counts });
  } catch (e) { err(res, e); }
});

// GET /v1/ingredient-intelligence
router.get('/', async (req, res) => {
  try {
    const db       = getUserMillDb(req);
    await ensureSchema(db);
    const mill     = millOf(req);
    const spec     = speciesOf(req);
    const dbId     = dbIdOf(req);
    const username = String(req.nutrixUser || '').trim();
    if (!username || username.toLowerCase() === 'default') {
      return ok(res, { rows: [], updated_at: null, mill_id: mill });
    }
    let row = await pickExactIntelRow(db, mill, spec, username, dbId);
    const parsed   = parseIntelRows(row);
    const priced   = ensureRealPrices(parsed);
    let rows       = priced.rows;
    let updatedAt  = row?.updated_at || null;
    if (row && priced.changed > 0) {
      updatedAt = new Date().toISOString();
      const saveUser = row.username || canonicalUsername(username);
      const millId   = row.mill_id || mill;
      const id       = `${millId}__${spec}__${saveUser}__${dbId}`;
      await db.run(`
        INSERT INTO ingredient_intelligence_library (id, mill_id, species, username, db_id, rows_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mill_id, species, username, db_id) DO UPDATE SET
          rows_json  = excluded.rows_json,
          updated_at = excluded.updated_at
      `, [id, millId, spec, saveUser, dbId, JSON.stringify(rows), updatedAt]);
    }
    ok(res, { rows: sortByCategory(rows), updated_at: updatedAt, mill_id: row?.mill_id || mill, prices_filled: priced.changed });
  } catch (e) { err(res, e); }
});

// PUT /v1/ingredient-intelligence
router.put('/', async (req, res) => {
  try {
    const { rows: rawRows } = req.body || {};
    if (!Array.isArray(rawRows)) return err(res, new Error('rows array required'), 400);
    const db         = getUserMillDb(req);
    await ensureSchema(db);
    const username   = String(req.nutrixUser || '').trim();
    if (!username || username.toLowerCase() === 'default') {
      return err(res, new Error('Sign in to save this database.'), 401);
    }
    const species    = speciesOf(req);
    const db_id      = dbIdOf(req);
    const requestedMill = millOf(req);
    const picked     = await pickExactIntelRow(db, requestedMill, species, username, db_id);
    const mill_id    = picked?.mill_id || requestedMill;
    const saveUser   = picked?.username || canonicalUsername(username);
    let previousRows = [];
    try { previousRows = picked ? JSON.parse(picked.rows_json || '[]') : []; } catch (_) { previousRows = []; }
    const merged     = mergePreservedPrices(deduplicateRows(rawRows), previousRows);
    const rows       = ensureRealPrices(merged).rows;
    const id         = `${mill_id}__${species}__${saveUser}__${db_id}`;
    const updated_at = new Date().toISOString();
    await db.run(`
      INSERT INTO ingredient_intelligence_library (id, mill_id, species, username, db_id, rows_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mill_id, species, username, db_id) DO UPDATE SET
        rows_json  = excluded.rows_json,
        updated_at = excluded.updated_at
    `, [id, mill_id, species, saveUser, db_id, JSON.stringify(rows), updated_at]);
    ok(res, { saved: rows.length, updated_at });
    // Sync to FACT DB JSON file so the optimizer always reads up-to-date nutrient values
    if (db_id && db_id.startsWith('cidb_')) {
      try {
        const safeUser = saveUser.replace(/@/g, '_').replace(/\./g, '_');
        const factDbDir = path.join(__dirname, '..', '..', '..', 'data', 'custom_ingredient_dbs', 'lite_' + safeUser);
        fs.mkdirSync(factDbDir, { recursive: true });
        const factDbPath = path.join(factDbDir, db_id + '.json');
        const factDbPayload = { ingredients: rows, _synced_at: updated_at };
        fs.writeFileSync(factDbPath, JSON.stringify(factDbPayload, null, 2), 'utf8');
      } catch (syncErr) {
        console.error('[II_PUT] FACT DB sync failed:', syncErr.message);
      }
    }
    learn({
      source: 'nutrix', kind: 'ii_save', user_id: username, mill_id,
      species,
      title: `Ingredient Intelligence ${species} (${rows.length} rows)`,
      text: rows.slice(0, 40).map(r => `${r.code || ''} ${r.name || r.ingredient_name || ''} ${r.price ?? ''}`).join('\n').slice(0, 4000),
      metadata: { db_id, count: rows.length }
    });
  } catch (e) { err(res, e); }
});

export default router;
