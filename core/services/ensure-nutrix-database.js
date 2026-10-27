/**
 * Give every signed-in user one "Nutrix database" prefilled with the
 * Brazilian NutrixDB catalog plus the rest of the master library.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { getUserMillDb } from "../db/turso/turso.adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);
const customDb = require("./custom-ingredient-db.service.cjs");
const { loadIngredients } = require("../db/ingredients/_index/LOAD_INGREDIENTS.cjs");
const { normalizeEmail } = require("../lib/normalize-email.cjs");

export const NUTRIX_DB_NAME = "Nutrix database";

const ALL_SPECIES = ["poultry", "swine", "dairy", "beef", "goat", "sheep", "equine"];

const II_SCHEMA = `CREATE TABLE IF NOT EXISTS ingredient_intelligence_library (
  id          TEXT PRIMARY KEY,
  mill_id     TEXT NOT NULL,
  species     TEXT NOT NULL DEFAULT 'poultry',
  username    TEXT NOT NULL DEFAULT 'default',
  db_id       TEXT NOT NULL DEFAULT 'base',
  rows_json   TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
)`;

const COPY_KEYS = [
  "dm", "moisture", "me", "me_mj", "amen", "ne", "ge",
  "cp", "ee", "cf", "ash", "starch", "sugars", "ndf", "adf", "lignin",
  "nsp_total", "nsp_soluble", "nsp_insoluble",
  "total_lys", "total_met", "total_cys", "total_metcys", "total_thr", "total_trp",
  "total_arg", "total_val", "total_ile", "total_leu", "total_his", "total_phe", "total_tyr",
  "ca", "total_p", "avp", "na", "k", "cl", "mg", "s",
  "sid_lys", "sid_met", "sid_cys", "sid_metcys", "sid_thr", "sid_trp",
  "sid_arg", "sid_val", "sid_ile", "sid_leu", "sid_his", "sid_phe", "sid_tyr",
  "total_his", "total_phe", "total_tyr",
  "linoleic", "linolenic",
  "fe", "zn", "mn", "cu", "i", "se",
  "vit_a", "vit_d3", "vit_e", "vit_k", "vit_b1", "vit_b2", "vit_b6", "vit_b12",
  "niacin", "pantothenic_acid", "folic_acid", "biotin", "choline",
  "deb", "beta_glucans", "arabinoxylans"
];

const locks = new Map();
const doneCache = new Set(); // remembers owner::mill::species combos already seeded this process
let libraryCache = null;

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
  locks.set(key, next);
  return next;
}

function unwrapDb(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.db && typeof obj.db === "object") return obj.db;
  if (obj.ingredients && typeof obj.ingredients === "object") return obj.ingredients;
  return obj;
}

function flattenIngredient(id, raw, source) {
  const r = raw && typeof raw === "object" ? raw : {};
  const n = r.nutrients && typeof r.nutrients === "object" ? r.nutrients : {};
  const merged = { ...n, ...r };
  const row = {
    ingredient_id: String(id),
    ingredient_name: customDb.cleanIngredientDisplayName(
      String(merged.display_name || merged.ingredient_name || id)
    ) || String(merged.display_name || merged.ingredient_name || id),
    category: merged.category || "",
    source_layer: source || "library"
  };
  for (const key of COPY_KEYS) {
    const v = merged[key];
    row[key] = v == null || v === "" ? null : v;
  }
  if (row.moisture == null && typeof row.dm === "number") {
    row.moisture = Number((100 - row.dm).toFixed(4));
  }
  return row;
}

function ingredientCategoryRankSimple(s, cat) {
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
  if (cat === 'oil_fat' || /soybean oil|soy oil/.test(s)) return 60;
  if (/palm oil/.test(s) && !/kernel/.test(s)) return 61;
  if (/tallow/.test(s)) return 62;
  if (/poultry fat|chicken fat/.test(s)) return 63;
  if (/animal fat|grease/.test(s)) return 64;
  if (/fish oil/.test(s)) return 65;
  if (/\boil\b/.test(s)) return 66;
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
  if (/zinc/.test(s)) return 100;
  if (/copper|cupric/.test(s)) return 101;
  if (/manganese/.test(s)) return 102;
  if (/\biron\b|ferrous|ferric/.test(s)) return 103;
  if (/selenium/.test(s)) return 104;
  if (/iodine/.test(s)) return 105;
  if (/cobalt/.test(s)) return 106;
  if (/chromium/.test(s)) return 107;
  if (/trace mineral|micro mineral|mineral mix/.test(s)) return 108;
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

function loadAllLibraryRows() {
  if (libraryCache) return libraryCache;
  const seen = new Set();
  const rows = [];
  const seenName = new Set();
  const add = (db, source) => {
    const inner = unwrapDb(db);
    if (!inner) return;
    for (const [id, raw] of Object.entries(inner)) {
      if (!id || !raw || typeof raw !== "object") continue;
      const idKey = String(id).trim().toLowerCase();
      if (!idKey || seen.has(idKey)) continue;
      const name = customDb.cleanIngredientDisplayName(
        String(raw.display_name || raw.ingredient_name || id)
      ) || String(raw.display_name || raw.ingredient_name || id);
      if (name.toUpperCase().includes("STUB")) continue;
      const nameKey = customDb.canonicalIngredientKey(name) || name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (nameKey && seenName.has(nameKey)) continue;
      seen.add(idKey);
      if (nameKey) seenName.add(nameKey);
      rows.push(flattenIngredient(id, raw, source));
    }
  };

  const nutrixPath = path.resolve(
    __dirname,
    "../db/ingredients/nutrixdb/v1/nutrixdb.ingredients.v1.json"
  );
  try {
    if (fs.existsSync(nutrixPath)) {
      const raw = fs.readFileSync(nutrixPath, "utf8").replace(/^\uFEFF/, "");
      add(JSON.parse(raw), "nutrixdb");
    }
  } catch (e) {
    console.error("[nutrix-db] Brazilian NutrixDB load failed:", e?.message || e);
  }

  for (const sp of ALL_SPECIES) {
    try {
      const loaded = loadIngredients({ species: sp, region: "us", version: "v1", basis: "sid" });
      if (loaded?.ok && loaded.db) add(loaded.db, sp);
    } catch (_) { /* skip missing species books */ }
  }

  const collapsed = customDb.collapseSpeciesCopies(rows);
  collapsed.sort((a, b) => {
    const ra = ingredientCategoryRankSimple(String(a.ingredient_name || '').toLowerCase(), String(a.category || '').toLowerCase());
    const rb = ingredientCategoryRankSimple(String(b.ingredient_name || '').toLowerCase(), String(b.category || '').toLowerCase());
    if (ra !== rb) return ra - rb;
    return String(a.ingredient_name || '').localeCompare(String(b.ingredient_name || ''), undefined, { sensitivity: 'base' });
  });
  libraryCache = collapsed;
  return libraryCache;
}

