const fs = require("fs");
const path = require("path");
const { normalizeEmail, emailAliases } = require("../lib/normalize-email.cjs");

// Baseline nutrient keys shown on every custom ingredient row, mirroring
// the `NutrientFields` type in nutripilot-web/src/app/formulation-workspace/formulation-workspace.ts.
// Species-specific extra keys (e.g. dairy's nel_mcal_kg, aqua's epa/dha) and
// custom nutrient keys are added to rows on demand and are not enumerated here.
const BASE_NUTRIENT_KEYS = [
  "dm", "moisture",
  "me", "me_mj", "amen", "ne",
  "cp", "ee", "cf", "ash",
  "starch", "sugars", "ndf", "adf", "lignin", "nsp_total", "nsp_soluble", "nsp_insoluble",
  "total_lys", "total_met", "total_cys", "total_metcys", "total_thr", "total_trp", "total_arg", "total_val", "total_ile", "total_leu",
  "ca", "total_p", "avp", "na", "k", "cl", "mg", "s",
  "sid_lys", "sid_met", "sid_cys", "sid_metcys", "sid_thr", "sid_trp", "sid_arg", "sid_val", "sid_ile", "sid_leu",
  "fe", "zn", "mn", "cu", "i", "se",
  "vit_a", "vit_d3", "vit_e", "vit_k", "vit_b1", "vit_b2", "vit_b6", "vit_b12",
  "niacin", "pantothenic_acid", "folic_acid", "biotin", "choline",
  "deb", "beta_glucans", "arabinoxylans"
];

function isLiteScope(millId) {
  const raw = String(millId || "").trim();
  return raw === "lite" || raw.startsWith("lite_");
}

function isLiteDirName(name) {
  const n = String(name || "");
  return n === "lite" || n.startsWith("lite_");
}

function millKey(millId, owner) {
  const raw = String(millId || "").trim();
  const o = normalizeEmail(owner).replace(/[^a-z0-9]+/g, "_").slice(0, 80);
  if (isLiteScope(raw)) return o ? `lite_${o}` : "lite";
  if (raw && raw !== "default" && raw !== "personal") return raw;
  return o ? `personal_${o}` : "personal";
}

function millRoot() {
  return path.join(process.cwd(), "data", "custom_ingredient_dbs");
}

function rootDir(millId) {
  return path.join(millRoot(), String(millId || "default"));
}

function ownerAliases(owner) {
  return emailAliases(owner);
}

function dbPath(millId, dbId) {
  return path.join(rootDir(millId), `${dbId}.json`);
}

function baseNamePath(millId, owner, species) {
  const safe = String(owner || "default").toLowerCase().replace(/[^a-z0-9._+-]+/g, "_");
  const spec = String(species || "poultry").toLowerCase();
  return path.join(rootDir(millId), `_base_name_${safe}_${spec}.json`);
}

function getBaseLibraryName(millId, species, owner) {
  const j = readJson(baseNamePath(millKey(millId, owner), owner, species));
  const name = String(j?.name || "").trim();
  return name && name.toLowerCase() !== "brazilian" ? name : "";
}

function setBaseLibraryName(millId, species, owner, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  writeJson(baseNamePath(millKey(millId, owner), owner, species), {
    name: trimmed,
    owner: String(owner || "").toLowerCase(),
    species: String(species || "poultry").toLowerCase(),
    updated_at: new Date().toISOString()
  });
  return trimmed;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function toMeta(db) {
  return {
    id: db.id,
    name: db.name,
    species: db.species,
    mill_id: db.mill_id || null,
    owner_username: db.owner_username || null,
    ingredient_count: Array.isArray(db.ingredients) ? db.ingredients.length : 0,
    custom_nutrient_count: Array.isArray(db.custom_nutrients) ? db.custom_nutrients.length : 0,
    updated_at: db.updated_at
  };
}

function ownedBy(db, owner) {
  if (!db) return false;
  const aliases = ownerAliases(owner);
  if (!aliases.length) return false;
  return aliases.includes(String(db.owner_username || "").toLowerCase());
}

function claimOrphanDb(db, filePath, owner) {
  if (!db || db.owner_username || !owner) return;
  db.owner_username = normalizeEmail(owner) || String(owner).toLowerCase();
  try { writeJson(filePath, db); } catch {}
}

function findDbRecord(millId, dbId, owner) {
  const preferred = millKey(millId, owner);
  const liteScope = isLiteScope(millId) || isLiteDirName(preferred);
  const root = millRoot();
  const dirs = [];
  if (fs.existsSync(path.join(root, preferred))) dirs.push(preferred);
  if (!liteScope && fs.existsSync(root)) {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name === preferred) continue;
      if (isLiteDirName(ent.name)) continue;
      dirs.push(ent.name);
    }
  }
  for (const mk of dirs) {
    const fp = dbPath(mk, dbId);
    const db = readJson(fp);
    if (!db) continue;
    if (ownedBy(db, owner)) return { db, millKey: mk };
    // Orphan DB (owner_username null) in preferred directory — claim it
    if (!db.owner_username && mk === preferred) {
      claimOrphanDb(db, fp, owner);
      return { db, millKey: mk };
    }
  }
  return null;
}

