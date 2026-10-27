import express from "express";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { loadIngredients } = require("../../../core/db/ingredients/_index/LOAD_INGREDIENTS.cjs");
const customIngredientDb = require("../../../core/services/custom-ingredient-db.service.cjs");

const router = express.Router();

// All known species — used for "load all" library view
const ALL_SPECIES = ["poultry", "swine", "dairy", "beef", "goat", "sheep", "equine"];

// Path to user-editable ingredient library (writable JSON, separate from NRC reference files)
const USER_LIBRARY_PATH = path.resolve(
  process.cwd(),
  "core", "db", "ingredients", "user-library", "us", "v1", "user.ingredients.v1.json"
);

function loadUserLibrary() {
  try {
    if (!fs.existsSync(USER_LIBRARY_PATH)) return {};
    const raw = fs.readFileSync(USER_LIBRARY_PATH, "utf8");
    const obj = JSON.parse(raw);
    return (obj && typeof obj.ingredients === "object") ? obj.ingredients : {};
  } catch (e) {
    console.error("[ingredients.route] user-library load error:", e);
    return {};
  }
}

function saveUserLibrary(ingredients) {
  const obj = {
    _meta: {
      description: "User-managed ingredient library — editable by nutritionists via the Library UI",
      region: "us", version: "v1",
      last_saved: new Date().toISOString()
    },
    ingredients
  };
  const dir = path.dirname(USER_LIBRARY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USER_LIBRARY_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function getIngredientIntelligencePath(species = "poultry", region = "us", version = "v1") {
  return path.join(
    process.cwd(),
    "core",
    "db",
    "ingredient-intelligence",
    `ingredients.intelligence.${species}.${region}.${version}.json`
  );
}

function loadIngredientIntelligenceMap(species = "poultry", region = "us", version = "v1") {
  try {
    const filePath = getIngredientIntelligencePath(species, region, version);

    if (!fs.existsSync(filePath)) {
      return {};
    }

    const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const items = Array.isArray(doc?.items) ? doc.items : [];

    const map = {};
    for (const item of items) {
      if (item && typeof item === "object" && item.ingredient_id) {
        map[String(item.ingredient_id)] = item;
      }
    }

    return map;
  } catch (err) {
    console.error("[ingredients.route] Ingredient Intelligence load error:", err);
    return {};
  }
}

// Canonical linoleic/linolenic fallback (INRAE 2022 / Rostagno 2017 values, as-fed %)
// Applied only when the ingredient's own profile has null/missing linoleic.
const LINOLEIC_CANON = [
  { match: /\b(corn|maize)\b(?!.*gluten)(?!.*germ)(?!.*bran)(?!.*ddgs)(?!.*distill)/i, linoleic: 1.91, linolenic: 0.07, ee: 3.73 },
  { match: /corn.*gluten.*feed|cgf\b/i,                          linoleic: 1.46, linolenic: 0.07, ee: 3.2  },
  { match: /corn.*gluten.*meal|cgm\b/i,                          linoleic: 1.21, linolenic: 0.05, ee: 1.98 },
  { match: /corn.*ddgs|ddg.*corn/i,                              linoleic: 2.78, linolenic: 0.22, ee: 7.5  },
  { match: /soybean.*meal.*48|sbm.*48|soy.*meal.*48/i,           linoleic: 0.77, linolenic: 0.07, ee: 1.72 },
  { match: /soybean.*meal.*46|sbm.*46|soy.*meal.*46/i,           linoleic: 0.66, linolenic: 0.07, ee: 1.89 },
  { match: /soybean.*meal.*44|sbm.*44|soy.*meal.*44/i,           linoleic: 0.68, linolenic: 0.07, ee: 1.93 },
  { match: /soybean.*meal|soya.*meal|sbm\b/i,                    linoleic: 0.66, linolenic: 0.07, ee: 1.89 },
  { match: /soybean.*full.?fat|soy.*full.?fat|soy.*extruded/i,   linoleic: 9.45, linolenic: 0.60, ee: 19.9 },
  { match: /soybean.*oil|soy.*oil/i,                             linoleic: 52.2, linolenic: 6.8,  ee: 99.5 },
  { match: /canola.*oil|rapeseed.*oil/i,                         linoleic: 18.7, linolenic: 8.9,  ee: 99.5 },
  { match: /canola|rapeseed/i,                                   linoleic: 0.80, linolenic: 0.30, ee: 3.5  },
  { match: /sunflower.*oil/i,                                    linoleic: 63.0, linolenic: 0.2,  ee: 99.5 },
  { match: /sunflower.*meal|sunflower.*cake/i,                   linoleic: 1.10, linolenic: 0.05, ee: 3.0  },
  { match: /palm.*kernel/i,                                      linoleic: 2.5,  linolenic: 0.2,  ee: 99.5 },
  { match: /palm.*oil/i,                                         linoleic: 10.0, linolenic: 0.4,  ee: 99.5 },
  { match: /wheat\b(?!.*bran)(?!.*middl)(?!.*germ)/i,           linoleic: 0.90, linolenic: 0.05, ee: 2.0  },
  { match: /wheat.*bran|wheat.*middl/i,                          linoleic: 1.20, linolenic: 0.10, ee: 3.5  },
  { match: /fish.*meal|fishmeal/i,                               linoleic: 0.20, linolenic: 0.30, ee: 10.0 },
  { match: /poultry.*by.?product|pbm\b/i,                        linoleic: 1.20, linolenic: 0.20, ee: 14.0 },
  { match: /meat.*bone.*meal|mbm\b/i,                            linoleic: 0.50, linolenic: 0.10, ee: 9.0  },
  { match: /peanut.*meal|groundnut.*meal/i,                      linoleic: 3.80, linolenic: 0.10, ee: 7.0  },
  { match: /cottonseed.*meal/i,                                  linoleic: 1.30, linolenic: 0.10, ee: 2.5  },
];

function canonLinoleic(name) {
  const blob = String(name || "").toLowerCase();
  for (const e of LINOLEIC_CANON) {
    if (e.match.test(blob)) return { linoleic: e.linoleic, linolenic: e.linolenic, ee_canon: e.ee };
  }
  return null;
}

function toFlatIngredientRows(db) {
  if (!db || typeof db !== "object") return [];

  return Object.entries(db).map(([ingredient_id, row]) => {
    const r = row && typeof row === "object" ? row : {};

    // Merge nested nutrients object to root level for equine ingredients
    const n = r.nutrients && typeof r.nutrients === "object" ? r.nutrients : {};
    const merged = { ...n, ...r };

    return {
  ingredient_id,
  ingredient_name: r.display_name || ingredient_id,
  ingredient_type: r.ingredient_type || null,
  functional_class: r.functional_class || null,
  category: r.category || null,
  region: r.region || null,
  source: r.source || null,

      active: r.active ?? null,
      data_quality_status: r.data_quality_status ?? null,
      data_quality_reason: r.data_quality_reason ?? null,
      last_modified: r.last_modified ?? null,
      modified_by: r.modified_by ?? null,

      dm: r.dm ?? null,
      moisture: r.moisture ?? (typeof r.dm === "number" ? Number((100 - r.dm).toFixed(4)) : null),

      // Normalize energy: standard field is `me`; some entries (e.g. corn_ddgs_6_9_ee) use
      // me_poultry_kcal_kg or me_hens_kcal_kg. Equine stores as de_mcal_kg.
      me: r.me ?? r.me_poultry_kcal_kg ?? r.me_hens_kcal_kg ?? null,
      de_mcal_kg: r.de_mcal_kg ?? n.de_mcal_kg ?? null,
      ge: r.ge ?? null,
      amen: r.amen ?? null,
      ne: r.ne ?? null,

      // Equine stores macros as *_pct; normalize to bare key so frontend library lookup works
      cp: r.cp ?? r.cp_pct ?? null,
      ee: r.ee ?? r.ee_pct ?? null,
      cf: r.cf ?? r.cf_pct ?? null,
      ash: r.ash ?? r.ash_pct ?? null,
      ndf: r.ndf ?? r.ndf_pct ?? null,
      adf: r.adf ?? r.adf_pct ?? null,
      starch: r.starch ?? r.starch_pct ?? null,
      sugars: r.sugars ?? null,

      ca: r.ca ?? r.ca_pct ?? null,
      total_p: r.total_p ?? r.p_total ?? r.p_pct ?? null,
      avp: r.avp ?? null,
      na: r.na ?? r.na_pct ?? null,
      k: r.k ?? r.k_pct ?? null,
      cl: r.cl ?? null,
      mg: r.mg ?? r.mg_pct ?? null,

      total_lys: r.total_lys ?? null,
      total_met: r.total_met ?? null,
      total_cys: r.total_cys ?? null,
      total_metcys: r.total_metcys ?? null,
      total_thr: r.total_thr ?? null,
      total_trp: r.total_trp ?? null,
      total_arg: r.total_arg ?? null,
      total_val: r.total_val ?? null,
      total_ile: r.total_ile ?? null,
      total_leu: r.total_leu ?? null,

      sid_lys: r.sid_lys ?? r.lys ?? null,
      sid_met: r.sid_met ?? r.met ?? null,
      sid_cys: r.sid_cys ?? null,
      sid_metcys: r.sid_metcys ?? r.met_cys ?? null,
      sid_thr: r.sid_thr ?? r.thr ?? null,
      sid_trp: r.sid_trp ?? r.trp ?? null,
      sid_arg: r.sid_arg ?? r.arg ?? null,
      sid_val: r.sid_val ?? r.val ?? null,
      sid_ile: r.sid_ile ?? r.ile ?? null,
      sid_leu: r.sid_leu ?? r.leu ?? null,
      sid_his: r.sid_his ?? null,
      sid_phe: r.sid_phe ?? null,
      sid_tyr: r.sid_tyr ?? null,
      total_his: r.total_his ?? null,
      total_phe: r.total_phe ?? null,
      total_tyr: r.total_tyr ?? null,
      linoleic: r.linoleic ?? canonLinoleic(r.display_name || r.ingredient_name || ingredient_id)?.linoleic ?? null,
      linolenic: r.linolenic ?? canonLinoleic(r.display_name || r.ingredient_name || ingredient_id)?.linolenic ?? null,

      adjust_policy: r.adjust_policy ?? null,
      species_compatibility: Array.isArray(r.species_compatibility) ? r.species_compatibility : null,

      // Equine nutrient keys from nested nutrients object
      de_mcal_kg: r.de_mcal_kg ?? n.de_mcal_kg ?? null,
      cp_pct: r.cp_pct ?? n.cp_pct ?? null,
      ca_pct: r.ca_pct ?? n.ca_pct ?? null,
      p_pct: r.p_pct ?? n.p_pct ?? null,
      ndf_pct: r.ndf_pct ?? n.ndf_pct ?? null,
      adf_pct: r.adf_pct ?? n.adf_pct ?? null,
      ee_pct: r.ee_pct ?? n.ee_pct ?? null,
      starch_pct: r.starch_pct ?? n.starch_pct ?? null,
      nsc_pct: r.nsc_pct ?? n.nsc_pct ?? null,

      source_layer: "base_library"
    };
  });
}

function mergeWithIngredientIntelligence(rows, iiMap) {
  if (!Array.isArray(rows) || !iiMap || typeof iiMap !== "object") {
    return Array.isArray(rows) ? rows : [];
  }

  return rows.map((row) => {
    const ii = iiMap[String(row.ingredient_id)];
    if (!ii || typeof ii !== "object") {
      return row;
    }

    const np = ii.nutrient_profile && typeof ii.nutrient_profile === "object" ? ii.nutrient_profile : {};
    const meta = ii.metadata && typeof ii.metadata === "object" ? ii.metadata : {};

    return {
      ...row,

      ingredient_name: ii.display_name ?? row.ingredient_name,

      active: meta.active ?? row.active,
      data_quality_status: meta.data_quality_status ?? row.data_quality_status,
      data_quality_reason: meta.data_quality_reason ?? row.data_quality_reason,
      last_modified: meta.last_modified ?? row.last_modified,
      modified_by: meta.modified_by ?? row.modified_by,

      dm: np.dm ?? row.dm,
      moisture: np.moisture ?? row.moisture,

      me: np.me ?? row.me,
      ge: np.ge ?? row.ge,
      amen: np.amen ?? row.amen,
      ne: np.ne ?? row.ne,

      cp: np.cp ?? row.cp,
      ee: np.ee ?? row.ee,
      cf: np.cf ?? row.cf,
      ash: np.ash ?? row.ash,
      ndf: np.ndf ?? row.ndf,
      adf: np.adf ?? row.adf,
      starch: np.starch ?? row.starch,
      sugars: np.sugars ?? row.sugars,

      ca: np.ca ?? row.ca,
      total_p: np.total_p ?? np.p_total ?? row.total_p,
      avp: np.avp ?? row.avp,
      na: np.na ?? row.na,
      k: np.k ?? row.k,
      cl: np.cl ?? row.cl,

      total_lys: np.total_lys ?? row.total_lys,
      total_met: np.total_met ?? row.total_met,
      total_cys: np.total_cys ?? row.total_cys,
      total_metcys: np.total_metcys ?? row.total_metcys,
      total_thr: np.total_thr ?? row.total_thr,
      total_trp: np.total_trp ?? row.total_trp,
      total_arg: np.total_arg ?? row.total_arg,
      total_val: np.total_val ?? row.total_val,
      total_ile: np.total_ile ?? row.total_ile,
      total_leu: np.total_leu ?? row.total_leu,

      sid_lys: np.sid_lys ?? row.sid_lys,
      sid_met: np.sid_met ?? row.sid_met,
      sid_cys: np.sid_cys ?? row.sid_cys,
      sid_metcys: np.sid_metcys ?? row.sid_metcys,
      sid_thr: np.sid_thr ?? row.sid_thr,
      sid_trp: np.sid_trp ?? row.sid_trp,
      sid_arg: np.sid_arg ?? row.sid_arg,
      sid_val: np.sid_val ?? row.sid_val,
      sid_ile: np.sid_ile ?? row.sid_ile,
      sid_leu: np.sid_leu ?? row.sid_leu,

      source_layer: "ingredient_intelligence"
    };
  });
}

function hasMeaningfulIngredientData(row) {
  if (!row || typeof row !== "object") return false;

  const name = String(row.ingredient_name || "").toUpperCase();
  if (name.includes("STUB")) return false;

  // Poultry keys
  const meaningfulKeys = [
    "dm", "moisture", "me", "ge", "amen", "ne",
    "cp", "ee", "cf", "ash", "ndf", "adf", "starch", "sugars",
    "ca", "total_p", "avp", "na", "k", "cl",
    "total_lys", "total_met", "total_cys", "total_metcys", "total_thr", "total_trp", "total_arg",
    "total_val", "total_ile", "total_leu",
    "sid_lys", "sid_met", "sid_cys", "sid_metcys", "sid_thr", "sid_trp", "sid_arg", "sid_val", "sid_ile", "sid_leu"
  ];

  // Equine keys
  const equineKeys = [
    "de_mcal_kg", "cp_pct", "ca_pct", "p_pct", "ndf_pct",
    "adf_pct", "ee_pct", "starch_pct", "nsc_pct"
  ];

  const allKeys = [...meaningfulKeys, ...equineKeys];

  // Also check nested nutrients object
  const nutrients = row.nutrients && typeof row.nutrients === "object" ? row.nutrients : {};

  return allKeys.some((key) =>
    (row[key] !== null && row[key] !== undefined) ||
    (nutrients[key] !== null && nutrients[key] !== undefined)
  );
}

function loadCustomDbRows(millId, dbId) {
  const db = customIngredientDb.getDb(millId, dbId);
  if (!db || !Array.isArray(db.ingredients)) return [];

  return db.ingredients.map((row) => ({
    ...row,
    custom_db_id: db.id,
    custom_db_name: db.name,
    source_layer: "custom_database"
  }));
}

router.get("/v1/ingredients", (req, res) => {
  try {
    const speciesParam = String(req.query.species || "poultry").trim().toLowerCase();
    const region = String(req.query.region || "us").trim().toLowerCase();
    const version = String(req.query.version || "v1").trim().toLowerCase();
    const basis = String(req.query.basis || "sid").trim().toLowerCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    // "species=all" → load every species file and merge for the Library view
    const loadAll = speciesParam === "all";
    const speciesToLoad = loadAll ? ALL_SPECIES : [speciesParam];

    // Track seen IDs to deduplicate (first species wins for shared ingredients like minerals)
    const seenIds = new Set();
    let rows = [];

    for (const sp of speciesToLoad) {
      let loaded;
      try {
        loaded = loadIngredients({ species: sp, region, version, basis });
      } catch (e) {
        continue;
      }
      if (!loaded || !loaded.ok || !loaded.db) continue;

      const spRows = toFlatIngredientRows(loaded.db).filter((row) => {
        if (!row || seenIds.has(row.ingredient_id)) return false;

        const compat = row.species_compatibility;
        if (!loadAll && Array.isArray(compat) && compat.length > 0) {
          if (!compat.includes(sp) && !compat.includes('all')) return false;
        }
        if (row.ingredient_type === "feed_additive") return true;
        return hasMeaningfulIngredientData(row);
      }).map(row => {
        seenIds.add(row.ingredient_id);
        // Tag each row with its species source when loading all
        return loadAll ? { ...row, species_source: sp } : row;
      });

      // Catalog only — never overlay Ingredient Intelligence onto library rows.
      rows = rows.concat(spRows);
    }

    // Overlay user-library edits (highest priority — nutritionist overrides)
    const userLib = loadUserLibrary();
    if (Object.keys(userLib).length > 0) {
      const userRows = toFlatIngredientRows(userLib).map(r => ({ ...r, source_layer: "user_library", species_source: r.species_source || "all" }));
      // For all-species view: add user ingredients that aren't already in rows
      for (const ur of userRows) {
        const idx = rows.findIndex(r => r.ingredient_id === ur.ingredient_id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...ur }; // user edit overrides base
        } else {
          rows.push(ur);
        }
      }
    }

    const species = loadAll ? "all" : speciesParam;

    if (q) {
      rows = rows.filter((x) =>
        String(x.ingredient_id || "").toLowerCase().includes(q) ||
        String(x.ingredient_name || "").toLowerCase().includes(q) ||
        String(x.category || "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => String(a.ingredient_name).localeCompare(String(b.ingredient_name)));

    return res.json({
      ok: true,
      items: rows,
      count: rows.length,
      context: { species, region, version, basis },
      ingredient_intelligence_applied: false
    });
  } catch (err) {
    console.error("[ingredients.route] error:", err);
    return res.status(500).json({
      ok: false,
      error: "INGREDIENTS_ROUTE_FAILED",
      message: err?.message || String(err)
    });
  }
});

// ── CREATE ingredient (nutritionist adds a new ingredient to library) ───────
router.post("/v1/ingredients", (req, res) => {
  try {
    const body = req.body || {};
    if (!body.ingredient_id || !body.ingredient_name) {
      return res.status(400).json({ ok: false, error: "ingredient_id and ingredient_name are required" });
    }
    const id = String(body.ingredient_id).trim().replace(/\s+/g, "_").toLowerCase();
    const lib = loadUserLibrary();
    if (lib[id]) {
      return res.status(409).json({ ok: false, error: "Ingredient ID already exists. Use PUT to update." });
    }
    const now = new Date().toISOString();
    lib[id] = {
      display_name: body.ingredient_name,
      category: body.category || "other",
      species_compatibility: body.species_compatibility || [],
      species_source: body.species_source || "all",
      source_layer: "user_library",
      created_at: now,
      last_modified: now,
      modified_by: body.modified_by || "nutritionist",
      ...sanitizeNutrients(body)
    };
    saveUserLibrary(lib);
    return res.json({ ok: true, ingredient_id: id, message: "Ingredient added to library" });
  } catch (err) {
    console.error("[ingredients.route] POST error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ── UPDATE ingredient ────────────────────────────────────────────────────────
router.put("/v1/ingredients/:id", (req, res) => {
  try {
    const id = String(req.params.id).trim();
    const body = req.body || {};
    const lib = loadUserLibrary();
    const existing = lib[id] || {};
    const now = new Date().toISOString();
    lib[id] = {
      ...existing,
      display_name: body.ingredient_name || existing.display_name,
      category: body.category || existing.category,
      species_compatibility: body.species_compatibility || existing.species_compatibility || [],
      species_source: body.species_source || existing.species_source || "all",
      source_layer: "user_library",
      last_modified: now,
      modified_by: body.modified_by || "nutritionist",
      ...sanitizeNutrients(body)
    };
    saveUserLibrary(lib);
    return res.json({ ok: true, ingredient_id: id, message: "Ingredient updated" });
  } catch (err) {
    console.error("[ingredients.route] PUT error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ── DELETE ingredient ────────────────────────────────────────────────────────
router.delete("/v1/ingredients/:id", (req, res) => {
  try {
    const id = String(req.params.id).trim();
    const lib = loadUserLibrary();
    if (!lib[id]) {
      return res.status(404).json({ ok: false, error: "Ingredient not found in user library. Base library ingredients cannot be deleted, only overridden." });
    }
    delete lib[id];
    saveUserLibrary(lib);
    return res.json({ ok: true, ingredient_id: id, message: "Ingredient removed from user library" });
  } catch (err) {
    console.error("[ingredients.route] DELETE error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Numeric nutrient fields allowed to be saved
const NUTRIENT_FIELDS = [
  "dm","moisture","me","ge","amen","ne","cp","ee","cf","ash","ndf","adf","starch","sugars",
  "ca","total_p","avp","na","k","cl","mg","s","total_lys","total_met","total_cys","total_metcys",
  "total_thr","total_trp","total_arg","total_val","total_ile","total_leu",
  "sid_lys","sid_met","sid_cys","sid_metcys","sid_thr","sid_trp","sid_arg","sid_val","sid_ile","sid_leu",
  "de","ne_m","ne_g","tdn","nel","nem","neg","me_ruminant","rdp_pct","rup_pct",
  "de_mcal_kg","cp_pct","ee_pct","ndf_pct","adf_pct","starch_pct","nsc_pct","ca_pct","p_pct",
  "price","adjust_policy","nutrient_basis"
];

function sanitizeNutrients(body) {
  const out = {};
  for (const f of NUTRIENT_FIELDS) {
    if (f in body) {
      const v = body[f];
      out[f] = (v === null || v === "" || v === undefined) ? null : (typeof v === "number" ? v : parseFloat(v) || null);
    }
  }
  // String fields
  if (body.nutrient_basis) out.nutrient_basis = String(body.nutrient_basis);
  if (body.price_basis) out.price_basis = String(body.price_basis);
  if (body.currency) out.currency = String(body.currency);
  if (body.source_ref) out.source_ref = String(body.source_ref);
  return out;
}

export default router;