function toIntelRow(item) {
  const id = String(item.ingredient_id || "").trim();
  const row = {
    profile_id: id ? `ii_${id}` : `ii_lib_${Date.now()}`,
    base_ingredient_id: id || null,
    ingredient_code: "",
    ingredient_name: customDb.cleanIngredientDisplayName(String(item.ingredient_name || id)),
    category: item.category || null,
    source: "library_seed",
    status: "active",
    currency: "USD",
    price_basis: "per_kg",
    price: null,
    notes: "Nutrix library",
    active: true
  };
  for (const key of COPY_KEYS) {
    if (item[key] != null) row[key] = item[key];
  }
  return row;
}

function rowKey(row) {
  const id = String(row?.base_ingredient_id || row?.ingredient_id || "").trim().toLowerCase();
  if (id) return "id:" + id;
  const name = String(row?.ingredient_name || "").trim().toLowerCase();
  return name ? "nm:" + name : "";
}

function mergeIntel(existing, incoming) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(out.map(rowKey).filter(Boolean));
  for (const row of incoming || []) {
    const k = rowKey(row);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(row);
  }
  return out;
}

function isNutrixName(name) {
  return String(name || "").trim().toLowerCase() === "nutrix database";
}

export async function ensureNutrixDatabaseForUser(reqLike, opts = {}) {
  const owner = normalizeEmail(reqLike?.nutrixUser || reqLike?.headers?.["x-nutrix-user"] || "");
  if (!owner) return null;
  const species = String(opts.species || "poultry").toLowerCase();
  const millId = String(opts.millId || "personal").trim() || "personal";
  const lite = millId === "lite" || millId.startsWith("lite_");
  const targetDbId = opts.targetDbId ? String(opts.targetDbId).trim() : null;
  const lockKey = `${owner}::${millId}::${species}::${targetDbId || "nutrix"}`;

  // Skip if already successfully seeded this process lifetime (prevents expensive re-seeding on every page load)
  if (!targetDbId && doneCache.has(lockKey)) return { skipped: true, cached: true };

  return withLock(lockKey, async () => {
    const items = customDb.listDbs(millId, species, owner);
    let db = null;

    if (targetDbId) {
      // Seed a specific user database by ID
      db = customDb.getDb(millId, targetDbId, owner);
      if (!db) return null;
    } else {
      const meta = (items || []).find((d) => isNutrixName(d.name));
      if (meta) {
        db = customDb.getDb(millId, meta.id, owner);
      } else {
        db = customDb.createDb(millId, species, NUTRIX_DB_NAME, owner);
      }
    }
    if (!db?.id) return null;

    const now = new Date().toISOString();
    const catalog = loadAllLibraryRows().map((item) => {
      const row = {
        ingredient_id: String(item.ingredient_id),
        ingredient_name: String(item.ingredient_name || item.ingredient_id),
        ingredient_code: "",
        category: item.category || "custom",
        status: "active",
        currency: "USD",
        price_basis: "per_kg",
        price: null,
        last_modified: now,
        modified_by: "Nutrix"
      };
      for (const key of COPY_KEYS) {
        row[key] = item[key] ?? null;
      }
      return row;
    });
    db = customDb.mergeUniqueIngredients(millId, db.id, owner, catalog) || db;
    if (lite) {
      return { db, seeded: Array.isArray(db.ingredients) ? db.ingredients.length : 0, skipped: false };
    }

    const millDb = getUserMillDb({ nutrixUser: owner, headers: reqLike?.headers, tursoClient: reqLike?.tursoClient });
    await millDb.exec(II_SCHEMA);
    await millDb.addColumnIfMissing("ingredient_intelligence_library", "db_id", "TEXT NOT NULL DEFAULT 'base'");
    try {
      await millDb.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ii_library_key ON ingredient_intelligence_library(mill_id, species, username, db_id)",
        []
      );
    } catch (_) { /* index exists */ }

    const username = owner;
    const dbId = db.id;
    let picked = await millDb.get(
      "SELECT mill_id, username, rows_json FROM ingredient_intelligence_library WHERE species=? AND db_id=? AND LOWER(username)=? ORDER BY length(rows_json) DESC LIMIT 1",
      [species, dbId, username]
    );
    if (!picked) {
      picked = await millDb.get(
        "SELECT mill_id, username, rows_json FROM ingredient_intelligence_library WHERE mill_id=? AND species=? AND username=? AND db_id=?",
        [millId, species, username, dbId]
      );
    }
    let existing = [];
    try { existing = JSON.parse(picked?.rows_json || "[]"); } catch { existing = []; }
    if (!Array.isArray(existing)) existing = [];

    const library = loadAllLibraryRows();
    const incoming = library.map(toIntelRow);
    if (existing.length >= incoming.length && incoming.length > 0) {
      doneCache.add(lockKey);
      return { db, seeded: existing.length, skipped: true };
    }
    const merged = mergeIntel(existing, incoming);
    const millSave = picked?.mill_id || millId;
    const userSave = picked?.username || username;
    const id = `${millSave}__${species}__${userSave}__${dbId}`;
    const updated_at = new Date().toISOString();
    await millDb.run(
      `INSERT INTO ingredient_intelligence_library (id, mill_id, species, username, db_id, rows_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mill_id, species, username, db_id) DO UPDATE SET
         rows_json  = excluded.rows_json,
         updated_at = excluded.updated_at`,
      [id, millSave, species, userSave, dbId, JSON.stringify(merged), updated_at]
    );
    doneCache.add(lockKey);
    return { db, seeded: merged.length, skipped: false };
  });
}