function writeOwnedDb(millId, dbId, owner, db) {
  const found = findDbRecord(millId, dbId, owner);
  const mk = found?.millKey || millKey(millId, owner);
  writeJson(dbPath(mk, dbId), db);
  return mk;
}

function listDbs(millId, species, owner) {
  const root = millRoot();
  if (!fs.existsSync(root)) return [];
  const preferred = millKey(millId, owner);
  const liteScope = isLiteScope(millId) || isLiteDirName(preferred);
  const seen = new Set();
  const items = [];
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  dirs.sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0));
  for (const d of dirs) {
    if (liteScope && d.name !== preferred) continue;
    if (!liteScope && isLiteDirName(d.name)) continue;
    const dir = path.join(root, d.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const fp = path.join(dir, f);
      const db = readJson(fp);
      if (!db || !db.id || seen.has(db.id)) continue;
      const isPreferred = d.name === preferred;
      if (!ownedBy(db, owner)) {
        // Orphan DB in preferred directory — claim it for this owner
        if (!db.owner_username && isPreferred) {
          claimOrphanDb(db, fp, owner);
        } else {
          continue;
        }
      }
      if (species && db.species !== species) continue;
      seen.add(db.id);
      items.push(toMeta(db));
    }
  }
  return items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

function rowNameSig(rows) {
  return (rows || []).map((r) => `${r.ingredient_id}|${r.ingredient_name}`).join("\n");
}

function persistCleanedIngredients(found) {
  if (!found?.db || !Array.isArray(found.db.ingredients)) return found.db;
  const collapsed = sortIngredientsByCommonUse(
    collapseSpeciesCopies(
      found.db.ingredients.map((row) => ({
        ...row,
        ingredient_name: cleanIngredientDisplayName(row.ingredient_name)
      }))
    )
  );
  if (rowNameSig(collapsed) === rowNameSig(found.db.ingredients)) return found.db;
  found.db.ingredients = collapsed;
  found.db.updated_at = new Date().toISOString();
  writeJson(dbPath(found.millKey, found.db.id), found.db);
  return found.db;
}

function getDb(millId, dbId, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;
  return persistCleanedIngredients(found);
}

function scrubAllStoredIngredientDbs() {
  const root = millRoot();
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  for (const dirEnt of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirEnt.isDirectory()) continue;
    const dir = path.join(root, dirEnt.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const p = path.join(dir, f);
      const db = readJson(p);
      if (!db?.id || !Array.isArray(db.ingredients)) continue;
      persistCleanedIngredients({ db, millKey: dirEnt.name });
      n += 1;
    }
  }
  return n;
}

function createDb(millId, species, name, owner) {
  const now = new Date().toISOString();
  const db = {
    id: `cidb_${Date.now()}`,
    mill_id: millKey(millId, owner),
    owner_username: normalizeEmail(owner) || null,
    species: String(species || "").toLowerCase(),
    name: String(name || "Untitled Database"),
    created_at: now,
    updated_at: now,
    custom_nutrients: [],
    ingredients: []
  };
  writeJson(dbPath(millKey(millId, owner), db.id), db);
  return db;
}

function renameDb(millId, dbId, name, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;
  found.db.name = String(name || found.db.name);
  found.db.updated_at = new Date().toISOString();
  writeJson(dbPath(found.millKey, dbId), found.db);
  return found.db;
}

function deleteDb(millId, dbId, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return false;
  const p = dbPath(found.millKey, dbId);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

function blankIngredientRow(name, customNutrients) {
  const row = {
    ingredient_id: `ci_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    ingredient_name: String(name || "New Ingredient"),
    ingredient_code: "",
    category: "custom",
    status: "active",
    currency: "USD",
    price_basis: "per_metric_ton",
    price: null,
    lab_override_target: false,
    last_modified: new Date().toISOString(),
    modified_by: ""
  };

  for (const key of BASE_NUTRIENT_KEYS) row[key] = null;
  for (const def of customNutrients || []) row[def.key] = null;

  return row;
}

function addIngredient(millId, dbId, name, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;

  const row = blankIngredientRow(name, found.db.custom_nutrients);
  row.modified_by = normalizeEmail(owner) || String(owner || "").trim() || "user";
  found.db.ingredients.unshift(row);
  found.db.updated_at = new Date().toISOString();
  writeJson(dbPath(found.millKey, dbId), found.db);
  return row;
}

function updateIngredient(millId, dbId, ingredientId, fields, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;

  const row = found.db.ingredients.find((r) => r.ingredient_id === ingredientId);
  if (!row) return null;

  const now = new Date().toISOString();
  const actor = normalizeEmail(owner) || String(owner || "").trim() || "user";
  Object.assign(row, fields, {
    ingredient_id: row.ingredient_id,
    last_modified: now,
    modified_by: actor
  });
  found.db.updated_at = now;
  writeJson(dbPath(found.millKey, dbId), found.db);
  return row;
}

function identityKeys(row) {
  const id = String(row?.ingredient_id || "").trim().toLowerCase();
  const name = canonicalIngredientKey(row?.ingredient_name) || String(row?.ingredient_name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return { id, name };
}

const SPECIES_TOKEN = "poultry|broiler|layer|turkey|swine|pig|porcine|equine|horse|beef|dairy|cattle|ruminant|goat|sheep|ovine|caprine|canine|feline|dog|cat";

function cleanEncoding(name) {
  return String(name || "")
    .replace(/Ã¢â‚¬[\s\S]?/g, " ")
    .replace(/â[\u0080-\u00ff€ê]{0,6}["”']?/g, " ")
    .replace(/[\u2013\u2014\u2015\u2212]/g, " ")
    .replace(/&mdash;|&ndash;/gi, " ")
    .replace(/[\u00A0-\u00BF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIngredientDisplayName(name) {
  const cleaned = stripSpeciesLabel(name);
  return cleaned || cleanEncoding(name);
}

function stripSpeciesLabel(name) {
  let s = cleanEncoding(name);
  const endSp = new RegExp(
    `\\s*(?:[\\(\\[—\\-–:|/]+\\s*)?(?:for\\s+)?(?:${SPECIES_TOKEN})\\s*[\\)\\]]?\\s*$`,
    "ig"
  );
  s = s.replace(endSp, "");
  s = s.replace(new RegExp(`\\s+(?:${SPECIES_TOKEN})\\s*$`, "ig"), "");
  s = s.replace(/\s+/g, " ").trim();
  return s || cleanEncoding(name);
}

function trailingSpecies(name) {
  const m = cleanEncoding(name).match(new RegExp(`(?:^|[\\s(\\[—\\-–:|/])(?:for\\s+)?(${SPECIES_TOKEN})\\s*[\\)\\]]?\\s*$`, "i"));
  return m ? m[1].toLowerCase() : "";
}

function canonicalIngredientKey(name) {
  let s = stripSpeciesLabel(name).toLowerCase();
  s = s.replace(/[()[\],]/g, " ");
  s = s.replace(/\b(average|aver\.?|mean|[+\-]?\s*1\s*sd(?:\s+of\s+dm)?)\b/g, " ");
  s = s.replace(/[^a-z0-9.%]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\bsoya(?:bean)?\b/g, "soybean");
  s = s.replace(/\bmaize\b/g, "corn");
  s = s.replace(/\byellow corn\b/g, "corn");
  s = s.replace(/\bcorn grain\b/g, "corn");
  s = s.replace(/\bsodium chloride\b|\bnacl\b/g, "salt");
  s = s.replace(/\bcalcium carbonate\b|\bcaco3\b/g, "limestone");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function isGenericCommodity(canon) {
  const s = String(canon || "");
  return /^(salt|corn|wheat|barley|sorghum|soybean meal|limestone|dicalcium|monocalcium|mcp|dcp|soybean oil|palm oil|lysine|methionine|threonine|tryptophan|valine|choline|rice bran|rice polish|broken rice|wheat bran|ddgs|molasses)\b/.test(s);
}

function nutrientFillScore(row) {
  let n = 0;
  for (const [k, v] of Object.entries(row || {})) {
    if (v == null || v === "") continue;
    if (["ingredient_id", "ingredient_name", "ingredient_code", "category", "status", "currency", "price_basis", "last_modified", "modified_by"].includes(k)) continue;
    n += 1;
  }
  return n;
}

function pickCanonicalRow(list) {
  return list.slice().sort((a, b) => {
    const ua = String(a?.modified_by || "").toLowerCase();
    const ub = String(b?.modified_by || "").toLowerCase();
    const userA = ua && ua !== "nutrix" && ua !== "system";
    const userB = ub && ub !== "nutrix" && ub !== "system";
    if (userA !== userB) return userA ? -1 : 1;
    const pa = a?.price != null && a.price !== "";
    const pb = b?.price != null && b.price !== "";
    if (pa !== pb) return pa ? -1 : 1;
    return nutrientFillScore(b) - nutrientFillScore(a);
  })[0];
}

function collapseSpeciesCopies(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const key = canonicalIngredientKey(row.ingredient_name) || String(row.ingredient_id || "").trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const list of groups.values()) {
    const best = { ...pickCanonicalRow(list) };
    best.ingredient_name = cleanIngredientDisplayName(best.ingredient_name);
    out.push(best);
  }
  return out;
}

const COMMON_USE_GROUPS = [
  // ── 1. GRAINS ──────────────────────────────────────────────────────────
  { pats: ["yellow corn", "maize grain", "corn grain", "yellow maize"] },
  { pats: ["corn", "maize"], exclude: ["gluten", "distiller", "ddgs", "ddg", "oil", "hominy", "steep", "silage", "ensilage", "stover", "bran", "germ", "sweet feed"] },
  { pats: ["wheat grain", "wheat, grain"], exclude: ["bran", "gluten", "middling", "mill run", "shorts", "germ", "pollard", "straw"] },
  { pats: ["wheat"], exclude: ["bran", "gluten", "middling", "mill run", "shorts", "germ", "pollard", "straw", "silage"] },
  { pats: ["barley"], exclude: ["malt", "straw"] },
  { pats: ["sorghum", "milo"] },
  { pats: [" oat", "(oat", "oats,", "oats ", "oats)"], exclude: ["hull", "hulls", "straw", "hay", "sweet feed", "textured"] },
  { pats: ["rye"], exclude: ["ryegrass"] },
  { pats: ["triticale"] },
  { pats: ["broken rice", "rice broken", "rice, grain", "rice grain"] },
  { pats: ["cassava", "tapioca", "manioc"] },

  // ── 2. PROTEIN MEALS ───────────────────────────────────────────────────
  { pats: ["soybean meal", "soya meal", "soyabean meal", "sbm", "solvent extracted soy"] },
  { pats: ["full fat soy", "full-fat soy", "soybean, full", "fullfat soy", "extruded soy", "roasted soy"] },
  { pats: ["heat-treated soybean", "toasted soybean"] },
  { pats: ["canola meal", "rapeseed meal", "canola, meal", "rapeseed, meal"] },
  { pats: ["sunflower meal", "sunflower, meal", "sunflower seed meal"] },
  { pats: ["cottonseed meal", "cottonseed, meal"] },
  { pats: ["cottonseed"] },
  { pats: ["peanut meal", "groundnut meal"] },
  { pats: ["palm kernel meal", "palm kernel expeller", "pke"] },
  { pats: ["sesame meal", "sesame, meal"] },
  { pats: ["linseed meal", "flaxseed meal", "linseed, meal"] },
  { pats: ["fish meal", "fish, meal"] },
  { pats: ["blood meal"] },
  { pats: ["feather meal", "hydrolyzed feather"] },
  { pats: ["meat and bone", "meat & bone", "mbm"] },
  { pats: ["poultry by", "poultry meal", "poultry byproduct", "pbm"] },
  { pats: ["insect meal", "bsfl", "black soldier", "housefly"] },
  { pats: ["algae", "spirulina", "chlorella"] },
  { pats: ["blood plasma", "plasma protein"] },

  // ── 3. CRYSTALLINE AMINO ACIDS ─────────────────────────────────────────
  { pats: ["l-lysine", "lysine hcl", "lys hcl", "lysine sulphate", "lysine sulfate"] },
  { pats: ["lysine"] },
  { pats: ["dl-methionine", "l-methionine", "mha", "dlm", "methionine hydroxy"] },
  { pats: ["methionine"] },
  { pats: ["l-threonine", "threonine"] },
  { pats: ["l-tryptophan", "tryptophan"] },
  { pats: ["l-valine", "valine"] },
  { pats: ["l-isoleucine", "isoleucine"] },
  { pats: ["l-leucine", "leucine"] },
  { pats: ["l-arginine", "arginine"] },
  { pats: ["l-histidine", "histidine"] },
  { pats: ["l-phenylalanine", "phenylalanine"] },
  { pats: ["l-cysteine", "cysteine", "cystine"] },
  { pats: ["glycine"] },
  { pats: ["l-proline", "proline"] },
  { pats: ["glutamic acid", "glutamine"] },

  // ── 4. BY-PRODUCTS & CO-PRODUCTS ──────────────────────────────────────
  { pats: ["ddgs", "distiller"] },
  { pats: ["corn gluten meal", "maize gluten meal"] },
  { pats: ["corn gluten", "maize gluten"] },
  { pats: ["corn hominy", "hominy feed"] },
  { pats: ["corn steep", "corn steepwater"] },
  { pats: ["wheat bran", "wheat, bran"] },
  { pats: ["wheat middling", "wheat, middling", "wheat shorts", "wheat mill run", "wheat pollard"] },
  { pats: ["wheat germ"] },
  { pats: ["rice bran", "rice polish"] },
  { pats: ["rice hulls", "rice husk"] },
  { pats: ["soybean hulls", "soy hulls", "soybean, hulls"] },
  { pats: ["oat hulls", "oat hull"] },
  { pats: ["beet pulp"] },
  { pats: ["citrus pulp"] },
  { pats: ["brewer", "brewery"] },
  { pats: ["bakery", "bread by", "cookie meal"] },
  { pats: ["molasses"] },
  { pats: ["alfalfa hay", "alfalfa, hay", "alfalfa silage", "alfalfa haylage"] },
  { pats: ["alfalfa"] },
  { pats: ["grass hay", "grass silage", "bermuda", "orchard grass", "timothy"] },
  { pats: ["corn silage", "maize silage"] },

  // ── 5. FATS & OILS ─────────────────────────────────────────────────────
  { pats: ["soybean oil", "soy oil", "soybean, degummed", "soybean acid oil"] },
  { pats: ["palm oil", "palm, oil", "rbd palm"], exclude: ["kernel"] },
  { pats: ["palm kernel oil"] },
  { pats: ["canola oil", "rapeseed oil"] },
  { pats: ["sunflower oil"] },
  { pats: ["tallow", "beef tallow"] },
  { pats: ["lard", "pork fat"] },
  { pats: ["poultry fat", "chicken fat"] },
  { pats: ["animal fat", "choice white grease", "grease"] },
  { pats: ["fish oil"] },
  { pats: ["acid oil", "soapstock"] },
  { pats: ["coconut oil"] },

  // ── 6. ENZYMES & FEED ADDITIVES ────────────────────────────────────────
  { pats: ["phytase"] },
  { pats: ["xylanase", "arabinoxylanase"] },
  { pats: ["beta-glucanase", "betaglucanase"] },
  { pats: ["protease"] },
  { pats: ["amylase"] },
  { pats: ["cellulase"] },
  { pats: ["lipase"] },
  { pats: ["nsp enzyme", "enzyme complex", "multienzyme"] },
  { pats: ["enzyme"] },
  { pats: ["probiotic", "direct-fed microbial", "dfm", "bacillus", "lactobacillus", "enterococcus"] },
  { pats: ["prebiotic", "mannan oligosaccharide", "fructo-oligosaccharide", "mos", "fos"] },
  { pats: ["mycotoxin binder", "toxin binder", "bentonite", "sepiolite", "montmorillonite", "smectite"] },
  { pats: ["coccidiostat", "salinomycin", "monensin", "lasalocid", "narasin", "maduramicin", "robenidine", "diclazuril", "nicarbazin"] },
  { pats: ["antioxidant", "ethoxyquin", "bha", "bht", "tocopheryl acetate"] },
  { pats: ["organic acid", "formic acid", "propionic acid", "butyrate", "lactic acid", "citric acid", "fumaric acid"] },
  { pats: ["essential oil", "thymol", "carvacrol", "oregano oil"] },
  { pats: ["beta-glucan", "beta glucan", "oat beta"] },
  { pats: ["yeast cell", "yeast culture", "saccharomyces"] },
  { pats: ["growth promoter", "antibiotic", "bacitracin", "virginiamycin"] },
  { pats: ["acidifier"] },
  { pats: ["anticoccidial", "coccidian"] },
  { pats: ["emulsifier", "lecithin", "lysolecithin"] },

  // ── 7. MACRO MINERAL SOURCES ───────────────────────────────────────────
  { pats: ["limestone", "calcium carbonate", "caco3", "calcite", "oyster shell"] },
  { pats: ["dicalcium phosphate", "dicalcium, phosphate", "dcp", "di-calcium phosphate"] },
  { pats: ["monocalcium phosphate", "monocalcium, phosphate", "mcp", "mono-calcium phosphate"] },
  { pats: ["tricalcium phosphate", "tcp"] },
  { pats: ["defluorinated phosphate", "rock phosphate"] },
  { pats: ["calcium phosphate"] },
  { pats: ["salt", "nacl", "sodium chloride", "table salt"] },
  { pats: ["sodium bicarbonate", "baking soda", "nahco3"] },
  { pats: ["sodium sulfate", "na2so4"] },
  { pats: ["potassium chloride", "kcl", "potassium, chloride"] },
  { pats: ["potassium bicarbonate", "potassium carbonate"] },
  { pats: ["magnesium oxide", "mgo", "calcined magnesite"] },
  { pats: ["magnesium sulfate", "mgso4", "epsom salt", "kieserite"] },
  { pats: ["calcium sulfate", "gypsum", "caso4"] },
  { pats: ["phosphoric acid"] },
  { pats: ["sulfur", "elemental sulfur", "flowers of sulfur"] },
  { pats: ["sodium phosphate", "monosodium phosphate", "disodium phosphate"] },
  { pats: ["urea"], exclude: ["formaldehyde"] },

  // ── 8. MICRO MINERALS (TRACE) ──────────────────────────────────────────
  { pats: ["zinc sulfate", "zinc oxide", "zinc methionine", "zinc amino", "zinc proteinate", "organic zinc"] },
  { pats: ["zinc"] },
  { pats: ["copper sulfate", "cupric sulfate", "copper amino", "copper proteinate", "organic copper"] },
  { pats: ["copper"] },
  { pats: ["manganese oxide", "manganese sulfate", "manganese amino", "manganese proteinate", "organic manganese"] },
  { pats: ["manganese"] },
  { pats: ["ferrous sulfate", "ferric oxide", "iron amino", "iron proteinate", "organic iron"] },
  { pats: ["iron"] },
  { pats: ["selenium", "sodium selenite", "sodium selenate", "selenomethionine", "organic selenium"] },
  { pats: ["iodine", "potassium iodide", "calcium iodate", "ethylenediamine dihydriodide", "eddi"] },
  { pats: ["cobalt"] },
  { pats: ["chromium", "chromium picolinate", "chromium propionate"] },
  { pats: ["trace mineral", "micro mineral", "mineral mix", "mineral blend"] },

  // ── 9. VITAMINS ────────────────────────────────────────────────────────
  { pats: ["vitamin a", "retinol", "retinyl acetate", "retinyl palmitate"] },
  { pats: ["vitamin d3", "cholecalciferol", "25-hydroxyvitamin d"] },
  { pats: ["vitamin d2", "ergocalciferol"] },
  { pats: ["vitamin d"] },
  { pats: ["vitamin e", "tocopherol", "all-rac tocopheryl", "dl-alpha tocopheryl"] },
  { pats: ["vitamin k3", "menadione", "msb", "mpb", "mnb"] },
  { pats: ["vitamin k"] },
  { pats: ["vitamin b12", "cyanocobalamin", "hydroxocobalamin"] },
  { pats: ["folic acid", "folate", "pteroylglutamic"] },
  { pats: ["biotin", "d-biotin"] },
  { pats: ["pantothenic acid", "d-pantothenate", "calcium pantothenate"] },
  { pats: ["niacin", "nicotinic acid", "niacinamide", "nicotinamide"] },
  { pats: ["riboflavin", "vitamin b2"] },
  { pats: ["thiamine", "vitamin b1", "thiamin"] },
  { pats: ["pyridoxine", "vitamin b6", "pyridoxal", "pyridoxamine"] },
  { pats: ["choline chloride", "choline"] },
  { pats: ["inositol", "myo-inositol"] },
  { pats: ["ascorbic acid", "vitamin c"] },
  { pats: ["vitamin", "vit "] },
  { pats: ["premix", "mineral premix", "vitamin-mineral", "vitamin mineral"] },
];

function commonUseRank(row) {
  const s = `${row?.ingredient_name || ""} ${row?.ingredient_id || ""}`.toLowerCase();
  for (let i = 0; i < COMMON_USE_GROUPS.length; i++) {
    const g = COMMON_USE_GROUPS[i];
    if ((g.exclude || []).some((x) => s.includes(x))) continue;
    if ((g.pats || []).some((p) => s.includes(p))) return i;
  }
  return 9000;
}

function sortIngredientsByCommonUse(rows) {
  return (rows || []).slice().sort((a, b) => {
    const d = commonUseRank(a) - commonUseRank(b);
    if (d) return d;
    return String(a?.ingredient_name || "").localeCompare(String(b?.ingredient_name || ""), undefined, {
      sensitivity: "base"
    });
  });
}

function mergeUniqueIngredients(millId, dbId, owner, incoming) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;
  const seenId = new Set();
  const seenName = new Set();
  const out = [];
  const push = (row) => {
    if (!row) return false;
    const { id, name } = identityKeys(row);
    if (id && seenId.has(id)) return false;
    if (name && seenName.has(name)) return false;
    if (id) seenId.add(id);
    if (name) seenName.add(name);
    out.push(row);
    return true;
  };
  for (const row of found.db.ingredients || []) push(row);
  for (const row of incoming || []) push(row);
  const collapsed = collapseSpeciesCopies(out);
  const sorted = sortIngredientsByCommonUse(collapsed);
  const prev = Array.isArray(found.db.ingredients) ? found.db.ingredients : [];
  const same = rowNameSig(sorted) === rowNameSig(prev);
  found.db.ingredients = sorted;
  if (!same) {
    found.db.updated_at = new Date().toISOString();
    writeJson(dbPath(found.millKey, dbId), found.db);
  }
  return found.db;
}

function seedIngredientsIfEmpty(millId, dbId, owner, rows) {
  return mergeUniqueIngredients(millId, dbId, owner, rows);
}

function deleteIngredient(millId, dbId, ingredientId, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return false;

  const before = found.db.ingredients.length;
  found.db.ingredients = found.db.ingredients.filter((r) => r.ingredient_id !== ingredientId);
  if (found.db.ingredients.length === before) return false;

  found.db.updated_at = new Date().toISOString();
  writeJson(dbPath(found.millKey, dbId), found.db);
  return true;
}

function addCustomNutrient(millId, dbId, def, owner) {
  const found = findDbRecord(millId, dbId, owner);
  if (!found) return null;

  const key = String(def.key || "").trim();
  if (!key) return null;

  if (!found.db.custom_nutrients.some((d) => d.key === key)) {
    found.db.custom_nutrients.push({ key, label: String(def.label || key), unit: def.unit || null });
    for (const row of found.db.ingredients) {
      if (!(key in row)) row[key] = null;
    }
  }

  found.db.updated_at = new Date().toISOString();
  writeJson(dbPath(found.millKey, dbId), found.db);
  return found.db;
}

module.exports = {
  BASE_NUTRIENT_KEYS,
  listDbs,
  getDb,
  createDb,
  renameDb,
  deleteDb,
  addIngredient,
  updateIngredient,
  deleteIngredient,
  seedIngredientsIfEmpty,
  mergeUniqueIngredients,
  collapseSpeciesCopies,
  canonicalIngredientKey,
  cleanIngredientDisplayName,
  scrubAllStoredIngredientDbs,
  addCustomNutrient,
  getBaseLibraryName,
  setBaseLibraryName
};
